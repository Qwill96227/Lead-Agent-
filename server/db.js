// Supabase storage for leads. Server-only: uses the project's secret key,
// which must live in env vars and never reach the browser.
//
// Env: SUPABASE_URL (e.g. https://abcd1234.supabase.co)
//      SUPABASE_SECRET_KEY (an sb_secret_... key, or the legacy service_role JWT)
// Without both, saving is skipped and the caller is told { stored: false }.
//
// Talks to PostgREST with fetch rather than adding supabase-js: one call, no new dependency.

const TIMEOUT_MS = 8000;

export function dbConfigured() {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SECRET_KEY);
}

// Map the sanitized lead (camelCase, from server/lead.js) onto table columns.
export function toLeadRow(l) {
  const c = l.contact || {};
  const a = l.address || {};
  const appt = l.appointment || null;
  return {
    client_ref: l.id || null,
    status: l.status || "new",
    first_name: c.first || null,
    last_name: c.last || null,
    phone: c.phone || null,
    email: c.email || null,
    street: a.street || null,
    city: a.city || null,
    state: a.state || null,
    zip: a.zip || null,
    market: l.territory ? l.territory.market : null,
    in_area: l.territory ? l.territory.inArea : null,
    property_type: l.propertyType || null,
    owner: typeof l.owner === "boolean" ? l.owner : null,
    windows: Number.isFinite(l.windows) ? l.windows : null,
    windows_approx: !!l.windowsApprox,
    doors: Number.isFinite(l.doors) ? l.doors : null,
    window_age: l.windowAge || null,
    window_age_years: l.windowAgeYears || null,
    window_material: l.windowMaterial || null,
    year_built: l.yearBuilt || null,
    pains: Array.isArray(l.pains) ? l.pains : [],
    timeline: l.timeline || null,
    project_details: l.projectDetails || null,
    score: l.score ? l.score.value : null,
    score_tier: l.score ? l.score.tier : null,
    score_flags: l.score && Array.isArray(l.score.flags) ? l.score.flags : [],
    appointment_type: l.appointmentType || null,
    appointment_date: appt && /^\d{4}-\d{2}-\d{2}$/.test(appt.date) ? appt.date : null,
    appointment_slot: appt ? appt.slot || null : null,
    assigned_to: l.assignedTo || null,
    lead_source: l.leadSource || null,
    source_breakdown: l.sourceBreakdown || null,
    sms_consent: l.smsConsent === true,
    transcript: Array.isArray(l.transcript) ? l.transcript : [],
  };
}

function authHeaders(key) {
  // New-style sb_secret_ keys go in `apikey` only; legacy JWT keys also need a Bearer header.
  const h = { apikey: key };
  if (key.startsWith("eyJ")) h.Authorization = `Bearer ${key}`;
  return h;
}

// Save a sanitized lead plus its consent record. Returns { stored, id?, error? }; never throws.
export async function saveLead(lead, meta = {}, fetchImpl = fetch) {
  if (!dbConfigured()) return { stored: false };
  const base = process.env.SUPABASE_URL.replace(/\/+$/, "");
  const key = process.env.SUPABASE_SECRET_KEY;

  const body = JSON.stringify({
    p_lead: toLeadRow(lead),
    p_consent: {
      sms_consent: lead.smsConsent === true,
      consent_version: meta.consentVersion || null,
      ip: meta.ip || null,
      user_agent: meta.userAgent ? String(meta.userAgent).slice(0, 300) : null,
    },
  });

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetchImpl(`${base}/rest/v1/rpc/insert_website_lead`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders(key) },
      body,
      signal: ctrl.signal,
    });
    if (!res.ok) {
      // Log status only; the body can echo lead data.
      console.error("Supabase insert failed with status", res.status);
      return { stored: false, error: `status ${res.status}` };
    }
    const id = await res.json(); // the function returns the lead's uuid
    return { stored: true, id: typeof id === "string" ? id : null };
  } catch (err) {
    console.error("Supabase insert failed:", err.name === "AbortError" ? "timeout" : err.message);
    return { stored: false, error: "unreachable" };
  } finally {
    clearTimeout(timer);
  }
}
