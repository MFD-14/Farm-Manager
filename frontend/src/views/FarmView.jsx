// Farm profile: the real Woodlands Farm at a glance — water system with
// buffer autonomy, livestock and flocks, and the block layout. Cached for
// offline viewing like every other reference screen.
import React, { useEffect, useState } from "react";
import { apiJson } from "../lib/api.js";
import { metaGet, metaSet } from "../lib/db.js";

const STATUS_CHIP = { active: "state-verified_closed", planted: "P2", fallow: "P3", planned: "state-released", reserve: "P3" };
const SPECIES_LABEL = { cattle: "Cattle", goats: "Goats", pigs: "Pigs" };

export default function FarmView() {
  const [data, setData] = useState(null);
  const [stale, setStale] = useState(false);

  useEffect(() => {
    (async () => {
      const cached = await metaGet("farm_cache");
      if (cached) { setData(cached); setStale(true); }
      try {
        const fresh = await apiJson("/api/owner/farm");
        setData(fresh); setStale(false);
        await metaSet("farm_cache", fresh);
      } catch { /* offline: cached view stands */ }
    })();
  }, []);

  if (!data) return <div className="wrap"><div className="empty">Loading farm profile…</div></div>;
  const { farm, water, livestock, blocks } = data;
  const maxHa = Math.max(...blocks.map((b) => b.hectares));

  return (
    <div className="wrap">
      <div className="daytitle">{farm.name}</div>
      <p className="farm-sub">{farm.subdivision} · {farm.location}</p>
      {stale && <p className="evidence-note" style={{ marginBottom: 8 }}>Offline — showing last synced data</p>}

      <div className="stat-row">
        <div className="stat"><div className="v">{farm.total_ha}</div><div className="l">hectares</div></div>
        <div className="stat"><div className="v">{farm.cropped_ha}</div><div className="l">cropped ha</div></div>
        <div className="stat"><div className="v">{livestock.totals.cattle + livestock.totals.goats + livestock.totals.pigs}</div><div className="l">head stock</div></div>
      </div>

      <div className="section-title">Water system</div>
      <div className="card">
        {water.stored_pct !== null && (
          <div className="wb-gauge" style={{ marginTop: 2, marginBottom: 10 }}>
            <div className="track" style={{ background: "var(--b1)" }}>
              <div className="fill" style={{ width: `${Math.min(100, water.stored_pct)}%` }} />
              <div className="mad" style={{ left: `${water.low_water_trigger_pct}%` }} title="T1 low-water line" />
            </div>
            <div className="wb-gauge-labels">
              <span><b>{(water.stored_l / 1000).toFixed(1)} kL</b> stored ({water.stored_pct}%)</span>
              <span>T1 at {water.low_water_trigger_pct}%</span>
            </div>
          </div>
        )}
        <div className="kv"><span>Borehole delivery</span><b>{water.borehole_lph.toLocaleString()} L/h</b></div>
        <div className="kv"><span>Daily pumping capacity</span><b>{(water.daily_pump_capacity_l / 1000).toFixed(0)} kL · ~{water.pumping_hours_per_day} h</b></div>
        <div className="kv"><span>Storage pool</span><b>{(water.pool_volume / 1000).toFixed(0)} kL</b></div>
        <div className="kv">
          <span>Main tank (usable)</span>
          <b>{water.tank_usable_measured
            ? `${(water.tank_usable / 1000).toFixed(0)} kL measured`
            : `${water.tank_usable_range[0] / 1000}–${water.tank_usable_range[1] / 1000} kL est.`}</b>
        </div>
        <div className="kv"><span>Peak demand</span><b>{(water.peak_crop_demand_l_per_day / 1000).toFixed(1)} kL crops + {(water.stock_water_l_per_day / 1000).toFixed(1)} kL stock</b></div>
        <div className="kv"><span>Pumping headroom</span><b>{water.pumping_headroom_pct}%</b></div>
        <div className="kv">
          <span>Autonomy if borehole stops</span>
          <b>{water.autonomy_days !== null ? `${water.autonomy_days} days now` : `${water.full_buffer_autonomy_days} days full`}</b>
        </div>
        {!water.tank_usable_measured && (
          <p className="evidence-note" style={{ textAlign: "left", marginTop: 8 }}>
            Tank volume is an estimate until Phase 0 rehabilitation measures it. The low end is used for
            the low-water trigger, so alerts err early, not late.
          </p>
        )}
      </div>

      <div className="section-title">Livestock</div>
      {livestock.herds.map((h) => (
        <div className="card" key={h.name}>
          <div className="row">
            <h3>{SPECIES_LABEL[h.species] || h.species} · {h.breed}</h3>
            <span className="farm-count">{h.head_count}</span>
          </div>
          <div className="meta"><span>{h.location}</span></div>
          {h.notes && <p className="farm-notes">{h.notes}</p>}
        </div>
      ))}
      {livestock.flocks.map((f) => (
        <div className="card" key={f.name}>
          <div className="row">
            <h3>Poultry · {f.name}</h3>
            <span className="farm-count">{f.current_count}</span>
          </div>
          <div className="meta">
            <span>{f.house}</span>
            <span>{f.purpose}</span>
            {f.age_days !== null && <span>{Math.floor(f.age_days / 7)} weeks old</span>}
            <span className="chip state-released">{f.stage}</span>
          </div>
        </div>
      ))}

      <div className="section-title">Land · {farm.mapped_ha} of {farm.total_ha} ha mapped</div>
      <div className="card">
        {blocks.map((b) => (
          <div className="farm-block" key={b.code}>
            <div className="farm-block-head">
              <span className="nm">{b.name}</span>
              <span className={`chip ${STATUS_CHIP[b.status] || "P3"}`}>{b.status}</span>
            </div>
            <div className="farm-bar"><div style={{ width: `${(b.hectares / maxHa) * 100}%` }} data-irrigated={b.irrigated} /></div>
            <div className="farm-block-meta">
              <span><b>{b.hectares} ha</b></span>
              <span>{b.soil}</span>
              {b.plant_count && <span>{b.plant_count.toLocaleString()} plants</span>}
              {b.irrigated && <span>irrigated</span>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
