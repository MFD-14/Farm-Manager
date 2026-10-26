// Resumable media pipeline (spec 6.2, 7.2 item 3): initiate, offset-based chunk
// PATCH (308 on partial); complete re-runs verification routing so a task whose
// evidence just finished uploading moves to the acceptance queue. Files land on disk
// under MEDIA_DIR; the storage key is recorded so object storage can replace the
// filesystem without touching callers.
import { Router } from "express";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { q, tx } from "../db/pool.js";
import { auth } from "../middleware/auth.js";
import { routeAfterDoneReported } from "../engine/verification.js";
import { validateEvidence } from "../engine/evidence.js";
import { config } from "../config.js";

export const mediaRouter = Router();

const mediaPath = (key) => path.join(config.mediaDir, key);
const MIME_EXT = {
  "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/heic": "heic",
  "video/mp4": "mp4", "video/webm": "webm", "video/3gpp": "3gp", "video/quicktime": "mov",
  "audio/webm": "webm", "audio/ogg": "ogg", "audio/mp4": "m4a", "audio/mpeg": "mp3", "audio/aac": "aac", "audio/amr": "amr",
};
fs.mkdirSync(config.mediaDir, { recursive: true });

// Perceptual-hash stand-in: sha256 over the raw bytes plus a coarse byte histogram
// hash. Catches exact and near-exact re-submissions (spec 5.1); a true pHash slots
// in here when an image library is added.
function computeHashes(buf) {
  const sha256 = crypto.createHash("sha256").update(buf).digest("hex");
  const hist = new Array(64).fill(0);
  for (let i = 0; i < buf.length; i += 97) hist[buf[i] >> 2]++;
  const phash = crypto.createHash("md5").update(hist.map((h) => Math.round(h / (buf.length / 970 + 1))).join(",")).digest("hex").slice(0, 16);
  return { sha256, phash };
}

mediaRouter.post("/initiate", auth(), async (req, res) => {
  const { media_uuid, instance_id, kind = "photo", bytes, sha256, captured_at, gps, exif, mime } = req.body || {};
  if (!media_uuid || !bytes) return res.status(400).json({ error: "media_uuid and bytes required" });
  if (!["photo", "video", "audio"].includes(kind)) return res.status(400).json({ error: "kind must be photo, video or audio" });
  // The file keeps its real format (gallery videos, phone voice notes) so it
  // plays back from off site.
  const ext = MIME_EXT[String(mime || "").split(";")[0]] || (kind === "photo" ? "jpg" : kind === "video" ? "mp4" : "ogg");
  const storageKey = `${media_uuid}.${ext}`;
  await q(
    `INSERT INTO media_objects (media_uuid, instance_id, event_uuid, kind, status, storage_key, bytes, sha256, captured_at, gps, exif, device_id)
     VALUES ($1,$2,NULL,$3,'uploading',$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT (media_uuid) DO UPDATE SET updated_at = now()`,
    [media_uuid, instance_id || null, kind, storageKey, bytes, sha256 || null,
     captured_at || null, gps || null, exif || {}, req.user.deviceId]);
  const existing = await q(`SELECT received_bytes FROM media_objects WHERE media_uuid = $1`, [media_uuid]);
  res.json({ upload_id: media_uuid, chunk_size: 256 * 1024, offset: Number(existing.rows[0]?.received_bytes || 0) });
});

// PATCH raw chunk at Upload-Offset; 308 with current offset on mismatch/partial.
mediaRouter.patch("/:uploadId", auth(), async (req, res) => {
  const { uploadId } = req.params;
  const offset = parseInt(req.headers["upload-offset"] || "0", 10);
  const m = await q(`SELECT * FROM media_objects WHERE media_uuid = $1`, [uploadId]);
  if (!m.rows.length) return res.status(404).json({ error: "unknown upload" });
  const row = m.rows[0];
  const current = Number(row.received_bytes);
  if (offset !== current) {
    res.set("Upload-Offset", String(current));
    return res.status(308).end();
  }
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const buf = Buffer.concat(chunks);
  const file = mediaPath(row.storage_key);
  fs.appendFileSync(file, buf);
  const newOffset = current + buf.length;
  await q(`UPDATE media_objects SET received_bytes = $2, updated_at = now() WHERE media_uuid = $1`, [uploadId, newOffset]);
  res.set("Upload-Offset", String(newOffset));
  if (newOffset < Number(row.bytes)) return res.status(308).end();
  res.status(204).end();
});

mediaRouter.post("/:uploadId/complete", auth(), async (req, res) => {
  const { uploadId } = req.params;
  const m = await q(`SELECT * FROM media_objects WHERE media_uuid = $1`, [uploadId]);
  if (!m.rows.length) return res.status(404).json({ error: "unknown upload" });
  const row = m.rows[0];
  const file = mediaPath(row.storage_key);
  if (!fs.existsSync(file)) return res.status(400).json({ error: "no bytes uploaded" });
  const buf = fs.readFileSync(file);
  const { sha256, phash } = computeHashes(buf);

  // pHash re-submission check over the last 60 days (spec 5.1): match routes the
  // task to needs_review rather than auto-rejecting.
  const dupe = await q(
    `SELECT media_uuid, instance_id FROM media_objects
     WHERE phash = $1 AND media_uuid <> $2 AND created_at >= now() - interval '60 days' LIMIT 1`,
    [phash, uploadId]);

  await q(
    `UPDATE media_objects SET status = 'stored', sha256 = $2, phash = $3, bytes = $4, updated_at = now()
     WHERE media_uuid = $1`, [uploadId, sha256, phash, buf.length]);

  if (row.instance_id) {
    await tx(async (c) => {
      const inst = await c.query(`SELECT * FROM task_instances WHERE id = $1 FOR UPDATE`, [row.instance_id]);
      if (!inst.rows.length) return;
      const instance = inst.rows[0];

      if (dupe.rows.length && instance.state === "done_reported") {
        const { foldEvent } = await import("../engine/fold.js");
        await foldEvent(c, {
          event_uuid: crypto.randomUUID(), instance_id: instance.id, actor_type: "system",
          type: "review_required",
          payload: { flags: [{ kind: "phash_match", matched: dupe.rows[0].media_uuid }] },
        });
        return;
      }

      // Deferred media (spec 5.3): now that the blob exists, re-run verification routing.
      if (instance.state === "done_reported") {
        const policy = instance.params?.evidence_policy_resolved ||
          (await c.query(`SELECT evidence_policy FROM task_templates WHERE id = $1`, [instance.template_id])).rows[0]?.evidence_policy || {};
        const check = validateEvidence(policy, instance.evidence_summary || {});
        await routeAfterDoneReported(c, instance, policy, check, {
          event_uuid: uploadId, device_time: row.captured_at, device_id: row.device_id,
        });
      }
    });
  }
  res.json({ stored: true, sha256, phash, phash_match: dupe.rows.length > 0 });
});

// Serve stored media to the owner app.
mediaRouter.get("/:mediaUuid", auth(), async (req, res) => {
  const m = await q(`SELECT * FROM media_objects WHERE media_uuid = $1 AND status = 'stored'`, [req.params.mediaUuid]);
  if (!m.rows.length) return res.status(404).end();
  res.sendFile(path.resolve(mediaPath(m.rows[0].storage_key)));
});
