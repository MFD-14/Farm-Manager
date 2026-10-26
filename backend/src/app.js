import express from "express";
import helmet from "helmet";
import cors from "cors";
import morgan from "morgan";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { authRouter } from "./routes/auth.js";
import { usersRouter } from "./routes/users.js";
import { integrationsRouter } from "./routes/integrations.js";
import { vimRouter } from "./routes/vim.js";
import { syncRouter } from "./routes/sync.js";
import { mediaRouter } from "./routes/media.js";
import { planRouter, instancesRouter } from "./routes/instances.js";
import { templatesRouter, rulesRouter, ownerRouter, devicesRouter } from "./routes/admin.js";
import { webhooksRouter } from "./routes/webhooks.js";

// Built PWA, served from the same origin so one address gives the API, the
// installable web app and the target the phone shells point at.
const WEB_DIST = process.env.WEB_DIST
  || path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../frontend/dist");

export function createApp() {
  const app = express();
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        imgSrc: ["'self'", "data:", "blob:"],
        connectSrc: ["'self'"],
        workerSrc: ["'self'"],
        fontSrc: ["'self'", "data:"],
        styleSrc: ["'self'", "'unsafe-inline'"],
      },
    },
    // The phone shells load the app from the device (capacitor://localhost,
    // https://localhost) and call this API cross-origin.
    crossOriginResourcePolicy: { policy: "cross-origin" },
  }));
  app.use(cors());
  // Keep the raw body: Meta signs WhatsApp webhooks over the exact bytes.
  app.use(express.json({ limit: "2mb", verify: (req, res, buf) => { req.rawBody = buf; } }));
  if (process.env.NODE_ENV !== "test") app.use(morgan("tiny"));

  app.get("/api/health", (req, res) => res.json({ ok: true, service: "wfm-backend" }));

  app.use("/api/auth", authRouter);
  app.use("/api/users", usersRouter);
  app.use("/api/integrations", integrationsRouter);
  app.use("/api/vim", vimRouter);
  app.use("/api/sync", syncRouter);
  app.use("/api/media", mediaRouter);
  app.use("/api/plan", planRouter);
  app.use("/api/instances", instancesRouter);
  app.use("/api/templates", templatesRouter);
  app.use("/api/rules", rulesRouter);
  app.use("/api/owner", ownerRouter);
  app.use("/api/devices", devicesRouter);
  app.use("/api/webhooks", webhooksRouter);

  if (fs.existsSync(path.join(WEB_DIST, "index.html"))) {
    // The service worker must always revalidate or installed phones never
    // pick up a new release.
    app.use(express.static(WEB_DIST, {
      setHeaders: (res, file) => {
        if (/(sw\.js|workbox-.*\.js|index\.html|manifest\.webmanifest)$/.test(file)) {
          res.setHeader("Cache-Control", "no-cache");
        }
      },
    }));
    app.get(/^\/(?!api\/).*/, (req, res) => res.sendFile(path.join(WEB_DIST, "index.html")));
  }

  app.use("/api", (req, res) => res.status(404).json({ error: "not found" }));

  app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).json({ error: "internal error" });
  });
  return app;
}
