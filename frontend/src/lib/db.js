// Client persistence (spec 7.2 item 1): IndexedDB with three object stores —
// plan, outbox_events, outbox_media — plus meta for cursors and identity.
// Capture writes locally first and never blocks on network.
import { openDB } from "idb";

export const dbPromise = openDB("woodlands", 1, {
  upgrade(db) {
    db.createObjectStore("plan", { keyPath: "id" });
    const ev = db.createObjectStore("outbox_events", { keyPath: "event_uuid" });
    ev.createIndex("by_time", "queued_at");
    const media = db.createObjectStore("outbox_media", { keyPath: "media_uuid" });
    media.createIndex("by_time", "queued_at");
    db.createObjectStore("meta");
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
  // media: {media_uuid, instance_id, kind, blob, queued_at}
  const db = await dbPromise;
  await db.put("outbox_media", { ...media, queued_at: Date.now(), offset: 0 });
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
    events: await db.count("outbox_events"),
    media: await db.count("outbox_media"),
  };
}
