// WhatsApp webhook (spec 4.4, 1.7) and VIM verdict callback (spec 5.5).
import { Router } from "express";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { q, tx } from "../db/pool.js";
import { config } from "../config.js";
import { foldEvent } from "../engine/fold.js";
import { applyVimVerdict } from "../engine/verification.js";
import { sendWhatsApp } from "../workers/whatsappSender.js";

export const webhooksRouter = Router();

// Meta webhook verification handshake.
webhooksRouter.get("/whatsapp", (req, res) => {
  if (req.query["hub.mode"] === "subscribe" && req.query["hub.verify_token"] === config.wa.verifyToken) {
    return res.send(req.query["hub.challenge"]);
  }
  res.status(403).end();
});

async function openTaskForContact(c, userId) {
  // "exactly one task for that subject is open" attachment heuristic (spec 4.4):
  // one open evidence-bearing instance assigned to the user attaches automatically.
  const r = await c.query(
    `SELECT id, template_code, title FROM task_instances
     WHERE assignee_id = $1 AND state IN ('released','acknowledged','in_progress','done_reported')
     ORDER BY CASE priority WHEN 'P0' THEN 0 WHEN 'P1' THEN 1 ELSE 2 END, due_at`,
    [userId]);
  return r.rows;
}

async function handleButtonReply(c, contact, buttonText, contextInstanceId) {
  let instanceId = contextInstanceId;
  if (!instanceId) {
    const open = await openTaskForContact(c, contact.user_id);
    if (open.length === 1) instanceId = open[0].id;
  }
  if (!instanceId) return { handled: false, reason: "no unambiguous open task" };

  const map = {
    done: { type: "done_reported", payload: { via: "whatsapp" } },
    problem: { type: "problem_flagged", payload: { via: "whatsapp", reason_code: "other" } },
    skip: { type: "skip_requested", payload: { via: "whatsapp", reason_code: "other" } },
  };
  const action = map[buttonText.toLowerCase()];
  if (!action) return { handled: false };
  await foldEvent(c, {
    event_uuid: randomUUID(), instance_id: instanceId,
    actor_type: "whatsapp", actor_id: contact.user_id,
    type: action.type, payload: action.payload,
  });
  if (action.type === "done_reported") {
    const contactPhone = contact.wa_phone;
    await sendWhatsApp(c, { toPhone: contactPhone, body: { text: "Noted. Send the photo here." }, instanceId });
  }
  return { handled: true, instanceId };
}

async function fetchAndStoreWaMedia(c, contact, mediaId, kind, instanceId) {
  // Media must be fetched within the short-lived URL validity (spec 1.7). Without
  // API credentials the media reference is stored for later manual retrieval.
  const mediaUuid = randomUUID();
  const storageKey = `${mediaUuid}.${kind === "image" ? "jpg" : kind === "video" ? "mp4" : "ogg"}`;
  let stored = false;
  if (config.wa.token) {
    try {
      const meta = await fetch(`https://graph.facebook.com/v20.0/${mediaId}`, {
        headers: { Authorization: `Bearer ${config.wa.token}` },
      }).then((r) => r.json());
      if (meta.url) {
        const bin = await fetch(meta.url, { headers: { Authorization: `Bearer ${config.wa.token}` } });
        const buf = Buffer.from(await bin.arrayBuffer());
        fs.mkdirSync(config.mediaDir, { recursive: true });
        fs.writeFileSync(path.join(config.mediaDir, storageKey), buf);
        stored = true;
      }
    } catch { /* fall through to reference-only */ }
  }
  await c.query(
    `INSERT INTO media_objects (media_uuid, instance_id, kind, status, storage_key, bytes, exif, device_id)
     VALUES ($1,$2,$3,$4,$5,0,$6,NULL)`,
    [mediaUuid, instanceId, kind === "image" ? "photo" : kind, stored ? "stored" : "pending_upload",
     storageKey, { wa_media_id: mediaId }]);
  if (instanceId) {
    await foldEvent(c, {
      event_uuid: randomUUID(), instance_id: instanceId,
      actor_type: "whatsapp", actor_id: contact.user_id,
      type: "media_attached", payload: { media_uuid: mediaUuid, kind: kind === "image" ? "photo" : kind },
    });
  }
  return mediaUuid;
}

// POST: messages and statuses. Idempotent on wa_message_id.
webhooksRouter.post("/whatsapp", async (req, res) => {
  res.status(200).end(); // ack fast; Meta retries on non-200
  const entries = req.body?.entry || [];
  for (const entry of entries) {
    for (const change of entry.changes || []) {
      const value = change.value || {};
      for (const status of value.statuses || []) {
        await q(
          `UPDATE wa_messages SET status = $2, updated_at = now() WHERE wa_message_id = $1`,
          [status.id, status.status]).catch(() => {});
      }
      for (const msg of value.messages || []) {
        try {
          await tx(async (c) => {
            const dup = await c.query(`SELECT 1 FROM wa_messages WHERE wa_message_id = $1`, [msg.id]);
            if (dup.rows.length) return;
            const phone = "+" + msg.from.replace(/^\+/, "");
            const contact = await c.query(`SELECT * FROM wa_contacts WHERE wa_phone = $1 AND allow_listed`, [phone]);
            if (!contact.rows.length) {
              await c.query(
                `INSERT INTO wa_messages (direction, wa_message_id, payload, status)
                 VALUES ('in', $1, $2, 'ignored_not_allowlisted')`, [msg.id, msg]);
              return;
            }
            const ct = contact.rows[0];
            // Every inbound message opens/refreshes the 24h service window (spec 1.7).
            await c.query(
              `UPDATE wa_contacts SET window_open_until = now() + interval '24 hours' WHERE id = $1`, [ct.id]);

            let related = null;
            const contextId = msg.context?.id
              ? (await c.query(`SELECT related_instance_id FROM wa_messages WHERE wa_message_id = $1`, [msg.context.id])).rows[0]?.related_instance_id
              : null;

            if (msg.type === "interactive" || msg.type === "button") {
              const text = msg.interactive?.button_reply?.title || msg.button?.text || "";
              const result = await handleButtonReply(c, ct, text, contextId);
              related = result.instanceId || null;
            } else if (["image", "video", "audio"].includes(msg.type)) {
              let instanceId = contextId;
              if (!instanceId) {
                const open = await openTaskForContact(c, ct.user_id);
                if (open.length === 1) instanceId = open[0].id;
                else if (open.length > 1) {
                  // Ask "which task is this for?" with a list (spec 4.4).
                  await sendWhatsApp(c, {
                    toPhone: ct.wa_phone,
                    body: { text: "Which task is this for?\n" + open.slice(0, 10).map((o, i) => `${i + 1}. ${o.template_code} ${o.title}`).join("\n") },
                  });
                }
              }
              await fetchAndStoreWaMedia(c, ct, msg[msg.type].id, msg.type, instanceId);
              related = instanceId;
            } else if (msg.type === "text") {
              const t = msg.text?.body?.trim().toLowerCase() || "";
              if (["done", "problem", "skip"].includes(t)) {
                const result = await handleButtonReply(c, ct, t, contextId);
                related = result.instanceId || null;
              }
            }

            await c.query(
              `INSERT INTO wa_messages (direction, wa_message_id, contact_id, payload, status, related_instance_id)
               VALUES ('in', $1, $2, $3, 'processed', $4)`,
              [msg.id, ct.id, msg, related]);
          });
        } catch (err) {
          console.error("wa webhook error", err.message);
        }
      }
    }
  }
});

// VIM verdict callback (spec 6.2); identical contract to the in-process consumer.
webhooksRouter.post("/vim", async (req, res) => {
  const { media_uuid, instance_id, verdict, confidence, extracted, model_version } = req.body || {};
  if (!media_uuid || !verdict) return res.status(400).json({ error: "media_uuid and verdict required" });
  try {
    await tx(async (c) => {
      await c.query(
        `UPDATE vim_jobs SET status = 'done', updated_at = now() WHERE media_uuid = $1 AND instance_id = $2`,
        [media_uuid, instance_id]);
      await applyVimVerdict(c, { media_uuid, instance_id, verdict, confidence, extracted, model_version });
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
