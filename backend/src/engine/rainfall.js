// Daily rainfall with public estimates filling the days the farm gauge wasn't
// read. One rule per day: the gauge (rain_mm) always wins, then Open-Meteo's
// estimate for the past week (rain_mm_est_om), then NASA POWER's satellite and
// model record (rain_mm_est_nasa), which reaches back to the previous season.
// Estimates are stored under their own metrics, so anything that must act on
// measured rain only (the T2 irrigation-skip rule, spray weather stamps) never
// sees them.
import { farmPoint } from "./farmPoint.js";
import { farmDateStr, addDays } from "../util/time.js";

export const SOURCES = { gauge: "rain_mm", "open-meteo": "rain_mm_est_om", nasa: "rain_mm_est_nasa" };

// Replace a provider's estimates for the given days ({ "YYYY-MM-DD": mm }).
export async function storeEstimates(c, metric, byDay) {
  const days = Object.keys(byDay);
  if (!days.length) return 0;
  await c.query(
    `DELETE FROM readings WHERE metric = $1 AND (taken_at AT TIME ZONE 'Africa/Harare')::date = ANY($2::date[])`, [metric, days]);
  for (const d of days) {
    await c.query(`INSERT INTO readings (metric, value, unit, taken_at) VALUES ($1, $2, 'mm', $3)`,
      [metric, byDay[d], `${d}T12:00:00+02:00`]);
  }
  return days.length;
}

// Every day from..to with its rain and where the figure came from
// (gauge, open-meteo, nasa) or null when nothing is known.
export async function dailyRain(c, from, to) {
  const { rows } = await c.query(
    `WITH d AS (SELECT generate_series($1::date, $2::date, '1 day')::date AS day),
     r AS (SELECT (taken_at AT TIME ZONE 'Africa/Harare')::date AS day, metric, SUM(value) AS v FROM readings
           WHERE metric = ANY($3) AND taken_at >= $1::date - interval '1 day' AND taken_at < $2::date + interval '2 days'
           GROUP BY 1, 2)
     SELECT to_char(d.day, 'YYYY-MM-DD') AS day,
            (SELECT v FROM r WHERE r.day = d.day AND metric = 'rain_mm') AS gauge,
            (SELECT v FROM r WHERE r.day = d.day AND metric = 'rain_mm_est_om') AS om,
            (SELECT v FROM r WHERE r.day = d.day AND metric = 'rain_mm_est_nasa') AS nasa
     FROM d ORDER BY d.day`, [from, to, Object.values(SOURCES)]);
  return rows.map((r) => {
    const [mm, source] = r.gauge != null ? [r.gauge, "gauge"] : r.om != null ? [r.om, "open-meteo"] : r.nasa != null ? [r.nasa, "nasa"] : [null, null];
    return { date: r.day, mm: mm == null ? null : Math.round(Number(mm) * 10) / 10, source };
  });
}

export async function rainForDay(c, dateStr) {
  return (await dailyRain(c, dateStr, dateStr))[0].mm ?? 0;
}

// NASA POWER (power.larc.nasa.gov): free daily precipitation for a point, no
// key. PRECTOTCORR is in mm/day; -999 marks days not yet available (the
// latest few days), which are skipped and filled later.
export async function fetchNasaPower(c, { today = farmDateStr() } = {}) {
  const { lat, lng } = await farmPoint(c);
  const y = Number(today.slice(0, 4));
  const start = `${Number(today.slice(5, 7)) >= 10 ? y - 1 : y - 2}-10-01`; // the previous season onwards
  const end = addDays(today, -1);
  const url = "https://power.larc.nasa.gov/api/temporal/daily/point?parameters=PRECTOTCORR&community=AG" +
    `&latitude=${lat.toFixed(4)}&longitude=${lng.toFixed(4)}&start=${start.replaceAll("-", "")}&end=${end.replaceAll("-", "")}&format=JSON`;
  let data;
  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    if (!resp.ok) throw new Error(`nasa power ${resp.status}`);
    data = await resp.json();
  } catch (err) {
    return { ok: false, error: err.message };
  }
  const series = data?.properties?.parameter?.PRECTOTCORR || {};
  const byDay = {};
  for (const [k, v] of Object.entries(series)) {
    if (typeof v === "number" && v >= 0) byDay[`${k.slice(0, 4)}-${k.slice(4, 6)}-${k.slice(6, 8)}`] = Math.round(v * 10) / 10;
  }
  return { ok: true, days: await storeEstimates(c, SOURCES.nasa, byDay) };
}
