// Grade Classes (migration 0124)
//
// Stage 4 of moving training off the UKG uploads (docs/lms-plan.html). Once a
// class on the schedule has started, it's graded here, on its own page of the
// Training dashboard: attended or no-show, passed or not passed, and an
// optional score. Complete class gives everyone who passed a credit for the
// course, on their training record at once, with the class's hours and AGCO
// setting. A grade changed after that moves the credit with it. Someone on the
// waitlist who turned up is marked attended and moves onto the roster; a
// walk-in who isn't on the list at all is added first. The Training Manager
// grades; the database holds the rules.
//
// A grade changes one row and the save bar in place, never the whole page, so
// nothing moves under the pointer while grading. The Class Schedule keeps a
// line saying where each class stands, with a button that opens it here.

// The class open here, the grades changed and not saved yet (registration id
// -> { attendance, result, score }), and whether every completed class shows.
let cgOpen = null;
let cgDirty = {};
let cgAllDone = false;
const CG_DONE_SHOWN = 8;

const cgStarted = (c) => c.status === "scheduled" && c.starts_on <= tcToday();
const cgRegs = (c) => crRegs.filter(r => r.class_id === c.id && r.status !== "cancelled")
  .sort((a, b) => (a.status === "waitlisted") - (b.status === "waitlisted")
    || (a.status === "waitlisted" ? a.listed_at.localeCompare(b.listed_at) : crName(a).localeCompare(crName(b))));
// A registration's grade as it stands on the page: saved, with any change on top.
const cgGrade = (r) => ({ attendance: r.attendance || "", result: r.result || "", score: r.score ?? "", ...(cgDirty[r.id] || {}) });
// Who still needs attendance, or a result after attending.
const cgUngraded = (c) => cgRegs(c).filter(r => r.status === "registered")
  .filter(r => { const g = cgGrade(r); return !g.attendance || (g.attendance === "attended" && !g.result); });
const cgDirtyIn = (c) => Object.keys(cgDirty).filter(id => cgRegs(c).some(r => r.id === id)).length;
const cgClass = (id) => scClasses.find(x => x.id === id);

// The classes to grade, oldest first, and those completed, latest first.
function cgLists() {
  const started = scClasses.filter(cgStarted);
  const toGrade = started.filter(c => !c.completed_at).sort((a, b) => a.starts_on.localeCompare(b.starts_on) || a.title.localeCompare(b.title));
  const done = started.filter(c => c.completed_at).sort((a, b) => String(b.completed_at).localeCompare(String(a.completed_at)));
  return { toGrade, done };
}

// ---- on the Class Schedule ------------------------------------------------------------

// The line under a class that has started, saying where its grades stand.
function cgSummaryHtml(c) {
  if (!cgStarted(c)) return "";
  const regs = cgRegs(c).filter(r => r.status === "registered");
  const passed = regs.filter(r => r.result === "passed").length;
  const said = c.completed_at
    ? `<span class="badge b-current">Completed</span> ${passed} passed · ${regs.filter(r => r.result === "not_passed").length} not passed · ${
      regs.filter(r => r.attendance === "no_show").length} no-show`
    : `<span class="badge b-expiring">To grade</span> ${regs.length - cgUngraded(c).length} of ${regs.length} graded`;
  return `<div class="note cg-line">${said}</div>`;
}

// Opens the class on Grade Classes.
function cgButtonHtml(c) {
  if (!cgStarted(c)) return "";
  return `<button type="button" class="pdf" data-cg-go="${esc(c.id)}">${c.completed_at ? "Grades" : "Grade"} &rsaquo;</button>`;
}

// ---- the page ---------------------------------------------------------------------------

function renderClassGrades() {
  const box = $("classGrades");
  const { toGrade, done } = cgLists();
  const count = document.querySelector("[data-cg-count]");
  if (count) count.textContent = toGrade.length ? String(toGrade.length) : "";
  if (!box) return;
  if (scNotSetUp) {
    box.innerHTML = `<div class="card"><p class="error">Run migration 0122_class_schedule.sql in the SQL editor, then reload this page.</p></div>`;
    return;
  }
  if (!cgOpen || !cgClass(cgOpen) || !cgStarted(cgClass(cgOpen))) cgOpen = (toGrade[0] || done[0] || {}).id || null;
  const people = toGrade.reduce((n, c) => n + cgUngraded(c).length, 0);
  const shownDone = cgAllDone ? done : done.slice(0, CG_DONE_SHOWN);
  const c = cgOpen ? cgClass(cgOpen) : null;
  const manager = isTrainingManager();

  box.innerHTML = `<div class="sx cab-admin cg" style="${lit("teal")}">
    <section class="sx-hero">
      <div class="sx-hero-text">
        <span class="sx-kicker">Training · Records</span>
        <h2>Who came, and who passed</h2>
        <p>Once a class on the schedule has started, mark each person attended or no-show, and passed or not, with a score if you
          like. <b>Complete class</b> puts it on the training record of everyone who passed, with its hours${companyHas("agco")
          ? " and AGCO credit" : ""}, and tells everyone their result. A grade changed after moves the record with it.
          ${manager ? "" : "Only the Training Manager grades."}</p>
      </div>
    </section>
    <div class="sx-tiles">
      ${cabTile("To grade", sxNum(toGrade.length), toGrade.length ? `${people} ${people === 1 ? "person" : "people"} still to grade` : "Every class is graded",
        { colour: toGrade.length ? "amber" : "green", hot: toGrade.length > 0 })}
      ${cabTile("Completed", sxNum(done.length), done.length ? `Latest ${newsDate(String(done[0].completed_at).slice(0, 10))}` : "None yet",
        { colour: "green" })}
    </div>
    ${toGrade.length || done.length ? `<div class="cg-layout">
      <section class="sx-panel cg-classes" style="${lit("steel")}">
        <header><h3>Classes</h3></header>
        ${toGrade.length ? `<h4>To grade · ${toGrade.length}</h4>${toGrade.map(cgPickHtml).join("")}` : ""}
        ${done.length ? `<h4>Completed · ${done.length}</h4>${shownDone.map(cgPickHtml).join("")}
          ${done.length > shownDone.length ? `<button type="button" class="sx-link cg-more" data-cg-more>Show all ${done.length} &rsaquo;</button>` : ""}` : ""}
      </section>
      <section class="sx-panel cg-book" id="cgBook" style="${lit(c && c.completed_at ? "green" : "amber")}">${c ? cgBookHtml(c, manager) : ""}</section>
    </div>` : `<section class="sx-panel"><p class="sx-empty">No class on the schedule has started yet. Classes show here from their first
      day, to grade.</p></section>`}
  </div>`;
}

function cgPickHtml(c) {
  const regs = cgRegs(c).filter(r => r.status === "registered");
  const line = c.completed_at
    ? `${regs.filter(r => r.result === "passed").length} passed · ${regs.filter(r => r.result === "not_passed").length} not passed`
    : `${regs.length - cgUngraded(c).length} of ${regs.length} graded`;
  return `<button type="button" class="cg-pick${c.id === cgOpen ? " on" : ""}" data-cg-pick="${esc(c.id)}" aria-pressed="${c.id === cgOpen}">
    <b>${esc(c.title)}</b><span>${esc(scDay(c.starts_on))}${c.ends_on > c.starts_on ? ` – ${esc(scDay(c.ends_on))}` : ""} · ${esc(scPlace(c))}</span>
    <em data-cg-pick-line="${esc(c.id)}">${line}</em></button>`;
}

function cgBookHtml(c, manager) {
  const regs = cgRegs(c);
  const hours = c.training_hours != null ? `${tcHours(c.training_hours)} training ${Number(c.training_hours) === 1 ? "hour" : "hours"}` : "no training hours";
  return `<header><h3>${esc(c.title)}</h3><span>${esc(scWhen(c))}</span></header>
    <p class="sx-sub">${esc(scPlace(c))} · ${esc(hours)}${c.counts_for_agco ? " · AGCO credit" : ""}${c.instructor ? ` · ${esc(c.instructor)}` : ""}.
      ${c.completed_at
        ? `Completed ${esc(newsDate(String(c.completed_at).slice(0, 10)))}${c.completed_by_name ? ` by ${esc(c.completed_by_name)}` : ""}.
           Change a grade and save: passed puts the course on their record, not passed or no-show takes it off, and they're told.`
        : `Someone on the waitlist who came is marked attended and moves onto the roster.`}</p>
    ${regs.length ? `<div class="cg-people">${regs.map(r => cgRowHtml(r, manager)).join("")}</div>
      ${manager ? `<div class="row cg-quick">
        <button type="button" class="ghost" data-cg-all="attended">Mark everyone attended</button>
        <button type="button" class="ghost" data-cg-all="passed">Pass everyone who attended</button>
      </div>` : ""}` : `<p class="sx-empty">Nobody was registered.${manager ? " Add whoever came below." : ""}</p>`}
    ${manager ? cgWalkInHtml(c) : ""}
    ${manager ? `<div class="cg-bar" data-cg-bar="${esc(c.id)}">${cgBarHtml(c)}</div>` : ""}`;
}

// One person: two choices of attendance, two of result once they attended,
// and a score once there's a result. Clicking the chosen one again clears it.
function cgRowHtml(r, manager = isTrainingManager()) {
  const g = cgGrade(r), off = manager ? "" : " disabled";
  const seg = (field, value, label, enabled = true) => `<button type="button" class="cg-choice${g[field] === value ? " on" : ""}"
    data-cg-set="${field}" data-cg-value="${value}" aria-pressed="${g[field] === value}"${enabled && manager ? "" : " disabled"}>${label}</button>`;
  return `<div class="cg-person${cgDirty[r.id] ? " dirty" : ""}" data-cg-reg="${esc(r.id)}">
    <div class="cg-who"><b>${esc(crName(r))}</b>
      <span>${esc(r.store || "")}${r.status === "waitlisted" ? ` <i class="cg-tag">Waitlist</i>` : ""}${r.credit_id
        ? ` <i class="cg-tag ok" title="This course is on their training record">On record</i>` : ""}</span></div>
    <div class="cg-seg" role="group" aria-label="Attendance for ${esc(crName(r))}">
      ${seg("attendance", "attended", "Attended")}${seg("attendance", "no_show", "No-show")}</div>
    <div class="cg-seg" role="group" aria-label="Result for ${esc(crName(r))}">
      ${seg("result", "passed", "Passed", g.attendance === "attended")}${seg("result", "not_passed", "Not passed", g.attendance === "attended")}</div>
    <input type="number" class="cg-score" min="0" max="100" step="0.5" inputmode="decimal" data-cg-score aria-label="Score for ${esc(crName(r))}"
      value="${esc(g.score)}" placeholder="Score"${g.result && manager ? "" : " disabled"}${off}>
  </div>`;
}

// Save and Complete, held at the bottom of the gradebook as it scrolls.
function cgBarHtml(c) {
  const dirty = cgDirtyIn(c), ungraded = cgUngraded(c).length, regs = cgRegs(c);
  const state = dirty ? `${dirty} ${dirty === 1 ? "change" : "changes"} not saved`
    : c.completed_at ? "Every grade is saved." : ungraded ? `${ungraded} still to grade` : "Everyone is graded: complete the class.";
  return `<span class="cg-state${dirty ? " dirty" : ""}">${state}</span>
    <span class="msg" role="status"></span>
    <button type="button" data-cg-save="${esc(c.id)}"${dirty ? "" : " disabled"}>${dirty ? `Save ${dirty} ${dirty === 1 ? "grade" : "grades"}` : "Saved"}</button>
    ${c.completed_at ? "" : `<button type="button" class="cg-complete" data-cg-complete="${esc(c.id)}"${regs.length && !ungraded && !dirty ? "" : " disabled"}
      title="${ungraded ? `${ungraded} still to grade` : dirty ? "Save the grades first" : ""}">Complete class</button>`}`;
}

// Someone who came but wasn't on the list: added to the class, then graded.
function cgWalkInHtml(c) {
  return `<div class="cg-walkin">
      <label for="cgFind">Add someone who came</label>
      <input id="cgFind" type="text" enterkeyhint="search" autocomplete="off" data-cg-find="${esc(c.id)}"
        placeholder="Search by name, number or location">
      <div class="cr-matches"></div>
    </div>`;
}

function cgDrawMatches(input) {
  const c = cgClass(input.dataset.cgFind);
  const box = input.parentElement.querySelector(".cr-matches");
  const words = input.value.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length || !c) { box.innerHTML = ""; return; }
  const on = new Set(cgRegs(c).map(r => r.person_key));
  const found = tsPeople.filter(p => !on.has(p.person_key)
      && words.every(w => `${crName(p)} ${p.employee_number || ""} ${p.store || ""}`.toLowerCase().includes(w)))
    .sort((a, b) => crName(a).localeCompare(crName(b))).slice(0, 8);
  box.innerHTML = found.map(p => `<button type="button" class="tc-match" data-cg-walkin="${esc(p.person_key)}" data-cg-class="${esc(c.id)}">
      <b>${esc(crName(p))}</b><span>${esc([p.store, (p.job || "").replace(/^\d+\s*-\s*/, "")].filter(Boolean).join(" · "))}</span></button>`).join("")
    || `<p class="note">Nobody by that name who isn't on the class already.</p>`;
}

// ---- changing a grade, in place ---------------------------------------------------------

// A grade as it now stands for one person; kept until saved, unless it's back
// to what's saved. A result needs them to have attended, a score a result.
function cgSet(r, change) {
  const g = { ...cgGrade(r), ...change };
  if (g.attendance !== "attended") { g.result = ""; g.score = ""; }
  if (!g.result) g.score = "";
  const saved = { attendance: r.attendance || "", result: r.result || "", score: r.score == null ? "" : Number(r.score) };
  if (g.attendance === saved.attendance && g.result === saved.result && g.score === saved.score) delete cgDirty[r.id];
  else cgDirty[r.id] = g;
}

// Redraws one person's row, the bar and the class's line in the list; the
// page around them stays where it is.
function cgRefresh(c, r) {
  if (r) {
    const row = document.querySelector(`[data-cg-reg="${CSS.escape(r.id)}"]`);
    if (row) row.outerHTML = cgRowHtml(r);
  }
  const bar = document.querySelector(`[data-cg-bar="${CSS.escape(c.id)}"]`);
  if (bar) bar.innerHTML = cgBarHtml(c);
  const line = document.querySelector(`[data-cg-pick-line="${CSS.escape(c.id)}"]`);
  if (line && !c.completed_at) {
    const regs = cgRegs(c).filter(x => x.status === "registered");
    line.textContent = `${regs.length - cgUngraded(c).length} of ${regs.length} graded`;
  }
}

// After a save, a completion or a walk-in: everything read again, and the page
// drawn where it was.
async function cgAfter(classId, message) {
  notify("class_notices", classId);
  await Promise.all([loadScheduledClasses(), loadTrainingStatus(), loadTrainingCredits()]);
  await loadClassRegistrations();
  const y = window.scrollY;
  renderClassGrades();
  safely(renderClassSchedule, renderTsLive, renderGiveCredit);
  window.scrollTo(0, y);
  const bar = document.querySelector(`[data-cg-bar="${CSS.escape(classId)}"]`);
  if (bar && message) speak(bar, message, false);
}

document.addEventListener("input", (event) => {
  if (event.target.matches("[data-cg-find]")) return cgDrawMatches(event.target);
  if (!event.target.matches("[data-cg-score]")) return;
  // A score as it's typed: the row stays as it is, so the box keeps its place.
  const row = event.target.closest("[data-cg-reg]"), r = crRegs.find(x => x.id === row.dataset.cgReg);
  if (!r) return;
  const text = event.target.value;
  cgSet(r, { score: text === "" ? "" : Number(text) });
  row.classList.toggle("dirty", !!cgDirty[r.id]);
  cgRefresh(cgClass(r.class_id));
});

document.addEventListener("click", async (event) => {
  const t = event.target;
  // From the Class Schedule: open the class here.
  const go = t.closest("[data-cg-go]");
  if (go) {
    cgOpen = go.dataset.cgGo;
    const tab = document.querySelector('#trainingNav [data-tab="grades"]');
    if (tab) tab.click();
    return;
  }
  const pick = t.closest("[data-cg-pick]");
  if (pick) {
    cgOpen = pick.dataset.cgPick;
    const y = window.scrollY;
    renderClassGrades();
    window.scrollTo(0, y);
    // On a narrow screen the gradebook is below the list.
    if (window.matchMedia("(max-width: 900px)").matches) $("cgBook").scrollIntoView({ block: "start" });
    return;
  }
  if (t.closest("[data-cg-more]")) {
    cgAllDone = true;
    const y = window.scrollY;
    renderClassGrades();
    return window.scrollTo(0, y);
  }
  const choice = t.closest("[data-cg-set]");
  if (choice) {
    const r = crRegs.find(x => x.id === choice.closest("[data-cg-reg]").dataset.cgReg);
    if (!r) return;
    const field = choice.dataset.cgSet, value = choice.dataset.cgValue;
    cgSet(r, { [field]: cgGrade(r)[field] === value ? "" : value });
    return cgRefresh(cgClass(r.class_id), r);
  }
  const all = t.closest("[data-cg-all]");
  if (all) {
    const c = cgClass(cgOpen);
    cgRegs(c).forEach(r => {
      const g = cgGrade(r);
      if (all.dataset.cgAll === "attended" && r.status === "registered" && !g.attendance) cgSet(r, { attendance: "attended" });
      if (all.dataset.cgAll === "passed" && g.attendance === "attended" && !g.result) cgSet(r, { result: "passed" });
    });
    cgRegs(c).forEach(r => cgRefresh(c, r));
    return;
  }
  const save = t.closest("[data-cg-save]");
  if (save) {
    const id = save.dataset.cgSave, c = cgClass(id);
    const grades = Object.entries(cgDirty).filter(([reg]) => cgRegs(c).some(r => r.id === reg))
      .map(([registration, g]) => ({ registration, attendance: g.attendance || null, result: g.result || null,
        score: g.score === "" ? null : g.score }));
    const bar = save.closest("[data-cg-bar]");
    if (grades.some(g => g.score != null && !(g.score >= 0 && g.score <= 100))) return speak(bar, "A score is from 0 to 100.", true);
    save.disabled = true;
    speak(bar, "Saving…", false);
    const { error } = await db.rpc("grade_class", { target_class: id, grades });
    if (error) { save.disabled = false; return speak(bar, error.message, true); }
    grades.forEach(g => delete cgDirty[g.registration]);
    return cgAfter(id, c.completed_at ? "Saved. Their records follow, and they're told." : "Saved.");
  }
  const complete = t.closest("[data-cg-complete]");
  if (complete) {
    const c = cgClass(complete.dataset.cgComplete);
    const passed = cgRegs(c).filter(r => r.status === "registered" && cgGrade(r).result === "passed").length;
    if (!confirm(`Complete ${c.title}? ${passed} ${passed === 1 ? "person" : "people"} who passed get it on their training record, `
      + "and everyone is told their result. You can still change a grade after.")) return;
    complete.disabled = true;
    const { data, error } = await db.rpc("complete_class", { target_class: c.id });
    if (error) { complete.disabled = false; return speak(complete.closest("[data-cg-bar]"), error.message, true); }
    return cgAfter(c.id, `Completed: ${data.passed} passed, ${data.not_passed} not passed, ${data.no_show} no-show. `
      + `${data.passed ? "It's on their training records now." : ""}`);
  }
  const walkin = t.closest("[data-cg-walkin]");
  if (walkin) {
    walkin.disabled = true;
    const { error } = await db.rpc("register_for_class", { target_class: walkin.dataset.cgClass, people: [walkin.dataset.cgWalkin] });
    if (error) { walkin.disabled = false; return alert(error.message); }
    await loadClassRegistrations();
    // Added, and marked as having come.
    const reg = crRegs.find(r => r.class_id === walkin.dataset.cgClass && r.person_key === walkin.dataset.cgWalkin);
    if (reg) cgSet(reg, { attendance: "attended" });
    const y = window.scrollY;
    renderClassGrades();
    safely(renderClassSchedule);
    window.scrollTo(0, y);
  }
});
