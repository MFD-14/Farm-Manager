// Rainfall screen, raindrop-app style: a big drop that fills with today's rain,
// 14-day bars, season-to-date accumulation against the Kwekwe seasonal norm.
// Data caches in IndexedDB so the screen still renders in a dead zone; the
// reading itself is captured through the daily W-08 task like everything else.
import React, { useEffect, useState } from "react";
import { apiJson } from "../lib/api.js";
import { metaGet, metaSet } from "../lib/db.js";

// Kwekwe long-term seasonal norm (spec climate table sums to ~770 mm/season).
const SEASON_NORM_MM = 750;
// Today's drop fill scales against a heavy-rain day.
const HEAVY_DAY_MM = 40;

export default function RainView({ onCaptureToday }) {
  const [data, setData] = useState(null);
  const [stale, setStale] = useState(false);

  useEffect(() => {
    (async () => {
      const cached = await metaGet("rain_cache");
      if (cached) { setData(cached); setStale(true); }
      try {
        const fresh = await apiJson("/api/owner/rain?days=14");
        setData(fresh); setStale(false);
        await metaSet("rain_cache", fresh);
      } catch { /* offline: cached view stands */ }
    })();
  }, []);

  if (!data) return <div className="wrap"><div className="empty">No rainfall data yet. Record the first W-08 gauge reading.</div></div>;

  const fill = Math.max(0, Math.min(1, data.today_mm / HEAVY_DAY_MM));
  const seasonPct = Math.min(100, Math.round((data.season.total_mm / SEASON_NORM_MM) * 100));
  const maxDay = Math.max(1, ...data.days.map((d) => d.mm));

  return (
    <div className="wrap">
      <div className="daytitle">Rainfall</div>
      {stale && <p className="evidence-note" style={{ marginBottom: 8 }}>Offline — showing last synced data</p>}

      <div className="rain-hero card">
        <Drop fill={fill} />
        <div className="rain-today">
          <div className="mm">{fmt(data.today_mm)}<span> mm</span></div>
          <div className="lbl">today</div>
          {data.last_reading && (
            <div className="last">
              last reading {fmt(data.last_reading.mm)} mm ·{" "}
              {new Date(data.last_reading.at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
            </div>
          )}
          {onCaptureToday && (
            <button className="btn primary" style={{ marginTop: 10, padding: "10px 16px", fontSize: 14 }}
              onClick={onCaptureToday}>
              Record today&apos;s reading
            </button>
          )}
        </div>
      </div>

      <div className="section-title">Last 14 days</div>
      <div className="card">
        <div className="rain-bars">
          {data.days.length === 0 && <div className="empty" style={{ padding: 18 }}>No readings in this window.</div>}
          {data.days.map((d) => (
            <div className="rain-bar" key={d.date} title={`${d.date}: ${fmt(d.mm)} mm`}>
              <span className="v">{d.mm > 0 ? fmt(d.mm) : ""}</span>
              <div className="bar" style={{ height: `${Math.max(d.mm > 0 ? 8 : 3, (d.mm / maxDay) * 92)}px` }}
                data-dry={d.mm === 0} />
              <span className="d">{d.date.slice(8)}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="section-title">Season · from {fmtDate(data.season.start)}</div>
      <div className="card">
        <div className="kv"><span>Season to date</span><b>{fmt(data.season.total_mm)} mm</b></div>
        <div className="rain-season-track">
          <div className="fill" style={{ width: `${seasonPct}%` }} />
          <span className="norm">norm {SEASON_NORM_MM} mm</span>
        </div>
        <div className="kv"><span>Rain days</span><b>{data.season.rain_days}</b></div>
        {data.season.wettest_day && (
          <div className="kv"><span>Wettest day</span>
            <b>{fmt(data.season.wettest_day.mm)} mm · {fmtDate(data.season.wettest_day.date)}</b>
          </div>
        )}
        <p className="evidence-note" style={{ textAlign: "left", marginTop: 8 }}>
          15 mm or more in 24 hours suppresses tomorrow&apos;s irrigation shifts automatically (rule T2).
        </p>
      </div>
    </div>
  );
}

function Drop({ fill }) {
  // Teardrop with a clipped water level that rises with today's rainfall.
  const level = 118 - fill * 92; // y of water surface inside the drop (26..118)
  return (
    <svg className="rain-drop" viewBox="0 0 100 130" width="108" height="140">
      <defs>
        <clipPath id="dropclip">
          <path d="M50 4 C58 26 88 56 88 86 a38 38 0 1 1 -76 0 C12 56 42 26 50 4 Z" />
        </clipPath>
        <linearGradient id="water" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#5db9ec" />
          <stop offset="1" stopColor="#2980b9" />
        </linearGradient>
      </defs>
      <path d="M50 4 C58 26 88 56 88 86 a38 38 0 1 1 -76 0 C12 56 42 26 50 4 Z"
        fill="#eaf4fb" stroke="#2980b9" strokeWidth="3" strokeLinejoin="round" />
      <g clipPath="url(#dropclip)">
        <rect x="0" y={level} width="100" height="130" fill="url(#water)">
          <animate attributeName="y" values={`${level + 2};${level - 2};${level + 2}`} dur="3s" repeatCount="indefinite" />
        </rect>
        <ellipse cx="50" cy={level} rx="52" ry="4" fill="#8fd0f4" opacity=".7">
          <animate attributeName="cy" values={`${level + 2};${level - 2};${level + 2}`} dur="3s" repeatCount="indefinite" />
        </ellipse>
      </g>
      <ellipse cx="38" cy="52" rx="7" ry="14" fill="#fff" opacity=".5" transform="rotate(18 38 52)" />
    </svg>
  );
}

const fmt = (n) => (Math.round(n * 10) / 10).toString();
const fmtDate = (d) => new Date(d + "T12:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short" });
