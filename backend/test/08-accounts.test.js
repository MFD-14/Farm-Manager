import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { prepareDb, q } from "./helpers.js";
import { createApp } from "../src/app.js";
import { seed } from "../src/db/seed.js";

let server, base;

async function api(path, { method = "GET", token, body } = {}) {
  const resp = await fetch(base + path, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await resp.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* raw */ }
  return { status: resp.status, json };
}
const login = (email, password) => api("/api/auth/login", { method: "POST", body: { email, password } });

before(async () => {
  await prepareDb();
  server = createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server?.close());

test("owner moves their account to their own email, and a restart keeps it", async () => {
  const owner = (await login("owner@woodlands.farm", "woodlands")).json.token;

  const wrong = await api("/api/auth/me", { method: "PATCH", token: owner,
    body: { email: "farmer@example.com", current_password: "nope" } });
  assert.equal(wrong.status, 403, "email change needs the current password");

  const r = await api("/api/auth/me", { method: "PATCH", token: owner,
    body: { email: " Farmer@Example.com ", name: "Rab", current_password: "woodlands" } });
  assert.equal(r.status, 200);
  assert.equal(r.json.user.email, "farmer@example.com");

  assert.equal((await login("FARMER@example.com", "woodlands")).status, 200, "email is case-insensitive");
  assert.equal((await login("owner@woodlands.farm", "woodlands")).status, 401);

  // Seed runs on every server start; it must not bring the starter owner back.
  await seed();
  const owners = (await q(`SELECT email FROM users WHERE role = 'owner'`)).rows;
  assert.deepEqual(owners.map((o) => o.email), ["farmer@example.com"]);

  // Own password change signs out other sessions but returns a working token.
  const other = (await login("farmer@example.com", "woodlands")).json.token;
  const short = await api("/api/auth/password", { method: "POST", token: owner,
    body: { current_password: "woodlands", new_password: "short" } });
  assert.equal(short.status, 400);
  const pw = await api("/api/auth/password", { method: "POST", token: owner,
    body: { current_password: "woodlands", new_password: "new-strong-pass" } });
  assert.equal(pw.status, 200);
  assert.equal((await api("/api/auth/me", { token: other })).status, 401, "other sessions end");
  assert.equal((await api("/api/auth/me", { token: pw.json.token })).status, 200, "this session continues");
  assert.equal((await login("farmer@example.com", "new-strong-pass")).status, 200);
});

test("owner adds people, resets passwords and switches accounts off", async () => {
  const owner = (await login("farmer@example.com", "new-strong-pass")).json.token;

  const care = (await login("caretaker@woodlands.farm", "woodlands")).json.token;
  assert.equal((await api("/api/users", { token: care })).status, 403, "caretakers can't manage people");

  const add = await api("/api/users", { method: "POST", token: owner,
    body: { name: "Tendai", email: "tendai@example.com", role: "caretaker", phone: "+263771234567" } });
  assert.equal(add.status, 201);
  assert.equal(add.json.temp_password.length, 10);
  assert.equal((await api("/api/users", { method: "POST", token: owner,
    body: { name: "Dup", email: "TENDAI@example.com", role: "caretaker" } })).status, 409);
  assert.equal((await api("/api/users", { method: "POST", token: owner,
    body: { name: "X", email: "not-an-email", role: "caretaker" } })).status, 400);

  // First sign-in with the one-time password asks for a new one.
  const first = await login("tendai@example.com", add.json.temp_password);
  assert.equal(first.status, 200);
  assert.equal(first.json.user.must_change_password, true);
  const changed = await api("/api/auth/password", { method: "POST", token: first.json.token,
    body: { current_password: add.json.temp_password, new_password: "tendai-own-pass" } });
  assert.equal(changed.json.user.must_change_password, false);
  const tendai = changed.json.token;

  // Reset by the owner ends Tendai's sessions and issues a new one-time password.
  const reset = await api(`/api/users/${add.json.user.id}/reset-password`, { method: "POST", token: owner });
  assert.equal(reset.status, 200);
  assert.equal((await api("/api/auth/me", { token: tendai })).status, 401);
  assert.equal((await login("tendai@example.com", "tendai-own-pass")).status, 401);
  const again = await login("tendai@example.com", reset.json.temp_password);
  assert.equal(again.json.user.must_change_password, true);

  // Switching off: sign-in refused, live sessions end, history stays.
  const off = await api(`/api/users/${add.json.user.id}`, { method: "PATCH", token: owner, body: { active: false } });
  assert.equal(off.status, 200);
  assert.equal((await login("tendai@example.com", reset.json.temp_password)).status, 403);
  assert.equal((await api("/api/auth/me", { token: again.json.token })).status, 401);

  const list = await api("/api/users", { token: owner });
  const row = list.json.users.find((u) => u.email === "tendai@example.com");
  assert.equal(row.active, false);
  assert.equal(list.json.users.find((u) => u.is_me).email, "farmer@example.com");

  // Switching back on lets them sign in again.
  await api(`/api/users/${add.json.user.id}`, { method: "PATCH", token: owner, body: { active: true } });
  assert.equal((await login("tendai@example.com", reset.json.temp_password)).status, 200);
});

test("the farm always keeps an active owner", async () => {
  const owner = (await login("farmer@example.com", "new-strong-pass")).json.token;
  const me = (await api("/api/auth/me", { token: owner })).json.user;

  assert.equal((await api(`/api/users/${me.id}`, { method: "PATCH", token: owner,
    body: { active: false } })).status, 400, "can't switch yourself off");
  assert.equal((await api(`/api/users/${me.id}`, { method: "PATCH", token: owner,
    body: { role: "caretaker" } })).status, 400, "can't demote yourself");

  // A second owner can be added and then switched off; the first remains.
  const second = await api("/api/users", { method: "POST", token: owner,
    body: { name: "Partner", email: "partner@example.com", role: "owner", password: "partner-pass" } });
  assert.equal(second.json.temp_password, null, "a typed password is not temporary");
  assert.equal(second.json.user.must_change_password, false);
  const p = (await login("partner@example.com", "partner-pass")).json.token;
  assert.equal((await api(`/api/users/${me.id}`, { method: "PATCH", token: p,
    body: { active: false } })).status, 200, "another owner can switch the first off");
  assert.equal((await api(`/api/users/${second.json.user.id}`, { method: "PATCH", token: p,
    body: { role: "caretaker" } })).status, 400);
  assert.equal((await api("/api/users/not-a-uuid", { method: "PATCH", token: p, body: {} })).status, 404);
});
