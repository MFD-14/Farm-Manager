// Evidence after "done": the acceptance sweep, and the feed of field video for
// the Video Intelligence Module.
//
// Photos, video and voice notes are not machine-checked (owner decision, Oct
// 2026). A task whose evidence is complete moves to the acceptance queue, where
// an owner or task manager accepts it or sends it back. VIM v1.1 (an external
// service that analyses field video) pulls new videos from /api/vim/pending and
// posts advisory annotations to /api/webhooks/vim; those appear on the
// acceptance card and never close a task.
import { randomUUID } from "node:crypto";
import { q, tx } from "../db/pool.js";
import { routeAfterDoneReported, flagMissingMedia } from "../engine/verification.js";
import { validateEvidence } from "../engine/evidence.js";

// Catch-up: a task can sit at done_reported if its evidence arrived through a
// path that didn't re-route it, or (once) because it was waiting on a photo
// check that no longer exists. Re-run routing for anything older than 10
// minutes; a task still waiting for uploads after 24 hours goes to the queue
// flagged media_not_uploaded.
export async function acceptanceSweep() {
  const { rows } = await q(
    `SELECT id FROM task_instances WHERE state = 'done_reported' AND updated_at < now() - interval '10 minutes'
     ORDER BY updated_at LIMIT 200`);
  let moved = 0;
  for (const { id } of rows) {
    await tx(async (c) => {
      const inst = (await c.query(`SELECT * FROM task_instances WHERE id = $1 FOR UPDATE`, [id])).rows[0];
      if (!inst || inst.state !== "done_reported") return;
      const policy = inst.params?.evidence_policy_resolved ||
        (await c.query(`SELECT evidence_policy FROM task_templates WHERE id = $1`, [inst.template_id])).rows[0]?.evidence_policy || {};
      await routeAfterDoneReported(c, inst, policy, validateEvidence(policy, inst.evidence_summary || {}),
        { event_uuid: randomUUID(), device_time: new Date() });
      let after = (await c.query(`SELECT state, updated_at FROM task_instances WHERE id = $1`, [id])).rows[0];
      if (after.state === "done_reported" && new Date(inst.updated_at) < new Date(Date.now() - 24 * 3_600_000)) {
        await flagMissingMedia(c, inst);
        after = (await c.query(`SELECT state FROM task_instances WHERE id = $1`, [id])).rows[0];
      }
      if (after.state !== "done_reported") moved += 1;
    });
  }
  return moved;
}

// Videos stored on the server that VIM hasn't annotated yet.
export async function pendingVideos(limit = 20) {
  const { rows } = await q(
    `SELECT m.media_uuid, m.instance_id, m.bytes, m.captured_at, m.storage_key,
            ti.template_code, ti.title, tt.evidence_policy->>'vim_profile' AS profile
     FROM media_objects m
     JOIN task_instances ti ON ti.id = m.instance_id
     JOIN task_templates tt ON tt.id = ti.template_id
     WHERE m.kind = 'video' AND m.status = 'stored'
       AND NOT EXISTS (SELECT 1 FROM vim_verdicts v WHERE v.media_uuid = m.media_uuid)
     ORDER BY m.created_at LIMIT $1`, [limit]);
  return rows.map((r) => ({
    media_uuid: r.media_uuid, instance_id: r.instance_id, bytes: Number(r.bytes || 0), captured_at: r.captured_at,
    task: `${r.template_code} ${r.title}`, profile: r.profile || null, download: `/api/vim/media/${r.media_uuid}`,
  }));
}

