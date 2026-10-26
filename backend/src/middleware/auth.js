import jwt from "jsonwebtoken";
import { config } from "../config.js";
import { q } from "../db/pool.js";

export function sign(user, deviceId = null) {
  return jwt.sign(
    { sub: user.id, role: user.role, device_id: deviceId, tv: user.token_version ?? 0 },
    config.jwtSecret,
    { expiresIn: config.jwtExpiry });
}

export function auth(required = true) {
  return async (req, res, next) => {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : null;
    if (!token) {
      if (!required) return next();
      return res.status(401).json({ error: "missing token" });
    }
    let claims;
    try {
      claims = jwt.verify(token, config.jwtSecret);
    } catch {
      return res.status(401).json({ error: "invalid token" });
    }
    // The account row is authoritative: a deactivated account, or a password
    // changed since this token was issued, ends the session; a role change
    // applies immediately.
    const u = await q(`SELECT role, active, token_version FROM users WHERE id = $1`, [claims.sub]);
    const row = u.rows[0];
    if (!row || !row.active) return res.status(401).json({ error: "account disabled" });
    if ((claims.tv ?? 0) !== row.token_version) return res.status(401).json({ error: "session ended" });
    req.user = { id: claims.sub, role: row.role, deviceId: claims.device_id || null };
    if (claims.device_id) {
      const d = await q(`SELECT revoked FROM devices WHERE id = $1`, [claims.device_id]);
      if (d.rows[0]?.revoked) return res.status(401).json({ error: "device revoked" });
    }
    next();
  };
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: "forbidden" });
    }
    next();
  };
}

// Sales money is for owners and task managers only: a caretaker records a
// sale's amount but never gets amounts back from the server (task records,
// the day bundle's last values, event payloads).
const MONEY_KEYS = new Set(["price_usd"]);
export function hideRevenue(req, res, next) {
  const json = res.json.bind(res);
  res.json = (body) => (req.user && !["owner", "admin", "manager"].includes(req.user.role)
    ? json(JSON.parse(JSON.stringify(body, (k, v) => (MONEY_KEYS.has(k) ? undefined : v))))
    : json(body));
  next();
}
