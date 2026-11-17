// The Open Seat Report
//
// Classes with seats left, for everyone.

// ---------------------------------------------------------------- open seat report
//
// Two documents make the report (training_reports, migration 0030):
//
//   internal — our own classes, written by the database from the Class
//              Schedule (0127). UKG's Open Seat Report and In-Class Event
//              Report aren't uploaded any more.
//   agco     — AGCO Academy's sessions, from the Open Seat Report sheet of
//              AGCO's Technical Training Catalog: AGCO dealers only (0149),
//              uploaded with the catalog's courses on the AGCO Training
//              Catalog upload (agco-catalog.js).

let trainingReports = {}, trainingReportsError = null;

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
  // AGCO Academy's sessions are an AGCO dealer's only (0149).
  if (osrState.tab === "agco" && !companyHas("agco")) osrState.tab = "classes";
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
    const ours = c.source === "scheduled" && c.classId;
    return `
      <div class="osr-card"${ours ? ` data-osr-class-id="${esc(c.classId)}"` : ""}>
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
              ${ours ? crNoteHtml(c) : ""}
            </div>
          </button>
          <div class="osr-actions">
            ${emails.length ? `<a class="osr-email" href="${esc(mail)}">${icon("mail", 14)} Email Class</a>`
              : `<span class="osr-email disabled" title="No students enrolled">${icon("mail", 14)} Email Class</span>`}
            ${ours ? crActionsHtml(c, plainWhen) : osrRequestButton(c.title, c.city, plainWhen)}
          </div>
        </div>
        <div class="osr-body" id="osr-class-${i}" hidden>
          ${ours ? crRosterHtml(c) : c.roster.length ? `<table class="osr-roster"><thead><tr><th>#</th><th>Name</th>
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

  return hero("Open Seat Report", internal && internal.openSeatExported
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
      ${companyHas("agco") ? tab("agco", "AGCO Open Seat Report", sessions.length) : ""}
    </div>

    <section${osrState.tab === "classes" ? "" : " hidden"} data-osr-panel="classes">
      <div class="osr-desc">Click a class to view its enrolled roster. Use "Email Class" to message everyone
        currently registered. Register for a class the training department scheduled here, or use "Request
        Registration" to ask them to sign someone up.</div>
      ${classCards}
    </section>

    <section${osrState.tab === "stores" ? "" : " hidden"} data-osr-panel="stores">
      <div class="osr-desc">Select a store to see which employees from that location are registered for
        training, and which class.</div>
      <div class="osr-subtabs">${storeTabs}</div>
      ${storePanel}
    </section>

    <section${osrState.tab === "agco" && companyHas("agco") ? "" : " hidden"} data-osr-panel="agco">
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
