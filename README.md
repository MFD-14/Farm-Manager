# Woodlands Farm Manager

Operations system for Woodlands Farm (119.2 ha, Kwekwe, Midlands Province,
Zimbabwe): one caretaker on an entry-level Android phone, one remote owner, and
a server that turns an append-only evidence log into a running farm.

Built from **[WFM-OPS-SPEC v1.0](docs/woodlands-farm-ops-spec-v1.0.md)**. The
core design decision, quoted from the spec:

> The caretaker's phone never edits shared state. It only appends signed,
> timestamped evidence events to a local outbox that drains whenever any
> connectivity exists. Everything else — the task state machine, verification,
> escalation, dashboards and KPIs — is a server-side fold over that append-only
> event log.

© 2026 Musara Holdings LLC. All rights reserved. See [LICENSE](LICENSE).

**Server:** free Google Cloud / Oracle Cloud setup with a one-command
installer in [DEPLOY-FREE-CLOUD.md](DEPLOY-FREE-CLOUD.md).

**Phones:** see [INSTALL-PHONES.md](INSTALL-PHONES.md). Android APK:
<https://github.com/MFD-14/Farm-Manager/releases/download/android-latest/woodlands.apk>
(rebuilt automatically on every app change). iPhone: add the server address
to the home screen from Safari.

## Repository layout

| Path | What it is |
|------|------------|
| `docs/` | WFM-OPS-SPEC v1.0, the build-from-this specification |
| `backend/` | Node/Express + PostgreSQL server: event log, task engine, release engine, rules, escalation, evidence and verification layer, WhatsApp gateway, VIM worker |
| `frontend/` | React PWA (Vite + Workbox): offline-first caretaker day view and capture flows, owner console |
| `prototype/` | The v1 single-file React prototype (claude.ai artifact) that established the screens, flows and Claude Vision contracts |

## What is implemented

**Task engine (spec §3).** TaskTemplate / TaskInstance / TaskEvent object model;
the full state machine (`scheduled → released → … → verified_closed`) with
`done_reported` separated from `verified_closed`; five schedule rule types
(calendar fixed and floating, meter, anchor chain, rolling); the 04:45 release
engine writing an idempotent DailyPlan; the tank-budget irrigation planner
emitting per-block shifts from the real stand; anchor chains for poultry
batches (D-2 through D119 vaccinations plus weekly weights), kale beds and the
90-day cattle programme; capacity handling with P2/P3 deferral and a starvation
guard.

**Trigger rules (spec §3.4).** T1 low water (with two-stage escalation and
irrigation suppression), T2 rain suppression, T3 fall armyworm threshold, T4
poultry mortality, T5 pump-versus-tank physics check, T6 harvest shortfall, T7
condition-score regression, T8 inventory reorder, T9 dark-farm detector.
Triggers instantiate tasks, they do not merely notify. Guards block spray tasks
on overdue calibration and harvests inside pre-harvest intervals, computed
automatically from recorded products.

**Escalation (spec §4).** Per-priority profiles, pre-due nudges, collapsed
overdue WhatsApp reminders with Done/Problem/Skip buttons, missed → rolled with
the yesterday badge, second-miss owner exceptions, third-miss owner-queue
escalation, absence mode with deputy routing and flagged auto-approvals, and
the anti-nag quieting rule.

**Evidence and verification (spec §5).** Evidence classes E0–E5 enforced
client-side and revalidated server-side; E0 random audit upgrades (1 in 7);
deferred media (a task is verifiable-pending-media and caretaker timers stop at
`done_reported`); resumable offset-based uploads; in-image stamping and pHash
re-submission checks; physics checks (water balance, feed balance, harvest
sanity, timing sanity with per-device clock skew); the VIM worker with nine
verification profiles, the 0.80/0.50 confidence thresholds, one-retake flow and
the outage sampling fallback. VIM runs heuristic by default and switches to
Claude Vision with `VIM_MODE=claude` plus an API key.

**Forecast feed.** Open-Meteo (no API key, free for non-commercial use, ~10k
requests/day) is fetched daily at 04:15 farm time: 7-day precipitation, rain
probability, temperatures and FAO-56 reference evapotranspiration for the farm
coordinates. Trigger T2 acts ahead of confident heavy rain (>= 15 mm at >= 60%
probability tomorrow) while an observed gauge reading always wins over the
forecast; a stale snapshot (> 36 h) is ignored and the gauge path never depends
on the network. The rain page shows the 7-day strip with T2 flags and the
digest carries "rain expected tomorrow".

**Phase 2 water-balance planner (spec §3.5 / R14).** The FAO-56 checkbook:
per-block daily ledger `deficit = deficit + Kc·ET0 − rain − irrigation`,
clamped to the root-zone TAW, recomputed deterministically from readings (ET0
from the forecast feed, rain from the W-08 gauge, applied volumes from
completed W-03 shifts). When the projected deficit crosses management-allowed
depletion the planner emits a refill shift with run time = depth / (rate ×
efficiency), capped at 180 minutes with the remainder carrying forward. Ships
disabled ("log before you automate"): the owner Water tab shows the ledger
running in shadow next to the Phase 1 tank-budget shifts and flips Phase 2 on
with one tap; caretaker shift cards then explain the deficit they replace.
Per-block agronomy (Kc, TAW, MAD, area, emitter rate, efficiency) is owner
configuration, and days that fell back to climate-normal ET0 are flagged.

**Channels (spec §4.4, §1.7).** WhatsApp webhook (idempotent on message id,
allow-listed numbers, 24-hour window tracking, button replies appended as
events, inbound media fetched and attached, ambiguous media prompting a task
list); outbound sender that degrades to log-only without credentials; digest at
19:00; notifications log for every rung.

**Sync and devices (spec §6).** `POST /api/sync/events` (idempotent, duplicates
are success, clock-skew handshake), `GET /api/sync/bundle` (the whole day in
one response), device registration with device-bound JWTs, `/restore` for
replacement handsets, owner revocation. `rebuild_projections` replays the
event log deterministically — the disaster-recovery path exists from day one.

**PWA.** IndexedDB stores (`plan`, `outbox_events`, `outbox_media`), a drain
loop with backoff that runs on connectivity and after every capture, priority-
ordered day view with the unsynced counter, sub-minute capture sheets, photo
compression toward the 150–250 KB budget, owner digest / decision queue (claim
and machine verdict side by side) / KPI board.

## Running it

Requirements: Node 20+, PostgreSQL 14+. Redis is optional (the scheduler runs
in-process with node-cron).

```bash
# Backend
cd backend
cp .env.example .env          # set DATABASE_URL, JWT_SECRET
npm install
npm run migrate
npm run seed                  # 63 templates, rules T1-T9, reference data, demo users
npm start                     # serves :4000, cron: release 04:45, sweep 5min, digest 19:00

# Frontend
cd frontend
npm install
npm run dev                   # dev server proxying /api to :4000
npm run build                 # production PWA in dist/
```

Seeded users: `owner@woodlands.farm` / `caretaker@woodlands.farm`, password
`woodlands` (change in production).

```bash
cd backend
npm test                        # 31 tests: state machine, schedules, release
                                # idempotency, triggers, guards, escalation,
                                # sync API, media pipeline, WhatsApp webhook,
                                # absence mode, rebuild determinism
node scripts/simulate-day.js    # end-to-end simulated farm day over the API
node src/jobs/run-release.js    # manual release for a date
node src/jobs/rebuild-projections.js   # replay the event log
```

## Configuration that matters

| Variable | Meaning |
|----------|---------|
| `TANK_USABLE` | Measured usable tank litres, entered after Phase 0 rehabilitation; parameterises trigger T1 and the water balance |
| `VIM_MODE` + `ANTHROPIC_API_KEY` | `heuristic` (default) or `claude` for Claude Vision verification |
| `WA_TOKEN`, `WA_PHONE_ID`, `WA_VERIFY_TOKEN` | WhatsApp Business Cloud API; sender degrades to log-only without them |
| `FARM_TZ` | Farm timezone, default `Africa/Harare` |
| `FARM_LAT`, `FARM_LNG` | Farm coordinates for the forecast feed, default Kwekwe (-18.9281, 29.8149) |

## Rollout

The spec's phased rollout (§8) applies: Sprint 0 uses W-01/W-02/C-01 capture
and the read-only digest; R1 turns on the full taxonomy with evidence enforced
on P0/P1 only; R2 arms the trigger rules; R3 moves VIM from shadow to
enforcing; R4 scales. Templates, rules and thresholds are all data (seeded,
owner-editable, versioned), so gating a phase is configuration, not code.
