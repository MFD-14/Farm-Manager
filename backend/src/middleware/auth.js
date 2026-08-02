import jwt from "jsonwebtoken";
import { config } from "../config.js";
import { q } from "../db/pool.js";

export function sign(user, deviceId = null) {
  return jwt.sign({ sub: user.id, role: user.role, device_id: deviceId }, config.jwtSecret, {
    expiresIn: config.jwtExpiry,
  });
}

export function auth(required = true) {
  return async (req, res, next) => {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : null;
    if (!token) {
      if (!required) return next();
      return res.status(401).json({ error: "missing token" });
    }
    try {
      const claims = jwt.verify(token, config.jwtSecret);
      req.user = { id: claims.sub, role: claims.role, deviceId: claims.device_id || null };
      if (claims.device_id) {
        const d = await q(`SELECT revoked FROM devices WHERE id = $1`, [claims.device_id]);
        if (d.rows[0]?.revoked) return res.status(401).json({ error: "device revoked" });
      }
      next();
    } catch {
      res.status(401).json({ error: "invalid token" });
    }
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
