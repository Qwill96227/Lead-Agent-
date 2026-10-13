import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { toLeadRow, saveLead } from "../server/db.js";
import { sanitize, handleLead } from "../server/lead.js";

const MIGRATION = new URL("../supabase/migrations/20261012000000_create_leads.sql", import.meta.url);

const browserLead = () => ({
  id: "ld_test123", status: "booked", appointmentType: "In-Home Consultation",
  appointment: { date: "2026-10-13", slot: "10 AM" },
  contact: { first: "Test", last: "Person", phone: "(225) 555-0100", email: "t@example.com" },
  address: { street: "1 Example St", city: "Covington", state: "LA", zip: "70435" },
  propertyType: "house", owner: true, windows: 6, doors: 1, windowAge: "20-30", windowAgeYears: 20,
  windowMaterial: "aluminum", pains: ["seal"], timeline: "asap", smsConsent: true,
  score: { value: 77, tier: "hot", flags: [] }, territory: { inArea: true, market: "Northshore / Hammond" },
  transcript: [{ from: "user", text: "6" }], consentVersion: "2026-10-11",
});

function withEnv(vars, fn) {
  const old = {};
  for (const k of Object.keys(vars)) { old[k] = process.env[k]; if (vars[k] == null) delete process.env[k]; else process.env[k] = vars[k]; }
  return Promise.resolve(fn()).finally(() => { for (const k of Object.keys(old)) { if (old[k] == null) delete process.env[k]; else process.env[k] = old[k]; } });
}

// ---------- Migration, run in real Postgres (PGlite) ----------

async function freshDb() {
  const db = new PGlite();
  await db.exec("create role anon; create role authenticated; create role service_role;"); // Supabase's roles
  await db.exec(readFileSync(MIGRATION, "utf8"));
  return db;
}
const insert = (db, row, consent = { sms_consent: true, consent_version: "v1", ip: "1.2.3.4" }) =>
  db.query("select public.insert_website_lead($1::jsonb, $2::jsonb) as id", [JSON.stringify(row), JSON.stringify(consent)]).then((r) => r.rows[0].id);

test("migration stores a website lead and its consent record", async () => {
  const db = await freshDb();
  const id = await insert(db, toLeadRow(sanitize(browserLead())));
  const lead = (await db.query("select * from leads where id = $1", [id])).rows[0];
  assert.equal(lead.phone, "2255550100");
  assert.equal(lead.source, "website");
  assert.equal(lead.appointment_slot, "10 AM");
  assert.deepEqual(lead.pains, ["seal"]);
  const consent = (await db.query("select * from lead_consents where lead_id = $1", [id])).rows[0];
  assert.equal(consent.sms_consent, true);
  assert.equal(consent.ip, "1.2.3.4");
});

test("resubmitting a client_ref can't overwrite an existing lead", async () => {
  const db = await freshDb();
  const row = toLeadRow(sanitize(browserLead()));
  const id1 = await insert(db, row);
  const id2 = await insert(db, { ...row, first_name: "Attacker", phone: "9999999999" });
  assert.equal(id2, id1);
  const after = (await db.query("select first_name, phone from leads where id = $1", [id1])).rows[0];
  assert.deepEqual({ ...after }, { first_name: "Test", phone: "2255550100" });
  const n = (await db.query("select count(*)::int as n from lead_consents")).rows[0].n;
  assert.equal(n, 1);
});

test("constraints reject out-of-range values", async () => {
  const db = await freshDb();
  await assert.rejects(insert(db, { ...toLeadRow(sanitize(browserLead())), client_ref: "x", score: 500 }), /leads_score_check/);
});

test("public roles are locked out; only service_role can insert", async () => {
  const db = await freshDb();
  const rls = (await db.query("select bool_and(relrowsecurity) as on from pg_class where relname in ('leads','lead_consents')")).rows[0].on;
  assert.equal(rls, true);
  const p = (await db.query(`select
    has_table_privilege('anon','public.leads','select') as anon_select,
    has_table_privilege('authenticated','public.lead_consents','select') as auth_select,
    has_function_privilege('anon','public.insert_website_lead(jsonb,jsonb)','execute') as anon_rpc,
    has_function_privilege('service_role','public.insert_website_lead(jsonb,jsonb)','execute') as service_rpc`)).rows[0];
  assert.deepEqual({ ...p }, { anon_select: false, auth_select: false, anon_rpc: false, service_rpc: true });
});

// ---------- server/db.js ----------

test("toLeadRow maps the CRM fields onto columns", () => {
  const r = toLeadRow(sanitize(browserLead()));
  assert.equal(r.client_ref, "ld_test123");
  assert.equal(r.market, "Northshore / Hammond");
  assert.equal(r.appointment_date, "2026-10-13");
  assert.equal(r.score_tier, "hot");
  assert.equal(r.sms_consent, true);
  assert.equal(r.window_age_years, 20);
});

test("saveLead is skipped when Supabase isn't configured", async () => {
  await withEnv({ SUPABASE_URL: null, SUPABASE_SECRET_KEY: null }, async () => {
    let called = false;
    const out = await saveLead(sanitize(browserLead()), {}, () => { called = true; });
    assert.deepEqual(out, { stored: false });
    assert.equal(called, false);
  });
});

test("saveLead calls the RPC with the right auth headers", async () => {
  for (const [key, bearer] of [["sb_secret_abc", false], ["eyJhbGciOi.legacy.jwt", true]]) {
    await withEnv({ SUPABASE_URL: "https://proj.supabase.co/", SUPABASE_SECRET_KEY: key }, async () => {
      let seen;
      const fakeFetch = async (url, init) => { seen = { url, init }; return new Response(JSON.stringify("11111111-2222-3333-4444-555555555555"), { status: 200 }); };
      const out = await saveLead(sanitize(browserLead()), { ip: "1.2.3.4", userAgent: "UA", consentVersion: "v1" }, fakeFetch);
      assert.equal(seen.url, "https://proj.supabase.co/rest/v1/rpc/insert_website_lead");
      assert.equal(seen.init.headers.apikey, key);
      assert.equal("Authorization" in seen.init.headers, bearer);
      const body = JSON.parse(seen.init.body);
      assert.equal(body.p_consent.ip, "1.2.3.4");
      assert.equal(body.p_lead.phone, "2255550100");
      assert.deepEqual(out, { stored: true, id: "11111111-2222-3333-4444-555555555555" });
    });
  }
});

test("saveLead reports failures without throwing", async () => {
  await withEnv({ SUPABASE_URL: "https://proj.supabase.co", SUPABASE_SECRET_KEY: "sb_secret_abc" }, async () => {
    const err = console.error; console.error = () => {};
    try {
      assert.deepEqual(await saveLead(sanitize(browserLead()), {}, async () => new Response("nope", { status: 401 })), { stored: false, error: "status 401" });
      assert.deepEqual(await saveLead(sanitize(browserLead()), {}, async () => { throw new Error("down"); }), { stored: false, error: "unreachable" });
    } finally { console.error = err; }
  });
});

// ---------- /api/lead response ----------

test("/api/lead returns 200 when nothing is configured, 502 when the only sink fails", async () => {
  const req = () => new Request("http://x/api/lead", { method: "POST", body: JSON.stringify(browserLead()) });
  await withEnv({ SUPABASE_URL: null, SUPABASE_SECRET_KEY: null, N8N_WEBHOOK_URL: null, N8N_WEBHOOK_SECRET: null, TURNSTILE_SECRET_KEY: null }, async () => {
    const res = await handleLead(req());
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true, stored: false, forwarded: false });
  });
  // Supabase configured but unreachable (port 9 = discard), n8n not configured -> 502.
  await withEnv({ SUPABASE_URL: "http://127.0.0.1:9", SUPABASE_SECRET_KEY: "sb_secret_x", N8N_WEBHOOK_URL: null, TURNSTILE_SECRET_KEY: null }, async () => {
    const err = console.error; console.error = () => {};
    try {
      const res = await handleLead(req());
      assert.equal(res.status, 502);
      assert.deepEqual(await res.json(), { ok: false, stored: false, forwarded: false });
    } finally { console.error = err; }
  });
});
