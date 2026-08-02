// Capture actions: every submit writes locally first (event + optional media into
// the outbox), flips the card, then tries to drain. Never blocks on network.
import { queueEvent, queueMedia, patchInstance } from "./db.js";
import { drainOnce } from "./sync.js";

const uuid = () => crypto.randomUUID();

async function append(instanceId, type, payload = {}) {
  await queueEvent({
    event_uuid: uuid(),
    instance_id: instanceId,
    type,
    payload,
    device_time: new Date().toISOString(),
  });
  drainOnce().catch(() => {});
}

export async function markSeen(instance) {
  if (instance.state !== "released") return instance;
  const next = await patchInstance(instance.id, { state: "acknowledged" });
  await append(instance.id, "seen");
  return next;
}

export async function reportDone(instance, { fields = {}, mediaItems = [], urgent = false }) {
  for (const m of mediaItems) {
    await queueMedia({
      media_uuid: m.media_uuid, instance_id: instance.id, kind: m.kind,
      blob: m.blob, captured_at: new Date().toISOString(),
      urgent: urgent || ["P0", "P1"].includes(instance.priority),
    });
    await append(instance.id, "media_attached", { media_uuid: m.media_uuid, kind: m.kind });
  }
  if (Object.keys(fields).length) {
    await append(instance.id, "field_recorded", { fields });
  }
  await append(instance.id, "done_reported", { fields });
  return patchInstance(instance.id, { state: "done_reported", local_done: true });
}

export async function requestSkip(instance, reasonCode, note) {
  await append(instance.id, "skip_requested", { reason_code: reasonCode, note: note || null });
  return patchInstance(instance.id, { state: "skip_pending" });
}

export async function flagProblem(instance, reasonCode, note, voiceItem) {
  if (voiceItem) {
    await queueMedia({
      media_uuid: voiceItem.media_uuid, instance_id: instance.id, kind: "audio",
      blob: voiceItem.blob, captured_at: new Date().toISOString(), urgent: true,
    });
    await append(instance.id, "media_attached", { media_uuid: voiceItem.media_uuid, kind: "audio" });
  }
  await append(instance.id, "problem_flagged", { reason_code: reasonCode, note: note || null });
  return patchInstance(instance.id, { state: "blocked" });
}

export const SKIP_REASONS = ["no water", "no input in stock", "rain", "sick", "other"];

// Client-side evidence gate (spec 5.1): the Done button stays disabled until the
// policy is satisfiable from what has been captured.
export function evidenceReady(policy, { fields = {}, photos = 0, videos = 0, voices = 0 }) {
  if (!policy?.classes?.length) return true;
  if (policy.any_of) {
    return policy.any_of.some((cls) =>
      (cls === "E2" && photos >= 1) || (cls === "E5" && voices >= 1) || (cls === "E4" && videos >= 1));
  }
  if (policy.classes.includes("E1")) {
    for (const f of policy.fields || []) {
      const v = fields[f.key];
      if (v === undefined || v === null || v === "") return false;
      if (f.type === "number") {
        const n = Number(v);
        if (Number.isNaN(n) || (f.min !== undefined && n < f.min) || (f.max !== undefined && n > f.max)) return false;
      }
    }
  }
  if (policy.classes.includes("E2") && photos < (policy.photo_min ?? 1)) return false;
  if (policy.classes.includes("E3") && photos < (policy.photo_min ?? 2)) return false;
  if (policy.classes.includes("E4") && videos < (policy.video_min ?? 1)) return false;
  if (policy.classes.includes("E5") && voices < (policy.voice_min ?? 1)) return false;
  return true;
}

// Compress a captured photo toward the 150-250 KB budget at 1280 px (spec 5.3),
// stamping task code and datetime onto the image (spec 5.1).
export async function compressAndStamp(file, { taskCode }) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1280 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const stamp = `${taskCode}  ${new Date().toISOString().slice(0, 16).replace("T", " ")}`;
  ctx.font = `${Math.max(14, Math.round(canvas.width / 40))}px monospace`;
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  const pad = 8;
  const w = ctx.measureText(stamp).width + pad * 2;
  ctx.fillRect(0, canvas.height - 30, w, 30);
  ctx.fillStyle = "#ffffff";
  ctx.fillText(stamp, pad, canvas.height - 10);
  const blob = await new Promise((res) => canvas.toBlob(res, "image/jpeg", 0.7));
  return blob;
}
