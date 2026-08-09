// Rainfall screen, raindrop-app style, with Daily / Weekly / Monthly views.
// Monthly bars are drawn against the Kwekwe climate-calendar norms so a failing
// rain year is visible at a glance. Data caches in IndexedDB for offline
// viewing; the reading itself is captured through the daily W-08 task.
import React, { useEffect, useState } from "react";
import { apiJson } from "../lib/api.js";
import { metaGet, metaSet } from "../lib/db.js";

// Kwekwe long-term monthly norms (mm), from the farm climate calendar.
const MONTH_NORMS = { 1: 170, 2: 160, 3: 100, 4: 30, 5: 5, 6: 2, 7: 1, 8: 2, 9: 10, 10: 40, 11: 100, 12: 160 };
const SEASON_NORM_MM = 750;
const HEAVY_DAY_MM = 40; // today's drop fill scales against a heavy-rain day

export default function RainView({ onCaptureToday }) {
  const [data, setData] = useState(null);
  const [stale, setStale] = useState(false);
  const [mode, setMode] = useState("daily"); // daily | weekly | monthly

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

      <div className="rain-seg">
        {[["daily", "Daily"], ["weekly", "Weekly"], ["monthly", "Monthly"]].map(([k, label]) => (
          <button key={k} className={mode === k ? "on" : ""} onClick={() => setMode(k)}>{label}</button>
        ))}
      </div>

      {mode === "daily" && (
        <>
          <div className="section-title">Last 14 days</div>
          <BarCard
            items={data.days.map((d) => ({ key: d.date, mm: d.mm, label: d.date.slice(8) }))}
            emptyText="No readings in this window."
          />
        </>
      )}

      {mode === "weekly" && (
        <>
          <div className="section-title">Last 12 weeks · totals</div>
          <BarCard
            items={data.weeks.map((w) => ({
              key: w.week_start, mm: w.mm,
              label: wkLabel(w.week_start),
              sub: w.rain_days ? `${w.rain_days}d` : "",
            }))}
            emptyText="No readings in the last 12 weeks."
          />
          <WeeklySummary weeks={data.weeks} />
        </>
      )}

      {mode === "monthly" && (
        <>
          <div className="section-title">Last 12 months · against Kwekwe norm</div>
          <BarCard
            items={data.months.map((m) => {
              const monthNum = Number(m.month.slice(5, 7));
              return {
                key: m.month, mm: m.mm, label: moLabel(m.month),
                norm: MONTH_NORMS[monthNum],
                sub: m.rain_days ? `${m.rain_days}d` : "",
              };
            })}
            emptyText="No readings in the last 12 months."
            showNorm
          />
          <div className="card rain-legend">
            <span><i className="sw actual" /> recorded</span>
            <span><i className="sw norm" /> monthly norm</span>
          </div>
        </>
      )}

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

// Shared bar chart. With showNorm, a ghost bar behind each actual bar marks the
// monthly norm, scaled on the same axis.
function BarCard({ items, emptyText, showNorm = false }) {
  const max = Math.max(1, ...items.map((i) => Math.max(i.mm, showNorm ? i.norm || 0 : 0)));
  const H = 96;
  return (
    <div className="card">
      <div className="rain-bars" style={{ minHeight: H + 44 }}>
        {items.length === 0 && <div className="empty" style={{ padding: 18 }}>{emptyText}</div>}
        {items.map((i) => (
          <div className="rain-bar" key={i.key} title={`${i.key}: ${fmt(i.mm)} mm`}>
            <span className="v">{i.mm > 0 ? fmt(i.mm) : ""}</span>
            <div className="stack" style={{ height: H }}>
              {showNorm && i.norm !== undefined && (
                <div className="bar ghost" style={{ height: `${Math.max(2, (i.norm / max) * H)}px` }} />
              )}
              <div className="bar" data-dry={i.mm === 0}
                style={{ height: `${Math.max(i.mm > 0 ? 8 : 3, (i.mm / max) * H)}px` }} />
            </div>
            <span className="d">{i.label}</span>
            {i.sub ? <span className="d sub">{i.sub}</span> : null}
          </div>
        ))}
      </div>
    </div>
  );
}

function WeeklySummary({ weeks }) {
  if (!weeks.length) return null;
  const total = weeks.reduce((a, w) => a + w.mm, 0);
  const best = weeks.reduce((a, w) => (w.mm > a.mm ? w : a), weeks[0]);
  const thisWeek = weeks[weeks.length - 1];
  return (
    <div className="card">
      <div className="kv"><span>This week</span><b>{fmt(thisWeek.mm)} mm · {thisWeek.rain_days} rain day{thisWeek.rain_days === 1 ? "" : "s"}</b></div>
      <div className="kv"><span>12-week total</span><b>{fmt(total)} mm</b></div>
      <div className="kv"><span>Wettest week</span><b>{fmt(best.mm)} mm · wk of {wkLabel(best.week_start)}</b></div>
    </div>
  );
}

function Drop({ fill }) {
  const level = 118 - fill * 92;
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
const wkLabel = (d) => new Date(d + "T12:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short" });
const moLabel = (m) => new Date(m + "-15T12:00:00Z").toLocaleDateString("en-GB", { month: "short" });
