import { test, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prepareDb, resetDynamic, q } from "./helpers.js";
import { createApp } from "../src/app.js";
import { seed } from "../src/db/seed.js";
import { ringAreaHa } from "../src/engine/fields.js";

let server, base, owner, care;
const api = async (path, { method = "GET", token, body } = {}) => {
  const r = await fetch(base + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined });
  return { status: r.status, json: await r.json().catch(() => null) };
};
const login = async (email) => (await api("/api/auth/login", { method: "POST", body: { email, password: "woodlands" } })).json.token;
const outline = (token, o) => api("/api/sync/events", { method: "POST", token, body: { events: [{
  event_uuid: randomUUID(), instance_id: null, type: "field_recorded", payload: { outline: o }, device_time: new Date().toISOString() }] } });
const loc = async (code) => (await q(`SELECT * FROM locations WHERE code = $1`, [code])).rows[0];

// About 100 m x 100 m near the farm: one hectare.
const LAT = -18.9281, LNG = 29.8149, dLat = 100 / 111_320, dLng = 100 / (111_320 * Math.cos((LAT * Math.PI) / 180));
const SQUARE = [[LNG, LAT], [LNG + dLng, LAT], [LNG + dLng, LAT + dLat], [LNG, LAT + dLat]];

before(async () => {
  await prepareDb();
  server = createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  owner = await login("owner@woodlands.farm");
  care = await login("caretaker@woodlands.farm");
});
after(() => server?.close());
beforeEach(async () => { await resetDynamic(); await seed({ withUsers: false }); });

test("area: a 100 m square is one hectare", () => {
  assert.ok(Math.abs(ringAreaHa(SQUARE) - 1) < 0.01, String(ringAreaHa(SQUARE)));
});

test("outlines: owner's Google Earth outline applies; a caretaker's walk is proposed, then used or discarded", async () => {
  const bed = await loc("BLK-A");
  assert.deepEqual((await outline(owner, { location_id: bed.id, coordinates: SQUARE, source: "google_earth" })).json.rejected, []);
  let row = await loc("BLK-A");
  assert.equal(row.geom.type, "Polygon");
  assert.equal(row.geom.coordinates[0].length, 5, "ring closed");
  assert.ok(Math.abs(row.geom_meta.area_ha - 1) < 0.01);
  assert.equal(row.geom_meta.source, "google_earth");

  const walked = SQUARE.map(([x, y]) => [x, y + dLat / 10]);
  await outline(care, { location_id: bed.id, coordinates: walked, source: "gps_walk", accuracy_m: 4 });
  row = await loc("BLK-A");
  assert.equal(row.geom_meta.source, "google_earth", "caretaker can't overwrite");
  assert.equal(row.geom_proposed.source, "gps_walk");
  assert.equal(row.geom_proposed.accuracy_m, 4);

  // The walked outline is in the day bundle for the owner to see offline.
  const ref = (await fetch(`${base}/api/sync/bundle`, { headers: { Authorization: `Bearer ${owner}` } }).then((r) => r.json())).reference_delta;
  assert.ok(ref.locations.find((l) => l.code === "BLK-A").geom_proposed);

  // Owner uses it (re-sends the walked ring), which clears the proposal.
  await outline(owner, { location_id: bed.id, coordinates: walked, source: "gps_walk", accuracy_m: 4 });
  row = await loc("BLK-A");
  assert.equal(row.geom_meta.source, "gps_walk");
  assert.equal(row.geom_proposed, null);

  await outline(care, { location_id: bed.id, coordinates: SQUARE, source: "gps_walk" });
  await outline(care, { location_id: bed.id, discard: true });
  assert.ok((await loc("BLK-A")).geom_proposed, "caretaker can't discard");
  await outline(owner, { location_id: bed.id, discard: true });
  assert.equal((await loc("BLK-A")).geom_proposed, null);
});

test("outlines: a new bed named in Google Earth is created for owners only; bad rings are ignored", async () => {
  await outline(owner, { location_id: null, name: "Seedling nursery", coordinates: SQUARE });
  const made = (await q(`SELECT * FROM locations WHERE name = 'Seedling nursery'`)).rows[0];
  assert.equal(made.kind, "block");
  assert.ok(made.geom_meta.area_ha > 0.9);
  await outline(care, { location_id: null, name: "Caretaker field", coordinates: SQUARE });
  assert.equal((await q(`SELECT count(*)::int AS n FROM locations WHERE name = 'Caretaker field'`)).rows[0].n, 0);
  const bed = await loc("BLK-B");
  await outline(owner, { location_id: bed.id, coordinates: [[LNG, LAT], [LNG, LAT]] });
  assert.equal((await loc("BLK-B")).geom, null);
});
