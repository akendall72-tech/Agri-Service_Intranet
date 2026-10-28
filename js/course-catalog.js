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

  return hero("Course Catalog", "A reference of Agri-Service technician, parts, and safety training courses.") + `
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

function renderCoursesAdmin() {
  const editor = $("courseEditor");
  if (!editor) return;
  const list = $("courseList");

  if (coursesError) {
    list.innerHTML = `<p class="error">${/does not exist|schema cache/i.test(coursesError)
      ? "Run migration 0032_course_catalog.sql in the SQL editor, then reload this page."
      : esc(coursesError)}</p>`;
    return;
  }

  // A fresh form starts at the end of the list.
  const order = editor.querySelector('[data-c="sort_order"]');
  if (!editingCourseId && !order.value) {
    order.value = allCourses.reduce((m, c) => Math.max(m, c.sort_order || 0), 0) + 10;
  }

  // Categories people have used, offered while typing.
  $("courseCategories").innerHTML = [...new Set(allCourses.map(c => c.category).filter(Boolean))]
    .map(c => `<option value="${esc(c)}">`).join("");
  renderAudienceChoices();

  const live = allCourses.filter(c => c.is_active).length;
  $("courseStats").innerHTML = `<span class="stat"><b>${allCourses.length}</b>courses</span>` +
    `<span class="stat"><b>${live}</b>showing</span>` +
    `<span class="stat"><b>${new Set(allCourses.map(c => c.category)).size}</b>categories</span>`;

  list.innerHTML = allCourses.length ? groupCourses(allCourses).map(([cat, courses]) => `
    <div class="section-title" style="margin-top:18px">${esc(cat)}</div>
    ${courses.map(c => `
      <div class="role" style="padding:12px 16px${c.is_active ? "" : ";opacity:.6"}" data-course="${esc(c.id)}">
        <div class="row" style="align-items:flex-start">
          <div style="flex:1;min-width:220px">
            <b>${esc(c.title)}</b>${c.is_active ? "" : ` <span class="badge b-none">Not showing</span>`}
            <div class="note">${esc([c.subtitle, c.level, c.credits, c.duration].filter(Boolean).join(" · "))}</div>
            <div class="note">👥 ${esc((c.audiences || []).join(", ") || "No audience set")} · order ${esc(c.sort_order)}</div>
          </div>
          <div class="row" style="gap:6px">
            <button class="pdf" data-act="edit-course">Edit</button>
            <button class="pdf" data-act="copy-course">Copy</button>
            <button class="pdf" data-act="delete-course">Delete</button>
          </div>
        </div>
        <span class="msg"></span>
      </div>`).join("")}`).join("") : `<p class="note">No courses yet. Add one above.</p>`;
}

function renderAudienceChoices(selected) {
  const box = $("courseAudienceChoices");
  const current = selected || [...box.querySelectorAll("button.on")].map(b => b.dataset.audience);
  const all = [...new Set([...DEFAULT_AUDIENCES, ...courseAudiences(allCourses), ...current])];
  box.innerHTML = all.map(a => `<button type="button" class="chip${current.includes(a) ? " on" : ""}"
    data-audience="${esc(a)}">${esc(a)}</button>`).join("");
}

function fillCourseForm(course, { copy = false } = {}) {
  const editor = $("courseEditor");
  const set = (f, v) => { editor.querySelector(`[data-c="${f}"]`).value = v ?? ""; };
  editingCourseId = course && !copy ? course.id : null;

  set("title", course ? course.title + (copy ? " (copy)" : "") : "");
  set("subtitle", course && course.subtitle);
  set("category", course && course.category);
  set("level", course && course.level);
  set("credits", course && course.credits);
  set("duration", course && course.duration);
  set("description", course && course.description);
  set("topics", course ? (course.topics || []).join("\n") : "");
  set("prerequisites", course ? (course.prerequisites || []).join("\n") : "");
  set("sort_order", course ? course.sort_order + (copy ? 1 : 0)
    : allCourses.reduce((m, c) => Math.max(m, c.sort_order || 0), 0) + 10);
  set("is_active", !course || course.is_active ? "yes" : "no");
  set("new_audience", "");
  renderAudienceChoices(course ? [...(course.audiences || [])] : []);

  $("courseEditorTitle").textContent = editingCourseId ? "Edit course" : "Add a course";
  editor.querySelector('[data-act="save-course"]').textContent = editingCourseId ? "Save changes" : "Add course";
  editor.querySelector('[data-act="cancel-course"]').classList.toggle("hidden", !course);
  speak(editor, "", false);
}

$("admin").addEventListener("click", async (event) => {
  const audienceChip = event.target.closest("#courseAudienceChoices button[data-audience]");
  if (audienceChip) { audienceChip.classList.toggle("on"); return; }

  const button = event.target.closest("button[data-act]");
  if (!button) return;
  const act = button.dataset.act;
  if (!["add-audience", "save-course", "cancel-course", "edit-course", "copy-course", "delete-course"].includes(act)) return;
  const editor = $("courseEditor");

  if (act === "add-audience") {
    const input = editor.querySelector('[data-c="new_audience"]');
    const name = input.value.trim();
    if (!name) return;
    const current = [...editor.querySelectorAll("#courseAudienceChoices button.on")].map(b => b.dataset.audience);
    renderAudienceChoices([...new Set([...current, name])]);
    input.value = "";
    return;
  }

  if (act === "cancel-course") return fillCourseForm(null);

  if (act === "edit-course" || act === "copy-course") {
    const course = allCourses.find(c => c.id === button.closest("[data-course]").dataset.course);
    fillCourseForm(course, { copy: act === "copy-course" });
    editor.scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }

  if (act === "delete-course") {
    const row = button.closest("[data-course]");
    const course = allCourses.find(c => c.id === row.dataset.course);
    if (!confirm(`Delete "${course.title}" from the catalog? This can't be undone. ` +
                 `To take it out of the catalog for now, edit it and set Showing to No.`)) return;
    const { data, error } = await db.from("courses").delete().eq("id", course.id).select();
    if (error) return speak(row, error.message, true);
    if (!data || !data.length) return speak(row, "Nothing deleted — only an owner can remove courses.", true);
    if (editingCourseId === course.id) fillCourseForm(null);
    await loadCourses();
    return renderCoursesAdmin();
  }

  // save-course
  const get = (f) => editor.querySelector(`[data-c="${f}"]`).value.trim();
  if (!get("title")) return speak(editor, "The course needs a title.", true);
  if (!get("category")) return speak(editor, "Pick or type a category.", true);

  const pending = get("new_audience");
  const audiences = [...editor.querySelectorAll("#courseAudienceChoices button.on")].map(b => b.dataset.audience);
  if (pending && !audiences.some(a => a.toLowerCase() === pending.toLowerCase())) audiences.push(pending);

  const row = {
    title: get("title"),
    subtitle: get("subtitle") || null,
    category: get("category"),
    level: get("level") || null,
    credits: get("credits") || null,
    duration: get("duration") || null,
    audiences,
    description: get("description") || null,
    topics: lines(get("topics")),
    prerequisites: lines(get("prerequisites")),
    sort_order: parseInt(get("sort_order"), 10) || 0,
    is_active: get("is_active") === "yes"
  };

  speak(editor, "Saving…", false);
  const query = editingCourseId
    ? db.from("courses").update(row).eq("id", editingCourseId).select()
    : db.from("courses").insert(row).select();
  const { data, error } = await query;
  if (error) {
    return speak(editor, /row-level/i.test(error.message) ? "Only an owner can change the catalog."
      : /does not exist|schema cache/i.test(error.message)
        ? "Run migration 0032_course_catalog.sql in the SQL editor first." : error.message, true);
  }
  if (!data || !data.length) return speak(editor, "Nothing changed — only an owner can edit courses.", true);

  const added = !editingCourseId;
  await loadCourses();
  fillCourseForm(null);
  renderCoursesAdmin();
  speak(editor, `${added ? "Added" : "Saved"}${row.is_active ? ". Phones show it next time the catalog is opened."
    : " — not showing in the catalog until Showing is Yes."}`, false);
});
