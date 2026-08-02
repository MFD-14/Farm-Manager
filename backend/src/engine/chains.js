// Anchor chains (spec 3.3 S4): an anchor event instantiates the whole chain with
// dates computed from the anchor. Chain members are created in 'scheduled' state;
// the release engine releases them when their release_at date arrives.
import { POULTRY_CHAIN, KALE_CHAIN, CATTLE_REHAB_CHAIN } from "../../seeds/taxonomy.js";
import { farmTime, addDays } from "../util/time.js";

const CHAINS = {
  batch_placed: POULTRY_CHAIN,
  bed_transplanted: KALE_CHAIN,
  programme_started: CATTLE_REHAB_CHAIN,
};

async function createChainInstance(c, { templateCode, anchorDate, offsetDays, subjectType, subjectId, params, title }) {
  const t = await c.query(
    `SELECT * FROM task_templates WHERE code = $1 AND active ORDER BY version DESC LIMIT 1`, [templateCode]);
  if (!t.rows.length) return null;
  const tpl = t.rows[0];
  const date = addDays(anchorDate, offsetDays);
  const releaseAt = farmTime(date, "06:00");
  const dueAt = farmTime(date, "17:00");
  const graceUntil = farmTime(date, "20:00");
  const periodKey = `${date}:chain:${offsetDays}:${params?.step || ""}`;
  const r = await c.query(
    `INSERT INTO task_instances
       (template_id, template_code, template_version, period_key, subject_type, subject_id,
        title, priority, est_minutes, params, release_at, due_at, grace_until, state)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'scheduled')
     ON CONFLICT (template_id, period_key, COALESCE(subject_id, '00000000-0000-0000-0000-000000000000'::uuid))
       DO NOTHING
     RETURNING id`,
    [tpl.id, tpl.code, tpl.version, periodKey, subjectType || tpl.subject_type, subjectId || tpl.default_subject_id,
     title || (params?.step ? `${tpl.title}: ${params.step}` : tpl.title),
     tpl.priority, tpl.est_minutes, JSON.stringify(params || {}), releaseAt, dueAt, graceUntil]);
  return r.rows[0]?.id || null;
}

export async function instantiateChainsForAnchor(c, anchorEvent, instance, event) {
  const chain = CHAINS[anchorEvent];
  if (!chain) return [];
  const anchorDate = (event.device_time ? new Date(event.device_time) : new Date()).toISOString().slice(0, 10);
  const created = [];

  let subjectType = instance.subject_type;
  let subjectId = instance.subject_id;

  // A P-08 chick placement creates the Batch entity itself (spec 2.3).
  if (anchorEvent === "batch_placed") {
    const fields = event.payload?.fields || {};
    const house = await c.query(`SELECT id FROM locations WHERE code = $1 OR name = $1 LIMIT 1`, [fields.house || "HOUSE-1"]);
    const b = await c.query(
      `INSERT INTO batches (species, name, house_location_id, placed_on, placed_count, current_count, stage)
       VALUES ('poultry', $1, $2, $3, $4, $4, 'brooding') RETURNING id`,
      [`Batch ${anchorDate}${fields.house ? " " + fields.house : ""}`, house.rows[0]?.id || null,
       anchorDate, Number(fields.count_placed) || 0]);
    subjectType = "batch";
    subjectId = b.rows[0].id;
  }

  for (const step of chain.offsets) {
    const id = await createChainInstance(c, {
      templateCode: step.template,
      anchorDate,
      offsetDays: step.d,
      subjectType,
      subjectId,
      params: { ...(step.params || {}), anchor: anchorEvent, anchor_date: anchorDate },
      title: step.title,
    });
    if (id) created.push(id);
  }

  // Weekly repeats (poultry weight samples from D7 to D112)
  if (chain.weekly_from_d7) {
    for (let d = 7; d <= 112; d += 7) {
      const id = await createChainInstance(c, {
        templateCode: chain.weekly_from_d7.template,
        anchorDate,
        offsetDays: d,
        subjectType,
        subjectId,
        params: { anchor: anchorEvent, anchor_date: anchorDate, week: d / 7 },
        title: chain.weekly_from_d7.title,
      });
      if (id) created.push(id);
    }
  }
  return created;
}

// If the anchor moves (replant): unreleased chain members shift; released ones
// are superseded (spec 3.3). Re-instantiating with the new anchor date creates
// the shifted set; this marks the old scheduled members superseded.
export async function supersedeChainMembers(c, subjectId, anchorEvent) {
  const { rows } = await c.query(
    `SELECT id FROM task_instances
     WHERE subject_id = $1 AND params->>'anchor' = $2 AND state IN ('scheduled','released','acknowledged')`,
    [subjectId, anchorEvent]);
  const { foldEvent } = await import("./fold.js");
  const { randomUUID } = await import("node:crypto");
  for (const r of rows) {
    await foldEvent(c, {
      event_uuid: randomUUID(), instance_id: r.id, actor_type: "system",
      type: "superseded", payload: { reason: "anchor moved" },
    });
  }
  return rows.length;
}
