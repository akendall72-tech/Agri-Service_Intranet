// HR
//
// The HR page, the payroll calendar and Who Does What, their uploads, and
// the employee handbook.

// ---- HR: the payroll calendar and the employee handbook -------------------------------
//
// The handbook is a PDF an owner uploads on the admin page (migration 0046).
// Opening it here hands the browser the PDF, which brings its own search.

let companyDocs = [], companyDocsError = null, handbookURL = null;

async function loadCompanyDocs() {
  const { data, error } = await db.from("company_documents")
    .select("id, title, summary, file_path, file_size, updated_at");
  companyDocsError = error ? error.message : null;
  companyDocs = data || [];
  handbookURL = null;
  const handbook = companyDocs.find(d => d.id === "handbook");
  if (handbook) {
    const { data: signed } = await db.storage.from("company-docs")
      .createSignedUrl(handbook.file_path, 3600);
    handbookURL = signed ? signed.signedUrl : null;
  }
}

function hrView() {
  const handbook = companyDocs.find(d => d.id === "handbook");
  const updated = handbook && handbook.updated_at
    ? `Updated ${new Date(handbook.updated_at).toLocaleDateString()}` : "";
  return hero("HR", "Your pay calendar and the employee handbook.") + linkGrid(
      `<button type="button" class="link-card" data-view="payroll"
        style="width:100%;text-align:left;font:inherit;color:inherit;cursor:pointer">
        <span class="well red">${icon("calendar")}</span>
        <span><b>Payroll Calendar</b><span>Days until payday, every pay period, and the paid holidays.</span>
          <span class="go">Open the calendar &rarr;</span></span></button>`
    + (handbook && handbookURL
      ? `<a class="link-card" href="${esc(handbookURL)}" target="_blank" rel="noopener">
          <span class="well green">${icon("doc")}</span>
          <span><b>${esc(handbook.title || "Employee Handbook")}</b>
            <span>${esc([handbook.summary, updated, fileSize(handbook.file_size)].filter(Boolean).join(" · "))}</span>
            <span class="go">Open the handbook &nearr;</span></span></a>`
      : `<div class="card"><b>Employee Handbook</b><p class="note" style="margin-bottom:0">${
          companyDocsError && /does not exist|schema cache/i.test(companyDocsError)
            ? "Not switched on yet."
            : "Not uploaded yet. An owner adds it on the admin page."}</p></div>`)
    + `<button type="button" class="link-card" data-inv-open=""
        style="width:100%;text-align:left;font:inherit;color:inherit;cursor:pointer;${lit("teal")}">
        <span class="well">${icon("box")}</span>
        <span><b>Personal Inventory</b><span>${isAdmin()
          ? "Your tools and equipment and what they're worth, and the lists of the people you look after."
          : "Your tools and equipment, on the truck or in the shop, and what they're worth."}</span>
          <span class="go">Open the inventory &rarr;</span></span></button>`);
}

function payrollView() {
  const head = hero("Payroll Calendar", "Paydays, the periods they cover, and paid holidays.");
  if (!payroll.length) return head + comingSoon("The payroll calendar hasn't been uploaded yet.");

  const today = todayISO();
  const upcoming = payroll.filter(p => p.payday && p.payday >= today);
  const past = payroll.filter(p => !p.payday || p.payday < today);
  const next = upcoming[0];
  const days = next ? Math.round((new Date(next.payday + "T00:00:00") - new Date(today + "T00:00:00")) / 86400000) : 0;
  const row = (p) => `<tr><td>${esc(p.number)}</td><td><b>${fmtDate(p.payday)}</b></td>
    <td>${fmtDate(p.period_start)} – ${fmtDate(p.period_end)}</td><td>${esc(p.holiday || "")}</td></tr>`;
  const table = (rows) => `<div style="overflow-x:auto"><table>
    <thead><tr><th>#</th><th>Payday</th><th>Pay period</th><th>Paid holiday</th></tr></thead>
    <tbody>${rows.map(row).join("")}</tbody></table></div>`;

  return head
    + (next ? `<div class="payday-card"><small>Next payday</small>
        <strong>${new Date(next.payday + "T00:00:00").toLocaleDateString(undefined,
          { weekday: "long", month: "long", day: "numeric" })}</strong>
        <span>${days === 0 ? "Today" : days === 1 ? "Tomorrow" : `In ${days} days`} · covers
          ${fmtDate(next.period_start)} – ${fmtDate(next.period_end)}</span></div>` : "")
    + `<div class="card"><h2>Upcoming paydays</h2>${upcoming.length ? table(upcoming)
        : `<p class="note">No more paydays on this calendar.</p>`}</div>`
    + (holidays.length ? `<div class="card"><h2>Paid holidays</h2><div style="overflow-x:auto"><table>
        <tbody>${holidays.map(h => `<tr><td>${esc(h.name)}</td>
          <td style="text-align:right;color:var(--muted)">${esc(h.hours || "")}</td></tr>`).join("")}</tbody>
        </table></div></div>` : "")
    + (past.length ? `<details class="ticket"><summary><b>Past paydays</b>
        <span class="note"> · ${past.length}</span></summary><div class="inner">${table(past.reverse())}</div></details>` : "");
}

function directoryView() {
  const head = hero("Who Does What", "Who to call for what, company-wide.");
  if (!directory.length) return head + comingSoon("The directory hasn't been uploaded yet.");

  const contact = (name, phone) => {
    const n = (name || "").trim(), p = (phone || "").trim();
    if (!n && !p) return `<span class="note">—</span>`;
    const email = n.includes("@") ? n : (p.includes("@") ? p : "");
    const digits = p.replace(/\D/g, "");
    return `<b>${esc(n)}</b>${email ? `<br><a href="mailto:${esc(email)}">Email</a>`
      : digits ? `<br><a href="tel:${esc(digits)}">${esc(p)}</a>` : ""}`;
  };

  return head + `<div class="card">
    <div class="row" style="margin-bottom:14px">
      <input class="search" id="dirSearch" placeholder="Search a topic or name…">
      <span class="note" id="dirCount">${directory.length} topics</span>
    </div>
    <div style="overflow-x:auto"><table id="dirTable">
      <thead><tr><th>Topic</th><th>Contact</th><th>Also</th></tr></thead>
      <tbody>${directory.map(d => `<tr data-dir="${esc(`${d.topic} ${d.contact1 || ""} ${d.contact2 || ""}`.toLowerCase())}">
        <td><b>${esc(d.topic)}</b></td>
        <td>${contact(d.contact1, d.phone1)}</td>
        <td>${contact(d.contact2, d.phone2)}</td></tr>`).join("")}</tbody>
    </table></div></div>`;
}

$("view").addEventListener("input", (event) => {
  if (event.target.id !== "dirSearch") return;
  const q = event.target.value.trim().toLowerCase();
  let shown = 0;
  document.querySelectorAll("#dirTable tbody tr").forEach(tr => {
    const show = !q || tr.dataset.dir.includes(q);
    tr.hidden = !show;
    if (show) shown++;
  });
  $("dirCount").textContent = `${shown} of ${directory.length} topics`;
});

// ---------------------------------------------------------------- payroll & directory

// Both files arrive as a spreadsheet. Reading them into rows-of-cells here
// means the two importers below don't care which format was dropped.
async function rowsFromFile(file) {
  if (/\.csv$/i.test(file.name) || file.type === "text/csv") {
    return parseCSV(await file.text());
  }
  const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  // raw:true keeps dates as Excel serial numbers, which excelDate below turns
  // into real dates. Letting SheetJS format them gives locale-dependent text.
  return XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: "" });
}

// Excel counts days from 1899-12-30 — the offset that absorbs its 1900
// leap-year bug. Anything outside a sane range isn't a date.
function excelDate(value) {
  const serial = typeof value === "number" ? value : parseFloat(value);
  if (!isFinite(serial) || serial < 30000 || serial > 60000) return null;
  const ms = Date.UTC(1899, 11, 30) + Math.round(serial) * 86400000;
  return new Date(ms).toISOString().slice(0, 10);
}

const cell = (row, index) => String((row && row[index]) ?? "").trim();

async function importPayroll(file) {
  const result = $("payrollResult");
  const say = (html, cls) => { result.innerHTML = `<p class="${cls}">${html}</p>`; };

  let rows;
  try { rows = await rowsFromFile(file); }
  catch (e) { return say(`Couldn't read that file: ${esc(e.message)}`, "error"); }

  const headerIndex = rows.findIndex(r =>
    (r || []).some(c => String(c).trim().toLowerCase() === "payroll #"));
  if (headerIndex === -1) {
    return say("No <b>Payroll #</b> header found in that sheet.", "error");
  }

  const header = rows[headerIndex].map(c => String(c).trim().toLowerCase());
  const at = (name) => header.indexOf(name);
  const columns = {
    number: at("payroll #"),
    start: at("pay period start"),
    end: at("pay period end"),
    holiday: at("paid holiday"),
    payday: at("payday")
  };

  const periods = [];
  for (let i = headerIndex + 1; i < rows.length; i++) {
    const row = rows[i] || [];
    const number = parseInt(cell(row, columns.number), 10);
    if (!Number.isFinite(number)) break;   // the calendar has run out

    const start = excelDate(row[columns.start]) || toISODate(cell(row, columns.start));
    const end = excelDate(row[columns.end]) || toISODate(cell(row, columns.end));

    let holidayCell = row[columns.holiday];
    let payday = excelDate(row[columns.payday]) || toISODate(cell(row, columns.payday));
    let holiday = String(holidayCell ?? "").trim();

    // In the real workbook the Payday sometimes sits one column left, where
    // Paid Holiday would be, because that cell was left empty. A date in the
    // holiday column and nothing in the payday column means exactly that.
    const holidayAsDate = excelDate(holidayCell);
    if (!payday && holidayAsDate) { payday = holidayAsDate; holiday = ""; }
    if (holidayAsDate) holiday = "";

    periods.push({
      year: parseInt((payday || end || start || "").slice(0, 4), 10) || new Date().getFullYear(),
      number, period_start: start, period_end: end, payday,
      holiday: holiday || null
    });
  }

  if (!periods.length) return say("No pay periods found under that header.", "error");

  // The paid-holidays block sits below the calendar on the same sheet.
  const blockStart = rows.findIndex(r =>
    (r || []).some(c => String(c).trim().toLowerCase() === "paid holidays"));
  const list = [];
  if (blockStart !== -1) {
    for (let i = blockStart + 1; i < rows.length; i++) {
      const row = rows[i] || [];
      const name = row.map(c => String(c ?? "").trim()).find(v => /\d{1,2}\/\d{1,2}\/\d{4}/.test(v));
      if (!name) {
        // "*Observed" and the quarterly block mark the end of the holidays.
        if (row.some(c => /observed|quarterly/i.test(String(c)))) break;
        continue;
      }
      const hours = row.map(c => String(c ?? "").trim())
        .find(v => /hrs$/i.test(v) || /^\d{1,2}$/.test(v)) || null;
      list.push({ year: periods[0].year, name, hours, sort_order: (list.length + 1) * 10 });
    }
  }

  // A payday normally lands within a few days of the period it pays for. One
  // that doesn't is a typo in the workbook — the 2026 sheet has two — and
  // showing a wrong date to the whole company is worse than saying so here.
  const suspect = periods.filter(p => {
    if (!p.payday || !p.period_end) return false;
    const gap = (new Date(p.payday) - new Date(p.period_end)) / 86400000;
    return gap < 0 || gap > 30;
  });

  say(`Importing ${periods.length} pay periods…`, "note");

  // Both tables move inside one database transaction, so a bad row leaves the
  // old calendar standing rather than emptying it.
  const { error } = await db.rpc("replace_payroll", { periods, holidays: list });
  if (error) return say(esc(error.message), "error");

  await loadAll();
  renderPayroll();

  say(`Imported ${periods.length} pay periods and ${list.length} paid holidays.`
    + (suspect.length ? `</p><p class="error">Check these in the spreadsheet — the
       payday doesn't line up with the period, which usually means the year is
       wrong in that cell: ` + suspect.map(p =>
         `#${p.number} pays ${p.payday}`).join(", ") : ""), "ok");
}

function renderPayroll() {
  const box = $("payrollSummary");
  if (!box) return;

  if (!payroll.length) {
    box.innerHTML = `<p class="note">Nothing imported yet.</p>`;
    return;
  }

  const next = payroll.find(p => p.payday && p.payday >= new Date().toISOString().slice(0, 10));
  box.innerHTML =
    `<span class="stat"><b>${payroll.length}</b>pay periods</span>` +
    `<span class="stat"><b>${holidays.length}</b>paid holidays</span>` +
    (next ? `<span class="stat"><b style="color:var(--red)">${
      fmtDate(next.payday)}</b>next payday</span>` : "") +
    `<div style="overflow-x:auto;margin-top:12px"><table>
      <thead><tr><th>#</th><th>Period</th><th>Payday</th><th>Holiday</th></tr></thead>
      <tbody>${payroll.map(p => `<tr>
        <td>${p.number}</td>
        <td>${fmtDate(p.period_start)} – ${fmtDate(p.period_end)}</td>
        <td><b>${fmtDate(p.payday)}</b></td>
        <td>${esc(p.holiday || "—")}</td>
      </tr>`).join("")}</tbody></table></div>`;
}

async function importDirectory(file) {
  const result = $("directoryResult");
  const say = (html, cls) => { result.innerHTML = `<p class="${cls}">${html}</p>`; };

  let rows;
  try { rows = await rowsFromFile(file); }
  catch (e) { return say(`Couldn't read that file: ${esc(e.message)}`, "error"); }

  // Columns are read by position, not by name: the sheet has two columns both
  // called "Phone #", so names can't tell them apart.
  const entries = rows
    .filter((row, index) => {
      if (!cell(row, 0)) return false;
      return !(index === 0 && cell(row, 0).toLowerCase() === "topic");
    })
    .map((row, index) => ({
      topic: cell(row, 0),
      contact1: cell(row, 1) || null,
      phone1: cell(row, 2) || null,
      contact2: cell(row, 3) || null,
      phone2: cell(row, 4) || null,
      sort_order: (index + 1) * 10
    }));

  if (!entries.length) return say("No rows found in that file.", "error");

  say(`Importing ${entries.length} rows…`, "note");

  // One transaction, so a bad row leaves the old directory standing.
  const { error } = await db.rpc("replace_directory", { entries });
  if (error) return say(esc(error.message), "error");

  await loadAll();
  renderDirectory();
  say(`Imported ${entries.length} rows.`, "ok");
}

function renderDirectory() {
  const box = $("directorySummary");
  if (!box) return;

  if (!directory.length) {
    box.innerHTML = `<p class="note">Nothing imported yet.</p>`;
    return;
  }

  box.innerHTML = `<span class="stat"><b>${directory.length}</b>topics</span>` +
    `<div style="overflow-x:auto;margin-top:12px"><table>
      <thead><tr><th>Topic</th><th>Contact 1</th><th>Phone</th>
        <th>Contact 2</th><th>Phone</th></tr></thead>
      <tbody>${directory.map(d => `<tr>
        <td><b>${esc(d.topic)}</b></td>
        <td>${esc(d.contact1 || "—")}</td>
        <td>${esc(d.phone1 || "—")}</td>
        <td>${esc(d.contact2 || "—")}</td>
        <td>${esc(d.phone2 || "—")}</td>
      </tr>`).join("")}</tbody></table></div>`;
}

// ---------------------------------------------------------------- employee handbook
//
// One PDF in the company-docs bucket, and one row in company_documents
// (migration 0046). A new upload is stored under a new name so phones can tell
// it apart from the copy they already saved; the old file is then removed.

function renderHandbook() {
  const box = $("handbookLive");
  if (!box) return;
  if (companyDocsError) {
    box.innerHTML = `<p class="error">${/does not exist|schema cache/i.test(companyDocsError)
      ? "Run migration 0046_company_documents.sql in the SQL editor, then reload this page."
      : esc(companyDocsError)}</p>`;
    return;
  }
  const handbook = companyDocs.find(d => d.id === "handbook");
  const title = $("handbookTitle"), summary = $("handbookSummary");
  if (handbook && title && document.activeElement !== title) title.value = handbook.title || "";
  if (handbook && summary && document.activeElement !== summary) summary.value = handbook.summary || "";
  box.innerHTML = handbook
    ? `<div class="role" style="padding:14px 16px"><b>${esc(handbook.title || "Employee Handbook")}</b>
        <div class="note">${esc(fileSize(handbook.file_size))}${handbook.updated_at
          ? ` · uploaded ${esc(new Date(handbook.updated_at).toLocaleString())}` : ""}</div>
        ${handbookURL ? `<div class="row" style="margin-top:10px">
          <a class="pdf" href="${esc(handbookURL)}" target="_blank" rel="noopener">Open the current PDF &nearr;</a>
        </div>` : ""}</div>`
    : `<p class="note">Nothing uploaded yet.</p>`;
}

async function uploadHandbook(file) {
  const say = (text, bad) => { const m = $("handbookMsg"); m.textContent = text; m.className = "msg " + (bad ? "error" : "ok"); };
  if (!/pdf$/i.test(file.name) && file.type !== "application/pdf") {
    return say("The handbook needs to be a PDF.", true);
  }
  if (file.size > 40 * 1024 * 1024) return say("That file is over 40 MB.", true);

  const previous = companyDocs.find(d => d.id === "handbook");
  const path = `handbook/${Date.now()}.pdf`;
  say("Uploading…", false);
  const { error: uploadError } = await db.storage.from("company-docs")
    .upload(path, file, { contentType: "application/pdf", upsert: false });
  if (uploadError) return say(uploadError.message, true);

  const row = {
    id: "handbook",
    title: ($("handbookTitle").value || "").trim() || (previous && previous.title) || "Employee Handbook",
    summary: ($("handbookSummary").value || "").trim() || (previous && previous.summary) || "",
    file_path: path,
    file_size: file.size
  };
  const { data, error } = await db.from("company_documents").upsert(row, { onConflict: "id" }).select();
  if (error || !data || !data.length) {
    await db.storage.from("company-docs").remove([path]);
    return say(error ? error.message : "Not saved — only an owner can upload the handbook.", true);
  }
  if (previous && previous.file_path && previous.file_path !== path) {
    await db.storage.from("company-docs").remove([previous.file_path]);
  }
  await loadCompanyDocs();
  renderHandbook();
  say("Uploaded. Phones pick it up the next time the handbook is opened.", false);
}

$("handbookFile").addEventListener("change", (event) => {
  const file = event.target.files[0];
  event.target.value = "";
  if (file) uploadHandbook(file);
});
["dragenter", "dragover"].forEach(type =>
  $("handbookDrop").addEventListener(type, (e) => { e.preventDefault(); $("handbookDrop").classList.add("over"); }));
["dragleave", "drop"].forEach(type =>
  $("handbookDrop").addEventListener(type, () => $("handbookDrop").classList.remove("over")));
$("handbookDrop").addEventListener("drop", (e) => {
  e.preventDefault();
  const file = e.dataTransfer.files[0];
  if (file) uploadHandbook(file);
});

$("admin").addEventListener("click", async (event) => {
  const button = event.target.closest('button[data-act="handbook-save-text"]');
  if (!button) return;
  const say = (text, bad) => { const m = $("handbookMsg"); m.textContent = text; m.className = "msg " + (bad ? "error" : "ok"); };
  const handbook = companyDocs.find(d => d.id === "handbook");
  if (!handbook) return say("Upload the handbook first.", true);
  const { data, error } = await db.from("company_documents").update({
    title: ($("handbookTitle").value || "").trim() || "Employee Handbook",
    summary: ($("handbookSummary").value || "").trim()
  }).eq("id", "handbook").select();
  if (error || !data || !data.length) {
    return say(error ? error.message : "Not saved — only an owner can change this.", true);
  }
  await loadCompanyDocs();
  renderHandbook();
  say("Saved.", false);
});
