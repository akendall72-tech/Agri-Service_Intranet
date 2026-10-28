// The AGCO Development Map
//
// The catalog, each technician's map and its levels, and the admin tabs for
// ticking courses, the level rules and publishing.

// ---------------------------------------------------------------- AGCO development map
//
// Where each technician is on AGCO's six levels of technical training
// (migration 0073), drawn as a road: a sign for each level, and a tractor
// where they are. Click a sign for the courses behind it.
//
// The courses come from AGCO's Technical Training Catalog, whose LEVEL tabs
// say what each level is made of; an owner uploads it on the admin page. The
// Training Manager then ticks, for each technician on the Training Status
// roster, the catalog courses they've completed (agco_course_marks, migration
// 0075). Each tick re-works that technician's map and saves it as their row,
// which is all the app and this page read (AgcoDevelopmentMapView.swift
// decides nothing).
//
// WHEN A LEVEL IS COMPLETE — agcoLevels below
//
//   1 and 2  every course on that tab of the catalog
//   3        either Application of Technical Theory or its online test-out
//   4 and 6  any one course at that level
//   5        as many as the owner's setting says: any one today
//            ({ "5": 1 } in agco_catalog.rules), a number, or all of them
//
//   A level that isn't complete while a higher one is shows red
//   ("required"): AGCO didn't hold to the order when the levels began, but it
//   does now. The tractor stops at the first level that isn't complete.

let agcoPeople = [], agcoCatalog = null, agcoMarks = [], agcoError = null;
// A catalog read on the admin page and not yet published.
let agcoPending = null;
// Which technician is open, which level's sign was clicked, and the picker's
// search and location.
const agcoState = { person: null, level: null, query: "", store: "all" };
// The same, for the technician being ticked on the admin page.
// By technician or by course, and within each what's open, searched and sorted.
const agcoEdit = { person: null, query: "", store: "all", mode: "people", course: null, courseQuery: "",
  courseSort: "level", show: "all" };

// What each level is, from the Training Center's requirements article.
const AGCO_LEVELS = [
  { level: 1, name: "Online System Foundations",
    takes: "Every Level 1 online course: the systems and theory behind AGCO's machines. Assigned to every service technician." },
  { level: 2, name: "Online System Foundations",
    takes: "Every Level 2 online course, building on Level 1 with components, operation and an introduction to diagnostics." },
  { level: 3, name: "Advanced Systems Training",
    takes: "Application of Technical Theory — five days, instructor-led at an AGCO facility — or its online test-out. Either one completes Level 3." },
  { level: 4, name: "Machine-Specific Training",
    takes: "A Level 4 course on a machine you work on: instructor-led and hands-on, at AGCO or here (Fendt tractors, large square balers, windrowers)." },
  { level: 5, name: "Advanced Technical Training",
    takes: "One of the two Level 5 courses — Electrical & Hydraulics, or Engines & Powertrains. Four days at an AGCO facility. Required before any Level 6 course." },
  { level: 6, name: "Expert Machine-Specific Training",
    takes: "A Level 6 Expert course: three days of advanced diagnostics, troubleshooting and repair on one machine." }
];

async function loadAgco() {
  const [people, catalog, marks] = await Promise.all([
    db.from("agco_development_people").select("*"),
    db.from("agco_catalog").select("*").eq("id", "current").maybeSingle(),
    db.from("agco_course_marks").select("*")
  ]);
  agcoError = people.error ? people.error.message : null;
  agcoPeople = (people.data || []).slice().sort((a, b) => (a.store || "").localeCompare(b.store || "")
    || (a.last_name || "").localeCompare(b.last_name || "") || (a.first_name || "").localeCompare(b.first_name || ""));
  agcoCatalog = catalog.error ? null : catalog.data;
  agcoMarks = marks.error ? [] : marks.data || [];   // owners only
}

const agcoName = (p) => `${p.first_name || ""} ${p.last_name || ""}`.trim();
// A map's key is its person's training key: their employee number, once uploaded.
const agcoMine = () => {
  const number = (profile && profile.employee_number) || "";
  const email = ((me && me.email) || "").toLowerCase();
  return (number && agcoPeople.find(p => p.person_key === number))
    || agcoPeople.find(p => email && (p.email || "").toLowerCase() === email) || null;
};
// The button is for technicians, and for the admins who look after them.
const agcoShowsButton = () => !agcoError && (agcoPeople.length > 0 || isAdmin());
const agcoLevelInfo = (n) => ((agcoCatalog && agcoCatalog.levels) || []).find(l => l.level === n)
  || AGCO_LEVELS.find(l => l.level === n) || { level: n, name: `Level ${n}`, takes: "", courses: [] };

// The owner's rules. Today only Level 5: how many of its courses complete it
// — a number, or "all".
const agcoRules = () => (agcoCatalog && agcoCatalog.rules) || {};
const agcoLevel5Rule = (rules = agcoRules()) => rules["5"] === "all" ? "all" : Math.max(1, Number(rules["5"]) || 1);

// How many of a level's courses complete it.
function agcoNeed(level, count, rules = agcoRules()) {
  if (level <= 2) return count;
  if (level === 5) { const rule = agcoLevel5Rule(rules); return rule === "all" ? count : Math.min(rule, count); }
  return Math.min(1, count);
}

// A course, the same whichever catalog it came from: its AGCO code, or its
// title for the Level 1 and 2 courses, which the catalog lists without one.
// The digits stay: "Level 1 … HVAC" and "Level 2 … HVAC" are two courses.
const agcoCourseKey = (c) => c.code ? String(c.code).toUpperCase()
  : `t:${String(c.title || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()}`;

// "Electrical & Hydraulics" from "Level 5 Master Professional Technician:
// Electrical & Hydraulics": what tells one course at a level from another.
const agcoCourseName = (title) => String(title || "").replace(/\(.*?\)/g, "").replace(/^[^:]*:\s*/, "").trim();

// ---- the haystack's labels
//
// Someone with every level complete gets a haystack under the flag: a bale for
// each Level 6 course ticked, labelled with its machine in a word or two.
// These are the catalog's Level 6 courses today. Anything else is shortened
// the same way, and an owner can change any label on the admin page
// (agco_catalog.rules.bales, by course).
const AGCO_BALES = {
  "fendt track tractors": "Fendt Track", "fendt wheel tractors": "Fendt Wheel",
  "fendt 900 series rogator": "Rogator 900", "fendt momentum planter": "Momentum",
  "ideal combines": "IDEAL", "gleaner combines": "Gleaner",
  "mf commercial round balers 4100v": "MF 4100V", "mf square balers": "MF Square",
  "mf rb146 156 round balers": "RB146/156", "mf windrowers": "MF Windrower",
  "massey ferguson compact tractors series": "MF Compact", "massey ferguson hhp series": "MF 5S–8S",
  "mf r500 sprayer": "MF R500", "terragator c series": "TerraGator C"
};
function agcoBaleAuto(title) {
  const name = agcoCourseName(title);
  const known = AGCO_BALES[name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()];
  if (known) return known;
  const words = name.replace(/massey ferguson/ig, "MF").replace(/\b(series|expert|technician|commercial)\b/ig, "")
    .replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  let label = "";
  for (const word of words) { if (label && `${label} ${word}`.length > 14) break; label = label ? `${label} ${word}` : word; }
  return label || "Level 6";
}
const agcoBaleLabel = (course, rules = agcoRules()) =>
  String((rules.bales || {})[agcoCourseKey(course)] || "").trim() || agcoBaleAuto(course.title);

// What Level 5 takes, in words that follow the setting.
function agcoLevel5Takes(courses, rule) {
  const names = (courses || []).map(c => agcoCourseName(c.title)).filter(Boolean);
  const n = names.length;
  const need = rule === "all" ? n : Math.min(rule, n || rule);
  const joined = n > 1 ? `${names.slice(0, -1).join(", ")} ${need === 1 ? "or" : "and"} ${names[n - 1]}` : names[0] || "";
  const lead = n > 1 && need >= n ? (n === 2 ? "Both Level 5 courses" : `All ${n} Level 5 courses`)
    : need === 1 ? (n === 2 ? "One of the two Level 5 courses" : n > 2 ? `One of the ${n} Level 5 courses` : "The Level 5 course")
    : `${need} of the ${n} Level 5 courses`;
  return `${lead}${joined ? ` — ${joined}` : ""}. Four days each at an AGCO facility. Required before any Level 6 course.`;
}

// Courses an owner added on the admin page — the Level 3 online test-out, a
// class AGCO hasn't listed yet (migration 0076). Kept apart from the
// catalog's own, so a new catalog keeps them.
const agcoAdded = () => (agcoCatalog && agcoCatalog.added_courses) || [];

// The levels as they're used: in order, the catalog's courses with the added
// ones after them (marked added), and today's words — AGCO_LEVELS, then the
// owner's rules — so a change to either needs no new upload.
const agcoWithRules = (levels, rules = agcoRules(), added = agcoAdded()) =>
  levels.slice().sort((a, b) => a.level - b.level).map(l => {
    const words = AGCO_LEVELS.find(a => a.level === l.level) || {};
    const own = (l.courses || []).filter(c => !c.added);
    const keys = new Set(own.map(agcoCourseKey));
    const courses = [...own, ...added.filter(c => c.level === l.level && !keys.has(agcoCourseKey(c)))
      .map(c => ({ title: c.title, code: c.code || "", added: true }))];
    const level = { ...l, courses, name: words.name || l.name, takes: words.takes || l.takes };
    return l.level === 5 ? { ...level, takes: agcoLevel5Takes(courses, agcoLevel5Rule(rules)) } : level;
  });

// The levels to tick against: a catalog waiting to publish, else the published one.
const agcoLevelsNow = () => agcoWithRules((agcoPending && agcoPending.levels)
  || (agcoCatalog && agcoCatalog.levels) || []);

// ---- working out a map --------------------------------------------------------------

// Each level's state, from the set of course keys ticked for one technician.
function agcoLevels(marked, levels, rules = agcoRules()) {
  const out = levels.map(info => {
    const courses = info.courses || [];
    const done = courses.filter(c => marked.has(agcoCourseKey(c))).length;
    const need = agcoNeed(info.level, courses.length, rules);
    return { level: info.level, have: Math.min(done, need), need, started: done > 0,
      complete: need > 0 && done >= need,
      missing: courses.filter(c => !marked.has(agcoCourseKey(c))).map(c => c.title) };
  });
  const top = Math.max(0, ...out.filter(l => l.complete).map(l => l.level));
  let reached = 0;
  while (reached < out.length && out[reached].complete) reached++;
  return {
    reached,
    levels: out.map(l => ({
      level: l.level,
      state: l.complete ? "done" : l.level < top ? "missing" : l.started ? "started" : "none",
      have: l.have, need: l.need, missing: l.complete ? [] : l.missing
    }))
  };
}

// One technician's row, as the app and the map read it.
function agcoPersonRow(tech, levels, marks = agcoMarks, rules = agcoRules()) {
  const mine = marks.filter(m => m.person_key === tech.person_key);
  const known = new Map(levels.flatMap(l => (l.courses || []).map(c => [agcoCourseKey(c), { level: l.level, course: c }])));
  const courses = mine.filter(m => known.has(m.course_key))
    .map(m => {
      const { level, course } = known.get(m.course_key);
      return { level, title: course.title, completed: m.marked_on || "",
        ...(level === 6 ? { bale: agcoBaleLabel(course, rules) } : {}) };
    })
    .sort((a, b) => a.level - b.level || a.title.localeCompare(b.title));
  const { reached, levels: states } = agcoLevels(new Set(mine.map(m => m.course_key)), levels, rules);
  return { person_key: tech.person_key, email: tech.email || "", first_name: tech.first_name || "",
    last_name: tech.last_name || "", name_key: tech.name_key || "", store: tech.store || "",
    reached, levels: states, courses };
}

const agcoTechs = () => tsPeople.filter(p => p.is_technician).sort((a, b) =>
  (a.store || "").localeCompare(b.store || "") || (a.last_name || "").localeCompare(b.last_name || ""));
const agcoTally = (people) => [0, 1, 2, 3, 4, 5, 6].map(n => people.filter(p => p.reached === n).length);

// Every technician's map, published in one step: after a new catalog, a rule
// change, or a new roster. The ticks stay as they are.
async function agcoPublishAll(catalogSource) {
  const levels = agcoLevelsNow();
  if (!levels.length) return "Upload the Technical Training Catalog first.";
  // The ticks as the database holds them now, not a copy from earlier.
  // Publishing Training Status can move them to a new key on the server (an
  // email to an employee number, 0098), and a stale copy then matched nobody:
  // every map was published empty.
  const fresh = await db.from("agco_course_marks").select("*");
  if (fresh.error) return fresh.error.message;
  agcoMarks = fresh.data || [];
  const old = (agcoCatalog && agcoCatalog.source) || {};
  const { error } = await db.rpc("publish_agco_development", {
    // Saved with the catalog's own courses only; the added ones live apart.
    catalog: { levels: levels.map(l => ({ ...l, courses: l.courses.filter(c => !c.added) })),
               source: { catalog: catalogSource || old.catalog || {} } },
    people: agcoTechs().map(t => agcoPersonRow(t, levels))
  });
  if (error) return error.message;
  await loadAgco();
  return null;
}

// Whether any technician's saved map disagrees with their ticks: no map, a map
// under a key nobody on the roster has any more, or a different number of
// courses on it. The maps are worked out on this page, so anything that
// changes the ticks or the keys without redrawing them leaves them behind.
function agcoMapsOutOfStep() {
  const levels = agcoLevelsNow();
  if (!levels.length || !tsPeople.length) return false;
  const known = new Set(levels.flatMap(l => (l.courses || []).map(agcoCourseKey)));
  const techs = agcoTechs(), keys = new Set(techs.map(t => t.person_key));
  if (agcoPeople.some(p => !keys.has(p.person_key))) return true;
  return techs.some(t => {
    const row = agcoPeople.find(p => p.person_key === t.person_key);
    const ticked = agcoMarks.filter(m => m.person_key === t.person_key && known.has(m.course_key)).length;
    return !row || (row.courses || []).length !== ticked;
  });
}

// Once a page load, for an owner: redraws every map if they've fallen out of
// step with the ticks. Quietly; the maps are the only thing it changes.
let agcoChecked = false;
async function agcoRepairMaps() {
  if (agcoChecked || !isOwner() || agcoError || !agcoCatalog) return;
  agcoChecked = true;
  if (!agcoMapsOutOfStep()) return;
  const problem = await agcoRebuild();
  if (problem) return console.error("redrawing the AGCO maps", problem);
  renderAgcoLive(); renderAgcoTechs();
  refreshShown();
}

// After a new roster is published. Returns what went wrong, if anything.
async function agcoRebuild() {
  if (!isOwner() || !agcoCatalog || !(agcoCatalog.levels || []).length) return null;
  return agcoPublishAll();
}

// ---- reading the catalog -----------------------------------------------------------

const AGCO_CODE = /^[A-Z]{5}[A-Z0-9]{10,20}$/;

// The catalog's LEVEL 1 to LEVEL 6 tabs: each course's title and code. French
// copies of the Level 2 courses are left out — they're the same courses.
function agcoCatalogFrom(workbook, file) {
  const levels = AGCO_LEVELS.map(info => {
    const name = workbook.SheetNames.find(n => new RegExp(`^\\s*level\\s*${info.level}\\s*$`, "i").test(n));
    if (!name) return null;
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[name], { header: 1, raw: true, defval: "" });
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

async function agcoReadFiles(files) {
  const problems = [];
  for (const file of files) {
    try {
      const catalog = agcoCatalogFrom(XLSX.read(await file.arrayBuffer(), { type: "array" }), file);
      if (catalog) agcoPending = catalog;
      else problems.push(`${file.name}: not AGCO's Technical Training Catalog — it needs the LEVEL 1 to LEVEL 6 tabs.`);
    } catch (e) {
      problems.push(`${file.name}: couldn't be read (${e.message}).`);
    }
  }
  renderAgcoImport(problems);
  renderAgcoTechs();
  renderAgcoRules();
  renderAgcoBales();
}

// ---- admin: the AGCO Development tab ----------------------------------------------

function renderAgcoImport(problems = []) {
  const box = $("agcoResult");
  if (!box) return;
  if (!agcoPending && !problems.length) { box.innerHTML = ""; return; }
  const levels = agcoPending ? agcoWithRules(agcoPending.levels) : [];
  const keys = new Set(levels.flatMap(l => l.courses.map(agcoCourseKey)));
  const orphaned = new Set(agcoMarks.filter(m => !keys.has(m.course_key)).map(m => m.title)).size;
  box.innerHTML = `${problems.map(p => `<p class="error">${esc(p)}</p>`).join("")}
    ${agcoPending ? `<div class="role" style="margin-top:12px">
      <b>Ready to publish</b>
      <p class="note" style="margin:6px 0 10px">${esc(agcoPending.source.file)}${agcoPending.source.dated
        ? `, from ${esc(agcoPending.source.dated)}` : ""}: ${levels.map(l => `Level ${l.level} ${l.courses.length}`).join(", ")}
        courses${agcoAdded().length ? `, with the ${agcoAdded().length} added here` : ""}.</p>
      ${orphaned ? `<p class="note" style="margin:0 0 10px">${orphaned} ${orphaned === 1 ? "course that's" : "courses that are"} ticked
        for someone ${orphaned === 1 ? "isn't" : "aren't"} on this catalog. The ticks are kept, but they won't count toward a level
        until the course is back.</p>` : ""}
      <div class="row"><button data-act="agco-publish">Publish</button>
        <button class="ghost" data-act="agco-discard">Discard</button><span class="msg"></span></div>
    </div>` : ""}`;
}

function renderAgcoLive() {
  const box = $("agcoLive");
  if (!box) return;
  if (agcoError) {
    box.innerHTML = `<p class="error">${/does not exist|schema cache/i.test(agcoError)
      ? "Run migration 0073_agco_development_map.sql in the SQL editor, then reload this page." : esc(agcoError)}</p>`;
    return;
  }
  const source = ((agcoCatalog && agcoCatalog.source) || {}).catalog || {};
  const levels = agcoWithRules((agcoCatalog && agcoCatalog.levels) || []);
  box.innerHTML = `<p class="note" style="margin:0"><b>In use:</b> ${levels.length
    ? `${esc(source.file || "Technical Training Catalog")}${source.dated ? `, from ${esc(source.dated)}` : ""} —
       ${levels.map(l => `Level ${l.level} ${l.courses.length}`).join(", ")} courses${agcoAdded().length
         ? `, the ${agcoAdded().length} added here included` : ""}.`
    : "no catalog yet."}</p>${levels.length ? `<div class="row" style="margin:10px 0 0">
      <button type="button" class="ghost" data-act="agco-export">${icon("doc", 15)}Export to CSV</button></div>` : ""}`;
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

$("admin").addEventListener("click", (event) => {
  if (event.target.closest('button[data-act="agco-export"]')) agcoExportCsv();
});

// ---- admin: ticking a technician's courses -------------------------------------------
//
// Only the Training Manager ticks (migration 0075 holds to it); other owners
// see the same lists with the boxes greyed out.

const agcoCanTick = () => isTrainingManager();
const agcoTrainingManager = () => {
  const holder = personDesignations.find(pd => pd.designation_id === "training_manager");
  return holder ? ((people.find(p => p.id === holder.person_id) || {}).full_name || "") : "";
};

const agcoRuleText = (level, count) => level <= 2 ? `Every course · ${count}`
  : level === 3 ? "Either one"
  : level === 5 ? (agcoLevel5Rule() === "all" ? (count === 2 ? "Both" : `All ${count}`)
    : agcoLevel5Rule() === 1 ? (count === 2 ? "Either one" : "Any one") : `Any ${agcoLevel5Rule()} of ${count}`)
  : "Any one";

function renderAgcoTechs() {
  const box = $("agcoTechs");
  if (!box) return;
  const levels = agcoLevelsNow();
  const techs = agcoTechs();
  if (!levels.length || !techs.length) {
    box.innerHTML = `<p class="note" style="margin:0">${!levels.length ? "Upload the Technical Training Catalog first."
      : "Publish All employees on the Training Status tab first — its technicians are who get a map."}</p>`;
    return;
  }
  const open = techs.find(t => t.person_key === agcoEdit.person);
  if (open) { box.innerHTML = agcoEditorHtml(open, levels); return; }

  const stores = [...new Set(techs.map(t => t.store || "No store"))].sort();
  if (agcoEdit.store !== "all" && !stores.includes(agcoEdit.store)) agcoEdit.store = "all";
  const modes = `<div class="chips" style="margin-bottom:12px">${[["people", "By technician"], ["course", "By course"]].map(([id, label]) =>
    `<button type="button" class="chip${agcoEdit.mode === id ? " on" : ""}" data-agco-mode="${id}">${label}</button>`).join("")}</div>`;
  if (agcoEdit.mode === "course") { box.innerHTML = modes + agcoCourseViewHtml(levels, techs, stores); return; }
  const q = agcoEdit.query.toLowerCase();
  const shown = techs.filter(t => (agcoEdit.store === "all" || (t.store || "No store") === agcoEdit.store)
    && (!q || agcoName(t).toLowerCase().includes(q)));
  const rows = techs.map(t => agcoPersonRow(t, levels));
  box.innerHTML = modes + `<p class="note" style="margin:0 0 10px">${techs.length} technicians. Furthest level reached:
      ${agcoTally(rows).map((n, i) => `${i ? `Level ${i}` : "not started"} ${n}`).join(", ")}.</p>
    <div class="row" style="margin-bottom:10px">
      <input class="search" id="agcoEditSearch" placeholder="Search technicians" value="${esc(agcoEdit.query)}" autocomplete="off"
             aria-label="Search technicians" style="flex:1;max-width:none">
      ${agcoShopSelect(stores)}
    </div>
    <div class="agco-edit-list">${shown.map(t => {
      const row = rows[techs.indexOf(t)];
      return `<button type="button" class="agco-edit-row" data-agco-edit="${esc(t.person_key)}">
        <span><b>${esc(agcoName(t))}</b><span class="note">${esc(t.store || "No store")}</span></span>
        <span class="agco-edit-signs">${row.levels.map(l => `<i class="${l.state}">${l.level}</i>`).join("")}</span>
        <span class="agco-edit-go">${agcoCanTick() ? "Tick courses" : "See courses"} &rsaquo;</span>
      </button>`;
    }).join("") || `<p class="note">No technician matches that.</p>`}</div>`;
}

function agcoEditorHtml(tech, levels) {
  const row = agcoPersonRow(tech, levels);
  const marks = new Map(agcoMarks.filter(m => m.person_key === tech.person_key).map(m => [m.course_key, m]));
  const state = (n) => row.levels.find(l => l.level === n) || {};
  return `<div class="agco-editor" data-agco-tech="${esc(tech.person_key)}" data-agco-say>
    <div class="row" style="justify-content:space-between;margin-bottom:6px">
      <button type="button" class="ghost" data-agco-edit="">&lsaquo; All technicians</button>
      <span class="msg"></span>
    </div>
    <h3 class="agco-editor-name">${esc(agcoName(tech))}</h3>
    <p class="note" style="margin:0 0 12px">${esc(tech.store || "No store")} · ${row.reached >= 6 ? "every level complete"
      : row.reached ? `Level ${row.reached} reached, Level ${row.reached + 1} next` : "Level 1 next"}. ${agcoCanTick()
      ? "Each tick saves, and the map changes with it."
      : `Only the Training Manager${agcoTrainingManager() ? ` (${esc(agcoTrainingManager())})` : ""} can tick courses.`}</p>
    ${levels.map(l => {
      const s = state(l.level);
      return `<fieldset class="agco-level-edit">
        <legend><span class="agco-edit-sign ${s.state}">${l.level}</span><b>${esc(l.name)}</b>
          <span class="note">${esc(agcoRuleText(l.level, l.courses.length))} · ${s.state === "done" ? "complete"
            : s.state === "missing" ? "required — a higher level is complete" : `${s.have} of ${s.need}`}</span></legend>
        ${l.courses.map(c => {
          const key = agcoCourseKey(c), mark = marks.get(key);
          return `<label class="check agco-course"><input type="checkbox" data-agco-mark="${esc(key)}" data-level="${l.level}"${
            mark ? " checked" : ""}${agcoCanTick() ? "" : " disabled"}><span>${esc(c.title)}${mark && mark.marked_on
            ? `<small>Ticked ${esc(usDate(mark.marked_on))}${mark.marked_by_name ? ` by ${esc(mark.marked_by_name)}` : ""}</small>` : ""}</span></label>`;
        }).join("")}
      </fieldset>`;
    }).join("")}
  </div>`;
}

// By course: every course with how many have it ticked, then one course with
// who has it and who doesn't — ticked from there, for everyone at a class.
const agcoShopSelect = (stores) => `<select id="agcoEditStore" style="width:auto;margin:0" aria-label="Location">${
  ["all", ...stores].map(s => `<option value="${esc(s)}"${agcoEdit.store === s ? " selected" : ""}>${
    s === "all" ? "All locations" : esc(s)}</option>`).join("")}</select>`;

function agcoCourseViewHtml(levels, techs, stores) {
  const onRoster = new Set(techs.map(t => t.person_key));
  const ticks = (key) => agcoMarks.filter(m => m.course_key === key && onRoster.has(m.person_key));
  const all = levels.flatMap(l => l.courses.map(c => ({ level: l.level, title: c.title, key: agcoCourseKey(c), added: !!c.added })));
  const open = all.find(c => c.key === agcoEdit.course);
  if (open) return agcoCourseDetailHtml(open, techs, ticks(open.key), stores);

  const count = new Map(all.map(c => [c.key, ticks(c.key).length]));
  const q = agcoEdit.courseQuery.toLowerCase();
  const list = all.filter(c => !q || c.title.toLowerCase().includes(q) || c.key.toLowerCase().includes(q));
  if (agcoEdit.courseSort === "most") list.sort((a, b) => count.get(b.key) - count.get(a.key) || a.level - b.level);
  if (agcoEdit.courseSort === "fewest") list.sort((a, b) => count.get(a.key) - count.get(b.key) || a.level - b.level);
  return `<div class="row" style="margin-bottom:10px">
      <input class="search" id="agcoCourseSearch" placeholder="Find a course by name or code" value="${esc(agcoEdit.courseQuery)}"
             autocomplete="off" aria-label="Find a course" style="flex:1;max-width:none">
      <select id="agcoCourseSort" style="width:auto;margin:0" aria-label="Sort courses">${[["level", "By level"],
        ["most", "Most ticked first"], ["fewest", "Fewest ticked first"]].map(([v, label]) =>
        `<option value="${v}"${agcoEdit.courseSort === v ? " selected" : ""}>${label}</option>`).join("")}</select>
    </div>
    <div class="agco-edit-list">${list.map(c => {
      const n = count.get(c.key);
      return `<button type="button" class="agco-edit-row agco-course-row" data-agco-course="${esc(c.key)}">
        <span class="agco-edit-sign">${c.level}</span>
        <span><b>${esc(c.title)}</b><span class="note">${n} of ${techs.length} ticked${c.added ? " · added here" : ""}</span></span>
        <span class="agco-course-meter" aria-hidden="true"><i style="width:${Math.round(100 * n / Math.max(1, techs.length))}%"></i></span>
        <span class="agco-edit-go">Who has it &rsaquo;</span>
      </button>`;
    }).join("") || `<p class="note">No course matches that.</p>`}</div>`;
}

function agcoCourseDetailHtml(course, techs, ticks, stores) {
  const has = new Map(ticks.map(m => [m.person_key, m]));
  const inShop = techs.filter(t => agcoEdit.store === "all" || (t.store || "No store") === agcoEdit.store);
  const yes = inShop.filter(t => has.has(t.person_key)), no = inShop.filter(t => !has.has(t.person_key));
  const shown = agcoEdit.show === "has" ? yes : agcoEdit.show === "not" ? no : inShop;
  return `<div data-agco-say>
    <div class="row" style="justify-content:space-between;margin-bottom:6px">
      <button type="button" class="ghost" data-agco-course="">&lsaquo; All courses</button>
      <span class="msg"></span>
    </div>
    <h3 class="agco-editor-name">${esc(course.title)}</h3>
    <p class="note" style="margin:0 0 12px">Level ${course.level}${course.added ? " · added here" : ""} · ticked for ${yes.length} of
      ${inShop.length} technicians${agcoEdit.store === "all" ? "" : ` at ${esc(agcoEdit.store)}`}. ${agcoCanTick()
      ? "Tick everyone who has completed it; each tick saves, and their map changes with it."
      : `Only the Training Manager${agcoTrainingManager() ? ` (${esc(agcoTrainingManager())})` : ""} can tick courses.`}</p>
    <div class="row" style="margin-bottom:10px">
      <div class="chips" style="margin:0">${[["all", "Everyone", inShop.length], ["has", "Has it", yes.length],
        ["not", "Hasn't", no.length]].map(([id, label, n]) => `<button type="button" class="chip${agcoEdit.show === id ? " on" : ""}"
        data-agco-show="${id}">${label} · ${n}</button>`).join("")}</div>
      ${agcoShopSelect(stores)}
    </div>
    <div class="agco-who">${shown.map(t => {
      const mark = has.get(t.person_key);
      return `<label class="check agco-course" data-agco-tech="${esc(t.person_key)}"><input type="checkbox"
          data-agco-mark="${esc(course.key)}" data-level="${course.level}"${mark ? " checked" : ""}${agcoCanTick() ? "" : " disabled"}>
        <span><b>${esc(agcoName(t))}</b> <span class="note">· ${esc(t.store || "No store")}</span>${mark && mark.marked_on
          ? `<small>Ticked ${esc(usDate(mark.marked_on))}${mark.marked_by_name ? ` by ${esc(mark.marked_by_name)}` : ""}</small>` : ""}</span></label>`;
    }).join("") || `<p class="note">${agcoEdit.show === "has" ? "Nobody here has it ticked yet." : "Everyone here has it ticked."}</p>`}</div>
  </div>`;
}

document.addEventListener("click", (event) => {
  const mode = event.target.closest("[data-agco-mode]");
  if (mode) { agcoEdit.mode = mode.dataset.agcoMode; agcoEdit.person = null; return renderAgcoTechs(); }
  const course = event.target.closest("[data-agco-course]");
  if (course) {
    agcoEdit.course = course.dataset.agcoCourse || null;
    agcoEdit.show = "all";
    renderAgcoTechs();
    return $("agcoTechCard").scrollIntoView({ block: "start" });
  }
  const show = event.target.closest("[data-agco-show]");
  if (show) { agcoEdit.show = show.dataset.agcoShow; return renderAgcoTechs(); }
  const pick = event.target.closest("[data-agco-edit]");
  if (!pick) return;
  agcoEdit.person = pick.dataset.agcoEdit || null;
  renderAgcoTechs();
  $("agcoTechCard").scrollIntoView({ block: "start" });
});

document.addEventListener("input", (event) => {
  const id = event.target.id;
  if (id !== "agcoEditSearch" && id !== "agcoCourseSearch") return;
  if (id === "agcoEditSearch") agcoEdit.query = event.target.value; else agcoEdit.courseQuery = event.target.value;
  const at = event.target.selectionStart;
  renderAgcoTechs();
  $(id).focus();
  $(id).setSelectionRange(at, at);
});

document.addEventListener("change", async (event) => {
  if (event.target.id === "agcoEditStore") { agcoEdit.store = event.target.value; return renderAgcoTechs(); }
  if (event.target.id === "agcoCourseSort") { agcoEdit.courseSort = event.target.value; return renderAgcoTechs(); }
  const box = event.target.closest("[data-agco-mark]");
  if (!box) return;
  // The technician: the open editor's, or the row's in the course view.
  const holder = box.closest("[data-agco-tech]");
  const editor = box.closest("[data-agco-say]");
  const tech = agcoTechs().find(t => t.person_key === holder.dataset.agcoTech);
  const levels = agcoLevelsNow();
  const level = levels.find(l => l.level === Number(box.dataset.level));
  const course = level && level.courses.find(c => agcoCourseKey(c) === box.dataset.agcoMark);
  if (!tech || !course) return;
  if (!agcoCanTick()) { box.checked = !box.checked; return; }
  const say = (text, bad) => speak(editor, text, bad);
  const key = agcoCourseKey(course);
  box.disabled = true;
  say("Saving…", false);
  let error;
  if (box.checked) {
    // Who and when are stamped by the database; this copy is for the page until it reloads.
    const mark = { person_key: tech.person_key, course_key: key, level: level.level, title: course.title };
    ({ error } = await db.from("agco_course_marks").upsert(mark, { onConflict: "person_key,course_key" }));
    if (!error) agcoMarks = [...agcoMarks.filter(m => !(m.person_key === tech.person_key && m.course_key === key)),
      { ...mark, marked_on: todayISO(), marked_by_name: (profile && profile.full_name) || "" }];
  } else {
    ({ error } = await db.from("agco_course_marks").delete().eq("person_key", tech.person_key).eq("course_key", key));
    if (!error) agcoMarks = agcoMarks.filter(m => !(m.person_key === tech.person_key && m.course_key === key));
  }
  if (error) {
    box.checked = !box.checked;
    box.disabled = false;
    return say(/does not exist|schema cache/i.test(error.message)
      ? "Run migration 0075_agco_ticked_courses.sql in the SQL editor first."
      : error.code === "42501" ? "Only the Training Manager can tick courses." : error.message, true);
  }
  // Their map, saved as soon as the tick is — if the catalog is published.
  if (agcoCatalog && (agcoCatalog.levels || []).length && !agcoPending) {
    const row = agcoPersonRow(tech, levels);
    const saved = await db.from("agco_development_people").upsert(row, { onConflict: "person_key" });
    if (saved.error) { box.disabled = false; return say(`Ticked, but the map wasn't updated: ${saved.error.message}`, true); }
    agcoPeople = [...agcoPeople.filter(p => p.person_key !== row.person_key), row];
  }
  const y = window.scrollY;
  renderAgcoTechs();
  renderAgcoLive();
  window.scrollTo(0, y);
  speak(document.querySelector("#agcoTechs [data-agco-say]"), `${box.checked ? "Ticked" : "Unticked"} for ${agcoName(tech)}.`, false);
});

// ---- admin: the level rules --------------------------------------------------------------

function renderAgcoRules() {
  const select = $("agcoLevel5Need");
  if (!select || document.activeElement === select) return;
  const five = agcoLevelsNow().find(l => l.level === 5);
  const n = five ? five.courses.length : 2;
  const rule = agcoLevel5Rule();
  const options = [[1, n === 2 ? "Either one of the two Level 5 courses" : "Any one Level 5 course"]];
  for (let k = 2; k < n; k++) options.push([k, `Any ${k} of the ${n} Level 5 courses`]);
  options.push(["all", n === 2 ? "Both Level 5 courses" : "Every Level 5 course on the catalog"]);
  select.innerHTML = options.map(([value, label]) =>
    `<option value="${value}"${String(rule) === String(value) ? " selected" : ""}>${esc(label)}</option>`).join("");
}

$("admin").addEventListener("click", async (event) => {
  const button = event.target.closest('button[data-act="agco-rules"]');
  if (!button) return;
  const card = $("agcoRulesCard");
  const value = $("agcoLevel5Need").value;
  const rule = value === "all" ? "all" : Number(value);
  button.disabled = true;
  speak(card, "Saving…", false);
  const { data, error } = await db.from("agco_catalog")
    .upsert({ id: "current", rules: { ...agcoRules(), 5: rule } }, { onConflict: "id" }).select("rules");
  if (error) { button.disabled = false; return speak(card, error.message, true); }
  if (!data || !data.length) { button.disabled = false; return speak(card, "Not saved — only an owner can change this.", true); }
  if (agcoCatalog) agcoCatalog.rules = data[0].rules; else agcoCatalog = { levels: [], rules: data[0].rules };
  const problem = agcoPending ? null : await agcoRebuild();
  button.disabled = false;
  renderAgcoLive(); renderAgcoTechs(); renderAgcoRules();
  if (problem) return speak(card, `Saved, but the maps weren't rebuilt: ${problem}`, true);
  const label = $("agcoLevel5Need").selectedOptions[0].textContent;
  speak(card, `Saved: ${label}. ${agcoPending ? "It applies when you publish the catalog waiting above." : "Every map has been rebuilt."}`, false);
});

// ---- admin: the haystack's labels -----------------------------------------------------

function renderAgcoBales() {
  const box = $("agcoBaleLabels");
  if (!box || box.contains(document.activeElement)) return;
  const six = agcoLevelsNow().find(l => l.level === 6);
  const bales = agcoRules().bales || {};
  box.innerHTML = six && six.courses.length ? six.courses.map((c, i) => `<div>
      <label for="agcoBale${i}">${esc(agcoCourseName(c.title) || c.title)}</label>
      <input id="agcoBale${i}" type="text" maxlength="16" data-agco-bale="${esc(agcoCourseKey(c))}"
             placeholder="${esc(agcoBaleAuto(c.title))}" value="${esc(bales[agcoCourseKey(c)] || "")}" autocomplete="off">
    </div>`).join("") : `<p class="note" style="margin:0">Upload the Technical Training Catalog first.</p>`;
}

$("admin").addEventListener("click", async (event) => {
  const button = event.target.closest('button[data-act="agco-bales"]');
  if (!button) return;
  const card = $("agcoBalesCard");
  // Only the ones that say something other than the automatic label are kept.
  const bales = {};
  card.querySelectorAll("[data-agco-bale]").forEach(input => {
    const value = input.value.trim().replace(/\s+/g, " ");
    if (value && value !== input.placeholder) bales[input.dataset.agcoBale] = value;
  });
  button.disabled = true;
  speak(card, "Saving…", false);
  const { data, error } = await db.from("agco_catalog")
    .upsert({ id: "current", rules: { ...agcoRules(), bales } }, { onConflict: "id" }).select("rules");
  if (error) { button.disabled = false; return speak(card, error.message, true); }
  if (!data || !data.length) { button.disabled = false; return speak(card, "Not saved — only an owner can change this.", true); }
  if (agcoCatalog) agcoCatalog.rules = data[0].rules; else agcoCatalog = { levels: [], rules: data[0].rules };
  const problem = agcoPending ? null : await agcoRebuild();
  button.disabled = false;
  renderAgcoBales();
  if (problem) return speak(card, `Saved, but the maps weren't rebuilt: ${problem}`, true);
  speak(card, "Saved. Every haystack has the new labels.", false);
});

// ---- admin: courses added to the catalog -------------------------------------------

function renderAgcoAdded() {
  const box = $("agcoAdded");
  if (!box) return;
  const added = agcoAdded().slice().sort((a, b) => a.level - b.level || a.title.localeCompare(b.title));
  box.innerHTML = added.length ? `<div class="agco-added">${added.map(c => {
      const key = agcoCourseKey(c);
      const ticked = agcoMarks.filter(m => m.course_key === key).length;
      return `<div class="agco-added-row" data-agco-added="${esc(key)}">
        <span class="agco-edit-sign done">${c.level}</span>
        <span><b>${esc(c.title)}</b><span class="note">${c.code ? `${esc(c.code)} · ` : ""}${ticked
          ? `ticked for ${ticked} ${ticked === 1 ? "technician" : "technicians"}` : "not ticked for anyone yet"}</span></span>
        <button type="button" class="ghost" data-act="agco-remove-course">Remove</button>
      </div>`;
    }).join("")}</div>` : `<p class="note" style="margin:0">None yet.</p>`;
}

// Saves the added courses, then re-works every map, since a level's courses changed.
async function agcoSaveAdded(list, where) {
  const { data, error } = await db.from("agco_catalog")
    .upsert({ id: "current", added_courses: list }, { onConflict: "id" }).select("added_courses");
  if (error) {
    return speak(where, /added_courses/i.test(error.message)
      ? "Run migration 0076_agco_added_courses.sql in the SQL editor first." : error.message, true);
  }
  if (!data || !data.length) return speak(where, "Not saved — only an owner can change the catalog.", true);
  if (agcoCatalog) agcoCatalog.added_courses = data[0].added_courses;
  else agcoCatalog = { levels: [], added_courses: data[0].added_courses };
  const problem = agcoPending ? null : await agcoRebuild();
  renderAgcoAdded(); renderAgcoImport(); renderAgcoLive(); renderAgcoTechs(); renderAgcoRules(); renderAgcoBales();
  return problem;
}

$("admin").addEventListener("click", async (event) => {
  const button = event.target.closest('button[data-act="agco-add-course"], button[data-act="agco-remove-course"]');
  if (!button) return;
  const card = $("agcoAddedCard");
  const say = (text, bad) => speak(card, text, bad);

  if (button.dataset.act === "agco-remove-course") {
    const key = button.closest("[data-agco-added]").dataset.agcoAdded;
    const course = agcoAdded().find(c => agcoCourseKey(c) === key);
    if (!course) return;
    const ticked = agcoMarks.filter(m => m.course_key === key).length;
    if (!confirm(`Remove "${course.title}" from Level ${course.level}?` + (ticked
      ? `\n\nIt's ticked for ${ticked} ${ticked === 1 ? "technician" : "technicians"}. The ticks are kept, but won't count `
        + "toward the level unless the course is added back." : ""))) return;
    button.disabled = true;
    const problem = await agcoSaveAdded(agcoAdded().filter(c => agcoCourseKey(c) !== key), card);
    if (problem) return say(`Removed, but the maps weren't rebuilt: ${problem}`, true);
    return say(`Removed "${course.title}". Every map has been rebuilt.`, false);
  }

  const level = Number($("agcoAddLevel").value);
  const title = $("agcoAddTitle").value.trim().replace(/\s+/g, " ");
  const code = $("agcoAddCode").value.trim().toUpperCase();
  if (!title) return say("Type the course's name, as AGCO names it.", true);
  if (code && !AGCO_CODE.test(code)) return say("That doesn't look like an AGCO course code — leave it blank if you don't have one.", true);
  const course = { level, title, ...(code ? { code } : {}) };
  const key = agcoCourseKey(course);
  // One course, one level: the same course twice would count twice.
  const clash = agcoLevelsNow().find(l => l.courses.some(c => agcoCourseKey(c) === key));
  if (clash) return say(`That course is already on Level ${clash.level}.`, true);
  button.disabled = true;
  say("Adding…", false);
  const problem = await agcoSaveAdded([...agcoAdded(), course], card);
  button.disabled = false;
  if (problem) return say(`Added, but the maps weren't rebuilt: ${problem}`, true);
  $("agcoAddTitle").value = "";
  $("agcoAddCode").value = "";
  say(`Added to Level ${level}. ${level <= 2 ? "Everyone now needs it to complete that level. " : ""}Every map has been rebuilt.`, false);
});

// ---- admin: publishing the catalog ------------------------------------------------------

$("admin").addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-act]");
  if (!button || !["agco-publish", "agco-discard"].includes(button.dataset.act)) return;
  if (button.dataset.act === "agco-discard") {
    agcoPending = null;
    renderAgcoTechs(); renderAgcoRules();
    return renderAgcoImport();
  }
  const box = button.closest(".role");
  button.disabled = true;
  speak(box, "Publishing…", false);
  const problem = await agcoPublishAll(agcoPending.source);
  button.disabled = false;
  if (problem) return speak(box, problem, true);
  agcoPending = null;
  renderAgcoImport(); renderAgcoLive(); renderAgcoTechs(); renderAgcoRules(); renderAgcoBales();
  $("agcoResult").innerHTML = `<p class="ok" style="margin-top:12px">Published. ${agcoPeople.length} technicians have a map,
    in the Training Center in the app and on this page.</p>`;
});

$("agcoFile").addEventListener("change", (e) => { agcoReadFiles([...e.target.files]); e.target.value = ""; });
["dragenter", "dragover"].forEach(type =>
  $("agcoDrop").addEventListener(type, (e) => { e.preventDefault(); $("agcoDrop").classList.add("over"); }));
["dragleave", "drop"].forEach(type =>
  $("agcoDrop").addEventListener(type, () => $("agcoDrop").classList.remove("over")));
$("agcoDrop").addEventListener("drop", (e) => { e.preventDefault(); agcoReadFiles([...e.dataTransfer.files]); });

// ---- the map ---------------------------------------------------------------------------
//
// One drawing, 360 wide, Level 1 at the top and the road winding down to
// Level 6 and the flag. The app draws it from the same numbers.

const AGCO_MAP = { width: 360, top: 70, row: 116, left: 112, right: 248, start: [180, 30] };
AGCO_MAP.finish = [180, AGCO_MAP.top + 6 * AGCO_MAP.row + 34];
AGCO_MAP.height = AGCO_MAP.finish[1] + 48;
const agcoPoint = (n) => n === 0 ? AGCO_MAP.start : n === 7 ? AGCO_MAP.finish
  : [n % 2 ? AGCO_MAP.left : AGCO_MAP.right, AGCO_MAP.top + (n - 0.5) * AGCO_MAP.row];

// The bend from one stop to the next, as a cubic curve.
function agcoBend(a, b) {
  const [x1, y1] = agcoPoint(a), [x2, y2] = agcoPoint(b), d = (y2 - y1) / 2;
  return [[x1, y1], [x1, y1 + d], [x2, y2 - d], [x2, y2]];
}
const agcoAt = (p, t) => {
  const u = 1 - t;
  return [0, 1].map(i => u * u * u * p[0][i] + 3 * u * u * t * p[1][i] + 3 * u * t * t * p[2][i] + t * t * t * p[3][i]);
};
// The first part of a bend, for the road already driven.
function agcoSplit(p, t) {
  const mix = (a, b) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  const a = mix(p[0], p[1]), b = mix(p[1], p[2]), c = mix(p[2], p[3]);
  const d = mix(a, b), e = mix(b, c);
  return [p[0], a, d, mix(d, e)];
}
const agcoCurve = (p) => `C${p[1].join(" ")} ${p[2].join(" ")} ${p[3].join(" ")}`;

// Where the tractor is: on its way to the next level, short of halfway so it
// clears that level's words — or at the flag.
const AGCO_TRACTOR_T = 0.42;
function agcoTractorSpot(reached) {
  return reached >= 6 ? AGCO_MAP.finish : agcoAt(agcoBend(reached, reached + 1), AGCO_TRACTOR_T);
}

const AGCO_TRACTOR = `<g class="agco-tractor-body">
    <path d="M7 4h14l3 10h19a3 3 0 0 1 3 3v6H7Z" fill="#CC0033" stroke="#7A0020" stroke-width="1"/>
    <path d="M10 7h9.5l2 7H10Z" fill="#CFE9F5" opacity=".9"/>
    <rect x="34" y="7.5" width="2.6" height="7" rx="1" fill="#1C2226"/>
    <circle cx="14" cy="25" r="10" fill="#111518" stroke="#3A454E" stroke-width="1"/>
    <circle cx="14" cy="25" r="4" fill="#A3AEB5"/>
    <circle cx="40" cy="28" r="6.5" fill="#111518" stroke="#3A454E" stroke-width="1"/>
    <circle cx="40" cy="28" r="2.4" fill="#A3AEB5"/>
  </g>`;

// A name in two lines when it's long, since SVG text doesn't wrap.
function agcoWrap(text, max = 23) {
  const words = text.toUpperCase().split(" "), lines = [""];
  words.forEach(w => {
    const line = lines[lines.length - 1];
    if (line && (line + " " + w).length > max) lines.push(w); else lines[lines.length - 1] = line ? `${line} ${w}` : w;
  });
  return lines.slice(0, 2);
}

const AGCO_STATE_TEXT = { done: "Complete", missing: "Required", started: "In progress", none: "Not started" };

function agcoStatusLine(level) {
  const counts = level.need > 1 ? ` · ${level.have} of ${level.need}` : "";
  return level.state === "missing" ? `Required before any Level ${level.level + 1}`
    : `${AGCO_STATE_TEXT[level.state] || "Not started"}${counts}`;
}

// The haystack: a pyramid, five bales at most to a row, the oldest at the bottom.
const AGCO_BALE = { w: 64, h: 28, gap: 4, rise: 31 };
function agcoStackRows(n) {
  const rows = [];
  let left = n;
  while (left > 15) { rows.push(5); left -= 5; }
  let size = 1;
  while (size * (size + 1) / 2 < left) size++;
  while (left > 0) { const take = Math.min(size, left); rows.push(take); left -= take; size = Math.max(1, size - 1); }
  return rows;
}
const agcoHaystackHeight = (n) => n ? 44 + agcoStackRows(n).length * AGCO_BALE.rise + 16 : 0;
const agcoBales = (person) => (person.reached || 0) < 6 ? [] : (person.courses || []).filter(c => c.level === 6)
  .sort((a, b) => String(a.completed).localeCompare(String(b.completed)) || a.title.localeCompare(b.title));

function agcoHaystackSvg(bales, top) {
  if (!bales.length) return "";
  const rows = agcoStackRows(bales.length);
  const ground = top + agcoHaystackHeight(bales.length) - 16;
  let next = 0;
  const stack = rows.map((count, r) => {
    const width = count * AGCO_BALE.w + (count - 1) * AGCO_BALE.gap;
    const y = ground - AGCO_BALE.h - r * AGCO_BALE.rise;
    return Array.from({ length: count }, (_, k) => {
      const bale = bales[next++];
      const x = AGCO_MAP.width / 2 - width / 2 + k * (AGCO_BALE.w + AGCO_BALE.gap);
      const label = bale.bale || agcoBaleAuto(bale.title);
      return `<g class="agco-bale"><title>${esc(bale.title)}</title>
        <rect x="${x}" y="${y}" width="${AGCO_BALE.w}" height="${AGCO_BALE.h}" rx="3"/>
        <line class="agco-twine" x1="${x + 9}" y1="${y + 2}" x2="${x + 9}" y2="${y + AGCO_BALE.h - 2}"/>
        <line class="agco-twine" x1="${x + AGCO_BALE.w - 9}" y1="${y + 2}" x2="${x + AGCO_BALE.w - 9}" y2="${y + AGCO_BALE.h - 2}"/>
        <text class="agco-bale-label${label.length > 11 ? " long" : ""}" x="${x + AGCO_BALE.w / 2}" y="${y + AGCO_BALE.h / 2 + 3}"
              text-anchor="middle">${esc(label)}</text>
      </g>`;
    }).join("");
  }).join("");
  return `<g class="agco-haystack">
    <text class="agco-haystack-head" x="${AGCO_MAP.width / 2}" y="${top + 24}" text-anchor="middle">THE HAYSTACK · ${bales.length}
      LEVEL 6 ${bales.length === 1 ? "COURSE" : "COURSES"}</text>
    <line class="agco-ground" x1="36" y1="${ground}" x2="${AGCO_MAP.width - 36}" y2="${ground}"/>
    ${stack}
  </g>`;
}

function agcoMapSvg(person) {
  const reached = person.reached || 0;
  const states = Object.fromEntries((person.levels || []).map(l => [l.level, l]));
  const bends = [0, 1, 2, 3, 4, 5, 6].map(n => agcoBend(n, n + 1));
  const road = `M${AGCO_MAP.start.join(" ")} ` + bends.map(agcoCurve).join(" ");
  const driven = `M${AGCO_MAP.start.join(" ")} ` + bends.slice(0, reached).map(agcoCurve).join(" ")
    + (reached < 6 ? " " + agcoCurve(agcoSplit(bends[reached], AGCO_TRACTOR_T)) : " " + agcoCurve(bends[6]));
  const [tx, ty] = agcoTractorSpot(reached);
  const selected = agcoState.level;

  const signs = [1, 2, 3, 4, 5, 6].map(n => {
    const level = states[n] || { level: n, state: "none" };
    const info = agcoLevelInfo(n);
    const [x, y] = agcoPoint(n);
    const left = n % 2 === 1;
    const sx = left ? x - 66 : x + 66;            // the sign, on the outside of the bend
    const lx = left ? x + 34 : 16;                 // its words, on the inside
    const name = agcoWrap(info.name);
    return `<g class="agco-sign ${level.state}${selected === n ? " on" : ""}" data-agco-level="${n}"
        role="button" tabindex="0" aria-label="Level ${n}, ${esc(info.name)}: ${esc(agcoStatusLine(level))}">
      <rect class="agco-hit" x="${Math.min(sx - 32, lx) - 4}" y="${y - 40}" width="${left ? lx + 210 - (sx - 32) : sx + 36 - lx}"
            height="76" rx="12"/>
      <line class="agco-post" x1="${sx}" y1="${y - 4}" x2="${sx}" y2="${y + 30}"/>
      <rect class="agco-plate" x="${sx - 27}" y="${y - 34}" width="54" height="40" rx="7"/>
      <rect class="agco-plate-line" x="${sx - 24}" y="${y - 31}" width="48" height="34" rx="5"/>
      <text class="agco-plate-small" x="${sx}" y="${y - 20}" text-anchor="middle">LEVEL</text>
      <text class="agco-plate-big" x="${sx}" y="${y - 1}" text-anchor="middle">${n}</text>
      ${level.state === "done"
        ? `<circle class="agco-check" cx="${sx + 24}" cy="${y - 32}" r="8"/>
           <path class="agco-check-mark" d="M${sx + 20} ${y - 32}l2.8 2.8 5-5.4"/>`
        : level.state === "missing"
        ? `<circle class="agco-alert" cx="${sx + 24}" cy="${y - 32}" r="8"/>
           <text class="agco-alert-mark" x="${sx + 24}" y="${y - 28}" text-anchor="middle">!</text>` : ""}
      <text class="agco-label-level" x="${lx}" y="${y - 22}">LEVEL ${n}</text>
      ${name.map((line, i) => `<text class="agco-label-name" x="${lx}" y="${y - 4 + i * 17}">${esc(line)}</text>`).join("")}
      <text class="agco-label-status" x="${lx}" y="${y + 13 + (name.length - 1) * 17}">${esc(agcoStatusLine(level))}</text>
    </g>`;
  }).join("");

  const [fx, fy] = AGCO_MAP.finish;
  const bales = agcoBales(person);
  const height = AGCO_MAP.height + agcoHaystackHeight(bales.length);
  return `<svg class="agco-map" viewBox="0 0 ${AGCO_MAP.width} ${height}" role="img"
      aria-label="Road map of AGCO's six training levels. ${esc(agcoName(person))} has reached ${reached ? `Level ${reached}` : "the start"}${
      bales.length ? `, with ${bales.length} Level 6 ${bales.length === 1 ? "course" : "courses"} in the haystack` : ""}.">
    <defs>
      <pattern id="agcoGrid" width="24" height="24" patternUnits="userSpaceOnUse">
        <path d="M24 0H0V24" fill="none" stroke="rgba(255,255,255,.045)" stroke-width="1"/>
      </pattern>
      <linearGradient id="agcoStraw" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#EDCF72"/><stop offset="1" stop-color="#C99A35"/>
      </linearGradient>
    </defs>
    <rect width="100%" height="100%" fill="url(#agcoGrid)"/>
    <path class="agco-road-edge" d="${road}"/>
    <path class="agco-road" d="${road}"/>
    <path class="agco-road-line" d="${road}"/>
    <path class="agco-driven-glow" d="${driven}"/>
    <path class="agco-driven" d="${driven}"/>
    <g class="agco-start" transform="translate(${AGCO_MAP.start[0]} ${AGCO_MAP.start[1] - 4})">
      <rect x="-26" y="-12" width="52" height="18" rx="9"/><text y="1" text-anchor="middle">START</text>
    </g>
    <g class="agco-flag" transform="translate(${fx + 32} ${fy - 30})">
      <line x1="0" y1="0" x2="0" y2="34"/>
      <path d="M0 1h22v14H0Z" fill="#fff"/>
      <path d="M0 1h5.5v3.5H0ZM11 1h5.5v3.5H11ZM5.5 4.5H11V8H5.5ZM16.5 4.5H22V8h-5.5ZM0 8h5.5v3.5H0ZM11 8h5.5v3.5H11ZM5.5 11.5H11V15H5.5ZM16.5 11.5H22V15h-5.5Z" fill="#111518"/>
    </g>
    <text class="agco-finish" x="${fx - 18}" y="${fy + 30}" text-anchor="end">EXPERT TECHNICIAN</text>
    ${signs}
    ${agcoHaystackSvg(bales, AGCO_MAP.height - 8)}
    <g class="agco-tractor" transform="translate(${tx} ${ty})">
      <circle class="agco-halo" r="25"/>
      <g transform="translate(-26 -19)">${AGCO_TRACTOR}</g>
    </g>
  </svg>`;
}

// "Level 1 Technical Certification: Engines Course" is just "Engines Course"
// under the Level 1 sign.
const agcoShort = (title) => String(title || "").replace(/^"?\s*level\s*[12]\s*technical\s*certification\s*:\s*/i, "");

// One level: what it takes, what's done, what's left.
function agcoLevelPanel(person, n) {
  const info = agcoLevelInfo(n);
  const level = (person.levels || []).find(l => l.level === n) || { level: n, state: "none" };
  const courses = (person.courses || []).filter(c => c.level === n);
  const course = (c) => `<li><b>${esc(agcoShort(c.title))}</b>${c.completed
    ? `<span>Ticked ${esc(usDate(c.completed))}</span>` : ""}</li>`;
  return `<div class="agco-panel" data-state="${level.state}" id="agcoPanel">
    <div class="agco-panel-head">
      <span class="agco-mini ${level.state}">${n}</span>
      <div><span class="agco-panel-level">Level ${n} · ${esc(AGCO_STATE_TEXT[level.state] || "Not started")}</span>
        <h2>${esc(info.name)}</h2></div>
    </div>
    <p class="agco-takes">${esc(info.takes || (AGCO_LEVELS.find(l => l.level === n) || {}).takes || "")}</p>
    ${level.need > 1 ? `<div class="agco-meter"><span><i style="width:${Math.round(100 * level.have / Math.max(1, level.need))}%"></i></span>
      <b>${level.have} of ${level.need}</b></div>` : ""}
    ${level.state === "missing" ? `<p class="agco-note required">${icon("info", 15)}<span>Level ${n} is required before
      any Level ${n + 1} course can be taken. AGCO didn't hold to that order when the levels began, so a higher level can be
      complete without it — but this one is still needed.</span></p>` : ""}
    <div class="agco-sub">Completed${courses.length ? ` · ${courses.length}` : ""}</div>
    ${courses.length ? `<ul class="agco-courses">${courses.map(course).join("")}</ul>`
      : `<p class="agco-none">Nothing at this level is marked complete yet.</p>`}
    ${level.missing && level.missing.length ? (() => {
      // "Still to do" when every one is needed; "Any one of these" when not.
      const left = Math.max(0, (level.need || 0) - (level.have || 0));
      const heading = left && left < level.missing.length
        ? `Any ${left === 1 ? "one" : left} of these` : `Still to do · ${level.missing.length}`;
      return `<div class="agco-sub">${heading}</div>
        <ul class="agco-courses todo">${level.missing.map(t => `<li><b>${esc(agcoShort(t))}</b></li>`).join("")}</ul>`;
    })() : ""}
  </div>`;
}

function agcoPersonHtml(person, chooser) {
  const reached = person.reached || 0;
  if (agcoState.level === null) agcoState.level = Math.min(6, reached + 1);
  const next = reached >= 6 ? "Every level complete" : `Next: Level ${reached + 1} · ${agcoLevelInfo(reached + 1).name}`;
  return `<div class="agco">
    ${chooser ? `<button type="button" class="ghost agco-back" data-agco-person="">${icon("chevronLeft", 15)}All technicians</button>` : ""}
    <div class="agco-summary">
      <div style="${lit("teal")}"><b>${reached ? `Level ${reached}` : "Start"}</b><span>Reached</span></div>
      <div style="${lit("amber")}"><b>${esc(reached >= 6 ? "Expert" : `Level ${reached + 1}`)}</b><span>${reached >= 6 ? "All six" : "Next"}</span></div>
      <div style="${lit("slate")}"><b>${(person.courses || []).length}</b><span>Courses ticked</span></div>
    </div>
    <div class="agco-layout">
      <div class="agco-map-card">
        <div class="agco-map-head"><b>${esc(agcoName(person))}</b><span>${esc(next)}</span></div>
        ${agcoMapSvg(person)}
        <p class="agco-map-foot">Click a sign for its courses. The Training Manager ticks them off as they're completed.</p>
      </div>
      <div class="agco-side">
        ${agcoLevelPanel(person, agcoState.level)}
      </div>
    </div>
  </div>`;
}

// For admins: who's where, then one technician's map.
function agcoChooserHtml() {
  const stores = [...new Set(agcoPeople.map(p => p.store || "No store"))].sort();
  if (agcoState.store !== "all" && !stores.includes(agcoState.store)) agcoState.store = "all";
  const q = agcoState.query.toLowerCase();
  const shown = agcoPeople.filter(p => (agcoState.store === "all" || (p.store || "No store") === agcoState.store)
    && (!q || agcoName(p).toLowerCase().includes(q)));
  const tally = agcoTally(shown);
  const mine = agcoMine();
  return `<div class="agco">
    <div class="agco-tally">${tally.map((n, i) => `<div class="${n ? "" : "zero"}"><b>${n}</b>
      <span>${i ? `Level ${i}` : "Not started"}</span></div>`).join("")}</div>
    <p class="agco-tally-note">Technicians by the furthest level they've reached${agcoState.store === "all" ? "" : ` at ${esc(agcoState.store)}`}.</p>
    <div class="st-controls">
      <input class="search" id="agcoSearch" placeholder="Search technicians" value="${esc(agcoState.query)}" autocomplete="off"
             aria-label="Search technicians">
      ${mine ? `<button type="button" class="ghost" data-agco-person="${esc(mine.person_key)}">My map</button>` : ""}
    </div>
    ${stores.length > 1 ? `<div class="cab-pills">${["all", ...stores].map(s => `<button type="button"
      class="cab-pill${agcoState.store === s ? " on" : ""}" data-agco-store="${esc(s)}">${s === "all" ? "All locations" : esc(s)}<span>${
      s === "all" ? agcoPeople.length : agcoPeople.filter(p => (p.store || "No store") === s).length}</span></button>`).join("")}</div>` : ""}
    <div class="agco-people" id="agcoPeople">${agcoPeopleRows(shown)}</div>
  </div>`;
}

function agcoPeopleRows(list) {
  if (!list.length) return `<p class="st-empty">${agcoPeople.length ? "No technician matches that." : "No maps published yet."}</p>`;
  return list.map(p => `<button type="button" class="agco-person cab-card" data-agco-person="${esc(p.person_key)}"
      style="${lit(p.reached >= 6 ? "green" : p.reached ? "teal" : "steel")}">
    <span class="agco-person-main"><b>${esc(agcoName(p))}</b><span>${esc(p.store || "No store")}</span></span>
    <span class="agco-gauge" aria-label="Reached ${p.reached ? `Level ${p.reached}` : "the start"}">${[1, 2, 3, 4, 5, 6]
      .map(n => `<i class="${n <= p.reached ? "on" : ""}"></i>`).join("")}</span>
    <span class="agco-person-level">${p.reached ? `L${p.reached}` : "—"}</span>
    <span class="cab-chev" aria-hidden="true">&rsaquo;</span>
  </button>`).join("");
}

function agcoMapView() {
  const blurb = "Where you are on AGCO's six levels of technical training, as a road from the first online course to Expert.";
  if (agcoError) {
    return hero("AGCO Development Map", blurb) + `<p class="st-empty">${/does not exist|schema cache/i.test(agcoError)
      ? "The AGCO Development Map isn't switched on yet." : esc(agcoError)}</p>`;
  }
  if (!agcoCatalog || !(agcoCatalog.levels || []).length) {
    return hero("AGCO Development Map", blurb) + `<p class="st-empty">Nothing has been published yet. The training department
      uploads AGCO's catalog and ticks each technician's courses on the Training dashboard.</p>`;
  }
  const chooser = isAdmin() && (agcoPeople.length > 1 || !agcoMine());
  const person = agcoPeople.find(p => p.person_key === agcoState.person) || (chooser ? null : agcoMine() || agcoPeople[0]);
  if (!person) {
    return hero("AGCO Development Map", "Each technician's road through AGCO's six levels. Pick one to see their map.")
      + (agcoPeople.length || chooser ? agcoChooserHtml()
        : `<p class="st-empty">The AGCO Development Map is for technicians.</p>`);
  }
  const own = agcoMine() && agcoMine().person_key === person.person_key;
  return hero("AGCO Development Map", own ? blurb : `${agcoName(person)} · ${person.store || "No store"}`)
    + agcoPersonHtml(person, chooser);
}

document.addEventListener("click", (event) => {
  const who = event.target.closest("[data-agco-person]");
  if (who) {
    agcoState.person = who.dataset.agcoPerson || null;
    agcoState.level = null;
    return showView("agcomap");
  }
  const store = event.target.closest("[data-agco-store]");
  if (store) { agcoState.store = store.dataset.agcoStore; return redraw("agcomap"); }
  const sign = event.target.closest("[data-agco-level]");
  if (sign) agcoPickLevel(Number(sign.dataset.agcoLevel));
});

document.addEventListener("keydown", (event) => {
  const sign = event.target.closest && event.target.closest("[data-agco-level]");
  if (!sign || (event.key !== "Enter" && event.key !== " ")) return;
  event.preventDefault();
  agcoPickLevel(Number(sign.dataset.agcoLevel));
});

function agcoPickLevel(n) {
  agcoState.level = n;
  const person = agcoPeople.find(p => p.person_key === agcoState.person)
    || (isAdmin() && (agcoPeople.length > 1 || !agcoMine()) ? null : agcoMine() || agcoPeople[0]);
  if (!person) return;
  document.querySelectorAll("[data-agco-level]").forEach(g => g.classList.toggle("on", Number(g.dataset.agcoLevel) === n));
  $("agcoPanel").outerHTML = agcoLevelPanel(person, n);
  // On a phone the panel is under the map, out of sight.
  if (window.matchMedia("(max-width: 900px)").matches) {
    $("agcoPanel").scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

document.addEventListener("input", (event) => {
  if (event.target.id !== "agcoSearch") return;
  agcoState.query = event.target.value.trim();
  const q = agcoState.query.toLowerCase();
  $("agcoPeople").innerHTML = agcoPeopleRows(agcoPeople.filter(p =>
    (agcoState.store === "all" || (p.store || "No store") === agcoState.store) && (!q || agcoName(p).toLowerCase().includes(q))));
});

// The wide button at the foot of the Training Center's links: the map in
// miniature, six signs and where the tractor is.
function agcoLinkCard() {
  const mine = agcoMine();
  const reached = mine ? mine.reached || 0 : null;
  const sub = mine ? (reached >= 6 ? "Every level complete — Expert" : `Level ${reached} reached · next, Level ${reached + 1}`)
    : "Where each technician is on AGCO's six levels";
  return `<button type="button" class="link-card agco-link" data-view="agcomap" style="${lit("teal")}">
    <span class="well">${icon("map")}</span>
    <span><b>AGCO Development Map</b><span>${esc(sub)}</span>
      <span class="agco-strip" aria-hidden="true">${[1, 2, 3, 4, 5, 6].map(n => {
        const state = mine ? ((mine.levels || []).find(l => l.level === n) || {}).state : null;
        const cls = state === "done" ? "on" : state === "missing" ? "missing"
          : mine && n === reached + 1 ? "next" : "";
        return `<i class="${cls}">${n}</i>`;
      }).join("")}</span>
      <span class="go">Open the map &rarr;</span></span>
  </button>`;
}
