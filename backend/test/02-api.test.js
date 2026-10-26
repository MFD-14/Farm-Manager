import { test, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prepareDb, resetDynamic, tx, q, instancesByCode, getInstance } from "./helpers.js";
import { createApp } from "../src/app.js";
import { runRelease } from "../src/engine/release.js";

const TODAY = "2026-08-03";
let server, base, caretakerToken, ownerToken;

async function api(path, { method = "GET", token, body, headers = {}, raw } = {}) {
  const resp = await fetch(base + path, {
    method,
    headers: {
      ...(raw ? {} : { "Content-Type": "application/json" }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: raw ? body : body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await resp.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* raw */ }
  return { status: resp.status, json, text, headers: resp.headers };
}

before(async () => {
  await prepareDb();
  const app = createApp();
  server = app.listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  const c = await api("/api/auth/login", { method: "POST", body: { email: "caretaker@woodlands.farm", password: "woodlands" } });
  caretakerToken = c.json.token;
  const o = await api("/api/auth/login", { method: "POST", body: { email: "owner@woodlands.farm", password: "woodlands" } });
  ownerToken = o.json.token;
});
beforeEach(async () => { await resetDynamic(); });
after(() => server?.close());

test("auth: login works, bad password rejected", async () => {
  const bad = await api("/api/auth/login", { method: "POST", body: { email: "caretaker@woodlands.farm", password: "wrong" } });
  assert.equal(bad.status, 401);
  const me = await api("/api/auth/me", { token: caretakerToken });
  assert.equal(me.json.user.role, "caretaker");
});

test("sync: events endpoint accepts, dedupes and returns server events", async () => {
  await tx((c) => runRelease(c, TODAY));
  const [w02] = await instancesByCode("W-02");
  const ev = {
    event_uuid: randomUUID(), instance_id: w02.id, type: "done_reported",
    payload: { fields: { start_time: "06:00", stop_time: "12:00", run_hours: 6 } },
    device_time: new Date().toISOString(),
  };
  const r1 = await api("/api/sync/events", { method: "POST", token: caretakerToken, body: { events: [ev] } });
  assert.equal(r1.status, 200);
  assert.deepEqual(r1.json.accepted, [ev.event_uuid]);
  const r2 = await api("/api/sync/events", { method: "POST", token: caretakerToken, body: { events: [ev] } });
  assert.deepEqual(r2.json.duplicates, [ev.event_uuid], "resend is duplicate, not error");
  assert.ok(r2.json.server_events.length > 0, "server events flow back");
  assert.equal((await getInstance(w02.id)).state, "verified_closed");
});

test("sync: bundle returns plan, templates and reference", async () => {
  await tx((c) => runRelease(c, TODAY));
  const r = await api(`/api/sync/bundle?date=${TODAY}`, { token: caretakerToken });
  assert.equal(r.status, 200);
  assert.ok(r.json.plan.instances.length > 10);
  assert.ok(r.json.templates_delta.length > 50);
  assert.ok(r.json.reference_delta.locations.length > 0);
});

test("owner decision: reject reopens a needs_review task", async () => {
  await tx((c) => runRelease(c, TODAY));
  const [w01] = await instancesByCode("W-01");
  // Evidence-short done -> needs_review
  await api("/api/sync/events", {
    method: "POST", token: caretakerToken,
    body: { events: [{ event_uuid: randomUUID(), instance_id: w01.id, type: "done_reported", payload: {} }] },
  });
  assert.equal((await getInstance(w01.id)).state, "needs_review");
  // Caretaker cannot decide
  const forbidden = await api(`/api/instances/${w01.id}/decision`, {
    method: "POST", token: caretakerToken, body: { action: "verify" } });
  assert.equal(forbidden.status, 403);
  // Owner rejects: back to released with new due
  const r = await api(`/api/instances/${w01.id}/decision`, {
    method: "POST", token: ownerToken, body: { action: "reject", note: "photo missing" } });
  assert.equal(r.status, 200);
  const after = await getInstance(w01.id);
  assert.equal(after.state, "released");
  assert.equal(after.rejection_count, 1);
});

test("media: initiate, chunked PATCH with offset recovery; the stored photo sends the task for acceptance", async () => {
  await tx((c) => runRelease(c, TODAY));
  const [w01] = await instancesByCode("W-01");
  const mediaUuid = randomUUID();
  const blob = Buffer.alloc(2048, 7); // fake jpeg bytes

  // Report fields + media_attached + done first (deferred media path, spec 5.3)
  await api("/api/sync/events", {
    method: "POST", token: caretakerToken,
    body: { events: [
      { event_uuid: randomUUID(), instance_id: w01.id, type: "field_recorded", payload: { fields: { level_pct: 55, pool_pct: 60 } } },
      { event_uuid: randomUUID(), instance_id: w01.id, type: "media_attached", payload: { media_uuid: mediaUuid, kind: "photo" } },
      { event_uuid: randomUUID(), instance_id: w01.id, type: "done_reported", payload: {} },
    ] },
  });
  assert.equal((await getInstance(w01.id)).state, "done_reported", "verifiable-pending-media");

  const init = await api("/api/media/initiate", {
    method: "POST", token: caretakerToken,
    body: { media_uuid: mediaUuid, instance_id: w01.id, kind: "photo", bytes: blob.length },
  });
  assert.equal(init.json.offset, 0);

  // First chunk
  const c1 = await api(`/api/media/${mediaUuid}`, {
    method: "PATCH", token: caretakerToken, raw: true, body: blob.subarray(0, 1024),
    headers: { "Upload-Offset": "0", "Content-Type": "application/offset+octet-stream" },
  });
  assert.equal(c1.status, 308);
  // Wrong offset (simulating a retry after network loss) gets 308 + current offset
  const cBad = await api(`/api/media/${mediaUuid}`, {
    method: "PATCH", token: caretakerToken, raw: true, body: blob.subarray(0, 10),
    headers: { "Upload-Offset": "0", "Content-Type": "application/offset+octet-stream" },
  });
  assert.equal(cBad.status, 308);
  assert.equal(cBad.headers.get("upload-offset"), "1024");
  // Final chunk
  const c2 = await api(`/api/media/${mediaUuid}`, {
    method: "PATCH", token: caretakerToken, raw: true, body: blob.subarray(1024),
    headers: { "Upload-Offset": "1024", "Content-Type": "application/offset+octet-stream" },
  });
  assert.equal(c2.status, 204);

  const done = await api(`/api/media/${mediaUuid}/complete`, { method: "POST", token: caretakerToken });
  assert.equal(done.json.stored, true);

  // Photo logged with the task; it waits for an owner or task manager to accept.
  assert.equal((await getInstance(w01.id)).state, "needs_review");
  const queue = await api("/api/instances?state=decisions", { token: ownerToken });
  const card = queue.json.instances.find((i) => i.id === w01.id);
  assert.equal(card.ready_to_accept, true);
  assert.equal(card.media[0].media_uuid, mediaUuid);
  const accept = await api(`/api/instances/${w01.id}/decision`, { method: "POST", token: ownerToken, body: { action: "accept" } });
  assert.equal(accept.json.state, "verified_closed");
  assert.equal((await getInstance(w01.id)).verification.method, "accepted");
});

test("whatsapp webhook: Done button appends done_reported; inbound is idempotent", async () => {
  await tx((c) => runRelease(c, TODAY));
  // Make exactly one open task for the caretaker: cancel everything else
  const all = (await q(`SELECT id FROM task_instances WHERE state IN ('released','acknowledged')`)).rows;
  const keep = (await instancesByCode("K-01"))[0];
  for (const r of all) {
    if (r.id !== keep.id) {
      await q(`INSERT INTO task_events (event_uuid, instance_id, actor_type, type) VALUES ($1,$2,'owner','cancelled')`, [randomUUID(), r.id]);
      await q(`UPDATE task_instances SET state = 'cancelled' WHERE id = $1`, [r.id]);
    }
  }
  const waMsg = {
    entry: [{ changes: [{ value: { messages: [{
      id: "wamid.TEST1", from: "263770000002", type: "interactive",
      interactive: { button_reply: { id: "done", title: "Done" } },
    }] } }] }],
  };
  const r1 = await api("/api/webhooks/whatsapp", { method: "POST", body: waMsg });
  assert.equal(r1.status, 200);
  await new Promise((res) => setTimeout(res, 300)); // webhook processes after ack
  assert.equal((await getInstance(keep.id)).state, "done_reported");
  // Same wa_message_id again: no duplicate processing
  await api("/api/webhooks/whatsapp", { method: "POST", body: waMsg });
  await new Promise((res) => setTimeout(res, 200));
  const events = (await q(`SELECT * FROM task_events WHERE instance_id = $1 AND type = 'done_reported'`, [keep.id])).rows;
  assert.equal(events.length, 1);
  // Window opened by inbound message (spec 1.7)
  const contact = (await q(`SELECT * FROM wa_contacts WHERE wa_phone = '+263770000002'`)).rows[0];
  assert.ok(new Date(contact.window_open_until) > new Date());
});

test("devices: register issues device-bound token; restore returns working set; revoke kills it", async () => {
  await tx((c) => runRelease(c, TODAY));
  const reg = await api("/api/devices/register", { method: "POST", token: caretakerToken, body: { platform: "android" } });
  assert.ok(reg.json.device_id);
  const deviceToken = reg.json.token;
  const restore = await api(`/api/devices/${reg.json.device_id}/restore`, { method: "POST", token: deviceToken });
  assert.ok(restore.json.open_instances.length > 0);
  assert.ok(restore.json.templates.length > 50);
  const revoke = await api(`/api/devices/${reg.json.device_id}/revoke`, { method: "POST", token: ownerToken });
  assert.equal(revoke.status, 200);
  const blocked = await api("/api/auth/me", { token: deviceToken });
  assert.equal(blocked.status, 401, "revoked device token rejected");
});

test("owner: digest and kpis endpoints respond", async () => {
  await tx((c) => runRelease(c, TODAY));
  const digest = await api(`/api/owner/digest?date=${TODAY}`, { token: ownerToken });
  assert.equal(digest.status, 200);
  assert.ok(digest.json.completion);
  const kpis = await api("/api/owner/kpis?period=7", { token: ownerToken });
  assert.equal(kpis.status, 200);
});

test("absence mode: skip auto-approves after 48h", async () => {
  await tx((c) => runRelease(c, TODAY));
  const [k01] = await instancesByCode("K-01");
  await api("/api/sync/events", {
    method: "POST", token: caretakerToken,
    body: { events: [{ event_uuid: randomUUID(), instance_id: k01.id, type: "skip_requested", payload: { reason_code: "rain" } }] },
  });
  await api("/api/owner/absence", { method: "POST", token: ownerToken, body: { active: true } });
  // Age the pending skip beyond 48h
  await q(`UPDATE task_instances SET updated_at = now() - interval '49 hours' WHERE id = $1`, [k01.id]);
  const { runEscalationSweep } = await import("../src/engine/escalation.js");
  await tx((c) => runEscalationSweep(c));
  const after = await getInstance(k01.id);
  assert.equal(after.state, "skipped");
});
