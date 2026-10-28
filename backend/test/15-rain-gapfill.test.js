// Rainfall gap-fill: the gauge always wins; Open-Meteo's past week and NASA
// POWER fill the days without a reading; estimates never trigger T2.
import { test, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { prepareDb, resetDynamic, tx, q } from "./helpers.js";
import { createApp } from "../src/app.js";
import { fetchForecast } from "../src/workers/forecast.js";
import { fetchNasaPower, dailyRain, rainForDay, storeEstimates, SOURCES } from "../src/engine/rainfall.js";
import { evaluateRules } from "../src/engine/rules.js";
import { runRelease } from "../src/engine/release.js";
import { farmDateStr, addDays } from "../src/util/time.js";

const TODAY = farmDateStr();
const realFetch = globalThis.fetch;
let server, base, ownerToken, urls;

// Answer external weather calls with canned JSON; everything else goes through.
function fakeWeather(body) {
  urls = [];
  globalThis.fetch = async (url, opts) => {
    if (String(url).startsWith("http://127.0.0.1")) return realFetch(url, opts);
    urls.push(String(url));
    return { ok: true, status: 200, json: async () => body };
  };
}
const gauge = (date, mm) => q(
  `INSERT INTO readings (metric, value, unit, taken_at) VALUES ('rain_mm', $1, 'mm', $2)`, [mm, `${date}T07:00:00+02:00`]);

before(async () => {
  await prepareDb();
  server = createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  const r = await realFetch(`${base}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "owner@woodlands.farm", password: "woodlands" }) });
  ownerToken = (await r.json()).token;
});
beforeEach(async () => {
  globalThis.fetch = realFetch;
  await resetDynamic();
  await q(`DELETE FROM farm_settings WHERE key = 'forecast'`);
});
after(() => { globalThis.fetch = realFetch; server.close(); });

test("Open-Meteo past days become estimates; the forecast snapshot stays today onwards", async () => {
  const time = [-3, -2, -1, 0, 1].map((n) => addDays(TODAY, n));
  fakeWeather({ daily: { time, precipitation_sum: [12.34, null, 4, 1, 20], precipitation_probability_max: [0, 0, 0, 30, 80],
    temperature_2m_max: [28, 28, 28, 28, 28], temperature_2m_min: [14, 14, 14, 14, 14], et0_fao_evapotranspiration: [4, 4, 4, 4.2, 4] } });
  assert.equal((await tx((c) => fetchForecast(c))).ok, true);
  assert.match(urls[0], /past_days=7/);

  const snap = (await q(`SELECT value FROM farm_settings WHERE key = 'forecast'`)).rows[0].value;
  assert.deepEqual(snap.daily.map((d) => d.date), [TODAY, addDays(TODAY, 1)]);
  const est = (await q(`SELECT value FROM readings WHERE metric = $1 ORDER BY taken_at`, [SOURCES["open-meteo"]])).rows;
  assert.deepEqual(est.map((r) => Number(r.value)), [12.3, 4], "null days skipped, values rounded");

  // A second fetch replaces, never duplicates.
  await tx((c) => fetchForecast(c));
  assert.equal((await q(`SELECT COUNT(*)::int AS n FROM readings WHERE metric = $1`, [SOURCES["open-meteo"]])).rows[0].n, 2);
});

test("NASA POWER fills older days, skipping missing (-999) values", async () => {
  const k = (n) => addDays(TODAY, n).replaceAll("-", "");
  fakeWeather({ properties: { parameter: { PRECTOTCORR: { [k(-30)]: 8.26, [k(-29)]: 0, [k(-2)]: -999 } } } });
  const r = await tx((c) => fetchNasaPower(c));
  assert.deepEqual(r, { ok: true, days: 2 });
  assert.match(urls[0], /power\.larc\.nasa\.gov.*PRECTOTCORR.*start=\d{4}1001/);
  assert.equal(await tx((c) => rainForDay(c, addDays(TODAY, -30))), 8.3);
});

test("the gauge wins over Open-Meteo, which wins over NASA", async () => {
  const [a, b, c3] = [-5, -4, -3].map((n) => addDays(TODAY, n));
  await gauge(a, 10);
  await tx(async (c) => {
    await storeEstimates(c, SOURCES["open-meteo"], { [a]: 30, [b]: 6 });
    await storeEstimates(c, SOURCES.nasa, { [a]: 50, [b]: 9, [c3]: 2 });
  });
  const days = await tx((c) => dailyRain(c, a, addDays(TODAY, -2)));
  assert.deepEqual(days, [
    { date: a, mm: 10, source: "gauge" },
    { date: b, mm: 6, source: "open-meteo" },
    { date: c3, mm: 2, source: "nasa" },
    { date: addDays(TODAY, -2), mm: null, source: null },
  ]);
});

test("estimates never trigger T2; only the gauge does", async () => {
  await tx((c) => runRelease(c, TODAY));
  await tx(async (c) => {
    await storeEstimates(c, SOURCES["open-meteo"], { [addDays(TODAY, -1)]: 40, [TODAY]: 40 });
  });
  const firings = await tx((c) => evaluateRules(c));
  assert.ok(!firings.find((f) => f.rule === "T2 Rain suppression"), "no T2 from estimates");
});

test("rain page totals include estimated days and mark them", async () => {
  await gauge(addDays(TODAY, -1), 5);
  await tx(async (c) => {
    await storeEstimates(c, SOURCES["open-meteo"], { [addDays(TODAY, -2)]: 7 });
  });
  const r = await realFetch(`${base}/api/owner/rain?days=14`, { headers: { Authorization: `Bearer ${ownerToken}` } });
  const body = await r.json();
  assert.deepEqual(body.days.slice(-2).map((d) => [d.mm, d.source, d.estimated]), [[7, "open-meteo", true], [5, "gauge", false]]);
  assert.equal(body.today_has_reading, false);
  const cur = body.seasons.find((s) => s.current);
  if (addDays(TODAY, -2) >= body.season.start) {
    assert.equal(body.season.total_mm, 12);
    assert.equal(body.season.estimated_days, 1);
    assert.equal(cur.total_mm, 12);
  }
});
