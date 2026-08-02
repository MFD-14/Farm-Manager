import express from "express";
import helmet from "helmet";
import cors from "cors";
import morgan from "morgan";
import { authRouter } from "./routes/auth.js";
import { syncRouter } from "./routes/sync.js";
import { mediaRouter } from "./routes/media.js";
import { planRouter, instancesRouter } from "./routes/instances.js";
import { templatesRouter, rulesRouter, ownerRouter, devicesRouter } from "./routes/admin.js";
import { webhooksRouter } from "./routes/webhooks.js";

export function createApp() {
  const app = express();
  app.use(helmet());
  app.use(cors());
  app.use(express.json({ limit: "2mb" }));
  if (process.env.NODE_ENV !== "test") app.use(morgan("tiny"));

  app.get("/api/health", (req, res) => res.json({ ok: true, service: "wfm-backend" }));

  app.use("/api/auth", authRouter);
  app.use("/api/sync", syncRouter);
  app.use("/api/media", mediaRouter);
  app.use("/api/plan", planRouter);
  app.use("/api/instances", instancesRouter);
  app.use("/api/templates", templatesRouter);
  app.use("/api/rules", rulesRouter);
  app.use("/api/owner", ownerRouter);
  app.use("/api/devices", devicesRouter);
  app.use("/api/webhooks", webhooksRouter);

  app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).json({ error: "internal error" });
  });
  return app;
}
