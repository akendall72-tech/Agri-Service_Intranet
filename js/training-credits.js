// Give Credit and Course Credits (migration 0121)
//
// Stage 1 of moving training off the UKG uploads (docs/lms-plan.html). The
// Training Manager gives anyone credit for any course by hand, and sets each
// catalog course's training hours and whether they count as AGCO credit.
//
// A credit is written into the same training record everything already reads,
// so Training Status, the AGCO metric and reports, crane qualification and the
// forklift driving test count it at once. It keeps the hours and AGCO setting
// it was given with: changing a course later only changes what's given after.
// Each Training Status upload puts the credits back on the records it rebuilds.
// The AGCO development map isn't touched; it stays ticked by hand.

let tcCredits = [], tcError = null, tcNotSetUp = false, tcOlderLoaded = false, tcShowRemoved = false, tcSearch = "";
// The form in progress: the people picked, by their record's key.
let tcPicked = [];
// Course Credits rows changed and not saved yet: course id -> { training_hours, counts_for_agco }.
let ccDirty = {};

// How far back the list of credits loads; Show older brings the rest.
const TC_DAYS = 365;

async function loadTrainingCredits() {
  if (!isOwner()) return;
  const { data, error } = await allRows(() => db.from("training_credits").select("*")
    .gte("given_at", sinceDay(TC_DAYS)).order("given_at", { ascending: false }).order("id"));
  tcError = error ? error.message : null;
  tcNotSetUp = !!error && /does not exist|schema cache/i.test(error.message);
  if (error) return;
  const older = tcCredits.filter(c => c.given_at < sinceDay(TC_DAYS));
  tcCredits = (data || []).concat(older.filter(c => !(data || []).some(n => n.id === c.id)));
}

olderLoaders.credits = async () => {
  const { data, error } = await allRows(() => db.from("training_credits").select("*")
    .lt("given_at", sinceDay(TC_DAYS)).order("given_at", { ascending: false }).order("id"));
  if (!error) {
    tcCredits = tcCredits.concat((data || []).filter(c => !tcCredits.some(x => x.id === c.id)));
    tcOlderLoaded = true;
  }
  renderGiveCredit();
};

// ---- the course being given --------------------------------------------------------------

const tcKey = (name) => craneCourseKey(name);
// The name a course goes by on a record.
const tcRecordName = (course) => (course.record_name || "").trim() || course.title;
// A catalog course, by its title or its name on records.
const tcCourse = (typed) => {
  const key = tcKey(typed);
  return key ? allCourses.find(c => tcKey(c.title) === key || tcKey(tcRecordName(c)) === key) || null : null;
};
// What a course on a record counts for, beyond its hours.
function tcCounts(name) {
  const key = tcKey(name), counts = [];
  if (key && key === tcKey(craneCourse())) counts.push("Qualifies for crane work");
  if (key && key === tcKey(forkliftCourse())) counts.push("Opens the forklift driving test");
  return counts;
}
// Every course name worth offering: the catalog's, then any already on a record.
function tcCourseNames() {
  const names = new Map();
  allCourses.filter(c => c.is_active).forEach(c => names.set(tcKey(c.title), c.title));
  allCourses.forEach(c => names.set(tcKey(tcRecordName(c)), names.get(tcKey(c.title)) || tcRecordName(c)));
  tsPeople.forEach(p => (p.classes || []).forEach(k => { if (!names.has(tcKey(k.course))) names.set(tcKey(k.course), k.course); }));
  return [...names.values()].sort((a, b) => a.localeCompare(b));
}

const tcName = (p) => `${p.first_name || ""} ${p.last_name || ""}`.trim() || p.email || p.person_key;
const tcHours = (n) => Number(n || 0).toLocaleString("en-US", { maximumFractionDigits: 1 });
const tcToday = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Boise" });

// ---- Give Credit ---------------------------------------------------------------------------

function renderGiveCredit() {
  const box = $("giveCredit");
  if (!box) return;
  if (tcNotSetUp) {
    box.innerHTML = `<div class="card"><p class="error">Run migration 0121_give_credit.sql in the SQL editor, then reload this page.</p></div>`;
    return;
  }
  const typed = ($("tcCourse") || {}).value || "";
  box.innerHTML = `<div class="card tc-form" id="tcForm">
      <h2>Give credit</h2>
      <p class="note">For a course someone completed that UKG doesn't have: a class run on paper, one taken somewhere else, or an
        online course. It goes on their training record straight away and counts everywhere the uploads count. It stays through every
        Training Status upload.</p>
      <div class="fields">
        <div class="wide"><label for="tcCourse">Course</label>
          <input id="tcCourse" list="tcCourses" maxlength="200" autocomplete="off" value="${esc(typed)}"
            placeholder="Pick from the catalog, or type a course name">
          <datalist id="tcCourses">${tcCourseNames().map(n => `<option value="${esc(n)}">`).join("")}</datalist>
          <p class="note tc-course-note" id="tcCourseNote"></p></div>
        <div class="wide"><label for="tcFind">People</label>
          <div class="tc-picked" id="tcPicked"></div>
          <input id="tcFind" type="text" enterkeyhint="search" autocomplete="off" placeholder="Search by name, number or location">
          <div class="tc-matches" id="tcMatches"></div></div>
        <div><label for="tcDate">Completed on</label><input id="tcDate" type="date" max="${tcToday()}" value="${tcToday()}"></div>
        <div><label for="tcHours">Training hours</label><input id="tcHours" type="number" min="0" max="1000" step="0.5" inputmode="decimal">
          <p class="note">From the catalog. Change it here for this credit only.</p></div>
        <div><label>AGCO</label><label class="tc-check" for="tcAgco"><input id="tcAgco" type="checkbox"> Counts as AGCO credit</label></div>
        <div><label for="tcNote">Note (optional)</label><input id="tcNote" maxlength="500" placeholder="Paper roster on file"></div>
      </div>
      <div class="row"><button type="button" data-tc-act="give">Give credit</button><span class="msg"></span></div>
    </div>
    ${tcListHtml()}`;
  tcFillFromCourse(false);
  tcDrawPicked();
}

// The course chosen sets the hours and AGCO box, and says what it counts for.
function tcFillFromCourse(fill = true) {
  const input = $("tcCourse");
  if (!input) return;
  const course = tcCourse(input.value);
  const note = $("tcCourseNote");
  const counts = tcCounts(course ? tcRecordName(course) : input.value);
  note.innerHTML = [
    course && tcKey(tcRecordName(course)) !== tcKey(course.title) ? `<span>Goes on records as <b>${esc(tcRecordName(course))}</b>.</span>` : "",
    ...counts.map(c => `<span class="badge b-current">${esc(c)}</span>`),
    !course && input.value.trim() ? "<span>Not in the catalog: set its hours below.</span>" : ""
  ].filter(Boolean).join(" ");
  if (fill) {
    $("tcHours").value = course && course.training_hours != null ? String(Number(course.training_hours)) : "";
    $("tcAgco").checked = !!(course && course.counts_for_agco);
  }
}

function tcDrawPicked() {
  const box = $("tcPicked");
  if (!box) return;
  const byKey = new Map(tsPeople.map(p => [p.person_key, p]));
  box.innerHTML = tcPicked.map(k => `<button type="button" class="chip on" data-tc-unpick="${esc(k)}"
    aria-label="Take off ${esc(tcName(byKey.get(k) || {}))}">${esc(tcName(byKey.get(k) || { person_key: k }))} ×</button>`).join("");
  const button = document.querySelector('[data-tc-act="give"]');
  if (button) button.textContent = tcPicked.length > 1 ? `Give credit to ${tcPicked.length} people` : "Give credit";
}

function tcDrawMatches() {
  const words = ($("tcFind").value || "").toLowerCase().split(/\s+/).filter(Boolean);
  const box = $("tcMatches");
  if (!words.length) { box.innerHTML = ""; return; }
  const found = tsPeople.filter(p => !tcPicked.includes(p.person_key)
      && words.every(w => `${tcName(p)} ${p.employee_number || ""} ${p.store || ""} ${p.email || ""}`.toLowerCase().includes(w)))
    .sort((a, b) => tcName(a).localeCompare(tcName(b))).slice(0, 8);
  box.innerHTML = found.map(p => `<button type="button" class="tc-match" data-tc-pick="${esc(p.person_key)}">
      <b>${esc(tcName(p))}</b><span>${esc([p.store, (p.job || "").replace(/^\d+\s*-\s*/, ""), p.employee_number && `#${p.employee_number}`].filter(Boolean).join(" · "))}</span>
    </button>`).join("") || `<p class="note">Nobody by that name on the training roster. They need to be on the All Employees upload.</p>`;
}

function tcListHtml() {
  if (tcError && !tcNotSetUp) return `<div class="card"><p class="error">${esc(tcError)}</p></div>`;
  const q = tcSearch.toLowerCase();
  const removed = tcCredits.filter(c => c.removed_at).length;
  const shown = tcCredits.filter(c => (tcShowRemoved || !c.removed_at)
    && (!q || `${c.person_name} ${c.course} ${c.note} ${c.given_by_name}`.toLowerCase().includes(q)));
  return `<div class="card">
      <h2>Given by hand</h2>
      <div class="row" style="margin-bottom:10px">
        <input id="tcSearch" type="text" enterkeyhint="search" autocomplete="off" placeholder="Search people, courses or notes" value="${esc(tcSearch)}" style="max-width:320px">
        ${removed ? `<label class="tc-check" for="tcRemoved"><input id="tcRemoved" type="checkbox"${tcShowRemoved ? " checked" : ""}> Show removed (${removed})</label>` : ""}
      </div>
      ${shown.length ? `<div style="overflow-x:auto"><table class="ts-table tc-table">
        <thead><tr><th>Completed</th><th>Person</th><th>Course</th><th class="num">Hours</th><th>AGCO</th><th>Given</th><th></th></tr></thead>
        <tbody>${shown.map(c => `<tr class="${c.removed_at ? "tc-removed" : ""}">
          <td>${esc(newsDate(c.completed_on))}</td>
          <td>${esc(c.person_name || c.email || c.employee_number)}</td>
          <td>${esc(c.course)}${c.note ? `<small>${esc(c.note)}</small>` : ""}</td>
          <td class="num">${esc(tcHours(c.hours))}</td>
          <td>${c.counts_for_agco ? `<span class="badge b-current">AGCO</span>` : ""}</td>
          <td><small>${esc(c.given_by_name || "")} · ${esc(newsDate(String(c.given_at).slice(0, 10)))}</small>${c.removed_at
            ? `<small>Removed by ${esc(c.removed_by_name || "someone")}, ${esc(newsDate(String(c.removed_at).slice(0, 10)))}</small>` : ""}</td>
          <td>${c.removed_at || !isTrainingManager() ? "" : `<button type="button" class="pdf" data-tc-remove="${esc(c.id)}">Remove</button>`}</td>
        </tr>`).join("")}</tbody></table></div>`
        : `<p class="note">${tcCredits.length ? "Nothing matches." : "No credit given by hand yet."}</p>`}
      ${tcOlderLoaded ? "" : showOlderHtml("credits", "Show older credits", `Showing credits given in the last ${TC_DAYS} days.`)}
    </div>`;
}

async function tcGive(button) {
  const box = $("tcForm");
  const typed = $("tcCourse").value.trim();
  const course = tcCourse(typed);
  const name = course ? tcRecordName(course) : typed;
  const hoursText = $("tcHours").value, date = $("tcDate").value;
  const hours = Number(hoursText);
  if (!name) return speak(box, "Pick or type the course.", true);
  if (!tcPicked.length) return speak(box, "Pick at least one person.", true);
  if (!date) return speak(box, "Say when they completed it.", true);
  if (date > tcToday()) return speak(box, "The date completed can't be in the future.", true);
  if (hoursText === "" || !(hours >= 0 && hours <= 1000)) return speak(box, "Give the training hours, from 0 to 1000.", true);

  // The same course on the same day already on their record would count twice.
  const byKey = new Map(tsPeople.map(p => [p.person_key, p]));
  const already = tcPicked.filter(k => ((byKey.get(k) || {}).classes || [])
    .some(c => tcKey(c.course) === tcKey(name) && c.completed === date)).map(k => tcName(byKey.get(k)));
  if (already.length && !confirm(`${already.join(", ")} already ${already.length === 1 ? "has" : "have"} ${name} on ${newsDate(date)}. `
      + "Giving it again would count those hours twice. Give it anyway?")) return;

  button.disabled = true;
  speak(box, "Saving…", false);
  const { data, error } = await db.rpc("give_training_credit", {
    people: tcPicked, course: name, course_id: course ? course.id : null, completed_on: date,
    hours, counts_for_agco: $("tcAgco").checked, note: $("tcNote").value.trim()
  });
  button.disabled = false;
  if (error) return speak(box, error.message, true);
  const names = tcPicked.map(k => tcName(byKey.get(k) || { person_key: k }));
  const counts = tcCounts(name);
  tcPicked = [];
  await Promise.all([loadTrainingCredits(), loadTrainingStatus()]);
  renderGiveCredit();
  renderTsLive();
  $("tcCourse").value = "";
  tcFillFromCourse();
  const who = names.length > 2 ? `${names.length} people` : names.join(" and ");
  speak($("tcForm"), `Saved. ${who} ${names.length === 1 ? "has" : "have"} ${name}${counts.includes("Qualifies for crane work")
    ? `, and ${names.length === 1 ? "is" : "are"} now qualified for crane work` : ""}.${data !== names.length ? ` (${data} given.)` : ""}`, false);
}

document.addEventListener("input", (event) => {
  if (event.target.id === "tcCourse") tcFillFromCourse();
  if (event.target.id === "tcFind") tcDrawMatches();
  if (event.target.id === "tcSearch") {
    tcSearch = event.target.value;
    const card = event.target.closest(".card"), at = event.target.selectionStart;
    card.outerHTML = tcListHtml();
    const again = $("tcSearch");
    again.focus();
    again.setSelectionRange(at, at);
  }
});

document.addEventListener("change", (event) => {
  if (event.target.id === "tcRemoved") { tcShowRemoved = event.target.checked; return renderGiveCredit(); }
  const row = event.target.closest("[data-cc-course]");
  if (row) ccMark(row);
});

document.addEventListener("click", async (event) => {
  const pick = event.target.closest("[data-tc-pick]");
  if (pick) {
    tcPicked.push(pick.dataset.tcPick);
    $("tcFind").value = "";
    tcDrawMatches();
    tcDrawPicked();
    return $("tcFind").focus();
  }
  const unpick = event.target.closest("[data-tc-unpick]");
  if (unpick) { tcPicked = tcPicked.filter(k => k !== unpick.dataset.tcUnpick); return tcDrawPicked(); }
  const give = event.target.closest('[data-tc-act="give"]');
  if (give) return tcGive(give);
  const remove = event.target.closest("[data-tc-remove]");
  if (remove) {
    const credit = tcCredits.find(c => c.id === remove.dataset.tcRemove);
    if (!credit || !confirm(`Remove ${credit.course} from ${credit.person_name}'s record? It comes off their training record `
        + "and its hours stop counting. The list keeps a note that it was given and removed.")) return;
    remove.disabled = true;
    const { error } = await db.rpc("remove_training_credit", { credit: credit.id });
    if (error) { remove.disabled = false; return alert(error.message); }
    await Promise.all([loadTrainingCredits(), loadTrainingStatus()]);
    renderGiveCredit();
    return renderTsLive();
  }
  if (event.target.closest('[data-cc-act="save"]')) return ccSave(event.target.closest('[data-cc-act="save"]'));
  if (event.target.closest('[data-cc-act="undo"]')) { ccDirty = {}; return renderCourseCredits(); }
});

// ---- Course Credits ---------------------------------------------------------------------------
//
// Every course's training hours and AGCO credit on one page, to go through
// when AGCO's list changes. A credit already given keeps what it was given
// with; a change here applies to credit given from now on.

function renderCourseCredits() {
  const box = $("courseCredits");
  if (!box) return;
  if (coursesError) { box.innerHTML = `<div class="card"><p class="error">${esc(coursesError)}</p></div>`; return; }
  if (allCourses.length && !("training_hours" in allCourses[0])) {
    box.innerHTML = `<div class="card"><p class="error">Run migration 0121_give_credit.sql in the SQL editor, then reload this page.</p></div>`;
    return;
  }
  const value = (c, f) => (ccDirty[c.id] && f in ccDirty[c.id]) ? ccDirty[c.id][f] : c[f];
  const changed = Object.keys(ccDirty).length;
  box.innerHTML = `<div class="card">
      <h2>Course credits</h2>
      <p class="note">Each course's training hours, and whether they count toward AGCO's hours. When AGCO changes which courses count, change
        them here. Credit already given keeps the hours and AGCO setting it was given with; a change applies to credit given from now on.</p>
      ${allCourses.length ? `<div style="overflow-x:auto"><table class="ts-table cc-table">
        <thead><tr><th>Course</th><th class="num">Training hours</th><th>AGCO credit</th><th>Last changed</th></tr></thead>
        <tbody>${groupCourses(allCourses).map(([cat, courses]) => `<tr class="ts-group"><td colspan="4">${esc(cat)}</td></tr>
          ${courses.map(c => `<tr data-cc-course="${esc(c.id)}" class="${ccDirty[c.id] ? "cc-dirty" : ""}${c.is_active ? "" : " cc-off"}">
            <td><b>${esc(c.title)}</b>${c.is_active ? "" : ` <span class="badge b-none">Not showing</span>`}
              ${(c.record_name || "").trim() ? `<small>On records as ${esc(c.record_name)}</small>` : ""}
              ${tcCounts(tcRecordName(c)).map(t => `<small>${esc(t)}</small>`).join("")}</td>
            <td class="num"><input type="number" min="0" max="1000" step="0.5" inputmode="decimal" data-cc="training_hours"
              aria-label="Training hours for ${esc(c.title)}" value="${esc(value(c, "training_hours") ?? "")}"></td>
            <td><input type="checkbox" data-cc="counts_for_agco" aria-label="${esc(c.title)} counts as AGCO credit"${value(c, "counts_for_agco") ? " checked" : ""}></td>
            <td><small>${c.credits_changed_at ? `${esc(newsDate(String(c.credits_changed_at).slice(0, 10)))} · ${esc(c.credits_changed_by_name || "")}` : "Not changed yet"}</small></td>
          </tr>`).join("")}`).join("")}</tbody></table></div>` : `<p class="note">No courses in the catalog yet.</p>`}
      <div class="row cc-bar"><button type="button" data-cc-act="save"${changed ? "" : " disabled"}>${changed
        ? `Save ${changed} ${changed === 1 ? "change" : "changes"}` : "No changes to save"}</button>
        ${changed ? `<button type="button" class="ghost" data-cc-act="undo">Undo changes</button>` : ""}<span class="msg"></span></div>
    </div>`;
}

// A row edited: kept until saved, and the button counts it.
function ccMark(row) {
  const course = allCourses.find(c => c.id === row.dataset.ccCourse);
  if (!course) return;
  const hours = row.querySelector('[data-cc="training_hours"]').value;
  const now = { training_hours: hours === "" ? null : Number(hours), counts_for_agco: row.querySelector('[data-cc="counts_for_agco"]').checked };
  const same = (now.training_hours ?? null) === (course.training_hours == null ? null : Number(course.training_hours))
    && now.counts_for_agco === !!course.counts_for_agco;
  if (same) delete ccDirty[course.id]; else ccDirty[course.id] = now;
  row.classList.toggle("cc-dirty", !same);
  const changed = Object.keys(ccDirty).length, button = document.querySelector('[data-cc-act="save"]');
  button.disabled = !changed;
  button.textContent = changed ? `Save ${changed} ${changed === 1 ? "change" : "changes"}` : "No changes to save";
}

async function ccSave(button) {
  const card = button.closest(".card");
  const bad = Object.entries(ccDirty).find(([, v]) => v.training_hours != null && !(v.training_hours >= 0 && v.training_hours <= 1000));
  if (bad) return speak(card, "Training hours are a number from 0 to 1000.", true);
  button.disabled = true;
  speak(card, "Saving…", false);
  for (const [id, row] of Object.entries(ccDirty)) {
    const { data, error } = await db.from("courses").update(row).eq("id", id).select("id");
    if (error || !(data || []).length) {
      button.disabled = false;
      return speak(card, error ? error.message : "Not saved: only the Training Manager changes course credits.", true);
    }
  }
  const saved = Object.keys(ccDirty).length;
  ccDirty = {};
  await loadCourses();
  renderCourseCredits();
  renderCoursesAdmin();
  speak(document.querySelector("#courseCredits .card"), `Saved ${saved} ${saved === 1 ? "course" : "courses"}.`, false);
}
