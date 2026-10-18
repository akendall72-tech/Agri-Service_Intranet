// Training reports
//
// The Training dashboard's Reports: AGCO Training Hours and the Class
// Report, with their PDFs and workbooks.

// ---- Reports, on the Training dashboard --------------------------------------------------
//
// Two reports for Training Managers, on screen and as a PDF or an Excel
// workbook, from the same Training Status uploads as the rest of the page:
//
//   AGCO Training Hours  the dealer metric for the credits report's calendar
//                        year: each technician's AGCO hours against what's
//                        needed, for the whole company and each location.
//   Class Report         the classes picked, in a calendar year or a fiscal
//                        year (April 1 to March 31): who took them, and what
//                        share of the people did, class by class and location
//                        by location.
//
// A class counts when it was completed inside the year picked. The AGCO hours
// are the credits report's own year: that report only carries the current one.

let rpAgcoStore = "all";
let rpClass = { picked: [], search: "", kind: "calendar", year: null, techs: true, store: "all", show: "all" };

const rpJob = (p) => (p.job || "").replace(/^\d+\s*-\s*/, "");
const rpPct = (n, d) => d ? Math.round(n / d * 1000) / 10 : 0;
const rpPctText = (n, d) => `${rpPct(n, d)}%`;
const rpByPlace = (a, b) => a.store.localeCompare(b.store) || a.last.localeCompare(b.last) || a.first.localeCompare(b.first);
// "Field Support" last, as the rest of the page orders locations.
const rpStoreOrder = (a, b) => (a === "Field Support") - (b === "Field Support") || a.localeCompare(b);
const rpStamp = () => `Prepared ${new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}${
  profile && profile.full_name ? ` by ${profile.full_name}` : ""}`;

function renderReports() {
  renderRpAgco();
  renderRpClass();
}

// ---- AGCO Training Hours -----------------------------------------------------------------

function rpAgcoModel() {
  const m = tsModel(), need = tsRequiredHours(), goal = tsGoal();
  const stores = [...new Set(m.techs.map(t => t.store))].sort(rpStoreOrder);
  if (rpAgcoStore !== "all" && !stores.includes(rpAgcoStore)) rpAgcoStore = "all";
  const techs = m.techs.filter(t => rpAgcoStore === "all" || t.store === rpAgcoStore).sort(rpByPlace);
  const sum = (list) => list.reduce((a, t) => a + (t.hours || 0), 0);
  const line = (store, list) => {
    const met = list.filter(t => t.met).length, hours = sum(list);
    return { store, techs: list.length, met, pct: rpPct(met, list.length), hours, avg: list.length ? hours / list.length : 0,
      goalCount: Math.ceil(list.length * goal - 1e-9) };
  };
  const byStore = stores.filter(s => rpAgcoStore === "all" || s === rpAgcoStore).map(s => line(s, m.techs.filter(t => t.store === s)));
  const all = line(rpAgcoStore === "all" ? "Whole company" : rpAgcoStore, techs);
  return { m, need, goal, goalPct: tsGoalPercent(), stores, techs, byStore, all,
    short: Math.max(0, all.goalCount - all.met), period: tsPeriod() || String(new Date().getFullYear()) };
}

const rpStatus = (t, need) => t.hours === null ? "Not on the credits report"
  : t.met ? "Met" : `${fmtHours(need - t.hours)} short`;
function fmtHours(n) { return String(Math.round((Number(n) || 0) * 10) / 10); }
const rpCredits = (t) => (t.entries || []).map(e => `${fmtHours(e.hours)} hrs${e.title ? ` ${e.title}` : ""}${
  e.earned ? ` (${newsDate(e.earned).replace(/, \d{4}$/, "")})` : ""}`);

function renderRpAgco() {
  const host = $("rpAgco");
  if (!host) return;
  if (trainingStatusError) { host.innerHTML = `<div class="card"><p class="error">${esc(trainingStatusError)}</p></div>`; return; }
  const r = rpAgcoModel();
  if (!r.m.techs.length) {
    host.innerHTML = `<div class="card"><p class="note" style="margin:0">No technicians yet. Upload the UKG reports under
      Uploads → Training Status and this fills in.</p></div>`;
    return;
  }
  const a = r.all, metGoal = a.pct >= r.goalPct;
  const box = (label, value, sub, tone) => `<div class="rp-box${tone ? ` ${tone}` : ""}"><span>${esc(label)}</span><b>${value}</b><small>${esc(sub)}</small></div>`;
  host.innerHTML = `<div class="card rp">
    <div class="rp-head">
      <div><h2>AGCO Training Hours · ${esc(r.period)}</h2>
        <p class="note">The dealer metric: technicians with ${fmtHours(r.need)}+ AGCO hours in ${esc(r.period)}, against a goal of
          ${r.goalPct}%. From the credits report${tsSources && tsSources.credits && tsSources.credits.exported
            ? ` exported ${esc(String(tsSources.credits.exported).replace(" MDT", ""))}` : ""}.</p></div>
      <div class="rp-tools">
        <select id="rpAgcoStore" aria-label="Location"><option value="all">Whole company</option>${r.stores.map(s =>
          `<option${s === rpAgcoStore ? " selected" : ""}>${esc(s)}</option>`).join("")}</select>
        <button type="button" class="pdf" data-rp="agco-pdf">${icon("doc", 15)}PDF</button>
        <button type="button" class="pdf" data-rp="agco-xlsx">${icon("doc", 15)}Excel</button>
      </div>
    </div>
    <div class="rp-boxes">
      ${box("Technicians", a.techs, rpAgcoStore === "all" ? "across the company" : `at ${rpAgcoStore}`)}
      ${box(`${fmtHours(r.need)}+ hours`, `${a.pct}%`, `${a.met} of ${a.techs}`, metGoal ? "ok" : "short")}
      ${box("Goal", `${r.goalPct}%`, metGoal ? "Met" : `${r.short} more ${r.short === 1 ? "technician" : "technicians"} needed`, metGoal ? "ok" : "")}
      ${box("Average", `${fmtHours(a.avg)} hrs`, `${fmtHours(a.hours)} hours in all`)}
    </div>
    ${rpAgcoStore === "all" ? `<h3 class="rp-sub">By location</h3>
    <div class="rp-scroll"><table class="rp-table">
      <thead><tr><th>Location</th><th class="num">Technicians</th><th class="num">${fmtHours(r.need)}+ hours</th><th class="num">Percent</th>
        <th class="num">Still needed</th><th class="num">Average hrs</th><th class="num">Total hrs</th></tr></thead>
      <tbody>${r.byStore.map(s => `<tr><td><b>${esc(s.store)}</b></td><td class="num">${s.techs}</td><td class="num">${s.met}</td>
        <td class="num ${s.pct >= r.goalPct ? "ok" : "short"}">${s.pct}%</td><td class="num">${Math.max(0, s.goalCount - s.met)}</td>
        <td class="num">${fmtHours(s.avg)}</td><td class="num">${fmtHours(s.hours)}</td></tr>`).join("")}</tbody>
      <tfoot><tr><td>Whole company</td><td class="num">${a.techs}</td><td class="num">${a.met}</td>
        <td class="num ${metGoal ? "ok" : "short"}">${a.pct}%</td><td class="num">${r.short}</td><td class="num">${fmtHours(a.avg)}</td>
        <td class="num">${fmtHours(a.hours)}</td></tr></tfoot>
    </table></div>` : ""}
    <h3 class="rp-sub">Technicians <span>${a.techs}</span></h3>
    <div class="rp-scroll"><table class="rp-table">
      <thead><tr><th>Name</th><th>Location</th><th>Job</th><th class="num">AGCO hrs</th><th>Status</th><th>Credits</th></tr></thead>
      <tbody>${r.techs.map(t => `<tr><td><b>${esc(t.name)}</b></td><td>${esc(t.store)}</td><td class="note">${esc(rpJob(t))}</td>
        <td class="num">${t.hours === null ? "—" : fmtHours(t.hours)}</td>
        <td class="${t.met ? "ok" : "short"}">${esc(rpStatus(t, r.need))}</td>
        <td class="rp-credits">${rpCredits(t).map(c => `<span>${esc(c)}</span>`).join("") || `<span class="note">—</span>`}</td></tr>`).join("")}</tbody>
    </table></div>
  </div>`;
}

function rpAgcoPdf() {
  const r = rpAgcoModel(), a = r.all, where = rpAgcoStore === "all" ? "Whole company" : rpAgcoStore;
  const pdf = rpPdf({ title: "AGCO Training Hours", period: r.period });
  pdf.note(`${where}. The dealer metric: technicians with ${fmtHours(r.need)}+ AGCO hours in ${r.period}, against a goal of ${r.goalPct}%.`);
  pdf.boxes([
    ["TECHNICIANS", String(a.techs), where],
    [`${fmtHours(r.need)}+ HOURS`, `${a.pct}%`, `${a.met} of ${a.techs}`, a.pct >= r.goalPct ? "ok" : "short"],
    ["GOAL", `${r.goalPct}%`, a.pct >= r.goalPct ? "Met" : `${r.short} more needed`],
    ["AVERAGE", `${fmtHours(a.avg)} hrs`, `${fmtHours(a.hours)} hours in all`]
  ]);
  if (rpAgcoStore === "all") {
    pdf.section("By location");
    pdf.table([["Location", 150], ["Techs", 55, "r"], [`${fmtHours(r.need)}+ hrs`, 60, "r"], ["Percent", 60, "r"],
      ["Still needed", 70, "r"], ["Avg hrs", 60, "r"], ["Total hrs", pdf.width - 455, "r"]],
      r.byStore.map(s => [s.store, String(s.techs), String(s.met), `${s.pct}%`, String(Math.max(0, s.goalCount - s.met)),
        fmtHours(s.avg), fmtHours(s.hours)])
        .concat([["Whole company", String(a.techs), String(a.met), `${a.pct}%`, String(r.short), fmtHours(a.avg), fmtHours(a.hours)]]),
      { bold: 0, total: true, color: (row, i) => i === 3 ? (parseFloat(row[3]) >= r.goalPct ? "ok" : "short") : null });
  }
  pdf.section("Technicians", `${a.techs} technicians, by location. Credits are the AGCO hours on the credits report, with the day each was earned.`);
  pdf.table([["Name", 118], ["Location", 78], ["Job", 100], ["Hours", 42, "r"], ["Status", 72], ["Credits", pdf.width - 410]],
    r.techs.map(t => [t.name, t.store, rpJob(t), t.hours === null ? "-" : fmtHours(t.hours), rpStatus(t, r.need), rpCredits(t).join("\n") || "-"]),
    { bold: 0, color: (row, i) => i === 4 ? (row[4] === "Met" ? "ok" : "short") : null });
  pdf.save(`AGCO Training Hours ${r.period}${rpAgcoStore === "all" ? "" : ` ${rpAgcoStore}`}.pdf`);
}

function rpAgcoXlsx() {
  const r = rpAgcoModel(), a = r.all, where = rpAgcoStore === "all" ? "Whole company" : rpAgcoStore;
  const head = [[`AGCO Training Hours ${r.period}`], [`Agri-Service, LLC · ${where} · ${rpStamp()}`],
    [`Technicians with ${fmtHours(r.need)}+ AGCO hours in ${r.period}; goal ${r.goalPct}%.`], []];
  const sheets = [];
  if (rpAgcoStore === "all") {
    sheets.push({ name: "By location", widths: [22, 12, 12, 10, 13, 12, 11], rows: head.concat([
      ["Location", "Technicians", `${fmtHours(r.need)}+ hours`, "Percent", "Still needed", "Average hrs", "Total hrs"],
      ...r.byStore.map(s => [s.store, s.techs, s.met, s.pct, Math.max(0, s.goalCount - s.met), Number(fmtHours(s.avg)), Number(fmtHours(s.hours))]),
      ["Whole company", a.techs, a.met, a.pct, r.short, Number(fmtHours(a.avg)), Number(fmtHours(a.hours))]]) });
  }
  sheets.push({ name: "Technicians", widths: [24, 16, 28, 10, 24, 60], rows: head.concat([
    ["Name", "Location", "Job", "AGCO hours", "Status", "Credits"],
    ...r.techs.map(t => [t.name, t.store, rpJob(t), t.hours === null ? "" : Number(fmtHours(t.hours)), rpStatus(t, r.need), rpCredits(t).join("; ")])]) });
  sheets.push({ name: "Credits", widths: [24, 16, 10, 12, 50], rows: head.concat([
    ["Name", "Location", "Hours", "Earned", "Credit"],
    ...r.techs.flatMap(t => (t.entries || []).map(e => [t.name, t.store, Number(e.hours) || 0, e.earned ? dateOnly(e.earned) : "", e.title || ""]))]) });
  rpXlsx(`AGCO Training Hours ${r.period}${rpAgcoStore === "all" ? "" : ` ${rpAgcoStore}`}.xlsx`, sheets);
}

// ---- Class Report ------------------------------------------------------------------------

// The calendar year, or the fiscal year starting April 1 of `year`.
function rpPeriod() {
  const now = new Date();
  const thisFy = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  const y = Number(rpClass.year) || (rpClass.kind === "fiscal" ? thisFy : now.getFullYear());
  return rpClass.kind === "fiscal"
    ? { year: y, start: `${y}-04-01`, end: `${y + 1}-04-01`, label: `Fiscal year ${y}–${String(y + 1).slice(2)}`,
        range: `Apr 1, ${y} – Mar 31, ${y + 1}` }
    : { year: y, start: `${y}-01-01`, end: `${y + 1}-01-01`, label: `Calendar year ${y}`, range: `Jan 1 – Dec 31, ${y}` };
}

function rpYears(m) {
  const now = new Date(), years = new Set(m.years.map(Number).filter(Boolean));
  years.add(now.getFullYear());
  if (rpClass.kind === "fiscal") {
    years.add(now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1);
    // A fiscal year starting the year before the earliest class still holds its spring.
    if (years.size) years.add(Math.min(...years) - 1);
  }
  // Every year from the earliest to now, none skipped.
  const out = [];
  for (let y = Math.max(...years); y >= Math.min(...years); y--) out.push(y);
  return out;
}

// The latest completion of a class inside the period.
function rpDone(p, course, per) {
  return p.classes.filter(c => c.course === course && c.completed >= per.start && c.completed < per.end)
    .reduce((best, c) => !best || c.completed > best.completed ? c : best, null);
}

// Their latest completion outside the period, for someone who didn't take it
// inside: shown, so a blank isn't mistaken for "never", but not counted.
function rpOutside(p, course, per) {
  const c = p.classes.filter(x => x.course === course && (x.completed < per.start || x.completed >= per.end))
    .reduce((best, x) => !best || x.completed > best.completed ? x : best, null);
  return c ? { completed: c.completed, when: c.completed < per.start ? "Earlier" : "Later" } : null;
}
const rpOutsideText = (o) => `${o.when} · ${newsDate(o.completed)}`;

function rpClassModel() {
  const m = tsModel(), per = rpPeriod(), picked = rpClass.picked;
  const stores = [...new Set((rpClass.techs ? m.techs : m.people).map(p => p.store))].sort(rpStoreOrder);
  if (rpClass.store !== "all" && !stores.includes(rpClass.store)) rpClass.store = "all";
  const pool = (rpClass.techs ? m.techs : m.people).filter(p => rpClass.store === "all" || p.store === rpClass.store);
  const rows = pool.map(p => {
    const done = picked.map(c => rpDone(p, c, per));
    const outside = picked.map((c, i) => done[i] ? null : rpOutside(p, c, per));
    return { p, done, outside, n: done.filter(Boolean).length };
  }).sort((x, y) => rpByPlace(x.p, y.p));
  const perClass = picked.map((name, i) => {
    const n = rows.filter(r => r.done[i]).length;
    return { name, n, pct: rpPct(n, pool.length), outside: rows.filter(r => r.outside[i]).length };
  });
  const allN = rows.filter(r => picked.length && r.n === picked.length).length;
  const anyN = rows.filter(r => r.n > 0).length;
  const byStore = [...new Set(rows.map(r => r.p.store))].sort(rpStoreOrder).map(store => {
    const here = rows.filter(r => r.p.store === store);
    return { store, people: here.length, all: here.filter(r => picked.length && r.n === picked.length).length,
      any: here.filter(r => r.n > 0).length, perClass: picked.map((_, i) => here.filter(r => r.done[i]).length) };
  });
  // Only the people who completed one or more of the classes in the period.
  const completers = rows.filter(r => r.n > 0);
  const shown = completers.filter(r => rpClass.show === "all" || (rpClass.show === "done") === (r.n === picked.length));
  return { m, per, picked, pool, rows, completers, perClass, allN, anyN, byStore, shown, stores,
    noun: rpClass.techs ? "technicians" : "people" };
}

// With more than one class, which completers to show.
const rpShowLabels = () => [["all", "Any of them"], ["done", "All of them"], ["missing", "Some of them"]];

function renderRpClass() {
  const host = $("rpClass");
  if (!host) return;
  if (trainingStatusError) { host.innerHTML = `<div class="card"><p class="error">${esc(trainingStatusError)}</p></div>`; return; }
  const m = tsModel(), courses = crCourses(m);
  if (!courses.length) {
    host.innerHTML = `<div class="card"><p class="note" style="margin:0">No classes on the uploaded reports yet. Upload them
      under Uploads → Training Status.</p></div>`;
    return;
  }
  rpClass.picked = rpClass.picked.filter(c => courses.some(x => x.name === c));
  if (!host.querySelector(".rp-class-layout")) {
    host.innerHTML = `<div class="rp-class-layout">
      <div class="card rp-picker">
        <h2>Classes</h2>
        <input type="text" class="search" id="rpClassSearch" placeholder="Search classes…" aria-label="Search classes" autocomplete="off">
        <p class="note rp-picker-count" id="rpClassCount"></p>
        <div id="rpClassList" class="rp-class-list"></div>
      </div>
      <div id="rpClassReport"></div>
    </div>`;
  }
  $("rpClassSearch").value = rpClass.search;
  rpDrawClassList(courses);
  rpDrawClassReport();
}

function rpDrawClassList(courses = crCourses(tsModel())) {
  const list = $("rpClassList");
  if (!list) return;
  const text = rpClass.search.trim().toLowerCase();
  const found = courses.filter(c => !text || c.name.toLowerCase().includes(text));
  $("rpClassCount").textContent = `${rpClass.picked.length} picked · ${courses.length} classes · the number is how many have ever taken it`;
  list.innerHTML = found.map(c => `<label class="rp-class${rpClass.picked.includes(c.name) ? " on" : ""}">
      <input type="checkbox" data-rp-class="${esc(c.name)}"${rpClass.picked.includes(c.name) ? " checked" : ""}>
      <span>${esc(c.name)}</span><small>${c.count}</small></label>`).join("")
    || `<p class="note" style="margin:8px 4px">No class matches that.</p>`;
}

function rpDrawClassReport() {
  const host = $("rpClassReport");
  if (!host) return;
  const r = rpClassModel(), k = r.picked.length;
  const years = rpYears(r.m);
  if (!years.includes(r.per.year)) years.unshift(r.per.year);
  const controls = `<div class="rp-controls">
      <div class="chips" style="margin:0">${[["calendar", "Calendar year"], ["fiscal", "Fiscal year"]].map(([id, label]) =>
        `<button type="button" class="chip${rpClass.kind === id ? " on" : ""}" data-rp-kind="${id}">${label}</button>`).join("")}</div>
      <select id="rpClassYear" aria-label="Year">${years.map(y => `<option value="${y}"${y === r.per.year ? " selected" : ""}>${
        rpClass.kind === "fiscal" ? `Apr ${y} – Mar ${y + 1}` : y}</option>`).join("")}</select>
      <select id="rpClassStore" aria-label="Location"><option value="all">Every location</option>${r.stores.map(s =>
        `<option${s === rpClass.store ? " selected" : ""}>${esc(s)}</option>`).join("")}</select>
      <label class="check" style="margin:0"><input type="checkbox" id="rpClassTechs"${rpClass.techs ? " checked" : ""}> Technicians only</label>
    </div>`;
  if (!k) {
    host.innerHTML = `<div class="card rp"><h2>Class Report</h2>${controls}
      <p class="note" style="margin:14px 0 0">Tick one or more classes on the left. The report shows who took them in
        ${esc(r.per.label.toLowerCase())} (${esc(r.per.range)}), and the share of ${r.noun} who did.</p></div>`;
    return;
  }
  const box = (label, value, sub) => `<div class="rp-box"><span>${esc(label)}</span><b>${value}</b><small>${esc(sub)}</small></div>`;
  const dateCell = (d, o) => d ? `<td class="ok">${esc(newsDate(d.completed))}</td>`
    : o ? `<td class="rp-outside" title="Outside ${esc(r.per.range)}, so it isn't counted">${esc(rpOutsideText(o))}</td>`
    : `<td class="note">—</td>`;
  host.innerHTML = `<div class="card rp">
    <div class="rp-head">
      <div><h2>Class Report · ${esc(r.per.label)}</h2>
        <p class="note">${esc(r.per.range)} · ${r.pool.length} ${r.noun}${rpClass.store === "all" ? " across the company" : ` at ${esc(rpClass.store)}`}.</p></div>
      <div class="rp-tools">
        <button type="button" class="pdf" data-rp="class-pdf">${icon("doc", 15)}PDF</button>
        <button type="button" class="pdf" data-rp="class-xlsx">${icon("doc", 15)}Excel</button>
      </div>
    </div>
    ${controls}
    <div class="rp-picked">${r.picked.map(c => `<span class="rp-chip">${esc(c)}<button type="button" data-rp-unpick="${esc(c)}"
      aria-label="Take ${esc(c)} off the report">&times;</button></span>`).join("")}</div>
    <div class="rp-boxes">
      ${box(r.noun[0].toUpperCase() + r.noun.slice(1), r.pool.length, rpClass.store === "all" ? "across the company" : `at ${rpClass.store}`)}
      ${k > 1 ? box("Took all", rpPctText(r.allN, r.pool.length), `${r.allN} of ${r.pool.length}`)
        : box("Took it", rpPctText(r.allN, r.pool.length), `${r.allN} of ${r.pool.length}`)}
      ${k > 1 ? box("Took at least one", rpPctText(r.anyN, r.pool.length), `${r.anyN} of ${r.pool.length}`) : ""}
      ${box("Classes", k, k === 1 ? "picked" : "picked together")}
    </div>
    <h3 class="rp-sub">By class</h3>
    <div class="rp-scroll"><table class="rp-table">
      <thead><tr><th>Class</th><th class="num">Completed</th><th class="num">Percent</th><th style="width:34%"></th>
        <th class="num" title="Completed it, but not between ${esc(r.per.range)}">Outside the year</th></tr></thead>
      <tbody>${r.perClass.map(c => `<tr><td><b>${esc(c.name)}</b></td><td class="num">${c.n} of ${r.pool.length}</td>
        <td class="num">${c.pct}%</td><td><span class="rp-bar"><i style="width:${Math.min(100, c.pct)}%"></i></span></td>
        <td class="num note">${c.outside || "—"}</td></tr>`).join("")}</tbody>
    </table></div>
    <h3 class="rp-sub">By location</h3>
    <div class="rp-scroll"><table class="rp-table">
      <thead><tr><th>Location</th><th class="num">${esc(r.noun[0].toUpperCase() + r.noun.slice(1))}</th>${k > 1
        ? `<th class="num">Took all</th><th class="num">Percent</th><th class="num">At least one</th>`
        : `<th class="num">Took it</th><th class="num">Percent</th>`}</tr></thead>
      <tbody>${r.byStore.map(s => `<tr><td><b>${esc(s.store)}</b></td><td class="num">${s.people}</td><td class="num">${s.all}</td>
        <td class="num">${rpPctText(s.all, s.people)}</td>${k > 1 ? `<td class="num">${s.any}</td>` : ""}</tr>`).join("")}</tbody>
      <tfoot><tr><td>${rpClass.store === "all" ? "Whole company" : esc(rpClass.store)}</td><td class="num">${r.pool.length}</td>
        <td class="num">${r.allN}</td><td class="num">${rpPctText(r.allN, r.pool.length)}</td>${k > 1 ? `<td class="num">${r.anyN}</td>` : ""}</tr></tfoot>
    </table></div>
    <h3 class="rp-sub">Completed <span>${r.shown.length}</span></h3>
    ${k > 1 ? `<div class="chips">${rpShowLabels().map(([id, label]) =>
      `<button type="button" class="chip${rpClass.show === id ? " on" : ""}" data-rp-show="${id}">${label}</button>`).join("")}</div>` : ""}
    ${r.shown.length ? `<div class="rp-scroll"><table class="rp-table">
      <thead><tr><th>Name</th><th>Location</th><th>Job</th>${r.picked.map(c => `<th class="rp-classcol">${esc(c)}</th>`).join("")}${
        k > 1 ? `<th class="num">Done</th>` : ""}</tr></thead>
      <tbody>${r.shown.map(row => `<tr><td><b>${esc(row.p.name)}</b></td><td>${esc(row.p.store)}</td><td class="note">${esc(rpJob(row.p))}</td>
        ${row.done.map((d, i) => dateCell(d, row.outside[i])).join("")}${k > 1 ? `<td class="num ${row.n === k ? "ok" : ""}">${row.n} of ${k}</td>` : ""}</tr>`).join("")}</tbody>
    </table></div>` : `<p class="note">${r.completers.length ? "Nobody matches." : `Nobody completed ${k === 1 ? "this class" : "these classes"}
      in ${esc(r.per.label.toLowerCase())} (${esc(r.per.range)}).${(n => n ? ` ${n} ${n === 1 ? "person" : "people"} took ${k === 1 ? "it" : "them"}
      outside those dates; the By class table counts them. Try another year.` : "")(r.rows.filter(x => x.outside.some(Boolean)).length)}`}</p>`}
    <p class="note" style="margin:14px 0 0">Only the people who completed ${k === 1 ? "the class" : "one or more of the classes"} in
      ${esc(r.per.label.toLowerCase())} (${esc(r.per.range)}) are listed; the percentages count all ${r.pool.length} ${r.noun}. A class taken outside those dates shows in
      grey, marked Earlier or Later, and isn't counted.${k > 1 ? " The PDF and the Excel file list every completer, whichever of Any, All or Some is showing." : ""}</p>
  </div>`;
}

function rpClassPdf() {
  const r = rpClassModel(), k = r.picked.length;
  if (!k) return;
  const wide = k > 2;
  const pdf = rpPdf({ title: "Class Report", period: r.per.label, orientation: wide ? "landscape" : "portrait" });
  const Noun = r.noun[0].toUpperCase() + r.noun.slice(1);
  pdf.note(`${r.per.range}. ${r.pool.length} ${r.noun}${rpClass.store === "all" ? " across the company" : ` at ${rpClass.store}`}. ` +
    `A class counts when it was completed inside these dates.`);
  pdf.boxes([
    [Noun.toUpperCase(), String(r.pool.length), rpClass.store === "all" ? "Whole company" : rpClass.store],
    [k > 1 ? "TOOK ALL" : "TOOK IT", rpPctText(r.allN, r.pool.length), `${r.allN} of ${r.pool.length}`],
    ...(k > 1 ? [["AT LEAST ONE", rpPctText(r.anyN, r.pool.length), `${r.anyN} of ${r.pool.length}`]] : []),
    ["CLASSES", String(k), k === 1 ? "picked" : "picked together"]
  ]);
  pdf.section("By class");
  pdf.table([["Class", pdf.width - 270], ["Completed", 90, "r"], ["Percent", 80, "r"], ["Outside the year", 100, "r"]],
    r.perClass.map(c => [c.name, `${c.n} of ${r.pool.length}`, `${c.pct}%`, c.outside ? String(c.outside) : "-"]), { bold: 0 });
  pdf.section("By location");
  pdf.table(k > 1
      ? [["Location", pdf.width - 320], [Noun, 80, "r"], ["Took all", 80, "r"], ["Percent", 80, "r"], ["At least one", 80, "r"]]
      : [["Location", pdf.width - 240], [Noun, 80, "r"], ["Took it", 80, "r"], ["Percent", 80, "r"]],
    r.byStore.map(s => [s.store, String(s.people), String(s.all), rpPctText(s.all, s.people), ...(k > 1 ? [String(s.any)] : [])])
      .concat([[rpClass.store === "all" ? "Whole company" : rpClass.store, String(r.pool.length), String(r.allN),
        rpPctText(r.allN, r.pool.length), ...(k > 1 ? [String(r.anyN)] : [])]]),
    { bold: 0, total: true });
  pdf.section("Completed", `${r.completers.length} ${r.completers.length === 1 ? "person" : "people"} who completed ` +
    `${k === 1 ? "the class" : "one or more of the classes"} in ${r.per.label.toLowerCase()}, by location. ` +
    `"Earlier" or "Later" is a class they took outside the year, which isn't counted.`);
  // A column a class while they fit; past that, one column listing them.
  const fixed = [["Name", 120], ["Location", 80], ["Job", wide ? 110 : 90]];
  const left = pdf.width - fixed.reduce((t, c) => t + c[1], 0) - (k > 1 ? 44 : 0);
  const perCol = left / k;
  const listed = r.completers;
  const rowsOut = listed.map(row => [row.p.name, row.p.store, rpJob(row.p)]);
  let cols;
  if (perCol >= 74) {
    cols = fixed.concat(r.picked.map(c => [c, perCol])).concat(k > 1 ? [["Done", 44, "r"]] : []);
    listed.forEach((row, i) => rowsOut[i].push(...row.done.map((d, j) => d ? newsDate(d.completed)
      : row.outside[j] ? rpOutsideText(row.outside[j]) : "-"), ...(k > 1 ? [`${row.n}/${k}`] : [])));
  } else {
    cols = fixed.concat([["Classes", left], ["Done", 44, "r"]]);
    // What they took, with the dates, then one line of what they didn't.
    listed.forEach((row, i) => {
      const took = r.picked.map((c, j) => row.done[j] ? `${c} (${newsDate(row.done[j].completed)})` : null).filter(Boolean);
      const not = r.picked.map((c, j) => row.done[j] ? null
        : row.outside[j] ? `${c} (${row.outside[j].when.toLowerCase()}, ${newsDate(row.outside[j].completed)})` : c).filter(Boolean);
      rowsOut[i].push([...took, ...(not.length ? [`Not taken: ${not.join(", ")}`] : [])].join("\n"), `${row.n}/${k}`);
    });
  }
  // A date is green; "Done" only when every class is.
  pdf.table(cols, rowsOut, { bold: 0, headSize: 7, color: (row, i) => i < 3 ? null
    : i === cols.length - 1 && k > 1 ? (row[i] === `${k}/${k}` ? "ok" : null)
    : /^(Earlier|Later) /.test(row[i]) ? "muted"
    : row[i] !== "-" && !/Not taken/.test(row[i]) ? "ok" : null });
  pdf.save(`Class Report ${r.per.label}${rpClass.store === "all" ? "" : ` ${rpClass.store}`}.pdf`);
}

function rpClassXlsx() {
  const r = rpClassModel(), k = r.picked.length;
  if (!k) return;
  const Noun = r.noun[0].toUpperCase() + r.noun.slice(1);
  const head = [[`Class Report · ${r.per.label}`], [`Agri-Service, LLC · ${r.per.range} · ${rpClass.store === "all" ? "Whole company" : rpClass.store} · ${rpStamp()}`],
    [`${r.pool.length} ${r.noun}. A class counts when it was completed inside these dates.`], []];
  rpXlsx(`Class Report ${r.per.label}${rpClass.store === "all" ? "" : ` ${rpClass.store}`}.xlsx`, [
    { name: "By class", widths: [44, 12, 10, 10, 16], rows: head.concat([["Class", "Completed", Noun, "Percent", "Outside the year"],
      ...r.perClass.map(c => [c.name, c.n, r.pool.length, c.pct, c.outside]),
      ...(k > 1 ? [[], ["Took all", r.allN, r.pool.length, rpPct(r.allN, r.pool.length)],
        ["Took at least one", r.anyN, r.pool.length, rpPct(r.anyN, r.pool.length)]] : [])]) },
    { name: "By location", widths: [22, 12, 10, 10, ...(k > 1 ? [13] : []), ...r.picked.map(() => 14)],
      rows: head.concat([["Location", Noun, k > 1 ? "Took all" : "Took it", "Percent", ...(k > 1 ? ["At least one"] : []), ...r.picked],
        ...r.byStore.map(s => [s.store, s.people, s.all, rpPct(s.all, s.people), ...(k > 1 ? [s.any] : []), ...s.perClass]),
        [rpClass.store === "all" ? "Whole company" : rpClass.store, r.pool.length, r.allN, rpPct(r.allN, r.pool.length),
          ...(k > 1 ? [r.anyN] : []), ...r.perClass.map(c => c.n)]]) },
    { name: "Completed", widths: [24, 16, 28, ...r.picked.map(() => 16), ...(k > 1 ? [8] : [])],
      rows: head.concat([["Name", "Location", "Job", ...r.picked, ...(k > 1 ? ["Done"] : [])],
        ...r.completers.map(row => [row.p.name, row.p.store, rpJob(row.p), ...row.done.map((d, j) => d ? dateOnly(d.completed)
          : row.outside[j] ? rpOutsideText(row.outside[j]) : ""),
          ...(k > 1 ? [row.n] : [])])]) }
  ]);
}

// ---- the PDF and the workbook --------------------------------------------------------------

// The look of the Monthly Safety Report: the red band, boxes for the headline
// numbers, and tables that carry their header onto every page they run onto.
// jsPDF's fonts are Latin-1, so dashes and quotes become plain ones.
function rpPdf({ title, period, orientation = "portrait" }) {
  const latin = (t) => String(t ?? "").replace(/[–—]/g, "-").replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
    .replace(/…/g, "...").replace(/·/g, "-").replace(/[^\x00-\xFF]/g, "").trim();
  const doc = new jspdf.jsPDF({ unit: "pt", format: "letter", orientation });
  const W = orientation === "landscape" ? 792 : 612, H = orientation === "landscape" ? 612 : 792;
  const M = 40, CW = W - M * 2, BOTTOM = H - M - 20;
  const red = [204, 0, 51], ink = [30, 30, 30], grey = [110, 110, 110], light = [246, 245, 243], rule = [226, 224, 222];
  const tones = { ok: [23, 112, 47], short: [168, 0, 42], muted: [125, 125, 125] };
  let y = 0;
  const smallHead = () => {
    doc.setFillColor(...red); doc.rect(0, 0, W, 6, "F");
    doc.setFont("helvetica", "bold"); doc.setFontSize(8); doc.setTextColor(...grey);
    doc.text(latin(`AGRI-SERVICE  -  ${title.toUpperCase()}  -  ${period.toUpperCase()}`), M, 24);
    y = 42;
  };
  const ensure = (h, then) => { if (y + h > BOTTOM) { doc.addPage(); smallHead(); if (then) then(); } };

  doc.setFillColor(...red); doc.rect(0, 0, W, 78, "F");
  doc.setTextColor(255); doc.setFont("helvetica", "bold"); doc.setFontSize(21); doc.text("AGRI-SERVICE", M, 36);
  doc.setFontSize(10); doc.text(latin(title.toUpperCase()), M, 54);
  doc.setFontSize(17); doc.text(latin(period), W - M, 38, { align: "right" });
  doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.text(latin(rpStamp()), W - M, 55, { align: "right" });
  y = 100;

  return {
    width: CW,
    note(text) {
      doc.setFont("helvetica", "normal"); doc.setFontSize(10); doc.setTextColor(...grey);
      doc.splitTextToSize(latin(text), CW).forEach(l => { ensure(14); doc.text(l, M, y); y += 13; });
      y += 8;
    },
    boxes(list) {
      const n = list.length, gap = 10, bw = (CW - gap * (n - 1)) / n, bh = 58;
      ensure(bh + 10);
      list.forEach(([label, value, sub, tone], i) => {
        const bx = M + i * (bw + gap);
        doc.setFillColor(...light); doc.roundedRect(bx, y, bw, bh, 4, 4, "F");
        doc.setFillColor(...red); doc.rect(bx, y, 3, bh, "F");
        doc.setFont("helvetica", "bold"); doc.setFontSize(7.5); doc.setTextColor(...grey); doc.text(latin(label), bx + 11, y + 14);
        doc.setFontSize(19); doc.setTextColor(...(tones[tone] || ink)); doc.text(latin(value), bx + 11, y + 37);
        doc.setFont("helvetica", "normal"); doc.setFontSize(8.3); doc.setTextColor(...grey);
        doc.text(doc.splitTextToSize(latin(sub || ""), bw - 18)[0] || "", bx + 11, y + 50);
      });
      y += bh + 14;
    },
    section(name, sub) {
      ensure(70); y += 22;
      doc.setFont("helvetica", "bold"); doc.setFontSize(12.5); doc.setTextColor(...ink); doc.text(latin(name.toUpperCase()), M, y);
      doc.setFillColor(...red); doc.rect(M, y + 6, 36, 2.5, "F"); y += 20;
      if (sub) {
        doc.setFont("helvetica", "normal"); doc.setFontSize(9.3); doc.setTextColor(...grey);
        doc.splitTextToSize(latin(sub), CW).forEach(l => { doc.text(l, M, y); y += 12; }); y += 4;
      }
    },
    // cols: [label, width, "r" to right-align]; rows of strings. opts.total
    // makes the last row bold and shaded; opts.color(row, i) gives "ok" or "short".
    table(cols, rows, opts = {}) {
      const xs = []; cols.reduce((x, c) => (xs.push(x), x + c[1]), M);
      const head = () => {
        doc.setFont("helvetica", "bold"); doc.setFontSize(opts.headSize || 7.5);
        const labels = cols.map(([label, w]) => doc.splitTextToSize(latin(label.toUpperCase()), w - 10));
        const hh = Math.max(...labels.map(l => l.length)) * 9 + 8;
        doc.setFillColor(238, 236, 233); doc.rect(M, y, CW, hh, "F");
        doc.setTextColor(...grey);
        labels.forEach((lines, i) => lines.forEach((l, j) => doc.text(l, cols[i][2] ? xs[i] + cols[i][1] - 5 : xs[i] + 5,
          y + 11 + j * 9, cols[i][2] ? { align: "right" } : {})));
        y += hh;
      };
      ensure(40); head();
      rows.forEach((row, n) => {
        doc.setFontSize(8.8);
        const cells = row.map((v, i) => latin(v).split("\n").flatMap(part => doc.splitTextToSize(part || " ", cols[i][1] - 10)));
        const h = Math.max(...cells.map(c => c.length)) * 11 + 8;
        ensure(h, head);
        doc.setFontSize(8.8);
        const total = opts.total && n === rows.length - 1;
        if (total) { doc.setFillColor(232, 230, 227); doc.rect(M, y, CW, h, "F"); }
        else if (n % 2) { doc.setFillColor(...light); doc.rect(M, y, CW, h, "F"); }
        cells.forEach((lines, i) => {
          const tone = opts.color ? opts.color(row, i) : null;
          doc.setFont("helvetica", total || opts.bold === i ? "bold" : "normal");
          doc.setTextColor(...(tones[tone] || ink));
          lines.forEach((l, j) => doc.text(l, cols[i][2] ? xs[i] + cols[i][1] - 5 : xs[i] + 5, y + 12 + j * 11,
            cols[i][2] ? { align: "right" } : {}));
        });
        doc.setDrawColor(...rule); doc.line(M, y + h, M + CW, y + h);
        y += h;
      });
      if (!rows.length) { doc.setFont("helvetica", "italic"); doc.setFontSize(9); doc.setTextColor(...grey); doc.text("Nobody.", M + 5, y + 13); y += 20; }
    },
    save(name) {
      const pages = doc.getNumberOfPages();
      for (let p = 1; p <= pages; p++) {
        doc.setPage(p); doc.setDrawColor(220); doc.line(M, H - M + 2, M + CW, H - M + 2);
        doc.setFont("helvetica", "normal"); doc.setFontSize(7.5); doc.setTextColor(...grey);
        doc.text(latin(`Agri-Service, LLC  -  ${title}  -  ${period}  -  From the UKG Training Status uploads`), M, H - M + 14);
        doc.setFont("helvetica", "bold"); doc.text(`Page ${p} of ${pages}`, W - M, H - M + 14, { align: "right" });
      }
      doc.save(name);
    }
  };
}

// An Excel workbook, one sheet per table. Dates go in as real dates.
function rpXlsx(name, sheets) {
  const book = XLSX.utils.book_new();
  sheets.forEach(s => {
    const sheet = XLSX.utils.aoa_to_sheet(s.rows, { cellDates: true, dateNF: "mmm d, yyyy" });
    if (s.widths) sheet["!cols"] = s.widths.map(w => ({ wch: w }));
    XLSX.utils.book_append_sheet(book, sheet, s.name.slice(0, 31));
  });
  XLSX.writeFile(book, name);
}

// ---- what the controls do ------------------------------------------------------------------

$("admin").addEventListener("change", (event) => {
  const t = event.target;
  if (t.id === "rpAgcoStore") { rpAgcoStore = t.value; return renderRpAgco(); }
  if (t.id === "rpClassYear") { rpClass.year = Number(t.value); return rpDrawClassReport(); }
  if (t.id === "rpClassStore") { rpClass.store = t.value; return rpDrawClassReport(); }
  if (t.id === "rpClassTechs") { rpClass.techs = t.checked; return rpDrawClassReport(); }
  if (t.dataset && t.dataset.rpClass !== undefined) {
    const name = t.dataset.rpClass;
    rpClass.picked = t.checked ? rpClass.picked.concat(rpClass.picked.includes(name) ? [] : [name]) : rpClass.picked.filter(c => c !== name);
    t.closest(".rp-class").classList.toggle("on", t.checked);
    $("rpClassCount").textContent = $("rpClassCount").textContent.replace(/^\d+ picked/, `${rpClass.picked.length} picked`);
    rpDrawClassReport();
  }
});

$("admin").addEventListener("input", (event) => {
  if (event.target.id !== "rpClassSearch") return;
  rpClass.search = event.target.value;
  rpDrawClassList();
});

$("admin").addEventListener("click", (event) => {
  const kind = event.target.closest("[data-rp-kind]");
  if (kind) { rpClass.kind = kind.dataset.rpKind; rpClass.year = null; return rpDrawClassReport(); }
  const show = event.target.closest("[data-rp-show]");
  if (show) { rpClass.show = show.dataset.rpShow; return rpDrawClassReport(); }
  const unpick = event.target.closest("[data-rp-unpick]");
  if (unpick) {
    rpClass.picked = rpClass.picked.filter(c => c !== unpick.dataset.rpUnpick);
    rpDrawClassList();
    return rpDrawClassReport();
  }
  const b = event.target.closest("[data-rp]");
  if (!b) return;
  try {
    ({ "agco-pdf": rpAgcoPdf, "agco-xlsx": rpAgcoXlsx, "class-pdf": rpClassPdf, "class-xlsx": rpClassXlsx })[b.dataset.rp]();
  } catch (e) {
    alert(`That report couldn't be made: ${e.message}`);
  }
});

function crPageInner() {
  const model = tsModel();
  const courses = crCourses(model);
  if (!courses.length) {
    return `<div class="card"><p class="note" style="margin:0">No classes on the uploaded reports yet.${
      isOwner() ? " Upload them on the Training dashboard, under Uploads → <b>Training Status</b>." : ""}</p></div>`;
  }
  // A class that went away with a new upload.
  if (crState.course && !courses.some(c => c.name === crState.course)) crState.course = null;
  return `<div class="cr-layout${crState.course ? " picked" : ""}">
      <div class="card cr-picker">
        <input type="text" class="search" id="crSearch" placeholder="Search classes…"
               value="${esc(crState.search)}" aria-label="Search classes">
        <p class="note cr-count">${courses.length} classes · the number is how many have taken it</p>
        <div id="crCourses">${crCourseList(courses)}</div>
      </div>
      <div class="cr-report">${crState.course ? crReport(model)
        : `<div class="card"><p class="note" style="margin:0">Pick a class to see who has taken it and who hasn't.</p></div>`}</div>
    </div>
    <p class="note ts-sources">${tsSourcesNote(tsSources)}</p>`;
}

function crCourseList(courses) {
  const text = crState.search.trim().toLowerCase();
  const found = courses.filter(c => !text || c.name.toLowerCase().includes(text));
  if (!found.length) return `<p class="note" style="margin:8px 4px">No class matches that.</p>`;
  return found.map(c => `<button type="button" class="cr-course${c.name === crState.course ? " on" : ""}"
      data-cr-course="${esc(c.name)}"><span>${esc(c.name)}</span><span class="n">${c.count}</span></button>`).join("");
}

function crReport(model) {
  const { pool, taken, shown } = crList(model);
  const noun = crState.techs ? "technicians" : "people";
  const share = pool.length ? taken / pool.length : 0;
  const filterLabel = CR_FILTERS.find(f => f[0] === crState.filter)[1];
  const exported = tsSources && tsSources.history && tsSources.history.exported;
  return `<div class="card">
    <div class="cr-head">
      <div style="min-width:0"><h2 class="cr-title">${esc(crState.course)}</h2>
        <p class="note" style="margin:0">${taken} of ${pool.length} ${noun} have taken it · ${
          isOwner() ? "all locations" : "your location"}</p></div>
      <button type="button" class="ghost cr-change" data-cr-change>Change class</button>
    </div>
    <div class="cr-meter" role="img" aria-label="${Math.round(share * 100)}% have taken it">
      <span><i style="width:${(share * 100).toFixed(1)}%"></i></span><b>${Math.round(share * 100)}%</b></div>
    <div class="row cr-controls">
      <div class="chips" style="margin:0">${CR_FILTERS.map(([id, label]) =>
        `<button type="button" class="chip${crState.filter === id ? " on" : ""}" data-cr-filter="${id}">${label}</button>`).join("")}</div>
      <label class="check" style="margin:0"><input type="checkbox" id="crTechs"${crState.techs ? " checked" : ""}> Technicians only</label>
      <button type="button" class="pdf" data-cr-pdf style="margin-left:auto">Download this list as a PDF</button>
    </div>
    <p class="section-title" style="margin:16px 2px 8px">${shown.length} ${shown.length === 1 ? "person" : "people"} · ${filterLabel.toLowerCase()}</p>
    ${shown.length ? `<div style="overflow-x:auto"><table class="cr-table">
      <thead><tr><th>Name</th><th>Location · job</th><th>Completed</th></tr></thead>
      <tbody>${shown.map(p => {
        const done = crCompletion(p, crState.course);
        return `<tr><td><b>${esc(p.name)}</b></td><td class="note">${esc(crShopJob(p))}</td>
          <td class="${done ? "cr-done" : "note"}">${done ? esc(newsDate(done.completed)) : "—"}</td></tr>`;
      }).join("")}</tbody></table></div>`
      : `<p class="note">${crState.filter === "notTaken" ? "Everyone has taken it." : "Nobody here."}</p>`}
    <p class="note" style="margin:14px 0 0">The PDF is what you're looking at now: ${filterLabel.toLowerCase()}${
      crState.techs ? ", technicians only" : ""}.${exported ? ` From the course history exported ${esc(exported.replace(" MDT", ""))}.` : ""}</p>
  </div>`;
}

function crRedraw() {
  const page = $("crPage");
  if (page) page.innerHTML = crPageInner();
}

document.addEventListener("click", (event) => {
  const course = event.target.closest("[data-cr-course]");
  if (course) {
    crState.course = course.dataset.crCourse;
    crRedraw();
    // On a phone the list gives way to the report, so start at its top.
    if (!document.querySelector(".cr-picker") || getComputedStyle(document.querySelector(".cr-picker")).display === "none") {
      const report = document.querySelector(".cr-report");
      if (report) report.scrollIntoView({ block: "start" });
    }
    return;
  }
  if (event.target.closest("[data-cr-change]")) { crState.course = null; crRedraw(); return; }
  const filter = event.target.closest("[data-cr-filter]");
  if (filter) { crState.filter = filter.dataset.crFilter; crRedraw(); return; }
  if (event.target.closest("[data-cr-pdf]")) downloadCourseReportPDF();
});

document.addEventListener("change", (event) => {
  if (event.target.id === "crTechs") { crState.techs = event.target.checked; crRedraw(); }
  if (event.target.id === "evalAccept") {
    const agree = document.querySelector("[data-eval-agree]");
    if (agree) agree.disabled = !event.target.checked;
    event.target.closest(".terms-accept").classList.toggle("on", event.target.checked);
  }
});

// Only the list changes as you type, so the box keeps its place and focus.
document.addEventListener("input", (event) => {
  if (event.target.id !== "crSearch") return;
  crState.search = event.target.value;
  $("crCourses").innerHTML = crCourseList(crCourses(tsModel()));
});

// The report as a sheet of paper, as CourseReportPDF.swift draws it: what the
// screen is showing, filter and all, with the column headings repeated on
// every page and "page 2 of 4" at the foot, for handing round a meeting.
function downloadCourseReportPDF() {
  const model = tsModel();
  const course = crState.course;
  if (!course) return;
  const { pool, taken, shown } = crList(model);
  const noun = crState.techs ? "technicians" : "people";
  const filterLabel = CR_FILTERS.find(f => f[0] === crState.filter)[1];
  const scope = isOwner() ? "All locations"
    : (myLocationNames().join(", ") || (model.stores[0]) || "Your location");
  const exported = tsSources && tsSources.history && tsSources.history.exported;
  const RED = [204, 0, 51], GREEN = [33, 112, 48], GREY = [90, 90, 90];

  const PAGE_W = 612, PAGE_H = 792, MARGIN = 50, WIDTH = PAGE_W - MARGIN * 2;
  const dateCol = PAGE_W - MARGIN - 96, shopCol = PAGE_W - MARGIN - 250;
  const doc = new jspdf.jsPDF({ unit: "pt", format: "letter" });
  let y = MARGIN;
  const write = (str, x, top, { size = 10.5, style = "normal", color = [0, 0, 0], width } = {}) => {
    doc.setFont("helvetica", style); doc.setFontSize(size); doc.setTextColor(...color);
    const lines = width ? doc.splitTextToSize(pdfSafe(str), width) : [pdfSafe(str)];
    doc.text(lines, x, top + size * 0.85);
    return lines.length * size * 1.25;
  };
  // Cut to a column's width with "...", as the app truncates.
  const fit = (str, width, size, style = "normal") => {
    doc.setFont("helvetica", style); doc.setFontSize(size);
    let text = pdfSafe(str);
    if (doc.getTextWidth(text) <= width) return text;
    while (text.length > 1 && doc.getTextWidth(text + "...") > width) text = text.slice(0, -1);
    return text.trimEnd() + "...";
  };
  const columnHeader = () => {
    write("NAME", MARGIN, y, { size: 8, style: "bold", color: [130, 130, 130] });
    write("LOCATION · JOB", shopCol, y, { size: 8, style: "bold", color: [130, 130, 130] });
    write("COMPLETED", dateCol, y, { size: 8, style: "bold", color: [130, 130, 130] });
    y += 12;
    doc.setDrawColor(190, 190, 190); doc.setLineWidth(0.5); doc.line(MARGIN, y, MARGIN + WIDTH, y);
    y += 6;
  };
  const ensure = (needed, header) => {
    if (y + needed <= PAGE_H - MARGIN - 26) return;
    doc.addPage(); y = MARGIN;
    if (header) columnHeader();
  };
  const note = (str) => { ensure(30); y += write(str, MARGIN, y, { size: 9, color: GREY, width: WIDTH }) + 4; };

  doc.setFillColor(...RED); doc.rect(MARGIN, y, WIDTH, 24, "F");
  write("COURSE REPORT", MARGIN + 8, y + 5, { size: 14, style: "bold", color: [255, 255, 255] });
  y += 30;
  y += write(course, MARGIN, y, { size: 13, style: "bold", width: WIDTH }) + 4;
  write([filterLabel, crState.techs ? "technicians only" : "everyone", scope].join(" · "), MARGIN, y,
    { size: 9, color: GREY });
  y += 23;

  // A bar, because "48 of 135" lands slower than seeing it.
  const share = pool.length ? taken / pool.length : 0;
  const barWidth = WIDTH - 200;
  doc.setFillColor(245, 245, 245); doc.roundedRect(MARGIN, y, WIDTH, 34, 5, 5, "F");
  doc.setFillColor(219, 219, 219); doc.roundedRect(MARGIN + 12, y + 21, barWidth, 5, 2.5, 2.5, "F");
  doc.setFillColor(...GREEN); doc.roundedRect(MARGIN + 12, y + 21, Math.max(2, barWidth * share), 5, 2.5, 2.5, "F");
  write(`${taken} of ${pool.length} ${noun} have taken it`, MARGIN + 12, y + 6);
  write(`${Math.round(share * 100)}%`, PAGE_W - MARGIN - 60, y + 9, { size: 13, style: "bold", color: GREEN });
  y += 50;

  columnHeader();
  shown.forEach(p => {
    ensure(18, true);
    const done = crCompletion(p, course);
    write(fit(p.name, shopCol - MARGIN - 8, 10.5), MARGIN, y);
    write(fit(crShopJob(p), dateCol - shopCol - 8, 9), shopCol, y + 1, { size: 9, color: GREY });
    write(done ? newsDate(done.completed) : "-", dateCol, y, { color: done ? GREEN : GREY });
    y += 15;
  });
  if (!shown.length) note(crState.filter === "notTaken" ? "Everyone has taken it." : "Nobody on this list.");

  y += 14;
  note(`From the course history${exported ? ` exported ${exported.replace(" MDT", "")}` : ""}. `
    + "Somebody who took the class after that is not on it yet.");

  // The foot of every page, now the number of pages is known.
  const printed = new Date().toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    write(`Agri-Service, LLC · printed ${printed} · page ${i} of ${pages}`, MARGIN, PAGE_H - MARGIN + 8,
      { size: 9, color: [140, 140, 140] });
  }
  doc.save(`Course Report - ${course.replace(/[\\/:*?"<>|]/g, "-")}.pdf`);
}
