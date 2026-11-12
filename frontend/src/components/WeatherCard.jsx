// Today's weather for everyone: sky, temperature, rain, wind, warnings, and
// when it is safe to spray. Reads the forecast cached with the day bundle.
import React, { useEffect, useState } from "react";
import { metaGet } from "../lib/db.js";
import { condition, today, windowText } from "../lib/weather.js";

const ICONS = {
  sun: "M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4M12 8a4 4 0 100 8 4 4 0 000-8z",
  cloud: "M7 18a4 4 0 01-.5-7.97A6 6 0 0118 9.5 4.25 4.25 0 0117.5 18z",
  rain: "M7 15a4 4 0 01-.5-7.97A6 6 0 0118 6.5 4.25 4.25 0 0117.5 15M8 18v3M12 18v3M16 18v3",
  storm: "M7 15a4 4 0 01-.5-7.97A6 6 0 0118 6.5 4.25 4.25 0 0117.5 15M13 13l-3 5h4l-3 4",
};
const rainText = (d) => (d.rain_mm >= 0.5 ? `${Math.round(d.rain_mm)} mm rain (${d.prob_pct}%)` : "no rain");

export default function WeatherCard() {
  const [weather, setWeather] = useState(null);
  // Re-read as the sync loop brings fresher bundles (and the first one after sign-in).
  useEffect(() => {
    const load = () => metaGet("weather").then(setWeather);
    load();
    const iv = setInterval(load, 15_000);
    return () => clearInterval(iv);
  }, []);
  const t = today(weather);
  if (!t) return null;
  const { day, at, windows, alerts, tomorrow, ageHours } = t;
  const sky = condition(day.code);
  return (
    <div className="card weather">
      <div className="wx-top">
        {sky && <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={ICONS[sky.icon]} /></svg>}
        <div>
          <b>{Math.round(day.tmax)}° / {Math.round(day.tmin)}°C</b>
          <span>{[sky?.word, rainText(day), day.wind_kmh != null && `wind to ${Math.round(day.wind_kmh)} km/h`].filter(Boolean).join(" · ")}</span>
        </div>
      </div>
      {at && <div className="wx-line">Now about {Math.round(at.temp)}°C, wind {Math.round(at.wind_kmh)} km/h</div>}
      {alerts.map((a) => <div className="wx-alert" key={a}>{a}</div>)}
      {weather.spray && (
        <div className="wx-line">
          <b>Spraying:</b> {windows.length ? `good ${windows.map(windowText).join(" and ")}` : "no good time left today"}
        </div>
      )}
      {tomorrow && <div className="wx-line">Tomorrow {Math.round(tomorrow.tmax)}° / {Math.round(tomorrow.tmin)}°C, {rainText(tomorrow)}</div>}
      {ageHours >= 12 && <div className="wx-line stale">Forecast is {ageHours} hours old; it updates when the server has internet.</div>}
    </div>
  );
}
