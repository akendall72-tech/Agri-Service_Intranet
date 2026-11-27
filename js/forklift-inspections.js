// Daily forklift inspections (migration 0171)
//
// The Forklift Center's version of the Crane Center's daily crane inspections
// (crane-inspections.js): each location's forklifts, each with a name to tell
// them apart and its OSHA class, and the check OSHA asks for before a forklift
// is used each day (1910.178(q)(7)). Everyone sees the forklifts at their
// location and whether each has had today's; anyone there can inspect one and
// sign it off, and then it's done for everyone. A Problem on any item takes
// the forklift out of service until it passes again, and the location's admins
// and the Safety Manager get a push. A location's admins add the forklifts; the
// Safety Manager keeps the checklist, on the Safety dashboard, each item for
// some classes or all. "Today" is the location's own day, and an inspection is
// due Monday to Friday, as for cranes; the day helpers are the cranes' own.

let fiForklifts = [], fiItems = [], fiInspections = [], fiItemsError = null;
let fiLoaded = false, fiError = null, fiNotSetUp = false;
// The forklift open on its page, and the forklift being added or edited.
let openForkliftId = null, fiDraft = null, fiShowRetired = false;
// Where an inspection was started from, for Cancel to go back to.
let fiCameFrom = "forklift";

// OSHA's classes, as forklift certifications name them, and what each looks like.
const FI_CLASSES = {
  I: ["Class I", "Electric rider", "sit-down or stand-up, counterbalanced"],
  II: ["Class II", "Electric narrow aisle", "reach truck, order picker"],
  III: ["Class III", "Electric hand truck", "pallet jack, walkie stacker"],
  IV: ["Class IV", "Engine, cushion tires", "indoors, solid tires"],
  V: ["Class V", "Engine, pneumatic tires", "the yard, air tires"],
  VI: ["Class VI", "Tow tractor", "a tug"],
  VII: ["Class VII", "Rough terrain", "telehandler, rough-terrain forklift"]
};
// "Class V · Engine, pneumatic tires"
const fiClass = (c) => FI_CLASSES[c] ? `${FI_CLASSES[c][0]} · ${FI_CLASSES[c][1]}` : "";
// How far back the page loads; a forklift's page offers the rest.
const FI_DAYS = 35;

async function loadForkliftInspections() {
  const [f, i, x] = await Promise.all([
    db.from("forklifts").select("*").order("name"),
    db.from("forklift_inspection_items").select("*").order("sort_order").order("label"),
    allRows(() => db.from("forklift_inspections").select("*").gte("inspected_on", sinceDay(FI_DAYS))
      .order("inspected_on", { ascending: false }).order("created_at", { ascending: false }).order("id"))
  ]);
  fiItemsError = i.error ? i.error.message : null;
  fiItems = i.error ? [] : i.data || [];
  const err = f.error || x.error;
  if (err) {
    fiError = err.message || "unknown";
    fiNotSetUp = /does not exist|schema cache/i.test(fiError);
    return;
  }
  fiError = null; fiNotSetUp = false;
  fiForklifts = f.data || [];
  // Older inspections someone asked for on a forklift's page stay.
  const older = fiInspections.filter(r => r.inspected_on < sinceDay(FI_DAYS));
  fiInspections = (x.data || []).concat(older.filter(r => !(x.data || []).some(n => n.id === r.id)));
  fiLoaded = true;
}

// ---- what's shown ------------------------------------------------------------------------
//
// Days are the cranes': ciToday, ciTime, ciDay and ciWorkday, in
// crane-inspections.js, which loads first.

const fiNeededToday = (lift) => ciWorkday(ciToday(lift.location_id));
const fiForklift = (id) => fiForklifts.find(f => f.id === id);
const fiActive = () => fiForklifts.filter(f => !f.retired_at);
const fiOf = (lift) => fiInspections.filter(r => r.forklift_id === lift.id)
  .sort((a, b) => b.inspected_on.localeCompare(a.inspected_on) || String(b.created_at).localeCompare(String(a.created_at)));
const fiLast = (lift) => fiOf(lift)[0] || null;
// Today's latest: what decides whether it can be used today.
const fiTodays = (lift) => fiOf(lift).find(r => r.inspected_on === ciToday(lift.location_id)) || null;
// "ok" passed today, "problem" failed today, "out" not yet today and failed
// its last one, "due" not yet today, "off" not yet today and not needed: the
// weekend.
function fiState(lift) {
  const today = fiTodays(lift);
  if (today) return today.safe ? "ok" : "problem";
  const last = fiLast(lift);
  return last && !last.safe ? "out" : fiNeededToday(lift) ? "due" : "off";
}
// The items an inspection found a problem with, as worded that day.
const fiFailed = (r) => r ? (r.items || []).filter(i => ((r.answers || {})[i.id] || {}).status === "problem") : [];
// The items asked on a forklift: those for its class, or for every class.
const fiItemsFor = (lift) => fiItems.filter(i => i.is_active && (!(i.classes || []).length || i.classes.includes(lift.truck_class)));
// Forklifts at your location (and any you look after) not inspected yet on a
// weekday: the Forklift Center's count, on the app's home page as here.
const fiDueHere = () => fiActive().filter(f => myLocations().includes(f.location_id) && !fiTodays(f) && fiNeededToday(f));
const fiCanKeep = (loc) => isOwner() || adminAt(loc);
// Where a new forklift can go: your locations, or any for an owner.
const fiPlaces = () => isOwner() ? allLocations.filter(l => l.is_active !== false).map(l => l.id) : myLocations();

const FI_STATE = {
  ok: ["Inspected", "green"], problem: ["Out of service", "red"], out: ["Out of service", "red"], due: ["Due today", "amber"],
  off: ["Not due today", "slate"]
};

// "Inspected by Dana Price at 7:42 AM", "Failed today: Brakes and parking brake".
function fiStatusLine(lift) {
  const state = fiState(lift), today = fiTodays(lift), last = fiLast(lift);
  if (state === "ok") return `Inspected by ${today.created_by_name || "someone"} at ${ciTime(today)}`;
  if (state === "problem") return `Failed today: ${fiFailed(today).map(i => i.label).join(", ") || "a problem was found"} · ${
    today.created_by_name || "someone"}, ${ciTime(today)}`;
  if (state === "out") return `Not inspected today. Failed on ${ciDay(last.inspected_on)}: ${
    fiFailed(last).map(i => i.label).join(", ") || "a problem was found"}`;
  if (state === "off") return `Not due at the weekend: inspect it first if it's used.${last ? ` Last passed ${ciDay(last.inspected_on)}.` : ""}`;
  return last ? `Not inspected today. Last passed ${ciDay(last.inspected_on)}.` : "Not inspected yet.";
}

function fiTag(lift) {
  const [label, accent] = FI_STATE[fiState(lift)];
  return lift.retired_at ? `<span class="cab-tag">Retired</span>`
    : ["ok", "off"].includes(fiState(lift)) ? `<span class="cab-tag" style="${lit(accent)}">${label}</span>`
    : `<span class="cab-tag ci-tag-${fiState(lift) === "due" ? "due" : "out"}">${label}</span>`;
}

// ---- the Forklift Center's section ---------------------------------------------------
//
// Drawn in the cranes' styles (.ci), so the two Centers' daily lists look alike.

function fiSectionHtml() {
  if (fiNotSetUp) return "";
  if (fiError) return `<div class="cm fv ci" id="fiSection"><h2 class="group-title">Daily forklift inspections</h2>
    <p class="cm-none">The forklifts couldn't be loaded. Try again in a minute.</p></div>`;
  if (!fiLoaded) return `<div class="cm fv ci" id="fiSection"></div>`;
  const shown = fiActive();
  const keepsAny = fiPlaces().some(fiCanKeep);
  if (!shown.length && !keepsAny) return `<div class="cm fv ci" id="fiSection"></div>`;
  const mine = shown.filter(f => myLocations().includes(f.location_id));
  const done = mine.filter(f => fiTodays(f)).length, weekday = mine.some(fiNeededToday);
  // At each location, the ones out of service first, then those still to do.
  const rank = { problem: 0, out: 0, due: 1, off: 2, ok: 2 };
  const byLocation = {};
  shown.slice().sort((a, b) => rank[fiState(a)] - rank[fiState(b)] || a.name.localeCompare(b.name))
    .forEach(f => { (byLocation[f.location_id] = byLocation[f.location_id] || []).push(f); });
  // Your own location first, then the rest by name.
  const order = Object.keys(byLocation).sort((a, b) => (myLocations().indexOf(a) + 1 || 99) - (myLocations().indexOf(b) + 1 || 99)
    || (locations[a] || "~").localeCompare(locations[b] || "~"));
  const retired = fiForklifts.filter(f => f.retired_at && fiCanKeep(f.location_id));
  return `<div class="cm fv ci" id="fiSection">
    <h2 class="group-title">Daily forklift inspections${mine.length ? ` <span class="ci-count">${weekday ? `${done} of ${mine.length} done today`
      : "None due at the weekend"}</span>` : ""}</h2>
    <p class="cm-none">Inspect each forklift before its first use of the day, Monday to Friday: a walk around it and each control tried
      with no load. Anyone at the location can sign it off, and it's done for everyone.</p>
    ${shown.length ? order.map(loc => `${order.length > 1 ? `<h3 class="ci-place">${esc(locations[loc] || loc)}</h3>` : ""}
      ${byLocation[loc].map(fiCardHtml).join("")}`).join("")
      : `<div class="cm-card cm-empty"><b>No forklifts yet</b><p>Add each forklift at ${esc(myLocationNames().join(" and ") || "your location")},
          with a name everyone will recognise and its class, and it goes on the daily list for everyone there.</p></div>`}
    ${keepsAny ? `<div class="fv-actions"><button type="button" class="fv-go quiet" data-fi-add>${icon("plus", 17)}Add a forklift</button></div>` : ""}
    ${retired.length ? `<button type="button" class="fv-retired-toggle" data-fi-retired aria-expanded="${fiShowRetired}">
        Retired · ${retired.length} ${fiShowRetired ? "▾" : "▸"}</button>
      ${fiShowRetired ? retired.map(fiCardHtml).join("") : ""}` : ""}
  </div>`;
}

function fiCardHtml(lift) {
  const state = fiState(lift);
  return `<div class="cm-card ci-card${state === "problem" || state === "out" ? " alert" : ""}${lift.retired_at ? " retired" : ""}">
    <span class="fv-card-top">
      <span class="fv-glyph">${icon("forklift", 22)}</span>
      <span class="fv-who"><b>${esc(lift.name)} ${fiTag(lift)}</b>
        <span>${esc([fiClass(lift.truck_class), lift.capacity].filter(Boolean).join(" · "))}</span>
        ${lift.retired_at ? "" : `<small class="ci-line ${state}">${esc(fiStatusLine(lift))}</small>`}</span>
    </span>
    <span class="fv-actions ci-actions">
      ${lift.retired_at ? "" : `<button type="button" class="fv-go${["ok", "off"].includes(state) ? " quiet" : ""}" data-fi-inspect="${esc(lift.id)}">${
        icon("checkCircle", 17)}${state === "ok" ? "Inspect again" : "Inspect"}</button>`}
      <button type="button" class="fv-go quiet" data-fi-open="${esc(lift.id)}">${icon("clock", 17)}History</button>
    </span>
  </div>`;
}

function fiRedraw() {
  if ($("view").classList.contains("hidden")) return;
  if (viewShown === "forklift" && $("fiSection")) $("fiSection").outerHTML = fiSectionHtml();
  if (viewShown === "fktruck" && $("fiForklift")) $("fiForklift").innerHTML = fiForkliftHtml();
}

// ---- a forklift's page ---------------------------------------------------------------------

function forkliftTruckView() {
  const lift = fiForklift(openForkliftId);
  if (!lift) return hero("Forklift Center") + `<div class="cm"><div class="cm-card cm-empty"><b>That forklift isn't here</b>
    <p>It may have been deleted, or it's at a location you don't see.</p></div></div>`;
  return hero(lift.name, [fiClass(lift.truck_class), locations[lift.location_id]].filter(Boolean).join(" · "))
    + `<div class="cm fv ci" id="fiForklift">${fiForkliftHtml()}</div>`;
}

function fiForkliftHtml() {
  const lift = fiForklift(openForkliftId);
  if (!lift) return "";
  const state = fiState(lift), keeps = fiCanKeep(lift.location_id), history = fiOf(lift);
  const showing = state === "problem" ? fiTodays(lift) : state === "out" ? fiLast(lift) : null;
  return `<div class="cm-card fv-head${state === "problem" || state === "out" ? " alert" : ""}">
      <p class="cm-eyebrow">${icon("forklift", 15)}${esc([fiClass(lift.truck_class), lift.capacity, locations[lift.location_id]].filter(Boolean).join(" · "))}</p>
      <div class="ci-big"><b>${esc(lift.retired_at ? "Retired" : FI_STATE[state][0])}</b></div>
      ${lift.retired_at ? `<p class="fv-note">Retired ${esc(new Date(lift.retired_at).toLocaleDateString())}: off the daily list, its inspections kept.</p>`
        : `<p class="ci-line ${state}">${esc(fiStatusLine(lift))}</p>
      ${showing ? `<ul class="fv-answers">${fiFailed(showing).map(i => `<li class="bad">${icon("warning", 15)}<span><b>${esc(i.label)}</b>${
        ((showing.answers || {})[i.id] || {}).note ? `<small>${esc(showing.answers[i.id].note)}</small>` : ""}</span></li>`).join("")}</ul>
        <p class="fv-warn">${icon("warning", 15)}Don't use it until it's fixed and passes an inspection.</p>` : ""}
      <div class="fv-actions">
        <button type="button" class="fv-go${["ok", "off"].includes(state) ? " quiet" : ""}" data-fi-inspect="${esc(lift.id)}">${icon("checkCircle", 17)}${
          state === "ok" ? "Inspect again" : "Inspect now"}</button>
        ${keeps ? `<button type="button" class="fv-go quiet" data-fi-edit="${esc(lift.id)}">${icon("pencil", 17)}Edit</button>` : ""}
      </div>`}
    </div>
    <p class="fv-msg" role="alert"></p>
    <h2 class="group-title">The last 30 days</h2>
    <div class="cm-card">${fiStripHtml(lift)}</div>
    <h2 class="group-title">Inspections${history.length ? ` <span class="cm-n">${history.length}</span>` : ""}</h2>
    <div class="cm-card ci-log">${history.length ? history.map(r => fiLogRowHtml(r, keeps)).join("")
      : `<p class="fv-note">No inspections${fiOlderDone.has(lift.id) ? " yet" : ` in the last ${FI_DAYS} days`}.</p>`}</div>
    ${fiOlderDone.has(lift.id) ? "" : showOlderHtml("fktruck", "Show older inspections", `Showing the last ${FI_DAYS} days.`)}
    ${lift.notes ? `<div class="cm-card fv-details"><p>${esc(lift.notes)}</p></div>` : ""}
    ${keeps ? `<div class="fv-foot">
      ${lift.retired_at ? `<button type="button" class="fv-quiet" data-fi-act="restore">Bring it back</button>`
        : `<button type="button" class="fv-quiet" data-fi-act="retire">Retire it</button>`}
      <button type="button" class="fv-quiet danger" data-fi-act="delete">Delete it</button>
    </div>` : ""}`;
}

// A square for each of the last 30 days, oldest first: passed, failed, not
// inspected, or a weekend it wasn't needed.
function fiStripHtml(lift) {
  const today = dateOnly(ciToday(lift.location_id)), days = [];
  let weekdays = 0, passed = 0;
  for (let back = 29; back >= 0; back--) {
    const d = new Date(today); d.setDate(d.getDate() - back);
    const ymd = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
    const that = fiOf(lift).filter(r => r.inspected_on === ymd), workday = ciWorkday(ymd);
    const state = that.length ? (that[0].safe ? "ok" : "problem") : workday ? "none" : "off";
    if (workday) { weekdays++; if (state === "ok") passed++; }
    days.push(`<i class="${state}" title="${esc(`${ciDay(ymd, true)}: ${state === "none" ? "not inspected" : state === "off" ? "weekend"
      : state === "ok" ? `passed, ${that[0].created_by_name || ""}` : `failed, ${that[0].created_by_name || ""}`}`)}"></i>`);
  }
  return `<div class="ci-strip" role="img" aria-label="Passed on ${passed} of the last ${weekdays} weekdays">${days.join("")}</div>
    <p class="fv-note ci-key"><i class="ok"></i> Passed <i class="problem"></i> Failed <i class="none"></i> Not inspected <i class="off"></i> Weekend · passed on ${passed} of ${weekdays} weekdays</p>`;
}

function fiLogRowHtml(r, keeps) {
  const failed = fiFailed(r);
  return `<div class="ci-log-row${r.safe ? "" : " bad"}">
    <span class="ci-log-mark">${icon(r.safe ? "checkCircle" : "warning", 16)}</span>
    <span class="ci-log-main"><b>${esc(ciDay(r.inspected_on, true))} · ${esc(ciTime(r))}</b>
      <small>${esc(r.created_by_name || "Someone")} · ${r.safe ? `all ${(r.items || []).length} items OK` : `${failed.length} failed`}</small>
      ${failed.map(i => `<em>${esc(i.label)}${((r.answers || {})[i.id] || {}).note ? `: ${esc(r.answers[i.id].note)}` : ""}</em>`).join("")}
      ${r.notes ? `<small>${esc(r.notes)}</small>` : ""}</span>
    ${keeps ? `<button type="button" class="fv-quiet danger ci-del" data-fi-del="${esc(r.id)}" title="Delete an inspection entered by mistake">Delete</button>` : ""}
  </div>`;
}

// Older inspections for the forklift that's open, all of them at once: one a
// day is a few hundred a year.
const fiOlderDone = new Set();
olderLoaders.fktruck = async () => {
  const lift = fiForklift(openForkliftId);
  if (!lift) return;
  const { data, error } = await allRows(() => db.from("forklift_inspections").select("*").eq("forklift_id", lift.id)
    .lt("inspected_on", sinceDay(FI_DAYS)).order("inspected_on", { ascending: false }).order("id"));
  if (!error) {
    fiInspections = fiInspections.concat((data || []).filter(r => !fiInspections.some(x => x.id === r.id)));
    fiOlderDone.add(lift.id);
  }
  fiRedraw();
};

// ---- inspecting one ------------------------------------------------------------------------

function forkliftInspectView() {
  const lift = fiForklift(openForkliftId);
  if (!lift) return hero("Forklift Center") + `<div class="cm"><div class="cm-card cm-empty"><b>That forklift isn't here</b></div></div>`;
  const items = fiItemsFor(lift), today = ciToday(lift.location_id);
  return hero(`Inspect ${lift.name}`, [fiClass(lift.truck_class), lift.capacity, locations[lift.location_id]].filter(Boolean).join(" · "))
    + `<div class="card fv-panel ci-form" id="fiForm">
      <h2>Daily inspection</h2>
      <p class="note">Before the forklift's first use today: walk around it, then try each control with no load. If anything isn't
        right, mark it <b>Problem</b> and say what's wrong: the forklift is tagged out of service until it passes, and the location's
        admins and the Safety Manager are told.</p>
      ${items.length ? `<div class="fv-items">${items.map(i => `<div class="fv-item ci-item" data-fi-item="${esc(i.id)}">
          <span class="fv-item-text"><b>${esc(i.label)}</b>${i.detail ? `<small>${esc(i.detail)}</small>` : ""}</span>
          <span class="fv-item-pick" role="radiogroup" aria-label="${esc(i.label)}">
            <label><input type="radio" name="fii-${esc(i.id)}" value="ok"> OK</label>
            <label class="bad"><input type="radio" name="fii-${esc(i.id)}" value="problem"> Problem</label>
          </span>
          <input class="fv-item-note ci-item-note" data-fi-note="${esc(i.id)}" maxlength="300" placeholder="What's wrong?" aria-label="What's wrong with ${esc(i.label)}">
        </div>`).join("")}</div>`
        : `<p class="note">The Safety Manager hasn't set any items for ${esc(FI_CLASSES[lift.truck_class] ? FI_CLASSES[lift.truck_class][0] : "this class")}
          forklifts. Look it over and sign it off.</p>`}
      <label for="fiNotes">Anything else?</label>
      <textarea id="fiNotes" rows="2" maxlength="1000" placeholder="A noise, a slow leak, anything to keep an eye on"></textarea>
      <p class="ci-sign">Signed off by <b>${esc((profile && profile.full_name) || (me && me.email) || "you")}</b>, ${esc(ciDay(today, true))}</p>
      <div class="row"><button type="button" id="fiSign" data-fi-act="sign">Sign off: safe to use</button>
        <button type="button" class="ghost" data-fi-act="cancel">Cancel</button></div>
      <p class="msg"></p>
    </div>`;
}

// The button says what signing off will do.
function fiSignLabel() {
  const button = $("fiSign");
  if (!button) return;
  const problem = !!document.querySelector('#fiForm input[value="problem"]:checked');
  button.textContent = problem ? "Sign off: tag it out of service" : "Sign off: safe to use";
  button.classList.toggle("danger", problem);
}

async function fiSign(button) {
  const lift = fiForklift(openForkliftId), box = $("fiForm");
  if (!lift) return;
  const answers = {}, missing = [], unexplained = [];
  fiItemsFor(lift).forEach(i => {
    const picked = box.querySelector(`input[name="fii-${CSS.escape(i.id)}"]:checked`);
    if (!picked) return missing.push(i.label);
    const note = (box.querySelector(`[data-fi-note="${CSS.escape(i.id)}"]`) || {}).value || "";
    if (picked.value === "problem" && !note.trim()) unexplained.push(i.label);
    answers[i.id] = { status: picked.value, note: picked.value === "problem" ? note.trim() : "" };
  });
  if (missing.length) return speak(box, `Answer every item: ${missing.join(", ")}.`, true);
  if (unexplained.length) return speak(box, `Say what's wrong with ${unexplained.join(", ")}.`, true);
  button.disabled = true;
  const { data, error } = await db.from("forklift_inspections").insert({ forklift_id: lift.id, answers, notes: $("fiNotes").value.trim() })
    .select("id, safe").single();
  button.disabled = false;
  if (error) return speak(box, error.message.includes("row-level") ? "You can inspect the forklifts at your own location." : error.message, true);
  if (!data.safe) notify("forklift_inspection", data.id);
  await loadForkliftInspections();
  showView("fktruck");
  fiSay(data.safe ? "Signed off. It's good to use today."
    : "Signed off and tagged out. The location's admins and the Safety Manager have been told.", !data.safe);
}

// ---- adding or editing a forklift -------------------------------------------------------------

function forkliftFormView() {
  if (!fiDraft) fiDraft = { id: null, name: "", truck_class: "V", location_id: fiPlaces()[0] || "", capacity: "", notes: "" };
  const d = fiDraft, places = fiPlaces();
  return hero(d.id ? `Edit ${d.name}` : "Add a Forklift",
      d.id ? "" : "It goes on the daily inspection list for everyone at its location.")
    + `<div class="card fv-form ci-form" id="fiForkliftForm">
      <div class="fields">
        <div class="wide"><label for="fifName">Name (required)</label><input id="fifName" maxlength="60" value="${esc(d.name)}"
          placeholder="${d.truck_class === "VII" ? "Yard telehandler" : d.truck_class === "III" ? "Parts pallet jack" : "Warehouse forklift"}" autocomplete="off"></div>
        <div class="wide"><label for="fifClass">Class</label><select id="fifClass">${Object.entries(FI_CLASSES).map(([k, [c, t, like]]) =>
          `<option value="${k}"${d.truck_class === k ? " selected" : ""}>${esc(`${c} · ${t} (${like})`)}</option>`).join("")}</select></div>
        <div><label for="fifCapacity">Rated capacity (optional)</label><input id="fifCapacity" maxlength="40" value="${esc(d.capacity)}"
          placeholder="5,000 lb"></div>
        ${places.length > 1 ? `<div><label for="fifLocation">Location</label><select id="fifLocation">${places.map(id =>
          `<option value="${esc(id)}"${d.location_id === id ? " selected" : ""}>${esc(locations[id] || id)}</option>`).join("")}</select></div>` : ""}
        <div class="wide"><label for="fifNotes">Notes (optional)</label><textarea id="fifNotes" rows="2" maxlength="1000"
          placeholder="Where it's kept, its make and model, the serial number">${esc(d.notes)}</textarea></div>
      </div>
      <p class="note">A name everyone will recognise: no two forklifts in service at a location can share one. The inspection asked
        depends on the class, as on its data plate.</p>
      <div class="row"><button type="button" data-fi-act="save-forklift">${d.id ? "Save" : "Add the forklift"}</button>
        <button type="button" class="ghost" data-fi-act="cancel-form">Cancel</button></div>
      <p class="msg"></p>
    </div>`;
}

async function fiSaveForklift(button) {
  const box = $("fiForkliftForm"), d = fiDraft;
  const row = { name: $("fifName").value.trim(), truck_class: $("fifClass").value, capacity: $("fifCapacity").value.trim(),
    notes: $("fifNotes").value.trim(), location_id: $("fifLocation") ? $("fifLocation").value : d.location_id };
  if (!row.name) return speak(box, "Give the forklift a name, so everyone knows which one it is.", true);
  if (!row.location_id) return speak(box, "Pick its location.", true);
  button.disabled = true;
  const { data, error } = d.id
    ? await db.from("forklifts").update(row).eq("id", d.id).select("id").single()
    : await db.from("forklifts").insert(row).select("id").single();
  button.disabled = false;
  if (error) {
    return speak(box, error.code === "23505" ? `${locations[row.location_id] || "That location"} already has a forklift called that.`
      : error.message.includes("row-level") ? "Only the location's admins can add or change its forklifts." : error.message, true);
  }
  await loadForkliftInspections();
  fiDraft = null;
  openForkliftId = data.id;
  showView("fktruck");
}

// ---- wiring --------------------------------------------------------------------------------

// Under the form, or at the foot of the forklift's page.
function fiSay(text, bad = true) {
  const where = document.querySelector("#fiForm .msg") || document.querySelector("#fiForkliftForm .msg") || document.querySelector("#fiForklift .fv-msg");
  if (where) { where.textContent = text; where.className = where.className.replace(/ ?(error|ok)/g, "") + (bad ? " error" : " ok"); }
  else if (bad) alert(text);
}

$("view").addEventListener("change", (event) => {
  if (event.target.closest("#fiForm") && event.target.type === "radio") fiSignLabel();
  // A new class changes the name suggested.
  if (event.target.id === "fifClass" && fiDraft) {
    fiDraft.name = $("fifName").value; fiDraft.capacity = $("fifCapacity").value; fiDraft.notes = $("fifNotes").value;
    if ($("fifLocation")) fiDraft.location_id = $("fifLocation").value;
    fiDraft.truck_class = event.target.value;
    showView("fkform");
  }
});

$("view").addEventListener("click", async (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  if (button.dataset.fiInspect) { fiCameFrom = viewShown; openForkliftId = button.dataset.fiInspect; return showView("fkinspect"); }
  if (button.dataset.fiOpen) { openForkliftId = button.dataset.fiOpen; return showView("fktruck"); }
  if (button.hasAttribute("data-fi-add")) { fiDraft = null; return showView("fkform"); }
  if (button.hasAttribute("data-fi-retired")) { fiShowRetired = !fiShowRetired; return fiRedraw(); }
  if (button.dataset.fiEdit) {
    const f = fiForklift(button.dataset.fiEdit);
    fiDraft = { id: f.id, name: f.name, truck_class: f.truck_class, location_id: f.location_id, capacity: f.capacity || "", notes: f.notes || "" };
    return showView("fkform");
  }
  if (button.dataset.fiDel) {
    if (!confirm("Delete this inspection? Only for one entered by mistake: it comes off the forklift's record for good.")) return;
    const { data, error } = await db.from("forklift_inspections").delete().eq("id", button.dataset.fiDel).select("id");
    if (error || !(data || []).length) return fiSay(error ? error.message : "Not deleted: only the location's admins can.");
    fiInspections = fiInspections.filter(r => r.id !== button.dataset.fiDel);
    return fiRedraw();
  }
  const act = button.dataset.fiAct;
  if (!act) return;
  if (act === "sign") return fiSign(button);
  if (act === "cancel") return showView(fiCameFrom === "fktruck" ? "fktruck" : "forklift");
  if (act === "save-forklift") return fiSaveForklift(button);
  if (act === "cancel-form") { const back = fiDraft && fiDraft.id; fiDraft = null; return showView(back ? "fktruck" : "forklift"); }
  const lift = fiForklift(openForkliftId);
  if (!lift) return;
  if (act === "retire" || act === "restore") {
    if (act === "retire" && !confirm(`Retire ${lift.name}? It comes off the daily list; its inspections are kept, and you can bring it back.`)) return;
    const { error } = await db.from("forklifts").update({ retired_at: act === "retire" ? new Date().toISOString() : null }).eq("id", lift.id);
    if (error) return fiSay(error.code === "23505" ? "Another forklift in service there has that name now. Rename one first." : error.message);
    await loadForkliftInspections();
    return fiRedraw();
  }
  if (act === "delete") {
    if (!confirm(`Delete ${lift.name} and every inspection of it? To keep its record, retire it instead.`)) return;
    const { data, error } = await db.from("forklifts").delete().eq("id", lift.id).select("id");
    if (error || !(data || []).length) return fiSay(error ? error.message : "Not deleted: only the location's admins can.");
    await loadForkliftInspections();
    return showView("forklift");
  }
});

// ---- the Safety dashboard: the daily inspection's checklist ------------------------------------
//
// The items every daily inspection asks, each answered OK or Problem. The
// Safety Manager keeps them here; an item can be for some classes of forklift,
// or all of them (none ticked). Rewording or deleting one never changes an
// inspection already signed off: each keeps the items as worded that day.

function renderForkliftInspectionAdmin() {
  const box = $("forkliftInspectionAdmin");
  if (!box) return;
  if (fiItemsError) {
    box.innerHTML = `<div class="card"><p class="error">${/does not exist|schema cache/i.test(fiItemsError)
      ? "Run migration 0171_daily_forklift_inspections.sql in the SQL editor, then reload this page." : esc(fiItemsError)}</p></div>`;
    return;
  }
  const classes = (i) => Object.entries(FI_CLASSES).map(([k, [c, t]]) => `<label class="fva-kind" title="${esc(t)}"><input type="checkbox" data-fia-class="${k}"${
    (i.classes || []).includes(k) ? " checked" : ""}> ${esc(c)}</label>`).join("");
  const count = (k) => fiItems.filter(i => i.is_active && (!(i.classes || []).length || i.classes.includes(k))).length;
  box.innerHTML = `<div class="card">
    <h2>Daily forklift inspection</h2>
    <p class="note">The check done on every forklift before its first use each day, in the Forklift Center on the app and this page.
      Each item is answered <b>OK</b> or <b>Problem</b>; a Problem tags the forklift out of service until it passes again, and the
      location's admins and you get a push. Tick the classes an item is for, or none for every class. Changes reach the app and this
      page straight away.</p>
    <p class="note">Right now each class is asked: ${Object.entries(FI_CLASSES).map(([k, [c, t]]) =>
      `<span title="${esc(t)}">${esc(c)} <b>${count(k)}</b></span>`).join(" · ")}. OSHA asks for a forklift to be examined before
      it's used, and daily when it's used every day (1910.178(q)(7)). Keep it short: it's done every day.</p>
    <p class="note"><b>Showing: No</b> takes an item off the inspection and can be switched back. Rewording or deleting one never
      changes an inspection already signed off.</p>
    ${fiItems.length ? fiItems.map((i, n) => `<div class="role${i.is_active ? "" : " off"}" style="padding:16px${i.is_active ? "" : ";opacity:.6"}" data-fia-item="${esc(i.id)}">
      <div class="fields">
        <div class="wide"><label>Item</label><input type="text" data-fia="label" maxlength="80" value="${esc(i.label)}"></div>
        <div class="wide"><label>How to check it (optional, shown under it)</label><input type="text" data-fia="detail" maxlength="200" value="${esc(i.detail || "")}"></div>
        <div class="wide"><label>For</label><div class="fva-kinds">${classes(i)}</div></div>
        <div><label>Showing</label><select data-fia="is_active">
          <option value="yes"${i.is_active ? " selected" : ""}>Yes</option><option value="no"${i.is_active ? "" : " selected"}>No</option></select></div>
      </div>
      <div class="row">
        <button data-fia-act="save">Save</button>
        <button class="ghost" data-fia-act="up"${n === 0 ? " disabled" : ""} aria-label="Move up">&uarr;</button>
        <button class="ghost" data-fia-act="down"${n === fiItems.length - 1 ? " disabled" : ""} aria-label="Move down">&darr;</button>
        <button class="ghost" data-fia-act="delete">Delete</button>
        <span class="msg"></span>
      </div>
    </div>`).join("") : `<p class="note">No items yet: an inspection is a sign-off and nothing more.</p>`}
    <div class="row" style="margin-top:10px"><button data-fia-act="add">Add an item</button><span class="msg" id="fiaMsg"></span></div>
  </div>`;
}

async function fiaReload() {
  const { data, error } = await db.from("forklift_inspection_items").select("*").order("sort_order").order("label");
  if (!error) fiItems = data || [];
  renderForkliftInspectionAdmin();
}

$("admin").addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-fia-act]");
  if (!button) return;
  const act = button.dataset.fiaAct;
  const refused = "Only the Safety Manager can change the forklift inspection.";
  if (act === "add") {
    const { error } = await db.from("forklift_inspection_items").insert({ label: "New item", is_active: false,
      sort_order: (Math.max(0, ...fiItems.map(i => i.sort_order || 0)) + 10) });
    if (error) return speak(button.closest(".row"), error.message.includes("row-level") ? refused : error.message, true);
    await fiaReload();
    return speak($("fiaMsg").closest(".row"), "Added, not showing yet. Word it, set Showing to Yes, and save.", false);
  }
  const box = button.closest("[data-fia-item]"), id = box.dataset.fiaItem, item = fiItems.find(i => i.id === id);
  if (act === "delete") {
    if (!confirm(`Delete "${item.label}" from the daily inspection? Inspections already signed off keep it. "Showing: No" can be undone; this can't.`)) return;
    const { data, error } = await db.from("forklift_inspection_items").delete().eq("id", id).select("id");
    if (error || !(data || []).length) return speak(box, error ? error.message : `Not deleted. ${refused}`, true);
    return fiaReload();
  }
  if (act === "up" || act === "down") {
    const at = fiItems.findIndex(i => i.id === id), other = fiItems[act === "up" ? at - 1 : at + 1];
    if (!other) return;
    // Spaced out first, so two items never share a place.
    const order = fiItems.map((i, n) => ({ id: i.id, sort_order: (n + 1) * 10 }));
    const a = order[at], b = order[act === "up" ? at - 1 : at + 1];
    [a.sort_order, b.sort_order] = [b.sort_order, a.sort_order];
    for (const row of order) {
      if (fiItems.find(i => i.id === row.id).sort_order === row.sort_order) continue;
      const { error } = await db.from("forklift_inspection_items").update({ sort_order: row.sort_order }).eq("id", row.id);
      if (error) return speak(box, error.message, true);
    }
    return fiaReload();
  }
  const label = box.querySelector('[data-fia="label"]').value.trim();
  if (!label) return speak(box, "An item needs some words.", true);
  speak(box, "Saving…", false);
  const { data, error } = await db.from("forklift_inspection_items").update({
    label, detail: box.querySelector('[data-fia="detail"]').value.trim(),
    classes: [...box.querySelectorAll("[data-fia-class]:checked")].map(c => c.dataset.fiaClass),
    is_active: box.querySelector('[data-fia="is_active"]').value === "yes"
  }).eq("id", id).select("id");
  if (error) return speak(box, error.message, true);
  if (!(data || []).length) return speak(box, `Not saved. ${refused}`, true);
  await fiaReload();
  speak(document.querySelector(`[data-fia-item="${CSS.escape(id)}"]`), "Saved.", false);
});
