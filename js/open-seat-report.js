// The Open Seat Report
//
// Classes with seats left, for everyone, and uploading the reports.

// ---------------------------------------------------------------- open seat report
//
// The Training Class Enrollment Report, rebuilt from three uploads instead of
// a separate website. The files are read here in the browser and the finished
// report is saved as two documents (migration 0030):
//
//   internal — the UKG Open Seat Report + In-Class Event Report CSVs. Always
//              published together, because each roster is matched to its
//              class by title, city and start time.
//   agco     — the "Open Seat Report" sheet of AGCO's Technical Training
//              Catalog, or a workbook holding just that sheet.
//
// Files are recognised by their column headings, not their names, since the
// UKG exports get a new random suffix every time.

let trainingReports = {}, trainingReportsError = null;
let osrPending = { openSeat: null, inClass: null, agco: null };

const osrText = (v) => String(v ?? "").trim();

// Dates arrive as "2026-11-17 08:00:00 MST", "10/19/2026", Excel serial
// numbers, or — in the AGCO sheet — broken formulas. Anything that isn't
// clearly a date becomes null and shows as "Date TBD".
// "2026-11-17 08:00:00 MST" -> "8:00 AM MST": when the class starts, on the
// clock where it's held, which is how UKG writes it. Excel keeps the time as
// the fraction of a day. Midnight is a date with no time, not a class that
// starts at midnight, so it gives nothing.
function osrTime(value) {
  if (value === null || value === undefined || value === "") return null;
  let hours, minutes, zone = "";
  if (typeof value === "number") {
    const total = Math.round((value % 1) * 1440);
    hours = Math.floor(total / 60) % 24; minutes = total % 60;
  } else {
    const m = osrText(value).match(/(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)?\s*([A-Za-z]{2,5})?\s*$/i);
    if (!m) return null;
    hours = Number(m[1]); minutes = Number(m[2]);
    if (m[3]) hours = (hours % 12) + (/pm/i.test(m[3]) ? 12 : 0);
    zone = (m[4] || "").toUpperCase();
  }
  if (!hours && !minutes) return null;
  const clock = `${hours % 12 || 12}:${String(minutes).padStart(2, "0")} ${hours < 12 ? "AM" : "PM"}`;
  return zone ? `${clock} ${zone}` : clock;
}

function osrDate(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return excelDate(value);
  const s = osrText(value);
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  if (/^\d+(\.\d+)?$/.test(s)) return excelDate(parseFloat(s));
  return null;
}

async function osrRowsFromFile(file) {
  if (/\.csv$/i.test(file.name) || file.type === "text/csv") {
    return parseCSV(await file.text());
  }
  // The full Technical Training Catalog is several megabytes and twenty tabs,
  // so find the one sheet that matters before reading any cells.
  const buffer = await file.arrayBuffer();
  const names = XLSX.read(buffer, { type: "array", bookSheets: true }).SheetNames;
  const name = names.find(n => /^open seat report$/i.test(n.trim())) || names[0];
  const workbook = XLSX.read(buffer, { type: "array", sheets: [name] });
  return XLSX.utils.sheet_to_json(workbook.Sheets[name], { header: 1, raw: true, defval: "" });
}

function osrHeaderIndex(rows, required) {
  return rows.findIndex(r => required.every(name =>
    (r || []).some(c => osrText(c).toLowerCase() === name)));
}

function osrRecords(rows, headerIndex) {
  const header = rows[headerIndex].map(osrText);
  return rows.slice(headerIndex + 1)
    .filter(r => (r || []).some(c => osrText(c) !== ""))
    .map(r => Object.fromEntries(header.map((h, i) => [h, r[i]])));
}

function osrExportDate(rows) {
  const row = rows.find(r => /^export date:/i.test(osrText((r || [])[0])));
  return row ? osrText(row[0]).replace(/^export date:\s*/i, "") : "";
}

// "Store - 13 - Pasco" -> number 13, name Pasco. This is the person's home
// store, which is what Enrollment by Store groups on — not the class's city.
function osrStore(raw) {
  const m = osrText(raw).match(/^(?:store\s*-\s*)?(\d+)\s*-\s*(.+)$/i);
  return m ? { number: m[1], name: m[2].trim() }
           : { number: "", name: osrText(raw) || "Unknown" };
}

function osrParse(rows, fileName) {
  // AGCO catalog sheet
  if (osrHeaderIndex(rows, ["class id", "title", "status"]) !== -1) {
    const sessions = [];
    let program = "AGCO", catalogDate = "";
    for (const row of rows) {
      const first = osrText(row[0]);
      const titleRow = first.match(/^(.*?)\s*open seat report\b(.*)$/i);
      if (titleRow) {
        // "Open Seat Report  8-27-26" starts the AGCO block; "Raven Open Seat
        // Report  8-27-26" starts Raven's. Any other brand would work the same.
        program = titleRow[1].trim() || "AGCO";
        const date = titleRow[2].match(/(\d{1,2}-\d{1,2}-\d{2,4})\s*$/);
        if (date && !catalogDate) catalogDate = date[1];
        continue;
      }
      if (first.toLowerCase() === "class id") continue;
      const title = osrText(row[2]);
      if (!title) continue;

      const status = osrText(row[7]);
      const counts = status.match(/^(\d+)\s+of\s+(\d+)\s+enrolled/i);
      const registered = counts ? Number(counts[1]) : null;
      const capacity = counts ? Number(counts[2]) : null;
      sessions.push({
        program,
        classId: osrText(row[0]),
        title,
        description: osrText(row[1]) || null,
        facility: osrText(row[4]).replace(/\s*\([A-Za-z0-9_]+\)\s*$/, ""),
        startDate: osrDate(row[5]),
        endDate: osrDate(row[6]),
        status,
        registered,
        capacity,
        full: /^full$/i.test(status) || (counts !== null && registered >= capacity)
      });
    }
    sessions.sort((a, b) => (a.startDate || "9999").localeCompare(b.startDate || "9999"));
    return { kind: "agco", fileName, catalogDate, sessions };
  }

  // UKG Open Seat Report
  let at = osrHeaderIndex(rows, ["event title", "available seats"]);
  if (at !== -1) {
    const classes = osrRecords(rows, at).map(r => ({
      title: osrText(r["Event Title"]),
      city: osrText(r["Event City"]),
      status: osrText(r["Status"]),
      startRaw: osrText(r["Event Start Date"]),
      startDate: osrDate(r["Event Start Date"]),
      startTime: osrTime(r["Event Start Date"]),
      endDate: osrDate(r["Event End Date"]),
      registered: parseInt(r["Registered"], 10) || 0,
      available: parseInt(r["Available Seats"], 10) || 0
    })).filter(c => c.title);
    return { kind: "openSeat", fileName, exported: osrExportDate(rows), classes };
  }

  // UKG In-Class Event Report
  at = osrHeaderIndex(rows, ["firstname", "event title"]);
  if (at !== -1) {
    const enrollments = osrRecords(rows, at).map(r => ({
      first: osrText(r["Firstname"]),
      last: osrText(r["Lastname"]),
      email: osrText(r["Email"]),
      store: osrText(r["Store"]),
      title: osrText(r["Event Title"]),
      eventId: osrText(r["Event Id"]),
      city: osrText(r["Event City"]),
      startRaw: osrText(r["Event Start Date"]),
      startDate: osrDate(r["Event Start Date"]),
      instructors: osrText(r["Instructor Names"])
    })).filter(e => e.title);
    return { kind: "inClass", fileName, exported: osrExportDate(rows), enrollments };
  }

  return null;
}

function osrBuildInternal(openSeat, inClass) {
  const warnings = [];
  const key = (...parts) => parts.map(p => osrText(p).toLowerCase()).join("|");
  const exact = new Map(), byDay = new Map();

  const classes = openSeat.classes.map(c => {
    const built = {
      eventId: null, title: c.title, city: c.city, status: c.status,
      startDate: c.startDate, endDate: c.endDate || c.startDate,
      // Null on a report published before times were kept.
      startTime: c.startTime || null,
      registered: c.registered, available: c.available,
      instructors: "", roster: [], sortKey: `${c.startDate || "9999"} ${c.startRaw}`
    };
    exact.set(key(c.title, c.city, c.startRaw), built);
    byDay.set(key(c.title, c.city, c.startDate), built);
    return built;
  });

  const unmatched = new Set();
  for (const e of inClass.enrollments) {
    const cls = exact.get(key(e.title, e.city, e.startRaw)) || byDay.get(key(e.title, e.city, e.startDate));
    if (!cls) { unmatched.add(`${e.title} (${e.city}, ${e.startDate || "no date"})`); continue; }
    const store = osrStore(e.store);
    cls.eventId = cls.eventId || e.eventId || null;
    if (!cls.instructors && e.instructors) cls.instructors = e.instructors;
    cls.roster.push({
      name: `${e.first} ${e.last}`.trim(), first: e.first, last: e.last, email: e.email,
      store: store.number ? `${store.number} - ${store.name}` : store.name,
      storeNumber: store.number, storeName: store.name
    });
  }

  for (const cls of classes) {
    cls.roster.sort((a, b) => a.last.localeCompare(b.last) || a.first.localeCompare(b.first));
    if (cls.roster.length !== cls.registered) {
      warnings.push(`${cls.title} (${cls.city}) says ${cls.registered} registered, but the ` +
        `In-Class Event Report lists ${cls.roster.length}.`);
    }
  }
  if (unmatched.size) {
    warnings.unshift(`People are enrolled in ${unmatched.size === 1 ? "a class" : "classes"} the Open ` +
      `Seat Report doesn't have: ${[...unmatched].join("; ")}. They're left out — check both ` +
      `files come from the same export.`);
  }
  if (openSeat.exported && inClass.exported && openSeat.exported !== inClass.exported) {
    warnings.unshift(`The two files were exported on different days (${openSeat.exported} and ` +
      `${inClass.exported}), so the rosters may not match the seat counts.`);
  }

  classes.sort((a, b) => a.sortKey.localeCompare(b.sortKey));
  classes.forEach(c => delete c.sortKey);

  return {
    warnings,
    data: {
      version: 1,
      openSeatExported: openSeat.exported,
      inClassExported: inClass.exported,
      classes
    },
    note: `Open Seat Report exported ${openSeat.exported || "?"} · ` +
          `In-Class Event Report exported ${inClass.exported || "?"}`
  };
}

async function osrAddFiles(files) {
  const result = $("osrResult");
  const problems = [];
  result.innerHTML = `<p class="note">Reading ${files.length === 1 ? "the file" : files.length + " files"}…</p>`;

  for (const file of files) {
    try {
      const parsed = osrParse(await osrRowsFromFile(file), file.name);
      if (parsed) osrPending[parsed.kind] = parsed;
      else problems.push(`<b>${esc(file.name)}</b> isn't one of the three reports — ` +
        `no Open Seat Report, In-Class Event Report or catalog columns in it.`);
    } catch (e) {
      problems.push(`Couldn't read <b>${esc(file.name)}</b>: ${esc(e.message)}`);
    }
  }
  renderOsrImport(problems);
}

function renderOsrImport(problems = []) {
  const box = $("osrResult");
  if (!box) return;
  const { openSeat, inClass, agco } = osrPending;
  const tick = (ok) => ok ? `<span class="ok">✓</span>` : `<span class="note">—</span>`;

  const lines = [
    [openSeat, "Open Seat Report", openSeat &&
      `${openSeat.classes.length} classes · exported ${esc(openSeat.exported || "?")}`],
    [inClass, "In-Class Event Report", inClass &&
      `${inClass.enrollments.length} enrollments · exported ${esc(inClass.exported || "?")}`],
    [agco, "AGCO Open Seat Report", agco &&
      `${agco.sessions.length} sessions${agco.catalogDate ? " · as of " + esc(agco.catalogDate) : ""}`]
  ];

  const nothing = !openSeat && !inClass && !agco;
  let warnings = [];
  if (openSeat && inClass) warnings = osrBuildInternal(openSeat, inClass).warnings;
  if (!!openSeat !== !!inClass) {
    warnings.push(`Add the ${openSeat ? "In-Class Event Report" : "Open Seat Report"} too — ` +
      `the classes and rosters are published together.`);
  }
  const canPublish = (openSeat && inClass) || agco;

  box.innerHTML = (problems.length ? `<div class="error" style="margin:12px 0">${problems.join("<br>")}</div>` : "") +
    (nothing ? "" : `
    <table style="margin-top:14px"><tbody>
      ${lines.map(([have, name, detail]) => `<tr>
        <td style="width:24px">${tick(have)}</td>
        <td><b>${name}</b><div class="note">${have ? `${detail} · ${esc(have.fileName)}` : "Not added"}</div></td>
      </tr>`).join("")}
    </tbody></table>
    ${warnings.length ? `<div class="note" style="margin-top:10px;color:#8a5e00">
      ${warnings.map(w => "⚠︎ " + esc(w)).join("<br>")}</div>` : ""}
    <div class="row" style="margin-top:14px">
      <button data-act="publish-osr"${canPublish ? "" : " disabled"}>Publish to the app</button>
      <button class="ghost" data-act="clear-osr">Start over</button>
      <span class="msg"></span>
    </div>`);
}

function renderOsrLive() {
  const box = $("osrLive");
  if (!box) return;
  if (trainingReportsError) {
    box.innerHTML = `<p class="error">${/does not exist|schema cache/i.test(trainingReportsError)
      ? "Run migration 0030_training_reports.sql in the SQL editor, then reload this page."
      : esc(trainingReportsError)}</p>`;
    return;
  }
  const when = (row) => row ? new Date(row.updated_at).toLocaleString("en-US",
    { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "";
  const internal = trainingReports.internal, agco = trainingReports.agco;
  const enrolled = internal ? internal.data.classes.reduce((n, c) => n + c.roster.length, 0) : 0;

  box.innerHTML = `
    <table><tbody>
      <tr><td><b>Classes &amp; rosters</b><div class="note">${internal
        ? `${internal.data.classes.length} classes, ${enrolled} enrolled · ${esc(internal.source_note || "")} · published ${when(internal)}`
        : "Nothing published yet"}</div></td></tr>
      <tr><td><b>AGCO sessions</b><div class="note">${agco
        ? `${agco.data.sessions.length} sessions · ${esc(agco.source_note || "")} · published ${when(agco)}`
        : "Nothing published yet"}</div></td></tr>
    </tbody></table>
    ${internal || agco ? `<button class="pdf" style="margin-top:10px" data-view="openseat">See the report</button>` : ""}`;
}

$("admin").addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-act]");
  if (!button || !["publish-osr", "clear-osr"].includes(button.dataset.act)) return;

  if (button.dataset.act === "clear-osr") {
    osrPending = { openSeat: null, inClass: null, agco: null };
    $("osrFile").value = "";
    return renderOsrImport();
  }

  const row = button.closest(".row");
  const { openSeat, inClass, agco } = osrPending;
  const writes = [];
  if (openSeat && inClass) {
    const built = osrBuildInternal(openSeat, inClass);
    writes.push({ id: "internal", data: built.data, source_note: built.note });
  }
  if (agco) {
    writes.push({ id: "agco", source_note: agco.catalogDate ? `Catalog as of ${agco.catalogDate}` : "",
                  data: { version: 1, catalogDate: agco.catalogDate, sessions: agco.sessions } });
  }
  if (!writes.length) return;

  speak(row, "Publishing…", false);
  const { data, error } = await db.from("training_reports").upsert(writes).select("id");
  if (error) {
    return speak(row, /row-level/i.test(error.message) ? "Only an owner can publish the report."
      : /does not exist|schema cache/i.test(error.message)
        ? "Run migration 0030_training_reports.sql in the SQL editor first." : error.message, true);
  }
  if (!data || data.length !== writes.length) {
    return speak(row, "Nothing was saved — only an owner can publish the report.", true);
  }

  osrPending = { openSeat: null, inClass: null, agco: null };
  $("osrFile").value = "";
  await loadAll();
  renderOsrImport();
  renderOsrLive();
  $("osrResult").innerHTML = `<p class="ok">Published. Phones show it next time the report is opened.</p>`;
});

// ---- the report itself, for everyone ---------------------------------------

let osrState = { tab: "classes", store: 0 };

const osrToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
};
const osrDay = (ymd) => dateOnly(ymd).toLocaleDateString("en-US",
  { month: "short", day: "numeric", year: "numeric" });

// Plain text with " - " for data attributes, prompts and email subjects;
// the page itself uses an en dash.
function osrRange(start, end, plain) {
  if (!start) return "Date TBD";
  if (!end || end === start) return osrDay(start);
  return `${osrDay(start)}${plain ? " - " : " – "}${osrDay(end)}`;
}

function osrBadge(status) {
  const cls = /^upcoming$/i.test(status) ? "gold" : /^completed$/i.test(status) ? "green" : "red";
  return `<span class="osr-badge ${cls}">${esc(status || "—")}</span>`;
}

const osrRequestButton = (title, place, dates, small) => `
  <button type="button" class="osr-request${small ? " small" : ""}" data-osr-request
    data-title="${esc(title)}" data-city="${esc(place)}" data-dates="${esc(dates)}">
    ${icon("pencil", 14)} ${small ? "Request" : "Request Registration"}</button>`;

function openSeatView() {
  const internal = trainingReports.internal && trainingReports.internal.data;
  const agcoDoc = trainingReports.agco && trainingReports.agco.data;
  const today = osrToday();

  if (!internal && !agcoDoc) {
    return hero("Open Seat Report", "Upcoming classes, who's enrolled, and open seats.", true) +
      comingSoon("The training department hasn't published the report yet.");
  }

  // A snapshot goes stale as classes finish, so finished ones drop off here
  // rather than waiting for the next upload.
  const classes = internal ? internal.classes.filter(c => (c.endDate || c.startDate || "9999") >= today) : [];
  const sessions = agcoDoc ? agcoDoc.sessions.filter(s => !s.startDate || (s.endDate || s.startDate) >= today) : [];

  const stores = new Map();
  classes.forEach(c => c.roster.forEach(p => {
    const k = p.storeName || "Unknown";
    if (!stores.has(k)) stores.set(k, { number: p.storeNumber, students: [] });
    stores.get(k).students.push({ ...p, cls: c });
  }));
  const storeList = [...stores.entries()].sort((a, b) =>
    (a[1].number || "99").localeCompare(b[1].number || "99", undefined, { numeric: true }) ||
    a[0].localeCompare(b[0]));
  if (osrState.store >= storeList.length) osrState.store = 0;

  const registered = classes.reduce((n, c) => n + c.registered, 0);
  const open = classes.reduce((n, c) => n + c.available, 0);
  const tab = (id, label, count) => `<button type="button" class="osr-tab${osrState.tab === id ? " on" : ""}"
    data-osr-tab="${id}">${label} <span>${count}</span></button>`;

  const classCards = classes.map((c, i) => {
    const cap = c.registered + c.available;
    const pct = cap ? Math.round(100 * c.registered / cap) : 0;
    const emails = c.roster.map(p => p.email).filter(Boolean);
    const plain = osrRange(c.startDate, c.endDate, true);
    const mail = `mailto:?bcc=${emails.join(",")}&subject=${encodeURIComponent(`${c.title} — ${plain}`)}`;
    // The registration request says when it starts too.
    const plainWhen = c.startTime ? `${plain}, starts ${c.startTime}` : plain;
    return `
      <div class="osr-card">
        <div class="osr-card-top">
          <button type="button" class="osr-head" data-osr-toggle="${i}" aria-expanded="false">
            <div class="osr-head-main">
              <div class="osr-title-row"><span class="osr-chev">▸</span>
                <span class="osr-title">${esc(c.title)}</span>${osrBadge(c.status)}</div>
              <div class="osr-meta"><span>${icon("calendar", 14)}${osrRange(c.startDate, c.endDate)}</span>
                ${c.startTime ? `<span>${icon("clock", 14)}Starts ${esc(c.startTime)}</span>` : ""}
                <span>${icon("pin", 14)}${esc(c.city)}</span>${c.instructors ? `<span>${icon("person", 14)}${esc(c.instructors)}</span>` : ""}</div>
            </div>
            <div class="osr-seats">
              <div><strong>${c.registered}</strong> / ${cap} enrolled</div>
              <div class="osr-bar"><div style="width:${pct}%"></div></div>
              <div class="osr-open">${c.available} seat${c.available === 1 ? "" : "s"} open</div>
            </div>
          </button>
          <div class="osr-actions">
            ${emails.length ? `<a class="osr-email" href="${esc(mail)}">${icon("mail", 14)} Email Class</a>`
              : `<span class="osr-email disabled" title="No students enrolled">${icon("mail", 14)} Email Class</span>`}
            ${osrRequestButton(c.title, c.city, plainWhen)}
          </div>
        </div>
        <div class="osr-body" id="osr-class-${i}" hidden>
          ${c.roster.length ? `<table class="osr-roster"><thead><tr><th>#</th><th>Name</th>
            <th>Store / Location</th><th>Email</th></tr></thead><tbody>
            ${c.roster.map((p, n) => `<tr><td class="osr-num">${n + 1}</td><td class="osr-name">${esc(p.name)}</td>
              <td>${esc(p.store)}</td><td><a href="mailto:${esc(p.email)}">${esc(p.email)}</a></td></tr>`).join("")}
            </tbody></table>`
          : `<p class="osr-empty">No one is currently enrolled in this session.</p>`}
        </div>
      </div>`;
  }).join("") || `<p class="osr-empty">No upcoming classes.</p>`;

  const storeTabs = storeList.map(([name, info], i) => `<button type="button"
    class="osr-subtab${i === osrState.store ? " on" : ""}" data-osr-store="${i}">${esc(name)}
    <span>${info.students.length}</span></button>`).join("");
  const storePanel = storeList.length ? (() => {
    const [name, info] = storeList[osrState.store];
    const students = [...info.students].sort((a, b) => a.name.localeCompare(b.name));
    return `<div class="osr-desc">${students.length} student${students.length === 1 ? "" : "s"} enrolled from ${esc(name)}</div>
      <div class="osr-scroll"><table class="osr-table"><thead><tr><th>#</th><th>Student</th><th>Class Enrolled</th><th>Email</th></tr></thead><tbody>
      ${students.map((s, n) => `<tr><td class="osr-num">${n + 1}</td><td class="osr-name">${esc(s.name)}</td>
        <td><div class="osr-class-title">${esc(s.cls.title)}</div>
          <div class="osr-sub">${osrRange(s.cls.startDate, s.cls.endDate)}${s.cls.startTime
            ? ` · ${esc(s.cls.startTime)}` : ""} · ${esc(s.cls.city)} ${osrBadge(s.cls.status)}</div></td>
        <td><a href="mailto:${esc(s.email)}">${esc(s.email)}</a></td></tr>`).join("")}
      </tbody></table></div>`;
  })() : `<p class="osr-empty">No one is enrolled in an upcoming class.</p>`;

  const agcoRows = sessions.map(s => {
    let badge, status;
    if (s.full) { badge = `<span class="osr-badge red">Full</span>`; status = "full"; }
    else if (s.capacity) {
      const left = s.capacity - s.registered;
      badge = `<span class="osr-badge ${left >= Math.max(1, Math.floor(s.capacity / 2)) ? "green" : "gold"}">` +
        `${left} open (${s.registered}/${s.capacity})</span>`;
      status = "open";
    } else { badge = `<span class="osr-badge gold">${esc(s.status || "TBD")}</span>`; status = "open"; }
    return `<tr data-osr-search="${esc(`${s.title} ${s.facility} ${s.program}`.toLowerCase())}" data-osr-status="${status}">
      <td><span class="osr-program${s.program === "AGCO" ? "" : " alt"}">${esc(s.program)}</span></td>
      <td><div class="osr-class-title">${esc(s.title)}</div>${s.description ? `<div class="osr-sub">${esc(s.description)}</div>` : ""}</td>
      <td>${esc(s.facility)}</td>
      <td>${osrRange(s.startDate, s.endDate)}</td>
      <td>${badge}</td>
      <td>${osrRequestButton(s.title, s.facility, osrRange(s.startDate, s.endDate, true), true)}</td></tr>`;
  }).join("");
  const agcoOpen = sessions.filter(s => !s.full).length;

  return hero("Open Seat Report", internal
      ? `Open Seat Report exported ${internal.openSeatExported} · In-Class Event Report exported ${internal.inClassExported}`
      : "Upcoming classes, who's enrolled, and open seats.") + `
  <div class="osr">
    <div class="osr-summary">
      <div><b>${classes.length}</b><span>Upcoming Classes</span></div>
      <div><b>${registered}</b><span>Total Registered</span></div>
      <div><b>${open}</b><span>Open Seats</span></div>
      <div><b>${storeList.length}</b><span>Stores Represented</span></div>
    </div>
    <div class="osr-tabs">
      ${tab("classes", "All Classes", classes.length)}
      ${tab("stores", "Enrollment by Store", storeList.length)}
      ${tab("agco", "AGCO Open Seat Report", sessions.length)}
    </div>

    <section${osrState.tab === "classes" ? "" : " hidden"} data-osr-panel="classes">
      <div class="osr-desc">Click a class to view its enrolled roster. Use "Email Class" to message everyone
        currently registered, or "Request Registration" to ask the training team to sign someone up.</div>
      ${classCards}
    </section>

    <section${osrState.tab === "stores" ? "" : " hidden"} data-osr-panel="stores">
      <div class="osr-desc">Select a store to see which employees from that location are registered for
        training, and which class.</div>
      <div class="osr-subtabs">${storeTabs}</div>
      ${storePanel}
    </section>

    <section${osrState.tab === "agco" ? "" : " hidden"} data-osr-panel="agco">
      ${agcoDoc ? `
      <div class="osr-desc">Seat availability across AGCO Academy's national technical training catalog${
        agcoDoc.catalogDate ? ` as of ${esc(agcoDoc.catalogDate)}` : ""} — ${sessions.length} sessions,
        ${agcoOpen} with open seats. Use "Request" to ask the training team to sign someone up.</div>
      <div class="osr-controls">
        <input type="text" id="osrSearch" placeholder="Search by class title or location...">
        <select id="osrFilter">
          <option value="all">All classes</option>
          <option value="open">Open seats only</option>
          <option value="full">Full only</option>
        </select>
      </div>
      <div class="osr-scroll"><table class="osr-table" id="osrAgcoTable">
        <thead><tr><th>Program</th><th>Class</th><th>Location</th><th>Dates</th><th>Seats</th><th>Action</th></tr></thead>
        <tbody>${agcoRows}</tbody></table></div>
      <p class="osr-empty" id="osrAgcoEmpty"${sessions.length ? " hidden" : ""}>No classes match your search.</p>`
      : `<p class="osr-empty">The AGCO catalog hasn't been published yet.</p>`}
    </section>
  </div>`;
}

$("view").addEventListener("click", (event) => {
  const toggle = event.target.closest("[data-osr-toggle]");
  if (toggle) {
    const body = $("osr-class-" + toggle.dataset.osrToggle);
    body.hidden = !body.hidden;
    toggle.setAttribute("aria-expanded", String(!body.hidden));
    return;
  }

  const tab = event.target.closest("[data-osr-tab]");
  if (tab) {
    osrState.tab = tab.dataset.osrTab;
    document.querySelectorAll("[data-osr-tab]").forEach(b =>
      b.classList.toggle("on", b === tab));
    document.querySelectorAll("[data-osr-panel]").forEach(p =>
      p.hidden = p.dataset.osrPanel !== osrState.tab);
    return;
  }

  const store = event.target.closest("[data-osr-store]");
  if (store) {
    osrState.store = Number(store.dataset.osrStore);
    // Redrawn where it is, rather than jumping back to the top.
    const y = window.scrollY;
    showView("openseat");
    window.scrollTo(0, y);
    return;
  }

  // Opens a draft in the person's own mail app. Nothing is sent until they
  // press Send there.
  const request = event.target.closest("[data-osr-request]");
  if (request) {
    const { title, city, dates } = request.dataset;
    const name = window.prompt(`Who needs to be registered for "${title}" (${dates})?`);
    if (!name || !name.trim()) return;
    const subject = `Registration Request: ${title} — ${dates}`;
    const body = `Please register the following person for this class:\n\nName: ${name.trim()}` +
      `\n\nClass: ${title}\nLocation: ${city}\nDates: ${dates}`;
    // To the Training Manager, whoever holds it (0112); with nobody set, the
    // draft opens with no address for the person to fill in.
    const manager = trainingManagerContact();
    window.location.href = `mailto:${manager ? manager.email : ""}?subject=${encodeURIComponent(subject)}` +
      `&body=${encodeURIComponent(body)}`;
  }
});

function osrFilterAgco() {
  const table = $("osrAgcoTable");
  if (!table) return;
  const q = $("osrSearch").value.trim().toLowerCase();
  const status = $("osrFilter").value;
  let shown = 0;
  table.querySelectorAll("tbody tr").forEach(tr => {
    const show = (!q || tr.dataset.osrSearch.includes(q)) &&
      (status === "all" || tr.dataset.osrStatus === status);
    tr.hidden = !show;
    if (show) shown++;
  });
  $("osrAgcoEmpty").hidden = shown > 0;
}
$("view").addEventListener("input", (e) => { if (e.target.id === "osrSearch") osrFilterAgco(); });
$("view").addEventListener("change", (e) => { if (e.target.id === "osrFilter") osrFilterAgco(); });

// The open seat report takes several files at once.
$("osrFile").addEventListener("change", (e) => {
  if (e.target.files.length) osrAddFiles([...e.target.files]);
});
["dragenter", "dragover"].forEach(type =>
  $("osrDrop").addEventListener(type, (e) => { e.preventDefault(); $("osrDrop").classList.add("over"); }));
["dragleave", "drop"].forEach(type =>
  $("osrDrop").addEventListener(type, () => $("osrDrop").classList.remove("over")));
$("osrDrop").addEventListener("drop", (e) => {
  e.preventDefault();
  if (e.dataTransfer.files.length) osrAddFiles([...e.dataTransfer.files]);
});
