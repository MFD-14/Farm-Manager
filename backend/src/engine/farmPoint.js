// The farm's point on the map: the middle of the imported farm boundary when
// there is one, else FARM_LAT / FARM_LNG (default Kwekwe). Used for the map
// and for the weather and rainfall feeds, so no coordinates live in the code.
export async function farmPoint(c) {
  const ring = (await c.query(`SELECT geom FROM locations WHERE code = 'FARM-BOUNDARY'`)).rows[0]?.geom?.coordinates?.[0];
  if (ring?.length > 3) {
    const pts = ring.slice(0, -1);
    return { lat: pts.reduce((a, p) => a + p[1], 0) / pts.length, lng: pts.reduce((a, p) => a + p[0], 0) / pts.length };
  }
  return { lat: Number(process.env.FARM_LAT || -18.9281), lng: Number(process.env.FARM_LNG || 29.8149) };
}
