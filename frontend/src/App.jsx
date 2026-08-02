import React, { useEffect, useState, useCallback } from "react";
import { loadToken, setToken, apiJson } from "./lib/api.js";
import { metaGet, metaSet, outboxCounts } from "./lib/db.js";
import { startSyncLoop, onSyncState, pullBundle } from "./lib/sync.js";
import DayView from "./views/DayView.jsx";
import OwnerView from "./views/OwnerView.jsx";
import Login from "./views/Login.jsx";

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
        <div>
          <div className="brand">Woodlands</div>
          <div className="sub">{isOwner ? "Owner console" : "Farm Manager"}</div>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          {!online && <span className="badge offline">offline</span>}
          <span className={`badge ${pending ? "sync-pending" : "sync-ok"}`}>
            {syncing ? "syncing…" : pending ? `${pending} unsynced` : "synced"}
          </span>
        </div>
      </header>
      {isOwner
        ? <OwnerView tab={tab} />
        : <DayView onCountsChanged={refreshCounts} />}
      {isOwner && (
        <nav className="tabs">
          <button className={tab === "day" ? "on" : ""} onClick={() => setTab("day")}>Digest</button>
          <button className={tab === "decisions" ? "on" : ""} onClick={() => setTab("decisions")}>Decisions</button>
          <button className={tab === "kpis" ? "on" : ""} onClick={() => setTab("kpis")}>KPIs</button>
        </nav>
      )}
    </>
  );
}
