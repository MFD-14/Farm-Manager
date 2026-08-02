# Woodlands Farm Manager: Systems and Processes Layer Specification

**Document:** WFM-OPS-SPEC v1.0
**Date:** 2 August 2026
**Scope:** Operations taxonomy, task engine, escalation, evidence and verification, data model, integration split, rollout, governance
**Audience:** Developer (build from this), Owner (operate from this)
**Farm:** Woodlands Farm, Subdivision 3, 119.2 ha, Kwekwe, Midlands Province, Zimbabwe

---

## 0. The bottom line

**The single most important design decision: the caretaker's phone never edits shared state. It only appends signed, timestamped evidence events to a local outbox that drains whenever any connectivity exists. Everything else in this system, the task state machine, verification, escalation, dashboards and KPIs, is a server-side fold over that append-only event log.**

Why this decision carries the whole design:

1. **It makes offline-first trivial instead of hard.** Sync conflicts arise when two parties edit the same record while disconnected. If the phone only ever appends new facts ("tank reading 62% at 06:14", "task W-03 reported done at 09:41 with photo abc123"), there is nothing to conflict with. The server folds events into task state in arrival order using event timestamps. The research bears this out: every serious agricultural app surveyed (AgriWebb, Herdwatch, Agworld, Breedr) claims offline capture, and not one publishes conflict resolution semantics, because their data is append-heavy and appends barely conflict. We adopt the pattern explicitly rather than by accident.
2. **Every action becomes evidence automatically.** An append-only log is an audit trail by construction. For an owner running the farm from off site, the log is the farm: it cannot be silently rewritten, and gaps in it are themselves a signal (see the dark-farm detector, Section 4.5).
3. **It lets WhatsApp be a second client, not a bolt-on.** A WhatsApp button tap or inbound photo is just another event appended by the server on the caretaker's behalf. App and WhatsApp write to the same log, so the caretaker can complete a task from either channel and the state machine does not care which.
4. **It survives the phone.** Replace a broken handset, restore the event log from the server, and the caretaker is back where they were (the CommCare restore pattern, Section 9.3).

Strongest objection: append-only logs complicate corrections, since you cannot edit a wrong entry, you must append a correcting event, and the fold logic must honour it. Accepted cost: corrections are rare, and a visible correction trail is a feature, not a bug, on a farm managed remotely.

Second-ranked decision, stated because it shapes every screen: **closure is evidence-gated and machine-verified.** No task reaches `verified_closed` without the evidence its template demands, and the Video Intelligence Module is wired in as an automatic verifier of that evidence, not as a separate analysis feature. Commercial CMMS products (MaintainX, UpKeep, Limble) stop at "done"; none has a first-class owner-verified state. That gap is exactly what a remote owner needs closed, so this design closes it.

---

## 1. Research: how established platforms solve this

Two structured research passes were run across livestock and herd apps, crop and field operations platforms, irrigation scheduling tools, work order and CMMS systems, offline-first sync architecture, and the WhatsApp Business Platform. Findings are tagged **Confirmed** (vendor help centres, user guides, public technical documentation, extension publications) or **Inferred** (marketing copy, app store listings, synthesis). Patterns marked ADOPT are carried into this design; the section that uses each is given in brackets.

### 1.1 Task and record modelling

| # | Pattern | Source products | Status | Verdict |
|---|---------|----------------|--------|---------|
| R1 | Everything is a log against an asset. One event primitive (log) with types (activity, observation, input, harvest, maintenance, medical, seeding, transplanting), linked to assets (what it happened to), locations (where), quantities (how much), owners (who), files. A future-dated log with status `pending` is a task; marking it `done` turns the plan into the historical record. Task and record are one entity. | farmOS 3.x (public data model documentation) | Confirmed | ADOPT with modification [3.1]: we keep the unification but add a richer state machine than pending/done, because a remote owner needs reported-versus-verified distinction |
| R2 | Thin task beside rich typed records. Task object needs only a name; everything else optional. Real data lives in typed records (treatment, feed, weight, birth, movement) keyed to mob or individual animal. | AgriWebb (help centre) | Confirmed | REJECT the split; adopt the typed-record catalogue as evidence payload types [5.1] |
| R3 | Document chain: plan, recommendation, work order, actual. Completion of the work order is the record-keeping step; the actual inherits the plan's content and captures what really happened (rates, batch numbers, weather at application). | Agworld | Confirmed (flow), Inferred (schema) | ADOPT the principle that completing a task IS creating the record [3.2, 5.1] |
| R4 | Work order carries asset, priority, due date, assignees, procedures (checklists), parts, photos, completion records; recurrence lives on the work order. | MaintainX, UpKeep, Limble | Confirmed | ADOPT the object shape [3.1] |
| R5 | Work order weather restrictions: the order itself carries limits (wind for spraying) and the manager is notified on violation; orders carry expiration dates so stale instructions die. | Trimble Ag | Confirmed | ADOPT as guard conditions and task expiry [3.3, 3.4] |
| R6 | Polymorphic association: one task links to crop, location, animal or equipment through a single mechanism. | Farmbrite | Confirmed | ADOPT [3.1: `subject_type` + `subject_id`] |

### 1.2 Recurrence and release

| # | Pattern | Source products | Status | Verdict |
|---|---------|----------------|--------|---------|
| R7 | Calendar recurrence (daily, weekly, monthly) with task templates and series. | Farmbrite | Confirmed | ADOPT for fixed-cadence work [3.3] |
| R8 | Fixed versus floating preventive maintenance: fixed schedules release on the calendar regardless of last completion (compliance work); floating schedules compute next due from actual completion (wear-driven work). | Limble, Fiix | Confirmed | ADOPT both, per template flag [3.3] |
| R9 | Meter and usage-based release: task fires at accumulated run-hours or a submitted meter reading meeting a condition. | Limble, MaintainX automations | Confirmed | ADOPT for pump and generator service [3.3] |
| R10 | Template-driven season generation from an anchor date: adding a planting generates the season's task chain with dates computed relative to the planting; when the plan shifts, task dates shift with it. | Tend (Growing Templates) | Confirmed (behaviour), Inferred (offset arithmetic) | ADOPT as anchor-offset chains for crop successions and poultry batches [3.3] |
| R11 | Biology-derived scheduling: breeding record auto-computes calving due date from gestation; scan record refines it; due-this-week lists refresh automatically. Livestock platforms rarely use calendar recurrence; schedules derive from recorded biological anchor events. | CattleMax, AgriWebb, Herdwatch | Confirmed | ADOPT [3.3: anchor chains on animal events] |
| R12 | Rolling chain recurrence: each completed herd move schedules the next from grazing arithmetic; the reminder fires when the move is due. | PastureMap | Confirmed | ADOPT for irrigation shifts and grazing moves [3.3] |

### 1.3 Triggers

| # | Pattern | Source products | Status | Verdict |
|---|---------|----------------|--------|---------|
| R13 | Soil moisture and tension thresholds reduce to a band: refill line (irrigate when crossed) and full point (stop). Alerts by push, SMS, email. | CropX, Hortau, AquaSpy | Confirmed (mechanics), Inferred (band reduction) | ADOPT the band abstraction, applied to tank level rather than soil sensors in Phase 1 [3.4] |
| R14 | Water-balance (checkbook) scheduling: daily ledger `deficit = deficit + ETc - rain - irrigation`; irrigate at management allowed depletion; run time = depth to replace divided by application rate times efficiency. Needs no field hardware. | FAO-56, CIMIS, WSU Irrigation Scheduler Mobile, SWAN | Confirmed | ADOPT as the Phase 2 irrigation planner; Phase 1 uses the simpler tank-budget method [3.5] |
| R15 | Infrastructure-state alerts: tank level, flow and rain loggers with SMS or email on threshold crossing; zero flow during a scheduled event means pump failure, flow outside schedule means leak. | Wildeye, WiseConn | Confirmed | ADOPT as physics checks computed from manual readings first, sensors later [5.4] |
| R16 | Satellite anomaly to human-assigned scouting task with named assignee and deadline; detection automated, task creation a human decision. | EOSDA Crop Monitoring | Confirmed | ADOPT the shape, but automate the creation step (see white space below) |
| R17 | Sensor event to alert cascade: first alert at threshold, second if condition persists. | Moocall | Confirmed | ADOPT the two-stage cascade for escalations [4.2] |
| R18 | Derived obligation lists: recording a treatment automatically produces the daily "animals in withdrawal" view; job lists update from data on other screens. | Herdwatch, HerdApp | Confirmed (Herdwatch), Inferred (HerdApp) | ADOPT [3.4: withdrawal and pre-harvest-interval blocking rules] |

**White-space finding (Confirmed absence, treated as tentative):** no surveyed mainstream platform auto-releases tasks from growth-stage, threshold or lifecycle triggers; every documented trigger ends in a notification and a human creates the task. Trimble's weather-restricted work orders are the only documented blocking trigger. This design automates trigger-to-task release directly (Section 3.4), because the human who would do that translation here is the absent owner.

### 1.4 Offline and sync

| # | Pattern | Source products | Status | Verdict |
|---|---------|----------------|--------|---------|
| R19 | Offline capture with sync ritual: unsynced-count badge, manual sync button, background sync toggle, sync at start and end of day. Conflicts prevented socially; duplicates, not merges, are the warned failure mode. | AgriWebb, Herdwatch | Confirmed (UI and ritual), Inferred (internals) | ADOPT the visible unsynced counter [4.1]; replace ritual with automatic outbox drain |
| R20 | Session batching: prime local data online, capture offline in an atomic session, commit the session on reconnect. | Breedr (chute mode) | Confirmed | ADOPT for the daily plan bundle [3.6] |
| R21 | Append-only events with a transactional outbox: state changes stored as immutable events; outbox drained to server; conflicts shrink to semantic ones handled by fold logic. Deterministic winner plus keep-the-loser for audit. | Event-sourcing pattern (Azure Architecture Center), CouchDB/PouchDB semantics | Confirmed | ADOPT as the core architecture [Section 0, 6.1] |
| R22 | Offline forms with deferred media: forms finalised fully offline queue on a ready-to-send screen and auto-send on connectivity; transport configurable (WiFi only, cellular, both); media uploads with the submission when connectivity allows. | ODK Collect, KoboToolbox, CommCare | Confirmed | ADOPT the two-queue split: tiny events on any bearer, media deferred [5.3] |
| R23 | Device restore: a replacement phone re-hydrates from the server's record of that user's submissions. | CommCare (restore API) | Confirmed | ADOPT [6.3, 9.3] |
| R24 | SMS outbound nudges and USSD structured inbound work on any handset and are the proven regional fallback. | Esoko (Ghana), DigiFarm Kenya (*283#), DigiCow | Confirmed | ADOPT SMS as degraded-mode channel only [4.4] |

### 1.5 Evidence and verification

| # | Pattern | Source products | Status | Verdict |
|---|---------|----------------|--------|---------|
| R25 | Evidence rules live in the checklist template: required procedure fields (photo, number, pass/fail, signature) block completion until filled; part-required toggle. | MaintainX | Confirmed | ADOPT as per-template `evidence_policy` [5.1] |
| R26 | Compliance as a by-product of the operational write: barcode-scanned medicine auto-populates withdrawal; treatment record auto-computes withdrawal end dates and a daily in-withdrawal list; audit day is printing reports. | Herdwatch (Bord Bia), AgriWebb | Confirmed | ADOPT [3.4 blocking rules, 5.1 input evidence type] |
| R27 | Spray record as forensic document: rates, batch numbers, weather auto-populated at application time. | Agworld | Confirmed | ADOPT for chemical application evidence [5.1] |
| R28 | Geotagged photos with caps (three per note), aggregated into reports; e-signatures absent across the whole industry, attribution is by user identity. | AgriWebb, Climate FieldView | Confirmed | ADOPT photo caps and user attribution; skip signatures |
| R29 | Voice notes as completion records, machine-summarised later. | MaintainX (CoPilot) | Confirmed | ADOPT voice evidence for literacy tolerance [5.1] |

### 1.6 Escalation, rollup and the absent owner

| # | Pattern | Source products | Status | Verdict |
|---|---------|----------------|--------|---------|
| R30 | Overdue thresholds and escalation automations: configurable days-past-due before a task counts overdue; automations notify on conditions. Multi-tier escalation chains are build-it-yourself even in mature CMMS. | Limble, MaintainX | Confirmed (features), Inferred (absence of built-in chains) | ADOPT and build the chain explicitly [4.2] |
| R31 | Absent-owner support is pull dashboards plus event push plus exception lists (due this week, in withdrawal, restriction violated). Scheduled digests are rare; Farmbrite's daily reminder email is the main confirmed instance. | AgriWebb, CattleMax, Herdwatch, Farmbrite | Confirmed | ADOPT exceptions-first digest [4.5]: the owner reads exceptions, not activity |
| R32 | KPI canon: preventive maintenance compliance percent (completed on time over scheduled) as the leading indicator; mean time to repair; planned percentage of work. | Limble, Fiix, UpKeep | Confirmed | ADOPT PM compliance as the master task KPI [9.2] |
| R33 | No commercial CMMS has a first-class verified-by-supervisor state; verification happens informally after "done". | MaintainX, UpKeep (documented state machines) | Confirmed | Gap closed by this design's `done_reported` to `verified_closed` transition [3.2] |

### 1.7 WhatsApp Business Platform mechanics (all Confirmed from platform documentation unless noted)

- Two message classes: free-form messages are allowed only inside the 24-hour service window that opens or refreshes each time the user messages the business; outside it, only pre-approved template messages (categories: utility, marketing, authentication) may be sent.
- Since 1 July 2025 pricing is per delivered template message; service messages are free, and utility templates sent inside an open window are also free. Consequence for us: a caretaker who interacts daily keeps the window rolling and nearly all traffic is free; the only paid messages are utility templates that re-open contact after more than 24 hours of silence, a few cents per day at worst in the Sub-Saharan Africa price band.
- Interactive messages: reply buttons (maximum three per message) and list messages (up to ten rows) return structured payloads to the webhook. Three buttons cover our task interaction: Done, Problem, Skip.
- Inbound media: the webhook delivers metadata plus a media ID; the server fetches a short-lived download URL (about five minutes) and must store the binary itself immediately. Voice notes arrive as audio messages through the same flow. WhatsApp's own store-and-forward therefore acts as the caretaker's media deferral layer.
- Status callbacks (sent, delivered, read, failed) arrive per message; handlers must be idempotent and order-tolerant (Inferred best practice from documented delivery variability).
- Template quality rating can pause templates with poor read rates, so operational templates must stay in the utility category and be genuinely useful.
- Precedent: Farmer.Chat (Digital Green) validates WhatsApp with voice, text and picture input for African and Indian smallholder contexts (Confirmed), but no documented product does CMMS-style evidence-gated task closure over WhatsApp (Confirmed absence). This design composes the two proven halves.

---

## 2. Canonical operations taxonomy

Conventions used throughout: task codes are `DOMAIN-NN`. Domains: **W** water, **C** crops, **K** cattle (kine), **P** poultry, **A** assets and infrastructure, **F** farm administration. Priorities: **P0** stop-everything, **P1** same-day critical, **P2** routine scheduled, **P3** flexible. Evidence classes **E0** to **E5** are defined in Section 5.1. Durations are target completion times on the phone, not job durations. Cadence names refer to schedule rule types defined in Section 3.3.

### 2.1 Daily tasks

| Code | Task | When | Priority | Evidence | Notes |
|------|------|------|----------|----------|-------|
| W-01 | Tank and pool level reading | 06:00 and 17:00 | P1 | E1 + E2: level value plus photo of gauge or dipstick | The sentinel reading; feeds triggers T1, T5 |
| W-02 | Pump run log | At switch-on and switch-off | P1 | E1: start time, stop time, meter photo if fitted | Yields run-hours for A-01 meter service |
| W-03 | Irrigation shift (per block) | Per daily irrigation plan, typically 2 to 4 instances | P1 | E1 + E2: block, start, stop, photo of wet emitter line | Released by the irrigation planner (3.5); suppressed by rain rule T2 |
| C-01 | Kale harvest and bundle count | 05:30, before heat | P1 | E1 + E2: bundle count plus one photo of bundled stack | VIM counts bundles from the photo (5.5) |
| C-02 | Sales and dispatch record | At sale or collection | P1 | E1 + E2: bundles sold, price, buyer, photo of load or cash tally | Revenue source of truth |
| C-03 | Seedbed and nursery watering | 06:30 | P2 | E0 (sampled) | Only while nursery active |
| K-01 | Cattle rehabilitation ration feed | 07:00 | P1 | E2: photo of feed in trough with herd present | 90-day ration programme; quantity from ration card |
| K-02 | Cattle water and gate check | 07:30 | P2 | E0 (sampled) | Escalates to P1 fault task if trough dry |
| P-01 | Poultry feed and water, morning | 06:15 | P1 | E1: feed scoops or kg per house | Per active house or batch |
| P-02 | Poultry feed and water, afternoon | 16:00 | P2 | E0 (sampled) | |
| P-03 | Brooder temperature and chick check | 06:00, 12:00, 21:00 | P1 | E1 + E2: temperature reading, photo of chick spread pattern | Only while any batch age is under 28 days; chick spread photo lets VIM and owner judge heat correctness |
| P-04 | Egg collection and grading count | 10:00 and 15:00 | P1 | E1: trays and singles count | Activates when first batch reaches point of lay |
| P-05 | Mortality check and record | 06:15 | P1 | E1 + E2: count per house, photo if more than 2 | Zero is a required entry, not an assumed default |
| A-02 | Infrastructure and security walk | 17:30 | P2 | E0 with weekly E2 sample | Route: pump house, tank, gates, stores |
| F-01 | Cash and float reconciliation | 17:00 | P2 | E1: cash on hand versus recorded sales | Variance beyond 5 dollars fires owner exception |

### 2.2 Weekly tasks

| Code | Task | When | Priority | Evidence | Notes |
|------|------|------|----------|----------|-------|
| W-04 | Drip filter flush and lateral inspection | Monday 08:00 | P2 | E3: before and after photo of filter element | Floating schedule: next due 7 days after completion |
| W-05 | Reticulation walk: mainline, valves, leaks | Thursday | P2 | E2: photo of any defect, else E0 | Defect found spawns A-repair task automatically |
| C-04 | Fall armyworm scout, maize block | Monday 06:30 | P1 | E1 + E2: form (plants inspected, plants with fresh damage) plus photos of damage | W-pattern walk, 10 stations of 10 plants; feeds trigger T3 |
| C-05 | Tomato and onion pest and disease scout | Tuesday 06:30 | P2 | E1 + E2 as C-04 | Red spider mite, bollworm, thrips, blight watch |
| C-06 | Kale succession transplant | Wednesday | P2 | E1 + E2: plants transplanted, bed identifier, photo of completed bed | Anchor event: starts the bed's lifecycle chain (3.3) |
| C-07 | Fertigation or top dressing per crop programme | Per programme | P2 | E1 + E2: product, quantity, block, photo of application | Decrements inventory; enforces label rates |
| K-03 | Body condition score, sample of 5 animals | Friday 07:00 | P2 | E1 + E2: scores per ear tag, side-on photo of each scored animal | VIM assists scoring from photos (5.5); feeds trigger T7 |
| K-04 | Tick control: dip or spray | Per DVS seasonal cadence: weekly in rains (Nov to Apr), fortnightly dry season | P1 | E2: race or spray photo with herd | Cadence switch is a seasonal rule (3.3) |
| P-06 | Poultry house deep clean and litter turn | Saturday | P2 | E3: before and after photos | Per house, staggered |
| P-07 | Feed stock count and consumption check | Sunday | P2 | E1 + E2: bags on hand, photo of stack | Feeds trigger T8 reorder rule |
| A-03 | Fence line section walk | Rotating section per week | P3 | E2: one photo per section corner | Four sections, monthly full coverage |
| F-02 | Weekly labour attendance and wage sheet | Saturday | P2 | E1: days worked per labourer | Owner approves before payment |

### 2.3 Monthly and seasonal tasks

| Code | Task | When | Priority | Evidence | Notes |
|------|------|------|----------|----------|-------|
| A-01 | Borehole pump and generator service | Meter: every 250 run-hours (S3) | P2 | E3 + E1: before and after, checklist, parts used | Run-hours accumulate from W-02 events |
| W-06 | Drip system chemical flush (chlorine or acid per water test) | Monthly, floating | P2 | E1 + E2 | Prevents emitter blockage on borehole water |
| W-07 | Borehole static level check | Monthly, dry season fortnightly | P2 | E1 | Early warning of aquifer stress |
| A-04 | Knapsack and spray equipment calibration | Quarterly | P2 | E1: measured output over measured area | Blocks C-SPRAY tasks if overdue (guard rule) |
| A-05 | Tank integrity inspection | Quarterly after Phase 0 rehabilitation | P2 | E4: 20 second walk-around video | VIM screens for visible leaks and wet ground |
| K-05 | Cattle vaccination: anthrax and blackleg | Annually, September to October, before rains | P1 | E2 + E1: batch number, dose count, race photo | Aligned to DVS campaigns; owner sources vaccine |
| K-06 | Deworming | Rains onset and rains end | P2 | E1 + E2: product, batch, animals treated | Withdrawal auto-recorded (3.4) |
| K-07 | Pregnancy diagnosis and cull review | Annually post-bulling | P2 | E1 per animal | Sets biological anchors for calving chains |
| C-08 | Land preparation per block | Per cropping calendar, October onward | P2 | E3 before and after | Released by season plan |
| C-09 | Planting: sorghum SV4, maize | With effective rains, November window | P1 | E1 + E2: variety, seed rate, block | Anchor event for the block's season chain |
| C-10 | Tomato and onion nursery sowing and transplant | Per succession plan | P2 | E1 + E2 | Anchor events |
| C-11 | Harvest: tomato, onion, sorghum, maize | Crop-specific windows from anchor chains | P1 | E1 + E2: quantity, grade, photo | Blocked inside any active pre-harvest interval (3.4) |
| P-08 | Hatch or chick placement, new batch | Per staggered hatching plan, roughly monthly | P1 | E1 + E2: count placed, source, house | Creates a Batch entity; starts the batch lifecycle chain (3.3) |
| F-03 | Month-end stock take: chemicals, feed, fuel, spares | Last Saturday | P2 | E1 + E2 | Reconciles inventory ledger |
| F-04 | Month-end owner review pack | Auto-generated 1st of month | P2 | System-generated | KPIs of Section 9.2; owner reads, no farm labour |

### 2.4 Event-triggered tasks (released by rules, Section 3.4)

| Code | Task | Trigger | Priority | Evidence |
|------|------|---------|----------|----------|
| W-E1 | Low-water protocol: priority irrigation only, kale first | Tank plus pool below 30% of working volume | P0 | E1 acknowledgement plus shift logs |
| W-E2 | Borehole or pump fault inspection | Pump ran but tank level did not rise as expected (physics check 5.4) | P1 | E4 video of pump running plus E5 voice description |
| W-E3 | Leak hunt | Tank fell overnight with no irrigation logged | P1 | E2 photo of found leak or E5 all-clear voice note |
| C-E1 | Fall armyworm spray, rotated mode of action | C-04 scout: fresh damage at or above 20% of plants (whorl stage) or 10% (seedling) | P1 | E1 + E2: product, batch, rate, block, nozzle photo |
| C-E2 | Replant or gap-fill | Emergence below 80% at day 10 after planting | P2 | E1 + E2 |
| K-E1 | Sick animal: isolate, describe, treat per vet advice | Caretaker flags animal from any K task | P1 | E4 + E5: video of animal, voice description; treatment E1 with product and batch |
| K-E2 | Calving follow-up chain: navel care day 0, tag day 1, dam check day 3 | Calving reported | P1 | E2 per step |
| P-E1 | Batch vaccination step | Batch age reaches template offset (2.5) | P1 | E1 + E2: vaccine, batch number, count |
| P-E2 | Abnormal mortality response: isolate house, biosecurity, vet call | P-05 mortality above 1% of house in a day or 3 consecutive days above 0.3% | P0 | E4 + E1 |
| A-E1 | Breakdown repair (any asset) | Caretaker report or physics check | P1 or P0 per asset criticality | E3 before and after, parts used E1 |
| F-E1 | Input purchase and delivery confirmation | Stock rule T8 or owner instruction | P2 | E2: delivery photo, quantities into inventory |

### 2.5 Poultry batch lifecycle template (anchor chain, worked instance in 3.3)

Offsets from batch placement day D0. Vaccination schedule is the configurable default; **confirm against the supplying hatchery's programme and local Department of Veterinary Services guidance before first use** (flagged as assumption, not confirmed veterinary advice).

| Offset | Task | Evidence |
|--------|------|----------|
| D-2 | Brooder setup: litter, heat test, feed and water positioned | E3 |
| D0 | Chick placement and count | E1 + E2 |
| D1 to D28 | P-03 brooder checks activate at batch level | E1 + E2 |
| D7 | Newcastle plus infectious bronchitis vaccine (eye drop) | E1 + E2 |
| D14 | Gumboro (IBD) vaccine | E1 + E2 |
| D21 | Gumboro booster | E1 + E2 |
| D28 | Newcastle booster (La Sota); brooding ends, grower phase | E1 + E2 |
| D56 | Fowl pox vaccination (wing web) | E1 + E2 |
| D112 | Transfer to layer house; point-of-lay preparation | E1 + E2 |
| D119 | Newcastle killed vaccine before lay | E1 + E2 |
| D126 onward | P-04 egg collection activates for this batch | E1 |
| Weekly from D7 | Batch weight sample (10 birds) | E1 |

### 2.6 Cattle rehabilitation programme (90-day chain, active now)

Anchored to programme start. Daily K-01 ration feeding; weekly K-03 body condition scoring of a rotating sample of 5 animals with target trajectory from score 2.5 to 3.0 by day 90; fortnightly ration review task to the owner fed by the K-03 trend; day 90 full-herd scoring and programme close-out report. If the weekly median score falls by 0.25 or more, trigger T7 fires an owner ration-review exception immediately rather than waiting for the fortnightly review.
---

## 3. Task engine specification

### 3.1 Object model

Two core entities, following the research verdicts (R1, R4, R6): a **TaskTemplate** holds the rule and never appears on the phone; a **TaskInstance** is one released occurrence, and completing it IS creating the operational record (R3). All mutation of a TaskInstance happens through appended **TaskEvents**; the instance row is a server-maintained projection for fast querying.

**TaskTemplate**

```
task_template {
  id                uuid
  code              text            -- "W-01", "C-E1"
  title             text            -- shown to caretaker, kept short
  title_local       text            -- optional Shona or Ndebele rendering
  domain            enum(W,C,K,P,A,F)
  subject_type      enum(asset, location, batch, herd, none)   -- R6 polymorphic link
  default_subject_id uuid null
  priority          enum(P0,P1,P2,P3)
  est_minutes       int             -- phone interaction target, not job length
  instructions      jsonb           -- ordered steps: {text, photo_url, voice_url}
  checklist         jsonb           -- optional required sub-items
  evidence_policy   jsonb           -- Section 5.1, e.g. {"classes":["E1","E2"],
                                    --   "fields":[{"key":"level_pct","type":"number","min":0,"max":100}],
                                    --   "photo_min":1, "vim_profile":"tank_gauge"}
  schedule          jsonb           -- Section 3.3 rule object, null for trigger-only templates
  guards            jsonb           -- Section 3.4 blocking conditions (PHI, withdrawal, calibration)
  escalation_profile text           -- Section 4.2, default per priority
  active            bool
  version           int             -- templates are versioned; instances pin the version they released from
}
```

**TaskInstance** (projection; canonical state lives in the event log)

```
task_instance {
  id                uuid
  template_id       uuid
  template_version  int
  period_key        text        -- e.g. "2026-10-14" or "2026-10-14:AM"; uniqueness
                                -- (template_id, period_key) makes release idempotent
  subject_type      enum, subject_id uuid
  assignee_id       uuid
  title, priority, est_minutes  -- denormalised from template at release
  params            jsonb       -- trigger-supplied values: block, litres, product, rate
  release_at        timestamptz
  due_at            timestamptz
  grace_until       timestamptz -- due_at + grace window from escalation profile
  expires_at        timestamptz null   -- R5: stale instructions die (e.g. rain-suppressed shift)
  state             enum        -- Section 3.2
  missed_count      int
  deferral_count    int
  evidence_summary  jsonb       -- filled by fold as evidence events arrive
  verification      jsonb       -- {method: vim|physics|owner|sampled_none, confidence, verdict}
  closed_at         timestamptz
}
```

**TaskEvent** (append-only; the system of record)

```
task_event {
  event_uuid   uuid          -- generated on the phone; idempotency key
  instance_id  uuid
  actor_type   enum(caretaker, owner, system, vim, whatsapp)
  actor_id     uuid
  type         enum(released, seen, started, field_recorded, media_attached,
                    done_reported, skip_requested, problem_flagged,
                    auto_verified, review_required, verified_closed,
                    rejected_reopened, missed, expired, cancelled, superseded,
                    corrected, deferred, reassigned, escalated)
  payload      jsonb         -- readings, media refs {media_uuid, kind}, reasons, verdicts
  device_time  timestamptz   -- when it happened on the phone
  server_time  timestamptz   -- when the server accepted it
  device_id    uuid
}
```

Supporting entities (full DDL in Section 6.1): Asset, Location, Batch, Herd/AnimalGroup, Animal, InventoryItem and InventoryMove, Reading (typed observations like tank level that exist outside any task), Rule, EscalationProfile, MediaObject, DailyPlan, Device.

Design rule carried from farmOS (R1): **a completed TaskInstance is the record.** There is no second "activity log" to fill in; reports, compliance views and KPIs are queries over instances, events and readings.

### 3.2 State machine

States and legal transitions. Guard conditions in square brackets; every transition is itself a TaskEvent, so the full history is replayable.

```
scheduled --released--> released                    [release_at reached, guards pass; system]
released --seen--> acknowledged                     [phone or WhatsApp renders it; automatic]
acknowledged --started--> in_progress               [optional; micro-tasks skip straight to done]
released|acknowledged|in_progress
          --done_reported--> done_reported          [evidence_policy satisfied locally; caretaker]
          --skip_requested--> skip_pending          [reason from fixed list + free text; caretaker]
          --problem_flagged--> blocked              [reason + optional E5 voice note; caretaker]
done_reported --auto_verified--> verified_closed    [VIM confidence >= 0.80 AND physics checks pass]
done_reported --review_required--> needs_review     [VIM 0.50 to 0.79, or physics anomaly,
                                                     or random audit sample hit]
done_reported --auto_verified--> verified_closed    [E0 tasks: sampled-none verification]
needs_review --verified_closed--> verified_closed   [owner approves in app]
needs_review --rejected_reopened--> released        [owner rejects; missed_count unchanged,
                                                     rejection_count += 1, new due_at]
skip_pending --approved--> skipped                  [owner or auto-rule (e.g. rain skip)]
skip_pending --denied--> released                   [owner]
blocked --unblocked--> released                     [owner action or linked repair task closes]
released|acknowledged --missed--> missed            [grace_until passed with no terminal event; system]
missed --rolled--> released                         [next plan day; missed_count += 1]
any non-terminal --expired--> expired               [expires_at passed; system; logged, not punished]
any non-terminal --cancelled--> cancelled           [owner]
any non-terminal --superseded--> superseded         [newer instance of same template+subject released]
verified_closed --corrected--> verified_closed      [correction event appends; original preserved]
```

Terminal states: `verified_closed`, `skipped`, `expired`, `cancelled`, `superseded`. Nothing else counts as finished in any KPI.

The fast path matters most: for a micro-task the caretaker sees the card, taps **Done**, the camera opens pre-set, one photo, submit. Three taps, under 30 seconds, `released` to `done_reported` in one gesture. `in_progress` exists only for jobs where labour time matters (repairs, land preparation) and is never required.

Two deliberate departures from surveyed products: `done_reported` versus `verified_closed` separates the caretaker's claim from the system's or owner's confirmation (closing the CMMS gap, R33), and `skip_pending` makes "did not do it, here is why" a first-class honest outcome rather than something that rots into `missed`. A caretaker who reports honestly must always have a cheaper path than one who goes silent.

### 3.3 Scheduling rules

Five schedule rule types cover everything in Section 2. The `schedule` field on a template holds exactly one.

**S1: Calendar (fixed).** `{type:"calendar", freq:"daily|weekly|monthly", byday:["MO"], at:["06:00","17:00"], fixed:true}`. Releases regardless of prior completion (R8 fixed). Used for: W-01, K-01, P-01, C-01, F-01, K-05 (yearly).

**S2: Calendar (floating).** As S1 with `fixed:false`: next occurrence is scheduled from the previous instance's `closed_at` plus the interval (R8 floating). Used for wear-driven work: W-04 filter flush, W-06 chemical flush, A-04 calibration.

**S3: Meter.** `{type:"meter", meter:"pump_run_hours", every:250, source:"reading"}`. The pump's run-hours accumulate from W-02 events; when the accumulator crosses each 250-hour boundary, release the service task (R9). Used for: pump service, generator oil change.

**S4: Anchor chain.** `{type:"anchor", anchor_event:"batch_placed", offsets:[{d:7, template:"P-E1", params:{step:"ND+IB"}}, ...]}`. An anchor event (batch placed, bed transplanted, planting done, calving reported, programme started) instantiates the whole chain with dates computed from the anchor (R10, R11). If the anchor moves (replant), unreleased chain members shift with it; released ones are superseded. Used for: poultry batch lifecycle (2.5), kale bed cycle below, crop season chains, K-E2 calving follow-ups, the 90-day cattle programme.

**S5: Rolling chain.** `{type:"rolling", next_from:"completion", compute:"irrigation_planner|grazing_planner"}`. Completing one instance asks a planner function to schedule the next (R12). Used for: W-03 irrigation shifts, future grazing rotation.

**Seasonal modifier.** Any rule may carry `season_overrides`: K-04 dipping is `{freq:"weekly"}` from November to April and `{freq:"fortnightly"}` from May to October, switching automatically on configured dates the owner can adjust.

**Worked example, kale succession (S4).** Owner target: 10,000 plants in continuous production yielding 330 to 400 bundles per day (which at one dollar per bundle gives 10,000 to 12,000 dollars per month). Configuration: beds of 800 plants, one C-06 transplant anchor per week. The anchor `bed_transplanted(bed_17, 2026-10-14, plants:800)` instantiates:

- D0 C-06 transplant record (the anchor task itself, evidence E1 + E2)
- D3, D7 establishment watering checks (E0)
- D10 gap-fill check C-E2 guard: emergence and survival at or above 80%, else release replant
- D14, D28 top dressing C-07 with rates from the template
- D28 onward: bed enters the daily C-01 harvest pool; the harvest planner draws roughly equal picking across mature beds
- D180 bed retirement and re-preparation task, closing the loop back to C-08

At steady state 12 to 13 active beds exist, one per week of age, and the release engine maintains the whole rotation with no manual scheduling. When 50 bundles per day (current) needs to become 330, the only change is the succession cadence and bed size in the template; the chain does the rest.

**Worked example, poultry batch (S4).** `batch_placed(batch_2026_11, 2026-11-03, count:150, house:H2)` instantiates the 2.5 chain: vaccination tasks at D7, D14, D21, D28, D56, D112, D119; brooder checks P-03 activate for D0 to D28; egg collection P-04 activates for the batch at D126. Staggered hatching toward 1,000 layers means several overlapping chains; the engine namespaces every instance by batch so the caretaker sees "Gumboro vaccine, House 2 batch, 150 birds" not an abstract reminder.

**Worked example, meter service (S3).** W-02 events log pump start 06:10 stop 12:20 gives 6.2 hours appended to the `pump_run_hours` accumulator. At 250 hours the pump service task releases with the checklist (grease, alignment, foot valve, cable check). If the caretaker forgets W-02 entries, the physics check (5.4) notices water appearing without pump hours and nudges.

### 3.4 Trigger rules

A **Rule** watches the event stream and readings, and releases templates with parameters. This is the deliberate step beyond the surveyed industry (Section 1.3 white space): triggers do not merely notify, they instantiate the task, because the human who would otherwise translate alert into instruction is off site.

```
rule {
  id            uuid
  name          text
  source        enum(reading, task_event, forecast, vim_verdict, inventory, clock)
  condition     jsonb   -- expression over the source, e.g. {"metric":"tank_level_pct","op":"<","value":30}
  action        jsonb   -- {release:"W-E1", params_from:{...}, notify:["owner"], suppress:["W-03"]}
  cooldown_h    int     -- no re-fire inside this window
  arm_condition jsonb   -- optional: rule only active when true (e.g. season, batch age)
  two_stage     jsonb   -- optional second escalation if condition persists (R17)
}
```

Worked rules for this farm, with the exact arithmetic:

**T1 Low water.** Working buffer is the pool, 45,000 litres, plus the main tank's usable volume once rehabilitated (80,000 to 125,000 litres; use the surveyed figure post Phase 0, parameterised as `TANK_USABLE`). Condition: combined stored volume below 30% of working buffer at any W-01 reading. Action: release W-E1 low-water protocol (kale first, then poultry, then tomato and onion, cattle trough always exempt from cuts), suppress routine W-03 releases for non-priority blocks, utility-template WhatsApp to owner. Cooldown 24 hours. Two-stage: below 15%, P0 alert and owner phone-call prompt.

**T2 Rain suppression.** Source: forecast API (or caretaker rain-gauge reading, which wins over forecast). Condition: observed rain at or above 15 mm in 24 hours. Action: suppress next day's W-03 releases for rainfed-capable blocks, append `expired` to already-released shifts with reason `rain`, release a field-access check task instead. This is the Trimble guard pattern (R5) inverted into automation.

**T3 Fall armyworm action threshold.** Source: C-04 scout form. Condition: `fresh_damage_plants / plants_inspected >= 0.20` at whorl stage, `>= 0.10` at seedling stage (thresholds configurable; defaults from regional FAW guidance, flagged as defaults to confirm with your agronomist). Action: release C-E1 spray task parameterised with the rotation register: the maize block has already had emamectin benzoate (IRAC group 6), so the template's rotation list offers the next mode of action (for example chlorantraniliprole, group 28, or spinetoram, group 5) and warns against repeating group 6. Guard: C-E1 will not release within the product's pre-harvest interval of any scheduled C-11 harvest on that block; it surfaces an owner decision instead. Cooldown: one spray cycle (7 days).

**T4 Poultry mortality.** Condition: P-05 mortality above 1% of house count in one day, or above 0.3% on 3 consecutive days. Action: release P-E2 (isolate, biosecurity, vet call) at P0, WhatsApp owner immediately. No cooldown; each firing matters.

**T5 Physics check, pump versus tank (detail in 5.4).** Condition: W-02 logged 4 or more pump hours in a window where W-01 readings imply added volume below 60% of `pump_hours * 6000` litres, allowing for logged irrigation draw. Action: release W-E2 borehole and pump fault inspection at P1 (possible causes ranked in the task instructions: leak, dropping yield, meter misread). Cooldown 48 hours.

**T6 Harvest shortfall.** Condition: C-01 bundle count below 80% of the trailing 7-day mean for 2 consecutive days. Action: owner exception in digest plus release a kale block inspection task with photo evidence. Catches pest, water stress or diversion early, whichever it is.

**T7 Condition score regression.** Condition: K-03 weekly median score falls 0.25 or more below the previous week, or any single animal scores 2.0 or below. Action: owner ration-review exception; single low animal also releases K-E1 individual check.

**T8 Input reorder.** Condition: inventory on hand below configured reorder point (poultry feed: 10 days of current consumption computed from P-01 entries; drip acid, sprays, diesel similarly). Action: release F-E1 purchase task assigned to the owner, with quantity suggestion. This is Herdwatch's derived-obligation pattern (R18, R26) generalised.

**Guards (blocking rules, evaluated at release and at done_reported):** a chemical application task cannot release if sprayer calibration A-04 is overdue; a harvest task cannot reach `done_reported` for a block inside an active pre-harvest interval; a milk or meat sale record for a treated animal inside its withdrawal window requires explicit owner override. Withdrawal and pre-harvest windows are computed automatically from the product recorded on the application or treatment event, Herdwatch-style (R26).

### 3.5 Irrigation planning (the S5 planner, worked)

Phase 1 method: **tank budget**, chosen over sensor-driven scheduling because it needs zero new hardware and every input already exists as a reading. Recommendation over the alternative (buy soil moisture probes now); strongest objection: the tank budget waters the average, not the actual root zone, and can overwater after cool days. Accepted until Phase 3, when one probe in the kale block reconciles the model, SWAN-style (R14).

Inputs: borehole delivery 6,000 litres per hour, observed daily pumping capacity roughly 36,000 litres; buffer = pool 45,000 litres plus `TANK_USABLE` after Phase 0. Demand model per block from crop and stand:

- Kale at target 10,000 plants, drip at 1 emitter of 2 litres per hour per plant, peak need 1.2 litres per plant per day: 12,000 litres per day; run time per shift = 1.2 / 2.0 = 0.6 hours, so 36 minutes per kale shift block.
- Tomato Rodade block (assume 2,500 plants at 1.6 litres): 4,000 litres per day.
- Onion Texas Grano (assume 30 m beds totalling 0.1 ha at 3 mm per day): 3,000 litres per day.
- Poultry at 1,000 layers: 300 litres per day. Cattle trough (assume 30 head at 40 litres): 1,200 litres per day, never cut.
- Maize and sorghum: rainfed, supplementary irrigation only under T2-inverse (14 dry days in season releases a supplementary shift decision to the owner).

Peak crop demand roughly 20,500 litres per day against 36,000 litres pumpable: feasible with 40% headroom, but only about 2 days of buffer autonomy if the borehole stops, which is why W-01 is P1 twice daily and T1 exists. The planner emits tomorrow's W-03 instances each evening: block, valve, start window, duration in minutes, expected litres. Each completed shift logs actuals; weekly variance between planned and physics-implied applied volume above 25% raises an owner exception (leak, valve error or misreporting).

The stand assumptions above are parameters, not facts: plant counts per block are maintained by C-06 and C-09 anchor events, so the planner always budgets from the real stand.

### 3.6 Release, the daily plan, and assignment

At 04:45 farm time the release engine materialises the day: evaluates S1 to S5 schedules and armed rules, applies guards and suppressions, and writes a **DailyPlan** of TaskInstances ordered by priority then time. The phone syncs the whole plan as one bundle (R20) on any connectivity, including the previous evening's WiFi or 2G window, so a signal-dead morning still has the full day cached, with instructions, photos and voice notes included in the bundle.

Assignment logic, sized to reality (one caretaker, seasonal labour without devices, one owner):

1. Default assignee is the caretaker for all W, C, K, P, A field tasks. Seasonal labourers appear as `helpers` on an instance (picked from a roster at completion, feeding F-02 wages), not as assignees; the caretaker's device is the single capture point.
2. F tasks split: F-01, F-02, F-03 caretaker; F-E1 purchases and all `needs_review` and `skip_pending` decisions route to the owner queue.
3. Reassignment is an owner action and appends a `reassigned` event; a second registered device (Phase 4, or a family member's WhatsApp as channel-only fallback) inherits by device registration, not by new user identity, so history stays continuous.

**Capacity and collision handling.** The plan computes `sum(est_minutes)` for interaction time and a rough field-labour load from template metadata. Rules when the day collides:

- P0 preempts everything; the plan re-orders immediately and pushes the change.
- P1 tasks never auto-defer. If P1 load alone exceeds the day, the plan flags an owner exception before 06:00 ("today cannot fit: choose") with a suggested cut list.
- P2 defers up to 2 days automatically, appending `deferred`; P3 defers up to 7 days.
- Starvation guard: any task with `deferral_count >= 3` escalates to the owner queue rather than deferring again.
- Collisions of same-asset tasks (filter flush scheduled while pump fault open): the repair task blocks the maintenance task via a `blocked_by` link; the blocked task shows as waiting, not missed.

**Time budget honesty:** every template's `est_minutes` counts phone interaction only, and the sum for a normal day (Section 2.1 set) is under 15 minutes. The one-minute-per-task requirement is enforced at design time: any template whose capture flow exceeds 60 seconds in field testing must be split or its evidence policy simplified. This is a hard acceptance criterion for the developer, not an aspiration.
---

## 4. Reminders, nudges and escalation

### 4.1 Channel stack, cheapest and most reliable first

1. **Cached local notifications.** The daily plan bundle carries every instance's reminder times, so the phone raises notifications from local data with zero connectivity. This is the primary reminder channel and it works in a dead zone.
2. **In-app plan screen.** The day view is the caretaker's home screen: cards ordered by time and priority, colour-coded state, unsynced counter always visible (R19).
3. **WhatsApp.** Server-initiated, so it needs the caretaker's phone to have data, but WhatsApp's own store-and-forward delivers late rather than never, and the habit already exists. Interaction design in 4.4.
4. **SMS.** Degraded mode only (R24): outbound nudge text when WhatsApp delivery fails for 12 hours or more. No inbound parsing in scope; SMS is a bell, not a channel.
5. **Voice call prompt.** The system never robocalls; it prompts the owner ("call now, task X is at stage red") because a call from the owner is the strongest social signal available and costs nothing to build.

### 4.2 The nudge and escalation ladder

Defined per **EscalationProfile**; defaults by priority below. All timers run server-side off the event log; local notifications mirror the early rungs from the cached plan. Two-stage persistence follows the Moocall cascade (R17).

| Rung | P0 | P1 | P2/P3 | Channel and action |
|------|----|----|-------|--------------------|
| Release | immediate push + WhatsApp | plan + local notification | plan | Task visible with due time |
| Pre-due nudge | n/a (due immediately) | 60 min before due: local notification | none | Phone only, no server needed |
| Overdue 1 | +15 min: WhatsApp to caretaker with 3 buttons | +2 h: local + WhatsApp buttons | end of day: rolls into tomorrow, missed_count += 1 | Buttons: Done, Problem, Skip |
| Overdue 2 | +30 min: WhatsApp utility template to owner, call prompt | +6 h: WhatsApp to owner (utility template if window closed) | second miss: owner digest exception line | Owner sees the same card and evidence state |
| Overdue 3 | +60 min: repeated owner alert + marked `missed`, stays top of every view | grace end (due day 20:00): `missed`, rolls, missed_count += 1 | third miss: task auto-escalates to owner queue as a decision (reassign, cancel, or convert to project) | Nothing silently disappears |

**Missed once:** the instance transitions to `missed` at grace end, rolls to the top of the next plan with a "yesterday" badge, `missed_count = 1`. No owner noise for P2/P3; the digest shows it in the completion percentage only.

**Missed twice (same template, consecutive periods):** named exception line in the owner's digest ("K-03 body scoring missed twice running") plus a WhatsApp utility template to the caretaker referencing the specific task, not a generic scold. For P1: also an owner alert at the second miss, immediately, not in the digest.

**Missed during owner absence:** the owner sets **absence mode** (dates plus optional deputy contact). While active: escalation rungs that would reach the owner go to the deputy if configured; the daily digest keeps sending (it is the owner's remote window, absence or not); P0 rungs always reach the owner regardless of absence; and auto-approval widens slightly so the farm does not stall: `skip_pending` older than 48 hours with a valid reason code auto-approves and is flagged for post-absence review, and `needs_review` items older than 72 hours auto-close as `verified_closed` with `verification.method = "deferred_owner_audit"` and land in a catch-up queue the owner clears on return. Recommendation: allow that auto-close; strongest objection: it briefly weakens the verification gate, which is why every auto-closed item stays flagged until a human actually looks at it.

### 4.3 Anti-nag design

Escalation systems die by crying wolf. Three protections: reminders collapse (one WhatsApp message lists all currently-overdue tasks rather than one message each); honest reporting is always cheaper than silence (Skip with a reason never escalates as hard as a silent miss, and the reason list includes "no water", "no input in stock", "rain", "sick", "other"); and repeated on-time completion earns quieter settings (after 14 consecutive on-time days for a template, its pre-due nudge switches off automatically, and switches back on after any miss).

### 4.4 WhatsApp as fallback channel, concrete flows

Channel roles: the app is for capture, WhatsApp is for nudge, confirm and emergency capture. Mechanics from Section 1.7.

- **Morning summary (06:00).** If the 24-hour window is open (it almost always will be, see below): free service message. If closed: one utility template, "Plan for {{date}}: {{n}} tasks, first: {{task}} at {{time}}", with a Start button whose tap re-opens the window for the day. Cost at Sub-Saharan utility rates: a few cents on the rare cold-start day, effectively zero otherwise.
- **Overdue nudge.** Interactive message, task title plus three reply buttons: **Done**, **Problem**, **Skip**. A Done tap appends `done_reported` with `actor_type = whatsapp` and immediately prompts "send the photo here". The inbound photo arrives by webhook media ID; the server fetches and stores it within the URL's five-minute validity, attaches it as evidence, and the task proceeds through the normal verification gate. A Problem tap prompts for a voice note (E5), which is stored and queued for the owner.
- **Evidence by chat, generally.** Any inbound photo or voice note while exactly one task for that subject is open attaches automatically; otherwise the bot asks "which task is this for?" with a list message (up to 10 rows). This keeps WhatsApp usable as the complete degraded-mode client if the app is broken or the phone is replaced mid-week.
- **Owner side.** P0 and P1 escalations arrive as utility templates with Approve or Reject buttons where a decision is pending (`skip_pending`, `needs_review`), so the owner can govern the farm from WhatsApp alone when travelling.
- **Window economics.** The caretaker's morning Start tap plus routine traffic keeps the service window rolling; the design goal is that paid templates fire only on cold starts and owner escalations. Budget line regardless: assume up to 60 utility templates per month, still under 3 dollars.

### 4.5 The dark-farm detector and the owner digest

**Dark-farm rule (T9).** Condition: no sync, no WhatsApp inbound, and no SMS delivery receipt from the caretaker's number for 24 hours. Action: owner alert "farm dark since {{time}}: last event was {{event}}", plus the pre-agreed out-of-band checklist (call caretaker, call neighbour contact). Covers the broken phone, exhausted data bundle, theft, and the caretaker walking off, without diagnosing which; the owner learns within a day, not a fortnight. This rule is the direct answer to "how do I know when the system itself has failed".

**Owner daily digest (19:00, WhatsApp plus in-app page).** Exceptions before activity (R31): completion line (12 of 14 verified, 1 skipped approved, 1 missed), water line (tank percent trend, litres pumped versus plan), money line (bundles sold, cash recorded, variance), then named exceptions needing decisions, each one tap away. Weekly (Sunday) adds trends: kale bundles 7-day mean, BCS trajectory against the 90-day target, poultry mortality and lay rate, PM compliance. Monthly F-04 compiles the KPI set of Section 9.2.

---

## 5. Logging and evidence layer

### 5.1 Evidence classes and per-task policy

Every template declares an `evidence_policy` choosing from six classes. Policy is enforced on-device before `done_reported` is accepted (the button stays disabled until the policy is satisfiable from what has been captured), which is the MaintainX required-field pattern (R25) moved client-side so it works offline.

| Class | Content | Capture cost | Used for |
|-------|---------|-------------|----------|
| E0 | Tap only; identity, time and cached GPS attach automatically | 5 seconds | Low-stakes routine (water check, afternoon feed); kept honest by random audit sampling: 1 in 7 instances silently upgrades to E2 at release |
| E1 | Structured fields (numbers, choices) defined by the template | 15 to 30 seconds | Readings, counts, quantities, forms |
| E2 | 1 to 3 photos, compressed, stamped | 20 seconds | Visual proof of state or action |
| E3 | Before and after photo pair; the "before" is prompted at task start | 30 seconds | Cleaning, repairs, filter service, land preparation |
| E4 | Video 10 to 20 seconds, 480p | 40 seconds | Moving evidence: pump running, animal gait, tank walk-around |
| E5 | Voice note up to 60 seconds | 20 seconds | Literacy-tolerant descriptions, problem reports; transcribed server-side when capacity allows |

Cross-cutting capture rules: every media item is stamped in-image (overlay burned onto the JPEG: task code, date-time, GPS if available) and in-metadata (EXIF plus payload); geofence check flags media captured outside the farm polygon; a perceptual hash (pHash) of every image is compared against the last 60 days to catch re-submitted photos, with matches routing the task to `needs_review` rather than auto-rejecting (sun, angle and mud make false positives real). Photos cap at 3 per event (R28). Chemical and medicine tasks additionally require the product's batch number as an E1 field and a photo of the label or container (R26, R27), which is what makes withdrawal and pre-harvest guards computable.

### 5.2 Sub-minute capture flows, specified

The developer builds exactly these flows; each has a stopwatch budget tested on the actual handset class (entry-level Android, one hand, sunlight):

- **W-01 tank reading (budget 40 s):** card tap, number pad pre-focused, type 62, camera opens on gauge framing guide, one photo, submit. Two fields max on any E1 form screen; anything longer becomes a checklist task with per-step capture.
- **C-01 harvest count (budget 45 s):** card tap, count pad, photo of the bundle stack against the tally board (a painted board with the date chalked on, giving VIM a scale and scene anchor), submit.
- **C-E1 spray (budget 60 s, the heaviest flow):** product picker (from inventory, one tap), batch number field (numeric, or photo of label in lieu), rate pre-filled from template (edit only on deviation), block confirm, nozzle photo, submit.
- Every flow ends on the same state: card flips to "reported, will sync", outbox counter increments. No flow contains free-text as a required field; free text and voice are always optional additions.

### 5.3 Offline capture and the two queues

Following ODK and CommCare (R22): capture is complete the moment the caretaker submits, regardless of signal.

- **Event queue:** TaskEvents as JSON, hundreds of bytes each, sent on any bearer including EDGE, batched, idempotent by `event_uuid`, FIFO with retry and exponential backoff. Media are referenced by `media_uuid` before they upload, so records are complete and verifiable-pending-media immediately.
- **Media queue:** compressed blobs (photo target 150 to 250 KB at 1280 px; video 480p, 20 s cap, roughly 2 to 4 MB; voice Opus, about 100 KB). Upload policy configurable: immediately on WiFi, on mobile data only between 19:00 and 06:00 (off-peak bundles) or when the item is attached to a P0 or P1 task, which jumps the queue. Uploads are resumable (offset-based chunks) because a 2 MB video on a flaky EDGE cell will otherwise never complete.
- **Storage budget:** local queue caps at 500 MB; at 80% the app warns and stops accepting E4 video (photo evidence substitutes) rather than failing silently.
- Verification (5.5) tolerates pending media: a task can sit at `done_reported` awaiting its blob; escalation timers for the *caretaker* stop at `done_reported`, so slow uplink never punishes the person who did the work.

### 5.4 Physics checks: verification without cameras

Cheap cross-checks over readings, the WiseConn zero-flow idea (R15) rebuilt on manual data:

- **Water balance:** `tank_delta` between W-01 readings should approximate `pump_hours * 6000` minus logged irrigation litres minus stock water. Persistent deficit beyond tolerance fires T5 (pump or leak); surplus fires a meter or reading audit nudge.
- **Feed balance:** poultry feed stock (P-07 weekly count) should fall by the daily P-01 consumption sum within 10%; drift flags diversion or misrecording, routed as a quiet owner exception, not an accusation.
- **Harvest sanity:** C-01 counts against active mature bed count give bundles per bed; outliers beyond 2 sigma route that day's evidence to `needs_review`.
- **Timing sanity:** event `device_time` versus card render time; a task reported done 90 seconds after the plan syncs, for work that takes an hour, routes to review. Device clock skew is measured at every sync handshake and stored per event, so honest clock drift does not read as fraud.

### 5.5 Video Intelligence Module as automatic verifier

VIM v1.1 today analyses field video as a standalone feature. It becomes the verification stage of the task pipeline: **every evidence media item is a VIM job with task context attached.**

Contract (server-side queue, media-triggered):

```
vim_job {
  media_uuid, instance_id,
  profile: text,        -- from template evidence_policy.vim_profile
  context: {task_code, subject, expected: {...}}   -- e.g. {min_bundles: 40} from params
}
vim_verdict {
  media_uuid, instance_id,
  verdict: enum(pass, fail, unusable, uncertain),
  confidence: float,
  extracted: jsonb,     -- profile-specific: counts, readings, flags
  model_version: text
}
```

Verification profiles, matched to the taxonomy (each is a scoped classification or counting job, not open-ended understanding):

| Profile | Checks | Feeds |
|---------|--------|-------|
| `tank_gauge` | Gauge or dipstick visible; reads level; compares to the E1 field within tolerance | W-01: mismatch beyond 10 points routes to review |
| `bundle_count` | Counts kale bundles against tally board; scene freshness (chalked date legible) | C-01: count reconciles the E1 number; extracted count is the KPI input when confidence is high |
| `wet_line` | Wet soil strip along drip lateral visible | W-03 shift proof |
| `trough_feed` | Feed present in trough, cattle present, approximate head count | K-01; head count trend cross-checks herd records |
| `chick_spread` | Chick distribution pattern under brooder (huddled = cold, dispersed to edge = hot, even = right) | P-03: bad spread pattern fires an immediate corrective nudge even though the task was done |
| `bcs_assist` | Side-on cattle photo quality gate plus a coarse condition estimate | K-03: flags disagreement with caretaker score beyond 0.5 for owner review; the caretaker's score remains the record (VIM assists, never overrules silently) |
| `spray_scene` | Sprayer present, crop block matches subject, nozzle output visible | C-E1, C-07 |
| `repair_pair` | Before and after differ materially in the defect region | E3 tasks |
| `leak_scan` | Wet ground or drip trails on tank walk-around video | A-05 |

Thresholds and routing (stated in 3.2 guards): confidence at or above 0.80 with verdict pass gives `auto_verified`; 0.50 to 0.79 or any physics-check disagreement gives `needs_review` with the VIM extract shown beside the caretaker's claim so the owner adjudicates in one glance; below 0.50 or verdict unusable (dark, blurred, wrong subject) sends a **retake request** to the caretaker as a nudge with the reason ("too dark, stand back two steps"), one retake before routing to review. Verdict fail routes to review, never to automatic rejection: the human always makes the negative call.

Cost and capacity controls: VIM runs on E2 and E3 photos for all P0 and P1 tasks; for P2 and P3 it samples 1 in 3 plus every physics-flagged item; E4 video processes at P0/P1 always, else daily batch. Every verdict is logged with `model_version`, so verification quality is itself auditable, and a weekly `vim_agreement` KPI (VIM versus owner decisions on reviewed items) tells you when to retrain or retire a profile.

VIM unavailable (service down, backlog beyond 12 hours): tasks flow to `needs_review` with sampling (owner reviews 1 in 5, the rest auto-close flagged `verification.method = "vim_outage_sample"`). The farm never stalls on the verifier.
---

## 6. Data model additions and endpoint contracts

### 6.1 Schema additions (PostgreSQL, matching the existing Node and Express plus PostgreSQL plus Redis stack)

Core tables, with only non-obvious columns annotated. All tables carry `id uuid primary key`, `created_at`, `updated_at` unless noted.

```sql
-- Reference layer
assets            (code text unique, name, kind check in ('pump','borehole','tank','pool',
                   'drip_block','sprayer','generator','coop','kraal','fence_section','vehicle','tool'),
                   parent_id uuid, meters jsonb, criticality check in ('P0','P1','P2'),
                   status check in ('active','archived'))           -- farmOS asset pattern (R1)
locations         (code, name, kind check in ('block','bed','paddock','house','store','zone'),
                   geom geography null, parent_id uuid, plant_count int null, crop text null)
herds             (name, species, head_count int)                    -- head_count maintained by events
animals           (tag text unique, herd_id, sex, birth_date, status, notes)  -- individual layer, used
                                                                     -- for K-03 sampled animals and K-E1
batches           (species default 'poultry', house_location_id, placed_on date,
                   placed_count int, current_count int, stage text)  -- anchor entity for S4 chains
inventory_items   (name, unit, category check in ('feed','chemical','vaccine','fuel','spare','seed'),
                   on_hand numeric, reorder_point numeric, reorder_qty numeric,
                   withdrawal_days int null, phi_days int null, irac_group text null)
inventory_moves   (item_id, qty numeric, direction check in ('in','out','adjust'),
                   source_event_uuid uuid null, unit_cost numeric null)  -- written by fold from task events

-- Task engine
task_templates    (as specified in 3.1; schedule jsonb, guards jsonb, evidence_policy jsonb,
                   escalation_profile text, version int)
task_instances    (as specified in 3.1; unique (template_id, period_key, subject_id))
task_events       (event_uuid uuid primary key, instance_id uuid null,  -- null allows farm-level events
                   actor_type, actor_id, type, payload jsonb,
                   device_time timestamptz, server_time timestamptz default now(),
                   device_id uuid)                                   -- append-only: no UPDATE, no DELETE;
                                                                     -- enforced by trigger
readings          (metric text, value numeric, unit text, subject_type, subject_id,
                   taken_at timestamptz, source_event_uuid uuid, device_id uuid)
                                                                     -- projection of E1 fields worth querying:
                                                                     -- tank_level_pct, pump_hours, rain_mm,
                                                                     -- bundle_count, mortality, bcs, egg_count
rules             (as specified in 3.4; last_fired_at timestamptz)
escalation_profiles (name text unique, rungs jsonb)
daily_plans       (plan_date date unique, generated_at, instance_ids uuid[], capacity_note jsonb)

-- Evidence and verification
media_objects     (media_uuid uuid primary key, instance_id, event_uuid, kind check in
                   ('photo','video','audio'), status check in ('pending_upload','stored','failed'),
                   storage_key text null, bytes int, sha256 text, phash text null,
                   exif jsonb, gps geography null, captured_at timestamptz, device_id uuid)
vim_jobs          (media_uuid, instance_id, profile text, context jsonb,
                   status check in ('queued','running','done','failed'), attempts int)
vim_verdicts      (media_uuid, instance_id, verdict, confidence numeric, extracted jsonb,
                   model_version text, decided_at timestamptz)

-- Channels and devices
devices           (user_id, platform, registered_at, last_sync_at, last_seen_event_uuid uuid,
                   push_token text null, revoked bool default false)
wa_contacts       (user_id, wa_phone text unique, window_open_until timestamptz null)
wa_messages       (direction check in ('in','out'), wa_message_id text unique, contact_id,
                   template_name text null, payload jsonb, status text,   -- sent/delivered/read/failed
                   related_instance_id uuid null)
notifications_log (channel check in ('push','whatsapp','sms','digest'), rung text,
                   instance_id uuid null, sent_at, delivered_at null)
```

Fold discipline: `task_instances`, `readings`, `inventory_moves`, `herds.head_count`, `batches.current_count` are projections rebuilt deterministically from `task_events`; a `rebuild_projections(from_ts)` job exists from day one and doubles as the disaster-recovery path.

### 6.2 Endpoint contracts

Conventions follow the existing route style (Express routers, JWT auth middleware, role checks). New surface:

```
POST /api/sync/events
  Body: { device_id, events: [ {event_uuid, instance_id, type, payload, device_time}, ... ] }
  200:  { accepted: [event_uuid], duplicates: [event_uuid], rejected: [{event_uuid, reason}],
          server_events: [...], cursor }        -- one round trip both directions
  Semantics: idempotent on event_uuid; duplicates are success, not error. rejected is reserved
  for malformed payloads only; semantic conflicts are folded, never bounced back to the phone.
  Handshake includes device clock sample for skew logging (5.4).

GET  /api/sync/bundle?cursor=...
  200: { plan: DailyPlan+instances, templates_delta, reference_delta (assets, locations,
         batches, inventory levels), instructions_media: [urls], cursor }
  The whole next-day pack in one cacheable response (R20).

POST /api/media/initiate        { media_uuid, instance_id, kind, bytes, sha256 }
      -> { upload_url | upload_id, chunk_size }
PATCH /api/media/:upload_id     (offset-based chunk; resumable; 308 on partial)
POST /api/media/:upload_id/complete  -> triggers vim_job creation server-side

GET  /api/plan/today            (owner and caretaker views differ by role)
GET  /api/instances/:id         (full event history + evidence + verdicts)
POST /api/instances/:id/decision   { action: verify|reject|approve_skip|deny_skip|cancel|reassign,
                                     note }        -- owner only; appends the matching event
POST /api/templates  /api/templates/:id            -- owner CRUD, versioned
POST /api/rules      /api/rules/:id/toggle          -- owner CRUD

GET  /api/owner/digest?date=    { completion, water, money, exceptions[], trends{} }
GET  /api/kpis?period=          (Section 9.2 set, computed server-side)

POST /api/webhooks/whatsapp     (Meta webhook: messages, statuses; idempotent on wa_message_id;
                                 verifies signature; media fetched within URL validity and
                                 written to media_objects + task_events)
POST /api/webhooks/vim          { media_uuid, verdict, confidence, extracted, model_version }
                                 (or internal queue consumer if VIM runs in-process; contract identical)

POST /api/devices/register      { platform, push_token } -> { device_id }
POST /api/devices/:id/restore   -> full state bundle for a replacement phone (R23):
                                 open instances, 30 days of history, templates, reference data
POST /api/devices/:id/revoke    (owner; lost or stolen phone)
```

### 6.3 Sync and identity rules

- The phone holds: the current plan, open instances, 30 days of closed history, all active templates and reference data, its outbox. Everything else is server-only.
- Auth: existing JWT, plus `device_id` bound at registration; events are attributed to user and device. Token expiry never blocks capture: events queue locally and the app re-authenticates on next connectivity (a 401 on sync pauses the drain, it does not drop it).
- Restore: new handset, same SIM or number, owner approves the registration, `/restore` rebuilds the working set in one download. Target: caretaker productive within 30 minutes of unboxing.

---

## 7. Integration split: version 1.2 app and version 2.0 backend

Grounding and honesty: the repository available to this design session (`mfd-14/train`) contains a Node and Express plus PostgreSQL plus Redis backend and a React PWA frontend (Vite, Zustand, Workbox service worker) with a generic task, submission and review flow. The Farm Manager v1.2 build, the Video Intelligence Module v1.1 code and the backend architecture specification v2.0 are not in that repository, so the split below states its assumption plainly: **assumed stack parity with the repository** (Node, Express, PostgreSQL, Redis, React PWA). Every contract above is deliberately stack-neutral REST plus SQL, so a mismatch moves work between columns below; it does not invalidate the design.

### 7.1 Drops into v1.2 and the v2.0 backend as they stand

| Piece | Why it drops in |
|-------|-----------------|
| Schema additions 6.1 | Additive tables; no existing table is altered. The existing users and roles carry over; caretaker and owner map to existing role checks |
| Template, instance and decision routes | New Express routers behind existing auth middleware, same validation pattern as current routes |
| Release engine and escalation timers | A scheduled job (node-cron or a Redis-backed queue like BullMQ, which the existing Redis supports) evaluating schedules and rules; no architectural novelty |
| Owner digest and KPI queries | Read-only SQL over the new tables |
| PWA day-view, capture flows, local notifications | New screens in the existing React PWA; Workbox is already present for asset caching |
| WhatsApp gateway | Self-contained webhook route plus an outbound sender worker; touches nothing else |
| Rule engine v1 | Condition expressions over readings and events, evaluated in the release job; a few hundred lines, not a platform |

### 7.2 Requires architecture change, each specified

1. **Client persistence and outbox.** A standard PWA caches assets, not intent. Required change: IndexedDB store on the phone with three object stores (plan, outbox_events, outbox_media), a Workbox Background Sync or custom drain loop, and capture screens that write locally first and never block on network. This is client architecture, not a feature, and it is the largest single piece of new work.
2. **Append-only event ingestion and fold.** If v2.0 endpoints mutate rows CRUD-style, add the `/api/sync/events` ingestion path plus fold workers that update projections. Existing CRUD stays for owner and admin surfaces; the caretaker path becomes event-only. Concretely: one ingestion route, one fold module with per-event-type handlers, the no-update trigger on `task_events`, and the `rebuild_projections` job.
3. **Resumable media pipeline.** Multipart-only upload endpoints will not survive EDGE. Required: the initiate, chunk, complete flow of 6.2 (tus protocol or equivalent), object storage rather than database blobs, and server-side compression validation.
4. **VIM from feature to worker.** VIM v1.1 as a user-invoked analysis feature must additionally run headless: consume `vim_jobs` from a Redis queue, load the profile, emit a verdict to the callback contract, and carry `model_version`. If VIM currently only accepts long-form video, the profiles in 5.5 need stills support (photo inference), which is a model-serving change, not a data-model change.
5. **Scheduler reliability.** Release, escalation and dark-farm timers must fire even when no request traffic arrives. If v2.0 hosting is serverless or request-driven only, add a worker dyno, a cron container, or an external scheduler hitting an internal endpoint. The design assumes one always-on worker process.
6. **Push notifications.** Web Push via FCM for the PWA on Android Chrome; requires service worker push handlers and key management. If v1.2 is a wrapped APK, native FCM instead. Either way this is a new subsystem; local notifications from the cached plan (4.1) reduce it to a nice-to-have rather than a dependency.

### 7.3 Sections of the v2.0 architecture specification I need pasted

To finalise the contracts I need exactly these, quoted as written:

1. **The API surface and database schema sections** (whatever v2.0 calls its endpoint list and entity or table definitions), so 6.1 and 6.2 land as deltas against reality rather than assumptions.
2. **Any section on mobile data persistence, caching or synchronisation**, if one exists, to reconcile with 7.2 item 1 and 2.
3. **The VIM interface**: how v1.1 is invoked today (endpoint, queue or in-process call), its input format (file, URL, stream; video only or stills), and its output schema, to finalise 5.5's job and verdict contracts and size the stills-support gap.
4. **The infrastructure and deployment section**: where the backend runs, whether a job scheduler, queue worker or cron facility already exists, and where media files are stored today, to settle 7.2 items 3 and 5.
5. **The authentication and roles section**: token lifetimes and the role model, to confirm the caretaker device binding in 6.3 needs no auth redesign.

Nothing else in the v2.0 document is needed for this layer.
---

## 8. Phased rollout, sequenced against Phase 0 and the July 2026 to June 2027 scaling plan

Principle: **log before you automate, automate before you enforce.** Each phase has a gate; the next phase does not start until the gate holds for two consecutive weeks, because a reminder system that fires on bad data teaches everyone to ignore it.

**Sprint 0: Foundations (August 2026, 2 to 3 weeks of build).**
Readings capture (W-01, W-02, rain), E1 and E2 evidence flows, the outbox, the owner WhatsApp daily digest in read-only form, and a manually curated task list. No engine, no escalation. Deliberately thin so the caretaker's habit forms on five easy wins a day.
Run the **Phase 0 tank rehabilitation itself as the first tracked project**: scope checklist as task instances, E3 before and after photos per work item, A-05 baseline walk-around video on completion (this baseline is what `leak_scan` compares against for the life of the tank), and the measured `TANK_USABLE` volume entered as the T1 parameter. The rehab proves the evidence loop on a project the owner is already watching closely.
Gate: 10 consecutive days with W-01 twice daily and C-01 daily captured, sync median under 12 hours.

**Phase R1: Task engine core (September to October 2026).**
Templates, instances, state machine, S1 and S2 schedules, the 04:45 release engine, daily plan bundle, escalation rungs through "missed once", owner decision queue, digest v2 (exceptions first). Load the full Section 2 taxonomy but enforce evidence policies on P0 and P1 only. Start the cattle 90-day programme chain and the kale succession chains in-system as beds transplant toward the 10,000-plant target. September also fires K-05 vaccination (pre-rains) as the first seasonal instance.
Gate: on-time verified completion of P1 tasks at or above 80%; caretaker median capture time per task under 60 seconds measured from event timestamps.

**Phase R2: Triggers, guards and channels (November 2026 to January 2027).**
Rules T1 to T9 armed (T1 with the real `TANK_USABLE`), anchor chains for poultry batches and summer cropping (C-09 planting anchors with the November rains), PHI and withdrawal and calibration guards, inventory ledger with T8 reorders, WhatsApp interactive buttons and evidence-by-chat, physics checks v1 (water balance, feed balance). This phase lands exactly when the farm needs it: rainy-season dipping cadence switches on, and November to February is peak fall armyworm pressure for T3.
Gate: two trigger firings handled end to end (released, executed, verified) without owner intervention; zero duplicate instances from release idempotency.

**Phase R3: Machine verification (February to April 2027).**
VIM profiles deployed in shadow mode for four weeks (verdicts logged, not enforced), then enforcing per the 5.5 thresholds; resumable media pipeline hardened; retake-request flow; KPI dashboard live; first phone-restore drill executed deliberately on a spare handset.
Gate: VIM agreement with owner decisions at or above 85% on the shadow sample; auto-verification covering at least 60% of evidence-bearing closures.

**Phase R4: Scale and resilience (May to June 2027).**
Poultry cadence at 1,000-plus layers (P-04 volumes, feed logistics via T8), second registered device (senior seasonal hand or deputy), absence-mode drill during a real owner trip, threshold review across a full season of data, and the documented handover pack test: a stand-in runs the farm from the system for three days (see 9.3, caretaker departure).
Gate: the June 2027 month-end pack (F-04) produced entirely from system data with no manual reconstruction; that pack is the scaling plan's year-one evidence base.

Dependencies respected: T1 waits for Phase 0's measured volume; VIM enforcement waits for the media pipeline; escalation beyond "missed once" waits until release data is trustworthy (R1 gate).

---

## 9. Governance: RACI, KPIs and failure modes

### 9.1 RACI

R executes, A owns the outcome and the decision, C is consulted before, I is informed after. "System" appears where automation acts.

| Process | Owner | Caretaker | Seasonal labour | System |
|---------|-------|-----------|-----------------|--------|
| Daily plan execution and evidence capture | A, I (digest) | R | supports under caretaker | releases, reminds |
| Irrigation plan and water allocation under scarcity (T1) | A (protocol pre-agreed) | R | R (shift labour) | computes plan, fires protocol |
| Chemical and spray decisions (product, rate, timing) | A, C (agronomist where needed) | R (application) | R (labour, never mixing) | enforces guards, logs |
| Livestock treatment and sick-animal response | A | R (first response per K-E1) | I | routes evidence, withdrawal guard |
| Poultry batch lifecycle and vaccination | A (programme), C (vet) | R | supports | releases chain by batch age |
| Sales, cash and reconciliation | A | R (record at sale) | I | variance exception (F-01) |
| Input purchasing and stock | A, R (purchase) | R (receive, count, F-E1 confirm) | I | T8 reorder proposals |
| Asset maintenance and repairs | A (spend approval above float) | R | supports | meter schedules, physics checks |
| Wages and attendance (F-02) | A (approve) | R (record) | C (their own days) | assembles sheet |
| Task verification and skip or review decisions | A, R (decisions) | I (outcomes) | n/a | auto-verifies within thresholds |
| Template, rule and threshold changes | A, R | C (feasibility) | n/a | versions everything |
| System administration, devices, WhatsApp numbers | A, R | I | n/a | dark-farm watchdog |

Two RACI rules that prevent quiet failure: the caretaker is never Accountable for a decision the owner has reserved (spend, chemicals, culls), so an unanswered decision escalates rather than defaulting onto the caretaker; and seasonal labour never captures evidence directly, keeping one identity per event trustworthy.

### 9.2 KPIs the system must surface

Computed server-side from events and readings; shown on the owner dashboard, the weekly digest and F-04. Targets are starting points, reviewed at R4.

| KPI | Definition | Target |
|-----|------------|--------|
| On-time verified completion, P0 and P1 | verified_closed by grace_until over released, weekly | at or above 90% |
| Overall completion including approved skips | terminal-positive states over released | at or above 85% |
| Auto-verification rate | auto_verified over evidence-bearing closures | at or above 60% rising to 75% |
| Evidence integrity flags | pHash, geofence or timing flags per week | trending to zero; any flag reviewed |
| Median sync latency | server_time minus device_time, weekly median | under 6 hours |
| Kale output | bundles per day, 7-day mean, versus plan curve toward 330 to 400 | on plan |
| Revenue recorded | C-02 sum per month versus the 10,000 to 12,000 dollar target | on plan |
| Cash variance | F-01 absolute variance per week | under 5 dollars |
| Water pumped versus plan | sum W-02 hours times 6,000 litres versus planner demand | 90 to 110% |
| Water productivity | litres per kale bundle, monthly | declining trend |
| Irrigation adherence | W-03 shifts verified over planned | at or above 95% |
| Cattle condition | median BCS versus the 2.5 to 3.0 ninety-day trajectory | on or above trajectory |
| Poultry mortality | weekly percent per house | under 0.5%, P-E2 threshold apart |
| Lay rate (from first batch maturity) | eggs over hen-days | at or above 70% rising with flock age |
| Feed efficiency | grams feed per bird per day versus breed standard | within 10% |
| PM compliance (assets) | meter and calendar services closed on time | at or above 90% |
| Escalations reaching owner | count per week by rung | declining after R2 |
| VIM agreement | VIM verdict matching owner decision on reviewed items | at or above 85% |
| Dark-farm incidents | T9 firings per quarter | zero |

### 9.3 Failure-mode register

| Failure | Detection | Mitigation, in order |
|---------|-----------|----------------------|
| Caretaker phone broken or lost | T9 dark-farm within 24 h; caretaker calls in | Pre-agreed fallback: WhatsApp from a family member's or neighbour's phone is accepted as channel-only evidence against named tasks (bot matches by phone allow-list); paper day-card (one laminated sheet mirroring the daily plan skeleton) covers capture for up to 72 h with back-entry marked `corrected`; replacement handset restored via /restore in under 30 minutes; owner revokes old device. Budget line: one spare entry-level handset kept charged on site from R2 |
| Data bundle exhausted | Sync latency KPI degrades; T9 if fully dark | Data is a farm input, not the caretaker's personal cost: monthly bundle purchased by owner as a standing F-E1 task with T8-style reminder; outbox tolerates 72 h dark by design; SMS bell still reaches the phone; media queue defers, events (tiny) send on residual airtime |
| Caretaker leaves or is incapacitated | Notice, or T9 plus owner call | The system is the SOP: every template carries instructions with photos and voice notes, so a literate stand-in executes from the plan alone (drilled at R4); owner switches assignee to the stand-in's registered device; no knowledge lives only in a person; wages, stock and cash states are current to the last sync, cutting dispute surface |
| Evidence gaming (staged or reused photos, invented readings) | pHash matches, geofence flags, timing sanity, physics checks, VIM mismatches, random E0 upgrades | Route to needs_review, never auto-accuse; owner sees claim and evidence side by side; pattern over weeks is a management conversation backed by an audit trail; design keeps honesty cheaper than fraud (Skip is one tap) |
| WhatsApp template paused or number restricted | Template status webhook; delivery failures | Operational templates kept utility-category and genuinely informative (1.7); pre-approved backup template variants; SMS bell as bridge; the app remains fully functional without WhatsApp |
| VIM outage or backlog | Queue depth alarm, 12 h threshold | Sampled human review fallback (5.5); no task blocks on the verifier; verdict backfill when service returns |
| Borehole or pump failure | T5 physics check, W-E2, or caretaker P0 report | W-E1 rationing protocol pre-agreed (kale first, stock water exempt); pool buffer covers about 2 days at reduced demand; repair as P0 with parts list from asset record; supplier contacts stored on the asset |
| Extended power outage (ZESA) | W-02 gaps, pumped volume KPI | Pumping windows already sized at about 6 h per day of the 24 h borehole capacity, leaving catch-up headroom; generator run task chain exists (A meter schedule); T1 protects the buffer |
| Server or backend down | Phone outbox grows; owner dashboard stale; uptime monitor | Phone is fully functional offline for 72 h or more by design; events replay idempotently on recovery; rebuild_projections restores state from the log; nightly off-site database backup is a stated infrastructure requirement (7.3 item 4 confirms where) |
| Owner unreachable (illness, travel without absence mode) | Decision queue ages | 48 h and 72 h auto-actions from 4.2 absence handling apply globally as defaults after 96 h of owner silence, flagged for later audit; P0 rungs also route to the deputy contact if one is configured |
| Theft or SIM swap on the caretaker number | Unusual location on events, T9, or report | Device revocation kills sync and push; WhatsApp allow-list is per number and owner-managed; JWT plus device binding means a stolen SIM alone cannot write events |
| Seasonal labour surge overwhelms capture | Capacity flag at release (3.6) | Helpers roster keeps capture on one device; if interaction load exceeds 20 min per day the plan flags template consolidation to the owner; second device is the R4 relief valve |

---

## 10. Conformance check against the brief

| Brief requirement | Where met |
|-------------------|-----------|
| Research across livestock, crop, irrigation and CMMS platforms, with named products, adopted mechanics, and confirmed versus inferred marked | Section 1 (R1 to R33, WhatsApp mechanics 1.7, white-space findings called out) |
| 1. Canonical taxonomy with actual recurring tasks across water, crops, cattle, poultry, infrastructure; daily, weekly, seasonal, event-triggered, asset maintenance | Section 2 (53 coded tasks plus the poultry batch and cattle rehabilitation lifecycle chains, no placeholders) |
| 2. Task engine: object and data model, full state machine, scheduling and trigger rules with worked farm examples, assignment, priority collisions | Section 3 (3.1 to 3.6; worked examples: kale succession, poultry batch, pump meter, T1 to T8 arithmetic, irrigation planner with real litres) |
| 3. Reminder, nudge, escalation; missed once, twice, during absence; WhatsApp as fallback | Section 4 (ladder 4.2, absence mode, anti-nag 4.3, WhatsApp flows 4.4, dark-farm 4.5) |
| 4. Evidence layer: proof per task type, offline photo, video and voice, VIM as automatic verifier | Section 5 (classes 5.1, sub-minute flows 5.2, two queues 5.3, physics checks 5.4, VIM contract, profiles, thresholds and fallbacks 5.5) |
| 5. Data model additions and endpoint contracts | Section 6 (DDL 6.1, contracts 6.2, sync and identity 6.3) |
| 6. Integration split with each required change specified | Section 7 (drop-ins 7.1, six specified changes 7.2, exact v2.0 sections requested 7.3) |
| 7. Phased rollout against Phase 0 and July 2026 to June 2027 | Section 8 (five phases, gates, seasonal alignment) |
| 8. RACI, KPIs, failure register including phone, data and caretaker departure | Section 9 (9.1, 9.2, 9.3) |
| Offline-functional, under one minute per task, remotely verifiable evidence | 5.2 stopwatch budgets and the 3.6 acceptance criterion; 5.3 offline queues; 5.5 plus 4.5 remote verification |
| Bottom line first; recommendations with strongest objection, not menus | Section 0; objections given at 0, 3.5, 4.2 |
| Specification depth without application code | Data models, state machine, rule definitions, contracts; no application code |
| British English, no em dashes | Applied throughout |

Open items requiring your input, consolidated: the five v2.0 specification sections listed in 7.3; confirmation of the poultry vaccination template against your hatchery and vet (2.5); FAW thresholds and rotation products against your agronomist (T3); herd head count and per-block stand counts as planner parameters (3.5); and the measured `TANK_USABLE` volume when Phase 0 completes (T1).
