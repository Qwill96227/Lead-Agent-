// POST /api/lead — accepts a finished Andi lead and forwards it to n8n
// (Workflow 1: lead intake + 60-second SMS outreach), signed with HMAC-SHA256.
//
// n8n should verify:  hex(HMAC_SHA256(secret, `${X-Andi-Timestamp}.${rawBody}`)) === X-Andi-Signature
// and reject timestamps older than ~5 minutes.
//
// Env: N8N_WEBHOOK_URL, N8N_WEBHOOK_SECRET (both optional: without them the lead is
//      accepted but not forwarded), TURNSTILE_SECRET_KEY (optional), ALLOWED_ORIGIN (optional)

import { createHmac } from "node:crypto";

const json = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

export function sign(secret, timestamp, rawBody) {
  return createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
}

// Keep only the fields n8n needs, with length caps. Unknown keys are dropped.
export function sanitize(l) {
  const s = (v, n = 200) => String(v ?? "").slice(0, n);
  const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  const c = l.contact || {};
  const a = l.address || {};
  return {
    id: s(l.id, 40),
    createdAt: s(l.createdAt, 40),
    status: s(l.status, 20),
    appointmentType: s(l.appointmentType, 60),
    appointment: l.appointment ? { date: s(l.appointment.date, 10), slot: s(l.appointment.slot, 10) } : null,
    contact: { first: s(c.first, 60), last: s(c.last, 60), phone: s(c.phone, 20).replace(/\D/g, ""), email: s(c.email, 120) },
    address: { street: s(a.street, 120), city: s(a.city, 60), state: s(a.state, 2), zip: s(a.zip, 5) },
    propertyType: s(l.propertyType, 20),
    owner: l.owner === true,
    leadSource: s(l.leadSource, 60),
    sourceBreakdown: s(l.sourceBreakdown, 120),
    windows: n(l.windows),
    windowsApprox: !!l.windowsApprox,
    doors: n(l.doors),
    windowAge: s(l.windowAge, 20),
    windowAgeYears: l.windowAgeYears ? n(l.windowAgeYears) : null,
    windowMaterial: s(l.windowMaterial, 20),
    yearBuilt: s(l.yearBuilt, 4),
    pains: Array.isArray(l.pains) ? l.pains.slice(0, 10).map((p) => s(p, 20)) : [],
    timeline: s(l.timeline, 20),
    smsConsent: l.smsConsent === true,
    projectDetails: s(l.projectDetails, 300),
    score: l.score ? { value: n(l.score.value), tier: s(l.score.tier, 10), flags: (l.score.flags || []).slice(0, 5).map((f) => s(f, 60)) } : null,
    territory: l.territory ? { inArea: !!l.territory.inArea, market: s(l.territory.market, 60) } : null,
    assignedTo: s(l.assignedTo, 60),
    transcript: Array.isArray(l.transcript) ? l.transcript.slice(-40).map((m) => ({ from: s(m.from, 10), text: s(m.text, 600) })) : [],
  };
}

async function turnstileOk(token, ip) {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) return true; // not enabled
  if (!token) return false;
  const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    body: new URLSearchParams({ secret, response: token, ...(ip ? { remoteip: ip } : {}) }),
  });
  const out = await res.json().catch(() => ({}));
  return out.success === true;
}

export default async (req, context) => {
  const allowed = process.env.ALLOWED_ORIGIN;
  const origin = req.headers.get("origin");
  if (allowed && origin && origin !== allowed) return json(403, { error: "forbidden" });
  if (req.method !== "POST") return json(405, { error: "method not allowed" });

  let lead;
  try {
    const raw = await req.text();
    if (raw.length > 60000) return json(413, { error: "too large" });
    lead = JSON.parse(raw);
  } catch {
    return json(400, { error: "bad json" });
  }

  const phone = String(lead?.contact?.phone || "").replace(/\D/g, "");
  if (!lead?.contact?.first || phone.length !== 10) {
    return json(422, { error: "missing contact" });
  }

  if (!(await turnstileOk(lead.turnstileToken, context?.ip))) return json(403, { error: "verification failed" });

  const url = process.env.N8N_WEBHOOK_URL;
  const secret = process.env.N8N_WEBHOOK_SECRET;
  if (!url || !secret) return json(200, { ok: true, forwarded: false });

  const body = JSON.stringify(sanitize(lead));
  const ts = Math.floor(Date.now() / 1000).toString();
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Andi-Timestamp": ts, "X-Andi-Signature": sign(secret, ts, body) },
      body,
    });
    if (!res.ok) {
      console.error("n8n webhook returned", res.status);
      return json(502, { ok: false, forwarded: false });
    }
    return json(200, { ok: true, forwarded: true });
  } catch (err) {
    console.error("n8n webhook failed", err);
    return json(502, { ok: false, forwarded: false });
  }
};

export const config = { path: "/api/lead" };
