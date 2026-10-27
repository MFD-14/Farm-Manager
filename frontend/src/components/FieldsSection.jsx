// Fields on the Farm Map: outlines over satellite imagery, the tapped field's
// area and source, Google Earth import (owners and task managers), and walking
// a boundary (everyone). Outlines come from the cached day bundle.
import React, { useCallback, useEffect, useState } from "react";
import FieldMap from "./FieldMap.jsx";
import WalkBoundary from "./WalkBoundary.jsx";
import { metaGet } from "../lib/db.js";
import { pullBundle } from "../lib/sync.js";
import { saveOutline } from "../lib/capture.js";
import { parseKml, ringAreaHa, fmtHa } from "../lib/geo.js";
import SheetClose from "./SheetClose.jsx";

const SOURCE = { google_earth: "Google Earth", gps_walk: "walked" };
const walkable = (l) => ["block", "zone", "paddock"].includes(l.kind) && l.status !== "retired";

function useFields() {
  const [fields, setFields] = useState([]);
  const load = useCallback(async () => setFields(((await metaGet("reference"))?.locations || []).filter(walkable)), []);
  const refresh = useCallback(async () => { await pullBundle().catch(() => {}); await load(); }, [load]);
  useEffect(() => { load(); }, [load]);
  return { fields, refresh };
}

// "Walk a boundary" on its own, for the Field Walk screen.
export function WalkButton({ isConsole, center }) {
  const { fields, refresh } = useFields();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="btn ghost block" onClick={() => setOpen(true)}>Walk a boundary</button>
      {open && <WalkBoundary fields={fields} isConsole={isConsole} center={center} onClose={(saved) => { setOpen(false); if (saved) setTimeout(refresh, 3000); }} />}
    </>
  );
}

export default function FieldsSection({ isConsole, center }) {
  const { fields, refresh } = useFields();
  const [sel, setSel] = useState(null);
  const [walk, setWalk] = useState(null); // field id or "" for the picker
  const [imported, setImported] = useState(null); // [{name, coordinates, target}]
  const [msg, setMsg] = useState(null);
  const field = fields.find((f) => f.id === sel);
  const afterSave = (text) => { setMsg(text); setTimeout(refresh, 3000); };

  async function onKml(e) {
    setMsg(null);
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    // Phones don't know the .kml type, so the picker allows any file and the
    // contents are checked here instead.
    if (/\.kmz$/i.test(file.name)) { setMsg("That's a KMZ file. In Google Earth Pro use Save Place As… and choose KML."); return; }
    try {
      const shapes = parseKml(await file.text());
      if (!shapes.length) { setMsg("No outlines found. In Google Earth Pro draw with Add Polygon, then Save Place As… KML."); return; }
      const same = (a, b) => a.toLowerCase() === b.toLowerCase();
      const match = (n) => fields.find((f) => same(f.name, n) || same(f.code, n))
        || fields.find((f) => f.name.toLowerCase().includes(n.toLowerCase()) || n.toLowerCase().includes(f.name.toLowerCase()));
      setImported(shapes.map((s) => ({ ...s, target: match(s.name)?.id || "new" })));
    } catch (err) { setMsg(err.message); }
  }

  async function saveImport() {
    for (const s of imported) {
      if (s.target === "skip") continue;
      await saveOutline({ location_id: s.target === "new" ? null : s.target, name: s.name, coordinates: s.coordinates, source: "google_earth" });
    }
    setImported(null);
    afterSave("Outlines saved. They show on the map once synced.");
  }

  const mapped = fields.filter((f) => f.geom);
  return (
    <>
      <div className="section-title">Fields · {mapped.length} of {fields.length} outlined</div>
      <FieldMap locations={fields} center={center} selected={sel} onSelect={(l) => setSel(l.id)}
        emptyText={mapped.length ? null : isConsole ? "No outlines yet. Import the farm boundary from Google Earth, or walk a boundary." : "No outlines yet. Walk a boundary to draw the first one."}>
        <button type="button" className="btn primary map-fab" onClick={() => setWalk("")}>Walk a boundary</button>
      </FieldMap>
      {!navigator.onLine && <p className="evidence-note">The satellite photo needs signal; outlines show offline.</p>}
      {msg && <p className="form-msg good">{msg}</p>}
      {field && (
        <div className="card">
          <div className="row"><h3>{field.name}</h3><span className="chip P3">{field.code}</span></div>
          <div className="meta">
            {field.geom_meta ? <><span><b>{fmtHa(field.geom_meta.area_ha)}</b></span><span>{SOURCE[field.geom_meta.source] || field.geom_meta.source}</span>
              {field.geom_meta.accuracy_m ? <span>±{field.geom_meta.accuracy_m} m</span> : null}</> : <span>Not outlined yet</span>}
          </div>
          {field.geom_proposed && (
            <p className="evidence-note" style={{ textAlign: "left" }}>
              Walked outline waiting: {fmtHa(field.geom_proposed.area_ha)} (±{field.geom_proposed.accuracy_m} m), dashed gold on the map.
            </p>
          )}
          <div className="person-actions">
            <button type="button" className="btn ghost" onClick={() => setWalk(field.id)}>Walk this boundary</button>
            {isConsole && field.geom_proposed && <>
              <button type="button" className="btn ghost" onClick={async () => {
                await saveOutline({ location_id: field.id, coordinates: field.geom_proposed.geometry.coordinates[0].slice(0, -1),
                  source: "gps_walk", accuracy_m: field.geom_proposed.accuracy_m });
                afterSave(`Walked outline is now ${field.name}'s outline.`);
              }}>Use walked outline</button>
              <button type="button" className="btn ghost" onClick={async () => { await saveOutline({ location_id: field.id, discard: true }); afterSave("Walked outline discarded."); }}>Discard</button>
            </>}
          </div>
        </div>
      )}
      <div className="person-actions">
        {isConsole && <label className="link-toggle">Import outlines from Google Earth (KML)<input type="file" hidden onChange={onKml} /></label>}
      </div>

      {walk !== null && <WalkBoundary fields={fields} initialId={walk} isConsole={isConsole} center={center}
        onClose={(saved) => { setWalk(null); if (saved) afterSave(isConsole ? "Outline saved." : "Walk saved. The owner will check it."); }} />}

      {imported && (
        <div className="sheet" onClick={() => setImported(null)}>
          <div className="panel" onClick={(e) => e.stopPropagation()}>
            <SheetClose onClose={() => setImported(null)} />
            <h2>Outlines from Google Earth</h2>
            <p className="evidence-note" style={{ textAlign: "left" }}>Choose which bed or field each outline is. Unmatched ones become new beds.</p>
            {imported.map((s, i) => (
              <div className="card" key={i}>
                <div className="row"><h3>{s.name}</h3><span className="farm-count">{fmtHa(ringAreaHa(s.coordinates))}</span></div>
                <select className="note-input" value={s.target} onChange={(e) => setImported(imported.map((x, j) => (j === i ? { ...x, target: e.target.value } : x)))}>
                  {fields.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                  <option value="new">New bed: {s.name}</option>
                  <option value="skip">Don't import</option>
                </select>
              </div>
            ))}
            <button type="button" className="btn primary block" onClick={saveImport}>Save outlines</button>
          </div>
        </div>
      )}
    </>
  );
}
