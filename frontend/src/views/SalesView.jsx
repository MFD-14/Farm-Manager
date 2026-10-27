// Sales: record any number of sales a day (walk-ins included), this week's
// totals, customers built from the buyer on each sale, then every sale.
// Earlier sales recorded on the old daily C-02 task are included.
// Money figures are for owners and task managers; the server never sends
// sale amounts to caretakers, who still enter them on the sale form.
import React, { useState } from "react";
import { useRecords } from "../lib/records.js";
import RecordForm from "../components/RecordForm.jsx";
import LogsView from "./LogsView.jsx";

const num = (v) => Number(v) || 0;
const usd = (v) => `$${Math.round(v).toLocaleString()}`;
const day = (d) => new Date(d).toLocaleString("en-GB", { timeZone: "Africa/Harare", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export default function SalesView({ onCountsChanged, showRevenue }) {
  const { records, refresh } = useRecords();
  const [adding, setAdding] = useState(false);

  return (
    <LogsView codes={["C-02"]} title="Sales" listInChildren>
      {(older) => {
        // One shape for both: new sale records and earlier C-02 task records.
        const sales = [
          ...(records || []).filter((x) => x.record.type === "sale").map((x) => ({ id: x.event_uuid, at: x.device_time || x.server_time,
            product: x.record.product, qty: num(x.record.quantity), unit: x.record.unit, usd: num(x.record.price_usd),
            buyer: x.record.buyer, payment: x.record.payment, by: x.by, queued: x.queued })),
          ...older.map((i) => ({ id: i.id, at: i.closed_at || i.updated_at, product: "Kale", qty: num(i.evidence_summary?.fields?.bundles_sold),
            unit: "bundles", usd: num(i.evidence_summary?.fields?.price_usd), buyer: i.evidence_summary?.fields?.buyer, older: true })),
        ].sort((a, b) => new Date(b.at) - new Date(a.at));
        const week = sales.filter((s) => Date.now() - new Date(s.at) < 7 * 86_400_000);
        const customers = {};
        for (const s of sales) {
          const c = (customers[(s.buyer || "Unnamed buyer").trim()] ||= { sales: 0, usd: 0 });
          c.sales += 1; c.usd += s.usd;
        }
        return (
          <>
            <button type="button" className="btn primary block" onClick={() => setAdding(true)}>Record a sale</button>
            <div className="stat-row">
              {showRevenue && <div className="stat"><div className="v">{usd(week.reduce((a, s) => a + s.usd, 0))}</div><div className="l">this week</div></div>}
              <div className="stat"><div className="v">{week.filter((s) => s.unit === "bundles").reduce((a, s) => a + s.qty, 0)}</div><div className="l">bundles sold</div></div>
              <div className="stat"><div className="v">{week.length}</div><div className="l">sales this week</div></div>
            </div>
            {Object.keys(customers).length > 0 && <div className="section-title">Customers</div>}
            {Object.entries(customers).sort((a, b) => b[1].sales - a[1].sales).map(([name, c]) => (
              <div className="kv" key={name}><span>{name} · {c.sales} sale{c.sales === 1 ? "" : "s"}</span>{showRevenue && <b>{usd(c.usd)}</b>}</div>
            ))}
            <div className="section-title">All sales</div>
            {!sales.length && <div className="empty">No sales recorded yet.</div>}
            {sales.map((s) => (
              <div className="card" key={s.id}>
                <div className="row"><h3>{s.product} to {s.buyer || "Unnamed buyer"}</h3><b>{s.qty.toLocaleString()} {s.unit}</b></div>
                <div className="meta">
                  {showRevenue && <span>received: <b>{usd(s.usd)}</b></span>}
                  {s.payment && <span>{s.payment}</span>}
                  {s.by && <span>{s.by}</span>}
                  {s.queued && <span className="chip sync-pending">waiting to sync</span>}
                </div>
                <div className="meta"><span>{day(s.at)}</span></div>
              </div>
            ))}
            {adding && <RecordForm type="sale" onClose={(saved) => { setAdding(false); if (saved) { refresh(); onCountsChanged?.(); } }} />}
          </>
        );
      }}
    </LogsView>
  );
}
