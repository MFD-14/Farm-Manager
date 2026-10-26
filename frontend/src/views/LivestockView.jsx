// Livestock records: health (vaccinations, treatments, illness, deworming,
// checkups), breeding (with the next expected birth or hatch counting down)
// and feed (used and, for owners and task managers, cost). Search and filter
// chips per tab; status changes are new records, so they work offline too.
import React, { useState } from "react";
import { useRecords, updateRecord, today } from "../lib/records.js";
import RecordForm from "../components/RecordForm.jsx";

const TABS = { health: "Health", breeding: "Breeding", feed: "Feed" };
const FILTERS = {
  health: ["All", "Vaccination", "Treatment", "Illness", "Deworming", "Checkup"],
  breeding: ["All", "Pregnant", "Delivered", "Failed"],
  feed: ["Today", "This week", "This month"],
};
const day = (d) => (d ? new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "");
const daysTo = (d) => Math.round((new Date(`${d}T12:00:00Z`) - new Date(`${today()}T12:00:00Z`)) / 86_400_000);
const since = (f) => { const d = new Date(`${today()}T12:00:00Z`); d.setUTCDate(d.getUTCDate() - (f === "Today" ? 0 : f === "This week" ? 6 : 29)); return d.toISOString().slice(0, 10); };

export default function LivestockView({ showCosts }) {
  const { records, refresh } = useRecords();
  const [tab, setTab] = useState("health");
  const [filter, setFilter] = useState("All");
  const [search, setSearch] = useState("");
  const [form, setForm] = useState(false);

  const all = (records || []).filter((r) => r.record.type === tab);
  const s = search.trim().toLowerCase();
  const list = all.filter((x) => {
    const r = x.record;
    if (s && ![r.animal, r.group, r.product, r.feed, r.notes].some((t) => String(t || "").toLowerCase().includes(s))) return false;
    if (tab === "health" && filter !== "All") return r.kind === filter;
    if (tab === "breeding" && filter !== "All") return r.status === filter;
    if (tab === "feed") return r.date >= since(filter);
    return true;
  });
  const next = all.filter((x) => x.record.status === "Pregnant" && x.record.expected).sort((a, b) => a.record.expected.localeCompare(b.record.expected))[0];
  const kg = (xs) => xs.reduce((a, x) => a + Number(x.record.quantity || 0) * (x.record.unit === "bags" ? 50 : 1), 0);
  const cost = (xs) => xs.reduce((a, x) => a + Number(x.record.cost_usd || 0), 0);
  const month = all.filter((x) => x.record.date >= since("This month"));
  const change = (x, status) => updateRecord(x.event_uuid, status).then(refresh);

  return (
    <div className="wrap">
      <div className="title-row"><div className="daytitle">Livestock</div>
        <button type="button" className="btn primary" onClick={() => setForm(true)}>+ Add record</button></div>
      <div className="tabs-inline">
        {Object.entries(TABS).map(([k, l]) => <button type="button" key={k} className={tab === k ? "on" : ""}
          onClick={() => { setTab(k); setFilter(FILTERS[k][k === "feed" ? 2 : 0]); }}>{l}</button>)}
      </div>

      {tab === "breeding" && next && (
        <div className="card hero">
          <small>Next expected {next.record.species === "Chicken" ? "hatch" : "birth"}</small>
          <b>{next.record.animal} · {daysTo(next.record.expected) >= 0 ? `${daysTo(next.record.expected)} days left` : `${-daysTo(next.record.expected)} days overdue`}</b>
          <span>{day(next.record.expected)}</span>
        </div>
      )}
      {tab === "feed" && (
        <div className="stat-row">
          <div className="stat"><div className="v">{Math.round(kg(month)).toLocaleString()} kg</div><div className="l">feed this month</div></div>
          {showCosts && <div className="stat"><div className="v">${Math.round(cost(month)).toLocaleString()}</div><div className="l">feed cost this month</div></div>}
        </div>
      )}

      <input className="note-input" placeholder={tab === "feed" ? "Search by animals or feed" : "Search by animal, product or notes"}
        value={search} onChange={(e) => setSearch(e.target.value)} />
      <div className="chips">
        {FILTERS[tab].map((f) => <button type="button" key={f} className={filter === f ? "on" : ""} onClick={() => setFilter(f)}>{f}</button>)}
      </div>
      <p className="farm-sub">{list.length} of {all.length} records</p>

      {!records && <div className="empty">Loading…</div>}
      {records && !list.length && <div className="empty">No {TABS[tab].toLowerCase()} records yet. Use + Add record.</div>}
      {list.map((x) => {
        const r = x.record;
        return (
          <div className="card" key={x.event_uuid}>
            <div className="row">
              <h3>{tab === "feed" ? r.group : r.animal || r.group}</h3>
              {tab === "feed"
                ? <b>{r.quantity} {r.unit}{showCosts && r.cost_usd ? ` · $${r.cost_usd}` : ""}</b>
                : <span className={`chip ${r.status === "Ongoing" || r.status === "Pregnant" ? "state-needs_review" : r.status === "Failed" ? "P1" : "state-verified_closed"}`}>{r.status}</span>}
            </div>
            <div className="meta">
              {tab === "health" && <><span className="chip P3">{r.kind}</span>{r.product && <span>{r.product}</span>}</>}
              {tab === "breeding" && <><span>{r.species}</span><span>Mated {day(r.date)}</span>{r.sire && <span>Sire {r.sire}</span>}
                <span>Expected {day(r.expected)}</span>{r.status === "Pregnant" && <span className="chip state-released">{daysTo(r.expected)} days left</span>}</>}
              {tab === "feed" && <span className="chip P3">{r.feed}</span>}
              {tab !== "breeding" && <span>{day(r.date)}</span>}
              {x.queued && <span className="chip sync-pending">waiting to sync</span>}
            </div>
            {r.notes && <p className="farm-notes">{r.notes}</p>}
            {r.status === "Ongoing" && <div className="person-actions"><button type="button" className="btn ghost" onClick={() => change(x, "Completed")}>Mark completed</button></div>}
            {r.status === "Pregnant" && <div className="person-actions">
              <button type="button" className="btn ghost" onClick={() => change(x, "Delivered")}>{r.species === "Chicken" ? "Hatched" : "Delivered"}</button>
              <button type="button" className="btn ghost" onClick={() => change(x, "Failed")}>Failed</button></div>}
          </div>
        );
      })}
      {form && <RecordForm type={tab} onClose={(saved) => { setForm(false); if (saved) refresh(); }} />}
    </div>
  );
}
