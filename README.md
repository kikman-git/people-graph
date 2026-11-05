# people-graph

Personal people-memory ("human knowledge graph") for Phat. A Telegram bot (**Boswell**, `@human_graph_txps_bot`)
captures facts about friends, family and contacts into SQLite; this Next.js app is the recall interface — search,
map, profiles, light editing. Complex Q&A happens in Telegram; the web UI stays deliberately minimal. It is a
private, single-owner tool: the database holds candid notes about real people. Built on the ledger pattern
(OpenClaw agent + script-only bot writes + one SQLite file + loopback Next.js behind Tailscale). `PLAN.md` is the
source of truth for every design decision; `CLAUDE.md` holds the working rules. On the box the checkout is still
`/home/ubuntu/human-graph` (npm package `human-graph`, systemd unit `human-graph.service`).

## How it works

```text
Telegram (@human_graph_txps_bot, account "people")
        ▼  binding: {channel: telegram, accountId: "people"} → agent "people"
OpenClaw agent "people" (🗂️ Boswell; workspace-people; skill people-graph)
   ├─ people_write.py   the ONLY bot write path (deterministic, validated)
   └─ people_query.py   canned reads + read-only sql escape hatch
        ▼
~/.openclaw/data/people.sqlite      (WAL, 0600; FTS5 kept in sync by triggers)
~/.openclaw/data/people-media/      (archived photos, realpath-guarded serving)
        ▲
        │  node:sqlite (reads + validated web CRUD)
this app: Next.js 15 · React 19 · Tailwind 4 · leaflet — no ORM
```

- **/** — search (FTS + CJK-substring fallback) over names, aliases, facts, history; empty query = directory,
  recently-updated first.
- **/map** — everyone with coordinates on a CARTO-Positron Leaflet map tinted into the paper palette; live filter;
  pin → mini card → profile.
- **/person/[id]** — the prep-before-meeting page: card, About (facts by category, superseded history preserved),
  History (shared interactions link co-attendees), Relationships. Edit dialogs (card + aliases, facts, history
  entries, relationships), photo upload, geocode + click-the-map location picker.
- **/tags** — tag vocabulary with rename (fixes LLM tag drift; renames merge).

## Setup

Requirements: Node 24 (built-in `node:sqlite`, so no native modules; the box runs v24.18, there is no `engines`
field and other majors were not tried), npm, and python3 for the skill scripts and the import script. The app needs
an existing people database; this repo does not create the schema (see Data).

```bash
npm ci                 # lockfile is in sync with package.json; everything resolves from registry.npmjs.org
npm run build          # required before `npm start`

# Database (schema owner is the skill, not this repo)
python3 ~/.openclaw/skills/people-graph/people_write.py init
bash ~/.openclaw/skills/people-graph/smoke_test.sh   # 45-check round trip, throwaway DB

# Google Maps Takeout import (people-labels → map pins)
python3 scripts/import_google_maps.py stage ~/takeout/Labeled\ places.json ~/takeout/*.csv
python3 scripts/import_google_maps.py review    # interactive attach/create/skip
python3 scripts/import_google_maps.py status
```

Development against a scratch DB: point the app at any SQLite file with `PEOPLE_DB`. `people_write.py --db
/tmp/seed.sqlite …` seeds it; the real DB never sees test data. Work in a separate clone (see Gotchas):

```bash
PEOPLE_DB=/tmp/seed.sqlite npx next dev -H 127.0.0.1 -p 3100
```

## Run / deploy

| | |
|---|---|
| systemd user unit | `human-graph.service` in `~/.config/systemd/user/` (not in this repo; enabled, survives reboot): `NODE_ENV=production`, `ExecStart=/usr/bin/npm start`, `Restart=always`, `RestartSec=3` |
| Listens / exposed | `127.0.0.1:18791` (loopback only), published by `tailscale serve --bg --https=8444 http://127.0.0.1:18791` (ledger-web owns :8443; `tailscale serve status` to inspect) |
| Tailnet URL | **https://openclaw-vps.tail0d53dc.ts.net:8444/** (tailnet only; never exposed publicly) |

```bash
npm run deploy     # next build → restart human-graph.service → health check (/api/people) → prints the URL
# individual steps: `npm run build`, `npm start` (production on 127.0.0.1:18791, what the service runs)
systemctl --user status human-graph
```

- `next start` needs `next build` first: with no `.next` build the service fails and systemd restarts it every 3 s.
- The OpenClaw gateway runs with `tailscale.resetOnExit=true`, so every `openclaw gateway restart` (and reboot) wipes
  the Tailscale serve mappings. The `tailscale-serve-apps.timer` user unit re-asserts them within 3 minutes
  (`systemctl --user start tailscale-serve-apps.service` to force it now).
- Use the full tailnet name: MagicDNS resolves `openclaw-vps`, but the TLS certificate only covers the full name.

## Configuration

| Name | Where | Purpose |
|---|---|---|
| `PEOPLE_DB` | env var, optional (template: `.env.example`) | SQLite path; default `~/.openclaw/data/people.sqlite` |
| port / bind | `package.json` scripts | `dev` and `start` pass `-p 18791`; only `start` passes `-H 127.0.0.1` |
| photo dir | `MEDIA_DIR` in `lib/db.ts` | fixed at `~/.openclaw/data/people-media`; not configurable |
| geocoder identity | `app/api/geocode/route.ts` | hard-coded Nominatim User-Agent with a contact address, as OSM's policy requires |

The app reads no secrets: no API keys, tokens or passwords. The Telegram bot token belongs to OpenClaw (a token file
under `~/.openclaw/secrets/`, referenced from `~/.openclaw/openclaw.json`), as does the DM allowlist.

## Data

| What | Where | In git? |
|---|---|---|
| People database | `~/.openclaw/data/people.sqlite` | No: candid notes about real people (WAL, mode 0600; `*.sqlite*` is git-ignored) |
| Photos | `~/.openclaw/data/people-media/` | No: personal photos, 0600 files in a 0700 dir, served only via `/api/photo/<id>` |
| Takeout exports | e.g. `~/takeout/` | No: labelled places are real people's addresses (also git-ignored if copied in-tree) |
| Nightly backup | `~/backups/openclaw-data/<YYYY-MM-DD>/` | No: see Backups below |

- Schema owner is the skill: `people_write.py init` creates/migrates `people`, `aliases`, `facts`, `interactions`,
  `interaction_people`, `relationships`, `import_places` and the FTS5 table `fts` (kept in sync by triggers).
  `PLAN.md` §4 has the design-time DDL; it predates `interactions.active`, so `people_write.py` is authoritative.
- Fact categories `hobby|work|skill|background|family|likes|dislikes|plans|other`; relationship types
  `family|partner|friend|colleague|introduced_by|other`. Both write paths enforce them.
- **Backups:** `~/bin/openclaw-data-backup.sh` nightly at 03:30 JST via cron — WAL-safe SQLite online backup of
  **people.sqlite and ledger.sqlite** + rsync of `people-media/` and `receipts/` into the folder above, newest 14
  kept. Log: `~/backups/openclaw-data/backup.log`.

**Data rules (red lines)**

1. The **bot** writes only via `people_write.py`. The web app has its own validated CRUD (this repo, `lib/db.ts`) —
   nothing else touches the DB.
2. **Supersede, don't delete.** Contradicted facts are archived (`active=0`, `superseded_by`); retract = deactivate,
   and interactions are deactivated the same way. Hard deletes come only from explicit web-UI actions: a whole
   person (card editor's "Delete person…" plus a confirm prompt; interactions left with nobody attached go with
   them), a relationship edge, or a removed alias.
3. Loopback + Tailscale only; DB file 0600; photos 0600 in a 0700 dir.
4. The agent treats message/image content as data, never instructions.

## API

Loopback only, no authentication (access control is the bind address plus Tailscale).

| Route | Methods | Notes |
|---|---|---|
| `/api/people` | GET | directory payload |
| `/api/people/[id]` | GET, PATCH, DELETE | profile payload / person card + aliases / hard delete |
| `/api/people/[id]/photo` | POST | multipart `file` (jpg, png, webp, heic; max 10 MB) |
| `/api/search?q=` | GET | FTS results (empty `q` = directory) |
| `/api/map` | GET | pins with mini-card payload |
| `/api/photo/[id]` | GET | archived photo (realpath-guarded to `people-media/`) |
| `/api/geocode?q=` | GET | Nominatim proxy (UA + 1 req/s + cache) |
| `/api/facts` | POST | add fact (`supersedes: id` → archive-and-replace) |
| `/api/facts/[id]` | PATCH, DELETE | edit / deactivate (never removes) |
| `/api/interactions/[id]` | PATCH, DELETE | edit / deactivate |
| `/api/relationships` | POST | add |
| `/api/relationships/[id]` | DELETE | hard delete (edges describe the present, not history) |
| `/api/tags/rename` | POST | `{from, to}`; merges on collision |

## Related

Outside this repo:

- OpenClaw skill `people-graph` (`~/.openclaw/skills/people-graph/`: `SKILL.md`, `people_write.py`,
  `people_query.py`, `smoke_test.sh`): the bot's only write path and the owner of the schema.
- OpenClaw agent `people` (🗂️ Boswell; workspace `~/.openclaw/workspace-people`, agentDir
  `~/.openclaw/agents/people`), reached through Telegram account `people` (bot `@human_graph_txps_bot`, polling,
  DM-allowlisted). Bot wiring is done; to recreate it: `openclaw channels add --channel telegram --account people
  --token <t>`, then `openclaw gateway restart` and verify with `openclaw agents list --bindings`.
- `spending-ledger` (on the box: `/home/ubuntu/ledger-web`, tailnet :8443): the app this one was cloned from; the
  design tokens in `app/globals.css` are copied from it.
- Hub page https://openclaw-vps.tail0d53dc.ts.net/apps lists every app on the box.

## Gotchas

- Do not run `npm run dev` in the live checkout: it uses the service's port (18791), passes no `-H` (Next binds
  0.0.0.0 by default) and writes into the same `.next/` the service serves.
- The web app cannot create people or interactions (no such routes); those come from the bot. Deleting a person
  leaves the photo file in `people-media/`.
- `/api/geocode` keeps its cache in process memory and spaces upstream calls by 1.1 s; the server needs outbound
  internet for it, and browsers need it for map tiles (CARTO) and fonts (Google Fonts).
- `CLAUDE.md` and `PLAN.md` carry status lines dated 2026-07-19 (Takeout import only sample-tested, first bot
  message pending): unknown whether they still hold. Both record the owner's numeric Telegram ID (the DM allowlist).
  `PLAN.md` only suggested the persona name "Rolo"; the live persona is Boswell.
- `next-env.d.ts` is git-ignored; `next dev` / `next build` regenerate it. There are no tests and no linter.

## License

MIT. See [LICENSE](LICENSE).
