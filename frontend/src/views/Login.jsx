import React, { useState } from "react";

export default function Login({ onLogin }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      await onLogin(email.trim(), password);
    } catch (e2) {
      setErr(e2.status === 401 ? "Wrong email or password" : "Cannot reach the server");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="login" onSubmit={submit}>
      <h1>Woodlands Farm Manager</h1>
      <div className="field">
        <label>Email</label>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" />
      </div>
      <div className="field">
        <label>Password</label>
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
      </div>
      {err && <p style={{ color: "var(--r5)", fontSize: 13 }}>{err}</p>}
      <button className="btn primary block" disabled={busy || !email || !password}>
        {busy ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
