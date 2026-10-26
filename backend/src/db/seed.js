import bcrypt from "bcryptjs";
import { fileURLToPath } from "node:url";
import { pool, tx } from "./pool.js";
import {
  TEMPLATES, CHAIN_SUPPORT_TEMPLATES,
} from "../../seeds/taxonomy.js";
import {
  ESCALATION_PROFILES, RULES, ASSETS, LOCATIONS, HERDS, POULTRY_BATCHES, INVENTORY, WATER_SYSTEM,
  KALE_PLAN, POULTRY_PLAN, FAW_HISTORY, SCALING_PLAN,
} from "../../seeds/reference.js";

export async function seed({ withUsers = true } = {}) {
  await tx(async (c) => {
    // Users
    let owner, caretaker;
    if (withUsers) {
      // First-run passwords. An existing account keeps its password on re-seed;
      // deployments set OWNER_PASSWORD / CARETAKER_PASSWORD so the server never
      // goes live on the demo password.
      const ownerHash = bcrypt.hashSync(process.env.OWNER_PASSWORD || "woodlands", 10);
      const careHash = bcrypt.hashSync(process.env.CARETAKER_PASSWORD || "woodlands", 10);
      if (process.env.NODE_ENV === "production" && (!process.env.OWNER_PASSWORD || !process.env.CARETAKER_PASSWORD)) {
        console.warn("WARNING: OWNER_PASSWORD / CARETAKER_PASSWORD not set; new accounts use the demo password.");
      }
      // The starter accounts are found by role, not email, so an owner who
      // renames their account to their own address doesn't get the starter
      // account back on the next restart.
      const starter = async (role, email, name, phone, hash) => {
        const existing = await c.query(
          `SELECT id FROM users WHERE role = $1 ORDER BY active DESC, created_at LIMIT 1`, [role]);
        if (existing.rows[0]) return existing.rows[0].id;
        const r = await c.query(
          `INSERT INTO users (email, password_hash, name, role, phone)
           VALUES ($1, $2, $3, $4, $5) RETURNING id`, [email, hash, name, role, phone]);
        await c.query(
          `INSERT INTO wa_contacts (user_id, wa_phone) VALUES ($1, $2) ON CONFLICT (wa_phone) DO NOTHING`,
          [r.rows[0].id, phone]);
        return r.rows[0].id;
      };
      owner = await starter("owner", "owner@woodlands.farm", "Owner", "+263770000001", ownerHash);
      caretaker = await starter("caretaker", "caretaker@woodlands.farm", "Caretaker", "+263770000002", careHash);
    }

    // Escalation profiles
    for (const p of ESCALATION_PROFILES) {
      await c.query(
        `INSERT INTO escalation_profiles (name, rungs) VALUES ($1, $2)
         ON CONFLICT (name) DO UPDATE SET rungs = EXCLUDED.rungs`, [p.name, p.rungs]);
    }

    // Assets (parents first)
    const assetIds = {};
    for (const a of ASSETS) {
      const r = await c.query(
        `INSERT INTO assets (code, name, kind, parent_id, meters, criticality)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
        [a.code, a.name, a.kind, a.parent ? assetIds[a.parent] : null, a.meters || {}, a.criticality || "P2"]);
      assetIds[a.code] = r.rows[0].id;
    }

    // Locations. Descriptive fields refresh on re-seed; plant_count is left
    // alone on conflict because anchor events maintain it once the farm runs.
    const locIds = {};
    for (const l of LOCATIONS) {
      const r = await c.query(
        `INSERT INTO locations (code, name, kind, crop, plant_count, irrigated, rainfed_capable, hectares, soil, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, crop = EXCLUDED.crop,
           irrigated = EXCLUDED.irrigated, rainfed_capable = EXCLUDED.rainfed_capable,
           hectares = EXCLUDED.hectares, soil = EXCLUDED.soil, status = EXCLUDED.status,
           updated_at = now()
         RETURNING id`,
        [l.code, l.name, l.kind, l.crop || null, l.plant_count || null, !!l.irrigated,
         !!l.rainfed_capable, l.hectares ?? null, l.soil || null, l.status || "active"]);
      locIds[l.code] = r.rows[0].id;
    }

    // Herds. head_count is a fold-maintained projection, so an existing herd
    // keeps its live count; only the descriptive record refreshes.
    const herdIds = {};
    for (const h of HERDS) {
      const existing = await c.query(`SELECT id FROM herds WHERE name = $1`, [h.name]);
      if (existing.rows.length) {
        herdIds[h.name] = existing.rows[0].id;
        await c.query(
          `UPDATE herds SET species = $2, breed = $3, location = $4, notes = $5, updated_at = now() WHERE id = $1`,
          [existing.rows[0].id, h.species, h.breed || null, h.location || null, h.notes || null]);
        continue;
      }
      const r = await c.query(
        `INSERT INTO herds (name, species, head_count, breed, location, notes)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [h.name, h.species, h.head_count, h.breed || null, h.location || null, h.notes || null]);
      herdIds[h.name] = r.rows[0].id;
    }

    // Poultry flocks as batches: the anchor entities the per-batch dailies hang off.
    for (const b of POULTRY_BATCHES) {
      await c.query(
        `INSERT INTO batches (species, name, house_location_id, placed_on, placed_count, current_count, stage, purpose)
         SELECT 'poultry', $1, $2, $3, $4, $5, $6, $7
         WHERE NOT EXISTS (SELECT 1 FROM batches WHERE name = $1)`,
        [b.name, locIds[b.house] || null, b.placed_on, b.placed_count, b.current_count, b.stage, b.purpose]);
    }

    // Inventory
    for (const i of INVENTORY) {
      await c.query(
        `INSERT INTO inventory_items (name, unit, category, on_hand, reorder_point, reorder_qty, withdrawal_days, phi_days, irac_group)
         SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9
         WHERE NOT EXISTS (SELECT 1 FROM inventory_items WHERE name = $1)`,
        [i.name, i.unit, i.category, i.on_hand, i.reorder_point, i.reorder_qty, i.withdrawal_days || null, i.phi_days || null, i.irac_group || null]);
    }

    // Subject resolution for templates
    const subjectId = (t) => {
      if (!t.subject_code) return null;
      if (t.subject_type === "asset") return assetIds[t.subject_code] || null;
      if (t.subject_type === "location") return locIds[t.subject_code] || null;
      if (t.subject_type === "herd") return herdIds["Main herd"] || null;
      return null;
    };

    // Templates (taxonomy + chain support)
    for (const t of [...TEMPLATES, ...CHAIN_SUPPORT_TEMPLATES]) {
      const extra = {};
      for (const k of ["readings", "meters", "anchor_emit", "inventory_out", "inventory_in", "rotation_register", "withdrawal_from_product", "e0_sampled", "assignee_role", "project"]) {
        if (t[k] !== undefined) extra[k] = t[k];
      }
      await c.query(
        `INSERT INTO task_templates
           (code, title, domain, subject_type, default_subject_id, priority, est_minutes,
            instructions, checklist, evidence_policy, schedule, guards, escalation_profile, version)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,1)
         ON CONFLICT (code, version) DO UPDATE SET
           title = EXCLUDED.title, evidence_policy = EXCLUDED.evidence_policy,
           schedule = EXCLUDED.schedule, guards = EXCLUDED.guards, updated_at = now()`,
        [
          t.code, t.title, t.domain, t.subject_type || "none", subjectId(t),
          t.priority, t.est_minutes ?? 1,
          JSON.stringify(t.instructions || []),
          JSON.stringify(t.checklist || []),
          JSON.stringify({ ...t.evidence_policy, ...extra }),
          t.schedule ? JSON.stringify(t.schedule) : null,
          JSON.stringify(t.guards || []),
          t.escalation_profile || t.priority,
        ]);
    }

    // Maize and sorghum are grown in the homestead garden (owner's farm brief),
    // so the maize armyworm scout and the planting task are on. An earlier
    // land-use update had switched them off; switch them back on once. The
    // marker stops later restarts overriding an owner's own choice.
    const brief = await c.query(`SELECT 1 FROM farm_settings WHERE key = 'farm_brief_2026_10'`);
    if (!brief.rows.length) {
      await c.query(`UPDATE task_templates SET active = true WHERE code IN ('C-04', 'C-09')`);
      await c.query(
        `INSERT INTO farm_settings (key, value) VALUES ('farm_brief_2026_10', $1)`,
        [JSON.stringify({ applied_at: new Date().toISOString(), reactivated: ["C-04", "C-09"] })]);
    }

    // Rules
    for (const r of RULES) {
      await c.query(
        `INSERT INTO rules (name, source, condition, action, cooldown_h, arm_condition, two_stage)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (name) DO UPDATE SET condition = EXCLUDED.condition, action = EXCLUDED.action,
           cooldown_h = EXCLUDED.cooldown_h, two_stage = EXCLUDED.two_stage, updated_at = now()`,
        [r.name, r.source, r.condition, r.action, r.cooldown_h, r.arm_condition || null, r.two_stage || null]);
    }

    // Farm settings defaults
    await c.query(
      `INSERT INTO farm_settings (key, value) VALUES
         ('absence_mode', '{"active": false}'),
         ('irrigation_demand', '{"BLK-A": {"litres_per_plant": 1.2, "emitter_lph": 2.0},
                                 "BLK-B": {"litres_per_day": 7000}}'),
         ('water_balance', '{"enabled": false,
            "blocks": {
              "BLK-A": {"kc": 1.0, "taw_mm": 60, "mad": 0.45, "area_m2": 2700, "rate_mm_h": 7.4, "efficiency": 0.9},
              "BLK-B": {"kc": 1.1, "taw_mm": 90, "mad": 0.5, "area_m2": 2250, "rate_mm_h": 5.0, "efficiency": 0.9}
            }}')
       ON CONFLICT (key) DO NOTHING`);

    // Scaling plan, kale and poultry plans, spray history: stored once, then
    // the owner's edits (milestone status, dates) are kept on re-seed; new
    // milestones in a later release merge in.
    for (const [key, value] of [["kale_plan", KALE_PLAN], ["poultry_plan", POULTRY_PLAN], ["faw_history", FAW_HISTORY]]) {
      await c.query(`INSERT INTO farm_settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING`,
        [key, JSON.stringify(value)]);
    }
    const plan = (await c.query(`SELECT value FROM farm_settings WHERE key = 'scaling_plan'`)).rows[0]?.value;
    const merged = plan
      ? { ...SCALING_PLAN, ...plan, milestones: [
          ...plan.milestones,
          ...SCALING_PLAN.milestones.filter((m) => !plan.milestones.some((x) => x.key === m.key)),
        ] }
      : SCALING_PLAN;
    await c.query(
      `INSERT INTO farm_settings (key, value) VALUES ('scaling_plan', $1)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`, [JSON.stringify(merged)]);

    // Water system. New keys merge in on re-seed; anything already stored wins,
    // so a measured TANK_USABLE entered after Phase 0 is never overwritten.
    await c.query(
      `INSERT INTO farm_settings (key, value) VALUES ('water_params', $1)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value || farm_settings.value, updated_at = now()`,
      [JSON.stringify(WATER_SYSTEM)]);
  });
  console.log("seeded");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  seed()
    .then(() => pool.end())
    .catch((e) => { console.error(e); process.exit(1); });
}
