// Custom Programs (migration 0168; docs/programs-plan.html)
//
// Anything a company wants to track or is working toward, made of six choices:
// what it counts (a source, narrowed to what that source has, and whose), how
// it's measured, when something counts, the goal, how often it's tracked, and
// over which year. "75% of technicians trained in PTx this year", "at least 10
// near misses reported a month", a number kept by hand each month.
//
// Admin → Programs (owners): the list, and one screen that makes or changes any
// program. The sources are PROGRAM_SOURCES, below: each says what it's called,
// what it can be narrowed to (drawn and read by its own functions), how it can
// be measured, and whether it's about people, so a new one is one new entry.
// The dashboards (stage 2) read the records each source already has; nothing
// is copied.

let progList = [], progError = null, progLoaded = false;
// "list" or "edit"; the program being made or changed; whether archived ones show.
let progView = "list", progDraft = null, progShowArchived = false;
// What the choices offer: the Course Catalog, online courses, the Safety Report
// form's kinds, the People list's departments.
let progCourses = [], progOnline = [], progReportKinds = [], progDepartments = [];

const PROG_MEASURES = {
  people: "Share of people",
  count: "How many times",
  total: "A total",
  rate: "Done out of due"
};
const PROG_TRACKED = { weekly: "Weekly", monthly: "Monthly", quarterly: "Quarterly" };
const PROG_PERIOD = { weekly: "week", monthly: "month", quarterly: "quarter" };
// Each certification: its id, its name, and what someone holds.
const PROG_CERTS = [
  ["forklift", "Forklift operator", "forklift certification"], ["crane", "Crane & rigging", "crane & rigging qualification"],
  ["dot_medical", "DOT medical card", "DOT medical card"], ["welding", "Welding", "welding certification"],
  ["cpr", "CPR", "CPR card"], ["first_aid", "First aid", "first aid card"], ["epa609", "EPA 609", "EPA 609 certification"]];

// A list of things to tick, each a checkbox named by its list and value.
const progTicks = (list, items, picked, label = (x) => x[1]) => items.length
  ? `<div class="pg-ticks">${items.map(x => `<label class="pg-tick"><input type="checkbox" data-pg-list="${list}" value="${esc(x[0])}"${
      (picked || []).includes(x[0]) ? " checked" : ""}> ${esc(label(x))}</label>`).join("")}</div>`
  : `<p class="note">None yet.</p>`;
const progPicked = (box, list) => [...box.querySelectorAll(`[data-pg-list="${list}"]:checked`)].map(c => c.value);
const progAnd = (words) => words.length < 2 ? words.join("") : `${words.slice(0, -1).join(", ")} or ${words[words.length - 1]}`;

const PROGRAM_SOURCES = [
  {
    id: "training", label: "Training", icon: "training",
    about: "Classes completed, from everyone's training record, and online courses passed.",
    measures: ["people", "count", "total"], people: true, totalUnit: "training hours",
    settingsHtml: (s) => `
      <div class="pg-choice"><label>Courses that count</label>
        <input type="text" class="pg-filter" data-pg-filter="courses" placeholder="Find a course" aria-label="Find a course">
        ${progTicks("courses", progCourses.map(c => [c.id, c.title]), s.courses)}</div>
      <div class="pg-choice"><label for="pgContains">And any course whose name contains</label>
        <input type="text" id="pgContains" data-pg-setting="contains" maxlength="60" placeholder="PTx" value="${esc(s.contains || "")}">
        <small>So a new course counts by itself: “PTx” takes in every class with PTx in its name.</small></div>
      ${progOnline.length ? `<div class="pg-choice"><label>Online courses that count</label>
        ${progTicks("online", progOnline.map(c => [c.id, c.title]), s.online)}</div>` : ""}`,
    readSettings: (box, s) => ({ courses: progPicked(box, "courses"), online: progPicked(box, "online"),
      contains: (box.querySelector('[data-pg-setting="contains"]') || {}).value?.trim() || s.contains || "" }),
    check: (s) => (s.courses || []).length || (s.online || []).length || (s.contains || "").trim()
      ? "" : "Pick the courses that count, or a word their names contain.",
    describe: (s) => {
      const names = (s.courses || []).map(id => (progCourses.find(c => c.id === id) || {}).title).filter(Boolean)
        .concat((s.online || []).map(id => (progOnline.find(c => c.id === id) || {}).title).filter(Boolean));
      const bits = [];
      if (s.contains) bits.push(`a course containing “${s.contains}”`);
      if (names.length) bits.push(names.length <= 2 ? progAnd(names) : `one of ${names.length} courses`);
      return bits.length ? progAnd(bits) : "a course";
    },
    did: (s, m) => m === "count" ? `classes completed (${PROGRAM_SOURCES[0].describe(s)})`
      : m === "total" ? `training hours (${PROGRAM_SOURCES[0].describe(s)})` : `have completed ${PROGRAM_SOURCES[0].describe(s)}`
  },
  {
    id: "certifications", label: "Certifications", icon: "safety",
    about: "Who holds a certification that's current: forklift, crane & rigging, DOT medical, welding, CPR, first aid, EPA 609.",
    measures: ["people"], people: true, noWhen: true,
    settingsHtml: (s) => `<div class="pg-choice"><label>Which certification</label><div class="pg-ticks">${PROG_CERTS.map(([k, t]) =>
      `<label class="pg-tick"><input type="radio" name="pgCert" data-pg-setting="kind" value="${k}"${s.kind === k ? " checked" : ""}> ${esc(t)}</label>`).join("")}</div></div>`,
    readSettings: (box, s) => ({ kind: (box.querySelector('[data-pg-setting="kind"]:checked') || {}).value || s.kind || "" }),
    check: (s) => s.kind ? "" : "Pick the certification.",
    describe: (s) => (PROG_CERTS.find(([k]) => k === s.kind) || [null, "a certification"])[1],
    did: (s) => `hold a current ${(PROG_CERTS.find(([k]) => k === s.kind) || [null, null, "certification"])[2]}`
  },
  {
    id: "safety_briefs", label: "Safety Briefs", icon: "safety",
    about: "Passing each month's Safety Brief.",
    measures: ["people"], people: true,
    settingsHtml: () => `<p class="note">Every month's Safety Brief counts.</p>`,
    readSettings: () => ({}), check: () => "",
    describe: () => "the Safety Brief", did: () => "have passed the Safety Brief"
  },
  {
    id: "safety_reports", label: "Safety Reports", icon: "megaphone",
    about: "Safety Reports sent: near misses, shout-outs, injuries, hazards, ideas, asset damage.",
    measures: ["count", "people"], people: true,
    settingsHtml: (s) => `<div class="pg-choice"><label>Which kinds of report (none ticked: every kind)</label>
      ${progTicks("kinds", progReportKinds.map(k => [k, k]), s.kinds, (x) => srShortKind(x[1]) || x[1])}</div>`,
    readSettings: (box) => ({ kinds: progPicked(box, "kinds") }), check: () => "",
    describe: (s) => (s.kinds || []).length ? progAnd(s.kinds.map(k => (srShortKind(k) || k).toLowerCase())) : "any kind",
    did: (s, m) => m === "count" ? `Safety Reports (${PROGRAM_SOURCES[3].describe(s)})` : `have sent a Safety Report (${PROGRAM_SOURCES[3].describe(s)})`
  },
  {
    id: "manual", label: "Numbers by hand", icon: "pencil",
    about: "Anything Agri-Barn doesn't record itself: parts sales, customer visits, hours billed. Each period's number is typed in.",
    measures: ["total", "count"], people: false,
    settingsHtml: (s) => `
      <div class="pg-choice"><label for="pgUnit">What's counted</label>
        <input type="text" id="pgUnit" data-pg-setting="unit" maxlength="60" placeholder="dollars of parts sold" value="${esc(s.unit || "")}">
        <small>In the words the dashboard should use: “dollars of parts sold”, “customer visits”.</small></div>
      <div class="pg-choice"><label>Kept for</label><div class="pg-ticks">
        <label class="pg-tick"><input type="radio" name="pgByLoc" data-pg-setting="by_location" value="yes"${s.by_location !== false ? " checked" : ""}>
          Each location (its admins type theirs)</label>
        <label class="pg-tick"><input type="radio" name="pgByLoc" data-pg-setting="by_location" value="no"${s.by_location === false ? " checked" : ""}>
          The whole company (owners type it)</label></div></div>`,
    readSettings: (box, s) => ({
      unit: (box.querySelector('[data-pg-setting="unit"]') || {}).value?.trim() ?? s.unit ?? "",
      by_location: ((box.querySelector('[data-pg-setting="by_location"]:checked') || {}).value || "yes") === "yes" }),
    check: (s) => (s.unit || "").trim() ? "" : "Say what's counted, like “dollars of parts sold”.",
    describe: (s) => s.unit || "a number", did: (s) => s.unit || "the number"
  }
];
const progSource = (id) => PROGRAM_SOURCES.find(s => s.id === id) || null;
// A goal is a percentage for done-out-of-due, or a share of people given as one.
const progPercent = (p) => p.measure === "rate" || (p.measure === "people" && p.goal_unit === "percent");

async function loadPrograms() {
  const [programs, courses, online, form, people] = await Promise.all([
    db.from("programs").select("*").order("sort_order").order("created_at"),
    db.from("courses").select("id,title,record_name,is_active").order("title"),
    db.from("online_courses").select("id,title").order("title"),
    db.from("safety_report_form").select("fields").eq("id", "current").maybeSingle(),
    allRows(() => db.from("employees").select("department,id").eq("here", true).order("id"))
  ]);
  progError = programs.error && !/does not exist|schema cache/i.test(programs.error.message) ? programs.error.message : null;
  progList = programs.error ? null : programs.data || [];
  progCourses = (courses.data || []).filter(c => c.is_active !== false);
  progOnline = online.data || [];
  const kind = ((form.data && form.data.fields) || []).find(f => f.id === "kind");
  progReportKinds = (kind && kind.options) || [];
  progDepartments = [...new Set((people.data || []).map(p => (p.department || "").trim()).filter(Boolean))].sort();
  progLoaded = true;
}

// "At least 75% of technicians at Twin Falls have completed a course containing “PTx” this fiscal year":
// the program in one sentence, retold as its choices change.
function progSentence(p) {
  const source = progSource(p.source);
  if (!source) return "";
  const s = p.settings || {}, who = s.people || {};
  const kinds = (who.jobs || []).map(k => ((typeof JOB_KINDS !== "undefined" ? JOB_KINDS : []).find(j => j.id === k) || { plural: k }).plural.toLowerCase());
  const places = (who.locations || []).map(id => locations[id] || id);
  const whose = [kinds.length ? progAnd(kinds) : "people", places.length ? `at ${progAnd(places)}` : "",
    (who.departments || []).length ? `in ${progAnd(who.departments)}` : ""].filter(Boolean).join(" ");
  const year = `this ${p.year_kind === "fiscal" ? "fiscal " : ""}year`;
  const every = `every ${PROG_PERIOD[p.tracked] || "month"}`;
  const goal = p.goal_direction === "none" ? "" : `${p.goal_direction === "at_most" ? "At most" : "At least"} ${
    progPercent(p) ? `${Number(p.goal_value ?? 0)}%` : Number(p.goal_value ?? 0).toLocaleString()}`;
  if (p.measure === "people") {
    const when = source.noWhen ? "" : p.counts_when === "ever" ? " at any time" : p.counts_when === "months"
      ? ` in the last ${p.within_months || "?"} months` : ` ${year}`;
    const span = !goal ? "" : p.goal_span === "period" ? `, ${every}` : p.counts_when === "year" && !source.noWhen ? "" : `, by the end of the ${p.year_kind === "fiscal" ? "fiscal " : ""}year`;
    const people = goal && p.goal_unit === "number" ? `${goal} ${whose}` : goal ? `${goal} of ${whose}` : `Share of ${whose} who`;
    return `${people} ${source.did(s, p.measure)}${when}${span}`;
  }
  // A count or a total: "At least 10 Safety Reports (near miss) every month", "Dollars of parts sold each month".
  const thing = source.did(s, p.measure);
  const by = source.people && whose !== "people" ? `, by ${whose},` : "";
  const when = !goal ? `each ${PROG_PERIOD[p.tracked] || "month"}` : p.goal_span === "period" ? every : year;
  return `${goal ? `${goal} ${thing}` : `${thing[0].toUpperCase()}${thing.slice(1)}`}${by} ${when}`;
}
const progTrackedText = (p) => `${PROG_TRACKED[p.tracked]}, ${p.year_kind === "fiscal" ? "fiscal" : "calendar"} year`;

function renderProgramsAdmin() {
  const box = $("programsAdmin");
  if (!box) return;
  if (!progLoaded) {
    box.innerHTML = `<div class="card"><p class="note">Loading…</p></div>`;
    loadPrograms().then(renderProgramsAdmin).catch(e => { box.innerHTML = `<div class="card"><p class="error">${esc(e.message)}</p></div>`; });
    return;
  }
  if (progList === null) {
    box.innerHTML = `<div class="card"><p class="error">Run migration 0168_programs.sql in the SQL editor, then reload this page.</p></div>`;
    return;
  }
  box.innerHTML = `<div class="sx cab-admin pg" style="${lit("violet")}">${progView === "edit" && progDraft ? progEditorHtml() : progListHtml()}</div>`;
}

// ---- the list

function progListHtml() {
  const current = progList.filter(p => !p.archived_at), archived = progList.filter(p => p.archived_at);
  const shown = progShowArchived ? archived : current;
  return `
    <section class="sx-hero">
      <div class="sx-hero-text">
        <span class="sx-kicker">Programs</span>
        <h2>What ${esc(companyName())} is working toward</h2>
        <p>A program tracks anything Agri-Barn records, or a number you type in, against a goal: “75% of technicians trained
          in PTx this year”, “at least 10 near misses reported a month”. Owners make them; owners and location admins see their
          dashboards, an admin's for their own locations.</p>
      </div>
      <button type="button" class="pg-new" data-pg-new>${icon("plus", 17)}New program</button>
    </section>
    ${progError ? `<p class="error">${esc(progError)}</p>` : ""}
    <section class="sx-panel" style="${lit("violet")}">
      <header><h3>${progShowArchived ? "Archived" : "Programs"}</h3><span>${shown.length}</span>
        ${archived.length || progShowArchived ? `<button type="button" class="pdf pg-archived" data-pg-archived>${progShowArchived
          ? "Current programs" : `Archived · ${archived.length}`}</button>` : ""}</header>
      ${shown.length ? `<div class="lc-scroll grows"><table class="lc-table cab-list">
        <thead><tr><th>Program</th><th>Counts</th><th>Tracked</th><th>Changed</th><th></th></tr></thead>
        <tbody>${shown.map(p => {
          const source = progSource(p.source);
          return `<tr${p.archived_at ? ` class="off"` : ""}>
            <td><b>${esc(p.name)}</b><small>${esc(progSentence(p))}</small></td>
            <td>${esc(source ? source.label : p.source)}<small>${esc(PROG_MEASURES[p.measure] || "")}</small></td>
            <td>${esc(progTrackedText(p))}</td>
            <td class="when">${esc(new Date(p.updated_at || p.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }))}
              ${p.updated_by_name ? `<small>${esc(p.updated_by_name)}</small>` : ""}</td>
            <td class="pl-do"><span class="cab-actions">
              <button type="button" class="pdf" data-pg-edit="${esc(p.id)}">Edit</button>
              <button type="button" class="pdf" data-pg-archive="${esc(p.id)}">${p.archived_at ? "Bring back" : "Archive"}</button></span></td>
          </tr>`; }).join("")}</tbody>
      </table></div>` : `<p class="sx-empty">${progShowArchived ? "Nothing archived."
        : "No programs yet. <b>New program</b> makes the first: PTx training, near misses, anything you want to track."}</p>`}
      <span class="msg" role="status"></span>
    </section>
    <section class="sx-panel" style="${lit("steel")}">
      <header><h3>How it works</h3></header>
      <dl class="cab-rules">
        <div><dt>Six choices</dt><dd>What it counts and what that's narrowed to, how it's measured, when something counts,
          the goal, and how often it's tracked over which year. Change any of them at any time; the dashboard redraws.</dd></div>
        <div><dt>The records</dt><dd>A program reads what's already in Agri-Barn, so it's always current and nothing is
          kept twice. “Numbers by hand” are typed in each period.</dd></div>
        <div><dt>The fiscal year</dt><dd>Starts in the month set on Admin → Company.</dd></div>
        <div><dt>Archive</dt><dd>Takes a finished program off the list, dashboard and all, and Bring back puts it back.</dd></div>
      </dl>
    </section>`;
}

// ---- making or changing one

const progBlank = () => ({ id: null, name: "", description: "", source: "training", settings: { people: {} }, measure: "people",
  counts_when: "year", within_months: null, goal_direction: "at_least", goal_value: 75, goal_unit: "percent", goal_span: "year",
  tracked: "monthly", year_kind: "calendar" });

function progEditorHtml() {
  const p = progDraft, source = progSource(p.source) || PROGRAM_SOURCES[0], s = p.settings || {}, who = s.people || {};
  if (!source.measures.includes(p.measure)) p.measure = source.measures[0];
  const people = p.measure === "people";
  const fiscal = MONTH_NAMES[(company.fiscal_year_starts || 1) - 1];
  const radios = (name, options, value, attr) => `<div class="pg-ticks">${options.map(([v, t]) =>
    `<label class="pg-tick"><input type="radio" name="${name}" ${attr}="${v}"${String(value) === v ? " checked" : ""}> ${t}</label>`).join("")}</div>`;
  return `
    <button type="button" class="cab-back" data-pg-back>${icon("chevronLeft", 16)}All programs</button>
    <form id="pgForm" class="pg-form" novalidate>
    <section class="sx-panel" style="${lit("violet")}">
      <header><h3>${p.id ? "Change the program" : "A new program"}</h3></header>
      <div class="fields">
        <div class="wide"><label for="pgName">Name</label>
          <input type="text" id="pgName" data-pg-field="name" maxlength="120" placeholder="PTx training" value="${esc(p.name)}"></div>
        <div class="wide"><label for="pgDescription">Why, or anything to know (optional)</label>
          <input type="text" id="pgDescription" data-pg-field="description" maxlength="500" placeholder="Company goal for 2027" value="${esc(p.description || "")}"></div>
      </div>
      <p class="pg-sentence" id="pgSentence">${esc(progSentence(p))}</p>
    </section>

    <section class="sx-panel" style="${lit("teal")}">
      <header><h3>What it counts</h3></header>
      <div class="pg-sources">${PROGRAM_SOURCES.map(x => `<label class="pg-source${x.id === source.id ? " on" : ""}">
        <input type="radio" name="pgSource" data-pg-source="${x.id}"${x.id === source.id ? " checked" : ""}>
        ${icon(x.icon, 18)}<b>${esc(x.label)}</b><small>${esc(x.about)}</small></label>`).join("")}</div>
    </section>

    <section class="sx-panel" style="${lit("teal")}">
      <header><h3>Narrowed to</h3></header>
      ${source.settingsHtml(s)}
      ${source.people ? `<h4>Whose</h4>
        <div class="pg-choice"><label>Job kinds (none ticked: every job)</label>
          ${progTicks("jobs", (typeof JOB_KINDS !== "undefined" ? JOB_KINDS : []).map(k => [k.id, k.plural]), who.jobs)}</div>
        <div class="pg-choice"><label>Locations (none ticked: every location)</label>
          ${progTicks("locations", allLocations.filter(l => l.is_active !== false).map(l => [l.id, l.name]), who.locations)}</div>
        ${progDepartments.length ? `<div class="pg-choice"><label>Departments (none ticked: every department)</label>
          ${progTicks("departments", progDepartments.map(d => [d, d]), who.departments)}</div>` : ""}` : ""}
    </section>

    <section class="sx-panel" style="${lit("teal")}">
      <header><h3>Measured as</h3></header>
      ${radios("pgMeasure", source.measures.map(m => [m, PROG_MEASURES[m] + (m === "total" && source.totalUnit ? ` (${source.totalUnit})` : "")]),
        p.measure, "data-pg-measure")}
      ${people && !source.noWhen ? `<h4>Counts when</h4>
        ${radios("pgWhen", [["year", "Within the year: everyone starts again from zero"], ["ever", "Ever: once done, it always counts"],
          ["months", "Within so many months"]], p.counts_when, "data-pg-when")}
        ${p.counts_when === "months" ? `<div class="pg-inline"><input type="number" id="pgMonths" data-pg-field="within_months" min="1" max="240"
          value="${esc(p.within_months ?? 12)}" aria-label="Months"> months</div>` : ""}` : ""}
    </section>

    <section class="sx-panel" style="${lit("amber")}">
      <header><h3>Goal</h3></header>
      ${radios("pgDirection", [["at_least", "At least"], ["at_most", "At most"], ["none", "No goal, just tracking"]], p.goal_direction, "data-pg-direction")}
      ${p.goal_direction !== "none" ? `<div class="pg-inline">
        <input type="number" id="pgGoal" data-pg-field="goal_value" min="0" step="any" value="${esc(p.goal_value ?? "")}" aria-label="Goal">
        ${people ? `<select data-pg-field="goal_unit" aria-label="Percent or people">
            <option value="percent"${p.goal_unit === "percent" ? " selected" : ""}>% of the people who count</option>
            <option value="number"${p.goal_unit === "number" ? " selected" : ""}>people</option></select>`
          : p.measure === "rate" ? `<span>% done</span>` : `<span id="pgGoalUnit">${esc(p.measure === "total" ? (source.totalUnit || s.unit || "in total") : "times")}</span>`}
        <select data-pg-field="goal_span" aria-label="By when">
          <option value="year"${p.goal_span === "year" ? " selected" : ""}>by the end of the year</option>
          <option value="period"${p.goal_span === "period" ? " selected" : ""}>every ${PROG_PERIOD[p.tracked]}</option></select>
      </div>` : ""}
      <h4>Tracked</h4>
      ${radios("pgTracked", Object.entries(PROG_TRACKED), p.tracked, "data-pg-tracked")}
      ${radios("pgYear", [["calendar", "Calendar year (January to December)"], ["fiscal", `Fiscal year (starts in ${fiscal}, set on Company)`]],
        p.year_kind, "data-pg-year")}
    </section>

    <div class="row pg-save">
      <button type="button" data-pg-save>${p.id ? "Save the changes" : "Make the program"}</button>
      <span class="msg" role="status"></span>
      ${p.id ? `<button type="button" class="ghost" data-pg-delete style="margin-left:auto">Delete the program</button>` : ""}
    </div>
    </form>`;
}

// What's on the screen, into the draft: the source's own settings, whose, and the fields.
function progRead() {
  const form = $("pgForm");
  if (!form || !progDraft) return;
  const p = progDraft, source = progSource(p.source);
  const people = { jobs: progPicked(form, "jobs"), locations: progPicked(form, "locations"), departments: progPicked(form, "departments") };
  p.settings = { ...(source ? source.readSettings(form, p.settings || {}) : {}), ...(source && source.people ? { people } : {}) };
  form.querySelectorAll("[data-pg-field]").forEach(el => {
    const key = el.dataset.pgField;
    p[key] = ["goal_value", "within_months"].includes(key) ? (el.value === "" ? null : Number(el.value)) : el.value;
  });
}

function progRedraw() {
  const y = window.scrollY;
  renderProgramsAdmin();
  window.scrollTo(0, y);
}

function progShow(view) {
  progView = view;
  renderProgramsAdmin();
  const tab = $("tab-programs");
  if (tab) tab.scrollIntoView({ block: "start" });
}

// Said beside Save on the editor, under the list on the list.
const progSay = (text, bad) => {
  const msg = document.querySelector("#programsAdmin .pg-save .msg") || document.querySelector("#programsAdmin .msg");
  if (msg) speak(msg.parentElement, text, bad); else if (bad) alert(text);
};

async function progSave(button) {
  progRead();
  const p = progDraft, source = progSource(p.source);
  const problem = !p.name.trim() ? "The program needs a name."
    : source.check(p.settings || {})
    || (p.measure === "people" && p.counts_when === "months" && !(p.within_months >= 1) ? "Say within how many months." : "")
    || (p.goal_direction !== "none" && !(p.goal_value >= 0 && p.goal_value !== null) ? "Give the goal a number." : "")
    || (p.goal_direction !== "none" && progPercent(p) && p.goal_value > 100 ? "A percentage goes up to 100." : "");
  if (problem) return progSay(problem, true);
  const percent = progPercent(p);
  const row = {
    name: p.name.trim(), description: (p.description || "").trim(), source: p.source, settings: p.settings || {},
    measure: p.measure, counts_when: p.measure === "people" && !source.noWhen ? p.counts_when : "year",
    within_months: p.measure === "people" && p.counts_when === "months" ? p.within_months : null,
    goal_direction: p.goal_direction, goal_value: p.goal_direction === "none" ? null : p.goal_value,
    goal_unit: percent ? "percent" : "number", goal_span: p.goal_span, tracked: p.tracked, year_kind: p.year_kind
  };
  button.disabled = true;
  progSay("Saving…", false);
  const { data, error } = p.id
    ? await db.from("programs").update(row).eq("id", p.id).select("id")
    : await db.from("programs").insert({ ...row, sort_order: (Math.max(0, ...progList.map(x => x.sort_order || 0)) + 10) }).select("id");
  button.disabled = false;
  if (error) return progSay(/row-level/i.test(error.message) ? "Only an owner can make or change programs." : error.message, true);
  if (!(data || []).length) return progSay("Not saved: only an owner can make or change programs.", true);
  await loadPrograms();
  progDraft = null;
  progShow("list");
  progSay(`${p.id ? "Saved" : "Made"} “${row.name}”.`, false);
}

$("admin").addEventListener("click", async (event) => {
  const b = event.target.closest("[data-pg-new], [data-pg-edit], [data-pg-back], [data-pg-archive], [data-pg-archived], [data-pg-save], [data-pg-delete]");
  if (!b) return;
  const d = b.dataset;
  if (d.pgNew !== undefined) { progDraft = progBlank(); return progShow("edit"); }
  if (d.pgEdit) {
    const p = progList.find(x => x.id === d.pgEdit);
    if (!p) return;
    progDraft = JSON.parse(JSON.stringify(p));
    progDraft.settings = progDraft.settings || {};
    return progShow("edit");
  }
  if (d.pgBack !== undefined) { progDraft = null; return progShow("list"); }
  if (d.pgArchived !== undefined) { progShowArchived = !progShowArchived; return renderProgramsAdmin(); }
  if (d.pgArchive) {
    const p = progList.find(x => x.id === d.pgArchive);
    const { data, error } = await db.from("programs").update({ archived_at: p.archived_at ? null : new Date().toISOString() })
      .eq("id", p.id).select("id");
    if (error || !(data || []).length) return progSay(error ? error.message : "Only an owner can archive programs.", true);
    await loadPrograms();
    renderProgramsAdmin();
    progSay(p.archived_at ? `“${p.name}” is back.` : `“${p.name}” is archived. Archived · ${progList.filter(x => x.archived_at).length} brings it back.`, false);
    return;
  }
  if (d.pgSave !== undefined) return progSave(b);
  if (d.pgDelete !== undefined) {
    const p = progDraft;
    if (!confirm(`Delete “${p.name}”? Its numbers kept by hand go with it, and this can't be undone. Archiving keeps it.`)) return;
    const { data, error } = await db.from("programs").delete().eq("id", p.id).select("id");
    if (error || !(data || []).length) return progSay(error ? error.message : "Only an owner can delete programs.", true);
    await loadPrograms();
    progDraft = null;
    return progShow("list");
  }
});

// Choices that change what's shown redraw the screen; words just retell the sentence.
$("admin").addEventListener("change", (event) => {
  const t = event.target;
  if (!t.closest("#pgForm") || !progDraft) return;
  progRead();
  const d = t.dataset;
  if (d.pgSource) {
    const next = progSource(d.pgSource);
    progDraft.source = d.pgSource;
    progDraft.settings = { people: (progDraft.settings || {}).people || {} };
    if (!next.measures.includes(progDraft.measure)) {
      progDraft.measure = next.measures[0];
      progDraft.goal_unit = progDraft.measure === "people" ? "percent" : "number";
    }
    return progRedraw();
  }
  if (d.pgMeasure) { progDraft.measure = d.pgMeasure; progDraft.goal_unit = d.pgMeasure === "people" ? "percent" : "number"; return progRedraw(); }
  if (d.pgWhen) { progDraft.counts_when = d.pgWhen; return progRedraw(); }
  if (d.pgDirection) { progDraft.goal_direction = d.pgDirection; return progRedraw(); }
  if (d.pgTracked) { progDraft.tracked = d.pgTracked; return progRedraw(); }
  if (d.pgYear) { progDraft.year_kind = d.pgYear; }
  if (d.pgField === "goal_unit") return progRedraw();
  const sentence = $("pgSentence");
  if (sentence) sentence.textContent = progSentence(progDraft);
});

$("admin").addEventListener("input", (event) => {
  const t = event.target;
  if (t.dataset.pgFilter) {
    const words = t.value.toLowerCase().trim();
    t.parentElement.querySelectorAll(".pg-tick").forEach(l => { l.hidden = !!words && !l.textContent.toLowerCase().includes(words); });
    return;
  }
  if (!t.closest("#pgForm") || !progDraft) return;
  progRead();
  const sentence = $("pgSentence");
  if (sentence) sentence.textContent = progSentence(progDraft);
  if (t.dataset.pgSetting === "unit" && $("pgGoalUnit")) $("pgGoalUnit").textContent = t.value.trim() || "in total";
});
