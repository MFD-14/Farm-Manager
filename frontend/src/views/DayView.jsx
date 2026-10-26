// Caretaker home screen (spec 4.1): cards ordered by time and priority,
// colour-coded state, unsynced counter in the top bar. Cards open the capture
// sheet; every flow ends "reported, will sync".
import React, { useEffect, useState, useCallback } from "react";
import { getPlanInstances, metaGet } from "../lib/db.js";
import { pullBundle } from "../lib/sync.js";
import { markSeen } from "../lib/capture.js";
import CaptureSheet from "../components/CaptureSheet.jsx";

const PRIORITY_ORDER = { P0: 0, P1: 1, P2: 2, P3: 3 };
const OPEN_STATES = new Set(["released", "acknowledged", "in_progress"]);
const WAITING_STATES = new Set(["done_reported", "needs_review", "skip_pending", "blocked"]);

function timeOf(inst) {
  return inst.due_at ? new Date(inst.due_at) : null;
}
function fmtTime(d) {
  if (!d) return "";
  return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

// codes narrows the list (Field Walk: the walking and scouting tasks).
export default function DayView({ onCountsChanged, codes, title }) {
  const [instances, setInstances] = useState([]);
  const [active, setActive] = useState(null);
  const [loading, setLoading] = useState(true);
  const [windows, setWindows] = useState([]);

  const refresh = useCallback(async () => {
    let list = await getPlanInstances();
    if (!list.length && navigator.onLine) {
      try { list = await pullBundle(); } catch { /* offline start: cached plan only */ }
    }
    setWindows((await metaGet("active_windows")) || []);
    list.sort((a, b) =>
      (PRIORITY_ORDER[a.priority] ?? 9) - (PRIORITY_ORDER[b.priority] ?? 9) ||
      (timeOf(a)?.getTime() ?? 0) - (timeOf(b)?.getTime() ?? 0));
    setInstances(codes ? list.filter((i) => codes.includes(i.template_code)) : list);
    setLoading(false);
  }, [codes]);

  useEffect(() => {
    refresh();
    const iv = setInterval(refresh, 15_000);
    return () => clearInterval(iv);
  }, [refresh]);

  async function openTask(inst) {
    const seen = await markSeen(inst);
    setActive(seen || inst);
  }

  const open = instances.filter((i) => OPEN_STATES.has(i.state));
  const waiting = instances.filter((i) => WAITING_STATES.has(i.state));
  const closed = instances.filter((i) => !OPEN_STATES.has(i.state) && !WAITING_STATES.has(i.state));

  const today = new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });

  return (
    <div className="wrap">
      <div className="daytitle">{title || today}</div>
      {windows.map((w, i) => (
        <div className="withhold-banner" key={i}>
          <b>{w.type === "phi" ? "Pre-harvest interval" : "Withdrawal"} active</b> · {w.subject_name}
          {" "}until {new Date(w.until).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
          {" "}({w.days_remaining}d left) · {w.product}
        </div>
      ))}
      {loading && <div className="empty">Loading plan…</div>}
      {!loading && !instances.length && codes && <div className="empty">No walks or scouting on the list today.</div>}
      {!loading && !instances.length && !codes && (
        <div className="empty">
          No plan cached yet. Connect once to pull today&apos;s bundle.
          <button className="btn ghost block" onClick={() => pullBundle().then(refresh)}>Retry</button>
        </div>
      )}

      {open.map((inst) => <TaskCard key={inst.id} inst={inst} onOpen={() => openTask(inst)} />)}

      {waiting.length > 0 && <div className="section-title">Reported / waiting</div>}
      {waiting.map((inst) => <TaskCard key={inst.id} inst={inst} onOpen={() => setActive(inst)} />)}

      {closed.length > 0 && <div className="section-title">Finished today</div>}
      {closed.map((inst) => <TaskCard key={inst.id} inst={inst} done />)}

      {active && (
        <CaptureSheet
          instance={active}
          onClose={() => { setActive(null); refresh(); onCountsChanged?.(); }}
        />
      )}
    </div>
  );
}

function TaskCard({ inst, onOpen, done }) {
  const rolled = inst.missed_count > 0 && OPEN_STATES.has(inst.state);
  return (
    <div className={`card ${done ? "done" : ""}`} data-priority={inst.priority} onClick={onOpen}>
      <div className="row">
        <h3>{inst.title}</h3>
        <span className={`chip ${inst.priority}`}>{inst.priority}</span>
      </div>
      <div className="meta">
        <span>{inst.template_code}</span>
        {inst.due_at && <span>due {fmtTime(new Date(inst.due_at))}</span>}
        <span className={`chip state-${inst.state}`}>{inst.state.replaceAll("_", " ")}</span>
        {rolled && <span className="chip yesterday">yesterday</span>}
        {inst.retake_reason && <span className="chip state-needs_review">retake asked</span>}
      </div>
    </div>
  );
}
