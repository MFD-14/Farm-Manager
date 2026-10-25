// Makes ACCOUNT_EMAIL an active owner with ACCOUNT_PASSWORD. Run by the server
// installer when ADMIN_EMAIL / ADMIN_PASSWORD are given, so the farm owner
// signs in with their own address from the start:
//   ACCOUNT_EMAIL=me@example.com ACCOUNT_PASSWORD=... node src/jobs/set-owner.js
// An existing account with that email is promoted; otherwise the starter
// owner@woodlands.farm account is renamed (keeping its history); otherwise a
// new owner is created. Signs out existing sessions of that account.
import { fileURLToPath } from "node:url";
import bcrypt from "bcryptjs";
import { tx, pool } from "../db/pool.js";
import { normalizeEmail, validEmail, passwordProblem } from "../routes/users.js";

export async function setOwnerAccount({ email, password, name }) {
  email = normalizeEmail(email);
  if (!validEmail(email)) throw new Error("ACCOUNT_EMAIL is not a valid email address");
  const problem = passwordProblem(password);
  if (problem) throw new Error(problem);
  const hash = bcrypt.hashSync(password, 10);
  return tx(async (c) => {
    const promote = (id) => c.query(
      `UPDATE users SET email = $2, password_hash = $3, role = 'owner', active = true,
         pending_approval = false, must_change_password = false, name = COALESCE($4, name),
         token_version = token_version + 1, updated_at = now()
       WHERE id = $1 RETURNING id, email, name`, [id, email, hash, name || null]);
    const same = await c.query(`SELECT id FROM users WHERE lower(email) = $1`, [email]);
    if (same.rows[0]) return { action: "updated", ...(await promote(same.rows[0].id)).rows[0] };
    const starter = await c.query(`SELECT id FROM users WHERE email = 'owner@woodlands.farm'`);
    if (starter.rows[0]) return { action: "renamed starter owner", ...(await promote(starter.rows[0].id)).rows[0] };
    const r = await c.query(
      `INSERT INTO users (email, password_hash, name, role) VALUES ($1, $2, $3, 'owner')
       RETURNING id, email, name`, [email, hash, name || "Owner"]);
    return { action: "created", ...r.rows[0] };
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  setOwnerAccount({
    email: process.env.ACCOUNT_EMAIL,
    password: process.env.ACCOUNT_PASSWORD,
    name: process.env.ACCOUNT_NAME,
  })
    .then((r) => { console.log(`owner account ${r.email}: ${r.action}`); return pool.end(); })
    .catch((e) => { console.error(`Could not set the owner account: ${e.message}`); process.exit(1); });
}
