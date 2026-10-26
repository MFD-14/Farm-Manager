// Crop plan, two ways round: by crop (planted: beds, plants and plantings
// with their expected harvest; harvested: yields in mixed units, totalled per
// crop) and by map (each bed, its crops, the crop work on the list and its
// latest records). Built from the day bundle and cached records: offline.
import React, { useEffect, useState } from "react";
import { metaGet, getPlanInstances } from "../lib/db.js";
import { useRecords } from "../lib/records.js";

const OPEN = new Set(["released", "acknowledged", "in_progress", "done_reported", "needs_review", "blocked", "skip_pending"]);
const crops = (b) => (b.crop || "").split("+").map((c) => c.trim()).filter(Boolean);

const day = (d) => (d ? new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "");
const LABEL = { planting: "Planted", harvest: "Harvested", activity: "Activity" };

export default function CropPlanView({ mode, showCosts }) {
  const [beds, setBeds] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [tab, setTab] = useState("planted");
  const { records } = useRecords();
  const crop = (records || []).filter((r) => ["planting", "harvest", "activity"].includes(r.record.type));

  useEffect(() => {
    (async () => {
      const ref = (await metaGet("reference")) || {};
      setBeds((ref.locations || []).filter((l) => l.kind === "block" && l.status !== "retired"));
      setTasks((await getPlanInstances()).filter((i) => OPEN.has(i.state)));
    })();
  }, []);

  if (!beds) return <div className="wrap"><div className="empty">Loading…</div></div>;
  if (!beds.length) return <div className="wrap"><div className="empty">No beds on record yet. Sync once with signal.</div></div>;

  const plants = (b) => (b.plant_count ? `${Number(b.plant_count).toLocaleString()} plants` : "plants not counted");

  if (mode === "crop") {
    const byCrop = {};
    for (const b of beds) for (const c of crops(b)) (byCrop[c] ||= []).push(b);
    const plantings = crop.filter((r) => r.record.type === "planting");
    const harvests = crop.filter((r) => r.record.type === "harvest");
    const totals = {};
    for (const h of harvests) {
      const t = (totals[h.record.crop.trim()] ||= {});
      t[h.record.unit] = (t[h.record.unit] || 0) + Number(h.record.quantity || 0);
    }
    return (
      <div className="wrap">
        <div className="daytitle">Crop plan by crop</div>
        <div className="tabs-inline">
          <button type="button" className={tab === "planted" ? "on" : ""} onClick={() => setTab("planted")}>Planted crops</button>
          <button type="button" className={tab === "harvested" ? "on" : ""} onClick={() => setTab("harvested")}>Harvested yields</button>
        </div>
        {tab === "planted" && <>
          {Object.entries(byCrop).map(([c, list]) => (
            <div className="card" key={c}>
              <h3 style={{ textTransform: "capitalize" }}>{c}</h3>
              {list.map((b) => (
                <div className="kv" key={b.code}><span>{b.name}</span><b>{plants(b)}{crops(b).length > 1 ? " (shared bed)" : ""}</b></div>
              ))}
            </div>
          ))}
          {plantings.length > 0 && <div className="section-title">Plantings</div>}
          {plantings.map((p) => (
            <div className="card" key={p.event_uuid}>
              <div className="row"><h3>{p.record.crop}</h3>{p.record.plants ? <b>{Number(p.record.plants).toLocaleString()}</b> : null}</div>
              <div className="meta"><span>{p.record.location}</span><span>Planted {day(p.record.date)}</span>
                {p.record.harvest_from && <span className="chip state-released">Harvest from {day(p.record.harvest_from)}</span>}</div>
            </div>
          ))}
        </>}
        {tab === "harvested" && <>
          {Object.entries(totals).map(([c, t]) => (
            <div className="kv" key={c}><span>{c}</span><b>{Object.entries(t).map(([u, q]) => `${q.toLocaleString()} ${u}`).join(" + ")}</b></div>
          ))}
          {!harvests.length && <div className="empty">No harvests logged yet. Use + on Tasks, then Log harvest. Kale bundles are counted on the C-01 task.</div>}
          {harvests.map((h) => (
            <div className="card" key={h.event_uuid}>
              <div className="row"><h3>{h.record.crop}</h3><b>{h.record.quantity.toLocaleString()} {h.record.unit}</b></div>
              <div className="meta"><span>{h.record.location}</span><span>{day(h.record.date)}</span><span>{h.by}</span></div>
              {h.record.notes && <p className="farm-notes">{h.record.notes}</p>}
            </div>
          ))}
        </>}
      </div>
    );
  }

  return (
    <div className="wrap">
      <div className="daytitle">Crop plan by map</div>
      {beds.map((b) => {
        const work = tasks.filter((t) => t.subject_id === b.id);
        const recent = crop.filter((r) => r.record.location_id === b.id).slice(0, 3);
        return (
          <div className="card" key={b.code}>
            <div className="row"><h3>{b.name}</h3><span className="chip P3">{b.code}</span></div>
            <div className="meta">{crops(b).map((c) => <span key={c} className="chip P3">{c}</span>)}<span>{plants(b)}</span></div>
            {work.map((t) => <div className="kv" key={t.id}><span>{t.template_code} {t.title}</span><b>{t.state.replace(/_/g, " ")}</b></div>)}
            {recent.map((r) => (
              <div className="kv" key={r.event_uuid}>
                <span>{LABEL[r.record.type]}: {r.record.crop || r.record.activity}{r.record.quantity ? ` · ${r.record.quantity} ${r.record.unit}` : ""}
                  {showCosts && r.record.cost_usd ? ` · $${r.record.cost_usd}` : ""}</span>
                <b>{day(r.record.date)}</b>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}
