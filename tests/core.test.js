import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { sign, sanitize } from "../server/lead.js";

// Load the browser script the way a page does: as a classic script that sets self.AndiCore.
const sandbox = { self: {}, console };
vm.runInNewContext(readFileSync(new URL("../public/js/core.js", import.meta.url), "utf8"), sandbox);
const C = sandbox.self.AndiCore;

function lead(overrides) {
  const l = C.newLead({ utm_source: "google", utm_campaign: "br-test" });
  Object.assign(l, {
    contact: { first: "Test", last: "Person", phone: "2255550100", email: "" },
    address: { street: "1 Example St", city: "Baton Rouge", state: "LA", zip: "70810" },
    propertyType: "house", owner: true, windows: 6, doors: 0, windowAge: "20-30", windowMaterial: "aluminum",
    pains: ["seal"], timeline: "1-3",
  }, overrides);
  return C.finalizeLead(l);
}

test("territory matches the rep's markets by ZIP", () => {
  assert.equal(C.territoryFor("70810").inArea, true);
  assert.equal(C.territoryFor("70810").market, "Baton Rouge");
  assert.equal(C.territoryFor("70435").market, "Northshore / Hammond");
  assert.equal(C.territoryFor("70503").market, "Lafayette");
  assert.equal(C.territoryFor("39120").market, "Natchez");
  assert.equal(C.territoryFor("39648").market, "McComb");
  assert.equal(C.territoryFor("77701").inArea, false);
  assert.equal(C.territoryFor("abc").inArea, false);
});

test("details line matches the CRM card format", () => {
  assert.equal(C.unitsLabel({ windows: 6, doors: 0 }), "6 Units (6 Windows +0 Doors)");
  assert.equal(C.unitsLabel({ windows: 5, doors: 1, windowsApprox: true }), "~6 Units (~5 Windows +1 Doors)");
});

test("a CRM-card-like lead scores warm and books", () => {
  const l = lead({ appointment: { date: "2026-10-13", slot: "10 AM" } });
  assert.equal(l.status, "booked");
  assert.equal(l.score.tier, "warm");
  assert.ok(l.projectDetails.includes("6 windows"));
});

test("big, old, urgent job scores hot", () => {
  const l = lead({ windows: 16, doors: 2, windowAge: "30+", pains: ["seal", "draft", "rot"], timeline: "asap", appointment: { date: "2026-10-13", slot: "1 PM" } });
  assert.equal(l.score.tier, "hot");
  assert.ok(l.score.value >= 70 && l.score.value <= 100);
});

test("renters and out-of-area leads are disqualified", () => {
  const renter = lead({ owner: false, timeline: "asap", windows: 16 });
  assert.ok(renter.score.value <= 15);
  assert.equal(renter.status, "lost");
  const far = lead({ address: { street: "1 Test", city: "Beaumont", state: "TX", zip: "77701" } });
  assert.equal(far.status, "lost");
  assert.ok(far.score.flags.includes("Outside territory"));
});

test("source breakdown reads UTM params", () => {
  assert.equal(C.sourceBreakdown({ utm_source: "google", utm_campaign: "x" }), "Google Search · x");
  assert.equal(C.sourceBreakdown({}), "Direct / organic");
});

test("demo leads are fictional and well-formed", () => {
  const demo = C.demoLeads("Rep");
  assert.equal(demo.length, 6);
  for (const l of demo) {
    assert.ok(l.demo);
    assert.match(l.contact.phone, /^\d{3}555\d{4}$/);
    assert.ok(l.contact.email.endsWith("@example.com"));
    assert.ok(l.score);
  }
});

test("webhook signature is HMAC-SHA256 over timestamp.body", () => {
  // Vector computed independently: printf '%s' '1700000000.{}' | openssl dgst -sha256 -hmac secret
  assert.equal(sign("secret", "1700000000", "{}"), "b8569b78799ff9e3cbff0fc2d63a33a2b57f3282abd07c37ae5e8e7d79a5f163");
  assert.notEqual(sign("secret", "1", "{}"), sign("secret", "2", "{}"));
  assert.notEqual(sign("a", "1", "{}"), sign("b", "1", "{}"));
});

test("sanitize drops unknown fields and caps lengths", () => {
  const s = sanitize(Object.assign(lead({}), { evil: "x", turnstileToken: "t", projectDetails: "y".repeat(1000) }));
  assert.equal(s.evil, undefined);
  assert.equal(s.turnstileToken, undefined);
  assert.equal(s.projectDetails.length, 300);
  assert.equal(s.contact.phone, "2255550100");
});
