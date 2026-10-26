// KPI set (spec 9.2), computed server-side from events and readings.

export async function computeKpis(c, { days = 7 } = {}) {
  const since = new Date(Date.now() - days * 86_400_000);

  const one = async (sql, params = []) => (await c.query(sql, params)).rows[0] || {};

  const completion = await one(
    `SELECT
       COUNT(*) FILTER (WHERE priority IN ('P0','P1')) AS p1_released,
       COUNT(*) FILTER (WHERE priority IN ('P0','P1') AND state = 'verified_closed'
                        AND closed_at <= grace_until) AS p1_on_time,
       COUNT(*) AS released,
       COUNT(*) FILTER (WHERE state IN ('verified_closed','skipped')) AS terminal_positive
     FROM task_instances WHERE release_at >= $1 AND state <> 'scheduled'`, [since]);

  // Acceptance (manual verification): how quickly evidence is accepted, and
  // how often it goes through first time.
  const acceptance = await one(
    `SELECT
       COUNT(*) FILTER (WHERE ti.verification->>'method' = 'accepted') AS accepted,
       COUNT(*) FILTER (WHERE ti.verification->>'method' = 'accepted' AND ti.rejection_count = 0) AS first_time,
       percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (ti.closed_at - d.reported)) / 3600)
         FILTER (WHERE ti.verification->>'method' = 'accepted') AS median_hours
     FROM task_instances ti
     LEFT JOIN LATERAL (SELECT max(server_time) AS reported FROM task_events e
                        WHERE e.instance_id = ti.id AND e.type = 'done_reported') d ON true
     WHERE ti.closed_at >= $1`, [since]);
  const sentBack = await one(
    `SELECT COUNT(*) AS n FROM task_events WHERE type = 'rejected_reopened' AND server_time >= $1`, [since]);
  const waiting = await one(`SELECT COUNT(*) AS n FROM task_instances WHERE state = 'needs_review'`);

  const integrity = await one(
    `SELECT COUNT(*) AS flags FROM task_events
     WHERE type = 'review_required' AND server_time >= $1
       AND payload::text ~ '(phash|geofence|timing)'`, [since]);

  const sync = await one(
    `SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (server_time - device_time))) AS median_s
     FROM task_events WHERE device_time IS NOT NULL AND server_time >= $1
       AND actor_type IN ('caretaker','whatsapp')`, [since]);

  const series = async (metric) => {
    const r = await c.query(
      `SELECT COALESCE(AVG(value),0) AS mean, COALESCE(SUM(value),0) AS sum
       FROM readings WHERE metric = $1 AND taken_at >= $2`, [metric, since]);
    return { mean: Number(r.rows[0].mean), sum: Number(r.rows[0].sum) };
  };

  const bundles = await series("bundle_count");
  const sales = await series("sales_usd");
  const pumpHours = await series("pump_hours");
  const irrigation = await series("irrigation_litres");
  const bcs = await one(
    `SELECT value FROM readings WHERE metric = 'bcs_median' ORDER BY taken_at DESC LIMIT 1`);
  const mortality = await series("mortality");
  const eggs = await series("egg_count");

  const pmCompliance = await one(
    `SELECT COUNT(*) FILTER (WHERE state = 'verified_closed' AND closed_at <= grace_until) AS on_time,
            COUNT(*) AS total
     FROM task_instances ti JOIN task_templates tt ON tt.id = ti.template_id
     WHERE tt.domain = 'A' AND ti.release_at >= $1 AND ti.state <> 'scheduled'`, [since]);

  const kalePlan = (await c.query(`SELECT value FROM farm_settings WHERE key = 'kale_plan'`)).rows[0]?.value || {};
  const layersNow = await one(
    `SELECT COALESCE(SUM(current_count), 0) AS n FROM batches WHERE purpose = 'layers' AND stage <> 'closed'`);

  const escalations = await one(
    `SELECT COUNT(*) AS n FROM notifications_log WHERE sent_at >= $1 AND rung LIKE 'overdue%'`, [since]);

  const darkFarm = await one(
    `SELECT COUNT(*) AS n FROM notifications_log WHERE rung = 'rule:T9 Dark farm' AND sent_at >= $1`, [since]);

  const pct = (a, b) => (Number(b) ? Math.round((Number(a) / Number(b)) * 1000) / 10 : null);

  return {
    period_days: days,
    on_time_verified_p1_pct: pct(completion.p1_on_time, completion.p1_released),
    overall_completion_pct: pct(completion.terminal_positive, completion.released),
    accepted_first_time_pct: pct(acceptance.first_time, acceptance.accepted),
    median_hours_to_accept: acceptance.median_hours !== null && acceptance.median_hours !== undefined
      ? Math.round(Number(acceptance.median_hours) * 10) / 10 : null,
    sent_back: Number(sentBack.n),
    waiting_for_acceptance: Number(waiting.n),
    evidence_integrity_flags: Number(integrity.flags),
    median_sync_latency_s: sync.median_s !== null ? Math.round(Number(sync.median_s)) : null,
    kale_bundles_daily_mean: Math.round(bundles.mean * 10) / 10,
    kale_target_bundles_per_day: kalePlan.target_bundles_per_day?.[0] || 330,
    revenue_monthly_run_rate_usd: Math.round((sales.sum / days) * 30),
    layers_now: Number(layersNow.n),
    revenue_recorded_usd: sales.sum,
    water_pumped_l: pumpHours.sum * 6000,
    irrigation_litres: irrigation.sum,
    water_l_per_bundle: bundles.sum ? Math.round((irrigation.sum / bundles.sum) * 10) / 10 : null,
    cattle_bcs_median: bcs.value !== undefined ? Number(bcs.value) : null,
    poultry_mortality_sum: mortality.sum,
    eggs_sum: eggs.sum,
    pm_compliance_pct: pct(pmCompliance.on_time, pmCompliance.total),
    escalations_to_owner: Number(escalations.n),
    dark_farm_incidents: Number(darkFarm.n),
  };
}
