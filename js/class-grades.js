// Grades (migration 0124)
//
// Stage 4 of moving training off the UKG uploads (docs/lms-plan.html). Once a
// class on the schedule has started, its roster becomes a gradebook on the
// Class Schedule: attended or no-show, passed or not passed, and an optional
// score. Complete class gives everyone who passed a credit for the course, on
// their training record at once, with the class's hours and AGCO setting. A
// grade changed after that moves the credit with it. Someone on the waitlist
// who turned up is marked attended and moves onto the roster; a walk-in who
// isn't on the list at all is added first. The Training Manager grades; the
// database holds the rules.

// The class whose gradebook is open, and the grades changed and not saved yet:
// registration id -> { attendance, result, score }.
let cgOpen = null;
let cgDirty = {};

const cgStarted = (c) => c.status === "scheduled" && c.starts_on <= tcToday();
const cgRegs = (c) => crRegs.filter(r => r.class_id === c.id && r.status !== "cancelled")
  .sort((a, b) => (a.status === "waitlisted") - (b.status === "waitlisted")
    || (a.status === "waitlisted" ? a.listed_at.localeCompare(b.listed_at) : crName(a).localeCompare(crName(b))));
// A registration's grade as it stands on the page: saved, with any change on top.
const cgGrade = (r) => ({ attendance: r.attendance || "", result: r.result || "", score: r.score ?? "", ...(cgDirty[r.id] || {}) });
// Who still needs attendance, or a result after attending.
const cgUngraded = (c) => cgRegs(c).filter(r => r.status === "registered")
  .filter(r => { const g = cgGrade(r); return !g.attendance || (g.attendance === "attended" && !g.result); });

// The line under the class, and the button that opens its gradebook.
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

function cgButtonHtml(c) {
  if (!cgStarted(c)) return "";
  return `<button type="button" class="pdf${cgOpen === c.id ? " on" : ""}" data-cg-open="${esc(c.id)}">${cgOpen === c.id
    ? "Close grades" : c.completed_at ? "Grades" : "Grade"}</button>`;
}

function cgBookHtml(c) {
  if (cgOpen !== c.id) return "";
  const regs = cgRegs(c);
  const dirty = Object.keys(cgDirty).filter(id => regs.some(r => r.id === id)).length;
  const ungraded = cgUngraded(c).length;
  const hours = c.training_hours != null ? `${tcHours(c.training_hours)} training ${Number(c.training_hours) === 1 ? "hour" : "hours"}` : "no training hours";
  const opt = (value, label, on) => `<option value="${value}"${on === value ? " selected" : ""}>${label}</option>`;
  const row = (r) => {
    const g = cgGrade(r);
    const credit = r.credit_id ? `<span class="badge b-current" title="This course is on their training record">On record</span>` : "";
    return `<tr data-cg-reg="${esc(r.id)}" class="${cgDirty[r.id] ? "cg-dirty" : ""}">
      <td><b>${esc(crName(r))}</b>${r.status === "waitlisted" ? ` <span class="badge b-none">Waitlist</span>` : ""}<small>${esc(r.store || "")}</small></td>
      <td><select data-cg="attendance" aria-label="Attendance for ${esc(crName(r))}">${opt("", "—", g.attendance)}${opt("attended", "Attended", g.attendance)}${opt("no_show", "No-show", g.attendance)}</select></td>
      <td><select data-cg="result" aria-label="Result for ${esc(crName(r))}"${g.attendance === "attended" ? "" : " disabled"}>${opt("", "—", g.result)}${opt("passed", "Passed", g.result)}${opt("not_passed", "Not passed", g.result)}</select></td>
      <td><input type="number" min="0" max="100" step="0.5" inputmode="decimal" data-cg="score" aria-label="Score for ${esc(crName(r))}"
        value="${esc(g.score)}" placeholder="Optional"${g.result ? "" : " disabled"}></td>
      <td>${credit}</td>
    </tr>`;
  };
  return `<div class="cg-book" data-cg-book="${esc(c.id)}">
      <h4 class="cr-head">Grades</h4>
      <p class="note">${c.completed_at
        ? `Completed ${esc(newsDate(String(c.completed_at).slice(0, 10)))}${c.completed_by_name ? ` by ${esc(c.completed_by_name)}` : ""}. Change a grade and save:
           passed puts the course on their record, not passed or no-show takes it off, and they're told.`
        : `Mark everyone attended or no-show, and passed or not. Complete class gives everyone who passed ${esc(c.title)} on their training
           record, with ${esc(hours)}${c.counts_for_agco ? " counting toward AGCO" : ""}, and tells them their result. Someone on the waitlist who
           came is marked attended and moves onto the roster.`}</p>
      ${regs.length ? `<div style="overflow-x:auto"><table class="ts-table cg-table">
        <thead><tr><th>Person</th><th>Attendance</th><th>Result</th><th>Score</th><th></th></tr></thead>
        <tbody>${regs.map(row).join("")}</tbody></table></div>
        <div class="row cg-quick">
          <button type="button" class="ghost" data-cg-all="attended">Mark everyone attended</button>
          <button type="button" class="ghost" data-cg-all="passed">Pass everyone who attended</button>
        </div>` : `<p class="note">Nobody was registered. Add whoever came below.</p>`}
      ${cgWalkInHtml(c)}
      <div class="row cg-bar">
        <button type="button" data-cg-save="${esc(c.id)}"${dirty ? "" : " disabled"}>${dirty ? `Save ${dirty} ${dirty === 1 ? "grade" : "grades"}` : "No changes to save"}</button>
        ${c.completed_at ? "" : `<button type="button" class="cg-complete" data-cg-complete="${esc(c.id)}"${regs.length && !ungraded && !dirty ? "" : " disabled"}
          title="${ungraded ? `${ungraded} still to grade` : dirty ? "Save the grades first" : ""}">Complete class</button>`}
        <span class="msg"></span>
      </div>
    </div>`;
}

// Someone who came but wasn't on the list: added to the class, then graded.
function cgWalkInHtml(c) {
  return `<div class="cg-walkin">
      <label for="cgFind-${esc(c.id)}">Add someone who came</label>
      <input id="cgFind-${esc(c.id)}" type="text" enterkeyhint="search" autocomplete="off" data-cg-find="${esc(c.id)}"
        placeholder="Search by name, number or location">
      <div class="cr-matches"></div>
    </div>`;
}

function cgDrawMatches(input) {
  const c = scClasses.find(x => x.id === input.dataset.cgFind);
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

// A changed field: kept until saved, and the result and score follow attendance.
function cgMark(tr) {
  const id = tr.dataset.cgReg, r = crRegs.find(x => x.id === id);
  if (!r) return;
  const attendance = tr.querySelector('[data-cg="attendance"]').value;
  const result = attendance === "attended" ? tr.querySelector('[data-cg="result"]').value : "";
  const scoreText = result ? tr.querySelector('[data-cg="score"]').value : "";
  const now = { attendance, result, score: scoreText === "" ? "" : Number(scoreText) };
  const saved = { attendance: r.attendance || "", result: r.result || "", score: r.score == null ? "" : Number(r.score) };
  if (now.attendance === saved.attendance && now.result === saved.result && now.score === saved.score) delete cgDirty[id];
  else cgDirty[id] = now;
}

async function cgAfter(classId, message) {
  notify("class_notices", classId);
  await Promise.all([loadScheduledClasses(), loadTrainingStatus(), loadTrainingCredits()]);
  await loadClassRegistrations();
  renderClassSchedule();
  safely(renderTsLive, renderGiveCredit);
  const book = document.querySelector(`[data-cg-book="${CSS.escape(classId)}"]`);
  if (book && message) speak(book, message, false);
}

document.addEventListener("change", (event) => {
  const tr = event.target.closest("[data-cg-reg]");
  if (!tr) return;
  cgMark(tr);
  renderClassSchedule();
});

document.addEventListener("input", (event) => {
  if (event.target.matches("[data-cg-find]")) cgDrawMatches(event.target);
});

document.addEventListener("click", async (event) => {
  const t = event.target;
  const open = t.closest("[data-cg-open]");
  if (open) {
    cgOpen = cgOpen === open.dataset.cgOpen ? null : open.dataset.cgOpen;
    return renderClassSchedule();
  }
  const all = t.closest("[data-cg-all]");
  if (all) {
    const c = scClasses.find(x => x.id === all.closest("[data-cg-book]").dataset.cgBook);
    cgRegs(c).forEach(r => {
      const g = cgGrade(r);
      if (all.dataset.cgAll === "attended" && r.status === "registered" && !g.attendance) cgDirty[r.id] = { ...g, attendance: "attended" };
      if (all.dataset.cgAll === "passed" && g.attendance === "attended" && !g.result) cgDirty[r.id] = { ...g, result: "passed" };
    });
    return renderClassSchedule();
  }
  const save = t.closest("[data-cg-save]");
  if (save) {
    const id = save.dataset.cgSave, c = scClasses.find(x => x.id === id);
    const grades = Object.entries(cgDirty).filter(([reg]) => cgRegs(c).some(r => r.id === reg))
      .map(([registration, g]) => ({ registration, attendance: g.attendance || null, result: g.result || null,
        score: g.score === "" ? null : g.score }));
    if (grades.some(g => g.score != null && !(g.score >= 0 && g.score <= 100))) {
      return speak(save.closest("[data-cg-book]"), "A score is from 0 to 100.", true);
    }
    save.disabled = true;
    const { error } = await db.rpc("grade_class", { target_class: id, grades });
    if (error) { save.disabled = false; return speak(save.closest("[data-cg-book]"), error.message, true); }
    grades.forEach(g => delete cgDirty[g.registration]);
    return cgAfter(id, c.completed_at ? "Saved. Their records follow, and they're told." : "Saved.");
  }
  const complete = t.closest("[data-cg-complete]");
  if (complete) {
    const c = scClasses.find(x => x.id === complete.dataset.cgComplete);
    const passed = cgRegs(c).filter(r => r.status === "registered" && cgGrade(r).result === "passed").length;
    if (!confirm(`Complete ${c.title}? ${passed} ${passed === 1 ? "person" : "people"} who passed get it on their training record, `
      + "and everyone is told their result. You can still change a grade after.")) return;
    complete.disabled = true;
    const { data, error } = await db.rpc("complete_class", { target_class: c.id });
    if (error) { complete.disabled = false; return speak(complete.closest("[data-cg-book]"), error.message, true); }
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
    if (reg) cgDirty[reg.id] = { ...cgGrade(reg), attendance: "attended" };
    renderClassSchedule();
  }
});
