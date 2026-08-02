process.env.NODE_ENV = "test";
import { randomUUID } from "node:crypto";
import { pool, tx, q } from "../src/db/pool.js";
import { migrate } from "../src/db/migrate.js";
import { seed } from "../src/db/seed.js";
import { foldEvent } from "../src/engine/fold.js";

let prepared = false;

export async function prepareDb() {
  if (prepared) return;
  await q(`DROP SCHEMA public CASCADE`);
  await q(`CREATE SCHEMA public`);
  await migrate();
  await seed();
  prepared = true;
}

export async function resetDynamic() {
  // Keep templates/rules/reference; clear runtime state between tests.
  await q(`ALTER TABLE task_events DISABLE TRIGGER task_events_no_update`);
  await q(`TRUNCATE task_events, task_instances, readings, daily_plans, media_objects,
           vim_jobs, vim_verdicts, notifications_log, wa_messages, inventory_moves, batches CASCADE`);
  await q(`ALTER TABLE task_events ENABLE TRIGGER task_events_no_update`);
  await q(`UPDATE rules SET last_fired_at = NULL, stage2_fired_at = NULL`);
  await q(`DELETE FROM farm_settings WHERE key IN ('suppressions','active_windows')`);
  await q(`UPDATE farm_settings SET value = '{"active": false}' WHERE key = 'absence_mode'`);
  await q(`DELETE FROM meter_accumulators`);
}

export async function caretaker() {
  return (await q(`SELECT * FROM users WHERE role = 'caretaker' LIMIT 1`)).rows[0];
}
export async function owner() {
  return (await q(`SELECT * FROM users WHERE role = 'owner' LIMIT 1`)).rows[0];
}

export async function appendEvent(instanceId, type, payload = {}, opts = {}) {
  const user = opts.actor || (await caretaker());
  return tx((c) =>
    foldEvent(c, {
      event_uuid: opts.event_uuid || randomUUID(),
      instance_id: instanceId,
      actor_type: opts.actor_type || "caretaker",
      actor_id: user.id,
      type,
      payload,
      device_time: opts.device_time || new Date(),
    }));
}

export async function getInstance(id) {
  return (await q(`SELECT * FROM task_instances WHERE id = $1`, [id])).rows[0];
}

export async function instancesByCode(code) {
  return (await q(`SELECT * FROM task_instances WHERE template_code = $1 ORDER BY created_at`, [code])).rows;
}

export { pool, tx, q };
