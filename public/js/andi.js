/*
 * Andi conversation engine (homeowner side).
 *
 * A small state machine. Each state asks one question, offers quick replies,
 * and writes its answer into a lead record shaped like the rep's CRM card.
 * Free text is parsed where possible; anything else (questions, objections)
 * goes to Claude through the /api/andi proxy, then Andi re-asks the current step.
 * With no proxy (e.g. opened as a local file) Andi still works using canned replies.
 */
(function () {
  "use strict";
  const C = window.AndiCore;
  const cfg = C.CONFIG;
  const $ = (sel) => document.querySelector(sel);

  const params = Object.fromEntries(new URLSearchParams(location.search));
  const lead = C.newLead(params);
  const settings = C.store.settings();
  lead.assignedTo = settings.repName;
  lead.reps = [{ name: settings.repName, role: "Primary" }];

  const log = $("#log");
  const quick = $("#quick");
  const input = $("#text");
  const form = $("#composer");
  const bar = $("#progress");
  const stepEls = document.querySelectorAll("[data-step]");

  let state = null;
  let busy = false;
  let aiTurns = 0;
  const MAX_AI_TURNS = 6; // keep costs and drift bounded per visitor

  // Two step orders. "Chat with Andi" qualifies first, then books.
  // "Set up a consultation" (fast track) books first, then asks optional
  // prep questions the homeowner can skip at any point.
  const ORDER = ["pains", "windows", "doors", "age", "material", "home", "owner", "timeline", "contact", "book"];
  const FAST_ORDER = ["contact", "book", "pains", "windows", "doors", "age", "material", "home", "owner"];
  const PREP = new Set(["pains", "windows", "doors", "age", "material", "home", "owner"]);
  let fastTrack = false;
  const SKIP = { id: "__skip", label: "Skip the rest" };

  // ---------- Rendering ----------
  function scrollDown() { log.scrollTop = log.scrollHeight; }

  function addMsg(from, text) {
    const el = document.createElement("div");
    el.className = "msg " + from;
    el.textContent = text;
    log.appendChild(el);
    if (from !== "note") lead.transcript.push({ from, text, at: new Date().toISOString() });
    scrollDown();
    return el;
  }

  function typing(ms) {
    const el = document.createElement("div");
    el.className = "msg andi";
    el.innerHTML = '<span class="typing" aria-label="Andi is typing"><i></i><i></i><i></i></span>';
    log.appendChild(el);
    scrollDown();
    return new Promise((r) => setTimeout(() => { el.remove(); r(); }, ms));
  }

  async function say(text) {
    await typing(Math.min(350 + text.length * 8, 1100));
    addMsg("andi", text);
  }

  function setQuick(options, { multi = false, onDone } = {}) {
    quick.innerHTML = "";
    const picked = new Set();
    options.forEach((o) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "chip" + (o.primary ? " primary" : "");
      b.textContent = o.label;
      if (multi) {
        b.setAttribute("aria-pressed", "false");
        b.onclick = () => {
          picked.has(o.id) ? picked.delete(o.id) : picked.add(o.id);
          b.setAttribute("aria-pressed", String(picked.has(o.id)));
          done.disabled = picked.size === 0;
        };
      } else {
        b.onclick = () => { if (!busy) answer(o.label, o); };
      }
      quick.appendChild(b);
    });
    let done;
    if (multi) {
      done = document.createElement("button");
      done.type = "button";
      done.className = "chip primary";
      done.textContent = "Continue →";
      done.disabled = true;
      done.onclick = () => {
        if (busy) return;
        const chosen = options.filter((o) => picked.has(o.id));
        onDone(chosen);
      };
      quick.appendChild(done);
    }
    // On the fast track the prep questions are optional.
    if (fastTrack && PREP.has(state)) {
      const s = document.createElement("button");
      s.type = "button";
      s.className = "chip";
      s.textContent = SKIP.label;
      s.onclick = () => { if (!busy) answer(SKIP.label, SKIP); };
      quick.appendChild(s);
    }
  }

  function clearQuick() { quick.innerHTML = ""; }

  const STEP_OF = { greet: 0, pains: 1, windows: 1, doors: 1, age: 1, material: 1, home: 2, owner: 2, timeline: 3, contact: 4, book: 4, done: 5, dq: 5 };
  const FAST_STEP_OF = { contact: 1, book: 2, pains: 3, windows: 3, doors: 3, age: 3, material: 3, home: 4, owner: 4, done: 5, dq: 5 };
  const STEP_LABELS = ["Windows", "Home", "Timing", "Contact"];
  const FAST_STEP_LABELS = ["Contact", "Time", "Windows", "Home"];
  function setProgress() {
    const s = (fastTrack ? FAST_STEP_OF : STEP_OF)[state] || 0;
    const labels = fastTrack ? FAST_STEP_LABELS : STEP_LABELS;
    stepEls.forEach((el) => { el.textContent = labels[Number(el.dataset.step) - 1]; });
    bar.style.width = Math.min(100, (s / 5) * 100) + "%";
    stepEls.forEach((el) => el.classList.toggle("on", Number(el.dataset.step) === s));
  }

  // ---------- Matching free text to options ----------
  function matchOption(text, options) {
    const t = text.toLowerCase().trim();
    return options.find((o) => o.label.toLowerCase() === t) ||
      options.find((o) => (o.keys || []).some((k) => t.includes(k))) ||
      null;
  }
  const firstInt = (t) => { const m = String(t).match(/\d+/); return m ? parseInt(m[0], 10) : null; };

  // Keywords so typed answers map to buttons.
  const KEYS = {
    lt10: ["new", "under 10", "less than 10", "few years"], "10-20": ["10", "15", "teen"], "20-30": ["20", "25"], "30+": ["30", "40", "50", "original", "old"], unsure: ["not sure", "unsure", "don't know", "dont know", "no idea"],
    aluminum: ["alum", "metal"], wood: ["wood"], vinyl: ["vinyl", "plastic"],
    house: ["house", "single", "home"], townhome: ["town"], condo: ["condo", "apartment"], mobile: ["mobile", "manufactured", "trailer"],
    asap: ["asap", "soon", "now", "right away", "immediately", "this month"], "1-3": ["1-3", "month", "couple"], "3-6": ["3-6", "six", "summer", "spring", "fall"], research: ["research", "looking", "browsing", "idea", "not sure"],
  };
  const withKeys = (list) => list.map((o) => Object.assign({}, o, { keys: KEYS[o.id] || [] }));

  // ---------- AI proxy (server holds the key) ----------
  async function callAndi(task, payload) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 15000);
      const res = await fetch("/api/andi", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(Object.assign({ task }, payload)),
        signal: ctrl.signal,
      });
      clearTimeout(t);
      if (!res.ok) return null;
      return await res.json();
    } catch (e) {
      return null;
    }
  }

  function leadContext() {
    return {
      step: state,
      windows: lead.windows, doors: lead.doors, windowAge: lead.windowAge, windowMaterial: lead.windowMaterial,
      pains: lead.pains, propertyType: lead.propertyType, owner: lead.owner, timeline: lead.timeline,
      firstName: lead.contact.first, city: lead.address.city,
    };
  }

  const CANNED = [
    { keys: ["price", "cost", "how much", "expensive", "quote"], text: "Every home is different, so pricing comes from a free in-home measurement. Your consultant will give you an exact quote with no obligation." },
    { keys: ["financ", "payment", "monthly"], text: "Financing options are available. Your consultant can walk through current offers at the appointment." },
    { keys: ["how long", "install", "timeline", "take"], text: "Most installs take about a day, depending on the number of windows. Your consultant can give you a schedule for your home." },
    { keys: ["warrant", "guarantee"], text: "Warranty coverage is part of every quote, and your consultant will go over the details in writing." },
    { keys: ["who are you", "human", "real person", "robot", "bot", "ai"], text: `I'm ${cfg.agentName}, a virtual assistant. I gather a few details so a local consultant can help you. A real person follows up.` },
  ];

  async function handleOffScript(text) {
    let reply = null;
    if (aiTurns < MAX_AI_TURNS) {
      aiTurns++;
      await typing(500);
      const res = await callAndi("chat", { message: text, context: leadContext(), history: lead.transcript.slice(-8) });
      if (res && res.reply) reply = res.reply;
    }
    if (!reply) {
      const t = text.toLowerCase();
      const hit = CANNED.find((c) => c.keys.some((k) => t.includes(k)));
      reply = hit ? hit.text : "Good question. Your consultant can cover that in detail at the visit.";
    }
    addMsg("andi", reply);
    await ask(state, { reprompt: true });
  }

  // ---------- States ----------
  const STATES = {
    async greet() {
      await say(`Hi, I'm ${cfg.agentName}! I can set up a free, no-pressure window consultation in about 2 minutes.`);
      if (fastTrack) return fastIntro(); // the booking button was clicked while Andi was greeting
      await say("First, what's bugging you about your current windows? Pick any that apply.");
      if (fastTrack) return fastIntro();
      state = "pains"; setProgress();
      offerPains();
    },
    async pains(re) {
      if (fastTrack && !re) {
        const a = lead.appointment;
        await say(a
          ? `You're booked for ${C.formatDay(a.date)} at ${a.slot}! A few quick questions so your consultant comes prepared. Skip anytime.`
          : "Got it, your consultant will reach out to pick a time. A few quick questions so they come prepared. Skip anytime.");
        await say("What's bugging you about your current windows? Pick any that apply.");
      } else {
        await say(re ? "Which of these sound like your windows? Pick any that apply." : "What's bugging you about your current windows?");
      }
      offerPains();
    },
    async windows(re) {
      await say(re ? "About how many windows would you want looked at?" : "Got it. About how many windows are you thinking of replacing? A rough number is fine.");
      setQuick(C.WINDOW_RANGES);
    },
    async doors() {
      await say("Any patio or entry doors you'd want replaced too?");
      setQuick(C.DOOR_OPTIONS);
    },
    async age() {
      await say("Roughly how old are the windows?");
      setQuick(withKeys(C.AGES));
    },
    async material() {
      await say("And what are the frames made of?");
      setQuick(withKeys(C.MATERIALS));
    },
    async home() {
      await say("What type of home is it?");
      setQuick(withKeys(C.PROPERTY_TYPES));
    },
    async owner() {
      await say("Do you own the home?");
      setQuick([{ id: "yes", label: "Yes, I own it", keys: ["yes", "yeah", "yep", "own", "i do"] }, { id: "no", label: "No, I rent", keys: ["no", "rent", "landlord", "tenant"] }]);
    },
    async timeline() {
      await say("When are you hoping to get this done?");
      setQuick(withKeys(C.TIMELINES));
    },
    async contact() {
      await say("Perfect. Where should your consultant reach you? This also tells me which local team covers your area.");
      clearQuick();
      showContactForm();
    },
    async book() {
      const days = C.nextBusinessDays(3);
      await say(fastTrack
        ? `Thanks, ${lead.contact.first}! Pick a time for your free in-home consultation.`
        : `Thanks, ${lead.contact.first}! Want to lock in a free in-home consultation? Pick a time that works.`);
      const opts = [];
      days.forEach((d) => cfg.slots.forEach((slot) => opts.push({ id: `${d}|${slot}`, label: `${C.formatDay(d)} · ${slot}`, date: d, slot })));
      opts.push({ id: "later", label: "Text me to schedule instead" });
      setQuick(opts);
    },
  };

  function offerPains() {
    setQuick(C.PAINS, {
      multi: true,
      onDone: (chosen) => {
        lead.pains = chosen.map((c) => c.id);
        userSaid(chosen.map((c) => c.label).join(", "));
        next();
      },
    });
  }

  async function ask(name, opts) {
    state = name;
    setProgress();
    await STATES[name](opts && opts.reprompt);
  }

  function userSaid(text) {
    clearQuick();
    addMsg("user", text);
  }

  // Move to the step after the current one in the active order, or finish.
  async function advance() {
    const order = fastTrack ? FAST_ORDER : ORDER;
    const i = order.indexOf(state);
    const nextState = order[i + 1];
    if (nextState) await ask(nextState);
    else await finish();
  }

  async function next() {
    busy = true;
    try { await advance(); } finally { busy = false; }
  }

  // Booking-first path: skip straight to contact details.
  async function fastIntro() {
    clearQuick();
    addMsg("user", "I'd like to set up a consultation.");
    await say("Great, let's get you on the calendar. Where should your consultant reach you? This also tells me which local team covers your area.");
    state = "contact"; setProgress();
    showContactForm();
  }

  async function startFastTrack() {
    document.querySelector(".chat").scrollIntoView({ behavior: "smooth", block: "start" });
    // Only switch paths before the homeowner has answered anything.
    const fresh = state === null || state === "greet" || (state === "pains" && !lead.pains.length);
    if (fastTrack || !fresh) { input.focus({ preventScroll: true }); return; }
    fastTrack = true;
    if (state === null) return begin(); // greet sees fastTrack and hands off
    if (busy) return; // greet is still typing; it hands off when done
    busy = true;
    try { await fastIntro(); } finally { busy = false; }
  }

  // ---------- Answer handling (buttons and typed text) ----------
  async function answer(text, option) {
    if (busy || !state || state === "done" || state === "dq") return;
    userSaid(text);
    busy = true;
    try {
      const handled = await apply(text, option);
      if (!handled) await handleOffScript(text);
    } finally {
      busy = false;
    }
  }

  // Returns true when the answer moved the flow forward.
  async function apply(text, o) {
    if (o && o.id === SKIP.id) {
      await finish();
      return true;
    }
    switch (state) {
      case "greet":
        return false;
      case "pains": {
        const t = text.toLowerCase();
        const found = C.PAINS.filter((p) => p.label.toLowerCase().split(/[ /]+/).some((w) => w.length > 3 && t.includes(w)));
        if (!found.length) return false;
        lead.pains = found.map((p) => p.id);
        await advance();
        return true;
      }
      case "windows": {
        if (o && o.value) {
          lead.windows = o.value; // range button: store a representative count
          lead.windowsApprox = true;
        } else {
          const n = firstInt(text);
          if (!n || n > 200) return false;
          lead.windows = n;
          lead.windowsApprox = false;
        }
        await advance();
        return true;
      }
      case "doors": {
        let n = o ? o.value : firstInt(text);
        if (n === null && /\b(no|none|nope|zero)\b/i.test(text)) n = 0;
        if (n === null || n > 20) return false;
        lead.doors = n;
        await advance();
        return true;
      }
      case "age": {
        let hit = o || matchOption(text, withKeys(C.AGES));
        const yrs = firstInt(text);
        if (!o && yrs !== null) hit = C.AGES.find((a) => a.id === (yrs < 10 ? "lt10" : yrs < 20 ? "10-20" : yrs < 30 ? "20-30" : "30+"));
        if (!hit) return false;
        lead.windowAge = hit.id;
        lead.windowAgeYears = !o && yrs !== null && yrs < 120 ? yrs : null;
        await advance();
        return true;
      }
      case "material": {
        const hit = o || matchOption(text, withKeys(C.MATERIALS));
        if (!hit) return false;
        lead.windowMaterial = hit.id;
        await advance();
        return true;
      }
      case "home": {
        const hit = o || matchOption(text, withKeys(C.PROPERTY_TYPES));
        if (!hit) return false;
        lead.propertyType = hit.id;
        await advance();
        return true;
      }
      case "owner": {
        const opts = [{ id: "yes", label: "Yes, I own it", keys: ["yes", "yeah", "yep", "own", "i do"] }, { id: "no", label: "No, I rent", keys: ["no", "rent", "landlord", "tenant"] }];
        const hit = o || matchOption(text, opts);
        if (!hit) return false;
        lead.owner = hit.id === "yes";
        if (!lead.owner) {
          state = "dq"; setProgress();
          if (fastTrack) {
            // Already booked: release the slot and let the rep follow up with the owner.
            lead.appointment = null;
            await say("Thanks for being upfront! Window replacement has to be approved by the homeowner, so I've released that time slot. Your consultant will reach out about setting up a visit with the owner.");
          } else {
            await say("Thanks for being upfront! Window replacement has to be approved by the homeowner. Feel free to share this page with your landlord. They can book a free consultation here anytime.");
          }
          saveAndSend();
          input.disabled = true;
          input.placeholder = "Conversation complete";
          return true;
        }
        await advance();
        return true;
      }
      case "timeline": {
        const hit = o || matchOption(text, withKeys(C.TIMELINES));
        if (!hit) return false;
        lead.timeline = hit.id;
        await advance();
        return true;
      }
      case "contact":
        return false; // the form handles this step
      case "book": {
        if (o && o.id === "later") lead.appointment = null;
        else if (o && o.date) lead.appointment = { date: o.date, slot: o.slot };
        else return false;
        await advance(); // finishes on the normal path; prep questions on the fast track
        return true;
      }
    }
    return false;
  }

  // ---------- Contact form (inline in the chat) ----------
  function showContactForm() {
    const tpl = $("#contact-tpl").content.cloneNode(true);
    const card = tpl.querySelector("form");
    card.querySelector("[data-seller]").textContent = cfg.sellerName || "the local window replacement dealer";
    log.appendChild(tpl);
    scrollDown();
    const first = card.querySelector("[name=first]");
    first && first.focus();
    input.disabled = true;
    input.placeholder = "Fill in the form above";

    card.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (busy) return;
      const f = Object.fromEntries(new FormData(card));
      const err = card.querySelector(".form-error");
      const bad = [];
      const phone = String(f.phone || "").replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
      const checks = {
        first: !!String(f.first || "").trim(),
        last: !!String(f.last || "").trim(),
        phone: phone.length === 10,
        email: !f.email || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email),
        street: !!String(f.street || "").trim(),
        city: !!String(f.city || "").trim(),
        zip: /^\d{5}$/.test(String(f.zip || "").trim()),
      };
      Object.entries(checks).forEach(([k, ok]) => {
        const el = card.querySelector(`[name=${k}]`);
        el.setAttribute("aria-invalid", String(!ok));
        if (!ok) bad.push(k);
      });
      if (bad.length) {
        err.textContent = "Please check the highlighted fields.";
        card.querySelector(`[name=${bad[0]}]`).focus();
        return;
      }
      err.textContent = "";

      lead.contact = { first: f.first.trim(), last: f.last.trim(), phone, email: String(f.email || "").trim() };
      const zip = f.zip.trim();
      lead.address = { street: f.street.trim(), city: f.city.trim(), state: zip.startsWith("39") ? "MS" : "LA", zip };
      lead.yearBuilt = String(f.yearBuilt || "").trim();
      lead.smsConsent = f.consent === "on";
      lead.turnstileToken = f["cf-turnstile-response"] || "";

      card.querySelectorAll("input, button").forEach((el) => (el.disabled = true));
      input.disabled = false;
      input.placeholder = "Type a message…";
      addMsg("user", `${C.fullName(lead.contact)} · ${C.formatPhone(phone)} · ${lead.address.city} ${zip}`);

      busy = true;
      try {
        const terr = C.territoryFor(zip);
        if (!terr.inArea) {
          state = "dq"; setProgress();
          await say(`Thanks, ${lead.contact.first}. ${zip} looks like it's outside the area this team covers. I've passed your details along so the right local office can reach out.`);
          saveAndSend();
          return;
        }
        await advance();
      } finally {
        busy = false;
      }
    });

    if (window.ANDI_TURNSTILE_SITEKEY && window.turnstile) {
      const slot = card.querySelector("[data-turnstile]");
      slot.hidden = false;
      window.turnstile.render(slot, { sitekey: window.ANDI_TURNSTILE_SITEKEY });
    }
  }

  // ---------- Finish: confirmation, save, hand off ----------
  async function finish() {
    const appointment = lead.appointment;
    state = "done"; setProgress();
    C.finalizeLead(lead);

    await typing(600);
    const res = await callAndi("confirm", { lead: publicLead() });
    if (res && res.projectDetails) lead.projectDetails = res.projectDetails;
    const fallback = appointment
      ? `You're all set, ${lead.contact.first}! Your free consultation is ${C.formatDay(appointment.date)} at ${appointment.slot}. ${lead.smsConsent ? "You'll get a text confirmation shortly. " : ""}Your consultant will measure ${lead.windows + lead.doors ? `your ${lead.windowsApprox ? "roughly " : ""}${lead.windows + lead.doors} openings` : "every opening"} and go over options. No pressure, no obligation.`
      : `Thanks, ${lead.contact.first}! A local consultant will ${lead.smsConsent ? "text" : "call"} you shortly to find a time that works.`;
    addMsg("andi", (res && res.message) || fallback);
    C.finalizeLead(lead);
    saveAndSend();
    clearQuick();
    input.disabled = true;
    input.placeholder = "Conversation complete";
  }

  // Only the fields the AI needs; no transcript, phone or email.
  function publicLead() {
    return {
      firstName: lead.contact.first, city: lead.address.city,
      windows: lead.windows, windowsApprox: lead.windowsApprox, doors: lead.doors,
      windowAge: (C.byId(C.AGES, lead.windowAge) || {}).label,
      windowMaterial: (C.byId(C.MATERIALS, lead.windowMaterial) || {}).label,
      pains: lead.pains.map((id) => (C.byId(C.PAINS, id) || {}).label),
      propertyType: (C.byId(C.PROPERTY_TYPES, lead.propertyType) || {}).label,
      timeline: (C.byId(C.TIMELINES, lead.timeline) || {}).label,
      yearBuilt: lead.yearBuilt,
      appointment: lead.appointment ? `${C.formatDay(lead.appointment.date)} at ${lead.appointment.slot}` : null,
      smsConsent: lead.smsConsent,
    };
  }

  function saveAndSend() {
    C.finalizeLead(lead);
    C.store.save(lead);
    const link = $("#dash-link");
    if (link) link.hidden = false;
    if (!lead.contact.phone) return; // e.g. renter: nothing for a rep to follow up on
    fetch("/api/lead", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(lead) })
      .then((r) => r.ok ? r.json() : null)
      .then((j) => { if (j && j.forwarded) addMsg("note", "Sent to your consultant."); })
      .catch(() => {});
  }

  // ---------- Wire up ----------
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text || busy) return;
    input.value = "";
    answer(text, null);
  });

  $("#book").addEventListener("click", startFastTrack);

  $("#start").addEventListener("click", () => {
    document.querySelector(".chat").scrollIntoView({ behavior: "smooth", block: "start" });
    if (state) { input.focus({ preventScroll: true }); return; }
    begin();
  });

  async function begin() {
    if (state) return;
    state = "greet";
    busy = true;
    try { await STATES.greet(); } finally { busy = false; }
  }

  // Start automatically once the chat scrolls into view.
  const io = new IntersectionObserver((entries) => {
    if (entries.some((e) => e.isIntersecting)) { io.disconnect(); begin(); }
  }, { threshold: 0.4 });
  io.observe(document.querySelector(".chat"));
})();
