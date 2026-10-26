// Farm records that aren't scheduled tasks: harvests, plantings, activities
// (with cost), feed, animal health, breeding, and new fields. Each is a
// farm-level field_recorded event with a `record` payload, so it is written
// offline and synced like everything else. A status change is a later record
// of type "update" pointing at the first one; nothing is ever edited.
import { useCallback, useEffect, useState } from "react";
import { apiJson } from "./api.js";
import { metaGet, metaSet, pendingEvents, queueEvent } from "./db.js";
import { drainOnce } from "./sync.js";

export const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Harare" });

// Days from mating (or setting eggs) to the expected birth or hatch.
export const GESTATION_DAYS = { Cattle: 283, Goat: 150, Pig: 114, Chicken: 21 };

const bed = { k: "location_id", label: "Bed or field", type: "bed", required: true };
const group = { k: "group_id", label: "Animals", type: "group", required: true };
const date = (label = "Date") => ({ k: "date", label, type: "date", required: true, notFuture: true });
const notes = { k: "notes", label: "Notes (optional)", type: "textarea" };

// Field types: text, number (with optional units), date, choice, bed, group, textarea.
export const RECORD_TYPES = {
  planting: { label: "Plant crop", icon: "M12 22V12M12 12C12 7 8 4 3 4c0 5 4 8 9 8zm0 0c0-5 4-8 9-8 0 5-4 8-9 8z",
    fields: [bed, { k: "crop", label: "Crop and variety", type: "text", required: true, placeholder: "e.g. Kale (Covo)" },
      { k: "plants", label: "Plants or seedlings", type: "number" }, date("Planted"),
      { k: "harvest_from", label: "Expected harvest", type: "date" }, notes] },
  harvest: { label: "Log harvest", icon: "M5 21h14M7 21V10l5-6 5 6v11M10 14h4",
    fields: [bed, { k: "crop", label: "Crop", type: "text", required: true },
      { k: "quantity", label: "Quantity", type: "number", required: true, units: ["kg", "bundles", "crates", "bags", "tonnes"] },
      date("Harvest date"), { k: "notes", label: "Quality notes (optional)", type: "textarea" }] },
  activity: { label: "Log activity", icon: "M14.7 6.3a4 4 0 00-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 005.4-5.4l-2.6 2.6-2.4-2.4z",
    fields: [{ ...bed, required: false, label: "Bed or field (optional)" },
      { k: "activity", label: "Activity", type: "choice", required: true,
        options: ["Planting", "Watering", "Fertilising", "Spraying", "Weeding", "Harvesting", "Land clearing", "Maintenance", "Other"] },
      { k: "cost_usd", label: "Cost ($)", type: "number" }, date(), notes] },
  feed: { label: "Log feed", icon: "M4 20h16M6 20V9h12v11M9 9V5h6v4",
    fields: [group, { k: "feed", label: "Feed", type: "choice", required: true,
      options: ["Rehabilitation ration", "Hay", "Grain", "Concentrate", "Lick", "Chick starter", "Growers mash", "Layers mash", "Other"] },
      { k: "quantity", label: "Quantity", type: "number", required: true, units: ["kg", "bags"] },
      { k: "cost_usd", label: "Cost ($)", type: "number" }, date(), notes] },
  health: { label: "Health record", icon: "M12 21s-7-4.4-7-10a4 4 0 017-2.6A4 4 0 0119 11c0 5.6-7 10-7 10z",
    fields: [group, { k: "animal", label: "Animal tag or name (optional)", type: "text" },
      { k: "kind", label: "Type", type: "choice", required: true, options: ["Vaccination", "Treatment", "Illness", "Deworming", "Checkup"] },
      { k: "product", label: "Product and batch (optional)", type: "text" },
      { k: "status", label: "Status", type: "choice", required: true, options: ["Completed", "Ongoing"] }, date(), notes] },
  breeding: { label: "Breeding record", icon: "M12 21a7 7 0 100-14 7 7 0 000 14zM12 7V3M9 3h6",
    fields: [group, { k: "animal", label: "Animal tag or name", type: "text", required: true },
      { k: "species", label: "Species", type: "choice", required: true, options: Object.keys(GESTATION_DAYS) },
      { k: "sire", label: "Sire (optional)", type: "text" }, date("Mated or eggs set"), notes] },
  field: { label: "Add field", console: true, icon: "M3 20l6-12 4 7 3-4 5 9z",
    fields: [{ k: "name", label: "Field name", type: "text", required: true, placeholder: "e.g. North kale bed" },
      { k: "size", label: "Size", type: "number", required: true, units: ["ha", "acres", "m²"], unitKey: "size_unit" },
      { k: "soil", label: "Soil type", type: "choice", options: ["Composted loam", "Loam", "Sandy loam", "Clay", "Other"] },
      { k: "crop", label: "Crop (optional)", type: "text" }] },
};

// Breeding records start as Pregnant (with an expected date); everything else
// keeps the status it was saved with.
export async function saveRecord(record) {
  const r = { ...record };
  if (r.type === "breeding") {
    r.status = "Pregnant";
    const d = new Date(`${r.date}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + GESTATION_DAYS[r.species]);
    r.expected = d.toISOString().slice(0, 10);
  }
  await queueEvent({ event_uuid: crypto.randomUUID(), instance_id: null, type: "field_recorded",
    payload: { record: r }, device_time: new Date().toISOString() });
  drainOnce().catch(() => {});
}

export const updateRecord = (ref, status) => saveRecord({ type: "update", ref, status, date: today() });

// Synced records (cached for offline) plus ones still waiting in the outbox,
// newest first, with any status updates applied.
export function useRecords() {
  const [records, setRecords] = useState(null);
  const refresh = useCallback(async () => {
    const queued = (await pendingEvents()).filter((e) => !e.instance_id && e.payload?.record)
      .map((e) => ({ event_uuid: e.event_uuid, record: e.payload.record, device_time: e.device_time, by: "You", queued: true }));
    let synced = (await metaGet("records_cache")) || [];
    try {
      synced = (await apiJson("/api/sync/notes?kind=record")).notes;
      await metaSet("records_cache", synced);
    } catch { /* offline: cached list stands */ }
    const ids = new Set(queued.map((q) => q.event_uuid));
    const all = [...queued.reverse(), ...synced.filter((s) => !ids.has(s.event_uuid))];
    const updates = all.filter((x) => x.record.type === "update");
    setRecords(all.filter((x) => x.record.type !== "update").map((x) => {
      const u = updates.find((v) => v.record.ref === x.event_uuid); // newest first
      return u ? { ...x, record: { ...x.record, status: u.record.status, status_on: u.record.date } } : x;
    }));
  }, []);
  useEffect(() => { refresh(); }, [refresh]);
  return { records, refresh };
}
