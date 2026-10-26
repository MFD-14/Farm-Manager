// Crop plan, two ways round: by crop (which beds grow it, how many plants)
// and by map (each bed, its crops and the crop work on the list for it).
// Built from the day bundle's reference data, so it works offline.
import React, { useEffect, useState } from "react";
import { metaGet, getPlanInstances } from "../lib/db.js";

const OPEN = new Set(["released", "acknowledged", "in_progress", "done_reported", "needs_review", "blocked", "skip_pending"]);
const crops = (b) => (b.crop || "").split("+").map((c) => c.trim()).filter(Boolean);

export default function CropPlanView({ mode }) {
  const [beds, setBeds] = useState(null);
  const [tasks, setTasks] = useState([]);

  useEffect(() => {
    (async () => {
      const ref = (await metaGet("reference")) || {};
      setBeds((ref.locations || []).filter((l) => l.kind === "block" && l.crop && l.status !== "retired"));
      setTasks((await getPlanInstances()).filter((i) => OPEN.has(i.state)));
    })();
  }, []);

  if (!beds) return <div className="wrap"><div className="empty">Loading…</div></div>;
  if (!beds.length) return <div className="wrap"><div className="empty">No beds on record yet. Sync once with signal.</div></div>;

  const plants = (b) => (b.plant_count ? `${Number(b.plant_count).toLocaleString()} plants` : "plants not counted");

  if (mode === "crop") {
    const byCrop = {};
    for (const b of beds) for (const c of crops(b)) (byCrop[c] ||= []).push(b);
    return (
      <div className="wrap">
        <div className="daytitle">Crop plan by crop</div>
        {Object.entries(byCrop).map(([crop, list]) => (
          <div className="card" key={crop}>
            <h3 style={{ textTransform: "capitalize" }}>{crop}</h3>
            {list.map((b) => (
              <div className="kv" key={b.code}><span>{b.name}</span><b>{plants(b)}{crops(b).length > 1 ? " (shared bed)" : ""}</b></div>
            ))}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="wrap">
      <div className="daytitle">Crop plan by map</div>
      {beds.map((b) => {
        const work = tasks.filter((t) => t.subject_id === b.id);
        return (
          <div className="card" key={b.code}>
            <div className="row"><h3>{b.name}</h3><span className="farm-count">{b.code}</span></div>
            <div className="meta">{crops(b).map((c) => <span key={c} className="chip P3">{c}</span>)}<span>{plants(b)}</span></div>
            {work.map((t) => <div className="kv" key={t.id}><span>{t.template_code} {t.title}</span><b>{t.state.replace(/_/g, " ")}</b></div>)}
          </div>
        );
      })}
    </div>
  );
}
