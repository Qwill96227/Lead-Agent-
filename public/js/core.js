/*
 * Andi core: the lead record, territory check, scoring and local storage.
 * Shared by the homeowner chat (index.html) and the rep dashboard (dashboard.html).
 * Loads as a browser global (window.AndiCore) or a CommonJS module (for tests).
 *
 * The lead record mirrors the fields on the rep's CRM appointment card:
 * Appointment Type, Set Date, Address, Primary Contact, Property Type,
 * Lead Source, Source Breakdown, Details (units), Age of Windows,
 * Windows Material, Year Built, Project Details, Assigned To, Rep(s),
 * Past Appointments.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.AndiCore = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // ---------- Config (edit per deployment; nothing secret lives here) ----------
  const CONFIG = {
    agentName: "Andi",
    brandLine: "Window & patio door replacement",
    region: "Greater Baton Rouge",
    defaultRepName: "Your Rep",
    // Legal name of the one seller the homeowner consents to hear from (FCC one-to-one consent).
    // TODO before launch: replace with the dealer's legal entity name.
    sellerName: "[Dealer legal name]",
    appointmentType: "In-Home Consultation",
    leadSource: "Andi Web Chat",
    monthlyLeadTarget: 36,
    monthlyApptTarget: 16,
    slots: ["10 AM", "1 PM", "4 PM"],
  };

  // ---------- Intake option lists (id, label, scoring weight) ----------
  const PAINS = [
    { id: "seal", label: "Foggy glass / seal failure", w: 6 },
    { id: "draft", label: "Drafts or leaks", w: 5 },
    { id: "rot", label: "Rotting or damaged frames", w: 6 },
    { id: "operate", label: "Hard to open or lock", w: 4 },
    { id: "energy", label: "High energy bills", w: 4 },
    { id: "noise", label: "Outside noise", w: 2 },
    { id: "look", label: "Dated look", w: 2 },
    { id: "storm", label: "Storm protection", w: 4 },
  ];

  const WINDOW_RANGES = [
    { id: "1-3", label: "1–3", value: 2 },
    { id: "4-6", label: "4–6", value: 5 },
    { id: "7-10", label: "7–10", value: 8 },
    { id: "11-15", label: "11–15", value: 13 },
    { id: "16+", label: "16 or more", value: 16 },
  ];

  const DOOR_OPTIONS = [
    { id: "0", label: "No doors", value: 0 },
    { id: "1", label: "1 door", value: 1 },
    { id: "2", label: "2 doors", value: 2 },
    { id: "3", label: "3 or more", value: 3 },
  ];

  const AGES = [
    { id: "lt10", label: "Under 10 years", years: 5, w: 2 },
    { id: "10-20", label: "10–20 years", years: 15, w: 10 },
    { id: "20-30", label: "20–30 years", years: 25, w: 18 },
    { id: "30+", label: "30+ years / original", years: 35, w: 22 },
    { id: "unsure", label: "Not sure", years: null, w: 8 },
  ];

  const MATERIALS = [
    { id: "aluminum", label: "Aluminum", w: 3 },
    { id: "wood", label: "Wood", w: 3 },
    { id: "vinyl", label: "Vinyl", w: 1 },
    { id: "unsure", label: "Not sure", w: 0 },
  ];

  const PROPERTY_TYPES = [
    { id: "house", label: "House" },
    { id: "townhome", label: "Townhome" },
    { id: "condo", label: "Condo" },
    { id: "mobile", label: "Mobile home" },
  ];

  const TIMELINES = [
    { id: "asap", label: "As soon as possible", w: 20 },
    { id: "1-3", label: "1–3 months", w: 15 },
    { id: "3-6", label: "3–6 months", w: 8 },
    { id: "research", label: "Just researching", w: 2 },
  ];

  const STATUSES = [
    { id: "new", label: "New" },
    { id: "contacted", label: "Contacted" },
    { id: "booked", label: "Appt set" },
    { id: "sold", label: "Sold" },
    { id: "no-sale", label: "No sale" },
    { id: "lost", label: "Lost / DQ" },
  ];

  // Finalize outcomes -> resulting status
  const RESULTS = [
    { label: "Sold", status: "sold" },
    { label: "No Sale – Demo", status: "no-sale" },
    { label: "No Sale – One Leg", status: "no-sale" },
    { label: "Rescheduled", status: "booked" },
    { label: "Canceled", status: "lost" },
    { label: "No Show", status: "contacted" },
  ];

  const byId = (list, id) => list.find((o) => o.id === id) || null;

  // ---------- Territory: ~100 mi around Baton Rouge, matched by ZIP prefix ----------
  const MARKETS = [
    { prefix: "707", name: "Baton Rouge" },
    { prefix: "708", name: "Baton Rouge" },
    { prefix: "700", name: "New Orleans metro" },
    { prefix: "701", name: "New Orleans metro" },
    { prefix: "703", name: "Houma / Thibodaux" },
    { prefix: "704", name: "Northshore / Hammond" },
    { prefix: "705", name: "Lafayette" },
    { prefix: "39120", name: "Natchez" },
    { prefix: "39648", name: "McComb" },
    { prefix: "39649", name: "McComb" },
    { prefix: "396", name: "Southwest Mississippi" },
  ];

  function territoryFor(zip) {
    const z = String(zip || "").trim().slice(0, 5);
    if (!/^\d{5}$/.test(z)) return { inArea: false, market: "Unknown ZIP" };
    const hit = MARKETS.filter((m) => z.startsWith(m.prefix)).sort((a, b) => b.prefix.length - a.prefix.length)[0];
    return hit ? { inArea: true, market: hit.name } : { inArea: false, market: "Outside territory" };
  }

  // ---------- Scoring (0-100). Transparent so the rep can see why. ----------
  function windowPoints(n) {
    if (!n) return 0;
    if (n <= 2) return 5;
    if (n <= 5) return 12;
    if (n <= 10) return 20;
    if (n <= 15) return 25;
    return 30;
  }

  function scoreLead(lead) {
    const reasons = [];
    let s = 0;

    const wp = windowPoints(lead.windows);
    s += wp;
    if (lead.windows) reasons.push(`${lead.windowsApprox ? "~" : ""}${lead.windows} windows (+${wp})`);

    const dp = Math.min((lead.doors || 0) * 3, 6);
    if (dp) { s += dp; reasons.push(`${lead.doors} door(s) (+${dp})`); }

    const age = byId(AGES, lead.windowAge);
    if (age) { s += age.w; reasons.push(`Windows ${age.label.toLowerCase()} (+${age.w})`); }

    const mat = byId(MATERIALS, lead.windowMaterial);
    if (mat && mat.w) { s += mat.w; reasons.push(`${mat.label} frames (+${mat.w})`); }

    const painPts = Math.min(
      (lead.pains || []).reduce((t, id) => t + ((byId(PAINS, id) || {}).w || 0), 0),
      15
    );
    if (painPts) { s += painPts; reasons.push(`Pain points (+${painPts})`); }

    const tl = byId(TIMELINES, lead.timeline);
    if (tl) { s += tl.w; reasons.push(`Timeline ${tl.label.toLowerCase()} (+${tl.w})`); }

    if (lead.appointment && lead.appointment.date) { s += 5; reasons.push("Booked a consult (+5)"); }

    const flags = [];
    if (lead.owner === false) { flags.push("Not the homeowner"); s = Math.min(s, 15); }
    if (lead.propertyType === "mobile") { flags.push("Mobile home"); s -= 15; }
    const terr = lead.address && lead.address.zip ? territoryFor(lead.address.zip) : null;
    if (terr && !terr.inArea) { flags.push(terr.market); s -= 20; }

    s = Math.max(0, Math.min(100, Math.round(s)));
    const tier = s >= 70 ? "hot" : s >= 45 ? "warm" : "cold";
    return { value: s, tier, reasons, flags };
  }

  // ---------- Display helpers (match the CRM card wording) ----------
  function unitsLabel(lead) {
    const w = lead.windows || 0;
    const d = lead.doors || 0;
    const a = lead.windowsApprox ? "~" : "";
    return `${a}${w + d} Units (${a}${w} Windows +${d} Doors)`;
  }

  function fullName(c) {
    return [c && c.first, c && c.last].filter(Boolean).join(" ").trim();
  }

  function formatPhone(p) {
    const d = String(p || "").replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
    return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : String(p || "");
  }

  function formatDateTime(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    return d.toLocaleDateString("en-US", { month: "numeric", day: "numeric", year: "numeric" }) +
      " " + d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  }

  function formatDay(isoDate) {
    if (!isoDate) return "";
    const [y, m, d] = isoDate.split("-").map(Number);
    return new Date(y, m - 1, d).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  }

  // Window age in years: the homeowner's exact number if typed, else the bucket's midpoint.
  function ageYears(lead) {
    if (lead.windowAgeYears) return { years: lead.windowAgeYears, exact: true };
    const age = byId(AGES, lead.windowAge);
    return age && age.years ? { years: age.years, exact: false } : null;
  }

  // Rep-shorthand summary, in the style reps write on the CRM card.
  function projectSummary(lead) {
    const parts = [];
    parts.push(`${lead.windowsApprox ? "~" : ""}${lead.windows || "?"} windows`);
    if (lead.doors) parts.push(`+${lead.doors} door${lead.doors > 1 ? "s" : ""}`);
    const age = ageYears(lead);
    if (age) parts.push(`${age.exact ? "" : "~"}${age.years}yr old`);
    const mat = byId(MATERIALS, lead.windowMaterial);
    if (mat && mat.id !== "unsure") parts.push(mat.label.toLowerCase());
    const pains = (lead.pains || []).map((id) => (byId(PAINS, id) || {}).label).filter(Boolean);
    if (pains.length) parts.push(pains.join(", ").toLowerCase());
    const tl = byId(TIMELINES, lead.timeline);
    if (tl) parts.push(`timeline: ${tl.label.toLowerCase()}`);
    if (lead.owner) parts.push("homeowner");
    return parts.join(" · ");
  }

  // Next N appointment days (Mon–Sat) as local YYYY-MM-DD, starting tomorrow.
  function nextBusinessDays(n, from) {
    const out = [];
    const d = new Date(from || Date.now());
    d.setHours(12, 0, 0, 0);
    while (out.length < n) {
      d.setDate(d.getDate() + 1);
      if (d.getDay() !== 0) {
        out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`);
      }
    }
    return out;
  }

  // ---------- Lead factory ----------
  function uid() {
    return "ld_" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  }

  function sourceBreakdown(params) {
    const p = params || {};
    const src = String(p.utm_source || p.source || "");
    const camp = String(p.utm_campaign || "");
    const pretty = { google: "Google Search", meta: "Meta", facebook: "Meta", instagram: "Meta", nextdoor: "Nextdoor", retarget: "Retargeting" };
    const name = pretty[src.toLowerCase()] || src || "Direct / organic";
    return camp ? `${name} · ${camp}` : name;
  }

  function newLead(params) {
    return {
      id: uid(),
      createdAt: new Date().toISOString(),
      status: "new",
      appointmentType: CONFIG.appointmentType,
      appointment: null, // { date: "YYYY-MM-DD", slot: "10 AM" }
      contact: { first: "", last: "", phone: "", email: "" },
      address: { street: "", city: "", state: "LA", zip: "" },
      propertyType: null,
      owner: null,
      leadSource: CONFIG.leadSource,
      sourceBreakdown: sourceBreakdown(params),
      windows: 0,
      windowsApprox: false,
      doors: 0,
      windowAge: null,
      windowAgeYears: null, // exact years when the homeowner typed a number
      windowMaterial: null,
      yearBuilt: "",
      pains: [],
      timeline: null,
      smsConsent: false,
      projectDetails: "",
      score: null,
      territory: null,
      assignedTo: CONFIG.defaultRepName,
      reps: [{ name: CONFIG.defaultRepName, role: "Primary" }],
      pastAppointments: [],
      notes: "",
      transcript: [],
    };
  }

  // Fill derived fields once the intake is done.
  function finalizeLead(lead) {
    lead.territory = territoryFor(lead.address.zip);
    if (!lead.projectDetails) lead.projectDetails = projectSummary(lead);
    lead.score = scoreLead(lead);
    if (lead.status === "new") {
      if (lead.owner === false || !lead.territory.inArea) lead.status = "lost";
      else if (lead.appointment && lead.appointment.date) lead.status = "booked";
    }
    return lead;
  }

  // ---------- Storage (browser localStorage: demo / single-device only) ----------
  const KEY = "andi.leads.v1";
  const SETTINGS_KEY = "andi.settings.v1";

  function safeGet(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      return fallback;
    }
  }
  function safeSet(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); return true; } catch (e) { return false; }
  }

  const store = {
    all() { return safeGet(KEY, []); },
    get(id) { return store.all().find((l) => l.id === id) || null; },
    save(lead) {
      const list = store.all();
      const i = list.findIndex((l) => l.id === lead.id);
      if (i >= 0) list[i] = lead; else list.unshift(lead);
      safeSet(KEY, list);
      return lead;
    },
    remove(id) { safeSet(KEY, store.all().filter((l) => l.id !== id)); },
    replaceAll(list) { safeSet(KEY, list); },
    settings() { return Object.assign({ repName: CONFIG.defaultRepName }, safeGet(SETTINGS_KEY, {})); },
    saveSettings(s) { safeSet(SETTINGS_KEY, s); },
  };

  // ---------- Demo data: fictional people, 555 numbers, example.com. Never real leads. ----------
  function demoLeads(repName) {
    const rep = repName || CONFIG.defaultRepName;
    const days = nextBusinessDays(6);
    const ago = (h) => new Date(Date.now() - h * 3600e3).toISOString();
    const seeds = [
      { first: "Marcy", last: "Delacroix", phone: "2255550142", city: "Baton Rouge", street: "1200 Example Oak Dr", zip: "70810", st: "LA", prop: "house", w: 12, d: 1, age: "20-30", mat: "aluminum", yb: "1998", pains: ["seal", "energy"], tl: "asap", appt: { date: days[0], slot: "10 AM" }, src: { utm_source: "google", utm_campaign: "br-window-replacement" }, h: 3 },
      { first: "Terrence", last: "Guidry", phone: "9855550118", city: "Covington", street: "77 Sample Pine Ln", zip: "70433", st: "LA", prop: "house", w: 6, d: 0, age: "20-30", mat: "wood", yb: "2004", pains: ["seal", "rot"], tl: "1-3", appt: { date: days[1], slot: "1 PM" }, src: { utm_source: "meta", utm_campaign: "northshore-retirees" }, h: 20 },
      { first: "Alicia", last: "Fontenot", phone: "3375550190", city: "Lafayette", street: "410 Demo Cypress St", zip: "70503", st: "LA", prop: "house", w: 9, d: 2, age: "30+", mat: "aluminum", yb: "1979", pains: ["draft", "operate", "noise"], tl: "1-3", appt: null, src: { utm_source: "nextdoor" }, h: 30 },
      { first: "Kevin", last: "Tran", phone: "5045550163", city: "Metairie", street: "3 Placeholder Ct", zip: "70002", st: "LA", prop: "townhome", w: 4, d: 0, age: "10-20", mat: "vinyl", yb: "2009", pains: ["look"], tl: "research", appt: null, src: { utm_source: "google", utm_campaign: "nola-brand" }, h: 52 },
      { first: "Renee", last: "Batiste", phone: "6015550127", city: "Natchez", street: "88 Fictional Rd", zip: "39120", st: "MS", prop: "house", w: 15, d: 1, age: "30+", mat: "wood", yb: "1965", pains: ["rot", "draft", "storm"], tl: "asap", appt: { date: days[2], slot: "10 AM" }, src: { utm_source: "retarget" }, h: 75 },
      { first: "Sam", last: "Example", phone: "4095550101", city: "Beaumont", street: "1 Test Ave", zip: "77701", st: "TX", prop: "house", w: 8, d: 0, age: "20-30", mat: "aluminum", yb: "1990", pains: ["energy"], tl: "3-6", appt: null, src: { utm_source: "meta" }, h: 100 },
    ];
    return seeds.map((s) => {
      const l = newLead(s.src);
      Object.assign(l, {
        createdAt: ago(s.h),
        contact: { first: s.first, last: s.last, phone: s.phone, email: `${s.first.toLowerCase()}@example.com` },
        address: { street: s.street, city: s.city, state: s.st, zip: s.zip },
        propertyType: s.prop, owner: true, windows: s.w, doors: s.d, windowAge: s.age, windowMaterial: s.mat,
        yearBuilt: s.yb, pains: s.pains, timeline: s.tl, appointment: s.appt, smsConsent: true,
        assignedTo: rep, reps: [{ name: rep, role: "Primary" }], demo: true,
        transcript: [{ from: "andi", text: "Demo lead. No conversation recorded." }],
      });
      return finalizeLead(l);
    });
  }

  return {
    CONFIG, PAINS, WINDOW_RANGES, DOOR_OPTIONS, AGES, MATERIALS, PROPERTY_TYPES, TIMELINES, STATUSES, RESULTS,
    byId, territoryFor, scoreLead, unitsLabel, ageYears, fullName, formatPhone, formatDateTime, formatDay, projectSummary,
    nextBusinessDays, newLead, finalizeLead, sourceBreakdown, store, demoLeads,
  };
});
