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
    const err = new Error("unauthorized");
    err.status = 401;
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
