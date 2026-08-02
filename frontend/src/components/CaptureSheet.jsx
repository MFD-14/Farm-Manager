// The capture sheet implements the sub-minute flows of spec 5.2: number pad
// pre-focused, camera pre-set, Done disabled until the evidence policy is
// satisfiable, Skip and Problem always one tap away and always cheaper than
// silence (spec 4.3).
import React, { useMemo, useRef, useState } from "react";
import { reportDone, requestSkip, flagProblem, evidenceReady, compressAndStamp, SKIP_REASONS } from "../lib/capture.js";

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
  const fileRef = useRef(null);
  const videoRef = useRef(null);

  const photos = mediaItems.filter((m) => m.kind === "photo").length;
  const videos = mediaItems.filter((m) => m.kind === "video").length;
  const voices = mediaItems.filter((m) => m.kind === "audio").length;
  const ready = evidenceReady(policy, { fields, photos, videos, voices });
  const isOpen = ["released", "acknowledged", "in_progress"].includes(instance.state);

  async function addPhoto(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const blob = await compressAndStamp(file, { taskCode: instance.template_code });
    setMediaItems((p) => [...p, {
      media_uuid: crypto.randomUUID(), kind: "photo", blob,
      preview: URL.createObjectURL(blob),
    }]);
    e.target.value = "";
  }

  async function addVideo(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setMediaItems((p) => [...p, { media_uuid: crypto.randomUUID(), kind: "video", blob: file }]);
    e.target.value = "";
  }

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
    await flagProblem(instance, "other", note);
    onClose();
  }

  const needsPhoto = policy.classes?.includes("E2") || policy.classes?.includes("E3") || policy.any_of?.includes("E2");
  const needsVideo = policy.classes?.includes("E4");
  const photoMin = policy.photo_min ?? (policy.classes?.includes("E3") ? 2 : needsPhoto ? 1 : 0);

  return (
    <div className="sheet" onClick={onClose}>
      <div className="panel" onClick={(e) => e.stopPropagation()}>
        <h2>{instance.title}</h2>
        <div className="code">
          {instance.template_code} · {instance.priority}
          {instance.params?.litres ? ` · ${instance.params.minutes} min · ${instance.params.litres} L` : ""}
        </div>

        {instance.retake_reason && <div className="retake">Retake asked: {instance.retake_reason}</div>}

        {(instance.instructions || []).length > 0 && (
          <div className="instructions">
            {(instance.instructions || []).map((s, i) => <div key={i}>{s.text}</div>)}
          </div>
        )}

        {!isOpen && (
          <p className="evidence-note">
            This task is {instance.state.replaceAll("_", " ")}.
            {instance.state === "done_reported" && " It will sync and verify automatically."}
          </p>
        )}

        {isOpen && mode === "capture" && (
          <>
            {(policy.fields || []).map((f) => (
              <div className="field" key={f.key}>
                <label>{f.label || f.key}{f.unit ? ` (${f.unit})` : ""}</label>
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

            {needsPhoto && (
              <div className="field">
                <label>Photo {photoMin > 1 ? `(${photos}/${photoMin}${policy.pair ? ", before and after" : ""})` : ""}</label>
                <input ref={fileRef} type="file" accept="image/*" capture="environment"
                  style={{ display: "none" }} onChange={addPhoto} />
                <button className="btn ghost block" onClick={() => fileRef.current?.click()}>
                  {photos ? "Add another photo" : "Take photo"}
                </button>
                <div className="photo-strip">
                  {mediaItems.filter((m) => m.kind === "photo").map((m) => (
                    <img key={m.media_uuid} src={m.preview} alt="" />
                  ))}
                </div>
              </div>
            )}

            {needsVideo && (
              <div className="field">
                <label>Video (10–20 s)</label>
                <input ref={videoRef} type="file" accept="video/*" capture="environment"
                  style={{ display: "none" }} onChange={addVideo} />
                <button className="btn ghost block" onClick={() => videoRef.current?.click()}>
                  {videos ? "Replace video" : "Record video"}
                </button>
                {videos > 0 && <p className="evidence-note">Video attached, uploads on WiFi or off-peak.</p>}
              </div>
            )}

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
                placeholder="Describe the problem…" />
            </div>
            <button className="btn danger block" disabled={busy} onClick={submitProblem}>Flag problem</button>
            <button className="btn ghost block" onClick={() => setMode("capture")}>Back</button>
          </>
        )}
      </div>
    </div>
  );
}
