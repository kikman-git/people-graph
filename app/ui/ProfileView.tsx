"use client";
// Interactive profile — the prep-before-meeting screen, now with ledger-style
// inline edit dialogs. Every mutation hits a validated API route and then
// router.refresh() re-renders the server data; there is no client cache to
// drift. Facts/interactions are never hard-deleted here: "retract"/"remove"
// deactivate, "replace" supersedes. The only hard delete is the whole person.
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Category, Fact, HistoryEntry, Profile } from "@/lib/types";
import { CATEGORIES, CATEGORY_LABELS, REL_TYPES } from "@/lib/types";
import Avatar from "./Avatar";
import MapPicker from "./MapPicker";
import Modal from "./Modal";
import { fmtBirthday, fmtDate, prettyTag, relSummary, todayJst } from "./format";

type PersonRef = { id: number; display_name: string };
type Flash = { text: string; ok: boolean };
type Dialog =
  | { kind: "person" }
  | { kind: "fact"; mode: "add"; category?: Category }
  | { kind: "fact"; mode: "edit"; fact: Fact }
  | { kind: "fact"; mode: "replace"; fact: Fact }
  | { kind: "interaction"; entry: HistoryEntry }
  | { kind: "relationship" }
  | null;

const CARD =
  "bg-white border border-line rounded-2xl shadow-[0_1px_2px_rgba(60,50,30,.04)]";
const H2 = "font-serif font-medium text-[17px] leading-[1.2] text-ink";
const INPUT =
  "w-full rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink outline-none placeholder:text-fainter focus:border-fainter";
const LABEL = "mb-1 mt-3 block text-xs font-semibold text-faint first:mt-0";
const BTN =
  "rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50";
const BTN_GHOST =
  "rounded-lg border border-line bg-white px-3.5 py-2 text-sm text-muted hover:text-ink";
const ACTION = "text-xs text-faint hover:text-accent-deep";

function MetaRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-2 text-[13px]">
      <span className="w-24 shrink-0 text-faint">{label}</span>
      <span className="min-w-0 text-ink-soft">{children}</span>
    </div>
  );
}

function TagChip({ tag }: { tag: string }) {
  return (
    <span className="rounded-full bg-accent-soft px-2 py-0.5 text-xs text-accent-deeper">
      {prettyTag(tag)}
    </span>
  );
}

function PersonChip({ id, name, sub }: { id: number; name: string; sub?: string }) {
  return (
    <Link
      href={`/person/${id}`}
      className="inline-flex items-baseline gap-1.5 rounded-full border border-line bg-indigo-soft px-3 py-1 text-[13px] text-ink hover:border-fainter hover:text-ink"
    >
      <span className="font-medium">{name}</span>
      {sub && <span className="text-xs text-muted">{sub}</span>}
    </Link>
  );
}

export default function ProfileView({
  data, people, tags,
}: {
  data: Profile;
  people: PersonRef[];
  tags: string[];
}) {
  const router = useRouter();
  const { person, about, superseded, history, relationships } = data;
  const [flash, setFlash] = useState<Flash | null>(null);
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<Dialog>(null);

  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), flash.ok ? 1800 : 3600);
    return () => clearTimeout(t);
  }, [flash]);

  const api = useCallback(
    async (path: string, method: string, body?: unknown, form?: FormData): Promise<boolean> => {
      setBusy(true);
      try {
        const res = await fetch(path, {
          method,
          ...(form
            ? { body: form }
            : body !== undefined
              ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }
              : {}),
        });
        const j = await res.json();
        if (!res.ok) throw new Error(j.error || res.statusText);
        router.refresh();
        return true;
      } catch (e) {
        setFlash({ text: (e as Error).message, ok: false });
        return false;
      } finally {
        setBusy(false);
      }
    },
    [router]
  );

  const done = (text: string) => {
    setDialog(null);
    setFlash({ text, ok: true });
  };

  const retractFact = async (f: Fact) => {
    if (!window.confirm(`Retract "${f.value}"? It stays archived as inactive.`)) return;
    if (await api(`/api/facts/${f.id}`, "DELETE")) setFlash({ text: "Fact retracted", ok: true });
  };
  const removeInteraction = async (h: HistoryEntry) => {
    if (!window.confirm(`Remove the ${fmtDate(h.happened_on)} entry? It stays archived as inactive.`)) return;
    if (await api(`/api/interactions/${h.id}`, "DELETE")) setFlash({ text: "Entry removed", ok: true });
  };
  const removeRelationship = async (id: number, name: string) => {
    if (!window.confirm(`Remove the relationship with ${name}?`)) return;
    if (await api(`/api/relationships/${id}`, "DELETE")) setFlash({ text: "Relationship removed", ok: true });
  };
  const deletePerson = async () => {
    if (!window.confirm(`Delete ${person.display_name} and everything recorded about them? This cannot be undone.`)) return;
    if (await api(`/api/people/${person.id}`, "DELETE")) {
      router.push("/");
    }
  };
  const uploadPhoto = async (file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    if (await api(`/api/people/${person.id}/photo`, "POST", undefined, fd)) {
      setFlash({ text: "Photo updated", ok: true });
    }
  };

  const birthday = person.birthday ? fmtBirthday(person.birthday) : null;
  const categories = CATEGORIES.filter((c) => about[c]?.length);
  const factCount = categories.reduce((n, c) => n + (about[c]?.length ?? 0), 0);

  return (
    <>
      <Link href="/" className="text-[13px]">
        ← All people
      </Link>

      {/* Card: who they are */}
      <section className={`${CARD} mt-3 p-5`}>
        <div className="flex items-start gap-4">
          <div className="flex flex-col items-center gap-1.5">
            <Avatar id={person.id} name={person.display_name} hasPhoto={person.hasPhoto} size={72} />
            <label className={`${ACTION} cursor-pointer`}>
              {person.hasPhoto ? "change photo" : "add photo"}
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp,image/heic"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) uploadPhoto(f);
                  e.target.value = "";
                }}
              />
            </label>
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-3">
              <h1 className="font-serif text-[28px] font-medium leading-tight">
                {person.display_name}
              </h1>
              <button className={BTN_GHOST} onClick={() => setDialog({ kind: "person" })}>
                Edit
              </button>
            </div>
            {person.aliases.length > 0 && (
              <div className="mt-0.5 text-sm text-muted">{person.aliases.join(" · ")}</div>
            )}
            <div className="mt-3 flex flex-col gap-1.5">
              {person.location && <MetaRow label="Location">{person.location}</MetaRow>}
              {birthday && (
                <MetaRow label="Birthday">
                  {birthday.label}
                  {birthday.age != null && <span className="text-faint"> ({birthday.age})</span>}
                </MetaRow>
              )}
              {person.how_we_met && <MetaRow label="How we met">{person.how_we_met}</MetaRow>}
              {person.phone && <MetaRow label="Phone">{person.phone}</MetaRow>}
              {person.email && <MetaRow label="Email">{person.email}</MetaRow>}
              {person.handles &&
                Object.entries(person.handles).map(([k, v]) => (
                  <MetaRow key={k} label={k}>{v}</MetaRow>
                ))}
            </div>
          </div>
        </div>
      </section>

      {/* About */}
      <section className="mt-6">
        <div className="flex items-baseline justify-between px-1">
          <h2 className={H2}>About</h2>
          <div className="flex items-baseline gap-3">
            {factCount > 0 && <span className="text-xs text-faint">{factCount} facts</span>}
            <button className={ACTION} onClick={() => setDialog({ kind: "fact", mode: "add" })}>
              + add fact
            </button>
          </div>
        </div>
        {categories.length === 0 ? (
          <div className={`${CARD} mt-2 px-5 py-6 text-sm text-muted`}>Nothing captured yet.</div>
        ) : (
          <div className={`${CARD} mt-2 divide-y divide-line-soft`}>
            {categories.map((cat) => (
              <div key={cat} className="px-5 py-3.5">
                <div className="text-xs font-semibold leading-none text-faint">
                  {CATEGORY_LABELS[cat]}
                </div>
                <ul className="mt-2 flex flex-col gap-1.5">
                  {about[cat]!.map((f) => (
                    <li key={f.id} className="flex items-baseline justify-between gap-3">
                      <span className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
                        <span className="text-[15px]">{f.value}</span>
                        {f.tag && <TagChip tag={f.tag} />}
                        <span className="text-xs text-fainter">{fmtDate(f.learned_at)}</span>
                      </span>
                      <span className="flex shrink-0 gap-2">
                        <button className={ACTION} onClick={() => setDialog({ kind: "fact", mode: "edit", fact: f })}>
                          edit
                        </button>
                        <button className={ACTION} onClick={() => setDialog({ kind: "fact", mode: "replace", fact: f })}>
                          replace
                        </button>
                        <button className={ACTION} onClick={() => retractFact(f)}>
                          retract
                        </button>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
        {superseded.length > 0 && (
          <details className="mt-2 px-1 text-sm">
            <summary className="cursor-pointer text-[13px] text-faint hover:text-muted">
              History of changes ({superseded.length})
            </summary>
            <ul className="mt-2 flex flex-col gap-1.5 px-1">
              {superseded.map((f) => (
                <li key={f.id} className="text-[13px] text-muted">
                  <span className="text-fainter">{CATEGORY_LABELS[f.category]}:</span>{" "}
                  <span className="line-through decoration-fainter">{f.value}</span>
                  {f.replacedByValue ? (
                    <span> → {f.replacedByValue}</span>
                  ) : (
                    <span className="text-fainter"> (retracted)</span>
                  )}
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>

      {/* History */}
      <section className="mt-6">
        <div className="flex items-baseline justify-between px-1">
          <h2 className={H2}>History</h2>
          {history.length > 0 && (
            <span className="text-xs text-faint">
              {history.length} {history.length === 1 ? "entry" : "entries"}
            </span>
          )}
        </div>
        {history.length === 0 ? (
          <div className={`${CARD} mt-2 px-5 py-6 text-sm text-muted`}>
            No meetups recorded yet — they arrive via the Telegram bot.
          </div>
        ) : (
          <div className={`${CARD} mt-2 divide-y divide-line-soft`}>
            {history.map((h) => (
              <div key={h.id} className="px-5 py-3.5">
                <div className="flex items-baseline justify-between gap-3">
                  <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
                    <span className="font-serif text-[15px] font-medium">
                      {fmtDate(h.happened_on)}
                    </span>
                    {h.place && <span className="text-[13px] text-muted">{h.place}</span>}
                  </div>
                  <span className="flex shrink-0 gap-2">
                    <button className={ACTION} onClick={() => setDialog({ kind: "interaction", entry: h })}>
                      edit
                    </button>
                    <button className={ACTION} onClick={() => removeInteraction(h)}>
                      remove
                    </button>
                  </span>
                </div>
                <p className="mt-1 text-[15px] leading-relaxed">{h.summary}</p>
                {h.with.length > 0 && (
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <span className="text-xs text-faint">with</span>
                    {h.with.map((w) => (
                      <PersonChip key={w.id} id={w.id} name={w.display_name} />
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Relationships */}
      <section className="mt-6">
        <div className="flex items-baseline justify-between px-1">
          <h2 className={H2}>Relationships</h2>
          <button className={ACTION} onClick={() => setDialog({ kind: "relationship" })}>
            + add
          </button>
        </div>
        {relationships.length === 0 ? (
          <div className={`${CARD} mt-2 px-5 py-6 text-sm text-muted`}>No links yet.</div>
        ) : (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {relationships.map((r) => (
              <span key={r.id} className="inline-flex items-center gap-1">
                <PersonChip id={r.other.id} name={r.other.display_name} sub={relSummary(r)} />
                <button
                  className="px-0.5 text-faint hover:text-bad"
                  title="Remove relationship"
                  onClick={() => removeRelationship(r.id, r.other.display_name)}
                >
                  ✕
                </button>
              </span>
            ))}
          </div>
        )}
      </section>

      {/* dialogs */}
      {dialog?.kind === "person" && (
        <PersonDialog
          data={data}
          busy={busy}
          onClose={() => setDialog(null)}
          onDelete={deletePerson}
          onSubmit={async (fields) => {
            if (await api(`/api/people/${person.id}`, "PATCH", fields)) done("Saved");
          }}
        />
      )}
      {dialog?.kind === "fact" && (
        <FactDialog
          mode={dialog.mode}
          fact={dialog.mode === "add" ? undefined : dialog.fact}
          category={dialog.mode === "add" ? dialog.category : undefined}
          tags={tags}
          busy={busy}
          onClose={() => setDialog(null)}
          onSubmit={async (fields, old) => {
            if (dialog.mode === "edit") {
              if (await api(`/api/facts/${old!.id}`, "PATCH", fields)) done("Fact updated");
            } else {
              const body = {
                ...fields,
                person_id: person.id,
                ...(dialog.mode === "replace" ? { supersedes: old!.id } : {}),
              };
              if (await api("/api/facts", "POST", body)) {
                done(dialog.mode === "replace" ? "Fact replaced" : "Fact added");
              }
            }
          }}
        />
      )}
      {dialog?.kind === "interaction" && (
        <InteractionDialog
          entry={dialog.entry}
          busy={busy}
          onClose={() => setDialog(null)}
          onSubmit={async (fields) => {
            if (await api(`/api/interactions/${dialog.entry.id}`, "PATCH", fields)) {
              done("Entry updated");
            }
          }}
        />
      )}
      {dialog?.kind === "relationship" && (
        <RelationshipDialog
          person={{ id: person.id, display_name: person.display_name }}
          people={people.filter((p) => p.id !== person.id)}
          busy={busy}
          onClose={() => setDialog(null)}
          onSubmit={async (body) => {
            if (await api("/api/relationships", "POST", body)) done("Relationship added");
          }}
        />
      )}

      {flash && (
        <div
          className={`fixed bottom-6 left-1/2 z-[60] -translate-x-1/2 rounded-full px-4 py-2 text-sm shadow-lg ${
            flash.ok ? "bg-ink text-cream" : "bg-bad text-white"
          }`}
          style={{ animation: "hbUp .18s ease-out" }}
        >
          {flash.text}
        </div>
      )}
    </>
  );
}

/* ------------------------------------------------------------- dialogs --- */

function PersonDialog({
  data, busy, onClose, onSubmit, onDelete,
}: {
  data: Profile;
  busy: boolean;
  onClose: () => void;
  onSubmit: (fields: Record<string, unknown>) => void;
  onDelete: () => void;
}) {
  const p = data.person;
  const [name, setName] = useState(p.display_name);
  const [aliases, setAliases] = useState(p.aliases.join("\n"));
  const [birthday, setBirthday] = useState(p.birthday ?? "");
  const [location, setLocation] = useState(p.location ?? "");
  const [lat, setLat] = useState<number | null>(p.lat);
  const [lng, setLng] = useState<number | null>(p.lng);
  const [geoNote, setGeoNote] = useState<string | null>(null);
  const [geoBusy, setGeoBusy] = useState(false);
  const [howWeMet, setHowWeMet] = useState(p.how_we_met ?? "");
  const [phone, setPhone] = useState(p.phone ?? "");
  const [email, setEmail] = useState(p.email ?? "");
  const [handles, setHandles] = useState(p.handles ? JSON.stringify(p.handles) : "");

  const geocode = async () => {
    if (!location.trim()) return;
    setGeoBusy(true);
    setGeoNote(null);
    try {
      const res = await fetch(`/api/geocode?q=${encodeURIComponent(location.trim())}`);
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || res.statusText);
      if (j.found) {
        setLat(j.lat);
        setLng(j.lng);
        setGeoNote(`→ ${j.display_name}`);
      } else {
        setGeoNote("No match — click the map to place the pin instead.");
      }
    } catch (e) {
      setGeoNote((e as Error).message);
    } finally {
      setGeoBusy(false);
    }
  };

  return (
    <Modal title={`Edit ${p.display_name}`} onClose={onClose}>
      <label className={LABEL}>Name</label>
      <input className={INPUT} value={name} onChange={(e) => setName(e.target.value)} />
      <label className={LABEL}>Aliases (one per line — 健二, Kenji-san, …)</label>
      <textarea
        className={INPUT} rows={2} value={aliases}
        onChange={(e) => setAliases(e.target.value)}
      />
      <label className={LABEL}>Birthday</label>
      <input
        className={INPUT} value={birthday} placeholder="YYYY-MM-DD, or MM-DD if the year is unknown"
        onChange={(e) => setBirthday(e.target.value)}
      />
      <label className={LABEL}>Location</label>
      <div className="flex gap-2">
        <input
          className={INPUT} value={location} placeholder="Shimokitazawa, Tokyo"
          onChange={(e) => setLocation(e.target.value)}
        />
        <button className={`${BTN_GHOST} shrink-0`} onClick={geocode} disabled={geoBusy || !location.trim()}>
          {geoBusy ? "…" : "Geocode"}
        </button>
      </div>
      {geoNote && <div className="mt-1 text-xs text-muted">{geoNote}</div>}
      <div className="mt-2">
        <MapPicker lat={lat} lng={lng} onPick={(a, b) => { setLat(a); setLng(b); setGeoNote(null); }} />
        <div className="mt-1 flex items-center justify-between text-xs text-faint">
          <span>{lat != null ? `${lat}, ${lng}` : "no pin — click the map to set one"}</span>
          {lat != null && (
            <button className={ACTION} onClick={() => { setLat(null); setLng(null); }}>
              remove pin
            </button>
          )}
        </div>
      </div>
      <label className={LABEL}>How we met</label>
      <input className={INPUT} value={howWeMet} onChange={(e) => setHowWeMet(e.target.value)} />
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className={LABEL}>Phone</label>
          <input className={INPUT} value={phone} onChange={(e) => setPhone(e.target.value)} />
        </div>
        <div>
          <label className={LABEL}>Email</label>
          <input className={INPUT} value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
      </div>
      <label className={LABEL}>Handles (JSON)</label>
      <input
        className={INPUT} value={handles} placeholder='{"line": "kenji_t", "telegram": "@kenji"}'
        onChange={(e) => setHandles(e.target.value)}
      />
      <div className="mt-4 flex items-center justify-between">
        <button className="text-sm text-bad hover:text-accent-deeper" onClick={onDelete} disabled={busy}>
          Delete person…
        </button>
        <div className="flex gap-2">
          <button className={BTN_GHOST} onClick={onClose}>Cancel</button>
          <button
            className={BTN}
            disabled={busy || !name.trim()}
            onClick={() =>
              onSubmit({
                display_name: name,
                aliases: aliases.split("\n").map((s) => s.trim()).filter(Boolean),
                birthday: birthday.trim() || null,
                location: location.trim() || null,
                lat, lng,
                how_we_met: howWeMet.trim() || null,
                phone: phone.trim() || null,
                email: email.trim() || null,
                handles: handles.trim() || null,
              })
            }
          >
            Save
          </button>
        </div>
      </div>
    </Modal>
  );
}

function FactDialog({
  mode, fact, category, tags, busy, onClose, onSubmit,
}: {
  mode: "add" | "edit" | "replace";
  fact?: Fact;
  category?: Category;
  tags: string[];
  busy: boolean;
  onClose: () => void;
  onSubmit: (fields: Record<string, unknown>, old?: Fact) => void;
}) {
  const [cat, setCat] = useState<Category>(fact?.category ?? category ?? "hobby");
  const [value, setValue] = useState(mode === "edit" ? fact!.value : "");
  const [tag, setTag] = useState(fact?.tag ?? "");
  const [learnedAt, setLearnedAt] = useState(mode === "edit" ? fact!.learned_at : todayJst());
  const title =
    mode === "add" ? "Add fact" : mode === "edit" ? "Edit fact" : "Replace fact";

  return (
    <Modal title={title} onClose={onClose}>
      {mode === "replace" && (
        <div className="mb-1 rounded-lg bg-wash px-3 py-2 text-[13px] text-muted">
          Replaces: <span className="line-through decoration-fainter">{fact!.value}</span>
          <span className="text-fainter"> (kept in the archive)</span>
        </div>
      )}
      <label className={LABEL}>Category</label>
      <select className={INPUT} value={cat} onChange={(e) => setCat(e.target.value as Category)}>
        {CATEGORIES.map((c) => (
          <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>
        ))}
      </select>
      <label className={LABEL}>Fact</label>
      <textarea
        className={INPUT} rows={2} value={value} autoFocus
        placeholder="loves bouldering, V5 projects"
        onChange={(e) => setValue(e.target.value)}
      />
      <label className={LABEL}>Tag (english snake_case; reuse an existing one when it fits)</label>
      <input
        className={INPUT} value={tag} list="known-tags" placeholder="bouldering"
        onChange={(e) => setTag(e.target.value)}
      />
      <datalist id="known-tags">
        {tags.map((t) => (
          <option key={t} value={t} />
        ))}
      </datalist>
      <label className={LABEL}>Learned on</label>
      <input
        type="date" className={INPUT} value={learnedAt}
        onChange={(e) => setLearnedAt(e.target.value)}
      />
      <div className="mt-4 flex justify-end gap-2">
        <button className={BTN_GHOST} onClick={onClose}>Cancel</button>
        <button
          className={BTN}
          disabled={busy || !value.trim()}
          onClick={() =>
            onSubmit(
              { category: cat, value, tag: tag.trim() || null, learned_at: learnedAt },
              fact
            )
          }
        >
          {title}
        </button>
      </div>
    </Modal>
  );
}

function InteractionDialog({
  entry, busy, onClose, onSubmit,
}: {
  entry: HistoryEntry;
  busy: boolean;
  onClose: () => void;
  onSubmit: (fields: Record<string, unknown>) => void;
}) {
  const [happenedOn, setHappenedOn] = useState(entry.happened_on);
  const [place, setPlace] = useState(entry.place ?? "");
  const [summary, setSummary] = useState(entry.summary);
  return (
    <Modal title="Edit history entry" onClose={onClose}>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className={LABEL}>Date</label>
          <input
            type="date" className={INPUT} value={happenedOn}
            onChange={(e) => setHappenedOn(e.target.value)}
          />
        </div>
        <div>
          <label className={LABEL}>Place</label>
          <input className={INPUT} value={place} onChange={(e) => setPlace(e.target.value)} />
        </div>
      </div>
      <label className={LABEL}>What happened</label>
      <textarea
        className={INPUT} rows={3} value={summary}
        onChange={(e) => setSummary(e.target.value)}
      />
      {entry.with.length > 0 && (
        <div className="mt-2 text-xs text-faint">
          Shared with {entry.with.map((w) => w.display_name).join(", ")} — edits apply to
          everyone's timeline.
        </div>
      )}
      <div className="mt-4 flex justify-end gap-2">
        <button className={BTN_GHOST} onClick={onClose}>Cancel</button>
        <button
          className={BTN}
          disabled={busy || !summary.trim() || !happenedOn}
          onClick={() =>
            onSubmit({ happened_on: happenedOn, place: place.trim() || null, summary })
          }
        >
          Save
        </button>
      </div>
    </Modal>
  );
}

function RelationshipDialog({
  person, people, busy, onClose, onSubmit,
}: {
  person: PersonRef;
  people: PersonRef[];
  busy: boolean;
  onClose: () => void;
  onSubmit: (body: Record<string, unknown>) => void;
}) {
  const [otherId, setOtherId] = useState<number>(people[0]?.id ?? 0);
  const [relType, setRelType] = useState<string>("friend");
  const [introducer, setIntroducer] = useState<"other" | "person">("other");
  const [label, setLabel] = useState("");
  const other = people.find((p) => p.id === otherId);

  // introduced_by is directed: A introduced_by B = "B introduced me to A".
  const body = (): Record<string, unknown> => {
    if (relType === "introduced_by") {
      return introducer === "other"
        ? { person_a: person.id, person_b: otherId, rel_type: relType, label: label.trim() || null }
        : { person_a: otherId, person_b: person.id, rel_type: relType, label: label.trim() || null };
    }
    return { person_a: person.id, person_b: otherId, rel_type: relType, label: label.trim() || null };
  };

  return (
    <Modal title="Add relationship" onClose={onClose}>
      {people.length === 0 ? (
        <p className="text-sm text-muted">No other people in the graph yet.</p>
      ) : (
        <>
          <label className={LABEL}>Person</label>
          <select
            className={INPUT} value={otherId}
            onChange={(e) => setOtherId(Number(e.target.value))}
          >
            {people.map((p) => (
              <option key={p.id} value={p.id}>{p.display_name}</option>
            ))}
          </select>
          <label className={LABEL}>Type</label>
          <select className={INPUT} value={relType} onChange={(e) => setRelType(e.target.value)}>
            {REL_TYPES.map((t) => (
              <option key={t} value={t}>{t.replaceAll("_", " ")}</option>
            ))}
          </select>
          {relType === "introduced_by" && other && (
            <div className="mt-2 flex flex-col gap-1 rounded-lg bg-wash px-3 py-2 text-[13px]">
              <label className="flex items-center gap-2">
                <input
                  type="radio" checked={introducer === "other"}
                  onChange={() => setIntroducer("other")}
                />
                {other.display_name} introduced me to {person.display_name}
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="radio" checked={introducer === "person"}
                  onChange={() => setIntroducer("person")}
                />
                {person.display_name} introduced me to {other.display_name}
              </label>
            </div>
          )}
          <label className={LABEL}>Label (optional)</label>
          <input
            className={INPUT} value={label} placeholder='"younger sister", "his manager at Sony"'
            onChange={(e) => setLabel(e.target.value)}
          />
          <div className="mt-4 flex justify-end gap-2">
            <button className={BTN_GHOST} onClick={onClose}>Cancel</button>
            <button className={BTN} disabled={busy || !otherId} onClick={() => onSubmit(body())}>
              Add
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
