// One form for every record type in lib/records.js, with validation: required
// fields, no negative numbers, no dates in the future (except an expected
// harvest). Beds and animal groups come from the cached day bundle.
import React, { useEffect, useState } from "react";
import { metaGet } from "../lib/db.js";
import { RECORD_TYPES, saveRecord, today } from "../lib/records.js";
import Attachments from "./Attachments.jsx";
import SheetClose from "./SheetClose.jsx";

export default function RecordForm({ type, onClose }) {
  const def = RECORD_TYPES[type];
  const [v, setV] = useState(() => Object.fromEntries(def.fields.map((f) => [f.k,
    f.initial ?? (f.type === "date" && f.required ? today() : f.type === "choice" && f.required ? f.options[0] : "")])));
  const [media, setMedia] = useState([]);
  const [units, setUnits] = useState(() => Object.fromEntries(def.fields.filter((f) => f.units).map((f) => [f.unitKey || "unit", f.units[0]])));
  const [errors, setErrors] = useState({});
  const [ref, setRef] = useState({ locations: [], herds: [], batches: [] });

  useEffect(() => { metaGet("reference").then((r) => r && setRef(r)); }, []);
  const beds = ref.locations.filter((l) => ["block", "zone", "paddock"].includes(l.kind) && l.status !== "retired" && l.code !== "FARM-BOUNDARY");
  const groups = [...(ref.herds || []).map((h) => ({ id: h.id, name: `${h.name} (${h.head_count})` })),
    ...ref.batches.filter((b) => b.stage !== "closed").map((b) => ({ id: b.id, name: `${b.name} (${b.current_count})` }))];

  function validate() {
    const e = {};
    for (const f of def.fields) {
      const x = v[f.k];
      if (f.required && (x === "" || x === null || x === undefined)) e[f.k] = "Required";
      else if (f.type === "number" && x !== "" && (Number.isNaN(Number(x)) || Number(x) < 0)) e[f.k] = "Enter a number, 0 or more";
      else if (f.notFuture && x > today()) e[f.k] = "Can't be in the future";
    }
    if (v.harvest_from && v.date && v.harvest_from < v.date) e.harvest_from = "Must be after planting";
    setErrors(e);
    return !Object.keys(e).length;
  }

  async function save() {
    if (!validate()) return;
    const out = { type };
    for (const f of def.fields) if (v[f.k] !== "") out[f.k] = f.type === "number" ? Number(v[f.k]) : v[f.k];
    Object.assign(out, units);
    const named = (list, id) => list.find((x) => x.id === id)?.name;
    if (out.location_id) out.location = named(beds, out.location_id);
    if (out.group_id) out.group = named(groups, out.group_id);
    await saveRecord(out, media);
    onClose(true);
  }

  // Quick picks: the chosen bed's crops for a crop field, Today / Yesterday for dates.
  const bedCrops = (beds.find((b) => b.id === v.location_id)?.crop || "").split("+").map((c) => c.trim()).filter(Boolean);
  const yesterday = (() => { const d = new Date(`${today()}T12:00:00Z`); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10); })();
  const picks = (f) => {
    const opts = f.k === "crop" ? bedCrops.map((c) => [c, c]) : f.type === "date" && f.notFuture ? [["Today", today()], ["Yesterday", yesterday]] : [];
    if (!opts.length) return null;
    return (
      <div className="quick-picks">
        {opts.map(([label, val]) => <button type="button" key={label} className={v[f.k] === val ? "on" : ""}
          onClick={() => setV({ ...v, [f.k]: val })}>{label}</button>)}
      </div>
    );
  };

  const input = (f) => {
    const common = { className: `note-input ${errors[f.k] ? "invalid" : ""}`, value: v[f.k], onChange: (e) => setV({ ...v, [f.k]: e.target.value }) };
    if (f.type === "textarea") return <textarea rows={2} {...common} />;
    if (f.type === "choice") return <select {...common}>{!f.required && <option value="">—</option>}{f.options.map((o) => <option key={o}>{o}</option>)}</select>;
    if (f.type === "bed" || f.type === "group") {
      const list = f.type === "bed" ? beds : groups;
      return <select {...common}><option value="">Choose…</option>{list.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select>;
    }
    if (f.type === "number") {
      return (
        <div className="unit-row">
          <input type="number" inputMode="decimal" min="0" step="any" placeholder={f.placeholder} {...common} />
          {f.units && <select className="note-input" value={units[f.unitKey || "unit"]} onChange={(e) => setUnits({ ...units, [f.unitKey || "unit"]: e.target.value })}>
            {f.units.map((u) => <option key={u}>{u}</option>)}</select>}
        </div>
      );
    }
    return <input type={f.type === "date" ? "date" : "text"} max={f.notFuture ? today() : undefined} placeholder={f.placeholder} {...common} />;
  };

  return (
    <div className="sheet" onClick={() => onClose(false)}>
      <div className="panel" onClick={(e) => e.stopPropagation()}>
        <SheetClose onClose={() => onClose(false)} />
        <h2>{def.label}</h2>
        {def.fields.map((f) => (
          <label className="form-field" key={f.k}>
            <span>{f.label}</span>
            {input(f)}
            {picks(f)}
            {errors[f.k] && <small className="form-msg bad">{errors[f.k]}</small>}
          </label>
        ))}
        {def.media && <label className="form-field"><span>Photo (optional)</span><Attachments items={media} setItems={setMedia} taskCode={type.toUpperCase()} /></label>}
        {!def.media && <p className="evidence-note">Saved on this phone now; syncs when there's signal.</p>}
        <button type="button" className="btn primary block" onClick={save}>Save</button>
      </div>
    </div>
  );
}

// The + sheet: everything that can be added, Tend style.
export function AddSheet({ items, onPick, onClose }) {
  return (
    <div className="sheet" onClick={onClose}>
      <div className="panel" onClick={(e) => e.stopPropagation()}>
        <SheetClose onClose={onClose} />
        {items.map((it) => (
          <button type="button" key={it.key} className="add-item" onClick={() => onPick(it.key)}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={it.icon} /></svg>
            <span>{it.label}</span><b>›</b>
          </button>
        ))}
      </div>
    </div>
  );
}
