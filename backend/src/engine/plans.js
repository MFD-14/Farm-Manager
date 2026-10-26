// The July 2026 to June 2027 scaling plan: planned releases (staggered
// hatching), milestone progress computed from farm data, project steps, and
// the fall armyworm rotation check.
import { releaseTemplateNow } from "./rules.js";
import { addDays, farmDateStr } from "../util/time.js";

const setting = async (c, key) => (await c.query(`SELECT value FROM farm_settings WHERE key = $1`, [key])).rows[0]?.value;

// ── Fall armyworm rotation (spray the same IRAC group twice in a row = flag) ──

async function iracFor(c, product) {
  if (!product) return null;
  const r = await c.query(
    `SELECT name, irac_group FROM inventory_items WHERE irac_group IS NOT NULL
     AND (lower(name) = lower($1) OR lower($1) LIKE '%' || lower(name) || '%' OR lower(name) LIKE '%' || lower($1) || '%')
     LIMIT 1`, [String(product).trim()]);
  return r.rows[0] || null;
}

// The last fall armyworm product: the latest recorded C-E1 spray, else the
// farm's history on record (emamectin benzoate on the maize).
export async function lastFawSpray(c, { excludeInstanceId = null } = {}) {
  const r = await c.query(
    `SELECT e.payload->'fields'->>'product' AS product, e.device_time, e.server_time
     FROM task_events e JOIN task_instances ti ON ti.id = e.instance_id
     WHERE ti.template_code = 'C-E1' AND e.type = 'done_reported' AND ($1::uuid IS NULL OR ti.id <> $1)
       AND e.payload->'fields'->>'product' IS NOT NULL
     ORDER BY e.server_time DESC LIMIT 1`, [excludeInstanceId]);
  if (r.rows[0]) {
    const item = await iracFor(c, r.rows[0].product);
    return { product: r.rows[0].product, irac_group: item?.irac_group || null, date: farmDateStr(new Date(r.rows[0].device_time || r.rows[0].server_time)) };
  }
  const history = (await setting(c, "faw_history")) || [];
  const last = history[history.length - 1];
  return last ? { product: last.product, irac_group: last.irac_group, date: last.date, note: last.note } : null;
}

export async function rotationHint(c) {
  const last = await lastFawSpray(c);
  const options = await c.query(
    `SELECT name, irac_group, on_hand FROM inventory_items
     WHERE irac_group IS NOT NULL AND ($1::text IS NULL OR irac_group <> $1) ORDER BY on_hand DESC`, [last?.irac_group || null]);
  return {
    last_product: last?.product || null,
    last_irac_group: last?.irac_group || null,
    last_date: last?.date || null,
    use_instead: options.rows.map((o) => ({ product: o.name, irac_group: o.irac_group, in_stock: Number(o.on_hand) > 0 })),
  };
}

// Flag for verification routing: same group as the previous spray.
export async function rotationFlag(c, instance, fields) {
  if (instance.template_code !== "C-E1") return null;
  const product = fields?.product;
  const item = await iracFor(c, product);
  if (!item) return null;
  const last = await lastFawSpray(c, { excludeInstanceId: instance.id });
  if (last?.irac_group && last.irac_group === item.irac_group) {
    return { kind: "rotation_breach", irac_group: item.irac_group, product, previous: last.product };
  }
  return null;
}

// ── Planned releases: staggered hatching toward 1,000+ layers ──

export async function releasePlannedTasks(c, dateStr = farmDateStr()) {
  const plan = await setting(c, "poultry_plan");
  if (!plan?.placements?.length) return [];
  const released = [];
  const n = plan.placements.length;
  for (const [i, placeOn] of plan.placements.entries()) {
    const label = `batch ${i + 1} of ${n}`;
    const house = plan.house_rotation?.[i % plan.house_rotation.length] || "HOUSE-2";
    const orderOn = addDays(placeOn, -(plan.order_lead_days ?? 21));
    // Windows rather than exact days, so a server that was down catches up;
    // the period key keeps each step to one release.
    if (dateStr >= orderOn && dateStr < placeOn) {
      const id = await releaseTemplateNow(c, "P-09", {
        periodKey: `plan:poultry:${placeOn}:order`,
        title: `Order ${plan.batch_size} day-old ${plan.breed} chicks (${label}, placing ${placeOn})`,
        params: { plan: "poultry", place_on: placeOn, batch_size: plan.batch_size, house },
        dueAt: new Date(`${addDays(dateStr, 3)}T10:00:00+02:00`),
      });
      if (id) released.push({ step: "order", place_on: placeOn, id });
    }
    if (dateStr >= placeOn && dateStr <= addDays(placeOn, 3)) {
      const id = await releaseTemplateNow(c, "P-08", {
        periodKey: `plan:poultry:${placeOn}:place`,
        title: `Place ${plan.batch_size} ${plan.breed} chicks in ${house === "HOUSE-1" ? "Poultry House A" : "Poultry House B"} (${label})`,
        params: { plan: "poultry", planned_count: plan.batch_size, house, purpose: "layers",
          batch_label: `${plan.breed} layers (${label}, placed ${placeOn})` },
        dueAt: new Date(`${dateStr}T12:00:00+02:00`),
      });
      if (id) released.push({ step: "place", place_on: placeOn, id });
    }
  }
  return released;
}

// ── Milestone progress ──

const PROJECTS = {
  phase0_tank: ["A-P1", "A-P2", "A-P3", "A-P4"],
  reticulation: ["A-P5", "A-P6", "A-P7", "A-P8"],
};

async function projectSteps(c, project) {
  const steps = [];
  for (const code of PROJECTS[project]) {
    const tpl = (await c.query(`SELECT code, title FROM task_templates WHERE code = $1 ORDER BY version DESC LIMIT 1`, [code])).rows[0];
    if (!tpl) continue;
    const runs = (await c.query(
      `SELECT state, count(*)::int AS n, max(updated_at) AS last FROM task_instances WHERE template_code = $1 GROUP BY state`, [code])).rows;
    const done = runs.find((r) => r.state === "verified_closed")?.n || 0;
    const open = runs.filter((r) => !["verified_closed", "cancelled", "expired", "superseded", "skipped"].includes(r.state))
      .reduce((a, r) => a + r.n, 0);
    steps.push({ code, title: tpl.title, done, open, last: runs.reduce((a, r) => (a && a > r.last ? a : r.last), null) });
  }
  return steps;
}

export async function planStatus(c, { today = farmDateStr() } = {}) {
  const plan = (await setting(c, "scaling_plan")) || { milestones: [] };
  const kale = (await setting(c, "kale_plan")) || {};
  const poultry = (await setting(c, "poultry_plan")) || {};
  const water = (await setting(c, "water_params")) || {};

  const mean = async (metric, days) => Number((await c.query(
    `SELECT COALESCE(AVG(value), 0) AS v FROM readings WHERE metric = $1 AND taken_at >= now() - ($2 || ' days')::interval`,
    [metric, days])).rows[0].v);
  const sum = async (metric, days) => Number((await c.query(
    `SELECT COALESCE(SUM(value), 0) AS v FROM readings WHERE metric = $1 AND taken_at >= now() - ($2 || ' days')::interval`,
    [metric, days])).rows[0].v);

  const kalePlants = Number((await c.query(`SELECT plant_count FROM locations WHERE code = 'BLK-A'`)).rows[0]?.plant_count || 0);
  const bundles7 = await mean("bundle_count", 7);
  const sales30 = await sum("sales_usd", 30);
  const layers = Number((await c.query(
    `SELECT COALESCE(SUM(current_count), 0) AS n FROM batches WHERE purpose = 'layers' AND stage <> 'closed'`)).rows[0].n);
  const growing = Number((await c.query(
    `SELECT COALESCE(SUM(current_count), 0) AS n FROM batches
     WHERE stage IN ('brooding', 'growing') AND (purpose = 'layers' OR purpose IS NULL)`)).rows[0].n);
  const bcs = (await c.query(`SELECT value, taken_at FROM readings WHERE metric = 'bcs_median' ORDER BY taken_at DESC LIMIT 1`)).rows[0];
  const planted = Number((await c.query(
    `SELECT count(*)::int AS n FROM task_instances WHERE template_code = 'C-09' AND state = 'verified_closed'
     AND closed_at >= $1::date`, [plan.from || "2026-07-01"])).rows[0].n);
  const projects = { phase0_tank: await projectSteps(c, "phase0_tank"), reticulation: await projectSteps(c, "reticulation") };
  const nextPlacement = (poultry.placements || []).find((d) => d >= today) || null;

  const computed = {
    phase0_tank: () => {
      const steps = projects.phase0_tank;
      const done = steps.filter((s) => s.done).length;
      if (water.tank_usable_measured) return { progress: 1, detail: `Usable volume measured: ${Number(water.tank_usable).toLocaleString()} L` };
      return { progress: done / Math.max(1, steps.length), detail: `${done} of ${steps.length} steps done; tank still taken as ${(water.tank_usable_range || [80000, 125000]).map((v) => v.toLocaleString()).join(" to ")} L` };
    },
    reticulation: () => {
      const steps = projects.reticulation;
      const done = steps.filter((s) => s.done).length;
      return { progress: steps.find((s) => s.code === "A-P8")?.done ? 1 : done / Math.max(1, steps.length), detail: `${done} of ${steps.length} kinds of work done` };
    },
    kale_10k: () => {
      const target = kale.target_bundles_per_day?.[0] || 330;
      return {
        progress: Math.min(1, bundles7 / target),
        detail: `${Math.round(bundles7)} bundles a day (7-day mean, target ${target} to ${kale.target_bundles_per_day?.[1] || 400}); ` +
          `$${Math.round(sales30).toLocaleString()} recorded in 30 days (target $${(kale.target_revenue_usd_month?.[0] || 10000).toLocaleString()}+); ` +
          `${kalePlants.toLocaleString()} plants on record (target ${(kale.target_plants || 10000).toLocaleString()})`,
      };
    },
    layers_1000: () => ({
      progress: Math.min(1, layers / (poultry.target_layers || 1000)),
      detail: `${layers.toLocaleString()} layers now, ${growing.toLocaleString()} growing on; ` +
        (nextPlacement ? `next placement ${nextPlacement} (${poultry.batch_size} chicks)` : "all planned placements made"),
    }),
    cattle_bcs: () => (bcs
      ? { progress: Math.max(0, Math.min(1, (Number(bcs.value) - 2.5) / 0.5)), detail: `Median BCS ${Number(bcs.value)} (from about 2.5, target 3.0)` }
      : { progress: 0, detail: "No body condition scores recorded yet (K-04)" }),
    summer_crops: () => ({ progress: planted ? 1 : 0, detail: planted ? `${planted} planting record(s) this season` : "Released with the effective rains (C-09)" }),
  };

  const milestones = (plan.milestones || []).map((m) => {
    const auto = computed[m.key]?.() || { progress: 0, detail: "" };
    const manual = m.status && m.status !== "auto" ? m.status : null;
    const done = manual === "done" || auto.progress >= 1;
    const status = done ? "done" : manual === "blocked" ? "blocked"
      : today > m.target ? "behind" : auto.progress > 0 ? "on_track" : "not_started";
    return { ...m, progress: done ? 1 : auto.progress, detail: auto.detail, status, manual: manual || null };
  });

  return {
    from: plan.from, to: plan.to, milestones, projects,
    kale: { ...kale, bundles_7d_mean: Math.round(bundles7 * 10) / 10, sales_30d_usd: sales30, plants: kalePlants },
    poultry: { ...poultry, layers_now: layers, growing_on: growing, next_placement: nextPlacement },
  };
}
