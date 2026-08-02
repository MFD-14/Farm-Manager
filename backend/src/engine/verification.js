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

  // All required media attached. Queue VIM jobs for blobs that exist server-side;
  // ones still uploading are queued by the completion handler.
  const vimProfile = policy.vim_profile;
  if (vimProfile) {
    let queued = 0;
    for (const m of instance.evidence_summary?.media || []) {
      const exists = await c.query(`SELECT 1 FROM media_objects WHERE media_uuid = $1`, [m.media_uuid]);
      if (!exists.rows.length) continue;
      await c.query(
        `INSERT INTO vim_jobs (media_uuid, instance_id, profile, context)
         SELECT $1, $2, $3, $4
         WHERE NOT EXISTS (SELECT 1 FROM vim_jobs WHERE media_uuid = $1 AND instance_id = $2)`,
        [m.media_uuid, instance.id, vimProfile,
         { task_code: instance.template_code, subject: instance.subject_id, expected: instance.params?.expected || {} }]);
      queued += 1;
    }
    // Stays at done_reported until verdicts arrive.
    return;
  }
  // Media required but no VIM profile: auto-verify on presence.
  await appendSystemEvent(c, instance.id, "auto_verified", {
    verification: { method: "media_present", verdict: "pass", confidence: 1 },
  });
}

// Applied when a VIM verdict arrives (worker or webhook). Thresholds per spec 5.5.
export async function applyVimVerdict(c, verdict) {
  await c.query(
    `INSERT INTO vim_verdicts (media_uuid, instance_id, verdict, confidence, extracted, model_version)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [verdict.media_uuid, verdict.instance_id, verdict.verdict, verdict.confidence,
     verdict.extracted || {}, verdict.model_version || "unknown"]);

  const { rows } = await c.query(`SELECT * FROM task_instances WHERE id = $1 FOR UPDATE`, [verdict.instance_id]);
  if (!rows.length) return;
  const instance = rows[0];
  if (instance.state !== "done_reported") return; // already routed

  // Wait until every attached media item with a queued/running job has a verdict.
  const pending = await c.query(
    `SELECT 1 FROM vim_jobs j WHERE j.instance_id = $1 AND j.status IN ('queued','running')
     AND NOT EXISTS (SELECT 1 FROM vim_verdicts v WHERE v.media_uuid = j.media_uuid AND v.instance_id = j.instance_id)`,
    [verdict.instance_id]);
  if (pending.rows.length) return;

  const { rows: verdicts } = await c.query(
    `SELECT * FROM vim_verdicts WHERE instance_id = $1 ORDER BY decided_at`, [verdict.instance_id]);
  const worst = verdicts.reduce((acc, v) => {
    const rank = { pass: 0, uncertain: 1, fail: 2, unusable: 3 };
    return rank[v.verdict] > rank[acc.verdict] ? v : acc;
  }, verdicts[0]);
  const minConf = Math.min(...verdicts.map((v) => Number(v.confidence)));

  if (worst.verdict === "pass" && minConf >= 0.8) {
    await appendSystemEvent(c, instance.id, "auto_verified", {
      verification: { method: "vim", verdict: "pass", confidence: minConf, extracted: worst.extracted },
    });
  } else if (worst.verdict === "unusable" || minConf < 0.5) {
    // One retake before review (spec 5.5).
    const already = instance.evidence_summary?.retake_requested;
    if (!already) {
      await c.query(
        `UPDATE task_instances SET evidence_summary = evidence_summary || '{"retake_requested": true}', updated_at = now() WHERE id = $1`,
        [instance.id]);
      await appendSystemEvent(c, instance.id, "retake_requested", {
        reason: worst.extracted?.reason || "unusable media, please retake",
      });
    } else {
      await appendSystemEvent(c, instance.id, "review_required", { flags: [{ kind: "vim_unusable_after_retake" }] });
    }
  } else {
    // fail, uncertain, or 0.50-0.79: owner adjudicates. Fail never auto-rejects.
    await appendSystemEvent(c, instance.id, "review_required", {
      flags: [{ kind: "vim", verdict: worst.verdict, confidence: minConf, extracted: worst.extracted }],
    });
  }
}
