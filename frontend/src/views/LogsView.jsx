// Logs: what has been recorded on the farm, newest first, with the readings
// each record carries. Time & Attendance is the same list narrowed to the
// weekly attendance and wage sheet (F-02), under the clock in and out card;
// Sales uses the same list for the earlier daily C-02 sales records.
// The full Logs list also carries farm records (harvests, plantings,
// activities with cost, feed, health, breeding). Cached for offline reading.
import React, { useEffect, useState } from "react";
import { apiJson } from "../lib/api.js";
import { metaGet, metaSet } from "../lib/db.js";
import { useRecords } from "../lib/records.js";

const RECORDED = new Set(["done_reported", "needs_review", "verified_closed", "skipped", "missed"]);
const STATE_LABEL = { done_reported: "reported", needs_review: "awaiting acceptance", verified_closed: "accepted",
  skipped: "skipped", missed: "missed" };
const NAMES = { price_usd: "received $" };
const label = (k) => NAMES[k] || k.replace(/_/g, " ");
const KIND = { sale: "Sale", harvest: "Harvest", planting: "Planting", activity: "Activity", feed: "Feed", health: "Health", breeding: "Breeding", field: "Field added" };
const when = (t) => new Date(t).toLocaleString("en-GB",
  { timeZone: "Africa/Harare", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

// listInChildren: the caller draws the list itself (Sales merges the earlier
// C-02 records with its sale records).
export default function LogsView({ codes, title = "Logs", empty = "Nothing recorded yet.", children, showCosts, listInChildren }) {
  const [rows, setRows] = useState(null);
  const { records } = useRecords();

  useEffect(() => {
    (async () => {
      const cached = await metaGet("logs_cache");
      if (cached) setRows(cached);
      try {
        const fresh = (await apiJson("/api/instances")).instances.filter((i) => RECORDED.has(i.state));
        setRows(fresh);
        await metaSet("logs_cache", fresh);
      } catch { /* offline: cached list stands */ }
    })();
  }, []);

  const list = (rows || []).filter((i) => !codes || codes.includes(i.template_code));
  // Tasks and farm records together, newest first (the full Logs list only).
  const items = [...list.map((i) => ({ at: i.closed_at || i.updated_at || i.due_at, task: i })),
    ...(codes ? [] : (records || []).map((r) => ({ at: r.device_time || r.server_time, rec: r })))]
    .sort((a, b) => new Date(b.at) - new Date(a.at));
  return (
    <div className="wrap">
      <div className="daytitle">{title}</div>
      {typeof children === "function" ? children(list) : children}
      {!rows && <div className="empty">Loading…</div>}
      {rows && !items.length && !listInChildren && <div className="empty">{empty}</div>}
      {!listInChildren && items.map(({ task: i, rec, at }) => {
        if (rec) {
          const r = rec.record;
          return (
            <div className="card" key={rec.event_uuid}>
              <div className="row">
                <h3>{KIND[r.type]} · {r.type === "sale" ? `${r.product} to ${r.buyer}` : r.crop || r.activity || r.feed || r.kind || r.animal || r.name}</h3>
                {r.quantity != null && <b>{r.quantity.toLocaleString()} {r.unit}</b>}
              </div>
              <div className="meta">
                {(r.location || r.group) && <span>{r.location || r.group}</span>}
                {showCosts && r.cost_usd ? <span>cost: <b>${r.cost_usd}</b></span> : null}
                {showCosts && r.price_usd != null ? <span>received: <b>${r.price_usd}</b></span> : null}
                {r.payment && <span>{r.payment}</span>}
                {r.status && <span>{r.status}</span>}
                <span>{rec.by}</span>
                {rec.queued && <span className="chip sync-pending">waiting to sync</span>}
              </div>
              {r.notes && <p className="farm-notes">{r.notes}</p>}
              <div className="meta"><span>{when(at)}</span></div>
            </div>
          );
        }
        const fields = Object.entries(i.evidence_summary?.fields || {}).filter(([, v]) => v !== "" && v !== null && typeof v !== "object");
        return (
          <div className="card" key={i.id}>
            <div className="row">
              <h3>{i.template_code} {i.title}</h3>
              <span className={`chip state-${i.state}`}>{STATE_LABEL[i.state]}</span>
            </div>
            {fields.length > 0 && <div className="meta">{fields.map(([k, v]) => <span key={k}>{label(k)}: <b>{String(v)}</b></span>)}</div>}
            <div className="meta"><span>{when(at)}</span></div>
          </div>
        );
      })}
    </div>
  );
}
