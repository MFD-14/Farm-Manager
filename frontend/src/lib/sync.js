// The outbox drain (spec 5.3): tiny events on any bearer, batched, idempotent,
// FIFO with retry and backoff; media resumable in offset chunks. The drain runs
// on connectivity events, on an interval, and after every capture.
import { api, apiJson } from "./api.js";
import {
  pendingEvents, removeEvents, pendingMedia, updateMedia, removeMedia,
  putPlanInstances, metaGet, metaSet, pendingDecisions, removeDecision,
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

    // 2. Decisions made offline by an owner or task manager.
    await drainDecisions();

    // 3. Media queue: resumable chunks, P0/P1 jump the queue (spec 5.3). Each
    // file succeeds or fails on its own, with its error kept for the uploads
    // screen; videos can be held for Wi-Fi.
    const media = await pendingMedia();
    media.sort((a, b) => (b.urgent ? 1 : 0) - (a.urgent ? 1 : 0) || a.queued_at - b.queued_at);
    const wifiOnlyVideo = (await metaGet("video_wifi_only")) === true;
    let failures = 0;
    for (const m of media.slice(0, 5)) {
      if (m.kind === "video" && wifiOnlyVideo && onCellular()) continue;
      try {
        await uploadMedia(m);
      } catch (err) {
        failures += 1;
        await updateMedia(m.media_uuid, { attempts: (m.attempts || 0) + 1, last_error: describe(err), last_try: Date.now() });
      }
    }
    if (failures) throw new Error("some uploads failed");
    await metaSet("last_sync_ok", new Date().toISOString());
    backoffMs = 2000;
  } catch (err) {
    backoffMs = Math.min(backoffMs * 2, 5 * 60_000);
  } finally {
    draining = false;
    emit({ syncing: false });
  }
}

const onCellular = () => navigator.connection?.type === "cellular";
function describe(err) {
  if (!navigator.onLine) return "No connection";
  if (err?.status === 401) return "Signed out; sign in again";
  if (err?.status === 413) return "File too large for the server";
  if (err?.status) return `Server said ${err.status}`;
  return "Connection dropped; will resume";
}

async function drainDecisions() {
  for (const d of await pendingDecisions()) {
    try {
      await apiJson(`/api/instances/${d.instance_id}/decision`, {
        method: "POST", body: { action: d.action, note: d.note, event_uuid: d.event_uuid },
      });
      await removeDecision(d.event_uuid);
    } catch (err) {
      if (err.status === 400 || err.status === 409) {
        // Someone decided first, or the task moved on: keep a note, drop the item.
        const conflicts = (await metaGet("decision_conflicts")) || [];
        let reason = err.message;
        try { reason = JSON.parse(err.message).error || reason; } catch { /* plain */ }
        conflicts.unshift({ ...d, reason, at: new Date().toISOString() });
        await metaSet("decision_conflicts", conflicts.slice(0, 20));
        await removeDecision(d.event_uuid);
      } else {
        throw err; // offline or server down: keep queued, retry with backoff
      }
    }
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
    if (e.type === "rejected_reopened") {
      await patchInstance(e.instance_id, { retake_reason: e.payload?.note || "sent back, please redo it", local_done: false });
    }
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
      bytes: m.blob.size, captured_at: m.captured_at, mime: m.blob.type || m.mime || null,
      exif: { source: m.source || "camera", file_modified: m.file_modified || null },
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
    await updateMedia(m.media_uuid, { offset, last_error: null });
    emit({ syncing: true, upload: { media_uuid: m.media_uuid, offset, size: buf.byteLength } });
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

// "Sync now" / per-file "Retry": try immediately, ignoring backoff.
export async function syncNow() {
  backoffMs = 2000;
  await drainOnce();
}

export function startSyncLoop() {
  const tick = () => drainOnce().catch(() => {});
  window.addEventListener("online", tick);
  setInterval(tick, 30_000);
  tick();
}
