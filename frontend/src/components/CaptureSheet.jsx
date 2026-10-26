// The capture sheet implements the sub-minute flows of spec 5.2: number pad
// pre-focused, camera pre-set, Done disabled until the evidence policy is
// satisfiable, Skip and Problem always one tap away and always cheaper than
// silence (spec 4.3).
import React, { useEffect, useMemo, useState } from "react";
import { reportDone, requestSkip, flagProblem, evidenceReady, attachToTask, SKIP_REASONS } from "../lib/capture.js";
import Attachments from "./Attachments.jsx";
import { metaGet } from "../lib/db.js";

export default function CaptureSheet({ instance, onClose }) {
  const policy = useMemo(
    () => instance.params?.evidence_policy_resolved || instance.template_evidence_policy || { classes: ["E0"] },
    [instance]);
  const [fields, setFields] = useState({});
  const [mediaItems, setMediaItems] = useState([]);
  const [mode, setMode] = useState("capture"); // capture | skip | problem
  const [skipReason, setSkipReason] = useState(SKIP_REASONS[0]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [lastValues, setLastValues] = useState(null);
  const [rainAhead, setRainAhead] = useState(null);

  const isSpray = policy.vim_profile === "spray_scene" || policy.inventory_out;

  useEffect(() => {
    (async () => {
      // AgriWebb pattern: show the previous entry beside each field.
      const lv = (await metaGet("last_values")) || {};
      setLastValues(lv[instance.template_code] || null);
      // Agworld pattern: warn before spraying into forecast rain.
      if (isSpray) {
        const rc = await metaGet("rain_cache");
        const next24 = rc?.forecast?.daily?.slice(0, 2) || [];
        const wet = next24.find((d) => d.rain_mm >= 5 && d.prob_pct >= 50);
        if (wet) setRainAhead(wet);
      }
    })();
  }, [instance.template_code, isSpray]);

  const photos = mediaItems.filter((m) => m.kind === "photo").length;
  const videos = mediaItems.filter((m) => m.kind === "video").length;
  const voices = mediaItems.filter((m) => m.kind === "audio").length;
  const ready = evidenceReady(policy, { fields, photos, videos, voices });
  const isOpen = ["released", "acknowledged", "in_progress"].includes(instance.state);

  async function submitDone() {
    setBusy(true);
    await reportDone(instance, { fields, mediaItems });
    onClose();
  }
  async function submitSkip() {
    setBusy(true);
    await requestSkip(instance, skipReason, note);
    onClose();
  }
  async function submitProblem() {
    setBusy(true);
    const voice = mediaItems.find((m) => m.kind === "audio");
    await flagProblem(instance, "other", note, voice);
    const rest = mediaItems.filter((m) => m !== voice);
    if (rest.length) await attachToTask(instance, rest);
    onClose();
  }
  async function submitExtra() {
    setBusy(true);
    await attachToTask(instance, mediaItems);
    onClose();
  }

  const needsPhoto = policy.classes?.includes("E2") || policy.classes?.includes("E3") || policy.any_of?.includes("E2");
  const needsVideo = policy.classes?.includes("E4");
  const needsVoice = policy.classes?.includes("E5");
  const photoMin = policy.photo_min ?? (policy.classes?.includes("E3") ? 2 : needsPhoto ? 1 : 0);

  return (
    <div className="sheet" onClick={onClose}>
      <div className="panel" onClick={(e) => e.stopPropagation()}>
        <h2>{instance.title}</h2>
        <div className="code">
          {instance.template_code} · {instance.priority}
          {instance.params?.litres ? ` · ${instance.params.minutes} min · ${instance.params.litres} L` : ""}
        </div>

        {instance.params?.basis?.method === "water_balance" && (
          <div className="instructions">
            Replacing {instance.params.basis.replacing_mm} mm of a {instance.params.basis.deficit_mm} mm
            soil-water deficit (computed from ET and rain).
          </div>
        )}

        {instance.retake_reason && <div className="retake">Sent back: {instance.retake_reason}</div>}

        {instance.params?.rotation?.last_product && isOpen && (
          <div className="retake">
            Last fall armyworm spray: {instance.params.rotation.last_product}
            {instance.params.rotation.last_irac_group ? ` (group ${instance.params.rotation.last_irac_group})` : ""}.
            {" "}Use a different group
            {instance.params.rotation.use_instead?.length
              ? `: ${instance.params.rotation.use_instead.filter((o) => o.in_stock).map((o) => `${o.product} (group ${o.irac_group})`).join(" or ") || "none in stock, ask the owner"}`
              : ""}.
          </div>
        )}

        {rainAhead && isOpen && (
          <div className="retake">
            Rain forecast ({rainAhead.rain_mm} mm, {rainAhead.prob_pct}%) within 24–48 h —
            spray may wash off. Consider waiting.
          </div>
        )}

        {(instance.instructions || []).length > 0 && (
          <div className="instructions">
            {(instance.instructions || []).map((s, i) => <div key={i}>{s.text}</div>)}
          </div>
        )}

        {!isOpen && (
          <p className="evidence-note">
            This task is {instance.state.replaceAll("_", " ")}.
            {["done_reported", "needs_review"].includes(instance.state) && " An owner or task manager will check the evidence and accept it."}
          </p>
        )}
        {["done_reported", "needs_review", "blocked", "skip_pending"].includes(instance.state) && (
          <>
            <div className="section-title">Add more evidence</div>
            <Attachments items={mediaItems} setItems={setMediaItems} taskCode={instance.template_code} />
            {mediaItems.length > 0 && (
              <button className="btn primary block" disabled={busy} onClick={submitExtra}>
                {busy ? "Saving…" : `Add ${mediaItems.length} to this task`}
              </button>
            )}
          </>
        )}

        {isOpen && mode === "capture" && (
          <>
            {(policy.fields || []).map((f) => (
              <div className="field" key={f.key}>
                <label>
                  {f.label || f.key}{f.unit ? ` (${f.unit})` : ""}
                  {lastValues?.fields?.[f.key] !== undefined && (
                    <span className="last-hint"> · last: {String(lastValues.fields[f.key])}</span>
                  )}
                </label>
                {f.type === "choice" ? (
                  <select value={fields[f.key] || ""} onChange={(e) => setFields({ ...fields, [f.key]: e.target.value })}>
                    <option value="">—</option>
                    {f.options.map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
                ) : (
                  <input
                    type={f.type === "number" ? "number" : "text"}
                    inputMode={f.type === "number" ? "decimal" : "text"}
                    value={fields[f.key] ?? ""}
                    onChange={(e) => setFields({ ...fields, [f.key]: e.target.value })}
                  />
                )}
              </div>
            ))}

            <div className="field">
              <label>
                Evidence
                {photoMin > 0 && ` · photo ${photos}/${photoMin}${policy.pair ? " (before and after)" : ""}`}
                {needsVideo && ` · video ${videos}/1`}
                {needsVoice && ` · voice note ${voices}/1`}
                {!photoMin && !needsVideo && !needsVoice && " (optional)"}
              </label>
              <Attachments items={mediaItems} setItems={setMediaItems} taskCode={instance.template_code}
                need={{ photo: photos < photoMin, video: needsVideo && !videos, voice: needsVoice && !voices }} />
            </div>

            <button className="btn primary block" disabled={!ready || busy} onClick={submitDone}>
              {busy ? "Saving…" : "Done"}
            </button>
            {!ready && <p className="evidence-note">Fill the required evidence to enable Done.</p>}

            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <button className="btn warn" style={{ flex: 1 }} onClick={() => setMode("skip")}>Skip…</button>
              <button className="btn danger" style={{ flex: 1 }} onClick={() => setMode("problem")}>Problem…</button>
            </div>
          </>
        )}

        {isOpen && mode === "skip" && (
          <>
            <div className="field">
              <label>Why is it skipped?</label>
              <select value={skipReason} onChange={(e) => setSkipReason(e.target.value)}>
                {SKIP_REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
            <div className="field">
              <label>Note (optional)</label>
              <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
            <button className="btn warn block" disabled={busy} onClick={submitSkip}>Request skip</button>
            <button className="btn ghost block" onClick={() => setMode("capture")}>Back</button>
          </>
        )}

        {isOpen && mode === "problem" && (
          <>
            <div className="field">
              <label>What is wrong?</label>
              <textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)}
                placeholder="Describe the problem, or record a voice note…" />
            </div>
            <Attachments items={mediaItems} setItems={setMediaItems} taskCode={instance.template_code} />
            <button className="btn danger block" disabled={busy} onClick={submitProblem}>Flag problem</button>
            <button className="btn ghost block" onClick={() => setMode("capture")}>Back</button>
          </>
        )}
      </div>
    </div>
  );
}
