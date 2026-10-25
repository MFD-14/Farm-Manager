// People: the owner adds, edits, switches off and resets passwords for the
// accounts that sign in to the farm. Accounts are never deleted, because the
// event log records who did each piece of work.
import { Router } from "express";
import bcrypt from "bcryptjs";
import { randomInt } from "node:crypto";
import { q } from "../db/pool.js";
import { auth, requireRole } from "../middleware/auth.js";

export const usersRouter = Router();

export const ROLES = ["owner", "caretaker"];

export function publicUser(u) {
  return {
    id: u.id, name: u.name, email: u.email, role: u.role, phone: u.phone,
    active: u.active, must_change_password: u.must_change_password,
  };
}

export const normalizeEmail = (e) => String(e || "").trim().toLowerCase();
export const validEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

export function passwordProblem(pw) {
  if (typeof pw !== "string" || pw.length < 8) return "Password must be at least 8 characters";
  if (pw.length > 200) return "Password is too long";
  return null;
}

// Readable one-time password: no 0/O, 1/l/I to misread over the phone.
export function generatePassword(len = 10) {
  const alphabet = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < len; i++) out += alphabet[randomInt(alphabet.length)];
  return out;
}

// WhatsApp allow-list follows the account's phone number.
export async function syncWaContact(userId, phone) {
  await q(`DELETE FROM wa_contacts WHERE user_id = $1`, [userId]);
  if (phone) {
    await q(`INSERT INTO wa_contacts (user_id, wa_phone) VALUES ($1, $2) ON CONFLICT (wa_phone) DO NOTHING`,
      [userId, phone]);
  }
}

async function otherActiveOwners(userId) {
  const r = await q(`SELECT count(*)::int AS n FROM users WHERE role = 'owner' AND active AND id <> $1`, [userId]);
  return r.rows[0].n;
}

usersRouter.use(auth(), requireRole("owner", "admin"));
usersRouter.param("id", (req, res, next, id) =>
  /^[0-9a-f-]{36}$/i.test(id) ? next() : res.status(404).json({ error: "not found" }));

usersRouter.get("/", async (req, res) => {
  const r = await q(
    `SELECT u.*, (SELECT max(last_sync_at) FROM devices d WHERE d.user_id = u.id AND NOT d.revoked) AS last_sync_at
     FROM users u ORDER BY u.active DESC, u.role = 'owner' DESC, u.created_at`);
  res.json({
    users: r.rows.map((u) => ({
      ...publicUser(u), last_login_at: u.last_login_at, last_sync_at: u.last_sync_at,
      created_at: u.created_at, is_me: u.id === req.user.id,
    })),
  });
});

usersRouter.post("/", async (req, res) => {
  const { name, role, phone } = req.body || {};
  const email = normalizeEmail(req.body?.email);
  if (!String(name || "").trim()) return res.status(400).json({ error: "Name is required" });
  if (!validEmail(email)) return res.status(400).json({ error: "That doesn't look like an email address" });
  if (!ROLES.includes(role)) return res.status(400).json({ error: "Role must be owner or caretaker" });
  // A password the owner types is the person's password; a generated one is
  // temporary and must be replaced at first sign-in.
  const given = req.body?.password ? String(req.body.password) : null;
  if (given) {
    const problem = passwordProblem(given);
    if (problem) return res.status(400).json({ error: problem });
  }
  const password = given || generatePassword();
  try {
    const r = await q(
      `INSERT INTO users (email, password_hash, name, role, phone, must_change_password)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [email, bcrypt.hashSync(password, 10), String(name).trim(), role, String(phone || "").trim() || null, !given]);
    if (r.rows[0].phone) await syncWaContact(r.rows[0].id, r.rows[0].phone);
    res.status(201).json({ user: publicUser(r.rows[0]), temp_password: given ? null : password });
  } catch (err) {
    if (err.code === "23505") return res.status(409).json({ error: "Another account already uses that email" });
    throw err;
  }
});

usersRouter.patch("/:id", async (req, res) => {
  const cur = (await q(`SELECT * FROM users WHERE id = $1`, [req.params.id])).rows[0];
  if (!cur) return res.status(404).json({ error: "not found" });
  const b = req.body || {};
  const isMe = cur.id === req.user.id;
  const next = {
    name: b.name !== undefined ? String(b.name).trim() : cur.name,
    email: b.email !== undefined ? normalizeEmail(b.email) : cur.email,
    role: b.role !== undefined ? b.role : cur.role,
    phone: b.phone !== undefined ? (String(b.phone).trim() || null) : cur.phone,
    active: b.active !== undefined ? !!b.active : cur.active,
  };
  if (!next.name) return res.status(400).json({ error: "Name can't be empty" });
  if (!validEmail(next.email)) return res.status(400).json({ error: "That doesn't look like an email address" });
  if (!ROLES.includes(next.role) && next.role !== cur.role) {
    return res.status(400).json({ error: "Role must be owner or caretaker" });
  }
  if (isMe && (next.role !== cur.role || !next.active)) {
    return res.status(400).json({ error: "You can't change your own role or switch off your own account" });
  }
  if (next.email !== cur.email && isMe) {
    return res.status(400).json({ error: "Change your own email under My account" });
  }
  const losingOwner = cur.role === "owner" && cur.active && (next.role !== "owner" || !next.active);
  if (losingOwner && (await otherActiveOwners(cur.id)) === 0) {
    return res.status(400).json({ error: "The farm needs at least one active owner" });
  }
  try {
    const r = await q(
      `UPDATE users SET name = $2, email = $3, role = $4, phone = $5, active = $6,
         token_version = token_version + CASE WHEN $6 = false AND active THEN 1 ELSE 0 END,
         updated_at = now()
       WHERE id = $1 RETURNING *`,
      [cur.id, next.name, next.email, next.role, next.phone, next.active]);
    if (next.phone !== cur.phone) await syncWaContact(cur.id, next.phone);
    res.json({ user: publicUser(r.rows[0]) });
  } catch (err) {
    if (err.code === "23505") return res.status(409).json({ error: "Another account already uses that email" });
    throw err;
  }
});

// Gives the person a new one-time password and signs them out everywhere.
usersRouter.post("/:id/reset-password", async (req, res) => {
  if (req.params.id === req.user.id) {
    return res.status(400).json({ error: "Change your own password under My account" });
  }
  const password = generatePassword();
  const r = await q(
    `UPDATE users SET password_hash = $2, must_change_password = true,
       token_version = token_version + 1, updated_at = now()
     WHERE id = $1 RETURNING *`, [req.params.id, bcrypt.hashSync(password, 10)]);
  if (!r.rows[0]) return res.status(404).json({ error: "not found" });
  res.json({ user: publicUser(r.rows[0]), temp_password: password });
});
