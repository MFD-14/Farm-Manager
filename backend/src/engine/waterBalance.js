// Phase 2 irrigation planner (spec 3.5 / R14): the FAO-56 water-balance
// "checkbook". Daily ledger per irrigated block:
//
//   deficit = clamp( deficit + ETc - rain - irrigation, 0, TAW )
//   ETc     = Kc * ET0
//
// Irrigate when the projected deficit crosses management-allowed depletion
// (MAD * TAW); depth to replace is the full deficit (refill to field capacity)
// and run time = depth / (application_rate * efficiency). Needs no field
// hardware: ET0 arrives with the Open-Meteo forecast, rain from the W-08
// gauge, applied volumes from completed W-03 shifts. Phase 3 reconciles the
// model against a soil probe, SWAN-style.
//
// The ledger is a deterministic fold over readings — recomputed from a window,
// never stored, in keeping with the system's projection discipline.
import { addDays, farmDateStr, farmTime } from "../util/time.js";

// Kwekwe long-term monthly reference ET0 (mm/day), used only when neither a
// reading nor a forecast value exists for a day. Flagged as fallback so the
// owner screen can show how much of the ledger ran on climate normals.
const ET0_NORMALS = { 1: 4.5, 2: 4.3, 3: 4.2, 4: 3.8, 5: 3.2, 6: 2.9, 7: 3.1, 8: 3.9, 9: 4.8, 10: 5.3, 11: 5.0, 12: 4.6 };

export const WB_DEFAULTS = {
  enabled: false, // Phase 2 opt-in; Phase 1 tank budget remains the default
  blocks: {
    // Kale: 10,000 plants at 60x45cm (~2,700 m2). Root zone 0.4 m in red clay
    // loam at ~150 mm/m gives TAW ~60 mm. Drip 2 L/h per plant = 7.4 mm/h.
    "BLK-A": { kc: 1.0, taw_mm: 60, mad: 0.45, area_m2: 2700, rate_mm_h: 7.4, efficiency: 0.9 },
    // Tomato + onion: ~2,250 m2 combined, deeper roots, mid-season Kc.
    "BLK-B": { kc: 1.1, taw_mm: 90, mad: 0.5, area_m2: 2250, rate_mm_h: 5.0, efficiency: 0.9 },
  },
};

export async function getWbConfig(c) {
  const r = await c.query(`SELECT value FROM farm_settings WHERE key = 'water_balance'`);
  const stored = r.rows[0]?.value || {};
  return {
    ...WB_DEFAULTS, ...stored,
    blocks: { ...WB_DEFAULTS.blocks, ...(stored.blocks || {}) },
  };
}

async function et0For(c, dateStr) {
  const reading = await c.query(
    `SELECT value FROM readings WHERE metric = 'et0_mm'
       AND date_trunc('day', taken_at AT TIME ZONE 'Africa/Harare') = $1::date
     ORDER BY taken_at DESC LIMIT 1`, [dateStr]);
  if (reading.rows.length) return { et0: Number(reading.rows[0].value), source: "reading" };
  const fc = await c.query(`SELECT value FROM farm_settings WHERE key = 'forecast'`);
  const entry = fc.rows[0]?.value?.daily?.find((d) => d.date === dateStr);
  if (entry?.et0_mm != null && !Number.isNaN(Number(entry.et0_mm))) {
    return { et0: Number(entry.et0_mm), source: "forecast" };
  }
  const month = Number(dateStr.slice(5, 7));
  return { et0: ET0_NORMALS[month], source: "normal" };
}

async function daySum(c, metric, dateStr, subjectId = null) {
  const r = await c.query(
    `SELECT COALESCE(SUM(value),0) AS s FROM readings
     WHERE metric = $1
       AND date_trunc('day', taken_at AT TIME ZONE 'Africa/Harare') = $2::date
       AND ($3::uuid IS NULL OR subject_id = $3)`,
    [metric, dateStr, subjectId]);
  return Number(r.rows[0].s);
}

// Ledger for one block over a trailing window ending yesterday relative to
// dateStr. The window opens with deficit 0 (assumed refilled), which converges
// within days of real data; the window is long enough that the assumption
// washes out.
export async function computeLedger(c, blockCode, dateStr, { days = 21 } = {}) {
  const cfg = await getWbConfig(c);
  const block = cfg.blocks[blockCode];
  if (!block) return null;
  const loc = await c.query(`SELECT id, name FROM locations WHERE code = $1`, [blockCode]);
  if (!loc.rows.length) return null;
  const subjectId = loc.rows[0].id;

  const rows = [];
  let deficit = 0;
  for (let i = days; i >= 1; i--) {
    const d = addDays(dateStr, -i);
    const { et0, source } = await et0For(c, d);
    const etc = block.kc * et0;
    const rain = await daySum(c, "rain_mm", d);
    const irrLitres = await daySum(c, "irrigation_litres", d, subjectId);
    const irrMm = irrLitres / block.area_m2; // 1 L per m2 = 1 mm
    deficit = Math.min(block.taw_mm, Math.max(0, deficit + etc - rain - irrMm));
    rows.push({
      date: d,
      et0: round1(et0), et0_source: source,
      etc: round1(etc), rain_mm: round1(rain), irrigation_mm: round1(irrMm),
      deficit_mm: round1(deficit),
    });
  }
  return {
    block: blockCode, block_name: loc.rows[0].name, subject_id: subjectId,
    config: block,
    mad_mm: round1(block.mad * block.taw_mm),
    deficit_mm: round1(deficit),
    rows,
  };
}

// Today's shifts from the ledger: refill any block whose projected end-of-day
// deficit crosses MAD. Run time capped at 180 minutes; any remainder stays in
// the ledger and triggers again tomorrow.
export async function waterBalancePlan(c, dateStr) {
  const cfg = await getWbConfig(c);
  const shifts = [];
  let start = 6 * 60;
  for (const blockCode of Object.keys(cfg.blocks)) {
    const ledger = await computeLedger(c, blockCode, dateStr);
    if (!ledger) continue;
    const { et0 } = await et0For(c, dateStr);
    const todayEtc = ledger.config.kc * et0;
    const projected = Math.min(ledger.config.taw_mm, ledger.deficit_mm + todayEtc);
    if (projected < ledger.mad_mm) continue;

    const effRate = ledger.config.rate_mm_h * ledger.config.efficiency;
    let minutes = Math.round((projected / effRate) * 60);
    minutes = Math.min(minutes, 180);
    const appliedMm = round1((minutes / 60) * effRate);
    const litres = Math.round(appliedMm * ledger.config.area_m2);

    const hh = String(Math.floor(start / 60)).padStart(2, "0");
    const mm = String(start % 60).padStart(2, "0");
    shifts.push({
      block_id: ledger.subject_id, block_code: blockCode, block_name: ledger.block_name,
      start: `${hh}:${mm}`, minutes, litres,
      basis: {
        method: "water_balance",
        deficit_mm: round1(projected), mad_mm: ledger.mad_mm, taw_mm: ledger.config.taw_mm,
        etc_today_mm: round1(todayEtc), replacing_mm: appliedMm,
      },
    });
    start += minutes + 15;
  }
  return shifts;
}

const round1 = (n) => Math.round(n * 10) / 10;
