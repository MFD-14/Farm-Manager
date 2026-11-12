// Reading the forecast snapshot that arrives with the day bundle (Open-Meteo:
// daily figures, the working hours of today and tomorrow, spraying windows).
// It is cached with the bundle, so the weather card works offline.

// WMO weather codes, grouped into the few words a farm day needs.
export function condition(code) {
  if (code == null) return null;
  if (code <= 1) return { word: "Clear", icon: "sun" };
  if (code <= 3) return { word: code === 2 ? "Partly cloudy" : "Cloudy", icon: "cloud" };
  if (code <= 48) return { word: "Fog", icon: "cloud" };
  if (code >= 95) return { word: "Thunderstorms", icon: "storm" };
  return { word: code >= 80 ? "Showers" : code <= 57 ? "Drizzle" : "Rain", icon: "rain" };
}

// Farm-local "YYYY-MM-DD" and hour for an instant.
export function farmNow(d = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Harare", hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit" }).formatToParts(d).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) };
}

const hh = (n) => `${String(n).padStart(2, "0")}:00`;
export const windowText = (w) => `${hh(w.from)}–${hh(w.to)}`;

// Why an hour is wrong for spraying, in plain words (null when it's fine).
// Same limits as the server's spraying windows.
export function sprayProblem(hour, hours) {
  if (!hour) return null;
  if (hour.wind_kmh > 15) return `too windy (${Math.round(hour.wind_kmh)} km/h), the spray will drift`;
  const i = hours.indexOf(hour);
  if (hours.slice(i, i + 4).some((a) => a.rain_mm >= 0.2 || a.prob_pct >= 40)) return "rain is likely before the spray dries";
  if (hour.delta_t > 8) return "too hot and dry, the spray will evaporate";
  if (hour.wind_kmh < 3) return "the air is too still, the spray can hang and drift";
  if (hour.delta_t < 2) return "too humid, the spray will not dry";
  return null;
}

// Today's entry, the forecast hour we are in, and the spraying picture.
export function today(weather, now = new Date()) {
  if (!weather?.daily?.length) return null;
  const { date, hour } = farmNow(now);
  const day = weather.daily.find((d) => d.date === date);
  if (!day) return null; // snapshot too old to describe today
  const hours = weather.hours || [];
  const at = hours.find((h) => h.time === `${date}T${hh(hour)}`) || null;
  const windows = (weather.spray || []).filter((w) => w.date === date && w.to > hour)
    .map((w) => ({ ...w, from: Math.max(w.from, hour) }));
  const alerts = [
    day.tmax >= 35 && `Heat: ${Math.round(day.tmax)}°C. Water early, shade the nursery`,
    day.tmin <= 2 && `Frost risk: ${Math.round(day.tmin)}°C tonight`,
    day.gust_kmh >= 50 && `Strong wind: gusts to ${Math.round(day.gust_kmh)} km/h`,
    day.rain_mm >= 20 && day.prob_pct >= 60 && `Heavy rain likely: ${Math.round(day.rain_mm)} mm`,
  ].filter(Boolean);
  return { day, at, hours, windows, alerts, tomorrow: weather.daily.find((d) => d.date > date) || null,
    ageHours: Math.round((now - new Date(weather.fetched_at)) / 3_600_000) };
}
