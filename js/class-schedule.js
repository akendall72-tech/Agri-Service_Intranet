// Class Schedule (migration 0122)
//
// Stage 2 of moving training off the UKG uploads (docs/lms-plan.html). The
// Training Manager puts a class on the schedule from the catalog. The database
// puts it on the company calendar and the Open Seat Report at once, and moves
// both when the class moves; drafts and cancelled classes are on neither. The
// calendar entry can't be changed on its own: the Event Center points here.
// Who can register is kept for when registration opens (Stage 3).

let scClasses = [], scError = null, scNotSetUp = false, scOlderLoaded = false;
// The class open in the form: null for a new one.
let scEditing = null;
// Rosters left open, so a redraw doesn't close them.
const csOpenRosters = new Set();
document.addEventListener("toggle", (event) => {
  const roster = event.target.closest && event.target.closest("[data-cs-roster]");
  if (roster) csOpenRosters[roster.open ? "add" : "delete"](roster.dataset.csRoster);
}, true);

// Classes that ended more than this many days ago load behind Show older.
const SC_DAYS = 90;

const SC_WHO = [
  ["everyone", "Open to everyone", "Anyone can register themselves, and admins can register their people."],
  ["admins", "Admin only", "People ask their location admin, who registers them."],
  ["training_manager", "Training Manager only", "People ask you, and you register them."]
];
const scWhoLabel = (value) => (SC_WHO.find(w => w[0] === value) || SC_WHO[0])[1];

async function loadScheduledClasses() {
  if (!isOwner()) return;
  const { data, error } = await allRows(() => db.from("scheduled_classes").select("*")
    .gte("ends_on", sinceDay(SC_DAYS)).order("starts_on").order("id"));
  scError = error ? error.message : null;
  scNotSetUp = !!error && /does not exist|schema cache/i.test(error.message);
  if (error) return;
  const older = scClasses.filter(c => c.ends_on < sinceDay(SC_DAYS));
  scClasses = (data || []).concat(older.filter(c => !(data || []).some(n => n.id === c.id)));
}

olderLoaders.classes = async () => {
  const { data, error } = await allRows(() => db.from("scheduled_classes").select("*")
    .lt("ends_on", sinceDay(SC_DAYS)).order("starts_on").order("id"));
  if (!error) {
    scClasses = scClasses.concat((data || []).filter(c => !scClasses.some(x => x.id === c.id)));
    scOlderLoaded = true;
  }
  renderClassSchedule();
};

// ---- how a class reads ---------------------------------------------------------------------

// "08:00:00" -> "8:00 AM"
function scTime(t) {
  const [h, m] = String(t || "0:0").split(":").map(Number);
  return `${h % 12 || 12}:${pad2(m)} ${h < 12 ? "AM" : "PM"}`;
}
const scDay = (ymd) => dateOnly(ymd).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
// "PST" or "MDT": the zone's short name on the class's first day.
function scZone(c) {
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: c.timezone, timeZoneName: "short" })
      .formatToParts(dateOnly(c.starts_on)).find(p => p.type === "timeZoneName").value;
  } catch { return ""; }
}
// "Wed, Dec 2, 8:00 AM – 4:00 PM PST", or across days with the hours each day.
const scWhen = (c) => `${scDay(c.starts_on)}${c.ends_on > c.starts_on ? ` – ${scDay(c.ends_on)}` : ""}, `
  + `${scTime(c.start_time)} – ${scTime(c.end_time)} ${scZone(c)}${c.ends_on > c.starts_on ? " each day" : ""}`;
// "Pasco, training room", "Boise Centre" or "Online".
const scPlace = (c) => c.is_online ? "Online"
  : c.location_id ? `${locations[c.location_id] || c.location_id}${c.venue ? `, ${c.venue}` : ""}` : c.venue;
const scZoneLabel = (zone) => (EVENT_ZONES.find(z => z[0] === zone) || [zone, zone])[1];
const scLocationZone = (id) => (allLocations.find(l => l.id === id) || {}).timezone || "America/Boise";

// ---- the page --------------------------------------------------------------------------------

function renderClassSchedule() {
  const box = $("classSchedule");
  if (!box) return;
  if (scNotSetUp) {
    box.innerHTML = `<div class="card"><p class="error">Run migration 0122_class_schedule.sql in the SQL editor, then reload this page.</p></div>`;
    return;
  }
  box.innerHTML = `${scFormHtml()}${scListHtml()}`;
  scShowWhere();
}

function scFormHtml() {
  const c = scEditing ? scClasses.find(x => x.id === scEditing) : null;
  const v = c || { starts_on: "", ends_on: "", start_time: "08:00", end_time: "16:00", seats: 12, registration: "everyone",
    timezone: "America/Boise", status: "new", venue: "", address: "", instructor: "", details: "", meeting_url: "" };
  const where = v.is_online ? "online" : v.location_id || !v.venue ? "location" : "venue";
  const hhmm = (t) => String(t || "").slice(0, 5);
  const shown = allCourses.filter(k => k.is_active || k.id === v.course_id);
  const kept = c && !shown.some(k => k.id === c.course_id);
  const zoneOptions = (picked) => EVENT_ZONES.map(([z, label]) =>
    `<option value="${esc(z)}"${z === picked ? " selected" : ""}>${esc(label)}</option>`).join("");
  const buttons = v.status === "new" ? `<button type="button" data-cs-save="scheduled">Put it on the schedule</button>
        <button type="button" class="ghost" data-cs-save="draft">Save as draft</button>`
    : v.status === "draft" ? `<button type="button" data-cs-save="scheduled">Put it on the schedule</button>
        <button type="button" class="ghost" data-cs-save="draft">Save draft</button>`
    : `<button type="button" data-cs-save="">Save changes</button>`;

  return `<div class="card cs-form" id="scForm">
      <h2>${c ? `Change ${esc(c.title)}` : "Schedule a class"}</h2>
      <p class="note">${c && c.status === "scheduled"
        ? "It's on the schedule: a change here moves it on the company calendar and the Open Seat Report too, and goes in its history."
        : "A class on the schedule goes on the company calendar and the Open Seat Report straight away. A draft stays here until you put it on. "
          + "Schedule a class here or in UKG, not both, or it shows twice."}</p>
      <div class="fields">
        <div class="wide"><label for="scCourse">Course</label>
          <select id="scCourse"><option value="">Pick a course from the catalog</option>
            ${kept ? `<option value="keep" selected>${esc(c.title)} (no longer in the catalog)</option>` : ""}
            ${groupCourses(shown).map(([cat, list]) => `<optgroup label="${esc(cat)}">${list.map(k =>
              `<option value="${esc(k.id)}"${k.id === v.course_id ? " selected" : ""}>${esc(k.title)}</option>`).join("")}</optgroup>`).join("")}
          </select>
          <p class="note" id="scCourseNote"></p></div>
        <div><label for="scFirst">First day</label><input id="scFirst" type="date" value="${esc(v.starts_on)}"></div>
        <div><label for="scLast">Last day</label><input id="scLast" type="date" value="${esc(v.ends_on)}">
          <p class="note">The same as the first day for a one-day class.</p></div>
        <div><label for="scStart">Starts</label><input id="scStart" type="time" step="900" value="${esc(hhmm(v.start_time))}"></div>
        <div><label for="scEnd">Ends</label><input id="scEnd" type="time" step="900" value="${esc(hhmm(v.end_time))}">
          <p class="note">Each day, on the clock where it's held.</p></div>
        <div class="wide"><span class="cs-label" id="scWhereLabel">Where</span>
          <div class="seg cs-where" role="radiogroup" aria-labelledby="scWhereLabel">
            ${[["location", "At a location"], ["venue", "Somewhere else"], ["online", "Online"]].map(([w, label]) =>
              `<label><input type="radio" name="scWhere" value="${w}"${w === where ? " checked" : ""}> ${label}</label>`).join("")}
          </div></div>
        <div data-cs-where="location"><label for="scLocation">Location</label>
          <select id="scLocation">${allLocations.filter(l => l.is_active !== false || l.id === v.location_id).map(l =>
            `<option value="${esc(l.id)}"${l.id === v.location_id ? " selected" : ""}>${esc(l.name)}</option>`).join("")}</select>
          <p class="note" id="scLocationZone"></p></div>
        <div data-cs-where="location"><label for="scRoom">Room (optional)</label>
          <input id="scRoom" maxlength="200" placeholder="Training room" value="${esc(where === "location" ? v.venue : "")}"></div>
        <div data-cs-where="venue"><label for="scVenue">Venue</label>
          <input id="scVenue" maxlength="200" placeholder="Boise Centre" value="${esc(where === "venue" ? v.venue : "")}"></div>
        <div data-cs-where="venue"><label for="scAddress">Address (optional)</label>
          <input id="scAddress" maxlength="300" value="${esc(v.address)}"></div>
        <div data-cs-where="online"><label for="scMeeting">Meeting link (optional)</label>
          <input id="scMeeting" type="url" maxlength="2000" placeholder="https://teams.microsoft.com/…" value="${esc(v.meeting_url || "")}">
          <p class="note">Add it when you have it. The calendar shows the class as online either way.</p></div>
        <div data-cs-where="venue online"><label for="scZone">Time zone</label>
          <select id="scZone">${zoneOptions(v.timezone)}</select></div>
        <div><label for="scInstructor">Instructor (optional)</label><input id="scInstructor" maxlength="200" value="${esc(v.instructor)}"></div>
        <div><label for="scSeats">Seats</label><input id="scSeats" type="number" min="1" max="500" step="1" inputmode="numeric" value="${esc(v.seats)}"></div>
        <div><label for="scRegisterBy">Register by (optional)</label><input id="scRegisterBy" type="date" value="${esc(v.register_by || "")}"></div>
        <div><label for="scHours">Training hours</label><input id="scHours" type="number" min="0" max="1000" step="0.5" inputmode="decimal"
          value="${esc(v.training_hours ?? "")}"><p class="note">From the catalog. Change it here for this class only.</p></div>
        <div><span class="cs-label">AGCO</span><label class="tc-check" for="scAgco"><input id="scAgco" type="checkbox"${v.counts_for_agco ? " checked" : ""}> Counts as AGCO credit</label></div>
        <div class="wide"><span class="cs-label" id="scWhoLabel">Who can register</span>
          <div class="cs-who" role="radiogroup" aria-labelledby="scWhoLabel">
            ${SC_WHO.map(([w, label, says]) => `<label class="cs-who-option"><input type="radio" name="scWho" value="${w}"${w === v.registration ? " checked" : ""}>
              <span><b>${label}</b><small>${says}</small></span></label>`).join("")}
          </div>
          <p class="note">Registering in the app comes next. The setting is kept with the class until then, and you can change it any time.</p></div>
        <div class="wide"><label for="scDetails">Details (optional)</label>
          <textarea id="scDetails" rows="3" maxlength="4000" placeholder="What to bring, where to park">${esc(v.details)}</textarea>
          <p class="note">Shown on the calendar, with the instructor, hours and seats.</p></div>
      </div>
      <div class="row">${buttons}${c ? `<button type="button" class="ghost" data-cs-act="new">Stop changing it</button>` : ""}<span class="msg"></span></div>
    </div>`;
}

// Only the boxes for where it's held show.
function scShowWhere() {
  const form = $("scForm");
  if (!form) return;
  const where = (form.querySelector('[name="scWhere"]:checked') || {}).value || "location";
  form.querySelectorAll("[data-cs-where]").forEach(el => el.classList.toggle("hidden", !el.dataset.csWhere.split(" ").includes(where)));
  const zone = $("scLocationZone");
  if (zone) zone.textContent = `Times are ${scZoneLabel(scLocationZone($("scLocation").value))} time there.`;
  scCourseNote();
}

// The course picked: what it goes on records as, and what it counts for.
function scCourseNote() {
  const course = allCourses.find(k => k.id === $("scCourse").value);
  const note = $("scCourseNote");
  if (!note) return;
  note.innerHTML = course ? [
    tcKey(tcRecordName(course)) !== tcKey(course.title) ? `<span>Goes on records as <b>${esc(tcRecordName(course))}</b>.</span>` : "",
    ...tcCounts(tcRecordName(course)).map(t => `<span class="badge b-current">${esc(t)}</span>`)
  ].filter(Boolean).join(" ") : "";
}

function scListHtml() {
  if (scError && !scNotSetUp) return `<div class="card"><p class="error">${esc(scError)}</p></div>`;
  const today = tcToday();
  const order = (a, b) => (a.starts_on + a.start_time).localeCompare(b.starts_on + b.start_time) || a.title.localeCompare(b.title);
  const coming = scClasses.filter(c => c.status !== "cancelled" && c.ends_on >= today).sort(order);
  const done = scClasses.filter(c => c.status === "cancelled" || c.ends_on < today).sort((a, b) => order(b, a));
  return `<div class="card">
      <h2>Coming up</h2>
      ${coming.length ? coming.map(scClassHtml).join("")
        : `<p class="note">Nothing on the schedule yet. Pick a course above to put the first class on.</p>`}
    </div>
    <div class="card">
      <h2>Past and cancelled</h2>
      ${done.length ? done.map(scClassHtml).join("") : `<p class="note">${scOlderLoaded ? "None yet." : `None in the last ${SC_DAYS} days.`}</p>`}
      ${scOlderLoaded ? "" : showOlderHtml("classes", "Show older classes", `Showing classes that ended in the last ${SC_DAYS} days.`)}
    </div>`;
}

function scClassHtml(c) {
  // The class as the Open Seat Report has it, with its roster (0123).
  const doc = c.status === "scheduled" ? crClass(c.id) : null;
  const day = dateOnly(c.starts_on);
  const past = c.ends_on < tcToday();
  const facts = [`${c.seats} ${c.seats === 1 ? "seat" : "seats"}`, c.register_by && `Register by ${scDay(c.register_by)}`,
    scWhoLabel(c.registration), c.training_hours != null && `${tcHours(c.training_hours)} training ${Number(c.training_hours) === 1 ? "hour" : "hours"}`,
    c.counts_for_agco && "AGCO credit", c.instructor && `Instructor: ${c.instructor}`].filter(Boolean);
  const actions = c.status === "scheduled" ? `<button type="button" class="pdf" data-cs-edit="${esc(c.id)}">Change</button>
      ${past ? "" : `<button type="button" class="pdf" data-cs-cancel="${esc(c.id)}">Cancel class</button>`}`
    : c.status === "draft" ? `<button type="button" class="pdf" data-cs-edit="${esc(c.id)}">Change</button>
      <button type="button" class="pdf" data-cs-delete="${esc(c.id)}">Delete</button>`
    : `${past ? "" : `<button type="button" class="pdf" data-cs-restore="${esc(c.id)}">Put back on the schedule</button>`}
      <button type="button" class="pdf" data-cs-delete="${esc(c.id)}">Delete</button>`;
  const history = (c.changes || []).slice().reverse();
  return `<div class="cs-class${c.status === "scheduled" ? "" : " cs-" + c.status}${c.id === scEditing ? " cs-open" : ""}" data-cs-class="${esc(c.id)}">
      <div class="cs-date" aria-hidden="true"><small>${day.toLocaleDateString("en-US", { month: "short" })}</small><b>${day.getDate()}</b></div>
      <div class="cs-main">
        <b class="cs-title">${esc(c.title)}</b>
        ${c.status === "draft" ? ` <span class="badge b-none">Draft, not on the calendar</span>` : ""}
        ${c.status === "cancelled" ? ` <span class="badge b-expired">Cancelled</span>` : ""}
        <div class="note">${esc(scWhen(c))} · ${esc(scPlace(c))}${c.is_online && !c.meeting_url ? " (link to follow)" : ""}</div>
        <div class="note">${facts.map(esc).join(" · ")}</div>
        ${doc ? `<div class="note cs-taken"><b>${doc.registered} of ${c.seats} registered</b>${(doc.waitlist || []).length
          ? ` · ${doc.waitlist.length} on the waitlist` : ""}</div>
        <details class="cs-roster" data-cs-roster="${esc(c.id)}"${csOpenRosters.has(c.id) ? " open" : ""}>
          <summary>Roster</summary>${crRosterHtml(doc)}</details>` : ""}
        ${history.length ? `<details class="cs-history"><summary>History (${history.length})</summary><ul>${history.map(h =>
          `<li><span>${esc(h.what)}</span><small>${esc(h.by || "")}${h.by ? " · " : ""}${esc(newsDate(String(h.at).slice(0, 10)))}</small></li>`).join("")}</ul></details>` : ""}
      </div>
      <div class="row cs-actions">${actions}</div>
    </div>`;
}

// ---- saving ----------------------------------------------------------------------------------

function scRow() {
  const form = $("scForm");
  const val = (id) => $(id).value.trim();
  const picked = $("scCourse").value;
  const course = allCourses.find(k => k.id === picked);
  const editing = scEditing ? scClasses.find(x => x.id === scEditing) : null;
  const where = form.querySelector('[name="scWhere"]:checked').value;
  const hours = val("scHours");
  return {
    problem: !course && picked !== "keep" ? "Pick the course from the catalog."
      : !val("scFirst") ? "Pick the first day."
      : val("scLast") && val("scLast") < val("scFirst") ? "The last day can't be before the first."
      : !val("scStart") || !val("scEnd") ? "Give the times it starts and ends."
      : val("scEnd") <= val("scStart") ? "It has to end after it starts."
      : where === "venue" && !val("scVenue") ? "Say where it's held."
      : where === "online" && val("scMeeting") && !/^https?:\/\/.+/i.test(val("scMeeting")) ? "The meeting link has to be a web address, starting https://."
      : !(Number(val("scSeats")) >= 1 && Number(val("scSeats")) <= 500 && Number.isInteger(Number(val("scSeats")))) ? "Seats are a whole number from 1 to 500."
      : val("scRegisterBy") && val("scRegisterBy") > val("scFirst") ? "The register-by date can't be after the first day."
      : hours !== "" && !(Number(hours) >= 0 && Number(hours) <= 1000) ? "Training hours are a number from 0 to 1000."
      : null,
    row: {
      course_id: course ? course.id : editing ? editing.course_id : null,
      title: course ? course.title : editing ? editing.title : "",
      starts_on: val("scFirst"), ends_on: val("scLast") || val("scFirst"),
      start_time: val("scStart"), end_time: val("scEnd"),
      timezone: where === "location" ? scLocationZone(val("scLocation")) : val("scZone"),
      location_id: where === "location" ? val("scLocation") : null,
      venue: where === "location" ? val("scRoom") : where === "venue" ? val("scVenue") : "",
      address: where === "venue" ? val("scAddress") : "",
      is_online: where === "online",
      meeting_url: where === "online" && val("scMeeting") ? val("scMeeting") : null,
      instructor: val("scInstructor"), seats: Number(val("scSeats")), register_by: val("scRegisterBy") || null,
      registration: form.querySelector('[name="scWho"]:checked').value,
      training_hours: hours === "" ? null : Number(hours), counts_for_agco: $("scAgco").checked,
      details: val("scDetails")
    }
  };
}

// After a change: the classes, and the calendar and report the database moved with them.
async function scReload() {
  const [, , reports] = await Promise.all([loadScheduledClasses(), loadEvents(), db.from("training_reports").select("*")]);
  if (!reports.error) trainingReports = Object.fromEntries((reports.data || []).map(r => [r.id, r]));
  await loadClassRegistrations();
  renderClassSchedule();
  safely(renderEvents, renderOsrLive);
}

async function scSave(button, status) {
  const box = $("scForm");
  const { problem, row } = scRow();
  if (problem) return speak(box, problem, true);
  if (status) row.status = status;
  const editing = scEditing;
  button.disabled = true;
  speak(box, "Saving…", false);
  const { data, error } = editing
    ? await db.from("scheduled_classes").update(row).eq("id", editing).select("id")
    : await db.from("scheduled_classes").insert(row).select("id");
  button.disabled = false;
  if (error) return speak(box, error.message, true);
  if (!(data || []).length) return speak(box, "Not saved: only the Training Manager schedules classes.", true);
  // Moving a class tells the people on it (0123).
  notify("class_notices", data[0].id);
  scEditing = null;
  await scReload();
  const on = status === "draft" ? "Saved as a draft. It isn't on the calendar until you put it on the schedule."
    : status === "scheduled" ? `${row.title} is on the schedule, the company calendar and the Open Seat Report.`
    : "Saved. The calendar and the Open Seat Report follow.";
  speak($("scForm"), on, false);
}

async function scSetStatus(id, status) {
  const { data, error } = await db.from("scheduled_classes").update({ status }).eq("id", id).select("id");
  if (error || !(data || []).length) return alert(error ? error.message : "Not saved: only the Training Manager changes classes.");
  notify("class_notices", id);
  await scReload();
}

function scEdit(id) {
  scEditing = id;
  renderClassSchedule();
  $("scForm").scrollIntoView({ block: "start" });
  $("scCourse").focus();
}

document.addEventListener("change", (event) => {
  if (!event.target.closest("#scForm")) return;
  if (event.target.name === "scWhere" || event.target.id === "scLocation") return scShowWhere();
  if (event.target.id === "scCourse") {
    const course = allCourses.find(k => k.id === event.target.value);
    $("scHours").value = course && course.training_hours != null ? String(Number(course.training_hours)) : "";
    $("scAgco").checked = !!(course && course.counts_for_agco);
    return scCourseNote();
  }
  // A one-day class unless said otherwise.
  if (event.target.id === "scFirst" && (!$("scLast").value || $("scLast").value < event.target.value)) $("scLast").value = event.target.value;
});

document.addEventListener("click", async (event) => {
  const t = event.target;
  const save = t.closest("[data-cs-save]");
  if (save) return scSave(save, save.dataset.csSave || null);
  if (t.closest('[data-cs-act="new"]')) { scEditing = null; return renderClassSchedule(); }
  const edit = t.closest("[data-cs-edit]");
  if (edit) return scEdit(edit.dataset.csEdit);
  // From the Event Center: a class's calendar entry is changed on the class.
  const open = t.closest("[data-cs-open]");
  if (open) {
    if (!scClasses.some(c => c.id === open.dataset.csOpen)) await olderLoaders.classes();
    showTraining("classschedule");
    return scEdit(open.dataset.csOpen);
  }
  const find = (b) => scClasses.find(c => c.id === b);
  const cancel = t.closest("[data-cs-cancel]");
  if (cancel) {
    const c = find(cancel.dataset.csCancel);
    if (c && confirm(`Cancel ${c.title} on ${scDay(c.starts_on)}? It comes off the company calendar and the Open Seat Report. `
        + "You can put it back on the schedule later.")) await scSetStatus(c.id, "cancelled");
    return;
  }
  const restore = t.closest("[data-cs-restore]");
  if (restore) return scSetStatus(restore.dataset.csRestore, "scheduled");
  const remove = t.closest("[data-cs-delete]");
  if (remove) {
    const c = find(remove.dataset.csDelete);
    if (!c || !confirm(`Delete ${c.title} on ${scDay(c.starts_on)}${c.status === "cancelled" ? ", and its history" : ""}? This can't be undone.`)) return;
    const { data, error } = await db.from("scheduled_classes").delete().eq("id", c.id).select("id");
    if (error || !(data || []).length) return alert(error ? error.message : "Not deleted: only the Training Manager deletes classes.");
    if (scEditing === c.id) scEditing = null;
    await scReload();
  }
});
