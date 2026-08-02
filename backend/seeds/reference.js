// Reference data: escalation profiles (4.2), rules T1-T9 (3.4, 4.5),
// assets, locations, herd, inventory for Woodlands Farm.

// Rung offsets are minutes relative to due_at (positive = after due).
// pre_due is minutes before due. Channels: local (phone-only, mirrored client-side),
// whatsapp, push, sms, call_prompt, digest.
export const ESCALATION_PROFILES = [
  {
    name: "P0",
    rungs: {
      release: { channels: ["push", "whatsapp"], to: ["caretaker"] },
      grace_min: 60,
      overdue: [
        { key: "overdue1", after_min: 15, channels: ["whatsapp"], to: ["caretaker"], buttons: true },
        { key: "overdue2", after_min: 30, channels: ["whatsapp", "call_prompt"], to: ["owner"] },
        { key: "overdue3", after_min: 60, channels: ["whatsapp"], to: ["owner"], mark_missed: true, sticky_top: true },
      ],
    },
  },
  {
    name: "P1",
    rungs: {
      release: { channels: ["local"], to: ["caretaker"] },
      pre_due_min: 60,
      grace: "due_day_20:00",
      overdue: [
        { key: "overdue1", after_min: 120, channels: ["local", "whatsapp"], to: ["caretaker"], buttons: true },
        { key: "overdue2", after_min: 360, channels: ["whatsapp"], to: ["owner"] },
        { key: "overdue3", at_grace_end: true, mark_missed: true, roll: true },
      ],
    },
  },
  {
    name: "P2",
    rungs: {
      release: { channels: ["local"], to: ["caretaker"] },
      grace: "end_of_day",
      overdue: [
        { key: "overdue1", at_grace_end: true, mark_missed: true, roll: true },
        { key: "second_miss", channels: ["digest"], to: ["owner"] },
        { key: "third_miss", escalate_owner_queue: true },
      ],
    },
  },
  {
    name: "P3",
    rungs: {
      release: { channels: ["local"], to: ["caretaker"] },
      grace: "end_of_day",
      overdue: [
        { key: "overdue1", at_grace_end: true, mark_missed: true, roll: true },
        { key: "second_miss", channels: ["digest"], to: ["owner"] },
        { key: "third_miss", escalate_owner_queue: true },
      ],
    },
  },
];

// Rules T1-T9 (spec 3.4, 4.5). Condition shapes are interpreted by src/engine/rules.js.
export const RULES = [
  {
    name: "T1 Low water",
    source: "reading",
    condition: { kind: "stored_volume_pct_below", value: 30 },
    action: {
      release: "W-E1",
      suppress: ["W-03"],
      notify: [{ to: "owner", channel: "whatsapp", template: "low_water" }],
    },
    cooldown_h: 24,
    two_stage: { condition: { kind: "stored_volume_pct_below", value: 15 }, action: { notify: [{ to: "owner", channel: "call_prompt" }], priority: "P0" } },
  },
  {
    name: "T2 Rain suppression",
    source: "reading",
    condition: { kind: "rain_24h_at_least", value: 15 },
    action: { suppress_next_day: ["W-03"], expire_released: { template: "W-03", reason: "rain" }, release: "W-ACCESS" },
    cooldown_h: 24,
  },
  {
    name: "T3 Fall armyworm action threshold",
    source: "task_event",
    condition: { kind: "faw_threshold", whorl: 0.2, seedling: 0.1 },
    action: { release: "C-E1", params_from: { block: "subject" }, notify: [{ to: "owner", channel: "digest" }] },
    cooldown_h: 168, // one spray cycle, 7 days
  },
  {
    name: "T4 Poultry mortality",
    source: "task_event",
    condition: { kind: "poultry_mortality", day_pct: 1.0, run_pct: 0.3, run_days: 3 },
    action: { release: "P-E2", notify: [{ to: "owner", channel: "whatsapp", template: "mortality_alert" }] },
    cooldown_h: 0,
  },
  {
    name: "T5 Physics check pump vs tank",
    source: "reading",
    condition: { kind: "pump_tank_deficit", min_pump_hours: 4, expected_ratio: 0.6, lph: 6000 },
    action: { release: "W-E2" },
    cooldown_h: 48,
  },
  {
    name: "T6 Harvest shortfall",
    source: "reading",
    condition: { kind: "harvest_shortfall", pct_of_trailing7: 0.8, consecutive_days: 2 },
    action: { release: "C-INSPECT", notify: [{ to: "owner", channel: "digest" }] },
    cooldown_h: 48,
  },
  {
    name: "T7 Condition score regression",
    source: "reading",
    condition: { kind: "bcs_regression", drop: 0.25, single_low: 2.0 },
    action: { release: "K-CHAIN-RATION-REVIEW", notify: [{ to: "owner", channel: "digest" }] },
    cooldown_h: 72,
  },
  {
    name: "T8 Input reorder",
    source: "inventory",
    condition: { kind: "below_reorder_point" },
    action: { release: "F-E1", assignee_role: "owner", params_from: { item: "item", suggested_qty: "reorder_qty" } },
    cooldown_h: 72,
  },
  {
    name: "T9 Dark farm",
    source: "clock",
    condition: { kind: "dark_farm_hours", value: 24 },
    action: { notify: [{ to: "owner", channel: "whatsapp", template: "dark_farm" }, { to: "owner", channel: "sms" }] },
    cooldown_h: 12,
  },
];

export const ASSETS = [
  { code: "BH-1", name: "Borehole 1", kind: "borehole", criticality: "P0" },
  { code: "PUMP-BH1", name: "Borehole pump", kind: "pump", parent: "BH-1", criticality: "P0", meters: { pump_run_hours: 0 } },
  { code: "TANK-MAIN", name: "Main tank", kind: "tank", criticality: "P0" },
  { code: "POOL-1", name: "Storage pool", kind: "pool", criticality: "P1" },
  { code: "DRIP-SYS", name: "Drip irrigation system", kind: "drip_block", criticality: "P1" },
  { code: "SPRAY-K1", name: "Knapsack sprayer 1", kind: "sprayer", criticality: "P2" },
  { code: "GEN-1", name: "Generator", kind: "generator", criticality: "P1", meters: { gen_run_hours: 0 } },
  { code: "COOP-1", name: "Poultry house 1", kind: "coop", criticality: "P1" },
  { code: "KRAAL-1", name: "Cattle kraal", kind: "kraal", criticality: "P1" },
  { code: "FENCE-N", name: "Fence north section", kind: "fence_section", criticality: "P2" },
  { code: "FENCE-E", name: "Fence east section", kind: "fence_section", criticality: "P2" },
  { code: "FENCE-S", name: "Fence south section", kind: "fence_section", criticality: "P2" },
  { code: "FENCE-W", name: "Fence west section", kind: "fence_section", criticality: "P2" },
];

export const LOCATIONS = [
  { code: "BLK-A", name: "Block A (Irrigated, kale)", kind: "block", crop: "kale", plant_count: 10000, irrigated: true },
  { code: "BLK-B", name: "Block B (Irrigated, tomato and onion)", kind: "block", crop: "tomato+onion", plant_count: 2500, irrigated: true },
  { code: "BLK-C", name: "Block C (Dryland maize)", kind: "block", crop: "maize", rainfed_capable: true },
  { code: "BLK-D", name: "Block D (Dryland maize and butternut)", kind: "block", crop: "maize+butternut", rainfed_capable: true },
  { code: "NURSERY", name: "Seedbed and nursery", kind: "zone" },
  { code: "HOUSE-1", name: "Poultry house 1", kind: "house" },
  { code: "HOUSE-2", name: "Poultry house 2", kind: "house" },
  { code: "STORE-1", name: "Main store", kind: "store" },
  { code: "PADDOCK-1", name: "Paddock 1", kind: "paddock" },
];

export const HERDS = [{ name: "Main herd", species: "cattle", head_count: 30 }];

export const INVENTORY = [
  { name: "Layers mash", unit: "kg", category: "feed", on_hand: 500, reorder_point: 300, reorder_qty: 500 },
  { name: "Emamectin benzoate", unit: "L", category: "chemical", on_hand: 2, reorder_point: 1, reorder_qty: 2, phi_days: 7, irac_group: "6" },
  { name: "Chlorantraniliprole", unit: "L", category: "chemical", on_hand: 1, reorder_point: 0.5, reorder_qty: 1, phi_days: 1, irac_group: "28" },
  { name: "Spinetoram", unit: "L", category: "chemical", on_hand: 1, reorder_point: 0.5, reorder_qty: 1, phi_days: 3, irac_group: "5" },
  { name: "Ivermectin", unit: "ml", category: "chemical", on_hand: 500, reorder_point: 100, reorder_qty: 500, withdrawal_days: 28 },
  { name: "ND I-2 vaccine", unit: "dose", category: "vaccine", on_hand: 500, reorder_point: 200, reorder_qty: 1000 },
  { name: "Diesel", unit: "L", category: "fuel", on_hand: 100, reorder_point: 40, reorder_qty: 100 },
  { name: "NPK 2:3:2", unit: "kg", category: "chemical", on_hand: 200, reorder_point: 50, reorder_qty: 200 },
  { name: "Drip acid cleaner", unit: "L", category: "chemical", on_hand: 10, reorder_point: 4, reorder_qty: 10 },
];
