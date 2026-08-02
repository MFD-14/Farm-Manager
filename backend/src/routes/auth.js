import { Router } from "express";
import bcrypt from "bcryptjs";
import { q } from "../db/pool.js";
import { sign, auth } from "../middleware/auth.js";

export const authRouter = Router();

authRouter.post("/login", async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: "email and password required" });
  const r = await q(`SELECT * FROM users WHERE email = $1`, [email.toLowerCase()]);
  const user = r.rows[0];
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: "invalid credentials" });
  }
  res.json({
    token: sign(user),
    user: { id: user.id, name: user.name, role: user.role, email: user.email },
  });
});

authRouter.get("/me", auth(), async (req, res) => {
  const r = await q(`SELECT id, name, role, email, phone FROM users WHERE id = $1`, [req.user.id]);
  res.json({ user: r.rows[0] || null });
});
