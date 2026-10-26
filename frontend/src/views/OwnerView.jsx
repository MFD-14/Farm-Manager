// Owner console (spec 4.5, 6.2): exceptions-first digest, the review queue
// where owners and task managers accept evidence, and the KPI board.
import React, { useEffect, useState, useCallback } from "react";
import { apiJson, mediaBlob } from "../lib/api.js";
import { queueDecision, pendingDecisions, cachedMediaBlob, cacheMediaBlob, metaGet, metaSet } from "../lib/db.js";
import { drainOnce } from "../lib/sync.js";

// Evidence from the server, kept on the phone after the first look so the
// queue can be reviewed with no signal.
function useMediaUrl(mediaUuid, { cache = true } = {}) {
  const [src, setSrc] = useState(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let url = null;
    let cancelled = false;
    (async () => {
      try {
        let blob = await cachedMediaBlob(mediaUuid);
        if (!blob) {
          blob = await mediaBlob(mediaUuid);
          if (cache) await cacheMediaBlob(mediaUuid, blob);
        }
        url = URL.createObjectURL(blob);
        if (!cancelled) setSrc(url);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => { cancelled = true; if (url) URL.revokeObjectURL(url); };
  }, [mediaUuid, cache]);
  return { src, failed };
}

export function EvidencePhoto({ mediaUuid, onOpen }) {
  const { src, failed } = useMediaUrl(mediaUuid);
  if (failed) return <div className="ev-missing">Photo shows when online</div>;
  if (!src) return <div className="ev-missing">Loading…</div>;
  return <img className="ev-photo" src={src} alt="Evidence" onClick={() => onOpen?.(src)} />;
}

export function EvidencePlayer({ mediaUuid, kind }) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <button type="button" className="ev-play" onClick={() => setOpen(true)}>
        {kind === "video" ? "▶ Play video" : "▶ Play voice note"}
      </button>
    );
  }
  return <PlayerInner mediaUuid={mediaUuid} kind={kind} />;
}
function PlayerInner({ mediaUuid, kind }) {
  const { src, failed } = useMediaUrl(mediaUuid, { cache: kind === "audio" });
  if (failed) return <div className="ev-missing">Plays when online</div>;
  if (!src) return <div className="ev-missing">Loading…</div>;
  return kind === "video"
    ? <video className="ev-video" src={src} controls playsInline />
    : <audio src={src} controls style={{ width: "100%" }} />;
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
  const w = digest.week;
  return (
    <div className="wrap">
      <div className="daytitle">Dashboard</div>
      <p className="farm-sub">Week to date as of {new Date(`${digest.date}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</p>
      {digest.weather && (
        <div className="card weather">
          <b>{Math.round(digest.weather.tmax)}° / {Math.round(digest.weather.tmin)}°C</b>
          <span>{digest.weather.rain_mm > 0 ? `${digest.weather.rain_mm} mm rain (${digest.weather.prob_pct}%)` : "No rain expected"} · Kwekwe</span>
        </div>
      )}
      <div className="week-grid">
        {[["Revenue", w.revenue_usd, (v) => `$${Math.round(v).toLocaleString()}`], ["Bundles harvested", w.bundles_harvested],
          ["New plantings", w.plantings], ["Labour hours", w.labour_hours]].map(([label, p, f = (v) => v]) => (
          <div className="stat" key={label}>
            <div className="l">{label}</div>
            <div className="v">{f(p.now)}</div>
            <div className="l">{p.before ? `${p.now >= p.before ? "+" : ""}${Math.round(((p.now - p.before) / p.before) * 100)}%` : "–"} on last week</div>
          </div>
        ))}
      </div>
      {w.labour_by_person.length > 0 && (
        <div className="card">
          <h3>Labour hours by person</h3>
          {w.labour_by_person.map((p) => <div className="kv" key={p.name}><span>{p.name}</span><b>{p.hours} h</b></div>)}
        </div>
      )}
      <div className="section-title">Today</div>
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

const FLAG_TEXT = {
  awaiting_acceptance: null,
  evidence_short: "Readings or details missing",
  media_not_uploaded: "Photo or video never finished uploading",
  timing_sanity: "Timing looks wrong (done too fast, or the clock was off)",
  harvest_sanity: "Harvest count far from the usual",
  phash_match: "Same photo as an earlier task",
  vim_unusable_after_retake: "Evidence unusable after a retake",
};
const SEND_BACK_REASONS = ["Photo unclear", "Wrong place or item", "Readings missing", "Not done properly"];

function flagLines(flags = []) {
  return (flags || []).map((f) => FLAG_TEXT[f.kind] === undefined ? f.kind.replaceAll("_", " ") : FLAG_TEXT[f.kind]).filter(Boolean);
}

function when(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  return d.toLocaleString("en-GB", { timeZone: "Africa/Harare", weekday: "short", hour: "2-digit", minute: "2-digit" });
}

function DecisionCard({ item, onDecide, onDetail, onZoom }) {
  const [mode, setMode] = useState(null); // null | "send_back"
  const [reason, setReason] = useState("");
  const photos = (item.media || []).filter((m) => m.kind === "photo");
  const players = (item.media || []).filter((m) => m.kind !== "photo");
  const fields = Object.entries(item.evidence_summary?.fields || {});
  const flags = flagLines(item.review_flags);
  return (
    <div className="card dcard" data-priority={item.priority}>
      <div className="row">
        <h3>{item.title}</h3>
        <span className={`chip ${item.priority}`}>{item.priority}</span>
      </div>
      <div className="meta">
        <span>{item.template_code}</span>
        {item.reported?.by && <span>by {item.reported.by}</span>}
        {item.reported?.at && <span>{when(item.reported.at)}</span>}
        {item.reported?.via === "whatsapp" && <span>via WhatsApp</span>}
      </div>
      {flags.length > 0 && <div className="dflags">{flags.map((f) => <div key={f}>⚠ {f}</div>)}</div>}
      {fields.length > 0 && (
        <div className="dfields">{fields.map(([k, v]) => <span key={k}><b>{String(v)}</b> {k.replaceAll("_", " ")}</span>)}</div>
      )}
      {photos.length > 0 && (
        <div className="ev-grid">{photos.map((m) => (
          m.status === "stored"
            ? <EvidencePhoto key={m.media_uuid} mediaUuid={m.media_uuid} onOpen={onZoom} />
            : <div key={m.media_uuid} className="ev-missing">Still uploading</div>
        ))}</div>
      )}
      {players.map((m) => (m.status === "stored"
        ? <EvidencePlayer key={m.media_uuid} mediaUuid={m.media_uuid} kind={m.kind} />
        : <div key={m.media_uuid} className="ev-missing">{m.kind === "video" ? "Video" : "Voice note"} still uploading</div>))}
      {(item.vim || []).map((v, i) => (
        <div className="dvim" key={i}>VIM: {v.verdict}{v.note ? `, ${v.note}` : ""}</div>
      ))}
      {item.state === "skip_pending" && <div className="dflags"><div>Skip requested</div></div>}
      {item.state === "blocked" && <div className="dflags"><div>Problem reported</div></div>}

      {mode === "send_back" ? (
        <div className="sendback">
          <div className="chips-row">{SEND_BACK_REASONS.map((r) => (
            <button type="button" key={r} className={`chip-btn ${reason === r ? "on" : ""}`} onClick={() => setReason(r)}>{r}</button>
          ))}</div>
          <input className="sendback-input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Or type the reason…" />
          <div className="person-actions">
            <button type="button" className="btn danger" disabled={!reason.trim()} onClick={() => onDecide(item, "send_back", reason.trim())}>Send back</button>
            <button type="button" className="btn ghost" onClick={() => setMode(null)}>Cancel</button>
          </div>
        </div>
      ) : (
        <div className="person-actions">
          {item.state === "needs_review" && <>
            <button type="button" className="btn primary" onClick={() => onDecide(item, "accept")}>Accept</button>
            <button type="button" className="btn ghost" onClick={() => setMode("send_back")}>Send back</button>
          </>}
          {item.state === "skip_pending" && <>
            <button type="button" className="btn primary" onClick={() => onDecide(item, "approve_skip")}>Approve skip</button>
            <button type="button" className="btn ghost" onClick={() => onDecide(item, "deny_skip")}>Deny</button>
          </>}
          {item.state === "blocked" && (
            <button type="button" className="btn primary" onClick={() => onDecide(item, "unblock")}>Problem solved</button>
          )}
          <button type="button" className="btn ghost" onClick={() => onDetail(item)}>History</button>
        </div>
      )}
    </div>
  );
}

function Decisions() {
  const [items, setItems] = useState(null);
  const [detail, setDetail] = useState(null);
  const [zoom, setZoom] = useState(null);
  const [offline, setOffline] = useState(false);
  const [queued, setQueued] = useState(0);
  const [confirmAll, setConfirmAll] = useState(false);

  const refresh = useCallback(async () => {
    const pending = new Set((await pendingDecisions()).map((d) => d.instance_id));
    setQueued(pending.size);
    try {
      const r = await apiJson("/api/instances?state=decisions");
      await metaSet("decision_queue", r.instances);
      setItems(r.instances.filter((i) => !pending.has(i.id)));
      setOffline(false);
    } catch {
      const cached = (await metaGet("decision_queue")) || [];
      setItems(cached.filter((i) => !pending.has(i.id)));
      setOffline(true);
    }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  // Decisions go through the outbox, so they work with no signal and replay
  // safely; the card leaves the queue at once.
  async function decide(item, action, note) {
    await queueDecision({ event_uuid: crypto.randomUUID(), instance_id: item.id, action, note: note || null,
      title: `${item.template_code} ${item.title}` });
    setItems((p) => p.filter((i) => i.id !== item.id));
    setQueued((n) => n + 1);
    drainOnce().then(refresh).catch(() => {});
  }
  async function acceptAll(ready) {
    setConfirmAll(false);
    for (const item of ready) {
      await queueDecision({ event_uuid: crypto.randomUUID(), instance_id: item.id, action: "accept", note: null,
        title: `${item.template_code} ${item.title}` });
    }
    const ids = new Set(ready.map((i) => i.id));
    setItems((p) => p.filter((i) => !ids.has(i.id)));
    drainOnce().then(refresh).catch(() => {});
  }

  if (!items) return <div className="empty">Loading…</div>;
  const ready = items.filter((i) => i.ready_to_accept);
  const look = items.filter((i) => i.state === "needs_review" && !i.ready_to_accept);
  const skips = items.filter((i) => i.state === "skip_pending");
  const blocked = items.filter((i) => i.state === "blocked");
  const props = { onDecide: decide, onDetail: (i) => apiJson(`/api/instances/${i.id}`).then(setDetail).catch(() => {}), onZoom: setZoom };

  return (
    <div className="wrap">
      <div className="daytitle">Review</div>
      {offline && <div className="retake">No signal: showing the queue from your last sync. Decisions are saved and sent later.</div>}
      {queued > 0 && <div className="instructions">{queued} decision{queued === 1 ? "" : "s"} waiting to sync.</div>}
      {items.length === 0 && <div className="empty">Nothing waiting. Tasks with photos land here for you to accept.</div>}

      {ready.length > 0 && (
        <>
          <div className="section-title">Ready to accept · {ready.length}</div>
          {ready.length > 1 && (confirmAll ? (
            <div className="card">
              <p className="form-msg" style={{ marginTop: 0 }}>Accept all {ready.length} tasks as complete? Check the photos first if unsure.</p>
              <div className="person-actions">
                <button type="button" className="btn primary" onClick={() => acceptAll(ready)}>Accept all {ready.length}</button>
                <button type="button" className="btn ghost" onClick={() => setConfirmAll(false)}>Cancel</button>
              </div>
            </div>
          ) : (
            <button type="button" className="btn ghost block" onClick={() => setConfirmAll(true)}>Accept all {ready.length}…</button>
          ))}
          {ready.map((i) => <DecisionCard key={i.id} item={i} {...props} />)}
        </>
      )}
      {look.length > 0 && <><div className="section-title">Needs a closer look · {look.length}</div>{look.map((i) => <DecisionCard key={i.id} item={i} {...props} />)}</>}
      {skips.length > 0 && <><div className="section-title">Skip requests · {skips.length}</div>{skips.map((i) => <DecisionCard key={i.id} item={i} {...props} />)}</>}
      {blocked.length > 0 && <><div className="section-title">Problems reported · {blocked.length}</div>{blocked.map((i) => <DecisionCard key={i.id} item={i} {...props} />)}</>}

      {zoom && <div className="zoom" onClick={() => setZoom(null)}><img src={zoom} alt="Evidence" /></div>}
      {detail && (
        <div className="sheet" onClick={() => setDetail(null)}>
          <div className="panel" onClick={(e) => e.stopPropagation()}>
            <h2>{detail.instance.title}</h2>
            <div className="code">{detail.instance.template_code} · {detail.instance.state.replaceAll("_", " ")}</div>
            <div className="section-title">History</div>
            {(detail.events || []).map((e) => (
              <div className="kv" key={e.event_uuid}>
                <span>{e.type.replaceAll("_", " ")}{e.actor_type !== "system" ? ` · ${e.actor_type}` : ""}{e.payload?.note ? `: ${e.payload.note}` : ""}</span>
                <span style={{ color: "var(--tm)", fontSize: 12 }}>
                  {new Date(e.server_time).toLocaleString("en-GB", { timeZone: "Africa/Harare", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                </span>
              </div>
            ))}
            <button type="button" className="btn ghost block" onClick={() => { props.onDecide(detail.instance, "cancel"); setDetail(null); }}>Cancel this task</button>
            <button type="button" className="btn ghost block" onClick={() => setDetail(null)}>Close</button>
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
    ["Accepted first time", pct(kpis.accepted_first_time_pct), ">= 90%"],
    ["Hours to accept (median)", kpis.median_hours_to_accept ?? "–", "< 24h"],
    ["Waiting for acceptance now", kpis.waiting_for_acceptance ?? 0, "low"],
    ["Sent back", kpis.sent_back ?? 0, "declining"],
    ["Evidence integrity flags", kpis.evidence_integrity_flags, "0"],
    ["Median sync latency", kpis.median_sync_latency_s != null ? `${kpis.median_sync_latency_s}s` : "–", "< 6h"],
    ["Kale bundles, daily mean", kpis.kale_bundles_daily_mean, `${kpis.kale_target_bundles_per_day ?? 330}–400`],
    ["Revenue recorded", `$${kpis.revenue_recorded_usd ?? 0}`, "period"],
    ["Revenue, monthly run rate", `$${(kpis.revenue_monthly_run_rate_usd ?? 0).toLocaleString()}`, "$10–12k/mo"],
    ["Layers", kpis.layers_now ?? 0, "1,000+ by Jun 2027"],
    ["Water pumped", `${((kpis.water_pumped_l ?? 0) / 1000).toFixed(1)} m³`, "90–110% plan"],
    ["Litres per bundle", kpis.water_l_per_bundle ?? "–", "declining"],
    ["Cattle BCS median", kpis.cattle_bcs_median ?? "–", "2.5 → 3.0"],
    ["Poultry mortality (sum)", kpis.poultry_mortality_sum ?? 0, "< 0.5%/wk"],
    ["PM compliance", pct(kpis.pm_compliance_pct), ">= 90%"],
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
