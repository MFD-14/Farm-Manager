// Outbound WhatsApp sender (spec 1.7, 4.4). Uses the Business Cloud API when
// WA_TOKEN/WA_PHONE_ID are configured; otherwise records the message locally so
// the rest of the system behaves identically in development and tests.
import { config } from "../config.js";

export async function sendWhatsApp(c, { toPhone, body, instanceId = null, templateName = null }) {
  const contact = await c.query(`SELECT * FROM wa_contacts WHERE wa_phone = $1`, [toPhone]);
  const contactId = contact.rows[0]?.id || null;
  const windowOpen = contact.rows[0]?.window_open_until &&
    new Date(contact.rows[0].window_open_until) > new Date();

  // Outside the 24h service window only template messages may be sent (spec 1.7).
  const mustTemplate = !windowOpen;
  const finalTemplate = templateName || (mustTemplate ? "wfm_utility_update" : null);

  const record = await c.query(
    `INSERT INTO wa_messages (direction, contact_id, template_name, payload, status, related_instance_id)
     VALUES ('out', $1, $2, $3, 'queued', $4) RETURNING id`,
    [contactId, finalTemplate, body, instanceId]);

  if (!config.wa.token || !config.wa.phoneId) {
    await c.query(`UPDATE wa_messages SET status = 'logged_only', updated_at = now() WHERE id = $1`, [record.rows[0].id]);
    return { logged: true };
  }

  const url = `https://graph.facebook.com/v20.0/${config.wa.phoneId}/messages`;
  const payload = finalTemplate
    ? {
        messaging_product: "whatsapp", to: toPhone, type: "template",
        template: { name: finalTemplate, language: { code: "en" },
          components: [{ type: "body", parameters: [{ type: "text", text: JSON.stringify(body).slice(0, 900) }] }] },
      }
    : {
        messaging_product: "whatsapp", to: toPhone, type: "text",
        text: { body: typeof body === "string" ? body : formatBody(body) },
      };

  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${config.wa.token}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await resp.json();
    await c.query(
      `UPDATE wa_messages SET status = $2, wa_message_id = $3, updated_at = now() WHERE id = $1`,
      [record.rows[0].id, resp.ok ? "sent" : "failed", data?.messages?.[0]?.id || null]);
    return { sent: resp.ok };
  } catch (err) {
    await c.query(`UPDATE wa_messages SET status = 'failed', updated_at = now() WHERE id = $1`, [record.rows[0].id]);
    return { sent: false, error: err.message };
  }
}

function formatBody(body) {
  if (body.collapsed) return `Overdue tasks (${body.count}):\n${body.tasks.join("\n")}`;
  if (body.digest) return body.text;
  return Object.entries(body).map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : v}`).join("\n");
}

// Interactive overdue nudge with three reply buttons (spec 4.4).
export async function sendTaskButtons(c, { toPhone, instance }) {
  return sendWhatsApp(c, {
    toPhone,
    instanceId: instance.id,
    body: {
      interactive: true,
      task: `${instance.template_code} ${instance.title}`,
      buttons: ["Done", "Problem", "Skip"],
      instance_id: instance.id,
    },
  });
}
