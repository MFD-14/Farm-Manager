// Logs: what has been recorded on the farm, newest first, with the readings
// each record carries. Time & Attendance is the same list narrowed to the
// weekly attendance and wage sheet (F-02), under the clock in and out card.
// Cached for offline reading.
import React, { useEffect, useState } from "react";
import { apiJson } from "../lib/api.js";
import { metaGet, metaSet } from "../lib/db.js";

const RECORDED = new Set(["done_reported", "needs_review", "verified_closed", "skipped", "missed"]);
const STATE_LABEL = { done_reported: "reported", needs_review: "awaiting acceptance", verified_closed: "accepted",
  skipped: "skipped", missed: "missed" };
const label = (k) => k.replace(/_/g, " ");

export default function LogsView({ codes, title = "Logs", empty = "Nothing recorded yet.", children }) {
  const [rows, setRows] = useState(null);

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
  return (
    <div className="wrap">
      <div className="daytitle">{title}</div>
      {children}
      {!rows && <div className="empty">Loading…</div>}
      {rows && !list.length && <div className="empty">{empty}</div>}
      {list.map((i) => {
        const fields = Object.entries(i.evidence_summary?.fields || {}).filter(([, v]) => v !== "" && v !== null && typeof v !== "object");
        return (
          <div className="card" key={i.id}>
            <div className="row">
              <h3>{i.template_code} {i.title}</h3>
              <span className={`chip state-${i.state}`}>{STATE_LABEL[i.state]}</span>
            </div>
            {fields.length > 0 && <div className="meta">{fields.map(([k, v]) => <span key={k}>{label(k)}: <b>{String(v)}</b></span>)}</div>}
            <div className="meta"><span>{new Date(i.closed_at || i.updated_at || i.due_at).toLocaleString("en-GB",
              { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span></div>
          </div>
        );
      })}
    </div>
  );
}
