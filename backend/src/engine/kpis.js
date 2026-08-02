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

  const autoVerify = await one(
    `SELECT
       COUNT(*) FILTER (WHERE verification->>'method' IN ('vim','media_present')) AS auto,
       COUNT(*) FILTER (WHERE state = 'verified_closed'
                        AND (evidence_summary->'media') IS NOT NULL
                        AND jsonb_array_length(COALESCE(evidence_summary->'media','[]'::jsonb)) > 0) AS evidence_bearing
     FROM task_instances WHERE closed_at >= $1`, [since]);

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

  const vimAgreement = await one(
    `SELECT COUNT(*) FILTER (WHERE agree) AS agree, COUNT(*) AS total FROM (
       SELECT (v.verdict = 'pass') = (ti.state = 'verified_closed') AS agree
       FROM vim_verdicts v JOIN task_instances ti ON ti.id = v.instance_id
       WHERE ti.state IN ('verified_closed','released') AND v.decided_at >= $1
         AND ti.verification->>'method' IN ('owner')
     ) x`, [since]);

  const escalations = await one(
    `SELECT COUNT(*) AS n FROM notifications_log WHERE sent_at >= $1 AND rung LIKE 'overdue%'`, [since]);

  const darkFarm = await one(
    `SELECT COUNT(*) AS n FROM notifications_log WHERE rung = 'rule:T9 Dark farm' AND sent_at >= $1`, [since]);

  const pct = (a, b) => (Number(b) ? Math.round((Number(a) / Number(b)) * 1000) / 10 : null);

  return {
    period_days: days,
    on_time_verified_p1_pct: pct(completion.p1_on_time, completion.p1_released),
    overall_completion_pct: pct(completion.terminal_positive, completion.released),
    auto_verification_pct: pct(autoVerify.auto, autoVerify.evidence_bearing),
    evidence_integrity_flags: Number(integrity.flags),
    median_sync_latency_s: sync.median_s !== null ? Math.round(Number(sync.median_s)) : null,
    kale_bundles_daily_mean: Math.round(bundles.mean * 10) / 10,
    revenue_recorded_usd: sales.sum,
    water_pumped_l: pumpHours.sum * 6000,
    irrigation_litres: irrigation.sum,
    water_l_per_bundle: bundles.sum ? Math.round((irrigation.sum / bundles.sum) * 10) / 10 : null,
    cattle_bcs_median: bcs.value !== undefined ? Number(bcs.value) : null,
    poultry_mortality_sum: mortality.sum,
    eggs_sum: eggs.sum,
    pm_compliance_pct: pct(pmCompliance.on_time, pmCompliance.total),
    vim_agreement_pct: pct(vimAgreement.agree, vimAgreement.total),
    escalations_to_owner: Number(escalations.n),
    dark_farm_incidents: Number(darkFarm.n),
  };
}
