// Phone numbers in international form (+263771234567), which is what WhatsApp
// identifies people by. Local Zimbabwe numbers (0771234567) get +263.
const DEFAULT_COUNTRY = process.env.FARM_COUNTRY_CODE || "263";

export function normalizePhone(raw) {
  if (raw === null || raw === undefined) return null;
  let s = String(raw).trim();
  if (!s) return null;
  const plus = s.startsWith("+") || s.startsWith("00");
  s = s.replace(/^00/, "").replace(/\D/g, "");
  if (!s) return null;
  if (!plus && s.startsWith("0")) s = DEFAULT_COUNTRY + s.slice(1);
  return `+${s}`;
}

// WhatsApp API "to" field: digits only.
export const waDigits = (phone) => String(phone || "").replace(/\D/g, "");
