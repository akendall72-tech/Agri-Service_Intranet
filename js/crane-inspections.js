// Daily crane inspections (migration 0119)
//
// Each location's cranes, each with a name to tell them apart, a bridge crane
// or a service truck crane, and the short function test OSHA asks for every
// day a crane is in service (the "frequent inspection", 1910.179(j)(2) and
// 1910.180(d)(3)). Everyone sees the cranes at their location and whether each
// has had today's; anyone there can inspect one and sign it off. A Problem on
// any item takes the crane out of service until it passes again, and the
// location's admins and the Safety Manager get a push. A location's admins
// add the cranes; the Safety Manager keeps the checklist, on the Safety
// dashboard. "Today" is the location's own day, in its time zone, and an
// inspection is due Monday to Friday; a crane used at the weekend can still
// be inspected then.

let ciCranes = [], ciItems = [], ciInspections = [], ciItemsError = null;
let ciLoaded = false, ciError = null, ciNotSetUp = false;
// The crane open on its page, and the crane being added or edited.
let openCraneId = null, ciDraft = null, ciShowRetired = false;
// Where an inspection was started from, for Cancel to go back to.
let ciCameFrom = "rigging";

const CI_KINDS = { bridge: "Bridge crane", truck: "Service truck crane" };
// How far back the page loads; a crane's page offers the rest.
const CI_DAYS = 35;

async function loadCraneInspections() {
  const [c, i, x] = await Promise.all([
    db.from("cranes").select("*").order("name"),
    db.from("crane_inspection_items").select("*").order("sort_order").order("label"),
    allRows(() => db.from("crane_inspections").select("*").gte("inspected_on", sinceDay(CI_DAYS))
      .order("inspected_on", { ascending: false }).order("created_at", { ascending: false }).order("id"))
  ]);
  ciItemsError = i.error ? i.error.message : null;
  ciItems = i.error ? [] : i.data || [];
  const err = c.error || x.error;
  if (err) {
    ciError = err.message || "unknown";
    ciNotSetUp = /does not exist|schema cache/i.test(ciError);
    return;
  }
  ciError = null; ciNotSetUp = false;
  ciCranes = c.data || [];
  // Older inspections someone asked for on a crane's page stay.
  const older = ciInspections.filter(r => r.inspected_on < sinceDay(CI_DAYS));
  ciInspections = (x.data || []).concat(older.filter(r => !(x.data || []).some(n => n.id === r.id)));
  ciLoaded = true;
}

// ---- days, on each location's clock ------------------------------------------------

const ciZone = (loc) => (allLocations.find(l => l.id === loc) || {}).timezone || "America/Boise";
const ciToday = (loc) => new Date().toLocaleDateString("en-CA", { timeZone: ciZone(loc) });
const ciTime = (r) => new Date(r.created_at).toLocaleTimeString("en-US",
  { hour: "numeric", minute: "2-digit", timeZone: ciZone(r.location_id) });
const ciDay = (ymd, year) => dateOnly(ymd).toLocaleDateString("en-US",
  year ? { weekday: "short", month: "short", day: "numeric", year: "numeric" } : { month: "short", day: "numeric" });
// Inspections are due on weekdays only (Andrew, 4 Nov 2026).
const ciWorkday = (ymd) => ![0, 6].includes(dateOnly(ymd).getDay());
const ciNeededToday = (crane) => ciWorkday(ciToday(crane.location_id));

// ---- what's shown ------------------------------------------------------------------------

const ciCrane = (id) => ciCranes.find(c => c.id === id);
const ciActive = () => ciCranes.filter(c => !c.retired_at);
const ciOf = (crane) => ciInspections.filter(r => r.crane_id === crane.id)
  .sort((a, b) => b.inspected_on.localeCompare(a.inspected_on) || String(b.created_at).localeCompare(String(a.created_at)));
const ciLast = (crane) => ciOf(crane)[0] || null;
// Today's latest: what decides whether it can be used today.
const ciTodays = (crane) => ciOf(crane).find(r => r.inspected_on === ciToday(crane.location_id)) || null;
// "ok" passed today, "problem" failed today, "out" not yet today and failed
// its last one, "due" not yet today, "off" not yet today and not needed: the
// weekend.
function ciState(crane) {
  const today = ciTodays(crane);
  if (today) return today.safe ? "ok" : "problem";
  const last = ciLast(crane);
  return last && !last.safe ? "out" : ciNeededToday(crane) ? "due" : "off";
}
// The items an inspection found a problem with, as worded that day.
const ciFailed = (r) => r ? (r.items || []).filter(i => ((r.answers || {})[i.id] || {}).status === "problem") : [];
// The items asked on a crane: those for its kind, or for every kind.
const ciItemsFor = (crane) => ciItems.filter(i => i.is_active && (!(i.kinds || []).length || i.kinds.includes(crane.kind)));
// Cranes at your location (and any you look after) not inspected yet on a
// weekday: the Crane Center's count, on the app's home page as here.
const ciDueHere = () => ciActive().filter(c => myLocations().includes(c.location_id) && !ciTodays(c) && ciNeededToday(c));
const ciCanKeep = (loc) => isOwner() || adminAt(loc);
// Where a new crane can go: your locations, or any for an owner.
const ciPlaces = () => isOwner() ? allLocations.filter(l => l.is_active !== false).map(l => l.id) : myLocations();

const CI_STATE = {
  ok: ["Inspected", "green"], problem: ["Out of service", "red"], out: ["Out of service", "red"], due: ["Due today", "amber"],
  off: ["Not due today", "slate"]
};

// "Inspected by Dana Price at 7:42 AM", "Failed today: Upper limit switch".
function ciStatusLine(crane) {
  const state = ciState(crane), today = ciTodays(crane), last = ciLast(crane);
  if (state === "ok") return `Inspected by ${today.created_by_name || "someone"} at ${ciTime(today)}`;
  if (state === "problem") return `Failed today: ${ciFailed(today).map(i => i.label).join(", ") || "a problem was found"} · ${
    today.created_by_name || "someone"}, ${ciTime(today)}`;
  if (state === "out") return `Not inspected today. Failed on ${ciDay(last.inspected_on)}: ${
    ciFailed(last).map(i => i.label).join(", ") || "a problem was found"}`;
  if (state === "off") return `Not due at the weekend: inspect it first if it's used.${last ? ` Last passed ${ciDay(last.inspected_on)}.` : ""}`;
  return last ? `Not inspected today. Last passed ${ciDay(last.inspected_on)}.` : "Not inspected yet.";
}

function ciTag(crane) {
  const [label, accent] = CI_STATE[ciState(crane)];
  return crane.retired_at ? `<span class="cab-tag">Retired</span>`
    : ["ok", "off"].includes(ciState(crane)) ? `<span class="cab-tag" style="${lit(accent)}">${label}</span>`
    : `<span class="cab-tag ci-tag-${ciState(crane) === "due" ? "due" : "out"}">${label}</span>`;
}

// ---- the Crane Center's section ------------------------------------------------------

function ciSectionHtml() {
  if (ciNotSetUp) return "";
  if (ciError) return `<div class="cm fv ci" id="ciSection"><h2 class="group-title">Daily crane inspections</h2>
    <p class="cm-none">The cranes couldn't be loaded. Try again in a minute.</p></div>`;
  if (!ciLoaded) return `<div class="cm fv ci" id="ciSection"></div>`;
  const shown = ciActive();
  const keepsAny = ciPlaces().some(ciCanKeep);
  if (!shown.length && !keepsAny) return `<div class="cm fv ci" id="ciSection"></div>`;
  const mine = shown.filter(c => myLocations().includes(c.location_id));
  const done = mine.filter(c => ciTodays(c)).length, weekday = mine.some(ciNeededToday);
  // At each location, the ones out of service first, then those still to do.
  const rank = { problem: 0, out: 0, due: 1, off: 2, ok: 2 };
  const byLocation = {};
  shown.slice().sort((a, b) => rank[ciState(a)] - rank[ciState(b)] || a.name.localeCompare(b.name))
    .forEach(c => { (byLocation[c.location_id] = byLocation[c.location_id] || []).push(c); });
  // Your own location first, then the rest by name.
  const order = Object.keys(byLocation).sort((a, b) => (myLocations().indexOf(a) + 1 || 99) - (myLocations().indexOf(b) + 1 || 99)
    || (locations[a] || "~").localeCompare(locations[b] || "~"));
  const retired = ciCranes.filter(c => c.retired_at && ciCanKeep(c.location_id));
  return `<div class="cm fv ci" id="ciSection">
    <h2 class="group-title">Daily crane inspections${mine.length ? ` <span class="ci-count">${weekday ? `${done} of ${mine.length} done today`
      : "None due at the weekend"}</span>` : ""}</h2>
    <p class="cm-none">Inspect each crane before its first use of the day, Monday to Friday: a short function test with no load. Anyone at the location can sign it off.</p>
    ${shown.length ? order.map(loc => `${order.length > 1 ? `<h3 class="ci-place">${esc(locations[loc] || loc)}</h3>` : ""}
      ${byLocation[loc].map(ciCardHtml).join("")}`).join("")
      : `<div class="cm-card cm-empty"><b>No cranes yet</b><p>Add each crane at ${esc(myLocationNames().join(" and ") || "your location")},
          with a name everyone will recognise, and it goes on the daily list for everyone there.</p></div>`}
    ${keepsAny ? `<div class="fv-actions"><button type="button" class="fv-go quiet" data-ci-add>${icon("plus", 17)}Add a crane</button></div>` : ""}
    ${retired.length ? `<button type="button" class="fv-retired-toggle" data-ci-retired aria-expanded="${ciShowRetired}">
        Retired · ${retired.length} ${ciShowRetired ? "▾" : "▸"}</button>
      ${ciShowRetired ? retired.map(ciCardHtml).join("") : ""}` : ""}
  </div>`;
}

function ciCardHtml(crane) {
  const state = ciState(crane);
  return `<div class="cm-card ci-card${state === "problem" || state === "out" ? " alert" : ""}${crane.retired_at ? " retired" : ""}">
    <span class="fv-card-top">
      <span class="fv-glyph">${icon("rigging", 22)}</span>
      <span class="fv-who"><b>${esc(crane.name)} ${ciTag(crane)}</b>
        <span>${esc([CI_KINDS[crane.kind], crane.capacity].filter(Boolean).join(" · "))}</span>
        ${crane.retired_at ? "" : `<small class="ci-line ${state}">${esc(ciStatusLine(crane))}</small>`}</span>
    </span>
    <span class="fv-actions ci-actions">
      ${crane.retired_at ? "" : `<button type="button" class="fv-go${["ok", "off"].includes(state) ? " quiet" : ""}" data-ci-inspect="${esc(crane.id)}">${
        icon("checkCircle", 17)}${state === "ok" ? "Inspect again" : "Inspect"}</button>`}
      <button type="button" class="fv-go quiet" data-ci-open="${esc(crane.id)}">${icon("clock", 17)}History</button>
    </span>
  </div>`;
}

function ciRedraw() {
  if ($("view").classList.contains("hidden")) return;
  if (viewShown === "rigging" && $("ciSection")) $("ciSection").outerHTML = ciSectionHtml();
  if (viewShown === "crane" && $("ciCrane")) $("ciCrane").innerHTML = ciCraneHtml();
}

// ---- a crane's page ----------------------------------------------------------------------

function craneView() {
  const crane = ciCrane(openCraneId);
  if (!crane) return hero("Crane Center") + `<div class="cm"><div class="cm-card cm-empty"><b>That crane isn't here</b>
    <p>It may have been deleted, or it's at a location you don't see.</p></div></div>`;
  return hero(crane.name, [CI_KINDS[crane.kind], locations[crane.location_id]].filter(Boolean).join(" · "))
    + `<div class="cm fv ci" id="ciCrane">${ciCraneHtml()}</div>`;
}

function ciCraneHtml() {
  const crane = ciCrane(openCraneId);
  if (!crane) return "";
  const state = ciState(crane), keeps = ciCanKeep(crane.location_id), history = ciOf(crane);
  const showing = state === "problem" ? ciTodays(crane) : state === "out" ? ciLast(crane) : null;
  return `<div class="cm-card fv-head${state === "problem" || state === "out" ? " alert" : ""}">
      <p class="cm-eyebrow">${icon("rigging", 15)}${esc([CI_KINDS[crane.kind], crane.capacity, locations[crane.location_id]].filter(Boolean).join(" · "))}</p>
      <div class="ci-big"><b>${esc(crane.retired_at ? "Retired" : CI_STATE[state][0])}</b></div>
      ${crane.retired_at ? `<p class="fv-note">Retired ${esc(new Date(crane.retired_at).toLocaleDateString())}: off the daily list, its inspections kept.</p>`
        : `<p class="ci-line ${state}">${esc(ciStatusLine(crane))}</p>
      ${showing ? `<ul class="fv-answers">${ciFailed(showing).map(i => `<li class="bad">${icon("warning", 15)}<span><b>${esc(i.label)}</b>${
        ((showing.answers || {})[i.id] || {}).note ? `<small>${esc(showing.answers[i.id].note)}</small>` : ""}</span></li>`).join("")}</ul>
        <p class="fv-warn">${icon("warning", 15)}Don't use it until it's fixed and passes an inspection.</p>` : ""}
      <div class="fv-actions">
        <button type="button" class="fv-go${["ok", "off"].includes(state) ? " quiet" : ""}" data-ci-inspect="${esc(crane.id)}">${icon("checkCircle", 17)}${
          state === "ok" ? "Inspect again" : "Inspect now"}</button>
        ${keeps ? `<button type="button" class="fv-go quiet" data-ci-edit="${esc(crane.id)}">${icon("pencil", 17)}Edit</button>` : ""}
      </div>`}
    </div>
    <p class="fv-msg" role="alert"></p>
    <h2 class="group-title">The last 30 days</h2>
    <div class="cm-card">${ciStripHtml(crane)}</div>
    <h2 class="group-title">Inspections${history.length ? ` <span class="cm-n">${history.length}</span>` : ""}</h2>
    <div class="cm-card ci-log">${history.length ? history.map(r => ciLogRowHtml(r, keeps)).join("")
      : `<p class="fv-note">No inspections${ciOlderDone.has(crane.id) ? " yet" : ` in the last ${CI_DAYS} days`}.</p>`}</div>
    ${ciOlderDone.has(crane.id) ? "" : showOlderHtml("crane", "Show older inspections", `Showing the last ${CI_DAYS} days.`)}
    ${crane.notes ? `<div class="cm-card fv-details"><p>${esc(crane.notes)}</p></div>` : ""}
    ${keeps ? `<div class="fv-foot">
      ${crane.retired_at ? `<button type="button" class="fv-quiet" data-ci-act="restore">Bring it back</button>`
        : `<button type="button" class="fv-quiet" data-ci-act="retire">Retire it</button>`}
      <button type="button" class="fv-quiet danger" data-ci-act="delete">Delete it</button>
    </div>` : ""}`;
}

// A square for each of the last 30 days, oldest first: passed, failed, not
// inspected, or a weekend it wasn't needed.
function ciStripHtml(crane) {
  const today = dateOnly(ciToday(crane.location_id)), days = [];
  let weekdays = 0, passed = 0;
  for (let back = 29; back >= 0; back--) {
    const d = new Date(today); d.setDate(d.getDate() - back);
    const ymd = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
    const that = ciOf(crane).filter(r => r.inspected_on === ymd), workday = ciWorkday(ymd);
    const state = that.length ? (that[0].safe ? "ok" : "problem") : workday ? "none" : "off";
    if (workday) { weekdays++; if (state === "ok") passed++; }
    days.push(`<i class="${state}" title="${esc(`${ciDay(ymd, true)}: ${state === "none" ? "not inspected" : state === "off" ? "weekend"
      : state === "ok" ? `passed, ${that[0].created_by_name || ""}` : `failed, ${that[0].created_by_name || ""}`}`)}"></i>`);
  }
  return `<div class="ci-strip" role="img" aria-label="Passed on ${passed} of the last ${weekdays} weekdays">${days.join("")}</div>
    <p class="fv-note ci-key"><i class="ok"></i> Passed <i class="problem"></i> Failed <i class="none"></i> Not inspected <i class="off"></i> Weekend · passed on ${passed} of ${weekdays} weekdays</p>`;
}

function ciLogRowHtml(r, keeps) {
  const failed = ciFailed(r);
  return `<div class="ci-log-row${r.safe ? "" : " bad"}">
    <span class="ci-log-mark">${icon(r.safe ? "checkCircle" : "warning", 16)}</span>
    <span class="ci-log-main"><b>${esc(ciDay(r.inspected_on, true))} · ${esc(ciTime(r))}</b>
      <small>${esc(r.created_by_name || "Someone")} · ${r.safe ? `all ${(r.items || []).length} items OK` : `${failed.length} failed`}</small>
      ${failed.map(i => `<em>${esc(i.label)}${((r.answers || {})[i.id] || {}).note ? `: ${esc(r.answers[i.id].note)}` : ""}</em>`).join("")}
      ${r.notes ? `<small>${esc(r.notes)}</small>` : ""}</span>
    ${keeps ? `<button type="button" class="fv-quiet danger ci-del" data-ci-del="${esc(r.id)}" title="Delete an inspection entered by mistake">Delete</button>` : ""}
  </div>`;
}

// Older inspections for the crane that's open, all of them at once: one a day
// is a few hundred a year.
const ciOlderDone = new Set();
olderLoaders.crane = async () => {
  const crane = ciCrane(openCraneId);
  if (!crane) return;
  const { data, error } = await allRows(() => db.from("crane_inspections").select("*").eq("crane_id", crane.id)
    .lt("inspected_on", sinceDay(CI_DAYS)).order("inspected_on", { ascending: false }).order("id"));
  if (!error) {
    ciInspections = ciInspections.concat((data || []).filter(r => !ciInspections.some(x => x.id === r.id)));
    ciOlderDone.add(crane.id);
  }
  ciRedraw();
};

// ---- inspecting one ------------------------------------------------------------------------

function craneInspectView() {
  const crane = ciCrane(openCraneId);
  if (!crane) return hero("Crane Center") + `<div class="cm"><div class="cm-card cm-empty"><b>That crane isn't here</b></div></div>`;
  const items = ciItemsFor(crane), today = ciToday(crane.location_id);
  return hero(`Inspect ${crane.name}`, [CI_KINDS[crane.kind], crane.capacity, locations[crane.location_id]].filter(Boolean).join(" · "))
    + `<div class="card fv-panel ci-form" id="ciForm">
      <h2>Daily inspection</h2>
      <p class="note">Before the crane's first use today, with no load on the hook. If anything doesn't work right, mark it
        <b>Problem</b> and say what's wrong: the crane is tagged out of service until it passes, and the location's admins and the
        Safety Manager are told.</p>
      ${items.length ? `<div class="fv-items">${items.map(i => `<div class="fv-item ci-item" data-ci-item="${esc(i.id)}">
          <span class="fv-item-text"><b>${esc(i.label)}</b>${i.detail ? `<small>${esc(i.detail)}</small>` : ""}</span>
          <span class="fv-item-pick" role="radiogroup" aria-label="${esc(i.label)}">
            <label><input type="radio" name="cii-${esc(i.id)}" value="ok"> OK</label>
            <label class="bad"><input type="radio" name="cii-${esc(i.id)}" value="problem"> Problem</label>
          </span>
          <input class="fv-item-note ci-item-note" data-ci-note="${esc(i.id)}" maxlength="300" placeholder="What's wrong?" aria-label="What's wrong with ${esc(i.label)}">
        </div>`).join("")}</div>`
        : `<p class="note">The Safety Manager hasn't set any items for ${esc(CI_KINDS[crane.kind].toLowerCase())}s. Look the crane over and sign it off.</p>`}
      <label for="ciNotes">Anything else?</label>
      <textarea id="ciNotes" rows="2" maxlength="1000" placeholder="A noise, a worn pendant label, anything to keep an eye on"></textarea>
      <p class="ci-sign">Signed off by <b>${esc((profile && profile.full_name) || (me && me.email) || "you")}</b>, ${esc(ciDay(today, true))}</p>
      <div class="row"><button type="button" id="ciSign" data-ci-act="sign">Sign off: safe to use</button>
        <button type="button" class="ghost" data-ci-act="cancel">Cancel</button></div>
      <p class="msg"></p>
    </div>`;
}

// The button says what signing off will do.
function ciSignLabel() {
  const button = $("ciSign");
  if (!button) return;
  const problem = !!document.querySelector('#ciForm input[value="problem"]:checked');
  button.textContent = problem ? "Sign off: tag it out of service" : "Sign off: safe to use";
  button.classList.toggle("danger", problem);
}

async function ciSign(button) {
  const crane = ciCrane(openCraneId), box = $("ciForm");
  if (!crane) return;
  const answers = {}, missing = [], unexplained = [];
  ciItemsFor(crane).forEach(i => {
    const picked = box.querySelector(`input[name="cii-${CSS.escape(i.id)}"]:checked`);
    if (!picked) return missing.push(i.label);
    const note = (box.querySelector(`[data-ci-note="${CSS.escape(i.id)}"]`) || {}).value || "";
    if (picked.value === "problem" && !note.trim()) unexplained.push(i.label);
    answers[i.id] = { status: picked.value, note: picked.value === "problem" ? note.trim() : "" };
  });
  if (missing.length) return speak(box, `Answer every item: ${missing.join(", ")}.`, true);
  if (unexplained.length) return speak(box, `Say what's wrong with ${unexplained.join(", ")}.`, true);
  button.disabled = true;
  const { data, error } = await db.from("crane_inspections").insert({ crane_id: crane.id, answers, notes: $("ciNotes").value.trim() })
    .select("id, safe").single();
  button.disabled = false;
  if (error) return speak(box, error.message.includes("row-level") ? "You can inspect the cranes at your own location." : error.message, true);
  if (!data.safe) notify("crane_inspection", data.id);
  await loadCraneInspections();
  showView("crane");
  ciSay(data.safe ? "Signed off. It's good to use today."
    : "Signed off and tagged out. The location's admins and the Safety Manager have been told.", !data.safe);
}

// ---- adding or editing a crane ---------------------------------------------------------------

function craneFormView() {
  if (!ciDraft) ciDraft = { id: null, name: "", kind: "bridge", location_id: ciPlaces()[0] || "", capacity: "", notes: "" };
  const d = ciDraft, places = ciPlaces();
  return hero(d.id ? `Edit ${d.name}` : "Add a Crane",
      d.id ? "" : "It goes on the daily inspection list for everyone at its location.")
    + `<div class="card fv-form ci-form" id="ciCraneForm">
      <div class="fields">
        <div class="wide"><label for="cifName">Name (required)</label><input id="cifName" maxlength="60" value="${esc(d.name)}"
          placeholder="${d.kind === "truck" ? "Fleet #214 crane" : "Shop bridge crane"}" autocomplete="off"></div>
        <div><label for="cifKind">Kind</label><select id="cifKind">${Object.entries(CI_KINDS).map(([k, t]) =>
          `<option value="${k}"${d.kind === k ? " selected" : ""}>${t}</option>`).join("")}</select></div>
        <div><label for="cifCapacity">Rated capacity (optional)</label><input id="cifCapacity" maxlength="40" value="${esc(d.capacity)}"
          placeholder="${d.kind === "truck" ? "6,000 lb" : "2 ton"}"></div>
        ${places.length > 1 ? `<div><label for="cifLocation">Location</label><select id="cifLocation">${places.map(id =>
          `<option value="${esc(id)}"${d.location_id === id ? " selected" : ""}>${esc(locations[id] || id)}</option>`).join("")}</select></div>` : ""}
        <div class="wide"><label for="cifNotes">Notes (optional)</label><textarea id="cifNotes" rows="2" maxlength="1000"
          placeholder="Where it is, which truck it's on, the serial number">${esc(d.notes)}</textarea></div>
      </div>
      <p class="note">A name everyone will recognise: no two cranes in service at a location can share one. The inspection asked
        depends on the kind.</p>
      <div class="row"><button type="button" data-ci-act="save-crane">${d.id ? "Save" : "Add the crane"}</button>
        <button type="button" class="ghost" data-ci-act="cancel-form">Cancel</button></div>
      <p class="msg"></p>
    </div>`;
}

async function ciSaveCrane(button) {
  const box = $("ciCraneForm"), d = ciDraft;
  const row = { name: $("cifName").value.trim(), kind: $("cifKind").value, capacity: $("cifCapacity").value.trim(),
    notes: $("cifNotes").value.trim(), location_id: $("cifLocation") ? $("cifLocation").value : d.location_id };
  if (!row.name) return speak(box, "Give the crane a name, so everyone knows which one it is.", true);
  if (!row.location_id) return speak(box, "Pick its location.", true);
  button.disabled = true;
  const { data, error } = d.id
    ? await db.from("cranes").update(row).eq("id", d.id).select("id").single()
    : await db.from("cranes").insert(row).select("id").single();
  button.disabled = false;
  if (error) {
    return speak(box, error.code === "23505" ? `${locations[row.location_id] || "That location"} already has a crane called that.`
      : error.message.includes("row-level") ? "Only the location's admins can add or change its cranes." : error.message, true);
  }
  await loadCraneInspections();
  ciDraft = null;
  openCraneId = data.id;
  showView("crane");
}

// ---- wiring --------------------------------------------------------------------------------

// Under the form, or at the foot of the crane's page.
function ciSay(text, bad = true) {
  const where = document.querySelector("#ciForm .msg") || document.querySelector("#ciCraneForm .msg") || document.querySelector("#ciCrane .fv-msg");
  if (where) { where.textContent = text; where.className = where.className.replace(/ ?(error|ok)/g, "") + (bad ? " error" : " ok"); }
  else if (bad) alert(text);
}

$("view").addEventListener("change", (event) => {
  if (event.target.closest("#ciForm") && event.target.type === "radio") ciSignLabel();
  if (event.target.id === "cifKind" && ciDraft) {
    ciDraft.name = $("cifName").value; ciDraft.capacity = $("cifCapacity").value; ciDraft.notes = $("cifNotes").value;
    if ($("cifLocation")) ciDraft.location_id = $("cifLocation").value;
    ciDraft.kind = event.target.value;
    showView("craneform");
  }
});

$("view").addEventListener("click", async (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  if (button.dataset.ciInspect) { ciCameFrom = viewShown; openCraneId = button.dataset.ciInspect; return showView("craneinspect"); }
  if (button.dataset.ciOpen) { openCraneId = button.dataset.ciOpen; return showView("crane"); }
  if (button.hasAttribute("data-ci-add")) { ciDraft = null; return showView("craneform"); }
  if (button.hasAttribute("data-ci-retired")) { ciShowRetired = !ciShowRetired; return ciRedraw(); }
  if (button.dataset.ciEdit) {
    const c = ciCrane(button.dataset.ciEdit);
    ciDraft = { id: c.id, name: c.name, kind: c.kind, location_id: c.location_id, capacity: c.capacity || "", notes: c.notes || "" };
    return showView("craneform");
  }
  if (button.dataset.ciDel) {
    if (!confirm("Delete this inspection? Only for one entered by mistake: it comes off the crane's record for good.")) return;
    const { data, error } = await db.from("crane_inspections").delete().eq("id", button.dataset.ciDel).select("id");
    if (error || !(data || []).length) return ciSay(error ? error.message : "Not deleted: only the location's admins can.");
    ciInspections = ciInspections.filter(r => r.id !== button.dataset.ciDel);
    return ciRedraw();
  }
  const act = button.dataset.ciAct;
  if (!act) return;
  if (act === "sign") return ciSign(button);
  if (act === "cancel") return showView(ciCameFrom === "crane" ? "crane" : "rigging");
  if (act === "save-crane") return ciSaveCrane(button);
  if (act === "cancel-form") { const back = ciDraft && ciDraft.id; ciDraft = null; return showView(back ? "crane" : "rigging"); }
  const crane = ciCrane(openCraneId);
  if (!crane) return;
  if (act === "retire" || act === "restore") {
    if (act === "retire" && !confirm(`Retire ${crane.name}? It comes off the daily list; its inspections are kept, and you can bring it back.`)) return;
    const { error } = await db.from("cranes").update({ retired_at: act === "retire" ? new Date().toISOString() : null }).eq("id", crane.id);
    if (error) return ciSay(error.code === "23505" ? "Another crane in service there has that name now. Rename one first." : error.message);
    await loadCraneInspections();
    return ciRedraw();
  }
  if (act === "delete") {
    if (!confirm(`Delete ${crane.name} and every inspection of it? To keep its record, retire it instead.`)) return;
    const { data, error } = await db.from("cranes").delete().eq("id", crane.id).select("id");
    if (error || !(data || []).length) return ciSay(error ? error.message : "Not deleted: only the location's admins can.");
    await loadCraneInspections();
    return showView("rigging");
  }
});

// ---- the Safety dashboard: the daily inspection's checklist ------------------------------------
//
// The items every daily inspection asks, each answered OK or Problem. The
// Safety Manager keeps them here; an item can be for bridge cranes, truck
// cranes, or both (none ticked). Rewording or deleting one never changes an
// inspection already signed off: each keeps the items as worded that day.

function renderCraneInspectionAdmin() {
  const box = $("craneInspectionAdmin");
  if (!box) return;
  if (ciItemsError) {
    box.innerHTML = `<div class="card"><p class="error">${/does not exist|schema cache/i.test(ciItemsError)
      ? "Run migration 0119_daily_crane_inspections.sql in the SQL editor, then reload this page." : esc(ciItemsError)}</p></div>`;
    return;
  }
  const kinds = (i) => Object.entries(CI_KINDS).map(([k, t]) => `<label class="fva-kind"><input type="checkbox" data-cia-kind="${k}"${
    (i.kinds || []).includes(k) ? " checked" : ""}> ${t}s</label>`).join("");
  const count = (kind) => ciItems.filter(i => i.is_active && (!(i.kinds || []).length || i.kinds.includes(kind))).length;
  box.innerHTML = `<div class="card">
    <h2>Daily crane inspection</h2>
    <p class="note">The short function test done on every crane before its first use each day, in the Crane Center on the app and
      this page. Each item is answered <b>OK</b> or <b>Problem</b>; a Problem tags the crane out of service until it passes again,
      and the location's admins and you get a push. Tick the kinds of crane an item is for, or none for both. Changes reach the app
      and this page straight away.</p>
    <p class="note">Right now a bridge crane is asked <b>${count("bridge")}</b> items and a service truck crane <b>${count("truck")}</b>. OSHA's
      daily items: the controls, air and hydraulic leaks, the hook, the hoist rope or chain, the safety devices, and the upper limit
      switch tried with no load (1910.179(j)(2) and (n)(4), 1910.180(d)(3)). Keep it short: it's done every day.</p>
    <p class="note"><b>Showing: No</b> takes an item off the inspection and can be switched back. Rewording or deleting one never
      changes an inspection already signed off.</p>
    ${ciItems.length ? ciItems.map((i, n) => `<div class="role${i.is_active ? "" : " off"}" style="padding:16px${i.is_active ? "" : ";opacity:.6"}" data-cia-item="${esc(i.id)}">
      <div class="fields">
        <div class="wide"><label>Item</label><input type="text" data-cia="label" maxlength="80" value="${esc(i.label)}"></div>
        <div class="wide"><label>How to check it (optional, shown under it)</label><input type="text" data-cia="detail" maxlength="200" value="${esc(i.detail || "")}"></div>
        <div class="wide"><label>For</label><div class="fva-kinds">${kinds(i)}</div></div>
        <div><label>Showing</label><select data-cia="is_active">
          <option value="yes"${i.is_active ? " selected" : ""}>Yes</option><option value="no"${i.is_active ? "" : " selected"}>No</option></select></div>
      </div>
      <div class="row">
        <button data-cia-act="save">Save</button>
        <button class="ghost" data-cia-act="up"${n === 0 ? " disabled" : ""} aria-label="Move up">&uarr;</button>
        <button class="ghost" data-cia-act="down"${n === ciItems.length - 1 ? " disabled" : ""} aria-label="Move down">&darr;</button>
        <button class="ghost" data-cia-act="delete">Delete</button>
        <span class="msg"></span>
      </div>
    </div>`).join("") : `<p class="note">No items yet: an inspection is a sign-off and nothing more.</p>`}
    <div class="row" style="margin-top:10px"><button data-cia-act="add">Add an item</button><span class="msg" id="ciaMsg"></span></div>
  </div>`;
}

async function ciaReload() {
  const { data, error } = await db.from("crane_inspection_items").select("*").order("sort_order").order("label");
  if (!error) ciItems = data || [];
  renderCraneInspectionAdmin();
}

$("admin").addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-cia-act]");
  if (!button) return;
  const act = button.dataset.ciaAct;
  const refused = "Only the Safety Manager can change the crane inspection.";
  if (act === "add") {
    const { error } = await db.from("crane_inspection_items").insert({ label: "New item", is_active: false,
      sort_order: (Math.max(0, ...ciItems.map(i => i.sort_order || 0)) + 10) });
    if (error) return speak(button.closest(".row"), error.message.includes("row-level") ? refused : error.message, true);
    await ciaReload();
    return speak($("ciaMsg").closest(".row"), "Added, not showing yet. Word it, set Showing to Yes, and save.", false);
  }
  const box = button.closest("[data-cia-item]"), id = box.dataset.ciaItem, item = ciItems.find(i => i.id === id);
  if (act === "delete") {
    if (!confirm(`Delete "${item.label}" from the daily inspection? Inspections already signed off keep it. "Showing: No" can be undone; this can't.`)) return;
    const { data, error } = await db.from("crane_inspection_items").delete().eq("id", id).select("id");
    if (error || !(data || []).length) return speak(box, error ? error.message : `Not deleted. ${refused}`, true);
    return ciaReload();
  }
  if (act === "up" || act === "down") {
    const at = ciItems.findIndex(i => i.id === id), other = ciItems[act === "up" ? at - 1 : at + 1];
    if (!other) return;
    // Spaced out first, so two items never share a place.
    const order = ciItems.map((i, n) => ({ id: i.id, sort_order: (n + 1) * 10 }));
    const a = order[at], b = order[act === "up" ? at - 1 : at + 1];
    [a.sort_order, b.sort_order] = [b.sort_order, a.sort_order];
    for (const row of order) {
      if (ciItems.find(i => i.id === row.id).sort_order === row.sort_order) continue;
      const { error } = await db.from("crane_inspection_items").update({ sort_order: row.sort_order }).eq("id", row.id);
      if (error) return speak(box, error.message, true);
    }
    return ciaReload();
  }
  const label = box.querySelector('[data-cia="label"]').value.trim();
  if (!label) return speak(box, "An item needs some words.", true);
  speak(box, "Saving…", false);
  const { data, error } = await db.from("crane_inspection_items").update({
    label, detail: box.querySelector('[data-cia="detail"]').value.trim(),
    kinds: [...box.querySelectorAll("[data-cia-kind]:checked")].map(c => c.dataset.ciaKind),
    is_active: box.querySelector('[data-cia="is_active"]').value === "yes"
  }).eq("id", id).select("id");
  if (error) return speak(box, error.message, true);
  if (!(data || []).length) return speak(box, `Not saved. ${refused}`, true);
  await ciaReload();
  speak(document.querySelector(`[data-cia-item="${CSS.escape(id)}"]`), "Saved.", false);
});
