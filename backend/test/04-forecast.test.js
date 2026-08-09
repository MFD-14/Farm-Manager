import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { prepareDb, resetDynamic, appendEvent, getInstance, instancesByCode, tx, q } from "./helpers.js";
import { runRelease } from "../src/engine/release.js";
import { evaluateRules } from "../src/engine/rules.js";
import { buildDigest } from "../src/engine/digest.js";
import { forecastFor } from "../src/workers/forecast.js";
import { farmDateStr, farmTime, addDays } from "../src/util/time.js";

const TODAY = farmDateStr(); // forecast paths compare against the real farm date

async function injectForecast(daily, { ageHours = 0 } = {}) {
  const snapshot = {
    provider: "open-meteo",
    fetched_at: new Date(Date.now() - ageHours * 3_600_000).toISOString(),
    daily,
  };
  await q(
    `INSERT INTO farm_settings (key, value) VALUES ('forecast', $1)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [JSON.stringify(snapshot)]);
}

const day = (offset, rain_mm, prob_pct, extra = {}) => ({
  date: addDays(TODAY, offset), rain_mm, prob_pct, tmax: 28, tmin: 14, et0_mm: 4.2, ...extra,
});

before(async () => { await prepareDb(); });
beforeEach(async () => {
  await resetDynamic();
  await q(`DELETE FROM farm_settings WHERE key = 'forecast'`);
});

test("T2 fires ahead of confident heavy rain in tomorrow's forecast", async () => {
  await tx((c) => runRelease(c, TODAY));
  assert.ok((await instancesByCode("W-03")).length >= 2);
  await injectForecast([day(0, 2, 30), day(1, 22, 85), day(2, 5, 40)]);
  const firings = await tx((c) => evaluateRules(c));
  const t2 = firings.find((f) => f.rule === "T2 Rain suppression");
  assert.ok(t2, "T2 fired from forecast");
  // Today's released shifts expired, tomorrow suppressed
  for (const s of await instancesByCode("W-03")) {
    assert.equal((await getInstance(s.id)).state, "expired");
  }
  const suppressions = (await q(`SELECT value FROM farm_settings WHERE key = 'suppressions'`)).rows[0].value;
  assert.ok(suppressions.some((x) => x.template === "W-03" && x.date === addDays(TODAY, 1)));
});

test("low-probability or light forecast rain does not fire T2", async () => {
  await tx((c) => runRelease(c, TODAY));
  await injectForecast([day(0, 0, 10), day(1, 22, 40)]); // heavy but only 40% confident
  let firings = await tx((c) => evaluateRules(c));
  assert.ok(!firings.some((f) => f.rule === "T2 Rain suppression"), "40% probability ignored");
  await injectForecast([day(0, 0, 10), day(1, 8, 95)]); // confident but light
  firings = await tx((c) => evaluateRules(c));
  assert.ok(!firings.some((f) => f.rule === "T2 Rain suppression"), "8mm ignored");
});

test("gauge wins over forecast: observed 20mm fires with source=gauge", async () => {
  await tx((c) => runRelease(c, TODAY));
  await injectForecast([day(0, 0, 5), day(1, 0, 5)]); // dry forecast
  const [g] = await instancesByCode("W-08");
  await appendEvent(g.id, "done_reported", { fields: { rain_mm: 20 } });
  const firings = await tx((c) => evaluateRules(c));
  const t2 = firings.find((f) => f.rule === "T2 Rain suppression");
  assert.ok(t2, "observed rain fires regardless of dry forecast");
});

test("stale forecast is ignored", async () => {
  await tx((c) => runRelease(c, TODAY));
  await injectForecast([day(0, 30, 90), day(1, 30, 90)], { ageHours: 48 });
  const fc = await tx((c) => forecastFor(c, addDays(TODAY, 1)));
  assert.equal(fc, null, "36h max age enforced");
  const firings = await tx((c) => evaluateRules(c));
  assert.ok(!firings.some((f) => f.rule === "T2 Rain suppression"));
});

test("digest carries rain expected tomorrow; rain endpoint exposes the forecast", async () => {
  await injectForecast([day(0, 3, 45), day(1, 18, 75)]);
  const digest = await tx((c) => buildDigest(c, TODAY));
  assert.deepEqual(digest.water.rain_expected_tomorrow, { mm: 18, prob_pct: 75 });

  const { createApp } = await import("../src/app.js");
  const server = createApp().listen(0);
  try {
    const login = await fetch(`http://127.0.0.1:${server.address().port}/api/auth/login`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "owner@woodlands.farm", password: "woodlands" }),
    }).then((r) => r.json());
    const r = await fetch(`http://127.0.0.1:${server.address().port}/api/owner/rain`, {
      headers: { Authorization: `Bearer ${login.token}` } }).then((x) => x.json());
    assert.equal(r.forecast.provider, "open-meteo");
    assert.equal(r.forecast.daily.length, 2);
  } finally {
    server.close();
  }
});
