// Client persistence (spec 7.2 item 1): IndexedDB object stores plan,
// outbox_events, outbox_media and outbox_decisions (owner / task manager
// decisions made offline), media_cache (evidence photos kept for offline
// review), plus meta for cursors and identity. Capture writes locally first
// and never blocks on network.
import { openDB } from "idb";

export const dbPromise = openDB("woodlands", 2, {
  upgrade(db, oldVersion) {
    if (oldVersion < 1) {
      db.createObjectStore("plan", { keyPath: "id" });
      const ev = db.createObjectStore("outbox_events", { keyPath: "event_uuid" });
      ev.createIndex("by_time", "queued_at");
      const media = db.createObjectStore("outbox_media", { keyPath: "media_uuid" });
      media.createIndex("by_time", "queued_at");
      db.createObjectStore("meta");
    }
    if (oldVersion < 2) {
      const dec = db.createObjectStore("outbox_decisions", { keyPath: "event_uuid" });
      dec.createIndex("by_time", "queued_at");
      const cache = db.createObjectStore("media_cache", { keyPath: "media_uuid" });
      cache.createIndex("by_time", "cached_at");
    }
  },
});

export async function putPlanInstances(instances) {
  const db = await dbPromise;
  const tx = db.transaction("plan", "readwrite");
  for (const inst of instances) await tx.store.put(inst);
  await tx.done;
}

export async function getPlanInstances() {
  const db = await dbPromise;
  return db.getAll("plan");
}

export async function clearPlan() {
  const db = await dbPromise;
  await db.clear("plan");
}

export async function patchInstance(id, patch) {
  const db = await dbPromise;
  const inst = await db.get("plan", id);
  if (!inst) return null;
  const next = { ...inst, ...patch };
  await db.put("plan", next);
  return next;
}

export async function queueEvent(event) {
  const db = await dbPromise;
  await db.put("outbox_events", { ...event, queued_at: Date.now() });
}

export async function pendingEvents() {
  const db = await dbPromise;
  return (await db.getAllFromIndex("outbox_events", "by_time"));
}

export async function removeEvents(uuids) {
  const db = await dbPromise;
  const tx = db.transaction("outbox_events", "readwrite");
  for (const u of uuids) await tx.store.delete(u);
  await tx.done;
}

export async function queueMedia(media) {
  // media: {media_uuid, instance_id, kind, blob, mime, source, title}
  const db = await dbPromise;
  await db.put("outbox_media", { ...media, queued_at: Date.now(), offset: 0, attempts: 0, last_error: null });
}

export async function pendingMedia() {
  const db = await dbPromise;
  return db.getAllFromIndex("outbox_media", "by_time");
}

export async function updateMedia(mediaUuid, patch) {
  const db = await dbPromise;
  const m = await db.get("outbox_media", mediaUuid);
  if (!m) return;
  await db.put("outbox_media", { ...m, ...patch });
}

export async function removeMedia(mediaUuid) {
  const db = await dbPromise;
  await db.delete("outbox_media", mediaUuid);
}

export async function metaGet(key) {
  const db = await dbPromise;
  return db.get("meta", key);
}
export async function metaSet(key, value) {
  const db = await dbPromise;
  await db.put("meta", value, key);
}

export async function outboxCounts() {
  const db = await dbPromise;
  return {
    events: await db.count("outbox_events") + await db.count("outbox_decisions"),
    media: await db.count("outbox_media"),
  };
}

// Decisions made offline: replayed in order with their event_uuid, so a retry
// never double-decides (the server treats a repeated id as a duplicate).
export async function queueDecision(decision) {
  const db = await dbPromise;
  await db.put("outbox_decisions", { ...decision, queued_at: Date.now() });
}
export async function pendingDecisions() {
  const db = await dbPromise;
  return db.getAllFromIndex("outbox_decisions", "by_time");
}
export async function removeDecision(eventUuid) {
  const db = await dbPromise;
  await db.delete("outbox_decisions", eventUuid);
}

// Evidence photos fetched while online, kept for reviewing offline later.
export async function cacheMediaBlob(mediaUuid, blob) {
  const db = await dbPromise;
  await db.put("media_cache", { media_uuid: mediaUuid, blob, cached_at: Date.now() });
  const keys = await db.getAllKeysFromIndex("media_cache", "by_time");
  for (const k of keys.slice(0, Math.max(0, keys.length - 150))) await db.delete("media_cache", k);
}
export async function cachedMediaBlob(mediaUuid) {
  const db = await dbPromise;
  return (await db.get("media_cache", mediaUuid))?.blob || null;
}
