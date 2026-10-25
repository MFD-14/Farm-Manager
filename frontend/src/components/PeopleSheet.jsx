// People (owner only): everyone who signs in to the farm. Add someone, edit
// their details, give them a new one-time password, or switch them off.
// Accounts are never deleted, because the farm history records who did what.
import React, { useEffect, useState } from "react";
import { apiJson, errorMessage, getServerUrl } from "../lib/api.js";

function when(ts) {
  if (!ts) return "never";
  const d = new Date(ts);
  const days = Math.floor((Date.now() - d.getTime()) / 86400000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  return d.toLocaleDateString();
}

// The one-time password is shown once; make it easy to pass on.
function OneTimePassword({ person, password, onDone }) {
  const server = getServerUrl() || window.location.origin;
  const message = `Woodlands Farm Manager\nServer: ${server}\nEmail: ${person.email}\nOne-time password: ${password}\nYou'll choose your own password when you first sign in.`;
  const [copied, setCopied] = useState(false);
  async function share() {
    if (navigator.share) {
      try { await navigator.share({ text: message }); return; } catch { /* cancelled */ }
    }
    try { await navigator.clipboard.writeText(message); setCopied(true); } catch { /* no clipboard */ }
  }
  return (
    <div className="card otp-card">
      <div className="otp-title">One-time password for {person.name}</div>
      <div className="otp-code">{password}</div>
      <p className="otp-note">
        Shown only now. Give it to {person.name} with the sign-in email <b>{person.email}</b>; they'll choose
        their own password at first sign-in.
      </p>
      <button type="button" className="btn primary block" onClick={share}>
        {copied ? "Copied" : navigator.share ? "Send sign-in details" : "Copy sign-in details"}
      </button>
      <button type="button" className="btn ghost block" onClick={onDone}>Done</button>
    </div>
  );
}

function PersonForm({ initial, isMe, onSaved, onCancel }) {
  const editing = !!initial;
  const [f, setF] = useState({
    name: initial?.name || "", email: initial?.email || "", role: initial?.role || "caretaker",
    phone: initial?.phone || "", password: "", wa_opt_in: initial ? initial.wa_opt_in !== false : true,
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      const r = editing
        ? await apiJson(`/api/users/${initial.id}`, {
            method: "PATCH",
            body: { name: f.name, phone: f.phone, wa_opt_in: f.wa_opt_in, ...(isMe ? {} : { email: f.email, role: f.role }) },
          })
        : await apiJson("/api/users", {
            method: "POST",
            body: { name: f.name, email: f.email, role: f.role, phone: f.phone, password: f.password || undefined },
          });
      onSaved(r);
    } catch (e2) {
      setErr(errorMessage(e2));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card" onSubmit={submit}>
      <div className="field">
        <label>Name</label>
        <input value={f.name} onChange={set("name")} autoComplete="off" />
      </div>
      <div className="field">
        <label>Sign-in email</label>
        <input type="email" value={f.email} onChange={set("email")} disabled={isMe}
          autoCapitalize="none" autoCorrect="off" autoComplete="off" />
        {isMe && <small className="field-hint">Change your own email under My account.</small>}
      </div>
      <div className="field">
        <label>Role</label>
        <select value={f.role} onChange={set("role")} disabled={isMe}>
          <option value="caretaker">Caretaker: daily tasks and evidence</option>
          <option value="owner">Owner (admin): everything, including People</option>
        </select>
      </div>
      <div className="field">
        <label>Phone (WhatsApp)</label>
        <input type="tel" value={f.phone} onChange={set("phone")} placeholder="e.g. 0771234567" />
        <small className="field-hint">Needed for WhatsApp reminders.</small>
      </div>
      {editing && (
        <label className="toggle-row">
          <span><b>WhatsApp messages from the farm</b><small>Reminders, morning list, retake requests</small></span>
          <input type="checkbox" checked={f.wa_opt_in} onChange={(e) => setF({ ...f, wa_opt_in: e.target.checked })} />
        </label>
      )}
      {!editing && (
        <div className="field">
          <label>Password (optional)</label>
          <input type="text" value={f.password} onChange={set("password")} autoComplete="new-password"
            autoCapitalize="none" autoCorrect="off" placeholder="Leave blank for a one-time password" />
        </div>
      )}
      {err && <p className="form-msg bad">{err}</p>}
      <button className="btn primary block" disabled={busy || !f.name.trim() || !f.email.trim()}>
        {busy ? "Saving…" : editing ? "Save changes" : "Add person"}
      </button>
      <button type="button" className="btn ghost block" onClick={onCancel}>Cancel</button>
    </form>
  );
}

export default function PeopleSheet({ onClose, onPendingChanged }) {
  const [people, setPeople] = useState(null);
  const [err, setErr] = useState(null);
  const [mode, setMode] = useState(null); // null | "add" | person id being edited
  const [otp, setOtp] = useState(null);   // { person, password }
  const [busyId, setBusyId] = useState(null);
  const [confirm, setConfirm] = useState(null); // { id, action }

  async function load() {
    try {
      setPeople((await apiJson("/api/users")).users);
      setErr(null);
    } catch (e) {
      setErr(errorMessage(e, "Couldn't load people. People needs a connection to the server."));
    }
  }
  useEffect(() => { load(); }, []);

  async function act(person, action) {
    setBusyId(person.id); setErr(null); setConfirm(null);
    try {
      if (action === "reset") {
        const r = await apiJson(`/api/users/${person.id}/reset-password`, { method: "POST" });
        setOtp({ person: r.user, password: r.temp_password });
      } else if (action === "approve" || action === "decline") {
        await apiJson(`/api/users/${person.id}/${action}`, { method: "POST" });
        onPendingChanged?.();
      } else {
        await apiJson(`/api/users/${person.id}`, { method: "PATCH", body: { active: action === "on" } });
      }
      await load();
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setBusyId(null);
    }
  }

  function saved(r) {
    if (r.temp_password) setOtp({ person: r.user, password: r.temp_password });
    setMode(null);
    load();
  }

  return (
    <div className="sheet" onClick={onClose}>
      <div className="panel" onClick={(e) => e.stopPropagation()}>
        <h2>People</h2>
        <div className="code">Everyone who signs in to Woodlands</div>

        {otp && <OneTimePassword person={otp.person} password={otp.password} onDone={() => setOtp(null)} />}
        {err && <p className="form-msg bad">{err}</p>}

        {mode === "add"
          ? <PersonForm onSaved={saved} onCancel={() => setMode(null)} />
          : !otp && <button type="button" className="btn primary block" onClick={() => setMode("add")}>+ Add a person</button>}

        {!people && !err && <div className="empty">Loading…</div>}
        {people?.map((p) => p.pending_approval ? (
          <div key={p.id} className="card person pending">
            <div className="person-head">
              <div>
                <div className="person-name">{p.name}</div>
                <div className="person-email">{p.email}{p.phone ? ` · ${p.phone}` : ""}</div>
              </div>
              <span className="chip role-pending">Waiting</span>
            </div>
            <div className="person-meta">Created their own account on {new Date(p.created_at).toLocaleDateString()}.
              Approve only if you know this person; they'll join as a caretaker.</div>
            <div className="person-actions">
              <button type="button" className="btn primary" disabled={busyId === p.id} onClick={() => act(p, "approve")}>
                Approve
              </button>
              <button type="button" className="btn ghost" disabled={busyId === p.id} onClick={() => act(p, "decline")}>
                Decline
              </button>
            </div>
          </div>
        ) : (
          <div key={p.id} className={`card person ${p.active ? "" : "off"}`}>
            {mode === p.id ? (
              <PersonForm initial={p} isMe={p.is_me} onSaved={saved} onCancel={() => setMode(null)} />
            ) : (
              <>
                <div className="person-head">
                  <div>
                    <div className="person-name">{p.name}{p.is_me && <span className="person-me"> (you)</span>}</div>
                    <div className="person-email">{p.email}</div>
                  </div>
                  <span className={`chip role-${p.role}`}>{p.role}</span>
                </div>
                <div className="person-meta">
                  {!p.active ? "Switched off"
                    : p.must_change_password ? "Waiting for first sign-in"
                    : `Last sign-in ${when(p.last_login_at)}`}
                  {p.active && p.last_sync_at && ` · last sync ${when(p.last_sync_at)}`}
                </div>
                {confirm?.id === p.id ? (
                  <div className="person-confirm">
                    <p>
                      {confirm.action === "reset"
                        ? `${p.name} will be signed out on every phone and get a new one-time password.`
                        : `${p.name} won't be able to sign in, and is signed out on every phone. Their records stay.`}
                    </p>
                    <div className="person-actions">
                      <button type="button" className="btn danger" disabled={busyId === p.id}
                        onClick={() => act(p, confirm.action)}>
                        {confirm.action === "reset" ? "Reset password" : "Switch off"}
                      </button>
                      <button type="button" className="btn ghost" onClick={() => setConfirm(null)}>Cancel</button>
                    </div>
                  </div>
                ) : (
                  <div className="person-actions">
                    <button type="button" className="btn ghost" onClick={() => setMode(p.id)}>Edit</button>
                    {!p.is_me && p.active && (
                      <button type="button" className="btn ghost" onClick={() => setConfirm({ id: p.id, action: "reset" })}>
                        New password
                      </button>
                    )}
                    {!p.is_me && (p.active
                      ? <button type="button" className="btn ghost" onClick={() => setConfirm({ id: p.id, action: "off" })}>Switch off</button>
                      : <button type="button" className="btn ghost" disabled={busyId === p.id} onClick={() => act(p, "on")}>Switch on</button>)}
                  </div>
                )}
              </>
            )}
          </div>
        ))}

        <button type="button" className="btn ghost block" onClick={onClose}>Close</button>
      </div>
    </div>
  );
}
