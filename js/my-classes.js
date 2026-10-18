// My Classes
//
// The classes you're enrolled in, from the Open Seat Report.

// ---------------------------------------------------------------- my classes
//
// The Agri-Service classes you're registered for, as the app's My Classes
// (MyClassesView.swift): the Open Seat Report's rosters carry each person's
// work email, and yours is matched to the one you sign in with. Soonest first,
// the next one on its own. Only as current as the last upload, which the foot
// of the page says. AGCO Academy's sessions have no rosters, so aren't here.

// Upcoming classes with your email on the roster, soonest first.
function myClasses() {
  const internal = trainingReports.internal && trainingReports.internal.data;
  const email = ((me && me.email) || "").trim().toLowerCase();
  if (!internal || !email) return [];
  const today = osrToday();
  return (internal.classes || [])
    .filter(c => (c.endDate || c.startDate || "9999") >= today)
    .filter(c => (c.roster || []).some(p => (p.email || "").trim().toLowerCase() === email))
    .sort((a, b) => (a.startDate || "9999").localeCompare(b.startDate || "9999") || a.title.localeCompare(b.title));
}

const mcKey = (c) => `${c.title}|${c.city}|${c.startDate || ""}`;
const mcFormat = (ymd, options) => dateOnly(ymd).toLocaleDateString("en-US", options);
const mcDaysBetween = (a, b) => Math.round((dateOnly(b) - dateOnly(a)) / 86400000);

// "Wed, Oct 14 – Thu, Oct 15, 2026 · 2 days", or one day, or "Date to be set".
function mcRange(c) {
  if (!c.startDate) return "Date to be set";
  const full = { weekday: "short", month: "short", day: "numeric", year: "numeric" };
  if (!c.endDate || c.endDate <= c.startDate) return mcFormat(c.startDate, full);
  const sameYear = c.startDate.slice(0, 4) === c.endDate.slice(0, 4);
  return `${mcFormat(c.startDate, sameYear ? { weekday: "short", month: "short", day: "numeric" } : full)} – ${
    mcFormat(c.endDate, full)} · ${mcDaysBetween(c.startDate, c.endDate) + 1} days`;
}

// "In 15 days", "Tomorrow", "Today", "Day 2 of 3", as the app says it.
function mcWhen(c) {
  if (!c.startDate) return "Date to be set";
  const until = mcDaysBetween(osrToday(), c.startDate);
  if (until > 1) return until >= 14 ? `In ${Math.floor(until / 7)} weeks` : `In ${until} days`;
  if (until === 1) return "Tomorrow";
  if (until === 0) return "Today";
  const total = mcDaysBetween(c.startDate, c.endDate || c.startDate) + 1;
  return `Day ${1 - until} of ${total}`;
}

function mcCard(c, next) {
  const meta = (name, text) => `<li>${icon(name, 15)}<span>${esc(text)}</span></li>`;
  return `<article class="mc-card${next ? " next" : ""}">
    <div class="mc-date" aria-hidden="true">${c.startDate
      ? `<small>${esc(mcFormat(c.startDate, { month: "short" }).toUpperCase())}</small><b>${esc(mcFormat(c.startDate, { day: "numeric" }))}</b>`
      : `<small>DATE</small><b class="tbd">TBD</b>`}</div>
    <div class="mc-body">
      <div class="mc-when">${esc(mcWhen(c))}</div>
      <h3 class="mc-title">${esc(c.title)}</h3>
      <ul class="mc-meta">
        ${meta("calendar", mcRange(c))}
        ${c.startTime ? meta("clock", `Starts ${c.startTime}`) : ""}
        ${c.city ? meta("pin", c.city) : ""}
        ${c.instructors ? meta("person", c.instructors) : ""}
      </ul>
      ${c.startDate ? `<button type="button" class="mc-action" data-mc-ics="${esc(mcKey(c))}">Add to my calendar ›</button>` : ""}
    </div>
  </article>`;
}

function myClassesView() {
  const intro = hero("My Classes", "The Agri-Service classes you're registered for, from the Open Seat Report.");
  const internal = trainingReports.internal && trainingReports.internal.data;
  if (!internal) {
    return intro + `<div class="card"><p class="note" style="margin:0">The training department hasn't published the Open Seat Report yet.</p></div>`;
  }
  const list = myClasses();
  const exported = internal.inClassExported || internal.openSeatExported;
  const foot = `<p class="note mc-foot">From the Open Seat Report${exported ? ` exported ${esc(exported.replace(" MDT", ""))}` : ""},
    matched on ${esc(me.email)}. A class you registered for after that shows up with the next upload.${list.length
      ? " The calendar button downloads a file: open it to add the class to Outlook or your calendar." : ""}</p>`;
  if (!list.length) {
    return intro + `<div class="mc-list"><article class="mc-card">
        <div class="mc-body"><h3 class="mc-title">No classes yet</h3>
          <p class="mc-empty">You're not on the roster for any upcoming Agri-Service class. The Open Seat Report shows
            the classes with seats left, and you can ask to be registered from there.</p>
          <button type="button" class="mc-action" data-view="openseat">See the open seats ›</button></div>
      </article></div>` + foot;
  }
  return intro + `<div class="mc-list">
      <h2 class="cab-heading"><span>Next up</span></h2>
      ${mcCard(list[0], true)}
      ${list.length > 1 ? `<h2 class="cab-heading mc-later"><span>Also registered</span>
        <span class="trail">${list.length - 1 === 1 ? "1 class" : `${list.length - 1} classes`}</span></h2>
        ${list.slice(1).map(c => mcCard(c, false)).join("")}` : ""}
    </div>` + foot;
}

// A class as a calendar file: all-day across its dates, since the report has
// when the first day starts but not when any day ends. As AddToCalendar.swift.
function downloadClassICS(c) {
  const after = dateOnly(c.endDate || c.startDate);
  after.setDate(after.getDate() + 1);
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const notes = [c.startTime && `Starts ${c.startTime} on the first day.`,
                 c.instructors && `Instructor: ${c.instructors}`, "From the Agri-Service app"].filter(Boolean).join("\n\n");
  const lines = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Agri-Service//My Classes//EN", "METHOD:PUBLISH", "BEGIN:VEVENT",
    `UID:${(c.eventId || slugify(`${c.title} ${c.city}`, "-"))}-${c.startDate}@agri-service-app`,
    `DTSTAMP:${stamp}`,
    `DTSTART;VALUE=DATE:${c.startDate.replace(/-/g, "")}`,
    `DTEND;VALUE=DATE:${after.getFullYear()}${pad2(after.getMonth() + 1)}${pad2(after.getDate())}`,
    `SUMMARY:${icsText(c.title)}`,
    ...(c.city ? [`LOCATION:${icsText(c.city)}`] : []),
    `DESCRIPTION:${icsText(notes)}`,
    "END:VEVENT", "END:VCALENDAR"
  ];
  const blob = new Blob([lines.map(icsFold).join("\r\n") + "\r\n"], { type: "text/calendar;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = (c.title.replace(/[^\w -]+/g, "").trim() || "class") + ".ics";
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

document.addEventListener("click", (event) => {
  const button = event.target.closest("[data-mc-ics]");
  if (!button) return;
  const c = myClasses().find(x => mcKey(x) === button.dataset.mcIcs);
  if (c) downloadClassICS(c);
});
