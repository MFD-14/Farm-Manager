import { test, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { prepareDb, resetDynamic, tx, q, instancesByCode, getInstance } from "./helpers.js";
import { createApp } from "../src/app.js";
import { runRelease } from "../src/engine/release.js";
import { runEscalationSweep } from "../src/engine/escalation.js";
import { runMorningPlan } from "../src/workers/morningPlan.js";
import { saveIntegrations, invalidateIntegrations } from "../src/integrations/settings.js";
import { setWaFetch, sendTaskReminder } from "../src/workers/whatsappSender.js";
import { setWebhookFetch } from "../src/routes/webhooks.js";
import { normalizePhone } from "../src/util/phone.js";
import { farmDateStr } from "../src/util/time.js";

const TODAY = farmDateStr();
const PHONE = "+263771111111";
let server, base, sent, caretaker;

before(async () => {
  await prepareDb();
  server = createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { setWaFetch(null); setWebhookFetch(null); server?.close(); });

beforeEach(async () => {
  await resetDynamic();
  await q(`DELETE FROM wa_messages`);
  await q(`DELETE FROM farm_settings WHERE key IN ('integrations', 'wa_morning_sent')`);
  invalidateIntegrations();
  sent = [];
  setWaFetch(async (url, opts) => {
    const body = JSON.parse(opts.body);
    sent.push({ url, body });
    if (body.to === "263779999999") {
      return { ok: false, status: 400, json: async () => ({ error: { message: "Recipient not on WhatsApp" } }) };
    }
    return { ok: true, status: 200, json: async () => ({ messages: [{ id: `wamid.${sent.length}` }] }) };
  });
  // A caretaker with a WhatsApp number, as the owner would add under People.
  await q(`DELETE FROM wa_contacts WHERE wa_phone = $1`, [PHONE]);
  await q(`DELETE FROM users WHERE email = 'tendai@example.com'`);
  caretaker = (await q(
    `INSERT INTO users (email, password_hash, name, role, phone) VALUES ('tendai@example.com', 'x', 'Tendai Moyo', 'caretaker', $1)
     RETURNING *`, [PHONE])).rows[0];
  await q(`INSERT INTO wa_contacts (user_id, wa_phone) VALUES ($1, $2)`, [caretaker.id, PHONE]);
});

const configure = (extra = {}) => saveIntegrations({ whatsapp: { token: "EAAtest", phoneId: "1234567890", ...extra } });
const openWindow = () => q(`UPDATE wa_contacts SET window_open_until = now() + interval '1 hour' WHERE wa_phone = $1`, [PHONE]);

async function releasedFor(user) {
  await tx((c) => runRelease(c, TODAY));
  // Park everything in the future so only the tasks a test picks are overdue.
  await q(`UPDATE task_instances SET due_at = now() + interval '1 day', grace_until = now() + interval '2 days',
           expires_at = NULL, assignee_id = $1`, [user.id]);
}

test("phone numbers become international form", () => {
  assert.equal(normalizePhone("0771 234 567"), "+263771234567");
  assert.equal(normalizePhone("+263 77-123-4567"), "+263771234567");
  assert.equal(normalizePhone("00447700900123"), "+447700900123");
  assert.equal(normalizePhone(""), null);
});

test("without credentials messages are logged, not sent", async () => {
  await releasedFor(caretaker);
  const [w01] = await instancesByCode("W-01");
  const r = await tx((c) => sendTaskReminder(c, { user: caretaker, instance: w01 }));
  assert.equal(r.status, "logged_only");
  assert.equal(sent.length, 0);
});

test("closed window uses the approved template with per-task buttons; open window sends tap buttons", async () => {
  await configure();
  await releasedFor(caretaker);
  const [w01] = await instancesByCode("W-01");

  const closed = await tx((c) => sendTaskReminder(c, { user: caretaker, instance: w01 }));
  assert.equal(closed.status, "sent");
  const t = sent[0].body;
  assert.match(sent[0].url, /graph\.facebook\.com\/v23\.0\/1234567890\/messages$/);
  assert.equal(t.to, "263771111111");
  assert.equal(t.type, "template");
  assert.equal(t.template.name, "woodlands_task_reminder");
  assert.equal(t.template.components[0].parameters[0].text, `W-01 ${w01.title}`);
  assert.deepEqual(t.template.components.slice(1).map((b) => b.parameters[0].payload),
    [`done:${w01.id}`, `problem:${w01.id}`, `skip:${w01.id}`]);

  await openWindow();
  const open = await tx((c) => sendTaskReminder(c, { user: caretaker, instance: w01 }));
  assert.equal(open.mode, "interactive");
  const i = sent[1].body;
  assert.equal(i.type, "interactive");
  assert.deepEqual(i.interactive.action.buttons.map((b) => b.reply.title), ["Done", "Problem", "Skip"]);
  assert.equal(i.interactive.action.buttons[0].reply.id, `done:${w01.id}`);
});

test("failed sends keep Meta's error for the owner to see", async () => {
  await configure();
  await releasedFor(caretaker);
  await q(`UPDATE users SET phone = '+263779999999' WHERE id = $1`, [caretaker.id]);
  const [w01] = await instancesByCode("W-01");
  const r = await tx((c) => sendTaskReminder(c, { user: { ...caretaker, phone: "+263779999999" }, instance: w01 }));
  assert.equal(r.status, "failed");
  const row = (await q(`SELECT status, error FROM wa_messages ORDER BY created_at DESC LIMIT 1`)).rows[0];
  assert.equal(row.error, "Recipient not on WhatsApp");
});

test("an overdue task reminds its assignee with buttons; several overdue become one list", async () => {
  await configure();
  await releasedFor(caretaker);
  const [w01] = await instancesByCode("W-01");
  // P1: first WhatsApp reminder two hours after the due time.
  await q(`UPDATE task_instances SET due_at = now() - interval '130 minutes' WHERE id = $1`, [w01.id]);
  await tx((c) => runEscalationSweep(c));
  const toTendai = sent.filter((s) => s.body.to === "263771111111");
  assert.equal(toTendai.length, 1);
  assert.equal(toTendai[0].body.template.name, "woodlands_task_reminder");

  // Second sweep: already reminded, nothing new.
  await tx((c) => runEscalationSweep(c));
  assert.equal(sent.filter((s) => s.body.to === "263771111111").length, 1);

  const p1s = (await q(`SELECT id FROM task_instances WHERE priority = 'P1' AND id <> $1 AND state = 'released' LIMIT 2`, [w01.id])).rows;
  await q(`UPDATE task_instances SET due_at = now() - interval '3 hours' WHERE id = ANY($1)`, [p1s.map((r) => r.id)]);
  await tx((c) => runEscalationSweep(c));
  const list = sent.filter((s) => s.body.to === "263771111111").slice(1);
  assert.equal(list.length, 1, "one message for both");
  assert.equal(list[0].body.template.name, "woodlands_overdue_list");
  assert.equal(list[0].body.template.components[0].parameters[0].text, "2");
});

test("people who switched WhatsApp off, and switched-off settings, get nothing", async () => {
  await configure({ reminders: false });
  await releasedFor(caretaker);
  const [w01] = await instancesByCode("W-01");
  await q(`UPDATE task_instances SET due_at = now() - interval '130 minutes' WHERE id = $1`, [w01.id]);
  await tx((c) => runEscalationSweep(c));
  assert.equal(sent.length, 0, "reminders off");

  await configure({ reminders: true });
  await q(`UPDATE users SET wa_opt_in = false WHERE id = $1`, [caretaker.id]);
  await q(`UPDATE task_instances SET escalation_state = '{}' WHERE id = $1`, [w01.id]);
  await tx((c) => runEscalationSweep(c));
  assert.equal(sent.filter((s) => s.body.to === "263771111111").length, 0, "opted out");
});

test("morning list goes out once, at the chosen time, not hours late", async () => {
  await configure({ morningTime: "06:00" });
  await releasedFor(caretaker);
  const at = (h, m) => new Date(`${TODAY}T${String(h - 2).padStart(2, "0")}:${String(m).padStart(2, "0")}:00Z`); // farm = UTC+2
  assert.equal((await tx((c) => runMorningPlan(c, { now: at(5, 30) }))).reason, "too early");
  const r = await tx((c) => runMorningPlan(c, { now: at(6, 5) }));
  assert.equal(r.sent, 1);
  const msg = sent.find((s) => s.body.template?.name === "woodlands_morning_plan");
  assert.equal(msg.body.template.components[0].parameters[0].text, "Tendai");
  assert.ok(!/\n/.test(msg.body.template.components[0].parameters[2].text), "no newlines in template params");
  assert.equal((await tx((c) => runMorningPlan(c, { now: at(6, 10) }))).reason, "already sent");

  await q(`DELETE FROM farm_settings WHERE key = 'wa_morning_sent'`);
  assert.equal((await tx((c) => runMorningPlan(c, { now: at(10, 0) }))).reason, "too late today");
});

async function postWebhook(body, secret) {
  const raw = JSON.stringify(body);
  const headers = { "Content-Type": "application/json" };
  if (secret) headers["X-Hub-Signature-256"] = `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}`;
  const r = await fetch(`${base}/api/webhooks/whatsapp`, { method: "POST", headers, body: raw });
  await new Promise((res) => setTimeout(res, 400)); // processes after the ack
  return r.status;
}
const inbound = (msg) => ({ entry: [{ changes: [{ value: { messages: [{ from: "263771111111", ...msg }] } }] }] });

test("webhook: signed button tap marks the task done and confirms; unsigned is refused", async () => {
  await configure({ appSecret: "shh-secret" });
  await releasedFor(caretaker);
  const [w01] = await instancesByCode("W-01");
  const tap = inbound({ id: "wamid.tap1", type: "button", button: { payload: `done:${w01.id}`, text: "Done" } });

  assert.equal(await postWebhook(tap, null), 401);
  assert.equal(await postWebhook(tap, "wrong-secret"), 401);
  assert.equal((await getInstance(w01.id)).state, "released");

  assert.equal(await postWebhook(tap, "shh-secret"), 200);
  // Recorded as done; W-01 needs gauge readings, so a bare "Done" goes to review.
  assert.ok(["done_reported", "needs_review"].includes((await getInstance(w01.id)).state));
  const reply = sent.find((s) => s.body.type === "text");
  assert.match(reply.body.text.body, /Noted: W-01 .* done/);

  // Tapping again doesn't record twice.
  await postWebhook(inbound({ id: "wamid.tap2", type: "button", button: { payload: `done:${w01.id}`, text: "Done" } }), "shh-secret");
  const done = (await q(`SELECT count(*)::int AS n FROM task_events WHERE instance_id = $1 AND type = 'done_reported'`, [w01.id])).rows[0];
  assert.equal(done.n, 1);
});

test("webhook: a photo with several open tasks asks which one; the number reply attaches it", async () => {
  await configure();
  await releasedFor(caretaker);
  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(3000, 7)]);
  setWebhookFetch(async (url) => (url.includes("lookaside")
    ? { arrayBuffer: async () => jpeg }
    : { json: async () => ({ url: "https://lookaside.example/media/1" }) }));

  await postWebhook(inbound({ id: "wamid.img1", type: "image", image: { id: "MEDIA1", mime_type: "image/jpeg" } }));
  const ask = sent.filter((s) => s.body.type === "text").at(-1);
  assert.match(ask.body.text.body, /Which task is this photo for\? Reply with the number/);
  const second = ask.body.text.body.split("\n")[2].replace(/^2\. /, "");

  await postWebhook(inbound({ id: "wamid.txt1", type: "text", text: { body: "2" } }));
  const media = (await q(`SELECT * FROM media_objects WHERE exif->>'wa_media_id' = 'MEDIA1'`)).rows[0];
  assert.ok(media.instance_id, "attached");
  assert.equal(media.status, "stored");
  assert.equal(Number(media.bytes), jpeg.length);
  const inst = await getInstance(media.instance_id);
  assert.equal(`${inst.template_code} ${inst.title}`, second);
  assert.equal(inst.evidence_summary.photo_count, 1);
  assert.match(sent.at(-1).body.text.body, /Photo received for/);
});

test("owner settings: secrets never come back, test message reports how it was sent", async () => {
  const owner = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "owner@woodlands.farm", password: "woodlands" }) }).then((r) => r.json());
  const h = { "Content-Type": "application/json", Authorization: `Bearer ${owner.token}` };
  const save = await fetch(`${base}/api/integrations`, { method: "POST", headers: h,
    body: JSON.stringify({ whatsapp: { token: "EAAsecret1234", phoneId: "555" }, claude: { apiKey: "sk-ant-abcd9876", enabled: true } }) })
    .then((r) => r.json());
  assert.equal(save.whatsapp.tokenSet, true);
  assert.equal(save.whatsapp.tokenHint, "…1234");
  assert.equal(save.claude.apiKeyHint, "…9876");
  assert.ok(!JSON.stringify(save).includes("EAAsecret1234") && !JSON.stringify(save).includes("sk-ant-abcd9876"));
  assert.match(save.webhook_url, /\/api\/webhooks\/whatsapp$/);
  assert.ok(save.whatsapp.verifyToken);

  const bad = await fetch(`${base}/api/integrations`, { method: "POST", headers: h,
    body: JSON.stringify({ whatsapp: { morningTime: "6am" } }) });
  assert.equal(bad.status, 400);

  const t = await fetch(`${base}/api/integrations/whatsapp/test`, { method: "POST", headers: h,
    body: JSON.stringify({ user_id: caretaker.id }) }).then((r) => r.json());
  assert.equal(t.status, "sent");
  assert.equal(t.mode, "template");
  assert.equal(sent.at(-1).body.template.name, "hello_world");
  assert.equal(sent.at(-1).body.template.language.code, "en_US");

  const act = await fetch(`${base}/api/integrations/activity`, { headers: h }).then((r) => r.json());
  assert.equal(act.whatsapp.messages[0].kind, "test");
  assert.equal(act.whatsapp.messages[0].person, "Tendai Moyo");

  const care = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "caretaker@woodlands.farm", password: "woodlands" }) }).then((r) => r.json());
  const denied = await fetch(`${base}/api/integrations`, { headers: { Authorization: `Bearer ${care.token}` } });
  assert.equal(denied.status, 403);
});
