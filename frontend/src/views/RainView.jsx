// Rainfall screen, raindrop-app style, with Daily / Weekly / Monthly views.
// Monthly bars are drawn against the Kwekwe climate-calendar norms so a failing
// rain year is visible at a glance. Days the gauge wasn't read are filled from
// public estimates (Open-Meteo for the past week, NASA POWER for older days),
// drawn striped and named as estimates. Data caches in IndexedDB for offline
// viewing; the reading itself is captured through the daily W-08 task.
import React, { useEffect, useState } from "react";
import { apiJson } from "../lib/api.js";
import { metaGet, metaSet } from "../lib/db.js";

// Kwekwe long-term monthly norms (mm), from the farm climate calendar.
const MONTH_NORMS = { 1: 170, 2: 160, 3: 100, 4: 30, 5: 5, 6: 2, 7: 1, 8: 2, 9: 10, 10: 40, 11: 100, 12: 160 };
const SEASON_NORM_MM = Object.values(MONTH_NORMS).reduce((a, b) => a + b, 0); // 780
const HEAVY_DAY_MM = 40; // today's drop fill scales against a heavy-rain day

// Cumulative norm curve at month-of-season boundaries (season order Oct..Sep).
const SEASON_MONTHS = [10, 11, 12, 1, 2, 3, 4, 5, 6, 7, 8, 9];
const MONTH_DAYS = { 1: 31, 2: 28, 3: 31, 4: 30, 5: 31, 6: 30, 7: 31, 8: 31, 9: 30, 10: 31, 11: 30, 12: 31 };
const NORM_CURVE = (() => {
  let d = 0, mm = 0;
  const pts = [{ d: 0, mm: 0 }];
  for (const m of SEASON_MONTHS) {
    d += MONTH_DAYS[m];
    mm += MONTH_NORMS[m];
    pts.push({ d, mm });
  }
  return pts;
})();

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
          <div className="lbl">{data.today_has_reading === false ? "no gauge reading yet today" : "today"}</div>
          {data.last_reading && (
            <div className="last">
              last reading {fmt(data.last_reading.mm)} mm ·{" "}
              {new Date(data.last_reading.at).toLocaleDateString("en-GB", { timeZone: "Africa/Harare", day: "numeric", month: "short" })}
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

      {data.forecast?.daily?.length > 0 && <ForecastStrip forecast={data.forecast} />}

      <div className="rain-seg">
        {[["daily", "Daily"], ["weekly", "Weekly"], ["monthly", "Monthly"]].map(([k, label]) => (
          <button key={k} className={mode === k ? "on" : ""} onClick={() => setMode(k)}>{label}</button>
        ))}
      </div>

      {mode === "daily" && (
        <>
          <div className="section-title">Last 14 days</div>
          <BarCard
            items={data.days.map((d) => ({ key: d.date, mm: d.mm, label: d.date.slice(8), est: d.estimated, source: d.source }))}
            emptyText="No readings in this window."
          />
          {data.days.some((d) => d.estimated) && <EstLegend />}
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
              est: w.estimated_days > 0,
            }))}
            emptyText="No readings in the last 12 weeks."
          />
          {data.weeks.some((w) => w.estimated_days) && <EstLegend some />}
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
                est: m.estimated_days > 0,
              };
            })}
            emptyText="No readings in the last 12 months."
            showNorm
          />
          <div className="card rain-legend">
            <span><i className="sw actual" /> recorded</span>
            <span><i className="sw norm" /> monthly norm</span>
            {data.months.some((m) => m.estimated_days) && <span><i className="sw est" /> includes estimated days</span>}
          </div>
        </>
      )}

      <div className="section-title">Season · from {fmtDate(data.season.start)}</div>
      {data.seasons?.length > 0 && <SeasonChart seasons={data.seasons} />}
      <div className="card">
        <div className="kv"><span>Season to date</span><b>{fmt(data.season.total_mm)} mm</b></div>
        <div className="rain-season-track">
          <div className="fill" style={{ width: `${seasonPct}%` }} />
          <span className="norm">norm {SEASON_NORM_MM} mm</span>
        </div>
        <div className="kv"><span>Rain days</span><b>{data.season.rain_days}</b></div>
        {data.season.wettest_day && (
          <div className="kv"><span>Wettest day</span>
            <b>{fmt(data.season.wettest_day.mm)} mm · {fmtDate(data.season.wettest_day.date)}{data.season.wettest_day.estimated ? " (estimated)" : ""}</b>
          </div>
        )}
        {data.season.estimated_days > 0 && (
          <p className="evidence-note" style={{ textAlign: "left", marginTop: 8 }}>
            Includes {data.season.estimated_days} day{data.season.estimated_days === 1 ? "" : "s"} without a gauge reading, estimated from public records (Open-Meteo, NASA POWER).
          </p>
        )}
        <p className="evidence-note" style={{ textAlign: "left", marginTop: 8 }}>
          A gauge reading of 15 mm or more in 24 hours suppresses tomorrow&apos;s irrigation shifts automatically (rule T2).
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
          <div className="rain-bar" key={i.key} title={`${i.key}: ${fmt(i.mm)} mm${i.est ? ` (${i.source ? `estimated, ${SOURCE_NAME[i.source]}` : "includes estimates"})` : ""}`}>
            <span className="v">{i.mm > 0 ? fmt(i.mm) : ""}</span>
            <div className="stack" style={{ height: H }}>
              {showNorm && i.norm !== undefined && (
                <div className="bar ghost" style={{ height: `${Math.max(2, (i.norm / max) * H)}px` }} />
              )}
              <div className={`bar ${i.est ? "est" : ""}`} data-dry={i.mm === 0}
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

const SOURCE_NAME = { gauge: "farm gauge", "open-meteo": "Open-Meteo", nasa: "NASA POWER" };

function EstLegend({ some }) {
  return (
    <div className="card rain-legend">
      <span><i className="sw actual" /> farm gauge</span>
      <span><i className="sw est" /> {some ? "includes estimated days" : "estimated (no gauge reading)"}</span>
    </div>
  );
}

// Next-7-days forecast strip (Open-Meteo). Droplet opacity tracks probability;
// a heavy-rain day (>= 15 mm at >= 60%) is flagged because it will trigger the
// T2 suppression automatically.
function ForecastStrip({ forecast }) {
  const ageH = Math.round((Date.now() - new Date(forecast.fetched_at).getTime()) / 3_600_000);
  return (
    <>
      <div className="section-title">Next 7 days · forecast{ageH > 24 ? ` (stale, ${ageH}h old)` : ""}</div>
      <div className="card rain-fc">
        {forecast.daily.slice(0, 7).map((d, i) => {
          const heavy = d.rain_mm >= 15 && d.prob_pct >= 60;
          return (
            <div className={`fc-day ${heavy ? "heavy" : ""}`} key={d.date}>
              <span className="fd">{i === 0 ? "Today" : dayLabel(d.date)}</span>
              <svg width="16" height="20" viewBox="0 0 16 20" style={{ opacity: Math.max(0.15, d.prob_pct / 100) }}>
                <path d="M8 1 C9.5 5 14 9 14 13 a6 6 0 1 1 -12 0 C2 9 6.5 5 8 1 Z"
                  fill="#2980b9" />
              </svg>
              <span className="fmm">{d.rain_mm > 0 ? `${fmt(d.rain_mm)}` : "–"}</span>
              <span className="fpp">{d.prob_pct}%</span>
              <span className="ft">{Math.round(d.tmax)}°<i>{Math.round(d.tmin)}°</i></span>
              {heavy && <span className="fflag">T2</span>}
            </div>
          );
        })}
      </div>
    </>
  );
}

// Cumulative curves: this season (solid blue), last season (solid earth), and
// the climate norm (dashed grey), on a shared day-of-season axis Oct..Sep.
function SeasonChart({ seasons }) {
  const W = 340, H = 168, PAD_L = 34, PAD_B = 22, PAD_T = 10;
  const plotW = W - PAD_L - 6, plotH = H - PAD_T - PAD_B;
  const maxMm = Math.max(
    SEASON_NORM_MM,
    ...seasons.map((s) => s.total_mm),
  ) * 1.05;
  const x = (d) => PAD_L + (Math.min(d, 366) / 366) * plotW;
  const y = (mm) => PAD_T + plotH - (mm / maxMm) * plotH;
  const path = (pts) => pts.length
    ? `M ${x(0)} ${y(0)} ` + pts.map((p) => `L ${x(p.d)} ${y(p.mm)}`).join(" ")
    : "";

  const current = seasons.find((s) => s.current);
  const previous = seasons.find((s) => !s.current);
  const currentEnd = current?.points.at(-1);

  const gridLines = [200, 400, 600, 800].filter((g) => g < maxMm);
  const monthTicks = SEASON_MONTHS.map((m, i) => ({
    label: "ONDJFMAMJJAS"[i],
    d: SEASON_MONTHS.slice(0, i).reduce((a, mo) => a + MONTH_DAYS[mo], 0),
  }));

  return (
    <div className="card rain-cmp">
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", display: "block" }}>
        {gridLines.map((g) => (
          <g key={g}>
            <line x1={PAD_L} y1={y(g)} x2={W - 6} y2={y(g)} stroke="var(--bl)" strokeWidth="1" />
            <text x={PAD_L - 5} y={y(g) + 3} textAnchor="end" fontSize="8.5" fill="var(--tm)">{g}</text>
          </g>
        ))}
        {monthTicks.map((t) => (
          <text key={t.d} x={x(t.d + 15)} y={H - 8} textAnchor="middle" fontSize="8.5" fill="var(--tm)">{t.label}</text>
        ))}
        <line x1={PAD_L} y1={y(0)} x2={W - 6} y2={y(0)} stroke="var(--bd)" strokeWidth="1" />

        <path d={path(NORM_CURVE)} fill="none" stroke="var(--tm)" strokeWidth="1.5"
          strokeDasharray="4 4" opacity=".7" />
        {previous && (
          <path d={path(previous.points)} fill="none" stroke="#a07c4f" strokeWidth="2.2"
            strokeLinejoin="round" opacity=".85" />
        )}
        {current && (
          <path d={path(current.points)} fill="none" stroke="var(--b5)" strokeWidth="2.8"
            strokeLinejoin="round" />
        )}
        {currentEnd && (
          <g>
            <circle cx={x(currentEnd.d)} cy={y(currentEnd.mm)} r="4" fill="var(--b5)"
              stroke="#fff" strokeWidth="1.5" />
            <text x={Math.min(x(currentEnd.d) + 6, W - 40)} y={y(currentEnd.mm) - 7}
              fontSize="9.5" fontWeight="700" fill="#1b5e8a">{fmt(currentEnd.mm)}</text>
          </g>
        )}
      </svg>
      <div className="rain-legend" style={{ paddingTop: 4 }}>
        {current && <span><i className="sw line-cur" /> {current.label}</span>}
        {previous && <span><i className="sw line-prev" /> {previous.label}</span>}
        <span><i className="sw line-norm" /> norm</span>
      </div>
      {previous && current && (
        <p className="evidence-note" style={{ textAlign: "left", padding: "0 2px 4px" }}>
          {seasonVerdict(current, previous)}
        </p>
      )}
    </div>
  );
}

// Compare like with like: last season's cumulative total at the same
// day-of-season as this season's latest reading.
function seasonVerdict(current, previous) {
  const day = current.points.at(-1)?.d ?? 0;
  const prevAtSameDay = [...previous.points].reverse().find((p) => p.d <= day)?.mm ?? 0;
  const nowMm = current.total_mm;
  const diff = Math.round((nowMm - prevAtSameDay) * 10) / 10;
  if (Math.abs(diff) < 10) return `Tracking last season almost exactly at this point (${fmt(prevAtSameDay)} mm by the same day).`;
  return diff > 0
    ? `${fmt(diff)} mm ahead of last season at this point (${fmt(prevAtSameDay)} mm by the same day).`
    : `${fmt(-diff)} mm behind last season at this point (${fmt(prevAtSameDay)} mm by the same day).`;
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
const dayLabel = (d) => new Date(d + "T12:00:00Z").toLocaleDateString("en-GB", { weekday: "short" });
const wkLabel = (d) => new Date(d + "T12:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short" });
const moLabel = (m) => new Date(m + "-15T12:00:00Z").toLocaleDateString("en-GB", { month: "short" });
