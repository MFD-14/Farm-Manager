// Phase 2 water-balance console (spec 3.5 / R14): per-block soil-water deficit
// gauges against the MAD trigger line, the trailing ledger, and today's
// computed shifts with their basis.
import React, { useEffect, useState } from "react";
import { apiJson } from "../lib/api.js";
import { metaGet, metaSet } from "../lib/db.js";

export default function WaterView() {
  const [data, setData] = useState(null);
  const [stale, setStale] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const cached = await metaGet("water_cache");
    if (cached) { setData(cached); setStale(true); }
    try {
      const fresh = await apiJson("/api/owner/water");
      setData(fresh); setStale(false);
      await metaSet("water_cache", fresh);
    } catch { /* offline */ }
  };
  useEffect(() => { load(); }, []);

  async function toggle() {
    setBusy(true);
    try {
      await apiJson("/api/owner/water/config", { method: "POST", body: { enabled: !data.enabled } });
      await load();
    } finally { setBusy(false); }
  }

  if (!data) return <div className="wrap"><div className="empty">Loading water balance…</div></div>;

  return (
    <div className="wrap">
      <div className="daytitle">Water balance</div>
      {stale && <p className="evidence-note" style={{ marginBottom: 8 }}>Offline — showing last synced data</p>}

      <div className="card wb-status">
        <div>
          <b>Soil-moisture planner</b>
          <div style={{ fontSize: 13, color: "var(--tm)", marginTop: 2 }}>
            Works out each bed&apos;s watering from the weather, rain and past irrigation.
          </div>
        </div>
        <button className={`btn ${data.enabled ? "primary" : "ghost"}`} disabled={busy}
          style={{ padding: "9px 16px", fontSize: 13 }} onClick={toggle}>
          {data.enabled ? "Enabled" : "Enable"}
        </button>
      </div>

      {!data.enabled && (
        <p className="evidence-note" style={{ margin: "4px 0 10px" }}>
          Watering is still planned from the tank budget. This planner runs alongside
          so you can compare before switching it on.
        </p>
      )}

      {data.plan?.length > 0 && (
        <>
          <div className="section-title">Today&apos;s computed shifts</div>
          {data.plan.map((s) => (
            <div className="card" data-priority="P1" key={s.block_code}>
              <div className="row"><h3>{s.block_name}</h3><span className="chip P1">{s.start}</span></div>
              <div className="meta">
                <span><b>{s.minutes} min</b> · {s.litres.toLocaleString()} L</span>
                <span>replacing {s.basis.replacing_mm} mm of a {s.basis.deficit_mm} mm deficit</span>
              </div>
            </div>
          ))}
        </>
      )}

      {data.blocks.map((b) => <BlockCard key={b.block} b={b} />)}
    </div>
  );
}

function BlockCard({ b }) {
  const [numbers, setNumbers] = useState(false);
  const pct = Math.min(100, (b.deficit_mm / b.config.taw_mm) * 100);
  const over = b.deficit_mm >= b.mad_mm;
  const last7 = b.rows.slice(-7);
  const normalDays = b.rows.filter((r) => r.et0_source === "normal").length;

  return (
    <div className="card" style={{ marginTop: 12 }}>
      <div className="row">
        <h3>{b.block_name}</h3>
        <span className={`chip ${over ? "P1" : "state-verified_closed"}`}>{over ? "Water today" : "Fine"}</span>
      </div>
      <p className="plain-summary">{summary(b, over)}</p>

      <div className="wb-gauge">
        <div className="track">
          <div className={`fill ${over ? "over" : ""}`} style={{ width: `${pct}%` }} />
          <div className="mad" style={{ left: `${b.config.mad * 100}%` }} />
        </div>
        <div className="wb-gauge-labels">
          <span><b>{b.deficit_mm} mm</b> used from the soil</span>
          <span>water at {b.mad_mm} mm</span>
          <span>dry at {b.config.taw_mm} mm</span>
        </div>
      </div>

      <Spark rows={b.rows} taw={b.config.taw_mm} mad={b.mad_mm} />

      <button type="button" className="link-toggle" aria-expanded={numbers} onClick={() => setNumbers(!numbers)}>
        {numbers ? "Hide the numbers" : "Show the numbers"}</button>
      {numbers && <>
      <table className="wb-table">
        <thead><tr><th>day</th><th>ET₀</th><th>ETc</th><th>rain</th><th>irr</th><th>deficit</th></tr></thead>
        <tbody>
          {last7.map((r) => (
            <tr key={r.date}>
              <td>{r.date.slice(8)}</td>
              <td>{r.et0}{r.et0_source !== "reading" ? "*" : ""}</td>
              <td>{r.etc}</td>
              <td>{r.rain_mm || "–"}</td>
              <td>{r.irrigation_mm || "–"}</td>
              <td><b>{r.deficit_mm}</b></td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="evidence-note" style={{ textAlign: "left", marginTop: 6 }}>
        Kc {b.config.kc} · {b.config.area_m2.toLocaleString()} m² · {b.config.rate_mm_h} mm/h at {Math.round(b.config.efficiency * 100)}% efficiency.
        {normalDays > 0 && ` * ${normalDays} day(s) used climate-normal ET₀ (no forecast/reading).`}
      </p>
      </>}
    </div>
  );
}

function Spark({ rows, taw, mad }) {
  const W = 320, H = 64, PAD = 4;
  const x = (i) => PAD + (i / Math.max(1, rows.length - 1)) * (W - PAD * 2);
  const y = (mm) => H - PAD - (mm / taw) * (H - PAD * 2);
  const line = rows.map((r, i) => `${i ? "L" : "M"} ${x(i)} ${y(r.deficit_mm)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", display: "block", margin: "8px 0 4px" }}>
      <line x1={PAD} y1={y(mad)} x2={W - PAD} y2={y(mad)} stroke="var(--gold)" strokeWidth="1.5" strokeDasharray="4 3" />
      <path d={`${line} L ${x(rows.length - 1)} ${H - PAD} L ${x(0)} ${H - PAD} Z`} fill="rgba(41,128,185,.12)" />
      <path d={line} fill="none" stroke="var(--b5)" strokeWidth="2" strokeLinejoin="round" />
    </svg>
  );
}

// The one sentence the owner needs: water today (how long, how much) or when next.
function summary(b, over) {
  const c = b.config;
  if (over) {
    // Shifts are capped at 3 h; litres are what that shift delivers (1 mm on 1 m² = 1 L).
    const full = Math.round((b.deficit_mm / (c.rate_mm_h * c.efficiency)) * 60);
    const minutes = Math.min(180, full);
    const litres = Math.round(c.rate_mm_h * (minutes / 60) * c.area_m2);
    return `Needs water today: about ${minutes} min (${litres.toLocaleString()} L)${full > 180 ? ", the first of several shifts" : ""}.`;
  }
  const use = b.rows.at(-1)?.etc || 0;
  const days = use > 0 ? Math.max(1, Math.round((b.mad_mm - b.deficit_mm) / use)) : null;
  return days ? `Soil moisture is fine; next watering in about ${days} day${days > 1 ? "s" : ""}.` : "Soil moisture is fine.";
}
