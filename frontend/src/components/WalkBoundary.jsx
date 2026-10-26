// Walk the boundary: pick a bed or field, press Start and walk its edge with
// the phone; GPS points are kept when they are accurate to 20 m and at least
// 3 m apart. The outline is saved through the outbox, so it works with no
// signal. Owners' and task managers' walks replace the outline; a caretaker's
// walk waits on the Farm Map for one of them to use it.
import React, { useEffect, useRef, useState } from "react";
import FieldMap from "./FieldMap.jsx";
import { ringAreaHa, metres, fmtHa } from "../lib/geo.js";
import { saveOutline } from "../lib/capture.js";

const MAX_ACCURACY_M = 20;
const MIN_STEP_M = 3;

export default function WalkBoundary({ fields, initialId, isConsole, center, onClose }) {
  const [fieldId, setFieldId] = useState(initialId || fields[0]?.id || "");
  const [pts, setPts] = useState([]);
  const [accs, setAccs] = useState([]);
  const [acc, setAcc] = useState(null);
  const [status, setStatus] = useState("idle"); // idle | walking | done
  const [err, setErr] = useState(null);
  const watch = useRef(null);
  const lock = useRef(null);
  const field = fields.find((f) => f.id === fieldId);

  const stop = () => {
    if (watch.current !== null) navigator.geolocation.clearWatch(watch.current);
    watch.current = null;
    lock.current?.release?.().catch(() => {});
  };
  useEffect(() => stop, []);

  async function start() {
    setErr(null); setPts([]); setAccs([]);
    if (!navigator.geolocation) { setErr("This phone can't share its location."); return; }
    try { lock.current = await navigator.wakeLock?.request("screen"); } catch { /* screen may sleep */ }
    setStatus("walking");
    watch.current = navigator.geolocation.watchPosition((pos) => {
      const a = pos.coords.accuracy;
      setAcc(a); setErr(null);
      if (a > MAX_ACCURACY_M) return;
      const p = [pos.coords.longitude, pos.coords.latitude];
      setPts((prev) => (prev.length && metres(prev[prev.length - 1], p) < MIN_STEP_M ? prev : [...prev, p]));
      setAccs((prev) => [...prev, a]);
    }, (e) => setErr(e.code === 1 ? "Location is switched off for this app. Allow it in the phone's settings." : "Waiting for GPS…"),
    { enableHighAccuracy: true, maximumAge: 0, timeout: 30_000 });
  }

  function finish() {
    stop();
    if (pts.length < 4) { setErr("Too few points. Walk the whole edge, then press Finish."); setStatus("idle"); return; }
    setStatus("done");
  }

  async function save() {
    const sorted = [...accs].sort((a, b) => a - b);
    await saveOutline({ location_id: fieldId, coordinates: pts, source: "gps_walk",
      accuracy_m: Math.round(sorted[Math.floor(sorted.length / 2)] || 0) });
    onClose(true);
  }

  const walked = pts.reduce((d, p, i) => (i ? d + metres(pts[i - 1], p) : 0), 0);
  const gap = pts.length > 2 ? metres(pts[pts.length - 1], pts[0]) : null;
  const area = pts.length > 2 ? ringAreaHa(pts) : 0;

  return (
    <div className="sheet" onClick={() => status !== "walking" && onClose(false)}>
      <div className="panel" onClick={(e) => e.stopPropagation()}>
        <h2>Walk the boundary</h2>
        <select className="note-input" value={fieldId} disabled={status !== "idle"} onChange={(e) => setFieldId(e.target.value)}>
          {fields.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
        </select>
        <FieldMap locations={field ? [field] : []} center={center} track={pts} height={220} />
        <div className="kv"><span>GPS accuracy</span><b className={acc > MAX_ACCURACY_M ? "warn-text" : ""}>{acc ? `±${Math.round(acc)} m` : "–"}</b></div>
        <div className="kv"><span>Points · walked</span><b>{pts.length} · {Math.round(walked)} m</b></div>
        <div className="kv"><span>Area so far</span><b>{area ? fmtHa(area) : "–"}</b></div>
        {field?.geom_meta && <div className="kv"><span>Current outline</span><b>{fmtHa(field.geom_meta.area_ha)}</b></div>}
        {status === "walking" && gap !== null && <p className="evidence-note">{Math.round(gap)} m from where you started. Finish back at the start.</p>}
        {status === "idle" && <p className="evidence-note">Stand on a corner, press Start, walk the edge all the way round, and press Finish at the start.</p>}
        {status === "done" && !isConsole && <p className="evidence-note">Saved outlines go to the owner to check before they replace the current one.</p>}
        {err && <p className="form-msg bad">{err}</p>}
        {status === "idle" && <button type="button" className="btn primary block" disabled={!fieldId} onClick={start}>Start</button>}
        {status === "walking" && <button type="button" className="btn primary block" onClick={finish}>Finish</button>}
        {status === "done" && <button type="button" className="btn primary block" onClick={save}>Save outline ({fmtHa(area)})</button>}
        {status !== "walking" && <button type="button" className="btn ghost block" onClick={() => (status === "done" ? setStatus("idle") : onClose(false))}>
          {status === "done" ? "Walk again" : "Close"}</button>}
      </div>
    </div>
  );
}
