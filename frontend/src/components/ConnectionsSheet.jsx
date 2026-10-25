// WhatsApp reminders and Claude photo checking (owner only). Keys are saved on
// the server and never shown again; the sheet only shows that one is saved and
// its last four characters.
import React, { useEffect, useState } from "react";
import { apiJson, errorMessage } from "../lib/api.js";

const STATUS_CLASS = { sent: "ok", delivered: "ok", read: "ok", processed: "ok", failed: "bad",
  logged_only: "muted", skipped_window_closed: "warn", skipped_no_phone: "warn", ignored_not_allowlisted: "warn" };
const STATUS_LABEL = { logged_only: "not sent (WhatsApp not set up)", skipped_window_closed: "skipped (no template)",
  ignored_not_allowlisted: "ignored (unknown number)", processed: "received" };
// Rough cost per photo: ~1,800 input tokens (photo + task) and ~800 output.
const PER_PHOTO = { "claude-opus-5-5": "about 2¢", "claude-sonnet-5-5": "about 1¢", "claude-haiku-5-5": "under 0.1¢" };

function when(ts) {
  const d = new Date(ts);
  return d.toLocaleDateString() === new Date().toLocaleDateString()
    ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString([], { day: "numeric", month: "short" });
}

function Copy({ value }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button" className="btn ghost copy-btn" onClick={async () => {
      try { await navigator.clipboard.writeText(value); setDone(true); setTimeout(() => setDone(false), 1500); } catch { /* no clipboard */ }
    }}>{done ? "Copied" : "Copy"}</button>
  );
}

function Toggle({ label, hint, checked, onChange }) {
  return (
    <label className="toggle-row">
      <span><b>{label}</b>{hint && <small>{hint}</small>}</span>
      <input type="checkbox" checked={!!checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

function Secret({ label, set, hintText, value, onChange, placeholder }) {
  return (
    <div className="field">
      <label>{label}</label>
      <input type="password" value={value} onChange={(e) => onChange(e.target.value)} autoComplete="off"
        placeholder={set ? `Saved (${hintText}). Type to replace` : placeholder} />
    </div>
  );
}

function WhatsAppCard({ data, people, activity, onSaved }) {
  const wa = data.whatsapp;
  const [f, setF] = useState({ ...wa, token: "", appSecret: "" });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [testTo, setTestTo] = useState("");
  const [showTemplates, setShowTemplates] = useState(false);
  const set = (k) => (v) => setF({ ...f, [k]: v });

  async function save() {
    setBusy(true); setMsg(null);
    try {
      const body = { phoneId: f.phoneId, language: f.language, apiVersion: f.apiVersion, reminders: f.reminders,
        morningPlan: f.morningPlan, morningTime: f.morningTime, ownerAlerts: f.ownerAlerts, retakes: f.retakes };
      if (f.token) body.token = f.token;
      if (f.appSecret) body.appSecret = f.appSecret;
      const r = await apiJson("/api/integrations", { method: "POST", body: { whatsapp: body } });
      setF({ ...r.whatsapp, token: "", appSecret: "" });
      onSaved(r);
      setMsg({ ok: true, text: "Saved." });
    } catch (e) { setMsg({ ok: false, text: errorMessage(e) }); } finally { setBusy(false); }
  }
  async function test() {
    setBusy(true); setMsg(null);
    try {
      const r = await apiJson("/api/integrations/whatsapp/test", { method: "POST", body: { user_id: testTo || undefined } });
      setMsg(r.status === "sent"
        ? { ok: true, text: `Test sent.${r.note ? ` ${r.note}` : ""}` }
        : { ok: false, text: `Not sent: ${r.error || r.status}` });
    } catch (e) { setMsg({ ok: false, text: errorMessage(e) }); } finally { setBusy(false); }
  }

  const templates = Object.values(data.templates).filter((t) => !t.builtin);
  const withPhone = people.filter((p) => p.active && p.phone);
  const missingPhone = people.filter((p) => p.active && p.role === "caretaker" && !p.phone);

  return (
    <div className="card conn-card">
      <div className="conn-head">
        <div><b>WhatsApp reminders</b><small>Task reminders with Done / Problem / Skip buttons, the morning task list, photo retakes and alerts to you</small></div>
        <span className={`chip ${wa.configured ? "conn-on" : "conn-off"}`}>{wa.configured ? "Connected" : "Not set up"}</span>
      </div>

      <Secret label="Access token" set={wa.tokenSet} hintText={wa.tokenHint} value={f.token} onChange={set("token")}
        placeholder="From Meta: WhatsApp → API setup (use a permanent system-user token)" />
      <div className="field">
        <label>Phone number ID</label>
        <input value={f.phoneId || ""} onChange={(e) => set("phoneId")(e.target.value)} inputMode="numeric" placeholder="e.g. 106540352242922" />
      </div>
      <Secret label="App secret (recommended)" set={wa.appSecretSet} hintText={wa.appSecretHint} value={f.appSecret}
        onChange={set("appSecret")} placeholder="Meta app → Settings → Basic → App secret" />

      <div className="field">
        <label>Webhook (paste these into Meta → WhatsApp → Configuration)</label>
        <div className="copy-row"><code>{data.webhook_url}</code><Copy value={data.webhook_url} /></div>
        <div className="copy-row"><code>{wa.verifyToken}</code><Copy value={wa.verifyToken} /></div>
        <small className="field-hint">Callback URL, then verify token. Subscribe to the "messages" field.</small>
      </div>

      <div className="section-title">What gets sent</div>
      <Toggle label="Overdue task reminders" hint="To the person the task is assigned to" checked={f.reminders} onChange={set("reminders")} />
      <Toggle label="Morning task list" hint="Each caretaker's tasks for the day" checked={f.morningPlan} onChange={set("morningPlan")} />
      {f.morningPlan && (
        <div className="field inline-field">
          <label>Send at (farm time)</label>
          <input type="time" value={f.morningTime || "06:00"} onChange={(e) => set("morningTime")(e.target.value)} />
        </div>
      )}
      <Toggle label="Photo retake requests" hint="When Claude can't use a photo" checked={f.retakes} onChange={set("retakes")} />
      <Toggle label="Alerts to owners" hint="Missed tasks and the 19:00 digest" checked={f.ownerAlerts} onChange={set("ownerAlerts")} />

      <button type="button" className="link-btn left" onClick={() => setShowTemplates(!showTemplates)}>
        {showTemplates ? "Hide" : "Show"} the {templates.length} message templates to create in WhatsApp Manager
      </button>
      {showTemplates && (
        <div className="tpl-list">
          <p className="field-hint">Needed for messages to someone who hasn't messaged the farm number in the last
            24 hours. Create each with exactly this name, category <b>Utility</b>, language <b>English ({f.language})</b>.</p>
          {templates.map((t) => (
            <div className="tpl" key={t.name}>
              <div className="copy-row"><code>{t.name}</code><Copy value={t.name} /></div>
              <div className="tpl-body">{t.body}</div>
              {t.buttons && <div className="field-hint">Quick reply buttons: {t.buttons.join(", ")}</div>}
              <div className="field-hint">Sample values: {t.example.join(" | ")}</div>
            </div>
          ))}
          <div className="field inline-field">
            <label>Template language code</label>
            <input value={f.language || "en"} onChange={(e) => set("language")(e.target.value)} />
          </div>
          <div className="field inline-field">
            <label>Graph API version</label>
            <input value={f.apiVersion || ""} onChange={(e) => set("apiVersion")(e.target.value)} />
          </div>
        </div>
      )}

      {msg && <p className={`form-msg ${msg.ok ? "good" : "bad"}`}>{msg.text}</p>}
      <button type="button" className="btn primary block" disabled={busy} onClick={save}>{busy ? "Saving…" : "Save WhatsApp settings"}</button>

      {wa.configured && (
        <div className="test-row">
          <select value={testTo} onChange={(e) => setTestTo(e.target.value)}>
            <option value="">Send a test to me</option>
            {withPhone.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.phone})</option>)}
          </select>
          <button type="button" className="btn ghost" disabled={busy} onClick={test}>Send test</button>
        </div>
      )}
      {missingPhone.length > 0 && (
        <p className="form-msg bad">No WhatsApp number for {missingPhone.map((p) => p.name).join(", ")}. Add it under People.</p>
      )}

      {activity?.messages?.length > 0 && (
        <>
          <div className="section-title">Recent messages · this month {activity.month.sent} sent
            {activity.month.failed ? `, ${activity.month.failed} failed` : ""}</div>
          {activity.messages.slice(0, 12).map((m, i) => (
            <div className="act-row" key={i}>
              <span className="act-when">{when(m.created_at)}</span>
              <span className="act-what">
                {m.direction === "in" ? "From " : "To "}{m.person || m.to_phone || "?"} · {(m.kind || "message").replaceAll("_", " ")}
                {m.text ? <small>{m.text}</small> : null}
                {m.error ? <small className="act-err">{m.error}</small> : null}
              </span>
              <span className={`act-status ${STATUS_CLASS[m.status] || "muted"}`}>{STATUS_LABEL[m.status] || m.status}</span>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

function ClaudeCard({ data, activity, onSaved }) {
  const cl = data.claude;
  const [f, setF] = useState({ ...cl, apiKey: "" });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const set = (k) => (v) => setF({ ...f, [k]: v });

  async function save() {
    setBusy(true); setMsg(null);
    try {
      const body = { enabled: f.enabled, model: f.model, effort: f.effort, monthlyCapUsd: Number(f.monthlyCapUsd) };
      if (f.apiKey) body.apiKey = f.apiKey;
      const r = await apiJson("/api/integrations", { method: "POST", body: { claude: body } });
      setF({ ...r.claude, apiKey: "" });
      onSaved(r);
      setMsg({ ok: true, text: r.claude.active ? "Saved. New photos will be checked by Claude." : "Saved." });
    } catch (e) { setMsg({ ok: false, text: errorMessage(e) }); } finally { setBusy(false); }
  }
  async function test() {
    setBusy(true); setMsg(null);
    try {
      const r = await apiJson("/api/integrations/claude/test", { method: "POST" });
      setMsg(r.ok ? { ok: true, text: `Connected to ${r.model} (${(r.ms / 1000).toFixed(1)}s).` } : { ok: false, text: r.error });
    } catch (e) { setMsg({ ok: false, text: errorMessage(e) }); } finally { setBusy(false); }
  }

  const month = activity?.month;
  return (
    <div className="card conn-card">
      <div className="conn-head">
        <div><b>Claude photo checking</b><small>Claude looks at each evidence photo, compares it with the task and what was reported, and passes it, asks for a retake, or sends it to you</small></div>
        <span className={`chip ${cl.active ? "conn-on" : "conn-off"}`}>{cl.active ? "On" : "Off"}</span>
      </div>

      <Toggle label="Check photos with Claude" hint="Off: photos pass on a basic size check, as before"
        checked={f.enabled} onChange={set("enabled")} />
      <Secret label="Anthropic API key" set={cl.apiKeySet} hintText={cl.apiKeyHint} value={f.apiKey} onChange={set("apiKey")}
        placeholder="sk-ant-… from console.anthropic.com → API keys" />
      <div className="field">
        <label>Model</label>
        <select value={f.model} onChange={(e) => set("model")(e.target.value)}>
          {Object.entries(data.models).map(([id, m]) => (
            <option key={id} value={id}>{m.label} ({PER_PHOTO[id] || "?"}/photo)</option>
          ))}
        </select>
      </div>
      <div className="field">
        <label>How carefully</label>
        <select value={f.effort} onChange={(e) => set("effort")(e.target.value)}>
          <option value="low">Quick (cheapest)</option>
          <option value="medium">Normal</option>
          <option value="high">Thorough (costs more)</option>
        </select>
      </div>
      <div className="field inline-field">
        <label>Monthly spending cap (USD)</label>
        <input type="number" min="0" step="1" value={f.monthlyCapUsd} onChange={(e) => set("monthlyCapUsd")(e.target.value)} />
      </div>
      <small className="field-hint">When the cap is reached, photos fall back to the basic check until next month. 0 means no cap.
        Photos are sent to Anthropic to be checked.</small>

      {msg && <p className={`form-msg ${msg.ok ? "good" : "bad"}`}>{msg.text}</p>}
      <button type="button" className="btn primary block" disabled={busy} onClick={save}>{busy ? "Saving…" : "Save photo checking settings"}</button>
      {cl.apiKeySet && <button type="button" className="btn ghost block" disabled={busy} onClick={test}>Test the API key</button>}

      {month && (
        <div className="section-title">This month · {month.photos} photo{month.photos === 1 ? "" : "s"} checked · ${Number(month.usd).toFixed(2)}
          {Number(f.monthlyCapUsd) > 0 ? ` of $${Number(f.monthlyCapUsd).toFixed(0)}` : ""}</div>
      )}
      {(activity?.checks || []).slice(0, 10).map((j, i) => (
        <div className="act-row" key={i}>
          <span className="act-when">{when(j.created_at)}</span>
          <span className="act-what">
            {j.template_code} {j.title}
            {j.reason ? <small>{j.reason}</small> : null}
            {j.last_error && j.status !== "done" ? <small className="act-err">{j.last_error}</small> : null}
          </span>
          <span className={`act-status ${j.verdict === "pass" ? "ok" : j.verdict ? "warn" : j.status === "failed" ? "bad" : "muted"}`}>
            {j.verdict ? `${j.verdict} ${Math.round((j.confidence || 0) * 100)}%` : j.status}
          </span>
        </div>
      ))}
    </div>
  );
}

export default function ConnectionsSheet({ onClose }) {
  const [data, setData] = useState(null);
  const [people, setPeople] = useState([]);
  const [activity, setActivity] = useState(null);
  const [err, setErr] = useState(null);

  async function load() {
    try {
      const [d, u, a] = await Promise.all([
        apiJson("/api/integrations"), apiJson("/api/users"), apiJson("/api/integrations/activity"),
      ]);
      setData(d); setPeople(u.users); setActivity(a); setErr(null);
    } catch (e) {
      setErr(errorMessage(e, "Couldn't load settings. This needs a connection to the server."));
    }
  }
  useEffect(() => { load(); }, []);

  return (
    <div className="sheet" onClick={onClose}>
      <div className="panel" onClick={(e) => e.stopPropagation()}>
        <h2>WhatsApp & photo checking</h2>
        <div className="code">Connections to WhatsApp and Claude</div>
        {err && <p className="form-msg bad">{err}</p>}
        {!data && !err && <div className="empty">Loading…</div>}
        {data && (
          <>
            <WhatsAppCard data={data} people={people} activity={activity?.whatsapp} onSaved={(d) => { setData(d); load(); }} />
            <ClaudeCard data={data} activity={activity?.claude} onSaved={(d) => { setData(d); load(); }} />
          </>
        )}
        <button type="button" className="btn ghost block" onClick={onClose}>Close</button>
      </div>
    </div>
  );
}
