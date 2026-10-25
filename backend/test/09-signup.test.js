import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { prepareDb, q } from "./helpers.js";
import { createApp } from "../src/app.js";
import { setOwnerAccount } from "../src/jobs/set-owner.js";

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

test("installer step makes the owner's own email the owner account", async () => {
  const before = (await login("owner@woodlands.farm", "woodlands")).json.token;
  const r = await setOwnerAccount({ email: "Boss@Example.com", password: "boss-pass-1" });
  assert.equal(r.action, "renamed starter owner");
  assert.equal((await login("owner@woodlands.farm", "woodlands")).status, 401);
  const me = await login("boss@example.com", "boss-pass-1");
  assert.equal(me.status, 200);
  assert.equal(me.json.user.role, "owner");
  assert.equal((await api("/api/auth/me", { token: before })).status, 401, "old sessions end");
  // Re-running with the same email just updates the password; still one owner.
  assert.equal((await setOwnerAccount({ email: "boss@example.com", password: "boss-pass-2" })).action, "updated");
  assert.equal((await q(`SELECT count(*)::int AS n FROM users WHERE role = 'owner'`)).rows[0].n, 1);
  await assert.rejects(setOwnerAccount({ email: "boss@example.com", password: "short" }), /8 characters/);
});

test("caretaker signs up, waits for approval, then signs in", async () => {
  const owner = (await login("boss@example.com", "boss-pass-2")).json.token;

  const bad = await api("/api/auth/signup", { method: "POST", body: { name: "T", email: "t@example.com", password: "123" } });
  assert.equal(bad.status, 400);
  const su = await api("/api/auth/signup", { method: "POST",
    body: { name: "Tafadzwa", email: "Taf@Example.com", password: "taf-pass-1", phone: "+263772222222" } });
  assert.equal(su.status, 201);
  assert.equal((await api("/api/auth/signup", { method: "POST",
    body: { name: "Again", email: "taf@example.com", password: "taf-pass-1" } })).status, 409);

  const waiting = await login("taf@example.com", "taf-pass-1");
  assert.equal(waiting.status, 403);
  assert.match(waiting.json.error, /waiting for the farm owner/);

  assert.equal((await api("/api/users/pending-count", { token: owner })).json.count, 1);
  const list = (await api("/api/users", { token: owner })).json.users;
  assert.equal(list[0].email, "taf@example.com", "sign-ups waiting are listed first");
  assert.equal(list[0].pending_approval, true);

  const care = (await login("caretaker@woodlands.farm", "woodlands")).json.token;
  assert.equal((await api(`/api/users/${list[0].id}/approve`, { method: "POST", token: care })).status, 403);

  const ok = await api(`/api/users/${list[0].id}/approve`, { method: "POST", token: owner });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.user.role, "caretaker");
  const signedIn = await login("taf@example.com", "taf-pass-1");
  assert.equal(signedIn.status, 200);
  assert.equal(signedIn.json.user.must_change_password, false, "they chose their own password");
  assert.equal((await api("/api/users/pending-count", { token: owner })).json.count, 0);
  assert.equal((await api(`/api/users/${list[0].id}/decline`, { method: "POST", token: owner })).status, 404,
    "an approved account can't be declined (switch it off instead)");
});

test("owner declines a sign-up and it is removed", async () => {
  const owner = (await login("boss@example.com", "boss-pass-2")).json.token;
  await api("/api/auth/signup", { method: "POST", body: { name: "Stranger", email: "s@example.com", password: "stranger-1" } });
  const id = (await api("/api/users", { token: owner })).json.users.find((u) => u.email === "s@example.com").id;
  assert.equal((await api(`/api/users/${id}/decline`, { method: "POST", token: owner })).status, 200);
  assert.equal((await q(`SELECT 1 FROM users WHERE id = $1`, [id])).rows.length, 0);
  assert.equal((await login("s@example.com", "stranger-1")).status, 401);
});
