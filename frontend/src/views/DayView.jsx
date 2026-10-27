// Caretaker home screen (spec 4.1): cards ordered by time and priority,
// colour-coded state, unsynced counter in the top bar. Cards open the capture
// sheet; every flow ends "reported, will sync".
import React, { useEffect, useState, useCallback } from "react";
import { getPlanInstances, metaGet } from "../lib/db.js";
import { pullBundle } from "../lib/sync.js";
import { apiJson, errorMessage } from "../lib/api.js";
import { markSeen } from "../lib/capture.js";
import CaptureSheet from "../components/CaptureSheet.jsx";
import RecordForm, { AddSheet } from "../components/RecordForm.jsx";
import { RECORD_TYPES } from "../lib/records.js";
import SheetClose from "../components/SheetClose.jsx";

const PRIORITY_ORDER = { P0: 0, P1: 1, P2: 2, P3: 3 };
const OPEN_STATES = new Set(["released", "acknowledged", "in_progress"]);
const WAITING_STATES = new Set(["done_reported", "needs_review", "skip_pending", "blocked"]);

function timeOf(inst) {
  return inst.due_at ? new Date(inst.due_at) : null;
}
function fmtTime(d) {
  if (!d) return "";
  return d.toLocaleTimeString("en-GB", { timeZone: "Africa/Harare", hour: "2-digit", minute: "2-digit" });
}

// codes narrows the list (Field Walk: the walking and scouting tasks).
// The + button opens the add sheet: a note or a farm record (harvest,
// planting, activity, feed, health, breeding) for everyone; releasing an
// unscheduled task or adding a field for owners and task managers.
// showCodes: owners and task managers see task codes and priorities; the
// caretaker sees plain words (Urgent, Late, Waiting) only when they matter.
export default function DayView({ onCountsChanged, codes, title, onAddNote, canAddTask, children, showCodes }) {
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState(null);
  const [templates, setTemplates] = useState(null);
  const [addMsg, setAddMsg] = useState(null);
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
    // By time of day (grouped Morning / Midday / Afternoon below), then priority.
    list.sort((a, b) => (timeOf(a)?.getTime() ?? 0) - (timeOf(b)?.getTime() ?? 0) ||
      (PRIORITY_ORDER[a.priority] ?? 9) - (PRIORITY_ORDER[b.priority] ?? 9));
    setInstances(codes ? list.filter((i) => codes.includes(i.template_code)) : list);
    setLoading(false);
  }, [codes]);

  useEffect(() => {
    refresh();
    const iv = setInterval(refresh, 15_000);
    return () => clearInterval(iv);
  }, [refresh]);

  async function pickTemplate() {
    setAddMsg(null);
    try {
      setTemplates((await apiJson("/api/templates")).templates.filter((t) => !t.schedule));
    } catch (e) { alert(errorMessage(e, "Adding a task needs signal.")); }
  }
  async function addTask(code) {
    try {
      await apiJson("/api/owner/release-task", { method: "POST", body: { template_code: code } });
      setTemplates(null);
      await pullBundle(); refresh();
    } catch (e) { setAddMsg(errorMessage(e)); }
  }

  async function openTask(inst) {
    const seen = await markSeen(inst);
    setActive(seen || inst);
  }

  const open = instances.filter((i) => OPEN_STATES.has(i.state));
  const waiting = instances.filter((i) => WAITING_STATES.has(i.state));
  const closed = instances.filter((i) => !OPEN_STATES.has(i.state) && !WAITING_STATES.has(i.state));

  const today = new Date().toLocaleDateString("en-GB", { timeZone: "Africa/Harare", weekday: "long", day: "numeric", month: "long" });
  const doneCount = waiting.length + closed.length;
  const dueSoFar = instances.filter((i) => !OPEN_STATES.has(i.state) || (timeOf(i) && timeOf(i) <= new Date())).length;
  const groups = PARTS.map(([label, from, to]) => [label, open.filter((i) => { const h = farmHour(i); return h >= from && h < to; })]).filter(([, l]) => l.length);

  return (
    <div className="wrap">
      <div className="daytitle">{title || today}</div>
      {children}
      {windows.map((w, i) => (
        <div className="withhold-banner" key={i}>
          <b>{w.type === "phi" ? "Pre-harvest interval" : "Withdrawal"} active</b> · {w.subject_name}
          {" "}until {new Date(w.until).toLocaleDateString("en-GB", { timeZone: "Africa/Harare", day: "numeric", month: "short" })}
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

      {instances.length > 0 && (
        <div className="progress" role="status">
          <b>{doneCount} of {instances.length} done</b> <span>· {dueSoFar} due so far</span>
          <div className="bar"><div style={{ width: `${Math.round((doneCount / instances.length) * 100)}%` }} /></div>
        </div>
      )}
      {groups.map(([label, list]) => (
        <React.Fragment key={label}>
          <div className="section-title">{label} · {list.length}</div>
          {list.map((inst) => <TaskCard key={inst.id} inst={inst} showCodes={showCodes} onOpen={() => openTask(inst)} />)}
        </React.Fragment>
      ))}

      {waiting.length > 0 && <div className="section-title">Reported, waiting · {waiting.length}</div>}
      {waiting.map((inst) => <TaskCard key={inst.id} inst={inst} showCodes={showCodes} onOpen={() => setActive(inst)} />)}

      {closed.length > 0 && <div className="section-title">Finished today · {closed.length}</div>}
      {closed.map((inst) => <TaskCard key={inst.id} inst={inst} showCodes={showCodes} done />)}

      {onAddNote && (
        <>
          {adding && (
            <AddSheet onClose={() => setAdding(false)}
              items={[...(canAddTask ? [{ key: "task", label: "Add task", icon: "M9 11l3 3L22 4M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" }] : []),
                { key: "note", label: "Add note", icon: "M11 4H4v16h16v-7M18.5 2.5a2.1 2.1 0 013 3L12 15l-4 1 1-4z" },
                ...Object.entries(RECORD_TYPES).filter(([, d]) => canAddTask || !d.console).map(([key, d]) => ({ key, label: d.label, icon: d.icon }))]}
              onPick={(key) => { setAdding(false); if (key === "task") pickTemplate(); else if (key === "note") onAddNote(); else setForm(key); }} />
          )}
          {form && <RecordForm type={form} onClose={(saved) => { setForm(null); if (saved) onCountsChanged?.(); }} />}
          <button type="button" className="fab" aria-label="Add" onClick={() => setAdding(true)}>+</button>
        </>
      )}
      {templates && (
        <div className="sheet" onClick={() => setTemplates(null)}>
          <div className="panel" onClick={(e) => e.stopPropagation()}>
            <SheetClose onClose={() => setTemplates(null)} />
            <h2>Add a task</h2>
            {addMsg && <p className="form-msg bad">{addMsg}</p>}
            {templates.map((t) => (
              <button type="button" key={t.code} className="btn ghost block" onClick={() => addTask(t.code)}>{t.code} {t.title}</button>
            ))}
          </div>
        </div>
      )}
      {active && (
        <CaptureSheet
          instance={active}
          showCodes={showCodes}
          onClose={() => { setActive(null); refresh(); onCountsChanged?.(); }}
        />
      )}
    </div>
  );
}

const PARTS = [["Morning", 0, 11], ["Midday", 11, 14], ["Afternoon and evening", 14, 24]];
const farmHour = (i) => (i.due_at ? Number(new Date(i.due_at).toLocaleString("en-GB", { timeZone: "Africa/Harare", hour: "2-digit", hour12: false })) % 24 : 6);
// Plain words for the states a person needs to act on or know about; none for "to do".
const STATE_WORDS = { done_reported: "Reported", needs_review: "Waiting for check", skip_pending: "Skip asked", blocked: "Problem reported",
  verified_closed: "Done", skipped: "Skipped", missed: "Missed" };

function TaskCard({ inst, onOpen, done, showCodes }) {
  const rolled = inst.missed_count > 0 && OPEN_STATES.has(inst.state);
  const late = OPEN_STATES.has(inst.state) && inst.due_at && new Date(inst.due_at) < new Date();
  // "Late" says it for overdue work; "Urgent" only marks emergencies (P0).
  const urgent = inst.priority === "P0";
  return (
    <div className={`card ${done ? "done" : ""} ${onOpen ? "tap" : ""}`} data-priority={inst.priority} onClick={onOpen}
      role={onOpen ? "button" : undefined} tabIndex={onOpen ? 0 : undefined} onKeyDown={(e) => onOpen && e.key === "Enter" && onOpen()}>
      <div className="row">
        <h3>{inst.title}</h3>
        {showCodes ? <span className={`chip ${inst.priority}`}>{inst.priority}</span> : urgent && <span className="chip urgent">Urgent</span>}
      </div>
      <div className="meta">
        {showCodes && <span>{inst.template_code}</span>}
        {inst.due_at && <span>due {fmtTime(new Date(inst.due_at))}</span>}
        {late && <span className="chip late">Late</span>}
        {STATE_WORDS[inst.state] && <span className={`chip state-${inst.state}`}>{STATE_WORDS[inst.state]}</span>}
        {rolled && <span className="chip yesterday">yesterday</span>}
        {inst.retake_reason && <span className="chip state-needs_review">retake asked</span>}
      </div>
    </div>
  );
}
