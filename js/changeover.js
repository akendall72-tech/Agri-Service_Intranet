// Changeover (migration 0125)
//
// Stage 5 of moving training off the UKG uploads (docs/lms-plan.html): the
// Training Manager's steps from records built from the uploads to records
// built here. Upload one last time; take the history; a month side by side,
// watching the differences between the two; then switch. Switching back puts
// records on the uploads again. The database does the building and holds the
// rules; this shows where things stand and offers the next step.

let coDiffs = null, coDiffsError = null, coDiffsAt = null;

const coDay = (iso) => iso ? newsDate(String(iso).slice(0, 10)) : "";

function renderChangeover() {
  const box = $("changeover");
  if (!box) return;
  const src = tsSources || {};
  if (!("records_from" in src)) {
    box.innerHTML = `<div class="card"><p class="error">Run migration 0125_training_changeover.sql in the SQL editor, then reload this page.</p></div>`;
    return;
  }
  const here = src.records_from === "here";
  const summary = src.history_summary || {};
  const taken = !!src.history_taken_at;
  const creditRows = (tsRaw && tsRaw.credits && tsRaw.credits.rows) || [];
  // An upload from before 0125 keeps only the AGCO year's hours.
  const keepsPastYears = creditRows.some(r => Array.isArray(r.agcoAll));
  const exported = (block) => block && block.exported ? `exported ${esc(block.exported)}` : block && block.file ? "uploaded" : "not uploaded";
  const step = (n, title, done, body) => `<div class="co-step${done ? " done" : ""}">
      <div class="co-n" aria-hidden="true">${done ? icon("check", 16) : n}</div>
      <div class="co-body"><h3>${title}</h3>${body}</div></div>`;

  box.innerHTML = `
    <div class="card co-now${here ? " here" : ""}">
      <span class="co-label">Training records come from</span>
      <b>${here ? "This system" : "The UKG uploads"}</b>
      <p class="note">${here
        ? `Built here since ${esc(coDay(src.records_switched_at))}${src.records_switched_by_name ? ` (${esc(src.records_switched_by_name)})` : ""}:
           the history taken from UKG, and every credit given and class completed here. All employees is still uploaded; OLT and ILT and
           Credits All Time aren't. The AGCO year is ${esc((src.credits && src.credits.period) || "")}, and on January 1st everyone's hours
           start again from the new year's credits by themselves.`
        : `Each upload of All employees, Credits All Time and OLT and ILT rebuilds everyone's record, with the credits given and classes
           completed here added on. Nothing changes for anyone until you switch.`}</p>
    </div>

    <div class="card">
      <h2>${here ? "How it was switched" : "The steps"}</h2>
      ${step(1, "Upload one last time", keepsPastYears || here, `
        <p class="note">Credits All Time ${exported(src.credits)}; OLT and ILT ${exported(src.history)}. ${keepsPastYears
          ? "The credits upload keeps every year's AGCO hours, so past years go into the history too."
          : "Upload Credits All Time again on the Training Status tab: this version of the page keeps every year's AGCO hours, not only this year's, so past years go into the history."}</p>`)}
      ${step(2, "Take the history", taken, `
        <p class="note">${taken
          ? `Taken ${esc(coDay(src.history_taken_at))}${src.history_taken_by_name ? ` by ${esc(src.history_taken_by_name)}` : ""}:
             ${summary.classes ?? 0} courses completed and ${summary.agco ?? 0} AGCO entries${summary.past_years ? ` (${summary.past_years} from past years)` : ""},
             for ${summary.people ?? 0} people.`
          : "Copies everything the uploads hold into the training history: courses completed and AGCO hours. Records built here start from it. (EPA 609 is kept on its own tab.)"}
          ${here ? "" : " Take it again after each upload during the month side by side, and once more just before switching."}</p>
        ${here || !isTrainingManager() ? "" : `<div class="row"><button type="button" data-co-act="take"${src.credits && src.history ? "" : " disabled"}>${taken
          ? "Take it again from the latest uploads" : "Take the history"}</button><span class="msg"></span></div>`}`)}
      ${step(3, "A month side by side", here, `
        <p class="note">Keep uploading as usual. <b>Check the differences</b> builds everyone's record here and compares it with the
          uploads': a course only one has, or different AGCO hours. Right after taking the history there should be none. After that
          it shows what UKG has recorded since: give credit for anything that should carry on, or take the history again.</p>
        ${here ? "" : `<div class="row"><button type="button" class="ghost" data-co-act="diffs"${taken ? "" : " disabled"}>Check the differences</button>
          <span class="msg"></span></div>${coDiffsHtml()}`}`)}
      ${step(4, here ? "Switched" : "Switch", here, here
        ? `<p class="note">Records are built here. Switching back puts them on the UKG uploads again, rebuilt from the last ones straight
             away; upload OLT and ILT and Credits All Time to bring them up to date. Nothing given or completed here is lost either way.</p>
           ${isTrainingManager() ? `<div class="row"><button type="button" class="ghost" data-co-act="back">Switch back to the UKG uploads</button><span class="msg"></span></div>` : ""}`
        : `<p class="note">From then on, records are built here: OLT and ILT and Credits All Time stop being uploaded (All employees carries on),
             online courses taken in UKG need Give Credit, and the AGCO year follows the calendar. You can switch back.</p>
           ${isTrainingManager() ? `<div class="row"><button type="button" data-co-act="switch"${taken ? "" : " disabled"}>Build records here from now on</button><span class="msg"></span></div>` : ""}`)}
    </div>`;
}

function coDiffsHtml() {
  if (coDiffsError) return `<p class="error">${esc(coDiffsError)}</p>`;
  if (!coDiffs) return "";
  if (!coDiffs.length) {
    return `<p class="ok co-same">No differences: records built here match the uploads for everyone${coDiffsAt ? ` (checked ${esc(coDiffsAt)})` : ""}.</p>`;
  }
  const people = new Set(coDiffs.map(d => d.person_key)).size;
  return `<p class="note"><b>${coDiffs.length} ${coDiffs.length === 1 ? "difference" : "differences"}</b> for ${people} ${people === 1 ? "person" : "people"}${
    coDiffsAt ? ` (checked ${esc(coDiffsAt)})` : ""}.</p>
    <div style="overflow-x:auto"><table class="ts-table co-diffs">
      <thead><tr><th>Person</th><th>What</th><th>The uploads</th><th>Built here</th></tr></thead>
      <tbody>${coDiffs.map(d => `<tr><td><b>${esc(d.name)}</b><small>${esc(d.store || "")}</small></td><td>${esc(d.what)}</td>
        <td>${esc(d.in_uploads)}</td><td>${esc(d.built_here)}</td></tr>`).join("")}</tbody></table></div>`;
}

// After a switch: everything that reads the records, again.
async function coReload() {
  await loadTrainingStatus();
  safely(renderChangeover, renderTsImport, renderTsLive, renderTrainingOverview);
}

document.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-co-act]");
  if (!button) return;
  const row = button.closest(".row") || button.closest(".card");
  const act = button.dataset.coAct;

  if (act === "take") {
    button.disabled = true;
    speak(row, "Taking the history…", false);
    const { data, error } = await db.rpc("take_training_history");
    button.disabled = false;
    if (error) return speak(row, error.message, true);
    coDiffs = null;
    await coReload();
    speak(document.querySelector('[data-co-act="take"]').closest(".row"),
      `Taken: ${data.classes} courses and ${data.agco} AGCO entries.`, false);
    return;
  }

  if (act === "diffs") {
    button.disabled = true;
    speak(row, "Comparing everyone's records…", false);
    const { data, error } = await db.rpc("training_record_differences");
    button.disabled = false;
    coDiffsError = error ? error.message : null;
    coDiffs = error ? null : data || [];
    coDiffsAt = new Date().toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
    return renderChangeover();
  }

  if (act === "switch") {
    if (!confirm("Build training records here from now on? Everyone's record is rebuilt from the history and the credits now. "
      + "OLT and ILT and Credits All Time stop being uploaded; All employees carries on. You can switch back.")) return;
    button.disabled = true;
    speak(row, "Switching…", false);
    const { data, error } = await db.rpc("switch_training_records", { target: "here" });
    if (error) { button.disabled = false; return speak(row, error.message, true); }
    coDiffs = null;
    await coReload();
    speak(document.querySelector("#changeover .co-now"), `Switched. ${data} ${data === 1 ? "record was" : "records were"} rebuilt here.`, false);
    return;
  }

  if (act === "back") {
    if (!confirm("Switch back to the UKG uploads? Records are rebuilt from the last uploads now. Upload OLT and ILT and Credits All Time "
      + "to bring them up to date. Everything given and completed here stays on them.")) return;
    button.disabled = true;
    speak(row, "Switching back…", false);
    const { error } = await db.rpc("switch_training_records", { target: "ukg" });
    if (error) { button.disabled = false; return speak(row, error.message, true); }
    // Rebuilt from the uploads as they were last published, credits on top.
    // Only with the stored All employees list: publishing an empty list would
    // empty everyone's record.
    const people = tsRaw ? tsPeopleFromRaw(tsRaw) : [];
    if (people.length) {
      const { error: again } = await db.rpc("publish_training_status", { raw: {}, people });
      if (again) { await coReload(); return speak(document.querySelector("#changeover .co-now"), again.message, true); }
    }
    await coReload();
    speak(document.querySelector("#changeover .co-now"), people.length
      ? `Switched back. ${people.length} records were rebuilt from the last uploads; upload OLT and ILT and Credits All Time to bring them up to date.`
      : "Switched back. Upload All employees, Credits All Time and OLT and ILT on the Training Status tab to rebuild the records from UKG.", !people.length);
    return;
  }
});
