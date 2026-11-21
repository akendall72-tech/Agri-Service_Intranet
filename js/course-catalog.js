// The Course Catalog
//
// The catalog everyone reads, and adding and changing courses.

// ---------------------------------------------------------------- course catalog
//
// Agri-Service's own courses (migration 0032), edited here and shown in the
// app and on this page. Courses sit under their category; categories run in
// the order of each one's first course, so the Order field arranges both.

let allCourses = [], coursesError = null;
let editingCourseId = null;
let catalogState = { search: "", audience: null };

// Always offered as choices, even before any course uses them.
const DEFAULT_AUDIENCES = ["Service Technicians", "Parts Associates"];

async function loadCourses() {
  const { data, error } = await db.from("courses").select("*").order("sort_order");
  coursesError = error ? error.message : null;
  allCourses = data || [];
}

// One entry per line, blanks and repeats dropped (a repeat shows twice in the app).
const lines = (text) => uniqueText(String(text || "").split("\n").map(s => s.trim()).filter(Boolean));

function courseAudiences(courses) {
  const counts = {};
  courses.forEach(c => (c.audiences || []).forEach(a => { counts[a] = (counts[a] || 0) + 1; }));
  return Object.keys(counts).sort((a, b) => counts[b] - counts[a] || a.localeCompare(b));
}

function groupCourses(courses) {
  const order = [], by = {};
  [...courses].sort((a, b) => a.sort_order - b.sort_order).forEach(c => {
    const cat = c.category || "General";
    if (!by[cat]) { by[cat] = []; order.push(cat); }
    by[cat].push(c);
  });
  return order.map(cat => [cat, by[cat]]);
}

// ---- the catalog, for everyone ------------------------------------------------

const CAT_CHEVRON = `<svg class="cat-chevron" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 7.5 10 12.5 15 7.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

function catalogCourseHtml(c) {
  const meta = [
    c.level && `<span>${icon("level", 14)}${esc(c.level)}</span>`,
    c.credits && `<span>${icon("training", 14)}${esc(c.credits)}</span>`,
    c.duration && `<span>${icon("clock", 14)}${esc(c.duration)}</span>`,
    (c.audiences || []).length && `<span>${icon("people", 14)}${esc(c.audiences.join(", "))}</span>`
  ].filter(Boolean).join("");
  const prereqs = (c.prerequisites || []).length
    ? `<ul class="cat-prereqs">${c.prerequisites.map(p => `<li>${esc(p)}</li>`).join("")}</ul>`
    : `<p class="cat-desc" style="margin:0">None</p>`;
  return `
    <details class="cat-course">
      <summary>
        <span class="cat-summary"><span class="cat-title">${esc(c.title)}</span>
          ${c.subtitle ? `<span class="cat-subtitle">${esc(c.subtitle)}</span>` : ""}</span>
        ${CAT_CHEVRON}
      </summary>
      <div class="cat-body">
        ${meta ? `<div class="cat-meta">${meta}</div>` : ""}
        ${c.description ? `<p class="cat-desc">${esc(c.description)}</p>` : ""}
        ${(c.topics || []).length ? `<p class="cat-label">Key Topics</p>
          <div class="cat-tags">${c.topics.map(t => `<span>${esc(t)}</span>`).join("")}</div>` : ""}
        <p class="cat-label">Prerequisites</p>
        ${prereqs}
      </div>
    </details>`;
}

function renderCatalogList() {
  const box = $("catList");
  if (!box) return;
  const live = allCourses.filter(c => c.is_active);
  const q = catalogState.search.trim().toLowerCase();
  const shown = live.filter(c => !catalogState.audience || (c.audiences || []).includes(catalogState.audience))
    .filter(c => !q || [c.title, c.subtitle, c.level, c.category, c.credits, c.duration, c.description,
      ...(c.audiences || []), ...(c.topics || []), ...(c.prerequisites || [])]
      .filter(Boolean).join(" ").toLowerCase().includes(q));
  $("catCount").textContent = `${shown.length} of ${live.length} courses`;
  box.innerHTML = shown.length
    ? groupCourses(shown).map(([cat, list]) => `<h2 class="cat-heading">${esc(cat)}</h2>
        <div class="cat-stack">${list.map(catalogCourseHtml).join("")}</div>`).join("")
    : `<p class="cat-empty">No courses match your search.</p>`;
}

function catalogView() {
  if (coursesError) {
    return hero("Course Catalog", "") + `<div class="card"><p class="error">${
      /does not exist|schema cache/i.test(coursesError)
        ? "The catalog isn't set up yet." : "The catalog couldn't be loaded."}</p></div>`;
  }
  const live = allCourses.filter(c => c.is_active);
  const audiences = courseAudiences(live);
  if (catalogState.audience && !audiences.includes(catalogState.audience)) catalogState.audience = null;
  setTimeout(renderCatalogList);

  return hero("Course Catalog", `A reference of ${companyName()} technician, parts, and safety training courses.`) + `
  <div class="cat">
    <div class="cat-controls">
      <div class="cat-search-row">
        <input type="text" id="catSearch" placeholder="Search courses, equipment, or topics…"
               value="${esc(catalogState.search)}" autocomplete="off">
        <span class="cat-count" id="catCount"></span>
      </div>
      ${audiences.length > 1 ? `<div class="cat-filter"><span>Who it's for</span>
        <button type="button" class="cat-chip${catalogState.audience ? "" : " on"}" data-cat-audience="">Everyone</button>
        ${audiences.map(a => `<button type="button" class="cat-chip${catalogState.audience === a ? " on" : ""}"
          data-cat-audience="${esc(a)}">${esc(a)}</button>`).join("")}</div>` : ""}
    </div>
    <div id="catList"></div>
    ${(manager => manager ? `<p class="cat-foot">Questions? Ask ${esc(manager.full_name || "the Training Manager")}${
      manager.full_name ? ", the Training Manager" : ""}: <a href="mailto:${esc(manager.email)}">${esc(manager.email)}</a></p>` : "")(
      trainingManagerContact())}
  </div>`;
}

$("view").addEventListener("input", (event) => {
  if (event.target.id !== "catSearch") return;
  catalogState.search = event.target.value;
  renderCatalogList();
});

$("view").addEventListener("click", (event) => {
  const chip = event.target.closest("[data-cat-audience]");
  if (!chip) return;
  catalogState.audience = chip.dataset.catAudience || null;
  document.querySelectorAll("[data-cat-audience]").forEach(b =>
    b.classList.toggle("on", (b.dataset.catAudience || null) === catalogState.audience));
  renderCatalogList();
});

// ---- admin ------------------------------------------------------------------------
//
// The Training dashboard's Course Catalog, in the Cab look: the catalog as it
// stands, filtered by its tiles and the search, and the form, shut until Add a
// course, Edit or Copy opens it. Saving or cancelling shuts it again and goes
// back to the course in the list.

let caOpen = false;        // the form is showing
let caFilter = "all";      // all | showing | hidden | agco
let caQuery = "";
let caSaid = "";           // what the last save or delete said, over the list
let caJust = null;         // the course just saved, lit up for a moment

const CA_TITLES = { all: "Courses", showing: "Showing", hidden: "Hidden", agco: "AGCO credit" };

function caMatches(c) {
  if (caFilter === "showing" && !c.is_active) return false;
  if (caFilter === "hidden" && c.is_active) return false;
  if (caFilter === "agco" && !c.counts_for_agco) return false;
  const q = caQuery.trim().toLowerCase();
  return !q || [c.title, c.subtitle, c.category, c.level, c.duration, c.record_name, c.description,
    ...(c.audiences || []), ...(c.topics || [])].filter(Boolean).join(" ").toLowerCase().includes(q);
}

function renderCoursesAdmin() {
  const editor = $("courseEditor");
  if (!editor) return;
  editor.classList.toggle("hidden", !caOpen);

  if (coursesError) {
    $("courseStats").innerHTML = "";
    $("courseList").innerHTML = `<p class="error">${/does not exist|schema cache/i.test(coursesError)
      ? "Run migration 0032_course_catalog.sql in the SQL editor, then reload this page."
      : esc(coursesError)}</p>`;
    return;
  }

  // Categories people have used, offered while typing.
  $("courseCategories").innerHTML = [...new Set(allCourses.map(c => c.category).filter(Boolean))]
    .map(c => `<option value="${esc(c)}">`).join("");
  renderAudienceChoices();

  if (caFilter === "agco" && !companyHas("agco")) caFilter = "all";
  const showing = allCourses.filter(c => c.is_active).length;
  const hidden = allCourses.length - showing;
  const agco = allCourses.filter(c => c.counts_for_agco).length;
  const cats = new Set(allCourses.map(c => c.category || "General")).size;
  const tile = (key, label, value, sub, colour) =>
    cabTile(label, sxNum(value), sub, { colour, data: `data-ca-filter="${key}"`, on: caFilter === key });
  const tiles = [
    tile("all", "Courses", allCourses.length, `In ${cats} ${cats === 1 ? "category" : "categories"}`, "teal"),
    tile("showing", "Showing", showing, "In the app and on this page", "green"),
    companyHas("agco") && tile("agco", "AGCO credit", agco, "Count toward AGCO hours", "amber"),
    tile("hidden", "Hidden", hidden, hidden ? "Kept here, out of the catalog" : "None hidden", "muted")
  ].filter(Boolean);
  $("courseStats").style.setProperty("--n", tiles.length);
  $("courseStats").innerHTML = tiles.join("");

  renderCaList();
}

function renderCaList() {
  const list = $("courseList");
  const shown = allCourses.filter(caMatches);
  const q = caQuery.trim();
  $("courseListTitle").textContent = CA_TITLES[caFilter] || CA_TITLES.all;
  $("courseCount").textContent = `${sxNum(shown.length)}${q ? " matching" : ""}`;
  const said = $("courseSaid");
  said.textContent = caSaid;
  said.classList.toggle("hidden", !caSaid);

  list.innerHTML = !allCourses.length
    ? `<p class="sx-empty">No courses yet. <b>Add a course</b> starts the catalog.</p>`
    : !shown.length ? `<p class="sx-empty">No course ${q ? "matches" : "here"}.</p>`
    : groupCourses(shown).map(([cat, courses]) => `
      <h4>${esc(cat)} <span>${courses.length}</span></h4>
      <div class="ca-courses">${courses.map(caCourseHtml).join("")}</div>`).join("");
  caJust = null;
}

function caCourseHtml(c) {
  const hours = c.training_hours != null
    ? `${tcHours(c.training_hours)} training ${Number(c.training_hours) === 1 ? "hour" : "hours"}` : "";
  const meta = [
    c.level && `<span>${icon("level", 14)}${esc(c.level)}</span>`,
    c.duration && `<span>${icon("clock", 14)}${esc(c.duration)}</span>`,
    hours && `<span>${icon("training", 14)}${esc(hours)}</span>`,
    `<span>${icon("people", 14)}${esc((c.audiences || []).join(", ") || "No audience set")}</span>`
  ].filter(Boolean).join("");
  const tags = [
    !c.is_active && `<span class="ca-tag off">Hidden</span>`,
    c.counts_for_agco && companyHas("agco") && `<span class="ca-tag agco">AGCO credit</span>`,
    c.counts_for_forklift && `<span class="ca-tag fk">Forklift driving test</span>`,
    c.counts_for_crane && `<span class="ca-tag crane">Crane &amp; rigging${c.crane_months ? ` · ${esc(c.crane_months)} months` : ""}</span>`
  ].filter(Boolean).join("");
  const editing = caOpen && editingCourseId === c.id;
  return `<article class="ca-course${c.is_active ? "" : " off"}${editing ? " editing" : ""}${caJust === c.id ? " just" : ""}"
      data-course="${esc(c.id)}">
    <div class="ca-main">
      <div class="ca-head"><b>${esc(c.title)}</b>${tags}</div>
      ${c.subtitle ? `<span class="ca-subtitle">${esc(c.subtitle)}</span>` : ""}
      ${c.description ? `<p class="ca-desc">${esc(c.description)}</p>` : ""}
      <div class="ca-meta">${meta}${c.record_name ? `<span>On records as ${esc(c.record_name)}</span>` : ""}
        <span class="ca-order">Order ${esc(c.sort_order)}</span></div>
    </div>
    <div class="ca-do">
      ${editing ? `<span class="ca-editing">Editing</span>` : `<button type="button" class="pdf" data-act="edit-course">Edit</button>`}
      <button type="button" class="pdf" data-act="copy-course">Copy</button>
      <button type="button" class="pdf" data-act="delete-course">Delete</button>
    </div>
    <span class="msg"></span>
  </article>`;
}

function renderAudienceChoices(selected) {
  const box = $("courseAudienceChoices");
  const current = selected || [...box.querySelectorAll("button.on")].map(b => b.dataset.audience);
  const all = [...new Set([...DEFAULT_AUDIENCES, ...courseAudiences(allCourses), ...current])];
  box.innerHTML = all.map(a => `<button type="button" class="chip${current.includes(a) ? " on" : ""}"
    data-audience="${esc(a)}" aria-pressed="${current.includes(a)}">${esc(a)}</button>`).join("");
}

function fillCourseForm(course, { copy = false } = {}) {
  const editor = $("courseEditor");
  const set = (f, v) => { editor.querySelector(`[data-c="${f}"]`).value = v ?? ""; };
  editingCourseId = course && !copy ? course.id : null;

  set("title", course ? course.title + (copy ? " (copy)" : "") : "");
  set("subtitle", course && course.subtitle);
  set("category", course && course.category);
  set("level", course && course.level);
  set("training_hours", course && course.training_hours != null ? Number(course.training_hours) : "");
  set("record_name", course && course.record_name);
  editor.querySelector('[data-c="counts_for_agco"]').checked = !!(course && course.counts_for_agco);
  editor.querySelector('[data-c="counts_for_forklift"]').checked = !!(course && course.counts_for_forklift);
  editor.querySelector('[data-c="counts_for_crane"]').checked = !!(course && course.counts_for_crane);
  set("crane_months", course && course.crane_months);
  caShowCraneMonths();
  // The Training Manager sets a course's credits, whether it counts for the
  // forklift driving test (0151) and for crane & rigging (0157); other owners
  // see them.
  const manager = isTrainingManager();
  ["training_hours", "counts_for_agco", "record_name", "counts_for_forklift", "counts_for_crane", "crane_months"].forEach(f =>
    editor.querySelector(`[data-c="${f}"]`).disabled = !manager);
  $("courseCreditNote").textContent = manager
    ? "The Credits line on the catalog is written from these. Only the Training Manager changes them."
    : "Only the Training Manager changes these. The Credits line on the catalog is written from them.";
  set("duration", course && course.duration);
  set("description", course && course.description);
  set("topics", course ? (course.topics || []).join("\n") : "");
  set("prerequisites", course ? (course.prerequisites || []).join("\n") : "");
  set("sort_order", course ? course.sort_order + (copy ? 1 : 0)
    : allCourses.reduce((m, c) => Math.max(m, c.sort_order || 0), 0) + 10);
  set("is_active", !course || course.is_active ? "yes" : "no");
  set("new_audience", "");
  renderAudienceChoices(course ? [...(course.audiences || [])] : []);

  $("courseEditorTitle").textContent = editingCourseId ? "Edit course" : copy ? "Copy a course" : "Add a course";
  $("courseEditorSub").textContent = editingCourseId ? course.category || ""
    : copy ? `From ${course.title}` : "";
  editor.querySelector('[data-act="save-course"]').textContent = editingCourseId ? "Save changes" : "Add course";
  speak(editor, "", false);
}

// Opens the form on a course (or a new one) and goes to it.
function caOpenForm(course, options) {
  caOpen = true;
  caSaid = "";
  fillCourseForm(course, options);
  renderCoursesAdmin();
  $("courseEditor").scrollIntoView({ behavior: "smooth", block: "start" });
  $("courseTitle").focus({ preventScroll: true });
}

// Shuts the form and goes back to the course in the list.
function caCloseForm(backTo) {
  caOpen = false;
  fillCourseForm(null);
  renderCoursesAdmin();
  const row = backTo && document.querySelector(`#courseList [data-course="${CSS.escape(backTo)}"]`);
  if (row) row.scrollIntoView({ behavior: "smooth", block: "center" });
}

// How long the crane & rigging qualification lasts shows with its box.
function caShowCraneMonths() {
  $("courseCraneMonthsRow").classList.toggle("hidden", !$("courseCrane").checked);
}

// People qualified now who wouldn't be with these crane courses: the course
// no longer counts, or it would run out straight away.
function caCraneLosses(courses) {
  const today = new Date(new Date().toDateString());
  const byKey = new Map(courses.map(c => [craneCourseKey(c.record), c]));
  return tsPeople.filter(r => {
    if (craneStatus(r).kind !== "qualified") return false;
    const done = (r.classes || []).filter(c => byKey.has(craneCourseKey(c.course)))
      .sort((a, b) => String(b.completed || "").localeCompare(String(a.completed || "")))[0];
    if (!done) return true;
    const ends = craneExpiry({ ...done, crane: byKey.get(craneCourseKey(done.course)) });
    return !!ends && ends < today;
  }).length;
}

// The ticked courses as the settings give them, from the catalog just saved,
// so the crane screens follow without waiting for Training Status to reload.
function caCraneSettingsFromCatalog() {
  if (!tsSources) return;
  tsSources.crane_courses = [...allCourses].filter(c => c.counts_for_crane)
    .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0) || a.title.localeCompare(b.title))
    .map(c => ({ title: c.title, record_name: c.record_name || c.title, months: c.crane_months }));
  if (typeof redrawCrane === "function") redrawCrane();
}

$("admin").addEventListener("change", (event) => {
  if (event.target.id === "courseCrane") caShowCraneMonths();
});

$("admin").addEventListener("input", (event) => {
  if (event.target.id !== "courseSearch") return;
  caQuery = event.target.value;
  renderCaList();
});

$("admin").addEventListener("click", async (event) => {
  const audienceChip = event.target.closest("#courseAudienceChoices button[data-audience]");
  if (audienceChip) {
    audienceChip.setAttribute("aria-pressed", audienceChip.classList.toggle("on"));
    return;
  }

  const filter = event.target.closest("#courseStats [data-ca-filter]");
  if (filter) {
    const key = filter.dataset.caFilter;
    caFilter = key === caFilter ? "all" : key;
    caSaid = "";
    return renderCoursesAdmin();
  }

  const button = event.target.closest("button[data-act]");
  if (!button) return;
  const act = button.dataset.act;
  if (!["new-course", "add-audience", "save-course", "cancel-course", "edit-course", "copy-course", "delete-course"].includes(act)) return;
  const editor = $("courseEditor");

  if (act === "new-course") return caOpenForm(null);

  if (act === "add-audience") {
    const input = editor.querySelector('[data-c="new_audience"]');
    const name = input.value.trim();
    if (!name) return;
    const current = [...editor.querySelectorAll("#courseAudienceChoices button.on")].map(b => b.dataset.audience);
    renderAudienceChoices([...new Set([...current, name])]);
    input.value = "";
    return;
  }

  if (act === "cancel-course") return caCloseForm(editingCourseId);

  if (act === "edit-course" || act === "copy-course") {
    const course = allCourses.find(c => c.id === button.closest("[data-course]").dataset.course);
    return caOpenForm(course, { copy: act === "copy-course" });
  }

  if (act === "delete-course") {
    const row = button.closest("[data-course]");
    const course = allCourses.find(c => c.id === row.dataset.course);
    if (!confirm(`Delete "${course.title}" from the catalog? This can't be undone. ` +
                 `To take it out of the catalog for now, edit it and set Showing to No.`)) return;
    const { data, error } = await db.from("courses").delete().eq("id", course.id).select();
    if (error) return speak(row, error.message, true);
    if (!data || !data.length) return speak(row, "Nothing deleted. Only an owner can remove courses.", true);
    if (editingCourseId === course.id) { caOpen = false; fillCourseForm(null); }
    await loadCourses();
    caSaid = `Deleted ${course.title}.`;
    if (course.counts_for_crane) caCraneSettingsFromCatalog();
    renderCoursesAdmin();
    return renderCourseCredits();
  }

  // save-course
  const get = (f) => editor.querySelector(`[data-c="${f}"]`).value.trim();
  if (!get("title")) return speak(editor, "The course needs a title.", true);
  if (!get("category")) return speak(editor, "Pick or type a category.", true);

  const pending = get("new_audience");
  const audiences = [...editor.querySelectorAll("#courseAudienceChoices button.on")].map(b => b.dataset.audience);
  if (pending && !audiences.some(a => a.toLowerCase() === pending.toLowerCase())) audiences.push(pending);

  const hours = get("training_hours");
  if (hours !== "" && !(Number(hours) >= 0 && Number(hours) <= 1000)) return speak(editor, "Training hours are a number from 0 to 1000.", true);
  const crane = editor.querySelector('[data-c="counts_for_crane"]').checked;
  const monthsRaw = crane ? get("crane_months") : "";
  const months = monthsRaw === "" ? null : Number(monthsRaw);
  if (months !== null && !(Number.isInteger(months) && months >= 1 && months <= 240)) {
    return speak(editor, "The crane & rigging qualification lasts whole months from 1 to 240, or leave it empty so it doesn't run out.", true);
  }
  const row = {
    title: get("title"),
    subtitle: get("subtitle") || null,
    category: get("category"),
    level: get("level") || null,
    // Sent only by the Training Manager: the database refuses anyone else's change.
    ...(isTrainingManager() ? {
      training_hours: hours === "" ? null : Number(hours),
      counts_for_agco: editor.querySelector('[data-c="counts_for_agco"]').checked,
      record_name: get("record_name") || null,
      counts_for_forklift: editor.querySelector('[data-c="counts_for_forklift"]').checked,
      counts_for_crane: crane,
      crane_months: months
    } : {}),
    duration: get("duration") || null,
    audiences,
    description: get("description") || null,
    topics: lines(get("topics")),
    prerequisites: lines(get("prerequisites")),
    sort_order: parseInt(get("sort_order"), 10) || 0,
    is_active: get("is_active") === "yes"
  };

  // Unticking a crane course, or making its qualification shorter, can take
  // it away from people who have it now: say how many before saving.
  const before = allCourses.find(c => c.id === editingCourseId);
  if (isTrainingManager() && (before ? (!!before.counts_for_crane !== crane || (before.crane_months ?? null) !== months) : crane)) {
    const record = row.record_name || (before && before.record_name) || row.title;
    const after = allCourses.filter(c => c.counts_for_crane && c.id !== editingCourseId)
      .map(c => ({ title: c.title, record: c.record_name || c.title, months: c.crane_months }))
      .concat(crane ? [{ title: row.title, record, months }] : []);
    const losing = caCraneLosses(after);
    if (losing && !confirm(`${losing} ${losing === 1 ? "person who is" : "people who are"} crane & rigging qualified now `
        + `wouldn't be: ${crane ? "their qualification would have run out." : "the course they took would no longer count."}\n\n`
        + "They'd show as not qualified in the app and on this page until they take a qualifying course again. Save anyway?")) {
      return speak(editor, "", false);
    }
  }

  speak(editor, "Saving…", false);
  const query = editingCourseId
    ? db.from("courses").update(row).eq("id", editingCourseId).select()
    : db.from("courses").insert(row).select();
  const { data, error } = await query;
  if (error) {
    return speak(editor, /row-level/i.test(error.message) ? "Only an owner can change the catalog."
      : /counts_for_crane|crane_months/i.test(error.message) ? "Run migration 0157_crane_course_box.sql in the SQL editor first."
      : /counts_for_forklift/i.test(error.message) ? "Run migration 0151_forklift_classes.sql in the SQL editor first."
      : /does not exist|schema cache/i.test(error.message)
        ? "Run migration 0032_course_catalog.sql in the SQL editor first." : error.message, true);
  }
  if (!data || !data.length) return speak(editor, "Nothing changed. Only an owner can edit courses.", true);

  const added = !editingCourseId;
  const id = editingCourseId || data[0].id;
  await loadCourses();
  // Back to the course, wherever the filters had got to.
  const saved = allCourses.find(c => c.id === id);
  if (saved && !caMatches(saved)) { caFilter = "all"; caQuery = ""; $("courseSearch").value = ""; }
  caSaid = `${added ? "Added" : "Saved"} ${row.title}. ${row.is_active
    ? "Phones show it the next time the catalog is opened." : "It's hidden from the catalog until Showing is Yes."}`;
  caJust = id;
  caCraneSettingsFromCatalog();
  caCloseForm(id);
  renderCourseCredits();
});
