// Disaster-recovery path (spec 6.1): rebuild all projections from the event log.
import { tx, pool } from "../db/pool.js";
import { rebuildProjections } from "../engine/fold.js";

tx((c) => rebuildProjections(c))
  .then((n) => { console.log(`replayed ${n} events`); return pool.end(); })
  .catch((e) => { console.error(e); process.exit(1); });
