import dotenv from "dotenv";
dotenv.config();

const env = process.env;

export const config = {
  env: env.NODE_ENV || "development",
  port: parseInt(env.PORT || "4000", 10),
  databaseUrl:
    env.NODE_ENV === "test"
      ? env.TEST_DATABASE_URL || "postgres://wfm:wfm@127.0.0.1:5432/wfm_test"
      : env.DATABASE_URL || "postgres://wfm:wfm@127.0.0.1:5432/wfm",
  redisUrl: env.REDIS_URL || "redis://127.0.0.1:6379",
  jwtSecret: env.JWT_SECRET || "dev-secret-change-me",
  jwtExpiry: env.JWT_EXPIRY || "30d",
  farmTz: env.FARM_TZ || "Africa/Harare",
  mediaDir: env.MEDIA_DIR || "./media",
  // Water system parameters (spec 3.5 / T1). TANK_USABLE is entered after Phase 0.
  tankUsable: parseInt(env.TANK_USABLE || "80000", 10),
  poolVolume: parseInt(env.POOL_VOLUME || "45000", 10),
  boreholeLph: parseInt(env.BOREHOLE_LPH || "6000", 10),
  anthropicKey: env.ANTHROPIC_API_KEY || "",
  vimMode: env.VIM_MODE || "heuristic", // heuristic | claude
  wa: {
    token: env.WA_TOKEN || "",
    phoneId: env.WA_PHONE_ID || "",
    verifyToken: env.WA_VERIFY_TOKEN || "change-me-verify",
  },
  // Release engine fires at 04:45 farm time (spec 3.6); digest at 19:00 (spec 4.5)
  releaseCron: env.RELEASE_CRON || "45 4 * * *",
  digestCron: env.DIGEST_CRON || "0 19 * * *",
  escalationCron: env.ESCALATION_CRON || "*/5 * * * *",
};
