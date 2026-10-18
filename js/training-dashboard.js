// The Training dashboard's front page
//
// The Training Manager's front page: the metric, what's out of date, and
// the people behind each tile.

// ---- the Training dashboard's front page -----------------------------------------
//
// The dealer metric first: the share of technicians with 24+ AGCO hours
// against AGCO's 65%, how many more it takes, and each location's share. Then who
// has it and who doesn't, where ticking someone plans them to get there (the
// same plan as Training Status's Planning tab, saved to this account). Then
// the Mock Schedule's year, AGCO Development by level, and how fresh each
// upload is. Every number opens the tab behind it. The Cab look, in teal.

let txStore = "all";
// The overview tile that's open, showing the people behind its number.
let txDrill = null;

// When each upload was made, as far as the files say. Older than a month and
// it's worth a fresh one.
function txUploads() {
  const src = tsSources || {};
  const when = (text) => { const d = text ? new Date(text) : null; return d && !isNaN(d) ? d : null; };
  const block = (label, b, tab) => {
    const date = b && (when(b.exported) || when(b.uploaded_at));
    return { label, tab, file: b && b.file, date, text: b && b.exported ? `Exported ${b.exported}` : b && b.file ? "Uploaded" : "Not uploaded yet",
      missing: !(b && (b.file || b.exported)) };
  };
  const osr = trainingReports.internal, osrAgco = trainingReports.agco;
  const catalog = ((agcoCatalog && agcoCatalog.source) || {}).catalog || {};
  const rows = [
    block("All employees", src.employees, "trainingstatus"),
    block(src.credits && src.credits.format === "rules" ? "Credit Rules" : "Credits All Time", src.credits, "trainingstatus"),
    block("OLT and ILT", src.history, "trainingstatus"),
    { label: "Open Seat Report", tab: "openseat", date: osr ? new Date(osr.updated_at) : null,
      text: osr ? `Published ${new Date(osr.updated_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}` : "Not published yet", missing: !osr },
    { label: "AGCO sessions", tab: "openseat", date: osrAgco ? new Date(osrAgco.updated_at) : null,
      text: osrAgco ? `Published ${new Date(osrAgco.updated_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}` : "Not published yet", missing: !osrAgco },
    { label: "AGCO Catalog", tab: "agcocatalog", date: when(catalog.dated) || (agcoCatalog && agcoCatalog.updated_at ? new Date(agcoCatalog.updated_at) : null),
      text: catalog.file ? `${catalog.file}${catalog.dated ? `, ${catalog.dated}` : ""}` : "Not uploaded yet", missing: !catalog.file, slow: true }
  ];
  // The catalog changes a few times a year; the rest weekly or monthly.
  rows.forEach(r => { r.days = r.date ? Math.floor((Date.now() - r.date) / SX_DAY) : null;
    r.stale = r.missing || (r.days !== null && r.days > (r.slow ? 180 : 30)); });
  return rows;
}

function renderTrainingNavCounts(uploads) {
  ["trainingstatus", "openseat", "agcocatalog"].forEach(tab => {
    const el = document.querySelector(`#trainingNav [data-tx-count="${tab}"]`);
    if (el) el.textContent = uploads.some(u => u.tab === tab && u.stale) ? "!" : "";
  });
}

// Each location's share against the goal: columns, with the goal drawn across.
function txShopChart(m) {
  const goal = tsGoalPercent();
  const shops = m.stores.map(store => {
    const techs = m.techs.filter(t => t.store === store);
    return { store, total: techs.length, met: techs.filter(t => t.met).length };
  }).filter(s => s.total);
  const on = (s) => txStore === s.store ? " on" : "";
  return `<div class="tx-chart" role="img" aria-label="Share of technicians with ${tsRequiredHours()}+ hours at each location, goal ${goal}%">
    <div class="tx-plot">
      <i class="tx-goal" style="bottom:${goal}%"><span>Goal ${goal}%</span></i>
      ${shops.map(s => { const pct = s.met / s.total * 100;
        return `<button type="button" class="tx-col${on(s)}" data-tx-store="${esc(s.store)}" title="${esc(s.store)}: ${s.met} of ${s.total} (${Math.round(pct)}%)">
          <i class="${pct >= goal ? "ok" : ""}" style="height:${Math.max(1.5, pct)}%"></i>
          <span class="tx-val" style="bottom:calc(${Math.max(1.5, pct)}% + 4px)">${Math.round(pct)}%</span></button>`; }).join("")}
    </div>
    <div class="tx-labels">${shops.map(s => `<button type="button" class="${on(s).trim()}" data-tx-store="${esc(s.store)}">${esc(s.store)}<em>${s.met} of ${s.total}</em></button>`).join("")}</div>
  </div>`;
}

function txWhoRow(t, planning) {
  const pct = t.hours === null ? 0 : Math.min(100, t.hours / t.required * 100);
  const need = Math.max(0, t.required - (t.hours || 0));
  return `<div class="tx-who-row${planning && tsPlan.has(t.key) ? " planned" : ""}">
    ${planning ? `<label class="tx-plan" title="Plan to get ${esc(t.first)} to ${t.required} hours"><input type="checkbox" data-ts-plan="${esc(t.key)}"${
      tsPlan.has(t.key) ? " checked" : ""}><span>Plan</span></label>` : ""}
    <span class="tx-who-name"><b>${esc(t.name)}</b><small>${esc(t.store)}${t.epa609 ? "" : " · no EPA 609"}</small></span>
    <span class="tx-bar"><i class="${t.met ? "ok" : ""}" style="width:${pct}%"></i></span>
    <span class="tx-hrs">${t.hours === null ? "—" : `${t.hours}<small> hrs</small>`}</span>
    ${planning ? `<span class="tx-need">${tsPlan.has(t.key) ? "Planned" : `needs ${need}`}</span>` : ""}
  </div>`;
}

// The people behind one of the overview tiles. Every number on the tiles is
// dealer-wide, so these are too, whatever location the list below is showing.
function txDrillPanel(m, { goal, need, plan, close }) {
  if (!txDrill) return "";
  const shortBy = (t) => Math.max(0, t.required - (t.hours || 0));
  const closest = (a, b) => shortBy(a) - shortBy(b) || a.name.localeCompare(b.name);
  const most = (a, b) => (b.hours || 0) - (a.hours || 0) || a.name.localeCompare(b.name);
  const notMet = m.techs.filter(t => !t.met).sort(closest);
  const met = m.techs.filter(t => t.met).sort(most);
  const list = (people, planning = false) => people.length
    ? `<div class="tx-who-list">${people.map(t => txWhoRow(t, planning)).join("")}</div>`
    : `<p class="sx-empty">Nobody.</p>`;
  const line = (t, note) => `<div class="tx-who-row tx-line"><span class="tx-who-name"><b>${esc(t.name)}</b>
      <small>${esc([t.store, (t.job || "").replace(/^\d+\s*-\s*/, "")].filter(Boolean).join(" · "))}</small></span>
      <span class="tx-note">${note}</span></div>`;
  const byLocation = (people, row) => m.stores.map(store => {
    const here = people.filter(t => t.store === store);
    return here.length ? `<h4>${esc(store)} · ${here.length}</h4><div class="tx-who-list">${here.map(row).join("")}</div>` : "";
  }).join("");

  let color, title, sub, body, link = "";
  if (txDrill === "techs") {
    color = "steel"; title = `Technicians · ${m.techs.length}`;
    sub = "Jobs with Technician in the title, on All Employees";
    link = `<button type="button" class="sx-link" data-tx-go="trainingstatus">Training Status &rsaquo;</button>`;
    body = byLocation([...m.techs].sort(most), t => txWhoRow(t, false));
  } else if (txDrill === "met") {
    color = "green"; title = `Have ${need}+ hours · ${met.length}`;
    sub = `${tsPct(m.pct)} of ${m.techs.length} technicians, most hours first`;
    body = list(met);
  } else if (txDrill === "short") {
    color = "amber"; title = `Still need hours · ${notMet.length}`;
    sub = close ? `Closest first · ${close} within 8 hours` : "Closest first";
    const near = notMet.filter(t => t.hours !== null && shortBy(t) <= 8), far = notMet.filter(t => !near.includes(t));
    body = near.length && far.length
      ? `<h4>Within 8 hours · ${near.length}</h4>${list(near, true)}<h4>More than 8 to go · ${far.length}</h4>${list(far, true)}`
      : list(notMet, true);
  } else if (txDrill === "goal") {
    color = m.pct >= tsGoal() ? "green" : "red";
    title = m.pct >= tsGoal() ? `${goal}% goal met` : `${m.neededForGoal} more for ${goal}%`;
    sub = `${m.goalCount} of ${m.techs.length} technicians is ${goal}% · ${m.metCount} have ${need}+ hours`;
    const want = m.pct >= tsGoal() ? 0 : m.neededForGoal;
    body = want
      ? `<p class="sx-sub">Any ${want} of these reaching ${need} hours meets the goal. The ${want} closest are first.</p>
         <h4>Closest ${want}</h4>${list(notMet.slice(0, want), true)}
         ${notMet.length > want ? `<h4>Everyone else still short · ${notMet.length - want}</h4>${list(notMet.slice(want), true)}` : ""}`
      : `<p class="sx-empty sx-clear">${icon("checkCircle", 18)} ${m.metCount} of ${m.techs.length} have ${need}+ hours, which is at least ${goal}%.</p>`;
  } else if (txDrill === "plan") {
    color = plan.projected >= tsGoal() ? "green" : "teal";
    title = `With your plan · ${tsPct(plan.projected)}`;
    sub = `${m.metCount} have ${need}+ hours, plus ${plan.planned} planned${plan.stillNeeded ? ` · ${plan.stillNeeded} more to reach ${goal}%` : ` · reaches ${goal}%`}`;
    const planned = notMet.filter(t => tsPlan.has(t.key)), rest = notMet.filter(t => !tsPlan.has(t.key));
    body = `<p class="sx-sub">Tick <b>Plan</b> for anyone you'll get to ${need} hours this year. The plan is saved to your account.</p>
      <h4>Planned · ${planned.length}</h4>${planned.length ? list(planned, true) : `<p class="sx-empty">Nobody yet.</p>`}
      ${rest.length ? `<h4>Not planned, closest first · ${rest.length}</h4>${list(rest, true)}` : ""}`;
  } else if (txDrill === "epa") {
    color = "violet";
    const without = m.techs.filter(t => !t.epa609), with609 = m.techs.filter(t => t.epa609);
    title = `EPA 609 · ${without.length} still need one`;
    sub = `${with609.length} of ${m.techs.length} technicians have it, from the credits report`;
    const byPlace = (a, b) => a.store.localeCompare(b.store) || a.name.localeCompare(b.name);
    body = `<div class="tx-who">
      <div><h4>Still need EPA 609 · ${without.length}</h4>${without.length
        ? `<div class="tx-who-list">${without.sort(byPlace).map(t => line(t, `<span class="tx-need">needs it</span>`)).join("")}</div>`
        : `<p class="sx-empty sx-clear">${icon("checkCircle", 18)} Every technician has it.</p>`}</div>
      <div><h4>Have it · ${with609.length}</h4>${with609.length
        ? `<div class="tx-who-list">${with609.sort(byPlace).map(t => line(t, `<span class="tx-have">${icon("checkCircle", 15)}</span>`)).join("")}</div>`
        : `<p class="sx-empty">Nobody yet.</p>`}</div></div>`;
  } else {
    return "";
  }
  return `<section class="sx-panel tx-drill" id="txDrill" style="${lit(color)}" aria-label="${esc(title)}">
    <header><h3>${esc(title)}</h3><span>${esc(sub)}</span>${link}
      <button type="button" class="sx-link tx-drill-close" data-tx-drill="${txDrill}" aria-label="Close">Close &times;</button></header>
    ${body}
  </section>`;
}

function renderTrainingOverview() {
  const box = $("txOverview");
  if (!box) return;
  const uploads = txUploads();
  renderTrainingNavCounts(uploads);
  if (trainingStatusError) {
    box.innerHTML = `<div class="card"><p class="error">${esc(trainingStatusError)}</p></div>`;
    return;
  }
  const m = tsModel();
  if (!m.techs.length) {
    box.innerHTML = `<div class="sx"><section class="sx-hero"><div class="sx-hero-text"><span class="sx-kicker">Training dashboard</span>
      <h2>No technicians yet</h2><p>Upload the UKG reports under Uploads → Training Status, and this fills in.</p></div>
      <button type="button" class="sx-link" data-tx-go="trainingstatus">Upload them &rsaquo;</button></section></div>`;
    return;
  }
  const goal = tsGoalPercent(), need = tsRequiredHours(), plan = tsPlanNumbers(m);
  const pctNow = m.pct * 100, metGoal = m.pct >= tsGoal();
  const shown = (list) => txStore === "all" ? list : list.filter(t => t.store === txStore);
  const notYet = shown(m.techs.filter(t => !t.met)).sort((a, b) => (b.hours || 0) - (a.hours || 0) || a.name.localeCompare(b.name));
  const have = shown(m.techs.filter(t => t.met)).sort((a, b) => b.hours - a.hours || a.name.localeCompare(b.name));
  const close = m.techs.filter(t => !t.met && t.hours !== null && t.required - t.hours <= 8).length;
  const period = tsPeriod();
  const credits = (tsSources && tsSources.credits && tsSources.credits.exported) || "";

  // The Mock Schedule's year.
  let mock = null;
  try { if (!mockError) { const st = mockStats(); mock = { st, year: mockYear, courses: mockCourses().filter(mockInYear).length }; } } catch { mock = null; }
  // AGCO Development, by the level each technician has reached.
  const tally = agcoError ? null : agcoTally(agcoPeople);
  const stale = uploads.filter(u => u.stale);

  box.innerHTML = `<div class="sx tx" style="${lit("teal")}">
    <section class="sx-hero tx-hero">
      <div class="sx-hero-text">
        <span class="sx-kicker">AGCO dealer metric${period ? ` · ${esc(period)}` : ""}${credits ? ` · credits exported ${esc(credits)}` : ""}</span>
        <h2>${tsPct(m.pct)} have ${need}+ hours</h2>
        <p>${m.metCount} of ${m.techs.length} technicians. ${metGoal ? `<b class="ok">The ${goal}% goal is met.</b>`
          : `<b>${m.neededForGoal} more</b> to reach ${goal}% (${m.goalCount} technicians).`}${close ? ` ${close} ${close === 1 ? "is" : "are"} within 8 hours.` : ""}</p>
      </div>
      <div class="tx-gauge${metGoal ? " ok" : ""}" style="--p:${Math.min(100, pctNow)}%;--g:${goal}" role="img"
        aria-label="${tsPct(m.pct)} of technicians, goal ${goal}%">
        <i class="tx-gauge-goal"></i>
        <b>${Math.round(pctNow)}<small>%</small></b>
        <span>Goal ${goal}%</span>
      </div>
    </section>

    <div class="sx-tiles">
      ${sxTile("Technicians", sxNum(m.techs.length), "on All Employees", { lit: "steel", drill: "techs" })}
      ${sxTile(`Have ${need}+ hours`, sxNum(m.metCount), `${tsPct(m.pct)} of technicians`, { lit: "green", good: metGoal, drill: "met" })}
      ${sxTile(`Still need hours`, sxNum(m.techs.length - m.metCount), close ? `${close} within 8 hours` : "Below the line", { lit: "amber", drill: "short" })}
      ${sxTile(`More for ${goal}%`, metGoal ? "0" : sxNum(m.neededForGoal), metGoal ? "The goal is met" : `${m.goalCount} technicians is ${goal}%`, { lit: metGoal ? "green" : "red", hot: !metGoal, drill: "goal" })}
      ${sxTile("With your plan", tsPct(plan.projected).replace("%", "<small>%</small>"), plan.planned ? `${plan.planned} planned · ${plan.stillNeeded ? `${plan.stillNeeded} more to go` : `reaches ${goal}%`}` : "Tick people below to plan", { lit: plan.projected >= tsGoal() ? "green" : "teal", good: plan.projected >= tsGoal(), drill: "plan" })}
      ${sxTile("EPA 609", tsPct(m.techs.length ? m.epaCount / m.techs.length : 0).replace("%", "<small>%</small>"), `${m.techs.length - m.epaCount} still need one`, { lit: "violet", drill: "epa" })}
    </div>
    ${txDrillPanel(m, { goal, need, plan, close })}

    <div class="sx-grid">
      <section class="sx-panel sx-wide">
        <header><h3>By location</h3><span>Share with ${need}+ hours · tap a location to filter</span>
          ${txStore !== "all" ? `<button type="button" class="sx-link" data-tx-store="all">All locations &rsaquo;</button>` : ""}</header>
        ${txShopChart(m)}
      </section>

      <section class="sx-panel" style="${lit(stale.length ? "amber" : "green")}">
        <header><h3>Uploads</h3><span>${stale.length ? `${stale.length} need${stale.length === 1 ? "s" : ""} a fresh one` : "All current"}</span></header>
        <div class="tx-uploads">${uploads.map(u => `<button type="button" class="tx-upload${u.stale ? " stale" : ""}" data-tx-go="${u.tab}">
          <span><b>${esc(u.label)}</b><small>${esc(u.text)}</small></span>
          <em>${u.missing ? "Upload" : u.days === null ? "" : u.days === 0 ? "Today" : `${u.days}d`}</em></button>`).join("")}</div>
      </section>

      <section class="sx-panel sx-full">
        <header><h3>Who has it, and who doesn't</h3><span>${txStore === "all" ? "Every location" : esc(txStore)}</span>
          <select id="txStore" class="tx-store">${["all", ...m.stores.filter(s => m.techs.some(t => t.store === s))].map(s =>
            `<option value="${esc(s)}"${s === txStore ? " selected" : ""}>${s === "all" ? "Every location" : esc(s)}</option>`).join("")}</select></header>
        <div class="tx-who">
          <div>
            <h4>Not there yet · ${notYet.length}</h4>
            <p class="sx-sub">Tick <b>Plan</b> for anyone you'll get to ${need} hours this year: <b>${tsPct(plan.projected)}</b> with the plan${
              plan.stillNeeded ? `, <b>${plan.stillNeeded} more</b> to reach ${goal}%` : `, which reaches ${goal}%`}. The plan is saved to your account.</p>
            <div class="tx-who-list">${notYet.map(t => txWhoRow(t, true)).join("") || `<p class="sx-empty sx-clear">${icon("checkCircle", 18)} Everyone here has ${need} hours.</p>`}</div>
          </div>
          <div>
            <h4>Have ${need}+ hours · ${have.length}</h4>
            <div class="tx-who-list">${have.map(t => txWhoRow(t, false)).join("") || `<p class="sx-empty">Nobody here yet.</p>`}</div>
          </div>
        </div>
        ${m.missingCredits.length ? `<p class="sx-sub">Not on the credits report, so counted as not met: ${m.missingCredits.map(t => esc(t.name)).join(", ")}.</p>` : ""}
      </section>

      <section class="sx-panel" style="${lit("violet")}">
        <header><h3>Mock Schedule</h3><span>${mock ? mock.year : ""}</span><button type="button" class="sx-link" data-tx-go="mock">Open &rsaquo;</button></header>
        ${mock ? `<div class="tx-mock"><b class="${mock.st.pct >= mock.st.goal ? "ok" : ""}">${tsPct(mock.st.pct)}</b>
            <span>${mock.st.met} of ${mock.st.total} reach ${mock.st.need} hours with the ${mock.courses} class${mock.courses === 1 ? "" : "es"} planned for ${mock.year}.</span></div>
          <p class="sx-sub">${mock.st.short ? `${mock.st.short} more to reach ${Math.round(mock.st.goal * 100)}% in ${mock.year}.` : `That reaches ${Math.round(mock.st.goal * 100)}% in ${mock.year}.`}</p>`
          : `<p class="sx-empty">The Mock Schedule isn't set up yet.</p>`}
      </section>

      <section class="sx-panel" style="${lit("deep")}">
        <header><h3>AGCO Development</h3><button type="button" class="sx-link" data-tx-go="agco">Open &rsaquo;</button></header>
        ${tally && agcoPeople.length ? sxRankHtml([6, 5, 4, 3, 2, 1, 0].map(n => [n ? `Level ${n}` : "Not started", tally[n]]), "")
          + `<p class="sx-sub">The highest level each technician has completed in order.</p>`
          : `<p class="sx-empty">No development maps yet. Upload the AGCO Catalog, then tick courses on AGCO Development.</p>`}
      </section>

      <section class="sx-panel" style="${lit("slate")}">
        <header><h3>Skills</h3><button type="button" class="sx-link" data-tx-go="skillsadmin">Open &rsaquo;</button></header>
        ${skillsError ? `<p class="sx-empty">${esc(skillsError)}</p>` : sxRankHtml(SKILL_LEVELS.map(n =>
          [`Level ${n} · ${competencies.filter(c => c.is_active && c.level === n).length} skills`, levelsDone.filter(x => x.level === n).length]), "")}
        <p class="sx-sub">Technicians who've finished each level. Sign-offs are in the Training Center; the list of skills is edited here.</p>
      </section>
    </div>
  </div>`;
}

$("admin").addEventListener("click", (event) => {
  const drill = event.target.closest("[data-tx-drill]");
  if (drill) {
    const key = drill.dataset.txDrill;
    txDrill = txDrill === key ? null : key;
    renderTrainingOverview();
    const tile = document.querySelector(`.sx-tile[data-tx-drill="${key}"]`);
    if (tile) tile.focus({ preventScroll: true });
    if (txDrill) $("txDrill").scrollIntoView({ block: "nearest", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    return;
  }
  const store = event.target.closest("[data-tx-store]");
  if (store) { txStore = store.dataset.txStore === txStore ? "all" : store.dataset.txStore; return renderTrainingOverview(); }
  const go = event.target.closest("[data-tx-go]");
  if (go) document.querySelector(`#trainingNav [data-tab="${go.dataset.txGo}"]`).click();
});
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape" || !txDrill || !$("txDrill")) return;
  const key = txDrill;
  txDrill = null;
  renderTrainingOverview();
  const tile = document.querySelector(`.sx-tile[data-tx-drill="${key}"]`);
  if (tile) tile.focus();
});
$("admin").addEventListener("change", (event) => {
  if (event.target.id === "txStore") { txStore = event.target.value; renderTrainingOverview(); }
});
