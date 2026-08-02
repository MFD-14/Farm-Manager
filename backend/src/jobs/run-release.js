import { tx, pool } from "../db/pool.js";
import { runRelease } from "../engine/release.js";
import { farmDateStr } from "../util/time.js";

const date = process.argv[2] || farmDateStr();
tx((c) => runRelease(c, date))
  .then((r) => {
    console.log(`released ${r.planIds.length} instances for ${date}`);
    console.log("capacity:", JSON.stringify(r.capacityNote));
    return pool.end();
  })
  .catch((e) => { console.error(e); process.exit(1); });
