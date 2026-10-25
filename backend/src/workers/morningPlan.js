// Morning task list on WhatsApp: once a day, at the owner's chosen farm time,
// each caretaker gets the tasks released for them today. Runs from the 5-minute
// sweep; a farm_settings marker makes it fire once per farm day.
import { getIntegrations } from "../integrations/settings.js";
import { sendMorningPlan, waPeople } from "./whatsappSender.js";
import { farmDateStr, farmDateParts } from "../util/time.js";

export async function runMorningPlan(c, { now = new Date() } = {}) {
  const s = await getIntegrations(c);
  if (!s.whatsapp.morningPlan) return { sent: 0, reason: "off" };
  const today = farmDateStr(now);
  const p = farmDateParts(now);
  const nowMin = p.hh * 60 + p.mm;
  const [th, tm] = s.whatsapp.morningTime.split(":").map(Number);
  const startMin = th * 60 + tm;
  if (nowMin < startMin) return { sent: 0, reason: "too early" };
  // A server that was down at the chosen time doesn't send a "good morning"
  // list in the afternoon.
  if (nowMin > startMin + 180) return { sent: 0, reason: "too late today" };

  const marker = (await c.query(`SELECT value FROM farm_settings WHERE key = 'wa_morning_sent'`)).rows[0]?.value;
  if (marker?.date === today) return { sent: 0, reason: "already sent" };
  // Claim the day first so overlapping sweeps can't double-send.
  await c.query(
    `INSERT INTO farm_settings (key, value) VALUES ('wa_morning_sent', $1)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [JSON.stringify({ date: today, at: now.toISOString() })]);

  const plan = (await c.query(`SELECT instance_ids FROM daily_plans WHERE plan_date = $1`, [today])).rows[0];
  if (!plan?.instance_ids?.length) return { sent: 0, reason: "no plan" };
  const { rows: open } = await c.query(
    `SELECT * FROM task_instances WHERE id = ANY($1) AND state IN ('released','acknowledged','in_progress')
     ORDER BY due_at NULLS LAST`, [plan.instance_ids]);

  const caretakers = await waPeople(c, { role: "caretaker" });
  if (!caretakers.length) return { sent: 0, reason: "no caretaker with WhatsApp" };
  const byUser = new Map(caretakers.map((u) => [u.id, []]));
  for (const inst of open) {
    const owner = byUser.has(inst.assignee_id) ? inst.assignee_id : caretakers[0].id;
    byUser.get(owner).push(inst);
  }
  let sent = 0;
  for (const u of caretakers) {
    const list = byUser.get(u.id);
    if (!list.length) continue;
    await sendMorningPlan(c, { user: u, instances: list });
    sent += 1;
  }
  return { sent };
}
