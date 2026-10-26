// Owner settings for WhatsApp reminders: read (secrets masked), save, test,
// and recent activity.
import { Router } from "express";
import { randomBytes } from "node:crypto";
import { q, tx } from "../db/pool.js";
import { auth, requireRole } from "../middleware/auth.js";
import { getIntegrations, saveIntegrations, publicView, waConfigured } from "../integrations/settings.js";
import { sendTest } from "../workers/whatsappSender.js";

export const integrationsRouter = Router();
integrationsRouter.use(auth(), requireRole("owner", "admin"));

function webhookUrl(req) {
  const proto = req.get("x-forwarded-proto") || req.protocol;
  return `${proto}://${req.get("host")}/api/webhooks/whatsapp`;
}

// Meta asks for a verify token when connecting the webhook; make one up front.
async function withVerifyToken(s) {
  return s.whatsapp.verifyToken ? s : saveIntegrations({ whatsapp: { verifyToken: randomBytes(12).toString("hex") } });
}

integrationsRouter.get("/", async (req, res) => {
  const s = await withVerifyToken(await getIntegrations());
  res.json({ ...publicView(s), webhook_url: webhookUrl(req) });
});

integrationsRouter.post("/", async (req, res) => {
  try {
    const s = await withVerifyToken(await saveIntegrations(req.body || {}));
    res.json({ ...publicView(s), webhook_url: webhookUrl(req) });
  } catch (err) {
    if (err.status === 400) return res.status(400).json({ error: err.message });
    throw err;
  }
});

integrationsRouter.post("/whatsapp/test", async (req, res) => {
  const s = await getIntegrations();
  if (!waConfigured(s)) return res.status(400).json({ error: "Save the WhatsApp access token and phone number ID first" });
  const userId = req.body?.user_id || req.user.id;
  const user = (await q(`SELECT * FROM users WHERE id = $1`, [userId])).rows[0];
  if (!user?.phone) return res.status(400).json({ error: "That person has no phone number. Add one under People." });
  const result = await tx((c) => sendTest(c, { user }));
  res.json({
    ...result,
    note: result.mode === "template"
      ? "Sent Meta's hello_world sample, because this person hasn't messaged the farm number in the last 24 hours."
      : undefined,
  });
});

integrationsRouter.get("/activity", async (req, res) => {
  const messages = (await q(
    `SELECT m.direction, m.kind, m.to_phone, m.status, m.error, m.template_name, m.created_at,
            m.payload->>'mode' AS mode, left(COALESCE(CASE WHEN m.direction = 'in' THEN m.payload#>>'{text,body}' ELSE m.payload->>'text' END, ''), 140) AS text,
            u.name AS person
     FROM wa_messages m
     LEFT JOIN wa_contacts wc ON wc.wa_phone = m.to_phone
     LEFT JOIN users u ON u.id = wc.user_id
     ORDER BY m.created_at DESC LIMIT 25`)).rows;
  const month = (await q(
    `SELECT count(*) FILTER (WHERE direction = 'out' AND status IN ('sent','delivered','read'))::int AS sent,
            count(*) FILTER (WHERE direction = 'out' AND status = 'failed')::int AS failed,
            count(*) FILTER (WHERE direction = 'out' AND status IN ('sent','delivered','read') AND payload->>'mode' = 'template')::int AS templates,
            count(*) FILTER (WHERE direction = 'in')::int AS received
     FROM wa_messages WHERE created_at >= date_trunc('month', now())`)).rows[0];
  res.json({ whatsapp: { month, messages } });
});
