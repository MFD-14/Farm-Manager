// Farm notes: anything worth recording that isn't a task (a broken fence, a
// sick-looking calf, a buyer's call), with photos, video or a voice note.
// Written offline like every record; the list is cached for offline reading.
import React, { useEffect, useState, useCallback } from "react";
import { apiJson } from "../lib/api.js";
import { metaGet, metaSet, pendingEvents } from "../lib/db.js";
import { saveNote } from "../lib/capture.js";
import Attachments from "../components/Attachments.jsx";
import { EvidencePhoto, EvidencePlayer } from "./OwnerView.jsx";

const when = (t) => new Date(t).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export default function NotesView({ onCountsChanged }) {
  const [text, setText] = useState("");
  const [items, setItems] = useState([]);
  const [notes, setNotes] = useState([]);
  const [queued, setQueued] = useState([]);

  const refresh = useCallback(async () => {
    setQueued((await pendingEvents()).filter((e) => !e.instance_id && e.payload?.note));
    const cached = await metaGet("notes_cache");
    if (cached) setNotes(cached);
    try {
      const fresh = (await apiJson("/api/sync/notes")).notes;
      setNotes(fresh);
      await metaSet("notes_cache", fresh);
    } catch { /* offline: cached list stands */ }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  async function save() {
    if (!text.trim() && !items.length) return;
    await saveNote(text.trim(), items);
    setText(""); setItems([]);
    onCountsChanged?.();
    refresh();
  }

  return (
    <div className="wrap">
      <div className="daytitle">Notes</div>
      <div className="card">
        <textarea className="note-input" rows={3} placeholder="What did you see?" value={text} onChange={(e) => setText(e.target.value)} />
        <Attachments items={items} setItems={setItems} taskCode="NOTE" />
        <button type="button" className="btn block" disabled={!text.trim() && !items.length} onClick={save}>Save note</button>
      </div>

      {queued.map((e) => (
        <div className="card" key={e.event_uuid}>
          <p>{e.payload.note || "(photo or voice note)"}</p>
          <div className="meta"><span>{when(e.device_time)}</span><span className="chip sync-pending">waiting to sync</span></div>
        </div>
      ))}
      {notes.map((n) => (
        <div className="card" key={n.event_uuid}>
          {n.note && <p>{n.note}</p>}
          {n.media.map((m) => (m.status !== "stored" ? <div key={m.media_uuid} className="ev-missing">Still uploading</div>
            : m.kind === "photo" ? <EvidencePhoto key={m.media_uuid} mediaUuid={m.media_uuid} />
              : <EvidencePlayer key={m.media_uuid} mediaUuid={m.media_uuid} kind={m.kind} />))}
          <div className="meta"><span>{n.by || "Someone"}</span><span>{when(n.device_time || n.server_time)}</span></div>
        </div>
      ))}
      {!notes.length && !queued.length && <div className="empty">No notes yet.</div>}
    </div>
  );
}
