// Evidence picker for a task: camera photo, gallery (photo or video), video
// recording and voice note. Everything is held locally and queued for upload
// with the task; nothing here needs signal.
import React, { useEffect, useRef, useState } from "react";
import { compressAndStamp, startVoiceNote } from "../lib/capture.js";

const BIG_VIDEO = 40 * 1024 * 1024;
const mb = (n) => `${(n / 1024 / 1024).toFixed(n > 10 * 1024 * 1024 ? 0 : 1)} MB`;

export default function Attachments({ items, setItems, taskCode, need = {} }) {
  const camRef = useRef(null);
  const galleryRef = useRef(null);
  const videoRef = useRef(null);
  const [recording, setRecording] = useState(null);
  const [seconds, setSeconds] = useState(0);
  const [err, setErr] = useState(null);

  useEffect(() => {
    if (!recording) return undefined;
    const iv = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(iv);
  }, [recording]);

  const add = (item) => setItems((p) => [...p, { media_uuid: crypto.randomUUID(), ...item }]);

  async function onFiles(e, source) {
    setErr(null);
    for (const file of Array.from(e.target.files || [])) {
      try {
        if (file.type.startsWith("image/")) {
          const blob = await compressAndStamp(file, { taskCode, fromGallery: source === "gallery" });
          add({ kind: "photo", blob, preview: URL.createObjectURL(blob), source, file_modified: file.lastModified || null });
        } else if (file.type.startsWith("video/")) {
          add({ kind: "video", blob: file, source, file_modified: file.lastModified || null });
        } else if (file.type.startsWith("audio/")) {
          add({ kind: "audio", blob: file, source, file_modified: file.lastModified || null });
        }
      } catch {
        setErr("Couldn't read that file.");
      }
    }
    e.target.value = "";
  }

  async function toggleVoice() {
    setErr(null);
    if (recording) {
      const blob = await recording.stop();
      setRecording(null);
      add({ kind: "audio", blob, source: "microphone", seconds });
      return;
    }
    try {
      setSeconds(0);
      setRecording(await startVoiceNote());
    } catch {
      setErr("Microphone not available. Allow it in the phone's settings.");
    }
  }

  const photos = items.filter((m) => m.kind === "photo");
  const others = items.filter((m) => m.kind !== "photo");
  const bigVideo = items.some((m) => m.kind === "video" && m.blob.size > BIG_VIDEO);

  return (
    <div className="attach">
      <input ref={camRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => onFiles(e, "camera")} />
      <input ref={galleryRef} type="file" accept="image/*,video/*" multiple hidden onChange={(e) => onFiles(e, "gallery")} />
      <input ref={videoRef} type="file" accept="video/*" capture="environment" hidden onChange={(e) => onFiles(e, "camera")} />
      <div className="attach-btns">
        <button type="button" className={`attach-btn ${need.photo ? "need" : ""}`} onClick={() => camRef.current?.click()}>
          <span aria-hidden="true">📷</span>Photo
        </button>
        <button type="button" className="attach-btn" onClick={() => galleryRef.current?.click()}>
          <span aria-hidden="true">🖼️</span>Gallery
        </button>
        <button type="button" className={`attach-btn ${need.video ? "need" : ""}`} onClick={() => videoRef.current?.click()}>
          <span aria-hidden="true">🎥</span>Video
        </button>
        <button type="button" className={`attach-btn ${recording ? "rec" : ""} ${need.voice ? "need" : ""}`} onClick={toggleVoice}>
          <span aria-hidden="true">{recording ? "⏹" : "🎙️"}</span>{recording ? `Stop ${seconds}s` : "Voice"}
        </button>
      </div>
      {photos.length > 0 && (
        <div className="photo-strip">
          {photos.map((m) => (
            <button type="button" key={m.media_uuid} className="thumb" title="Remove"
              onClick={() => setItems((p) => p.filter((x) => x.media_uuid !== m.media_uuid))}>
              <img src={m.preview} alt="" />
              <span>×</span>
            </button>
          ))}
        </div>
      )}
      {others.map((m) => (
        <div className="attach-item" key={m.media_uuid}>
          <span>{m.kind === "video" ? "🎥 Video" : "🎙️ Voice note"}{m.seconds ? ` · ${m.seconds}s` : ""} · {mb(m.blob.size)}
            {m.source === "gallery" ? " · from gallery" : ""}</span>
          <button type="button" className="link-btn" onClick={() => setItems((p) => p.filter((x) => x.media_uuid !== m.media_uuid))}>Remove</button>
        </div>
      ))}
      {bigVideo && <p className="evidence-note">Large video: it uploads in pieces and resumes if the signal drops.</p>}
      <p className="evidence-note">Saved on this phone now; uploads by itself when there's signal.</p>
      {err && <p className="form-msg bad">{err}</p>}
    </div>
  );
}
