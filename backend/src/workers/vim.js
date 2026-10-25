// VIM worker (spec 5.5, 7.2 item 4): consumes vim_jobs and emits a verdict per
// photo through the same contract as the webhook. Two engines:
//   claude    - Claude looks at the photo(s) with the task's instructions and
//               what the caretaker reported, and returns a structured verdict
//   heuristic - deterministic local checks (media present, size sane), used in
//               development, tests, when Claude is off, over the monthly cap,
//               and for voice notes and videos
// Jobs are claimed in a short transaction and Claude is called outside it, so
// a slow API call never holds database locks.
import fs from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { q, tx } from "../db/pool.js";
import { config } from "../config.js";
import { applyVimVerdict } from "../engine/verification.js";
import { getIntegrations, claudeActive, CLAUDE_MODELS } from "../integrations/settings.js";

// What to look for, per verification profile (task templates name one).
const PROFILE_CHECKS = {
  tank_gauge: "A water tank level gauge, sight tube or dipstick should be visible. Read the level (percent or litres) and compare it with the reported reading.",
  bundle_count: "Kale bundles should be stacked against a tally board. Estimate the bundle count, check the chalked date is legible, and compare with the reported count.",
  wet_line: "A drip irrigation line should show a wet soil strip along the lateral, proving water ran.",
  trough_feed: "Feed should be present in the trough with animals present. Estimate the head count.",
  chick_spread: "Chicks under a brooder: are they huddled (too cold), pushed to the edges (too hot) or evenly spread (right)?",
  bcs_assist: "A side-on photo of cattle for body condition scoring. Is it usable for scoring? Give a coarse 1-5 estimate.",
  spray_scene: "A sprayer should be present in a crop that matches the task, ideally with nozzle output visible.",
  repair_pair: "Before and after photos of a repair: do they show the same place, and is the defect visibly fixed in the after photo?",
  leak_scan: "A walk-around of a tank: look for wet ground, drips or trails that suggest a leak.",
};

const SYSTEM = `You check evidence photos for Woodlands Farm, a 119-hectare mixed farm near Kwekwe, Zimbabwe (kale, poultry, cattle, goats, pigs; borehole water and drip irrigation). The caretaker takes a photo on an entry-level phone to prove a task was done, and the farm owner, who is often away, relies on your verdict.

Decide whether the photo shows the task done as described and as reported. Be fair to field conditions: photos are often imperfect, so judge whether a reasonable farm owner would accept this as proof.

Verdicts:
- pass: the photo clearly shows what the task requires, and agrees with what the caretaker reported.
- fail: the photo shows the task was not done, or contradicts the report (for example the gauge reads far from the reported level, or the trough is empty).
- unusable: you can't judge: too dark, blurred, the wrong subject, a finger over the lens, a photo of a screen, or clearly not this farm task.
- uncertain: plausible, but a key detail can't be confirmed.

Confidence is how sure you are of your verdict, from 0 to 1. Write the reason in one or two plain sentences for the owner. If the verdict is unusable, give the caretaker a short, practical retake instruction (for example "Move closer so the gauge numbers are readable"); otherwise leave retake_hint empty. Put any numbers you can read (levels, counts, scores) in readings.`;

const VERDICT_SCHEMA = {
  type: "object",
  properties: {
    verdict: { type: "string", enum: ["pass", "fail", "unusable", "uncertain"] },
    confidence: { type: "number" },
    reason: { type: "string" },
    retake_hint: { type: "string" },
    matches_report: { type: "string", enum: ["yes", "no", "unclear", "nothing_reported"] },
    readings: {
      type: "array",
      items: {
        type: "object",
        properties: { name: { type: "string" }, value: { type: "string" } },
        required: ["name", "value"],
        additionalProperties: false,
      },
    },
  },
  required: ["verdict", "confidence", "reason", "retake_hint", "matches_report", "readings"],
  additionalProperties: false,
};

// Models with server-side refusal fallback ("default" routing).
const FALLBACK_MODELS = new Set(["claude-opus-5-5", "claude-sonnet-5-5"]);
const MAX_IMAGE_BYTES = 4_500_000;

let clientFactory = (apiKey) => new Anthropic({ apiKey, maxRetries: 2, timeout: 120_000 });
// Tests inject a fake client.
export function setClaudeClientFactory(fn) {
  clientFactory = fn || ((apiKey) => new Anthropic({ apiKey, maxRetries: 2, timeout: 120_000 }));
}

export function imageMediaType(buf) {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buf.length > 12 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  if (buf.length > 6 && buf.toString("ascii", 0, 3) === "GIF") return "image/gif";
  return null;
}

export function costUsd(model, usage) {
  const price = CLAUDE_MODELS[model] || CLAUDE_MODELS["claude-opus-5-5"];
  const input = (usage?.input_tokens || 0) + (usage?.cache_creation_input_tokens || 0) * 1.25
    + (usage?.cache_read_input_tokens || 0) * 0.1;
  return (input * price.input + (usage?.output_tokens || 0) * price.output) / 1_000_000;
}

export async function claudeSpendThisMonth() {
  const r = await q(
    `SELECT COALESCE(SUM(cost_usd), 0)::float AS usd, count(*) FILTER (WHERE cost_usd IS NOT NULL)::int AS photos
     FROM vim_jobs WHERE updated_at >= date_trunc('month', now())`);
  return r.rows[0];
}

function heuristicVerdict(media) {
  // Deterministic: usable when the blob exists and has plausible size; confidence
  // scaled so most pass auto-verification, mirroring the target auto-verify rate.
  const file = media?.storage_key ? path.join(config.mediaDir, media.storage_key) : null;
  const exists = file && fs.existsSync(file);
  const bytes = exists ? fs.statSync(file).size : Number(media?.bytes || 0);
  if (!exists && !bytes) return { verdict: "unusable", confidence: 0.2, extracted: { reason: "no media bytes" } };
  if (bytes < 500) return { verdict: "unusable", confidence: 0.3, extracted: { reason: "too small, likely corrupt" } };
  return { verdict: "pass", confidence: 0.9, extracted: { heuristic: true, bytes } };
}

function loadImage(storageKey) {
  if (!storageKey) return null;
  const file = path.join(config.mediaDir, storageKey);
  if (!fs.existsSync(file)) return null;
  const buf = fs.readFileSync(file);
  const mediaType = imageMediaType(buf);
  if (!mediaType || buf.length > MAX_IMAGE_BYTES) return null;
  return { type: "image", source: { type: "base64", media_type: mediaType, data: buf.toString("base64") } };
}

// Everything Claude needs about the task, from the database.
async function taskContext(job) {
  const inst = (await q(
    `SELECT ti.template_code, ti.title, ti.subject_id, ti.params, tt.instructions, tt.checklist
     FROM task_instances ti JOIN task_templates tt ON tt.id = ti.template_id WHERE ti.id = $1`,
    [job.instance_id])).rows[0];
  const done = (await q(
    `SELECT payload FROM task_events WHERE instance_id = $1 AND type = 'done_reported'
     ORDER BY server_time DESC LIMIT 1`, [job.instance_id])).rows[0];
  const siblings = (await q(
    `SELECT media_uuid, storage_key FROM media_objects
     WHERE instance_id = $1 AND kind = 'photo' AND status = 'stored' AND media_uuid <> $2
     ORDER BY created_at LIMIT 3`, [job.instance_id, job.media_uuid])).rows;
  return { inst, reported: done?.payload?.fields || {}, siblings };
}

async function claudeVerdict(job, media, settings) {
  const main = loadImage(media.storage_key);
  if (!main) return null; // not an image Claude can read: caller falls back
  const { inst, reported, siblings } = await taskContext(job);
  const extra = job.profile === "repair_pair"
    ? siblings.map((s) => loadImage(s.storage_key)).filter(Boolean)
    : [];

  const lines = [
    `Task: ${inst ? `${inst.template_code} ${inst.title}` : job.context?.task_code || "farm task"}`,
    inst?.instructions ? `Instructions given to the caretaker: ${inst.instructions}` : null,
    Array.isArray(inst?.checklist) && inst.checklist.length ? `Checklist: ${inst.checklist.join("; ")}` : null,
    `What to check: ${PROFILE_CHECKS[job.profile] || "Does the photo show this task done?"}`,
    Object.keys(reported).length
      ? `The caretaker reported: ${Object.entries(reported).map(([k, v]) => `${k} = ${v}`).join(", ")}`
      : "The caretaker reported no values with this task.",
    job.context?.expected && Object.keys(job.context.expected).length
      ? `Expected: ${JSON.stringify(job.context.expected)}` : null,
    extra.length ? `The first image is the photo to judge; the next ${extra.length} are other photos from the same task (for before/after comparison).` : null,
  ].filter(Boolean);

  const { model, effort, apiKey } = settings.claude;
  const client = clientFactory(apiKey);
  const request = {
    model,
    max_tokens: 16000,
    system: SYSTEM,
    output_config: { effort, format: { type: "json_schema", schema: VERDICT_SCHEMA } },
    messages: [{ role: "user", content: [main, ...extra, { type: "text", text: lines.join("\n") }] }],
  };
  // On a policy decline, Opus and Sonnet re-run on Anthropic's recommended
  // fallback model inside the same call.
  const response = FALLBACK_MODELS.has(model)
    ? await client.beta.messages.create({ ...request, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" })
    : await client.messages.create(request);

  const servedBy = response.model || model;
  const usage = { model: servedBy, input: response.usage?.input_tokens || 0, output: response.usage?.output_tokens || 0,
    cost: costUsd(CLAUDE_MODELS[servedBy] ? servedBy : model, response.usage) };

  if (response.stop_reason === "refusal") {
    return { verdict: "uncertain", confidence: 0, usage,
      extracted: { reason: "Claude declined to assess this photo; please check it yourself.", engine: "claude",
        model: servedBy, refused: true } };
  }
  if (response.stop_reason === "max_tokens") throw new Error("Claude response was cut off");
  const text = (response.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
  let parsed;
  try { parsed = JSON.parse(text); } catch { throw new Error("Claude returned unreadable output"); }
  const verdict = ["pass", "fail", "unusable", "uncertain"].includes(parsed.verdict) ? parsed.verdict : "uncertain";
  return {
    verdict,
    confidence: Math.max(0, Math.min(1, Number(parsed.confidence) || 0)),
    usage,
    extracted: {
      engine: "claude", model: servedBy,
      reason: String(parsed.reason || "").slice(0, 600),
      retake_hint: String(parsed.retake_hint || "").slice(0, 200),
      matches_report: parsed.matches_report,
      readings: Array.isArray(parsed.readings) ? parsed.readings.slice(0, 10) : [],
    },
  };
}

// Retryable: rate limits, overload, server errors, network. Everything else
// (bad key, bad request) fails the attempt the same way but is worth surfacing.
function errorMessage(err) {
  if (err instanceof Anthropic.AuthenticationError) return "Claude API key was rejected";
  if (err instanceof Anthropic.PermissionDeniedError) return "This API key isn't allowed to use that model";
  if (err instanceof Anthropic.NotFoundError) return "Claude model not found";
  if (err instanceof Anthropic.RateLimitError) return "Claude rate limit; will retry";
  if (err instanceof Anthropic.BadRequestError) return `Claude rejected the request: ${err.message}`.slice(0, 300);
  if (err instanceof Anthropic.APIError) return `Claude API error ${err.status ?? ""}; will retry`.trim();
  return String(err?.message || err).slice(0, 300);
}

async function claimJobs(limit) {
  // Recover jobs left 'running' by a crashed worker.
  await q(`UPDATE vim_jobs SET status = 'queued', updated_at = now()
           WHERE status = 'running' AND updated_at < now() - interval '15 minutes' AND attempts < 3`);
  const r = await q(
    `UPDATE vim_jobs SET status = 'running', attempts = attempts + 1, updated_at = now()
     WHERE id IN (SELECT id FROM vim_jobs WHERE status = 'queued' AND attempts < 3
                  ORDER BY created_at LIMIT $1 FOR UPDATE SKIP LOCKED)
     RETURNING *`, [limit]);
  return r.rows;
}

export async function processVimQueue({ limit = 20 } = {}) {
  const jobs = await claimJobs(limit);
  if (!jobs.length) return [];
  const settings = await getIntegrations();
  const results = [];
  for (const job of jobs) {
    const media = (await q(`SELECT * FROM media_objects WHERE media_uuid = $1`, [job.media_uuid])).rows[0] || {};
    try {
      let v = null;
      let engine = "heuristic-v1";
      if (claudeActive(settings) && media.status === "stored" && media.kind === "photo") {
        const spend = await claudeSpendThisMonth();
        const cap = Number(settings.claude.monthlyCapUsd);
        if (cap > 0 && spend.usd >= cap) {
          engine = "heuristic-v1 (Claude monthly cap reached)";
        } else {
          v = await claudeVerdict(job, media, settings);
          if (v) engine = v.extracted.model || settings.claude.model;
        }
      }
      if (!v) v = heuristicVerdict(media);
      await tx(async (c) => {
        await c.query(
          `UPDATE vim_jobs SET status = 'done', model = $2, input_tokens = $3, output_tokens = $4, cost_usd = $5,
             last_error = NULL, updated_at = now() WHERE id = $1`,
          [job.id, engine, v.usage?.input ?? null, v.usage?.output ?? null, v.usage ? v.usage.cost : null]);
        await applyVimVerdict(c, {
          media_uuid: job.media_uuid, instance_id: job.instance_id,
          verdict: v.verdict, confidence: v.confidence, extracted: v.extracted, model_version: engine,
        });
      });
      results.push({ job: job.id, verdict: v.verdict, confidence: v.confidence, engine });
    } catch (err) {
      const message = errorMessage(err);
      await q(
        `UPDATE vim_jobs SET status = CASE WHEN attempts >= 3 THEN 'failed' ELSE 'queued' END,
           last_error = $2, updated_at = now() WHERE id = $1`, [job.id, message]);
      results.push({ job: job.id, error: message });
    }
  }
  return results;
}

// Owner's "Test" button: a tiny request with the saved key and model.
export async function testClaude() {
  const settings = await getIntegrations();
  if (!settings.claude.apiKey) return { ok: false, error: "No Claude API key saved yet" };
  const started = Date.now();
  try {
    const client = clientFactory(settings.claude.apiKey);
    const r = await client.messages.create({
      model: settings.claude.model,
      max_tokens: 2000,
      output_config: { effort: "low" },
      messages: [{ role: "user", content: "Reply with just the word OK." }],
    });
    const text = (r.content || []).filter((b) => b.type === "text").map((b) => b.text).join("").trim();
    return { ok: true, model: r.model || settings.claude.model, reply: text.slice(0, 40), ms: Date.now() - started };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
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
