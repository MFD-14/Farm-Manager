import { test, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { prepareDb, resetDynamic, tx, q, instancesByCode, getInstance, appendEvent } from "./helpers.js";
import { createApp } from "../src/app.js";
import { runRelease } from "../src/engine/release.js";
import { acceptanceSweep } from "../src/workers/vim.js";
import { farmDateStr } from "../src/util/time.js";

const TODAY = farmDateStr();
let server, base, owner, manager, care;

async function api(path, { method = "GET", token, body, headers = {} } = {}) {
  const r = await fetch(base + path, {
    method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* raw */ }
  return { status: r.status, json };
}
const login = async (email, password) => (await api("/api/auth/login", { method: "POST", body: { email, password } })).json.token;

before(async () => {
  await prepareDb();
  server = createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  await q(`INSERT INTO users (email, password_hash, name, role, phone) VALUES ('mgr@example.com', $1, 'Farai', 'manager', '+263773333333')
           ON CONFLICT DO NOTHING`, [bcrypt.hashSync("manager-pass", 10)]);
  owner = await login("owner@woodlands.farm", "woodlands");
  manager = await login("mgr@example.com", "manager-pass");
  care = await login("caretaker@woodlands.farm", "woodlands");
});
after(() => server?.close());
beforeEach(async () => { await resetDynamic(); await q(`DELETE FROM wa_messages`); });

// W-01 reported done with readings and a stored photo: waits for acceptance.
async function readyW01(i = 0) {
  await tx((c) => runRelease(c, TODAY));
  const w01 = (await instancesByCode("W-01"))[i];
  const mediaUuid = randomUUID();
  await q(`INSERT INTO media_objects (media_uuid, instance_id, kind, status, storage_key, bytes)
           VALUES ($1, $2, 'photo', 'stored', 'x.jpg', 120000)`, [mediaUuid, w01.id]);
  await appendEvent(w01.id, "field_recorded", { fields: { level_pct: 60, pool_pct: 70 } });
  await appendEvent(w01.id, "media_attached", { media_uuid: mediaUuid, kind: "photo" });
  await appendEvent(w01.id, "done_reported", {});
  return w01;
}

test("a task manager accepts; the event records who and in which role", async () => {
  const w01 = await readyW01();
  const queue = await api("/api/instances?state=decisions", { token: manager });
  assert.equal(queue.status, 200);
  const card = queue.json.instances.find((i) => i.id === w01.id);
  assert.equal(card.ready_to_accept, true);
  assert.equal(card.reported.by, "Caretaker");
  assert.equal(card.media.length, 1);

  const r = await api(`/api/instances/${w01.id}/decision`, { method: "POST", token: manager, body: { action: "accept" } });
  assert.equal(r.json.state, "verified_closed");
  const ev = (await q(`SELECT actor_type, payload FROM task_events WHERE instance_id = $1 AND type = 'verified_closed'`, [w01.id])).rows[0];
  assert.equal(ev.actor_type, "manager");
  assert.equal(ev.payload.verification.role, "manager");
});

test("caretakers can't see the queue or accept their own work", async () => {
  const w01 = await readyW01();
  assert.equal((await api("/api/instances?state=decisions", { token: care })).status, 403);
  assert.equal((await api(`/api/instances/${w01.id}/decision`, { method: "POST", token: care, body: { action: "accept" } })).status, 403);
  assert.equal((await getInstance(w01.id)).state, "needs_review");
});

test("send back needs a reason, reopens the task and tells the caretaker", async () => {
  const w01 = await readyW01();
  const noReason = await api(`/api/instances/${w01.id}/decision`, { method: "POST", token: owner, body: { action: "send_back" } });
  assert.equal(noReason.status, 400);
  const r = await api(`/api/instances/${w01.id}/decision`, { method: "POST", token: owner,
    body: { action: "send_back", note: "Gauge not visible in the photo" } });
  assert.equal(r.json.state, "released");
  const msg = (await q(`SELECT * FROM wa_messages WHERE kind = 'sent_back'`)).rows[0];
  assert.equal(msg.related_instance_id, w01.id);
  assert.equal(msg.payload.template.params[1], "Gauge not visible in the photo");
});

test("accept all takes only clean tasks; flagged ones stay for a look", async () => {
  const a = await readyW01(0);
  const b = await readyW01(1);
  // A flagged task: done without its required readings.
  const [w02] = await instancesByCode("W-02");
  await appendEvent(w02.id, "done_reported", {});
  assert.equal((await getInstance(w02.id)).state, "needs_review");

  const r = await api("/api/instances/accept", { method: "POST", token: manager, body: { ids: [a.id, b.id, w02.id] } });
  assert.deepEqual(r.json.accepted.sort(), [a.id, b.id].sort());
  assert.deepEqual(r.json.skipped, [w02.id]);
  assert.equal((await getInstance(w02.id)).state, "needs_review");
});

test("offline decisions replay safely: same event id twice is one decision; a decided task can't be re-decided", async () => {
  const w01 = await readyW01();
  const eventUuid = randomUUID();
  const first = await api(`/api/instances/${w01.id}/decision`, { method: "POST", token: owner, body: { action: "accept", event_uuid: eventUuid } });
  assert.equal(first.json.state, "verified_closed");
  const again = await api(`/api/instances/${w01.id}/decision`, { method: "POST", token: owner, body: { action: "accept", event_uuid: eventUuid } });
  assert.equal(again.json.duplicate, true);
  // The manager, also offline, sent it back meanwhile: arrives late and loses.
  const late = await api(`/api/instances/${w01.id}/decision`, { method: "POST", token: manager,
    body: { action: "send_back", note: "blurry", event_uuid: randomUUID() } });
  assert.ok([400, 409].includes(late.status));
  assert.equal((await getInstance(w01.id)).state, "verified_closed");
});

test("a photo still uploading holds the task; after a day it reaches the queue flagged", async () => {
  await tx((c) => runRelease(c, TODAY));
  const [w01] = await instancesByCode("W-01");
  const mediaUuid = randomUUID();
  await appendEvent(w01.id, "field_recorded", { fields: { level_pct: 60, pool_pct: 70 } });
  await appendEvent(w01.id, "media_attached", { media_uuid: mediaUuid, kind: "photo" });
  await appendEvent(w01.id, "done_reported", {});
  assert.equal((await getInstance(w01.id)).state, "done_reported", "evidence uploading");

  await q(`UPDATE task_instances SET updated_at = now() - interval '25 hours' WHERE id = $1`, [w01.id]);
  assert.equal(await acceptanceSweep(), 1);
  assert.equal((await getInstance(w01.id)).state, "needs_review");
  const flags = (await q(`SELECT payload FROM task_events WHERE instance_id = $1 AND type = 'review_required'`, [w01.id])).rows[0].payload.flags;
  assert.deepEqual(flags, [{ kind: "media_not_uploaded", expected: 1, received: 0 }]);
});

test("VIM annotations are advisory and need the shared secret", async () => {
  const w01 = await readyW01();
  const media = (await q(`SELECT media_uuid FROM media_objects WHERE instance_id = $1`, [w01.id])).rows[0];
  const body = { media_uuid: media.media_uuid, instance_id: w01.id, verdict: "fail", confidence: 0.9,
    extracted: { reason: "No water visible" }, model_version: "vim-1.1" };
  assert.equal((await api("/api/webhooks/vim", { method: "POST", body })).status, 403);
  assert.equal((await api("/api/vim/pending", {})).status, 403);

  process.env.VIM_WEBHOOK_SECRET = "vim-shared";
  try {
    const r = await api("/api/webhooks/vim", { method: "POST", body, headers: { "x-vim-secret": "vim-shared" } });
    assert.equal(r.status, 200);
    assert.equal((await getInstance(w01.id)).state, "needs_review", "a fail annotation doesn't move the task");
    const card = (await api("/api/instances?state=decisions", { token: owner })).json.instances.find((i) => i.id === w01.id);
    assert.equal(card.vim[0].note, "No water visible");
    const feed = await api("/api/vim/pending", { headers: { "x-vim-secret": "vim-shared" } });
    assert.deepEqual(feed.json.videos, [], "only videos are offered to VIM");
  } finally {
    delete process.env.VIM_WEBHOOK_SECRET;
  }
});

test("a caretaker's phone can't accept its own work or forge events through sync", async () => {
  const w01 = await readyW01();
  const r = await api("/api/sync/events", { method: "POST", token: care, body: { events: [
    { event_uuid: randomUUID(), instance_id: w01.id, type: "verified_closed", payload: {} },
    { event_uuid: randomUUID(), instance_id: w01.id, type: "auto_verified", actor_type: "owner", payload: {} },
  ] } });
  assert.equal(r.json.accepted.length, 0);
  assert.deepEqual(r.json.rejected.map((x) => x.reason), ["not allowed: verified_closed", "not allowed: auto_verified"]);
  assert.equal((await getInstance(w01.id)).state, "needs_review");

  // A field event claiming to be from the owner is recorded as the caretaker.
  const [k01] = await instancesByCode("K-01");
  await api("/api/sync/events", { method: "POST", token: care, body: { events: [
    { event_uuid: randomUUID(), instance_id: k01.id, type: "seen", actor_type: "owner", payload: {} },
  ] } });
  const ev = (await q(`SELECT actor_type FROM task_events WHERE instance_id = $1 AND type = 'seen'`, [k01.id])).rows[0];
  assert.equal(ev.actor_type, "caretaker");
});
