import React, { useEffect, useState, useCallback } from "react";
import { loadToken, setToken, clearToken, apiJson, onUnauthorized } from "./lib/api.js";
import { metaGet, metaSet, outboxCounts } from "./lib/db.js";
import { startSyncLoop, onSyncState, pullBundle } from "./lib/sync.js";
import DayView from "./views/DayView.jsx";
import OwnerView from "./views/OwnerView.jsx";
import RainView from "./views/RainView.jsx";
import WaterView from "./views/WaterView.jsx";
import FarmView from "./views/FarmView.jsx";
import NotesView from "./views/NotesView.jsx";
import LogsView from "./views/LogsView.jsx";
import CropPlanView from "./views/CropPlanView.jsx";
import AboutSheet from "./components/AboutSheet.jsx";
import AccountSheet, { PasswordForm } from "./components/AccountSheet.jsx";
import PeopleSheet from "./components/PeopleSheet.jsx";
import ConnectionsSheet from "./components/ConnectionsSheet.jsx";
import SyncSheet from "./components/SyncSheet.jsx";

import Login from "./views/Login.jsx";

const LEAF_ICON = "M11 20A7 7 0 019.8 6.9C15.5 4.9 17 3.5 19 2c1 2 2 4.5 2 8 0 5.5-4.8 10-10 10zM2 21c0-3 1.9-5.5 4.5-6.3";
const WALK = ["A-02", "A-03", "W-05", "C-04", "C-05", "C-INSPECT", "W-ACCESS"];
const ATTENDANCE = ["F-02"];

// The side menu, in the order of the Tend reference; console entries are for
// owners and task managers only.
const MENU = [
  { key: "dashboard", label: "Dashboard", console: true, icon: "M12 3a9 9 0 109 9h-9z" },
  { key: "tasks", label: "Tasks", icon: "M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" },
  { key: "review", label: "Review", console: true, icon: "M12 3l8 4v5c0 5-3.5 8-8 9-4.5-1-8-4-8-9V7z" },
  { key: "notes", label: "Notes", icon: "M11 4H4v16h16v-7M18.5 2.5a2.1 2.1 0 013 3L12 15l-4 1 1-4z" },
  { key: "farm", label: "Farm Map", icon: "M1 6v16l7-4 8 4 7-4V2l-7 4-8-4zM8 2v16M16 6v16" },
  { key: "crop", label: "Crop Plan By Crop", icon: LEAF_ICON },
  { key: "cropmap", label: "Crop Plan By Map", icon: "M12 21s-7-6-7-11a7 7 0 0114 0c0 5-7 11-7 11zM12 10h.01" },
  { key: "attendance", label: "Time & Attendance", icon: "M12 7v5l3 3M12 21a9 9 0 110-18 9 9 0 010 18z" },
  { key: "walk", label: "Field Walk", icon: "M13 4h.01M7 21l3-6 3 2v4M10 15l1-6 4 3h3M11 9l-4 2v3" },
  { key: "logs", label: "Logs", icon: "M3 3v18h18M7 16l4-8 4 4 4-6" },
  { key: "rain", label: "Rain", icon: "M12 2.69l5.66 5.66a8 8 0 11-11.31 0z" },
  { key: "water", label: "Water", console: true, icon: "M2 12h4l3-9 4 18 3-9h6" },
  { key: "kpis", label: "KPIs", console: true, icon: "M12 20V10M18 20V4M6 20v-4" },
];

function Icon({ d, size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>
  );
}

export default function App() {
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState(null);
  const [counts, setCounts] = useState({ events: 0, media: 0 });
  const [online, setOnline] = useState(navigator.onLine);
  const [syncing, setSyncing] = useState(false);
  const [tab, setTab] = useState(null);
  const [showMenu, setShowMenu] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showAbout, setShowAbout] = useState(false);
  const [showAccount, setShowAccount] = useState(false);
  const [showPeople, setShowPeople] = useState(false);
  const [showConnections, setShowConnections] = useState(false);
  const [showSync, setShowSync] = useState(false);
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
    await pullBundle().catch(() => {});
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
    setTab(null);
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
  // Owners and task managers get the console (review queue, dashboard, KPIs);
  // only owners administer people and WhatsApp.
  const isConsole = isOwner || user.role === "manager";
  const page = tab || (isConsole ? "dashboard" : "tasks");
  const menu = MENU.filter((m) => isConsole || !m.console);
  const go = (key) => { setTab(key); setShowMenu(false); };
  const openSheet = (fn) => { setShowMenu(false); fn(true); };
  const roleLabel = isOwner ? "Owner" : isConsole ? "Task manager" : "Caretaker";
  const initials = (user.name || user.email).split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();

  const views = {
    dashboard: () => <OwnerView tab="day" />,
    tasks: () => <DayView onCountsChanged={refreshCounts} />,
    review: () => <OwnerView tab="decisions" />,
    notes: () => <NotesView onCountsChanged={refreshCounts} />,
    farm: () => <FarmView />,
    crop: () => <CropPlanView mode="crop" />,
    cropmap: () => <CropPlanView mode="map" />,
    attendance: () => <LogsView codes={ATTENDANCE} title="Time & Attendance"
      empty="No attendance recorded yet. It's taken weekly with the F-02 attendance and wage sheet task." />,
    walk: () => <DayView onCountsChanged={refreshCounts} codes={WALK} title="Field Walk" />,
    logs: () => <LogsView />,
    rain: () => <RainView onCaptureToday={isConsole ? undefined : () => setTab("tasks")} />,
    water: () => <WaterView />,
    kpis: () => <OwnerView tab="kpis" />,
  };

  return (
    <>
      <header className="topbar">
        <div className="brandwrap">
          <button className="about-btn" aria-label="Menu" onClick={() => { setShowMenu(true); if (isOwner) refreshWaiting(); }}>
            {isOwner && waiting > 0 && <span className="dot" aria-label={`${waiting} waiting for approval`} />}
            <Icon d="M3 6h18M3 12h18M3 18h18" size={18} />
          </button>
          <div>
            <div className="brand">Woodlands</div>
            <div className="sub">{(MENU.find((m) => m.key === page) || MENU[0]).label}</div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          {!online && <span className="badge offline">offline</span>}
          <button type="button" className="sync-badge-btn" aria-label="Sync and uploads" onClick={() => setShowSync(true)}>
            <span className={`badge ${pending ? "sync-pending" : "sync-ok"}`}>
              {syncing ? "syncing…" : pending ? `${pending} unsynced` : "synced"}
            </span>
          </button>
        </div>
      </header>
      {showMenu && (
        <div className="drawer-scrim" onClick={() => setShowMenu(false)}>
          <nav className="drawer" onClick={(e) => e.stopPropagation()}>
            <div className="drawer-brand">
              <span className="leaf"><Icon d={LEAF_ICON} size={18} /></span>
              <b>Woodlands</b>
              <button type="button" className="drawer-close" aria-label="Close menu" onClick={() => setShowMenu(false)}>
                <Icon d="M19 12H5M11 18l-6-6 6-6" />
              </button>
            </div>
            <div className="drawer-user">
              <span className="avatar">{initials}</span>
              <div><b>{user.name}</b><small>{user.email}</small></div>
            </div>
            <div className="drawer-farm"><b>Woodlands Farm</b><small>{roleLabel}</small></div>
            {menu.map((m) => (
              <button key={m.key} type="button" className={`drawer-item ${page === m.key ? "on" : ""}`} onClick={() => go(m.key)}>
                <Icon d={m.icon} />{m.label}
              </button>
            ))}
            <hr />
            <button type="button" className="drawer-item group" onClick={() => setShowSettings(!showSettings)}>
              Settings<Icon d={showSettings ? "M18 15l-6-6-6 6" : "M6 9l6 6 6-6"} />
            </button>
            {showSettings && (
              <div className="drawer-sub">
                <button type="button" onClick={() => openSheet(setShowAccount)}>My account</button>
                {isOwner && <button type="button" onClick={() => openSheet(setShowPeople)}>
                  People{waiting > 0 && <span className="chip role-pending">{waiting} waiting</span>}</button>}
                {isOwner && <button type="button" onClick={() => openSheet(setShowConnections)}>WhatsApp</button>}
                <button type="button" onClick={() => openSheet(setShowSync)}>Sync &amp; uploads</button>
              </div>
            )}
            <button type="button" className="drawer-item group" onClick={() => openSheet(setShowAbout)}>Help</button>
          </nav>
        </div>
      )}
      {showAbout && <AboutSheet user={user} onClose={() => setShowAbout(false)} />}
      {showAccount && (
        <AccountSheet user={user} pending={pending} waiting={waiting} onClose={() => setShowAccount(false)}
          onUserChanged={updateUser} onSignOut={signOut}
          onOpenPeople={() => { setShowAccount(false); setShowPeople(true); }}
          onOpenConnections={() => { setShowAccount(false); setShowConnections(true); }} />
      )}
      {showPeople && <PeopleSheet onClose={() => setShowPeople(false)} onPendingChanged={refreshWaiting} />}
      {showConnections && <ConnectionsSheet onClose={() => setShowConnections(false)} />}
      {showSync && <SyncSheet online={online} onClose={() => { setShowSync(false); refreshCounts(); }} />}
      {(views[page] || views.tasks)()}
    </>
  );
}
