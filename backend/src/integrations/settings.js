// Integration settings: WhatsApp Business Cloud API and Claude photo checking.
// The owner enters them in the app; they are stored server-side in
// farm_settings 'integrations' and environment variables act as defaults (so
// existing .env deployments keep working). Secrets never leave the server:
// publicView() returns only whether each is set and its last four characters.
import { q } from "../db/pool.js";
import { config } from "../config.js";

export const CLAUDE_MODELS = {
  // Per-million-token prices (USD) for the cost view and the monthly cap.
  "claude-opus-5-5": { label: "Opus 5.5, most careful", input: 4, output: 20 },
  "claude-sonnet-5-5": { label: "Sonnet 5.5, balanced", input: 2, output: 10 },
  "claude-haiku-5-5": { label: "Haiku 5.5, cheapest", input: 0.10, output: 0.50 },
};
export const DEFAULT_CLAUDE_MODEL = "claude-opus-5-5";
export const EFFORTS = ["low", "medium", "high"];

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
  retake: {
    name: "woodlands_photo_retake",
    body: "Woodlands Farm: please take the photo for {{1}} again. Reason: {{2}}.",
    example: ["W-01 Tank and pool level reading", "the gauge is not visible"],
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
    retakes: true,        // ask for a new photo when Claude can't use it
  },
  claude: {
    apiKey: config.anthropicKey || "",
    enabled: config.vimMode === "claude",
    model: process.env.VIM_MODEL || DEFAULT_CLAUDE_MODEL,
    effort: process.env.VIM_EFFORT || "medium",
    monthlyCapUsd: Number(process.env.VIM_MONTHLY_CAP_USD || 20),
  },
});

const SECRET_KEYS = { whatsapp: ["token", "appSecret"], claude: ["apiKey"] };

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
  cache = { whatsapp: merge("whatsapp"), claude: merge("claude") };
  if (!CLAUDE_MODELS[cache.claude.model]) cache.claude.model = DEFAULT_CLAUDE_MODEL;
  if (!EFFORTS.includes(cache.claude.effort)) cache.claude.effort = "medium";
  cacheAt = Date.now();
  return cache;
}

export const waConfigured = (s) => !!(s.whatsapp.token && s.whatsapp.phoneId);
export const claudeActive = (s) => !!(s.claude.enabled && s.claude.apiKey);

const hint = (v) => (v ? `…${String(v).slice(-4)}` : null);

export function publicView(s) {
  const wa = { ...s.whatsapp };
  const cl = { ...s.claude };
  for (const k of SECRET_KEYS.whatsapp) { wa[`${k}Set`] = !!wa[k]; wa[`${k}Hint`] = hint(wa[k]); delete wa[k]; }
  for (const k of SECRET_KEYS.claude) { cl[`${k}Set`] = !!cl[k]; cl[`${k}Hint`] = hint(cl[k]); delete cl[k]; }
  return {
    whatsapp: { ...wa, configured: waConfigured(s) },
    claude: { ...cl, active: claudeActive(s) },
    models: CLAUDE_MODELS,
    templates: WA_TEMPLATES,
  };
}

// Partial update from the owner. For secrets: a non-empty string replaces,
// null clears, an absent or empty field keeps what is stored.
const ALLOWED = {
  whatsapp: ["token", "phoneId", "verifyToken", "appSecret", "apiVersion", "language",
    "reminders", "morningPlan", "morningTime", "ownerAlerts", "retakes"],
  claude: ["apiKey", "enabled", "model", "effort", "monthlyCapUsd"],
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
      if (key === "model" && !CLAUDE_MODELS[v]) throw badRequest("Unknown Claude model");
      if (key === "effort" && !EFFORTS.includes(v)) throw badRequest("Effort must be low, medium or high");
      if (key === "monthlyCapUsd") {
        v = Number(v);
        if (!Number.isFinite(v) || v < 0 || v > 1000) throw badRequest("Monthly cap must be between 0 and 1000 dollars");
      }
      if (key === "apiVersion" && !/^v\d+\.\d+$/.test(v)) throw badRequest("API version must look like v23.0");
      if (["reminders", "morningPlan", "ownerAlerts", "retakes", "enabled"].includes(key)) v = !!v;
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
