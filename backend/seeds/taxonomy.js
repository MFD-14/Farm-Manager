// Full Section 2 canonical operations taxonomy (WFM-OPS-SPEC v1.0).
// Evidence classes E0-E5 per 5.1; schedules S1-S5 per 3.3; escalation profiles per 4.2.

const E = {
  E0: { classes: ["E0"] },
  E1: (fields) => ({ classes: ["E1"], fields }),
  E1E2: (fields, vim, photoMin = 1) => ({
    classes: ["E1", "E2"], fields, photo_min: photoMin, ...(vim ? { vim_profile: vim } : {}),
  }),
  E2: (vim, photoMin = 1) => ({ classes: ["E2"], photo_min: photoMin, ...(vim ? { vim_profile: vim } : {}) }),
  E3: (vim) => ({ classes: ["E3"], photo_min: 2, pair: true, ...(vim ? { vim_profile: vim } : {}) }),
  E4: (vim) => ({ classes: ["E4"], video_min: 1, ...(vim ? { vim_profile: vim } : {}) }),
  E5: { classes: ["E5"], voice_min: 1 },
};

const num = (key, label, min, max, unit) => ({ key, label, type: "number", min, max, unit });
const text = (key, label) => ({ key, label, type: "text" });
const choice = (key, label, options) => ({ key, label, type: "choice", options });

export const TEMPLATES = [
  // ── 2.1 Daily ──────────────────────────────────────────────────────────────
  {
    code: "W-01", title: "Tank and pool level reading", domain: "W", priority: "P1", est_minutes: 1,
    subject_type: "asset", subject_code: "TANK-MAIN",
    evidence_policy: { ...E.E1E2([num("level_pct", "Tank level %", 0, 100, "%"), num("pool_pct", "Pool level %", 0, 100, "%")], "tank_gauge") },
    schedule: { type: "calendar", freq: "daily", at: ["06:00", "17:00"], fixed: true },
    readings: [{ metric: "tank_level_pct", from: "level_pct" }, { metric: "pool_level_pct", from: "pool_pct" }],
    instructions: [{ text: "Read the tank gauge and the pool dipstick. Photograph the gauge." }],
  },
  {
    code: "W-02", title: "Pump run log", domain: "W", priority: "P1", est_minutes: 1,
    subject_type: "asset", subject_code: "PUMP-BH1",
    evidence_policy: E.E1([text("start_time", "Start time"), text("stop_time", "Stop time"), num("run_hours", "Run hours", 0, 24, "h")]),
    schedule: { type: "calendar", freq: "daily", at: ["18:00"], fixed: true },
    readings: [{ metric: "pump_hours", from: "run_hours" }],
    meters: [{ meter: "pump_run_hours", from: "run_hours" }],
    instructions: [{ text: "Log pump switch-on and switch-off times. Photo of meter if fitted." }],
  },
  {
    code: "W-03", title: "Irrigation shift", domain: "W", priority: "P1", est_minutes: 1,
    subject_type: "location",
    evidence_policy: { ...E.E1E2([num("litres", "Litres applied", 0, 100000, "L"), num("minutes", "Run minutes", 0, 600, "min")], "wet_line") },
    schedule: { type: "rolling", next_from: "completion", compute: "irrigation_planner" },
    readings: [{ metric: "irrigation_litres", from: "litres" }],
    instructions: [{ text: "Open the block valve for the planned duration. Photograph a wet emitter line before closing." }],
  },
  {
    code: "W-08", title: "Rain gauge reading", domain: "W", priority: "P2", est_minutes: 1,
    subject_type: "asset", subject_code: "RAIN-G1",
    evidence_policy: E.E1([num("rain_mm", "Rainfall since yesterday (mm)", 0, 300, "mm")]),
    schedule: { type: "calendar", freq: "daily", at: ["06:00"], fixed: true },
    readings: [{ metric: "rain_mm", from: "rain_mm" }],
    instructions: [
      { text: "Read the gauge at the same time every morning. Zero is a required entry, not an assumed default." },
      { text: "Empty the gauge after reading so tomorrow starts from zero." },
    ],
  },
  {
    code: "C-01", title: "Kale harvest and bundle count", domain: "C", priority: "P1", est_minutes: 1,
    subject_type: "location", subject_code: "BLK-A",
    evidence_policy: { ...E.E1E2([num("bundle_count", "Bundles", 0, 2000)], "bundle_count") },
    schedule: { type: "calendar", freq: "daily", at: ["05:30"], fixed: true },
    readings: [{ metric: "bundle_count", from: "bundle_count" }],
    instructions: [{ text: "Harvest before heat. Stack bundles against the tally board, chalk the date, one photo." }],
  },
  {
    code: "C-02", title: "Sales and dispatch record", domain: "C", priority: "P1", est_minutes: 1,
    evidence_policy: E.E1E2([num("bundles_sold", "Bundles sold", 0, 2000), num("price_usd", "Price (USD)", 0, 10000), text("buyer", "Buyer")]),
    schedule: { type: "calendar", freq: "daily", at: ["16:30"], fixed: true },
    readings: [{ metric: "bundles_sold", from: "bundles_sold" }, { metric: "sales_usd", from: "price_usd" }],
    instructions: [{ text: "Record at sale or collection: bundles, price, buyer, photo of load or cash tally." }],
  },
  {
    code: "C-03", title: "Seedbed and nursery watering", domain: "C", priority: "P2", est_minutes: 1,
    subject_type: "location", subject_code: "NURSERY",
    evidence_policy: E.E0, e0_sampled: true,
    schedule: { type: "calendar", freq: "daily", at: ["06:30"], fixed: true, active_when: "nursery_active" },
  },
  {
    code: "K-01", title: "Cattle rehabilitation ration feed", domain: "K", priority: "P1", est_minutes: 1,
    subject_type: "herd", subject_code: "HERD-MAIN",
    evidence_policy: E.E2("trough_feed"),
    schedule: { type: "calendar", freq: "daily", at: ["07:00"], fixed: true },
    instructions: [{ text: "Feed the 90-day ration per the ration card. Photo of feed in trough with herd present." }],
  },
  {
    code: "K-02", title: "Cattle water and gate check", domain: "K", priority: "P2", est_minutes: 1,
    subject_type: "herd", subject_code: "HERD-MAIN",
    evidence_policy: E.E0, e0_sampled: true,
    schedule: { type: "calendar", freq: "daily", at: ["07:30"], fixed: true },
  },
  {
    code: "P-01", title: "Poultry feed and water, morning", domain: "P", priority: "P1", est_minutes: 1,
    subject_type: "batch",
    evidence_policy: E.E1([num("feed_kg", "Feed (kg or scoops)", 0, 500)]),
    schedule: { type: "calendar", freq: "daily", at: ["06:15"], fixed: true, per_active_batch: true },
    readings: [{ metric: "poultry_feed_kg", from: "feed_kg" }],
  },
  {
    code: "P-02", title: "Poultry feed and water, afternoon", domain: "P", priority: "P2", est_minutes: 1,
    subject_type: "batch",
    evidence_policy: E.E0, e0_sampled: true,
    schedule: { type: "calendar", freq: "daily", at: ["16:00"], fixed: true, per_active_batch: true },
  },
  {
    code: "P-03", title: "Brooder temperature and chick check", domain: "P", priority: "P1", est_minutes: 1,
    subject_type: "batch",
    evidence_policy: { ...E.E1E2([num("temp_c", "Brooder temp (C)", 0, 45, "C")], "chick_spread") },
    schedule: { type: "calendar", freq: "daily", at: ["06:00", "12:00", "21:00"], fixed: true, per_active_batch: true, batch_age_max_days: 28 },
    readings: [{ metric: "brooder_temp_c", from: "temp_c" }],
  },
  {
    code: "P-04", title: "Egg collection and grading count", domain: "P", priority: "P1", est_minutes: 1,
    subject_type: "batch",
    evidence_policy: E.E1([num("trays", "Trays", 0, 100), num("singles", "Singles", 0, 29)]),
    schedule: { type: "calendar", freq: "daily", at: ["10:00", "15:00"], fixed: true, per_active_batch: true, batch_age_min_days: 126, batch_purpose: "layers" },
    readings: [{ metric: "egg_count", from: "trays", transform: "trays_to_eggs" }],
  },
  {
    code: "P-05", title: "Mortality check and record", domain: "P", priority: "P1", est_minutes: 1,
    subject_type: "batch",
    evidence_policy: E.E1E2([num("mortality", "Deaths (0 required if none)", 0, 1000)], null, 0),
    schedule: { type: "calendar", freq: "daily", at: ["06:15"], fixed: true, per_active_batch: true },
    readings: [{ metric: "mortality", from: "mortality" }],
    instructions: [{ text: "Zero is a required entry, not an assumed default. Photo if more than 2." }],
  },
  {
    code: "A-02", title: "Infrastructure and security walk", domain: "A", priority: "P2", est_minutes: 2,
    evidence_policy: E.E0, e0_sampled: true,
    schedule: { type: "calendar", freq: "daily", at: ["17:30"], fixed: true },
    instructions: [{ text: "Route: pump house, tank, gates, stores." }],
  },
  {
    code: "F-01", title: "Cash and float reconciliation", domain: "F", priority: "P2", est_minutes: 2,
    evidence_policy: E.E1([num("cash_on_hand", "Cash on hand (USD)", 0, 100000), num("recorded_sales", "Recorded sales (USD)", 0, 100000)]),
    schedule: { type: "calendar", freq: "daily", at: ["17:00"], fixed: true },
    readings: [{ metric: "cash_variance", derive: "cash_on_hand - recorded_sales" }],
  },

  // ── 2.2 Weekly ─────────────────────────────────────────────────────────────
  {
    code: "W-04", title: "Drip filter flush and lateral inspection", domain: "W", priority: "P2", est_minutes: 2,
    subject_type: "asset", subject_code: "DRIP-SYS",
    evidence_policy: E.E3("repair_pair"),
    schedule: { type: "calendar", freq: "weekly", byday: ["MO"], at: ["08:00"], fixed: false, interval_days: 7 },
  },
  {
    code: "W-05", title: "Reticulation walk: mainline, valves, leaks", domain: "W", priority: "P2", est_minutes: 2,
    evidence_policy: E.E2(),
    schedule: { type: "calendar", freq: "weekly", byday: ["TH"], at: ["08:00"], fixed: true },
  },
  {
    code: "C-04", title: "Fall armyworm scout, maize bed", domain: "C", priority: "P1", est_minutes: 3,
    subject_type: "location", subject_code: "BLK-C",
    evidence_policy: E.E1E2([
      num("plants_inspected", "Plants inspected", 1, 1000),
      num("fresh_damage_plants", "Plants with fresh damage", 0, 1000),
      choice("crop_stage", "Crop stage", ["seedling", "whorl", "tassel"]),
    ]),
    schedule: { type: "calendar", freq: "weekly", byday: ["MO"], at: ["06:30"], fixed: true },
    readings: [{ metric: "faw_damage_pct", derive: "fresh_damage_plants / plants_inspected * 100" }],
    instructions: [{ text: "W-pattern walk, 10 stations of 10 plants. Photograph fresh damage." }],
  },
  {
    code: "C-05", title: "Tomato and onion pest and disease scout", domain: "C", priority: "P2", est_minutes: 3,
    subject_type: "location", subject_code: "BLK-B",
    evidence_policy: E.E1E2([num("plants_inspected", "Plants inspected", 1, 1000), num("affected_plants", "Affected plants", 0, 1000)]),
    schedule: { type: "calendar", freq: "weekly", byday: ["TU"], at: ["06:30"], fixed: true },
  },
  {
    code: "C-06", title: "Kale succession transplant", domain: "C", priority: "P2", est_minutes: 2,
    subject_type: "location",
    evidence_policy: E.E1E2([num("plants", "Plants transplanted", 1, 5000), text("bed", "Bed identifier")]),
    schedule: { type: "calendar", freq: "weekly", byday: ["WE"], at: ["08:00"], fixed: true },
    anchor_emit: "bed_transplanted",
  },
  {
    code: "C-07", title: "Fertigation or top dressing", domain: "C", priority: "P2", est_minutes: 2,
    subject_type: "location",
    evidence_policy: { ...E.E1E2([text("product", "Product"), num("quantity", "Quantity", 0, 1000), text("batch_number", "Batch number")], "spray_scene") },
    schedule: null, // released by anchor chains and programmes
    inventory_out: { item_from: "product", qty_from: "quantity" },
  },
  {
    code: "K-03", title: "Body condition score, sample of 5", domain: "K", priority: "P2", est_minutes: 3,
    subject_type: "herd", subject_code: "HERD-MAIN",
    evidence_policy: { ...E.E1E2([text("scores", "Scores per ear tag, e.g. A12=2.5,B03=3.0")], "bcs_assist") },
    schedule: { type: "calendar", freq: "weekly", byday: ["FR"], at: ["07:00"], fixed: true },
    readings: [{ metric: "bcs_median", derive: "median_scores" }],
  },
  {
    code: "K-04", title: "Tick control: dip or spray", domain: "K", priority: "P1", est_minutes: 2,
    subject_type: "herd", subject_code: "HERD-MAIN",
    evidence_policy: E.E2("trough_feed"),
    schedule: {
      type: "calendar", freq: "weekly", byday: ["WE"], at: ["08:00"], fixed: true,
      season_overrides: [
        { months: [11, 12, 1, 2, 3, 4], freq: "weekly" },
        { months: [5, 6, 7, 8, 9, 10], freq: "fortnightly" },
      ],
    },
  },
  {
    code: "P-06", title: "Poultry house deep clean and litter turn", domain: "P", priority: "P2", est_minutes: 2,
    subject_type: "location", subject_code: "HOUSE-1",
    evidence_policy: E.E3("repair_pair"),
    schedule: { type: "calendar", freq: "weekly", byday: ["SA"], at: ["09:00"], fixed: true },
  },
  {
    code: "P-07", title: "Feed stock count and consumption check", domain: "P", priority: "P2", est_minutes: 2,
    evidence_policy: E.E1E2([num("bags_on_hand", "Bags on hand", 0, 500)]),
    schedule: { type: "calendar", freq: "weekly", byday: ["SU"], at: ["09:00"], fixed: true },
    readings: [{ metric: "feed_stock_bags", from: "bags_on_hand" }],
  },
  {
    code: "A-03", title: "Fence line section walk", domain: "A", priority: "P3", est_minutes: 3,
    subject_type: "asset",
    evidence_policy: E.E2(null, 1),
    schedule: { type: "calendar", freq: "weekly", byday: ["TU"], at: ["15:00"], fixed: true, rotate_subjects: ["FENCE-N", "FENCE-E", "FENCE-S", "FENCE-W"] },
  },
  {
    code: "F-02", title: "Weekly labour attendance and wage sheet", domain: "F", priority: "P2", est_minutes: 3,
    evidence_policy: E.E1([text("attendance", "Days worked per labourer")]),
    schedule: { type: "calendar", freq: "weekly", byday: ["SA"], at: ["16:00"], fixed: true },
  },

  // ── 2.3 Monthly and seasonal ───────────────────────────────────────────────
  {
    code: "A-01", title: "Borehole pump and generator service", domain: "A", priority: "P2", est_minutes: 5,
    subject_type: "asset", subject_code: "PUMP-BH1",
    evidence_policy: { classes: ["E1", "E3"], photo_min: 2, pair: true, fields: [text("parts_used", "Parts used")], vim_profile: "repair_pair" },
    schedule: { type: "meter", meter: "pump_run_hours", every: 250, source: "reading" },
    checklist: [{ item: "Grease" }, { item: "Alignment" }, { item: "Foot valve" }, { item: "Cable check" }],
  },
  {
    code: "W-06", title: "Drip system chemical flush", domain: "W", priority: "P2", est_minutes: 2,
    subject_type: "asset", subject_code: "DRIP-SYS",
    evidence_policy: E.E1E2([text("product", "Chlorine or acid product"), num("dose", "Dose", 0, 100)]),
    schedule: { type: "calendar", freq: "monthly", at: ["08:00"], fixed: false, interval_days: 30 },
  },
  {
    code: "W-07", title: "Borehole static level check", domain: "W", priority: "P2", est_minutes: 1,
    subject_type: "asset", subject_code: "BH-1",
    evidence_policy: E.E1([num("static_level_m", "Static level (m)", 0, 200, "m")]),
    schedule: { type: "calendar", freq: "monthly", at: ["07:00"], fixed: true, season_overrides: [{ months: [5, 6, 7, 8, 9, 10], freq: "fortnightly" }] },
    readings: [{ metric: "borehole_static_m", from: "static_level_m" }],
  },
  {
    code: "A-04", title: "Knapsack and spray equipment calibration", domain: "A", priority: "P2", est_minutes: 3,
    subject_type: "asset", subject_code: "SPRAY-K1",
    evidence_policy: E.E1([num("output_l", "Measured output (L)", 0, 100), num("area_m2", "Measured area (m2)", 0, 10000)]),
    schedule: { type: "calendar", freq: "monthly", at: ["09:00"], fixed: false, interval_days: 90 },
  },
  {
    code: "A-05", title: "Tank integrity inspection", domain: "A", priority: "P2", est_minutes: 2,
    subject_type: "asset", subject_code: "TANK-MAIN",
    evidence_policy: E.E4("leak_scan"),
    schedule: { type: "calendar", freq: "monthly", at: ["10:00"], fixed: false, interval_days: 90 },
  },
  {
    code: "K-05", title: "Cattle vaccination: anthrax and blackleg", domain: "K", priority: "P1", est_minutes: 3,
    subject_type: "herd", subject_code: "HERD-MAIN",
    evidence_policy: E.E1E2([text("batch_number", "Vaccine batch number"), num("dose_count", "Doses given", 0, 500)]),
    schedule: { type: "calendar", freq: "yearly", month: 9, at: ["08:00"], fixed: true },
  },
  {
    code: "K-06", title: "Deworming", domain: "K", priority: "P2", est_minutes: 2,
    subject_type: "herd", subject_code: "HERD-MAIN",
    evidence_policy: E.E1E2([text("product", "Product"), text("batch_number", "Batch"), num("animals_treated", "Animals treated", 0, 500)]),
    schedule: null, // released at rains onset and rains end via rules/owner
    withdrawal_from_product: true,
  },
  {
    code: "K-07", title: "Pregnancy diagnosis and cull review", domain: "K", priority: "P2", est_minutes: 5,
    subject_type: "herd", subject_code: "HERD-MAIN",
    evidence_policy: E.E1([text("results", "Result per animal")]),
    schedule: { type: "calendar", freq: "yearly", month: 6, at: ["08:00"], fixed: true },
  },
  {
    code: "C-08", title: "Land preparation per block", domain: "C", priority: "P2", est_minutes: 2,
    subject_type: "location",
    evidence_policy: E.E3("repair_pair"),
    schedule: null, // released by season plan
  },
  {
    code: "C-09", title: "Planting: sorghum SV4, maize (homestead garden beds)", domain: "C", priority: "P1", est_minutes: 2,
    subject_type: "location",
    evidence_policy: E.E1E2([text("variety", "Variety"), num("seed_rate", "Seed rate", 0, 100), text("block", "Block")]),
    schedule: null, // owner-released with effective rains, November window
    anchor_emit: "planting_done",
  },
  {
    code: "C-10", title: "Tomato and onion nursery sowing and transplant", domain: "C", priority: "P2", est_minutes: 2,
    subject_type: "location",
    evidence_policy: E.E1E2([text("crop", "Crop"), num("plants", "Plants", 0, 10000)]),
    schedule: null,
    anchor_emit: "nursery_transplanted",
  },
  {
    code: "C-11", title: "Harvest: tomato and onion", domain: "C", priority: "P1", est_minutes: 2,
    subject_type: "location",
    evidence_policy: E.E1E2([num("quantity", "Quantity", 0, 100000), text("grade", "Grade")]),
    schedule: null, // from anchor chains
    guards: [{ type: "phi_block" }],
  },
  {
    code: "P-08", title: "Hatch or chick placement, new batch", domain: "P", priority: "P1", est_minutes: 2,
    subject_type: "batch",
    evidence_policy: E.E1E2([num("count_placed", "Count placed", 1, 5000), text("source", "Source"), text("house", "House")]),
    schedule: null, // per staggered hatching plan, owner-released
    anchor_emit: "batch_placed",
  },
  {
    code: "F-03", title: "Month-end stock take", domain: "F", priority: "P2", est_minutes: 5,
    evidence_policy: E.E1E2([text("counts", "Counts per item")]),
    schedule: { type: "calendar", freq: "monthly", last_saturday: true, at: ["09:00"], fixed: true },
  },
  {
    code: "F-04", title: "Month-end owner review pack", domain: "F", priority: "P2", est_minutes: 0,
    evidence_policy: { classes: [], system_generated: true },
    schedule: { type: "calendar", freq: "monthly", day: 1, at: ["06:00"], fixed: true, assignee: "system" },
  },

  // ── 2.4 Event-triggered (trigger-only: schedule null) ──────────────────────
  {
    code: "W-E1", title: "Low-water protocol: priority irrigation only", domain: "W", priority: "P0", est_minutes: 1,
    evidence_policy: { classes: ["E1"], fields: [choice("ack", "Protocol acknowledged", ["yes"])] },
    schedule: null,
    instructions: [{ text: "Kale first, then poultry, then tomato and onion. Cattle trough is never cut." }],
  },
  {
    code: "W-E2", title: "Borehole or pump fault inspection", domain: "W", priority: "P1", est_minutes: 3,
    subject_type: "asset", subject_code: "PUMP-BH1",
    evidence_policy: { classes: ["E4", "E5"], video_min: 1, voice_min: 1 },
    schedule: null,
    instructions: [{ text: "Possible causes ranked: leak, dropping yield, meter misread. Video the pump running; voice-describe what you find." }],
  },
  {
    code: "W-E3", title: "Leak hunt", domain: "W", priority: "P1", est_minutes: 3,
    evidence_policy: { classes: ["E2", "E5"], photo_min: 0, voice_min: 0, any_of: ["E2", "E5"] },
    schedule: null,
  },
  {
    code: "C-E1", title: "Fall armyworm spray, rotated mode of action", domain: "C", priority: "P1", est_minutes: 1,
    subject_type: "location", subject_code: "BLK-C",
    evidence_policy: { ...E.E1E2([text("product", "Product"), text("batch_number", "Batch number"), num("rate", "Rate", 0, 100), text("block", "Block")], "spray_scene") },
    schedule: null,
    guards: [{ type: "calibration", asset_code: "SPRAY-K1", template: "A-04" }, { type: "phi_block" }],
    inventory_out: { item_from: "product", qty_from: "rate" },
    rotation_register: ["emamectin benzoate (IRAC 6)", "chlorantraniliprole (IRAC 28)", "spinetoram (IRAC 5)"],
    instructions: [{ text: "Use a different insecticide group from the last fall armyworm spray (shown on this task). Spraying the same group twice in a row is flagged." }],
  },
  {
    code: "C-E2", title: "Replant or gap-fill", domain: "C", priority: "P2", est_minutes: 2,
    subject_type: "location",
    evidence_policy: E.E1E2([num("plants", "Plants replanted", 0, 5000)]),
    schedule: null,
  },
  {
    code: "K-E1", title: "Sick animal: isolate, describe, treat", domain: "K", priority: "P1", est_minutes: 3,
    subject_type: "herd", subject_code: "HERD-MAIN",
    evidence_policy: { classes: ["E4", "E5", "E1"], video_min: 1, voice_min: 1, fields: [text("product", "Treatment product"), text("batch_number", "Batch")] },
    schedule: null,
    withdrawal_from_product: true,
  },
  {
    code: "K-E2", title: "Calving follow-up", domain: "K", priority: "P1", est_minutes: 1,
    subject_type: "herd", subject_code: "HERD-MAIN",
    evidence_policy: E.E2(),
    schedule: null, // anchor chain from calving_reported
  },
  {
    code: "P-E1", title: "Batch vaccination step", domain: "P", priority: "P1", est_minutes: 2,
    subject_type: "batch",
    evidence_policy: E.E1E2([text("vaccine", "Vaccine"), text("batch_number", "Batch number"), num("count", "Birds treated", 0, 5000)]),
    schedule: null, // released by the poultry anchor chain
  },
  {
    code: "P-E2", title: "Abnormal mortality response", domain: "P", priority: "P0", est_minutes: 2,
    subject_type: "batch",
    evidence_policy: { classes: ["E4", "E1"], video_min: 1, fields: [text("actions", "Actions taken")] },
    schedule: null,
    instructions: [{ text: "Isolate house, biosecurity, vet call." }],
  },
  {
    code: "A-E1", title: "Breakdown repair", domain: "A", priority: "P1", est_minutes: 3,
    subject_type: "asset",
    evidence_policy: { classes: ["E3", "E1"], photo_min: 2, pair: true, fields: [text("parts_used", "Parts used")], vim_profile: "repair_pair" },
    schedule: null,
  },
  {
    code: "F-E1", title: "Input purchase and delivery confirmation", domain: "F", priority: "P2", est_minutes: 2,
    evidence_policy: E.E2(),
    schedule: null, assignee_role: "owner",
    inventory_in: true,
  },

  // ── Projects in the July 2026 to June 2027 scaling plan (owner-released steps) ──
  // Phase 0: the main tank (80,000 to 125,000 L) leaks; rehabilitate it and
  // measure the usable volume, which then replaces the range everywhere.
  {
    code: "A-P1", title: "Phase 0: drain and inspect the main tank", domain: "A", priority: "P1", est_minutes: 3,
    subject_type: "asset", subject_code: "TANK-MAIN", project: "phase0_tank",
    evidence_policy: { ...E.E1E2([text("cracks_found", "Cracks or leaks found (where)"), text("condition", "Floor and wall condition")], null, 2) },
    schedule: null,
    instructions: [{ text: "Run the tank down into the pool first (the pool carries the farm meanwhile). Photograph every crack and the floor." }],
  },
  {
    code: "A-P2", title: "Phase 0: repair and reline the main tank", domain: "A", priority: "P1", est_minutes: 3,
    subject_type: "asset", subject_code: "TANK-MAIN", project: "phase0_tank",
    evidence_policy: { classes: ["E1", "E3"], photo_min: 2, pair: true, fields: [text("materials", "Materials used")] },
    schedule: null,
    instructions: [{ text: "Before and after photos of each repaired section, same angle." }],
  },
  {
    code: "A-P3", title: "Phase 0: refill and 48-hour leak test", domain: "A", priority: "P1", est_minutes: 2,
    subject_type: "asset", subject_code: "TANK-MAIN", project: "phase0_tank",
    evidence_policy: E.E1E2([num("level_start_pct", "Level at start %", 0, 100, "%"), num("level_48h_pct", "Level after 48 h %", 0, 100, "%")]),
    schedule: null,
    readings: [{ metric: "tank_leak_test_start_pct", from: "level_start_pct" }, { metric: "tank_leak_test_48h_pct", from: "level_48h_pct" }],
    instructions: [{ text: "Fill, close the outlet, note the level; read it again 48 hours later with no draw-off. Photo of the gauge both times." }],
  },
  {
    code: "A-P4", title: "Phase 0: measure the usable tank volume", domain: "A", priority: "P1", est_minutes: 3,
    subject_type: "asset", subject_code: "TANK-MAIN", project: "phase0_tank",
    evidence_policy: E.E1E2([num("usable_litres", "Usable volume (litres)", 20000, 200000, "L"), text("method", "How measured (dimensions or metered fill)")]),
    schedule: null,
    readings: [{ metric: "tank_usable_measured_l", from: "usable_litres" }],
    instructions: [{ text: "From outlet level to overflow: measure inside dimensions or meter a fill. This figure replaces the 80,000 to 125,000 L estimate." }],
  },
  // Reticulation: 40 mm PVC and sprinklers to 63 mm HDPE mainline and drip.
  {
    code: "A-P5", title: "Reticulation upgrade: lay 63 mm HDPE mainline section", domain: "A", priority: "P2", est_minutes: 2,
    subject_type: "asset", subject_code: "RETIC-MAIN", project: "reticulation",
    evidence_policy: E.E1E2([text("section", "Section (from, to)"), num("metres", "Metres laid", 0, 2000, "m")]),
    schedule: null,
    instructions: [{ text: "Photo of the trench with pipe laid before backfill, and of each fitting." }],
  },
  {
    code: "A-P6", title: "Reticulation upgrade: install drip laterals on a bed", domain: "A", priority: "P2", est_minutes: 2,
    subject_type: "asset", subject_code: "RETIC-MAIN", project: "reticulation",
    evidence_policy: E.E1E2([text("bed", "Bed or block"), num("laterals", "Laterals", 0, 500), num("emitters", "Emitters", 0, 20000)]),
    schedule: null,
  },
  {
    code: "A-P7", title: "Reticulation upgrade: flush and pressure test", domain: "A", priority: "P2", est_minutes: 2,
    subject_type: "asset", subject_code: "RETIC-MAIN", project: "reticulation",
    evidence_policy: E.E1E2([num("pressure_bar", "Pressure (bar)", 0, 10, "bar"), text("leaks", "Leaks found and fixed")]),
    schedule: null,
    instructions: [{ text: "Flush laterals until clear, then hold pressure 30 minutes. Photo of the gauge and the end of a lateral running clear." }],
  },
  {
    code: "A-P8", title: "Reticulation upgrade: retire the 40 mm PVC sprinkler line", domain: "A", priority: "P3", est_minutes: 2,
    subject_type: "asset", subject_code: "RETIC-MAIN", project: "reticulation",
    evidence_policy: E.E2(null, 1),
    schedule: null,
  },
  // Poultry scaling: staggered hatching toward 1,000+ Black Australorp layers.
  {
    code: "P-09", title: "Order day-old chicks for the next planned batch", domain: "P", priority: "P1", est_minutes: 2,
    evidence_policy: E.E1([text("supplier", "Supplier"), num("count_ordered", "Chicks ordered", 0, 5000), text("delivery_date", "Delivery date")]),
    schedule: null, assignee_role: "owner",
    instructions: [{ text: "Released by the poultry plan three weeks before a placement. Confirm the brooder house is free on the delivery date." }],
  },
];

// ── Poultry batch lifecycle chain (2.5), S4 anchor offsets ────────────────────
export const POULTRY_CHAIN = {
  anchor_event: "batch_placed",
  offsets: [
    { d: -2, template: "P-CHAIN-SETUP", title: "Brooder setup: litter, heat test, feed and water", evidence: "E3" },
    { d: 7, template: "P-E1", params: { step: "ND+IB eye drop", vaccine: "Newcastle + IB" } },
    { d: 14, template: "P-E1", params: { step: "Gumboro (IBD)", vaccine: "IBD intermediate" } },
    { d: 21, template: "P-E1", params: { step: "Gumboro booster", vaccine: "IBD booster" } },
    { d: 28, template: "P-E1", params: { step: "Newcastle booster (La Sota)", vaccine: "ND La Sota" } },
    { d: 56, template: "P-E1", params: { step: "Fowl pox (wing web)", vaccine: "Fowl pox" } },
    { d: 112, template: "P-CHAIN-TRANSFER", title: "Transfer to layer house; point-of-lay preparation" },
    { d: 119, template: "P-E1", params: { step: "Newcastle killed, pre-lay", vaccine: "ND killed" } },
  ],
  weekly_from_d7: { template: "P-CHAIN-WEIGH", title: "Batch weight sample (10 birds)" },
};

// ── Kale bed lifecycle chain (3.3 worked example), S4 from bed_transplanted ──
export const KALE_CHAIN = {
  anchor_event: "bed_transplanted",
  offsets: [
    { d: 3, template: "C-CHAIN-WATER", title: "Establishment watering check", evidence: "E0" },
    { d: 7, template: "C-CHAIN-WATER", title: "Establishment watering check", evidence: "E0" },
    { d: 10, template: "C-CHAIN-GAPCHECK", title: "Gap-fill check: emergence and survival >= 80%" },
    { d: 14, template: "C-07", params: { programme: "kale top dressing 1" } },
    { d: 28, template: "C-07", params: { programme: "kale top dressing 2" } },
    { d: 180, template: "C-CHAIN-RETIRE", title: "Bed retirement and re-preparation" },
  ],
};

// Support templates used only inside chains.
export const CHAIN_SUPPORT_TEMPLATES = [
  { code: "P-CHAIN-SETUP", title: "Brooder setup: litter, heat test, feed and water", domain: "P", priority: "P1", est_minutes: 3, subject_type: "batch", evidence_policy: { classes: ["E3"], photo_min: 2, pair: true }, schedule: null },
  { code: "P-CHAIN-TRANSFER", title: "Transfer to layer house", domain: "P", priority: "P1", est_minutes: 2, subject_type: "batch", evidence_policy: { classes: ["E1", "E2"], photo_min: 1, fields: [{ key: "count", label: "Birds moved", type: "number", min: 0, max: 5000 }] }, schedule: null },
  { code: "P-CHAIN-WEIGH", title: "Batch weight sample (10 birds)", domain: "P", priority: "P2", est_minutes: 2, subject_type: "batch", evidence_policy: { classes: ["E1"], fields: [{ key: "avg_g", label: "Average weight (g)", type: "number", min: 0, max: 5000 }] }, schedule: null, readings: [{ metric: "batch_avg_weight_g", from: "avg_g" }] },
  { code: "C-CHAIN-WATER", title: "Establishment watering check", domain: "C", priority: "P2", est_minutes: 1, subject_type: "location", evidence_policy: { classes: ["E0"] }, schedule: null },
  { code: "C-CHAIN-GAPCHECK", title: "Gap-fill check: emergence >= 80%", domain: "C", priority: "P2", est_minutes: 1, subject_type: "location", evidence_policy: { classes: ["E1"], fields: [{ key: "survival_pct", label: "Survival %", type: "number", min: 0, max: 100 }] }, schedule: null },
  { code: "C-CHAIN-RETIRE", title: "Bed retirement and re-preparation", domain: "C", priority: "P2", est_minutes: 2, subject_type: "location", evidence_policy: { classes: ["E3"], photo_min: 2, pair: true }, schedule: null },
  { code: "K-CHAIN-RATION-REVIEW", title: "Fortnightly ration review", domain: "K", priority: "P2", est_minutes: 2, subject_type: "herd", evidence_policy: { classes: ["E1"], fields: [{ key: "decision", label: "Ration decision", type: "text" }] }, schedule: null, assignee_role: "owner" },
  { code: "K-CHAIN-D90-SCORE", title: "Day 90 full-herd scoring and close-out", domain: "K", priority: "P1", est_minutes: 5, subject_type: "herd", evidence_policy: { classes: ["E1", "E2"], photo_min: 1, fields: [{ key: "scores", label: "Scores per animal", type: "text" }] }, schedule: null },
  { code: "C-INSPECT", title: "Kale block inspection", domain: "C", priority: "P1", est_minutes: 2, subject_type: "location", evidence_policy: { classes: ["E2"], photo_min: 1 }, schedule: null },
  { code: "W-ACCESS", title: "Field access check after rain", domain: "W", priority: "P2", est_minutes: 1, subject_type: "location", evidence_policy: { classes: ["E0"] }, schedule: null },
];

// ── Cattle rehabilitation programme chain (2.6), anchored to programme start ──
export const CATTLE_REHAB_CHAIN = {
  anchor_event: "programme_started",
  offsets: [
    { d: 14, template: "K-CHAIN-RATION-REVIEW" },
    { d: 28, template: "K-CHAIN-RATION-REVIEW" },
    { d: 42, template: "K-CHAIN-RATION-REVIEW" },
    { d: 56, template: "K-CHAIN-RATION-REVIEW" },
    { d: 70, template: "K-CHAIN-RATION-REVIEW" },
    { d: 84, template: "K-CHAIN-RATION-REVIEW" },
    { d: 90, template: "K-CHAIN-D90-SCORE" },
  ],
};
