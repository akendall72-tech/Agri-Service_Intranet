// The AGCO Training Catalog upload
//
// AGCO's Technical Training Catalog, the workbook AGCO sends its dealers, is
// uploaded once on the Training dashboard (Uploads, AGCO dealers only) and
// publishes both of the things in it:
//
//   its Open Seat Report sheet    AGCO Academy's sessions and their seats, on
//                                 the Open Seat Report's AGCO tab
//                                 (training_reports "agco", migration 0030)
//   its LEVEL 1 to LEVEL 6 tabs   the courses behind each level of AGCO
//                                 Development (agco_catalog, 0073), with every
//                                 technician's map worked out again from the
//                                 ticks (agcoPublishAll in agco-map.js)
//
// The file is read once, here in the browser, and nothing changes until
// Publish. A copy with only one of the two publishes that one and leaves the
// other as it is. Until Nov 2026 these were two uploads of the same file.

// The sessions read and waiting to publish. The catalog's courses wait in
// agcoPending (agco-map.js), which the ticking reads from while they wait.
let agcoSessionsPending = null;

// "2026-11-17", "10/19/2026" or an Excel day number. Anything else (the sheet
// has broken formulas in places) is no date, and shows as "Date TBD".
function agcoSheetDate(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return excelDate(value);
  const s = tsText(value);
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  if (/^\d+(\.\d+)?$/.test(s)) return excelDate(parseFloat(s));
  return null;
}

// ---- the Open Seat Report sheet ---------------------------------------------------
//
// "Open Seat Report  8-27-26" heads AGCO's block of sessions and "Raven Open
// Seat Report  8-27-26" Raven's; any other brand would work the same. Each
// block has a Class ID / Title / Status heading, then a row a session.

const agcoSessionHeading = (row) => ["class id", "title", "status"]
  .every(h => (row || []).some(c => tsText(c).toLowerCase() === h));
const agcoSheetRows = (workbook, name) =>
  XLSX.utils.sheet_to_json(workbook.Sheets[name], { header: 1, raw: true, defval: "" });

function agcoSessionsFrom(workbook, file) {
  // The sheet by its name, or, in a copy with just that sheet, by its columns.
  const named = workbook.SheetNames.find(n => /^open seat report$/i.test(n.trim()));
  const name = named || workbook.SheetNames.find(n => agcoSheetRows(workbook, n).some(agcoSessionHeading));
  if (!name) return null;
  const rows = agcoSheetRows(workbook, name);
  if (!rows.some(agcoSessionHeading)) return null;

  const sessions = [];
  let program = "AGCO", catalogDate = "";
  for (const row of rows) {
    const first = tsText(row[0]);
    const titleRow = first.match(/^(.*?)\s*open seat report\b(.*)$/i);
    if (titleRow) {
      program = titleRow[1].trim() || "AGCO";
      const date = titleRow[2].match(/(\d{1,2}-\d{1,2}-\d{2,4})\s*$/);
      if (date && !catalogDate) catalogDate = date[1];
      continue;
    }
    if (first.toLowerCase() === "class id") continue;
    const title = tsText(row[2]);
    if (!title) continue;
    const status = tsText(row[7]);
    const counts = status.match(/^(\d+)\s+of\s+(\d+)\s+enrolled/i);
    const registered = counts ? Number(counts[1]) : null;
    const capacity = counts ? Number(counts[2]) : null;
    sessions.push({
      program,
      classId: tsText(row[0]),
      title,
      description: tsText(row[1]) || null,
      facility: tsText(row[4]).replace(/\s*\([A-Za-z0-9_]+\)\s*$/, ""),
      startDate: agcoSheetDate(row[5]),
      endDate: agcoSheetDate(row[6]),
      status,
      registered,
      capacity,
      full: /^full$/i.test(status) || (counts !== null && registered >= capacity)
    });
  }
  if (!sessions.length) return null;
  sessions.sort((a, b) => (a.startDate || "9999").localeCompare(b.startDate || "9999"));
  return { file: file.name, catalogDate, sessions };
}

// ---- the LEVEL tabs ------------------------------------------------------------------

// The catalog's LEVEL 1 to LEVEL 6 tabs: each course's title and code. French
// copies of the Level 2 courses are left out — they're the same courses.
function agcoCatalogFrom(workbook, file) {
  const levels = AGCO_LEVELS.map(info => {
    const name = workbook.SheetNames.find(n => new RegExp(`^\\s*level\\s*${info.level}\\s*$`, "i").test(n));
    if (!name) return null;
    const rows = agcoSheetRows(workbook, name);
    const head = rows.findIndex(r => (r || []).some(c => tsText(c).toLowerCase() === "course title"));
    if (head < 0) return null;
    const titleAt = rows[head].findIndex(c => tsText(c).toLowerCase() === "course title");
    const seen = new Set();
    const courses = rows.slice(head + 1).map(r => {
      const cells = (r || []).map(tsText);
      const code = cells.find(c => AGCO_CODE.test(c)) || "";
      let title = cells[titleAt] || "";
      if (!title && /CRTMLP03/.test(code)) title = "Level 3: Application of Technical Theory";
      return { title: title || code, code };
    }).filter(c => c.title && !/^certification\s+technique/i.test(c.title))
      .filter(c => { const k = c.title.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
    return { ...info, courses };
  });
  if (levels.some(l => !l)) return null;
  // "Open Seat Report 9-23-26" heads the catalog's first data tab: the date it's from.
  let dated = "";
  const osr = workbook.SheetNames.find(n => /^open seat report$/i.test(n.trim()));
  if (osr && workbook.Sheets[osr] && workbook.Sheets[osr].A1) {
    const m = tsText(workbook.Sheets[osr].A1.v).match(/(\d{1,2}-\d{1,2}-\d{2,4})/);
    if (m) dated = m[1];
  }
  return { levels, source: { file: file.name, dated } };
}

// ---- reading the file -------------------------------------------------------------------

async function agcoReadFiles(files) {
  const problems = [];
  // A new file starts over: what was read before and not published goes.
  agcoPending = null;
  agcoSessionsPending = null;
  const box = $("agcoResult");
  if (box) box.innerHTML = `<p class="note" style="margin-top:12px">Reading ${files.length === 1 ? esc(files[0].name) : `${files.length} files`}…</p>`;
  for (const file of files) {
    try {
      const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
      const catalog = agcoCatalogFrom(workbook, file), sessions = agcoSessionsFrom(workbook, file);
      if (catalog) agcoPending = catalog;
      if (sessions) agcoSessionsPending = sessions;
      if (!catalog && !sessions) problems.push(`${file.name}: not AGCO's Technical Training Catalog. It needs the Open Seat Report sheet or the LEVEL 1 to LEVEL 6 tabs.`);
    } catch (e) {
      problems.push(`${file.name}: couldn't be read (${e.message}).`);
    }
  }
  renderAgcoImport(problems);
  renderAgcoTechs();
  renderAgcoRules();
  renderAgcoBales();
}

// "412 sessions (AGCO 380, Raven 32)".
function agcoSessionsSummary(sessions) {
  const by = new Map();
  sessions.forEach(s => by.set(s.program, (by.get(s.program) || 0) + 1));
  const n = sessions.length;
  return `${sxNum(n)} ${n === 1 ? "session" : "sessions"}${by.size > 1
    ? ` (${[...by].map(([program, count]) => `${program} ${sxNum(count)}`).join(", ")})` : ""}`;
}
const agcoLevelsSummary = (levels) => `${levels.map(l => `Level ${l.level} ${l.courses.length}`).join(", ")} courses`;

// ---- the tab ------------------------------------------------------------------------------

function renderAgcoImport(problems = []) {
  const box = $("agcoResult");
  if (!box) return;
  const catalog = agcoPending, sessions = agcoSessionsPending;
  if (!catalog && !sessions) {
    box.innerHTML = problems.map(p => `<p class="error" style="margin-top:12px">${esc(p)}</p>`).join("");
    return;
  }
  const levels = catalog ? agcoWithRules(catalog.levels) : [];
  const keys = new Set(levels.flatMap(l => l.courses.map(agcoCourseKey)));
  const orphaned = catalog ? new Set(agcoMarks.filter(m => !keys.has(m.course_key)).map(m => m.title)).size : 0;
  const file = catalog ? catalog.source.file : sessions.file;
  const dated = (catalog && catalog.source.dated) || (sessions && sessions.catalogDate) || "";
  const tick = (ok) => ok ? `<span class="ok">✓</span>` : `<span class="note">—</span>`;
  const line = (have, name, detail) => `<tr><td style="width:24px">${tick(have)}</td>
    <td><b>${name}</b><div class="note">${have ? detail : "Not in this file. What's published now stays."}</div></td></tr>`;
  box.innerHTML = `${problems.map(p => `<p class="error" style="margin-top:12px">${esc(p)}</p>`).join("")}
    <div class="role" style="margin-top:12px">
      <b>Ready to publish</b>
      <p class="note" style="margin:6px 0 4px">${esc(file)}${dated ? `, from ${esc(dated)}` : ""}.</p>
      <table style="margin:4px 0 10px"><tbody>
        ${line(!!sessions, "AGCO Academy sessions", sessions && `${agcoSessionsSummary(sessions.sessions)}, for the Open Seat Report's AGCO tab.`)}
        ${line(!!catalog, "AGCO Development courses", catalog && `${agcoLevelsSummary(levels)}${agcoAdded().length
          ? `, with the ${agcoAdded().length} added here` : ""}, for every technician's map.`)}
      </tbody></table>
      ${orphaned ? `<p class="note" style="margin:0 0 10px">${orphaned} ${orphaned === 1 ? "course that's" : "courses that are"} ticked
        for someone ${orphaned === 1 ? "isn't" : "aren't"} on this catalog. The ticks are kept, but they won't count toward a level
        until the course is back.</p>` : ""}
      <div class="row"><button data-act="agco-publish">Publish${catalog && sessions ? " both" : ""}</button>
        <button class="ghost" data-act="agco-discard">Discard</button><span class="msg"></span></div>
    </div>`;
}

function renderAgcoLive() {
  const box = $("agcoLive");
  if (!box) return;
  const migration = (error, number) => /does not exist|schema cache/i.test(error)
    ? `Run migration ${number} in the SQL editor, then reload this page.` : error;
  const when = (row) => new Date(row.updated_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  const agco = trainingReports.agco;
  const source = ((agcoCatalog && agcoCatalog.source) || {}).catalog || {};
  const levels = agcoWithRules((agcoCatalog && agcoCatalog.levels) || []);
  const sessionsLine = trainingReportsError ? `<span class="error">${esc(migration(trainingReportsError, "0030_training_reports.sql"))}</span>`
    : agco ? `${agcoSessionsSummary(agco.data.sessions || [])}${agco.source_note ? ` · ${esc(agco.source_note)}` : ""} · published ${when(agco)}`
    : "Nothing published yet.";
  const coursesLine = agcoError ? `<span class="error">${esc(migration(agcoError, "0073_agco_development_map.sql"))}</span>`
    : levels.length ? `${esc(source.file || "Technical Training Catalog")}${source.dated ? `, from ${esc(source.dated)}` : ""}: ${agcoLevelsSummary(levels)}${
      agcoAdded().length ? `, the ${agcoAdded().length} added here included` : ""}.`
    : "No catalog yet.";
  box.innerHTML = `<table><tbody>
      <tr><td><b>AGCO Academy sessions</b><div class="note">${sessionsLine}</div></td></tr>
      <tr><td><b>AGCO Development courses</b><div class="note">${coursesLine}</div></td></tr>
    </tbody></table>
    ${agco || levels.length ? `<div class="row" style="margin:10px 0 0">
      ${agco ? `<button type="button" class="pdf" data-view="openseat">See the Open Seat Report</button>` : ""}
      ${levels.length ? `<button type="button" class="ghost" data-act="agco-export">${icon("doc", 15)}Export the courses to CSV</button>` : ""}
    </div>` : ""}`;
}

// The catalog as the database holds it, for a spreadsheet: every course on each
// level, the ones added here included, and how many of today's technicians are
// ticked for it. What's published, not a catalog read and waiting to publish.
function agcoExportCsv() {
  const levels = agcoWithRules((agcoCatalog && agcoCatalog.levels) || []);
  const source = ((agcoCatalog && agcoCatalog.source) || {}).catalog || {};
  const techs = new Set(agcoTechs().map(t => t.person_key));
  const ticked = (c) => new Set(agcoMarks.filter(m => m.course_key === agcoCourseKey(c) && techs.has(m.person_key))
    .map(m => m.person_key)).size;
  downloadCSV(`AGCO Catalog ${new Date().toLocaleDateString("en-CA")}.csv`, [
    ["Level", "Level name", "Course title", "AGCO course code", "From", "Technicians ticked"],
    ...levels.flatMap(l => l.courses.map(c => [l.level, l.name, c.title, c.code || "",
      c.added ? "Added here" : [source.file || "Technical Training Catalog", source.dated].filter(Boolean).join(", "), ticked(c)]))
  ]);
}

// ---- publishing -------------------------------------------------------------------------
//
// The sessions first, then the courses and every map with them. If the second
// fails, the first stays published and the message says which.

async function agcoPublishSessions(sessions) {
  const row = { id: "agco", source_note: sessions.catalogDate ? `Catalog as of ${sessions.catalogDate}` : "",
    data: { version: 1, catalogDate: sessions.catalogDate, sessions: sessions.sessions } };
  const { data, error } = await db.from("training_reports").upsert(row, { onConflict: "company_id,id" }).select("*");
  if (error) {
    return /row-level/i.test(error.message) ? "Only an owner can publish the Open Seat Report."
      : /does not exist|schema cache/i.test(error.message) ? "Run migration 0030_training_reports.sql in the SQL editor first." : error.message;
  }
  if (!data || !data.length) return "Nothing was saved: only an owner can publish the Open Seat Report.";
  trainingReports = { ...trainingReports, agco: data[0] };
  return null;
}

$("admin").addEventListener("click", async (event) => {
  if (event.target.closest('button[data-act="agco-export"]')) return agcoExportCsv();
  const button = event.target.closest("button[data-act]");
  if (!button || !["agco-publish", "agco-discard"].includes(button.dataset.act)) return;
  if (button.dataset.act === "agco-discard") {
    agcoPending = null;
    agcoSessionsPending = null;
    renderAgcoTechs(); renderAgcoRules(); renderAgcoBales();
    return renderAgcoImport();
  }
  const box = button.closest(".role");
  const sessions = agcoSessionsPending, catalog = agcoPending;
  button.disabled = true;
  speak(box, "Publishing…", false);
  const sessionsProblem = sessions ? await agcoPublishSessions(sessions) : null;
  if (sessionsProblem) { button.disabled = false; return speak(box, sessionsProblem, true); }
  agcoSessionsPending = null;
  const catalogProblem = catalog ? await agcoPublishAll(catalog.source) : null;
  if (catalogProblem) {
    button.disabled = false;
    renderAgcoLive(); renderTrainingOverview();
    return speak(box, `${sessions ? "The sessions are published, but the courses aren't: " : ""}${catalogProblem}`, true);
  }
  agcoPending = null;
  renderAgcoImport(); renderAgcoLive(); renderAgcoTechs(); renderAgcoRules(); renderAgcoBales(); renderTrainingOverview();
  $("agcoResult").innerHTML = `<p class="ok" style="margin-top:12px">Published. ${[
    sessions && `AGCO Academy's ${agcoSessionsSummary(sessions.sessions)} are on the Open Seat Report`,
    catalog && `${agcoPeople.length} technicians have a map from the new courses, in the Training Center in the app and on this page`
  ].filter(Boolean).join(", and ")}.</p>`;
});

$("agcoFile").addEventListener("change", (e) => { if (e.target.files.length) agcoReadFiles([...e.target.files]); e.target.value = ""; });
["dragenter", "dragover"].forEach(type =>
  $("agcoDrop").addEventListener(type, (e) => { e.preventDefault(); $("agcoDrop").classList.add("over"); }));
["dragleave", "drop"].forEach(type =>
  $("agcoDrop").addEventListener(type, () => $("agcoDrop").classList.remove("over")));
$("agcoDrop").addEventListener("drop", (e) => { e.preventDefault(); if (e.dataTransfer.files.length) agcoReadFiles([...e.dataTransfer.files]); });
