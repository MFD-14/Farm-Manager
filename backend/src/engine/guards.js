// Blocking guards (spec 3.4), evaluated at release and at done_reported:
// calibration overdue blocks spray tasks; PHI blocks harvest; withdrawal blocks
// sale records without owner override.

export async function evaluateGuards(c, template, { subjectId = null } = {}) {
  const blocks = [];
  for (const g of template.guards || []) {
    if (g.type === "calibration") {
      // Blocked if the calibration template (e.g. A-04) has no verified close within its interval.
      const t = await c.query(
        `SELECT ti.closed_at, tt.schedule FROM task_instances ti
         JOIN task_templates tt ON tt.id = ti.template_id
         WHERE tt.code = $1 AND ti.state = 'verified_closed'
         ORDER BY ti.closed_at DESC LIMIT 1`, [g.template]);
      const intervalDays = t.rows[0]?.schedule?.interval_days || 90;
      const last = t.rows[0]?.closed_at;
      const overdue = !last || (Date.now() - new Date(last).getTime()) / 86_400_000 > intervalDays;
      if (overdue) blocks.push({ guard: "calibration", detail: `${g.template} overdue`, since: last || null });
    }
    if (g.type === "phi_block") {
      const w = await c.query(`SELECT value FROM farm_settings WHERE key = 'active_windows'`);
      const windows = w.rows[0]?.value || [];
      const hit = windows.find(
        (win) => win.type === "phi" && win.subject_id === subjectId && new Date(win.until) > new Date());
      if (hit) blocks.push({ guard: "phi", detail: `pre-harvest interval active until ${hit.until} (${hit.product})` });
    }
    if (g.type === "withdrawal_block") {
      const w = await c.query(`SELECT value FROM farm_settings WHERE key = 'active_windows'`);
      const windows = w.rows[0]?.value || [];
      const hit = windows.find(
        (win) => win.type === "withdrawal" && win.subject_id === subjectId && new Date(win.until) > new Date());
      if (hit) blocks.push({ guard: "withdrawal", detail: `withdrawal active until ${hit.until} (${hit.product})` });
    }
  }
  return blocks;
}
