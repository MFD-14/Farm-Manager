// Forecast feed (spec 3.4 T2: "Source: forecast API, or caretaker rain-gauge
// reading, which wins over forecast").
//
// Provider: Open-Meteo (https://open-meteo.com) — chosen because it needs no
// API key or registration, allows ~10,000 requests/day free for non-commercial
// use, covers any coordinate worldwide with 16-day daily forecasts, and serves
// FAO-56 reference evapotranspiration (et0), which the Phase 2 water-balance
// irrigation planner needs (spec R14). One fetch per day is ~0.01% of the quota.
//
// The fetched forecast is stored in farm_settings under 'forecast' so the rule
// engine, digest and rain page all read one snapshot; tests inject the same
// shape directly and never touch the network.
import { config } from "../config.js";

const LAT = process.env.FARM_LAT || "-18.9281";
const LNG = process.env.FARM_LNG || "29.8149";

const URL =
  `https://api.open-meteo.com/v1/forecast?latitude=${LAT}&longitude=${LNG}` +
  `&daily=precipitation_sum,precipitation_probability_max,temperature_2m_max,` +
  `temperature_2m_min,et0_fao_evapotranspiration` +
  `&timezone=${encodeURIComponent(config.farmTz)}&forecast_days=7`;

export async function fetchForecast(c) {
  let data;
  try {
    const resp = await fetch(URL, { signal: AbortSignal.timeout(15_000) });
    if (!resp.ok) throw new Error(`open-meteo ${resp.status}`);
    data = await resp.json();
  } catch (err) {
    // Offline or blocked egress: keep the last snapshot; T2's gauge path and
    // everything else continue unaffected. The rain page shows forecast age.
    return { ok: false, error: err.message };
  }
  const d = data.daily || {};
  const daily = (d.time || []).map((date, i) => ({
    date,
    rain_mm: Number(d.precipitation_sum?.[i] ?? 0),
    prob_pct: Number(d.precipitation_probability_max?.[i] ?? 0),
    tmax: Number(d.temperature_2m_max?.[i] ?? null),
    tmin: Number(d.temperature_2m_min?.[i] ?? null),
    et0_mm: Number(d.et0_fao_evapotranspiration?.[i] ?? null),
  }));
  const snapshot = { provider: "open-meteo", fetched_at: new Date().toISOString(), daily };
  await c.query(
    `INSERT INTO farm_settings (key, value) VALUES ('forecast', $1)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [JSON.stringify(snapshot)]);
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
