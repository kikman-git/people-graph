import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type {
  Category, DirectoryEntry, Fact, FactFields, HistoryEntry, InteractionFields,
  MapPin, PersonCard, PersonFields, Profile, RelType, Relationship,
  RelationshipFields, SearchResult, SupersededFact, TagInfo,
} from "./types";
import { CATEGORIES, REL_TYPES } from "./types";

const DB_PATH =
  process.env.PEOPLE_DB ?? path.join(os.homedir(), ".openclaw/data/people.sqlite");
const MEDIA_DIR = path.join(os.homedir(), ".openclaw/data/people-media");

// The schema (incl. the FTS sync triggers) is owned by people_write.py — run
// `people_write.py init` once. The web app's own writes below are the
// "validated CRUD" the plan allows; the Telegram bot still writes only via
// the script. Triggers keep the FTS index in sync for both paths.
function withDb<T>(fn: (db: DatabaseSync) => T): T {
  const db = new DatabaseSync(DB_PATH, { readOnly: true });
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

function withDbRW<T>(fn: (db: DatabaseSync) => T): T {
  const db = new DatabaseSync(DB_PATH);
  db.exec("PRAGMA foreign_keys = ON"); // cascades must fire the fts triggers
  db.exec("PRAGMA busy_timeout = 5000");
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

type Row = Record<string, unknown>;

/* ---------------------------------------------------- directory assembly -- */

function aliasesByPerson(db: DatabaseSync): Map<number, string[]> {
  const m = new Map<number, string[]>();
  for (const r of db.prepare("SELECT person_id, alias FROM aliases ORDER BY id").all() as Row[]) {
    const pid = r.person_id as number;
    if (!m.has(pid)) m.set(pid, []);
    m.get(pid)!.push(String(r.alias));
  }
  return m;
}

function tagsByPerson(db: DatabaseSync): Map<number, string[]> {
  const rows = db
    .prepare(
      `SELECT person_id, tag, count(*) n FROM facts
       WHERE active=1 AND tag IS NOT NULL GROUP BY person_id, tag
       ORDER BY person_id, n DESC, tag`
    )
    .all() as Row[];
  const m = new Map<number, string[]>();
  for (const r of rows) {
    const pid = r.person_id as number;
    if (!m.has(pid)) m.set(pid, []);
    const tags = m.get(pid)!;
    if (tags.length < 3) tags.push(String(r.tag));
  }
  return m;
}

function entriesFor(db: DatabaseSync, ids: number[] | null): DirectoryEntry[] {
  const filter = ids ? `WHERE p.id IN (${ids.map(() => "?").join(",")})` : "";
  const rows = db
    .prepare(
      `SELECT p.id, p.display_name, p.location, p.photo_path, p.updated_at,
         (SELECT count(*) FROM facts f WHERE f.person_id=p.id AND f.active=1) AS fact_count,
         (SELECT max(i.happened_on) FROM interactions i
            JOIN interaction_people ip ON ip.interaction_id=i.id
            WHERE ip.person_id=p.id AND i.active=1) AS last_interaction
       FROM people p ${filter} ORDER BY p.updated_at DESC, p.id DESC`
    )
    .all(...(ids ?? [])) as Row[];
  const aliases = aliasesByPerson(db);
  const tags = tagsByPerson(db);
  return rows.map((r) => ({
    id: r.id as number,
    display_name: String(r.display_name),
    location: (r.location as string) ?? null,
    aliases: aliases.get(r.id as number) ?? [],
    tags: tags.get(r.id as number) ?? [],
    factCount: r.fact_count as number,
    lastInteraction: (r.last_interaction as string) ?? null,
    hasPhoto: !!r.photo_path,
    updated_at: String(r.updated_at),
  }));
}

export function directory(): DirectoryEntry[] {
  return withDb((db) => entriesFor(db, null));
}

// Lightweight id+name list (relationship pickers etc.).
export function peopleRefs(): { id: number; display_name: string }[] {
  return withDb((db) =>
    (db.prepare("SELECT id, display_name FROM people ORDER BY display_name").all() as Row[])
      .map((r) => ({ id: r.id as number, display_name: String(r.display_name) }))
  );
}

/* -------------------------------------------------------------- profile --- */

export function profile(id: number): Profile | null {
  return withDb((db) => {
    const p = db.prepare("SELECT * FROM people WHERE id=?").get(id) as Row | undefined;
    if (!p) return null;
    const person: PersonCard = {
      id: p.id as number,
      display_name: String(p.display_name),
      aliases: (db.prepare("SELECT alias FROM aliases WHERE person_id=? ORDER BY id").all(id) as Row[])
        .map((r) => String(r.alias)),
      birthday: (p.birthday as string) ?? null,
      location: (p.location as string) ?? null,
      lat: (p.lat as number) ?? null,
      lng: (p.lng as number) ?? null,
      how_we_met: (p.how_we_met as string) ?? null,
      phone: (p.phone as string) ?? null,
      email: (p.email as string) ?? null,
      handles: p.handles ? (JSON.parse(String(p.handles)) as Record<string, string>) : null,
      hasPhoto: !!p.photo_path,
      created_at: String(p.created_at),
      updated_at: String(p.updated_at),
    };

    const about: Partial<Record<Category, Fact[]>> = {};
    const factRows = db
      .prepare(
        `SELECT id, category, value, tag, learned_at FROM facts
         WHERE person_id=? AND active=1 ORDER BY learned_at DESC, id DESC`
      )
      .all(id) as Row[];
    for (const cat of CATEGORIES) {
      const facts = factRows
        .filter((r) => r.category === cat)
        .map((r) => ({
          id: r.id as number, category: cat, value: String(r.value),
          tag: (r.tag as string) ?? null, learned_at: String(r.learned_at),
        }));
      if (facts.length) about[cat] = facts;
    }

    const superseded: SupersededFact[] = (
      db.prepare(
        `SELECT f.id, f.category, f.value, f.tag, f.learned_at, g.value AS replaced_by
         FROM facts f LEFT JOIN facts g ON g.id = f.superseded_by
         WHERE f.person_id=? AND f.active=0 ORDER BY f.id DESC`
      ).all(id) as Row[]
    ).map((r) => ({
      id: r.id as number, category: r.category as Category, value: String(r.value),
      tag: (r.tag as string) ?? null, learned_at: String(r.learned_at),
      replacedByValue: (r.replaced_by as string) ?? null,
    }));

    const withPeople = db.prepare(
      `SELECT p.id, p.display_name FROM interaction_people ip
       JOIN people p ON p.id = ip.person_id
       WHERE ip.interaction_id=? AND ip.person_id != ?`
    );
    const history: HistoryEntry[] = (
      db.prepare(
        `SELECT i.id, i.happened_on, i.place, i.summary FROM interactions i
         JOIN interaction_people ip ON ip.interaction_id = i.id
         WHERE ip.person_id=? AND i.active=1
         ORDER BY i.happened_on DESC, i.id DESC`
      ).all(id) as Row[]
    ).map((r) => ({
      id: r.id as number, happened_on: String(r.happened_on),
      place: (r.place as string) ?? null, summary: String(r.summary),
      with: (withPeople.all(r.id as number, id) as Row[]).map((w) => ({
        id: w.id as number, display_name: String(w.display_name),
      })),
    }));

    const relationships: Relationship[] = (
      db.prepare(
        `SELECT r.id, r.person_a, r.person_b, r.rel_type, r.label,
                pa.display_name AS name_a, pb.display_name AS name_b
         FROM relationships r
         JOIN people pa ON pa.id = r.person_a
         JOIN people pb ON pb.id = r.person_b
         WHERE r.person_a=? OR r.person_b=?`
      ).all(id, id) as Row[]
    ).map((r) => {
      const isA = r.person_a === id;
      return {
        id: r.id as number,
        rel_type: r.rel_type as RelType,
        label: (r.label as string) ?? null,
        direction: isA ? ("a" as const) : ("b" as const),
        other: {
          id: (isA ? r.person_b : r.person_a) as number,
          display_name: String(isA ? r.name_b : r.name_a),
        },
      };
    });

    return { person, about, superseded, history, relationships };
  });
}

/* --------------------------------------------------------------- search --- */

function ftsExpr(q: string): string {
  return q
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => `"${t.replaceAll('"', '""')}"`)
    .join(" ");
}

const likeEscape = (q: string) =>
  q.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");

export function search(q: string): SearchResult[] {
  const query = q.trim();
  if (!query) return directory().map((e) => ({ ...e, match: null }));
  return withDb((db) => {
    // First match per person wins (hits arrive in bm25 rank order).
    const matches = new Map<number, string | null>();
    const note = (pid: number, text: string | null) => {
      if (!matches.has(pid)) matches.set(pid, text);
    };

    const factRow = db.prepare("SELECT person_id, value, active FROM facts WHERE id=?");
    const interRow = db.prepare("SELECT summary, active FROM interactions WHERE id=?");
    const interPeople = db.prepare(
      "SELECT person_id FROM interaction_people WHERE interaction_id=?"
    );
    const consume = (kind: string, refId: number, pid: number | null) => {
      if (kind === "person" || kind === "alias") {
        if (pid != null) note(pid, null); // the card itself shows the matched name
        return;
      }
      if (kind === "fact") {
        const f = factRow.get(refId) as Row | undefined;
        if (f && f.active === 1) note(f.person_id as number, String(f.value));
        return;
      }
      if (kind === "interaction") {
        const i = interRow.get(refId) as Row | undefined;
        if (!i || i.active !== 1) return;
        for (const r of interPeople.all(refId) as Row[]) {
          note(r.person_id as number, String(i.summary));
        }
      }
    };

    let rows: Row[] = [];
    try {
      rows = db
        .prepare(
          `SELECT kind, ref_id, person_id FROM fts
           WHERE fts MATCH ? ORDER BY bm25(fts) LIMIT 80`
        )
        .all(ftsExpr(query)) as Row[];
    } catch {
      rows = []; // FTS syntax quirk — the LIKE fallback below still answers
    }
    for (const r of rows) {
      consume(String(r.kind), r.ref_id as number, (r.person_id as number) ?? null);
    }

    if (matches.size === 0) {
      // FTS tokenizes CJK per run, so substring matches inside Japanese words
      // (and mid-word latin) land here.
      const pat = `%${likeEscape(query)}%`;
      const scans: [string, string][] = [
        ["person", `SELECT id, id AS pid FROM people WHERE display_name LIKE ? ESCAPE '\\'`],
        ["alias", `SELECT id, person_id AS pid FROM aliases WHERE alias LIKE ? ESCAPE '\\'`],
        ["fact", `SELECT id, person_id AS pid FROM facts
                  WHERE value LIKE ? ESCAPE '\\' OR tag LIKE ? ESCAPE '\\'`],
        ["interaction", `SELECT id, NULL AS pid FROM interactions
                         WHERE summary LIKE ? ESCAPE '\\' OR place LIKE ? ESCAPE '\\'`],
      ];
      for (const [kind, sql] of scans) {
        const params = sql.split("?").length - 1;
        for (const r of db.prepare(sql).all(...Array(params).fill(pat)) as Row[]) {
          consume(kind, r.id as number, (r.pid as number) ?? null);
        }
      }
    }

    const ids = [...matches.keys()];
    if (!ids.length) return [];
    const byId = new Map(entriesFor(db, ids).map((e) => [e.id, e]));
    return ids
      .filter((id) => byId.has(id))
      .map((id) => ({ ...byId.get(id)!, match: matches.get(id) ?? null }));
  });
}

/* ------------------------------------------------------------------ map --- */

export function mapPins(): MapPin[] {
  return withDb((db) => {
    const rows = db
      .prepare(
        `SELECT id, display_name, lat, lng, location, photo_path
         FROM people WHERE lat IS NOT NULL AND lng IS NOT NULL`
      )
      .all() as Row[];
    const aliases = aliasesByPerson(db);
    const tags = tagsByPerson(db);
    const factStmt = db.prepare(
      `SELECT value FROM facts WHERE person_id=? AND active=1
       ORDER BY learned_at DESC, id DESC LIMIT 3`
    );
    return rows.map((r) => ({
      id: r.id as number,
      display_name: String(r.display_name),
      lat: r.lat as number,
      lng: r.lng as number,
      location: (r.location as string) ?? null,
      hasPhoto: !!r.photo_path,
      aliases: aliases.get(r.id as number) ?? [],
      tags: tags.get(r.id as number) ?? [],
      facts: (factStmt.all(r.id as number) as Row[]).map((f) => String(f.value)),
    }));
  });
}

/* ---------------------------------------------------------------- photo --- */

// Resolve a person's archived photo; fails closed on anything outside the
// people-media directory (same posture as ledger-web's receipt serving).
export function photoPath(id: number): string | null {
  const row = withDb((db) =>
    db.prepare("SELECT photo_path FROM people WHERE id=?").get(id)
  ) as { photo_path: string | null } | undefined;
  if (!row?.photo_path) return null;
  let p: string;
  try {
    p = fs.realpathSync(row.photo_path);
  } catch {
    return null;
  }
  if (!p.startsWith(MEDIA_DIR + path.sep) || !fs.statSync(p).isFile()) return null;
  return p;
}

/* ================================================================ writes ===
   Validated CRUD for the web UI (ledger precedent). The Telegram bot never
   uses these — it writes only via people_write.py. Shared discipline:
   validate() returns {fields} or {errors}; a write with errors never runs.
   Facts and interactions are never hard-deleted here either — deactivate/
   supersede only. The one hard delete is a whole person (explicit user
   action in the UI, per the red lines). */

type Validated<T> = { fields?: T; errors?: string[] };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const nowUtc = () => new Date().toISOString();

function isRealDate(s: string): boolean {
  if (!DATE_RE.test(s)) return false;
  try {
    return new Date(s + "T00:00:00Z").toISOString().slice(0, 10) === s;
  } catch {
    return false;
  }
}

// 'YYYY-MM-DD', or 'MM-DD' when the year is unknown ('2000-' = leap probe).
const isBirthday = (s: string) =>
  isRealDate(s) || (/^\d{2}-\d{2}$/.test(s) && isRealDate(`2000-${s}`));

// 'Rock Climbing' -> 'rock_climbing'; null if empty; error string if invalid.
function normTag(raw: unknown): { tag: string | null; error?: string } {
  const s = String(raw ?? "").trim().toLowerCase();
  if (!s) return { tag: null };
  const t = s.replace(/[\s\-]+/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "");
  if (!/^[a-z0-9_]+$/.test(t)) {
    return { tag: null, error: `tag must be english snake_case (a-z, 0-9, _); got "${raw}"` };
  }
  return { tag: t };
}

const optStr = (v: unknown, max: number): string | null => {
  const s = typeof v === "string" ? v.trim().slice(0, max) : "";
  return s || null;
};

function touch(db: DatabaseSync, ids: number[]) {
  const ts = nowUtc();
  const st = db.prepare("UPDATE people SET updated_at=? WHERE id=?");
  for (const id of new Set(ids)) st.run(ts, id);
}

function personExists(db: DatabaseSync, id: number): boolean {
  return !!db.prepare("SELECT 1 FROM people WHERE id=?").get(id);
}

function tx<T>(db: DatabaseSync, fn: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const r = fn();
    db.exec("COMMIT");
    return r;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

/* ---- person ---- */

export function validatePerson(body: unknown): Validated<PersonFields> {
  const errors: string[] = [];
  const o = (body ?? {}) as Record<string, unknown>;

  const display_name = typeof o.display_name === "string" ? o.display_name.trim() : "";
  if (!display_name || display_name.length > 120) {
    errors.push("name is required (max 120 chars)");
  }

  let birthday: string | null = null;
  if (o.birthday != null && o.birthday !== "") {
    birthday = typeof o.birthday === "string" && isBirthday(o.birthday) ? o.birthday : "";
    if (!birthday) errors.push("birthday must be YYYY-MM-DD, or MM-DD when the year is unknown");
  }

  let lat: number | null = null;
  let lng: number | null = null;
  const hasLat = o.lat != null && o.lat !== "";
  const hasLng = o.lng != null && o.lng !== "";
  if (hasLat !== hasLng) errors.push("lat and lng must be given together");
  else if (hasLat) {
    lat = typeof o.lat === "number" ? o.lat : NaN;
    lng = typeof o.lng === "number" ? o.lng : NaN;
    if (!(lat! >= -90 && lat! <= 90 && lng! >= -180 && lng! <= 180)) {
      errors.push("lat/lng out of range");
    }
  }

  let handles: string | null = null;
  if (o.handles != null && o.handles !== "") {
    try {
      const h: unknown = typeof o.handles === "string" ? JSON.parse(o.handles) : o.handles;
      if (
        typeof h !== "object" || h === null || Array.isArray(h) ||
        !Object.values(h).every((v) => typeof v === "string")
      ) throw new Error();
      handles = Object.keys(h as object).length
        ? JSON.stringify(h)
        : null;
    } catch {
      errors.push('handles must be a JSON object of strings, e.g. {"line": "kenji_t"}');
    }
  }

  const seen = new Set<string>([display_name.toLowerCase()]);
  const aliases: string[] = [];
  for (const a of Array.isArray(o.aliases) ? o.aliases : []) {
    const s = typeof a === "string" ? a.trim().slice(0, 120) : "";
    if (!s || seen.has(s.toLowerCase())) continue;
    seen.add(s.toLowerCase());
    aliases.push(s);
  }

  if (errors.length) return { errors };
  return {
    fields: {
      display_name, birthday,
      location: optStr(o.location, 200), lat, lng,
      how_we_met: optStr(o.how_we_met, 500),
      phone: optStr(o.phone, 60), email: optStr(o.email, 120),
      handles, aliases,
    },
  };
}

export function updatePerson(id: number, f: PersonFields): boolean {
  return withDbRW((db) => {
    if (!personExists(db, id)) return false;
    return tx(db, () => {
      db.prepare(
        `UPDATE people SET display_name=?, birthday=?, location=?, lat=?, lng=?,
           how_we_met=?, phone=?, email=?, handles=?, updated_at=? WHERE id=?`
      ).run(
        f.display_name, f.birthday, f.location, f.lat, f.lng,
        f.how_we_met, f.phone, f.email, f.handles, nowUtc(), id
      );
      // Alias diff (exact-string): removals + additions fire the fts triggers.
      const existing = db.prepare("SELECT id, alias FROM aliases WHERE person_id=?").all(id) as Row[];
      const want = new Set(f.aliases);
      const del = db.prepare("DELETE FROM aliases WHERE id=?");
      for (const r of existing) if (!want.has(String(r.alias))) del.run(r.id as number);
      const have = new Set(existing.map((r) => String(r.alias)));
      const ins = db.prepare("INSERT INTO aliases (person_id, alias) VALUES (?,?)");
      for (const a of f.aliases) if (!have.has(a)) ins.run(id, a);
      return true;
    });
  });
}

// The one hard delete (explicit UI action). Cascades take aliases, facts,
// interaction links and relationship edges; interactions left with no people
// are meaningless, so they go too. The photo file stays in the archive.
export function deletePerson(id: number): boolean {
  return withDbRW((db) =>
    tx(db, () => {
      const r = db.prepare("DELETE FROM people WHERE id=?").run(id);
      db.exec(
        `DELETE FROM interactions WHERE id IN (
           SELECT i.id FROM interactions i
           LEFT JOIN interaction_people ip ON ip.interaction_id = i.id
           WHERE ip.interaction_id IS NULL)`
      );
      return r.changes > 0;
    })
  );
}

/* ---- facts ---- */

export function validateFact(body: unknown): Validated<FactFields> {
  const errors: string[] = [];
  const o = (body ?? {}) as Record<string, unknown>;

  const category = typeof o.category === "string" ? o.category : "";
  if (!(CATEGORIES as readonly string[]).includes(category)) {
    errors.push("category must be one of: " + CATEGORIES.join("|"));
  }
  const value = typeof o.value === "string" ? o.value.trim().slice(0, 500) : "";
  if (!value) errors.push("value is required");

  const { tag, error } = normTag(o.tag);
  if (error) errors.push(error);

  const learned_at =
    o.learned_at == null || o.learned_at === ""
      ? new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10) // today JST
      : typeof o.learned_at === "string" && isRealDate(o.learned_at)
        ? o.learned_at
        : "";
  if (!learned_at) errors.push("learned_at must be a real YYYY-MM-DD date");

  if (errors.length) return { errors };
  return { fields: { category: category as Category, value, tag, learned_at } };
}

export function createFact(
  personId: number,
  f: FactFields,
  supersedes: number | null
): { id?: number; error?: string; status?: number } {
  return withDbRW((db) => {
    if (!personExists(db, personId)) return { error: "person not found", status: 404 };
    let old: Row | undefined;
    if (supersedes != null) {
      old = db.prepare("SELECT person_id, active FROM facts WHERE id=?").get(supersedes) as Row | undefined;
      if (!old) return { error: `no fact with id ${supersedes}`, status: 400 };
      if (old.person_id !== personId) return { error: "superseded fact belongs to a different person", status: 400 };
      if (old.active !== 1) return { error: "that fact is already inactive", status: 400 };
    }
    return tx(db, () => {
      const r = db.prepare(
        `INSERT INTO facts (person_id, category, value, tag, learned_at, source, raw_message)
         VALUES (?,?,?,?,?,'web',NULL)`
      ).run(personId, f.category, f.value, f.tag, f.learned_at);
      const id = Number(r.lastInsertRowid);
      if (supersedes != null) {
        db.prepare("UPDATE facts SET active=0, superseded_by=? WHERE id=?").run(id, supersedes);
      }
      touch(db, [personId]);
      return { id };
    });
  });
}

export function updateFact(id: number, f: FactFields): boolean {
  return withDbRW((db) => {
    const row = db.prepare("SELECT person_id FROM facts WHERE id=?").get(id) as Row | undefined;
    if (!row) return false;
    return tx(db, () => {
      db.prepare("UPDATE facts SET category=?, value=?, tag=?, learned_at=? WHERE id=?")
        .run(f.category, f.value, f.tag, f.learned_at, id);
      touch(db, [row.person_id as number]);
      return true;
    });
  });
}

// DELETE /api/facts/[id] means deactivate: facts are archived, never removed.
export function deactivateFact(id: number): { ok: boolean; error?: string } {
  return withDbRW((db) => {
    const row = db.prepare("SELECT person_id, active FROM facts WHERE id=?").get(id) as Row | undefined;
    if (!row) return { ok: false, error: "fact not found" };
    if (row.active !== 1) return { ok: false, error: "fact is already inactive" };
    return tx(db, () => {
      db.prepare("UPDATE facts SET active=0 WHERE id=?").run(id);
      touch(db, [row.person_id as number]);
      return { ok: true };
    });
  });
}

/* ---- interactions ---- */

export function validateInteraction(body: unknown): Validated<InteractionFields> {
  const errors: string[] = [];
  const o = (body ?? {}) as Record<string, unknown>;
  const happened_on =
    typeof o.happened_on === "string" && isRealDate(o.happened_on) ? o.happened_on : "";
  if (!happened_on) errors.push("happened_on must be a real YYYY-MM-DD date");
  const summary = typeof o.summary === "string" ? o.summary.trim().slice(0, 1000) : "";
  if (!summary) errors.push("summary is required");
  if (errors.length) return { errors };
  return { fields: { happened_on, place: optStr(o.place, 200), summary } };
}

function interactionPeople(db: DatabaseSync, id: number): number[] {
  return (db.prepare("SELECT person_id FROM interaction_people WHERE interaction_id=?").all(id) as Row[])
    .map((r) => r.person_id as number);
}

export function updateInteraction(id: number, f: InteractionFields): boolean {
  return withDbRW((db) => {
    if (!db.prepare("SELECT 1 FROM interactions WHERE id=?").get(id)) return false;
    return tx(db, () => {
      db.prepare("UPDATE interactions SET happened_on=?, place=?, summary=? WHERE id=?")
        .run(f.happened_on, f.place, f.summary, id);
      touch(db, interactionPeople(db, id));
      return true;
    });
  });
}

export function deactivateInteraction(id: number): { ok: boolean; error?: string } {
  return withDbRW((db) => {
    const row = db.prepare("SELECT active FROM interactions WHERE id=?").get(id) as Row | undefined;
    if (!row) return { ok: false, error: "interaction not found" };
    if (row.active !== 1) return { ok: false, error: "interaction is already inactive" };
    return tx(db, () => {
      db.prepare("UPDATE interactions SET active=0 WHERE id=?").run(id);
      touch(db, interactionPeople(db, id));
      return { ok: true };
    });
  });
}

/* ---- relationships ---- */

export function validateRelationship(body: unknown): Validated<RelationshipFields> {
  const errors: string[] = [];
  const o = (body ?? {}) as Record<string, unknown>;
  const person_a = typeof o.person_a === "number" && Number.isInteger(o.person_a) ? o.person_a : NaN;
  const person_b = typeof o.person_b === "number" && Number.isInteger(o.person_b) ? o.person_b : NaN;
  if (!(person_a > 0 && person_b > 0)) errors.push("person_a and person_b are required");
  else if (person_a === person_b) errors.push("a person cannot relate to themselves");
  const rel_type = typeof o.rel_type === "string" ? o.rel_type : "";
  if (!(REL_TYPES as readonly string[]).includes(rel_type)) {
    errors.push("rel_type must be one of: " + REL_TYPES.join("|"));
  }
  if (errors.length) return { errors };
  return {
    fields: {
      person_a, person_b,
      rel_type: rel_type as RelType,
      label: optStr(o.label, 200),
    },
  };
}

export function createRelationship(
  f: RelationshipFields
): { id?: number; error?: string; status?: number } {
  return withDbRW((db) => {
    if (!personExists(db, f.person_a) || !personExists(db, f.person_b)) {
      return { error: "person not found", status: 404 };
    }
    // introduced_by is directed (A introduced_by B = "B introduced me to A");
    // every other type is symmetric, so either stored order is a duplicate.
    const dup =
      f.rel_type === "introduced_by"
        ? db.prepare(
            "SELECT id FROM relationships WHERE person_a=? AND person_b=? AND rel_type=?"
          ).get(f.person_a, f.person_b, f.rel_type)
        : db.prepare(
            `SELECT id FROM relationships WHERE rel_type=?
             AND ((person_a=? AND person_b=?) OR (person_a=? AND person_b=?))`
          ).get(f.rel_type, f.person_a, f.person_b, f.person_b, f.person_a);
    if (dup) return { error: "that relationship already exists", status: 409 };
    return tx(db, () => {
      const r = db.prepare(
        "INSERT INTO relationships (person_a, person_b, rel_type, label) VALUES (?,?,?,?)"
      ).run(f.person_a, f.person_b, f.rel_type, f.label);
      touch(db, [f.person_a, f.person_b]);
      return { id: Number(r.lastInsertRowid) };
    });
  });
}

export function deleteRelationship(id: number): boolean {
  return withDbRW((db) => {
    const row = db.prepare("SELECT person_a, person_b FROM relationships WHERE id=?").get(id) as Row | undefined;
    if (!row) return false;
    return tx(db, () => {
      db.prepare("DELETE FROM relationships WHERE id=?").run(id);
      touch(db, [row.person_a as number, row.person_b as number]);
      return true;
    });
  });
}

/* ---- tags ---- */

export function tagsList(): TagInfo[] {
  return withDb((db) => {
    const rows = db.prepare(
      `SELECT tag, count(*) AS facts, count(DISTINCT person_id) AS people
       FROM facts WHERE active=1 AND tag IS NOT NULL
       GROUP BY tag ORDER BY facts DESC, tag`
    ).all() as Row[];
    return rows.map((r) => ({
      tag: String(r.tag), facts: r.facts as number, people: r.people as number,
    }));
  });
}

// Fixes LLM tag drift ("climbing" vs "bouldering"). Renames across ALL fact
// rows — including superseded ones, so history stays consistent. Renaming
// onto an existing tag is a merge, which is exactly the point.
export function renameTag(from: unknown, to: unknown): { renamed?: number; error?: string } {
  const f = normTag(from);
  const t = normTag(to);
  if (!f.tag) return { error: "from tag is required" };
  if (f.error) return { error: f.error };
  if (!t.tag) return { error: t.error ?? "to tag is required" };
  if (f.tag === t.tag) return { error: "from and to are the same tag" };
  return withDbRW((db) => {
    const r = db.prepare("UPDATE facts SET tag=? WHERE tag=?").run(t.tag, f.tag);
    if (r.changes === 0) return { error: `no facts carry tag "${f.tag}"` };
    return { renamed: Number(r.changes) };
  });
}

/* ---- photo ---- */

const PHOTO_EXT = new Set([".jpg", ".jpeg", ".png", ".webp", ".heic"]);
export const MAX_PHOTO_BYTES = 10 * 1024 * 1024;

export function savePhoto(
  id: number,
  filename: string,
  bytes: Buffer
): { ok: boolean; error?: string; status?: number } {
  const ext = path.extname(filename).toLowerCase();
  if (!PHOTO_EXT.has(ext)) {
    return { ok: false, error: `unsupported type ${ext || "(none)"} — use jpg/png/webp/heic`, status: 400 };
  }
  if (bytes.length === 0 || bytes.length > MAX_PHOTO_BYTES) {
    return { ok: false, error: "file must be 1 byte – 10 MB", status: 400 };
  }
  return withDbRW((db) => {
    if (!personExists(db, id)) return { ok: false, error: "person not found", status: 404 };
    const base = path.basename(filename).replace(/[^\w.\-]+/g, "_").slice(-80);
    const ts = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15) + "Z";
    fs.mkdirSync(MEDIA_DIR, { recursive: true, mode: 0o700 });
    const dest = path.join(MEDIA_DIR, `${ts}_p${id}_${base}`);
    fs.writeFileSync(dest, bytes, { mode: 0o600 });
    db.prepare("UPDATE people SET photo_path=?, updated_at=? WHERE id=?").run(dest, nowUtc(), id);
    return { ok: true };
  });
}
