import { Router } from "express";
import bcrypt from "bcryptjs";
import { q } from "../db/pool.js";
import { sign, auth } from "../middleware/auth.js";
import { publicUser, normalizeEmail, validEmail, passwordProblem, syncWaContact } from "./users.js";

export const authRouter = Router();

authRouter.post("/login", async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: "email and password required" });
  const r = await q(`SELECT * FROM users WHERE lower(email) = $1`, [normalizeEmail(email)]);
  const user = r.rows[0];
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: "invalid credentials" });
  }
  if (user.pending_approval) {
    return res.status(403).json({ error: "Your account is waiting for the farm owner to approve it." });
  }
  if (!user.active) return res.status(403).json({ error: "This account has been switched off. Ask the farm owner." });
  await q(`UPDATE users SET last_login_at = now() WHERE id = $1`, [user.id]);
  res.json({ token: sign(user), user: publicUser(user) });
});

// Self sign-up from the sign-in screen. The account starts as a caretaker that
// can't sign in until an owner approves it under People, so finding the server
// address isn't enough to get in.
const MAX_PENDING = 20;
authRouter.post("/signup", async (req, res) => {
  const name = String(req.body?.name || "").trim();
  const email = normalizeEmail(req.body?.email);
  const phone = String(req.body?.phone || "").trim() || null;
  const password = req.body?.password;
  if (!name) return res.status(400).json({ error: "Please enter your name" });
  if (!validEmail(email)) return res.status(400).json({ error: "That doesn't look like an email address" });
  const problem = passwordProblem(password);
  if (problem) return res.status(400).json({ error: problem });
  const pending = await q(`SELECT count(*)::int AS n FROM users WHERE pending_approval`);
  if (pending.rows[0].n >= MAX_PENDING) {
    return res.status(429).json({ error: "Too many accounts are waiting for approval. Ask the farm owner." });
  }
  try {
    await q(
      `INSERT INTO users (email, password_hash, name, role, phone, active, pending_approval)
       VALUES ($1, $2, $3, 'caretaker', $4, false, true)`,
      [email, bcrypt.hashSync(password, 10), name, phone]);
    res.status(201).json({ ok: true, pending_approval: true });
  } catch (err) {
    if (err.code === "23505") return res.status(409).json({ error: "An account with that email already exists. Try signing in." });
    throw err;
  }
});

authRouter.get("/me", auth(), async (req, res) => {
  const r = await q(`SELECT * FROM users WHERE id = $1`, [req.user.id]);
  res.json({ user: r.rows[0] ? publicUser(r.rows[0]) : null });
});

// Own profile. Changing the sign-in email needs the current password.
authRouter.patch("/me", auth(), async (req, res) => {
  const { name, phone, email, current_password } = req.body || {};
  const me = (await q(`SELECT * FROM users WHERE id = $1`, [req.user.id])).rows[0];
  const next = {
    name: name !== undefined ? String(name).trim() : me.name,
    phone: phone !== undefined ? (String(phone).trim() || null) : me.phone,
    email: email !== undefined ? normalizeEmail(email) : me.email,
  };
  if (!next.name) return res.status(400).json({ error: "Name can't be empty" });
  if (next.email !== me.email) {
    if (!validEmail(next.email)) return res.status(400).json({ error: "That doesn't look like an email address" });
    if (!current_password || !bcrypt.compareSync(current_password, me.password_hash)) {
      return res.status(403).json({ error: "Current password is wrong" });
    }
  }
  try {
    const r = await q(
      `UPDATE users SET name = $2, phone = $3, email = $4, updated_at = now() WHERE id = $1 RETURNING *`,
      [me.id, next.name, next.phone, next.email]);
    if (next.phone !== me.phone) await syncWaContact(me.id, next.phone);
    res.json({ user: publicUser(r.rows[0]) });
  } catch (err) {
    if (err.code === "23505") return res.status(409).json({ error: "Another account already uses that email" });
    throw err;
  }
});

// Own password. Signs out every other phone using this account; this one gets
// a fresh token and keeps its device binding.
authRouter.post("/password", auth(), async (req, res) => {
  const { current_password, new_password } = req.body || {};
  const me = (await q(`SELECT * FROM users WHERE id = $1`, [req.user.id])).rows[0];
  if (!current_password || !bcrypt.compareSync(current_password, me.password_hash)) {
    return res.status(403).json({ error: "Current password is wrong" });
  }
  const problem = passwordProblem(new_password);
  if (problem) return res.status(400).json({ error: problem });
  const r = await q(
    `UPDATE users SET password_hash = $2, must_change_password = false,
       token_version = token_version + 1, updated_at = now()
     WHERE id = $1 RETURNING *`, [me.id, bcrypt.hashSync(new_password, 10)]);
  res.json({ token: sign(r.rows[0], req.user.deviceId), user: publicUser(r.rows[0]) });
});
