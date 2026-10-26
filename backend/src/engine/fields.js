// Field outlines arrive as farm-level field_recorded events with an `outline`
// payload, from a Google Earth (KML) import or a walked GPS boundary, so they
// work offline through the outbox like any other record. Owners and task
// managers change the outline; a caretaker's walk is held as a proposal.

const R = 6378137; // WGS84 equatorial radius, metres

// Area of a closed ring of [lng, lat] points in hectares (spherical excess
// approximation, as used by turf.js; good to well under 1% at field scale).
export function ringAreaHa(ring) {
  const rad = (d) => (d * Math.PI) / 180;
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % ring.length];
    a += rad(x2 - x1) * (2 + Math.sin(rad(y1)) + Math.sin(rad(y2)));
  }
  return Math.abs((a * R * R) / 2) / 10_000;
}

const validRing = (pts) => Array.isArray(pts) && pts.length >= 3
  && pts.every((p) => Array.isArray(p) && Math.abs(p[0]) <= 180 && Math.abs(p[1]) <= 90);

export async function applyOutline(c, event) {
  const o = event.payload.outline;
  const console_ = ["owner", "manager"].includes(event.actor_type);
  const meta = (geom) => ({
    area_ha: Math.round(ringAreaHa(geom.coordinates[0]) * 1000) / 1000,
    source: o.source || "google_earth", accuracy_m: o.accuracy_m ?? null,
    by: event.actor_id || null, at: event.device_time || new Date().toISOString(),
  });

  if (o.discard) {
    if (console_) await c.query(`UPDATE locations SET geom_proposed = NULL WHERE id = $1`, [o.location_id]);
    return;
  }
  if (!validRing(o.coordinates)) return;
  const ring = o.coordinates.map((p) => [Number(p[0]), Number(p[1])]);
  const geom = { type: "Polygon", coordinates: [[...ring, ring[0]]] };

  // A new bed or field named in Google Earth (owners and task managers only).
  let id = o.location_id;
  if (!id && console_ && o.name) {
    const code = `FLD-${String(event.event_uuid).slice(0, 6).toUpperCase()}`;
    id = (await c.query(
      `INSERT INTO locations (code, name, kind, status) VALUES ($1, $2, $3, 'active') RETURNING id`,
      [code, String(o.name).slice(0, 120), o.kind === "paddock" ? "paddock" : "block"])).rows[0].id;
  }
  if (!id) return;

  if (console_) {
    await c.query(`UPDATE locations SET geom = $2, geom_meta = $3, geom_proposed = NULL WHERE id = $1`,
      [id, geom, meta(geom)]);
  } else {
    await c.query(`UPDATE locations SET geom_proposed = $2 WHERE id = $1`, [id, { geometry: geom, ...meta(geom) }]);
  }
}

// "Add field" from the record form (owners and task managers): a named bed or
// field with its size; an outline can follow from Google Earth or a walk.
const TO_HA = { ha: 1, acres: 0.404686, "m²": 0.0001 };
export async function addField(c, event) {
  if (!["owner", "manager"].includes(event.actor_type)) return;
  const r = event.payload.record;
  const name = String(r.name || "").trim().slice(0, 120);
  if (!name) return;
  const ha = Number(r.size) * (TO_HA[r.size_unit] || 1);
  await c.query(
    `INSERT INTO locations (code, name, kind, soil, crop, status, geom_meta) VALUES ($1, $2, 'block', $3, $4, 'active', $5)`,
    [`FLD-${String(event.event_uuid).slice(0, 6).toUpperCase()}`, name, r.soil || null, r.crop || null,
      ha > 0 ? { area_ha: Math.round(ha * 1000) / 1000, source: "entered", by: event.actor_id || null, at: event.device_time || null } : null]);
}
