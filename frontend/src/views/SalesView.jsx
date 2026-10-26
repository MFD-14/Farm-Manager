// Sales: record today's sale (the C-02 task), this week's totals, customers
// built from the buyer on each record, then every sale (the Logs list).
// Money figures are for owners and task managers; the server never sends
// sale amounts to caretakers, who still enter them on the sale form.
import React, { useEffect, useState } from "react";
import { getPlanInstances } from "../lib/db.js";
import CaptureSheet from "../components/CaptureSheet.jsx";
import LogsView from "./LogsView.jsx";

const OPEN = new Set(["released", "acknowledged", "in_progress"]);
const num = (v) => Number(v) || 0;
const usd = (v) => `$${Math.round(v).toLocaleString()}`;

export default function SalesView({ onCountsChanged, showRevenue }) {
  const [task, setTask] = useState(null);
  const [active, setActive] = useState(null);
  const load = async () => setTask((await getPlanInstances()).find((i) => i.template_code === "C-02" && OPEN.has(i.state)) || null);
  useEffect(() => { load(); }, []);

  return (
    <LogsView codes={["C-02"]} title="Sales" empty="No sales recorded yet.">
      {(sales) => {
        const week = sales.filter((s) => Date.now() - new Date(s.closed_at || s.updated_at) < 7 * 86_400_000);
        const total = (list, k) => list.reduce((a, s) => a + num(s.evidence_summary?.fields?.[k]), 0);
        const customers = {};
        for (const s of sales) {
          const f = s.evidence_summary?.fields || {};
          const c = (customers[(f.buyer || "Unnamed buyer").trim()] ||= { sales: 0, bundles: 0, usd: 0 });
          c.sales += 1; c.bundles += num(f.bundles_sold); c.usd += num(f.price_usd);
        }
        return (
          <>
            <button type="button" className="btn primary block" disabled={!task} onClick={() => setActive(task)}>
              {task ? "Record a sale" : "Today's sale is recorded"}
            </button>
            <div className="stat-row">
              {showRevenue && <div className="stat"><div className="v">{usd(total(week, "price_usd"))}</div><div className="l">this week</div></div>}
              <div className="stat"><div className="v">{total(week, "bundles_sold")}</div><div className="l">bundles sold</div></div>
              <div className="stat"><div className="v">{week.length}</div><div className="l">sales</div></div>
            </div>
            {Object.keys(customers).length > 0 && <div className="section-title">Customers</div>}
            {Object.entries(customers).sort((a, b) => b[1].usd - a[1].usd).map(([name, c]) => (
              <div className="kv" key={name}><span>{name} · {c.sales} sale{c.sales === 1 ? "" : "s"}, {c.bundles} bundles</span>{showRevenue && <b>{usd(c.usd)}</b>}</div>
            ))}
            <div className="section-title">All sales</div>
            {active && <CaptureSheet instance={active} onClose={() => { setActive(null); load(); onCountsChanged?.(); }} />}
          </>
        );
      }}
    </LogsView>
  );
}
