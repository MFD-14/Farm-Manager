// Forecast feed (spec 3.4 T2: "Source: forecast API, or caretaker rain-gauge
// reading, which wins over forecast").
//
// Provider: Open-Meteo (https://open-meteo.com) — chosen because it needs no
// API key or registration, allows ~10,000 requests/day free for non-commercial
// use, covers any coordinate worldwide with 16-day daily forecasts, and serves
// FAO-56 reference evapotranspiration (et0), which the Phase 2 water-balance
// irrigation planner needs (spec R14). A fetch every three hours is under 0.1%
// of the quota.
//
// The fetched forecast is stored in farm_settings under 'forecast' so the rule
// engine, digest and rain page all read one snapshot; tests inject the same
// shape directly and never touch the network.
//
// The same request returns the past 7 days (past_days=7); those become the
// Open-Meteo rainfall estimates that fill days the gauge wasn't read
// (engine/rainfall.js). The stored snapshot stays today onwards, and carries
// wind, sky condition and the daylight hours of today and tomorrow, from which
// the safe spraying windows are worked out.
import { config } from "../config.js";
import { farmPoint } from "../engine/farmPoint.js";
import { storeEstimates, SOURCES } from "../engine/rainfall.js";
import { farmDateStr } from "../util/time.js";

const DAILY = "precipitation_sum,precipitation_probability_max,temperature_2m_max,temperature_2m_min," +
  "et0_fao_evapotranspiration,weather_code,wind_speed_10m_max,wind_gusts_10m_max";
const HOURLY = "temperature_2m,relative_humidity_2m,precipitation_probability,precipitation,wind_speed_10m";
const num = (v) => (v == null ? null : Number(v));
const r1 = (v) => Math.round(v * 10) / 10;

// Delta T (dry bulb minus wet bulb, °C): the standard spraying indicator.
// Wet bulb from temperature and humidity by Stull's formula (2011).
export function deltaT(temp, rh) {
  const wet = temp * Math.atan(0.151977 * Math.sqrt(rh + 8.313659)) + Math.atan(temp + rh) - Math.atan(rh - 1.676331)
    + 0.00391838 * rh ** 1.5 * Math.atan(0.023101 * rh) - 4.686035;
  return r1(temp - wet);
}

// An hour is fit for spraying when there is a light steady breeze (3 to 15
// km/h: calm air risks an inversion, more drifts), Delta T is 2 to 8 (the
// droplets neither hang nor evaporate), and no rain falls then or is likely
// in the three hours after (time for the spray to dry on the leaf).
export function sprayWindows(hours) {
  const ok = hours.map((h, i) => {
    const ahead = hours.slice(i, i + 4);
    return h.wind_kmh >= 3 && h.wind_kmh <= 15 && h.delta_t >= 2 && h.delta_t <= 8
      && ahead.every((a) => a.rain_mm < 0.2 && a.prob_pct < 40);
  });
  const windows = [];
  hours.forEach((h, i) => {
    if (!ok[i]) return;
    const hh = Number(h.time.slice(11, 13));
    const last = windows.at(-1);
    if (last && last.date === h.time.slice(0, 10) && last.to === hh) last.to = hh + 1;
    else windows.push({ date: h.time.slice(0, 10), from: hh, to: hh + 1 });
  });
  return windows;
}

export async function fetchForecast(c, { today = farmDateStr() } = {}) {
  const { lat, lng } = await farmPoint(c);
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(4)}&longitude=${lng.toFixed(4)}` +
    `&daily=${DAILY}&hourly=${HOURLY}&timezone=${encodeURIComponent(config.farmTz)}&forecast_days=7&past_days=7`;
  let data;
  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!resp.ok) throw new Error(`open-meteo ${resp.status}`);
    data = await resp.json();
  } catch (err) {
    // Offline or blocked egress: keep the last snapshot; T2's gauge path and
    // everything else continue unaffected. The weather card shows forecast age.
    return { ok: false, error: err.message };
  }
  const d = data.daily || {};
  const h = data.hourly || {};
  const daily = (d.time || []).map((date, i) => ({
    date,
    rain_mm: Number(d.precipitation_sum?.[i] ?? 0),
    prob_pct: Number(d.precipitation_probability_max?.[i] ?? 0),
    tmax: num(d.temperature_2m_max?.[i]),
    tmin: num(d.temperature_2m_min?.[i]),
    et0_mm: num(d.et0_fao_evapotranspiration?.[i]),
    code: num(d.weather_code?.[i]),
    wind_kmh: num(d.wind_speed_10m_max?.[i]),
    gust_kmh: num(d.wind_gusts_10m_max?.[i]),
  })).filter((x) => x.date >= today);
  const past = (d.time || []).flatMap((date, i) =>
    (date < today && d.precipitation_sum?.[i] != null ? [[date, r1(d.precipitation_sum[i])]] : []));
  await storeEstimates(c, SOURCES["open-meteo"], Object.fromEntries(past));

  // Working hours (05:00 to 18:00) of today and tomorrow, for the "now" line
  // and the spraying windows.
  const tomorrow = daily[1]?.date;
  const hours = (h.time || []).flatMap((time, i) => {
    const hh = Number(time.slice(11, 13));
    if (![today, tomorrow].includes(time.slice(0, 10)) || hh < 5 || hh > 18 || h.temperature_2m?.[i] == null) return [];
    const temp = Number(h.temperature_2m[i]), rh = Number(h.relative_humidity_2m?.[i] ?? 50);
    return [{ time, temp, rh, wind_kmh: Number(h.wind_speed_10m?.[i] ?? 0), rain_mm: Number(h.precipitation?.[i] ?? 0),
      prob_pct: Number(h.precipitation_probability?.[i] ?? 0), delta_t: deltaT(temp, rh) }];
  });
  const snapshot = { provider: "open-meteo", fetched_at: new Date().toISOString(), daily, hours, spray: sprayWindows(hours) };
  await c.query(
    `INSERT INTO farm_settings (key, value) VALUES ('forecast', $1)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [JSON.stringify(snapshot)]);

  // Project today's reference ET0 into readings so the water-balance ledger
  // (spec 3.5 Phase 2) accumulates real values day by day, one row per day.
  const first = daily[0];
  if (first?.et0_mm != null && !Number.isNaN(first.et0_mm)) {
    await c.query(
      `INSERT INTO readings (metric, value, unit, taken_at)
       SELECT 'et0_mm', $1, 'mm', now()
       WHERE NOT EXISTS (
         SELECT 1 FROM readings WHERE metric = 'et0_mm'
           AND date_trunc('day', taken_at AT TIME ZONE 'Africa/Harare') = $2::date)`,
      [first.et0_mm, first.date]);
  }
  return { ok: true, days: daily.length };
}

export async function getForecast(c) {
  const r = await c.query(`SELECT value FROM farm_settings WHERE key = 'forecast'`);
  return r.rows[0]?.value || null;
}

// Forecast entry for a given farm date (YYYY-MM-DD), null when absent or stale.
export async function forecastFor(c, dateStr, { maxAgeHours = 36 } = {}) {
  const snap = await getForecast(c);
  if (!snap) return null;
  if ((Date.now() - new Date(snap.fetched_at).getTime()) / 3_600_000 > maxAgeHours) return null;
  return snap.daily.find((x) => x.date === dateStr) || null;
}
