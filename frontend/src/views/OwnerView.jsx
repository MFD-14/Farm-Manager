// Owner console (spec 4.5, 6.2): exceptions-first digest, the decision queue
// with claim-versus-evidence side by side, and the KPI board.
import React, { useEffect, useState, useCallback } from "react";
import { apiJson, mediaObjectUrl } from "../lib/api.js";

function EvidencePhoto({ mediaUuid }) {
  const [src, setSrc] = useState(null);
  useEffect(() => {
    let url = null;
    let cancelled = false;
    mediaObjectUrl(mediaUuid)
      .then((u) => { url = u; if (!cancelled) setSrc(u); })
      .catch(() => {});
    return () => { cancelled = true; if (url) URL.revokeObjectURL(url); };
  }, [mediaUuid]);
  if (!src) return <div className="evidence-note" style={{ padding: 12 }}>Loading photo…</div>;
  return <img src={src} alt="" style={{ width: "100%", borderRadius: 10, marginTop: 8 }} />;
}

export default function OwnerView({ tab }) {
  if (tab === "decisions") return <Decisions />;
  if (tab === "kpis") return <Kpis />;
  return <Digest />;
}

function Digest() {
  const [digest, setDigest] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => {
    apiJson("/api/owner/digest").then(setDigest).catch((e) => setErr(e.message));
  }, []);
  if (err) return <div className="empty">Cannot load digest: {err}</div>;
  if (!digest) return <div className="empty">Loading…</div>;
  const c = digest.completion;
  return (
    <div className="wrap">
      <div className="daytitle">Daily digest · {digest.date}</div>
      <div className="stat-row">
        <div className="stat"><div className="v">{c.verified}/{c.total}</div><div className="l">verified</div></div>
        <div className="stat"><div className="v">{c.missed}</div><div className="l">missed</div></div>
        <div className="stat"><div className="v">{digest.water.tank_pct ?? "–"}%</div><div className="l">tank</div></div>
      </div>
      <div className="card">
        <div className="kv"><span>Rain today</span><b>{digest.water.rain_mm ?? 0} mm</b></div>
        {digest.water.rain_expected_tomorrow && (
          <div className="kv"><span>Rain expected tomorrow</span>
            <b>{digest.water.rain_expected_tomorrow.mm} mm · {digest.water.rain_expected_tomorrow.prob_pct}%</b>
          </div>
        )}
        <div className="kv"><span>Litres pumped</span><b>{digest.water.litres_pumped.toLocaleString()}</b></div>
        <div className="kv"><span>Bundles harvested</span><b>{digest.money.bundles_harvested}</b></div>
        <div className="kv"><span>Bundles sold</span><b>{digest.money.bundles_sold}</b></div>
        <div className="kv"><span>Sales recorded</span><b>${digest.money.sales_usd}</b></div>
        <div className="kv"><span>Cash variance</span><b>{digest.money.cash_variance ?? "–"}</b></div>
      </div>
      <div className="section-title">Exceptions needing you ({digest.exceptions.length})</div>
      {digest.exceptions.length === 0 && <div className="empty">Nothing needs a decision.</div>}
      {digest.exceptions.map((ex, i) => (
        <div className="card" key={i}>
          <div className="row">
            <h3>{ex.title || ex.kind}</h3>
            {ex.state && <span className={`chip state-${ex.state}`}>{ex.state.replaceAll("_", " ")}</span>}
          </div>
          {ex.code && <div className="meta"><span>{ex.code}</span></div>}
          {ex.kind === "cash_variance" && <div className="meta"><span>variance ${ex.value}</span></div>}
        </div>
      ))}
    </div>
  );
}

function Decisions() {
  const [items, setItems] = useState(null);
  const [detail, setDetail] = useState(null);

  const refresh = useCallback(() => {
    apiJson("/api/instances?state=decisions").then((r) => setItems(r.instances)).catch(() => setItems([]));
  }, []);
  useEffect(refresh, [refresh]);

  async function decide(id, action, note) {
    await apiJson(`/api/instances/${id}/decision`, { method: "POST", body: { action, note } });
    setDetail(null);
    refresh();
  }

  if (!items) return <div className="empty">Loading…</div>;
  return (
    <div className="wrap">
      <div className="daytitle">Decision queue</div>
      {items.length === 0 && <div className="empty">Queue is clear.</div>}
      {items.map((i) => (
        <div className="card" key={i.id} data-priority={i.priority} onClick={() => {
          apiJson(`/api/instances/${i.id}`).then(setDetail);
        }}>
          <div className="row">
            <h3>{i.title}</h3>
            <span className={`chip state-${i.state}`}>{i.state.replaceAll("_", " ")}</span>
          </div>
          <div className="meta"><span>{i.template_code}</span><span className={`chip ${i.priority}`}>{i.priority}</span></div>
        </div>
      ))}
      {detail && (
        <div className="sheet" onClick={() => setDetail(null)}>
          <div className="panel" onClick={(e) => e.stopPropagation()}>
            <h2>{detail.instance.title}</h2>
            <div className="code">{detail.instance.template_code} · {detail.instance.state}</div>

            <div className="section-title">Caretaker claim</div>
            <div className="card">
              {Object.entries(detail.instance.evidence_summary?.fields || {}).map(([k, v]) => (
                <div className="kv" key={k}><span>{k}</span><b>{String(v)}</b></div>
              ))}
              {(detail.media || []).filter((m) => m.status === "stored" && m.kind === "photo").map((m) => (
                <EvidencePhoto key={m.media_uuid} mediaUuid={m.media_uuid} />
              ))}
            </div>

            {(detail.verdicts || []).length > 0 && (
              <>
                <div className="section-title">Machine verdicts</div>
                {detail.verdicts.map((v, i) => (
                  <div className="verdict" key={i}>
                    <div className="kv">
                      <span>{v.extracted?.engine === "claude" ? `Claude (${v.extracted.model || v.model_version})` : v.model_version}</span>
                      <b>{v.verdict} · {Math.round(v.confidence * 100)}%</b>
                    </div>
                    {v.extracted?.reason && <p className="verdict-reason">{v.extracted.reason}</p>}
                    {v.extracted?.matches_report && v.extracted.matches_report !== "nothing_reported" && (
                      <div className="verdict-meta">Matches what was reported: {v.extracted.matches_report}</div>
                    )}
                    {(v.extracted?.readings || []).length > 0 && (
                      <div className="verdict-meta">Read from photo: {v.extracted.readings.map((r) => `${r.name} ${r.value}`).join(", ")}</div>
                    )}
                  </div>
                ))}
              </>
            )}

            <div className="section-title">Events</div>
            {(detail.events || []).map((e) => (
              <div className="kv" key={e.event_uuid}>
                <span>{e.type.replaceAll("_", " ")}</span>
                <span style={{ color: "var(--tm)", fontSize: 12 }}>
                  {new Date(e.server_time).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                </span>
              </div>
            ))}

            <div style={{ display: "flex", gap: 8, marginTop: 16, flexWrap: "wrap" }}>
              {detail.instance.state === "needs_review" && <>
                <button className="btn primary" style={{ flex: 1 }} onClick={() => decide(detail.instance.id, "verify")}>Approve</button>
                <button className="btn danger" style={{ flex: 1 }} onClick={() => decide(detail.instance.id, "reject")}>Reject</button>
              </>}
              {detail.instance.state === "skip_pending" && <>
                <button className="btn primary" style={{ flex: 1 }} onClick={() => decide(detail.instance.id, "approve_skip")}>Approve skip</button>
                <button className="btn danger" style={{ flex: 1 }} onClick={() => decide(detail.instance.id, "deny_skip")}>Deny skip</button>
              </>}
              {detail.instance.state === "blocked" && (
                <button className="btn primary" style={{ flex: 1 }} onClick={() => decide(detail.instance.id, "unblock")}>Unblock</button>
              )}
              <button className="btn ghost" style={{ flex: 1 }} onClick={() => decide(detail.instance.id, "cancel")}>Cancel task</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Kpis() {
  const [kpis, setKpis] = useState(null);
  const [period, setPeriod] = useState(7);
  useEffect(() => {
    apiJson(`/api/owner/kpis?period=${period}`).then(setKpis).catch(() => setKpis({}));
  }, [period]);
  if (!kpis) return <div className="empty">Loading…</div>;
  const rows = [
    ["On-time verified P0/P1", pct(kpis.on_time_verified_p1_pct), ">= 90%"],
    ["Overall completion", pct(kpis.overall_completion_pct), ">= 85%"],
    ["Auto-verification", pct(kpis.auto_verification_pct), ">= 60%"],
    ["Evidence integrity flags", kpis.evidence_integrity_flags, "0"],
    ["Median sync latency", kpis.median_sync_latency_s != null ? `${kpis.median_sync_latency_s}s` : "–", "< 6h"],
    ["Kale bundles, daily mean", kpis.kale_bundles_daily_mean, "330–400"],
    ["Revenue recorded", `$${kpis.revenue_recorded_usd ?? 0}`, "$10–12k/mo"],
    ["Water pumped", `${((kpis.water_pumped_l ?? 0) / 1000).toFixed(1)} m³`, "90–110% plan"],
    ["Litres per bundle", kpis.water_l_per_bundle ?? "–", "declining"],
    ["Cattle BCS median", kpis.cattle_bcs_median ?? "–", "2.5 → 3.0"],
    ["Poultry mortality (sum)", kpis.poultry_mortality_sum ?? 0, "< 0.5%/wk"],
    ["PM compliance", pct(kpis.pm_compliance_pct), ">= 90%"],
    ["VIM agreement", pct(kpis.vim_agreement_pct), ">= 85%"],
    ["Escalations to owner", kpis.escalations_to_owner ?? 0, "declining"],
    ["Dark-farm incidents", kpis.dark_farm_incidents ?? 0, "0"],
  ];
  return (
    <div className="wrap">
      <div className="daytitle">KPIs · last {period} days</div>
      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        {[7, 30, 90].map((p) => (
          <button key={p} className={`btn ${p === period ? "primary" : "ghost"}`} onClick={() => setPeriod(p)}>{p}d</button>
        ))}
      </div>
      <div className="card">
        {rows.map(([label, value, target]) => (
          <div className="kv" key={label}>
            <span>{label} <span style={{ color: "var(--tm)", fontSize: 11 }}>({target})</span></span>
            <b>{value ?? "–"}</b>
          </div>
        ))}
      </div>
    </div>
  );
}

const pct = (v) => (v == null ? "–" : `${v}%`);
