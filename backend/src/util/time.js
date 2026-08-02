// Farm time helpers. Africa/Harare is UTC+2 with no DST, so a fixed offset is
// exact and keeps every computation deterministic and testable.
export const FARM_OFFSET_MIN = 120;

const MS_MIN = 60_000;

// Date in farm-local terms for a given instant.
export function farmDateParts(d = new Date()) {
  const local = new Date(d.getTime() + FARM_OFFSET_MIN * MS_MIN);
  return {
    y: local.getUTCFullYear(),
    m: local.getUTCMonth() + 1,
    d: local.getUTCDate(),
    hh: local.getUTCHours(),
    mm: local.getUTCMinutes(),
    dow: local.getUTCDay(), // 0=Sunday
  };
}

export function farmDateStr(d = new Date()) {
  const p = farmDateParts(d);
  return `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
}

// Instant corresponding to HH:MM farm time on farm date dateStr (YYYY-MM-DD).
export function farmTime(dateStr, hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  const [y, mo, day] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, mo - 1, day, h, m) - FARM_OFFSET_MIN * MS_MIN);
}

export function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}

export function daysBetween(a, b) {
  return Math.round((new Date(b + "T00:00:00Z") - new Date(a + "T00:00:00Z")) / 86_400_000);
}

export const DOW = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

export function farmMonth(d = new Date()) {
  return farmDateParts(d).m;
}
