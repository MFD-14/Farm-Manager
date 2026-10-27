// Each sale is its own record (any number a day, walk-ins included). The
// fold projects it into the same readings the old daily C-02 task wrote, so
// the dashboard, KPIs and the kale plan count it: sales_usd always, and
// bundles_sold when the sale is counted in bundles.
export async function projectSale(c, event) {
  const r = event.payload.record;
  const at = event.device_time || new Date().toISOString();
  const add = (metric, value, unit) => c.query(
    `INSERT INTO readings (metric, value, unit, taken_at, source_event_uuid, device_id) VALUES ($1, $2, $3, $4, $5, $6)`,
    [metric, value, unit, at, event.event_uuid, event.device_id || null]);
  if (r.price_usd !== undefined && Number(r.price_usd) >= 0) await add("sales_usd", Number(r.price_usd), "USD");
  if (r.unit === "bundles" && Number(r.quantity) > 0) await add("bundles_sold", Number(r.quantity), "bundles");
}
