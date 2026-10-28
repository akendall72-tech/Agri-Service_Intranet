// The Location Dashboard
//
// One location at a glance for its admins and owners: the AGCO dealer metric,
// To do, the Safety Brief and Safety Reports, EPA 609, forklift cards and crane
// qualifications (each with the required operators), upcoming classes and the
// vehicles kept there.

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
  const vehicle = event.target.closest("[data-lx-fleet]");
  if (vehicle) { openFleetId = vehicle.dataset.lxFleet; fvPanel = null; showView("fleetvehicle"); }
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

// Everything the dashboard shows for one location, worked out once: the page
// draws it, and the PDF report prints it.
function lxFigures(loc) {
  const name = lxName(loc), placeKey = name.trim().toLowerCase();
  const here = (store) => String(store || "").trim().toLowerCase() === placeKey;
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

  // The vehicles kept here (0111), the most pressing first: service or
  // equipment overdue or bald tires, then coming due or worn, then the ones
  // with no service logged yet.
  const fleet = fvLoaded ? fvActive().filter(v => v.location_id === loc).map(v => {
    const due = fvDue(v);
    const gear = fvGearOn(v).map(e => ({ e, due: fvGearDue(e) })).filter(g => g.due && (g.due.level === "soon" || g.due.level === "overdue"));
    const rank = due.level === "overdue" || v.tire_condition === "replace" || gear.some(g => g.due.level === "overdue") ? 0
      : due.level === "soon" || v.tire_condition === "worn" || gear.length ? 1 : due.level === "unknown" ? 2 : 3;
    return { v, due, gear, rank, checked: fvCheckedThisWeek(v) };
  }).sort((a, b) => a.rank - b.rank || b.due.used - a.due.used
    || String(a.v.fleet_number).localeCompare(String(b.v.fleet_number), "en", { numeric: true })) : [];
  const fleetOverdue = fleet.filter(x => x.due.level === "overdue"), fleetSoon = fleet.filter(x => x.due.level === "soon");
  const gearOverdue = fleet.flatMap(x => x.gear.filter(g => g.due.level === "overdue").map(g => ({ ...g, v: x.v })));
  const tiresOut = fleet.filter(x => x.v.tire_condition === "replace"), tiresWorn = fleet.filter(x => x.v.tire_condition === "worn");
  const fleetChecked = fleet.filter(x => x.checked).length;
  const fleetYear = fvToday().slice(0, 4), fleetIds = new Set(fleet.map(x => x.v.id));
  const spent = fvServices.filter(s => fleetIds.has(s.vehicle_id) && String(s.done_on).startsWith(fleetYear) && s.cost != null)
    .reduce((total, s) => total + Number(s.cost), 0);
  const fleetTone = fleetOverdue.length || tiresOut.length || gearOverdue.length ? "red"
    : fleetSoon.length || tiresWorn.length || fleet.some(x => x.gear.length) ? "amber" : "teal";

  const todo = [
    reqNot.length && { n: reqNot.length, tone: "red", text: `required forklift ${reqNot.length === 1 ? "operator isn't" : "operators aren't"} certified`,
      items: reqNot.map(x => `${x.name} · ${x.st.label}${x.r.note ? ` · ${x.r.note}` : ""}`) },
    craneReqNot.length && { n: craneReqNot.length, tone: "red", text: `required crane ${craneReqNot.length === 1 ? "operator isn't" : "operators aren't"} qualified`,
      items: craneReqNot.map(x => `${x.name} · ${x.st.label}${x.r.note ? ` · ${x.r.note}` : ""}`) },
    plansWaiting.length && { n: plansWaiting.length, tone: "red", text: `${plansWaiting.length === 1 ? "lift plan" : "lift plans"} waiting for approval`,
      items: plansWaiting.map(p => `${p.created_by_name || "Someone"}: ${firstLine(p.job_description) || "Untitled lift"}`), go: ["rigging", "Crane Center"] },
    inspTodo.length && { n: inspTodo.length, tone: "amber", text: `${inspTodo.length === 1 ? "inspection" : "inspections"} with the after-class part to finish`,
      items: inspTodo.map(r => `${(inspForms.find(f => f.id === r.form_id) || {}).name || "Inspection"} · ${r.created_by_name || ""}`), go: ["inspection", "Inspection Center"] },
    fleetOverdue.length && { n: fleetOverdue.length, tone: "red", text: `${fleetOverdue.length === 1 ? "vehicle is" : "vehicles are"} overdue for service`,
      items: fleetOverdue.map(x => `${fvName(x.v)} · ${fvDueText(x.due, "mi")} · ${x.v.driver_name || "No driver"}`), go: ["fleet", "Fleet Center"] },
    tiresOut.length && { n: tiresOut.length, tone: "red", text: `${tiresOut.length === 1 ? "vehicle needs" : "vehicles need"} new tires`,
      items: tiresOut.map(x => `${fvName(x.v)}${x.v.tread_32nds != null ? ` · ${x.v.tread_32nds}/32"` : ""} · ${x.v.driver_name || "No driver"}`), go: ["fleet", "Fleet Center"] },
    gearOverdue.length && { n: gearOverdue.length, tone: "amber", text: `${gearOverdue.length === 1 ? "piece" : "pieces"} of equipment overdue for service`,
      items: gearOverdue.map(g => `${g.e.kind} on ${fvName(g.v)} · ${fvDueText(g.due, "hr")}`), go: ["fleet", "Fleet Center"] },
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

  return {
    name, today, short, roster, accounts, m, goal, need, shortBy, notMet, met, close, no609, metGoal, cards, fkDays,
    fk, testsDue, required, reqNot, craneRequired, craneReqNot, sKey, thisMonth, sBrief, sRows, briefPassed,
    reportSent, needsBrief, needsReport, sMissing, soon, cr, techsNoCrane, internal, classes, plansWaiting,
    inspTodo, fleet, fleetOverdue, fleetSoon, gearOverdue, tiresOut, tiresWorn, fleetChecked, fleetYear, spent,
    fleetTone, todo
  };
}

function lxPlural(n, one, many = one + "s") { return `${n} ${n === 1 ? one : many}`; }

function renderLocationOverview() {
  const box = $("lxOverview");
  if (!box) return;
  renderLocationNav();
  const loc = lxCurrent();
  if (!loc) {
    box.innerHTML = `<div class="card"><p class="note">You aren't the admin of a location yet.</p></div>`;
    return;
  }
  const { name, short, roster, accounts, m, goal, need, notMet, met, close, no609, metGoal, cards, fkDays, fk,
    testsDue, required, reqNot, craneRequired, craneReqNot, sKey, sBrief, sRows, briefPassed, reportSent, sMissing,
    soon, cr, techsNoCrane, internal, classes, fleet, fleetOverdue, fleetSoon, tiresOut, tiresWorn,
    fleetChecked, fleetYear, spent, fleetTone, todo } = lxFigures(loc);
  if (document.body.classList.contains("location-mode")) $("adminTitle").textContent = `${name} Dashboard`;
  const plural = lxPlural;
  const line = (who, sub, note, tone) => `<div class="tx-who-row tx-line"><span class="tx-who-name"><b>${esc(who)}</b>${
    sub ? `<small>${esc(sub)}</small>` : ""}</span><span class="tx-note lx-note-${tone}">${note}</span></div>`;
  const list = (rows, empty) => rows.length ? `<div class="tx-who-list">${rows.join("")}</div>` : `<p class="sx-empty">${empty}</p>`;
  const job = (r) => (r.job || "").replace(/^\d+\s*-\s*/, "");
  const noReports = !roster.length;

  box.innerHTML = `<div class="sx lx" style="${lit("slate")}">
    <div class="lx-pdfbar"><span class="msg" role="status"></span>
      <button type="button" data-lx-pdf>${icon("doc", 15)}Export PDF</button></div>
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
          : `<p class="sx-empty sx-clear">${icon("checkCircle", 18)} Nothing waiting at ${esc(name)}: no lift plans to approve, every technician has EPA 609, every required forklift operator is certified and every required crane operator qualified, no forklift card or crane qualification has run out, and no vehicle is overdue for service or needs tires.</p>`}
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
      <section class="sx-panel sx-full lx-fleet" style="${lit(fleetTone)}">
        <header><h3>Fleet</h3><span>${fleet.length ? `${plural(fleet.length, "vehicle")} · ${fleetChecked} checked this week` : ""}</span>
          <button type="button" class="sx-link" data-view="fleet">Fleet Center &rsaquo;</button></header>
        ${!fvLoaded ? `<p class="sx-empty">${fvNotSetUp ? "The Fleet Center isn't switched on yet." : fvError ? "The Fleet Center couldn't be loaded." : "Loading…"}</p>`
        : !fleet.length ? `<p class="sx-empty">No vehicles at ${esc(name)} yet. Drivers add their own in the Fleet Center, and you can add one for anyone here.</p>`
        : `<div class="sx-trio lx-fleet-stats">
            <div class="${fleetOverdue.length ? "red" : ""}"><b>${sxNum(fleetOverdue.length)}</b><span>Service overdue</span></div>
            <div class="${fleetSoon.length ? "amber" : ""}"><b>${sxNum(fleetSoon.length)}</b><span>Service soon</span></div>
            <div class="${tiresOut.length ? "red" : tiresWorn.length ? "amber" : ""}"><b>${sxNum(tiresOut.length + tiresWorn.length)}</b><span>Worn tires</span></div>
            <div class="${fleetChecked < fleet.length ? "amber" : ""}"><b>${fleetChecked}<small>/${fleet.length}</small></b><span>Checked this week</span></div>
            <div class="teal"><b>${spent >= 10000 ? `$${(spent / 1000).toFixed(1)}k` : `$${Math.round(spent).toLocaleString("en-US")}`}</b><span>Spent in ${fleetYear}</span></div>
          </div>
          <h4>Next service</h4>
          <div class="lx-fleet-list">${fleet.map(x => `<button type="button" class="lx-fleet-row" data-lx-fleet="${esc(x.v.id)}"
              aria-label="${esc(`${fvName(x.v)}: ${FV_LEVEL[x.due.level][0]}, ${fvDueText(x.due, "mi")}`)}">
            ${fvRing(x.due, 44)}
            <span class="lx-fleet-who"><b>${esc(fvName(x.v))}</b>
              <small>${esc([fvDescription(x.v) || FV_KINDS[x.v.kind], x.v.driver_name || "No driver"].join(" · "))}</small></span>
            <span class="lx-fleet-due">${fvBar(x.due, "mi")}</span>
            <span class="lx-fleet-tags">${fvTireChip(x.v)}${x.gear.map(g => `<span class="fv-tire" style="${lit(g.due.level === "overdue" ? "red" : "amber")}">${
              esc(g.e.kind)} <small>· ${esc(fvDueText(g.due, "hr").split(" · ")[0])}</small></span>`).join("")}
              ${x.checked ? `<span class="cab-tag" style="${lit("green")}">Checked</span>` : `<span class="cab-tag fv-due-tag">Check due</span>`}</span>
          </button>`).join("")}</div>
          <p class="sx-sub">Each vehicle is kept at its driver's location. The weekly check updates the miles and tires; open one for its chart and service log.</p>`}
      </section>
    </div>
  </div>`;
}

// ---- the location report, as a PDF ------------------------------------------------
//
// The dashboard on paper, for a meeting or the file: the headline figures, To
// do, the AGCO dealer metric, the Safety Brief and Reports for the month the
// dashboard is showing, EPA 609, forklift cards and crane qualifications with
// the required operators, upcoming classes, and the fleet. As on the page, a
// Safety Report is only a count. jsPDF's fonts are Latin-1, so dashes and
// quotes are made plain.
function lxReportPdf(loc) {
  const f = lxFigures(loc), month = sxMonthName(f.sKey);
  const latin = (t) => String(t ?? "").replace(/[–—]/g, "-").replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"').replace(/…/g, "...").replace(/[^\x00-\xFF]/g, "").replace(/[ \t]+\n/g, "\n").trim();
  const doc = new jspdf.jsPDF({ unit: "pt", format: "letter" });
  const W = 612, H = 792, M = 44, CW = W - M * 2, BOTTOM = H - M - 20;
  const red = [204, 0, 51], ink = [30, 30, 30], grey = [110, 110, 110], light = [246, 245, 243], rule = [226, 224, 222];
  const green = [23, 112, 47], amber = [180, 110, 10], ember = [194, 65, 12], violet = [109, 40, 217], teal = [14, 116, 120];
  const TONES = { red, amber, ember, violet, teal, slate: grey, green };
  const asOf = new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  const money = (n) => `$${Math.round(n).toLocaleString("en-US")}`;
  const job = (text) => String(text || "").replace(/^\d+\s*-\s*/, "");
  let y = 0;

  const smallHead = () => {
    doc.setFillColor(...red); doc.rect(0, 0, W, 6, "F");
    doc.setFont("helvetica", "bold"); doc.setFontSize(8); doc.setTextColor(...grey);
    doc.text(latin(`AGRI-SERVICE  -  ${f.name.toUpperCase()} LOCATION REPORT  -  ${asOf.toUpperCase()}`), M, 24);
    y = 42;
  };
  const ensure = (h, then) => { if (y + h > BOTTOM) { doc.addPage(); smallHead(); if (then) then(); } };
  // A section's heading keeps its opening lines with it, never alone at a page's foot.
  const section = (title, sub) => {
    ensure(130); y += 24;
    doc.setFont("helvetica", "bold"); doc.setFontSize(13); doc.setTextColor(...ink); doc.text(latin(title).toUpperCase(), M, y);
    doc.setFillColor(...red); doc.rect(M, y + 6, 40, 2.5, "F"); y += 22;
    if (sub) { doc.setFont("helvetica", "normal"); doc.setFontSize(9.5); doc.setTextColor(...grey);
      doc.splitTextToSize(latin(sub), CW).forEach(l => { doc.text(l, M, y); y += 12; }); y += 4; }
  };
  const subhead = (text) => {
    y += 12; ensure(44);
    doc.setFont("helvetica", "bold"); doc.setFontSize(9); doc.setTextColor(...ink); doc.text(latin(text), M, y); y += 8;
  };
  const note = (text) => {
    y += 12; doc.setFont("helvetica", "italic"); doc.setFontSize(8.8); doc.setTextColor(...grey);
    doc.splitTextToSize(latin(text), CW).forEach(l => { ensure(12); doc.text(l, M, y); y += 11.5; });
  };
  // A table: columns of [label, width, "r" for right-aligned]; rows of strings.
  // opts.color(row, i) colours a cell; opts.bold is the column set in bold.
  const table = (cols, rows, opts = {}) => {
    const xs = []; cols.reduce((x, c) => (xs.push(x), x + c[1]), M);
    const head = () => {
      doc.setFillColor(238, 236, 233); doc.rect(M, y, CW, 17, "F");
      doc.setFont("helvetica", "bold"); doc.setFontSize(7.5); doc.setTextColor(...grey);
      cols.forEach(([label, w, a], i) => doc.text(label.toUpperCase(), a ? xs[i] + w - 5 : xs[i] + 5, y + 11.5, a ? { align: "right" } : {}));
      y += 17;
    };
    if (!rows.length) {
      doc.setFont("helvetica", "italic"); doc.setFontSize(9); doc.setTextColor(...grey);
      doc.text(latin(opts.empty || "None."), M, y + 4); y += 12; return;
    }
    doc.setFontSize(8.8);
    const laid = rows.map(row => {
      const cells = row.map((v, i) => doc.splitTextToSize(latin(v), cols[i][1] - 10));
      return { row, cells, h: Math.max(...cells.map(c => c.length)) * 11 + 8 };
    });
    // The header never sits at the foot of a page without a row under it.
    ensure(17 + laid[0].h); head();
    laid.forEach(({ row, cells, h }, n) => {
      ensure(h, head);
      doc.setFontSize(8.8);
      if (n % 2) { doc.setFillColor(...light); doc.rect(M, y, CW, h, "F"); }
      cells.forEach((lines, i) => {
        const color = opts.color ? opts.color(row, i) : null;
        doc.setFont("helvetica", opts.bold === i || (color && i > 0) ? "bold" : "normal"); doc.setTextColor(...(color || ink));
        lines.forEach((l, j) => doc.text(l, cols[i][2] ? xs[i] + cols[i][1] - 5 : xs[i] + 5, y + 12 + j * 11, cols[i][2] ? { align: "right" } : {}));
      });
      doc.setDrawColor(...rule); doc.line(M, y + h, M + CW, y + h);
      y += h;
    });
  };
  // Rows that carry their own colour: [cells, colour of the status column].
  const toned = (rows) => { const tones = new Map(rows.map(([cells, tone]) => [cells, tone])); return [rows.map(r => r[0]), tones]; };

  // The band.
  doc.setFillColor(...red); doc.rect(0, 0, W, 84, "F");
  doc.setTextColor(255); doc.setFont("helvetica", "bold"); doc.setFontSize(22); doc.text("AGRI-SERVICE", M, 38);
  doc.setFontSize(10); doc.text("LOCATION REPORT", M, 56);
  doc.setFontSize(20); doc.text(latin(f.name), W - M, 40, { align: "right" });
  doc.setFont("helvetica", "normal"); doc.setFontSize(9);
  doc.text(latin(`Prepared ${asOf}${profile && profile.full_name ? ` by ${profile.full_name}` : ""}`), W - M, 58, { align: "right" });
  y = 108;
  doc.setFont("helvetica", "normal"); doc.setFontSize(10); doc.setTextColor(...grey);
  doc.text(latin(`Training, safety, certifications and vehicles at ${f.name}: ${lxPlural(f.roster.length, "person", "people")} on the UKG reports, ${lxPlural(f.accounts.length, "app account")}.`), M, y);
  y += 18;

  // The headline figures, two rows of three.
  const techs = f.m.techs.length, people = f.sRows.length, worn = f.tiresOut.length + f.tiresWorn.length;
  const boxes = [
    ["AGCO DEALER METRIC", techs ? `${Math.round(f.m.pct * 100)}%` : "-",
      techs ? `${f.m.metCount} of ${techs} technicians have ${f.need}+ hrs` : "No technicians here", !techs ? grey : f.metGoal ? green : amber],
    ["SAFETY BRIEF", f.sBrief && people ? `${f.briefPassed} of ${people}` : "-",
      f.sBrief ? `passed the ${month} brief` : `None published for ${month}`, !f.sBrief || !people ? grey : f.briefPassed === people ? green : amber],
    ["SAFETY REPORTS", srCounts && people ? `${f.reportSent} of ${people}` : "-",
      srCounts ? `sent one in ${month}` : "Counts need migration 0101", !srCounts || !people ? grey : f.reportSent === people ? green : amber],
    ["FORKLIFT CARDS", String(f.fk.certified.length + f.fk.expiring.length),
      f.reqNot.length ? `${f.reqNot.length} required not certified` : `${f.fk.expiring.length} expiring - ${f.fk.expired.length} expired`,
      f.reqNot.length || f.fk.expired.length ? red : f.fk.expiring.length ? amber : green],
    ["CRANE QUALIFIED", String(f.cr.qualified.length + f.cr.expiring.length),
      f.craneReqNot.length ? `${f.craneReqNot.length} required not qualified` : `${f.cr.expiring.length} expiring - ${f.cr.expired.length} expired`,
      f.craneReqNot.length || f.cr.expired.length ? red : f.cr.expiring.length ? amber : green],
    ["FLEET", String(f.fleet.length), f.fleet.length ? `${f.fleetOverdue.length} overdue - ${worn} worn tires` : "No vehicles yet",
      f.fleetOverdue.length || f.tiresOut.length ? red : f.fleetSoon.length || worn ? amber : f.fleet.length ? green : grey]
  ];
  const bw = (CW - 20) / 3, bh = 62;
  boxes.forEach(([label, value, sub, color], i) => {
    const bx = M + (i % 3) * (bw + 10), by = y + Math.floor(i / 3) * (bh + 10);
    doc.setFillColor(...light); doc.roundedRect(bx, by, bw, bh, 4, 4, "F");
    doc.setFillColor(...color); doc.rect(bx, by, 3, bh, "F");
    doc.setFont("helvetica", "bold"); doc.setFontSize(7.5); doc.setTextColor(...grey); doc.text(label, bx + 12, by + 15);
    doc.setFontSize(22); doc.setTextColor(...(color === grey ? ink : color)); doc.text(latin(value), bx + 12, by + 40);
    doc.setFont("helvetica", "normal"); doc.setFontSize(8.5); doc.setTextColor(...grey); doc.text(latin(sub), bx + 12, by + 53);
  });
  y += bh * 2 + 6;

  // To do.
  section("To do", f.todo.length ? `${lxPlural(f.todo.length, "thing")} to look at, as of ${asOf}.`
    : `Nothing waiting at ${f.name}: no lift plans to approve, every technician has EPA 609, every required operator holds it, no card or qualification has run out, and no vehicle is overdue for service or needs tires.`);
  if (f.todo.length) {
    const [rows, tones] = toned(f.todo.map(t => [[String(t.n), t.text[0].toUpperCase() + t.text.slice(1), t.items.join("; ")], TONES[t.tone] || ink]));
    table([["", 30, "r"], ["What", 190], ["Who", CW - 220]], rows, { color: (row, i) => i < 2 ? tones.get(row) : null });
  }

  // The AGCO dealer metric.
  section("AGCO dealer metric", techs
    ? `${f.m.metCount} of ${techs} technicians here have ${f.need} or more AGCO hours (${tsPct(f.m.pct)}). The dealer goal is ${f.goal}%, dealer-wide. Not there yet are listed first, closest first.`
    : f.roster.length ? "Nobody here has Technician in their job title." : "Nobody here is on the latest Training Status reports yet.");
  if (techs) {
    const [rows, tones] = toned([...f.notMet, ...f.met].map(t => [[t.name, job(t.job), t.hours === null ? "-" : String(t.hours),
      t.met ? "Met" : `Needs ${f.shortBy(t)}${tsPlan.has(t.key) ? " - planned" : ""}`], t.met ? green : amber]));
    table([["Technician", 170], ["Job", 190], ["AGCO hours", 70, "r"], ["Status", CW - 430]], rows,
      { bold: 0, color: (row, i) => i === 3 ? tones.get(row) : null });
  }

  // The Safety Brief and Safety Reports.
  section(`Safety Brief & Reports - ${month}`, people
    ? `${f.sBrief ? `${f.briefPassed} of ${people} passed the ${month} Safety Brief.` : `No Safety Brief was published for ${month}.`} ${
      srCounts ? `${f.reportSent} of ${people} sent at least one Safety Report.` : ""} Everyone with an app account here by the end of the month. A Safety Report shows only as a count; what it says stays with the Safety Manager.`
    : `Nobody at ${f.name} has an app account yet.`);
  if (people) {
    const briefWord = { passed: "Passed", failed: "Not passed yet", started: "Started", none: "Not taken" };
    const [rows, tones] = toned(f.sRows.map(x => [[x.name, x.brief === null ? "No brief" : briefWord[x.brief],
      x.reports === null ? "-" : x.reports ? lxPlural(x.reports, "report") : "None"],
      [x.brief === "passed" ? green : x.brief === null ? grey : x.brief === "none" ? red : amber, x.reports === null ? grey : x.reports ? green : red]]));
    table([["Name", 220], ["Safety Brief", 150], ["Safety Reports", CW - 370]], rows,
      { bold: 0, color: (row, i) => i ? tones.get(row)[i - 1] : null });
  }

  // EPA 609.
  section("EPA 609", techs ? (f.no609.length ? `${techs - f.no609.length} of ${techs} technicians have it. Still need it:`
    : "Every technician here has it.") : "No technicians here.");
  if (f.no609.length) table([["Technician", 220], ["Job", CW - 220]], f.no609.map(t => [t.name, job(t.job)]), { bold: 0 });

  // Forklift cards.
  section("Forklift cards", `${lxPlural(f.cards.length, "card")} on record for people here: ${f.fk.certified.length} current, ${f.fk.expiring.length} running out in the next 60 days, ${f.fk.expired.length} expired.`);
  if (f.required.length) {
    subhead(`Required operators - ${f.required.length - f.reqNot.length} of ${f.required.length} certified`);
    const [rows, tones] = toned(f.required.map(x => [[x.name, x.st.label, x.r.note || "-"], x.st.met ? green : x.st.tone === "warn" ? amber : red]));
    table([["Name", 170], ["Status", 160], ["Why they're required", CW - 330]], rows, { bold: 0, color: (row, i) => i === 1 ? tones.get(row) : null });
    subhead("Everyone with a card");
  }
  {
    const [rows, tones] = toned([...f.fk.expired, ...f.fk.expiring, ...f.fk.waiting, ...f.fk.removed, ...f.fk.certified].map(x => [[x.name,
      (x.r.truck_classes || []).join(", ") || "-",
      x.st[0] === "Expired" ? `Expired ${fmtDate(x.r.expiration_date)}` : x.st[1] === "b-expiring" ? `${f.fkDays(x.r)} days left`
        : x.st[1] === "b-current" ? `Until ${fmtDate(x.r.expiration_date)}` : x.st[0]],
      x.st[1] === "b-current" ? green : x.st[1] === "b-expiring" || x.st[1] === "b-pending" ? amber : red]));
    table([["Name", 200], ["Truck classes", 150], ["Status", CW - 350]], rows,
      { bold: 0, color: (row, i) => i === 2 ? tones.get(row) : null, empty: `Nobody at ${f.name} has a forklift card on record.` });
  }
  if (f.testsDue.length) note(`Passed the online course and due a driving test: ${f.testsDue.map(p => p.name).join(", ")}.`);

  // Crane qualifications.
  section("Crane qualifications", `From ${craneCourse()}: ${f.cr.qualified.length + f.cr.expiring.length} qualified (${f.cr.expiring.length} running out in the next 60 days), ${f.cr.expired.length} expired, ${f.cr.removed.length} removed.`);
  if (f.craneRequired.length) {
    subhead(`Required operators - ${f.craneRequired.length - f.craneReqNot.length} of ${f.craneRequired.length} qualified`);
    const [rows, tones] = toned(f.craneRequired.map(x => [[x.name, x.st.label, x.r.note || "-"], x.st.met ? green : x.st.tone === "warn" ? amber : red]));
    table([["Name", 170], ["Status", 160], ["Why they're required", CW - 330]], rows, { bold: 0, color: (row, i) => i === 1 ? tones.get(row) : null });
    subhead("Everyone who's taken it");
  }
  {
    const [rows, tones] = toned([...f.cr.expired, ...f.cr.removed, ...f.cr.expiring, ...f.cr.qualified].map(x => [[x.name, job(x.r.job),
      x.st.kind === "expired" ? `Expired ${f.short(x.st.expires)}` : x.st.kind === "removed" ? "Removed"
        : x.st.expires ? `Until ${f.short(x.st.expires)}` : "Qualified"],
      x.st.kind === "qualified" ? (f.soon(x.st.expires) ? amber : green) : red]));
    table([["Name", 200], ["Job", 190], ["Status", CW - 390]], rows,
      { bold: 0, color: (row, i) => i === 2 ? tones.get(row) : null, empty: `Nobody at ${f.name} has taken the course.` });
  }
  if (f.techsNoCrane.length) note(`Technicians who haven't taken it: ${f.techsNoCrane.map(r => `${r.first_name} ${r.last_name}`.trim()).join(", ")}.`);

  // Upcoming training.
  section("Upcoming training", f.classes.length ? `${lxPlural(f.classes.length, "class", "classes")} with someone from ${f.name} enrolled, from the latest Open Seat Report.`
    : f.internal ? `Nobody from ${f.name} is enrolled in an upcoming class on the latest Open Seat Report.` : "The Open Seat Report hasn't been published yet.");
  if (f.classes.length) {
    table([["Class", 190], ["When", 110], ["Where", 80], ["From here", CW - 380]], f.classes.map(({ c, who }) => [c.title,
      c.startDate ? osrRange(c.startDate, c.endDate, true) : "-", c.city || "-", who.map(p => p.name || `${p.first} ${p.last}`.trim()).join(", ")]), { bold: 0 });
  }

  // The fleet.
  section("Fleet", f.fleet.length
    ? `${lxPlural(f.fleet.length, "vehicle")} kept at ${f.name}: ${f.fleetOverdue.length} overdue for service, ${f.fleetSoon.length} due soon, ${worn} with worn tires; ${f.fleetChecked} of ${f.fleet.length} checked this week.${f.spent ? ` ${money(f.spent)} spent on service and repairs in ${f.fleetYear}.` : ""} The most pressing first.`
    : !fvLoaded ? "The Fleet Center couldn't be read." : `No vehicles at ${f.name} yet.`);
  if (f.fleet.length) {
    const levelColor = { ok: green, soon: amber, overdue: red, unknown: grey };
    const tireColor = { good: green, fair: amber, worn: ember, replace: red };
    const [rows, tones] = toned(f.fleet.map(x => [[`${fvName(x.v)}\n${fvDescription(x.v) || FV_KINDS[x.v.kind]}`, x.v.driver_name || "No driver",
      x.v.odometer != null ? `${fvMiles(x.v.odometer)} mi` : "-", `${FV_LEVEL[x.due.level][0]}\n${fvDueText(x.due, "mi")}`,
      x.v.tire_condition ? `${FV_TIRES[x.v.tire_condition].title}${x.v.tread_32nds != null ? ` - ${x.v.tread_32nds}/32"` : ""}` : "Not checked",
      x.checked ? "Checked" : "Not yet"],
      { 3: levelColor[x.due.level], 4: tireColor[x.v.tire_condition] || grey, 5: x.checked ? green : amber }]));
    table([["Vehicle", 112], ["Driver", 90], ["Odometer", 62, "r"], ["Next service", 132], ["Tires", 70], ["This week", CW - 466]], rows,
      { bold: 0, color: (row, i) => tones.get(row)[i] || null });
    const gear = f.fleet.flatMap(x => x.gear.map(g => ({ ...g, v: x.v })));
    if (gear.length) {
      subhead("Equipment coming due");
      const [gearRows, gearTones] = toned(gear.map(g => [[`${g.e.kind}${g.e.make || g.e.model ? ` - ${[g.e.make, g.e.model].filter(Boolean).join(" ")}` : ""}`,
        fvName(g.v), `${FV_LEVEL[g.due.level][0]}: ${fvDueText(g.due, "hr")}`], g.due.level === "overdue" ? red : amber]));
      table([["Equipment", 200], ["On", 90], ["Service", CW - 290]], gearRows, { bold: 0, color: (row, i) => i === 2 ? gearTones.get(row) : null });
    }
  }

  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p); doc.setDrawColor(220); doc.line(M, H - M + 2, M + CW, H - M + 2);
    doc.setFont("helvetica", "normal"); doc.setFontSize(7.5); doc.setTextColor(...grey);
    doc.text(latin(`Agri-Service, LLC  -  ${f.name} Location Report  -  ${asOf}  -  For internal use`), M, H - M + 14);
    doc.setFont("helvetica", "bold"); doc.text(`Page ${p} of ${pages}`, W - M, H - M + 14, { align: "right" });
  }
  doc.save(`${f.name} Location Report ${fvToday()}.pdf`);
}

$("admin").addEventListener("click", (event) => {
  const btn = event.target.closest("[data-lx-pdf]");
  if (!btn) return;
  const row = btn.closest(".lx-pdfbar");
  btn.disabled = true; speak(row, "Making the report…", false);
  try { lxReportPdf(lxCurrent()); speak(row, `Downloaded the ${lxName()} report.`, false); }
  catch (e) { speak(row, `Couldn't make it: ${e.message}`, true); }
  btn.disabled = false;
});
