// Schedule rule evaluation (spec 3.3). Given a template and a farm date, decide
// which occurrences release today and at what times.
import { DOW, farmMonth, daysBetween } from "../util/time.js";

function lastSaturday(dateStr) {
  const [y, m] = dateStr.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)); // last day of month
  const back = (last.getUTCDay() - 6 + 7) % 7;
  last.setUTCDate(last.getUTCDate() - back);
  return last.toISOString().slice(0, 10);
}

function effectiveFreq(schedule, month) {
  let freq = schedule.freq;
  for (const o of schedule.season_overrides || []) {
    if (o.months?.includes(month)) freq = o.freq;
  }
  return freq;
}

// S1/S2 calendar occurrence test for a given farm date.
// For floating (fixed:false) schedules the caller supplies lastClosedAt (date str)
// and interval_days; occurrence fires when the interval has elapsed.
export function calendarOccurrences(schedule, dateStr, { lastClosedDate = null } = {}) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dow = DOW[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  const month = m;
  const freq = effectiveFreq(schedule, month);
  const times = schedule.at || ["08:00"];

  if (schedule.fixed === false) {
    // S2 floating: next due = last closed + interval (default from freq)
    const interval = schedule.interval_days || (freq === "weekly" ? 7 : freq === "fortnightly" ? 14 : freq === "monthly" ? 30 : 90);
    if (!lastClosedDate) {
      // Never done: release on the schedule's nominal day (or today for monthly+)
      if (freq === "weekly" || freq === "fortnightly") {
        return schedule.byday?.includes(dow) ? times : [];
      }
      return times; // monthly/quarterly floating with no history: due now
    }
    return daysBetween(lastClosedDate, dateStr) >= interval ? times : [];
  }

  switch (freq) {
    case "daily":
      return times;
    case "weekly":
      return schedule.byday?.includes(dow) ? times : [];
    case "fortnightly": {
      if (!schedule.byday?.includes(dow)) return [];
      // ISO week parity keeps fortnightly deterministic without state.
      const week = Math.floor(Date.UTC(y, m - 1, d) / (7 * 86_400_000));
      return week % 2 === 0 ? times : [];
    }
    case "monthly":
      if (schedule.last_saturday) return dateStr === lastSaturday(dateStr) ? times : [];
      return d === (schedule.day || 1) ? times : [];
    case "yearly":
      return month === schedule.month && d === (schedule.day || 1) ? times : [];
    default:
      return [];
  }
}

// S3 meter: release when the accumulator crosses each `every` boundary since last service.
export function meterDue(schedule, accumulatorTotal, lastServiceAtTotal) {
  return accumulatorTotal - lastServiceAtTotal >= schedule.every;
}

// S5 irrigation planner (spec 3.5, tank-budget method). Emits tomorrow's W-03
// shifts: block, start window, duration minutes, expected litres. Demand comes
// from the real stand (locations.plant_count maintained by anchors).
export async function irrigationPlan(c, dateStr) {
  // Dispatch: Phase 2 water balance when enabled (spec 3.5 Phase 2 / R14),
  // else the Phase 1 tank-budget method below.
  const { getWbConfig, waterBalancePlan } = await import("./waterBalance.js");
  const wb = await getWbConfig(c);
  if (wb.enabled) return waterBalancePlan(c, dateStr);
  return tankBudgetPlan(c, dateStr);
}

export async function tankBudgetPlan(c, dateStr) {
  const { rows: blocks } = await c.query(
    `SELECT id, code, name, crop, plant_count FROM locations WHERE kind = 'block' AND irrigated`);
  const demand = await c.query(`SELECT value FROM farm_settings WHERE key = 'irrigation_demand'`);
  const dm = demand.rows[0]?.value || {};
  const shifts = [];
  let start = 6 * 60; // minutes from midnight, first shift 06:00
  for (const b of blocks) {
    const d = dm[b.code] || {};
    let litres;
    let minutes;
    if (d.litres_per_plant && b.plant_count) {
      litres = d.litres_per_plant * b.plant_count;
      const emitterLph = d.emitter_lph || 2.0;
      minutes = Math.round((d.litres_per_plant / emitterLph) * 60); // e.g. 1.2/2.0 h = 36 min
    } else if (d.litres_per_day) {
      litres = d.litres_per_day;
      minutes = Math.round((litres / 6000) * 60); // run at nominal delivery
    } else {
      continue;
    }
    const hh = String(Math.floor(start / 60)).padStart(2, "0");
    const mm = String(start % 60).padStart(2, "0");
    shifts.push({
      block_id: b.id, block_code: b.code, block_name: b.name,
      start: `${hh}:${mm}`, minutes, litres: Math.round(litres),
    });
    start += minutes + 15; // valve change buffer
  }
  return shifts;
}
