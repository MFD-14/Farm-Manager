// Scaling plan, July 2026 to June 2027 (owners and task managers): each
// milestone with progress computed from farm data, the project steps behind
// Phase 0 and the reticulation upgrade (released from here), and the poultry
// placement calendar. Cached for offline viewing.
import React, { useEffect, useState } from "react";
import { apiJson, errorMessage } from "../lib/api.js";
import { metaGet, metaSet } from "../lib/db.js";

const STATUS = {
  done: ["Done", "state-verified_closed"], on_track: ["On track", "state-released"], behind: ["Behind", "P1"],
  not_started: ["Not started", "P3"], blocked: ["Blocked", "P1"],
};
const fmt = (d) => (d ? new Date(`${d}T12:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "");

export default function PlanSection() {
  const [plan, setPlan] = useState(null);
  const [allowed, setAllowed] = useState(true);
  const [open, setOpen] = useState(null);
  const [msg, setMsg] = useState(null);

  async function load() {
    try {
      const p = await apiJson("/api/owner/plan");
      setPlan(p);
      await metaSet("plan_cache", p);
    } catch (e) {
      if (e.status === 403) { setAllowed(false); return; }
      const cached = await metaGet("plan_cache");
      if (cached) setPlan(cached);
    }
  }
  useEffect(() => { load(); }, []);

  async function mark(key, status) {
    setMsg(null);
    try { setPlan(await apiJson(`/api/owner/plan/${key}`, { method: "POST", body: { status } })); } catch (e) { setMsg(errorMessage(e)); }
  }
  async function release(code, title) {
    setMsg(null);
    try {
      await apiJson("/api/owner/release-task", { method: "POST", body: { template_code: code } });
      setMsg(`Released: ${title}. It's on the caretaker's list now.`);
      load();
    } catch (e) { setMsg(errorMessage(e)); }
  }

  if (!allowed || !plan) return null;
  return (
    <>
      <div className="section-title">Scaling plan · {fmt(plan.from)} to {fmt(plan.to)}</div>
      {msg && <p className="form-msg good">{msg}</p>}
      {plan.milestones.map((m) => {
        const [label, chip] = STATUS[m.status] || STATUS.not_started;
        const steps = m.project ? plan.projects?.[m.project] : null;
        return (
          <div className="card milestone" key={m.key}>
            <div className="milestone-head">
              <b>{m.title}</b>
              <span className={`chip ${chip}`}>{label}</span>
            </div>
            <div className="upload-bar"><div style={{ width: `${Math.round(m.progress * 100)}%` }} /></div>
            <div className="milestone-meta">{m.detail}</div>
            <div className="milestone-meta">Target {fmt(m.target)}{m.manual ? ` · marked ${m.manual} by hand` : ""}</div>
            <div className="person-actions">
              {steps && <button type="button" className="btn ghost" onClick={() => setOpen(open === m.key ? null : m.key)}>
                {open === m.key ? "Hide steps" : "Steps"}</button>}
              {m.status !== "done" && <button type="button" className="btn ghost" onClick={() => mark(m.key, "done")}>Mark done</button>}
              {m.manual ? <button type="button" className="btn ghost" onClick={() => mark(m.key, "auto")}>Undo</button>
                : m.status !== "done" && <button type="button" className="btn ghost" onClick={() => mark(m.key, "blocked")}>Blocked</button>}
            </div>
            {open === m.key && steps && (
              <div className="steps">
                {steps.map((s) => (
                  <div className="step" key={s.code}>
                    <span>
                      <b>{s.title}</b>
                      <small>{s.done ? `Done ${s.done}×` : "Not done yet"}{s.open ? ` · ${s.open} open` : ""}</small>
                    </span>
                    <button type="button" className="btn ghost" disabled={s.open > 0} onClick={() => release(s.code, s.title)}>
                      {s.open ? "On the list" : "Release"}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
      {plan.poultry?.placements?.length > 0 && (
        <div className="card milestone">
          <b>Poultry placements ({plan.poultry.batch_size} {plan.poultry.breed} chicks each)</b>
          <div className="placements">
            {plan.poultry.placements.map((d) => (
              <span key={d} className={`chip ${d < new Date().toISOString().slice(0, 10) ? "state-verified_closed" : d === plan.poultry.next_placement ? "state-released" : "P3"}`}>
                {fmt(d)}
              </span>
            ))}
          </div>
          <div className="milestone-meta">Chicks are ordered three weeks before each date; the order and the placement come to the task list by themselves.</div>
        </div>
      )}
    </>
  );
}
