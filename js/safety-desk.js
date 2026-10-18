// The Safety Desk
//
// Each month's Safety Brief: reading it, its questions, who's passed, and
// writing the briefs on the admin page.

// ---- the Safety Desk (migration 0080) ---------------------------------------------
//
// A Safety Brief a month: an OSHA document to read and questions about it —
// multiple choice with four answers, or true or false —
// about it, for everyone. Opening a brief starts its reading time on the server,
// and the questions open when it's up; the server marks the answers, and keeps
// the right ones out of reach until someone has passed. Tries are unlimited.
// Results: your own, your location's for an admin, everyone's for an owner —
// the database's rule. Owners write the briefs on the admin page.

let safetyBriefs = [], safetyResults = [], safetyKeys = [], safetyError = null;
let openBriefId = null, safetyReportBrief = null, safetyReportFilter = "notpassed";
let briefReadyAt = null, briefTimer = null, briefPicks = [], briefNotice = "", briefStartProblem = "", briefFor = null;
let sdDraft = null, sdPdfFile = null;

const SAFETY_PAGES = ["safetydesk", "safetybrief", "safetyreport", "safetyform", "safetyreportlist", "safetyreportone"];

async function loadSafetyDesk() {
  const [b, r, k] = await Promise.all([
    db.from("safety_briefs").select("*").order("month", { ascending: false }),
    db.from("safety_brief_results").select("*"),
    db.from("safety_brief_keys").select("*")       // owners only; nothing for anyone else
  ]);
  safetyError = b.error ? b.error.message : null;
  safetyBriefs = b.data || [];
  safetyResults = r.data || [];
  safetyKeys = k.data || [];
}

// This month as the database counts it: Mountain time.
function briefThisMonth() {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "America/Boise",
    year: "numeric", month: "2-digit" }).formatToParts(new Date()).map(p => [p.type, p.value]));
  return `${parts.year}-${parts.month}-01`;
}
const deskBriefs = () => safetyBriefs.filter(b => b.is_published && b.month <= briefThisMonth());
const briefMonthTitle = (b) => dateOnly(b.month).toLocaleDateString("en-US", { month: "long", year: "numeric" });
const briefResult = (b, person) => safetyResults.find(r => r.brief_id === b.id && r.person_id === person);
const briefNeeded = (b) => Math.min(b.pass_mark || 4, (b.questions || []).length);
// True or false is a question whose two answers are True and False.
const sdIsTrueFalse = (q) => q.kind === "truefalse"
  || ((q.choices || []).length === 2 && q.choices[0] === "True" && q.choices[1] === "False");
const briefParagraphs = (b) => (b.body || "").split(/\n\s*\n/).map(s => s.trim()).filter(Boolean);
const briefDay = (iso) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });

function briefStatusTag(r) {
  if (r && r.passed_at) return `<span class="cab-tag sd-ok">Passed</span>`;
  if (r && r.tries) return `<span class="cab-tag sd-warn">Not passed yet</span>`;
  if (r) return `<span class="cab-tag sd-warn">Started</span>`;
  return `<span class="cab-tag sd-due">Not taken</span>`;
}

function safetyDeskView() {
  const head = hero("Safety Desk",
    "This month's Safety Brief, and every one before it. Everyone takes the brief each month: read it, then answer its questions.");
  if (safetyError) {
    return head + `<div class="sd" style="${lit("ember")}"><div class="sd-card sd-note"><b>The Safety Desk couldn't be loaded</b>
      <p>${/does not exist|relation/i.test(safetyError) ? "Migration 0080 hasn't been run yet." : "Try again in a minute."}</p></div></div>`;
  }
  const list = deskBriefs(), month = briefThisMonth();
  const current = list.find(b => b.month === month);
  const past = list.filter(b => b.month < month);
  const passedPast = past.filter(b => (briefResult(b, me.id) || {}).passed_at).length;
  const monthName = dateOnly(month).toLocaleDateString("en-US", { month: "long", year: "numeric" });

  const currentCard = current ? (() => {
    const r = briefResult(current, me.id);
    const n = (current.questions || []).length;
    return `<button type="button" class="cab-card sd-current${r && r.passed_at ? "" : " due"}" data-view="safetybrief" data-brief="${esc(current.id)}">
      <span class="sd-tags">${briefStatusTag(r)}<span class="cab-tag sd-quiet">${n} questions</span></span>
      <b>${esc(current.title)}</b>
      ${current.summary ? `<span class="sd-sum">${esc(current.summary)}</span>` : ""}
      <span class="sd-meta${r && r.passed_at ? " ok" : ""}">${r && r.passed_at
        ? `Passed ${esc(briefDay(r.passed_at))} · ${r.score} of ${n} right`
        : `Read it, then answer ${n} questions. They open ${current.read_minutes} minute${current.read_minutes === 1 ? "" : "s"} after you start.`}</span>
      <span class="sd-go">${r && r.passed_at ? "Look back over it" : r ? "Carry on" : "Start this month's brief"} &rsaquo;</span>
    </button>`;
  })() : `<div class="sd-card sd-note"><b>This month's brief isn't up yet</b>
      <p>The training department puts up a new Safety Brief each month. Check back soon.</p></div>`;

  const report = isAdmin() && list.length ? (() => {
    const b = current || list[0];
    const passed = safetyResults.filter(r => r.brief_id === b.id && r.passed_at).length;
    return `<div class="group-title">Who's taken it</div>
      <button type="button" class="cab-card sd-row" data-view="safetyreport">
        <span class="sd-main"><b>Safety Brief report</b>
          <span class="sd-sum">${esc(briefMonthTitle(b))}: ${passed} passed so far. See who has and hasn't, ${isOwner() ? "everywhere" : "at your location"}.</span></span>
        <span class="sd-chev">&rsaquo;</span></button>`;
  })() : "";

  return head + `<div class="sd" style="${lit("ember")}">
    <div class="group-title">This month<span class="sd-count">${esc(monthName)}</span></div>
    ${currentCard}
    ${report}
    ${past.length ? `<div class="group-title">Your record<span class="sd-count">${passedPast} of ${past.length} passed</span></div>
      <div class="sd-list">${past.map(b => {
        const r = briefResult(b, me.id), d = dateOnly(b.month);
        return `<button type="button" class="cab-card sd-row" data-view="safetybrief" data-brief="${esc(b.id)}">
          <span class="sd-month"><small>${esc(d.toLocaleDateString("en-US", { month: "short" }))}</small><b>${d.getFullYear()}</b></span>
          <span class="sd-main"><b>${esc(b.title)}</b>${briefStatusTag(r)}</span>
          <span class="sd-chev">&rsaquo;</span></button>`;
      }).join("")}</div>` : ""}
    <p class="sd-foot">Tries are unlimited: anyone who doesn't pass reads it again and has another go.</p>
  </div>`;
}

function safetyBriefView() {
  const b = safetyBriefs.find(x => x.id === openBriefId);
  if (!b) {
    return hero("Safety Brief") + `<div class="sd" style="${lit("ember")}"><div class="sd-card sd-note"><b>This brief isn't available</b>
      <p><button type="button" class="ghost" data-view="safetydesk">Back to the Safety Desk</button></p></div></div>`;
  }
  if (briefFor !== b.id) { briefFor = b.id; briefPicks = []; briefNotice = ""; briefStartProblem = ""; briefReadyAt = null; }
  const r = briefResult(b, me.id), n = (b.questions || []).length;
  const passed = r && r.passed_at;
  setTimeout(() => beginBrief(b));

  return hero(b.title, `Safety Brief · ${briefMonthTitle(b)}${b.summary ? ` · ${b.summary}` : ""}`)
    + `<div class="sd sd-brief" style="${lit("ember")}">
      ${passed ? `<div class="sd-card sd-passed">${icon("checkCircle", 26)}<span><b>Passed</b>
        <span>${esc(new Date(r.passed_at).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }))} · ${r.score} of ${n} right${r.tries > 1 ? ` · ${r.tries} tries` : ""}</span></span></div>` : ""}
      ${b.document_path || briefParagraphs(b).length ? `<div class="group-title">Read</div>` : ""}
      ${b.document_path ? `<div class="sd-card sd-doc">
          <div class="sd-doc-head">${icon("doc", 20)}<b>${esc(b.document_name || "The document")}</b>
            <a id="sdPdfLink" class="sd-go" target="_blank" rel="noopener" href="#" aria-disabled="true">Open it in a new tab &nearr;</a></div>
          <iframe id="sdPdf" title="${esc(b.document_name || "Safety Brief document")}"></iframe>
        </div>` : ""}
      ${briefParagraphs(b).length ? `<div class="sd-card sd-body">${briefParagraphs(b).map(p =>
          `<p>${esc(p).replace(/\n/g, "<br>")}</p>`).join("")}</div>` : ""}
      ${passed && Array.isArray(r.picks) && Array.isArray(r.key)
        ? `<div class="group-title">Your answers<span class="sd-count">${r.score} of ${n}</span></div>
           ${(b.questions || []).map((q, i) => `<div class="sd-card sd-review ${r.picks[i] === r.key[i] ? "right" : "wrong"}">
             <b>${i + 1}. ${esc(q.q)}</b>
             <ul>${(q.choices || []).map((c, j) => `<li class="${j === r.key[i] ? "key" : j === r.picks[i] ? "miss" : ""}">
               <i>${j === r.key[i] ? "✓" : j === r.picks[i] ? "✕" : ""}</i>${esc(c)}${j === r.picks[i] ? ` <span class="cab-tag">Yours</span>` : ""}</li>`).join("")}</ul>
           </div>`).join("")}`
        : passed ? "" : `<div class="group-title">Questions<span class="sd-count">${n}</span></div>
           <div class="sd-card sd-questions" id="sdQuestions"></div>`}
    </div>`;
}

// After the page is drawn: the PDF's link, and the reading time.
async function beginBrief(b) {
  if (b.document_path && $("sdPdf")) {
    const { data } = await db.storage.from("safety-briefs").createSignedUrl(b.document_path, 3600);
    if (data && data.signedUrl && $("sdPdf")) {
      $("sdPdf").src = data.signedUrl;
      $("sdPdfLink").href = data.signedUrl;
      $("sdPdfLink").removeAttribute("aria-disabled");
    }
  }
  const r = briefResult(b, me.id);
  if (r && r.passed_at) return;
  renderBriefQuestions();
  if (briefReadyAt === null) {
    const { data, error } = await db.rpc("start_safety_brief", { brief: b.id });
    if (error) {
      briefStartProblem = error.message.includes("available") ? "This brief isn't available."
        : "The questions couldn't be opened. Reload the page and try again.";
    } else {
      briefReadyAt = Date.now() + (data.seconds_left || 0) * 1000;
      if (!briefResult(b, me.id)) await loadSafetyDesk();
    }
  }
  renderBriefQuestions();
  clearInterval(briefTimer);
  briefTimer = setInterval(briefTick, 1000);
}

function briefTick() {
  const left = briefReadyAt === null ? 0 : Math.max(0, Math.ceil((briefReadyAt - Date.now()) / 1000));
  const clock = $("sdClock");
  if (!$("sdQuestions")) { clearInterval(briefTimer); briefTimer = null; return; }
  if (left > 0 && clock) {
    clock.textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;
    const b = safetyBriefs.find(x => x.id === openBriefId);
    const total = Math.max(1, ((b && b.read_minutes) || 3) * 60);
    $("sdRing").style.setProperty("--p", `${(1 - left / total) * 100}%`);
  } else if (left === 0 && clock) {
    clearInterval(briefTimer); briefTimer = null;
    renderBriefQuestions();
  }
}

function renderBriefQuestions() {
  const box = $("sdQuestions");
  const b = safetyBriefs.find(x => x.id === openBriefId);
  if (!box || !b) return;
  const n = (b.questions || []).length;
  const left = briefReadyAt === null ? null : Math.max(0, Math.ceil((briefReadyAt - Date.now()) / 1000));
  const notice = briefNotice ? `<p class="sd-notice">${esc(briefNotice)}</p>` : "";
  if (briefStartProblem) { box.innerHTML = notice + `<p class="sd-sum">${esc(briefStartProblem)}</p>`; return; }
  if (left === null) { box.innerHTML = `<p class="sd-sum">Opening…</p>`; return; }
  if (left > 0) {
    box.innerHTML = notice + `<div class="sd-wait"><span class="sd-ring" id="sdRing"><b id="sdClock"></b></span>
      <span><b>The questions open soon</b><span class="sd-sum">Take the time to read it through. The questions open when the timer
        runs out.</span></span></div>`;
    return briefTick();
  }
  const all = briefPicks.filter(x => x !== undefined && x !== null).length === n;
  box.innerHTML = notice + `<p class="sd-sum">${n} questions. Get ${briefNeeded(b)} right to pass.</p>
    <form id="sdForm">${(b.questions || []).map((q, i) => `<fieldset class="sd-q">
      <legend><small>Question ${i + 1} of ${n}</small>${esc(q.q)}</legend>
      ${(q.choices || []).map((c, j) => `<label class="sd-choice${briefPicks[i] === j ? " on" : ""}">
        <input type="radio" name="sdq${i}" value="${j}" data-sd-q="${i}"${briefPicks[i] === j ? " checked" : ""}>
        <span class="sd-letter">${sdIsTrueFalse(q) ? "TF"[j] : "ABCDEF"[j]}</span><span>${esc(c)}</span></label>`).join("")}
    </fieldset>`).join("")}
      <button type="submit" class="sd-submit" id="sdSubmit"${all ? "" : " disabled"}>${all ? "Hand in my answers" : `Answer all ${n} to hand in`}</button>
      <span class="msg"></span>
    </form>`;
}

$("view").addEventListener("change", (event) => {
  const radio = event.target.closest("[data-sd-q]");
  if (!radio) return;
  const b = safetyBriefs.find(x => x.id === openBriefId);
  briefPicks[Number(radio.dataset.sdQ)] = Number(radio.value);
  radio.closest("fieldset").querySelectorAll(".sd-choice").forEach(l =>
    l.classList.toggle("on", l.querySelector("input").checked));
  const n = (b.questions || []).length, all = briefPicks.filter(x => x !== undefined && x !== null).length === n;
  const button = $("sdSubmit");
  button.disabled = !all;
  button.textContent = all ? "Hand in my answers" : `Answer all ${n} to hand in`;
});

$("view").addEventListener("submit", async (event) => {
  if (event.target.id !== "sdForm") return;
  event.preventDefault();
  const b = safetyBriefs.find(x => x.id === openBriefId);
  const button = $("sdSubmit");
  button.disabled = true;
  button.textContent = "Marking…";
  const { data, error } = await db.rpc("submit_safety_brief", { brief: b.id, picks: briefPicks.slice(0, (b.questions || []).length) });
  if (error) {
    briefNotice = /every question/i.test(error.message) ? "Answer every question." : error.message;
    return renderBriefQuestions();
  }
  if (data.too_soon) {
    briefReadyAt = Date.now() + (data.seconds_left || 60) * 1000;
    briefNotice = "The questions aren't open yet. Keep reading.";
    renderBriefQuestions();
    briefTimer = setInterval(briefTick, 1000);
    return;
  }
  await loadSafetyDesk();
  if (data.passed) {
    // The database ticked the reminder that ticks itself; show it ticked here too.
    sharedTasks.filter(t => t.ticked_by === "safety_brief").forEach(t => {
      if (!completions.some(c => c.task_id === t.id && c.week_start === b.month)) completions.push({ task_id: t.id, week_start: b.month });
    });
    briefNotice = "";
    return showView("safetybrief");
  }
  briefNotice = `${data.score} of ${data.total} right — you need ${data.needed}. Read it through again, then have another go.`;
  renderBriefQuestions();
  $("sdQuestions").scrollIntoView({ behavior: "smooth", block: "start" });
});

function safetyReportView() {
  const list = deskBriefs();
  const head = hero("Safety Brief Report", isOwner() ? "Who has and hasn't taken each month's Safety Brief, everywhere."
    : "Who has and hasn't taken each month's Safety Brief at your location.");
  if (!list.length) return head + `<div class="sd" style="${lit("ember")}"><div class="sd-card sd-note"><b>No Safety Briefs yet</b></div></div>`;
  const b = list.find(x => x.id === safetyReportBrief) || list.find(x => x.month === briefThisMonth()) || list[0];
  const n = (b.questions || []).length;
  // Everyone with an account by the end of that month.
  const end = new Date(dateOnly(b.month)); end.setMonth(end.getMonth() + 1);
  const expected = people.filter(p => !p.deactivated_at && (!p.created_at || new Date(p.created_at) < end));
  const res = (p) => briefResult(b, p.id);
  const passed = expected.filter(p => (res(p) || {}).passed_at);
  const filters = [["notpassed", "Not passed", expected.length - passed.length], ["passed", "Passed", passed.length],
    ["everyone", "Everyone", expected.length]];
  const shown = expected.filter(p => safetyReportFilter === "everyone"
    || (safetyReportFilter === "passed") === !!(res(p) || {}).passed_at);
  const shops = {};
  shown.forEach(p => { const s = locations[p.location_id] || "No location set"; (shops[s] = shops[s] || []).push(p); });
  const share = expected.length ? passed.length / expected.length : 0;
  const line = (r) => !r ? "Not started"
    : r.passed_at ? `Passed ${briefDay(r.passed_at)} · ${r.score} of ${n}`
    : r.tries ? `Not passed yet · ${r.tries} ${r.tries === 1 ? "try" : "tries"}, last ${r.last_score} of ${n}`
    : `Started ${briefDay(r.started_at)}, not answered`;

  return head + `<div class="sd" style="${lit("ember")}">
    <div class="sd-card sd-summary">
      <label for="sdReportMonth" class="sd-label">Month</label>
      <select id="sdReportMonth">${list.map(x => `<option value="${esc(x.id)}"${x.id === b.id ? " selected" : ""}>${esc(briefMonthTitle(x))} · ${esc(x.title)}</option>`).join("")}</select>
      <div class="sd-big"><b>${passed.length}</b><span>of ${expected.length} passed · ${Math.round(share * 100)}%</span></div>
      <div class="sd-meter"><i style="width:${share * 100}%"></i></div>
    </div>
    <div class="cab-pills">${filters.map(([id, label, count]) => `<button type="button" class="cab-pill${safetyReportFilter === id ? " on" : ""}"
      data-sd-filter="${id}">${label}<span>${count}</span></button>`).join("")}</div>
    ${Object.keys(shops).sort().map(shop => `<div class="group-title">${esc(shop)}<span class="sd-count">${shops[shop].length}</span></div>
      <div class="sd-card sd-people">${shops[shop].sort((x, y) => (x.full_name || "").localeCompare(y.full_name || "")).map(p => {
        const r = res(p);
        return `<div class="sd-person"><i class="${r && r.passed_at ? "ok" : r ? "warn" : "due"}"></i>
          <span><b>${esc(p.full_name || p.email || "No name yet")}</b><small>${esc(line(r))}</small></span></div>`;
      }).join("")}</div>`).join("") || `<p class="sd-foot">${safetyReportFilter === "notpassed" ? "Everyone has passed it." : "Nobody to show."}</p>`}
  </div>`;
}

$("view").addEventListener("click", (event) => {
  const pill = event.target.closest("[data-sd-filter]");
  if (pill) { safetyReportFilter = pill.dataset.sdFilter; return showView("safetyreport"); }
});
$("view").addEventListener("change", (event) => {
  if (event.target.id === "sdReportMonth") { safetyReportBrief = event.target.value; showView("safetyreport"); }
});

// ---- admin: writing the briefs -----------------------------------------------------

function sdBlankDraft() {
  const next = new Date(); next.setDate(1); next.setMonth(next.getMonth() + 1);
  return { id: null, month: `${next.getFullYear()}-${pad2(next.getMonth() + 1)}`, title: "", summary: "", body: "",
    document_path: null, document_name: null, read_minutes: 3, pass_mark: 4, is_published: false,
    questions: Array.from({ length: 5 }, () => ({ q: "", kind: "choice", choices: ["", "", "", ""] })), answers: [null, null, null, null, null] };
}

// Who hasn't passed a month's brief yet, by location, with a button that opens an
// email to all of them. Their addresses go in BCC so nobody sees the list;
// the Safety Manager writes the rest. A long list is split into a few emails,
// because mail apps refuse a link past about 2,000 characters.
let sdMissingBrief = null, sdMissingView = "not";

function renderSdMissing() {
  const box = $("sdMissing");
  if (!box) return;
  const list = deskBriefs();
  if (safetyError || !list.length) {
    box.innerHTML = `<h2>Who hasn't passed</h2><p class="note">No Safety Briefs yet.</p>`;
    return;
  }
  const b = list.find(x => x.id === sdMissingBrief) || list.find(x => x.month === briefThisMonth()) || list[0];
  const end = new Date(dateOnly(b.month)); end.setMonth(end.getMonth() + 1);
  const expected = people.filter(p => !p.deactivated_at && (!p.created_at || new Date(p.created_at) < end));
  const shop = (p) => locations[p.location_id] || "No location set";
  const byShop = (x, y) => shop(x).localeCompare(shop(y)) || (x.full_name || x.email || "").localeCompare(y.full_name || y.email || "");
  const missing = expected.filter(p => !(briefResult(b, p.id) || {}).passed_at).sort(byShop);
  const passed = expected.filter(p => (briefResult(b, p.id) || {}).passed_at).sort(byShop);
  const when = (iso) => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
  const emails = [...new Set(missing.map(p => (p.email || "").trim()).filter(e => /@/.test(e)))];
  const noEmail = missing.filter(p => !/@/.test(p.email || "")).length;
  const n = (b.questions || []).length;
  const state = (r) => !r ? "Not started" : r.tries ? `${r.tries} ${r.tries === 1 ? "try" : "tries"}, last ${r.last_score} of ${n}` : "Started, not answered";

  const { html: buttons, split } = bccButtons(emails);

  const toggle = `<div class="chips sd-missing-toggle">
      <button type="button" class="chip${sdMissingView === "not" ? " on" : ""}" data-sd-view="not">Not passed · ${missing.length}</button>
      <button type="button" class="chip${sdMissingView === "passed" ? " on" : ""}" data-sd-view="passed">Passed · ${passed.length}</button></div>`;
  const head = `<h2>Who's taken it</h2>
    <div class="row" style="margin-bottom:10px">
      <select id="sdMissingMonth" style="max-width:360px;margin:0">${list.map(x => `<option value="${esc(x.id)}"${x.id === b.id ? " selected" : ""}>${
        esc(briefMonthTitle(x))} · ${esc(x.title)}</option>`).join("")}</select>
    </div>${toggle}`;

  // Who has passed, and when.
  if (sdMissingView === "passed") {
    box.innerHTML = `${head}
      <p class="sd-missing-sum"><b class="ok">${passed.length}</b> of ${expected.length} have passed ${esc(briefMonthTitle(b))}'s brief${
        passed.length ? "" : ". Nobody yet."}</p>
      ${passed.length ? `<div style="overflow-x:auto"><table class="sd-missing">
        <thead><tr><th>Name</th><th>Location</th><th>Passed</th><th>Score</th><th>Tries</th></tr></thead>
        <tbody>${passed.map(p => { const r = briefResult(b, p.id);
          return `<tr><td><b>${esc(p.full_name || p.email || "No name yet")}</b></td><td>${esc(shop(p))}</td>
            <td>${esc(when(r.passed_at))}</td><td>${r.score ?? "—"} of ${n}</td><td>${r.tries || 1}</td></tr>`; }).join("")}</tbody>
      </table></div>` : ""}`;
    return;
  }

  box.innerHTML = `${head}
    <p class="sd-missing-sum"><b>${missing.length}</b> of ${expected.length} haven't passed ${esc(briefMonthTitle(b))}'s brief${
      missing.length ? "" : ". Everyone has."}</p>
    ${missing.length ? `<div class="row sd-mail-row">${buttons}
        ${emails.length ? `<button type="button" class="ghost" data-sd-copy="${esc(emails.join("; "))}">Copy the addresses</button>` : ""}
        <span class="msg"></span></div>
      <p class="note" style="margin:6px 0 12px">Opens a new email in your mail app with everyone in <b>BCC</b>, so nobody sees the
        others; write the subject and message yourself.${split ? " The list is long, so it's split into a few emails." : ""}${
        noEmail ? ` ${noEmail} ${noEmail === 1 ? "person has" : "people have"} no email on their account and ${noEmail === 1 ? "isn't" : "aren't"} included.` : ""}</p>
      <div style="overflow-x:auto"><table class="sd-missing">
        <thead><tr><th>Name</th><th>Location</th><th>Email</th><th>Where they are</th></tr></thead>
        <tbody>${missing.map(p => `<tr><td><b>${esc(p.full_name || "No name yet")}</b></td><td>${esc(shop(p))}</td>
          <td>${esc(p.email || "—")}</td><td>${esc(state(briefResult(b, p.id)))}</td></tr>`).join("")}</tbody>
      </table></div>` : ""}`;
}

$("admin").addEventListener("change", (event) => {
  if (event.target.id === "sdMissingMonth") { sdMissingBrief = event.target.value; renderSdMissing(); }
});
$("admin").addEventListener("click", (event) => {
  const view = event.target.closest("[data-sd-view]");
  if (view) { sdMissingView = view.dataset.sdView; renderSdMissing(); }
});
$("admin").addEventListener("click", async (event) => {
  const copy = event.target.closest("[data-sd-copy]");
  if (!copy) return;
  try { await navigator.clipboard.writeText(copy.dataset.sdCopy); speak(copy.closest(".row"), "Copied. Paste them into BCC.", false); }
  catch { speak(copy.closest(".row"), "Couldn't copy here. Select the emails in the list instead.", true); }
});

function renderSafetyAdmin() {
  const box = $("sdAdminList");
  if (!box) return;
  renderSdMissing();
  if (safetyError) {
    box.innerHTML = `<h2>Safety Desk</h2><p class="error">Couldn't load the Safety Briefs (${esc(safetyError)}). If that says a
      table doesn't exist, run migration 0080_safety_desk.sql, then reload this page.</p>`;
    return;
  }
  const month = briefThisMonth();
  const monthly = allSharedTasks.filter(t => (t.cadence || "weekly") === "monthly");
  const linked = allSharedTasks.find(t => t.ticked_by === "safety_brief");
  box.innerHTML = `<h2>Safety Desk</h2>
    <p class="note">A Safety Brief a month: an OSHA document to read and questions about it. Everyone sees a
      published brief from the 1st of its month, so next month's can be written ahead. The questions open a few minutes after
      someone starts reading, and tries are unlimited.</p>
    <div class="row"><button data-sd-act="new">New Safety Brief</button><span class="msg"></span></div>
    <div class="sd-admin-list">${safetyBriefs.map(b => {
      const passed = safetyResults.filter(r => r.brief_id === b.id && r.passed_at).length;
      const state = !b.is_published ? `<span class="badge b-none">Draft — nobody sees it</span>`
        : b.month > month ? `<span class="badge b-expiring">Shows from ${esc(dateOnly(b.month).toLocaleDateString("en-US", { month: "long", day: "numeric" }))}</span>`
        : `<span class="badge b-current">Showing</span>`;
      return `<div class="role sd-admin-row"><div><b>${esc(briefMonthTitle(b))}</b> · ${esc(b.title)} ${state}
          <div class="note">${(b.questions || []).length} questions · pass ${briefNeeded(b)} · questions open after ${b.read_minutes} min
            ${b.document_name ? ` · ${esc(b.document_name)}` : ""} · ${passed} passed</div></div>
        <span class="sd-admin-acts"><button class="pdf" data-sd-reuse="${esc(b.id)}" title="Copy it to another month">Reuse</button>
          <button class="pdf" data-sd-edit="${esc(b.id)}">Edit</button></span></div>`;
    }).join("") || `<p class="note">No Safety Briefs yet.</p>`}</div>
    <div class="sd-reminder">
      <label for="sdReminder"><b>The reminder that ticks itself</b></label>
      <p class="note" style="margin:2px 0 8px">A monthly shared reminder that's ticked for each person when they pass that month's
        brief. Nobody can tick it by hand; tapping it opens this month's brief.</p>
      <div class="row"><select id="sdReminder" style="max-width:360px;margin:0"><option value="">None</option>${monthly.map(t =>
        `<option value="${esc(t.id)}"${linked && linked.id === t.id ? " selected" : ""}${t.ticked_by === "safety_report" ? " disabled" : ""}>${esc(t.title)}${t.is_active === false ? " (switched off)" : ""}${t.ticked_by === "safety_report" ? " — the Safety Report's" : ""}</option>`).join("")}</select>
        <button class="ghost" data-sd-act="reminder">Save</button><span class="msg"></span></div>
    </div>`;
  renderSdEditor();
}

// A reused brief shares its PDF, so a file only goes once no other brief uses it.
const sdPdfInUse = (path, exceptId) => safetyBriefs.some(b => b.id !== exceptId && b.document_path === path);

// The first month from next month on with no brief yet, for a reused one.
function sdNextFreeMonth() {
  const taken = new Set(safetyBriefs.map(b => b.month.slice(0, 7)));
  const d = dateOnly(briefThisMonth());
  for (let i = 1; i <= 48; i++) {
    const m = new Date(d.getFullYear(), d.getMonth() + i, 1);
    const key = `${m.getFullYear()}-${pad2(m.getMonth() + 1)}`;
    if (!taken.has(key)) return key;
  }
  return briefThisMonth().slice(0, 7);
}

function renderSdEditor() {
  const box = $("sdEditor");
  if (!box) return;
  box.classList.toggle("hidden", !sdDraft);
  if (!sdDraft) { box.innerHTML = ""; return; }
  const d = sdDraft;
  box.innerHTML = `<h2>${d.id ? "Edit the Safety Brief" : d.reusedFrom ? "Reuse a Safety Brief" : "New Safety Brief"}</h2>
    ${d.reusedFrom ? `<p class="note" style="margin:-4px 0 12px">A copy of the ${esc(d.reusedFrom)} brief, with its reading and
      questions. Pick the month it's for and change anything you like. Everyone takes it fresh; who passed in ${esc(d.reusedFrom)}
      stays with that one. It starts as a draft.</p>` : ""}
    <div class="fields">
      <div><label for="sdMonth">Month</label><input id="sdMonth" type="month" data-sdf="month" value="${esc(d.month)}"></div>
      <div><label for="sdPublished">Showing</label><select id="sdPublished" data-sdf="is_published">
        <option value="no"${d.is_published ? "" : " selected"}>No — keep as a draft</option>
        <option value="yes"${d.is_published ? " selected" : ""}>Yes, from the 1st of its month</option></select></div>
      <div class="wide"><label for="sdTitle">Title</label><input id="sdTitle" type="text" maxlength="160" data-sdf="title"
        value="${esc(d.title)}" placeholder="Hearing Conservation in the Shop"></div>
      <div class="wide"><label for="sdSummary">One line about it (optional)</label><input id="sdSummary" type="text" maxlength="400"
        data-sdf="summary" value="${esc(d.summary || "")}"></div>
      <div class="wide"><label>The OSHA document (PDF)</label>
        <div class="row" style="margin:0">${d.document_name ? `<span>${esc(d.document_name)}</span>
            <button type="button" class="pdf" data-sd-act="remove-pdf">Remove</button>` : `<span class="note">None yet</span>`}
          <label class="pdf sd-file">${d.document_name ? "Replace" : "Choose a PDF"}<input type="file" accept="application/pdf" id="sdPdfFile" class="hidden"></label>
          ${sdPdfFile ? `<span class="note">New: ${esc(sdPdfFile.name)} — saved with the brief</span>` : ""}</div></div>
      <div class="wide"><label for="sdBody">Text to read (optional, with or instead of the PDF)</label>
        <textarea id="sdBody" rows="6" data-sdf="body" placeholder="Leave a blank line between paragraphs.">${esc(d.body || "")}</textarea></div>
      <div><label for="sdRead">Questions open after (minutes)</label><input id="sdRead" type="number" min="0" max="30" data-sdf="read_minutes" value="${d.read_minutes}"></div>
      <div><label for="sdPass">Right answers to pass</label><input id="sdPass" type="number" min="1" max="10" data-sdf="pass_mark" value="${d.pass_mark}"></div>
    </div>
    <h3 style="margin:18px 0 6px">Questions</h3>
    <p class="note" style="margin:0 0 10px">Multiple choice with four answers, or true or false. Pick the right answer with its
      circle.</p>
    ${d.questions.map((q, i) => `<div class="role sd-q-edit">
      <div class="row" style="margin:0 0 6px"><b>Question ${i + 1}</b>
        <select data-sdk="${i}" aria-label="Kind of question" style="width:auto;margin:0">
          <option value="choice"${q.kind === "truefalse" ? "" : " selected"}>Multiple choice</option>
          <option value="truefalse"${q.kind === "truefalse" ? " selected" : ""}>True or false</option></select>
        ${d.questions.length > 1 ? `<button type="button" class="pdf" style="margin-left:auto" data-sd-remove-q="${i}">Remove</button>` : ""}</div>
      <input type="text" maxlength="400" data-sdq="${i}" value="${esc(q.q)}" placeholder="${q.kind === "truefalse"
        ? "A statement that's true or false" : "The question"}">
      ${q.kind === "truefalse" ? `<div class="sd-tf-edit">${["True", "False"].map((c, j) => `<label class="check">
          <input type="radio" name="sdAnswer${i}" data-sda="${i}" value="${j}"${d.answers[i] === j ? " checked" : ""}> ${c} is right</label>`).join("")}</div>`
      : q.choices.map((c, j) => `<div class="sd-choice-edit">
        <input type="radio" name="sdAnswer${i}" data-sda="${i}" value="${j}" aria-label="Answer ${"ABCD"[j]} is right"${d.answers[i] === j ? " checked" : ""}>
        <span>${"ABCD"[j]}</span>
        <input type="text" maxlength="300" data-sdc="${i}:${j}" value="${esc(c)}" placeholder="Answer ${"ABCD"[j]}"></div>`).join("")}
    </div>`).join("")}
    ${d.questions.length < 10 ? `<button type="button" class="ghost" data-sd-act="add-q">Add a question</button>` : ""}
    <div class="row" style="margin-top:16px"><button data-sd-act="save">${d.id ? "Save changes" : "Save the brief"}</button>
      <button class="ghost" data-sd-act="cancel">Cancel</button>
      ${d.id ? `<button class="ghost" data-sd-act="delete" style="margin-left:auto">Delete</button>` : ""}
      <span class="msg"></span></div>`;
}

$("admin").addEventListener("input", (event) => {
  if (!sdDraft || !$("sdEditor") || !$("sdEditor").contains(event.target)) return;
  const t = event.target;
  if (t.dataset.sdf) {
    const f = t.dataset.sdf;
    sdDraft[f] = f === "read_minutes" || f === "pass_mark" ? Number(t.value) : f === "is_published" ? t.value === "yes" : t.value;
  } else if (t.dataset.sdq !== undefined) {
    sdDraft.questions[Number(t.dataset.sdq)].q = t.value;
  } else if (t.dataset.sdc) {
    const [i, j] = t.dataset.sdc.split(":").map(Number);
    sdDraft.questions[i].choices[j] = t.value;
  }
});

$("admin").addEventListener("change", (event) => {
  if (!sdDraft || !$("sdEditor") || !$("sdEditor").contains(event.target)) return;
  const t = event.target;
  if (t.dataset.sda !== undefined) sdDraft.answers[Number(t.dataset.sda)] = Number(t.value);
  // Switching kind: true or false has its two answers fixed; multiple choice
  // gets back whatever four answers it had.
  if (t.dataset.sdk !== undefined) {
    const i = Number(t.dataset.sdk), q = sdDraft.questions[i];
    if (t.value === "truefalse" && q.kind !== "truefalse") {
      q.saved = q.choices; q.kind = "truefalse"; q.choices = ["True", "False"];
      if (sdDraft.answers[i] > 1) sdDraft.answers[i] = null;
    } else if (t.value === "choice" && q.kind === "truefalse") {
      q.kind = "choice"; q.choices = q.saved || ["", "", "", ""]; sdDraft.answers[i] = null;
    }
    return renderSdEditor();
  }
  if (t.dataset.sdf === "is_published") sdDraft.is_published = t.value === "yes";
  if (t.id === "sdPdfFile" && t.files[0]) {
    if (t.files[0].type !== "application/pdf") return speak($("sdEditor"), "That isn't a PDF.", true);
    sdPdfFile = t.files[0];
    renderSdEditor();
  }
});

$("admin").addEventListener("click", async (event) => {
  // Edit a brief, or reuse it: the same reading and questions, copied to another
  // month as a draft. Everyone takes the copy fresh; the old month's results
  // stay with the old brief. The copy shares the PDF file.
  const edit = event.target.closest("[data-sd-edit], [data-sd-reuse]");
  if (edit) {
    const reuse = edit.dataset.sdReuse !== undefined;
    const b = safetyBriefs.find(x => x.id === (reuse ? edit.dataset.sdReuse : edit.dataset.sdEdit));
    const key = (safetyKeys.find(k => k.brief_id === b.id) || {}).answers || [];
    sdPdfFile = null;
    sdDraft = { ...JSON.parse(JSON.stringify(b)), month: b.month.slice(0, 7),
      questions: (b.questions || []).map(q => sdIsTrueFalse(q)
        ? { q: q.q || "", kind: "truefalse", choices: ["True", "False"] }
        : { q: q.q || "", kind: "choice", choices: [0, 1, 2, 3].map(j => (q.choices || [])[j] || "") }),
      answers: (b.questions || []).map((_, i) => key[i] ?? null) };
    if (reuse) Object.assign(sdDraft, { id: null, month: sdNextFreeMonth(), is_published: false, reusedFrom: briefMonthTitle(b) });
    renderSdEditor();
    return $("sdEditor").scrollIntoView({ behavior: "smooth", block: "start" });
  }
  const removeQ = event.target.closest("[data-sd-remove-q]");
  if (removeQ && sdDraft) {
    const i = Number(removeQ.dataset.sdRemoveQ);
    sdDraft.questions.splice(i, 1); sdDraft.answers.splice(i, 1);
    return renderSdEditor();
  }
  const button = event.target.closest("[data-sd-act]");
  if (!button) return;
  const act = button.dataset.sdAct;
  if (act === "new") {
    sdDraft = sdBlankDraft(); sdPdfFile = null; renderSdEditor();
    return $("sdEditor").scrollIntoView({ behavior: "smooth", block: "start" });
  }
  if (act === "cancel") { sdDraft = null; sdPdfFile = null; return renderSdEditor(); }
  if (act === "add-q") { sdDraft.questions.push({ q: "", kind: "choice", choices: ["", "", "", ""] }); sdDraft.answers.push(null); return renderSdEditor(); }
  if (act === "remove-pdf") { sdDraft.document_path = null; sdDraft.document_name = null; sdPdfFile = null; return renderSdEditor(); }
  if (act === "reminder") return saveSdReminder(button);
  if (act === "delete") return deleteSdBrief();
  if (act === "save") return saveSdBrief(button);
});

async function saveSdReminder(button) {
  const card = button.closest(".sd-reminder");
  const chosen = $("sdReminder").value || null;
  button.disabled = true;
  const off = await db.from("weekly_tasks").update({ ticked_by: null }).eq("ticked_by", "safety_brief").select("id");
  const on = !off.error && chosen ? await db.from("weekly_tasks").update({ ticked_by: "safety_brief" }).eq("id", chosen).select("id") : { data: [] };
  button.disabled = false;
  const error = off.error || on.error;
  if (error) return speak(card, error.message, true);
  if (chosen && !(on.data || []).length) return speak(card, "Not saved — only an owner can change reminders.", true);
  [allSharedTasks, sharedTasks].forEach(list => list.forEach(t => {
    if (t.ticked_by === "safety_brief") t.ticked_by = null;
    if (t.id === chosen) t.ticked_by = "safety_brief";
  }));
  speak(card, chosen ? "Saved. It now ticks itself when someone passes that month's brief." : "Saved. No reminder ticks itself.", false);
}

async function saveSdBrief(button) {
  const box = $("sdEditor"), d = sdDraft;
  const problem = !/^\d{4}-\d{2}$/.test(d.month || "") ? "Pick the month it's for."
    : !d.title.trim() ? "The brief needs a title."
    : !d.questions.length ? "Add at least one question."
    : d.questions.some(q => !q.q.trim()) ? "Every question needs its wording."
    : d.questions.some(q => q.kind !== "truefalse" && q.choices.some(c => !c.trim())) ? "Every multiple-choice question needs all four answers."
    : d.answers.some(a => a === null || a === undefined) ? "Pick the right answer for every question."
    : d.is_published && !d.document_path && !sdPdfFile && !(d.body || "").trim() ? "Add the PDF or some text to read before it shows."
    : !(d.read_minutes >= 0 && d.read_minutes <= 30) ? "The reading time has to be between 0 and 30 minutes."
    : !(d.pass_mark >= 1 && d.pass_mark <= 10) ? "Right answers to pass has to be between 1 and 10."
    : null;
  if (problem) return speak(box, problem, true);
  button.disabled = true;
  speak(box, "Saving…", false);

  let path = d.document_path, name = d.document_name;
  const before = d.id ? (safetyBriefs.find(b => b.id === d.id) || {}).document_path : null;
  if (sdPdfFile) {
    path = `${crypto.randomUUID()}.pdf`;
    name = sdPdfFile.name;
    const up = await db.storage.from("safety-briefs").upload(path, sdPdfFile, { contentType: "application/pdf" });
    if (up.error) { button.disabled = false; return speak(box, `The PDF didn't upload: ${up.error.message}`, true); }
  }
  const row = { month: `${d.month}-01`, title: d.title.trim(), summary: (d.summary || "").trim() || null,
    body: (d.body || "").trim() || null, document_path: path || null, document_name: path ? name : null,
    read_minutes: d.read_minutes, pass_mark: d.pass_mark, is_published: !!d.is_published,
    questions: d.questions.map(q => q.kind === "truefalse"
      ? { q: q.q.trim(), kind: "truefalse", choices: ["True", "False"] }
      : { q: q.q.trim(), kind: "choice", choices: q.choices.map(c => c.trim()) }) };
  const saved = d.id ? await db.from("safety_briefs").update(row).eq("id", d.id).select("id")
    : await db.from("safety_briefs").insert(row).select("id");
  if (saved.error || !(saved.data || []).length) {
    button.disabled = false;
    const msg = saved.error && /duplicate|unique/i.test(saved.error.message)
      ? `There's already a Safety Brief for ${dateOnly(row.month).toLocaleDateString("en-US", { month: "long", year: "numeric" })}.`
      : saved.error ? saved.error.message : "Not saved — only an owner can write Safety Briefs.";
    return speak(box, msg, true);
  }
  const id = saved.data[0].id;
  const key = await db.from("safety_brief_keys").upsert({ brief_id: id, answers: d.answers }, { onConflict: "brief_id" });
  if (key.error) { button.disabled = false; return speak(box, `The brief saved, but its answers didn't: ${key.error.message}`, true); }
  if (before && before !== path && !sdPdfInUse(before, d.id)) await db.storage.from("safety-briefs").remove([before]);
  sdDraft = null; sdPdfFile = null;
  await loadSafetyDesk();
  renderSafetyAdmin();
  speak($("sdAdminList"), "Saved.", false);
}

async function deleteSdBrief() {
  const d = sdDraft, b = safetyBriefs.find(x => x.id === d.id);
  const passed = safetyResults.filter(r => r.brief_id === d.id && r.passed_at).length;
  if (!confirm(`Delete the ${briefMonthTitle(b)} Safety Brief?${passed ? ` ${passed} people's results for it go too.` : ""}`)) return;
  const { data, error } = await db.from("safety_briefs").delete().eq("id", d.id).select("id");
  if (error || !(data || []).length) return speak($("sdEditor"), error ? error.message : "Not deleted — only an owner can.", true);
  if (b.document_path && !sdPdfInUse(b.document_path, b.id)) await db.storage.from("safety-briefs").remove([b.document_path]);
  sdDraft = null;
  await loadSafetyDesk();
  renderSafetyAdmin();
}
