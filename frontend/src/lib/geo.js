// Field outline helpers: area, distance and Google Earth (KML) parsing.
// Points are [lng, lat], as in GeoJSON.
const R = 6378137;
const rad = (d) => (d * Math.PI) / 180;

// Same formula as the server (backend/src/engine/fields.js).
export function ringAreaHa(ring) {
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % ring.length];
    a += rad(x2 - x1) * (2 + Math.sin(rad(y1)) + Math.sin(rad(y2)));
  }
  return Math.abs((a * R * R) / 2) / 10_000;
}

export function metres([x1, y1], [x2, y2]) {
  const h = Math.sin(rad(y2 - y1) / 2) ** 2 + Math.cos(rad(y1)) * Math.cos(rad(y2)) * Math.sin(rad(x2 - x1) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export const fmtHa = (ha) => (ha < 0.1 ? `${Math.round(ha * 10_000).toLocaleString()} m²` : `${ha.toFixed(2)} ha`);

// Polygons (and closed paths) from a Google Earth Pro "Save Place As… .kml".
export function parseKml(text) {
  const doc = new DOMParser().parseFromString(text, "text/xml");
  if (doc.getElementsByTagName("parsererror").length) throw new Error("That file isn't a readable KML file.");
  const ring = (el) => {
    const pts = (el?.getElementsByTagName("coordinates")[0]?.textContent || "").trim().split(/\s+/)
      .map((t) => t.split(",").map(Number)).filter((p) => p.length >= 2 && p.every((n) => !Number.isNaN(n))).map(([x, y]) => [x, y]);
    if (pts.length > 1 && metres(pts[0], pts[pts.length - 1]) < 0.5) pts.pop();
    return pts;
  };
  return [...doc.getElementsByTagName("Placemark")].flatMap((pm) => {
    const name = pm.getElementsByTagName("name")[0]?.textContent?.trim() || "Unnamed";
    const shapes = [...pm.getElementsByTagName("Polygon")].map((pg) => ring(pg.getElementsByTagName("outerBoundaryIs")[0] || pg));
    if (!shapes.length) shapes.push(...[...pm.getElementsByTagName("LineString")].map(ring));
    return shapes.filter((c) => c.length >= 3).map((coordinates) => ({ name, coordinates }));
  });
}
