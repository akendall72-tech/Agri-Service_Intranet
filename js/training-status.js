// Training Status
//
// The three UKG exports (All employees, Credits All Time, OLT and ILT), the
// AGCO dealer metric worked out from them, Training Status for everyone, its
// Classes tab (the course report), and uploading the exports.

// ---------------------------------------------------------------- training status
//
// Technician AGCO training hours, EPA 609 and everyone's training history
// (migration 0043), built from three UKG exports an owner uploads on the admin
// page's Training Status tab:
//
//   All employees        who everyone is, their job and store. Technicians are
//                        the jobs with "Technician" in the title.
//   Credit Rules Report  each technician's hours toward the 24-hour AGCO
//                        training credit, and whether they hold EPA 609.
//   OLT and ILT          every course completion, with its date.
//
// The dealer metric: a share of technicians need the full AGCO training hours.
//
// Publishing turns the three into one row per employee. The database decides
// who sees which rows: everyone their own, a location admin their location's,
// owners everyone's. So the same page works for all three — it just shows
// whatever came back.

let tsPeople = [], tsSources = null, tsRaw = null, trainingStatusError = null;
// Who a driving test can be about: since 0092, people who passed the online
// course in the last 30 days and haven't been tested, from
// forklift_eligible_people(). The same list the app uses.
let evalPeople = [];
let tsPlan = new Set();            // person keys ticked as planned to reach 24
let tsState = { tab: "summary", filter: "all", store: null, everyone: false, year: null };
let tsPending = { employees: null, credits: null, history: null };

// The dealer metric: the share of technicians who need 24+ AGCO hours. AGCO
// sets it, so it's a setting owners change on the admin page (65% by default).
const tsGoalPercent = () => {
  const value = Number(tsSources && tsSources.goal_percent);
  return value > 0 && value <= 100 ? value : 65;
};

// The hours a technician needs. AGCO's credits report states it per person
// inside the credit rule title ("... Number of Credits: 24"), and that wins —
// it is what AGCO actually applied to them. This is the answer for everyone
// the report is quiet about, and it supplies the wording everywhere. Owners
// change it on the admin page; migration 0052.
const tsRequiredHours = () => {
  const value = Number(tsSources && tsSources.required_hours);
  return value > 0 && value <= 200 ? value : 24;
};
const tsGoal = () => tsGoalPercent() / 100;

async function loadTrainingStatus() {
  const [people, sources, plan, raw, evaluable] = await Promise.all([
    db.from("training_status_people").select("*"),
    db.rpc("training_status_sources"),
    db.from("training_plans").select("planned").maybeSingle(),
    db.from("training_status").select("*").eq("id", "current").maybeSingle(),
    db.rpc("forklift_eligible_people")
  ]);
  trainingStatusError = people.error ? people.error.message : null;
  tsPeople = people.data || [];
  // The driving test picker, loaded with everything else. Not yourself: the
  // database refuses it.
  const mine = ((me && me.email) || "").toLowerCase();
  evalPeople = (evaluable.data || [])
    .filter(r => (r.email || "").toLowerCase() !== mine);
  tsSources = sources.error ? null : sources.data;
  tsPlan = new Set((plan.data && plan.data.planned) || []);
  tsRaw = raw.error ? null : raw.data;   // owners only
}

// ---- reading the exports -------------------------------------------------------------

const tsText = (value) => String(value ?? "").replace(/ /g, " ").replace(/\s+/g, " ").trim();

// People are matched by their UKG employee number (tsEmployeeNumber), then by
// work email. A name only stands in for someone with neither, which today is
// nobody: "Andrés  Pérez-Gómez" and "andres perez gomez" are the same key.
//
// THIS WRITES name_key, AND TWO OTHER PLACES READ IT. Change one and people
// stop matching their own records — which is what happened with accents until
// migration 0049. Keep all three the same:
//
//   supabase/migrations/0049_name_key_accents  training_name_key()
//   Agri-Service/.../PersonName.swift          PersonName.key(_:)
//
// The rule: an accented letter becomes the plain letter under it, everything
// else that isn't a-z is a gap, lower case. A letter that isn't an accented
// ASCII letter -- ø, ß, æ -- is not folded; NFD leaves it alone and it becomes
// a gap. 0049 carries the list of names all three are checked against.
const tsNameKey = (first, last) => `${first} ${last}`.normalize("NFD").replace(/[̀-ͯ]/g, "")
  .toLowerCase().replace(/[^a-z]+/g, " ").trim();

// "004217", or "4217" from a spreadsheet that dropped the zeros: the same
// person. Digits are padded back to six; anything else is kept, in capitals.
// The database's employee_number_key() is the same rule.
const tsEmployeeNumber = (value) => {
  const text = tsText(value);
  if (!text) return "";
  return /^\d+$/.test(text) ? text.replace(/^0+/, "").padStart(6, "0") : text.toUpperCase();
};

const tsStoreName = (store) => tsText(store).replace(/^store\s*-\s*\d+\s*-\s*/i, "") || "No store";

const tsIsTech = (job) => /\btechnician\b/i.test(job || "");

// Which export a file is, from its column headings — the file names don't matter.
function tsIdentify(rows) {
  const heads = [
    ["employees", "employees", ["firstname", "lastname", "email", "jobs", "store"]],
    ["history", "history", ["firstname", "lastname", "email", "course", "date completed"]],
    // Credits All Time: every credit earned, with emails. The one to use.
    ["credits", "all-time", ["firstname", "lastname", "email", "credit type", "credits number", "earned at"]],
    // The older Credit Rules Report: a total per rule, names but no emails.
    ["credits", "rules", ["first name", "last name", "credit rule", "credits", "completion"]]
  ];
  for (let i = 0; i < Math.min(rows.length, 40); i++) {
    const row = (rows[i] || []).map(c => tsText(c).toLowerCase());
    for (const [kind, format, names] of heads) {
      if (names.every(n => row.includes(n))) {
        const col = Object.fromEntries(row.map((name, index) => [name, index]));
        return { kind, format, headerIndex: i, col };
      }
    }
  }
  return null;
}

// "Export Date: Sep 18, 2026 MDT" from the lines above the table.
function tsExported(rows, headerIndex) {
  for (const row of rows.slice(0, headerIndex)) {
    const m = /^export date:\s*(.+)$/i.exec(tsText((row || [])[0]));
    if (m) return m[1];
  }
  return "";
}

// "2026-09-14 16:41:59 MDT", a spreadsheet date, or anything a browser reads.
function tsDate(value) {
  const text = tsText(value);
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const serial = excelDate(value);
  if (serial) return serial;
  const parsed = text ? new Date(text) : null;
  return parsed && !isNaN(parsed) ? parsed.toISOString().slice(0, 10) : null;
}

function tsParse(rows, file) {
  const found = tsIdentify(rows);
  if (!found) return null;
  const { kind, format, headerIndex, col } = found;
  const get = (row, name) => tsText(row[col[name]]);
  // Exports from before UKG added the column have none; everyone falls back to email.
  const number = (row) => "employee number" in col ? tsEmployeeNumber(row[col["employee number"]]) : "";
  const body = rows.slice(headerIndex + 1).filter(r => r && r.some(c => tsText(c)));
  const meta = { file: file.name, exported: tsExported(rows, headerIndex) };

  if (kind === "employees") {
    const list = body.map(r => ({
      first: get(r, "firstname"), last: get(r, "lastname"), email: get(r, "email").toLowerCase(),
      number: number(r),
      department: tsText(r[col["department"]]).replace(/^department\s*-\s*\d+\s*-\s*/i, ""),
      job: get(r, "jobs"), store: tsStoreName(get(r, "store"))
    })).filter(p => p.first || p.last);
    return { kind, data: { ...meta, rows: list } };
  }

  if (kind === "history") {
    const list = body.map(r => ({
      email: get(r, "email").toLowerCase(), number: number(r), first: get(r, "firstname"), last: get(r, "lastname"),
      course: get(r, "course"), completed: tsDate(r[col["date completed"]]),
      percent: parseFloat(get(r, "% completed")) || 0
    })).filter(h => h.course && h.completed && (h.percent >= 100 || !("% completed" in col)))
      .map(({ percent: _percent, ...h }) => h);
    return { kind, data: { ...meta, rows: list } };
  }

  if (format === "all-time") {
    // One row per credit ever earned. AGCO hours count toward the calendar
    // year they're earned in — the year the export was taken — and EPA 609
    // counts for life.
    const yearOf = (text) => (/\b(20\d\d)\b/.exec(text || "") || [])[1] || "";
    const exportYear = yearOf(meta.exported);
    const isAgco = (r) => /agco training hours/i.test(get(r, "credit type") + " " + get(r, "credits rule title"));
    const cycles = [...new Set(body.filter(isAgco).map(r => get(r, "credits period cycle")).filter(Boolean))]
      .sort((a, b) => yearOf(b).localeCompare(yearOf(a)));
    const period = cycles.find(c => yearOf(c) === exportYear) || cycles[0] || "";

    const people = new Map();
    for (const r of body) {
      const email = get(r, "email").toLowerCase(), num = number(r);
      const first = get(r, "firstname"), last = get(r, "lastname");
      if (!num && !email && !first && !last) continue;
      const key = num || email || `name:${tsNameKey(first, last)}`;
      const person = people.get(key)
        || { number: num, email, first, last, agcoHours: 0, agcoRequired: null, epa609: false, agcoEntries: [] };
      const rule = get(r, "credits rule title");
      const credits = parseFloat(get(r, "credits number")) || 0;
      const earned = tsDate(r[col["earned at"]]);
      if (isAgco(r)) {
        const inPeriod = period ? get(r, "credits period cycle") === period
          : !!earned && earned.startsWith(exportYear);
        if (inPeriod) {
          person.agcoHours += credits;
          person.agcoEntries.push({ hours: credits, earned, title: get(r, "external certificate title") });
        }
        const required = parseFloat((/number of credits:\s*([\d.]+)/i.exec(rule) || [])[1]);
        if (required) person.agcoRequired = required;
      } else if (/epa\s*609/i.test(get(r, "credit type") + " " + rule)) {
        person.epa609 = true;
      }
      people.set(key, person);
    }
    const list = [...people.values()].map(p => ({
      ...p, agcoRequired: p.agcoRequired || tsRequiredHours(),
      agcoMet: p.agcoHours >= tsRequiredHours(),
      agcoEntries: p.agcoEntries.sort((a, b) => (a.earned || "").localeCompare(b.earned || ""))
    }));
    return { kind, data: { ...meta, format, period: yearOf(period) || period || exportYear, rows: list } };
  }

  // The Credit Rules Report: one row per person per rule; kept as one row per person.
  const people = new Map();
  for (const r of body) {
    const first = get(r, "first name"), last = get(r, "last name");
    if (!first && !last) continue;
    const key = tsNameKey(first, last);
    const person = people.get(key) || { first, last, agcoHours: null, agcoRequired: null, agcoMet: null, epa609: null };
    const rule = get(r, "credit rule");
    const credits = parseFloat(get(r, "credits")) || 0;
    const done = /^100\s*%?$/.test(get(r, "completion"));
    const required = parseFloat((/number of credits:\s*([\d.]+)/i.exec(rule) || [])[1]);
    if (/agco training hours/i.test(rule)) {
      person.agcoHours = credits;
      person.agcoRequired = required || tsRequiredHours();
      person.agcoMet = done || credits >= tsRequiredHours();
    } else if (/epa\s*609/i.test(rule)) {
      person.epa609 = done || credits >= (required || 1);
    }
    people.set(key, person);
  }
  const list = [...people.values()].filter(p => p.agcoHours !== null || p.epa609 !== null);
  return { kind, data: { ...meta, format, rows: list } };
}

// ---- the model --------------------------------------------------------------------------

// The exports, joined into one row per employee, as the database stores them:
// by employee number, then by email. A name joins only the older Credit Rules
// Report, which has neither.
function tsPeopleFromRaw(raw) {
  const employees = (raw && raw.employees && raw.employees.rows) || [];
  const credits = (raw && raw.credits && raw.credits.rows) || [];
  const history = (raw && raw.history && raw.history.rows) || [];
  // Credits All Time lists everyone with a credit, so anyone missing simply has
  // none. The older Credit Rules Report only lists technicians, by name.
  const allTime = !!(raw && raw.credits && raw.credits.format === "all-time" && raw.credits.rows);
  const creditByNumber = new Map(credits.filter(c => c.number).map(c => [c.number, c]));
  const creditByEmail = new Map(credits.filter(c => c.email).map(c => [c.email, c]));
  // Only the older report, with no emails, is ever joined by name.
  const creditByName = new Map(credits.filter(c => !c.number && !c.email).map(c => [tsNameKey(c.first, c.last), c]));
  const classesByNumber = new Map(), classesByEmail = new Map();
  const file = (map, key, h) => { if (!map.has(key)) map.set(key, []); map.get(key).push(h); };
  for (const h of history) {
    if (h.number) file(classesByNumber, h.number, h);
    if (h.email) file(classesByEmail, h.email, h);
  }
  const seen = new Set();
  return employees.map(e => {
    const key = tsNameKey(e.first, e.last);
    const number = e.number || "";
    const credit = (number && creditByNumber.get(number)) || (e.email && creditByEmail.get(e.email))
      || creditByName.get(key);
    // By number; a class reported without one (an older export) by email.
    const theirs = number && classesByNumber.has(number)
      ? [...classesByNumber.get(number), ...(classesByEmail.get(e.email) || []).filter(h => !h.number)]
      : classesByEmail.get(e.email) || [];
    const classes = theirs.map(h => ({ course: h.course, completed: h.completed }))
      .sort((a, b) => b.completed.localeCompare(a.completed) || a.course.localeCompare(b.course));
    return {
      person_key: number || e.email || `name:${key}`, employee_number: number || null, email: e.email || null,
      first_name: e.first, last_name: e.last, name_key: key,
      department: e.department || "", job: e.job || "", store: e.store || "",
      is_technician: tsIsTech(e.job),
      agco_hours: credit ? credit.agcoHours : allTime ? 0 : null,
      agco_required: credit ? credit.agcoRequired : allTime ? tsRequiredHours() : null,
      agco_met: !!(credit && credit.agcoMet), epa_609: !!(credit && credit.epa609),
      in_credits: !!credit || allTime, classes,
      agco_entries: (credit && credit.agcoEntries) || []
    };
  }).filter(p => (p.first_name || p.last_name) && !seen.has(p.person_key) && seen.add(p.person_key));
}

// Whatever rows this person may see, worked into the metric.
function tsModel(rows = tsPeople) {
  const people = rows.map(r => ({
    key: r.person_key, number: r.employee_number || "", email: r.email || "", first: r.first_name, last: r.last_name,
    name: `${r.first_name} ${r.last_name}`.trim(), job: r.job, store: r.store || "No store",
    isTech: r.is_technician, hours: r.agco_hours === null || r.agco_hours === undefined ? null : Number(r.agco_hours),
    // "Met" is worked out here rather than read from agco_met, which was
    // decided at upload time against whatever the requirement was then.
    // Otherwise changing the hours would move every label and none of the
    // numbers.
    //
    // The setting decides for everyone. The report states a figure per person
    // too (requiredInReport), but AGCO changes the requirement long before the
    // reports catch up, and every technician on the roster has a report figure
    // — so a setting that only filled gaps would move nobody.
    required: tsRequiredHours(),
    requiredInReport: Number(r.agco_required) || null,
    met: (Number(r.agco_hours) || 0) >= tsRequiredHours(),
    epa609: !!r.epa_609,
    inCredits: !!r.in_credits, classes: r.classes || [], entries: r.agco_entries || []
  }));
  const byName = (a, b) => a.last.localeCompare(b.last) || a.first.localeCompare(b.first);
  const techs = people.filter(p => p.isTech).sort((a, b) => a.store.localeCompare(b.store) || byName(a, b));
  const metCount = techs.filter(t => t.met).length;
  const goalCount = Math.ceil(techs.length * tsGoal() - 1e-9);
  const years = new Set();
  people.forEach(p => p.classes.forEach(c => years.add(c.completed.slice(0, 4))));
  return {
    people: people.sort(byName), techs, metCount, goalCount,
    pct: techs.length ? metCount / techs.length : 0,
    neededForGoal: Math.max(0, goalCount - metCount),
    epaCount: techs.filter(t => t.epa609).length,
    stores: [...new Set(people.map(p => p.store))].sort((a, b) =>
      (a === "Field Support") - (b === "Field Support") || a.localeCompare(b)),
    missingCredits: techs.filter(t => !t.inCredits),
    years: [...years].sort().reverse()
  };
}

// "2026", the year the AGCO hours count toward.
const tsPeriod = () => (tsSources && tsSources.credits && tsSources.credits.period) || "";
const tsHoursHead = () => `AGCO hours${tsPeriod() ? ` (${esc(tsPeriod())})` : ""}`;

// "16 hrs · Level 4 Balers · Feb 11" for each credit that makes up the hours.
function tsEntries(t) {
  if (!t.entries || !t.entries.length) return "";
  return `<div class="ts-entries">${t.entries.map(e => `<span>${esc(e.hours)} hrs${e.title ? ` · ${esc(e.title)}` : ""}${
    e.earned ? ` · ${esc(newsDate(e.earned).replace(/, \d{4}$/, ""))}` : ""}</span>`).join("")}</div>`;
}

const tsPct = (n) => `${(Math.round(n * 1000) / 10).toFixed(1)}%`;

// ---- the page -----------------------------------------------------------------------------

function trainingStatusView() {
  const admin = isAdmin();
  const intro = hero(admin ? "Training Status" : "My Training",
    admin ? "Technician AGCO training hours against the dealer metric, EPA 609, and training history, from the latest UKG exports."
          : "Your AGCO training hours, EPA 609 and the classes you've completed, from the latest UKG exports.");
  if (trainingStatusError) {
    return intro + `<div class="card"><p class="note">${/does not exist|schema cache/i.test(trainingStatusError)
      ? "Training Status isn't switched on yet." : esc(trainingStatusError)}</p></div>`;
  }
  const model = tsModel();
  if (!admin) return intro + tsSelfView(model) + `<p class="note ts-sources">${tsSourcesNote(tsSources)}</p>`;
  if (!model.people.length) {
    const uploaded = tsSources && tsSources.employees && tsSources.employees.file;
    return intro + `<div class="card"><p class="note">${!uploaded ? "No reports yet. " + (isOwner()
      ? "Upload them on the Training dashboard, under Uploads → <b>Training Status</b>." : "The training department uploads them.")
      : "Nobody at your location is on the latest reports."}</p></div>`;
  }
  const scope = isOwner() ? "All locations" : myLocations().length > 1
    ? `Your locations: ${esc(myLocationNames().join(", "))}` : `Your location: ${esc(locations[profile.location_id] || "not set")}`;
  const tabs = [["summary", "Summary"], ["techs", "Technicians"], ["history", "History"], ["plan", "Planning"], ["classes", "Classes"]];
  return intro + `<div id="tsPage">
    <div class="row ts-tabs"><div class="chips" style="margin:0">${tabs.map(([id, label]) =>
      `<button class="chip${tsState.tab === id ? " on" : ""}" data-ts-tab="${id}">${label}</button>`).join("")}</div>
      <span class="pill">${scope}</span></div>
    <div id="tsBody">${tsBody(model)}</div>
    <p class="note ts-sources">${tsSourcesNote(tsSources)}</p></div>`;
}

// An employee's own record: hours toward 24, 609, and what they've taken.
function tsSelfView(m) {
  const own = tsMine();
  const mine = (own && m.people.find(p => p.key === own.person_key)) || m.people[0];
  if (!mine) {
    const number = profile && profile.employee_number;
    return `<div class="card"><b>No training record found for you yet</b>
      <p class="note" style="margin-bottom:0">Records are matched by your employee number${number ? ` (#${esc(number)})` : ""},
        then by your work email${me.email ? ` (${esc(me.email)})` : ""}. If UKG lists you under another number or
        address, ask the training department.</p></div>`;
  }
  const years = {};
  mine.classes.forEach(c => { (years[c.completed.slice(0, 4)] ||= []).push(c); });
  return `<div class="ts-cards">
      <div class="card ts-kpi"><small>${esc(mine.job.replace(/^\d+\s*-\s*/, "") || "Employee")} · ${esc(mine.store)}</small>
        <strong style="font-size:26px">${esc(mine.name)}</strong>
        ${mine.isTech ? `${mine.hours === null ? `<span class="note">Not on the credits report yet.</span>` : `
          <span>AGCO training hours${tsPeriod() ? ` in ${esc(tsPeriod())}` : " this year"}</span>${tsHoursCell(mine)}${tsEntries(mine)}
          <span>${mine.met ? `<span class="badge b-current">${tsRequiredHours()} hours met</span>`
            : `<span class="badge b-expired">${Math.max(0, mine.required - mine.hours)} more hours to reach ${mine.required}</span>`}
          ${mine.epa609 ? `<span class="badge b-current">EPA 609</span>` : `<span class="badge b-expired">No EPA 609 yet</span>`}</span>`}` : ""}
      </div></div>
    <div class="card"><h2>Classes completed</h2>
      ${Object.keys(years).length ? Object.keys(years).sort().reverse().map(y => `<div class="ts-year">${y}
        <span>${years[y].length}</span></div><ul class="ts-classes">${years[y].map(c =>
        `<li><span>${esc(c.course)}</span><time>${esc(newsDate(c.completed))}</time></li>`).join("")}</ul>`).join("")
      : `<p class="note">None on the OLT and ILT report yet.</p>`}
    </div>`;
}

function tsSourcesNote(sources) {
  if (!sources) return "";
  const part = (label, block) => block && (block.file || block.exported)
    ? `${label}${block.exported ? ` exported ${esc(block.exported)}` : ""}` : `${label} not uploaded`;
  return `From ${part("All employees", sources.employees)}; ${part(sources.credits && sources.credits.format === "rules"
    ? "Credit Rules" : "Credits All Time", sources.credits)}; ${
    part("OLT and ILT", sources.history)}.`;
}

function tsBody(model) {
  switch (tsState.tab) {
    case "techs": return tsTechsTab(model);
    case "history": return tsHistoryTab(model);
    case "plan": return tsPlanTab(model);
    // Who has and hasn't taken a class, which was its own Course Report page.
    case "classes": return `<div id="crPage">${crPageInner()}</div>`;
    default: return tsSummaryTab(model);
  }
}

// The bar with the goal's line on it.
function tsMeter(pct, projected = null) {
  return `<div class="ts-meter" role="img" aria-label="${tsPct(pct)} of technicians, goal ${tsGoalPercent()}%">
    ${projected !== null && projected > pct ? `<i class="ts-proj" style="width:${Math.min(100, projected * 100)}%"></i>` : ""}
    <i class="ts-now${pct >= tsGoal() ? " ok" : ""}" style="width:${Math.min(100, pct * 100)}%"></i>
    <b class="ts-goal" style="left:${tsGoalPercent()}%"><span>Goal ${tsGoalPercent()}%</span></b></div>`;
}

function tsSummaryTab(m) {
  const stores = m.stores.map(store => {
    const techs = m.techs.filter(t => t.store === store);
    if (!techs.length) return "";
    const met = techs.filter(t => t.met).length;
    const epa = techs.filter(t => t.epa609).length;
    return `<tr><td><b>${esc(store)}</b></td><td class="num">${techs.length}</td>
      <td class="num">${met}</td><td class="num">${tsPct(met / techs.length)}</td>
      <td class="num">${epa} of ${techs.length}</td></tr>`;
  }).join("");
  return `<div class="ts-cards">
      <div class="card ts-kpi">
        <small>Technicians with ${tsRequiredHours()}+ AGCO training hours</small>
        <strong class="${m.pct >= tsGoal() ? "ok" : "short"}">${tsPct(m.pct)}</strong>
        ${tsMeter(m.pct)}
        <span>${m.metCount} of ${m.techs.length} technicians. ${m.neededForGoal
          ? `<b>${m.neededForGoal} more</b> needed to reach ${tsGoalPercent()}%${isOwner() ? "" : " here"} (${m.goalCount} technicians).`
          : "The dealer metric is met."}</span>
      </div>
      <div class="card ts-kpi">
        <small>Technicians with an EPA 609 credit</small>
        <strong>${tsPct(m.techs.length ? m.epaCount / m.techs.length : 0)}</strong>
        <span>${m.epaCount} of ${m.techs.length} technicians. ${m.techs.length - m.epaCount} still need one.</span>
      </div>
    </div>
    <div class="card"><h2>By location</h2>
      <div style="overflow-x:auto"><table class="ts-table">
        <thead><tr><th>Location</th><th class="num">Technicians</th><th class="num">${tsRequiredHours()}+ hrs</th>
          <th class="num">%</th><th class="num">EPA 609</th></tr></thead>
        <tbody>${stores}</tbody></table></div></div>
    ${m.missingCredits.length ? `<p class="note">Not on the credits report, so counted as not met:
      ${m.missingCredits.map(t => esc(t.name)).join(", ")}.</p>` : ""}`;
}

function tsHoursCell(t) {
  if (t.hours === null) return `<span class="note">Not on the report</span>`;
  const pct = Math.min(100, (t.hours / t.required) * 100);
  return `<div class="ts-hours"><div class="ts-bar"><i class="${t.met ? "ok" : ""}" style="width:${pct}%"></i></div>
    <span>${t.hours} hrs</span></div>`;
}

function tsTechsTab(m) {
  const filters = [["all", "All technicians"], ["hours", `Still need ${tsRequiredHours()} hrs`], ["609", "Missing 609"]];
  const keep = (t) => tsState.filter === "hours" ? !t.met : tsState.filter === "609" ? !t.epa609 : true;
  const groups = m.stores.map(store => {
    const techs = m.techs.filter(t => t.store === store && keep(t));
    if (!techs.length) return "";
    return `<tr class="ts-group"><td colspan="4">${esc(store)} <span>${techs.length}</span></td></tr>` +
      techs.map(t => `<tr><td><b>${esc(t.name)}</b><div class="note">${esc(t.job.replace(/^\d+\s*-\s*/, ""))}</div></td>
        <td>${tsHoursCell(t)}${tsEntries(t)}</td>
        <td>${t.met ? `<span class="badge b-current">Met</span>`
          : `<span class="badge b-expired">Needs ${Math.max(0, t.required - (t.hours || 0))} hrs</span>`}</td>
        <td>${t.epa609 ? `<span class="badge b-current">Yes</span>` : `<span class="badge b-expired">No</span>`}</td></tr>`).join("");
  }).join("");
  return `<div class="chips">${filters.map(([id, label]) =>
      `<button class="chip${tsState.filter === id ? " on" : ""}" data-ts-filter="${id}">${label}</button>`).join("")}</div>
    <div class="card" style="padding:0;overflow:hidden"><div style="overflow-x:auto"><table class="ts-table">
      <thead><tr><th>Technician</th><th>${tsHoursHead()}</th><th>24 hrs</th><th>EPA 609</th></tr></thead>
      <tbody>${groups || `<tr><td colspan="4" class="note">Nobody — everyone's there.</td></tr>`}</tbody>
    </table></div></div>`;
}

function tsHistoryTab(m) {
  const store = tsState.store && m.stores.includes(tsState.store) ? tsState.store
    : (m.stores.find(s => m.techs.some(t => t.store === s)) || m.stores[0]);
  const year = tsState.year && m.years.includes(tsState.year) ? tsState.year : (tsState.year === "all" ? "all" : m.years[0] || "all");
  const pool = tsState.everyone ? m.people : m.techs;
  const count = (s) => pool.filter(p => p.store === s).length;
  const people = pool.filter(p => p.store === store);
  const rows = people.map(p => {
    const classes = p.classes.filter(c => year === "all" || c.completed.startsWith(year));
    return `<tr><td><b>${esc(p.name)}</b><div class="note">${esc(p.job.replace(/^\d+\s*-\s*/, ""))}</div>
        ${p.isTech ? `<div class="ts-tags">${p.hours !== null ? `<span class="pill">${p.hours} AGCO hrs</span>` : ""}
          <span class="pill">${p.epa609 ? "609 ✓" : "No 609"}</span></div>` : ""}</td>
      <td>${classes.length ? `<ul class="ts-classes">${classes.map(c =>
        `<li><span>${esc(c.course)}</span><time>${esc(newsDate(c.completed))}</time></li>`).join("")}</ul>` : "—"}</td>
      <td class="num">${classes.length}</td></tr>`;
  }).join("");
  return `<div class="chips">${m.stores.filter(s => count(s)).map(s =>
      `<button class="chip${s === store ? " on" : ""}" data-ts-store="${esc(s)}">${esc(s)} <span class="ts-n">${count(s)}</span></button>`).join("")}</div>
    <div class="row" style="margin:-2px 0 12px">
      <label class="check" style="margin:0"><input type="checkbox" data-ts-everyone ${tsState.everyone ? "checked" : ""}>
        Everyone, not just technicians</label>
      <select data-ts-year style="width:auto;margin:0">
        ${m.years.map(y => `<option value="${y}"${y === year ? " selected" : ""}>${y}</option>`).join("")}
        <option value="all"${year === "all" ? " selected" : ""}>All years</option></select>
    </div>
    <div class="card" style="padding:0;overflow:hidden"><div style="overflow-x:auto"><table class="ts-table">
      <thead><tr><th>${esc(store)} (${people.length})</th><th>Classes completed${year === "all" ? "" : " in " + year}</th>
        <th class="num">Total</th></tr></thead>
      <tbody>${rows || `<tr><td colspan="3" class="note">Nobody here.</td></tr>`}</tbody></table></div></div>`;
}

function tsPlanNumbers(m) {
  const planned = m.techs.filter(t => !t.met && tsPlan.has(t.key)).length;
  const projected = m.techs.length ? (m.metCount + planned) / m.techs.length : 0;
  return { planned, projected, stillNeeded: Math.max(0, m.goalCount - m.metCount - planned) };
}

function tsPlanTab(m) {
  const n = tsPlanNumbers(m);
  const groups = m.stores.map(store => {
    const techs = m.techs.filter(t => t.store === store);
    if (!techs.length) return "";
    return `<tr class="ts-group"><td colspan="3">${esc(store)} <span>${techs.filter(t => t.met).length} of ${techs.length} met</span></td></tr>` +
      techs.map(t => `<tr class="${t.met ? "ts-met" : ""}">
        <td><label class="check" style="margin:0"><input type="checkbox" data-ts-plan="${esc(t.key)}"
          ${t.met || tsPlan.has(t.key) ? "checked" : ""} ${t.met ? "disabled" : ""}> <b>${esc(t.name)}</b></label></td>
        <td>${tsHoursCell(t)}</td>
        <td>${t.met ? `<span class="badge b-current">Met</span>` : tsPlan.has(t.key)
          ? `<span class="badge b-answered">Planned</span>` : `<span class="note">Needs ${Math.max(0, t.required - (t.hours || 0))} hrs</span>`}</td></tr>`).join("");
  }).join("");
  return `<div class="ts-cards">
      <div class="card ts-kpi"><small>Now</small><strong>${tsPct(m.pct)}</strong>
        <span>${m.metCount} of ${m.techs.length} technicians have ${tsRequiredHours()}+ hours.</span></div>
      <div class="card ts-kpi"><small>With the plan</small>
        <strong class="${n.projected >= tsGoal() ? "ok" : "short"}">${tsPct(n.projected)}</strong>
        ${tsMeter(m.pct, n.projected)}
        <span>${n.planned} planned. ${n.stillNeeded
          ? `<b>${n.stillNeeded} more</b> to reach ${tsGoalPercent()}%.`
          : `That reaches ${tsGoalPercent()}%.`}</span></div>
    </div>
    <div class="row" style="margin:0 0 12px">
      <span class="note" style="flex:1">Tick the technicians you plan to get to ${tsRequiredHours()} hours. Your plan is saved to your
        account, so it's the same in the app, and nobody else sees it.</span>
      <button class="ghost" data-ts-clear ${n.planned ? "" : "disabled"}>Clear plan</button>
      <span class="msg" id="tsPlanMsg"></span></div>
    <div class="card" style="padding:0;overflow:hidden"><div style="overflow-x:auto"><table class="ts-table">
      <thead><tr><th>Technician</th><th>${tsHoursHead()}</th><th></th></tr></thead>
      <tbody>${groups}</tbody></table></div></div>`;
}

function tsRedraw() {
  const body = $("tsBody");
  if (!body) return;
  body.innerHTML = tsBody(tsModel());
  document.querySelectorAll("[data-ts-tab]").forEach(b => b.classList.toggle("on", b.dataset.tsTab === tsState.tab));
}

let tsSaveTimer = null;
function tsSavePlan() {
  clearTimeout(tsSaveTimer);
  tsSaveTimer = setTimeout(async () => {
    const { error } = await db.from("training_plans")
      .upsert({ planned: [...tsPlan] }, { onConflict: "user_id" });
    const msg = $("tsPlanMsg");
    if (msg) {
      msg.textContent = error ? `Not saved: ${error.message}` : "Saved";
      msg.className = "msg " + (error ? "error" : "ok");
    }
  }, 500);
}

document.addEventListener("click", (event) => {
  const tab = event.target.closest("[data-ts-tab]");
  if (tab) { tsState.tab = tab.dataset.tsTab; return tsRedraw(); }
  const filter = event.target.closest("[data-ts-filter]");
  if (filter) { tsState.filter = filter.dataset.tsFilter; return tsRedraw(); }
  const store = event.target.closest("[data-ts-store]");
  if (store) { tsState.store = store.dataset.tsStore; return tsRedraw(); }
  if (event.target.closest("[data-ts-clear]")) {
    if (!confirm("Clear every planned tick?")) return;
    tsPlan.clear();
    tsRedraw();
    return tsSavePlan();
  }
});

document.addEventListener("change", (event) => {
  const box = event.target.closest("[data-ts-plan]");
  if (box) {
    const key = box.dataset.tsPlan;
    if (box.checked) tsPlan.add(key); else tsPlan.delete(key);
    tsRedraw();
    if (document.body.classList.contains("training-mode")) renderTrainingOverview();
    if (document.body.classList.contains("location-mode")) renderLocationOverview();
    return tsSavePlan();
  }
  if (event.target.matches("[data-ts-everyone]")) { tsState.everyone = event.target.checked; return tsRedraw(); }
  if (event.target.matches("[data-ts-year]")) { tsState.year = event.target.value; return tsRedraw(); }
});

// ---- admin: uploading ---------------------------------------------------------------------

const TS_KINDS = { employees: "All employees", credits: "Credits All Time", history: "OLT and ILT" };

async function tsReadFiles(files) {
  const problems = [];
  for (const file of files) {
    let rows;
    try { rows = await rowsFromFile(file); }
    catch (e) { problems.push(`${file.name}: couldn't be read (${e.message}).`); continue; }
    const parsed = tsParse(rows, file);
    if (!parsed) { problems.push(`${file.name}: not one of the three reports — its columns don't match.`); continue; }
    if (!parsed.data.rows.length) { problems.push(`${file.name}: the ${TS_KINDS[parsed.kind]} report has no rows.`); continue; }
    tsPending[parsed.kind] = parsed.data;
  }
  renderTsImport(problems);
}

function renderTsImport(problems = []) {
  const box = $("tsResult");
  if (!box) return;
  const kinds = Object.keys(TS_KINDS).filter(k => tsPending[k]);
  if (!kinds.length && !problems.length) { box.innerHTML = ""; return; }

  // What it would look like with these files over what's published now.
  const merged = { ...(tsRaw || {}), ...Object.fromEntries(kinds.map(k => [k, tsPending[k]])) };
  const rows = tsPeopleFromRaw(merged);
  const m = tsModel(rows);
  const jobs = {};
  m.techs.forEach(t => { jobs[t.job] = (jobs[t.job] || 0) + 1; });
  const has = (k) => merged[k] && merged[k].rows;
  const staff = (merged.employees && merged.employees.rows) || [];
  const knownNumbers = new Set(staff.map(e => e.number).filter(Boolean));
  const knownNames = new Set(staff.map(e => tsNameKey(e.first, e.last)));
  const knownEmails = new Set(staff.map(e => e.email).filter(Boolean));
  const creditRows = (merged.credits && merged.credits.rows) || [];
  const unmatched = creditRows.filter(c => !(c.number && knownNumbers.has(c.number))
    && !(c.email && knownEmails.has(c.email)) && !(!c.number && !c.email && knownNames.has(tsNameKey(c.first, c.last))));
  // Who has no employee number, so their records are kept against their email.
  const unnumbered = has("employees") ? staff.filter(e => !e.number) : [];
  // Only the older Credit Rules Report, with neither numbers nor emails, finds
  // people by name; two employees with one name can't be told apart there.
  const byNameOnly = creditRows.some(c => !c.number && !c.email);
  const nameCount = {};
  staff.forEach(e => { const k = tsNameKey(e.first, e.last); if (k) nameCount[k] = (nameCount[k] || 0) + 1; });
  const sharedNames = staff.filter((e, i, all) => nameCount[tsNameKey(e.first, e.last)] > 1
    && all.findIndex(x => tsNameKey(x.first, x.last) === tsNameKey(e.first, e.last)) === i)
    .map(e => `${e.first} ${e.last}`.trim());
  const appStores = new Set(allLocations.map(l => l.name.toLowerCase()));
  const strayStores = m.stores.filter(s => s !== "No store" && !appStores.has(s.toLowerCase())
    && m.people.some(p => p.store === s));

  box.innerHTML = `${problems.map(p => `<p class="error">${esc(p)}</p>`).join("")}
    ${kinds.length ? `<div class="role" style="margin-top:12px">
      <b>Ready to publish</b>
      <ul class="note" style="margin:6px 0 10px">${kinds.map(k => `<li><b>${TS_KINDS[k]}</b> — ${esc(tsPending[k].file)}${
        tsPending[k].exported ? `, exported ${esc(tsPending[k].exported)}` : ""}: ${tsPending[k].rows.length} ${
        k === "history" ? "completions" : k === "credits" ? "people" : "employees"}</li>`).join("")}</ul>
      ${!has("employees") ? `<p class="error" style="margin:0 0 6px">All employees hasn't been uploaded yet — it's needed
        before anything can be published.</p>` : ""}
      ${m.techs.length ? `<p class="note" style="margin:0 0 6px">That makes <b>${m.techs.length} technicians</b>
        (${Object.entries(jobs).map(([job, n]) => `${esc(job.replace(/^\d+\s*-\s*/, ""))} ${n}`).join(", ")}),
        <b>${m.metCount}</b> with 24+ hours — <b>${tsPct(m.pct)}</b>.</p>` : ""}
      ${m.missingCredits.length && has("credits") ? `<p class="note" style="margin:0 0 6px">Technicians not on the
        credits report (counted as not met): ${m.missingCredits.map(t => esc(t.name)).join(", ")}.</p>` : ""}
      ${unmatched.length && has("employees") ? `<p class="note" style="margin:0 0 6px">On the credits report but not
        in All employees, so left out: ${unmatched.map(c => esc(c.first + " " + c.last)).join(", ")}.</p>` : ""}
      ${sharedNames.length && byNameOnly ? `<p class="error" style="margin:0 0 6px">Two or more people on All employees
        share a name: ${sharedNames.map(esc).join(", ")}. This credits report has no employee numbers or emails, so it finds
        people by name, and their AGCO hours can't be told apart: check theirs by hand in UKG.</p>` : ""}
      ${unnumbered.length ? `<p class="note" style="margin:0 0 6px">${unnumbered.length === staff.length
        ? `This All employees export has no Employee Number column, so everyone's records are kept against their email.
           Export it again with the column to key them by number.`
        : `No employee number on All employees, so kept against their email: ${unnumbered.map(e => esc(`${e.first} ${e.last}`.trim())).join(", ")}.`}</p>` : ""}
      ${strayStores.length ? `<p class="note" style="margin:0 0 6px">Stores with no location of the same name in the app,
        so no location admin sees them (owners still do): ${strayStores.map(esc).join(", ")}. Rename the location under
        Groups &amp; Locations to match.</p>` : ""}
      <div class="row"><button data-act="ts-publish" ${has("employees") ? "" : "disabled"}>Publish</button>
        <button class="ghost" data-act="ts-discard">Discard</button><span class="msg"></span></div>
    </div>` : ""}`;
}

function renderTsLive() {
  // The reports read the same uploads.
  renderReports();
  const box = $("tsLive");
  if (!box) return;
  if (trainingStatusError) {
    box.innerHTML = `<p class="error">${/does not exist|schema cache/i.test(trainingStatusError)
      ? "Run migration 0043_training_status.sql in the SQL editor, then reload this page." : esc(trainingStatusError)}</p>`;
    return;
  }
  const goalInput = $("tsGoalInput");
  if (goalInput && document.activeElement !== goalInput) goalInput.value = tsGoalPercent();
  const hoursInput = $("tsHoursInput");
  if (hoursInput && document.activeElement !== hoursInput) hoursInput.value = tsRequiredHours();
  const courseInput = $("craneCourseInput");
  if (courseInput && document.activeElement !== courseInput) courseInput.value = craneCourse();
  const monthsInput = $("craneMonthsInput");
  if (monthsInput && document.activeElement !== monthsInput) monthsInput.value = craneValidMonths() || "";
  if (!tsSources || !(tsSources.employees && tsSources.employees.file)) {
    box.innerHTML = `<p class="note">Nothing published yet.</p>`;
    return;
  }
  const m = tsModel();
  box.innerHTML = `<ul class="note" style="margin:0 0 8px">${Object.entries(TS_KINDS).map(([k, label]) => {
      const block = tsSources[k];
      return `<li><b>${label}</b>: ${block && block.file ? `${esc(block.file)}${block.exported
        ? `, exported ${esc(block.exported)}` : ""}` : "not uploaded yet"}</li>`;
    }).join("")}</ul>
    <p class="note" style="margin:0">Published ${esc(new Date(tsSources.updated_at).toLocaleString())}.
      ${m.people.length} employees, ${m.techs.length} technicians, ${m.metCount} at 24+ hours (${tsPct(m.pct)}).</p>`;
}

$("tsFile").addEventListener("change", (e) => { tsReadFiles([...e.target.files]); e.target.value = ""; });
["dragenter", "dragover"].forEach(type =>
  $("tsDrop").addEventListener(type, (e) => { e.preventDefault(); $("tsDrop").classList.add("over"); }));
["dragleave", "drop"].forEach(type =>
  $("tsDrop").addEventListener(type, () => $("tsDrop").classList.remove("over")));
$("tsDrop").addEventListener("drop", (e) => { e.preventDefault(); tsReadFiles([...e.dataTransfer.files]); });

$("admin").addEventListener("click", async (event) => {
  const button = event.target.closest('button[data-act="ts-goal"]');
  if (!button) return;
  const card = $("tsGoalCard");
  const value = Number($("tsGoalInput").value);
  const hours = Number($("tsHoursInput").value);
  if (!(value > 0 && value <= 100)) return speak(card, "Enter a percentage from 1 to 100.", true);
  if (!(hours > 0 && hours <= 200)) return speak(card, "Enter the hours as a number from 1 to 200.", true);

  // Changing the hours re-decides who has met the requirement, so say how
  // many people move before it is saved rather than after.
  const before = tsRequiredHours();
  if (hours !== before) {
    const techs = tsPeople.filter(r => r.is_technician);
    const metNow = techs.filter(r => (Number(r.agco_hours) || 0) >= before).length;
    const metAfter = techs.filter(r => (Number(r.agco_hours) || 0) >= hours).length;
    if (!confirm(
          `Change the requirement from ${before} to ${hours} hours?\n\n` +
          `It applies to every technician. ${metNow} of ${techs.length} have met it now; `
          + `${metAfter} of ${techs.length} would meet ${hours}.\n\n` +
          `Nothing needs re-uploading — the app and this page work it out live.`)) return;
  }

  button.disabled = true;
  const { data, error } = await db.from("training_status")
    .upsert({ id: "current", goal_percent: value, required_hours: hours }, { onConflict: "id" })
    .select("goal_percent, required_hours");
  button.disabled = false;
  if (error) return speak(card, error.message, true);
  if (!data || !data.length) return speak(card, "Not saved — only an owner can change this.", true);
  await loadTrainingStatus();
  renderTsLive();
  speak(card, `Saved. ${tsGoalPercent()}% of technicians with ${tsRequiredHours()}+ hours.`, false);
});

$("admin").addEventListener("click", async (event) => {
  const button = event.target.closest('button[data-act="crane-months"]');
  if (!button) return;
  const card = $("craneExpiryRow");
  const raw = $("craneMonthsInput").value.trim();
  const months = raw === "" ? null : Number(raw);
  if (months !== null && !(Number.isInteger(months) && months >= 1 && months <= 240)) {
    return speak(card, "Enter whole months from 1 to 240, or leave it empty for no expiration.", true);
  }
  if (months === craneValidMonths()) return speak(card, "That's already the setting.", false);
  // Say how many people it would take off the qualified list before saving.
  if (months) {
    const today = new Date(new Date().toDateString());
    const lapsed = tsPeople.filter(r => { const c = craneCompletion(r); return c && craneExpiry(c, months) < today; }).length;
    if (!confirm(`Make the Crane & Rigging Qualification last ${months} months from the day the course was completed?\n\n`
        + (lapsed ? `${lapsed} ${lapsed === 1 ? "person's qualification" : "people's qualifications"} would show as expired straight away, `
          + `in the app and on this page, until they take the course again.`
          : "Nobody's qualification would expire straight away."))) return;
  }
  button.disabled = true;
  const { data, error } = await db.from("training_status")
    .upsert({ id: "current", crane_valid_months: months }, { onConflict: "id" }).select("crane_valid_months");
  button.disabled = false;
  if (error) return speak(card, /crane_valid_months/.test(error.message)
    ? "Run migration 0087_crane_expiry_setting.sql in the SQL editor first." : error.message, true);
  if (!data || !data.length) return speak(card, "Not saved — only an owner can change this.", true);
  await loadTrainingStatus();
  renderTsLive();
  redrawCrane();
  speak(card, months ? `Saved. A qualification now lasts ${months} months.` : "Saved. The qualification doesn't expire.", false);
});

$("admin").addEventListener("click", async (event) => {
  const button = event.target.closest('button[data-act="crane-course"]');
  if (!button) return;
  const card = $("craneCourseCard");
  const value = $("craneCourseInput").value.trim().replace(/\s+/g, " ");
  if (!value) return speak(card, "Type the course name as it appears on the report.", true);

  // Saving a name nothing matches would quietly un-qualify everyone, so say
  // so first. It can still be saved — the report may be uploaded later.
  const matches = tsPeople.filter(r => (r.classes || [])
    .some(c => craneCourseKey(c.course) === craneCourseKey(value))).length;
  if (!matches && !confirm(
        `Nothing on the current report is called "${value}".\n\n` +
        `Saving this means nobody is qualified for crane and rigging work ` +
        `until a report with that course is uploaded.\n\nSave it anyway?`)) return;

  button.disabled = true;
  const { data, error } = await db.from("training_status")
    .upsert({ id: "current", crane_course: value }, { onConflict: "id" }).select("crane_course");
  button.disabled = false;
  if (error) return speak(card, error.message, true);
  if (!data || !data.length) return speak(card, "Not saved — only an owner can change this.", true);
  await loadTrainingStatus();
  renderTsLive();
  redrawCrane();
  speak(card, `Saved. ${matches} ${matches === 1 ? "person is" : "people are"} qualified by `
             + `"${value}".`, false);
});

$("admin").addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-act]");
  if (!button || !["ts-publish", "ts-discard"].includes(button.dataset.act)) return;
  if (button.dataset.act === "ts-discard") {
    tsPending = { employees: null, credits: null, history: null };
    return renderTsImport();
  }
  const card = button.closest(".role");
  const raw = {};
  Object.keys(TS_KINDS).forEach(k => { if (tsPending[k]) raw[k] = tsPending[k]; });
  const people = tsPeopleFromRaw({ ...(tsRaw || {}), ...raw });
  button.disabled = true;
  speak(card, "Publishing…", false);
  const { error } = await db.rpc("publish_training_status", { raw, people });
  button.disabled = false;
  if (error) return speak(card, error.message, true);
  tsPending = { employees: null, credits: null, history: null };
  await loadTrainingStatus();
  renderTsImport();
  renderTsLive();
  $("tsResult").innerHTML = `<p class="ok" style="margin-top:12px">Published. The app shows it the next time Training Status is opened.</p>`;
  // The AGCO maps follow the roster: a new technician gets one straight away.
  await agcoRebuild();
  renderAgcoLive();
  renderAgcoTechs();
});

// The signed-in person's own training row: by their employee number, then
// their work email, as the database's rule does. Never by name: an owner or
// admin sees other people's rows, and a namesake's must never come back as theirs.
function tsMine() {
  const number = (profile && profile.employee_number) || "";
  const email = ((me && me.email) || "").toLowerCase();
  return (number && tsPeople.find(r => r.employee_number === number))
    || (email && tsPeople.find(r => (r.email || "").toLowerCase() === email)) || null;
}

// ---------------------------------------------------------------- course report
//
// One class, and who has and hasn't taken it: Training Status's Classes tab,
// as in the app (CourseReportTab.swift), for location admins and owners. It
// was its own Course Report page. It reads the same uploads as the rest of
// Training Status, so it needs no data of its own and has the same reach: an admin sees their own location, an owner everyone. That's the
// database's answer, not this page's, which is why the report says whose list
// it is.
//
// "Hasn't taken it" means everyone visible with no completion of that class,
// which is only as good as the last upload. The foot of the page says when
// that was.

let crState = { course: null, search: "", filter: "notTaken", techs: false };

const CR_FILTERS = [["notTaken", "Not taken"], ["taken", "Taken"], ["all", "Everyone"]];

// The newest completion of a class, or null.
function crCompletion(person, course) {
  return person.classes.filter(c => c.course === course)
    .reduce((best, c) => !best || c.completed > best.completed ? c : best, null);
}

// "Twin Falls · Technician Master", from "4070 - Technician Master".
const crShopJob = (p) => [p.store, (p.job || "").replace(/^\d+\s*-\s*/, "")].filter(Boolean).join(" · ");

// Every class anyone visible has completed, with how many people took it.
function crCourses(model) {
  const counts = new Map();
  model.people.forEach(p => new Set(p.classes.map(c => c.course)).forEach(name =>
    counts.set(name, (counts.get(name) || 0) + 1)));
  return [...counts].map(([name, count]) => ({ name, count }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));
}

// Who's on the list, by location then surname, and how many have taken it.
function crList(model) {
  const pool = crState.techs ? model.techs : model.people;
  const course = crState.course;
  const taken = pool.filter(p => crCompletion(p, course));
  const shown = crState.filter === "notTaken" ? pool.filter(p => !crCompletion(p, course))
    : crState.filter === "taken" ? taken : pool;
  const byShop = (a, b) => a.store.localeCompare(b.store) || a.last.localeCompare(b.last)
    || a.first.localeCompare(b.first);
  return { pool, taken: taken.length, shown: [...shown].sort(byShop) };
}
