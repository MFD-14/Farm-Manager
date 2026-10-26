// Integration settings: the WhatsApp Business Cloud API.
// The owner enters them in the app; they are stored server-side in
// farm_settings 'integrations' and environment variables act as defaults (so
// existing .env deployments keep working). Secrets never leave the server:
// publicView() returns only whether each is set and its last four characters.
import { q } from "../db/pool.js";
import { config } from "../config.js";

// Message templates the owner creates once in WhatsApp Manager (category
// Utility). Needed only for messages sent when the person hasn't messaged the
// farm number in the last 24 hours; inside that window plain messages are used.
export const WA_TEMPLATES = {
  task_reminder: {
    name: "woodlands_task_reminder",
    body: "Reminder from Woodlands Farm: {{1}} was due at {{2}}. Please do it now and tap a button below when it is done.",
    buttons: ["Done", "Problem", "Skip"],
    example: ["W-01 Tank and pool level reading", "06:00"],
  },
  overdue_list: {
    name: "woodlands_overdue_list",
    body: "Woodlands Farm: you have {{1}} overdue tasks: {{2}}. Please open the Woodlands app to record them.",
    example: ["3", "W-01 Tank reading; P-01 Poultry feed; C-01 Kale harvest"],
  },
  morning_plan: {
    name: "woodlands_morning_plan",
    body: "Good morning {{1}}. You have {{2}} farm tasks today: {{3}}. Open the Woodlands app to see the details.",
    example: ["Tendai", "8", "W-01 Tank reading; P-01 Poultry feed; C-01 Kale harvest"],
  },
  sent_back: {
    name: "woodlands_task_sent_back",
    body: "Woodlands Farm: {{1}} was sent back. Reason: {{2}}. Please redo it and record it in the Woodlands app.",
    example: ["W-01 Tank and pool level reading", "the gauge is not visible in the photo"],
  },
  // Meta's pre-approved sample template, available on every new number; used
  // by the owner's "Send test" button before the farm's own are approved.
  hello: { name: "hello_world", language: "en_US", builtin: true, body: "Hello World" },
  owner_alert: {
    name: "woodlands_owner_alert",
    body: "Woodlands Farm alert: {{1}}. Open the Woodlands app for details.",
    example: ["C-01 Kale harvest was missed twice in a row"],
  },
};

const DEFAULTS = () => ({
  whatsapp: {
    token: config.wa.token || "",
    phoneId: config.wa.phoneId || "",
    verifyToken: config.wa.verifyToken && config.wa.verifyToken !== "change-me-verify" ? config.wa.verifyToken : "",
    appSecret: process.env.WA_APP_SECRET || "",
    apiVersion: process.env.WA_API_VERSION || "v23.0",
    language: process.env.WA_TEMPLATE_LANGUAGE || "en",
    reminders: true,      // overdue task reminders to the assignee
    morningPlan: true,    // the day's task list each morning
    morningTime: "06:00", // farm time
    ownerAlerts: true,    // missed-twice and urgent alerts to owners
    sentBack: true,       // tell the caretaker when a task is sent back
  },
});

const SECRET_KEYS = { whatsapp: ["token", "appSecret"] };

let cache = null;
let cacheAt = 0;

export function invalidateIntegrations() { cache = null; }

export async function getIntegrations(client = null) {
  if (cache && Date.now() - cacheAt < 30_000) return cache;
  const runner = client || { query: q };
  const r = await runner.query(`SELECT value FROM farm_settings WHERE key = 'integrations'`);
  const stored = r.rows[0]?.value || {};
  const d = DEFAULTS();
  // Stored values win, but an empty stored secret falls back to the env default.
  const merge = (section) => {
    const out = { ...d[section] };
    for (const [k, v] of Object.entries(stored[section] || {})) {
      if (v === undefined || v === null) continue;
      if (v === "" && SECRET_KEYS[section]?.includes(k)) continue;
      out[k] = v;
    }
    return out;
  };
  cache = { whatsapp: merge("whatsapp") };
  cacheAt = Date.now();
  return cache;
}

export const waConfigured = (s) => !!(s.whatsapp.token && s.whatsapp.phoneId);

const hint = (v) => (v ? `…${String(v).slice(-4)}` : null);

export function publicView(s) {
  const wa = { ...s.whatsapp };
  for (const k of SECRET_KEYS.whatsapp) { wa[`${k}Set`] = !!wa[k]; wa[`${k}Hint`] = hint(wa[k]); delete wa[k]; }
  return { whatsapp: { ...wa, configured: waConfigured(s) }, templates: WA_TEMPLATES };
}

// Partial update from the owner. For secrets: a non-empty string replaces,
// null clears, an absent or empty field keeps what is stored.
const ALLOWED = {
  whatsapp: ["token", "phoneId", "verifyToken", "appSecret", "apiVersion", "language",
    "reminders", "morningPlan", "morningTime", "ownerAlerts", "sentBack"],
};

export async function saveIntegrations(patch) {
  const r = await q(`SELECT value FROM farm_settings WHERE key = 'integrations'`);
  const stored = r.rows[0]?.value || {};
  for (const section of Object.keys(ALLOWED)) {
    const incoming = patch?.[section];
    if (!incoming || typeof incoming !== "object") continue;
    const next = { ...(stored[section] || {}) };
    for (const key of ALLOWED[section]) {
      if (!(key in incoming)) continue;
      let v = incoming[key];
      const secret = SECRET_KEYS[section]?.includes(key);
      if (secret) {
        if (v === null) { next[key] = ""; continue; }
        if (typeof v !== "string" || !v.trim()) continue;
        next[key] = v.trim();
        continue;
      }
      if (typeof v === "string") v = v.trim();
      if (key === "morningTime" && !/^([01]\d|2[0-3]):[0-5]\d$/.test(v)) throw badRequest("Morning time must look like 06:00");
      if (key === "apiVersion" && !/^v\d+\.\d+$/.test(v)) throw badRequest("API version must look like v23.0");
      if (["reminders", "morningPlan", "ownerAlerts", "sentBack"].includes(key)) v = !!v;
      next[key] = v;
    }
    stored[section] = next;
  }
  await q(
    `INSERT INTO farm_settings (key, value) VALUES ('integrations', $1)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [JSON.stringify(stored)]);
  invalidateIntegrations();
  return getIntegrations();
}

function badRequest(message) {
  const err = new Error(message);
  err.status = 400;
  return err;
}
