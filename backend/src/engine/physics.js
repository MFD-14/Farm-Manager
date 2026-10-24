// Physics checks (spec 5.4): cheap cross-checks over readings.
import { config } from "../config.js";

// Water balance: tank_delta between W-01 readings should approximate
// pump_hours * 6000 minus logged irrigation minus stock water (~1500 L/day).
// Returns a flag object or null. Evaluated by the rule engine (T5) over a window.
export async function waterBalance(c, { windowHours = 24 } = {}) {
  const since = new Date(Date.now() - windowHours * 3_600_000);
  const { rows: tanks } = await c.query(
    `SELECT value, taken_at FROM readings WHERE metric = 'tank_level_pct' AND taken_at >= $1 ORDER BY taken_at`, [since]);
  if (tanks.length < 2) return null;
  const settings = await c.query(`SELECT value FROM farm_settings WHERE key = 'water_params'`);
  const wp = settings.rows[0]?.value || {};
  const tankUsable = Number(wp.tank_usable || config.tankUsable);
  const lph = Number(wp.borehole_lph || config.boreholeLph);

  const deltaPct = Number(tanks.at(-1).value) - Number(tanks[0].value);
  const tankDeltaL = (deltaPct / 100) * tankUsable;

  const agg = async (metric) => {
    const r = await c.query(
      `SELECT COALESCE(SUM(value),0) AS s FROM readings WHERE metric = $1 AND taken_at >= $2`, [metric, since]);
    return Number(r.rows[0].s);
  };
  const pumpHours = await agg("pump_hours");
  const irrigationL = await agg("irrigation_litres");
  const stockWaterL = Number(wp.stock_water_l_per_day || 1500) * (windowHours / 24);

  const expectedDeltaL = pumpHours * lph - irrigationL - stockWaterL;
  const deficitL = expectedDeltaL - tankDeltaL;
  return { pumpHours, tankDeltaL, expectedDeltaL, deficitL, irrigationL };
}

// Harvest sanity: C-01 counts against trailing stats; outliers beyond 2 sigma
// route that day's evidence to needs_review.
export async function harvestSanity(c, instance) {
  const count = Number(instance.evidence_summary?.fields?.bundle_count);
  if (Number.isNaN(count)) return null;
  const { rows } = await c.query(
    `SELECT value FROM readings WHERE metric = 'bundle_count' AND taken_at >= now() - interval '14 days' ORDER BY taken_at DESC LIMIT 14`);
  if (rows.length < 5) return null;
  const vals = rows.map((r) => Number(r.value));
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  const sd = Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length) || 1;
  if (Math.abs(count - mean) > 2 * sd) {
    return { kind: "harvest_outlier", count, mean: Math.round(mean * 10) / 10, sd: Math.round(sd * 10) / 10 };
  }
  return null;
}

// Timing sanity: reported done implausibly soon after release for jobs with a
// declared minimum job length. Clock skew per device is subtracted (spec 5.4).
export async function timingSanity(c, instance, event) {
  const minJobMin = instance.params?.min_job_minutes;
  if (!minJobMin || !instance.release_at || !event.device_time) return null;
  let skewMs = 0;
  if (event.device_id) {
    const d = await c.query(`SELECT clock_skew_ms FROM devices WHERE id = $1`, [event.device_id]);
    skewMs = Number(d.rows[0]?.clock_skew_ms || 0);
  }
  const elapsedMs = new Date(event.device_time).getTime() - skewMs - new Date(instance.release_at).getTime();
  if (elapsedMs < Math.min(90_000, minJobMin * 60_000 * 0.1)) {
    return { kind: "timing", elapsed_s: Math.round(elapsedMs / 1000), min_job_minutes: minJobMin };
  }
  return null;
}

// Feed balance: weekly P-07 stock count vs cumulative P-01 consumption within 10%.
export async function feedBalance(c) {
  const { rows: counts } = await c.query(
    `SELECT value, taken_at FROM readings WHERE metric = 'feed_stock_bags' ORDER BY taken_at DESC LIMIT 2`);
  if (counts.length < 2) return null;
  const [latest, previous] = counts;
  const { rows } = await c.query(
    `SELECT COALESCE(SUM(value),0) AS s FROM readings
     WHERE metric = 'poultry_feed_kg' AND taken_at BETWEEN $1 AND $2`,
    [previous.taken_at, latest.taken_at]);
  const consumedKg = Number(rows[0].s);
  const BAG_KG = 50;
  const stockDropKg = (Number(previous.value) - Number(latest.value)) * BAG_KG;
  if (consumedKg === 0 && stockDropKg === 0) return null;
  const drift = Math.abs(stockDropKg - consumedKg) / Math.max(consumedKg, 1);
  if (drift > 0.1) {
    return { kind: "feed_drift", stockDropKg, consumedKg, drift: Math.round(drift * 100) / 100 };
  }
  return null;
}
