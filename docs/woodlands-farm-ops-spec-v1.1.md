# Woodlands Farm Manager: Systems and Processes Layer Specification

**Document:** WFM-OPS-SPEC v1.1 (supersedes v1.0 of 2 August 2026)
**Date:** 26 October 2026
**Status:** As built in this repository, with the owner decisions of October 2026 applied
**Scope:** Operations taxonomy, task engine, escalation and WhatsApp, evidence and acceptance, data model and endpoints, integration split, rollout, governance, and a feature audit against the farm brief
**Audience:** Developer (build and maintain from this), Owner and task manager (operate from this)
**Farm:** Woodlands Farm, Subdivision 3, 119.2 ha, Kwekwe, Midlands Province, Zimbabwe. Owned by Musara Holdings LLC.

---

## Change log from v1.0

| Area | v1.0 | v1.1 (this document) | Why |
|------|------|----------------------|-----|
| Evidence verification | Machine-verified: VIM verdicts at 0.80 confidence auto-closed tasks | **Human-accepted.** Photos, video and voice notes upload and are logged with the task; an owner or task manager accepts the task as complete, or sends it back with a reason | Owner decision, October 2026 |
| Video Intelligence Module | Automatic verifier on every photo and video | Automatic **advisory** check on field video: annotations appear on the acceptance card, and a "fail" or "unusable" annotation keeps the task out of "accept all". It never closes or rejects a task | Follows from the decision above |
| Roles | Owner, caretaker | Owner (admin), **task manager**, caretaker; self sign-up with owner approval | Owner request; research R52 |
| Offline | Event outbox and media queue | Adds an offline **decision** outbox for owners and task managers, a local cache of evidence for offline review, a visible per-file upload queue with retry, video-on-Wi-Fi-only, gallery and voice capture, and an "evidence uploading" hold | Owner request; research R43 to R46 |
| Land | 119.2 ha in eight blocks | 2 ha homestead garden in use (crop split to follow), 112.2 ha to clear and graze meanwhile, 5 ha lost to mining | Owner update, October 2026 |
| Cattle | Brahman and Mashona (prototype sample data) | **Nguni and Sanga**, BCS about 2.5, 90-day rehabilitation ration | Farm brief |
| Scaling plan | Narrative rollout only | Milestones with progress computed from farm data; Phase 0 and reticulation as released project steps; a staggered-hatching calendar that releases chick orders and placements | Farm brief |
| Spray resistance | Rotation register as text | Enforced: the spray task carries the last IRAC group and in-stock alternatives; repeating a group is flagged | Farm brief (emamectin benzoate already used on the maize) |
| WhatsApp | Designed | Built, with signed webhooks, per-task buttons, photo routing, sent-back notices and owner alerts; template text fixed below | Build |
| Research | 33 findings, August 2026 | v1.0 findings kept, three corrected, 19 new findings from an October 2026 pass (R34 to R52) | Brief requires named products and confirmed versus inferred |

Everything stated as "built" below exists in this repository and is covered by its automated tests (86 at the time of writing) unless marked otherwise. Everything marked **Proposed** is specified but not built.

---

## 0. The bottom line

**The single most important design decision is unchanged: the caretaker's phone never edits shared state. It only appends timestamped evidence events to a local outbox that drains whenever any connectivity exists. Everything else, the task state machine, acceptance, escalation, dashboards and KPIs, is a server-side fold over that append-only event log.**

Why it still carries the design:

1. **Offline-first is trivial instead of hard.** Appends do not conflict. The October 2026 research confirms the industry split: products that let phones edit shared records resolve conflicts with last-write-wins and lose data (Fiix documents this), while the robust ones queue operations and flag the residue for a manager (ODK Central, Mobble). We queue operations and fold them.
2. **Every action is evidence.** The log is the audit trail; gaps in it are a signal (the dark-farm detector, 4.5).
3. **WhatsApp is a second client, not a bolt-on.** A button tap or an inbound photo is one more event appended on the caretaker's behalf.
4. **It survives the phone.** A replacement handset restores the working set from the server.
5. **It now also carries the owner's decisions offline.** Accept, send back and skip decisions are queued on the owner's or task manager's phone with their own event ids and replay safely; a late decision on a task someone already decided is refused and shown, never silently applied.

Second decision, **changed in v1.1: closure is evidence-gated and human-accepted.** A task that needs a photo, video or voice note cannot close until that evidence has reached the server and a person with the owner or task manager role has accepted it. Tasks that need only readings or a tap (E0 and E1) still close on submission, kept honest by random audit sampling and physics checks. Strongest objection: human acceptance does not scale and the queue can rot. Accepted, with three mitigations built in: "accept all" clears the clean ones in one tap; anything flagged (missing readings, timing, physics, rotation, a VIM concern) is separated out so attention goes where it is needed; and a task waiting more than 24 hours alerts the owner and task managers. The industry evidence supports the design: approval states with a mandatory reason and bulk approval exist in field data tools (KoboToolbox, ODK Central, UpKeep, Limble), but no CMMS surveyed documents a clean approve-or-send-back flow for a completed work order, so this one is designed rather than copied (R48 to R50).

---

## 1. Research: how established platforms solve this

Two passes. The **August 2026 pass** (R1 to R33) is carried from v1.0. The **October 2026 pass** (R34 to R52) re-checked the mechanics this revision depends on: manual approval, offline media queues, conflict handling, release lead time, sensor debounce, escalation tiers and roles. Each finding is tagged:

- **Confirmed:** seen in vendor help-centre pages, official documentation, or a primary methods source (extension guide, developers' paper).
- **Inferred:** from marketing copy, app-store text, reviews, or synthesis. Said plainly where it applies.

Method note for the October pass: direct page fetches were blocked by the build environment's network proxy, so vendor pages were read through search-engine extracts of those pages. Crop and irrigation vendors (Granular, Cropwise, FieldView, CropX, WiseConn, Hortau, Netafim) publish little public help content, so most findings about them are Inferred, and nothing usable was found for Granular.

### 1.1 Task and record modelling

| # | Pattern | Products | Status | Verdict and where used |
|---|---------|----------|--------|------------------------|
| R1 | Everything is a log against an asset; a future-dated log with status pending is a task, marking it done makes it the record. Only pending logs assigned to a user sync to that user's phone. | farmOS | Confirmed | ADOPT, with a richer state machine than pending/done because a remote owner needs reported versus accepted [3.1] |
| R2 | Thin task beside rich typed records; a task has one main assignee plus team members, all notified. | AgriWebb | Confirmed | Typed-record catalogue adopted as evidence payloads [5.1]; split rejected |
| R3 | Recommendation or prescription converts into a work order (job); completing the job is the record, including weather at application. | Agworld | Confirmed (conversion), Inferred (status names) | ADOPT: completing a task is creating the record; spray records stamp weather [3.2, 5.1] |
| R4 | A reusable procedure (template) attached to a work order (instance); field types Pass/Flag/Fail, picture, signature, meter reading, number; a required empty field blocks completion. Statuses Open, On Hold, In Progress, Done; In Progress set automatically on the first step. | MaintainX | Confirmed | ADOPT the template/instance split and required-field gating [3.1, 5.1] |
| R5 | Work orders carry weather restrictions, planned start and end, and Start/Pause/Done timing that rolls up to cost per acre. | Trimble Ag Software | Confirmed | ADOPT as guards and expiry [3.4] |
| R6 | One polymorphic link from task to crop, location, animal or equipment; templates with "days due after start date" applied from an animal record produce a dated series. | Farmbrite | Confirmed | ADOPT `subject_type` + `subject_id` and anchor offsets [3.1, 3.3] |
| R34 | A "request" is a separate object from a work order: request, then admin approval, then work order. | MaintainX, UpKeep, Limble | Confirmed | ADOPT the shape for self sign-up (an account request an owner approves) [6.2] |

### 1.2 Recurrence and release

| # | Pattern | Products | Status | Verdict |
|---|---------|----------|--------|---------|
| R7 | Calendar recurrence with templates and series; "repeat based on date completed" otherwise from the original due date. | Farmbrite | Confirmed | ADOPT [3.3 S1, S2] |
| R8 | Fixed ("based on original schedule") versus floating ("based on last completion"); Time, Usage or Time-or-Usage schedules, the last requiring floating. | MaintainX, Limble, Fiix | Confirmed | ADOPT per-template `fixed` flag [3.3] |
| R9 | Meter triggers fire when a reading is entered from any screen; by default the next service counts from the last completion (done at 1,015 h on a 1,000 h cycle, next at 2,015 h); missed thresholds all generate on the next reading. | UpKeep, Limble | Confirmed | ADOPT for pump and generator service [3.3 S3] |
| R10 | Anchor-date season generation: adding a planting generates the season's tasks; when the plan shifts, dates shift. | Tend | Confirmed (behaviour), Inferred (offset arithmetic) | ADOPT [3.3 S4] |
| R11 | Biology-derived dates: breeding record sets the due date (285 days default, per-breed); pregnancy check refines it. | CattleMax, AgriWebb, Herdwatch | Confirmed | ADOPT [3.3 S4] |
| R12 | Rolling chain: each completed move schedules the next. | PastureMap | Confirmed | ADOPT for irrigation shifts [3.3 S5] |
| R35 | **Release ahead on a horizon:** "create work order ahead by" sets lead time, a scheduling horizon sets how far out to generate; a start-date offset makes a yearly task appear only days before due. | MaintainX | Confirmed | ADOPT: the 04:45 release plus the day bundle, and lead-time releases in plans (chick order 21 days before placement) [3.3 S6] |
| R36 | **Duplicate guard:** a trigger does not create a new work order while one is still open; time and usage plans for the same job create duplicates. | MaintainX | Confirmed | ADOPT: idempotent `(template, period_key, subject)` and fixed period keys for plan steps [3.3] |
| R37 | **Retraction:** a breeding record's expected-birth event is deleted automatically if the pregnancy is marked failed. Conditional alerts fire on false-to-true and stop when the condition turns false. | Farmbrite, CommCare | Confirmed | ADOPT: anchor moves supersede unreleased chain members [3.3 S4] |
| R38 | Late completion allowed until the next repeat starts; one-offs get a 14-day grace; a schedule can be marked "Won't do". Overdue split into Late Submit versus Missed. | SafetyCulture | Confirmed | ADOPT: grace windows per profile, and honest Skip as "won't do with a reason" [4.2] |

### 1.3 Triggers: weather, growth stage, sensors

| # | Pattern | Products | Status | Verdict |
|---|---------|----------|--------|---------|
| R13 | Soil moisture reduced to a band: refill line and full point; alerts by push, SMS, email. | CropX, Hortau | Confirmed (mechanics), Inferred (band reduction and Hortau alert channels, 2014 press) | ADOPT the band, applied to tank level first [3.4 T1] |
| R14 | Checkbook water balance: irrigate when root-zone depletion reaches RAW = p x TAW; apply no more than the current depletion; rain and irrigation are deposits, crop water use withdrawals. | FAO-56; NDSU and Clemson extension guides | Confirmed | ADOPT as the Phase 2 planner, built and shipped disabled [3.5] |
| R15 | Zero flow during a scheduled event means pump failure; flow outside schedule means leak. | Wildeye, WiseConn | Confirmed | ADOPT as physics checks on manual readings [5.5] |
| R16 | Satellite anomaly becomes a human-assigned scouting task. | EOSDA Crop Monitoring | Confirmed | ADOPT the shape, automate the creation [3.4] |
| R17 | Two-stage cascade: alert at threshold, second if it persists. | Moocall | Confirmed | ADOPT [4.2, T1 stage 2] |
| R18 | Derived obligation lists: a treatment record produces the daily in-withdrawal list. | Herdwatch | Confirmed | ADOPT withdrawal and PHI guards [3.4] |
| R39 | **Sensor debounce:** rule options above/below/between/rate of change; fire on every crossing, once until it clears, N of the last M readings, or persisting for a time; a re-run interval; warning tier to a request, critical tier to a work order; an action history of every run, skip and failure. | MaintainX | Confirmed | ADOPT for sensor-fed rules when probes arrive; manual-reading rules use cooldowns and two-stage now [3.4] |
| R40 | Sensor disconnection alert after 12 hours by default; escalation notifies more people if an alert stays active. | SafetyCulture | Confirmed | ADOPT: the dark-farm detector at 24 hours of silence [4.5] |
| R41 | Satellite-derived crop coefficient for water use, with advice by SMS; in a 2012 trial irrigators replied by SMS with irrigation and rain amounts to update the balance. | IrriSAT (developers' paper) | Confirmed | ADOPT the two-way channel idea: the caretaker can reply "done", "skip" or a photo on WhatsApp [4.4] |
| R42 | Growing-degree-day logic from a biofix to notify before a crop stage. | Agrio | Inferred (vendor blog) | NOTED: no crop platform on the list documents a GDD-triggered task (FieldView and Cropwise expose growth-stage insights only, Inferred); our growth-stage triggers are anchor offsets from planting and transplant dates [3.3 S4] |

**White-space finding (re-confirmed, still treated as tentative):** no surveyed platform auto-releases a task from a growth stage, threshold or lifecycle trigger; documented triggers end in a notification or, at most, a request a human converts (MaintainX's warning-to-request, critical-to-work-order split is the nearest). This design releases the task directly (3.4), because the person who would translate the alert is off site.

### 1.4 Offline capture and sync

| # | Pattern | Products | Status | Verdict |
|---|---------|----------|--------|---------|
| R19 | Visible unsynced counter, manual sync, background sync; others see offline photos only after both phones sync. | AgriWebb, Herdwatch | Confirmed (AgriWebb), Inferred (Herdwatch, marketing) | ADOPT the counter; automatic drain replaces the ritual [5.4] |
| R20 | Prime online, capture offline in a session, commit on reconnect. | Breedr (chute mode) | Confirmed | ADOPT the day bundle [3.6] |
| R21 | Append-only events with an outbox; conflicts become semantic and are handled by the fold. | Event-sourcing pattern; CouchDB/PouchDB | Confirmed | ADOPT as the core [0, 6] |
| R22 | Forms queue on a ready-to-send screen; transport Wi-Fi, cellular or both. | ODK Collect, KoboToolbox, CommCare | Confirmed | ADOPT [5.4] |
| R23 | A replacement phone re-hydrates from the server; the server keeps a hashed shadow and sends only differences; each form processed all-or-nothing. | CommCare | Confirmed | ADOPT restore [6.3] |
| R24 | SMS and USSD as the regional fallback; SMS delivery cannot be confirmed, so not for emergencies. | Esoko, DigiFarm, CommCare | Confirmed | ADOPT SMS as a bell only [4.1] |
| R43 | **The media queue made visible:** each photo, video, audio or signature starts uploading as soon as it is added, not when the record is finished; per-media-type setting Cellular+Wi-Fi, Wi-Fi only, or Never. | Fulcrum | Confirmed | ADOPT: upload starts on capture; videos-on-Wi-Fi-only switch [5.4] |
| R44 | Sync screen with a media tab, per-file error diagnostics and per-item retry; leaving mid-upload can fail; approval requests cannot be sent offline. | SafetyCulture | Confirmed | ADOPT the per-file status and retry; improve on it by queueing approvals offline [5.4, 5.6] |
| R45 | Offline caches: assigned and due-this-week items cached automatically (UpKeep), 100 work orders by default (MaintainX), up to 10 bookmarked tasks (Limble). Offline photo caps by plan (5 on UpKeep Professional); closing the app offline can lose work (Limble). | UpKeep, MaintainX, Limble | Confirmed | ADOPT the whole day plus open tasks cached; no photo caps beyond 3 per event; IndexedDB survives app close [5.4] |
| R46 | **Conflicts:** last write wins by sync time and simultaneous syncs can lose the first change (Fiix). Server applies updates in arrival order but marks parallel updates and conflicts, holds out-of-order offline updates up to 5 days, and shows conflicts only to managers (ODK Central). Offline actions saved as "Offline Requests", with a review of what changed on the farm before accepting (Mobble). | Fiix, ODK Central, Mobble | Confirmed | ADOPT the ODK/Mobble posture: append-only, deterministic winner, losers recorded and shown to the decision-maker; reject Fiix-style silent last-write-wins [3.2, 5.6] |

### 1.5 Evidence, closure and approval

| # | Pattern | Products | Status | Verdict |
|---|---------|----------|--------|---------|
| R25 | Required procedure fields block completion; Flag or Fail prompts a corrective work order. | MaintainX | Confirmed | ADOPT client-side evidence gating [5.1] |
| R26 | Compliance as a by-product: a treatment record computes withdrawal dates and an in-withdrawal list. | Herdwatch, AgriWebb | Confirmed | ADOPT [3.4 guards] |
| R27 | Spray record as forensic document: rates, batch numbers, weather at application. | Agworld | Confirmed | ADOPT, built [5.1] |
| R28 | Geotagged photos with caps; signatures absent industry-wide, attribution by user identity. | AgriWebb, Climate FieldView | Confirmed | ADOPT caps and attribution |
| R29 | Voice notes as completion records. | MaintainX | Confirmed | ADOPT for literacy tolerance [5.1] |
| R47 | **Evidence rules, not just fields:** a logic rule can require a photo or note when an answer is "No". | SafetyCulture | Confirmed | ADOPT: problem reports carry a voice note; flagged checks spawn follow-up tasks [5.1] |
| R48 | **Inspection approvals:** an approval page with one approver (a user, a group where any member may approve, or by site); the worker can be allowed to pick the approver; once approved the inspection cannot be reopened. Rejection is not documented (Inferred to happen through the approval questions). | SafetyCulture | Confirmed (reject: Inferred) | ADOPT: approver by role group (owner or task manager, any one may decide); accepted is terminal, corrections append [3.2] |
| R49 | **Approval inside the task:** the worker requests approval from a preset supervisor or one they pick; the task blocks until a decision; approve or deny cannot be changed. Request review switched on account-wide, reviewers by role permission. | Limble | Confirmed | ADOPT the blocking review step and decisions as final, appended events [3.2] |
| R50 | **Decline needs a reason sent to the requester** (UpKeep requests, MaintainX work requests); review states Approved / Not Approved / On Hold with **bulk status change** and "validate" as its own permission (KoboToolbox); Received / Has Issues / Approved / Rejected with a comment feed and exports filtered by state (ODK Central). | UpKeep, MaintainX, KoboToolbox, ODK Central | Confirmed | ADOPT: send back requires a reason that reaches the caretaker on WhatsApp; "accept all" for clean items; acceptance as a separate role permission [3.2, 5.6] |

**Correction to v1.0 R33.** v1.0 said no commercial CMMS has a first-class verified-by-supervisor state. That was too strong: Limble's approval instruction (R49) and SafetyCulture's inspection approvals (R48) are supervisor sign-off steps. What remains true (Confirmed absence in MaintainX's help centre) is that no surveyed CMMS documents approving or sending back a **completed work order** with a reason routed to the worker. That specific flow is designed here.

### 1.6 Escalation, rollup and the absent owner

| # | Pattern | Products | Status | Verdict |
|---|---------|----------|--------|---------|
| R30 | Overdue tiers per task, orange at +1 day and red at +2 by default; extra notification profiles add escalation layers by tag, priority or status. | Limble | Confirmed | ADOPT per-priority escalation profiles [4.2] |
| R31 | Absent-owner support is dashboards, event push and exception lists; Farmbrite's daily reminder email and MaintainX's Monday work-order report are the confirmed digests. | Farmbrite, MaintainX, AgriWebb, CattleMax | Confirmed (CattleMax weekly calving list: Inferred) | ADOPT the exceptions-first daily digest and weekly trends [4.5] |
| R32 | PM compliance as the master maintenance KPI. | Limble, Fiix, UpKeep | Confirmed | ADOPT [9.2] |
| R33 | (Corrected above.) | | | |
| R51 | Due-soon alert one hour before, overdue alert at the due time, action-overdue 24 h after; alerts within 5 minutes are grouped; escalation to a manager exists for sensors and lone workers but not for overdue actions. Scheduled-versus-completed dashboards, with the caveat that a scheduled inspection only counts once started. | SafetyCulture | Confirmed | ADOPT grouping (one WhatsApp lists all overdue tasks) and owner escalation for overdue work, which SafetyCulture lacks [4.2, 4.3] |
| R52 | Roles: Requester, Full User, Administrator, and Operator (completes only work orders assigned to them); custom roles on enterprise plans. Administrator, Farm Manager (no billing), Full Farm User, mobile-only Farm User and narrow roles. Only Admins and Limited Admins approve. | MaintainX, AgriWebb, UpKeep | Confirmed | ADOPT owner (admin), task manager (approves, no administration), caretaker (operator, sees own tasks) [3.6, 6.2] |

### 1.7 WhatsApp Business Platform mechanics

- Free-form messages only inside the 24-hour service window that opens or refreshes when the person messages the business; outside it, only pre-approved templates (utility, marketing, authentication). Confirmed.
- **Pricing changed since v1.0.** From 1 July 2025 pricing became per delivered template message. From **1 October 2026**, per vendor help centres (Zoho, respond.io, AiSensy; Inferred from secondary sources, not Meta's own page), utility templates sent *inside* an open window also become billable from the first message, and each business number gets **1,000 free service messages a month**. Consequence: free-form messages inside the window (our reminders when the caretaker is in contact) cost nothing up to 1,000 a month; templates cost a few US cents each in the Rest of Africa band. The sender therefore prefers free-form whenever the window is open (4.4).
- Interactive reply buttons (maximum three) and list messages (up to ten rows) return structured payloads; template quick-reply buttons carry a per-send payload. Confirmed.
- Inbound media arrives as a media id; the server must fetch the short-lived URL and store the bytes itself. Confirmed.
- Webhook deliveries are signed with the app secret (`X-Hub-Signature-256`). Confirmed; built (4.4).
- No surveyed farm or CMMS product sends WhatsApp natively (Herdwatch, AgriWebb, Mobble, Farmbrite, MaintainX, Limble, UpKeep, Fiix, Netafim: Inferred from absence in their documentation); MaintainX reaches WhatsApp only through a third-party connector (Saysimple, Inferred). WhatsApp here is a direct Business API integration.

### 1.8 Patterns adopted in this revision, in one list

1. Templates separate from released instances, released ahead on a horizon (R35), with a duplicate guard (R36).
2. Anchor-date tasks that retract when the anchor is cancelled or moved (R37).
3. Sensor rules with debounce and warning/critical tiers when probes arrive (R39); a silence detector now (R40).
4. A visible media queue: upload on capture, Wi-Fi-only for video, per-file status and retry, "evidence uploading" never blocks the task's own sync (R43, R44).
5. Append-only conflict posture: deterministic winner, losers recorded and shown to the decision-maker, never silent last-write-wins (R46).
6. Acceptance as an explicit review state with a mandatory reason on send-back, bulk accept for clean items, and acceptance as its own permission (R48 to R50).
7. Evidence rules (R47): a reported problem carries a voice note; flagged checks spawn follow-ups.
8. Tiered overdue escalation with grouping (R30, R51); Late versus Missed kept distinct (R38).
9. Exceptions-first daily digest plus weekly trends (R31).
10. WhatsApp and SMS as notification and fallback channels, never the system of record (R24, R41, 1.7).
11. Roles: owner, task manager, operator-style caretaker (R52).

---

## 2. Canonical operations taxonomy

### 2.0 The farm the taxonomy serves (farm brief and owner updates, October 2026)

| Domain | Reality | Where it lives in the system |
|--------|---------|------------------------------|
| Land | 119.2 ha. In use: the **2 ha homestead garden** (crop split to follow). 112.2 ha to be cleared, grazed meanwhile. About 5 ha lost to mining. | `locations`: HOMESTEAD (2 ha, in use), UNCLEARED (112.2 ha), MINING (5 ha); beds BLK-A (kale and rape), BLK-B (tomato Rodade, onion Texas Grano), BLK-C (maize, sorghum SV4) inside the homestead garden. Earlier field-map blocks retired, kept for history |
| Water | Borehole about 6,000 L/h, roughly 36,000 L/day. Main tank 80,000 to 125,000 L, leaking, rehabilitation is Phase 0. Pool about 45,000 L is the buffer now. Reticulation upgrading from 40 mm PVC and sprinklers to 63 mm HDPE and drip. | `water_params` (borehole_lph 6000, daily_pump_capacity_l 36000, pool_volume 45000, tank_usable 80000 until measured, range [80000, 125000]); assets BH-1, PUMP-BH1, TANK-MAIN, POOL-1, DRIP-SYS, RETIC-MAIN; projects A-P1 to A-P8 |
| Crops | Kale is the cash engine: $1 a bundle, about 50 bundles a day now, scaling to 10,000 plants and $10,000 to $12,000 a month. Tomato Rodade, onion Texas Grano, sorghum SV4, maize. The maize was treated for fall armyworm with emamectin benzoate. | `kale_plan` (price 1, baseline 50/day, target 10,000 plants, 330 to 400 bundles/day, $10,000 to $12,000/month); `faw_history` (emamectin benzoate, IRAC group 6, on BLK-C) |
| Cattle | Nguni and Sanga, body condition score about 2.5, on a 90-day rehabilitation ration. | Herd "Main herd" (breed Nguni and Sanga; head count 30 on record, **to confirm**); 90-day programme chain (2.6) |
| Poultry | Black Australorp, scaling through staggered hatching toward 1,000+ layers. | `poultry_plan`: six 150-chick placements six weeks apart from 3 November 2026; 250 layers and 100 broilers on record from the v1 prototype, **to confirm** |
| Build | Farm Manager app v1.2, Video Intelligence Module v1.1 (field video analysis), backend architecture specification v2.0. Scaling plan July 2026 to June 2027. | App version 1.2.x (Android build number from CI); VIM wired as advisory video check (5.7); integration split (Section 7); `scaling_plan` milestones (3.7) |

Two records in the app are **not** in the farm brief and came from the v1 prototype's sample data: a goat herd (35 Boer) and a pig herd (8 Large White). They are kept on the Farm screen but have no task templates. If they are real, the proposed G and S tasks in 2.8 cover them; if not, remove them.

Conventions: task codes `DOMAIN-NN`. Domains: **W** water, **C** crops, **K** cattle, **P** poultry, **A** assets and infrastructure (projects are **A-P**), **F** farm administration. Priorities **P0** stop-everything, **P1** same-day critical, **P2** routine, **P3** flexible. Evidence classes E0 to E5 (5.1). "Accept" means the task waits for an owner or task manager (5.6); "auto" means it closes on submission (E0/E1).

### 2.1 Daily tasks (built)

| Code | Task | When | Priority | Evidence | Closes by | Notes |
|------|------|------|----------|----------|-----------|-------|
| W-01 | Tank and pool level reading | 06:00 and 17:00 | P1 | E1 + E2: tank %, pool %, gauge photo | Accept | The sentinel reading; feeds T1 and T5 |
| W-02 | Pump run log | 18:00 | P1 | E1: start, stop, run hours | Auto | Accumulates pump run-hours for A-01 |
| W-03 | Irrigation shift (per bed) | From the irrigation planner | P1 | E1 + E2: litres, minutes, wet emitter line photo | Accept | Planner in 3.5; suppressed by T2 |
| W-08 | Rain gauge reading | 06:00 | P2 | E1: mm (zero is a required entry) | Auto | Gauge wins over forecast for T2 |
| C-01 | Kale harvest and bundle count | 05:30 | P1 | E1 + E2: bundles, photo of the stack against the tally board | Accept | Feeds the kale KPI and T6 |
| C-02 | Sales and dispatch record | 16:30 | P1 | E1 + E2: bundles sold, price, buyer, load or cash photo | Accept | Revenue source of truth |
| C-03 | Seedbed and nursery watering | 06:30 | P2 | E0 (1 in 7 audit upgrades to E2) | Auto | While nursery active |
| K-01 | Cattle rehabilitation ration feed | 07:00 | P1 | E2: feed in trough with herd present | Accept | 90-day programme |
| K-02 | Cattle water and gate check | 07:30 | P2 | E0 | Auto | Dry trough raises a fault task |
| P-01 | Poultry feed and water, morning | 06:15 | P1 | E1: feed per house | Auto | Per active batch |
| P-02 | Poultry feed and water, afternoon | 16:00 | P2 | E0 | Auto | |
| P-03 | Brooder temperature and chick check | 06:00, 12:00, 21:00 | P1 | E1 + E2: temperature, chick spread photo | Accept | Only while a batch is under 28 days old |
| P-04 | Egg collection and grading count | 10:00 and 15:00 | P1 | E1: trays and singles | Auto | Per laying batch only (not broilers) |
| P-05 | Mortality check and record | 06:15 | P1 | E1 + E2: count per house (zero required), photo if more than 2 | Accept | Feeds T4 |
| A-02 | Infrastructure and security walk | 17:30 | P2 | E0 | Auto | Pump house, tank, gates, stores |
| F-01 | Cash and float reconciliation | 17:00 | P2 | E1: cash on hand versus recorded sales | Auto | Variance over $5 is an owner exception |

### 2.2 Weekly tasks (built)

| Code | Task | When | Priority | Evidence | Closes by |
|------|------|------|----------|----------|-----------|
| W-04 | Drip filter flush and lateral inspection | Monday, floating 7 days | P2 | E3: before and after | Accept |
| W-05 | Reticulation walk: mainline, valves, leaks | Thursday | P2 | E2: defect photo | Accept |
| C-04 | Fall armyworm scout, maize bed | Monday 06:30 | P1 | E1 + E2: plants inspected, plants with fresh damage, crop stage, photos | Accept; fires T3 |
| C-05 | Tomato and onion pest and disease scout | Tuesday 06:30 | P2 | E1 + E2 | Accept |
| C-06 | Kale succession transplant (800-plant bed) | Wednesday | P2 | E1 + E2: plants, bed, photo | Accept; anchors the bed chain |
| K-03 | Body condition score, sample of 5 | Friday 07:00 | P2 | E1 + E2: score per tag, side-on photos | Accept; feeds T7 and the cattle milestone |
| K-04 | Tick control: dip or spray | Weekly in the rains (Nov to Apr), fortnightly in the dry season | P1 | E2 | Accept |
| P-06 | Poultry house deep clean and litter turn | Saturday | P2 | E3 | Accept |
| P-07 | Feed stock count and consumption check | Sunday | P2 | E1 + E2: bags on hand | Accept; feeds T8 |
| A-03 | Fence line section walk | Tuesday, rotating section | P3 | E2 | Accept |
| F-02 | Labour attendance and wage sheet | Saturday | P2 | E1 | Auto; owner approves payment |

### 2.3 Monthly, seasonal and asset maintenance (built)

| Code | Task | When | Priority | Evidence |
|------|------|------|----------|----------|
| A-01 | Borehole pump and generator service | Every 250 pump run-hours (meter) | P2 | E1 + E3: checklist, parts, before and after |
| W-06 | Drip system chemical flush | Monthly, floating | P2 | E1 + E2 |
| W-07 | Borehole static level check | Monthly, fortnightly in the dry season | P2 | E1 |
| A-04 | Knapsack and spray equipment calibration | Monthly, floating; overdue blocks spraying | P2 | E1 |
| A-05 | Tank integrity walk-around video | Monthly, floating (after Phase 0) | P2 | E4: 20-second video (offered to VIM, 5.7) |
| K-05 | Cattle vaccination: anthrax and blackleg | Yearly, September to October | P1 | E1 + E2: batch number, doses, race photo |
| K-06 | Deworming | Rains onset and end (owner-released) | P2 | E1 + E2; withdrawal recorded |
| K-07 | Pregnancy diagnosis and cull review | Yearly | P2 | E1 |
| C-07 | Fertigation or top dressing | Per programme and kale bed chain | P2 | E1 + E2; decrements stock |
| C-08 | Land preparation | Per cropping calendar (owner-released) | P2 | E3 |
| C-09 | Planting: sorghum SV4, maize (homestead beds) | With the effective rains, November window (owner-released) | P1 | E1 + E2: variety, seed rate, bed |
| C-10 | Tomato Rodade and onion Texas Grano nursery and transplant | Per succession (owner-released) | P2 | E1 + E2 |
| C-11 | Harvest: tomato and onion | From anchor chains; blocked inside any pre-harvest interval | P1 | E1 + E2 |
| P-08 | Chick placement, new batch | From the poultry plan (3.3 S6) or owner-released | P1 | E1 + E2: count placed, source, house; creates the batch and its chain |
| P-09 | Order day-old chicks for the next planned batch | 21 days before each planned placement (owner's task) | P1 | E1: supplier, count ordered, delivery date |
| F-03 | Month-end stock take | Monthly | P2 | E1 + E2 |
| F-04 | Month-end owner review pack | 1st of the month, generated | P2 | System |

### 2.4 Event-triggered tasks (built, released by rules in 3.4)

| Code | Task | Trigger | Priority | Evidence |
|------|------|---------|----------|----------|
| W-E1 | Low-water protocol: priority irrigation only (kale first, stock water never cut) | T1: tank plus pool below 30% of working buffer | P0 | E1 |
| W-E2 | Borehole or pump fault inspection | T5: pump hours did not show up in tank level | P1 | E4 video + E5 voice |
| W-E3 | Leak hunt | Overnight fall with no irrigation logged | P1 | E2 or E5 |
| W-ACCESS | Field access check after rain | T2 | P2 | E0 |
| C-E1 | Fall armyworm spray, rotated mode of action | T3 from C-04 | P1 | E1 + E2: product, batch, rate, bed, nozzle photo; rotation check (3.4) |
| C-E2 | Replant or gap-fill | Emergence under 80% at day 10 | P2 | E1 + E2 |
| C-INSPECT | Kale bed inspection | T6 harvest shortfall | P1 | E2 |
| K-E1 | Sick animal: isolate, describe, treat | Caretaker flag or T7 single low score | P1 | E4 + E5, treatment E1 |
| K-E2 | Calving follow-up chain | Calving reported | P1 | E2 per step |
| P-E1 | Batch vaccination step | Batch age reaches the chain offset | P1 | E1 + E2 |
| P-E2 | Abnormal mortality response | T4 | P0 | E4 + E1 |
| A-E1 | Breakdown repair | Caretaker report or physics check | P1 or P0 by asset | E3 + E1 |
| F-E1 | Input purchase and delivery confirmation | T8 reorder (owner's task) | P2 | E2 |

### 2.5 Projects in the scaling plan (built, released step by step from the Farm screen)

| Code | Step | Evidence | Effect |
|------|------|----------|--------|
| A-P1 | Phase 0: drain and inspect the main tank (run it into the pool first) | E1 + E2, 2 photos: cracks found, floor and wall condition | |
| A-P2 | Phase 0: repair and reline | E1 + E3: materials, before and after per section | |
| A-P3 | Phase 0: refill and 48-hour leak test | E1 + E2: level at start, level after 48 h, gauge photos | Readings `tank_leak_test_start_pct`, `tank_leak_test_48h_pct` |
| A-P4 | Phase 0: measure the usable tank volume | E1 + E2: usable litres (20,000 to 200,000), method | **Replaces the 80,000 to 125,000 L estimate** in `water_params` (T1, water balance, buffer autonomy); completes the Phase 0 milestone |
| A-P5 | Reticulation: lay a 63 mm HDPE mainline section | E1 + E2: section, metres; trench photo before backfill | |
| A-P6 | Reticulation: install drip laterals on a bed | E1 + E2: bed, laterals, emitters | |
| A-P7 | Reticulation: flush and pressure test | E1 + E2: pressure in bar, leaks found; gauge photo | |
| A-P8 | Reticulation: retire the 40 mm PVC sprinkler line | E2 | Completes the reticulation milestone |

### 2.6 Lifecycle chains (built)

**Poultry batch (anchor: P-08 placement, day D0).** D-2 brooder setup (E3); D0 placement and count; D0 to D28 P-03 brooder checks; D7 Newcastle plus infectious bronchitis; D14 Gumboro; D21 Gumboro booster; D28 Newcastle booster (La Sota), brooding ends; D56 fowl pox; D112 transfer to layer house; D119 Newcastle killed vaccine; D126 onward P-04 egg collection for this batch; weekly weight sample D7 to D112. **Confirm the vaccination programme with the hatchery and the Department of Veterinary Services before first use** (assumption, not veterinary advice).

**Kale bed (anchor: C-06 transplant).** D0 transplant record; D3, D7 establishment watering checks; D10 gap check (emergence 80% or replant); D14, D28 top dressing; D28 onward the bed joins the C-01 harvest pool; D180 retirement and re-preparation. Steady state 12 to 13 beds of 800 plants gives about 10,000 plants.

**Cattle 90-day rehabilitation (anchor: programme start).** Daily K-01 ration; weekly K-03 scoring of 5 animals on the trajectory from about 2.5 to 3.0 by day 90; fortnightly ration review to the owner; day 90 full-herd scoring and close-out. T7 fires on a weekly median drop of 0.25 or any animal at 2.0 or below.

### 2.7 Kale scaling arithmetic (built as `kale_plan`)

Current 50 bundles a day at $1 is about $1,500 a month. Target 330 to 400 bundles a day is $10,000 to $12,000 a month. At roughly 28 to 30 plants per daily bundle, 10,000 plants sustain the target, which is 12 to 13 beds of 800 at one transplant a week. The milestone (3.7) reads progress from the 7-day mean of C-01 bundle counts, the 30-day sum of C-02 sales and the plant count maintained by C-06 anchors.

### 2.8 Proposed (not built): goats and pigs, if confirmed

| Code | Task | When | Priority | Evidence |
|------|------|------|----------|----------|
| G-01 | Goat kraal water, feed and headcount | Daily 07:30 | P2 | E1: head count |
| G-02 | Goat FAMACHA and body check (sample of 10) | Fortnightly | P2 | E1 + E2 |
| S-01 | Pig feed and water | Daily 07:00 and 16:00 | P1 | E1: feed kg |
| S-02 | Farrowing chain (anchor: service date, 114 days) | Per sow | P1 | E1 + E2 per step |

---

## 3. Task engine specification

### 3.1 Object model (as built)

A **TaskTemplate** holds the rule and never reaches the phone as a task. A **TaskInstance** is one released occurrence; completing it is creating the operational record (R1, R3). Instances change only through appended **TaskEvents**; the instance row is a projection the server maintains for fast queries and can rebuild from the log.

```
task_template {
  id, code ("W-01"), title, domain (W|C|K|P|A|F), version   -- instances pin the version
  subject_type (asset|location|batch|herd|none), default_subject_id   -- R6 polymorphic link
  priority (P0..P3), est_minutes          -- phone interaction target, not job length
  instructions jsonb [{text}], checklist jsonb
  evidence_policy jsonb {                 -- 5.1
    classes ["E1","E2"], fields [{key,label,type,min,max,unit,options}],
    photo_min, video_min, voice_min, any_of, pair,
    vim_profile,                          -- names the VIM check for video evidence (5.7)
    readings [{metric, from}], meters [{meter, from}],   -- projections written by the fold
    anchor_emit, inventory_out, inventory_in, rotation_register,
    assignee_role, project, e0_sampled
  }
  schedule jsonb | null                   -- 3.3; null = released by rule, plan or owner
  guards jsonb [{type: calibration|phi_block|...}]       -- 3.4
  escalation_profile (P0|P1|P2|P3)        -- 4.2
  active bool
}

task_instance {
  id, template_id, template_code, template_version
  period_key text                         -- "2026-10-26", "2026-10-26:06:00",
                                          -- "plan:poultry:2026-11-03:place"
  unique (template_id, period_key, subject_id)   -- release is idempotent (R36)
  subject_type, subject_id, assignee_id
  title, priority, est_minutes            -- copied at release; plan steps carry their own title
  params jsonb                            -- trigger and plan values: block, litres, minutes,
                                          -- basis, rotation {last_product, last_irac_group,
                                          -- use_instead[]}, planned_count, house, purpose,
                                          -- batch_label, evidence_policy_resolved
  release_at, due_at, grace_until, expires_at
  state                                   -- 3.2
  missed_count, deferral_count, rejection_count
  blocked_by uuid                         -- same-asset collision link (3.6)
  evidence_summary jsonb {fields, photo_count, video_count, voice_count,
                          media [{media_uuid, kind}], weather, retake_requested}
  verification jsonb {method: accepted|sampled_none|deferred_owner_audit,
                      by, role, note}
  escalation_state jsonb                  -- rungs already fired, incl. review_aging
  closed_at
}

task_event {                              -- append-only; UPDATE and DELETE refused by trigger
  event_uuid uuid primary key             -- generated on the phone: idempotency key
  seq bigint identity                     -- total order for deterministic replay
  instance_id uuid null
  actor_type (caretaker|owner|manager|system|vim|whatsapp)   -- set by the server from the account
  actor_id, device_id
  type   released | seen | started | field_recorded | media_attached | done_reported |
         skip_requested | problem_flagged | review_required | verified_closed |
         rejected_reopened | skip_approved | skip_denied | unblocked | missed | rolled |
         expired | cancelled | superseded | corrected | deferred | reassigned |
         escalated | auto_verified | retake_requested
  payload jsonb                           -- readings, media refs, reasons, flags, decisions
  device_time, server_time (clock_timestamp())
}
```

Design rule (R1): **a completed instance is the record.** There is no second activity log; reports, compliance views, KPIs and the plan milestones are queries over instances, events and readings.

### 3.2 State machine (as built)

```
scheduled --released--> released                  [release time reached, guards pass]          system
released --seen--> acknowledged                   [card rendered on phone or WhatsApp]          caretaker
acknowledged|released --started--> in_progress    [optional; long jobs only]                    caretaker
released|acknowledged|in_progress
  --done_reported--> done_reported                [evidence policy satisfied on the phone]      caretaker, whatsapp
  --skip_requested--> skip_pending                [reason from fixed list + note]               caretaker, whatsapp
  --problem_flagged--> blocked                    [description and/or voice note]               caretaker, whatsapp

done_reported --auto_verified--> verified_closed  [E0/E1 policy, no flags: sampled_none]        system
done_reported (holds)                             [evidence still uploading: any attached
                                                   media not yet stored on the server]
done_reported --review_required--> needs_review   [flags: evidence_short, timing_sanity,
                                                   harvest_sanity, rotation_breach, phash_match]
done_reported --review_required--> needs_review   [all evidence stored: awaiting_acceptance]
done_reported --review_required--> needs_review   [24 h with uploads still missing:
                                                   media_not_uploaded]                          system (sweep)

needs_review --verified_closed--> verified_closed [Accept; verification.method = accepted]      owner, manager
needs_review --rejected_reopened--> released      [Send back; reason required; new due next
                                                   day 12:00; rejection_count += 1;
                                                   caretaker told on WhatsApp]                  owner, manager
skip_pending --skip_approved--> skipped           [owner/manager, or absence auto-rule]
skip_pending --skip_denied--> released            [owner, manager]
blocked --unblocked--> released                   [problem solved]                              owner, manager
released|acknowledged|in_progress --missed--> missed   [grace passed]                           system
missed --rolled--> released                       [next plan day; missed_count += 1]            system
any non-terminal --expired--> expired             [expires_at passed, e.g. rain-suppressed]     system
any non-terminal --cancelled--> cancelled         owner, manager
any non-terminal --superseded--> superseded       [anchor moved]                                system
verified_closed --corrected--> verified_closed    [correction appended; original kept]          owner, manager
```

Terminal states: `verified_closed`, `skipped`, `expired`, `cancelled`, `superseded`.

**Who may append what (enforced at the sync endpoint).** The server derives `actor_type` from the signed-in account and ignores any value the phone sends. Caretakers may append only field events (`seen`, `started`, `field_recorded`, `media_attached`, `done_reported`, `skip_requested`, `problem_flagged`). Owners and task managers may also append decisions (`verified_closed`, `rejected_reopened`, `skip_approved`, `skip_denied`, `unblocked`, `cancelled`, `reassigned`, `corrected`, `deferred`). System events (`released`, `review_required`, `auto_verified`, `missed`, `rolled`, `expired`, `superseded`, `escalated`) come only from the server. A caretaker therefore cannot accept their own work, even with a modified app.

**Ready to accept.** A `needs_review` task is "ready" when its only flag is `awaiting_acceptance` and no VIM annotation on it says `fail` or `unusable`. Only ready tasks are included in "accept all"; everything else is decided one by one.

**Conflicts, resolved deterministically (R46).** Two people deciding the same task offline: the first decision to reach the server wins (it moves the state), the second is refused because its transition is no longer legal, and the refusal is shown on the second person's phone under "Decisions that didn't apply". A field event for a task that has since been cancelled is accepted into the log (the fact happened) but changes nothing. Media attached to a task in any non-terminal state is always accepted. Nothing is ever silently overwritten.

**Field-speed fast path.** Micro-task: tap card, number pad, camera, Done. Three taps, under 30 seconds, `released` to `done_reported` in one gesture, offline.

### 3.3 Scheduling rules

Six rule types. A template's `schedule` holds one of S1 to S5; S6 lives in a plan setting and releases templates whose schedule is null.

| Type | Shape | Used for |
|------|-------|----------|
| S1 calendar, fixed | `{type:"calendar", freq:"daily|weekly|monthly|yearly", byday:["MO"], at:["06:00","17:00"], fixed:true}` | W-01, W-08, C-01, K-01, P-01, F-01, K-05 |
| S2 calendar, floating | as S1 with `fixed:false`: next due = last closure + interval (R8) | W-04, W-06, A-04, A-05 |
| S3 meter | `{type:"meter", meter:"pump_run_hours", every:250}` accumulated from W-02 events (R9) | A-01 |
| S4 anchor chain | `{anchor_event:"batch_placed", offsets:[{d:7, template:"P-E1", params:{...}}]}`; an anchor move supersedes unreleased members (R37) | Poultry batch, kale bed, cattle programme, calving |
| S5 rolling | `{type:"rolling", compute:"irrigation_planner"}` | W-03 |
| S6 plan dates | a plan setting with dates and lead times; each step released once by a fixed period key (R35, R36) | P-09 chick order and P-08 placement |

**Seasonal modifier:** `season_overrides` switch cadence by month (K-04 weekly November to April, fortnightly May to October; W-07 fortnightly in the dry season).

**Release horizon and catch-up.** The 04:45 release materialises the day and the phone pulls it as one bundle (R20). Plan steps use windows rather than exact days (order: from 21 days before placement until placement; placement: placement day plus three days), so a server that was down catches up the next morning; the fixed period key guarantees a single release.

**Worked example, staggered hatching to 1,000+ layers (S6, built).** `poultry_plan = {breed: Black Australorp, target_layers: 1000, batch_size: 150, order_lead_days: 21, house_rotation: [HOUSE-2, HOUSE-1], placements: [2026-11-03, 2026-12-15, 2027-01-26, 2027-03-09, 2027-04-20, 2027-06-01]}`.

- 13 October 2026: P-09 "Order 150 day-old Black Australorp chicks (batch 1 of 6, placing 2026-11-03)" released to the owner, due in three days.
- 3 November 2026: P-08 "Place 150 Black Australorp chicks in Poultry House B (batch 1 of 6)" released to the caretaker with `params {planned_count:150, house:HOUSE-2, purpose:layers, batch_label}`.
- Caretaker reports 148 placed: the fold creates batch "Black Australorp layers (batch 1 of 6, placed 2026-11-03)", purpose layers, current count 148, and instantiates the 2.6 chain (D7 Newcastle plus IB on 10 November, D14 Gumboro on 17 November, and so on to D126 egg collection on 9 March 2027).
- Arithmetic: 250 layers on hand plus 6 x 150 placed, less about 5% rearing loss, is roughly 1,100 birds; batches placed by late January 2027 are in lay by the end of the plan year, the June 2027 batch lays from October 2027. The layers milestone (3.7) reads current layer counts from batches with purpose layers.

**Worked example, kale bed (S4, built).** `bed_transplanted(bed_17, 2026-10-14, plants:800)` releases checks on 17 and 21 October, the gap check on 24 October, top dressings on 28 October and 11 November, joins the harvest pool on 11 November and retires on 12 April 2027. Moving from 50 to 330 bundles a day changes only the cadence and bed size in the template.

**Worked example, pump service (S3, built).** W-02 logs 06:10 to 12:20 = 6.2 h added to `pump_run_hours`; crossing 250 h releases A-01 with its checklist. Missing W-02 entries show up in the water-balance physics check (5.5).

### 3.4 Trigger rules (built)

```
rule { id, name, source (reading|task_event|forecast|inventory|clock),
       condition jsonb, action jsonb {release, params, notify, suppress, expire_released},
       cooldown_h, arm_condition jsonb, two_stage jsonb, last_fired_at, stage2_fired_at }
```

| Rule | Condition (exact) | Action | Cooldown |
|------|-------------------|--------|----------|
| T1 Low water | (tank % x `tank_usable` + pool % x 45,000) / (`tank_usable` + 45,000) below 30% at a W-01 reading | Release W-E1 (P0), suppress non-priority W-03, alert owners and task managers | 24 h; stage 2 below 15%: P0 alert and owner call prompt |
| T2 Rain | Gauge W-08 at or above 15 mm, or forecast tomorrow at or above 15 mm with probability at or above 60% (forecast older than 36 h ignored; gauge always wins) | Suppress tomorrow's W-03, expire released shifts with reason rain, release W-ACCESS | 24 h |
| T3 Fall armyworm | C-04: fresh damage / plants inspected at or above 0.20 (whorl) or 0.10 (seedling) | Release C-E1 with the rotation hint | 7 days |
| T4 Poultry mortality | P-05 above 1% of the batch in a day, or above 0.3% three days running | Release P-E2 (P0), alert owners | none |
| T5 Pump versus tank | 4+ pump hours where tank gain is under 60% of hours x 6,000 L after logged irrigation | Release W-E2 | 48 h |
| T6 Harvest shortfall | C-01 under 80% of the 7-day mean two days running | Release C-INSPECT, owner exception | 48 h |
| T7 Condition regression | K-03 weekly median down 0.25+, or an animal at 2.0 or below | Owner ration review; single animal releases K-E1 | 7 days |
| T8 Reorder | Stock on hand below reorder point | Release F-E1 to the owner with quantity | 72 h |
| T9 Dark farm | No caretaker event for 24 h | Owner alert with last event and out-of-band checklist | 24 h |

**Rotation check (built, new in v1.1).** Every C-E1 release carries `params.rotation = {last_product, last_irac_group, last_date, use_instead[]}`. The last product comes from the latest recorded C-E1 spray, else from `faw_history` (emamectin benzoate, group 6, on the maize). `use_instead` lists inventory products of a different IRAC group with stock flags (chlorantraniliprole group 28, spinetoram group 5). On `done_reported`, if the product's group equals the previous spray's group, the task goes to review with `{kind: rotation_breach, irac_group, product, previous}`. Worked: the next armyworm outbreak on the maize offers chlorantraniliprole or spinetoram; if the caretaker records emamectin benzoate again, the owner sees "Same group as the previous spray (6)" before accepting.

**Guards (built):** a spray task cannot release while A-04 calibration is overdue; a harvest cannot release for a bed inside an active pre-harvest interval computed from the product's `phi_days` (emamectin benzoate 7 days); animal sales inside a withdrawal window need an owner override. Spray completions are stamped with that day's forecast weather and the last 24 h of gauge rain, in the immutable event (R27).

**Sensor-fed rules (Proposed, when probes or a tank logger arrive):** adopt R39 debounce settings per rule (`for: {n_of_last_m: [3,4]} | {persists_minutes: 60}`), warning and critical tiers, and a 12-hour silent-sensor rule (R40).

### 3.5 Irrigation planning (built)

**Phase 1, tank budget (default).** Per irrigated bed: kale `litres_per_plant 1.2` x plant count at 2 L/h emitters gives 36-minute shifts; tomato and onion `litres_per_day 7,000` run at nominal delivery. Shifts start 06:00 with 15-minute valve changes. Stock water and poultry are never cut.

At the 10,000-plant kale target, crop demand peaks near 20,500 L/day against 36,000 L pumpable: feasible with about 40% headroom, but only about two days of buffer if the borehole stops, which is why W-01 is twice daily and T1 exists. Until Phase 0 measures the tank, buffer = 45,000 L pool + 80,000 L (the low end of the tank range, deliberately conservative).

**Phase 2, FAO-56 checkbook (built, shipped disabled, switched on on the Water screen).** Per bed daily: `deficit = clamp(deficit + Kc x ET0 - rain - irrigation, 0, TAW)`; when the projected deficit crosses MAD x TAW, release a refill shift with `minutes = depth / (rate x efficiency)`, capped at 180 with the remainder carried. ET0 comes from the Open-Meteo forecast feed (04:15 daily), rain from W-08, applied water from completed W-03 shifts. Days on climate-normal ET0 are flagged. The ledger runs in shadow beside Phase 1 so the owner can compare before switching (R14).

**After the reticulation upgrade:** 63 mm HDPE raises mainline capacity and drip replaces sprinklers; the A-P6 step records laterals and emitters per bed, and the owner updates the bed's `rate_mm_h` and `efficiency` on the Water screen (drip efficiency 0.9 against roughly 0.7 for sprinklers), which shortens planned run times by about a fifth for the same depth.

### 3.6 Release, the daily plan, assignment and collisions (built)

At 04:45 the release engine evaluates S1 to S5, armed rules, guards and suppressions, then releases S6 plan steps, and writes the **DailyPlan** ordered by priority then time. Phones pull the bundle (plan, open tasks, templates, reference data, active pre-harvest and withdrawal windows, last recorded values per template) on any connectivity, so a signal-dead morning has the whole day.

**Assignment.**

1. Field tasks (W, C, K, P, A) default to the first active caretaker; plan placements and project steps likewise.
2. Owner-role templates (F-E1 purchases, P-09 chick orders) go to the owner.
3. Reminders follow the task's actual assignee (4.2); a reassignment is a `reassigned` event.
4. The acceptance queue, skip requests and problem reports go to **owners and task managers** together; any one may decide (R48). The event records who and in which role.
5. Owners and task managers see every task and can do field work themselves from the Tasks screen; caretakers see their own and unassigned tasks.

**Capacity and collisions.** P0 pre-empts and re-orders the plan. P1 never auto-defers; if P1 alone overflows the day, an owner exception lists a suggested cut before 06:00. P2 defers up to 2 days, P3 up to 7, each appending `deferred`. A task deferred 3 times escalates to the owner queue (starvation guard). Same-asset collisions link through `blocked_by`: a pump-fault repair blocks the filter flush, which shows as waiting, not missed. Every template's `est_minutes` counts phone interaction only; the normal day's sum stays under 15 minutes, and any capture flow over 60 seconds in field testing is split.

### 3.7 Scaling plan, July 2026 to June 2027 (built)

`scaling_plan.milestones`, each with a target date, progress computed from farm data, and an optional manual mark (done or blocked) by an owner or task manager:

| Milestone | Target | Progress computed from |
|-----------|--------|------------------------|
| Phase 0: tank rehabilitated, usable volume measured | 15 Dec 2026 | Done when `water_params.tank_usable_measured`; else A-P1 to A-P4 steps closed |
| Reticulation on 63 mm HDPE and drip; sprinklers retired | 31 Mar 2027 | A-P5 to A-P8 steps; done when A-P8 closes |
| Kale at 10,000 plants, 330 to 400 bundles/day | 30 Jun 2027 | 7-day mean bundles / 330; detail shows 30-day sales and plant count |
| 1,000+ Black Australorp layers | 30 Jun 2027 | Current layers (batches with purpose layers) / 1,000; next placement shown |
| Cattle BCS about 2.5 to 3.0 | 31 Jan 2027 | (latest median BCS - 2.5) / 0.5 |
| Sorghum SV4 and maize planted | 15 Dec 2026 | A verified C-09 since 1 July 2026 |

Status: done, on track (progress above zero, target not passed), behind (target passed), not started, or blocked (manual). The Farm Map screen shows each milestone with its bar, detail line and, for projects, the steps with a Release button (disabled while a step is already on the list). Targets are proposals for the owner to adjust.

---

## 4. Reminders, nudges and escalation

### 4.1 Channel stack, cheapest and most reliable first

1. **The phone's own plan.** The day bundle carries every task with its due time, so the Tasks screen orders the day and marks overdue work with no connectivity at all. Local notifications raised from that cached plan are the primary reminder channel in a dead zone (built as the plan view; **Proposed:** OS-level scheduled notifications once the Android wrapper exposes them).
2. **In-app sync badge.** Always visible: queued records, uploads waiting, decisions waiting, last sync time. Tapping it opens the Sync screen (5.4).
3. **WhatsApp (built).** Server-initiated reminders, the morning list, sent-back notices and owner alerts. WhatsApp's own store-and-forward delivers late rather than never, and the caretaker already lives in it.
4. **SMS (Proposed, logged stub built).** The notifier has an SMS channel behind the same interface; a gateway (Africa's Talking or a local aggregator) plugs into that one file. Use: a bell only, when WhatsApp delivery fails for 12 hours (R24).
5. **Call prompt.** The system never robocalls; a P0 rung tells the owner to phone the caretaker (the strongest social signal available, at no build cost).

### 4.2 The escalation ladder (built, per priority profile)

All timers run server-side off the event log every five minutes; each rung fires once per task and is recorded in `escalation_state`.

| Rung | P0 | P1 | P2 and P3 |
|------|----|----|-----------|
| Release | Push and WhatsApp to the assignee immediately | On the plan | On the plan |
| Pre-due | n/a | 60 min before due (switched off after 14 on-time closes in a row for that template, back on after any miss) | none |
| Overdue 1 | +15 min: WhatsApp to the assignee with Done, Problem, Skip buttons | +2 h: WhatsApp with buttons | At end of day: `missed`, rolls to tomorrow, `missed_count` + 1 |
| Overdue 2 | +30 min: WhatsApp alert to owners and task managers plus "phone the caretaker" | +6 h: WhatsApp alert to owners and task managers | Second miss in a row: named line in the digest |
| Overdue 3 | +60 min: `missed`, stays at the top of every view | 20:00 on the due day: `missed`, rolls, `missed_count` + 1 | |

**Missed once:** the task is marked `missed` at the end of its grace, rolls to the next plan day with a "yesterday" badge. No owner noise for P2 and P3; the digest counts it.

**Missed twice running:** P0 and P1 send an owner alert immediately (`woodlands_owner_alert`: "C-01 Kale harvest was missed twice in a row"); P2 and P3 put a named exception in the digest.

**Missed during the owner's absence (built).** The owner sets absence dates (and optionally a deputy contact) on the Farm Map screen. While active:
- rungs that would reach the owner go to the deputy if one is set; P0 always reaches the owner as well;
- the digest keeps sending;
- a skip request older than 48 hours with a listed reason (no water, no input in stock, rain, sick, other) is approved automatically and flagged for review on return;
- **changed in v1.1:** tasks waiting for acceptance are never auto-closed while a task manager account is active, because acceptance keeps happening. Only on a farm with no task manager does a task waiting more than 72 hours close as `verified_closed` with `verification.method = deferred_owner_audit`, flagged until a person looks at it. Strongest objection: even that weakens the gate; it exists so a farm with one owner abroad and no manager does not stall.

**Acceptance queue ageing (built, new in v1.1).** A task waiting more than 24 hours for acceptance raises one WhatsApp alert to owners and task managers listing up to five such tasks ("3 tasks have waited over a day for acceptance: ..."). It fires once per task.

**Skip, problem and send-back are cheaper than silence.** A Skip with a reason never escalates the way a silent miss does; a Problem report moves the task to `blocked` and to the decision queue, which stops the caretaker's escalation clock (the problem is now the manager's to solve).

### 4.3 Anti-nag design (built)

1. **Collapse:** one WhatsApp per person listing all their currently overdue tasks; a single overdue task gets the three buttons instead.
2. **Quieting:** 14 consecutive on-time closes of a template switch its pre-due nudge off.
3. **Clocks stop at `done_reported`.** Slow uploads never punish the person who did the work; the evidence hold (5.6) is the server's problem, not the caretaker's.
4. **Per-person opt-out:** each person can switch WhatsApp messages off under My account; owners can switch each message type off farm-wide (reminders, morning list, owner alerts, sent-back notices).

### 4.4 WhatsApp flows (built)

**Window logic.** Every send carries two forms. If the person messaged the farm number in the last 24 hours, the free-form version goes (text or tap buttons; free up to 1,000 a month from October 2026). Otherwise the approved template goes. Without credentials every message is logged as `logged_only`, so the farm behaves identically before WhatsApp is set up. Every inbound message refreshes the window.

**Templates (category Utility, language "en"; created once in WhatsApp Manager):**

| Key | Template name | Body | Buttons |
|-----|---------------|------|---------|
| task_reminder | `woodlands_task_reminder` | Reminder from Woodlands Farm: {{1}} was due at {{2}}. Please do it now and tap a button below when it is done. | Done, Problem, Skip |
| overdue_list | `woodlands_overdue_list` | Woodlands Farm: you have {{1}} overdue tasks: {{2}}. Please open the Woodlands app to record them. | |
| morning_plan | `woodlands_morning_plan` | Good morning {{1}}. You have {{2}} farm tasks today: {{3}}. Open the Woodlands app to see the details. | |
| sent_back | `woodlands_task_sent_back` | Woodlands Farm: {{1}} was sent back. Reason: {{2}}. Please redo it and record it in the Woodlands app. | |
| owner_alert | `woodlands_owner_alert` | Woodlands Farm alert: {{1}}. Open the Woodlands app for details. | |
| hello | `hello_world` (Meta's sample, en_US) | Hello World | used by "Send test" before the farm's own are approved |

**Flows.**
- **Morning list** at the owner's chosen time (default 06:00): each caretaker gets their tasks for the day. Fires once per farm day; a server that was down at that time does not send "good morning" in the afternoon.
- **Overdue reminder:** buttons carry the task id (`done:<uuid>`, `problem:<uuid>`, `skip:<uuid>`). Done appends `done_reported` with `actor_type = whatsapp` and asks for the photo; Problem asks for a voice note or description and blocks the task; Skip records a skip request. Typed replies ("done") resolve against the replied-to message or the single open task.
- **Evidence by chat:** an inbound photo, video or voice note attaches automatically when exactly one task is open for that person; otherwise the bot replies with a numbered list ("which task is this for?") and the reply "2" attaches it to task 2. Media is fetched from Meta immediately (the URL is short-lived) and stored as a normal `media_objects` row, so it reaches the acceptance card like any other upload.
- **Sent back:** the caretaker receives the reason the owner or task manager typed.
- **Owner alerts** go to every active owner and task manager with a phone and WhatsApp switched on.
- **Security:** deliveries are verified with the app secret; messages from numbers not on an active account are ignored.

**Costs, worked.** A normal month: about 30 morning lists and perhaps 40 reminders, nearly all inside the open window (free), plus about 20 templates on cold-start days and owner alerts at a few US cents each: under US$2 a month.

### 4.5 Dark farm and the owner digest (built)

**Dark-farm rule (T9).** No caretaker event, sync or WhatsApp message for 24 hours: owner alert with the time and type of the last event, and the out-of-band checklist (call the caretaker, call the neighbour contact). Covers a broken phone, exhausted data bundle, theft or absence without diagnosing which.

**Digest (19:00, in app and WhatsApp).** Exceptions before activity: completion line (verified, skipped, missed, **waiting for acceptance**), water line (tank % trend, litres pumped against plan, rain), money line (bundles harvested and sold, cash, variance), then named exceptions, each one tap from a decision. The weekly view adds kale bundles 7-day mean against the 330 target, BCS against the 2.5 to 3.0 trajectory, poultry mortality and lay rate, maintenance compliance, and acceptance KPIs (9.2).

---

## 5. Logging and evidence layer

### 5.1 Evidence classes and per-task policy (built)

Each template's `evidence_policy` chooses from six classes. The phone enforces the policy before Done is enabled (MaintainX required fields, R25, moved on-device so it works offline); the server re-checks on receipt.

| Class | Content | Capture cost | Closure |
|-------|---------|--------------|---------|
| E0 | Tap only; person, time and device attach automatically | 5 s | Closes on submission; 1 in 7 silently upgraded to E2 at release (`e0_sampled`) |
| E1 | Structured fields: numbers, choices, product pickers, with min and max | 15 to 30 s | Closes on submission unless a sanity check flags it |
| E2 | 1 to 3 photos (camera or gallery) | 20 s | Accepted by a person |
| E3 | Before and after pair; "before" prompted at start | 30 s | Accepted by a person |
| E4 | Video, 10 to 20 s | 40 s | Accepted by a person; VIM annotates (5.7) |
| E5 | Voice note, up to 60 s, recorded in the app | 20 s | Accepted by a person |

Cross-cutting rules (built): every photo is stamped (task code and time burned onto the image for camera shots; gallery picks are stamped with "from gallery" and their file date); a perceptual hash (pHash) of every image is compared with the last 60 days and a match routes the task to review with `phash_match`; uploads keep their real file type (JPEG, PNG, MP4, WebM, 3GP, OGG, M4A); chemical and medicine tasks require the product (from inventory) and batch number so withdrawal and pre-harvest windows are computable.

### 5.2 Proof per task type

| Task | Proof (policy) | Why this proof |
|------|----------------|----------------|
| W-01 Tank and pool level | E1 tank %, pool %; E2 photo of the gauge or marker | Gauge photo lets the reviewer read the number back |
| W-02 Pump run | E1 start, stop, hours | Feeds the pump meter and the water balance (5.5) |
| W-03 Irrigation shift | E1 litres, minutes; E2 wet-line photo | Wet soil along the line is visible proof the water reached the bed |
| W-08 Rain gauge | E1 mm | Gates T2 |
| C-01 Kale harvest | E1 bundles; E2 photo of the bundle stack against the tally board | Board with the chalked date proves freshness and scale |
| C-02 Sales and dispatch | E1 bundles sold, price US$, buyer; E2 photo of the load | Money line; cash variance |
| C-04 Fall armyworm scout | E1 plants inspected, plants with fresh damage, crop stage; E2 whorl photo | Fires T3 at 20% whorl damage |
| C-E1 Spray | E1 product, batch, rate, block; E2 label or nozzle photo | Rotation check, pre-harvest window, Agworld-style spray record (R27) |
| K-01 Rehabilitation ration feed | E2 trough photo with feed in it | 90-day ration adherence, at a glance |
| K-03 Body condition | E1 per-animal BCS; E2 side-on photos | Trajectory from 2.5 toward 3.0 |
| K-E1 Sick animal | E4 video of the animal; E5 voice note of the symptoms; E1 treatment product and batch | Withdrawal window; vet referral |
| P-01 Poultry feed and water | E1 feed kg | Feed balance |
| P-04 Egg collection | E1 trays, singles | Lay rate |
| P-05 Mortality | E1 dead count; E2 photo | T4 thresholds; photo deters invented deaths |
| P-08 Place chicks | E1 count placed, source, house; E2 photo of the brooder | Creates the batch and its chain |
| A-P1 to A-P8 Project steps | E1 measurements (cracks, materials, levels, metres, pressure) with photos; A-P2 before and after; A-P4 records the measured usable litres | Phase 0 and reticulation progress verifiable off site |
| A-05 Tank integrity inspection | E4 walk-round video (VIM `leak_scan`) | Wet ground or seepage visible; compared with the Phase 0 baseline |
| Any problem report | E5 voice note or text (evidence rule, R47) | Literacy-tolerant; the reviewer hears it in the queue |

### 5.3 Sub-minute capture flows (built; stopwatch budgets for field testing)

- **W-01 (40 s):** tap card, number pad focused with "last: 62" beside the field, type tank and pool %, camera, one photo, Done.
- **C-01 (45 s):** tap card, bundle count, photo of the stack and board, Done.
- **C-E1 (60 s, heaviest):** the card shows "Last spray: Emamectin benzoate (group 6). Use a different group: Chlorantraniliprole (28), Spinetoram (5)"; product picker (one tap), batch number, rate pre-filled, block confirm, label photo, Done.
- **Problem (20 s):** Problem button, hold to record a voice note, Send.
- Every flow ends the same way: the card flips to "Reported, will sync", the badge counter rises. No flow has a required free-text field.

### 5.4 Offline capture, the three queues and the media cache (built)

Following ODK, CommCare and Fulcrum (R22, R43): capture is complete when the person taps Done, whatever the signal.

| Queue (IndexedDB) | Holds | Drains |
|-------------------|-------|--------|
| `outbox_events` | Field events as JSON, a few hundred bytes each, each with its `event_uuid` | On any connectivity, in order, batched to `/api/sync/events`; duplicates are success |
| `outbox_media` | Photo, video and voice blobs, with per-file status (waiting, uploading, failed), attempt count and last error | Upload starts on capture; resumable 256 KB chunks; video waits for Wi-Fi when the "videos on Wi-Fi only" switch is on (default) |
| `outbox_decisions` | Owner and task manager decisions (accept, send back, approve or deny skip, unblock) with their own `event_uuid` | Replayed to `/api/instances/:id/decision`; a decision refused because someone else already decided (400 or 409) is kept (last 20) in the local `meta` store as `decision_conflicts` and shown |
| `media_cache` | Evidence downloaded for review | Lets an owner or task manager review photos, video and voice offline |

The **Sync screen** (from the badge) lists records waiting, each file with its status and error and a Retry button, decisions waiting and decisions that did not apply, with a Sync now button. The day bundle (plan, open tasks, templates, reference data, active windows, last values) is cached so a signal-dead morning has the whole day. Storage target for entry-level phones: photos about 150 to 250 KB at 1280 px, video 480p 20 s (2 to 4 MB), voice about 100 KB.

**Evidence hold (built).** Events reference media by `media_uuid` before the bytes arrive. A task reported done whose files are still uploading stays at `done_reported`; the moment the last file is stored it goes to the acceptance queue. After 24 hours with files still missing it goes to the queue anyway, flagged `media_not_uploaded`, so the reviewer can send it back or accept on other grounds.

### 5.5 Physics checks: verification without cameras (built)

- **Water balance:** tank change between W-01 readings against pump hours x 6,000 L, less irrigation and stock water; persistent deficit fires T5.
- **Feed balance:** poultry feed stock against summed daily consumption within 10%; drift is a quiet owner exception.
- **Harvest sanity:** bundles against mature beds; outliers beyond 2 sigma flag `harvest_sanity`.
- **Timing sanity:** a long task reported seconds after the plan synced flags `timing_sanity`; device clock skew is measured at each sync so honest drift does not read as fraud.
- **Rotation:** same IRAC group twice in a row flags `rotation_breach` (3.4).

A flagged task is never rejected automatically; it goes to the queue with the flag shown and is excluded from "accept all".

### 5.6 The acceptance flow (built, new in v1.1)

```
caretaker: Done (offline OK) ──► done_reported
    │ all files stored? ── no ──► hold (sweep re-checks every 5 min; 24 h ► queue with media_not_uploaded)
    │ yes
    ▼
review_required {flags: [awaiting_acceptance, ...any sanity flags]} ──► needs_review
    ▼
Review queue (owner, task manager; works offline from cache)
    ├─ Accept ─────────► verified_closed {verification: {method: accepted, by, role, note}}
    ├─ Send back ──────► rejected_reopened {note (required), new_due_at: tomorrow 12:00}
    │                    rejection_count + 1; WhatsApp "sent back" to the caretaker; task back on their list
    └─ Accept all ─────► every "ready" task (only flag awaiting_acceptance, no VIM fail or unusable)
```

**The card** shows the task, who reported it, when and how (app or WhatsApp), the readings, every photo (tap to zoom, full image, nothing cropped), playable video and voice notes, the flags in plain words ("Same group as the previous spray (6)", "2 files still uploading"), any VIM annotation, and the rejection count. Decision time target: under 10 seconds per clean task, one tap for the whole clean batch.

**Who may accept:** any active owner or task manager; never the caretaker (enforced at the sync endpoint, 3.2). The event records the person and role, so "accepted by" is auditable per task.

### 5.7 Video Intelligence Module v1.1 as an advisory verifier (built contract)

VIM does not move tasks. It annotates field video so the reviewer can decide faster, and a concern keeps the task out of "accept all".

**Feed and callback (all calls carry header `x-vim-secret: <VIM_WEBHOOK_SECRET>`; without the secret configured the feed is off):**

```
GET  /api/vim/pending?limit=20
  200 { videos: [ { media_uuid, instance_id, bytes, captured_at,
                    task: "A-05 Tank integrity inspection", profile: "leak_scan" | null,
                    download: "/api/vim/media/<media_uuid>" } ] }
      -- stored videos with no verdict yet, oldest first

GET  /api/vim/media/:media_uuid        -- the video bytes, with its content type

POST /api/webhooks/vim
  { media_uuid, instance_id, verdict: "pass"|"fail"|"unusable"|"uncertain",
    confidence: 0..1, extracted: { reason, ...profile fields }, model_version }
  200 { ok: true }                     -- stored in vim_verdicts; shown on the card
```

**Profiles** are named in each template's `evidence_policy.vim_profile`. Video-bearing templates today: A-05 (`leak_scan`), and W-E2, K-E1 and P-E2 (no profile; VIM receives `profile: null` and applies its general check). The photo profiles already written into policies (`tank_gauge`, `bundle_count`, `wet_line`, `trough_feed`, `chick_spread`, `bcs_assist`, `spray_scene`, `repair_pair`; definitions as in v1.0 §5.5) stay dormant until VIM accepts stills (7.3).

**Effect on acceptance:** `pass` and `uncertain` are shown, nothing more; `fail` or `unusable` show as a concern and remove the task from "accept all", so a person looks at it individually. VIM outage changes nothing: the queue simply has no annotations. Every verdict carries `model_version`, so an agreement rate against human decisions can be computed later if wanted (not a KPI in v1.1).

---

## 6. Data model additions and endpoint contracts

### 6.1 Schema as built (PostgreSQL), by migration

All tables carry `id uuid primary key`, `created_at`, `updated_at` unless noted. Only what the v1.0 design did not already state is annotated.

| Migration | What it adds or changes |
|-----------|-------------------------|
| 001_schema | The v1.0 model: `users`, `devices`, `assets`, `locations`, `herds`, `animals`, `batches`, `inventory_items`, `inventory_moves`, `task_templates`, `task_instances` (3.1), `task_events` (append-only, UPDATE and DELETE refused by trigger), `readings`, `rules`, `escalation_profiles`, `daily_plans`, `media_objects`, `vim_jobs`, `vim_verdicts`, `wa_contacts`, `wa_messages`, `notifications_log`, `farm_settings (key text primary key, value jsonb)`, `meter_accumulators` |
| 002_perf_indexes | Indexes for the sweeps: open instances by state and due time, events by instance and server time, readings by metric and time |
| 003_farm_details | `locations.hectares`, `soil`, `status` (active, to_clear, lost); `herds.breed`, `location`, `notes`; `batches.purpose` (layers, broilers) |
| 004_accounts | `users.active` (deactivate, never delete: events reference people), `token_version` (bumped on password change or deactivation; every older sign-in stops working), `must_change_password`, `last_login_at`; unique lower-case email |
| 005_signup | `users.pending_approval`: self sign-up waits for an owner |
| 006_integrations | `users.wa_opt_in`; `wa_messages.to_phone`, `kind`, `error` for the activity view. (Its photo-check cost columns on `vim_jobs` are now unused.) |
| 007_manual_acceptance | Role `manager` (task manager) on `users.role`; `manager` on `task_events.actor_type`; queued photo-check jobs closed (the acceptance sweep picks up the tasks) |
| 008_farm_brief | Asset kind `pipeline` (the reticulation mainline under upgrade) |

**Settings documents (`farm_settings`, jsonb), each a contract:**

```
water_params      { tank_usable, tank_usable_range: [80000,125000], tank_usable_measured: bool,
                    pool_l: 45000, borehole_lph: 6000, ... }     -- A-P4 overwrites tank_usable
scaling_plan      { from: "2026-07-01", to: "2027-06-30",
                    milestones: [{ key, title, target, project?, status?: done|blocked|auto, note? }] }
poultry_plan      { breed, target_layers, batch_size, order_lead_days, house_rotation[], placements[] }
kale_plan         { target_plants: 10000, target_bundles_per_day: [330,400], price_usd_per_bundle: 1,
                    target_revenue_usd_month: [10000,12000], plants_per_bundle_week, ... }
faw_history       [{ date, product, irac_group, block, note }]
absence_mode      { active, from, until, deputy_contact }
integrations      { whatsapp: { token*, phoneId, verifyToken, appSecret*, apiVersion, language,
                    reminders, morningPlan, morningTime, ownerAlerts, sentBack } }   -- * never returned
active_windows    [{ kind: phi|withdrawal, subject_id, product, until }]
forecast, suppressions, irrigation_demand, water_balance, wa_morning_sent   -- engine state
```

**Fold discipline (unchanged):** `task_instances`, `readings`, `inventory_moves`, herd and batch counts, `water_params.tank_usable` (from A-P4) and the meter accumulators are projections of `task_events`; they can be rebuilt from the log.

**Proposed additions (not built):** `media_objects.gps geography` populated from the phone (column exists, capture not yet wired); `animals` rows per tagged Nguni and Sanga animal once the herd is tagged (K-03 then scores named animals); a `buyers` table if kale sales move to account customers.

### 6.2 Endpoint contracts (as built)

Authentication: `Authorization: Bearer <JWT>`; the token carries user id, role and `token_version`. Roles: `owner` (and legacy `admin`), `manager`, `caretaker`. "Console" means owner, admin or manager.

```
AUTH
POST /api/auth/login        { email, password } -> { token, user }      401 wrong; 403 pending approval or inactive
POST /api/auth/signup       { name, email, password, phone? } -> 201 { ok, pending_approval: true }   409 email taken; 429 too many waiting
GET  /api/auth/me           -> { user }
PATCH /api/auth/me          { name?, email?, phone?, wa_opt_in? }
POST /api/auth/password     { current, next } -> new token (older sign-ins end)

PEOPLE (owner)
GET  /api/users             GET /api/users/pending-count
POST /api/users             { name, email, role, phone?, password? } -> 201 { user, temp_password (generated if none given, shown once) }
PATCH /api/users/:id        { role?, active?, phone?, name? }
POST /api/users/:id/approve | /decline | /reset-password

SYNC (everyone)
POST /api/sync/events
  { device_id, events: [{ event_uuid, instance_id, type, payload, device_time }], cursor? }
  -> { accepted: [uuid], duplicates: [uuid], rejected: [{ event_uuid, reason }],
       server_events: [{ event_uuid, instance_id, actor_type, type, payload, server_time }], cursor }
  Rules: idempotent on event_uuid; actor_type set from the account's role; caretakers may send only
  field events (3.2), others are rejected with reason "not allowed for your role"; illegal transitions
  are rejected per event, never the batch.
GET  /api/sync/notes[?kind=clock]  -> { notes: [{ event_uuid, note, device_time, server_time, by, media: [{ media_uuid, kind, status }] }] }
                         (farm notes, or clock-ins and outs with kind=clock: field_recorded events with instance_id null and payload
                          { note, media: [uuid] } or { clock: in|out };
                          written through POST /api/sync/events and media initiate without an instance)
GET  /api/sync/bundle?date=  -> { date, plan: {...instances}, open_instances, templates_delta,
                                  reference_delta: { assets, locations, batches, inventory },
                                  active_windows, last_values }

MEDIA
POST  /api/media/initiate   { media_uuid, instance_id, kind: photo|video|audio, bytes, sha256,
                              captured_at, mime, exif? } -> { upload_id, chunk_size: 262144, offset }
                              (offset > 0 resumes a part-sent file)
PATCH /api/media/:upload_id  raw chunk, header Upload-Offset -> 204
POST  /api/media/:upload_id/complete -> { stored: true, sha256, phash, phash_match }
                              (storing the last file of a done task releases it to the queue)
GET   /api/media/:media_uuid  -> bytes with content type (any signed-in person)

PLAN, TASKS AND DECISIONS
GET  /api/plan/today                 -> { date, plan, instances }   (caretaker: own and unassigned)
GET  /api/instances/:id              -> { instance, events, media, verdicts }
GET  /api/instances?state=decisions  (console) -> { instances: [ ...instance,
        review_flags, reported: { at, by, via }, media: [{ media_uuid, kind, status }],
        vim: [{ verdict, confidence, note, model }], ready_to_accept } ]
POST /api/instances/:id/decision     (console)
        { action: accept|send_back|approve_skip|deny_skip|unblock|cancel|reassign,
          note (required for send_back), assignee_id?, event_uuid? (offline replay key) }
        -> { ok, state } | { ok, duplicate: true } | 400/409 { error } (already decided, illegal)
POST /api/instances/accept           (console) { ids: [uuid] (max 200), note? } -> { accepted, skipped }
        (only "ready" tasks are accepted; others come back in skipped with a reason)

OWNER CONSOLE (owner, admin, manager unless noted)
GET  /api/owner/digest?date=     GET /api/owner/kpis?period=7|30     GET /api/owner/farm
GET  /api/owner/plan             -> { from, to, milestones[], projects, kale, poultry }   (3.7)
POST /api/owner/plan/:key        { status: done|blocked|auto, note? } -> plan
POST /api/owner/release-task     { template_code, title?, note? } -> 201 { id }
                                 (templates with no schedule only: projects, P-09, event tasks)
GET  /api/owner/water            POST /api/owner/water/config (owner)   GET /api/owner/rain
POST /api/owner/absence (owner)  POST /api/owner/release-now (owner)    POST /api/owner/forecast/refresh
GET  /api/templates  POST /api/templates  POST /api/templates/:id     (owner; versioned)
GET  /api/rules      POST /api/rules/:id/toggle                        (owner)
POST /api/devices/register  { platform, push_token? } -> { device_id }
POST /api/devices/:id/restore -> working set for a replacement phone   POST /api/devices/:id/revoke (owner)

INTEGRATIONS (owner)
GET  /api/integrations -> { whatsapp: { ...settings, tokenSet, tokenHint, configured }, templates, webhook_url }
POST /api/integrations { whatsapp: {...} }       POST /api/integrations/whatsapp/test { to? }
GET  /api/integrations/activity -> recent messages with status and errors

WEBHOOKS AND VIM
GET  /api/webhooks/whatsapp   Meta verification handshake (verify token)
POST /api/webhooks/whatsapp   messages and statuses; X-Hub-Signature-256 checked; idempotent on wa_message_id
GET  /api/vim/pending  GET /api/vim/media/:uuid  POST /api/webhooks/vim     (x-vim-secret; 5.7)
GET  /api/health
```

### 6.3 Sync and identity rules (built)

- The phone holds the day bundle, open tasks, its three outboxes and the media cache. Everything else is server-only.
- A 401 during sync pauses the drain and asks the person to sign in again; nothing queued is dropped.
- Changing a password, resetting it or deactivating a person bumps `token_version`; every older sign-in on every phone stops working at its next request.
- A replacement phone signs in and pulls the bundle; whatever the old phone had not synced is lost only if that phone is gone, which is why the badge and the Sync screen keep the backlog visible.

---

## 7. Integration split: this repository, app v1.2 and backend specification v2.0

### 7.1 Where things stand

This repository is a complete, working implementation of the layer (Node and Express, PostgreSQL, React PWA wrapped as an Android APK, Docker images on GHCR behind Caddy, deployed on the owner's Google Cloud instance). The Farm Manager **app v1.2**, the **backend specification v2.0** and **VIM v1.1** code are not in this repository; I have not seen them. The split below states that assumption plainly: wherever v1.2 and v2.0 differ from this stack, the contracts in Section 6 are the interface, and the columns below say what moves.

### 7.2 Drops in as it stands

| Piece | Why it drops in |
|-------|-----------------|
| Schema (6.1) | Additive tables and columns; existing users and roles map to owner, manager, caretaker |
| Task, decision, acceptance and plan routes | Express routers behind the existing JWT middleware |
| Release engine, rules, escalation, acceptance sweep, morning list | One always-on Node process with node-cron (04:15 forecast, 04:45 release then planned releases, five-minute sweep, 19:00 digest) |
| WhatsApp gateway | Self-contained webhook plus sender; touches nothing else |
| Owner console, review queue, plan section | Screens in a React app; no shared state with other features |
| Digest and KPIs | Read-only SQL |

### 7.3 Needs architecture change in v1.2 or v2.0, each specified

1. **Client outbox and caches (largest).** If v1.2 writes straight to the server, it needs the IndexedDB stores of 5.4 (`plan`, `outbox_events`, `outbox_media`, `outbox_decisions`, `media_cache`, `meta`), a drain loop on connectivity and visibility events, and capture screens that write locally first.
2. **Append-only ingestion.** If v2.0 mutates task rows CRUD-style, add `/api/sync/events`, the fold, the no-update trigger on `task_events`, and the role allow-lists (3.2). Keep CRUD for owner screens.
3. **Resumable media.** If v2.0 uses single multipart uploads, add initiate, chunk and complete (6.2) and file storage outside the database.
4. **Acceptance as a server state.** v2.0 needs `needs_review` with the `awaiting_acceptance` flag, the evidence hold, and decisions that carry their own `event_uuid` for offline replay.
5. **VIM v1.1 changes.** Today (as I understand it) a person runs VIM on a video. Needed: a headless loop that polls `/api/vim/pending`, downloads, analyses with the named profile, posts the verdict with `model_version`, all with the shared secret. For the photo profiles to wake up, VIM needs stills support (a model-serving change). VIM must never write task state.
6. **Scheduler.** If v2.0 runs serverless or request-driven only, add an always-on worker or cron container; the timers above must fire with no traffic.
7. **Push notifications (optional).** FCM in the APK wrapper for pre-due nudges; the cached plan and WhatsApp make this an improvement, not a dependency.

### 7.4 Sections of v1.2 and v2.0 I need to finalise the split

Paste, as written: (1) v2.0's API surface and schema; (2) any v2.0 section on mobile persistence, caching or sync; (3) VIM v1.1's interface (how it is invoked, input format, video only or stills, output schema); (4) v2.0 infrastructure (hosting, scheduler or queue, where media is stored, backups); (5) v2.0 auth and roles (token lifetime, role model). Nothing else is needed.

---

## 8. Rollout from October 2026 (sequenced against Phase 0 and the scaling plan)

Principle unchanged: **log before you automate, automate before you enforce.** Each phase has a gate held for two consecutive weeks.

| Phase | When | What switches on | Gate |
|-------|------|------------------|------|
| R0 Live now | Done, October 2026 | Server on Google Cloud; owner account; caretaker sign-up and approval; daily taxonomy; offline capture; manual acceptance; WhatsApp once credentials are entered | Caretaker records W-01 twice daily and C-01 daily for 10 days; median sync under 12 h |
| R1 Acceptance habit | Late Oct to mid Nov 2026 | Task manager account (if appointed); review queue worked daily; "accept all" for clean items; WhatsApp templates approved; morning list on | Median time to accept under 24 h; first-time acceptance at or above 80% |
| R2 Phase 0 tracked | Nov to 15 Dec 2026 | A-P1 to A-P4 released from the Farm Map screen; A-05 baseline walk-round video; measured usable volume replaces the estimate (T1 recalibrates itself) | Phase 0 milestone shows Done with the measured litres |
| R3 Rains and plantings | Nov 2026 to Jan 2027 | C-09 sorghum SV4 and maize with the effective rains; T2 rain rule; T3 armyworm with the rotation check; K-04 weekly tick control; first poultry placement 3 Nov (P-09 order released 13 Oct) | Two trigger firings handled end to end; no rotation breach accepted unreviewed |
| R4 Reticulation and kale scale-up | Jan to Mar 2027 | A-P5 to A-P8; drip efficiency entered per bed; kale beds added toward 10,000 plants; FAO-56 ledger in shadow beside the tank budget | Reticulation milestone Done by 31 Mar 2027; planner and ledger agree within 15% |
| R5 Scale and resilience | Apr to Jun 2027 | Poultry toward 1,000+ layers (placements to 1 Jun); VIM headless loop on video if VIM v1.1 is changed (7.3 item 5); absence drill during a real owner trip; spare handset restore drill | June 2027 month-end pack (F-04) produced from system data alone; kale at or near 330 bundles a day |

Dependencies: T1 thresholds wait on Phase 0's measured volume (the estimate is deliberately conservative until then); FAO-56 switches on only after a season of shadow data; VIM advisory waits on its headless loop and changes nothing if it never arrives.

---

## 9. Governance: RACI, KPIs and failure modes

### 9.1 RACI (R does, A owns the decision, C consulted, I informed)

| Process | Owner | Task manager | Caretaker | System |
|---------|-------|--------------|-----------|--------|
| Daily plan execution and evidence | A, I (digest) | I, supervises | R | releases, reminds |
| **Accepting completed work, sending back** | A (and may do it) | **R** | I (outcome, reason on WhatsApp) | holds until evidence arrives; flags; queue-ageing alert |
| Skip requests and problem reports | A | R | R (raises) | absence auto-approve with flag |
| Irrigation plan and low-water protocol | A (protocol agreed) | C | R | computes, fires T1 |
| Spray and chemical decisions | A | C | R (applies) | rotation check, pre-harvest guard |
| Livestock treatment, sick animal | A | C | R (first response) | withdrawal window |
| Poultry batches and vaccination | A (programme, chick orders) | C | R | releases order, placement and chain |
| Scaling plan milestones and project steps | A | R (releases steps, marks) | R (does the work) | computes progress |
| Sales, cash, reconciliation | A | C | R | variance exception |
| Purchases and stock | A, R | C | R (receives, counts) | reorder proposals |
| People and accounts | A, R | none | none | token revocation |
| WhatsApp and farm settings | A, R | none | none | delivery log |
| Templates, rules, thresholds | A, R | C | C (feasibility) | versions everything |

Rules: the caretaker is never accountable for a reserved decision (spend, chemicals, culls), so an unanswered decision escalates rather than defaulting onto them; a person cannot accept their own work (enforced: caretakers cannot send decision events; an owner or manager who did field work themselves should leave acceptance to the other, recommended practice, not enforced).

### 9.2 KPIs (computed server-side; owner dashboard, weekly digest, F-04)

| KPI | Definition | Target |
|-----|------------|--------|
| On-time completion, P0 and P1 | Closed by grace end over released, weekly | at or above 90% |
| Overall completion | Closed or approved skip over released | at or above 85% |
| **Accepted first time** (new) | Closed with `rejection_count = 0` over evidence-bearing closures | at or above 85% |
| **Median hours to accept** (new) | `needs_review` entry to acceptance | under 24 h |
| **Waiting for acceptance** (new) | Count in `needs_review` now; oldest age | under 10; none over 24 h |
| Evidence integrity flags | pHash, timing and physics flags per week | trending to zero |
| Media not uploaded | Tasks flagged `media_not_uploaded` per week | zero |
| Median sync latency | server minus device time | under 6 h |
| Kale output | Bundles per day, 7-day mean, against 330 to 400 | on plan curve |
| Revenue run rate | 30-day recorded sales, against US$10,000 to 12,000 a month | on plan |
| Layers now | Birds in layer batches, against 1,000+ by June 2027 | per placement calendar |
| Cattle condition | Median BCS against 2.5 to 3.0 | rising to 3.0 by 31 Jan 2027 |
| Water pumped against plan | W-02 hours x 6,000 L against demand | 90 to 110% |
| Poultry mortality | Weekly % per house | under 0.5% |
| Maintenance compliance | Meter and calendar services on time | at or above 90% |
| Dark-farm incidents | T9 firings per quarter | zero |

Removed in v1.1: auto-verification rate and VIM agreement (no machine closure any more).

### 9.3 Failure-mode register

| Failure | Detection | Mitigation |
|---------|-----------|------------|
| **Acceptance queue rots** (new) | Queue-ageing alert at 24 h; KPI | "Accept all" for clean items; appoint a task manager; absence fallback only without a manager |
| **Evidence never uploads** (new) | Hold; `media_not_uploaded` at 24 h; Sync screen per-file errors | Retry per file; Wi-Fi-only switch for video; reviewer decides on other grounds or sends back |
| **Two people decide the same task offline** (new) | Second decision refused | Shown under "Decisions that didn't apply"; nothing overwritten |
| Caretaker phone broken or lost | T9 within 24 h | WhatsApp from another registered phone as a stopgap; paper day card for up to 72 h, entered later as corrections; replacement phone signs in and pulls the day; owner deactivates the old sign-in |
| Data bundle exhausted | Sync latency; T9 | Data as a farm input bought by the owner monthly; outbox holds days; events are tiny |
| Caretaker leaves | Notice or T9 | Instructions live in every template; reassign to a new account; history and stock current to the last sync |
| Evidence gaming | pHash, timing, physics, gallery stamp, VIM concern | Flagged and reviewed by a person, never auto-accused; skip is one tap, so honesty is cheaper |
| WhatsApp number or template restricted | Delivery errors in the activity view | Utility templates kept genuinely informative; the app works fully without WhatsApp |
| VIM down | No annotations | Nothing changes: acceptance is human |
| Borehole or pump failure | T5, W-E2, P0 report | W-E1 rationing (stock water never cut); pool buffer about 2 days; P0 repair |
| Server down | Outbox grows; uptime check | Phones work offline; idempotent replay; projections rebuildable; nightly off-site database backup (to set up on the Google Cloud instance, open item) |
| Owner unreachable | Queue ageing | Task manager continues; deputy contact for owner rungs; P0 still reaches the owner |
| Stolen phone or SIM swap | T9, unusual activity | Deactivate the account (token revoked); WhatsApp ignores unknown numbers; webhooks signed |

---

## 10. Feature audit against the farm brief

Status: **Built** (in this repository, tested), **Partial** (built with a named gap), **Proposed** (specified, not built), **Needs input** (waiting on the owner).

| Brief item | Status | Where |
|------------|--------|-------|
| Offline capture: record, photo, video, voice; sync when coverage returns | Built | 5.4; Sync screen; resumable uploads |
| Upload items offline (gallery photos and files) | Built | Attachments panel: camera, gallery, video, voice |
| Owner and task manager decisions offline | Built | `outbox_decisions`, media cache |
| Photos not checked by Claude; uploaded and logged with the task; admin or task manager accepts | Built | 5.6; Claude integration removed |
| Task manager role | Built | 3.2, 6.2, 9.1 |
| Caretaker self sign-up, owner approval | Built | 6.2 |
| App menu in the Tend layout: Dashboard (weather, week to date against last week, labour hours by person), Tasks (+ to add a task or note), Review, Sales (totals, customers from the buyer field), Notes, Farm Map, Crop Plan by Crop and by Map, Time & Attendance, Field Walk, Logs, Rain, Water, KPIs, Settings, Help | Built | Side menu; Notes (offline, with photos, video, voice), crop plan from the cached bundle, Time & Attendance with offline clock in and out plus the F-02 sheets, a header bell (decisions waiting, or overdue tasks for a caretaker) and globe (English or Shona menu; Shona to be checked by a speaker), Field Walk as the day's walking and scouting tasks |
| WhatsApp reminders, morning list, sent-back notices, owner alerts | Built (needs Meta credentials) | 4.4 |
| Water: borehole 6,000 L/h, main tank 80,000 to 125,000 L, pool 45,000 L | Built | `water_params`; T1, T5; irrigation planner |
| Phase 0 tank rehabilitation, measured usable volume | Built | A-P1 to A-P4; milestone; A-05 baseline |
| Reticulation 40 mm PVC sprinklers to 63 mm HDPE and drip | Built | A-P5 to A-P8; milestone; RETIC-MAIN asset |
| Kale toward 10,000 plants, 330 to 400 bundles a day, US$1 a bundle, US$10,000 to 12,000 a month | Built | `kale_plan`; C-01, C-02; milestone; KPI |
| Crop varieties (sorghum SV4, maize, tomato Rodade, onion Texas Grano, kale) | Built | Locations and C-09, C-10, C-11 |
| Maize FAW treated with emamectin benzoate; rotation | Built | `faw_history`; C-E1 rotation check |
| Nguni and Sanga cattle at BCS 2.5 on the 90-day ration | Built | Herd; K-01, K-03; 90-day chain; milestone |
| Black Australorp toward 1,000+ layers, staggered hatching | Built | `poultry_plan`; P-09, P-08; chain; milestone |
| Land: 2 ha homestead in use, 112.2 ha to clear and graze, 5 ha lost to mining | Built | Locations with status |
| Homestead crop split | Needs input | Owner to supply; beds then carry plant counts |
| Scaling plan July 2026 to June 2027 | Built | 3.7 |
| Research with named products, confirmed versus inferred | Built (document) | Section 1 |
| Taxonomy, engine, escalation, evidence, data model, integration split | Built (document) | Sections 2 to 7 |
| VIM v1.1 wired as an automatic verifier | Partial | Contract built and advisory (5.7); VIM's headless loop is VIM-side work (7.3) |
| Goats and pigs | Needs input | 2.8 templates proposed |
| Poultry vaccination programme against the hatchery and vet | Needs input | 2.6 chain uses a standard programme |
| SMS fallback | Proposed | Stub in the notifier |
| GPS on evidence | Proposed | Column exists |
| OS-level scheduled notifications | Proposed | 4.1 |
| Nightly off-site backup | Proposed | 9.3 |
| App v1.2 and backend v2.0 alignment | Needs input | 7.4 |

---

## 11. Conformance and open items

| Brief requirement | Where met |
|-------------------|-----------|
| Research first, named products, inference marked | Section 1 (R1 to R52; 19 new in this revision; status column on every finding) |
| 1. Canonical operations taxonomy | Section 2 (all coded tasks, projects, chains, kale arithmetic) |
| 2. Task engine | Section 3 (object model, state machine with acceptance, S1 to S6, T1 to T9 with the rotation guard, irrigation, assignment, milestones) |
| 3. Reminder, nudge and escalation | Section 4 (ladder, missed once, twice, during absence, queue ageing, WhatsApp flows and exact templates) |
| 4. Logging and evidence, VIM as automatic verifier | Section 5 (classes, proof per task, sub-minute flows, offline queues, physics checks, acceptance, VIM advisory contract) |
| 5. Data model and endpoint contracts | Section 6 |
| 6. Integration split | Section 7 |
| Offline, under a minute per task, verifiable off site | 5.3 budgets; 5.4 queues; 5.6 acceptance card with full evidence |
| Photos not run through Claude; accepted by admin or task manager | 5.6; change log |
| Specification depth, no full application code | Contracts, state machine, rules and settings documents; the code itself lives in the repository |
| British English, no em dashes | Applied |

**Open items for the owner:**

1. **Cattle count** per breed (Nguni, Sanga) and whether animals are tagged (K-03 then scores named animals).
2. **Goats and pigs:** present or planned? If yes, 2.8 is switched on.
3. **Poultry:** current layer count (the seed assumes 250), confirmation of the six placement dates, hatchery and vet's vaccination programme.
4. **Fall armyworm:** date of the emamectin benzoate spray on the maize, and which alternatives are actually in the store.
5. **Homestead crop split** across the 2 ha (beds, crops, plant counts).
6. **Task manager:** who, and their phone number for WhatsApp.
7. **WhatsApp:** Meta credentials entered and the five templates submitted for approval (WHATSAPP-SETUP.md).
8. **Backups:** agree a nightly off-site database backup on the Google Cloud instance.
9. **v1.2, v2.0 and VIM v1.1:** the sections listed in 7.4.
