// Outbound WhatsApp (spec 1.7, 4.4) over the WhatsApp Business Cloud API.
//
// WhatsApp only allows free-form messages (plain text, tap buttons) within 24
// hours of the person last messaging the farm number. Outside that window a
// pre-approved template is required (see WA_TEMPLATES), and those are billed
// per message. So every send carries both forms: the free-form version is used
// while the window is open, the template otherwise. Without credentials the
// message is recorded as logged_only, so development, tests and a farm that
// hasn't set WhatsApp up yet all behave the same way.
import { getIntegrations, waConfigured, WA_TEMPLATES } from "../integrations/settings.js";
import { normalizePhone, waDigits } from "../util/phone.js";
import { config } from "../config.js";

let fetchImpl = (...args) => fetch(...args);
// Tests swap the network call.
export function setWaFetch(fn) { fetchImpl = fn || ((...args) => fetch(...args)); }

// Template parameters can't contain newlines, tabs or long runs of spaces.
export function templateParam(v, max = 600) {
  const s = String(v ?? "").replace(/[\r\n\t]+/g, "; ").replace(/ {4,}/g, "   ").trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s || "-";
}

export function farmClock(ts) {
  if (!ts) return "today";
  return new Intl.DateTimeFormat("en-GB", { timeZone: config.farmTz, hour: "2-digit", minute: "2-digit" })
    .format(new Date(ts));
}

const taskLabel = (i) => `${i.template_code} ${i.title}`;

/**
 * Low-level send. Returns { status } where status is one of
 * sent | failed | logged_only | skipped_window_closed | skipped_no_phone.
 *   text      free-form body (used when the window is open)
 *   buttons   up to 3 [{ id, title }] reply buttons for the free-form form
 *   template  { key, params: [..], buttonPayloads: [..] } for a closed window
 *   choices   instance ids a numbered list in `text` refers to (photo routing)
 */
export async function sendWhatsApp(c, { toPhone, kind = "message", text, buttons, template, instanceId = null, choices, mediaUuid }) {
  const phone = normalizePhone(toPhone);
  if (!phone) return { status: "skipped_no_phone" };
  const settings = await getIntegrations(c);
  const wa = settings.whatsapp;

  const contact = (await c.query(`SELECT * FROM wa_contacts WHERE wa_phone = $1`, [phone])).rows[0];
  const windowOpen = !!(contact?.window_open_until && new Date(contact.window_open_until) > new Date());
  const tpl = template ? WA_TEMPLATES[template.key] : null;

  let mode = null;
  if (windowOpen && text) mode = buttons?.length ? "interactive" : "text";
  else if (tpl) mode = "template";

  const record = await c.query(
    `INSERT INTO wa_messages (direction, contact_id, template_name, payload, status, related_instance_id, to_phone, kind)
     VALUES ('out', $1, $2, $3, 'queued', $4, $5, $6) RETURNING id`,
    [contact?.id || null, mode === "template" ? tpl.name : null,
     { mode, text, buttons, template, choices, media_uuid: mediaUuid }, instanceId, phone, kind]);
  const id = record.rows[0].id;
  const finish = async (status, extra = {}) => {
    await c.query(
      `UPDATE wa_messages SET status = $2, wa_message_id = COALESCE($3, wa_message_id), error = $4, updated_at = now()
       WHERE id = $1`, [id, status, extra.waId || null, extra.error || null]);
    return { status, id, mode, ...extra };
  };

  if (!mode) return finish("skipped_window_closed", { error: "Outside the 24-hour window and no template for this message" });
  if (!waConfigured(settings)) return finish("logged_only");

  const to = waDigits(phone);
  let payload;
  if (mode === "template") {
    const components = [{
      type: "body",
      parameters: (template.params || []).map((p) => ({ type: "text", text: templateParam(p) })),
    }];
    (template.buttonPayloads || []).forEach((payloadId, index) => {
      components.push({ type: "button", sub_type: "quick_reply", index: String(index),
        parameters: [{ type: "payload", payload: payloadId }] });
    });
    payload = { messaging_product: "whatsapp", to, type: "template",
      template: { name: tpl.name, language: { code: tpl.language || wa.language || "en" },
        ...(tpl.builtin ? {} : { components }) } };
  } else if (mode === "interactive") {
    payload = { messaging_product: "whatsapp", to, type: "interactive",
      interactive: { type: "button", body: { text: text.slice(0, 1024) },
        action: { buttons: buttons.slice(0, 3).map((b) => ({ type: "reply", reply: { id: b.id, title: b.title.slice(0, 20) } })) } } };
  } else {
    payload = { messaging_product: "whatsapp", to, type: "text", text: { body: text.slice(0, 4096) } };
  }

  try {
    const resp = await fetchImpl(`https://graph.facebook.com/${wa.apiVersion}/${wa.phoneId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${wa.token}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) return finish("failed", { error: data?.error?.message || `HTTP ${resp.status}` });
    return finish("sent", { waId: data?.messages?.[0]?.id || null });
  } catch (err) {
    return finish("failed", { error: err.message === "fetch failed" ? "Couldn't reach WhatsApp's servers" : err.message });
  }
}

// People who get WhatsApp from the farm: active, have a phone, haven't opted out.
export async function waPeople(c, { role, ids } = {}) {
  const r = ids
    ? await c.query(`SELECT * FROM users WHERE id = ANY($1) AND active AND wa_opt_in AND phone IS NOT NULL`, [ids])
    : await c.query(`SELECT * FROM users WHERE role = $1 AND active AND wa_opt_in AND phone IS NOT NULL ORDER BY created_at`, [role]);
  return r.rows;
}

// Who a task reminder goes to: the assignee, else the first caretaker.
export async function reminderRecipient(c, instance) {
  if (instance.assignee_id) {
    const [u] = await waPeople(c, { ids: [instance.assignee_id] });
    if (u) return u;
  }
  return (await waPeople(c, { role: "caretaker" }))[0] || null;
}

const firstName = (u) => String(u?.name || "").trim().split(/\s+/)[0] || "there";

export async function sendTaskReminder(c, { user, instance }) {
  const s = await getIntegrations(c);
  if (!s.whatsapp.reminders || !user) return { status: "disabled" };
  const ids = ["done", "problem", "skip"].map((a) => `${a}:${instance.id}`);
  return sendWhatsApp(c, {
    toPhone: user.phone, kind: "task_reminder", instanceId: instance.id,
    text: `Reminder: ${taskLabel(instance)} was due at ${farmClock(instance.due_at)}. ` +
      "Tap Done when it's finished (then send the photo here), or Problem / Skip.",
    buttons: [{ id: ids[0], title: "Done" }, { id: ids[1], title: "Problem" }, { id: ids[2], title: "Skip" }],
    template: { key: "task_reminder", params: [taskLabel(instance), farmClock(instance.due_at)], buttonPayloads: ids },
  });
}

export async function sendOverdueList(c, { user, instances }) {
  const s = await getIntegrations(c);
  if (!s.whatsapp.reminders || !user || !instances.length) return { status: "disabled" };
  const lines = instances.map(taskLabel);
  return sendWhatsApp(c, {
    toPhone: user.phone, kind: "overdue_list",
    text: `${instances.length} task${instances.length === 1 ? " is" : "s are"} overdue:\n` +
      lines.map((l) => `• ${l}`).join("\n") + "\nPlease record them in the Woodlands app.",
    template: { key: "overdue_list", params: [String(instances.length), lines.join("; ")] },
  });
}

export async function sendMorningPlan(c, { user, instances }) {
  const s = await getIntegrations(c);
  if (!s.whatsapp.morningPlan || !user || !instances.length) return { status: "disabled" };
  const lines = instances.map((i) => `${farmClock(i.due_at)} ${taskLabel(i)}`);
  return sendWhatsApp(c, {
    toPhone: user.phone, kind: "morning_plan",
    text: `Good morning ${firstName(user)}. Today's farm tasks (${instances.length}):\n` +
      lines.map((l) => `• ${l}`).join("\n") + "\nOpen the Woodlands app to record them.",
    template: { key: "morning_plan", params: [firstName(user), String(instances.length), lines.join("; ")] },
  });
}

// An owner or task manager sent a task back: tell whoever does it, and why.
export async function sendSentBack(c, { instance, reason }) {
  const s = await getIntegrations(c);
  if (!s.whatsapp.sentBack) return { status: "disabled" };
  const user = await reminderRecipient(c, instance);
  if (!user) return { status: "skipped_no_phone" };
  return sendWhatsApp(c, {
    toPhone: user.phone, kind: "sent_back", instanceId: instance.id,
    text: `${taskLabel(instance)} was sent back. Reason: ${reason}. ` +
      "Please redo it and record it in the Woodlands app (you can send the photo here as a reply).",
    template: { key: "sent_back", params: [taskLabel(instance), reason] },
  });
}

export async function sendOwnerAlert(c, { text, instanceId = null, kind = "owner_alert" }) {
  const s = await getIntegrations(c);
  if (!s.whatsapp.ownerAlerts) return [];
  // Owners and task managers both run the farm from the console.
  const owners = [...await waPeople(c, { role: "owner" }), ...await waPeople(c, { role: "manager" })];
  const results = [];
  for (const o of owners) {
    results.push(await sendWhatsApp(c, {
      toPhone: o.phone, kind, instanceId, text: `Woodlands Farm: ${text}`,
      template: { key: "owner_alert", params: [text] },
    }));
  }
  return results;
}

// Replies to someone who just messaged in (always inside the window).
export async function sendReply(c, { toPhone, text, instanceId = null, choices, mediaUuid }) {
  return sendWhatsApp(c, { toPhone, kind: "reply", text, instanceId, choices, mediaUuid });
}

// Owner's "Send test" button.
export async function sendTest(c, { user }) {
  return sendWhatsApp(c, {
    toPhone: user.phone, kind: "test",
    text: `Test from Woodlands Farm: WhatsApp reminders are working for ${user.name}.`,
    template: { key: "hello" },
  });
}
