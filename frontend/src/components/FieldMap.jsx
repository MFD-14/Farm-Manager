// Field outlines on Esri World Imagery (satellite tiles need signal; the
// outlines come from the cached day bundle, so they show offline too). Walked
// outlines waiting for an owner are dashed gold; a live walk draws as a line.
import React, { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

const IMAGERY = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
const FARM_CENTER = { lat: -18.9281, lng: 29.8149 }; // FARM_LAT / FARM_LNG default
const latlngs = (ring) => ring.map(([lng, lat]) => [lat, lng]);

export default function FieldMap({ locations = [], center = FARM_CENTER, track, selected, onSelect, height = 300 }) {
  const el = useRef(null);
  const map = useRef(null);
  const layer = useRef(null);
  const fitted = useRef(false);

  useEffect(() => {
    map.current = L.map(el.current, { zoomControl: true, attributionControl: true }).setView([center.lat, center.lng], 15);
    L.tileLayer(IMAGERY, { maxZoom: 20, maxNativeZoom: 19,
      attribution: "Imagery © Esri, Maxar, Earthstar Geographics" }).addTo(map.current);
    layer.current = L.layerGroup().addTo(map.current);
    return () => map.current.remove();
  }, [center.lat, center.lng]);

  useEffect(() => {
    const g = layer.current;
    g.clearLayers();
    const bounds = [];
    // The farm boundary first, as a red line with no fill, so beds draw on top.
    const boundaryFirst = [...locations].sort((a, b) => (b.code === "FARM-BOUNDARY") - (a.code === "FARM-BOUNDARY"));
    for (const l of boundaryFirst) {
      if (l.geom) {
        const poly = L.polygon(latlngs(l.geom.coordinates[0]), l.code === "FARM-BOUNDARY"
          ? { color: l.id === selected ? "#e0be5f" : "#c0392b", weight: 3, fill: false }
          : { color: l.id === selected ? "#e0be5f" : "#45b868", weight: l.id === selected ? 4 : 2, fillOpacity: 0.15 }).bindTooltip(l.name, { sticky: true }).on("click", () => onSelect?.(l));
        g.addLayer(poly);
        bounds.push(...poly.getLatLngs()[0]);
      }
      if (l.geom_proposed) {
        g.addLayer(L.polygon(latlngs(l.geom_proposed.geometry.coordinates[0]), { color: "#d4a843", dashArray: "6 6", weight: 2, fillOpacity: 0.05 })
          .bindTooltip(`${l.name} (walked, waiting)`, { sticky: true }).on("click", () => onSelect?.(l)));
      }
    }
    if (track?.length) {
      const line = L.polyline(latlngs(track), { color: "#ffffff", weight: 3 });
      g.addLayer(line);
      g.addLayer(L.circleMarker(latlngs(track.slice(-1))[0], { radius: 6, color: "#e74c3c", fillOpacity: 1 }));
      map.current.panTo(latlngs(track.slice(-1))[0]);
    } else if (bounds.length && !fitted.current) {
      map.current.fitBounds(L.latLngBounds(bounds), { padding: [20, 20] });
      fitted.current = true;
    }
  }, [locations, track, selected, onSelect]);

  return <div ref={el} className="field-map" style={{ height }} />;
}
