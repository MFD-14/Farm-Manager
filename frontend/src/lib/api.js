import { metaGet, metaSet } from "./db.js";

let token = null;

export async function loadToken() {
  token = await metaGet("token");
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

export async function api(path, { method = "GET", body, raw, headers = {} } = {}) {
  const resp = await fetch(path, {
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
