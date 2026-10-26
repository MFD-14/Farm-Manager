// WhatsApp webhook (spec 4.4, 1.7) and VIM verdict callback (spec 5.5).
import { Router } from "express";
import { randomUUID, createHmac, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { q, tx } from "../db/pool.js";
import { config } from "../config.js";
import { foldEvent } from "../engine/fold.js";
import { applyVimVerdict, routeAfterDoneReported } from "../engine/verification.js";
import { validateEvidence } from "../engine/evidence.js";
import { sendReply } from "../workers/whatsappSender.js";
import { getIntegrations } from "../integrations/settings.js";
import { vimSecretOk } from "./vim.js";

export const webhooksRouter = Router();

let fetchImpl = (...args) => fetch(...args);
export function setWebhookFetch(fn) { fetchImpl = fn || ((...args) => fetch(...args)); }

// Meta webhook verification handshake.
webhooksRouter.get("/whatsapp", async (req, res) => {
  const { whatsapp } = await getIntegrations();
  const expected = whatsapp.verifyToken;
  if (expected && req.query["hub.mode"] === "subscribe" && req.query["hub.verify_token"] === expected) {
    return res.send(req.query["hub.challenge"]);
  }
  res.status(403).end();
});

// Meta signs each delivery with the app secret (X-Hub-Signature-256). With the
// secret configured, unsigned or mis-signed requests are dropped, so nobody can
// fake a "Done" from the caretaker's number.
export function signatureValid(rawBody, header, secret) {
  if (!secret) return true;
  if (!rawBody || !header?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest();
  const given = Buffer.from(header.slice(7), "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

const taskLabel = (i) => `${i.template_code} ${i.title}`;
const OPEN_STATES = ["released", "acknowledged", "in_progress", "done_reported"];

async function openTasksFor(c, userId) {
  // "Exactly one task for that subject is open" attachment heuristic (spec 4.4).
  const r = await c.query(
    `SELECT id, template_code, title, state FROM task_instances
     WHERE assignee_id = $1 AND state = ANY($2)
     ORDER BY CASE priority WHEN 'P0' THEN 0 WHEN 'P1' THEN 1 ELSE 2 END, due_at`,
    [userId, OPEN_STATES]);
  return r.rows;
}

// Button ids look like "done:<instance uuid>"; older or typed replies are just
// the word, resolved against the replied-to message or the one open task.
function parseAction(raw) {
  const s = String(raw || "").trim().toLowerCase();
  const m = s.match(/^(done|problem|skip)(?::([0-9a-f-]{36}))?$/);
  return m ? { action: m[1], instanceId: m[2] || null } : null;
}

async function rerouteIfDone(c, instanceId) {
  const inst = (await c.query(`SELECT * FROM task_instances WHERE id = $1 FOR UPDATE`, [instanceId])).rows[0];
  if (!inst || inst.state !== "done_reported") return;
  const policy = inst.params?.evidence_policy_resolved ||
    (await c.query(`SELECT evidence_policy FROM task_templates WHERE id = $1`, [inst.template_id])).rows[0]?.evidence_policy || {};
  await routeAfterDoneReported(c, inst, policy, validateEvidence(policy, inst.evidence_summary || {}),
    { event_uuid: randomUUID(), device_time: new Date() });
}

async function handleAction(c, contact, parsed, contextInstanceId) {
  let instanceId = parsed.instanceId || contextInstanceId;
  if (!instanceId) {
    const open = (await openTasksFor(c, contact.user_id)).filter((t) => t.state !== "done_reported");
    if (open.length === 1) instanceId = open[0].id;
    else {
      await sendReply(c, { toPhone: contact.wa_phone,
        text: open.length ? "Which task? Please use the buttons on the reminder, or record it in the Woodlands app."
          : "There's no open task to record that against." });
      return { handled: false, reason: "no unambiguous open task" };
    }
  }
  const inst = (await c.query(`SELECT * FROM task_instances WHERE id = $1`, [instanceId])).rows[0];
  if (!inst) return { handled: false };
  if (!["released", "acknowledged", "in_progress"].includes(inst.state)) {
    await sendReply(c, { toPhone: contact.wa_phone, instanceId,
      text: `${taskLabel(inst)} is already recorded (${inst.state.replaceAll("_", " ")}).` });
    return { handled: true, instanceId, already: true };
  }
  const map = {
    done: { type: "done_reported", payload: { via: "whatsapp" } },
    problem: { type: "problem_flagged", payload: { via: "whatsapp", reason_code: "other" } },
    skip: { type: "skip_requested", payload: { via: "whatsapp", reason_code: "other" } },
  };
  await foldEvent(c, {
    event_uuid: randomUUID(), instance_id: instanceId,
    actor_type: "whatsapp", actor_id: contact.user_id,
    type: map[parsed.action].type, payload: map[parsed.action].payload,
  });
  const after = (await c.query(`SELECT state, evidence_summary FROM task_instances WHERE id = $1`, [instanceId])).rows[0];
  const reply = {
    done: after?.state === "done_reported"
      ? `Noted: ${taskLabel(inst)} done. If it needs a photo, send it here as a reply to this message.`
      : after?.state === "needs_review"
        ? `Noted: ${taskLabel(inst)} done. It also needs readings or details, please add them in the Woodlands app.`
        : `Noted: ${taskLabel(inst)} done. Thank you.`,
    problem: `Noted a problem with ${taskLabel(inst)}. The owner will see it.`,
    skip: `Skip request for ${taskLabel(inst)} sent to the owner.`,
  }[parsed.action];
  await sendReply(c, { toPhone: contact.wa_phone, text: reply, instanceId });
  return { handled: true, instanceId };
}

const EXT = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "video/mp4": "mp4",
  "audio/ogg": "ogg", "audio/mpeg": "mp3", "audio/aac": "aac", "audio/amr": "amr" };

async function fetchAndStoreWaMedia(c, contact, waMedia, kind) {
  // Media URLs from Meta are short-lived (spec 1.7): fetch immediately. Without
  // credentials the reference is kept for later manual retrieval.
  const { whatsapp } = await getIntegrations(c);
  const mediaUuid = randomUUID();
  const mime = String(waMedia.mime_type || "").split(";")[0];
  const storageKey = `${mediaUuid}.${EXT[mime] || (kind === "image" ? "jpg" : kind === "video" ? "mp4" : "ogg")}`;
  let bytes = 0;
  if (whatsapp.token) {
    try {
      const auth = { headers: { Authorization: `Bearer ${whatsapp.token}` } };
      const meta = await fetchImpl(`https://graph.facebook.com/${whatsapp.apiVersion}/${waMedia.id}`, auth).then((r) => r.json());
      if (meta.url) {
        const bin = await fetchImpl(meta.url, auth);
        const buf = Buffer.from(await bin.arrayBuffer());
        fs.mkdirSync(config.mediaDir, { recursive: true });
        fs.writeFileSync(path.join(config.mediaDir, storageKey), buf);
        bytes = buf.length;
      }
    } catch { /* keep the reference only */ }
  }
  await c.query(
    `INSERT INTO media_objects (media_uuid, instance_id, kind, status, storage_key, bytes, exif, device_id)
     VALUES ($1, NULL, $2, $3, $4, $5, $6, NULL)`,
    [mediaUuid, kind === "image" ? "photo" : kind, bytes ? "stored" : "pending_upload",
     storageKey, bytes, { wa_media_id: waMedia.id, via: "whatsapp", from_user: contact.user_id }]);
  return mediaUuid;
}

async function attachMedia(c, contact, mediaUuid, instanceId) {
  const m = (await c.query(`SELECT kind FROM media_objects WHERE media_uuid = $1`, [mediaUuid])).rows[0];
  await c.query(`UPDATE media_objects SET instance_id = $2 WHERE media_uuid = $1`, [mediaUuid, instanceId]);
  await foldEvent(c, {
    event_uuid: randomUUID(), instance_id: instanceId,
    actor_type: "whatsapp", actor_id: contact.user_id,
    type: "media_attached", payload: { media_uuid: mediaUuid, kind: m?.kind || "photo", via: "whatsapp" },
  });
  await rerouteIfDone(c, instanceId);
  const inst = (await c.query(`SELECT * FROM task_instances WHERE id = $1`, [instanceId])).rows[0];
  const pendingDone = ["released", "acknowledged", "in_progress"].includes(inst.state);
  await sendReply(c, { toPhone: contact.wa_phone, instanceId,
    text: `Photo received for ${taskLabel(inst)}.${pendingDone ? " Tap Done (or reply \"done\") when the task is finished." : " Thank you."}` });
}

async function handleMedia(c, contact, msg, contextInstanceId) {
  const mediaUuid = await fetchAndStoreWaMedia(c, contact, msg[msg.type], msg.type);
  let instanceId = contextInstanceId;
  const open = await openTasksFor(c, contact.user_id);
  if (!instanceId && open.length === 1) instanceId = open[0].id;
  if (instanceId) {
    await attachMedia(c, contact, mediaUuid, instanceId);
    return instanceId;
  }
  if (!open.length) {
    await sendReply(c, { toPhone: contact.wa_phone, mediaUuid,
      text: "Photo saved, but you have no open task to attach it to." });
    return null;
  }
  // Ask "which task is this for?" (spec 4.4); a number reply attaches it.
  const choices = open.slice(0, 9);
  await sendReply(c, { toPhone: contact.wa_phone, mediaUuid, choices: choices.map((o) => o.id),
    text: "Which task is this photo for? Reply with the number:\n" +
      choices.map((o, i) => `${i + 1}. ${taskLabel(o)}`).join("\n") });
  return null;
}

// "2" after a "which task?" list attaches the waiting photo to task 2.
async function handleChoice(c, contact, n) {
  const r = await c.query(
    `SELECT id, payload FROM wa_messages
     WHERE direction = 'out' AND to_phone = $1 AND payload ? 'choices' AND payload->'choices' IS NOT NULL
       AND jsonb_typeof(payload->'choices') = 'array' AND NOT (payload ? 'chosen')
       AND created_at > now() - interval '6 hours'
     ORDER BY created_at DESC LIMIT 1`, [contact.wa_phone]);
  const prompt = r.rows[0];
  const instanceId = prompt?.payload?.choices?.[n - 1];
  if (!instanceId || !prompt.payload.media_uuid) return false;
  await c.query(`UPDATE wa_messages SET payload = payload || $2 WHERE id = $1`, [prompt.id, { chosen: n }]);
  await attachMedia(c, contact, prompt.payload.media_uuid, instanceId);
  return instanceId;
}

async function processMessage(msg) {
  await tx(async (c) => {
    const dup = await c.query(`SELECT 1 FROM wa_messages WHERE wa_message_id = $1`, [msg.id]);
    if (dup.rows.length) return;
    const phone = "+" + String(msg.from).replace(/^\+/, "");
    const contact = (await c.query(
      `SELECT wc.* FROM wa_contacts wc JOIN users u ON u.id = wc.user_id
       WHERE wc.wa_phone = $1 AND wc.allow_listed AND u.active`, [phone])).rows[0];
    if (!contact) {
      await c.query(
        `INSERT INTO wa_messages (direction, wa_message_id, payload, status, to_phone)
         VALUES ('in', $1, $2, 'ignored_not_allowlisted', $3)`, [msg.id, msg, phone]);
      return;
    }
    // Every inbound message opens/refreshes the 24h service window (spec 1.7).
    await c.query(`UPDATE wa_contacts SET window_open_until = now() + interval '24 hours' WHERE id = $1`, [contact.id]);

    const contextId = msg.context?.id
      ? (await c.query(`SELECT related_instance_id FROM wa_messages WHERE wa_message_id = $1`, [msg.context.id])).rows[0]?.related_instance_id
      : null;

    let related = null;
    if (msg.type === "interactive" || msg.type === "button") {
      const raw = msg.interactive?.button_reply?.id || msg.button?.payload || msg.interactive?.button_reply?.title || msg.button?.text;
      const parsed = parseAction(raw);
      if (parsed) related = (await handleAction(c, contact, parsed, contextId)).instanceId || null;
    } else if (["image", "video", "audio"].includes(msg.type)) {
      related = await handleMedia(c, contact, msg, contextId);
    } else if (msg.type === "text") {
      const t = msg.text?.body?.trim() || "";
      const parsed = parseAction(t);
      if (parsed) related = (await handleAction(c, contact, parsed, contextId)).instanceId || null;
      else if (/^[1-9]$/.test(t)) related = (await handleChoice(c, contact, Number(t))) || null;
    }

    await c.query(
      `INSERT INTO wa_messages (direction, wa_message_id, contact_id, payload, status, related_instance_id, to_phone)
       VALUES ('in', $1, $2, $3, 'processed', $4, $5)`,
      [msg.id, contact.id, msg, related, phone]);
  });
}

// POST: messages and delivery statuses. Idempotent on wa_message_id.
webhooksRouter.post("/whatsapp", async (req, res) => {
  const { whatsapp } = await getIntegrations();
  if (!signatureValid(req.rawBody, req.get("x-hub-signature-256"), whatsapp.appSecret)) {
    return res.status(401).end();
  }
  res.status(200).end(); // ack fast; Meta retries on non-200
  for (const entry of req.body?.entry || []) {
    for (const change of entry.changes || []) {
      const value = change.value || {};
      for (const status of value.statuses || []) {
        const error = status.errors?.[0] ? `${status.errors[0].code}: ${status.errors[0].title || status.errors[0].message || ""}` : null;
        await q(
          `UPDATE wa_messages SET status = $2, error = COALESCE($3, error), updated_at = now() WHERE wa_message_id = $1`,
          [status.id, status.status, error]).catch(() => {});
      }
      for (const msg of value.messages || []) {
        try {
          await processMessage(msg);
        } catch (err) {
          console.error("wa webhook error", err.message);
        }
      }
    }
  }
});

// VIM v1.1 annotation callback (spec 5.5). Advisory: stored with the evidence
// and shown on the acceptance card; never moves a task. Off unless
// VIM_WEBHOOK_SECRET is set and sent as x-vim-secret.
webhooksRouter.post("/vim", async (req, res) => {
  if (!vimSecretOk(req)) return res.status(403).json({ error: "forbidden" });
  const { media_uuid, instance_id, verdict, confidence, extracted, model_version } = req.body || {};
  if (!media_uuid || !verdict) return res.status(400).json({ error: "media_uuid and verdict required" });
  try {
    await tx(async (c) => {
      await applyVimVerdict(c, { media_uuid, instance_id, verdict, confidence, extracted, model_version });
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
