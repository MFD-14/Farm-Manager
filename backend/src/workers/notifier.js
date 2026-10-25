// Notification dispatch (spec 4.1 channel stack). Every send is logged to
// notifications_log; WhatsApp goes out through the sender (which degrades to
// log-only without credentials). SMS and push are logged stubs behind the same
// interface so wiring a gateway later touches only this file.
import { sendOwnerAlert, sendOverdueList, sendTaskReminder, waPeople } from "./whatsappSender.js";

// One readable line per notification, used for WhatsApp.
export function alertText(rung, body = {}) {
  if (body.text) return body.text;
  if (rung === "second_miss") return `${body.task} was missed ${body.missed_count} times in a row`;
  if (body.rule) {
    return `rule ${body.rule} fired${body.template ? `, ${body.template} task released` : ""}`;
  }
  if (body.task) return `${body.task} needs attention${body.deputy ? " (absence mode)" : ""}`;
  return `notification ${rung || ""}`.trim();
}

export async function notify(c, { channel, to, rung, instanceId = null, body = {} }) {
  const people = await waPeople(c, { role: to === "owner" ? "owner" : "caretaker" });
  const recipient = people.map((p) => p.phone).join(",") || to;

  await c.query(
    `INSERT INTO notifications_log (channel, rung, instance_id, recipient, body)
     VALUES ($1,$2,$3,$4,$5)`,
    [channel === "local" ? "push" : channel, rung || null, instanceId, recipient, body]);

  if (channel === "whatsapp") {
    const text = alertText(rung, body);
    if (to === "owner") {
      await sendOwnerAlert(c, { text, instanceId, kind: rung === "daily_digest" ? "digest" : "owner_alert" }).catch(() => {});
    }
    // Caretaker-bound generic notifications are task reminders, handled by the
    // escalation engine; nothing else messages the caretaker directly.
  }
  return { channel, recipient };
}

// Reminder collapse (spec 4.3): one message per person listing all of their
// currently-overdue tasks, not one message per task. A single overdue task gets
// the Done / Problem / Skip buttons instead.
export async function notifyCollapsedOverdue(c, { instances, rung, buttons = false }) {
  const caretakers = await waPeople(c, { role: "caretaker" });
  const byUser = new Map();
  for (const inst of instances) {
    let user = inst.assignee_id ? (await waPeople(c, { ids: [inst.assignee_id] }))[0] : null;
    if (!user) user = caretakers[0];
    if (!user) continue;
    if (!byUser.has(user.id)) byUser.set(user.id, { user, list: [] });
    byUser.get(user.id).list.push(inst);
  }
  for (const { user, list } of byUser.values()) {
    await c.query(
      `INSERT INTO notifications_log (channel, rung, instance_id, recipient, body) VALUES ('whatsapp', $1, NULL, $2, $3)`,
      [rung, user.phone, { collapsed: true, count: list.length, tasks: list.map((i) => `${i.template_code} ${i.title}`) }]);
    if (list.length === 1 && buttons) await sendTaskReminder(c, { user, instance: list[0] }).catch(() => {});
    else await sendOverdueList(c, { user, instances: list }).catch(() => {});
  }
  return { people: byUser.size };
}
