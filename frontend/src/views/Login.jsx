import React, { useEffect, useState } from "react";
import { getServerUrl, setServerUrl, isNativeShell, errorMessage, apiJson } from "../lib/api.js";
import AboutSheet, { COPYRIGHT } from "../components/AboutSheet.jsx";

export default function Login({ onLogin, notice }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [server, setServer] = useState("");
  const [showServer, setShowServer] = useState(false);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [showAbout, setShowAbout] = useState(false);
  // "signin" | "signup" | "requested" (sign-up sent, waiting for the owner)
  const [mode, setMode] = useState("signin");
  const [name, setName] = useState("");
  const [confirm, setConfirm] = useState("");
  const [phone, setPhone] = useState("");
  const native = isNativeShell();

  useEffect(() => {
    const current = getServerUrl();
    setServer(current);
    // The installed app is loaded from the phone itself, so it cannot guess the
    // server: ask for it up front until one is saved.
    setShowServer(native && !current);
  }, [native]);

  async function signUp() {
    await apiJson("/api/auth/signup", {
      method: "POST", body: { name: name.trim(), email: email.trim(), password, phone: phone.trim() },
    });
    setMode("requested");
    setPassword(""); setConfirm("");
  }

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      if (showServer || native) await setServerUrl(server);
      if (mode === "signup") return await signUp();
      await onLogin(email.trim(), password);
    } catch (e2) {
      const reachedServer = e2.status >= 400 && e2.status < 500;
      setErr(e2.status === 401 ? "Wrong email or password"
        : reachedServer ? errorMessage(e2)
        : "Cannot reach the server. Check the server address.");
      if (!reachedServer) setShowServer(true);
    } finally {
      setBusy(false);
    }
  }

  const needsServer = native && !server.trim();
  const signup = mode === "signup";
  const switchMode = (m) => { setMode(m); setErr(null); };

  if (mode === "requested") {
    return (
      <div className="login">
        <h1>Account requested</h1>
        <div className="tagline">
          Thanks{name ? `, ${name.trim().split(" ")[0]}` : ""}. The farm owner needs to approve your account.
          Once they have, sign in with <b>{email.trim()}</b> and the password you chose.
        </div>
        <button type="button" className="btn primary block" onClick={() => switchMode("signin")}>Back to sign in</button>
      </div>
    );
  }

  return (
    <form className="login" onSubmit={submit}>
      <div className="mark">
        <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round">
          <path d="M11 20A7 7 0 019.8 6.9C15.5 4.9 17 3.5 19 2c1 2 2 4.5 2 8 0 5.5-4.8 10-10 10z" />
          <path d="M2 21c0-3 1.9-5.5 4.5-6.3" />
        </svg>
      </div>
      <h1>Woodlands Farm Manager</h1>
      <div className="tagline">119.2 ha · Kwekwe, Midlands Province</div>
      {notice && <p className="form-msg bad">{notice}</p>}
      {showServer && (
        <div className="field">
          <label>Server address</label>
          <input type="url" inputMode="url" autoCapitalize="none" autoCorrect="off"
            placeholder="https://farm.example.com" value={server}
            onChange={(e) => setServer(e.target.value)} />
        </div>
      )}
      {signup && (
        <div className="field">
          <label>Your name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
        </div>
      )}
      <div className="field">
        <label>Email</label>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" />
      </div>
      <div className="field">
        <label>Password</label>
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
          autoComplete={signup ? "new-password" : "current-password"}
          placeholder={signup ? "At least 8 characters" : undefined} />
      </div>
      {signup && (
        <>
          <div className="field">
            <label>Password again</label>
            <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
          </div>
          <div className="field">
            <label>Phone (WhatsApp, optional)</label>
            <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+263…" autoComplete="tel" />
          </div>
          {confirm && confirm !== password && <p className="form-msg bad">The two passwords don't match.</p>}
        </>
      )}
      {err && <p style={{ color: "var(--r5)", fontSize: 13 }}>{err}</p>}
      {signup ? (
        <button className="btn primary block"
          disabled={busy || !name.trim() || !email || password.length < 8 || password !== confirm || needsServer}>
          {busy ? "Sending…" : "Create account"}
        </button>
      ) : (
        <button className="btn primary block" disabled={busy || !email || !password || needsServer}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
      )}
      <button type="button" className="link-btn" onClick={() => switchMode(signup ? "signin" : "signup")}>
        {signup ? "I already have an account" : "New here? Create an account"}
      </button>
      {!showServer && (
        <button type="button" className="link-btn" onClick={() => setShowServer(true)}>
          Change server address
        </button>
      )}
      <button type="button" className="login-copyright" onClick={() => setShowAbout(true)}>
        {COPYRIGHT}
      </button>
      {showAbout && <AboutSheet onClose={() => setShowAbout(false)} />}
    </form>
  );
}
