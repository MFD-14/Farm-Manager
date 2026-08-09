import bcrypt from "bcryptjs";
import { fileURLToPath } from "node:url";
import { pool, tx } from "./pool.js";
import {
  TEMPLATES, CHAIN_SUPPORT_TEMPLATES,
} from "../../seeds/taxonomy.js";
import { ESCALATION_PROFILES, RULES, ASSETS, LOCATIONS, HERDS, INVENTORY } from "../../seeds/reference.js";

export async function seed({ withUsers = true } = {}) {
  await tx(async (c) => {
    // Users
    let owner, caretaker;
    if (withUsers) {
      const hash = bcrypt.hashSync("woodlands", 10);
      const or = await c.query(
        `INSERT INTO users (email, password_hash, name, role, phone)
         VALUES ('owner@woodlands.farm', $1, 'Owner', 'owner', '+263770000001')
         ON CONFLICT (email) DO UPDATE SET updated_at = now() RETURNING id`, [hash]);
      owner = or.rows[0].id;
      const cr = await c.query(
        `INSERT INTO users (email, password_hash, name, role, phone)
         VALUES ('caretaker@woodlands.farm', $1, 'Caretaker', 'caretaker', '+263770000002')
         ON CONFLICT (email) DO UPDATE SET updated_at = now() RETURNING id`, [hash]);
      caretaker = cr.rows[0].id;
      await c.query(
        `INSERT INTO wa_contacts (user_id, wa_phone) VALUES ($1,'+263770000001'), ($2,'+263770000002')
         ON CONFLICT (wa_phone) DO NOTHING`, [owner, caretaker]);
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

    // Locations
    const locIds = {};
    for (const l of LOCATIONS) {
      const r = await c.query(
        `INSERT INTO locations (code, name, kind, crop, plant_count, irrigated, rainfed_capable)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
        [l.code, l.name, l.kind, l.crop || null, l.plant_count || null, !!l.irrigated, !!l.rainfed_capable]);
      locIds[l.code] = r.rows[0].id;
    }

    // Herd
    const herdIds = {};
    for (const h of HERDS) {
      const existing = await c.query(`SELECT id FROM herds WHERE name = $1`, [h.name]);
      if (existing.rows.length) { herdIds[h.name] = existing.rows[0].id; continue; }
      const r = await c.query(
        `INSERT INTO herds (name, species, head_count) VALUES ($1,$2,$3) RETURNING id`,
        [h.name, h.species, h.head_count]);
      herdIds[h.name] = r.rows[0].id;
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
      for (const k of ["readings", "meters", "anchor_emit", "inventory_out", "inventory_in", "rotation_register", "withdrawal_from_product", "e0_sampled", "assignee_role"]) {
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
         ('water_params', '{"tank_usable": 80000, "pool_volume": 45000, "borehole_lph": 6000}'),
         ('irrigation_demand', '{"BLK-A": {"litres_per_plant": 1.2, "emitter_lph": 2.0},
                                 "BLK-B": {"litres_per_day": 7000}}'),
         ('water_balance', '{"enabled": false,
            "blocks": {
              "BLK-A": {"kc": 1.0, "taw_mm": 60, "mad": 0.45, "area_m2": 2700, "rate_mm_h": 7.4, "efficiency": 0.9},
              "BLK-B": {"kc": 1.1, "taw_mm": 90, "mad": 0.5, "area_m2": 2250, "rate_mm_h": 5.0, "efficiency": 0.9}
            }}')
       ON CONFLICT (key) DO NOTHING`);
  });
  console.log("seeded");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  seed()
    .then(() => pool.end())
    .catch((e) => { console.error(e); process.exit(1); });
}
