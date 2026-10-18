// The Mock Schedule
//
// Planning next year's classes against the 24-hour metric (owners).

// ---- admin: the Mock Schedule (owners, migration 0078) ----------------------------
//
// A year's training planned on a calendar, to see how near it gets the company
// to AGCO's dealer metric: the share of technicians with 24 or more hours. Every
// class is made up — its name, level, days and hours are typed in — and so is
// who's in it. The technicians are Training Status's, and hours they've already
// earned that year count too. Nothing here reaches the app or anyone's record.
//
// A year's plan is one document, saved whole a moment after each change. A class
// runs on weekdays: a three-day class dropped on a Thursday runs Thu, Fri, Mon.
// Its hours count for the year it finishes in.

let mockRows = [], mockError = null;
let mockYear = new Date().getFullYear() + 1;
let mockMonth = 0;
let mockOpenId = null, mockFocus = null;
let mockUndo = [], mockRedo = [], mockLastGroup = null, mockLastGroupAt = 0;
let mockVersion = 0, mockSavedVersion = 0, mockSaving = false, mockSaveTimer = null;
let mockSavedAt = null, mockSaveError = null, mockConflict = false;
let mockTechView = { filter: "all", shop: "", search: "" };
let mockAddView = { search: "", shop: "", shortOnly: true };
let mockDrag = null, mockMarked = "";

// The level colours, as the AGCO map and Skills use them.
const MOCK_COLOR = { 0: "#6B5B95", 1: "#6E6763", 2: "#6E6763", 3: "#2F5D7C", 4: "#CC0033", 5: "#B8760D", 6: "#137026" };
const mockLevelName = (n) => Number(n) ? `Level ${n}` : "No level";
const mockColor = (c) => MOCK_COLOR[Number(c.level) || 0] || MOCK_COLOR[0];

async function loadMockSchedules() {
  const { data, error } = await db.from("mock_schedules").select("*");
  mockError = error ? error.message : null;
  mockRows = data || [];
}

// The year's plan, or a fresh one that isn't saved until something changes.
function mockRow() {
  let row = mockRows.find(r => Number(r.year) === mockYear);
  if (!row) {
    row = { year: mockYear, goal_percent: 65, required_hours: 24, plan: { courses: [] }, updated_at: null };
    mockRows.push(row);
  }
  if (!row.plan || !Array.isArray(row.plan.courses)) row.plan = { courses: [] };
  return row;
}
const mockCourses = () => mockRow().plan.courses;
const mockCourse = (id) => mockCourses().find(c => c.id === id);

// ---- days -------------------------------------------------------------------------

const msDate = (ymd) => new Date(ymd + "T12:00:00Z");
const msYmd = (d) => d.toISOString().slice(0, 10);
const msAdd = (ymd, n) => { const d = msDate(ymd); d.setUTCDate(d.getUTCDate() + n); return msYmd(d); };
const msDow = (ymd) => (msDate(ymd).getUTCDay() + 6) % 7;          // Monday 0 … Sunday 6
const msWeekday = (ymd) => msDow(ymd) < 5;
const msNextWeekday = (ymd) => { while (!msWeekday(ymd)) ymd = msAdd(ymd, 1); return ymd; };
const msBackWeekdays = (ymd, n) => { while (n > 0) { ymd = msAdd(ymd, -1); if (msWeekday(ymd)) n--; } return ymd; };
const msFmt = (ymd, opts) => msDate(ymd).toLocaleDateString("en-US", { timeZone: "UTC", ...opts });
const msNum = (n) => String(Math.round((Number(n) || 0) * 10) / 10);
const msMonthEnd = (m) => msAdd(m === 11 ? `${mockYear + 1}-01-01` : `${mockYear}-${pad2(m + 2)}-01`, -1);

// The weekdays a class runs, from its first.
function mockDays(c) {
  if (!c.start) return [];
  const n = Math.max(1, Math.min(20, Math.round(Number(c.days) || 1)));
  const out = [];
  for (let d = msNextWeekday(c.start); out.length < n; d = msAdd(d, 1)) if (msWeekday(d)) out.push(d);
  return out;
}
const mockLast = (c) => { const d = mockDays(c); return d[d.length - 1] || null; };
const mockInYear = (c) => !!c.start && (mockLast(c) || "").startsWith(String(mockYear));
function mockWhen(c) {
  const days = mockDays(c);
  if (!days.length) return "Not on the calendar";
  const f = (d) => msFmt(d, { weekday: "short", month: "short", day: "numeric" });
  return days.length === 1 ? f(days[0]) : `${f(days[0])} – ${f(days[days.length - 1])} · ${days.length} days`;
}

// ---- technicians and the metric ---------------------------------------------------

const mockTechs = () => tsPeople.filter(p => p.is_technician).sort((a, b) =>
  (a.store || "").localeCompare(b.store || "") || (a.last_name || "").localeCompare(b.last_name || "")
  || (a.first_name || "").localeCompare(b.first_name || ""));
const mockName = (p) => `${p.first_name || ""} ${p.last_name || ""}`.trim() || p.email || "Someone";

// Hours already on their record for the plan's year, from Training Status, where
// each block carries the day it was earned. Up to a day, for the month strip.
const mockEarned = (p, upTo) => (p.agco_entries || [])
  .filter(e => String(e.earned || "").startsWith(String(mockYear)) && (!upTo || String(e.earned) <= upTo))
  .reduce((t, e) => t + (Number(e.hours) || 0), 0);

function mockStats(upTo) {
  const row = mockRow(), techs = mockTechs();
  const need = Number(row.required_hours) || 24, goal = (Number(row.goal_percent) || 65) / 100;
  const planned = new Map();
  mockCourses().forEach(c => {
    if (!mockInYear(c) || (upTo && mockLast(c) > upTo)) return;
    (c.people || []).forEach(k => planned.set(k, (planned.get(k) || 0) + (Number(c.hours) || 0)));
  });
  const people = techs.map(p => {
    const earned = mockEarned(p, upTo), plan = planned.get(p.person_key) || 0;
    return { p, earned, plan, total: earned + plan, met: earned + plan >= need - 1e-9 };
  });
  const met = people.filter(x => x.met).length;
  const goalCount = Math.ceil(techs.length * goal - 1e-9);
  return { people, met, total: techs.length, pct: techs.length ? met / techs.length : 0, goal, goalCount,
    short: Math.max(0, goalCount - met), need, earned: people.reduce((t, x) => t + x.earned, 0), ...mockAverage(people) };
}

// Hours per technician, on average: earned, planned and the two together.
function mockAverage(people) {
  const n = people.length || 1, sum = (f) => people.reduce((t, x) => t + x[f], 0) / n;
  return { avg: sum("total"), avgEarned: sum("earned"), avgPlan: sum("plan") };
}

// What's worth knowing about one person in one class.
function mockWarnings(c, key) {
  const out = [], days = new Set(mockDays(c));
  const clash = mockCourses().filter(o => o.id !== c.id && (o.people || []).includes(key)
    && mockDays(o).some(d => days.has(d)));
  if (clash.length) out.push(`Also in ${clash.map(o => o.title || "another class").join(", ")} those days`);
  // Since 2026, a Level 5 course comes before any Level 6 (the requirements article).
  if (Number(c.level) === 6) {
    const map = (agcoPeople || []).find(r => r.person_key === key);
    const l5 = map && (map.levels || []).find(l => l.level === 5);
    const first = mockDays(c)[0];
    const planned = mockCourses().some(o => Number(o.level) === 5 && (o.people || []).includes(key)
      && o.start && first && mockLast(o) < first);
    if (map && !(l5 && l5.state === "done") && !planned) out.push("Needs Level 5 before Level 6");
  }
  return out;
}

// ---- changing the plan: every change can be undone, and saves itself ----------------

function mockSnapshot() {
  const r = mockRow();
  return JSON.stringify({ goal_percent: r.goal_percent, required_hours: r.required_hours, plan: r.plan });
}

// Typing in one box is one change, not a change per letter.
function mockChange(fn, { group = null, keepEditor = false } = {}) {
  const now = Date.now();
  if (!group || group !== mockLastGroup || now - mockLastGroupAt > 4000) {
    mockUndo.push(mockSnapshot());
    if (mockUndo.length > 100) mockUndo.shift();
  }
  mockLastGroup = group; mockLastGroupAt = now;
  mockRedo = [];
  fn(mockRow());
  mockVersion++;
  mockQueueSave();
  renderMockSchedule({ keepEditor });
}

function mockUndoStep(back) {
  const from = back ? mockUndo : mockRedo, to = back ? mockRedo : mockUndo;
  if (!from.length) return;
  to.push(mockSnapshot());
  Object.assign(mockRow(), JSON.parse(from.pop()));
  mockLastGroup = null;
  mockVersion++;
  mockQueueSave();
  if (mockOpenId && !mockCourse(mockOpenId)) mockOpenId = null;
  renderMockSchedule();
}

function mockQueueSave() {
  clearTimeout(mockSaveTimer);
  mockSaveTimer = setTimeout(mockSave, 700);
  renderMockStatus();
}

// The whole year, in one write. Saved over only the copy this page loaded:
// if another owner saved in between, the page says so rather than losing it.
async function mockSave(overwrite = false) {
  clearTimeout(mockSaveTimer);
  if (mockSaving) { mockSaveTimer = setTimeout(mockSave, 400); return; }
  if (mockVersion === mockSavedVersion && !overwrite) return;
  const row = mockRow(), version = mockVersion;
  const body = { year: row.year, goal_percent: Number(row.goal_percent) || 65,
    required_hours: Number(row.required_hours) || 24, plan: row.plan };
  mockSaving = true; mockSaveError = null;
  renderMockStatus();
  const table = db.from("mock_schedules");
  const { data, error } = overwrite ? await table.upsert(body, { onConflict: "year" }).select("updated_at")
    : row.updated_at ? await table.update(body).eq("year", row.year).eq("updated_at", row.updated_at).select("updated_at")
    : await table.insert(body).select("updated_at");
  mockSaving = false;
  if (error && error.code !== "23505") {
    mockSaveError = /row-level/i.test(error.message) ? "Only owners can change the mock schedule." : error.message;
  } else if (error || !(data || []).length) {
    mockConflict = true;
  } else {
    row.updated_at = data[0].updated_at;
    mockSavedVersion = version; mockSavedAt = new Date(); mockConflict = false;
    if (mockVersion !== version) mockQueueSave();
  }
  renderMockStatus();
}

const mockUnsaved = () => mockVersion !== mockSavedVersion;

window.addEventListener("beforeunload", (event) => {
  if (mockUnsaved()) { event.preventDefault(); event.returnValue = ""; }
});

function mockNewId() { return "c" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

let mockFlashTimer = null;
function mockFlash(text) {
  const el = $("msFlash");
  if (!el) return;
  el.textContent = text;
  el.classList.toggle("hidden", !text);
  clearTimeout(mockFlashTimer);
  mockFlashTimer = setTimeout(() => el.classList.add("hidden"), 4000);
}

// ---- drawing it ---------------------------------------------------------------------

function renderMockSchedule({ keepEditor = false } = {}) {
  const host = $("mockSchedule");
  if (!host) return;
  if (!isOwner()) { host.innerHTML = `<div class="card"><p class="note">Owners only.</p></div>`; return; }
  if (mockError) {
    host.innerHTML = `<div class="card"><p class="error">The mock schedule couldn't be loaded (${esc(mockError)}).
      If that says the table doesn't exist, run migration 0078_mock_schedule.sql in the SQL editor, then reload this
      page.</p></div>`;
    return;
  }
  if (!host.querySelector(".ms-shell")) {
    host.innerHTML = `<div class="ms-shell">
      <div class="card ms-head" id="msHead"></div>
      <div class="ms-board">
        <div class="card ms-cal" id="msCal"></div>
        <div class="card ms-tray" id="msTray" data-ms-drop="tray"></div>
      </div>
      <div id="msEditor"></div>
      <div class="card ms-techs" id="msTechs"></div>
    </div>`;
  }
  renderMockHead();
  renderMockCalendar();
  renderMockTray();
  if (keepEditor) mockEditorRefresh(); else renderMockEditor();
  renderMockTechs();
}

function renderMockHead() {
  const row = mockRow(), s = mockStats();
  const now = new Date().getFullYear();
  const years = [...new Set([now, now + 1, now + 2, now + 3, mockYear, ...mockRows.map(r => Number(r.year))])].sort();
  const focus = mockFocus && tsPeople.find(p => p.person_key === mockFocus);
  const shops = [...new Set(s.people.map(x => x.p.store || "No store"))];
  $("msHead").innerHTML = `
    <div class="ms-top">
      <h2>Mock Schedule <select id="msYear" aria-label="Year">${years.map(y =>
        `<option value="${y}"${y === mockYear ? " selected" : ""}>${y}</option>`).join("")}</select></h2>
      <span class="ms-status" id="msStatus"></span>
      <span class="ms-tools">
        <button type="button" class="ghost" data-ms-act="undo" ${mockUndo.length ? "" : "disabled"} title="Undo (Ctrl+Z)">&#8630; Undo</button>
        <button type="button" class="ghost" data-ms-act="redo" ${mockRedo.length ? "" : "disabled"} title="Redo (Ctrl+Shift+Z)">Redo &#8631;</button>
        <button type="button" class="ghost" data-ms-act="startover" ${mockCourses().length ? "" : "disabled"}>Start over</button>
        <button type="button" class="ghost" data-ms-act="pdf" ${s.total ? "" : "disabled"} title="Every technician and class, as a PDF">${icon("doc", 15)}PDF</button>
      </span>
    </div>
    <p class="note">Only owners see this, and nothing here reaches the app, the Event Center or anyone's training
      record. The technicians come from Training Status${s.earned
        ? `, with the ${msNum(s.earned)} hours they've already earned in ${mockYear} counted in`
        : `; hours they earn in ${mockYear} count in here once a ${mockYear} credits report is uploaded`}.</p>
    <div class="ms-score">
      <div class="ms-pct ${s.pct >= s.goal ? "ok" : "short"}">${Math.round(s.pct * 100)}%</div>
      <div class="ms-score-text">
        <b>${s.met} of ${s.total} technicians</b> reach ${msNum(s.need)} hours in ${mockYear} with this plan.
        ${!s.total ? "" : s.short
          ? `<span class="short">${s.short} more needed for ${msNum(s.goal * 100)}% (${s.goalCount} technicians).</span>`
          : `<span class="ok">That meets the ${msNum(s.goal * 100)}% goal.</span>`}
        <div class="ms-meter" role="img" aria-label="${Math.round(s.pct * 100)}% of technicians, goal ${msNum(s.goal * 100)}%">
          <i class="${s.pct >= s.goal ? "ok" : ""}" style="width:${Math.min(100, s.pct * 100)}%"></i>
          <b style="left:${Math.min(100, s.goal * 100)}%"></b></div>
      </div>
      <div class="ms-avg" title="Every technician's earned and planned hours for ${mockYear}, added up and divided by ${s.total}">
        <b>${msNum(s.avg)}<small>hrs</small></b>
        <span>average per technician</span>
        <em>${msNum(s.avgEarned)} earned + ${msNum(s.avgPlan)} planned</em>
      </div>
      <div class="ms-goal">
        <label for="msGoal">Goal</label>
        <input id="msGoal" type="number" min="1" max="100" step="1" value="${msNum(row.goal_percent)}"> % of technicians with
        <input id="msHours" type="number" min="1" max="200" step="0.5" value="${msNum(row.required_hours)}" aria-label="Hours needed"> hours
      </div>
    </div>
    ${shops.length > 1 ? `<div class="ms-shops">${shops.map(shop => {
      const here = s.people.filter(x => (x.p.store || "No store") === shop);
      const met = here.filter(x => x.met).length;
      return `<span class="ms-shop${met / here.length >= s.goal ? " ok" : ""}"><b>${esc(shop)}</b>
        ${met}/${here.length} · ${Math.round(met / here.length * 100)}% · <span class="ms-shop-avg">${msNum(mockAverage(here).avg)} hrs avg</span></span>`;
    }).join("")}</div>` : ""}
    ${focus ? `<p class="ms-focusing">Showing ${esc(mockName(focus))}'s classes on the calendar.
      <button type="button" class="linkish" data-ms-act="clear-focus">Show everyone's</button></p>` : ""}
    <p class="ms-flash hidden" id="msFlash" role="status"></p>`;
  renderMockStatus();
}

function renderMockStatus() {
  const el = $("msStatus");
  if (!el) return;
  const row = mockRow();
  if (mockConflict) {
    el.innerHTML = `<span class="error">Another owner saved the ${mockYear} plan since this page loaded it.</span>
      <button type="button" class="pdf" data-ms-act="load-theirs">Load theirs</button>
      <button type="button" class="pdf" data-ms-act="keep-mine">Keep mine</button>`;
  } else if (mockSaveError) {
    el.innerHTML = `<span class="error">Not saved: ${esc(mockSaveError)}</span>
      <button type="button" class="pdf" data-ms-act="retry">Try again</button>`;
  } else if (mockSaving || mockUnsaved()) {
    el.textContent = "Saving…";
  } else {
    el.textContent = mockSavedAt ? `Saved ${mockSavedAt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`
      : row.updated_at ? `Saved ${new Date(row.updated_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`
      : "Nothing planned yet";
  }
  const undo = document.querySelector('[data-ms-act="undo"]'), redo = document.querySelector('[data-ms-act="redo"]');
  if (undo) undo.disabled = !mockUndo.length;
  if (redo) redo.disabled = !mockRedo.length;
}

function renderMockCalendar() {
  const box = $("msCal");
  const courses = mockCourses().filter(c => c.start);
  const today = msYmd(new Date());

  const months = Array.from({ length: 12 }, (_, m) => {
    const key = `${mockYear}-${pad2(m + 1)}`;
    const n = courses.filter(c => mockDays(c)[0].startsWith(key)).length;
    const pct = mockStats(msMonthEnd(m)).pct;
    return `<button type="button" class="ms-month${m === mockMonth ? " on" : ""}" data-ms-month="${m}"
        title="By the end of ${msFmt(`${key}-01`, { month: "long" })}: ${Math.round(pct * 100)}% of technicians">
      <b>${msFmt(`${key}-01`, { month: "short" })}</b><span>${n ? `${n} ${n === 1 ? "class" : "classes"}` : "–"}</span>
      <i style="--p:${Math.min(100, pct * 100)}%"></i><small>${Math.round(pct * 100)}%</small></button>`;
  }).join("");

  const first = `${mockYear}-${pad2(mockMonth + 1)}-01`, last = msMonthEnd(mockMonth);
  const weeks = [];
  for (let wk = msAdd(first, -msDow(first)); wk <= last; wk = msAdd(wk, 7)) weeks.push(wk);

  const weekHtml = (wk) => {
    const days = Array.from({ length: 7 }, (_, i) => msAdd(wk, i));
    const segs = [];
    courses.forEach(c => {
      const cols = mockDays(c).map(d => days.indexOf(d)).filter(i => i >= 0);
      if (cols.length) segs.push({ c, c0: Math.min(...cols), c1: Math.max(...cols), first: mockDays(c)[0] === days[Math.min(...cols)] });
    });
    segs.sort((a, b) => a.c0 - b.c0 || (b.c1 - b.c0) - (a.c1 - a.c0));
    const lanes = [];
    segs.forEach(s => {
      let lane = lanes.findIndex(end => end < s.c0);
      if (lane < 0) { lane = lanes.length; lanes.push(-1); }
      lanes[lane] = s.c1; s.lane = lane;
    });
    return `<div class="ms-week" style="--lanes:${Math.max(1, lanes.length)}">
      <div class="ms-days">${days.map(d => `<div class="ms-day${d.slice(0, 7) !== first.slice(0, 7) ? " out" : ""}${
        msWeekday(d) ? "" : " wkend"}${d === today ? " today" : ""}" data-day="${d}"><span>${Number(d.slice(8))}</span></div>`).join("")}</div>
      <div class="ms-bars">${segs.map(s => {
        const people = (s.c.people || []).length, dim = mockFocus && !(s.c.people || []).includes(mockFocus);
        return `<button type="button" class="ms-bar${s.c.id === mockOpenId ? " open" : ""}${dim ? " dim" : ""}${s.first ? "" : " cont"}"
            draggable="true" data-ms-course="${esc(s.c.id)}"
            style="grid-column:${s.c0 + 1}/${s.c1 + 2};grid-row:${s.lane + 1};--c:${mockColor(s.c)}"
            title="${esc(`${s.c.title || "Untitled class"} · ${mockLevelName(s.c.level)} · ${msNum(s.c.hours)} hours · ${people} technicians · ${mockWhen(s.c)}`)}">
          <b>${esc(s.c.title || "Untitled class")}</b><span>${msNum(s.c.hours)}h · ${people}</span></button>`;
      }).join("")}</div>
    </div>`;
  };

  box.innerHTML = `
    <div class="ms-months" aria-label="Months">${months}</div>
    <div class="ms-cal-head">
      <button type="button" class="ghost" data-ms-step="-1" ${mockMonth ? "" : "disabled"} aria-label="Previous month">&lsaquo;</button>
      <h3>${msFmt(first, { month: "long", year: "numeric" })}</h3>
      <button type="button" class="ghost" data-ms-step="1" ${mockMonth < 11 ? "" : "disabled"} aria-label="Next month">&rsaquo;</button>
      <span class="note">Drag a class to move it, or onto a month above. Double-click a day to add a class there.</span>
    </div>
    <div class="ms-dow">${["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map(d => `<span>${d}</span>`).join("")}</div>
    <div class="ms-grid">${weeks.map(weekHtml).join("")}</div>`;
}

function renderMockTray() {
  const box = $("msTray");
  const waiting = mockCourses().filter(c => !c.start);
  const placed = mockCourses().filter(c => c.start).sort((a, b) => a.start.localeCompare(b.start));
  const chip = (c) => `<button type="button" class="ms-chip${c.id === mockOpenId ? " open" : ""}" draggable="true"
      data-ms-course="${esc(c.id)}" style="--c:${mockColor(c)}">
    <b>${esc(c.title || "Untitled class")}</b><span>${esc(mockLevelName(c.level))} · ${Number(c.days) || 1}d · ${msNum(c.hours)}h · ${(c.people || []).length} techs</span></button>`;
  box.innerHTML = `
    <div class="ms-tray-head"><h3>Not on the calendar</h3>
      <button type="button" data-ms-act="new">${icon("plus", 15)}New class</button></div>
    ${waiting.length ? `<div class="ms-chips">${waiting.map(chip).join("")}</div>`
      : `<p class="note">New classes wait here until they're dragged onto a day.</p>`}
    <p class="note ms-drop-hint">Drag a class here to take it off the calendar. It stays in the plan, but its hours
      don't count.</p>
    <h3>On the calendar <span class="ms-n">${placed.length}</span></h3>
    ${placed.length ? `<ul class="ms-placed">${placed.map(c => `<li><button type="button" class="linkish" data-ms-open="${esc(c.id)}"
        style="--c:${mockColor(c)}"><i></i><span>${esc(msFmt(mockDays(c)[0], { month: "short", day: "numeric" }))}</span>
        ${esc(c.title || "Untitled class")}</button></li>`).join("")}</ul>`
      : `<p class="note">Nothing yet.</p>`}
    <div class="ms-legend">${[3, 4, 5, 6, 0].map(n => `<span style="--c:${MOCK_COLOR[n]}"><i></i>${mockLevelName(n)}</span>`).join("")}</div>`;
}

function renderMockEditor() {
  const box = $("msEditor");
  const c = mockOpenId && mockCourse(mockOpenId);
  if (!c) { box.innerHTML = ""; return; }
  const shops = [...new Set(mockTechs().map(p => p.store).filter(Boolean))];
  box.innerHTML = `<div class="card ms-editor" id="msEditorCard" style="--c:${mockColor(c)}">
    <div class="ms-ed-top">
      <h2><i class="ms-sw"></i><span id="msEdTitle">${esc(c.title || "New class")}</span></h2>
      <div class="row">
        <button type="button" class="ghost" data-ms-act="duplicate" title="Another session of this class, not on the calendar yet">Copy</button>
        <button type="button" class="ghost" data-ms-act="delete">Delete</button>
        <button type="button" data-ms-act="close">Done</button>
      </div>
    </div>
    <div class="ms-ed-grid">
      <div>
        <div class="fields">
          <div class="wide"><label for="msTitle">Class</label>
            <input id="msTitle" data-ms-field="title" type="text" maxlength="120" autocomplete="off"
              value="${esc(c.title || "")}" placeholder="Whatever you'd call it"></div>
          <div><label for="msLevel">Level</label>
            <select id="msLevel" data-ms-field="level">${[0, 1, 2, 3, 4, 5, 6].map(n =>
              `<option value="${n}"${(Number(c.level) || 0) === n ? " selected" : ""}>${mockLevelName(n)}</option>`).join("")}</select></div>
          <div><label for="msHoursIn">Hours</label>
            <input id="msHoursIn" data-ms-field="hours" type="number" min="0" max="200" step="0.5" value="${c.hours ?? ""}"></div>
          <div><label for="msDaysIn">Days</label>
            <input id="msDaysIn" data-ms-field="days" type="number" min="1" max="20" step="1" value="${Number(c.days) || 1}"></div>
          <div><label for="msStart">Starts</label>
            <input id="msStart" data-ms-field="start" type="date" min="${mockYear}-01-01" max="${mockYear}-12-31" value="${c.start || ""}"></div>
          <div><label for="msPlace">Where (optional)</label>
            <input id="msPlace" data-ms-field="place" type="text" maxlength="80" list="msPlaces" autocomplete="off" value="${esc(c.place || "")}"></div>
          <div><label for="msSeats">Seats (optional)</label>
            <input id="msSeats" data-ms-field="seats" type="number" min="1" max="500" step="1" value="${c.seats ?? ""}"></div>
        </div>
        <datalist id="msPlaces">${allLocations.map(l => `<option value="${esc(l.name)}">`).join("")}
          <option value="AGCO facility"><option value="Online"></datalist>
        <p class="ms-when" id="msWhen"></p>
      </div>
      <div class="ms-roster">
        <h3>Technicians <span class="ms-n" id="msSeatCount"></span></h3>
        <div id="msRosterNotes"></div>
        <ul class="ms-people" id="msInClass"></ul>
        <div class="ms-add">
          <label for="msAddSearch">Add technicians</label>
          <div class="ms-add-bar">
            <input id="msAddSearch" type="search" class="search" placeholder="Search by name" autocomplete="off" value="${esc(mockAddView.search)}">
            <select id="msAddShop" aria-label="Location"><option value="">Every location</option>${shops.map(s =>
              `<option${s === mockAddView.shop ? " selected" : ""}>${esc(s)}</option>`).join("")}</select>
            <label class="check"><input type="checkbox" id="msAddShort"${mockAddView.shortOnly ? " checked" : ""}>
              Only those short of the hours</label>
          </div>
          <ul class="ms-people ms-cands" id="msCands"></ul>
        </div>
      </div>
    </div>
  </div>`;
  mockEditorRefresh();
}

// The parts of the open class that change as it's edited, without redrawing the
// boxes being typed in.
function mockEditorRefresh() {
  const c = mockOpenId && mockCourse(mockOpenId);
  if (!c || !$("msEditorCard")) return renderMockEditor();
  $("msEditorCard").style.setProperty("--c", mockColor(c));
  $("msEdTitle").textContent = c.title || "New class";
  $("msWhen").textContent = mockWhen(c) + (c.start && !mockInYear(c)
    ? ` — it finishes in ${mockLast(c).slice(0, 4)}, so its hours count for that year` : "");
  renderMockRoster();
}

function renderMockRoster() {
  const c = mockOpenId && mockCourse(mockOpenId);
  if (!c || !$("msInClass")) return;
  const s = mockStats(), by = new Map(s.people.map(x => [x.p.person_key, x]));
  const inClass = (c.people || []).slice().sort((a, b) => {
    const pa = by.get(a), pb = by.get(b);
    return (pa ? mockName(pa.p) : a).localeCompare(pb ? mockName(pb.p) : b);
  });
  const seats = Number(c.seats) || 0, hours = Number(c.hours) || 0;
  $("msSeatCount").textContent = seats ? `${inClass.length} of ${seats} seats` : `${inClass.length}`;
  $("msRosterNotes").innerHTML = (seats && inClass.length > seats
      ? `<p class="ms-warn">${inClass.length - seats} more than the seats.</p>` : "")
    + (!c.start ? `<p class="note">Not on the calendar, so its hours don't count yet.</p>` : "")
    + (!hours ? `<p class="note">No hours entered, so it doesn't move anyone toward ${msNum(s.need)}.</p>` : "");
  $("msInClass").innerHTML = inClass.length ? inClass.map(k => {
    const x = by.get(k), warn = mockWarnings(c, k);
    return `<li><span class="ms-who"><b>${x ? esc(mockName(x.p)) : esc(k)}</b>
        <small>${x ? esc(x.p.store || "") : "No longer a technician on Training Status"}</small>
        ${warn.map(w => `<em class="ms-warn">${esc(w)}</em>`).join("")}</span>
      ${x ? `<span class="ms-hrs ${x.met ? "ok" : "short"}" title="Earned and planned for ${mockYear}">${msNum(x.total)} h</span>` : ""}
      <button type="button" class="pdf" data-ms-remove="${esc(k)}">Remove</button></li>`;
  }).join("") : `<li class="ms-none">Nobody yet. Add technicians below.</li>`;

  const words = mockAddView.search.toLowerCase().split(/\s+/).filter(Boolean);
  const taken = new Set(c.people || []);
  const cands = s.people.filter(x => !taken.has(x.p.person_key)
    && (!mockAddView.shop || x.p.store === mockAddView.shop)
    && (!mockAddView.shortOnly || !x.met)
    && words.every(w => mockName(x.p).toLowerCase().includes(w)));
  $("msCands").innerHTML = cands.length ? cands.slice(0, 80).map(x => `<li>
      <span class="ms-who"><b>${esc(mockName(x.p))}</b><small>${esc(x.p.store || "")}</small></span>
      <span class="ms-hrs ${x.met ? "ok" : "short"}">${msNum(x.total)}${hours ? ` → ${msNum(x.total + hours)}` : ""} h</span>
      <button type="button" data-ms-add="${esc(x.p.person_key)}">Add</button></li>`).join("")
      + (cands.length > 1 ? `<li class="ms-none"><button type="button" class="ghost" data-ms-act="add-all">Add all ${cands.length}</button></li>` : "")
    : `<li class="ms-none">${s.total ? "Nobody else matches." : "No technicians on Training Status yet."}</li>`;
}

function renderMockTechs() {
  const box = $("msTechs");
  const s = mockStats();
  if (!s.total) {
    box.innerHTML = `<h2>Technicians</h2><p class="note">No technicians yet. They come from Training Status: upload the
      All employees report on the Training Status tab.</p>`;
    return;
  }
  if (!$("msTechRows")) {
    const shops = [...new Set(s.people.map(x => x.p.store).filter(Boolean))];
    box.innerHTML = `<h2>Technicians</h2>
      <div class="ms-tech-bar">
        <div class="chips" id="msTechPills"></div>
        <select id="msTechShop" aria-label="Location"><option value="">Every location</option>${shops.map(x =>
          `<option${x === mockTechView.shop ? " selected" : ""}>${esc(x)}</option>`).join("")}</select>
        <input id="msTechSearch" type="search" class="search" placeholder="Search by name" autocomplete="off" value="${esc(mockTechView.search)}">
      </div>
      <p class="note">Earned is what Training Status has for ${mockYear} so far; planned is the classes here that finish in
        ${mockYear}. Click a name to see their classes on the calendar, or add them to one from their row.</p>
      <div class="ms-table-wrap"><table class="ms-table"><thead><tr><th>Technician</th><th>Location</th>
        <th class="num">Earned</th><th class="num">Planned</th><th class="num">Total</th><th>Classes</th></tr></thead>
        <tbody id="msTechRows"></tbody><tfoot id="msTechAvg"></tfoot></table></div>`;
  }
  const short = s.people.filter(x => !x.met).length;
  $("msTechPills").innerHTML = [["all", "All", s.total], ["short", `Short of ${msNum(s.need)}`, short], ["met", `Reach ${msNum(s.need)}`, s.total - short]]
    .map(([id, label, n]) => `<button type="button" class="chip${mockTechView.filter === id ? " on" : ""}" data-ms-techs="${id}">${label} · ${n}</button>`).join("");
  renderMockTechRows(s);
}

function renderMockTechRows(s = mockStats()) {
  const body = $("msTechRows");
  if (!body) return;
  const words = mockTechView.search.toLowerCase().split(/\s+/).filter(Boolean);
  const rows = s.people.filter(x => (mockTechView.filter === "all" || (mockTechView.filter === "met") === x.met)
    && (!mockTechView.shop || x.p.store === mockTechView.shop)
    && words.every(w => mockName(x.p).toLowerCase().includes(w)));
  const all = mockCourses().slice().sort((a, b) => (a.start || "9999").localeCompare(b.start || "9999"));
  body.innerHTML = rows.map(x => {
    const key = x.p.person_key;
    const theirs = all.filter(c => (c.people || []).includes(key));
    const others = all.filter(c => !(c.people || []).includes(key));
    return `<tr class="${mockFocus === key ? "focus" : ""}">
      <td><button type="button" class="linkish" data-ms-focus="${esc(key)}">${esc(mockName(x.p))}</button></td>
      <td>${esc(x.p.store || "")}</td>
      <td class="num">${msNum(x.earned)}</td><td class="num">${msNum(x.plan)}</td>
      <td class="num ${x.met ? "ok" : "short"}">${msNum(x.total)}${x.met ? " ✓" : ` <small>${msNum(s.need - x.total)} short</small>`}</td>
      <td><div class="ms-tclasses">${theirs.map(c => {
          const warn = mockWarnings(c, key);
          return `<button type="button" class="ms-tag" data-ms-open="${esc(c.id)}" style="--c:${mockColor(c)}"
              title="${esc(warn.join(". ") || mockWhen(c))}">${c.start ? esc(msFmt(mockDays(c)[0], { month: "short", day: "numeric" })) + " · " : ""}${
              esc(c.title || "Untitled class")}${warn.length ? " ⚠" : ""}</button>`;
        }).join("")}
        ${others.length ? `<select data-ms-addto="${esc(key)}" aria-label="Add ${esc(mockName(x.p))} to a class">
          <option value="">+ Add to…</option>${others.map(c => `<option value="${esc(c.id)}">${c.start
            ? esc(msFmt(mockDays(c)[0], { month: "short", day: "numeric" })) + " · " : "Not placed · "}${esc(c.title || "Untitled class")}</option>`).join("")}
        </select>` : ""}</div></td>
    </tr>`;
  }).join("") || `<tr><td colspan="6" class="note">Nobody matches.</td></tr>`;
  const foot = $("msTechAvg");
  if (foot) {
    const a = mockAverage(rows);
    foot.innerHTML = rows.length ? `<tr class="ms-avg-row"><td colspan="2">Average of ${rows.length === s.total ? "all" : "these"} ${rows.length}</td>
      <td class="num">${msNum(a.avgEarned)}</td><td class="num">${msNum(a.avgPlan)}</td><td class="num">${msNum(a.avg)}</td><td></td></tr>` : "";
  }
}

// ---- the plan as a PDF ---------------------------------------------------------------
//
// What the Technicians list shows with All picked: every technician, their location,
// hours earned, planned and in all, and their classes in the level's colour. The
// score and each location's share go first, and the classes by date last. Landscape,
// for the width. jsPDF's fonts are Latin-1, so dashes and quotes are swapped for
// plain ones and anything else outside it is dropped.
function mockPdf() {
  const s = mockStats(), year = mockYear;
  const latin = (t) => String(t ?? "").replace(/[\u2013\u2014]/g, "-").replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"').replace(/\u2026/g, "...").replace(/[^\x00-\xFF]/g, "").trim();
  const rgb = (hex) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
  const doc = new jspdf.jsPDF({ unit: "pt", format: "letter", orientation: "landscape" });
  const W = 792, H = 612, M = 36, CW = W - M * 2, BOTTOM = H - M - 18;
  const red = [204, 0, 51], ink = [30, 30, 30], grey = [110, 110, 110], green = [23, 112, 47], short = [168, 0, 42];
  const day = (d) => msFmt(d, { month: "short", day: "numeric" });
  let y = 0;

  const smallHead = () => {
    doc.setFillColor(...red); doc.rect(0, 0, W, 6, "F");
    doc.setFont("helvetica", "bold"); doc.setFontSize(8); doc.setTextColor(...grey);
    doc.text(`AGRI-SERVICE  -  MOCK SCHEDULE ${year}`, M, 24);
    y = 40;
  };
  const newPage = (then) => { doc.addPage(); smallHead(); if (then) then(); };

  // The band and the score.
  doc.setFillColor(...red); doc.rect(0, 0, W, 58, "F");
  doc.setTextColor(255); doc.setFont("helvetica", "bold"); doc.setFontSize(18); doc.text("AGRI-SERVICE", M, 30);
  doc.setFontSize(9); doc.text(`MOCK SCHEDULE ${year}`, M, 45);
  doc.setFont("helvetica", "normal"); doc.setFontSize(9);
  doc.text(`Printed ${new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`, W - M, 28, { align: "right" });
  doc.text("Planning only - not anyone's training record", W - M, 42, { align: "right" });
  y = 84;
  const met = s.pct >= s.goal;
  doc.setFont("helvetica", "bold"); doc.setFontSize(34); doc.setTextColor(...(met ? green : short));
  doc.text(`${Math.round(s.pct * 100)}%`, M, y + 10);
  doc.setFontSize(12); doc.setTextColor(...ink);
  doc.text(`${s.met} of ${s.total} technicians reach ${msNum(s.need)} hours in ${year} with this plan.`, M + 100, y - 4);
  doc.setFont("helvetica", "normal"); doc.setFontSize(10.5); doc.setTextColor(...(met ? green : short));
  doc.text(s.short ? `${s.short} more needed for ${msNum(s.goal * 100)}% (${s.goalCount} technicians).`
    : `That meets the ${msNum(s.goal * 100)}% goal.`, M + 100, y + 11);
  // The meter, with the goal marked.
  const mx = M + 100, mw = 300, my = y + 19;
  doc.setFillColor(232, 230, 228); doc.roundedRect(mx, my, mw, 6, 3, 3, "F");
  doc.setFillColor(...(met ? green : [217, 119, 6])); doc.roundedRect(mx, my, Math.max(6, mw * Math.min(1, s.pct)), 6, 3, 3, "F");
  doc.setFillColor(...ink); doc.rect(mx + mw * Math.min(1, s.goal) - 1, my - 3, 2, 12, "F");
  // Hours per technician, on average, beside the score and clear of its words.
  doc.setFont("helvetica", "bold"); doc.setFontSize(12);
  const said = doc.getTextWidth(`${s.met} of ${s.total} technicians reach ${msNum(s.need)} hours in ${year} with this plan.`);
  const ax = Math.max(mx + mw, M + 100 + said) + 36;
  doc.setDrawColor(226, 224, 222); doc.line(ax - 20, y - 16, ax - 20, y + 26);
  doc.setFont("helvetica", "bold"); doc.setFontSize(24); doc.setTextColor(...ink);
  const avgText = `${msNum(s.avg)} hrs`;
  doc.text(avgText, ax, y + 8);
  const lx2 = ax + doc.getTextWidth(avgText) + 10;
  doc.setFontSize(10.5); doc.text("average per technician", lx2, y - 2);
  doc.setFont("helvetica", "normal"); doc.setFontSize(9.5); doc.setTextColor(...grey);
  doc.text(`${msNum(s.avgEarned)} earned + ${msNum(s.avgPlan)} planned`, lx2, y + 11);
  y += 44;
  // Each location.
  const shops = [...new Set(s.people.map(x => x.p.store || "No store"))];
  if (shops.length > 1) {
    doc.setFontSize(9); let x = M;
    shops.forEach(shop => {
      const here = s.people.filter(p => (p.p.store || "No store") === shop), m = here.filter(p => p.met).length;
      const label = latin(`${shop}  ${m}/${here.length} - ${Math.round(m / here.length * 100)}% - ${msNum(mockAverage(here).avg)} hrs avg`);
      const w = doc.getTextWidth(label) + 16;
      if (x + w > M + CW) { x = M; y += 20; }
      const ok = m / here.length >= s.goal;
      doc.setFillColor(...(ok ? [228, 243, 232] : [246, 244, 242])); doc.roundedRect(x, y - 11, w, 16, 8, 8, "F");
      doc.setTextColor(...(ok ? green : ink)); doc.setFont("helvetica", "bold"); doc.text(label, x + 8, y);
      x += w + 6;
    });
    y += 18;
  }
  doc.setFont("helvetica", "normal"); doc.setFontSize(8.5); doc.setTextColor(...grey);
  doc.text(latin(`Earned is what Training Status has for ${year} so far; planned is the classes in this plan that finish in ${year}.`), M, y + 4);
  y += 14;
  // The level colours.
  let lx = M;
  [3, 4, 5, 6, 0].forEach(n => {
    doc.setFillColor(...rgb(MOCK_COLOR[n])); doc.rect(lx, y - 6, 8, 8, "F");
    doc.setTextColor(...grey); doc.text(mockLevelName(n), lx + 11, y + 1); lx += doc.getTextWidth(mockLevelName(n)) + 26;
  });
  y += 14;

  // Every technician.
  const all = mockCourses().slice().sort((a, b) => (a.start || "9999").localeCompare(b.start || "9999"));
  const cols = [["Technician", 150], ["Location", 92], ["Earned", 50, "r"], ["Planned", 52, "r"], ["Total", 76, "r"], ["Classes", CW - 150 - 92 - 50 - 52 - 76]];
  const xs = []; cols.reduce((x, c) => (xs.push(x), x + c[1]), M);
  const tableHead = () => {
    doc.setFillColor(240, 238, 236); doc.rect(M, y, CW, 18, "F");
    doc.setFont("helvetica", "bold"); doc.setFontSize(8); doc.setTextColor(...grey);
    cols.forEach(([label, w, align], i) => doc.text(label.toUpperCase(), align ? xs[i] + w - 6 : xs[i] + 6, y + 12, align ? { align: "right" } : {}));
    y += 18;
  };
  tableHead();
  s.people.forEach((x, n) => {
    const key = x.p.person_key;
    const theirs = all.filter(c => (c.people || []).includes(key));
    doc.setFontSize(9);
    const lines = theirs.map(c => latin(`${c.start ? day(mockDays(c)[0]) + "  " : "Not placed  "}${c.title || "Untitled class"}  (${msNum(c.hours)}h)`));
    const wrapped = lines.map(l => doc.splitTextToSize(l, cols[5][1] - 22));
    // Room for the "8 short" line under a total that falls short.
    const h = Math.max(x.met ? 1 : 2, wrapped.reduce((t, w) => t + w.length, 0)) * 11.5 + 9;
    if (y + h > BOTTOM) newPage(tableHead);
    if (n % 2) { doc.setFillColor(250, 249, 248); doc.rect(M, y, CW, h, "F"); }
    doc.setDrawColor(230, 228, 226); doc.line(M, y + h, M + CW, y + h);
    const top = y + 13;
    doc.setFont("helvetica", "bold"); doc.setFontSize(9.5); doc.setTextColor(...ink);
    doc.text(doc.splitTextToSize(latin(mockName(x.p)), cols[0][1] - 10)[0], xs[0] + 6, top);
    doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(...grey);
    doc.text(doc.splitTextToSize(latin(x.p.store || ""), cols[1][1] - 10)[0] || "", xs[1] + 6, top);
    doc.setTextColor(...ink);
    doc.text(msNum(x.earned), xs[2] + cols[2][1] - 6, top, { align: "right" });
    doc.text(msNum(x.plan), xs[3] + cols[3][1] - 6, top, { align: "right" });
    doc.setFont("helvetica", "bold"); doc.setTextColor(...(x.met ? green : short));
    doc.text(x.met ? `${msNum(x.total)}  OK` : msNum(x.total), xs[4] + cols[4][1] - 6, top, { align: "right" });
    if (!x.met) { doc.setFont("helvetica", "normal"); doc.setFontSize(7.5); doc.text(`${msNum(s.need - x.total)} short`, xs[4] + cols[4][1] - 6, top + 10, { align: "right" }); }
    doc.setFont("helvetica", "normal"); doc.setFontSize(9);
    let ly = top;
    if (!theirs.length) { doc.setTextColor(...grey); doc.text("-", xs[5] + 6, ly); }
    theirs.forEach((c, i) => {
      doc.setFillColor(...rgb(mockColor(c))); doc.rect(xs[5] + 6, ly - 7, 7, 7, "F");
      doc.setTextColor(...ink);
      wrapped[i].forEach(line => { doc.text(line, xs[5] + 18, ly); ly += 11.5; });
    });
    y += h;
  });
  // The average, under the list.
  if (y + 22 > BOTTOM) newPage(tableHead);
  doc.setDrawColor(...grey); doc.line(M, y, M + CW, y);
  doc.setFillColor(246, 244, 242); doc.rect(M, y + 0.5, CW, 20, "F");
  doc.setFont("helvetica", "bold"); doc.setFontSize(9.5); doc.setTextColor(...ink);
  doc.text(`Average of all ${s.total}`, xs[0] + 6, y + 14);
  doc.text(msNum(s.avgEarned), xs[2] + cols[2][1] - 6, y + 14, { align: "right" });
  doc.text(msNum(s.avgPlan), xs[3] + cols[3][1] - 6, y + 14, { align: "right" });
  doc.text(msNum(s.avg), xs[4] + cols[4][1] - 6, y + 14, { align: "right" });
  y += 21;

  // The classes, by date.
  if (all.length) {
    if (y + 80 > BOTTOM) newPage(); else y += 22;
    doc.setFont("helvetica", "bold"); doc.setFontSize(12); doc.setTextColor(...ink); doc.text("THE CLASSES", M, y);
    doc.setFillColor(...red); doc.rect(M, y + 5, 36, 2, "F"); y += 16;
    const ccols = [["When", 170], ["Class", CW - 170 - 70 - 50 - 80 - 120 - 60], ["Level", 70], ["Hours", 50, "r"], ["Technicians", 80, "r"], ["Where", 120], ["Seats", 60, "r"]];
    const cxs = []; ccols.reduce((x, c) => (cxs.push(x), x + c[1]), M);
    const classHead = () => {
      doc.setFillColor(240, 238, 236); doc.rect(M, y, CW, 18, "F");
      doc.setFont("helvetica", "bold"); doc.setFontSize(8); doc.setTextColor(...grey);
      ccols.forEach(([label, w, align], i) => doc.text(label.toUpperCase(), align ? cxs[i] + w - 6 : cxs[i] + 6, y + 12, align ? { align: "right" } : {}));
      y += 18;
    };
    classHead();
    all.forEach((c, n) => {
      doc.setFontSize(9);
      const title = doc.splitTextToSize(latin(c.title || "Untitled class"), ccols[1][1] - 20);
      const h = title.length * 11.5 + 9;
      if (y + h > BOTTOM) newPage(classHead);
      if (n % 2) { doc.setFillColor(250, 249, 248); doc.rect(M, y, CW, h, "F"); }
      doc.setDrawColor(230, 228, 226); doc.line(M, y + h, M + CW, y + h);
      const top = y + 13;
      doc.setFont("helvetica", "normal"); doc.setTextColor(...(c.start ? ink : grey));
      doc.text(latin(c.start ? mockWhen(c) : "Not on the calendar"), cxs[0] + 6, top);
      doc.setFillColor(...rgb(mockColor(c))); doc.rect(cxs[1] + 6, top - 7, 7, 7, "F");
      doc.setFont("helvetica", "bold"); doc.setTextColor(...ink);
      title.forEach((line, i) => doc.text(line, cxs[1] + 18, top + i * 11.5));
      doc.setFont("helvetica", "normal");
      doc.text(mockLevelName(c.level), cxs[2] + 6, top);
      doc.text(msNum(c.hours), cxs[3] + ccols[3][1] - 6, top, { align: "right" });
      doc.text(String((c.people || []).length), cxs[4] + ccols[4][1] - 6, top, { align: "right" });
      doc.setTextColor(...grey); doc.text(doc.splitTextToSize(latin(c.place || "-"), ccols[5][1] - 10)[0], cxs[5] + 6, top);
      doc.text(c.seats ? String(c.seats) : "-", cxs[6] + ccols[6][1] - 6, top, { align: "right" });
      y += h;
    });
  }

  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p); doc.setDrawColor(220); doc.line(M, H - M + 2, M + CW, H - M + 2);
    doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(...grey);
    doc.text(`Agri-Service, LLC  -  Mock Schedule ${year}  -  planning only`, M, H - M + 14);
    doc.setFont("helvetica", "bold"); doc.text(`Page ${p} of ${pages}`, W - M, H - M + 14, { align: "right" });
  }
  doc.save(`Mock Schedule ${year}.pdf`);
  mockFlash("Downloaded the PDF.");
}

// ---- what people do -----------------------------------------------------------------

function mockOpen(id, { jump = false } = {}) {
  mockOpenId = id;
  const c = mockCourse(id);
  if (jump && c && c.start) mockMonth = Number(mockDays(c)[0].slice(5, 7)) - 1;
  renderMockCalendar(); renderMockTray(); renderMockEditor();
  $("msEditorCard") && $("msEditorCard").scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function mockAddClass(start = null) {
  const id = mockNewId();
  mockOpenId = id;
  mockChange(r => r.plan.courses.push({ id, title: "", level: 0, days: 1, hours: null, start, place: "", seats: null, people: [] }));
  const title = $("msTitle");
  if (title) { $("msEditorCard").scrollIntoView({ behavior: "smooth", block: "nearest" }); title.focus(); }
}

async function mockSwitchYear(year) {
  if (mockUnsaved()) await mockSave();
  mockYear = year; mockMonth = 0; mockOpenId = null; mockFocus = null;
  // Drawn afresh, since the technicians' note names the year.
  $("mockSchedule").innerHTML = "";
  mockUndo = []; mockRedo = []; mockLastGroup = null; mockSavedAt = null; mockConflict = false; mockSaveError = null;
  renderMockSchedule();
}

function msDayAt(week, x) {
  const cells = [...week.querySelectorAll(".ms-day")];
  let day = cells[0].dataset.day;
  cells.forEach(cell => { if (x >= cell.getBoundingClientRect().left) day = cell.dataset.day; });
  return day;
}

const mockDropStart = (day) => msBackWeekdays(msNextWeekday(day), mockDrag ? mockDrag.offset : 0);

// The days a class would land on, lit while it's dragged.
function msMark(start, other) {
  const key = (start || "") + "|" + (other ? other.dataset.msMonth ?? "tray" : "");
  if (key === mockMarked) return;
  mockMarked = key;
  document.querySelectorAll(".ms-day.target, .ms-day.bad, .ms-month.over, .ms-tray.over")
    .forEach(el => el.classList.remove("target", "bad", "over"));
  if (other) other.classList.add("over");
  if (start && mockDrag) {
    const c = mockCourse(mockDrag.id);
    const bad = !start.startsWith(String(mockYear));
    mockDays({ ...c, start }).forEach(d => {
      const cell = document.querySelector(`.ms-day[data-day="${d}"]`);
      if (cell) cell.classList.add(bad ? "bad" : "target");
    });
  }
}

function mockSetField(c, field, value) {
  if (field === "title" || field === "place") c[field] = value;
  else if (field === "level") c.level = Number(value) || 0;
  else if (field === "days") c.days = Math.max(1, Math.min(20, Math.round(Number(value)) || 1));
  else if (field === "hours") c.hours = value === "" ? null : Math.max(0, Math.min(200, Number(value) || 0));
  else if (field === "seats") c.seats = value === "" ? null : Math.max(1, Math.round(Number(value)) || 1);
  else if (field === "start") c.start = value || null;
}

(function wireMockSchedule() {
  const host = $("mockSchedule");
  if (!host) return;

  host.addEventListener("click", async (event) => {
    const t = event.target;
    const month = t.closest("[data-ms-month]");
    if (month) { mockMonth = Number(month.dataset.msMonth); return renderMockCalendar(); }
    const step = t.closest("[data-ms-step]");
    if (step) { mockMonth = Math.max(0, Math.min(11, mockMonth + Number(step.dataset.msStep))); return renderMockCalendar(); }
    const course = t.closest("[data-ms-course]");
    if (course) return mockOpen(course.dataset.msCourse);
    const open = t.closest("[data-ms-open]");
    if (open) return mockOpen(open.dataset.msOpen, { jump: true });
    const focus = t.closest("[data-ms-focus]");
    if (focus) {
      mockFocus = mockFocus === focus.dataset.msFocus ? null : focus.dataset.msFocus;
      renderMockHead(); renderMockCalendar(); renderMockTechRows();
      if (mockFocus) $("msCal").scrollIntoView({ behavior: "smooth", block: "nearest" });
      return;
    }
    const techs = t.closest("[data-ms-techs]");
    if (techs) { mockTechView.filter = techs.dataset.msTechs; return renderMockTechs(); }
    const c = mockOpenId && mockCourse(mockOpenId);
    const add = t.closest("[data-ms-add]");
    if (add && c) {
      const key = add.dataset.msAdd;
      return mockChange(() => { mockCourse(c.id).people = [...new Set([...(c.people || []), key])]; }, { keepEditor: true });
    }
    const remove = t.closest("[data-ms-remove]");
    if (remove && c) {
      const key = remove.dataset.msRemove;
      return mockChange(() => { mockCourse(c.id).people = (c.people || []).filter(k => k !== key); }, { keepEditor: true });
    }
    const act = t.closest("[data-ms-act]");
    if (!act) return;
    switch (act.dataset.msAct) {
      case "new": return mockAddClass();
      case "close": mockOpenId = null; renderMockCalendar(); renderMockTray(); return renderMockEditor();
      case "undo": return mockUndoStep(true);
      case "redo": return mockUndoStep(false);
      case "clear-focus": mockFocus = null; renderMockHead(); renderMockCalendar(); return renderMockTechRows();
      case "retry": return mockSave();
      case "keep-mine": return mockSave(true);
      case "load-theirs":
        await loadMockSchedules();
        mockUndo = []; mockRedo = []; mockSavedVersion = mockVersion; mockConflict = false;
        if (mockOpenId && !mockCourse(mockOpenId)) mockOpenId = null;
        return renderMockSchedule();
      case "pdf": return mockPdf();
      case "startover":
        if (!confirm(`Take every class off the ${mockYear} plan? Undo brings them back while this page is open.`)) return;
        mockOpenId = null;
        return mockChange(r => { r.plan.courses = []; });
      case "duplicate": {
        if (!c) return;
        const id = mockNewId();
        mockOpenId = id;
        mockChange(r => r.plan.courses.push({ ...JSON.parse(JSON.stringify(c)), id, start: null, people: [] }));
        return mockFlash("Copied. The copy is under Not on the calendar, with nobody in it yet.");
      }
      case "delete":
        if (!c) return;
        if ((c.people || []).length && !confirm(`Delete ${c.title || "this class"}? ${c.people.length} technicians come out of it.`)) return;
        mockOpenId = null;
        return mockChange(r => { r.plan.courses = r.plan.courses.filter(x => x.id !== c.id); });
      case "add-all": {
        if (!c) return;
        const keys = [...$("msCands").querySelectorAll("[data-ms-add]")].map(b => b.dataset.msAdd);
        return mockChange(() => { mockCourse(c.id).people = [...new Set([...(c.people || []), ...keys])]; }, { keepEditor: true });
      }
    }
  });

  host.addEventListener("dblclick", (event) => {
    const week = event.target.closest(".ms-week");
    if (!week || event.target.closest(".ms-bar")) return;
    const day = msNextWeekday(msDayAt(week, event.clientX));
    if (!day.startsWith(String(mockYear))) return mockFlash(`Classes go on the ${mockYear} calendar.`);
    mockAddClass(day);
  });

  host.addEventListener("input", (event) => {
    const t = event.target;
    if (t.id === "msAddSearch") { mockAddView.search = t.value; return renderMockRoster(); }
    if (t.id === "msTechSearch") { mockTechView.search = t.value; return renderMockTechRows(); }
    const field = t.dataset.msField;
    if (!field || ["level", "start"].includes(field) || !mockOpenId) return;
    const id = mockOpenId;
    mockChange(() => mockSetField(mockCourse(id), field, t.value), { group: `${field}:${id}`, keepEditor: true });
  });

  host.addEventListener("change", async (event) => {
    const t = event.target;
    if (t.id === "msYear") return mockSwitchYear(Number(t.value));
    if (t.id === "msGoal" || t.id === "msHours") {
      const n = Number(t.value), ok = t.id === "msGoal" ? n > 0 && n <= 100 : n > 0 && n <= 200;
      if (!ok) return renderMockHead();
      return mockChange(r => { r[t.id === "msGoal" ? "goal_percent" : "required_hours"] = n; }, { keepEditor: true });
    }
    if (t.id === "msAddShop") { mockAddView.shop = t.value; return renderMockRoster(); }
    if (t.id === "msAddShort") { mockAddView.shortOnly = t.checked; return renderMockRoster(); }
    if (t.id === "msTechShop") { mockTechView.shop = t.value; return renderMockTechRows(); }
    if (t.dataset.msAddto) {
      const key = t.dataset.msAddto, id = t.value;
      if (!id) return;
      return mockChange(() => { const c = mockCourse(id); c.people = [...new Set([...(c.people || []), key])]; }, { keepEditor: true });
    }
    const field = t.dataset.msField;
    if (!field || !mockOpenId) return;
    const id = mockOpenId;
    if (field === "start" && t.value && !t.value.startsWith(String(mockYear))) {
      t.value = mockCourse(id).start || "";
      return mockFlash(`Classes go on the ${mockYear} calendar.`);
    }
    if (field === "start" && t.value) mockMonth = Number(msNextWeekday(t.value).slice(5, 7)) - 1;
    mockChange(() => mockSetField(mockCourse(id), field, t.value),
      { group: ["level", "start"].includes(field) ? null : `${field}:${id}`, keepEditor: true });
  });

  host.addEventListener("dragstart", (event) => {
    const el = event.target.closest && event.target.closest("[data-ms-course]");
    const c = el && mockCourse(el.dataset.msCourse);
    if (!c) return;
    let offset = 0;
    const week = el.closest(".ms-week");
    if (week && c.start) offset = Math.max(0, mockDays(c).indexOf(msDayAt(week, event.clientX)));
    mockDrag = { id: c.id, offset };
    mockMarked = "";
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", c.id);
    el.classList.add("dragging");
  });

  host.addEventListener("dragover", (event) => {
    if (!mockDrag) return;
    const week = event.target.closest(".ms-week"), tray = event.target.closest(".ms-tray"),
      month = event.target.closest("[data-ms-month]");
    if (!week && !tray && !month) return msMark(null, null);
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    msMark(week ? mockDropStart(msDayAt(week, event.clientX)) : null, tray || month);
  });

  host.addEventListener("drop", (event) => {
    if (!mockDrag) return;
    const week = event.target.closest(".ms-week"), tray = event.target.closest(".ms-tray"),
      month = event.target.closest("[data-ms-month]");
    if (!week && !tray && !month) return;
    event.preventDefault();
    const id = mockDrag.id;
    let start = null;
    if (month) {
      mockMonth = Number(month.dataset.msMonth);
      start = msNextWeekday(`${mockYear}-${pad2(mockMonth + 1)}-01`);
    } else if (week) {
      start = mockDropStart(msDayAt(week, event.clientX));
    }
    mockDrag = null; msMark(null, null);
    if (start && !start.startsWith(String(mockYear))) {
      renderMockCalendar();
      return mockFlash(`Classes go on the ${mockYear} calendar.`);
    }
    const c = mockCourse(id);
    if (!c || (c.start || null) === start) return renderMockSchedule({ keepEditor: true });
    mockChange(() => { mockCourse(id).start = start; });
  });

  host.addEventListener("dragend", () => {
    mockDrag = null; msMark(null, null);
    host.querySelectorAll(".dragging").forEach(el => el.classList.remove("dragging"));
  });

  document.addEventListener("keydown", (event) => {
    if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "z") return;
    if ($("tab-mock").classList.contains("hidden") || $("admin").classList.contains("hidden")) return;
    if (event.target.closest("input, textarea, select")) return;
    event.preventDefault();
    mockUndoStep(!event.shiftKey);
  });
})();
