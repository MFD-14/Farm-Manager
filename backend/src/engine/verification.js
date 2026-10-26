// Verification routing (spec 3.2 guards, 5.4 physics, 5.5 VIM thresholds).
import { randomUUID } from "node:crypto";
import { timingSanity, harvestSanity } from "./physics.js";

async function appendSystemEvent(c, instanceId, type, payload = {}) {
  // Local import to avoid a cycle at module load.
  const { foldEvent } = await import("./fold.js");
  return foldEvent(c, {
    event_uuid: randomUUID(),
    instance_id: instanceId,
    actor_type: type === "auto_verified" ? "vim" : "system",
    type,
    payload,
  });
}

// Called by the fold when done_reported lands, and again by the media completion
// handler when a deferred blob arrives.
export async function routeAfterDoneReported(c, instance, policy, evidenceCheck, event) {
  const flags = [];

  // Field-level deficiencies are review-worthy; media shortfalls only mean the
  // blob has not arrived yet (spec 5.3) and are handled by waiting below.
  if (evidenceCheck.field_problems?.length) {
    flags.push({ kind: "evidence_short", detail: evidenceCheck.field_problems });
  }

  const timing = await timingSanity(c, instance, event);
  if (timing) flags.push(timing);

  if (instance.template_code === "C-01") {
    const sanity = await harvestSanity(c, instance);
    if (sanity) flags.push(sanity);
  }

  // Fall armyworm resistance management: the same IRAC group twice running.
  if (instance.template_code === "C-E1") {
    const { rotationFlag } = await import("./plans.js");
    const rot = await rotationFlag(c, instance, event?.payload?.fields || instance.evidence_summary?.fields);
    if (rot) flags.push(rot);
  }

  if (flags.length) {
    await appendSystemEvent(c, instance.id, "review_required", { flags });
    return;
  }

  const needsMedia = (policy.classes || []).some((cl) => ["E2", "E3", "E4", "E5"].includes(cl)) || policy.any_of;

  if (!needsMedia) {
    // E0 / E1-only tasks: sampled-none verification closes immediately (spec 3.2).
    await appendSystemEvent(c, instance.id, "auto_verified", {
      verification: { method: "sampled_none", verdict: "pass", confidence: 1 },
    });
    return;
  }

  if (evidenceCheck.media_short) {
    // Deferred media (spec 5.3): record is complete, verifiable pending media.
    // Caretaker escalation timers stop at done_reported; media completion
    // re-runs this routing.
    return;
  }

  // All required evidence is in. Photos, video and voice notes are not
  // machine-checked (owner decision, Oct 2026): the task waits in the
  // acceptance queue until an owner or task manager accepts it or sends it back.
  // Photos attached offline can be reported before their bytes arrive: wait
  // ("evidence uploading") until every file is on the server, so nobody is asked
  // to accept a task whose photo they can't see. The media completion handler
  // and the acceptance sweep re-run this routing.
  const media = instance.evidence_summary?.media || [];
  const uuids = media.map((m) => m.media_uuid).filter(Boolean);
  const stored = uuids.length
    ? (await c.query(`SELECT count(*)::int AS n FROM media_objects WHERE media_uuid = ANY($1) AND status = 'stored'`, [uuids])).rows[0].n
    : 0;
  if (stored < uuids.length) return;
  await appendSystemEvent(c, instance.id, "review_required", {
    flags: [{ kind: "awaiting_acceptance", media: media.length }],
  });
}

// Evidence that never finished uploading still reaches a person: after a day
// the task goes to the queue flagged, rather than waiting out of sight.
export async function flagMissingMedia(c, instance) {
  const uuids = (instance.evidence_summary?.media || []).map((m) => m.media_uuid).filter(Boolean);
  const stored = uuids.length
    ? (await c.query(`SELECT count(*)::int AS n FROM media_objects WHERE media_uuid = ANY($1) AND status = 'stored'`, [uuids])).rows[0].n
    : 0;
  await appendSystemEvent(c, instance.id, "review_required", {
    flags: [{ kind: "media_not_uploaded", expected: uuids.length, received: stored }],
  });
}

// A task is "ready to accept" when the only reason it is waiting is the
// acceptance step itself (no evidence shortfall, timing or physics flag).
export function acceptanceOnly(flags) {
  return Array.isArray(flags) && flags.length > 0 && flags.every((f) => f.kind === "awaiting_acceptance");
}

// Video Intelligence Module annotations (VIM v1.1 analyses field video). They
// are advisory: stored and shown on the acceptance card next to the evidence,
// never moving a task by themselves.
export async function applyVimVerdict(c, verdict) {
  await c.query(
    `INSERT INTO vim_verdicts (media_uuid, instance_id, verdict, confidence, extracted, model_version)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [verdict.media_uuid, verdict.instance_id, verdict.verdict, verdict.confidence,
     verdict.extracted || {}, verdict.model_version || "unknown"]);
}
