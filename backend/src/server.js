import cron from "node-cron";
import { createApp } from "./app.js";
import { config } from "./config.js";
import { migrate } from "./db/migrate.js";
import { tx } from "./db/pool.js";
import { runRelease } from "./engine/release.js";
import { runEscalationSweep } from "./engine/escalation.js";
import { evaluateRules } from "./engine/rules.js";
import { sendDigest } from "./engine/digest.js";
import { processVimQueue, vimOutageSweep } from "./workers/vim.js";
import { runMorningPlan } from "./workers/morningPlan.js";
import { fetchForecast } from "./workers/forecast.js";
import { farmDateStr } from "./util/time.js";

const TZ = { timezone: config.farmTz };

async function main() {
  await migrate();
  const app = createApp();
  app.listen(config.port, () => console.log(`wfm-backend listening on :${config.port}`));

  // 04:15 farm time: pull the forecast so T2 can evaluate it before release;
  // also fetch once at boot. Failures are silent — the gauge path never depends
  // on the network.
  tx((c) => fetchForecast(c)).catch(() => {});
  cron.schedule("15 4 * * *", async () => {
    try { await tx((c) => fetchForecast(c)); } catch { /* keep last snapshot */ }
  }, TZ);

  // 04:45 farm time: materialise the day (spec 3.6).
  cron.schedule(config.releaseCron, async () => {
    try {
      const r = await tx((c) => runRelease(c, farmDateStr()));
      console.log(`release: ${r.planIds.length} instances`);
    } catch (e) { console.error("release failed", e); }
  }, TZ);

  // Escalation, rules and VIM every 5 minutes; timers fire without request traffic
  // (spec 7.2 item 5: the design assumes one always-on worker process — this one).
  cron.schedule(config.escalationCron, async () => {
    try {
      await tx((c) => runEscalationSweep(c));
      await tx((c) => evaluateRules(c));
      await tx((c) => runMorningPlan(c));
      await processVimQueue();
    } catch (e) { console.error("sweep failed", e); }
  }, TZ);

  // 19:00 farm time: owner digest (spec 4.5).
  cron.schedule(config.digestCron, async () => {
    try { await tx((c) => sendDigest(c)); } catch (e) { console.error("digest failed", e); }
  }, TZ);

  // Hourly: VIM outage fallback sweep (spec 5.5).
  cron.schedule("15 * * * *", async () => {
    try { await vimOutageSweep(); } catch (e) { console.error("vim outage sweep failed", e); }
  }, TZ);
}

main().catch((e) => { console.error(e); process.exit(1); });
