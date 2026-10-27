// My account: name, sign-in email, phone, password, sign out. Owners also get
// the way into People. In "forced" mode it is the first-sign-in screen that
// replaces a one-time password the owner handed out.
import React, { useState } from "react";
import { apiJson, setToken, errorMessage } from "../lib/api.js";
import { metaSet } from "../lib/db.js";
import SheetClose from "./SheetClose.jsx";

export function PasswordForm({ onDone, forced, initialCurrent = "" }) {
  const [current, setCurrent] = useState(initialCurrent);
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  const mismatch = confirm && next !== confirm;
  async function submit(e) {
    e.preventDefault();
    setBusy(true); setMsg(null);
    try {
      const r = await apiJson("/api/auth/password", {
        method: "POST", body: { current_password: current, new_password: next },
      });
      await setToken(r.token);
      setCurrent(""); setNext(""); setConfirm("");
      setMsg({ ok: true, text: "Password changed. Other phones using this account will need to sign in again." });
      onDone?.(r.user);
    } catch (err) {
      setMsg({ ok: false, text: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      {/* At first sign-in the one-time password was just typed; don't ask twice. */}
      {!initialCurrent && (
        <div className="field">
          <label>{forced ? "One-time password" : "Current password"}</label>
          <input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" />
        </div>
      )}
      <div className="field">
        <label>New password</label>
        <input type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password"
          placeholder="At least 8 characters" />
      </div>
      <div className="field">
        <label>New password again</label>
        <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
      </div>
      {mismatch && <p className="form-msg bad">The two new passwords don't match.</p>}
      {msg && <p className={`form-msg ${msg.ok ? "good" : "bad"}`}>{msg.text}</p>}
      <button className="btn primary block" disabled={busy || !current || next.length < 8 || next !== confirm}>
        {busy ? "Saving…" : forced ? "Set my password" : "Change password"}
      </button>
    </form>
  );
}

export default function AccountSheet({ user, pending, waiting = 0, onClose, onUserChanged, onSignOut, onOpenPeople, onOpenConnections }) {
  const [name, setName] = useState(user.name || "");
  const [email, setEmail] = useState(user.email || "");
  const [phone, setPhone] = useState(user.phone || "");
  const [waOptIn, setWaOptIn] = useState(user.wa_opt_in !== false);
  const [current, setCurrent] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [confirmOut, setConfirmOut] = useState(false);

  const emailChanged = email.trim().toLowerCase() !== (user.email || "").toLowerCase();
  const dirty = emailChanged || name.trim() !== (user.name || "") || phone.trim() !== (user.phone || "")
    || waOptIn !== (user.wa_opt_in !== false);

  async function saveProfile(e) {
    e.preventDefault();
    setBusy(true); setMsg(null);
    try {
      const r = await apiJson("/api/auth/me", {
        method: "PATCH",
        body: { name, phone, email, wa_opt_in: waOptIn, ...(emailChanged ? { current_password: current } : {}) },
      });
      await metaSet("user", r.user);
      onUserChanged(r.user);
      setCurrent("");
      setMsg({ ok: true, text: emailChanged ? `Saved. Sign in with ${r.user.email} from now on.` : "Saved." });
    } catch (err) {
      setMsg({ ok: false, text: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="sheet" onClick={onClose}>
      <div className="panel" onClick={(e) => e.stopPropagation()}>
        <SheetClose onClose={onClose} />
        <h2>My account</h2>
        <div className="code">{user.role === "owner" ? "Owner · full admin access"
          : user.role === "manager" ? "Task manager · accepts completed tasks" : "Caretaker"}</div>

        {user.role === "owner" && onOpenPeople && (
          <button type="button" className="people-entry" onClick={onOpenPeople}>
            <span>
              <b>People</b>
              <small>
                {waiting
                  ? <b className="waiting-note">{waiting} new account{waiting === 1 ? "" : "s"} waiting for your approval</b>
                  : "Add the caretaker and others, approve sign-ups, reset passwords"}
              </small>
            </span>
            <span aria-hidden="true">›</span>
          </button>
        )}
        {user.role === "owner" && onOpenConnections && (
          <button type="button" className="people-entry" onClick={onOpenConnections}>
            <span>
              <b>WhatsApp</b>
              <small>Reminders, the morning task list and sent-back notices for the caretaker; alerts for you</small>
            </span>
            <span aria-hidden="true">›</span>
          </button>
        )}

        <div className="section-title">Profile</div>
        <form onSubmit={saveProfile}>
          <div className="field">
            <label>Name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
          </div>
          <div className="field">
            <label>Sign-in email</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
              autoCapitalize="none" autoCorrect="off" autoComplete="email" />
          </div>
          {emailChanged && (
            <div className="field">
              <label>Current password (to change email)</label>
              <input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" />
            </div>
          )}
          <div className="field">
            <label>Phone (WhatsApp)</label>
            <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="e.g. 0771234567" autoComplete="tel" />
          </div>
          <label className="toggle-row">
            <span><b>WhatsApp messages from the farm</b><small>{user.role === "caretaker"
              ? "Task reminders and the morning task list" : "Alerts and the evening digest"}</small></span>
            <input type="checkbox" checked={waOptIn} onChange={(e) => setWaOptIn(e.target.checked)} />
          </label>
          {msg && <p className={`form-msg ${msg.ok ? "good" : "bad"}`}>{msg.text}</p>}
          <button className="btn primary block" disabled={busy || !dirty || !name.trim() || (emailChanged && !current)}>
            {busy ? "Saving…" : "Save profile"}
          </button>
        </form>

        <div className="section-title">Password</div>
        <PasswordForm onDone={(u) => { metaSet("user", u); onUserChanged(u); }} />

        <div className="section-title">This phone</div>
        {!confirmOut ? (
          <button type="button" className="btn ghost block" onClick={() => (pending ? setConfirmOut(true) : onSignOut())}>
            Sign out
          </button>
        ) : (
          <div className="card">
            <p className="form-msg bad" style={{ marginTop: 0 }}>
              {pending} record{pending === 1 ? " hasn't" : "s haven't"} reached the server yet. They stay on this
              phone and send after the next sign-in, under whoever signs in.
            </p>
            <button type="button" className="btn danger block" onClick={onSignOut}>Sign out anyway</button>
            <button type="button" className="btn ghost block" onClick={() => setConfirmOut(false)}>Stay signed in</button>
          </div>
        )}
        <button type="button" className="btn ghost block" onClick={onClose}>Close</button>
      </div>
    </div>
  );
}
