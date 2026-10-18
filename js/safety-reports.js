// Safety Reports
//
// The Safety Report form, the list everyone sees, the Safety Manager's list,
// editing the form, and approving reports.

// ---- the Safety Report (migration 0082) ------------------------------------------
//
// The company's own form, which used to be a Microsoft Form. The questions come
// from the database and only the Safety Manager changes them, on the admin page,
// the way the inspection forms are edited. Where it happened starts at the location
// of whoever's filling it in; their name, email and location are added by the
// database. People pickers list everyone on the All Employees upload. A report
// goes to the Safety Manager by push notification; they get the list, sorted
// and filtered by any question, and each report as a PDF.

let srForm = null, srFormError = null, srReports = [], srEmployees = null;
let srPicked = {}, srPhotos = {}, srSent = false, srNotice = "";
let srSort = "sent", srAscending = false, srFilters = {}, srQuery = "", srStatus = null, openSafetyReportId = null;

const SR_TYPES = [["text", "Short answer"], ["long_text", "Long answer"], ["date", "Date"], ["choice", "Pick one"],
  ["yes_no", "Yes or no"], ["people", "People (from All Employees)"], ["location", "Location (starts at theirs)"], ["photos", "Photos"]];

const isSafetyManager = () => isOwner() && personDesignations.some(pd =>
  pd.person_id === me.id && pd.designation_id === "safety_manager");

// The table gives your own reports, or every one for the Safety Manager; the
// log gives the approved ones everyone reads, without who sent them (0085).
async function loadSafetyReportData() {
  const [form, reports, log, counts] = await Promise.all([
    db.from("safety_report_form").select("*").eq("id", "current").maybeSingle(),
    db.from("safety_reports").select("*").order("created_at", { ascending: false }).limit(1000),
    db.rpc("safety_report_log"),
    db.rpc("safety_report_counts")
  ]);
  // How many each person sent a month, for the people this person looks after
  // (0101): counts only. Before 0101, null, and the Location Dashboard says so.
  srCounts = counts.error ? null : counts.data || [];
  srFormError = form.error ? form.error.message : null;
  srForm = form.data || null;
  const own = reports.data || [], seen = new Set(own.map(r => r.id));
  srReports = own.concat((log.data || []).filter(r => !seen.has(r.id)))
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
}

let srCounts = null;
const srPending = (r) => (r.status || "pending") !== "approved";
// The originals for the Safety Manager and the sender; the shared copies on a
// report from the log, whose answers leave the originals out.
function srPhotoPaths(r) {
  const a = r.answers || {};
  const originals = (r.fields_snapshot || []).filter(f => f.type === "photos").flatMap(f => Array.isArray(a[f.id]) ? a[f.id] : []);
  return originals.length ? originals : (r.shared_photos || []);
}

const srFields = () => ((srForm && srForm.fields) || []).filter(f => f.active !== false);
const srShortKind = (k) => String(k || "").replace(/^[^A-Za-z]+/, "").replace(/\s*\(.*\)\s*$/, "").trim();
const srShop = (id) => (allLocations.find(l => l.id === id) || {}).name || "";

// How an answer reads, for the list, the page and the PDF.
function srDisplay(report, field) {
  const a = (report.answers || {})[field.id];
  if (a === undefined || a === null || a === "") return "";
  if (field.type === "photos") return Array.isArray(a) && a.length ? `${a.length} photo${a.length === 1 ? "" : "s"}` : "";
  if (Array.isArray(a)) return a.join(", ");
  if (typeof a === "boolean") return a ? "Yes" : "No";
  if (field.type === "date") return dateOnly(a).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  return String(a);
}
const srTitle = (r) => (r.answers || {}).title || "Safety report";

// ---- filling one in --------------------------------------------------------------

function safetyFormView() {
  const head = hero("Safety Report", "A near miss, a hazard, an injury, a bright idea or a safety shout-out. It goes to the Safety Manager.");
  if (srFormError) {
    return head + `<div class="srf" style="${lit("ember")}"><div class="srf-card"><b>The form couldn't be loaded</b>
      <p class="srf-help">${/does not exist|schema cache/i.test(srFormError) ? "Migration 0082 hasn't been run yet." : esc(srFormError)}</p></div></div>`;
  }
  if (srSent) {
    srSent = false;    // opening the form again starts a new one
    return head + `<div class="srf" style="${lit("green")}"><div class="srf-card srf-sent">${icon("checkCircle", 44)}
      <b>Sent</b><p>Thanks. The Safety Manager has your report.</p>
      <div class="row" style="justify-content:center"><button type="button" class="srf-quiet" data-sr-act="another">Send another</button>
        <button type="button" class="srf-quiet" data-view="safety">Back to the Safety Center</button></div></div></div>`;
  }
  if (srEmployees === null) {
    srEmployees = [];
    db.rpc("all_employee_names").then(({ data }) => { srEmployees = data || []; });
  }
  const fields = srFields();
  const shop = srShop(profile && profile.location_id);
  return head + `<form class="srf" id="srForm" style="${lit("ember")}" novalidate>
    <div class="srf-card srf-from">${icon("person", 16)}<span>From <b>${esc((profile && profile.full_name) || me.email)}</b>${shop ? ` · ${esc(shop)}` : ""}</span></div>
    ${fields.length ? fields.map(f => srFieldHtml(f, shop)).join("") : `<p class="srf-note">The Safety Report form hasn't been set up yet.</p>`}
    ${fields.length ? `<p class="srf-problem" id="srProblem">${esc(srNotice)}</p>
      <button type="submit" class="srf-submit" id="srSubmit">Send to the Safety Manager</button>` : ""}
  </form>`;
}

function srFieldHtml(f, shop) {
  const id = `srq_${f.id}`;
  const req = f.required ? `<i class="srf-req" aria-label="required">*</i>` : "";
  const label = `<label class="srf-label" for="${id}">${esc(f.label)}${req}</label>${f.help ? `<p class="srf-help">${esc(f.help)}</p>` : ""}`;
  let input = "";
  if (f.type === "text") input = `<input type="text" id="${id}" data-srq="${esc(f.id)}" maxlength="300" autocomplete="off">`;
  else if (f.type === "long_text") input = `<textarea id="${id}" data-srq="${esc(f.id)}" rows="5"></textarea>`;
  else if (f.type === "date") input = `<input type="date" id="${id}" data-srq="${esc(f.id)}" value="${dayKey(new Date())}" max="${dayKey(new Date())}">`;
  else if (f.type === "choice") input = `<div class="srf-choices" role="radiogroup">${(f.options || []).map((o, j) => `<label class="srf-choice">
      <input type="radio" name="${id}" value="${esc(o)}" data-srq="${esc(f.id)}"${j === 0 ? ` id="${id}"` : ""}><span>${esc(o)}</span></label>`).join("")}</div>`;
  else if (f.type === "yes_no") input = `<div class="srf-yesno">${["Yes", "No"].map((o, j) => `<label class="srf-pill">
      <input type="radio" name="${id}" value="${o}" data-srq="${esc(f.id)}"${j === 0 ? ` id="${id}"` : ""}><span>${o}</span></label>`).join("")}</div>`;
  else if (f.type === "location") input = `<select id="${id}" data-srq="${esc(f.id)}">${allLocations.filter(l => l.is_active !== false)
      .map(l => `<option${l.name === shop ? " selected" : ""}>${esc(l.name)}</option>`).join("")}
      <option value="N/A"${shop ? "" : " selected"}>N/A — not at a location</option></select>`;
  else if (f.type === "people") input = `<div class="srf-people" data-srf-people="${esc(f.id)}">
      <div class="srf-chips">${(srPicked[f.id] || []).map(n => `<button type="button" class="srf-chip" data-sr-unpick="${esc(n)}" data-srf="${esc(f.id)}">${esc(n)} ✕</button>`).join("")}</div>
      <input type="search" id="${id}" class="srf-search" data-srf-find="${esc(f.id)}" placeholder="Type a name to add someone" autocomplete="off">
      <div class="srf-matches" data-srf-matches="${esc(f.id)}"></div></div>`;
  else if (f.type === "photos") input = `<div class="srf-photos" data-srf-photos="${esc(f.id)}">
      <div class="srf-thumbs">${(srPhotos[f.id] || []).map((p, j) => `<span class="srf-thumb"><img src="${p.url}" alt=""><button type="button"
        data-sr-unphoto="${j}" data-srf="${esc(f.id)}" aria-label="Remove photo">✕</button></span>`).join("")}</div>
      <label class="srf-quiet srf-file">${icon("camera", 16)} Add photos<input type="file" id="${id}" accept="image/*" multiple data-srf-file="${esc(f.id)}" class="hidden"></label></div>`;
  return `<div class="srf-card" data-srf-field="${esc(f.id)}">${label}${input}</div>`;
}

// A photo shrunk to 1600 pixels on the long side, as the app does, so it sends quickly.
function srShrink(file) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, 1600 / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale); canvas.height = Math.round(img.height * scale);
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(blob => resolve(blob ? { blob, url: URL.createObjectURL(blob) } : null), "image/jpeg", 0.8);
      URL.revokeObjectURL(img.src);
    };
    img.onerror = () => resolve(null);
    img.src = URL.createObjectURL(file);
  });
}

function srRedrawField(fieldId) {
  const card = document.querySelector(`[data-srf-field="${CSS.escape(fieldId)}"]`);
  const f = srFields().find(x => x.id === fieldId);
  if (card && f) card.outerHTML = srFieldHtml(f, srShop(profile && profile.location_id));
}

$("view").addEventListener("input", (event) => {
  const find = event.target.closest("[data-srf-find]");
  if (!find) return;
  const id = find.dataset.srfFind, words = find.value.toLowerCase().split(/\s+/).filter(Boolean);
  const box = document.querySelector(`[data-srf-matches="${CSS.escape(id)}"]`);
  const taken = new Set(srPicked[id] || []);
  const matches = words.length ? (srEmployees || []).filter(p => !taken.has(p.name)
    && words.every(w => `${p.name} ${p.store || ""}`.toLowerCase().includes(w))).slice(0, 8) : [];
  box.innerHTML = matches.map(p => `<button type="button" class="srf-match" data-sr-pick="${esc(p.name)}" data-srf="${esc(id)}">
    <b>${esc(p.name)}</b><span>${esc(p.store || "")}</span></button>`).join("")
    || (words.length ? `<p class="srf-help">${(srEmployees || []).length ? "Nobody by that name on All Employees." : "Loading the names…"}</p>` : "");
});

$("view").addEventListener("change", async (event) => {
  const file = event.target.closest("[data-srf-file]");
  if (!file) return;
  const id = file.dataset.srfFile;
  for (const f of [...file.files].slice(0, 10)) {
    const shrunk = await srShrink(f);
    if (shrunk) (srPhotos[id] = srPhotos[id] || []).push(shrunk);
  }
  srRedrawField(id);
});

$("view").addEventListener("click", (event) => {
  const pick = event.target.closest("[data-sr-pick]");
  if (pick) { const id = pick.dataset.srf; srPicked[id] = [...new Set([...(srPicked[id] || []), pick.dataset.srPick])]; srRedrawField(id);
    const s = document.querySelector(`[data-srf-find="${CSS.escape(id)}"]`); if (s) s.focus(); return; }
  const unpick = event.target.closest("[data-sr-unpick]");
  if (unpick) { const id = unpick.dataset.srf; srPicked[id] = (srPicked[id] || []).filter(n => n !== unpick.dataset.srUnpick); return srRedrawField(id); }
  const unphoto = event.target.closest("[data-sr-unphoto]");
  if (unphoto) { const id = unphoto.dataset.srf; (srPhotos[id] || []).splice(Number(unphoto.dataset.srUnphoto), 1); return srRedrawField(id); }
  const act = event.target.closest("[data-sr-act]");
  if (act && act.dataset.srAct === "another") { srSent = false; srPicked = {}; srPhotos = {}; srNotice = ""; return showView("safetyform"); }
  if (act && act.dataset.srAct === "pdf") return srDownloadPdf(srReports.find(r => r.id === openSafetyReportId));
  if (act && act.dataset.srAct === "review") {
    srrOpenId = openSafetyReportId;
    return showSafety("safetyreports");
  }
  const report = event.target.closest("[data-sr-report]");
  if (report) openSafetyReportId = report.dataset.srReport;
});

$("view").addEventListener("submit", async (event) => {
  if (event.target.id !== "srForm") return;
  event.preventDefault();
  const fields = srFields(), answers = {}, missing = [];
  for (const f of fields) {
    let value = null;
    if (["text", "long_text", "date", "location"].includes(f.type)) {
      value = (document.querySelector(`[data-srq="${CSS.escape(f.id)}"]`) || {}).value;
      value = value ? value.trim() : null;
    } else if (f.type === "choice" || f.type === "yes_no") {
      const on = document.querySelector(`[data-srq="${CSS.escape(f.id)}"]:checked`);
      value = on ? (f.type === "yes_no" ? on.value === "Yes" : on.value) : null;
    } else if (f.type === "people") {
      value = (srPicked[f.id] || []).length ? srPicked[f.id] : null;
    } else if (f.type === "photos") {
      value = (srPhotos[f.id] || []).length ? "photos" : null;
    }
    if (value === null || value === "") { if (f.required) missing.push(f.label); continue; }
    if (f.type !== "photos") answers[f.id] = value;
  }
  const problem = $("srProblem");
  if (missing.length) { problem.textContent = `Still needed: ${missing.map(l => l.replace(/[?.:]+$/, "")).join("; ")}.`; return; }
  const button = $("srSubmit");
  button.disabled = true; button.textContent = "Sending…"; problem.textContent = "";

  const id = crypto.randomUUID();
  for (const f of fields.filter(x => x.type === "photos")) {
    const paths = [];
    for (const p of srPhotos[f.id] || []) {
      const path = `${me.id}/${id}/${crypto.randomUUID()}.jpg`;
      const up = await db.storage.from("safety-report-photos").upload(path, p.blob, { contentType: "image/jpeg" });
      if (up.error) { button.disabled = false; button.textContent = "Send to the Safety Manager";
        problem.textContent = `A photo didn't upload: ${up.error.message}`; return; }
      paths.push(path);
    }
    if (paths.length) answers[f.id] = paths;
  }
  const { error } = await db.from("safety_reports").insert({ id, answers,
    fields_snapshot: fields.map(f => ({ id: f.id, label: f.label, type: f.type })) });
  if (error) {
    button.disabled = false; button.textContent = "Send to the Safety Manager";
    problem.textContent = /row-level/i.test(error.message) ? "Your account isn't allowed to send a report." : error.message;
    return;
  }
  // The Safety Manager is told; the reminder that ticks itself is ticked.
  notify("safety_report", id);
  sharedTasks.filter(t => t.ticked_by === "safety_report").forEach(t => {
    const key = periodKey(t.cadence || "weekly");
    if (!completions.some(c => c.task_id === t.id && c.week_start === key)) completions.push({ task_id: t.id, week_start: key });
  });
  srSent = true; srPicked = {}; srPhotos = {}; srNotice = "";
  await loadSafetyReportData();
  showView("safetyform");
});

// ---- the Safety Manager's list ---------------------------------------------------

function srQuestions() {
  const seen = new Set();
  return srReports.flatMap(r => r.fields_snapshot || []).filter(f => !seen.has(f.id) && seen.add(f.id));
}

function safetyReportListView() {
  const manager = isSafetyManager();
  const head = hero("Safety Reports", manager
    ? "Every report sent, waiting or approved. Sort and filter by any question; approve them on the Safety dashboard."
    : "Reports from across the company, approved by the Safety Manager. Sort and filter by any question.");
  if (!srReports.length) return head + `<div class="srl" style="${lit("ember")}"><p class="srf-note">${manager ? "No reports yet."
    : "No reports have been approved yet. They show here once the Safety Manager approves them."}</p></div>`;
  const qs = srQuestions();
  // Where it happened is left out of approved reports for everyone but the
  // Safety Manager (0086), so it's no use to sort or filter by.
  const sortable = qs.filter(f => !["photos", "long_text", "people"].includes(f.type)
    && (manager || (f.type !== "location" && f.id !== "follow_up")));
  // Whether someone asked to be followed up is between them and the Safety Manager.
  const filterable = qs.filter(f => ["choice", "location", "yes_no"].includes(f.type)
    && (manager || (f.id !== "follow_up" && f.type !== "location")));
  const words = srQuery.toLowerCase().split(/\s+/).filter(Boolean);
  const value = (r) => {
    if (srSort === "sent") return r.created_at;
    const f = qs.find(x => x.id === srSort);
    if (!f) return r.created_at;
    return f.type === "date" ? String((r.answers || {})[f.id] || "") : srDisplay(r, f).toLowerCase();
  };
  const shown = srReports.filter(r => (!srStatus || (srStatus === "waiting") === srPending(r))
    && Object.entries(srFilters).every(([id, v]) => {
      const f = qs.find(x => x.id === id); return !f || srDisplay(r, f) === v; })
    && words.every(w => [r.reporter_name, ...(r.fields_snapshot || []).map(f => srDisplay(r, f))].join(" ").toLowerCase().includes(w)))
    .sort((a, b) => { const x = value(a), y = value(b);
      if (x === y) return b.created_at.localeCompare(a.created_at);
      if (!x) return 1; if (!y) return -1;
      return (srAscending ? 1 : -1) * (x < y ? -1 : 1); });
  const short = (f) => f.id === "kind" ? "Type" : f.id === "where" ? "Where" : f.id === "follow_up" ? "Follow-up" : f.label;
  const isDate = srSort === "sent" || (qs.find(x => x.id === srSort) || {}).type === "date";

  return head + `<div class="srl" style="${lit("ember")}">
    <div class="srl-bar">
      <label class="srl-ctl">Sort by <select id="srSort"><option value="sent"${srSort === "sent" ? " selected" : ""}>Date sent</option>
        ${sortable.map(f => `<option value="${esc(f.id)}"${srSort === f.id ? " selected" : ""}>${esc(f.label)}</option>`).join("")}</select></label>
      ${manager ? `<label class="srl-ctl">Status <select id="srStatus"><option value="">Any</option>
        <option value="waiting"${srStatus === "waiting" ? " selected" : ""}>Waiting for approval</option>
        <option value="approved"${srStatus === "approved" ? " selected" : ""}>Approved</option></select></label>` : ""}
      <label class="srl-ctl"><select id="srOrder"><option value="desc"${srAscending ? "" : " selected"}>${isDate ? "Newest first" : "Z to A"}</option>
        <option value="asc"${srAscending ? " selected" : ""}>${isDate ? "Oldest first" : "A to Z"}</option></select></label>
      ${filterable.map(f => {
        const values = [...new Set(srReports.map(r => srDisplay(r, f)).filter(Boolean))].sort();
        return `<label class="srl-ctl">${esc(short(f))} <select data-sr-filter="${esc(f.id)}"><option value="">Any</option>${values.map(v =>
          `<option value="${esc(v)}"${srFilters[f.id] === v ? " selected" : ""}>${esc(f.id === "kind" ? srShortKind(v) || v : v)}</option>`).join("")}</select></label>`;
      }).join("")}
      <input id="srQuery" class="search" placeholder="Search the reports" value="${esc(srQuery)}">
    </div>
    <div class="group-title">${shown.length === srReports.length ? "Reports" : "Matching"}<span class="srl-count">${shown.length} of ${srReports.length}</span></div>
    <div class="srl-list">${shown.map(r => {
      const a = r.answers || {};
      return `<button type="button" class="cab-card srl-row${srPending(r) ? " follow" : ""}" data-view="safetyreportone" data-sr-report="${esc(r.id)}">
        <span class="srl-tags">${srPending(r) ? `<span class="cab-tag srl-follow">${manager ? "To approve" : "Waiting for approval"}</span>` : ""}${
          a.kind ? `<span class="cab-tag">${esc(srShortKind(a.kind))}</span>` : ""}${
          manager && a.follow_up === true ? `<span class="cab-tag srl-quiet">Follow up</span>` : ""}</span>
        <b>${esc(srTitle(r))}</b>
        <span class="srl-meta">${[a.date ? dateOnly(a.date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "",
          a.where || "", r.reporter_name].filter(Boolean).map(esc).join(" · ")}</span>
      </button>`;
    }).join("") || `<p class="srf-note">${srReports.length ? "Nothing matches. Clear a filter to see more." : "No reports yet."}</p>`}</div>
  </div>`;
}

$("view").addEventListener("change", (event) => {
  const t = event.target;
  if (t.id === "srSort") { srSort = t.value; return showView("safetyreportlist"); }
  if (t.id === "srOrder") { srAscending = t.value === "asc"; return showView("safetyreportlist"); }
  if (t.id === "srStatus") { srStatus = t.value || null; return showView("safetyreportlist"); }
  if (t.dataset.srFilter !== undefined) { if (t.value) srFilters[t.dataset.srFilter] = t.value; else delete srFilters[t.dataset.srFilter]; return showView("safetyreportlist"); }
});
$("view").addEventListener("input", (event) => {
  if (event.target.id !== "srQuery") return;
  srQuery = event.target.value;
  const at = event.target.selectionStart;
  showView("safetyreportlist");
  const q = $("srQuery"); if (q) { q.focus(); q.setSelectionRange(at, at); }
});

function safetyReportOneView() {
  const r = srReports.find(x => x.id === openSafetyReportId);
  if (!r) return hero("Safety Report") + `<div class="srl" style="${lit("ember")}"><p class="srf-note">This report isn't in the list any more.</p></div>`;
  const a = r.answers || {}, shop = srShop(r.reporter_location), manager = isSafetyManager();
  const inHeader = new Set(["kind", "title", "date", "where", "follow_up"]);
  const rest = (r.fields_snapshot || []).filter(f => !inHeader.has(f.id) && f.type !== "photos");
  const photoPaths = srPhotoPaths(r);
  const day = (iso) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  // Who sent it isn't on a report from the log; whether they asked for a
  // follow-up is for the Safety Manager.
  const facts = [
    r.reporter_name ? ["Reported by", [r.reporter_name, manager ? r.reporter_email : ""].filter(Boolean).join(" · ")] : null,
    r.reporter_name ? ["Reporter's location", shop || "—"] : null,
    ["Incident date", a.date ? dateOnly(a.date).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }) : "—"],
    manager || a.where ? ["Where it happened", a.where ? (a.where === "N/A" ? "Not at a location" : a.where) : "—"] : null,
    ["Type of report", a.kind || "—"],
    manager ? ["Follow-up requested", a.follow_up === true ? "Yes — please follow up" : a.follow_up === false ? "No" : "—"] : null,
    manager && !srPending(r) ? ["Approved", [day(r.approved_at), r.approved_by_name].filter(Boolean).join(" by ")] : null
  ].filter(Boolean);
  setTimeout(async () => {
    for (const [i, path] of photoPaths.entries()) {
      const { data } = await db.storage.from("safety-report-photos").createSignedUrl(path, 3600);
      const img = document.querySelector(`[data-sr-photo="${i}"]`);
      if (img && data && data.signedUrl) img.src = data.signedUrl;
    }
  });
  return hero(srTitle(r), [a.kind ? srShortKind(a.kind) : "", `Sent ${new Date(r.created_at).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })}`].filter(Boolean).join(" · "))
    + `<div class="srl srd" style="${lit("ember")}">
    ${srPending(r) ? `<div class="srf-card srd-wait">${icon("clock", 18)}<span>${manager
      ? `Waiting for approval. <button type="button" class="linkish" data-sr-act="review">Edit and approve it on the Safety dashboard</button>; then everyone can read it.`
      : "Waiting for the Safety Manager to approve it. Only you and they can see it until then."}</span></div>` : ""}
    ${manager ? `<div class="srd-acts"><button type="button" data-sr-act="pdf">${icon("doc", 16)}Download the PDF</button><span class="msg"></span></div>` : ""}
    <div class="srf-card srd-facts">
      ${facts.map(([k, v]) => `<div${k === "Follow-up requested" && a.follow_up === true ? ` class="hot"` : ""}><span>${k}</span><b>${esc(v)}</b></div>`).join("")}
    </div>
    ${rest.length ? `<div class="group-title">The report</div>${rest.map(f => {
      const v = srDisplay(r, f);
      return `<div class="srf-card"><span class="srf-label">${esc(f.label)}</span><p class="srd-value${v ? "" : " empty"}">${v ? esc(v).replace(/\n/g, "<br>") : "—"}</p></div>`;
    }).join("")}` : ""}
    ${photoPaths.length ? `<div class="group-title">Photos<span class="srl-count">${photoPaths.length}</span></div>
      <div class="srd-photos">${photoPaths.map((_, i) => `<img data-sr-photo="${i}" alt="Photo ${i + 1}">`).join("")}</div>` : ""}
  </div>`;
}

// The report as a PDF, laid out like the app's. jsPDF's fonts are Latin-1, so
// emoji are left out of the text.
async function srDownloadPdf(r, box = document.querySelector(".srd-acts")) {
  if (!r) return;
  speak(box, "Making the PDF…", false);
  const latin = (s) => String(s ?? "").replace(/[^\x00-\xFF]/g, "").replace(/\s+\n/g, "\n").trim();
  const a = r.answers || {}, shop = srShop(r.reporter_location);
  const doc = new jspdf.jsPDF({ unit: "pt", format: "letter" });
  const W = 612, H = 792, M = 46, CW = W - M * 2;
  const red = [204, 0, 51];
  let y = 0;
  const reference = r.id.slice(0, 8).toUpperCase();
  const sent = new Date(r.created_at).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
  const newPage = () => {
    doc.addPage(); doc.setFillColor(...red); doc.rect(0, 0, W, 6, "F");
    doc.setFont("helvetica", "bold"); doc.setFontSize(8); doc.setTextColor(115);
    doc.text(`AGRI-SERVICE  ·  SAFETY REPORT ${reference}`, M, 26); y = 46;
  };
  const ensure = (h) => { if (y + h > H - M - 16) newPage(); };

  doc.setFillColor(...red); doc.rect(0, 0, W, 70, "F");
  doc.setTextColor(255); doc.setFont("helvetica", "bold"); doc.setFontSize(19); doc.text("AGRI-SERVICE", M, 40);
  doc.setFontSize(9); doc.text("SAFETY REPORT", M, 56);
  doc.setFont("courier", "bold"); doc.setFontSize(10); doc.text(`Report ${reference}`, W - M, 34, { align: "right" });
  doc.setFont("helvetica", "normal"); doc.text(sent, W - M, 50, { align: "right" });
  y = 98;
  doc.setTextColor(...red); doc.setFont("helvetica", "bold"); doc.setFontSize(10);
  doc.text(latin(srShortKind(a.kind) || "Safety report").toUpperCase(), M, y); y += 20;
  doc.setTextColor(30); doc.setFontSize(20);
  const titleLines = doc.splitTextToSize(latin(srTitle(r)), CW);
  doc.text(titleLines, M, y); y += titleLines.length * 24 + 4;

  const facts = [["REPORTED BY", [r.reporter_name, r.reporter_email].filter(Boolean).join("\n")], ["REPORTER'S LOCATION", shop || "-"],
    ["SENT", sent], ["INCIDENT DATE", a.date ? dateOnly(a.date).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }) : "-"],
    ["WHERE IT HAPPENED", a.where ? (a.where === "N/A" ? "Not at a location" : a.where) : "-"],
    ["FOLLOW-UP REQUESTED", a.follow_up === true ? "Yes - please follow up" : a.follow_up === false ? "No" : "-"]];
  const colW = (CW - 10) / 2;
  for (let i = 0; i < facts.length; i += 2) {
    doc.setFontSize(10.5);
    const rows = facts.slice(i, i + 2).map(([k, v]) => [k, doc.splitTextToSize(latin(v), colW - 20)]);
    const h = Math.max(...rows.map(([, l]) => l.length)) * 13 + 30;
    ensure(h + 8);
    rows.forEach(([k, lines], j) => {
      const x = M + j * (colW + 10), hot = k === "FOLLOW-UP REQUESTED" && a.follow_up === true;
      doc.setFillColor(...(hot ? [255, 242, 230] : [246, 246, 246])); doc.roundedRect(x, y, colW, h, 3, 3, "F");
      doc.setFillColor(...(hot ? [217, 115, 26] : red)); doc.rect(x, y, 3, h, "F");
      doc.setFont("helvetica", "bold"); doc.setFontSize(7.5); doc.setTextColor(115); doc.text(k, x + 12, y + 14);
      doc.setFont("helvetica", "normal"); doc.setFontSize(10.5); doc.setTextColor(...(hot ? [153, 64, 0] : [30, 30, 30]));
      doc.text(lines, x + 12, y + 28);
    });
    y += h + 8;
  }
  const answer = (label, value) => {
    ensure(40);
    doc.setFont("helvetica", "bold"); doc.setFontSize(7.5); doc.setTextColor(115); doc.text(latin(label).toUpperCase(), M, y + 6); y += 9;
    doc.setFont("helvetica", "normal"); doc.setFontSize(10.5); doc.setTextColor(30);
    for (const line of doc.splitTextToSize(latin(value) || "-", CW)) { ensure(15); doc.text(line, M, y + 10); y += 14; }
    y += 7; doc.setDrawColor(225); doc.line(M, y, M + CW, y); y += 12;
  };
  y += 8;
  if (a.kind) answer("Type of report", a.kind);
  const inFacts = new Set(["kind", "title", "date", "where", "follow_up"]);
  const rest = (r.fields_snapshot || []).filter(f => !inFacts.has(f.id) && f.type !== "photos");
  const section = (t) => { ensure(44); y += 10; doc.setFont("helvetica", "bold"); doc.setFontSize(11); doc.setTextColor(30);
    doc.text(t.toUpperCase(), M, y + 10); y += 16; doc.setFillColor(...red); doc.rect(M, y, 36, 2, "F"); y += 12; };
  if (rest.length) { section("The report"); rest.forEach(f => answer(f.label, srDisplay(r, f))); }

  const paths = srPhotoPaths(r);
  if (paths.length) {
    const cellW = (CW - 12) / 2, cellH = cellW * 0.75;
    ensure(cellH + 44); section("Photos");
    for (const [i, path] of paths.entries()) {
      if (i % 2 === 0) { if (i > 0) y += cellH + 12; ensure(cellH + 4); }
      const x = M + (i % 2) * (cellW + 12);
      doc.setFillColor(242); doc.rect(x, y, cellW, cellH, "F");
      try {
        const { data } = await db.storage.from("safety-report-photos").download(path);
        const url = await new Promise(res => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(data); });
        const img = await new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = url; });
        const s = Math.min(cellW / img.width, cellH / img.height), w = img.width * s, h = img.height * s;
        doc.addImage(url, "JPEG", x + (cellW - w) / 2, y + (cellH - h) / 2, w, h);
      } catch { /* a photo that can't be fetched is left out */ }
    }
    y += cellH + 12;
  }
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p); doc.setDrawColor(220); doc.line(M, H - M + 2, M + CW, H - M + 2);
    doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(115);
    doc.text("Agri-Service, LLC  ·  Confidential: for safety and leadership use", M, H - M + 14);
    doc.setFont("helvetica", "bold"); doc.text(`Page ${p} of ${pages}`, W - M, H - M + 14, { align: "right" });
  }
  const day = String(r.created_at).slice(0, 10);
  doc.save(`Safety Report ${day} ${latin(srTitle(r)).replace(/[\\/:*?"<>|]/g, "-")}.pdf`);
  speak(box, "Downloaded.", false);
}

// ---- admin: the form, edited like the inspection forms ---------------------------

function renderSafetyReportAdmin() {
  const box = $("srAdmin");
  if (!box) return;
  if (srFormError) {
    box.innerHTML = `<div class="card"><p class="error">${/does not exist|schema cache/i.test(srFormError)
      ? "Run migration 0082_safety_reports.sql in the SQL editor, then reload this page." : esc(srFormError)}</p></div>`;
    return;
  }
  const can = isSafetyManager();
  const fields = (srForm && srForm.fields) || [];
  const dis = can ? "" : " disabled";
  const linked = allSharedTasks.find(t => t.ticked_by === "safety_report");
  box.innerHTML = `
    <div class="card">
      <h2>Safety Report form</h2>
      <p class="note">${can ? "" : "<b>Only the Safety Manager can change this form.</b> "}What everyone fills in from the Safety Center, in the
        app and on the web page. Changes are live as soon as they're saved. Past reports keep the questions they were answered with,
        so renaming, changing or deleting a question never alters an old report. <b>Showing: No</b> stops asking it and can be undone.
        Their name, email and location are added for them; a <b>Location</b> question starts at their own location, and a <b>People</b> question
        picks from the All Employees upload.${srForm && srForm.updated_by_name ? ` Last saved by ${esc(srForm.updated_by_name)},
        ${esc(new Date(srForm.updated_at).toLocaleDateString())}.` : ""}</p>
      ${fields.map((q, i) => `<div class="role" style="padding:14px 16px${q.active === false ? ";opacity:.6" : ""}" data-srquestion="${i}">
        <div class="fields">
          <div class="wide"><label>Question</label><input type="text" data-srqe="label" value="${esc(q.label)}"${dis}></div>
          <div><label>Answer type</label><select data-srqe="type"${dis}>${SR_TYPES.map(([v, l]) =>
            `<option value="${v}"${q.type === v ? " selected" : ""}>${l}</option>`).join("")}</select></div>
          <div><label>Required</label><select data-srqe="required"${dis}>
            <option value="yes"${q.required ? " selected" : ""}>Yes</option><option value="no"${q.required ? "" : " selected"}>No</option></select></div>
          <div><label>Order</label><input type="text" data-srqe="order" value="${(i + 1) * 10}"${dis}></div>
          <div><label>Showing</label><select data-srqe="active"${dis}>
            <option value="yes"${q.active === false ? "" : " selected"}>Yes</option><option value="no"${q.active === false ? " selected" : ""}>No</option></select></div>
          <div class="wide"><label>Hint under the question (optional)</label><input type="text" data-srqe="help" value="${esc(q.help || "")}"${dis}></div>
          <div class="wide"${q.type === "choice" ? "" : " hidden"} data-srqe-options><label>Choices, one per line</label>
            <textarea rows="5" data-srqe="options"${dis}>${esc((q.options || []).join("\n"))}</textarea></div>
        </div>
        ${can ? `<div class="row"><button data-sr-admin="save">Save</button><button class="ghost" data-sr-admin="delete">Delete</button><span class="msg"></span></div>` : ""}
      </div>`).join("") || `<p class="note">No questions yet.</p>`}
      ${can ? `<div class="row" style="margin-top:10px"><button data-sr-admin="add">Add a question</button><span class="msg" id="srAdminMsg"></span></div>` : ""}
    </div>
    <div class="card">
      <h2>The reminder that ticks itself</h2>
      <p class="note">A shared reminder that's ticked for each person when they send a Safety Report in its day, week or month.
        Nobody can tick it by hand; tapping it opens the form.</p>
      <div class="row"><select id="srReminder" style="max-width:360px;margin:0"${dis}><option value="">None</option>${allSharedTasks.map(t =>
        `<option value="${esc(t.id)}"${linked && linked.id === t.id ? " selected" : ""}${t.ticked_by && t.ticked_by !== "safety_report" ? " disabled" : ""}>${esc(t.title)} (${esc(t.cadence || "weekly")})${t.ticked_by === "safety_brief" ? " — the Safety Brief's" : ""}</option>`).join("")}</select>
        ${can ? `<button class="ghost" data-sr-admin="reminder">Save</button>` : ""}<span class="msg"></span></div>
    </div>`;
}

$("admin").addEventListener("change", (event) => {
  if (event.target.matches('[data-srqe="type"]')) {
    event.target.closest("[data-srquestion]").querySelector("[data-srqe-options]").hidden = event.target.value !== "choice";
  }
});

async function srSaveForm(fields, where, message) {
  const { data, error } = await db.from("safety_report_form").upsert({ id: "current", fields }, { onConflict: "id" }).select();
  if (error || !(data || []).length) {
    speak(where, error && !/row-level/i.test(error.message) ? error.message : "Not saved — only the Safety Manager can change this form.", true);
    return false;
  }
  await loadSafetyReportData();
  renderSafetyReportAdmin();
  if (message) { const m = $("srAdminMsg"); if (m) { m.textContent = message; m.className = "msg ok"; } }
  return true;
}

$("admin").addEventListener("click", async (event) => {
  const button = event.target.closest("[data-sr-admin]");
  if (!button) return;
  const act = button.dataset.srAdmin;
  const fields = JSON.parse(JSON.stringify((srForm && srForm.fields) || []));
  if (act === "add") {
    fields.push({ id: "q" + Math.random().toString(36).slice(2, 8), label: "New question", type: "text", options: [], help: "", required: false, active: false });
    return srSaveForm(fields, button.closest(".row"), "Added at the bottom, not showing yet. Fill it in, set Showing to Yes, and save.");
  }
  if (act === "reminder") {
    const row = button.closest(".row"), chosen = $("srReminder").value || null;
    const off = await db.from("weekly_tasks").update({ ticked_by: null }).eq("ticked_by", "safety_report").select("id");
    const on = !off.error && chosen ? await db.from("weekly_tasks").update({ ticked_by: "safety_report" }).eq("id", chosen).select("id") : { data: [] };
    if (off.error || on.error) return speak(row, (off.error || on.error).message, true);
    if (chosen && !(on.data || []).length) return speak(row, "Not saved — only an owner can change reminders.", true);
    [allSharedTasks, sharedTasks].forEach(list => list.forEach(t => {
      if (t.ticked_by === "safety_report") t.ticked_by = null;
      if (t.id === chosen) t.ticked_by = "safety_report";
    }));
    return speak(row, chosen ? "Saved. It ticks itself when someone sends a report." : "Saved. No reminder ticks itself with reports.", false);
  }
  const card = button.closest("[data-srquestion]"), index = Number(card.dataset.srquestion);
  if (act === "delete") {
    if (!confirm("Delete this question? Past reports keep their answers to it. Setting Showing to No instead can be undone.")) return;
    fields.splice(index, 1);
    return srSaveForm(fields, card);
  }
  if (act === "save") {
    const get = (f) => card.querySelector(`[data-srqe="${f}"]`).value.trim();
    if (!get("label")) return speak(card, "The question needs some words.", true);
    const options = uniqueText(get("options").split("\n").map(o => o.trim()).filter(Boolean));
    if (get("type") === "choice" && options.length < 2) return speak(card, "A pick-one question needs at least two choices, one per line.", true);
    if (get("type") === "location" && fields.some((f, i) => i !== index && f.type === "location" && f.active !== false) && get("active") === "yes") {
      return speak(card, "There's already a Location question showing.", true);
    }
    fields[index] = { ...fields[index], label: get("label"), type: get("type"), options: get("type") === "choice" ? options : [],
      help: get("help"), required: get("required") === "yes", active: get("active") === "yes" };
    // Order: the numbers typed, the rest where they were.
    const order = fields.map((f, i) => ({ f, n: i === index ? (parseInt(get("order"), 10) || (i + 1) * 10) : (i + 1) * 10, i }));
    order.sort((x, y) => x.n - y.n || x.i - y.i);
    speak(card, "Saving…", false);
    return srSaveForm(order.map(o => o.f), card, "Saved. It's live in the app and on the web page.");
  }
});

// ---- admin: approving the reports (migration 0085) -------------------------------
//
// A report waits here until a Safety Manager approves it. They can tidy the
// wording first, and pick which photos everyone sees: those are copied under
// approved/<report id>/, because the originals sit under the sender's own id.
// The first edit keeps the sender's own words in original_answers, shown here.
// Approved, it joins the Safety Reports everyone reads, without who sent it.

let srrOpenId = null, srrShowing = "waiting";
// The list's sort: a column's key, and which way.
let srrSort = { key: "sent", asc: false };

// The list's columns: when it was sent, the form's questions with short
// answers (the long ones and photos don't fit a column), who sent it and from
// where, and when it was approved. Each knows what it shows and what it sorts by.
function srrColumns(approvedList) {
  const day = (iso) => iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "";
  const label = { title: "Title", kind: "Type", where: "Where", date: "Incident date", involved: "Employees involved",
    witness: "Witness", follow_up: "Follow-up" };
  const first = ["title", "kind", "where", "date"];
  const qs = srQuestions().filter(f => !["long_text", "photos"].includes(f.type))
    .sort((a, b) => ((first.indexOf(a.id) + 1) || 99) - ((first.indexOf(b.id) + 1) || 99));
  const question = (f) => ({
    key: "q:" + f.id, label: label[f.id] || f.label.replace(/[?:]+$/, ""), wide: f.id === "title",
    show: (r) => f.id === "kind" ? srShortKind((r.answers || {}).kind || "") : srDisplay(r, f),
    // The type sorts by its words, not the emoji in front of them.
    sort: (r) => f.type === "date" ? String((r.answers || {})[f.id] || "")
      : f.id === "kind" ? srShortKind((r.answers || {}).kind || "").toLowerCase() : srDisplay(r, f).toLowerCase()
  });
  const at = qs.findIndex(f => !first.includes(f.id));
  const cols = [{ key: "sent", label: "Sent", show: (r) => day(r.created_at), sort: (r) => r.created_at || "" }];
  qs.slice(0, at < 0 ? qs.length : at).forEach(f => cols.push(question(f)));
  cols.push({ key: "reporter", label: "Reported by", show: (r) => r.reporter_name || "", sort: (r) => (r.reporter_name || "").toLowerCase() },
            { key: "shop", label: "Their location", show: (r) => srShop(r.reporter_location), sort: (r) => srShop(r.reporter_location).toLowerCase() });
  if (at >= 0) qs.slice(at).forEach(f => cols.push(question(f)));
  if (approvedList) cols.push({ key: "approved", label: "Approved",
    show: (r) => [day(r.approved_at), r.approved_by_name].filter(Boolean).join(" · "), sort: (r) => r.approved_at || "" });
  return cols;
}

const SRR_BUCKET = "safety-report-photos";
const srrShared = (r, path) => `approved/${r.id}/${path.split("/").pop()}`;

function renderSafetyReportsAdmin() {
  const box = $("srrAdmin");
  if (!box) return;
  renderSafetyReportStats(); renderSafetyOverview();
  if (srFormError) {
    box.innerHTML = `<div class="card"><p class="error">${/does not exist|schema cache/i.test(srFormError)
      ? "Run migration 0082_safety_reports.sql in the SQL editor, then reload this page." : esc(srFormError)}</p></div>`;
    return;
  }
  if (!isSafetyManager()) {
    box.innerHTML = `<div class="card"><h2>Safety Reports</h2><p class="note">Only a Safety Manager approves reports. Approved
      ones are in the Safety Center for everyone, without who sent them.</p></div>`;
    return;
  }
  const r = srReports.find(x => x.id === srrOpenId);
  if (r) return renderSrrEditor(box, r);
  if (srReports.length && !("status" in srReports[0])) {
    box.innerHTML = `<div class="card"><p class="error">Run migration 0085_safety_report_approval.sql in the SQL editor, then reload
      this page.</p></div>`;
    return;
  }
  const waiting = srReports.filter(srPending), approved = srReports.filter(x => !srPending(x));
  const list = srrShowing === "approved" ? approved : waiting;
  box.innerHTML = `<div class="card">
    <h2>Safety Reports</h2>
    <p class="note">Every report waits here for a Safety Manager. <b>Review</b> one to read it, tidy the wording if it needs it, choose
      which photos to share, and <b>Approve</b>. Approved reports are in the Safety Center for everyone to read, without the
      sender's name, email or location. Their own words are always kept.</p>
    <div class="row srr-tabs">
      <button class="${srrShowing === "waiting" ? "" : "ghost"}" data-srr-show="waiting">Waiting for approval (${waiting.length})</button>
      <button class="${srrShowing === "approved" ? "" : "ghost"}" data-srr-show="approved">Approved (${approved.length})</button>
      <span class="msg"></span>
    </div>
    ${list.length ? (() => {
      const cols = srrColumns(srrShowing === "approved");
      const col = cols.find(c => c.key === srrSort.key) || cols[0];
      // Empty answers go last, whichever way it's sorted; a tie falls back to newest first.
      const rows = list.slice().sort((a, b) => {
        const x = col.sort(a), y = col.sort(b);
        if (x === y) return String(b.created_at).localeCompare(String(a.created_at));
        if (!x) return 1; if (!y) return -1;
        return (srrSort.asc ? 1 : -1) * (x < y ? -1 : 1);
      });
      return `<p class="note" style="margin:0 0 8px">Click a heading to sort by it; click it again to reverse. Click a report to review it.</p>
      <div class="srr-table-wrap"><table class="srr-table">
        <thead><tr><th></th>${cols.map(c => {
          const on = c.key === col.key;
          return `<th aria-sort="${on ? (srrSort.asc ? "ascending" : "descending") : "none"}"><button type="button" class="srr-sort${on ? " on" : ""}"
            data-srr-sort="${esc(c.key)}">${esc(c.label)}<i aria-hidden="true">${on ? (srrSort.asc ? "▲" : "▼") : "↕"}</i></button></th>`;
        }).join("")}</tr></thead>
        <tbody>${rows.map(x => `<tr data-srr-open="${esc(x.id)}" tabindex="0"><td class="srr-acts"><span><button class="pdf" data-srr-open="${esc(x.id)}">Review</button><button
          class="ghost pdf" data-srr-pdf="${esc(x.id)}" title="Download this report as a PDF">PDF</button><span class="msg"></span></span></td>${cols.map(c => {
          const v = c.show(x);
          return `<td class="${c.wide ? "wide" : ""}">${c.key === "q:title" ? `<b>${esc(v || srTitle(x))}</b>${x.edited_at ? ` <span class="badge b-none">Edited</span>` : ""}`
            : c.key === "q:follow_up" && v === "Yes" ? `<span class="badge b-expiring">Yes</span>` : esc(v || "—")}</td>`;
        }).join("")}</tr>`).join("")}</tbody>
      </table></div>`;
    })() : `<p class="note">${srrShowing === "approved" ? "Nothing approved yet." : "Nothing waiting. Every report has been approved."}</p>`}
  </div>`;
}

// One answer, as a box to edit.
function srrInput(r, f) {
  const a = (r.answers || {})[f.id];
  const name = `data-srr-field="${esc(f.id)}"`;
  if (f.type === "long_text") return `<textarea ${name} rows="5">${esc(a ?? "")}</textarea>`;
  if (f.type === "date") return `<input type="date" ${name} value="${esc(a ?? "")}">`;
  if (f.type === "yes_no") return `<select ${name}><option value="">—</option>
    <option value="yes"${a === true ? " selected" : ""}>Yes</option><option value="no"${a === false ? " selected" : ""}>No</option></select>`;
  if (f.type === "people") return `<textarea ${name} rows="3" placeholder="One name per line">${esc(Array.isArray(a) ? a.join("\n") : (a ?? ""))}</textarea>`;
  if (f.type === "choice" || f.type === "location") {
    const options = f.type === "location"
      ? allLocations.map(l => l.name).concat(["N/A"])
      : (((srForm && srForm.fields) || []).find(q => q.id === f.id) || {}).options || [];
    const all = a && !options.includes(a) ? [a, ...options] : options;
    return `<select ${name}><option value="">—</option>${all.map(o =>
      `<option${o === a ? " selected" : ""}>${esc(o)}</option>`).join("")}</select>`;
  }
  return `<input type="text" ${name} value="${esc(a ?? "")}">`;
}

function renderSrrEditor(box, r) {
  const fields = (r.fields_snapshot || []).filter(f => f.type !== "photos");
  const photos = srPhotoPaths(r);
  const original = r.original_answers;
  const sharedNow = new Set(r.shared_photos || []);
  const show = (answers, f) => srDisplay({ ...r, answers }, f);
  box.innerHTML = `<div class="card srr-editor" data-srr-report="${esc(r.id)}">
    <div class="row" style="justify-content:space-between;align-items:flex-start">
      <div><h2 style="margin:0">${esc(srTitle(r))}</h2>
        <p class="note" style="margin:4px 0 0">${srPending(r) ? `<span class="badge b-expiring">Waiting for approval</span>`
          : `<span class="badge b-current">Approved</span> ${esc(new Date(r.approved_at).toLocaleDateString())}${r.approved_by_name ? ` by ${esc(r.approved_by_name)}` : ""}`}
          &nbsp;Sent by <b>${esc(r.reporter_name || "—")}</b>${r.reporter_email ? ` (${esc(r.reporter_email)})` : ""}${
          r.reporter_location ? `, ${esc(srShop(r.reporter_location))}` : ""}, ${esc(new Date(r.created_at).toLocaleString())}.
          Only Safety Managers see who sent it.</p></div>
      <button class="ghost" data-srr-act="back">Back to the list</button>
    </div>
    <div class="fields" style="margin-top:14px">${fields.map(f => `<div class="${["long_text", "people"].includes(f.type) ? "wide" : ""}">
      <label>${esc(f.label)}</label>${srrInput(r, f)}</div>`).join("")}</div>
    ${photos.length ? `<label style="display:block;margin-top:4px">Photos to share with everyone</label>
      <p class="note" style="margin:2px 0 8px">Untick any that show a face, an injury, or anything else that shouldn't be shared. The
        Safety Manager keeps every photo either way.</p>
      <div class="srr-photos">${photos.map((path, i) => `<label class="srr-photo">
        <img data-srr-img="${i}" alt="Photo ${i + 1}">
        <span><input type="checkbox" data-srr-photo="${esc(path)}"${srPending(r) || sharedNow.has(srrShared(r, path)) ? " checked" : ""}> Share</span>
      </label>`).join("")}</div>` : ""}
    ${original ? `<details class="srr-original"><summary>Their own words, before ${esc(r.edited_by_name || "a Safety Manager")} edited it</summary>
      ${fields.map(f => `<p><b>${esc(f.label)}</b><br>${esc(show(original, f) || "—").replace(/\n/g, "<br>")}</p>`).join("")}</details>` : ""}
    <div class="row" style="margin-top:14px">
      ${srPending(r) ? `<button data-srr-act="approve">Approve</button><button class="ghost" data-srr-act="save">Save changes</button>`
        : `<button data-srr-act="save">Save changes</button><button class="ghost" data-srr-act="unapprove">Move back to waiting</button>`}
      <button class="ghost" data-srr-act="delete" style="margin-left:auto">Delete</button><span class="msg"></span>
    </div>
  </div>`;
  setTimeout(async () => {
    for (const [i, path] of photos.entries()) {
      const { data } = await db.storage.from(SRR_BUCKET).createSignedUrl(path, 3600);
      const img = box.querySelector(`[data-srr-img="${i}"]`);
      if (img && data && data.signedUrl) img.src = data.signedUrl;
    }
  });
}

// The edited answers, from the boxes. An answer cleared is taken out.
function srrAnswers(box, r) {
  const answers = { ...(r.answers || {}) };
  for (const f of (r.fields_snapshot || []).filter(x => x.type !== "photos")) {
    const el = box.querySelector(`[data-srr-field="${CSS.escape(f.id)}"]`);
    if (!el) continue;
    let v = el.value.trim();
    if (f.type === "yes_no") v = v === "yes" ? true : v === "no" ? false : null;
    else if (f.type === "people") { v = v.split("\n").map(n => n.trim()).filter(Boolean); if (!v.length) v = null; }
    else if (!v) v = null;
    if (v === null) delete answers[f.id]; else answers[f.id] = v;
  }
  return answers;
}

// Copies the chosen photos where everyone can read them, after clearing out
// the last lot. Returns the copies' paths, or throws.
async function srrSharePhotos(box, r) {
  if ((r.shared_photos || []).length) await db.storage.from(SRR_BUCKET).remove(r.shared_photos);
  const chosen = [...box.querySelectorAll("[data-srr-photo]:checked")].map(c => c.dataset.srrPhoto);
  const copies = [];
  for (const path of chosen) {
    const to = srrShared(r, path);
    const { error } = await db.storage.from(SRR_BUCKET).copy(path, to);
    if (error) throw new Error(`A photo couldn't be shared: ${error.message}`);
    copies.push(to);
  }
  return copies;
}

async function srrSave(button, approve) {
  const box = button.closest("[data-srr-report]"), row = button.closest(".row");
  const r = srReports.find(x => x.id === box.dataset.srrReport);
  if (!r) return;
  const answers = srrAnswers(box, r);
  const required = new Set(((srForm && srForm.fields) || []).filter(f => f.required).map(f => f.id));
  const missing = (r.fields_snapshot || []).filter(f => f.type !== "photos" && required.has(f.id) && answers[f.id] === undefined);
  if (approve && missing.length) return speak(row, `Fill in ${missing.map(f => f.label.replace(/[?.:]+$/, "")).join("; ")} before approving.`, true);
  const goingLive = approve || !srPending(r);
  row.querySelectorAll("button").forEach(b => b.disabled = true);
  speak(row, approve ? "Approving…" : "Saving…", false);
  try {
    const change = { answers };
    if (approve) change.status = "approved";
    if (goingLive) change.shared_photos = await srrSharePhotos(box, r);
    const { data, error } = await db.from("safety_reports").update(change).eq("id", r.id).select("id");
    if (error) throw error;
    if (!(data || []).length) throw new Error("Not saved — only a Safety Manager can change reports.");
  } catch (e) {
    row.querySelectorAll("button").forEach(b => b.disabled = false);
    return speak(row, e.message, true);
  }
  await loadSafetyReportData();
  if (approve) { srrOpenId = null; srrShowing = "waiting"; }
  renderSafetyReportsAdmin();
  if (approve) speak($("srrAdmin").querySelector(".srr-tabs"), "Approved. Everyone can read it in the Safety Center now.", false);
  else speak($("srrAdmin").querySelector("[data-srr-report] .row:last-child"), "Saved.", false);
}

$("admin").addEventListener("click", (event) => {
  const sort = event.target.closest("[data-srr-sort]");
  if (!sort) return;
  const key = sort.dataset.srrSort;
  // Dates start newest first; words start A to Z.
  srrSort = srrSort.key === key ? { key, asc: !srrSort.asc } : { key, asc: !["sent", "approved", "q:date"].includes(key) };
  renderSafetyReportsAdmin();
});
$("admin").addEventListener("keydown", (event) => {
  if (event.key !== "Enter" || !event.target.matches("tr[data-srr-open]")) return;
  srrOpenId = event.target.dataset.srrOpen; renderSafetyReportsAdmin(); window.scrollTo(0, 0);
});

$("admin").addEventListener("click", async (event) => {
  const show = event.target.closest("[data-srr-show]");
  if (show) { srrShowing = show.dataset.srrShow; return renderSafetyReportsAdmin(); }
  const pdf = event.target.closest("[data-srr-pdf]");
  if (pdf) return srDownloadPdf(srReports.find(x => x.id === pdf.dataset.srrPdf), pdf.closest("td"));
  const open = event.target.closest("[data-srr-open]");
  if (open) { srrOpenId = open.dataset.srrOpen; renderSafetyReportsAdmin(); return window.scrollTo(0, 0); }
  const button = event.target.closest("[data-srr-act]");
  if (!button) return;
  const act = button.dataset.srrAct;
  if (act === "back") { srrOpenId = null; return renderSafetyReportsAdmin(); }
  if (act === "approve") return srrSave(button, true);
  if (act === "save") return srrSave(button, false);
  const box = button.closest("[data-srr-report]"), row = button.closest(".row");
  const r = srReports.find(x => x.id === box.dataset.srrReport);
  if (act === "unapprove") {
    const { data, error } = await db.from("safety_reports").update({ status: "pending" }).eq("id", r.id).select("id");
    if (error || !(data || []).length) return speak(row, error ? error.message : "Not saved.", true);
    if ((r.shared_photos || []).length) await db.storage.from(SRR_BUCKET).remove(r.shared_photos);
    await loadSafetyReportData();
    renderSafetyReportsAdmin();
    return speak($("srrAdmin").querySelector("[data-srr-report] .row:last-child"), "Moved back to waiting. Nobody else can see it now.", false);
  }
  if (act === "delete") {
    if (!confirm("Delete this report for good, photos and all? This can't be undone.")) return;
    const { data, error } = await db.from("safety_reports").delete().eq("id", r.id).select("id");
    if (error || !(data || []).length) return speak(row, error ? error.message : "Not deleted — only a Safety Manager can delete reports.", true);
    const files = (r.shared_photos || []).concat(srPhotoPaths(r).filter(p => !p.startsWith("approved/")));
    if (files.length) await db.storage.from(SRR_BUCKET).remove(files);
    srrOpenId = null;
    await loadSafetyReportData();
    renderSafetyReportsAdmin();
  }
});
