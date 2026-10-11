/*
 * Rep dashboard: KPIs vs. monthly targets, a lead list, and an appointment
 * detail view laid out like the rep's CRM card (Update / Unassign / Finalize,
 * Appointment Rep(s) with ride-alongs, Past Appointments).
 */
(function () {
  "use strict";
  const C = window.AndiCore;
  const $ = (s, el) => (el || document).querySelector(s);

  // Lead fields are typed by homeowners, so everything rendered as HTML is escaped.
  const esc = (v) => String(v == null ? "" : v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const label = (list, id) => (C.byId(list, id) || {}).label || "";

  let settings = C.store.settings();
  let openId = null;
  let editing = null; // "update" | "finalize" | "ride" | null

  // ---------- Header / settings ----------
  const repInput = $("#rep-name");
  repInput.value = settings.repName;
  repInput.addEventListener("change", () => {
    const old = settings.repName;
    settings.repName = repInput.value.trim() || C.CONFIG.defaultRepName;
    C.store.saveSettings(settings);
    // Move leads assigned to the old name over to the new one.
    const list = C.store.all().map((l) => {
      if (l.assignedTo === old) l.assignedTo = settings.repName;
      l.reps = (l.reps || []).map((r) => (r.name === old ? Object.assign({}, r, { name: settings.repName }) : r));
      return l;
    });
    C.store.replaceAll(list);
    render();
  });

  const statusSel = $("#f-status");
  C.STATUSES.forEach((s) => statusSel.insertAdjacentHTML("beforeend", `<option value="${s.id}">${esc(s.label)}</option>`));
  ["#q", "#f-status", "#f-tier"].forEach((s) => $(s).addEventListener("input", renderRows));

  // ---------- KPIs ----------
  function renderKpis(list) {
    const now = new Date();
    const thisMonth = list.filter((l) => {
      const d = new Date(l.createdAt);
      return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    });
    const qualified = thisMonth.filter((l) => l.status !== "lost");
    // Count an appointment whether it's upcoming or already run and finalized.
    const appts = thisMonth.filter((l) => (l.appointment && l.appointment.date) || (l.pastAppointments || []).length);
    const hot = qualified.filter((l) => l.score && l.score.tier === "hot");
    const sold = list.filter((l) => l.status === "sold").length;
    const ran = list.filter((l) => (l.pastAppointments || []).some((p) => /^(Sold|No Sale)/.test(p.result))).length;
    const pct = (a, b) => (b ? Math.min(100, Math.round((a / b) * 100)) : 0);
    const tLead = C.CONFIG.monthlyLeadTarget;
    const tAppt = C.CONFIG.monthlyApptTarget;
    $("#kpis").innerHTML = `
      <div class="kpi"><div class="label">Qualified leads</div><div class="value">${qualified.length}<span class="sub"> / ${tLead}</span></div>
        <div class="meter"><span style="width:${pct(qualified.length, tLead)}%"></span></div><div class="sub">this month vs. target</div></div>
      <div class="kpi"><div class="label">Appointments set</div><div class="value">${appts.length}<span class="sub"> / ${tAppt}</span></div>
        <div class="meter"><span style="width:${pct(appts.length, tAppt)}%"></span></div><div class="sub">this month vs. target</div></div>
      <div class="kpi"><div class="label">Booking rate</div><div class="value">${pct(appts.length, qualified.length)}%</div><div class="sub">appointments ÷ qualified leads</div></div>
      <div class="kpi"><div class="label">Hot leads</div><div class="value">${hot.length}</div><div class="sub">score 70+ this month</div></div>
      <div class="kpi"><div class="label">Close rate</div><div class="value">${ran ? pct(sold, ran) + "%" : "–"}</div><div class="sub">${sold} sold of ${ran} run</div></div>`;
  }

  // ---------- Table ----------
  function filtered(list) {
    const q = $("#q").value.trim().toLowerCase();
    const st = $("#f-status").value;
    const tier = $("#f-tier").value;
    return list.filter((l) => {
      if (st && l.status !== st) return false;
      if (tier && (!l.score || l.score.tier !== tier)) return false;
      if (!q) return true;
      const hay = [C.fullName(l.contact), l.contact.phone, l.contact.email, l.address.city, l.address.zip, l.address.street, l.projectDetails].join(" ").toLowerCase();
      return hay.includes(q.replace(/[()\-\s]/g, "")) || hay.includes(q);
    });
  }

  function scoreBadge(l) {
    if (!l.score) return "";
    return `<span class="badge ${l.score.tier}">${l.score.value} · ${l.score.tier}</span>`;
  }

  function statusPill(l) {
    return `<span class="pill ${esc(l.status)}">${esc(label(C.STATUSES, l.status) || l.status)}</span>`;
  }

  function renderRows() {
    const all = C.store.all();
    const list = filtered(all).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    $("#empty").hidden = all.length > 0;
    $("#rows").innerHTML = list.map((l) => `
      <tr data-id="${esc(l.id)}" tabindex="0">
        <td><div class="name">${esc(C.fullName(l.contact) || "(no name yet)")}${l.demo ? '<span class="tag-demo">DEMO</span>' : ""}</div>
            <div class="sub">${esc(C.formatPhone(l.contact.phone))}</div></td>
        <td class="num">${esc(C.formatDateTime(l.createdAt))}</td>
        <td>${l.appointment && l.appointment.date ? esc(`${C.formatDay(l.appointment.date)} · ${l.appointment.slot}`) : '<span class="sub">Not booked</span>'}</td>
        <td>${esc(l.territory ? l.territory.market : "")}<div class="sub">${esc(l.address.city)} ${esc(l.address.zip)}</div></td>
        <td>${esc(C.unitsLabel(l))}<div class="sub">${esc(label(C.AGES, l.windowAge))}</div></td>
        <td>${scoreBadge(l)}</td>
        <td>${statusPill(l)}</td>
      </tr>`).join("");
  }

  $("#rows").addEventListener("click", (e) => {
    const tr = e.target.closest("tr[data-id]");
    if (tr) openLead(tr.dataset.id);
  });
  $("#rows").addEventListener("keydown", (e) => {
    const tr = e.target.closest("tr[data-id]");
    if (tr && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); openLead(tr.dataset.id); }
  });

  function render() {
    const all = C.store.all();
    renderKpis(all);
    renderRows();
    if (openId) renderModal();
  }

  // ---------- Appointment modal ----------
  const modal = $("#modal");

  function openLead(id) {
    openId = id;
    editing = null;
    modal.hidden = false;
    renderModal();
    $("[data-close]", modal).focus();
  }

  function closeModal() {
    modal.hidden = true;
    openId = null;
    editing = null;
  }
  modal.addEventListener("click", (e) => {
    if (e.target === modal || e.target.closest("[data-close]")) closeModal();
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !modal.hidden) closeModal(); });

  function row(dt, dd, raw) {
    const has = raw ? !!dd : dd != null && String(dd).trim() !== "";
    return `<dt>${esc(dt)}</dt><dd class="${has ? "" : "empty-val"}">${has ? (raw ? dd : esc(dd)) : "—"}</dd>`;
  }

  function renderModal() {
    const l = C.store.get(openId);
    if (!l) { closeModal(); return; }
    const name = C.fullName(l.contact);
    $("#m-title").textContent = l.assignedTo || "Unassigned";

    const apptLine = l.appointment && l.appointment.date
      ? `${l.appointment.slot} ${C.formatDay(l.appointment.date)} with ${name}`
      : `Unscheduled · ${name}`;

    const addr = [l.address.street, `${l.address.city}, ${l.address.state === "MS" ? "Mississippi" : l.address.state === "LA" ? "Louisiana" : l.address.state} ${l.address.zip}`, "United States"].filter(Boolean).join("\n");
    const contact = [name, l.contact.phone ? `${C.formatPhone(l.contact.phone)} (Mobile)` : "", l.contact.email, l.smsConsent ? "✓ SMS consent given" : "✗ No SMS consent: call only"].filter(Boolean).join("\n");
    const ageLabel = label(C.AGES, l.windowAge);
    const age = C.ageYears(l);
    const ageText = age ? (age.exact ? String(age.years) : `~${age.years} (${ageLabel})`) : ageLabel;

    const score = l.score
      ? `${scoreBadge(l)}${l.score.flags.length ? ` <span class="flags">${esc(l.score.flags.join(" · "))}</span>` : ""}
         <ul class="score-reasons">${l.score.reasons.map((r) => `<li>${esc(r)}</li>`).join("")}</ul>`
      : "";

    const reps = (l.reps || []).map((r, i) => `<span class="rep-chip">${esc(r.name)} (${esc(r.role)})${r.role !== "Primary" ? ` <button type="button" data-rm-rep="${i}" aria-label="Remove ${esc(r.name)}">×</button>` : ""}</span>`).join("");

    const past = (l.pastAppointments || []).map((p) => `<tr><td>${esc(p.date)}</td><td>${esc(p.result)}${p.amount ? ` · $${esc(Number(p.amount).toLocaleString())}` : ""}</td><td>${esc(p.doneBy)}</td></tr>`).join("");

    $("#m-body").innerHTML = `
      <div class="appt-head"><span class="chev">⌄</span> ${esc(apptLine)}</div>
      <dl class="card">
        ${row("Appointment Type", l.appointmentType)}
        ${row("Set Date", C.formatDateTime(l.createdAt))}
        ${row("Address", addr)}
        ${row("Primary Contact", contact)}
        ${row("Property Type", label(C.PROPERTY_TYPES, l.propertyType) + (l.owner === false ? " (renter)" : ""))}
        ${row("Lead Source", l.leadSource)}
        ${row("Source Breakdown", l.sourceBreakdown)}
        ${row("Details", C.unitsLabel(l))}
        ${row("Age of Windows", ageText)}
        ${row("Windows Material", label(C.MATERIALS, l.windowMaterial))}
        ${row("Year Built", l.yearBuilt)}
        ${row("Project Details", l.projectDetails)}
        ${row("Pain Points", (l.pains || []).map((id) => label(C.PAINS, id)).join(", "))}
        ${row("Timeline", label(C.TIMELINES, l.timeline))}
        ${row("Andi Score", score, true)}
        ${row("Status", statusPill(l), true)}
        <dt>Appointment Assigned To:</dt>
        <dd>${esc(l.assignedTo || "Unassigned")}
          <div class="actions-row">
            <button class="btn btn-sage" type="button" data-act="update">Update</button>
            ${l.assignedTo ? '<button class="btn btn-sage" type="button" data-act="unassign">Unassign</button>' : '<button class="btn btn-sage" type="button" data-act="assign">Assign to me</button>'}
            <button class="btn btn-sage push" type="button" data-act="finalize">Finalize</button>
          </div>
          ${editing === "update" ? updateForm(l) : ""}
          ${editing === "finalize" ? finalizeForm(l) : ""}
        </dd>
        <dt>Appointment Rep(s):</dt>
        <dd><div class="rep-box">${reps || '<span class="sub" style="color:#aaa">None</span>'}</div>
          <div class="actions-row"><button class="btn btn-ghost btn-sm" type="button" data-act="ride">＋ Add Ride Along</button></div>
          ${editing === "ride" ? `<form class="inline-edit" data-form="ride"><input name="name" placeholder="Rep name" required><button class="btn btn-sm" type="submit">Add</button></form>` : ""}
        </dd>
      </dl>
      <div class="section-title">Past Appointments</div>
      <table class="past"><thead><tr><th>Date</th><th>Result</th><th>Done By</th></tr></thead>
        <tbody>${past || '<tr><td colspan="3" style="color:#aaa">None yet</td></tr>'}</tbody></table>
      <details class="transcript"><summary>Andi conversation (${(l.transcript || []).length} messages)</summary>
        <div class="transcript-log">${(l.transcript || []).map((m) => `<div class="msg ${m.from === "user" ? "user" : "andi"}">${esc(m.text)}</div>`).join("")}</div>
      </details>`;
  }

  function updateForm(l) {
    const days = C.nextBusinessDays(14);
    const cur = l.appointment || {};
    if (cur.date && !days.includes(cur.date)) days.unshift(cur.date);
    return `<form class="inline-edit" data-form="update">
      <label class="sr-only" for="u-date">Date</label>
      <select id="u-date" name="date"><option value="">No appointment</option>${days.map((d) => `<option value="${d}" ${d === cur.date ? "selected" : ""}>${esc(C.formatDay(d))}</option>`).join("")}</select>
      <label class="sr-only" for="u-slot">Time</label>
      <select id="u-slot" name="slot">${C.CONFIG.slots.map((s) => `<option ${s === cur.slot ? "selected" : ""}>${s}</option>`).join("")}</select>
      <label class="sr-only" for="u-status">Status</label>
      <select id="u-status" name="status">${C.STATUSES.map((s) => `<option value="${s.id}" ${s.id === l.status ? "selected" : ""}>${esc(s.label)}</option>`).join("")}</select>
      <label class="sr-only" for="u-details">Project details</label>
      <textarea id="u-details" name="projectDetails" placeholder="Project details">${esc(l.projectDetails)}</textarea>
      <button class="btn btn-sm" type="submit">Save</button>
      <button class="btn btn-ghost btn-sm" type="button" data-act="cancel">Cancel</button>
    </form>`;
  }

  function finalizeForm() {
    return `<form class="inline-edit" data-form="finalize">
      <label class="sr-only" for="f-result">Result</label>
      <select id="f-result" name="result">${C.RESULTS.map((r) => `<option>${esc(r.label)}</option>`).join("")}</select>
      <label class="sr-only" for="f-amount">Sale amount</label>
      <input id="f-amount" name="amount" type="number" min="0" step="1" placeholder="Sale $ (if sold)" style="width:150px">
      <button class="btn btn-sm" type="submit">Record result</button>
      <button class="btn btn-ghost btn-sm" type="button" data-act="cancel">Cancel</button>
    </form>`;
  }

  function mutate(fn) {
    const l = C.store.get(openId);
    if (!l) return;
    fn(l);
    l.score = C.scoreLead(l);
    C.store.save(l);
    render();
  }

  $("#m-body").addEventListener("click", (e) => {
    const act = e.target.closest("[data-act]");
    const rm = e.target.closest("[data-rm-rep]");
    if (rm) {
      mutate((l) => l.reps.splice(Number(rm.dataset.rmRep), 1));
      return;
    }
    if (!act) return;
    const a = act.dataset.act;
    if (a === "cancel") { editing = null; renderModal(); return; }
    if (a === "unassign") { mutate((l) => { l.assignedTo = ""; l.reps = (l.reps || []).filter((r) => r.role !== "Primary"); }); toast("Unassigned"); return; }
    if (a === "assign") {
      mutate((l) => { l.assignedTo = settings.repName; l.reps = [{ name: settings.repName, role: "Primary" }].concat((l.reps || []).filter((r) => r.role !== "Primary")); });
      return;
    }
    editing = editing === a ? null : a;
    renderModal();
    const firstField = $("#m-body form [name]");
    if (firstField) firstField.focus();
  });

  $("#m-body").addEventListener("submit", (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    const kind = e.target.dataset.form;
    if (kind === "update") {
      mutate((l) => {
        l.appointment = f.date ? { date: f.date, slot: f.slot } : null;
        l.status = f.status;
        l.projectDetails = f.projectDetails.trim();
      });
      toast("Appointment updated");
    } else if (kind === "finalize") {
      const res = C.RESULTS.find((r) => r.label === f.result);
      mutate((l) => {
        const when = l.appointment && l.appointment.date ? l.appointment.date : new Date().toISOString().slice(0, 10);
        l.pastAppointments = (l.pastAppointments || []).concat({ date: when, result: f.result, amount: f.amount ? Number(f.amount) : null, doneBy: l.assignedTo || settings.repName });
        l.status = res ? res.status : l.status;
        if (f.result !== "Rescheduled") l.appointment = null;
      });
      toast(`Recorded: ${f.result}`);
    } else if (kind === "ride") {
      const n = String(f.name || "").trim();
      if (n) mutate((l) => { l.reps = (l.reps || []).concat({ name: n, role: "Ride Along" }); });
    }
    editing = null;
    renderModal();
  });

  // ---------- Copy as CRM text ----------
  function crmText(l) {
    const age = C.ageYears(l);
    return [
      `Appointment Type: ${l.appointmentType}`,
      `Appointment: ${l.appointment ? `${C.formatDay(l.appointment.date)} ${l.appointment.slot}` : "Not booked"}`,
      `Address: ${l.address.street}, ${l.address.city}, ${l.address.state} ${l.address.zip}`,
      `Primary Contact: ${C.fullName(l.contact)} ${C.formatPhone(l.contact.phone)} (Mobile)${l.contact.email ? " " + l.contact.email : ""}`,
      `Property Type: ${label(C.PROPERTY_TYPES, l.propertyType)}`,
      `Lead Source: ${l.leadSource}`,
      `Source Breakdown: ${l.sourceBreakdown}`,
      `Details: ${C.unitsLabel(l)}`,
      `Age of Windows: ${age ? age.years : label(C.AGES, l.windowAge)}`,
      `Windows Material: ${label(C.MATERIALS, l.windowMaterial)}`,
      `Year Built: ${l.yearBuilt || ""}`,
      `Project Details: ${l.projectDetails}`,
    ].join("\n");
  }

  $("#m-copy").addEventListener("click", async () => {
    const l = C.store.get(openId);
    if (!l) return;
    try { await navigator.clipboard.writeText(crmText(l)); toast("Copied. Paste into the CRM."); }
    catch (e) { toast("Copy failed. Your browser blocked clipboard access."); }
  });

  // Two-click delete instead of confirm(), so it works everywhere.
  let armed = null;
  $("#m-delete").addEventListener("click", (e) => {
    if (armed !== openId) {
      armed = openId;
      e.target.textContent = "Click again to delete";
      setTimeout(() => { armed = null; e.target.textContent = "Delete"; }, 3000);
      return;
    }
    C.store.remove(openId);
    armed = null;
    e.target.textContent = "Delete";
    closeModal();
    render();
    toast("Lead deleted");
  });

  // ---------- Toolbar ----------
  $("#seed").addEventListener("click", () => {
    const existing = C.store.all().filter((l) => !l.demo);
    C.store.replaceAll(C.demoLeads(settings.repName).concat(existing));
    render();
    toast("Demo leads loaded");
  });

  $("#clear-demo").addEventListener("click", () => {
    C.store.replaceAll(C.store.all().filter((l) => !l.demo));
    render();
    toast("Demo leads cleared");
  });

  $("#export").addEventListener("click", () => {
    const cols = ["Set Date", "Name", "Phone", "Email", "SMS Consent", "Street", "City", "State", "ZIP", "Market", "Property Type", "Windows", "Doors", "Age of Windows", "Material", "Year Built", "Timeline", "Pain Points", "Project Details", "Score", "Tier", "Status", "Appointment", "Assigned To", "Lead Source", "Source Breakdown"];
    const q = (v) => `"${String(v == null ? "" : v).replace(/"/g, '""')}"`;
    const lines = C.store.all().map((l) => [
      C.formatDateTime(l.createdAt), C.fullName(l.contact), C.formatPhone(l.contact.phone), l.contact.email, l.smsConsent ? "yes" : "no",
      l.address.street, l.address.city, l.address.state, l.address.zip, l.territory ? l.territory.market : "",
      label(C.PROPERTY_TYPES, l.propertyType), l.windows, l.doors, label(C.AGES, l.windowAge), label(C.MATERIALS, l.windowMaterial), l.yearBuilt,
      label(C.TIMELINES, l.timeline), (l.pains || []).map((id) => label(C.PAINS, id)).join("; "), l.projectDetails,
      l.score ? l.score.value : "", l.score ? l.score.tier : "", label(C.STATUSES, l.status),
      l.appointment ? `${l.appointment.date} ${l.appointment.slot}` : "", l.assignedTo, l.leadSource, l.sourceBreakdown,
    ].map(q).join(","));
    const csv = [cols.map(q).join(",")].concat(lines).join("\r\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = `andi-leads-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });

  let toastTimer;
  function toast(msg) {
    const t = $("#toast");
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (t.hidden = true), 2200);
  }

  // Keep in sync if the chat is open in another tab.
  window.addEventListener("storage", (e) => { if (e.key && e.key.startsWith("andi.")) render(); });

  render();
})();
