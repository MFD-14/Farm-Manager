# Woodlands Farm Manager — v1 prototype

`woodlands-farm-manager-v1.jsx` is the v1 prototype of the Woodlands Farm Manager,
carried over verbatim from the claude.ai chat where it was built. It is a single-file
React component designed to run as a claude.ai artifact, which means it has two
environment dependencies that do not exist in a normal browser build:

- `window.storage` — the artifact key-value persistence API (used for tasks,
  observations, media index, photos, and video frames).
- Direct `fetch` calls to `https://api.anthropic.com/v1/messages` without an API
  key header — the artifact runtime injects auth. Outside that runtime these calls
  need a server-side proxy and a real API key.

## What it demonstrates

- Dashboard, crop planning library, livestock management (herds, health log,
  vaccination schedules), task manager, field-walk photo observations
- Camera capture (getUserMedia) and photo gallery with lightbox
- Video field walks: MediaRecorder capture (90 s cap), client-side frame
  extraction to canvas, per-frame Claude Vision analysis, aggregate
  growth-stage/health scoring, progress timeline, and staggered-batch comparison
- Pest/disease identifier and livestock health advisor backed by Claude
- WhatsApp hub mock, yield estimator, Kwekwe climate calendar, farm map

## Relationship to the spec

The production build is specified in `../docs/woodlands-farm-ops-spec-v1.0.md`
(WFM-OPS-SPEC v1.0): an append-only evidence event log, server-side task state
machine, escalation, and a WhatsApp ingest path on a Node/Express + PostgreSQL +
Redis backend with a React PWA client. This prototype is the functional and visual
reference for that build — the screens, flows, seed data shapes, and the Claude
Vision prompts/JSON contracts it established.
