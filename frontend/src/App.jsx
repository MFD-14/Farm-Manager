import React, { useEffect, useState, useCallback } from "react";
import { loadToken, setToken, apiJson } from "./lib/api.js";
import { metaGet, metaSet, outboxCounts } from "./lib/db.js";
import { startSyncLoop, onSyncState, pullBundle } from "./lib/sync.js";
import DayView from "./views/DayView.jsx";
import OwnerView from "./views/OwnerView.jsx";
import RainView from "./views/RainView.jsx";
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

  const refreshCounts = useCallback(async () => setCounts(await outboxCounts()), []);

  useEffect(() => {
    (async () => {
      await loadToken();
      const cached = await metaGet("user");
      if (cached) setUser(cached);
      setReady(true);
      startSyncLoop();
    })();
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    const unsub = onSyncState((s) => { setSyncing(s.syncing); refreshCounts(); });
    const iv = setInterval(refreshCounts, 5000);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); unsub(); clearInterval(iv); };
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
    setUser(r.user);
    if (r.user.role !== "owner") await pullBundle().catch(() => {});
  }

  if (!ready) return null;
  if (!user) return <Login onLogin={handleLogin} />;

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
        <div style={{ display: "flex", gap: 6 }}>
          {!online && <span className="badge offline">offline</span>}
          <span className={`badge ${pending ? "sync-pending" : "sync-ok"}`}>
            {syncing ? "syncing…" : pending ? `${pending} unsynced` : "synced"}
          </span>
        </div>
      </header>
      {isOwner
        ? (tab === "rain" ? <RainView /> : <OwnerView tab={tab} />)
        : (tab === "rain"
            ? <RainView onCaptureToday={() => setTab("day")} />
            : <DayView onCountsChanged={refreshCounts} />)}
      {isOwner ? (
        <nav className="tabs">
          <button className={tab === "day" ? "on" : ""} onClick={() => setTab("day")}>
            <TabIcon d="M3 3v18h18M7 16l4-8 4 4 4-6" />Digest
          </button>
          <button className={tab === "decisions" ? "on" : ""} onClick={() => setTab("decisions")}>
            <TabIcon d="M9 11l3 3L22 4M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" />Decisions
          </button>
          <button className={tab === "rain" ? "on" : ""} onClick={() => setTab("rain")}>
            <TabIcon d="M12 2.69l5.66 5.66a8 8 0 11-11.31 0z" />Rain
          </button>
          <button className={tab === "kpis" ? "on" : ""} onClick={() => setTab("kpis")}>
            <TabIcon d="M12 20V10M18 20V4M6 20v-4" />KPIs
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
        </nav>
      )}
    </>
  );
}
