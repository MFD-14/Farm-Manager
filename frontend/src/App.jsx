import React, { useEffect, useState, useCallback } from "react";
import { loadToken, setToken, clearToken, apiJson, onUnauthorized } from "./lib/api.js";
import { metaGet, metaSet, outboxCounts } from "./lib/db.js";
import { startSyncLoop, onSyncState, pullBundle } from "./lib/sync.js";
import DayView from "./views/DayView.jsx";
import OwnerView from "./views/OwnerView.jsx";
import RainView from "./views/RainView.jsx";
import WaterView from "./views/WaterView.jsx";
import FarmView from "./views/FarmView.jsx";
import AboutSheet from "./components/AboutSheet.jsx";
import AccountSheet, { PasswordForm } from "./components/AccountSheet.jsx";
import PeopleSheet from "./components/PeopleSheet.jsx";
import ConnectionsSheet from "./components/ConnectionsSheet.jsx";

// Barn outline for the Farm tab.
const FARM_ICON = "M3 21V10l9-6 9 6v11M9 21v-6h6v6M3 21h18";
import Login from "./views/Login.jsx";

function TabIcon({ d }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>
  );
}

export default function App() {
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState(null);
  const [counts, setCounts] = useState({ events: 0, media: 0 });
  const [online, setOnline] = useState(navigator.onLine);
  const [syncing, setSyncing] = useState(false);
  const [tab, setTab] = useState("day");
  const [showAbout, setShowAbout] = useState(false);
  const [showAccount, setShowAccount] = useState(false);
  const [showPeople, setShowPeople] = useState(false);
  const [showConnections, setShowConnections] = useState(false);
  const [notice, setNotice] = useState(null);
  const [oneTime, setOneTime] = useState(""); // kept in memory only
  const [waiting, setWaiting] = useState(0); // sign-ups awaiting an owner

  const refreshCounts = useCallback(async () => setCounts(await outboxCounts()), []);

  useEffect(() => {
    (async () => {
      await loadToken();
      const cached = await metaGet("user");
      if (cached) setUser(cached);
      setReady(true);
      startSyncLoop();
      // Pick up changes the owner made to this account (role, name, email).
      if (cached) {
        apiJson("/api/auth/me").then(async (r) => {
          if (r.user) { await metaSet("user", r.user); setUser(r.user); }
        }).catch(() => {});
      }
    })();
    // Password changed or reset, or account switched off: ask for sign-in
    // again. The outbox stays on the phone and drains after sign-in.
    const offAuth = onUnauthorized(async () => {
      await clearToken();
      await metaSet("user", null);
      setUser(null);
      setShowAccount(false); setShowPeople(false);
      setNotice("You've been signed out. Sign in again; anything not yet synced is kept on this phone.");
    });
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    const unsub = onSyncState((s) => { setSyncing(s.syncing); refreshCounts(); });
    const iv = setInterval(refreshCounts, 5000);
    return () => { offAuth(); window.removeEventListener("online", on); window.removeEventListener("offline", off); unsub(); clearInterval(iv); };
  }, [refreshCounts]);

  async function handleLogin(email, password) {
    const r = await apiJson("/api/auth/login", { method: "POST", body: { email, password } });
    await setToken(r.token);
    // Bind this browser as a device (spec 6.3) so events carry device identity.
    try {
      const reg = await apiJson("/api/devices/register", { method: "POST", body: { platform: "pwa" } });
      await setToken(reg.token);
      await metaSet("device_id", reg.device_id);
    } catch { /* keep user token */ }
    await metaSet("user", r.user);
    setOneTime(r.user.must_change_password ? password : "");
    setNotice(null);
    setUser(r.user);
    if (r.user.role !== "owner") await pullBundle().catch(() => {});
  }

  // Owners see a dot on the account button when someone has signed up.
  const refreshWaiting = useCallback(async () => {
    try { setWaiting((await apiJson("/api/users/pending-count")).count); } catch { /* offline */ }
  }, []);
  useEffect(() => {
    if (user?.role !== "owner") return undefined;
    refreshWaiting();
    const iv = setInterval(refreshWaiting, 120000);
    return () => clearInterval(iv);
  }, [user?.role, refreshWaiting]);

  async function updateUser(u) {
    await metaSet("user", u);
    setUser(u);
  }

  async function signOut() {
    await clearToken();
    await metaSet("user", null);
    await metaSet("device_id", null);
    setShowAccount(false); setShowPeople(false);
    setTab("day");
    setUser(null);
  }

  if (!ready) return null;
  if (!user) return <Login onLogin={handleLogin} notice={notice} />;

  // First sign-in with a one-time password from the owner: choose your own.
  if (user.must_change_password) {
    return (
      <div className="login">
        <h1>Choose your password</h1>
        <div className="tagline">
          Hello {user.name}. You signed in with a one-time password; pick your own to keep using Woodlands.
        </div>
        <PasswordForm forced initialCurrent={oneTime} onDone={(u) => { setOneTime(""); updateUser(u); }} />
        <button type="button" className="link-btn" onClick={signOut}>Sign out</button>
      </div>
    );
  }

  const pending = counts.events + counts.media;
  const isOwner = user.role === "owner";

  return (
    <>
      <header className="topbar">
        <div className="brandwrap">
          <div className="leaf">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round">
              <path d="M11 20A7 7 0 019.8 6.9C15.5 4.9 17 3.5 19 2c1 2 2 4.5 2 8 0 5.5-4.8 10-10 10z" />
              <path d="M2 21c0-3 1.9-5.5 4.5-6.3" />
            </svg>
          </div>
          <div>
            <div className="brand">Woodlands</div>
            <div className="sub">{isOwner ? "Owner console" : "Farm Manager"}</div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          {!online && <span className="badge offline">offline</span>}
          <span className={`badge ${pending ? "sync-pending" : "sync-ok"}`}>
            {syncing ? "syncing…" : pending ? `${pending} unsynced` : "synced"}
          </span>
          <button className="about-btn" aria-label="My account"
            onClick={() => { setShowAccount(true); if (isOwner) refreshWaiting(); }}>
            {isOwner && waiting > 0 && <span className="dot" aria-label={`${waiting} waiting for approval`} />}
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0116 0" />
            </svg>
          </button>
          <button className="about-btn" aria-label="About Woodlands" onClick={() => setShowAbout(true)}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <circle cx="12" cy="12" r="10" /><path d="M12 16v-4M12 8h.01" />
            </svg>
          </button>
        </div>
      </header>
      {showAbout && <AboutSheet user={user} onClose={() => setShowAbout(false)} />}
      {showAccount && (
        <AccountSheet user={user} pending={pending} waiting={waiting} onClose={() => setShowAccount(false)}
          onUserChanged={updateUser} onSignOut={signOut}
          onOpenPeople={() => { setShowAccount(false); setShowPeople(true); }}
          onOpenConnections={() => { setShowAccount(false); setShowConnections(true); }} />
      )}
      {showPeople && <PeopleSheet onClose={() => setShowPeople(false)} onPendingChanged={refreshWaiting} />}
      {showConnections && <ConnectionsSheet onClose={() => setShowConnections(false)} />}
      {tab === "farm" ? <FarmView />
        : isOwner
          ? (tab === "rain" ? <RainView /> : tab === "water" ? <WaterView />
            : tab === "tasks" ? <DayView onCountsChanged={refreshCounts} /> : <OwnerView tab={tab} />)
          : (tab === "rain"
              ? <RainView onCaptureToday={() => setTab("day")} />
              : <DayView onCountsChanged={refreshCounts} />)}
      {isOwner ? (
        <nav className="tabs seven">
          <button className={tab === "day" ? "on" : ""} onClick={() => setTab("day")}>
            <TabIcon d="M3 3v18h18M7 16l4-8 4 4 4-6" />Digest
          </button>
          {/* Owners can do the day's tasks themselves, same screen as the caretaker. */}
          <button className={tab === "tasks" ? "on" : ""} onClick={() => setTab("tasks")}>
            <TabIcon d="M9 11l3 3L22 4M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" />Tasks
          </button>
          <button className={tab === "decisions" ? "on" : ""} onClick={() => setTab("decisions")}>
            <TabIcon d="M12 3l8 4v5c0 5-3.5 8-8 9-4.5-1-8-4-8-9V7z" />Review
          </button>
          <button className={tab === "rain" ? "on" : ""} onClick={() => setTab("rain")}>
            <TabIcon d="M12 2.69l5.66 5.66a8 8 0 11-11.31 0z" />Rain
          </button>
          <button className={tab === "water" ? "on" : ""} onClick={() => setTab("water")}>
            <TabIcon d="M2 12h4l3-9 4 18 3-9h6" />Water
          </button>
          <button className={tab === "kpis" ? "on" : ""} onClick={() => setTab("kpis")}>
            <TabIcon d="M12 20V10M18 20V4M6 20v-4" />KPIs
          </button>
          <button className={tab === "farm" ? "on" : ""} onClick={() => setTab("farm")}>
            <TabIcon d={FARM_ICON} />Farm
          </button>
        </nav>
      ) : (
        <nav className="tabs">
          <button className={tab === "day" ? "on" : ""} onClick={() => setTab("day")}>
            <TabIcon d="M9 11l3 3L22 4M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" />Today
          </button>
          <button className={tab === "rain" ? "on" : ""} onClick={() => setTab("rain")}>
            <TabIcon d="M12 2.69l5.66 5.66a8 8 0 11-11.31 0z" />Rain
          </button>
          <button className={tab === "farm" ? "on" : ""} onClick={() => setTab("farm")}>
            <TabIcon d={FARM_ICON} />Farm
          </button>
        </nav>
      )}
    </>
  );
}
