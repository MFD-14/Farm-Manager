// Clock in and out for Time & Attendance. Each tap is a farm-level record in
// the outbox, so it works with no signal; the list shows everyone's recent
// entries (cached for offline reading).
import React, { useEffect, useState, useCallback } from "react";
import { apiJson } from "../lib/api.js";
import { metaGet, metaSet, pendingEvents } from "../lib/db.js";
import { clockInOut } from "../lib/capture.js";

const at = (t) => new Date(t).toLocaleString("en-GB", { timeZone: "Africa/Harare", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export default function ClockCard({ user, onCountsChanged }) {
  const [entries, setEntries] = useState([]);

  const refresh = useCallback(async () => {
    const queued = (await pendingEvents()).filter((e) => !e.instance_id && e.payload?.clock)
      .map((e) => ({ event_uuid: e.event_uuid, clock: e.payload.clock, device_time: e.device_time, by: user.name, queued: true }));
    let synced = (await metaGet("clock_cache")) || [];
    try {
      synced = (await apiJson("/api/sync/notes?kind=clock")).notes;
      await metaSet("clock_cache", synced);
    } catch { /* offline: cached list stands */ }
    const ids = new Set(queued.map((e) => e.event_uuid));
    setEntries([...queued.reverse(), ...synced.filter((e) => !ids.has(e.event_uuid))]);
  }, [user.name]);
  useEffect(() => { refresh(); }, [refresh]);

  const mine = entries.find((e) => e.by === user.name);
  const isIn = mine?.clock === "in";

  async function tap() {
    await clockInOut(isIn ? "out" : "in");
    onCountsChanged?.();
    refresh();
  }

  return (
    <>
      <div className="card">
        <div className="row">
          <h3>{isIn ? `Clocked in since ${at(mine.device_time || mine.server_time)}` : "Clocked out"}</h3>
        </div>
        <button type="button" className={`btn block ${isIn ? "ghost" : "primary"}`} onClick={tap}>{isIn ? "Clock out" : "Clock in"}</button>
      </div>
      {entries.slice(0, 20).map((e) => (
        <div className="kv" key={e.event_uuid}>
          <span>{e.by || "Someone"} · clocked {e.clock}{e.queued ? " (waiting to sync)" : ""}</span>
          <b>{at(e.device_time || e.server_time)}</b>
        </div>
      ))}
      <div className="section-title">Weekly attendance sheets (F-02)</div>
    </>
  );
}
