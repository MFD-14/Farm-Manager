// End-to-end simulated farm day against a running server: pulls the bundle,
// works through the caretaker's plan over the sync API exactly as the PWA does,
// uploads evidence, lets VIM verify, exercises a trigger and prints the digest.
// Usage: node scripts/simulate-day.js [baseUrl]
import { randomUUID } from "node:crypto";

const base = process.argv[2] || "http://127.0.0.1:4000";
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
};

async function api(path, { method = "GET", token, body, raw, headers = {} } = {}) {
  const resp = await fetch(base + path, {
    method,
    headers: {
      ...(raw ? {} : { "Content-Type": "application/json" }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers,
    },
    body: raw ? body : body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await resp.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  return { status: resp.status, json, headers: resp.headers };
}

const ev = (instance_id, type, payload = {}) => ({
  event_uuid: randomUUID(), instance_id, type, payload, device_time: new Date().toISOString(),
});

async function send(token, events) {
  const r = await api("/api/sync/events", { method: "POST", token, body: { events } });
  return r.json;
}

async function main() {
  // Login both roles
  const care = (await api("/api/auth/login", { method: "POST", body: { email: "caretaker@woodlands.farm", password: "woodlands" } })).json;
  const own = (await api("/api/auth/login", { method: "POST", body: { email: "owner@woodlands.farm", password: "woodlands" } })).json;
  check("login caretaker + owner", !!care?.token && !!own?.token);

  // Owner triggers the 04:45 release
  const rel = await api("/api/owner/release-now", { method: "POST", token: own.token, body: {} });
  check("release engine materialises the day", rel.status === 200 && rel.json.planIds.length > 10,
    `${rel.json.planIds?.length} instances`);

  // Caretaker pulls the bundle
  const bundle = (await api("/api/sync/bundle", { token: care.token })).json;
  const plan = bundle.plan?.instances || [];
  check("bundle carries the plan + reference", plan.length > 10 && bundle.reference_delta.locations.length > 0);

  const byCode = (code) => plan.filter((i) => i.template_code === code);

  // 06:00 W-01 tank reading with photo evidence
  const w01 = byCode("W-01")[0];
  const mediaUuid = randomUUID();
  await send(care.token, [
    ev(w01.id, "field_recorded", { fields: { level_pct: 62, pool_pct: 70 } }),
    ev(w01.id, "media_attached", { media_uuid: mediaUuid, kind: "photo" }),
    ev(w01.id, "done_reported", {}),
  ]);
  // Upload the photo (single chunk)
  const blob = Buffer.alloc(4096, 42);
  await api("/api/media/initiate", { method: "POST", token: care.token,
    body: { media_uuid: mediaUuid, instance_id: w01.id, kind: "photo", bytes: blob.length } });
  await api(`/api/media/${mediaUuid}`, { method: "PATCH", token: care.token, raw: true, body: blob,
    headers: { "Upload-Offset": "0", "Content-Type": "application/offset+octet-stream" } });
  await api(`/api/media/${mediaUuid}/complete`, { method: "POST", token: care.token });
  // VIM verifies on the 5-minute sweep; poke it via the worker path
  const { processVimQueue } = await import("../src/workers/vim.js");
  await processVimQueue();
  const w01After = (await api(`/api/instances/${w01.id}`, { token: care.token })).json;
  check("W-01: evidence + VIM -> verified_closed", w01After.instance.state === "verified_closed",
    `method=${w01After.instance.verification?.method}`);

  // W-02 pump log: 6 hours -> meter accumulates
  const w02 = byCode("W-02")[0];
  await send(care.token, [ev(w02.id, "done_reported", { fields: { start_time: "06:10", stop_time: "12:20", run_hours: 6.2 } })]);

  // C-01 kale harvest count
  const c01 = byCode("C-01")[0];
  await send(care.token, [ev(c01.id, "field_recorded", { fields: { bundle_count: 52 } }), ev(c01.id, "done_reported", {})]);

  // Irrigation shifts
  for (const shift of byCode("W-03")) {
    await send(care.token, [ev(shift.id, "field_recorded", { fields: { litres: shift.params.litres, minutes: shift.params.minutes } }), ev(shift.id, "done_reported", {})]);
  }

  // K-01 skip (rain) -> owner approves
  const k01 = byCode("K-01")[0];
  await send(care.token, [ev(k01.id, "skip_requested", { reason_code: "rain", note: "kraal flooded" })]);
  const dec = await api(`/api/instances/${k01.id}/decision`, { method: "POST", token: own.token, body: { action: "approve_skip" } });
  check("skip flow: caretaker requests, owner approves", dec.status === 200 && dec.json.state === "skipped");

  // Trigger T1: low water reading fires the protocol
  const w01b = byCode("W-01")[1];
  await send(care.token, [
    ev(w01b.id, "field_recorded", { fields: { level_pct: 15, pool_pct: 10 } }),
    ev(w01b.id, "done_reported", {}),
  ]);
  await new Promise((r) => setTimeout(r, 300));
  const openNow = (await api("/api/instances?state=released", { token: own.token })).json.instances;
  const we1 = openNow.find((i) => i.template_code === "W-E1");
  check("T1 low water trigger releases W-E1 protocol task", !!we1);

  // Owner digest
  const digest = (await api("/api/owner/digest", { token: own.token })).json;
  check("digest: completion/water/money lines computed",
    digest.completion.total > 0 && digest.water.litres_pumped === 37200,
    `verified=${digest.completion.verified} pumped=${digest.water.litres_pumped}L`);

  const kpis = (await api("/api/owner/kpis?period=7", { token: own.token })).json;
  check("KPIs computed", kpis.overall_completion_pct !== undefined,
    `completion=${kpis.overall_completion_pct}% auto-verify=${kpis.auto_verification_pct}%`);

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} scenario checks passed`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
