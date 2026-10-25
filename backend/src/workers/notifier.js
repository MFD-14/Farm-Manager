// Notification dispatch (spec 4.1 channel stack). Every send is logged to
// notifications_log; WhatsApp goes out through the sender when configured and
// degrades to log-only otherwise. SMS and push are logged stubs behind the same
// interface so wiring a gateway later touches only this file.
import { sendWhatsApp } from "./whatsappSender.js";

export async function notify(c, { channel, to, rung, instanceId = null, body = {} }) {
  const user = await c.query(
    `SELECT id, phone FROM users WHERE role = $1 AND active ORDER BY created_at LIMIT 1`, [to === "owner" ? "owner" : "caretaker"]);
  const recipient = user.rows[0]?.phone || to;

  await c.query(
    `INSERT INTO notifications_log (channel, rung, instance_id, recipient, body)
     VALUES ($1,$2,$3,$4,$5)`,
    [channel === "local" ? "push" : channel, rung || null, instanceId, recipient, body]);

  if (channel === "whatsapp") {
    await sendWhatsApp(c, { toPhone: recipient, body, instanceId }).catch(() => {});
  }
  return { channel, recipient };
}

// Reminder collapse (spec 4.3): one message lists all currently-overdue tasks.
export async function notifyCollapsedOverdue(c, { to, instances, rung }) {
  const lines = instances.map((i) => `- ${i.template_code} ${i.title}`);
  return notify(c, {
    channel: "whatsapp", to, rung,
    body: { collapsed: true, count: instances.length, tasks: lines },
  });
}
