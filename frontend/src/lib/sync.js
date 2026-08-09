// The outbox drain (spec 5.3): tiny events on any bearer, batched, idempotent,
// FIFO with retry and backoff; media resumable in offset chunks. The drain runs
// on connectivity events, on an interval, and after every capture.
import { api, apiJson } from "./api.js";
import {
  pendingEvents, removeEvents, pendingMedia, updateMedia, removeMedia,
  putPlanInstances, metaGet, metaSet,
} from "./db.js";

let draining = false;
let backoffMs = 2000;
const listeners = new Set();

export function onSyncState(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function emit(state) {
  for (const fn of listeners) fn(state);
}

export async function drainOnce() {
  if (draining || !navigator.onLine) return;
  draining = true;
  emit({ syncing: true });
  try {
    // 1. Events, batched FIFO.
    const events = await pendingEvents();
    if (events.length) {
      const deviceId = await metaGet("device_id");
      const cursor = await metaGet("cursor");
      const body = {
        device_id: deviceId,
        device_now: new Date().toISOString(),
        cursor,
        events: events.slice(0, 100).map(({ queued_at, ...e }) => e),
      };
      const result = await apiJson("/api/sync/events", { method: "POST", body });
      const settled = [...result.accepted, ...result.duplicates,
        ...result.rejected.map((r) => r.event_uuid)].filter(Boolean);
      await removeEvents(settled);
      if (result.cursor) await metaSet("cursor", result.cursor);
      // Mirror server-side state changes into the cached plan.
      await applyServerEvents(result.server_events || []);
    }

    // 2. Media queue: resumable chunks, P0/P1 jump the queue (spec 5.3).
    const media = await pendingMedia();
    media.sort((a, b) => (b.urgent ? 1 : 0) - (a.urgent ? 1 : 0) || a.queued_at - b.queued_at);
    for (const m of media.slice(0, 3)) {
      await uploadMedia(m);
    }
    backoffMs = 2000;
  } catch (err) {
    backoffMs = Math.min(backoffMs * 2, 5 * 60_000);
  } finally {
    draining = false;
    emit({ syncing: false });
  }
}

async function applyServerEvents(serverEvents) {
  const { patchInstance } = await import("./db.js");
  const stateMap = {
    auto_verified: "verified_closed", verified_closed: "verified_closed",
    review_required: "needs_review", rejected_reopened: "released",
    skip_approved: "skipped", skip_denied: "released", expired: "expired",
    cancelled: "cancelled", missed: "missed", rolled: "released",
    retake_requested: null, released: "released", unblocked: "released",
  };
  for (const e of serverEvents) {
    if (!e.instance_id) continue;
    const next = stateMap[e.type];
    if (next) await patchInstance(e.instance_id, { state: next });
    if (e.type === "retake_requested") {
      await patchInstance(e.instance_id, { retake_reason: e.payload?.reason || "please retake the photo" });
    }
  }
}

async function uploadMedia(m) {
  const init = await apiJson("/api/media/initiate", {
    method: "POST",
    body: {
      media_uuid: m.media_uuid, instance_id: m.instance_id, kind: m.kind,
      bytes: m.blob.size, captured_at: m.captured_at,
    },
  });
  let offset = init.offset || 0;
  const chunkSize = init.chunk_size || 256 * 1024;
  const buf = await m.blob.arrayBuffer();
  while (offset < buf.byteLength) {
    const chunk = buf.slice(offset, offset + chunkSize);
    const resp = await api(`/api/media/${m.media_uuid}`, {
      method: "PATCH", raw: true, body: chunk,
      headers: { "Upload-Offset": String(offset), "Content-Type": "application/offset+octet-stream" },
    });
    const serverOffset = resp.headers.get("Upload-Offset");
    offset = serverOffset ? parseInt(serverOffset, 10) : offset + chunk.byteLength;
    await updateMedia(m.media_uuid, { offset });
  }
  await apiJson(`/api/media/${m.media_uuid}/complete`, { method: "POST" });
  await removeMedia(m.media_uuid);
}

// Pull the day bundle (R20): one cacheable response with the whole plan.
export async function pullBundle() {
  const bundle = await apiJson("/api/sync/bundle");
  const instances = [
    ...(bundle.plan?.instances || []),
    ...(bundle.open_instances || []),
  ];
  // De-dup by id, plan order first.
  const seen = new Set();
  const merged = instances.filter((i) => (seen.has(i.id) ? false : (seen.add(i.id), true)));
  await putPlanInstances(merged);
  await metaSet("reference", bundle.reference_delta);
  await metaSet("bundle_date", bundle.date);
  await metaSet("active_windows", bundle.active_windows || []);
  await metaSet("last_values", bundle.last_values || {});
  return merged;
}

export function startSyncLoop() {
  const tick = () => drainOnce().catch(() => {});
  window.addEventListener("online", tick);
  setInterval(tick, 30_000);
  tick();
}
