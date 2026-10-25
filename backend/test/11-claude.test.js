import { test, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { prepareDb, resetDynamic, tx, q, instancesByCode, getInstance, appendEvent } from "./helpers.js";
import { runRelease } from "../src/engine/release.js";
import { processVimQueue, setClaudeClientFactory, costUsd, imageMediaType, testClaude } from "../src/workers/vim.js";
import { saveIntegrations, invalidateIntegrations } from "../src/integrations/settings.js";
import { setWaFetch } from "../src/workers/whatsappSender.js";
import { config } from "../src/config.js";
import { farmDateStr } from "../src/util/time.js";

const TODAY = farmDateStr();
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(4000, 9)]);
let calls, reply;

// A stand-in for the Anthropic client that records requests.
function fakeClient() {
  const create = async (req) => {
    calls.push(req);
    if (reply instanceof Error) throw reply;
    return typeof reply === "function" ? reply(req) : reply;
  };
  return { messages: { create }, beta: { messages: { create } } };
}
const answer = (obj, extra = {}) => ({
  model: extra.model || "claude-opus-5-5",
  stop_reason: extra.stop_reason || "end_turn",
  content: [{ type: "text", text: JSON.stringify(obj) }],
  usage: { input_tokens: 1800, output_tokens: 400 },
});

before(async () => {
  await prepareDb();
  setClaudeClientFactory(() => fakeClient());
  setWaFetch(async () => ({ ok: true, json: async () => ({ messages: [{ id: "wamid.x" }] }) }));
});
after(() => { setClaudeClientFactory(null); setWaFetch(null); });

beforeEach(async () => {
  await resetDynamic();
  await q(`DELETE FROM farm_settings WHERE key = 'integrations'`);
  invalidateIntegrations();
  calls = [];
  await saveIntegrations({ claude: { apiKey: "sk-ant-test", enabled: true } });
});

// W-01 done with a stored tank photo and reported readings, waiting for a verdict.
async function w01WithPhoto(fields = { level_pct: 62, pool_pct: 70 }) {
  await tx((c) => runRelease(c, TODAY));
  const [w01] = await instancesByCode("W-01");
  const mediaUuid = (await q(`SELECT gen_random_uuid() AS id`)).rows[0].id;
  fs.mkdirSync(config.mediaDir, { recursive: true });
  fs.writeFileSync(path.join(config.mediaDir, `${mediaUuid}.jpg`), JPEG);
  await q(`INSERT INTO media_objects (media_uuid, instance_id, kind, status, storage_key, bytes)
           VALUES ($1, $2, 'photo', 'stored', $3, $4)`, [mediaUuid, w01.id, `${mediaUuid}.jpg`, JPEG.length]);
  await appendEvent(w01.id, "field_recorded", { fields });
  await appendEvent(w01.id, "media_attached", { media_uuid: mediaUuid, kind: "photo" });
  await appendEvent(w01.id, "done_reported", { fields });
  return w01;
}

test("image type and cost helpers", () => {
  assert.equal(imageMediaType(JPEG), "image/jpeg");
  assert.equal(imageMediaType(Buffer.from("OggS....")), null);
  // Opus 5.5: $4 in / $20 out per million tokens.
  assert.equal(costUsd("claude-opus-5-5", { input_tokens: 1_000_000, output_tokens: 100_000 }), 6);
  assert.equal(costUsd("claude-haiku-5-5", { input_tokens: 1_000_000, output_tokens: 1_000_000 }), 0.6);
});

test("Claude pass with high confidence auto-verifies, with the photo, task and report in the request", async () => {
  const w01 = await w01WithPhoto();
  reply = answer({ verdict: "pass", confidence: 0.93, reason: "Gauge clearly reads about 60%, matching the report.",
    retake_hint: "", matches_report: "yes", readings: [{ name: "tank level", value: "60%" }] });
  const [r] = await processVimQueue();
  assert.equal(r.verdict, "pass");

  const req = calls[0];
  assert.equal(req.model, "claude-opus-5-5");
  assert.deepEqual(req.betas, ["server-side-fallback-2026-07-01"]);
  assert.equal(req.fallbacks, "default");
  assert.equal(req.output_config.effort, "medium");
  assert.equal(req.output_config.format.type, "json_schema");
  assert.equal(req.thinking, undefined, "Opus 5.5 thinking is always on; not sent");
  const [img, text] = req.messages[0].content;
  assert.equal(img.source.media_type, "image/jpeg");
  assert.match(text.text, /Task: W-01/);
  assert.match(text.text, /level_pct = 62/);
  assert.match(text.text, /gauge/);

  const inst = await getInstance(w01.id);
  assert.equal(inst.state, "verified_closed");
  assert.equal(inst.verification.method, "vim");
  const job = (await q(`SELECT * FROM vim_jobs WHERE instance_id = $1`, [w01.id])).rows[0];
  assert.equal(job.model, "claude-opus-5-5");
  assert.equal(Number(job.cost_usd).toFixed(4), ((1800 * 4 + 400 * 20) / 1e6).toFixed(4));
});

test("a contradicting photo goes to the owner with Claude's reason", async () => {
  const w01 = await w01WithPhoto({ level_pct: 90, pool_pct: 70 });
  reply = answer({ verdict: "fail", confidence: 0.85, reason: "Gauge reads about 30%, not the reported 90%.",
    retake_hint: "", matches_report: "no", readings: [{ name: "tank level", value: "30%" }] });
  await processVimQueue();
  const inst = await getInstance(w01.id);
  assert.equal(inst.state, "needs_review");
  const v = (await q(`SELECT * FROM vim_verdicts WHERE instance_id = $1`, [w01.id])).rows[0];
  assert.equal(v.extracted.reason, "Gauge reads about 30%, not the reported 90%.");
  assert.equal(v.extracted.matches_report, "no");
});

test("an unusable photo asks the caretaker to retake it, on WhatsApp too", async () => {
  await saveIntegrations({ whatsapp: { token: "EAA", phoneId: "1" } });
  const w01 = await w01WithPhoto();
  reply = answer({ verdict: "unusable", confidence: 0.9, reason: "Too dark to see the gauge.",
    retake_hint: "Use the torch and move closer to the gauge", matches_report: "unclear", readings: [] });
  await processVimQueue();
  const ev = (await q(`SELECT payload FROM task_events WHERE instance_id = $1 AND type = 'retake_requested'`, [w01.id])).rows[0];
  assert.equal(ev.payload.reason, "Use the torch and move closer to the gauge");
  const msg = (await q(`SELECT * FROM wa_messages WHERE kind = 'retake' ORDER BY created_at DESC LIMIT 1`)).rows[0];
  assert.equal(msg.related_instance_id, w01.id);
  assert.equal(msg.payload.template.params[1], "Use the torch and move closer to the gauge");
});

test("a refusal goes to the owner instead of passing", async () => {
  const w01 = await w01WithPhoto();
  reply = { model: "claude-opus-5-5", stop_reason: "refusal", content: [], usage: { input_tokens: 1500, output_tokens: 0 } };
  await processVimQueue();
  assert.equal((await getInstance(w01.id)).state, "needs_review");
});

test("Haiku uses the plain endpoint; over the monthly cap Claude isn't called", async () => {
  await saveIntegrations({ claude: { model: "claude-haiku-5-5", effort: "low", monthlyCapUsd: 5 } });
  await w01WithPhoto();
  reply = answer({ verdict: "pass", confidence: 0.9, reason: "ok", retake_hint: "", matches_report: "yes", readings: [] },
    { model: "claude-haiku-5-5" });
  await processVimQueue();
  assert.equal(calls[0].model, "claude-haiku-5-5");
  assert.equal(calls[0].betas, undefined);
  assert.equal(calls[0].output_config.effort, "low");

  await resetDynamic();
  calls = [];
  await w01WithPhoto();
  await q(`UPDATE vim_jobs SET cost_usd = 6`); // this month's spend already over the $5 cap
  const [r] = await processVimQueue();
  assert.equal(calls.length, 0);
  assert.match(r.engine, /monthly cap/);
  assert.equal(r.verdict, "pass");
});

test("API errors retry, then show a readable reason", async () => {
  const w01 = await w01WithPhoto();
  reply = new Anthropic.AuthenticationError(401, { type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } },
    "invalid x-api-key", new Headers());
  const [r] = await processVimQueue();
  assert.equal(r.error, "Claude API key was rejected");
  let job = (await q(`SELECT * FROM vim_jobs WHERE instance_id = $1`, [w01.id])).rows[0];
  assert.equal(job.status, "queued");
  assert.equal(job.last_error, "Claude API key was rejected");
  await processVimQueue();
  await processVimQueue();
  job = (await q(`SELECT * FROM vim_jobs WHERE instance_id = $1`, [w01.id])).rows[0];
  assert.equal(job.status, "failed", "gives up after three attempts; the outage sweep takes over");
  assert.equal((await testClaude()).error, "Claude API key was rejected");
});

test("Claude off: heuristic as before", async () => {
  await saveIntegrations({ claude: { enabled: false } });
  const w01 = await w01WithPhoto();
  const [r] = await processVimQueue();
  assert.equal(calls.length, 0);
  assert.equal(r.engine, "heuristic-v1");
  assert.equal((await getInstance(w01.id)).state, "verified_closed");
});
