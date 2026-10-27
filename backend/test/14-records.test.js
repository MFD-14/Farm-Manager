import { test, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prepareDb, resetDynamic, q } from "./helpers.js";
import { createApp } from "../src/app.js";
import { seed } from "../src/db/seed.js";

let server, base, owner, care;
const api = async (path, { method = "GET", token, body } = {}) => {
  const r = await fetch(base + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined });
  return { status: r.status, json: await r.json().catch(() => null) };
};
const login = async (email) => (await api("/api/auth/login", { method: "POST", body: { email, password: "woodlands" } })).json.token;
const record = (token, r) => api("/api/sync/events", { method: "POST", token, body: { events: [{
  event_uuid: randomUUID(), instance_id: null, type: "field_recorded", payload: { record: r }, device_time: new Date().toISOString() }] } });

before(async () => {
  await prepareDb();
  server = createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  owner = await login("owner@woodlands.farm");
  care = await login("caretaker@woodlands.farm");
});
after(() => server?.close());
beforeEach(async () => { await resetDynamic(); await seed({ withUsers: false }); });

test("records: harvests, activities and livestock records sync from the field; costs only reach owners", async () => {
  assert.equal((await record(care, { type: "harvest", crop: "Tomato", quantity: 120, unit: "kg", date: "2026-10-26" })).json.accepted.length, 1);
  await record(care, { type: "activity", activity: "Spraying", cost_usd: 35, date: "2026-10-26" });
  await record(care, { type: "breeding", species: "Cattle", animal: "Tag 14", date: "2026-08-01", status: "Pregnant" });

  const own = (await api("/api/sync/notes?kind=record", { token: owner })).json.notes;
  assert.equal(own.length, 3);
  assert.equal(own.find((n) => n.record.type === "activity").record.cost_usd, 35);
  assert.equal(own.find((n) => n.record.type === "harvest").by, "Caretaker");
  const mine = (await api("/api/sync/notes?kind=record", { token: care })).json.notes;
  assert.equal(mine.find((n) => n.record.type === "activity").record.cost_usd, undefined, "caretakers don't see costs");
  assert.equal(mine.find((n) => n.record.type === "harvest").record.quantity, 120);

  const ref = (await fetch(`${base}/api/sync/bundle`, { headers: { Authorization: `Bearer ${care}` } }).then((r) => r.json())).reference_delta;
  assert.ok(ref.herds.length > 0, "herds ride in the bundle for livestock records");
});

test("records: Add field creates a bed with its size for owners only", async () => {
  await record(owner, { type: "field", name: "North kale bed", size: 1, size_unit: "acres", soil: "Loam" });
  const bed = (await q(`SELECT * FROM locations WHERE name = 'North kale bed'`)).rows[0];
  assert.equal(bed.kind, "block");
  assert.equal(bed.soil, "Loam");
  assert.equal(bed.geom_meta.area_ha, 0.405);
  await record(care, { type: "field", name: "Caretaker bed", size: 1, size_unit: "ha" });
  assert.equal((await q(`SELECT count(*)::int AS n FROM locations WHERE name = 'Caretaker bed'`)).rows[0].n, 0);
});

test("sales: any number a day (walk-ins), counted in revenue and bundles sold; amounts hidden from caretakers", async () => {
  const sale = (q, usd, buyer) => record(care, { type: "sale", product: "Kale", quantity: q, unit: "bundles", price_usd: usd, buyer, payment: "Cash", date: "2026-10-27" });
  await sale(40, 40, "Mbare market");
  await sale(5, 5, "Walk-in");
  await sale(3, 3, "Walk-in");
  await record(care, { type: "sale", product: "Eggs", quantity: 2, unit: "trays", price_usd: 10, buyer: "Walk-in", payment: "EcoCash", date: "2026-10-27" });

  const sum = async (m) => Number((await q(`SELECT COALESCE(SUM(value), 0) AS v FROM readings WHERE metric = $1`, [m])).rows[0].v);
  assert.equal(await sum("sales_usd"), 58);
  assert.equal(await sum("bundles_sold"), 48, "only sales counted in bundles");
  assert.equal((await api("/api/owner/digest", { token: owner })).json.week.revenue_usd.now, 58);

  const mine = (await api("/api/sync/notes?kind=record", { token: care })).json.notes.filter((n) => n.record.type === "sale");
  assert.equal(mine.length, 4);
  assert.ok(mine.every((n) => n.record.price_usd === undefined));
  const own = (await api("/api/sync/notes?kind=record", { token: owner })).json.notes.filter((n) => n.record.type === "sale");
  assert.equal(own.reduce((a, n) => a + n.record.price_usd, 0), 58);
});

test("sales: the old daily sales task no longer releases", async () => {
  assert.equal((await q(`SELECT schedule FROM task_templates WHERE code = 'C-02'`)).rows[0].schedule, null);
});
