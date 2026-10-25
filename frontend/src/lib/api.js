import { metaGet, metaSet } from "./db.js";

let token = null;
// Server origin. Empty means "same origin" (the PWA served by the backend).
// The native shells load the app from the device, so they need an absolute
// address, entered once on the sign-in screen and remembered.
let serverUrl = "";

export const isNativeShell = () =>
  typeof window !== "undefined" && !!window.Capacitor?.isNativePlatform?.();

export async function loadToken() {
  token = await metaGet("token");
  serverUrl = (await metaGet("server_url")) || "";
  return token;
}
export async function setToken(t) {
  token = t;
  await metaSet("token", t);
}
export async function clearToken() {
  token = null;
  await metaSet("token", null);
}

export function getServerUrl() {
  return serverUrl;
}
export async function setServerUrl(url) {
  serverUrl = (url || "").trim().replace(/\/+$/, "");
  if (serverUrl && !/^https?:\/\//i.test(serverUrl)) serverUrl = `https://${serverUrl}`;
  await metaSet("server_url", serverUrl);
  return serverUrl;
}

export function apiUrl(path) {
  return `${serverUrl}${path}`;
}

// Fired when the server ends this session (password changed or reset, account
// switched off). Capture keeps queueing; App asks the person to sign in again.
const unauthorizedListeners = new Set();
export function onUnauthorized(fn) {
  unauthorizedListeners.add(fn);
  return () => unauthorizedListeners.delete(fn);
}

// Server errors arrive as {"error": "..."}; show the sentence, not the JSON.
export function errorMessage(err, fallback = "Something went wrong. Try again.") {
  if (!err) return fallback;
  if (err.status === 0 || err.name === "TypeError") return "Cannot reach the server. Check your connection.";
  try {
    const parsed = JSON.parse(err.message);
    if (parsed?.error) return parsed.error;
  } catch { /* not JSON */ }
  return err.message && err.message !== "unauthorized" ? err.message : fallback;
}

export async function api(path, { method = "GET", body, raw, headers = {} } = {}) {
  const resp = await fetch(apiUrl(path), {
    method,
    headers: {
      ...(raw ? {} : { "Content-Type": "application/json" }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: raw ? body : body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (resp.status === 401) {
    // Token expiry never blocks capture (spec 6.3): the caller keeps queueing;
    // App shows login when online.
    const text = await resp.text().catch(() => "");
    const err = new Error(text || "unauthorized");
    err.status = 401;
    if (token && !path.startsWith("/api/auth/login")) unauthorizedListeners.forEach((fn) => fn());
    throw err;
  }
  if (!resp.ok && resp.status !== 308) {
    const text = await resp.text();
    const err = new Error(text || resp.statusText);
    err.status = resp.status;
    throw err;
  }
  return resp;
}

export async function apiJson(path, opts) {
  const resp = await api(path, opts);
  return resp.json();
}

// Evidence photos need the bearer token, which an <img src> cannot send, so
// fetch them as blobs and hand back an object URL.
export async function mediaObjectUrl(mediaUuid) {
  const resp = await api(`/api/media/${mediaUuid}`);
  return URL.createObjectURL(await resp.blob());
}
