// Owner daily digest (spec 4.5): exceptions before activity. Completion line,
// water line, money line, then named exceptions each one decision away.
import { farmDateStr, farmTime } from "../util/time.js";
import { notify } from "../workers/notifier.js";

export async function buildDigest(c, dateStr = farmDateStr()) {
  const dayStart = farmTime(dateStr, "00:00");
  const dayEnd = farmTime(dateStr, "23:59");

  const { rows: dayInstances } = await c.query(
    `SELECT state, priority, template_code, title, missed_count FROM task_instances
     WHERE due_at BETWEEN $1 AND $2`, [dayStart, dayEnd]);
  const total = dayInstances.length;
  const verified = dayInstances.filter((i) => i.state === "verified_closed").length;
  const skipped = dayInstances.filter((i) => i.state === "skipped").length;
  const missed = dayInstances.filter((i) => i.state === "missed").length;
  const pendingReview = dayInstances.filter((i) => i.state === "needs_review").length;

  const latest = async (metric) => {
    const r = await c.query(`SELECT value, taken_at FROM readings WHERE metric = $1 ORDER BY taken_at DESC LIMIT 1`, [metric]);
    return r.rows[0] || null;
  };
  const daySum = async (metric) => {
    const r = await c.query(
      `SELECT COALESCE(SUM(value),0) AS s FROM readings WHERE metric = $1 AND taken_at BETWEEN $2 AND $3`,
      [metric, dayStart, dayEnd]);
    return Number(r.rows[0].s);
  };

  const tank = await latest("tank_level_pct");
  const litresPumped = (await daySum("pump_hours")) * 6000;
  const rainToday = await daySum("rain_mm");
  const bundles = await daySum("bundle_count");
  const bundlesSold = await daySum("bundles_sold");
  const salesUsd = await daySum("sales_usd");
  const cashVariance = await latest("cash_variance");

  // Named exceptions needing decisions (spec 4.5)
  const { rows: decisions } = await c.query(
    `SELECT id, template_code, title, state, updated_at FROM task_instances
     WHERE state IN ('needs_review','skip_pending','blocked')
     ORDER BY CASE priority WHEN 'P0' THEN 0 WHEN 'P1' THEN 1 ELSE 2 END, updated_at`);

  const exceptions = decisions.map((d) => ({
    instance_id: d.id, code: d.template_code, title: d.title, state: d.state,
  }));

  // Herdwatch-style withholding board: active PHI/withdrawal windows with countdowns.
  const windowsRow = await c.query(`SELECT value FROM farm_settings WHERE key = 'active_windows'`);
  const withholdings = (windowsRow.rows[0]?.value || [])
    .filter((w) => new Date(w.until) > new Date())
    .map((w) => ({
      type: w.type, product: w.product, until: w.until,
      days_remaining: Math.max(0, Math.ceil((new Date(w.until) - Date.now()) / 86_400_000)),
    }));
  if (cashVariance && Math.abs(Number(cashVariance.value)) > 5) {
    exceptions.push({ kind: "cash_variance", value: Number(cashVariance.value) });
  }

  const { forecastFor } = await import("../workers/forecast.js");
  const { addDays } = await import("../util/time.js");
  const fcTomorrow = await forecastFor(c, addDays(dateStr, 1));

  const fcToday = await forecastFor(c, dateStr);

  const digest = {
    date: dateStr,
    weather: fcToday ? { tmax: fcToday.tmax, tmin: fcToday.tmin, rain_mm: fcToday.rain_mm, prob_pct: fcToday.prob_pct } : null,
    week: await weekToDate(c),
    completion: { total, verified, skipped, missed, pending_review: pendingReview },
    water: {
      tank_pct: tank ? Number(tank.value) : null,
      litres_pumped: litresPumped,
      rain_mm: rainToday,
      rain_expected_tomorrow: fcTomorrow
        ? { mm: fcTomorrow.rain_mm, prob_pct: fcTomorrow.prob_pct }
        : null,
    },
    money: { bundles_harvested: bundles, bundles_sold: bundlesSold, sales_usd: salesUsd,
             cash_variance: cashVariance ? Number(cashVariance.value) : null },
    withholdings,
    exceptions,
  };

  // Weekly trends on Sundays (spec 4.5)
  const dow = new Date(dateStr + "T12:00:00Z").getUTCDay();
  if (dow === 0) {
    const trend = async (metric, days = 7) => {
      const r = await c.query(
        `SELECT date_trunc('day', taken_at) AS d, AVG(value) AS v FROM readings
         WHERE metric = $1 AND taken_at >= now() - ($2 || ' days')::interval GROUP BY 1 ORDER BY 1`,
        [metric, days]);
      return r.rows.map((x) => ({ d: x.d.toISOString().slice(0, 10), v: Math.round(Number(x.v) * 10) / 10 }));
    };
    digest.trends = {
      kale_bundles_7d: await trend("bundle_count"),
      bcs: await trend("bcs_median", 90),
      mortality: await trend("mortality"),
      lay: await trend("egg_count"),
    };
  }
  return digest;
}

// Week to date against the week before (the Tend dashboard's overview):
// revenue, bundles, plantings, and labour hours from clock-ins and outs.
async function weekToDate(c) {
  const sum = async (metric, from, to) => Number((await c.query(
    `SELECT COALESCE(SUM(value), 0) AS v FROM readings WHERE metric = $1
     AND taken_at >= now() - ($2 || ' days')::interval AND taken_at < now() - ($3 || ' days')::interval`,
    [metric, from, to])).rows[0].v);
  const plantings = async (from, to) => Number((await c.query(
    `SELECT count(*) AS n FROM task_instances WHERE template_code IN ('C-06', 'C-09', 'C-10')
     AND state IN ('done_reported', 'needs_review', 'verified_closed')
     AND updated_at >= now() - ($1 || ' days')::interval AND updated_at < now() - ($2 || ' days')::interval`,
    [from, to])).rows[0].n);
  // Pair each clock-in with the next clock-out by the same person.
  const { rows: clocks } = await c.query(
    `SELECT u.name, e.payload->>'clock' AS clock, COALESCE(e.device_time, e.server_time) AS t
     FROM task_events e JOIN users u ON u.id = e.actor_id
     WHERE e.instance_id IS NULL AND e.type = 'field_recorded' AND e.payload ? 'clock'
       AND COALESCE(e.device_time, e.server_time) >= now() - interval '14 days'
     ORDER BY u.name, t`);
  const hours = { this: {}, prev: {} };
  const open = {};
  for (const r of clocks) {
    if (r.clock === "in") { open[r.name] = new Date(r.t); continue; }
    if (!open[r.name]) continue;
    const h = (new Date(r.t) - open[r.name]) / 3_600_000;
    const bucket = Date.now() - open[r.name] < 7 * 86_400_000 ? "this" : "prev";
    if (h > 0 && h < 24) hours[bucket][r.name] = (hours[bucket][r.name] || 0) + h;
    delete open[r.name];
  }
  const total = (o) => Math.round(Object.values(o).reduce((a, b) => a + b, 0) * 10) / 10;
  const pair = (now, before) => ({ now, before });
  return {
    revenue_usd: pair(await sum("sales_usd", 7, 0), await sum("sales_usd", 14, 7)),
    bundles_harvested: pair(await sum("bundle_count", 7, 0), await sum("bundle_count", 14, 7)),
    plantings: pair(await plantings(7, 0), await plantings(14, 7)),
    labour_hours: pair(total(hours.this), total(hours.prev)),
    labour_by_person: Object.entries(hours.this).map(([name, h]) => ({ name, hours: Math.round(h * 10) / 10 })),
  };
}

export async function sendDigest(c, dateStr = farmDateStr()) {
  const digest = await buildDigest(c, dateStr);
  const line = `Digest ${dateStr}: ${digest.completion.verified}/${digest.completion.total} verified, ` +
    `${digest.completion.skipped} skipped, ${digest.completion.missed} missed. ` +
    `Tank ${digest.water.tank_pct ?? "?"}%. Sold ${digest.money.bundles_sold} bundles ($${digest.money.sales_usd}). ` +
    `${digest.exceptions.length} exception(s) need you.`;
  await notify(c, { channel: "digest", to: "owner", rung: "daily_digest", body: { digest: true, text: line, data: digest } });
  await notify(c, { channel: "whatsapp", to: "owner", rung: "daily_digest", body: { digest: true, text: line } });
  return digest;
}
