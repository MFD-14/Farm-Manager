// Sync & uploads: what this phone is still holding, file by file, with
// progress, the last error and a retry. Opened from the sync badge.
import React, { useEffect, useState, useCallback } from "react";
import { pendingEvents, pendingMedia, pendingDecisions, updateMedia, removeMedia, metaGet, metaSet } from "../lib/db.js";
import { syncNow, onSyncState } from "../lib/sync.js";

const size = (n) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const KIND = { photo: "📷 Photo", video: "🎥 Video", audio: "🎙️ Voice note" };

function ago(iso) {
  if (!iso) return "never";
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString();
}

export default function SyncSheet({ online, onClose }) {
  const [events, setEvents] = useState(0);
  const [decisions, setDecisions] = useState([]);
  const [media, setMedia] = useState([]);
  const [lastOk, setLastOk] = useState(null);
  const [wifiOnly, setWifiOnly] = useState(false);
  const [conflicts, setConflicts] = useState([]);
  const [progress, setProgress] = useState({});
  const [busy, setBusy] = useState(false);
  const [confirmDrop, setConfirmDrop] = useState(null);

  const load = useCallback(async () => {
    setEvents((await pendingEvents()).length);
    setDecisions(await pendingDecisions());
    setMedia(await pendingMedia());
    setLastOk(await metaGet("last_sync_ok"));
    setWifiOnly((await metaGet("video_wifi_only")) === true);
    setConflicts((await metaGet("decision_conflicts")) || []);
  }, []);

  useEffect(() => {
    load();
    const off = onSyncState((s) => {
      if (s.upload) setProgress((p) => ({ ...p, [s.upload.media_uuid]: s.upload }));
      if (!s.syncing) load();
    });
    return off;
  }, [load]);

  async function sync() {
    setBusy(true);
    try { await syncNow(); } finally { setBusy(false); load(); }
  }
  async function retry(m) {
    await updateMedia(m.media_uuid, { last_error: null });
    sync();
  }
  async function drop(m) {
    await removeMedia(m.media_uuid);
    setConfirmDrop(null);
    load();
  }
  async function toggleWifi(v) {
    setWifiOnly(v);
    await metaSet("video_wifi_only", v);
  }

  const totalBytes = media.reduce((a, m) => a + (m.blob?.size || 0) - (m.offset || 0), 0);
  const nothing = !events && !decisions.length && !media.length;

  return (
    <div className="sheet" onClick={onClose}>
      <div className="panel" onClick={(e) => e.stopPropagation()}>
        <h2>Sync & uploads</h2>
        <div className="code">{online ? "Online" : "No signal: everything is saved on this phone"} · last full sync {ago(lastOk)}</div>

        {nothing && <div className="empty">Everything on this phone has reached the server.</div>}

        {(events > 0 || decisions.length > 0) && (
          <div className="card sync-row">
            <span>📝 {events} record{events === 1 ? "" : "s"}{decisions.length ? `, ${decisions.length} decision${decisions.length === 1 ? "" : "s"}` : ""}</span>
            <small>Small; they go first, even on a weak signal.</small>
          </div>
        )}

        {media.length > 0 && <div className="section-title">Files · {media.length} waiting · {size(totalBytes)} to send</div>}
        {media.map((m) => {
          const p = progress[m.media_uuid];
          const sent = p ? p.offset : m.offset || 0;
          const pct = m.blob?.size ? Math.round((sent / m.blob.size) * 100) : 0;
          const held = m.kind === "video" && wifiOnly && navigator.connection?.type === "cellular";
          return (
            <div className="card upload" key={m.media_uuid}>
              <div className="upload-head">
                <b>{KIND[m.kind] || m.kind}</b>
                <span>{size(m.blob?.size || 0)}</span>
              </div>
              <div className="upload-task">{m.title || "Task evidence"}{m.source === "gallery" ? " · from gallery" : ""}</div>
              <div className="upload-bar"><div style={{ width: `${pct}%` }} /></div>
              <div className="upload-meta">
                <span>{held ? "Waiting for Wi-Fi" : pct > 0 ? `${pct}% sent` : "Waiting"}{m.attempts ? ` · tried ${m.attempts}×` : ""}</span>
                {m.last_error && <span className="act-err">{m.last_error}</span>}
              </div>
              {confirmDrop === m.media_uuid ? (
                <div className="person-actions">
                  <button type="button" className="btn danger" onClick={() => drop(m)}>Delete from phone</button>
                  <button type="button" className="btn ghost" onClick={() => setConfirmDrop(null)}>Keep</button>
                </div>
              ) : (
                <div className="person-actions">
                  <button type="button" className="btn ghost" disabled={busy || !online} onClick={() => retry(m)}>Retry now</button>
                  {m.attempts >= 5 && (
                    <button type="button" className="btn ghost" onClick={() => setConfirmDrop(m.media_uuid)}>Give up on this file</button>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {conflicts.length > 0 && (
          <>
            <div className="section-title">Decisions that didn't apply</div>
            {conflicts.slice(0, 5).map((c) => (
              <div className="act-row" key={c.event_uuid}>
                <span className="act-when">{new Date(c.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                <span className="act-what">{c.title || "Task"}: {c.action.replace("_", " ")}<small className="act-err">{c.reason}</small></span>
              </div>
            ))}
          </>
        )}

        <label className="toggle-row">
          <span><b>Videos only on Wi-Fi</b><small>Keeps mobile data for records and photos</small></span>
          <input type="checkbox" checked={wifiOnly} onChange={(e) => toggleWifi(e.target.checked)} />
        </label>

        <button type="button" className="btn primary block" disabled={busy || !online || nothing} onClick={sync}>
          {busy ? "Syncing…" : "Sync now"}
        </button>
        <button type="button" className="btn ghost block" onClick={onClose}>Close</button>
      </div>
    </div>
  );
}
