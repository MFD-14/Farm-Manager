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
  { code: "RETIC-MAIN", name: "Reticulation mainline (40 mm PVC and sprinklers, upgrading to 63 mm HDPE and drip)", kind: "pipeline", criticality: "P1" },
  { code: "SPRAY-K1", name: "Knapsack sprayer 1", kind: "sprayer", criticality: "P2" },
  { code: "RAIN-G1", name: "Rain gauge", kind: "tool", criticality: "P2" },
  { code: "GEN-1", name: "Generator", kind: "generator", criticality: "P1", meters: { gen_run_hours: 0 } },
  { code: "COOP-1", name: "Poultry house 1", kind: "coop", criticality: "P1" },
  { code: "KRAAL-1", name: "Cattle kraal", kind: "kraal", criticality: "P1" },
  { code: "FENCE-N", name: "Fence north section", kind: "fence_section", criticality: "P2" },
  { code: "FENCE-E", name: "Fence east section", kind: "fence_section", criticality: "P2" },
  { code: "FENCE-S", name: "Fence south section", kind: "fence_section", criticality: "P2" },
  { code: "FENCE-W", name: "Fence west section", kind: "fence_section", criticality: "P2" },
];

// Woodlands Farm layout (Subdivision 3, 119.2 ha, Kwekwe). Block sizes and
// soils from the farm field map; stands (plant_count) are planner parameters
// maintained by C-06/C-09 anchor events (spec 3.5).
export const LOCATIONS = [
  // Land use (owner, Oct 2026): the 2 ha homestead garden is the only land in
  // use (crop split to follow); about 5 ha is lost to mining; the rest is to be
  // cleared and may be grazed meanwhile. 2 + 112.2 + 5 = 119.2 ha.
  { code: "HOMESTEAD", name: "Homestead garden", kind: "zone", crop: "kale, rape, tomato Rodade, onion Texas Grano, sorghum SV4, maize (split to follow)", irrigated: true, hectares: 2, soil: "Composted loam", status: "active" },
  { code: "UNCLEARED", name: "Land to clear (grazing meanwhile)", kind: "paddock", hectares: 112.2, soil: "Mixed", status: "to clear" },
  { code: "MINING", name: "Lost to mining activity", kind: "zone", hectares: 5, status: "lost" },
  // The title-deed boundary as an outline only (no hectares, so it isn't
  // counted again in the land list); imported from the beacon KML.
  { code: "FARM-BOUNDARY", name: "Farm boundary", kind: "zone", status: "active" },
  // Beds inside the homestead garden. They keep their codes because tasks
  // (C-01 kale harvest, C-05 scouting) and the irrigation planner refer to them;
  // their area is part of the homestead's 2 ha.
  { code: "BLK-A", name: "Homestead garden: kale and rape beds", kind: "block", crop: "kale+rape", plant_count: 10000, irrigated: true, soil: "Composted loam" },
  { code: "BLK-B", name: "Homestead garden: tomato (Rodade) and onion (Texas Grano) beds", kind: "block", crop: "tomato Rodade+onion Texas Grano", plant_count: 2500, irrigated: true, soil: "Composted loam" },
  // Maize and sorghum: rain-fed beds in the homestead garden. The maize was
  // treated for fall armyworm with emamectin benzoate (IRAC group 6).
  { code: "BLK-C", name: "Homestead garden: maize and sorghum (SV4) beds", kind: "block", crop: "maize+sorghum SV4", rainfed_capable: true, soil: "Composted loam" },
  // Earlier field-map blocks not in use. Kept (old records point at them) but
  // retired: no area, no crop, out of the irrigation planner.
  { code: "BLK-D", name: "Block D (retired)", kind: "block", status: "retired" },
  { code: "BLK-E", name: "Block E (retired)", kind: "block", status: "retired" },
  { code: "ORCHARD", name: "Orchard area (retired)", kind: "zone", status: "retired" },
  { code: "GRAZING", name: "Grazing reserve (retired)", kind: "paddock", status: "retired" },
  { code: "NURSERY", name: "Seedbed and nursery", kind: "zone" },
  { code: "HOUSE-1", name: "Poultry House A", kind: "house" },
  { code: "HOUSE-2", name: "Poultry House B", kind: "house" },
  { code: "STORE-1", name: "Main store", kind: "store" },
  { code: "PADDOCK-1", name: "Paddock 1", kind: "paddock" },
  { code: "PADDOCK-2", name: "Paddock 2", kind: "paddock" },
  { code: "KRAAL-G", name: "Goat kraal", kind: "zone" },
  { code: "PIGGERY", name: "Piggery", kind: "zone" },
];

// Herds. The cattle (Nguni and Sanga, owner's farm brief) run as one herd for
// the 90-day rehabilitation programme (spec 2.6) and K-task scheduling.
export const HERDS = [
  {
    name: "Main herd", species: "cattle", head_count: 30,
    breed: "Nguni and Sanga",
    location: "Paddock 1 and Paddock 2",
    notes: "Indigenous Nguni and Sanga cattle at body condition score around 2.5, on the 90-day rehabilitation ration; target BCS 3.0. Head count and breed split to confirm.",
  },
  {
    name: "Goat herd", species: "goats", head_count: 35,
    breed: "Boer", location: "Goat kraal",
    notes: "3 bucks, 25 does, 7 kids.",
  },
  {
    name: "Pig herd", species: "pigs", head_count: 8,
    breed: "Large White", location: "Piggery",
    notes: "2 sows, 6 growers.",
  },
];

// Active poultry flocks as batches (anchor entities for the S4 chains and the
// per-batch dailies P-01/P-02/P-04/P-05). Staggered hatching builds toward the
// 1,000-layer target.
export const POULTRY_BATCHES = [
  {
    name: "Black Australorp layers", house: "HOUSE-1", placed_on: "2026-01-15",
    placed_count: 250, current_count: 250, stage: "laying", purpose: "layers",
  },
  {
    name: "Sasso broilers (batch 3)", house: "HOUSE-2", placed_on: "2026-05-01",
    placed_count: 100, current_count: 100, stage: "growing", purpose: "broilers",
  },
];

// Water system (spec 3.5, T1). Borehole delivers 6,000 L/h; roughly 6 pumping
// hours a day gives ~36,000 L/day. The pool is the measured buffer; the main
// tank's usable volume is a range until Phase 0 rehabilitation measures it, so
// tank_usable_measured stays false and the low end is used for T1 (safest).
export const WATER_SYSTEM = {
  borehole_lph: 6000,
  pumping_hours_per_day: 6,
  daily_pump_capacity_l: 36000,
  pool_volume: 45000,
  tank_usable: 80000,
  tank_usable_range: [80000, 125000],
  tank_usable_measured: false,
  stock_water_l_per_day: 1500,
  low_water_trigger_pct: 30,
  critical_water_trigger_pct: 15,
  peak_crop_demand_l_per_day: 20500,
};

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

// ── The July 2026 to June 2027 scaling plan ──────────────────────────────────
// Kale is the cash engine: $1 a bundle, about 50 bundles a day now, scaling to
// 10,000 plants in continuous production (330 to 400 bundles a day, $10,000 to
// $12,000 a month).
export const KALE_PLAN = {
  price_usd_per_bundle: 1,
  baseline_bundles_per_day: 50,
  target_plants: 10000,
  target_bundles_per_day: [330, 400],
  target_revenue_usd_month: [10000, 12000],
  bed_size_plants: 800,
  transplant_cadence: "one 800-plant bed a week (C-06)",
};

// Black Australorp layers through staggered hatching: 150-bird batches every
// six weeks from November 2026. With the 250 layers on hand and about 5%
// rearing loss this passes 1,000 layers; batches lay from about week 20.
export const POULTRY_PLAN = {
  breed: "Black Australorp",
  target_layers: 1000,
  batch_size: 150,
  order_lead_days: 21,
  house_rotation: ["HOUSE-2", "HOUSE-1"],
  placements: ["2026-11-03", "2026-12-15", "2027-01-26", "2027-03-09", "2027-04-20", "2027-06-01"],
};

// Last fall armyworm treatment on record, for the rotation check. The farm
// brief records emamectin benzoate on the maize; the date is to confirm.
export const FAW_HISTORY = [
  { product: "Emamectin benzoate", irac_group: "6", block: "BLK-C", date: null, note: "maize treated for fall armyworm (farm brief)" },
];

// Milestones the owner reads progress against. Status is computed from farm
// data where it can be (see engine/plans.js); the rest the owner marks.
export const SCALING_PLAN = {
  from: "2026-07-01",
  to: "2027-06-30",
  milestones: [
    { key: "phase0_tank", title: "Phase 0: main tank rehabilitated and its usable volume measured", target: "2026-12-15", project: "phase0_tank" },
    { key: "reticulation", title: "Reticulation on 63 mm HDPE mainline and drip; 40 mm PVC sprinklers retired", target: "2027-03-31", project: "reticulation" },
    { key: "kale_10k", title: "Kale at 10,000 plants, 330 to 400 bundles a day ($10,000 to $12,000 a month)", target: "2027-06-30" },
    { key: "layers_1000", title: "1,000+ Black Australorp layers through staggered hatching", target: "2027-06-30" },
    { key: "cattle_bcs", title: "Cattle from BCS about 2.5 to 3.0 on the 90-day rehabilitation ration", target: "2027-01-31" },
    { key: "summer_crops", title: "Sorghum SV4 and maize planted with the effective rains", target: "2026-12-15" },
  ],
};
