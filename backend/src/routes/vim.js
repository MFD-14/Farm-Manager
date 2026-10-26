// Feed for the Video Intelligence Module (VIM v1.1): new field videos to
// analyse and their files. Annotations come back through /api/webhooks/vim.
// Both ends need VIM_WEBHOOK_SECRET, sent as x-vim-secret; without it the feed
// is off.
import { Router } from "express";
import path from "node:path";
import { timingSafeEqual } from "node:crypto";
import { q } from "../db/pool.js";
import { config } from "../config.js";
import { pendingVideos } from "../workers/vim.js";

export const vimRouter = Router();

export function vimSecretOk(req) {
  const secret = process.env.VIM_WEBHOOK_SECRET;
  const given = req.get("x-vim-secret") || "";
  return !!secret && given.length === secret.length && timingSafeEqual(Buffer.from(given), Buffer.from(secret));
}

vimRouter.use((req, res, next) => (vimSecretOk(req) ? next() : res.status(403).json({ error: "forbidden" })));

vimRouter.get("/pending", async (req, res) => {
  res.json({ videos: await pendingVideos(Math.min(Number(req.query.limit) || 20, 100)) });
});

vimRouter.get("/media/:uuid", async (req, res) => {
  if (!/^[0-9a-f-]{36}$/i.test(req.params.uuid)) return res.status(404).end();
  const m = (await q(`SELECT storage_key FROM media_objects WHERE media_uuid = $1 AND kind = 'video' AND status = 'stored'`,
    [req.params.uuid])).rows[0];
  if (!m) return res.status(404).end();
  res.sendFile(path.resolve(config.mediaDir, m.storage_key));
});
