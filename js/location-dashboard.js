// The Location Dashboard
//
// One location at a glance for its admins and owners: the AGCO dealer metric,
// To do, the Safety Brief and Safety Reports, EPA 609, forklift cards and crane
// qualifications (each with the required operators) and upcoming classes.

// ---- the Location dashboard ------------------------------------------------------
//
// One location at a glance, for the people who look after it: what needs doing,
// the AGCO dealer metric, EPA 609, forklift cards, crane qualifications and
// upcoming classes, for the people there. An admin sees their own location and
// any they're covering (0099) and switches between them; an owner can look at
// any. The database has already limited what's loaded to what this person may
// see, so this only sorts it by location.
let lxLocation = null;
// The month the Safety Brief and Reports panel shows, and whether it lists
// only the people missing something. The month is filled in on first draw:
// sxMonthKey is in safety-dashboard.js, which loads after this file.
let lxSafetyMonth = null, lxSafetyFilter = "missing";

function lxChoices() {
  if (!isAdmin()) return [];
  return isOwner() ? allLocations.filter(l => l.is_active !== false).map(l => l.id)
    : myLocations().filter(id => locations[id]);
}
function lxCurrent() {
  const choices = lxChoices();
  if (!choices.includes(lxLocation)) {
    lxLocation = choices.includes(profile && profile.location_id) ? profile.location_id : choices[0] || null;
  }
  return lxLocation;
}
function lxName(id = lxCurrent()) { return (id && locations[id]) || "Location"; }
function isLocationAdmin() { return lxChoices().length > 0; }

function showLocation() {
  viewShown = null; screenTouched = false;
  if (!isLocationAdmin()) return showHome();
  $("home").classList.add("hidden");
  $("view").classList.add("hidden");
  $("admin").classList.remove("hidden");
  setMode("location");
  document.body.dataset.page = "location";
  safely(renderLocationOverview);
  document.querySelector('#locationNav [data-tab="locationoverview"]').click();
  window.scrollTo(0, 0);
}

// The locations to switch between, under the Overview: an admin's own and the
// ones they cover, or every location for an owner.
function renderLocationNav() {
  const box = $("locationPicks");
  if (!box) return;
  const choices = lxChoices(), here = lxCurrent();
  box.innerHTML = choices.length > 1 ? `<div class="nav-group">${isOwner() ? "Locations" : "Your locations"}</div>`
    + choices.map(id => `<button type="button" class="nav-item${id === here ? " active" : ""}" data-lx-location="${esc(id)}"
        aria-current="${id === here}">${icon("building", 18)}<span>${esc(lxName(id))}${
          !isOwner() && id !== (profile && profile.location_id) ? ` <small class="note">covering</small>` : ""}</span></button>`).join("")
    : "";
}

$("admin").addEventListener("change", (event) => {
  if (event.target.id === "lxSafetyMonth") { lxSafetyMonth = event.target.value; renderLocationOverview(); }
});
$("admin").addEventListener("click", (event) => {
  const pill = event.target.closest("[data-lx-safety]");
  if (pill) { lxSafetyFilter = pill.dataset.lxSafety; renderLocationOverview(); }
});

document.addEventListener("click", (event) => {
  const pick = event.target.closest("[data-lx-location]");
  if (!pick) return;
  lxLocation = pick.dataset.lxLocation;
  setMode("location");
  renderLocationOverview();
  $("adminTitle").textContent = `${lxName()} Dashboard`;
  window.scrollTo(0, 0);
});

function renderLocationOverview() {
  const box = $("lxOverview");
  if (!box) return;
  renderLocationNav();
  const loc = lxCurrent();
  if (!loc) {
    box.innerHTML = `<div class="card"><p class="note">You aren't the admin of a location yet.</p></div>`;
    return;
  }
  const name = lxName(loc), placeKey = name.trim().toLowerCase();
  const here = (store) => String(store || "").trim().toLowerCase() === placeKey;
  if (document.body.classList.contains("location-mode")) $("adminTitle").textContent = `${name} Dashboard`;
  const byName = (a, b) => a.name.localeCompare(b.name);
  const today = new Date(new Date().toDateString()), DAY = 86400000;
  const short = (d) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

  // Who's here: on the UKG roster at this location, and with an account here.
  const roster = tsPeople.filter(r => here(r.store));
  const accounts = people.filter(p => p.location_id === loc && !p.deactivated_at);
  const emails = new Set([...roster.map(r => r.email), ...accounts.map(p => p.email)]
    .map(e => String(e || "").trim().toLowerCase()).filter(Boolean));
  const nameKeys = new Set([...roster.map(r => tsNameKey(r.first_name, r.last_name)),
    ...accounts.map(p => tsNameKey(p.full_name || "", ""))].filter(Boolean));
  // A forklift card carries an email, or for an old one only a name.
  const atLocation = (email, who) => {
    const e = String(email || "").trim().toLowerCase();
    return e ? emails.has(e) : nameKeys.has(tsNameKey(who || "", ""));
  };

  // The AGCO dealer metric, for this location's technicians.
  const m = tsModel(roster);
  const goal = tsGoalPercent(), need = tsRequiredHours();
  const shortBy = (t) => Math.max(0, t.required - (t.hours || 0));
  const notMet = m.techs.filter(t => !t.met).sort((a, b) => shortBy(a) - shortBy(b) || byName(a, b));
  const met = m.techs.filter(t => t.met).sort((a, b) => (b.hours || 0) - (a.hours || 0) || byName(a, b));
  const close = notMet.filter(t => t.hours !== null && shortBy(t) <= 8);
  const no609 = m.techs.filter(t => !t.epa609).sort(byName);
  const metGoal = m.techs.length && m.pct >= tsGoal();

  // Forklift cards: each person's newest, as the Safety dashboard counts them.
  const cards = certsPerPerson().filter(r => atLocation(r.email, r.operator_name))
    .map(r => ({ r, st: certStatusNow(r), name: r.operator_name || r.email || "Someone" }));
  const fkDays = (r) => Math.round((new Date(r.expiration_date) - new Date()) / DAY);
  const fk = {
    certified: cards.filter(x => x.st[1] === "b-current"),
    expiring: cards.filter(x => x.st[1] === "b-expiring").sort((a, b) => String(a.r.expiration_date).localeCompare(String(b.r.expiration_date))),
    expired: cards.filter(x => x.st[0] === "Expired"),
    removed: cards.filter(x => x.st[0] === "Removed"),
    waiting: cards.filter(x => x.st[1] === "b-pending")
  };
  const testsDue = evalPeople.filter(p => atLocation(p.email, p.name));
  // The Safety Manager's required operators here, forklift (0100) and crane
  // (0102), the ones who don't hold it first.
  const requiredHere = (kind) => reqKinds[kind].rows.filter(r => here(reqStoreOf(r)))
    .map(r => ({ r, st: reqKinds[kind].status(r), name: reqName(r) }))
    .sort((a, b) => (a.st.met - b.st.met) || a.name.localeCompare(b.name));
  const required = requiredHere("forklift"), reqNot = required.filter(x => !x.st.met);
  const craneRequired = requiredHere("crane"), craneReqNot = craneRequired.filter(x => !x.st.met);

  // The Safety Brief and Safety Reports, for everyone with an account here by
  // the month's end. A report is only a count (0101): who sent one is kept
  // from everyone but the Safety Manager, and what it says from the admin.
  const sKey = lxSafetyMonth || (lxSafetyMonth = sxMonthKey()), thisMonth = sKey === sxMonthKey();
  const sBrief = safetyBriefs.find(b => b.is_published && String(b.month).slice(0, 7) === sKey) || null;
  const sRows = sxPeopleIn(sKey).filter(p => p.location_id === loc).map(p => {
    const res = sBrief ? briefResult(sBrief, p.id) : null;
    return { p, name: p.full_name || p.email || "No name yet",
      brief: !sBrief ? null : res && res.passed_at ? "passed" : res && res.tries ? "failed" : res ? "started" : "none",
      reports: srCounts ? ((srCounts.find(c => c.person_id === p.id && c.month === sKey) || {}).reports || 0) : null };
  }).sort((a, b) => a.name.localeCompare(b.name));
  const briefPassed = sRows.filter(x => x.brief === "passed").length;
  const reportSent = sRows.filter(x => x.reports > 0).length;
  const needsBrief = sBrief ? sRows.filter(x => x.brief !== "passed") : [];
  const needsReport = srCounts ? sRows.filter(x => !x.reports) : [];
  const sMissing = sRows.filter(x => needsBrief.includes(x) || needsReport.includes(x));

  // Crane qualifications, from the course on Training Status.
  const crane = roster.map(r => ({ r, st: craneStatus(r), name: `${r.first_name} ${r.last_name}`.trim() }))
    .filter(x => x.st.kind !== "none");
  const soon = (d) => d && (d - today) / DAY <= 60;
  const cr = {
    qualified: crane.filter(x => x.st.kind === "qualified" && !soon(x.st.expires)),
    expiring: crane.filter(x => x.st.kind === "qualified" && soon(x.st.expires)).sort((a, b) => a.st.expires - b.st.expires),
    expired: crane.filter(x => x.st.kind === "expired"),
    removed: crane.filter(x => x.st.kind === "removed")
  };
  const techsNoCrane = roster.filter(r => r.is_technician && craneStatus(r).kind === "none");

  // Upcoming classes with someone from here on the roster.
  const internal = trainingReports.internal && trainingReports.internal.data;
  const todayKey = osrToday();
  const classes = internal ? (internal.classes || []).filter(c => (c.endDate || c.startDate || "9999") >= todayKey)
    .map(c => ({ c, who: (c.roster || []).filter(p => here(p.storeName)) })).filter(x => x.who.length)
    .sort((a, b) => (a.c.startDate || "9999").localeCompare(b.c.startDate || "9999") || a.c.title.localeCompare(b.c.title)) : [];

  // Waiting on this location's admin.
  const plansWaiting = plans.filter(p => p.status === "submitted" && p.location_id === loc);
  const inspTodo = inspections.filter(r => r.location_id === loc && !r.post_submitted_at
    && (inspForms.find(f => f.id === r.form_id) || {}).has_after_class);

  const plural = (n, one, many = one + "s") => `${n} ${n === 1 ? one : many}`;
  const todo = [
    reqNot.length && { n: reqNot.length, tone: "red", text: `required forklift ${reqNot.length === 1 ? "operator isn't" : "operators aren't"} certified`,
      items: reqNot.map(x => `${x.name} · ${x.st.label}${x.r.note ? ` · ${x.r.note}` : ""}`) },
    craneReqNot.length && { n: craneReqNot.length, tone: "red", text: `required crane ${craneReqNot.length === 1 ? "operator isn't" : "operators aren't"} qualified`,
      items: craneReqNot.map(x => `${x.name} · ${x.st.label}${x.r.note ? ` · ${x.r.note}` : ""}`) },
    plansWaiting.length && { n: plansWaiting.length, tone: "red", text: `${plansWaiting.length === 1 ? "lift plan" : "lift plans"} waiting for approval`,
      items: plansWaiting.map(p => `${p.created_by_name || "Someone"}: ${firstLine(p.job_description) || "Untitled lift"}`), go: ["rigging", "Crane Center"] },
    inspTodo.length && { n: inspTodo.length, tone: "amber", text: `${inspTodo.length === 1 ? "inspection" : "inspections"} with the after-class part to finish`,
      items: inspTodo.map(r => `${(inspForms.find(f => f.id === r.form_id) || {}).name || "Inspection"} · ${r.created_by_name || ""}`), go: ["inspection", "Inspection Center"] },
    no609.length && { n: no609.length, tone: "violet", text: `${no609.length === 1 ? "technician" : "technicians"} without EPA 609`,
      items: no609.map(t => t.name) },
    fk.expired.length && { n: fk.expired.length, tone: "red", text: `forklift ${fk.expired.length === 1 ? "card" : "cards"} expired`,
      items: fk.expired.map(x => `${x.name} · expired ${fmtDate(x.r.expiration_date)}`) },
    fk.expiring.length && { n: fk.expiring.length, tone: "amber", text: `forklift ${fk.expiring.length === 1 ? "card runs" : "cards run"} out in the next 60 days`,
      items: fk.expiring.map(x => `${x.name} · ${fkDays(x.r)} day${fkDays(x.r) === 1 ? "" : "s"}`) },
    testsDue.length && { n: testsDue.length, tone: "slate", text: `forklift driving ${testsDue.length === 1 ? "test" : "tests"} due`,
      items: testsDue.map(p => `${p.name} · by ${p.last_day ? fmtDate(p.last_day) : "the deadline"}`) },
    cr.expired.length && { n: cr.expired.length, tone: "red", text: `crane ${cr.expired.length === 1 ? "qualification" : "qualifications"} expired`,
      items: cr.expired.map(x => `${x.name} · expired ${short(x.st.expires)}`) },
    cr.expiring.length && { n: cr.expiring.length, tone: "amber", text: `crane ${cr.expiring.length === 1 ? "qualification runs" : "qualifications run"} out in the next 60 days`,
      items: cr.expiring.map(x => `${x.name} · ${short(x.st.expires)}`) },
    close.length && { n: close.length, tone: "teal", text: `${close.length === 1 ? "technician is" : "technicians are"} within 8 hours of ${need}`,
      items: close.map(t => `${t.name} · needs ${shortBy(t)}`) },
    thisMonth && needsBrief.length && { n: needsBrief.length, tone: "ember", text: `${needsBrief.length === 1 ? "person hasn't" : "people haven't"} passed this month's Safety Brief`,
      items: needsBrief.map(x => `${x.name} · ${x.brief === "failed" ? "not passed yet" : x.brief === "started" ? "started" : "not taken"}`) },
    thisMonth && needsReport.length && { n: needsReport.length, tone: "ember", text: `${needsReport.length === 1 ? "person hasn't" : "people haven't"} sent a Safety Report this month`,
      items: needsReport.map(x => x.name) }
  ].filter(Boolean);

  const line = (who, sub, note, tone) => `<div class="tx-who-row tx-line"><span class="tx-who-name"><b>${esc(who)}</b>${
    sub ? `<small>${esc(sub)}</small>` : ""}</span><span class="tx-note lx-note-${tone}">${note}</span></div>`;
  const list = (rows, empty) => rows.length ? `<div class="tx-who-list">${rows.join("")}</div>` : `<p class="sx-empty">${empty}</p>`;
  const job = (r) => (r.job || "").replace(/^\d+\s*-\s*/, "");
  const noReports = !roster.length;

  box.innerHTML = `<div class="sx lx" style="${lit("slate")}">
    <section class="sx-hero lx-hero">
      <div class="sx-hero-text">
        <span class="sx-kicker">${esc(name)} · ${plural(roster.length, "person", "people")} on the UKG reports · ${plural(accounts.length, "app account")}</span>
        <h2>${m.techs.length ? `${tsPct(m.pct)} have ${need}+ hours` : "No technicians yet"}</h2>
        <p>${m.techs.length ? `${m.metCount} of ${m.techs.length} technicians here. ${metGoal
          ? `<b class="ok">At or above the ${goal}% goal.</b>` : `The dealer goal is ${goal}%.`}${close.length ? ` ${close.length} ${close.length === 1 ? "is" : "are"} within 8 hours.` : ""}`
          : noReports ? "Nobody here is on the latest Training Status reports yet." : "Nobody here has Technician in their job title."}</p>
      </div>
      ${m.techs.length ? `<div class="tx-gauge${metGoal ? " ok" : ""}" style="--p:${Math.min(100, m.pct * 100)}%;--g:${goal}" role="img"
        aria-label="${tsPct(m.pct)} of ${esc(name)} technicians, goal ${goal}%"><i class="tx-gauge-goal"></i>
        <b>${Math.round(m.pct * 100)}<small>%</small></b><span>Goal ${goal}%</span></div>` : ""}
    </section>

    <div class="sx-tiles">
      ${sxTile("Technicians", sxNum(m.techs.length), `${plural(roster.length, "person", "people")} here`, { lit: "steel" })}
      ${sxTile(`Have ${need}+ hours`, sxNum(m.metCount), m.techs.length ? `${tsPct(m.pct)} of technicians` : "No technicians", { lit: "green", good: metGoal })}
      ${sxTile("EPA 609", sxNum(no609.length), no609.length ? "still need one" : "Every technician has it", { lit: "violet", hot: no609.length > 0 })}
      ${sxTile("Forklift cards", sxNum(fk.certified.length + fk.expiring.length), reqNot.length
        ? `${reqNot.length} required ${reqNot.length === 1 ? "operator" : "operators"} not certified`
        : fk.expiring.length || fk.expired.length ? `${fk.expiring.length} expiring · ${fk.expired.length} expired` : "Current cards",
        { lit: reqNot.length || fk.expired.length ? "red" : fk.expiring.length ? "amber" : "green", hot: reqNot.length > 0 })}
      ${sxTile("Crane qualified", sxNum(cr.qualified.length + cr.expiring.length), craneReqNot.length
        ? `${craneReqNot.length} required ${craneReqNot.length === 1 ? "operator" : "operators"} not qualified`
        : cr.expired.length || cr.expiring.length ? `${cr.expiring.length} expiring · ${cr.expired.length} expired` : "Current",
        { lit: craneReqNot.length || cr.expired.length ? "red" : cr.expiring.length ? "amber" : "green", hot: craneReqNot.length > 0 })}
      ${sxTile("Upcoming classes", sxNum(classes.length), classes.length ? `${plural(new Set(classes.flatMap(x => x.who.map(p => p.email || p.name))).size, "person", "people")} enrolled` : "Nobody enrolled", { lit: "teal" })}
    </div>

    <div class="sx-grid">
      <section class="sx-panel sx-wide" style="${lit(todo.length ? "amber" : "green")}">
        <header><h3>To do</h3><span>${todo.length ? plural(todo.length, "thing") + " to look at" : "All clear"}</span></header>
        ${todo.length ? `<div class="lx-todo">${todo.map(t => `<details>
            <summary style="--tone:var(--lit-${t.tone})"><b>${sxNum(t.n)}</b><span>${esc(t.text)}</span></summary>
            <ul>${t.items.map(i => `<li>${esc(i)}</li>`).join("")}</ul>
            ${t.go ? `<button type="button" class="sx-link" data-view="${t.go[0]}">Open the ${esc(t.go[1])} &rsaquo;</button>` : ""}
          </details>`).join("")}</div>`
          : `<p class="sx-empty sx-clear">${icon("checkCircle", 18)} Nothing waiting at ${esc(name)}: no lift plans to approve, every technician has EPA 609, every required forklift operator is certified and every required crane operator qualified, and no forklift card or crane qualification has run out.</p>`}
      </section>

      <section class="sx-panel" style="${lit("teal")}">
        <header><h3>Upcoming training</h3><span>${classes.length ? plural(classes.length, "class", "classes") : ""}</span></header>
        ${classes.length ? `<div class="lx-classes">${classes.map(({ c, who }) => `<div class="lx-class">
            <b>${esc(c.title)}</b>
            <small>${esc([c.startDate ? osrRange(c.startDate, c.endDate) : "", c.city].filter(Boolean).join(" · "))}</small>
            <span>${esc(who.map(p => p.name || `${p.first} ${p.last}`.trim()).join(", "))}</span></div>`).join("")}</div>`
          : `<p class="sx-empty">${internal ? `Nobody from ${esc(name)} is enrolled in an upcoming class on the latest Open Seat Report.`
            : "The Open Seat Report hasn't been published yet."}</p>`}
      </section>

      <section class="sx-panel sx-full" style="${lit("ember")}">
        <header><h3>Safety Brief &amp; Reports</h3><span>${esc(sxMonthName(sKey))}</span>
          <select id="lxSafetyMonth" class="tx-store" aria-label="Month">${sxMonthOptions(sKey)}</select></header>
        ${sRows.length ? `<div class="lx-safety-sum">
          <div><b>${sBrief ? `${briefPassed}<small> of ${sRows.length}</small>` : "—"}</b><span>${sBrief
            ? `passed the ${esc(sxMonthName(sKey))} Safety Brief` : `No Safety Brief was published for ${esc(sxMonthName(sKey))}`}</span></div>
          <div><b>${srCounts ? `${reportSent}<small> of ${sRows.length}</small>` : "—"}</b><span>${srCounts
            ? "sent at least one Safety Report" : "Report counts need migration 0101"}</span></div>
        </div>
        <div class="sx-who-bar">
          <div class="sx-who-pills">${[["missing", "Missing something", sMissing.length], ["all", "Everyone", sRows.length]].map(([id, label, n]) =>
            `<button type="button" class="sx-who-pill${lxSafetyFilter === id ? " on" : ""}" data-lx-safety="${id}">${label}<span>${n}</span></button>`).join("")}</div>
          ${(emails => emails.length && lxSafetyFilter === "missing" ? `<div class="row sx-who-mail">${bccButtons(emails).html}
            <button type="button" class="ghost" data-sd-copy="${esc(emails.join("; "))}">Copy the addresses</button><span class="msg"></span></div>` : "")(
            [...new Set(sMissing.map(x => (x.p.email || "").trim()).filter(e => /@/.test(e)))])}
        </div>
        ${(rows => rows.length ? `<div class="lx-safety">${rows.map(x => `<div class="lx-safety-row">
            <span class="tx-who-name"><b>${esc(x.name)}</b></span>
            <span class="tx-note lx-note-${x.brief === "passed" ? "ok" : x.brief === null ? "quiet" : x.brief === "none" ? "bad" : "warn"}">${
              x.brief === null ? "No brief" : x.brief === "passed" ? "Brief passed" : x.brief === "failed" ? "Brief not passed yet" : x.brief === "started" ? "Brief started" : "Brief not taken"}</span>
            <span class="tx-note lx-note-${x.reports === null ? "quiet" : x.reports ? "ok" : "bad"}">${
              x.reports === null ? "—" : x.reports ? `${x.reports} report${x.reports === 1 ? "" : "s"}` : "No report"}</span>
          </div>`).join("")}</div>`
          : `<p class="sx-empty sx-clear">${icon("checkCircle", 18)} Everyone at ${esc(name)} has passed the brief and sent a report for ${esc(sxMonthName(sKey))}.</p>`)(
          lxSafetyFilter === "missing" ? sMissing : sRows)}
        <p class="sx-sub">Everyone with an app account at ${esc(name)} by the end of the month. Who sent a Safety Report is a count only; what it says stays with the Safety Manager.</p>`
        : `<p class="sx-empty">Nobody at ${esc(name)} has an app account yet.</p>`}
      </section>

      <section class="sx-panel sx-full" style="${lit(metGoal ? "green" : "amber")}">
        <header><h3>AGCO dealer metric</h3><span>${m.techs.length ? `${m.metCount} of ${m.techs.length} technicians · goal ${goal}% dealer-wide` : ""}</span>
          <button type="button" class="sx-link" data-view="training">Training Center &rsaquo;</button></header>
        ${m.techs.length ? `<div class="tx-who">
          <div><h4>Not there yet · ${notMet.length}</h4>
            <p class="sx-sub">Closest first. Tick <b>Plan</b> for anyone you'll get to ${need} hours this year; the plan is yours, and shows on Training Status.</p>
            ${notMet.length ? `<div class="tx-who-list">${notMet.map(t => txWhoRow(t, true)).join("")}</div>`
              : `<p class="sx-empty sx-clear">${icon("checkCircle", 18)} Every technician here has ${need} hours.</p>`}</div>
          <div><h4>Have ${need}+ hours · ${met.length}</h4>
            ${met.length ? `<div class="tx-who-list">${met.map(t => txWhoRow(t, false)).join("")}</div>` : `<p class="sx-empty">Nobody here yet.</p>`}</div>
        </div>` : `<p class="sx-empty">${noReports ? "Nobody here is on the latest Training Status reports yet." : "No technicians here."}</p>`}
      </section>

      <section class="sx-panel" style="${lit("violet")}">
        <header><h3>EPA 609</h3><span>${m.techs.length ? `${m.techs.length - no609.length} of ${m.techs.length} have it` : ""}</span></header>
        ${m.techs.length ? `<h4>Still need it · ${no609.length}</h4>${no609.length
          ? list(no609.map(t => line(t.name, t.job ? t.job.replace(/^\d+\s*-\s*/, "") : "", "needs it", "warn")), "")
          : `<p class="sx-empty sx-clear">${icon("checkCircle", 18)} Every technician here has it.</p>`}` : `<p class="sx-empty">No technicians here.</p>`}
      </section>

      <section class="sx-panel" style="${lit(reqNot.length || fk.expired.length ? "red" : fk.expiring.length ? "amber" : "green")}">
        <header><h3>Forklift cards</h3><span>${plural(cards.length, "card")}</span></header>
        ${required.length ? `<h4 style="margin-top:0">Required operators · ${required.length - reqNot.length} of ${required.length} certified</h4>
          ${list(required.map(x => line(x.name, x.r.note || "", esc(x.st.label), x.st.tone)), "")}
          <h4>Everyone with a card</h4>` : ""}
        <div class="sx-trio"><div><b>${sxNum(fk.certified.length)}</b><span>Certified</span></div>
          <div class="amber"><b>${sxNum(fk.expiring.length)}</b><span>Expiring</span></div>
          <div class="red"><b>${sxNum(fk.expired.length)}</b><span>Expired</span></div></div>
        ${list([...fk.expired, ...fk.expiring, ...fk.waiting, ...fk.removed, ...fk.certified].map(x =>
            line(x.name, (x.r.truck_classes || []).join(", "),
              x.st[0] === "Expired" ? `expired ${fmtDate(x.r.expiration_date)}`
              : x.st[1] === "b-expiring" ? `${fkDays(x.r)} days left`
              : x.st[1] === "b-current" ? `until ${fmtDate(x.r.expiration_date)}` : esc(x.st[0]).toLowerCase(),
              x.st[1] === "b-current" ? "ok" : x.st[1] === "b-expiring" || x.st[1] === "b-pending" ? "warn" : "bad")),
          `Nobody at ${esc(name)} has a forklift card on record.`)}
        ${testsDue.length ? `<p class="sx-sub">${plural(testsDue.length, "person", "people")} passed the online course and ${testsDue.length === 1 ? "is" : "are"} due a driving test: ${esc(testsDue.map(p => p.name).join(", "))}.</p>` : ""}
      </section>

      <section class="sx-panel" style="${lit(craneReqNot.length || cr.expired.length ? "red" : cr.expiring.length ? "amber" : "green")}">
        <header><h3>Crane qualifications</h3><span>${esc(craneCourse())}</span></header>
        ${craneRequired.length ? `<h4 style="margin-top:0">Required operators · ${craneRequired.length - craneReqNot.length} of ${craneRequired.length} qualified</h4>
          ${list(craneRequired.map(x => line(x.name, x.r.note || "", esc(x.st.label), x.st.tone)), "")}
          <h4>Everyone who's taken it</h4>` : ""}
        <div class="sx-trio"><div><b>${sxNum(cr.qualified.length)}</b><span>Qualified</span></div>
          <div class="amber"><b>${sxNum(cr.expiring.length)}</b><span>Expiring</span></div>
          <div class="red"><b>${sxNum(cr.expired.length + cr.removed.length)}</b><span>Expired · removed</span></div></div>
        ${list([...cr.expired, ...cr.removed, ...cr.expiring, ...cr.qualified].map(x =>
            line(x.name, job(x.r),
              x.st.kind === "expired" ? `expired ${short(x.st.expires)}` : x.st.kind === "removed" ? "removed"
              : x.st.expires ? `until ${short(x.st.expires)}` : "qualified",
              x.st.kind === "qualified" ? (soon(x.st.expires) ? "warn" : "ok") : "bad")),
          noReports ? "Nobody here is on the latest Training Status reports yet." : `Nobody at ${esc(name)} has taken the course.`)}
        ${techsNoCrane.length ? `<p class="sx-sub">Technicians who haven't taken it: ${esc(techsNoCrane.map(r => `${r.first_name} ${r.last_name}`.trim()).join(", "))}.</p>` : ""}
      </section>
    </div>
  </div>`;
}
