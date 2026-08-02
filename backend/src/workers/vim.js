// VIM worker (spec 5.5, 7.2 item 4): consumes vim_jobs, loads the profile, emits
// a verdict through the same contract as the webhook. Two adapters:
//   claude    — Claude Vision over the stored media with a profile-specific prompt
//   heuristic — deterministic local checks (media present, size sane), used in
//               development, tests and as the outage fallback
import fs from "node:fs";
import path from "node:path";
import { tx } from "../db/pool.js";
import { config } from "../config.js";
import { applyVimVerdict } from "../engine/verification.js";

const PROFILE_PROMPTS = {
  tank_gauge: "Is a water tank gauge or dipstick visible? Read the level percentage.",
  bundle_count: "Count the kale bundles stacked against the tally board. Is the chalked date legible?",
  wet_line: "Is a wet soil strip visible along the drip lateral?",
  trough_feed: "Is feed present in the trough with cattle present? Approximate head count.",
  chick_spread: "Describe the chick distribution under the brooder: huddled (cold), dispersed to edges (hot), or even (right).",
  bcs_assist: "Side-on cattle photo: is the image usable for body condition scoring? Coarse estimate 1-5.",
  spray_scene: "Is a sprayer present, does the crop match, is nozzle output visible?",
  repair_pair: "Do the before and after photos differ materially in the defect region?",
  leak_scan: "Any wet ground or drip trails visible on this tank walk-around?",
};

async function heuristicVerdict(job, media) {
  // Deterministic: usable when the blob exists and has plausible size; confidence
  // scaled so most pass auto-verification, mirroring the target auto-verify rate.
  const file = media?.storage_key ? path.join(config.mediaDir, media.storage_key) : null;
  const exists = file && fs.existsSync(file);
  const bytes = exists ? fs.statSync(file).size : Number(media?.bytes || 0);
  if (!exists && !bytes) {
    return { verdict: "unusable", confidence: 0.2, extracted: { reason: "no media bytes" } };
  }
  if (bytes < 500) {
    return { verdict: "unusable", confidence: 0.3, extracted: { reason: "too small, likely corrupt" } };
  }
  return { verdict: "pass", confidence: 0.9, extracted: { heuristic: true, bytes, profile: job.profile } };
}

async function claudeVerdict(job, media) {
  const file = path.join(config.mediaDir, media.storage_key);
  if (!fs.existsSync(file)) return heuristicVerdict(job, media);
  const b64 = fs.readFileSync(file).toString("base64");
  const prompt = `${PROFILE_PROMPTS[job.profile] || "Assess this farm evidence photo."}
Task context: ${JSON.stringify(job.context)}.
Respond ONLY with JSON: {"verdict":"pass|fail|unusable|uncertain","confidence":0.0,"extracted":{}}`;
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": config.anthropicKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-sonnet-5",
      max_tokens: 500,
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: "image/jpeg", data: b64 } },
          { type: "text", text: prompt },
        ],
      }],
    }),
  });
  if (!resp.ok) throw new Error(`anthropic ${resp.status}`);
  const data = await resp.json();
  const text = data.content?.map((c) => c.text || "").join("") || "";
  const parsed = JSON.parse(text.replace(/```json|```/g, "").trim());
  return {
    verdict: ["pass", "fail", "unusable", "uncertain"].includes(parsed.verdict) ? parsed.verdict : "uncertain",
    confidence: Math.max(0, Math.min(1, Number(parsed.confidence) || 0)),
    extracted: parsed.extracted || {},
  };
}

export async function processVimQueue({ limit = 20 } = {}) {
  return tx(async (c) => {
    const { rows: jobs } = await c.query(
      `SELECT j.*, m.storage_key, m.bytes, m.status AS media_status
       FROM vim_jobs j JOIN media_objects m ON m.media_uuid = j.media_uuid
       WHERE j.status = 'queued' AND j.attempts < 3
       ORDER BY j.created_at LIMIT $1 FOR UPDATE OF j SKIP LOCKED`, [limit]);
    const results = [];
    for (const job of jobs) {
      await c.query(`UPDATE vim_jobs SET status = 'running', attempts = attempts + 1, updated_at = now() WHERE id = $1`, [job.id]);
      try {
        const useClaude = config.vimMode === "claude" && config.anthropicKey && job.media_status === "stored";
        const v = useClaude ? await claudeVerdict(job, job) : await heuristicVerdict(job, job);
        await c.query(`UPDATE vim_jobs SET status = 'done', updated_at = now() WHERE id = $1`, [job.id]);
        await applyVimVerdict(c, {
          media_uuid: job.media_uuid, instance_id: job.instance_id,
          verdict: v.verdict, confidence: v.confidence, extracted: v.extracted,
          model_version: useClaude ? "claude-sonnet-5" : "heuristic-v1",
        });
        results.push({ job: job.id, verdict: v.verdict, confidence: v.confidence });
      } catch (err) {
        await c.query(
          `UPDATE vim_jobs SET status = CASE WHEN attempts >= 3 THEN 'failed' ELSE 'queued' END, updated_at = now()
           WHERE id = $1`, [job.id]);
        results.push({ job: job.id, error: err.message });
      }
    }
    return results;
  });
}

// VIM outage fallback (spec 5.5): jobs queued beyond 12 hours flow to review with
// sampling; owner reviews 1 in 5, the rest auto-close flagged vim_outage_sample.
export async function vimOutageSweep() {
  return tx(async (c) => {
    const { rows: stale } = await c.query(
      `SELECT DISTINCT j.instance_id FROM vim_jobs j
       JOIN task_instances ti ON ti.id = j.instance_id
       WHERE j.status IN ('queued','failed') AND j.created_at < now() - interval '12 hours'
         AND ti.state = 'done_reported'`);
    const { randomUUID } = await import("node:crypto");
    const { foldEvent } = await import("../engine/fold.js");
    let n = 0;
    for (const row of stale) {
      n += 1;
      if (n % 5 === 0) {
        await foldEvent(c, {
          event_uuid: randomUUID(), instance_id: row.instance_id, actor_type: "system",
          type: "review_required", payload: { flags: [{ kind: "vim_outage_sample" }] },
        });
      } else {
        await foldEvent(c, {
          event_uuid: randomUUID(), instance_id: row.instance_id, actor_type: "system",
          type: "auto_verified",
          payload: { verification: { method: "vim_outage_sample", verdict: "pass", flagged: true } },
        });
      }
    }
    return n;
  });
}
