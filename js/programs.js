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
// Each program opens to its dashboard (below), worked out from the records each
// source already has (PROG_COLLECT); nothing is copied.

let progList = [], progError = null, progLoaded = false;
// "list", "edit" or "dashboard"; the program being made or changed, and where
// its editor goes back to; whether archived ones show.
let progView = "list", progDraft = null, progFrom = "list", progShowArchived = false;
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
    // Within the year and a goal every period: each period starts again ("each month").
    const fresh = p.counts_when === "year" && p.goal_span === "period" && !!goal && !source.noWhen;
    const when = source.noWhen ? "" : fresh ? ` each ${PROG_PERIOD[p.tracked] || "month"}` : p.counts_when === "ever" ? " at any time"
      : p.counts_when === "months" ? ` in the last ${p.within_months || "?"} months` : ` ${year}`;
    const span = !goal || fresh ? "" : p.goal_span === "period" ? `, ${every}` : p.counts_when === "year" && !source.noWhen ? "" : `, by the end of the ${p.year_kind === "fiscal" ? "fiscal " : ""}year`;
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
  const view = progView === "edit" && progDraft ? progEditorHtml() : progView === "dashboard" && progOpen ? progDashboardHtml() : progListHtml();
  box.innerHTML = `<div class="sx cab-admin pg" style="${lit("violet")}">${view}</div>`;
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
            <td><button type="button" class="pg-name" data-pg-open="${esc(p.id)}">${esc(p.name)}</button><small>${esc(progSentence(p))}</small></td>
            <td>${esc(source ? source.label : p.source)}<small>${esc(PROG_MEASURES[p.measure] || "")}</small></td>
            <td>${esc(progTrackedText(p))}</td>
            <td class="when">${esc(new Date(p.updated_at || p.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }))}
              ${p.updated_by_name ? `<small>${esc(p.updated_by_name)}</small>` : ""}</td>
            <td class="pl-do"><span class="cab-actions">
              <button type="button" class="pdf" data-pg-open="${esc(p.id)}">Open</button>
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
        ${radios("pgWhen", [["year", p.goal_span === "period" && p.goal_direction !== "none"
          ? `Within each ${PROG_PERIOD[p.tracked]}: everyone starts again each ${PROG_PERIOD[p.tracked]}` : "Within the year: everyone starts again from zero"], ["ever", "Ever: once done, it always counts"],
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
  if (progFrom === "dashboard" && p.id) { progOpen = p.id; progPick = null; return progShow("dashboard"); }
  progShow("list");
  progSay(`${p.id ? "Saved" : "Made"} “${row.name}”.`, false);
}

// ---- the dashboard
//
// Every program opens to the same page, shaped by its measure: where it stands
// against the goal and whether it's on pace, the year period by period, any one
// period's records, breakdowns by location, job and what was done, who's still
// to do, and for numbers kept by hand, the place to type them. It's worked out
// here from records loaded at sign-in; a program's Safety Reports and its
// hand-kept numbers are read when it opens.
//
// People are counted as they were at the time: a period counts whoever was on
// the People list then (by when they joined and left). Everyone on the first
// People list counts from the start, since that list says nothing of before.

// The program open, how many years back, the period picked, the breakdown shown.
let progOpen = null, progBack = 0, progPick = null, progBy = "location", progAllToDo = false;
let progReports = null, progLoadError = null;
const progNumbers = new Map();
const PROG_YEARS_BACK = 2;

// Days as "yyyy-mm-dd", compared as text.
const pgIso = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const pgDay = (v) => !v ? null : /^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? String(v) : pgIso(new Date(v));
const pgAddDays = (iso, n) => { const d = dateOnly(iso); d.setDate(d.getDate() + n); return pgIso(d); };
function pgAddMonths(iso, n) {
  const [y, m, d] = iso.split("-").map(Number), first = new Date(y, m - 1 + n, 1);
  const last = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  return pgIso(new Date(first.getFullYear(), first.getMonth(), Math.min(d, last)));
}
const pgDaysBetween = (a, b) => Math.round((dateOnly(b) - dateOnly(a)) / 864e5);
const pgShort = (iso) => dateOnly(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

// The year a program is in, `back` years ago: January 1st, or the first of the fiscal year's month.
function pgYearStart(p, back = 0) {
  const t = todayISO(), y = +t.slice(0, 4), m = +t.slice(5, 7);
  const sm = p.year_kind === "fiscal" ? (company.fiscal_year_starts || 1) : 1;
  return `${(m >= sm ? y : y - 1) - back}-${pad2(sm)}-01`;
}
function pgYearName(start) {
  if (start.slice(5) === "01-01") return start.slice(0, 4);
  const f = (iso) => dateOnly(iso).toLocaleDateString("en-US", { month: "short", year: "numeric" });
  return `${f(start)} – ${f(pgAddDays(pgAddMonths(start, 12), -1))}`;
}

// The year's weeks, months or quarters, each knowing whether it's past, now or to come.
function pgPeriods(p, start) {
  const end = pgAddMonths(start, 12), list = [], today = todayISO();
  const fmt = (iso, o) => dateOnly(iso).toLocaleDateString("en-US", o);
  if (p.tracked === "weekly") {
    // Weeks of seven days from the year's first; the day or two left over joins the last week.
    for (let d = start; d < end; d = pgAddDays(d, 7)) {
      const e = pgAddDays(d, 14) > end ? end : pgAddDays(d, 7);
      list.push({ start: d, end: e, label: `Week of ${fmt(d, { month: "short", day: "numeric", year: "numeric" })}`,
        short: fmt(d, { month: "numeric", day: "numeric" }) });
      if (e === end) break;
    }
  } else {
    const step = p.tracked === "quarterly" ? 3 : 1;
    for (let i = 0; i < 12; i += step) {
      const s = pgAddMonths(start, i), e = pgAddMonths(start, i + step);
      list.push(step === 1 ? { start: s, end: e, label: fmt(s, { month: "long", year: "numeric" }), short: fmt(s, { month: "short" }) }
        : { start: s, end: e, label: `Q${i / 3 + 1}, ${fmt(s, { month: "short" })} – ${fmt(pgAddDays(e, -1), { month: "short", year: "numeric" })}`,
          short: `Q${i / 3 + 1}` });
    }
  }
  list.forEach((x, i) => Object.assign(x, { i, last: pgAddDays(x.end, -1), future: x.start > today, now: x.start <= today && today < x.end }));
  list.forEach(x => { x.asOf = x.last < today ? x.last : today; });
  return list;
}

// ---- who

const pgNum = (v) => v ? tsEmployeeNumber(v) : "";
const pgMail = (v) => String(v || "").trim().toLowerCase();

// Everyone who works here or has: the People list, else the training records.
function pgEveryone() {
  if (plRows.length) {
    const first = plRows.map(e => String(e.first_seen || "").slice(0, 10)).filter(Boolean).sort()[0];
    return plRows.map(e => ({ key: e.person_key, number: pgNum(e.employee_number), email: pgMail(e.email),
      name: `${e.first_name || ""} ${e.last_name || ""}`.trim() || e.email || "Someone",
      job: String(e.job || "").replace(/^\d+\s*-\s*/, ""), kind: jobKind(e.job), location: e.location_id || storeLocation(e.store),
      department: String(e.department || "").trim(),
      joined: e.first_seen && String(e.first_seen).slice(0, 10) !== first ? pgDay(e.first_seen) : null,
      left: e.here ? null : pgDay(e.left_at) || "0000-01-01" }));
  }
  return tsPeople.map(r => ({ key: r.person_key, number: pgNum(r.employee_number), email: pgMail(r.email),
    name: `${r.first_name || ""} ${r.last_name || ""}`.trim() || r.email || "Someone", job: String(r.job || "").replace(/^\d+\s*-\s*/, ""),
    kind: jobKind(r.job), location: storeLocation(r.store), department: String(r.department || "").trim(), joined: null, left: null }));
}

// Finding a record's person: by employee number, then work email, then the
// record's own key; an account by its profile; an old forklift card by name.
function pgContext(everyone) {
  const byNum = new Map(), byMail = new Map(), byKey = new Map(), byName = new Map();
  everyone.forEach(x => {
    if (x.number) byNum.set(x.number, x);
    if (x.email) byMail.set(x.email, x);
    if (x.key) byKey.set(String(x.key).toLowerCase(), x);
    const n = tsNameKey(x.name, "");
    byName.set(n, byName.has(n) ? null : x);
  });
  const profiles = new Map(people.map(pr => [pr.id, pr]));
  const accountByMail = new Map(people.filter(pr => pr.email).map(pr => [pgMail(pr.email), pr]));
  const viaAccount = (email) => { const pr = email && accountByMail.get(pgMail(email)); return pr && pr.employee_number ? byNum.get(pgNum(pr.employee_number)) : null; };
  const find = (number, email, key) => (number && byNum.get(pgNum(number))) || (email && byMail.get(pgMail(email)))
    || (key && byKey.get(String(key).toLowerCase())) || viaAccount(email) || null;
  const byProfile = (id) => { const pr = profiles.get(id); return pr ? find(pr.employee_number, pr.email) : null; };
  const profileName = (id) => (profiles.get(id) || {}).full_name || "Someone";
  const profileLocation = (id) => (profiles.get(id) || {}).location_id || null;
  return { everyone, find, byProfile, profileName, profileLocation, byName: (name) => byName.get(tsNameKey(name || "", "")) || null };
}

// The program's "whose", as a test of a person.
function pgWhose(p) {
  const w = (p.settings || {}).people || {}, jobs = w.jobs || [], locs = w.locations || [], deps = w.departments || [];
  return { any: !!(jobs.length || locs.length || deps.length),
    test: (x) => !!x && (!jobs.length || jobs.includes(x.kind)) && (!locs.length || locs.includes(x.location))
      && (!deps.length || deps.includes(x.department)) };
}
const pgHereOn = (x, day) => (!x.joined || x.joined <= day) && (!x.left || x.left > day);

// ---- what each source holds
//
// A record is one thing done: { at, person, name, location, what, facet, value }.
// A certification is held for a while instead: { from, until, person, ... }.

const PROG_COLLECT = {
  training(p, ctx) {
    const s = p.settings || {}, key = craneCourseKey, word = String(s.contains || "").trim().toLowerCase();
    const picked = new Set((s.courses || []).flatMap(id => {
      const c = allCourses.find(x => x.id === id);
      return c ? [key(c.record_name || c.title), key(c.title)] : [];
    }));
    const hours = new Map();
    allCourses.forEach(c => [c.record_name || c.title, c.title].forEach(n => { if (!hours.has(key(n))) hours.set(key(n), Number(c.training_hours) || 0); }));
    const counts = (name) => picked.has(key(name)) || (!!word && String(name || "").toLowerCase().includes(word));
    const records = [];
    tsPeople.forEach(r => {
      const x = ctx.find(r.employee_number, r.email, r.person_key);
      (r.classes || []).forEach(c => {
        if (!c.completed || !counts(c.course)) return;
        records.push({ at: pgDay(c.completed), person: x, name: x ? x.name : `${r.first_name || ""} ${r.last_name || ""}`.trim(),
          location: x ? x.location : storeLocation(r.store), what: c.course, facet: c.course, value: hours.get(key(c.course)) || 0 });
      });
    });
    // Online courses: each person's first pass of each.
    const online = new Set(s.online || []), firsts = new Map();
    ocAttempts.filter(a => online.has(a.course_id) && ["passed", "completed"].includes(a.status) && a.completed_at).forEach(a => {
      const k = `${a.user_id}|${a.course_id}`, had = firsts.get(k);
      if (!had || a.completed_at < had.completed_at) firsts.set(k, a);
    });
    firsts.forEach(a => {
      const x = ctx.byProfile(a.user_id), title = (ocCourses.find(c => c.id === a.course_id) || {}).title || "Online course";
      records.push({ at: pgDay(a.completed_at), person: x, name: x ? x.name : ctx.profileName(a.user_id),
        location: x ? x.location : ctx.profileLocation(a.user_id), what: `${title} (online)`, facet: title, value: 0 });
    });
    return { records, facet: "Course" };
  },

  certifications(p, ctx) {
    const kind = (p.settings || {}).kind, spans = [];
    const add = (x, name, location, from, until, what) =>
      spans.push({ person: x, name: x ? x.name : name || "Someone", location: x ? x.location : location || null, from: from || null,
        until: until || null, at: from || null, what, facet: what, value: 1 });
    if (kind === "forklift") approvedCerts().filter(c => c.passed_driving !== false).forEach(c => {
      const x = ctx.find(null, c.email, null) || (!c.email ? ctx.byName(c.operator_name) : null);
      add(x, c.operator_name, null, pgDay(c.evaluation_date), pgDay(c.expiration_date), "Forklift certification");
    });
    if (kind === "crane") {
      const kinds = new Map(craneCourses().map(c => [craneCourseKey(c.record), c]));
      tsPeople.forEach(r => {
        const change = craneOverrides.get(r.person_key);
        if (change && change.revoked) return;
        const x = ctx.find(r.employee_number, r.email, r.person_key);
        (r.classes || []).filter(c => c.completed && kinds.has(craneCourseKey(c.course))).forEach(c => {
          const until = craneExpiry({ ...c, crane: kinds.get(craneCourseKey(c.course)) });
          add(x, `${r.first_name || ""} ${r.last_name || ""}`, storeLocation(r.store), pgDay(c.completed), until ? pgIso(until) : null, c.course);
        });
      });
    }
    if (kind === "epa609") {
      epaCerts.forEach(c => add(ctx.find(c.employee_number, c.email), c.person_name, storeLocation(c.store), pgDay(c.certified_on), null, "EPA 609"));
      tsPeople.filter(r => r.epa_609).forEach(r => {
        const x = ctx.find(r.employee_number, r.email, r.person_key);
        if (!x || !spans.some(sp => sp.person === x)) add(x, `${r.first_name || ""} ${r.last_name || ""}`, storeLocation(r.store), null, null, "EPA 609");
      });
    }
    const named = CERT_KINDS.find(k => k.id === kind);
    if (named) lcCerts.filter(c => c.kind === kind).forEach(c => {
      const x = ctx.byProfile(c.user_id) || ctx.find(c.employee_number, c.email);
      add(x, c.person_name, ctx.profileLocation(c.user_id), pgDay(c.issued_on), pgDay(c.expires_on), named.name);
    });
    return { spans, records: spans.filter(sp => sp.from), facet: "Certification" };
  },

  safety_briefs(_p, ctx) {
    const briefs = new Map(safetyBriefs.map(b => [b.id, b]));
    return { facet: "Brief", records: safetyResults.filter(r => r.passed_at).map(r => {
      const x = ctx.byProfile(r.person_id), b = briefs.get(r.brief_id);
      // Counted toward the brief's own month, whenever it was passed.
      return { at: b ? pgDay(b.month) : pgDay(r.passed_at), person: x, name: x ? x.name : r.person_name || ctx.profileName(r.person_id),
        location: x ? x.location : ctx.profileLocation(r.person_id), what: `${b ? `${briefMonthTitle(b)}: ${b.title}` : "Safety Brief"} · passed ${pgShort(pgDay(r.passed_at))}`,
        facet: b ? briefMonthTitle(b) : "Safety Brief", value: 1 };
    }) };
  },

  safety_reports(p, ctx) {
    const kinds = (p.settings || {}).kinds || [];
    return { facet: "Kind", records: (progReports || []).filter(r => !kinds.length || kinds.includes((r.answers || {}).kind)).map(r => {
      const a = r.answers || {}, x = ctx.byProfile(r.created_by) || ctx.find(null, r.reporter_email);
      const kind = srShortKind(a.kind) || a.kind || "Safety Report";
      return { at: pgDay(r.created_at), person: x, name: r.reporter_name || (x && x.name) || "Someone",
        location: a.where && locations[a.where] ? a.where : r.reporter_location || (x && x.location) || null,
        what: a.title ? `${kind}: ${a.title}` : kind, facet: kind, value: 1 };
    }) };
  },

  manual(p) {
    return { facet: "Location", records: (progNumbers.get(p.id) || []).map(n => ({ at: n.period_start, person: null,
      name: n.entered_by_name || "", location: n.location_id || null, what: n.note || "", facet: n.location_id ? locations[n.location_id] || n.location_id : "Company",
      value: Number(n.value) || 0 })) };
  }
};

// ---- the figures

// What a value means: a share of people (0 to 1), or a number.
const pgIsShare = (p) => p.measure === "people" && p.goal_unit !== "number";
const pgGoal = (p) => p.goal_direction === "none" || p.goal_value == null ? null : pgIsShare(p) ? Number(p.goal_value) / 100 : Number(p.goal_value);
const pgMeets = (p, v) => { const g = pgGoal(p); return g === null || v === null ? null : p.goal_direction === "at_most" ? v <= g : v >= g; };
const pgFmt = (p, v) => v === null || v === undefined ? "—" : pgIsShare(p) ? `${Math.round(v * 100)}%`
  : Number(v).toLocaleString("en-US", { maximumFractionDigits: 1 });
// What's counted, in a word or two, for the tiles: "technicians", "reports", "dollars of parts sold".
function pgUnit(p, n = 2) {
  const s = p.settings || {}, w = s.people || {};
  if (p.measure === "people") {
    const kinds = (w.jobs || []).map(k => (JOB_KINDS.find(j => j.id === k) || { plural: k }).plural.toLowerCase());
    return kinds.length === 1 ? (n === 1 ? JOB_KINDS.find(j => j.id === w.jobs[0]).label.toLowerCase() : kinds[0]) : n === 1 ? "person" : "people";
  }
  if (p.source === "manual") return s.unit || "";
  if (p.measure === "total") return "hours";
  return { training: n === 1 ? "class" : "classes", safety_reports: n === 1 ? "report" : "reports" }[p.source] || "";
}

// Everything the dashboard shows for one year of a program.
function pgFigures(p, back, ctx) {
  const start = pgYearStart(p, back), end = pgAddMonths(start, 12), today = todayISO();
  const periods = pgPeriods(p, start), whose = pgWhose(p), source = progSource(p.source);
  const got = (PROG_COLLECT[p.source] || (() => ({ records: [] })))(p, ctx);
  const records = got.records.filter(r => r.at && (!whose.any || whose.test(r.person)));
  const spans = got.spans ? got.spans.filter(sp => !whose.any || whose.test(sp.person)) : null;
  const total = p.measure === "total";
  const sum = (list) => list.reduce((n, r) => n + (total ? r.value : 1), 0);
  const inRange = (from, to) => records.filter(r => r.at >= from && r.at < to);

  // People: whoever counts on a day, and whether they'd done it by then.
  const scoped = p.measure === "people" ? ctx.everyone.filter(x => whose.test(x)) : [];
  const scopeOn = (day) => scoped.filter(x => pgHereOn(x, day));
  const dates = new Map(), held = new Map();
  records.forEach(r => { if (r.person) (dates.get(r.person) || dates.set(r.person, []).get(r.person)).push(r); });
  (spans || []).forEach(sp => { if (sp.person) (held.get(sp.person) || held.set(sp.person, []).get(sp.person)).push(sp); });
  const windowFrom = (period) => p.counts_when === "ever" ? "0000-01-01"
    : p.counts_when === "months" ? pgAddMonths(period.asOf, -(Number(p.within_months) || 12))
    : p.goal_span === "period" ? period.start : start;
  // The record that counts someone: their latest in the window, or the certification they hold.
  const proof = (x, from, day) => spans
    ? (held.get(x) || []).filter(sp => (!sp.from || sp.from <= day) && (!sp.until || sp.until >= day)).sort((a, b) => String(b.until || "9").localeCompare(String(a.until || "9")))[0] || null
    : (dates.get(x) || []).filter(r => r.at >= from && r.at <= day).sort((a, b) => b.at.localeCompare(a.at))[0] || null;
  const peopleAt = (period) => {
    const scope = scopeOn(period.asOf), from = windowFrom(period);
    const done = scope.map(x => ({ x, proof: proof(x, from, period.asOf) })).filter(d => d.proof);
    return { of: scope.length, done, scope, value: pgIsShare(p) ? (scope.length ? done.length / scope.length : null) : done.length };
  };

  let running = 0;
  periods.forEach(pd => {
    pd.records = inRange(pd.start, pd.end);
    if (spans) pd.records = spans.filter(sp => sp.from && sp.from >= pd.start && sp.from < pd.end);
    if (pd.future) { pd.value = null; pd.happened = null; return; }
    pd.happened = p.measure === "people" ? new Set(pd.records.filter(r => r.person && scoped.includes(r.person)).map(r => r.person)).size : sum(pd.records);
    if (p.measure === "people") {
      const at = peopleAt(pd);
      Object.assign(pd, { value: at.value, of: at.of, done: at.done.length });
    } else {
      running += pd.happened;
      pd.value = p.goal_span === "period" ? pd.happened : running;
    }
    pd.cumulative = p.measure === "people" ? pd.value : running;
    pd.meets = pgMeets(p, p.measure === "people" || p.goal_span === "period" ? pd.value : null);
  });

  // Where it stands: as of today, or the end of a year that's over.
  const shown = periods.filter(pd => !pd.future);
  const current = shown[shown.length - 1] || periods[0];
  const asOf = current.asOf;
  let stands, people = null;
  if (p.measure === "people") {
    people = peopleAt(current);
    stands = people.value;
  } else stands = p.goal_span === "period" ? current.happened : sum(inRange(start, pgAddDays(asOf, 1)));
  const yearRecords = inRange(start, pgAddDays(asOf, 1));
  const frac = Math.min(1, (pgDaysBetween(start, asOf) + 1) / pgDaysBetween(start, end));
  return { p, source, start, end, asOf, today, periods, current, stands, people, frac, records, spans, yearRecords, scoped, facet: got.facet,
    over: asOf < today || back > 0 };
}

// Ahead, on pace or behind, in plain words: the year's goal against how much
// of the year has gone, or how many periods have met it.
function pgPace(f) {
  const p = f.p, g = pgGoal(p), most = p.goal_direction === "at_most";
  if (g === null) return null;
  if (p.goal_span === "period") {
    const done = f.periods.filter(pd => !pd.future && !pd.now);
    const met = done.filter(pd => pd.meets).length;
    const word = PROG_PERIOD[p.tracked];
    return { tone: !done.length ? "steel" : met === done.length ? "green" : met >= done.length / 2 ? "amber" : "red",
      title: !done.length ? `First ${word}` : `${met} of ${done.length}`,
      text: !done.length ? `The first ${word} isn't over yet.` : `${done.length === 1 ? `${word} that's over` : `${word}s that are over`} met the goal.` };
  }
  if (f.over) {
    const ok = pgMeets(p, f.stands);
    return { tone: ok ? "green" : "red", title: ok ? "Reached" : "Missed", text: `Finished at ${pgFmt(p, f.stands)} against a goal of ${pgFmt(p, g)}.` };
  }
  // A share kept over time (ever, the last so many months, a certification) isn't paced: it's on goal now or not.
  if (p.measure === "people" && (p.counts_when !== "year" || f.spans)) {
    const ok = pgMeets(p, f.stands);
    return { tone: ok ? "green" : "amber", title: ok ? "On goal" : "Below goal", text: ok ? "On goal today." : `${pgFmt(p, f.stands)} today; the goal is ${pgFmt(p, g)}.` };
  }
  const expected = g * f.frac, v = f.stands || 0;
  const projected = f.frac > 0 ? v / f.frac : v;
  const shown = pgIsShare(p) ? Math.min(1, projected) : projected;
  if (most) {
    const ok = projected <= g;
    return { tone: ok ? "green" : "red", title: ok ? "Within the limit" : "Heading over",
      text: `At this rate the year ends near ${pgFmt(p, shown)}; the limit is ${pgFmt(p, g)}.` };
  }
  const ratio = expected ? v / expected : 1;
  const tone = ratio >= 1.05 ? "green" : ratio >= 0.95 ? "teal" : ratio >= 0.75 ? "amber" : "red";
  return { tone, title: ratio >= 1.05 ? "Ahead" : ratio >= 0.95 ? "On pace" : "Behind",
    text: `By now it would be ${pgFmt(p, expected)} to finish on goal. At this rate the year ends near ${pgFmt(p, shown)}.` };
}

// What it takes to reach the goal: "12 more technicians", "3 more reports this month".
function pgTakes(f) {
  const p = f.p, g = pgGoal(p);
  if (g === null || f.over) return "";
  const most = p.goal_direction === "at_most", when = p.goal_span === "period" ? ` this ${PROG_PERIOD[p.tracked]}` : "";
  if (p.measure === "people") {
    const need = pgIsShare(p) ? Math.ceil(g * f.people.of - 1e-9) - f.people.done.length : g - f.people.done.length;
    return most ? "" : need > 0 ? `${need.toLocaleString()} more ${need === 1 ? pgUnit(p, 1) : pgUnit(p)}` : "Goal reached";
  }
  const left = g - (f.stands || 0), unit = pgUnit(p, Math.abs(left) === 1 ? 1 : 2);
  if (most) return left >= 0 ? `${pgFmt(p, left)} ${unit} left before the limit${when}` : `Over the limit by ${pgFmt(p, -left)}${when}`;
  return left > 0 ? `${pgFmt(p, left)} more ${unit}${when}` : `Goal reached${when}`;
}

// ---- drawing

// A chart of the year's periods: bars, a line, last year's line, the goal and the pace to it.
// `percent` draws the scale as 0-100%; a bar or dot on the wrong side of the goal is marked short.
function pgChart(f, { bars, line, last, goal, pace, label, percent = false }) {
  const W = 960, H = 250, L = 50, R = 14, T = 18, B = 28, n = f.periods.length, band = (W - L - R) / n;
  const share = percent, most = f.p.goal_direction === "at_most";
  const short = (v) => typeof goal === "number" && v !== null && v !== undefined && (most ? v > goal : v < goal);
  const values = [...(bars || []), ...(line || []), ...(last || []), goal, pace].filter(v => typeof v === "number");
  let max = Math.max(share ? 1 : 0, ...values, 0) || 1, nice = .25;
  if (!share) {
    // A step of 1, 2, 2.5 or 5 times a power of ten, whole for anything counted, and at most five of them.
    const step = Math.pow(10, Math.floor(Math.log10(max / 4)));
    nice = Math.max(Number.isInteger(max) || max >= 4 ? 1 : 0, [1, 2, 2.5, 5, 10].map(m => m * step).find(x => max / x <= 5) || step * 10);
    max = Math.ceil(max / nice) * nice;
  }
  const ticks = Array.from({ length: Math.round(max / nice) + 1 }, (_, i) => i * nice);
  const y = (v) => T + (H - T - B) * (1 - v / max), cx = (i) => L + band * (i + .5);
  const fmt = (v) => share ? `${Math.round(v * 100)}%` : Number(v).toLocaleString("en-US", { maximumFractionDigits: 1, notation: max >= 1e5 ? "compact" : "standard" });
  const every = Math.ceil(n / 13);
  const path = (vals) => vals.map((v, i) => v === null || v === undefined ? null : `${cx(i).toFixed(1)},${y(v).toFixed(1)}`).filter(Boolean).join(" ");
  const pick = progPick;
  return `<svg class="pg-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}">
    ${ticks.map(v => `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text class="tick" x="${L - 8}" y="${y(v) + 4}" text-anchor="end">${fmt(v)}</text>`).join("")}
    ${f.periods.map((pd, i) => `<g class="pg-hit${pick === i ? " on" : ""}${pd.future ? " future" : ""}" data-pg-period="${i}">
      <rect class="hit" x="${L + band * i}" y="${T}" width="${band}" height="${H - T - B}"/>
      ${bars && bars[i] !== null && bars[i] !== undefined ? `<rect class="bar${short(bars[i]) ? " short" : ""}"
        x="${(L + band * i + band * .18).toFixed(1)}" y="${y(Math.max(0, bars[i])).toFixed(1)}" width="${(band * .64).toFixed(1)}"
        height="${Math.max(bars[i] > 0 ? 1.5 : 0, y(0) - y(Math.max(0, bars[i]))).toFixed(1)}" rx="2"/>` : ""}
      <title>${esc(pd.label)}${bars && bars[i] !== null && bars[i] !== undefined ? `: ${fmt(bars[i])}` : line && line[i] !== null && line[i] !== undefined ? `: ${fmt(line[i])}` : ""}</title>
      ${i % every === 0 ? `<text class="tick x" x="${cx(i)}" y="${H - 8}" text-anchor="middle">${esc(pd.short)}</text>` : ""}</g>`).join("")}
    ${typeof pace === "number" ? `<line class="pace" x1="${L}" y1="${y(0)}" x2="${W - R}" y2="${y(pace)}"/>` : ""}
    ${typeof goal === "number" ? `<line class="goal" x1="${L}" x2="${W - R}" y1="${y(goal)}" y2="${y(goal)}"/>
      <text class="goal-label" x="${W - R - 4}" y="${y(goal) - 6}" text-anchor="end">Goal ${fmt(goal)}</text>` : ""}
    ${last && last.some(v => v !== null && v !== undefined) ? `<polyline class="last" points="${path(last)}"/>` : ""}
    ${line ? `<polyline class="line" points="${path(line)}"/>${line.map((v, i) => v === null || v === undefined ? ""
      : `<circle class="dot${short(v) ? " short" : ""}" cx="${cx(i)}" cy="${y(v)}" r="${pick === i ? 5 : 3.5}"/>`).join("")}` : ""}
  </svg>`;
}
const pgKey = (items) => `<div class="pg-key">${items.filter(Boolean).map(([cls, text]) => `<span><i class="${cls}"></i>${esc(text)}</span>`).join("")}</div>`;

// Horizontal bars: a label, a bar, and its figure.
function pgBarsHtml(rows, { share = false, goal = null } = {}) {
  if (!rows.length) return `<p class="sx-empty">Nothing to show yet.</p>`;
  const max = share ? 1 : Math.max(...rows.map(r => r.value), 1);
  return `<div class="pg-bars">${rows.map(r => `<div class="pg-bar-row">
      <span class="pg-bar-name">${esc(r.label)}${r.sub ? `<small>${esc(r.sub)}</small>` : ""}</span>
      <span class="pg-bar"><i class="${goal !== null && r.value < goal ? "short" : ""}" style="width:${Math.max(r.value > 0 ? 1 : 0, r.value / max * 100)}%"></i>${
        goal !== null && share ? `<b class="pg-bar-goal" style="left:${goal * 100}%"></b>` : ""}</span>
      <span class="pg-bar-val">${esc(r.text)}</span></div>`).join("")}</div>`;
}

async function pgLoad(p) {
  progLoadError = null;
  const reads = [];
  if (p.source === "safety_reports" && !progReports) {
    const since = `${+todayISO().slice(0, 4) - PROG_YEARS_BACK - 2}-01-01`;
    reads.push(allRows(() => db.from("safety_reports").select("id,created_by,reporter_name,reporter_email,reporter_location,created_at,answers,status")
      .gte("created_at", since).order("created_at").order("id")).then(({ data, error }) => {
      if (error) progLoadError = error.message; else progReports = data || [];
    }));
  }
  if (p.source === "manual") {
    reads.push(allRows(() => db.from("program_numbers").select("*").eq("program_id", p.id).order("period_start").order("id")).then(({ data, error }) => {
      if (error) progLoadError = error.message; else progNumbers.set(p.id, data || []);
    }));
  }
  await Promise.all(reads);
}

async function progOpenDashboard(id) {
  const p = progList.find(x => x.id === id);
  if (!p) return;
  progOpen = id; progBack = 0; progPick = null; progBy = "location"; progAllToDo = false;
  progShow("dashboard");
  await pgLoad(p);
  progRedraw();
}

function progDashboardHtml() {
  const p = progList.find(x => x.id === progOpen);
  if (!p) return `<p class="sx-empty">That program isn't here any more.</p>`;
  const ctx = pgContext(pgEveryone());
  const f = pgFigures(p, progBack, ctx), last = pgFigures(p, progBack + 1, ctx);
  const goal = pgGoal(p), pace = pgPace(f), takes = pgTakes(f), source = f.source;
  if (progPick === null || !f.periods[progPick] || f.periods[progPick].future) progPick = f.current.i;
  const pd = f.periods[progPick], word = PROG_PERIOD[p.tracked];
  const people = p.measure === "people", years = Array.from({ length: PROG_YEARS_BACK + 1 }, (_, i) => i);
  const sameDay = last.periods[f.current.i] || null;
  const lastAtThisPoint = sameDay ? (p.measure === "people" || p.goal_span === "period" ? sameDay.value : sameDay.cumulative) : null;
  const unit = pgUnit(p), meets = pgMeets(p, f.stands);

  // The gauge: where it stands across the scale, the goal marked, and where the pace says it should be.
  const scaleMax = pgIsShare(p) ? 1 : Math.max(goal || 0, f.stands || 0, 1) * 1.15;
  const at = (v) => Math.max(0, Math.min(100, v / scaleMax * 100));
  const paceMark = pace && goal !== null && p.goal_span === "year" && !f.over && p.goal_direction === "at_least"
    && !(people && (p.counts_when !== "year" || f.spans)) ? goal * f.frac : null;

  const standsWords = people
    ? `${f.people.done.length.toLocaleString()} of ${f.people.of.toLocaleString()} ${f.people.of === 1 ? pgUnit(p, 1) : unit}${pgIsShare(p) ? "" : ` (${f.people.of ? Math.round(f.people.done.length / f.people.of * 100) : 0}%)`}`
    : p.goal_span === "period" ? `${f.current.label}${f.current.now ? ", so far" : ""}` : `${f.over ? "The year" : "The year so far"}, ${unit || "in total"}`;

  return `
    <div class="pg-top">
      <button type="button" class="cab-back" data-pg-back>${icon("chevronLeft", 16)}All programs</button>
      <div class="pg-top-do">
        <select id="pgYearPick" aria-label="Year">${years.map(b => `<option value="${b}"${b === progBack ? " selected" : ""}>${
          esc(b === 0 ? `This year: ${pgYearName(pgYearStart(p, 0))}` : pgYearName(pgYearStart(p, b)))}</option>`).join("")}</select>
        <button type="button" class="cab-back" data-pg-edit="${esc(p.id)}">${icon("pencil", 15)}Change the program</button>
      </div>
    </div>
    <section class="sx-hero pg-dash-hero">
      <div class="sx-hero-text">
        <span class="sx-kicker">${esc(source ? source.label : p.source)} · ${esc(progTrackedText(p))} · ${esc(pgYearName(f.start))}</span>
        <h2>${esc(p.name)}</h2>
        <p>${esc(progSentence(p))}.${p.description ? ` <span class="pg-why">${esc(p.description)}</span>` : ""}</p>
      </div>
    </section>
    ${progLoadError ? `<p class="error">${esc(progLoadError)}</p>` : ""}

    <section class="sx-panel pg-stands" style="${lit(meets === null ? "violet" : meets ? "green" : "amber")}">
      <div class="pg-stands-main">
        <span class="pg-stands-label">${f.over ? "Where it finished" : "Where it stands"}</span>
        <b class="pg-stands-value">${pgFmt(p, f.stands)}</b>
        <span class="pg-stands-sub">${esc(standsWords)}</span>
        ${goal !== null || pgIsShare(p) ? `<div class="pg-gauge" aria-hidden="true"><i style="width:${at(f.stands || 0)}%"></i>${goal !== null
          ? `<b class="pg-gauge-goal" style="left:${at(goal)}%"><span>Goal ${esc(pgFmt(p, goal))}</span></b>` : ""}${paceMark !== null
          ? `<b class="pg-gauge-pace" style="left:${at(paceMark)}%"><span>Pace</span></b>` : ""}</div>` : ""}
      </div>
      <dl class="pg-facts">
        <div><dt>Goal</dt><dd>${goal === null ? "None: just tracking" : `${p.goal_direction === "at_most" ? "At most" : "At least"} ${esc(pgFmt(p, goal))}${
          pgIsShare(p) || !unit ? "" : ` ${esc(unit)}`}${p.goal_span === "period" ? ` every ${word}` : " for the year"}`}</dd></div>
        ${takes ? `<div><dt>What it takes</dt><dd>${esc(takes)}</dd></div>` : ""}
        ${pace ? `<div><dt>${f.over ? "Result" : "On pace?"}</dt><dd><span class="pg-tone" style="${lit(pace.tone)}">${esc(pace.title)}</span> ${esc(pace.text)}</dd></div>` : ""}
        <div><dt>Last year at this point</dt><dd>${lastAtThisPoint === null || lastAtThisPoint === undefined ? "—" : esc(pgFmt(p, lastAtThisPoint))}${
          lastAtThisPoint !== null && lastAtThisPoint !== undefined && f.stands !== null ? ` <small>(${pgChangeWords(p, f.stands, lastAtThisPoint)})</small>` : ""}</dd></div>
      </dl>
    </section>

    ${pgChartsHtml(f, last)}
    ${p.source === "manual" ? pgNumbersHtml(f) : ""}
    ${pgPeriodHtml(f, pd)}
    ${pgBreakdownHtml(f)}
    ${people ? pgToDoHtml(f) : ""}`;
}

// "up 12 points", "down 3", "the same".
function pgChangeWords(p, now, then) {
  const d = now - then;
  if (Math.abs(d) < 1e-9) return "the same";
  return pgIsShare(p) ? `${d > 0 ? "up" : "down"} ${Math.abs(Math.round(d * 100))} point${Math.abs(Math.round(d * 100)) === 1 ? "" : "s"}`
    : `${d > 0 ? "up" : "down"} ${Number(Math.abs(d)).toLocaleString("en-US", { maximumFractionDigits: 1 })}`;
}

function pgChartsHtml(f, last) {
  const p = f.p, goal = pgGoal(p), word = PROG_PERIOD[p.tracked], people = p.measure === "people";
  const lastSeries = last.periods.map(pd => pd.value === null ? null : people || p.goal_span === "period" ? pd.value : pd.cumulative);
  const cumulative = !people && p.goal_span !== "period";
  const lineChart = people || cumulative ? `
    <section class="sx-panel" style="${lit("violet")}">
      <header><h3>${people ? `At the end of each ${word}` : "The year, adding up"}</h3><span>${esc(pgYearName(f.start))}</span></header>
      ${pgChart(f, { line: f.periods.map(pd => pd.future ? null : people ? pd.value : pd.cumulative), last: lastSeries,
        goal: goal !== null && (people || p.goal_span === "period") ? goal : null,
        pace: goal !== null && cumulative && p.goal_span === "year" ? goal : null,
        percent: people && pgIsShare(p), label: `${p.name}, ${people ? `at the end of each ${word}` : "adding up over the year"}` })}
      ${pgKey([["k-line", pgYearName(f.start)], ["k-last", `Last year (${pgYearName(last.start)})`],
        goal !== null && (people || p.goal_span === "period") ? ["k-goal", "Goal"] : null,
        goal !== null && cumulative && p.goal_span === "year" ? ["k-pace", "Pace to the goal"] : null])}
    </section>` : "";
  const bars = f.periods.map(pd => pd.future ? null : pd.happened);
  const barChart = `
    <section class="sx-panel" style="${lit("teal")}">
      <header><h3>${people ? `Done each ${word}` : `Each ${word}`}</h3><span>${people ? `${pgUnit(p)} who did it in that ${word}` : esc(pgUnit(p) || "in total")}</span></header>
      ${pgChart(f, { bars,
        goal: goal !== null && !people && p.goal_span === "period" ? goal : null, label: `${p.name}, each ${word}` })}
      <p class="note pg-chart-note">Pick a ${word} to see what's behind it.</p>
    </section>`;
  return `<div class="pg-charts">${lineChart}${barChart}</div>`;
}

// One period: every record behind it.
function pgPeriodHtml(f, pd) {
  const p = f.p, word = PROG_PERIOD[p.tracked], options = f.periods.filter(x => !x.future);
  const rows = [...(pd.records || [])].sort((a, b) => String(b.at).localeCompare(String(a.at)) || a.name.localeCompare(b.name));
  const total = p.measure === "total";
  const headline = p.measure === "people"
    ? `${pd.happened || 0} ${pd.happened === 1 ? pgUnit(p, 1) : pgUnit(p)} did it${pd.value !== null && pd.value !== undefined ? ` · ${pgFmt(p, pd.value)} at the end of the ${word}${pd.now ? " so far" : ""}` : ""}`
    : `${pgFmt(p, pd.happened)} ${pgUnit(p, pd.happened === 1 ? 1 : 2)}`;
  return `
    <section class="sx-panel" style="${lit("steel")}" id="pgPeriodPanel">
      <header><h3>${esc(pd.label)}</h3><span>${esc(headline)}</span>
        <select id="pgPeriodPick" class="cab-search" aria-label="Pick a ${word}">${options.map(x =>
          `<option value="${x.i}"${x.i === pd.i ? " selected" : ""}>${esc(x.label)}${x.now ? " (now)" : ""}</option>`).join("")}</select></header>
      ${rows.length ? `<div class="lc-scroll"><table class="lc-table">
        <thead><tr><th>When</th><th>Who</th><th>What</th><th>Where</th>${total ? `<th class="num">${esc(pgUnit(p) || "Amount")}</th>` : ""}</tr></thead>
        <tbody>${rows.map(r => `<tr><td class="when">${r.at ? esc(pgShort(r.at)) : "—"}</td><td>${esc(r.name || "—")}${r.person && r.person.job ? `<small>${esc(r.person.job)}</small>` : ""}</td>
          <td>${esc(r.what || "")}${r.until ? `<small>Until ${esc(pgShort(r.until))}</small>` : ""}</td><td>${esc(r.location ? locations[r.location] || r.location : "—")}</td>
          ${total ? `<td class="num">${esc(Number(r.value).toLocaleString("en-US", { maximumFractionDigits: 1 }))}</td>` : ""}</tr>`).join("")}</tbody>
      </table></div>
      <div class="row pg-csv"><button type="button" class="pdf" data-pg-csv="period">${icon("arrowOut", 15)}Download this ${word} (CSV)</button></div>`
      : `<p class="sx-empty">Nothing in ${esc(pd.label)}${pd.now ? " yet" : ""}.</p>`}
    </section>`;
}

// The year so far by location, by job, and by what was done.
function pgBreakdownHtml(f) {
  const p = f.p, people = p.measure === "people", goal = pgGoal(p);
  const facetName = p.source === "manual" ? null : f.facet;
  const tabs = [["location", "By location"], ...(f.source && f.source.people ? [["job", "By job"]] : []), ...(facetName ? [["facet", `By ${facetName.toLowerCase()}`]] : [])];
  if (!tabs.some(([id]) => id === progBy)) progBy = "location";
  const locName = (id) => id ? locations[id] || id : "No location";
  const kindName = (k) => k ? (JOB_KINDS.find(j => j.id === k) || { plural: k }).plural : "Not on the People list";
  const group = (list, keyOf) => { const m = new Map(); list.forEach(x => { const k = keyOf(x); m.set(k, (m.get(k) || []).concat([x])); }); return m; };
  let rows = [];
  if (people && progBy !== "facet") {
    const keyOf = progBy === "job" ? (x) => x.kind : (x) => x.location || "";
    const doneSet = new Set(f.people.done.map(d => d.x));
    rows = [...group(f.people.scope, keyOf)].map(([k, list]) => {
      const done = list.filter(x => doneSet.has(x)).length;
      return { label: progBy === "job" ? kindName(k) : locName(k), value: pgIsShare(p) ? done / list.length : done, of: list.length,
        text: `${done} of ${list.length}${pgIsShare(p) ? ` · ${Math.round(done / list.length * 100)}%` : ""}` };
    }).sort((a, b) => a.value - b.value || a.label.localeCompare(b.label));
  } else if (people) {
    const counts = new Map();
    f.people.done.forEach(d => counts.set(d.proof.facet || d.proof.what, (counts.get(d.proof.facet || d.proof.what) || 0) + 1));
    rows = [...counts].map(([k, n]) => ({ label: k, value: n, text: `${n} ${n === 1 ? pgUnit(p, 1) : pgUnit(p)}` })).sort((a, b) => b.value - a.value);
  } else {
    const list = p.goal_span === "period" ? f.current.records || [] : f.yearRecords;
    const keyOf = progBy === "job" ? (r) => r.person ? r.person.kind : "" : progBy === "facet" ? (r) => r.facet || "Other" : (r) => r.location || "";
    rows = [...group(list, keyOf)].map(([k, rs]) => {
      const v = rs.reduce((n, r) => n + (p.measure === "total" ? r.value : 1), 0);
      return { label: progBy === "job" ? kindName(k) : progBy === "location" ? locName(k) : k, value: v, text: pgFmt(p, v) };
    }).sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
  }
  const what = people ? (progBy === "facet" ? `what each ${pgUnit(p, 1)} counted for did` : `as of ${pgShort(f.asOf)}`)
    : p.goal_span === "period" ? f.current.label : f.over ? "the year" : "the year so far";
  return `
    <section class="sx-panel" style="${lit("amber")}">
      <header><h3>Breakdown</h3><span>${esc(what)}</span>
        <span class="pg-tabs">${tabs.map(([id, t]) => `<button type="button" class="chip${progBy === id ? " on" : ""}" data-pg-by="${id}">${esc(t)}</button>`).join("")}</span></header>
      ${pgBarsHtml(rows, { share: people && pgIsShare(p) && progBy !== "facet", goal: people && pgIsShare(p) && progBy !== "facet" ? goal : null })}
    </section>`;
}

// Everyone who counts and hasn't yet, by location; for training, anyone already
// registered for an upcoming class that would count is marked.
function pgToDo(f) {
  const done = new Set(f.people.done.map(d => d.x));
  const left = f.people.scope.filter(x => !done.has(x));
  const marks = new Map();
  if (f.p.source === "training") {
    const s = f.p.settings || {}, word = String(s.contains || "").trim().toLowerCase(), picked = new Set(s.courses || []);
    const today = todayISO();
    const classes = scClasses.filter(c => c.status === "scheduled" && c.starts_on >= today
      && (picked.has(c.course_id) || (!!word && String(c.title || "").toLowerCase().includes(word))));
    const byId = new Map(classes.map(c => [c.id, c]));
    crRegs.filter(r => byId.has(r.class_id) && r.status !== "cancelled").forEach(r => {
      const x = f.people.scope.find(y => (r.employee_number && y.number && pgNum(r.employee_number) === y.number) || (r.email && y.email === pgMail(r.email)) || y.key === r.person_key);
      const c = byId.get(r.class_id);
      if (x) marks.set(x, `${r.status === "waitlisted" ? "Waitlisted" : "Registered"}: ${c.title}, ${pgShort(c.starts_on)}`);
    });
  }
  return left.map(x => ({ x, note: marks.get(x) || "" }))
    .sort((a, b) => (locations[a.x.location] || "~").localeCompare(locations[b.x.location] || "~") || a.x.name.localeCompare(b.x.name));
}

function pgToDoHtml(f) {
  if (f.over) return "";
  const list = pgToDo(f), shown = progAllToDo ? list : list.slice(0, 40), registered = list.filter(t => t.note).length;
  const byPlace = new Map();
  shown.forEach(t => { const k = t.x.location ? locations[t.x.location] || t.x.location : "No location"; byPlace.set(k, (byPlace.get(k) || []).concat([t])); });
  return `
    <section class="sx-panel" style="${lit("red")}">
      <header><h3>Still to do</h3><span>${list.length.toLocaleString()} ${list.length === 1 ? pgUnit(f.p, 1) : pgUnit(f.p)}${registered ? ` · ${registered} registered for a class` : ""}</span></header>
      ${list.length ? `<div class="pg-todo">${[...byPlace].map(([place, ts]) => `<div class="pg-todo-place"><h4>${esc(place)} <span>${ts.length}</span></h4>
        <ul>${ts.map(t => `<li${t.note ? ` class="booked"` : ""}><b>${esc(t.x.name)}</b>${t.x.job ? `<small>${esc(t.x.job)}</small>` : ""}${t.note ? `<em>${esc(t.note)}</em>` : ""}</li>`).join("")}</ul></div>`).join("")}</div>
      <div class="row pg-csv">
        ${list.length > shown.length ? `<button type="button" class="pdf" data-pg-alltodo>Show all ${list.length.toLocaleString()}</button>` : ""}
        <button type="button" class="pdf" data-pg-csv="todo">${icon("arrowOut", 15)}Download the list (CSV)</button></div>`
      : `<p class="sx-empty">Nobody: everyone who counts has done it.</p>`}
    </section>`;
}

// Numbers kept by hand: a row per period so far, a column per location (or one for the company).
function pgNumbersHtml(f) {
  const p = f.p, s = p.settings || {}, byLoc = s.by_location !== false;
  const places = byLoc ? allLocations.filter(l => l.is_active !== false).map(l => [l.id, l.name]) : [["", "Company"]];
  const rows = progNumbers.get(p.id) || [];
  const cell = (start, loc) => rows.find(n => n.period_start === start && (n.location_id || "") === loc);
  const periods = f.periods.filter(pd => !pd.future);
  return `
    <section class="sx-panel" style="${lit("green")}">
      <header><h3>The numbers</h3><span>${esc(s.unit || "")}, typed in each ${esc(PROG_PERIOD[p.tracked])}${byLoc ? " for each location" : " for the company"}</span></header>
      <div class="lc-scroll"><table class="lc-table pg-numbers">
        <thead><tr><th>${esc(PROG_TRACKED[p.tracked].replace(/ly$/, ""))}</th>${places.map(([, n]) => `<th class="num">${esc(n)}</th>`).join("")}${byLoc ? `<th class="num">All</th>` : ""}</tr></thead>
        <tbody>${periods.slice().reverse().map(pd => {
          const vals = places.map(([id]) => cell(pd.start, id));
          const all = vals.reduce((n, c) => n + (c ? Number(c.value) || 0 : 0), 0);
          return `<tr><td class="when">${esc(pd.label)}</td>${places.map(([id], i) => `<td class="num"><input type="number" step="any" inputmode="decimal"
            data-pg-num="${esc(pd.start)}|${esc(id)}" value="${vals[i] ? esc(vals[i].value) : ""}" aria-label="${esc(pd.label)}, ${esc(places[i][1])}"
            title="${vals[i] ? esc(`${vals[i].entered_by_name || ""} ${vals[i].entered_at ? pgShort(pgDay(vals[i].entered_at)) : ""}`.trim()) : ""}"></td>`).join("")}${
            byLoc ? `<td class="num"><b>${all ? esc(pgFmt(p, all)) : "—"}</b></td>` : ""}</tr>`; }).join("")}</tbody>
      </table></div>
      <p class="note">Saved as you leave each box. Empty a box to take its number away.</p><span class="msg" role="status"></span>
    </section>`;
}

async function pgSaveNumber(input) {
  const p = progList.find(x => x.id === progOpen);
  if (!p) return;
  const [start, loc] = input.dataset.pgNum.split("|");
  const rows = progNumbers.get(p.id) || [];
  const had = rows.find(n => n.period_start === start && (n.location_id || "") === loc);
  const text = input.value.trim(), value = text === "" ? null : Number(text);
  const box = input.closest(".sx-panel");
  if (value !== null && !Number.isFinite(value)) return speak(box, "That isn't a number.", true);
  if (had && value !== null && Number(had.value) === value) return;
  const done = !had && value === null ? { data: [], error: null }
    : value === null ? await db.from("program_numbers").delete().eq("id", had.id).select("id")
    : had ? await db.from("program_numbers").update({ value }).eq("id", had.id).select("id")
    : await db.from("program_numbers").insert({ program_id: p.id, period_start: start, location_id: loc || null, value }).select("id");
  if (done.error) return speak(box, /row-level/i.test(done.error.message) ? "Only an owner, or that location's admin, keeps its numbers." : done.error.message, true);
  await pgLoad(p);
  progRedraw();
  const msg = document.querySelector("#programsAdmin .pg-numbers") && document.querySelector("#programsAdmin .pg-numbers").closest(".sx-panel");
  if (msg) speak(msg, value === null ? "Taken away." : "Saved.", false);
}

// A list as a spreadsheet.
function pgCsv(which) {
  const p = progList.find(x => x.id === progOpen);
  if (!p) return;
  const f = pgFigures(p, progBack, pgContext(pgEveryone()));
  const slug = p.name.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "") || "program";
  const where = (id) => id ? locations[id] || id : "";
  if (which === "todo") {
    return downloadCSV(`${slug}-still-to-do.csv`, [["Name", "Job", "Location", "Employee number", "Email", "Note"],
      ...pgToDo(f).map(t => [t.x.name, t.x.job, where(t.x.location), t.x.number, t.x.email, t.note])]);
  }
  const pd = f.periods[progPick] || f.current;
  downloadCSV(`${slug}-${pd.start}.csv`, [["Date", "Name", "Job", "What", "Location", p.measure === "total" ? pgUnit(p) || "Amount" : "Count"],
    ...(pd.records || []).map(r => [r.at || "", r.name, r.person ? r.person.job : "", r.what, where(r.location), p.measure === "total" ? r.value : 1])]);
}

$("admin").addEventListener("click", async (event) => {
  const b = event.target.closest("[data-pg-new], [data-pg-edit], [data-pg-back], [data-pg-archive], [data-pg-archived], [data-pg-save], [data-pg-delete], "
    + "[data-pg-open], [data-pg-period], [data-pg-by], [data-pg-alltodo], [data-pg-csv]");
  if (!b || !b.closest("#programsAdmin")) return;
  const d = b.dataset;
  if (d.pgNew !== undefined) { progDraft = progBlank(); progFrom = "list"; return progShow("edit"); }
  if (d.pgOpen) return progOpenDashboard(d.pgOpen);
  if (d.pgPeriod !== undefined) {
    progPick = Number(d.pgPeriod);
    progRedraw();
    const panel = $("pgPeriodPanel");
    if (panel) panel.scrollIntoView({ block: "nearest", behavior: "smooth" });
    return;
  }
  if (d.pgBy) { progBy = d.pgBy; return progRedraw(); }
  if (d.pgAlltodo !== undefined) { progAllToDo = true; return progRedraw(); }
  if (d.pgCsv) return pgCsv(d.pgCsv);
  if (d.pgEdit) {
    const p = progList.find(x => x.id === d.pgEdit);
    if (!p) return;
    progFrom = progView === "dashboard" ? "dashboard" : "list";
    progDraft = JSON.parse(JSON.stringify(p));
    progDraft.settings = progDraft.settings || {};
    return progShow("edit");
  }
  if (d.pgBack !== undefined) {
    const back = progView === "edit" && progFrom === "dashboard" && progOpen ? "dashboard" : "list";
    progDraft = null; progFrom = "list";
    return progShow(back);
  }
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
    progDraft = null; progOpen = null; progFrom = "list";
    return progShow("list");
  }
});

// Choices that change what's shown redraw the screen; words just retell the sentence.
$("admin").addEventListener("change", (event) => {
  const t = event.target;
  if (t.id === "pgYearPick") { progBack = Number(t.value) || 0; progPick = null; progAllToDo = false; return progRedraw(); }
  if (t.id === "pgPeriodPick") { progPick = Number(t.value); return progRedraw(); }
  if (t.dataset.pgNum) return pgSaveNumber(t);
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
  if (d.pgField === "goal_unit" || d.pgField === "goal_span") return progRedraw();
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
