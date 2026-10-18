// The Crane Center
//
// The Crane & Rigging Qualification (from the course on Training Status),
// the Crane Center page, lift plans in the admin table, and a lift plan's PDF.

// ---- crane and rigging ---------------------------------------------------

// ---- crane & rigging qualification (migration 0045) ------------------------------------
//
// Qualified means the qualifying course (a setting, see craneCourse below) is
// on the person's training history
// (the OLT and ILT report uploaded for Training Status). It lasts as long as
// the setting says, from the day the course was completed — or for good, while
// the setting is empty, which is how it starts (migration 0087). A location
// admin or owner can remove it with a reason and restore it — only for someone
// who has taken the course; the database enforces that.

// Which course qualifies someone is a SETTING (migration 0051), not a
// constant: UKG renames courses, and a rename used to mean editing this file,
// the app and a migration. The name below is only what to show before the
// settings have loaded, or if they can't be reached.
const CRANE_COURSE_FALLBACK = "Lifting and Rigging ILT";
const craneCourse = () => {
  const named = tsText(tsSources && tsSources.crane_course).trim();
  return named || CRANE_COURSE_FALLBACK;
};
// Course names are typed by people: "Lifting and Rigging ILT" and
// "lifting and  rigging ilt" are the same course. Must match course_key() in
// the database and CranePerson.courseKey in the app.
const craneCourseKey = (name) => tsText(name).toLowerCase().replace(/\s+/g, " ").trim();

let craneOverrides = new Map(), craneError = null, craneFilter = "all";

async function loadCrane() {
  const { data, error } = await db.from("crane_qualification_overrides")
    .select("person_key, revoked, reason, changed_by_name, changed_at");
  craneError = error ? error.message : null;
  craneOverrides = new Map((data || []).map(o => [o.person_key, o]));
}

const craneCompletion = (row) => {
  const wanted = craneCourseKey(craneCourse());
  return (row.classes || []).find(c => craneCourseKey(c.course) === wanted) || null;
};

// How many months a qualification lasts, or null for no expiration (0087).
const craneValidMonths = () => {
  const n = Number(tsSources && tsSources.crane_valid_months);
  return n > 0 && n <= 240 ? n : null;
};
// The day it runs out: that many months after the course was completed.
function craneExpiry(completion, months = craneValidMonths()) {
  if (!months || !completion || !completion.completed) return null;
  const d = dateOnly(completion.completed);
  const day = d.getDate();
  d.setDate(1); d.setMonth(d.getMonth() + months);
  d.setDate(Math.min(day, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()));
  return d;
}
const craneDay = (d) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

function craneStatus(row) {
  const completion = craneCompletion(row);
  if (!completion) return { kind: "none" };
  const change = craneOverrides.get(row.person_key);
  if (change && change.revoked) return { kind: "removed", change, completion };
  const expires = craneExpiry(completion);
  if (expires && expires < new Date(new Date().toDateString())) return { kind: "expired", completion, expires };
  return { kind: "qualified", completion, expires };
}

const craneMine = tsMine;

const warnIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 2 20h20L12 3Z"/><path d="M12 10v4M12 17.5v.01"/></svg>';

function craneCard() {
  if (trainingStatusError || craneError) return "";
  const mine = craneMine();
  const status = mine ? craneStatus(mine) : { kind: "none" };
  if (status.kind === "qualified") {
    return `<div class="cert">
      <div class="band">QUALIFIED CRANE &amp; RIGGING</div>
      <div class="body">
        <div class="name">${esc((profile && profile.full_name) || `${mine.first_name} ${mine.last_name}`)}</div>
        <span class="badge b-current">Qualified</span>
        <dl>
          <div><dt>Course</dt><dd>${craneCourse()}</dd></div>
          <div><dt>Completed</dt><dd>${esc(newsDate(status.completion.completed))}</dd></div>
          <div><dt>Location</dt><dd>${esc(mine.store || "-")}</dd></div>
          <div><dt>Expires</dt><dd>${status.expires ? esc(craneDay(status.expires)) : "No expiration"}</dd></div>
        </dl>
        <p class="note" style="margin-top:16px">Issued by the Agri-Service Training Department</p>
      </div>
    </div>`;
  }
  if (status.kind === "removed") {
    return `<div class="crane-alert removed">${warnIcon}<div>
      <b>Qualification removed</b>
      <p>${esc(status.change.changed_by_name)} removed it on ${esc(new Date(status.change.changed_at).toLocaleDateString())}.
        Speak to your location admin.</p>
      ${status.change.reason ? `<q>${esc(status.change.reason)}</q>` : ""}</div></div>`;
  }
  if (status.kind === "expired") {
    return `<div class="crane-alert removed">${warnIcon}<div>
      <b>Qualification expired</b>
      <p>Your Crane &amp; Rigging Qualification ran out on ${esc(craneDay(status.expires))}, ${craneValidMonths()} months after you
        completed ${craneCourse()} on ${esc(newsDate(status.completion.completed))}. Take the course again to be qualified;
        ask the training department when the next class is.</p></div></div>`;
  }
  return `<div class="crane-alert caution">${warnIcon}<div>
    <b>Not qualified yet</b>
    <p>You're qualified for crane and rigging work once the ${craneCourse()} course shows on your
      training history${mine ? "" : " — and your training record wasn't found"}. Ask the training
      department when the next class is.</p></div></div>`;
}

// Admins and owners: everyone they look after, with Remove and Restore.
function craneAdminSection() {
  if (!isAdmin() || trainingStatusError || craneError || !tsPeople.length) return "";
  const myKey = (tsMine() || {}).person_key;
  const rows = tsPeople.map(r => ({ r, st: craneStatus(r) }))
    .filter(x => craneFilter === "all" || x.st.kind === craneFilter)
    .sort((a, b) => (a.r.store || "").localeCompare(b.r.store || "") || a.r.last_name.localeCompare(b.r.last_name));
  const counts = { qualified: 0, expired: 0, removed: 0, none: 0 };
  tsPeople.forEach(r => { counts[craneStatus(r).kind]++; });
  const filters = [["all", "All", tsPeople.length], ["qualified", "Qualified", counts.qualified],
    ...(craneValidMonths() || counts.expired ? [["expired", "Expired", counts.expired]] : []),
    ["removed", "Removed", counts.removed], ["none", "Not taken", counts.none]];
  return `<section id="craneAdmin">
    <div class="group-title">Crane qualifications</div>
    <p class="osr-desc">${isOwner() ? "Everyone" : "Everyone at your location"}. Qualified means ${esc(craneCourse())} is on
      their training history${craneValidMonths() ? `, completed in the last ${craneValidMonths()} months` : ""}. You can remove a
      qualification, with a reason, and restore it — only for someone who has taken the course, and never your own.</p>
    <div class="cab-pills">${filters.map(([id, label, n]) =>
      `<button type="button" class="cab-pill${craneFilter === id ? " on" : ""}" data-crane-filter="${id}">${label}<span>${n}</span></button>`).join("")}</div>
    <div class="crane-scroll"><table class="crane-table">
      <thead><tr><th>Name</th>${isOwner() ? `<th class="loc">Location</th>` : ""}<th>Status</th><th></th></tr></thead>
      <tbody>${rows.map(({ r, st }) => `<tr>
        <td><span class="who">${esc(r.first_name)} ${esc(r.last_name)}</span>
          <span class="why">${esc((r.job || "").replace(/^\d+\s*-\s*/, ""))}</span>
          ${isOwner() ? `<span class="why where">${esc(r.store || "-")}</span>` : ""}</td>
        ${isOwner() ? `<td class="loc">${esc(r.store || "-")}</td>` : ""}
        <td>${st.kind === "qualified" ? `<span class="cab-tag ok">Qualified</span>
              <span class="why">${esc(newsDate(st.completion.completed))}${st.expires ? ` · expires ${esc(craneDay(st.expires))}` : ""}</span>`
          : st.kind === "expired" ? `<span class="cab-tag exp">Expired</span>
              <span class="why">${esc(craneDay(st.expires))} · completed ${esc(newsDate(st.completion.completed))}</span>`
          : st.kind === "removed" ? `<span class="cab-tag off">Removed</span>
              <span class="why">by ${esc(st.change.changed_by_name)}, ${esc(new Date(st.change.changed_at).toLocaleDateString())}:
              ${esc(st.change.reason)}</span>`
          : `<span class="cab-tag none">Not taken</span>`}</td>
        <td style="white-space:nowrap;text-align:right">${r.person_key === myKey || st.kind === "none" || st.kind === "expired" ? ""
          : st.kind === "qualified" ? `<button type="button" class="quiet" data-crane="remove" data-key="${esc(r.person_key)}">Remove</button>`
          : `<button type="button" class="quiet" data-crane="restore" data-key="${esc(r.person_key)}">Restore</button>`}</td>
      </tr>`).join("") || `<tr><td colspan="4">Nobody here.</td></tr>`}</tbody>
    </table></div>
  </section>`;
}

function redrawCrane() {
  const host = $("craneAdmin");
  if (host) host.outerHTML = craneAdminSection();
}

document.addEventListener("click", async (event) => {
  const filter = event.target.closest("[data-crane-filter]");
  if (filter) { craneFilter = filter.dataset.craneFilter; return redrawCrane(); }
  const button = event.target.closest("[data-crane]");
  if (!button) return;
  const row = tsPeople.find(r => r.person_key === button.dataset.key);
  if (!row) return;
  const name = `${row.first_name} ${row.last_name}`;
  const removing = button.dataset.crane === "remove";
  let reason = "";
  if (removing) {
    reason = (prompt(`Why is ${name}'s Crane & Rigging Qualification being removed? They'll see this.`) || "").trim();
    if (!reason) return;
  } else if (!confirm(`Restore ${name}'s Crane & Rigging Qualification?`)) {
    return;
  }
  button.disabled = true;
  const { data, error } = await db.from("crane_qualification_overrides")
    .upsert({ person_key: row.person_key, revoked: removing, reason }, { onConflict: "person_key" })
    .select("person_key, revoked, reason, changed_by_name, changed_at");
  button.disabled = false;
  if (error || !data || !data.length) {
    return alert(error && !/row-level/i.test(error.message) ? error.message
      : "That wasn't saved — only their location admin or an owner can change it, and only for someone who has taken the course.");
  }
  craneOverrides.set(row.person_key, data[0]);
  redrawCrane();
});

function riggingView() {
  const mine = plans.filter(p => p.created_by === me.id);
  const others = plans.filter(p => p.created_by !== me.id);

  // A heading, then a card per plan — as the app lays out its lift plans.
  const group = (title, rows, empty) => `<div class="group-title">${title}${rows.length
      ? ` <span style="margin-left:auto;order:2">${rows.length}</span>` : ""}</div>
    ${rows.length ? `<div class="crane-list">${rows.map(planRow).join("")}</div>` : `<p class="crane-empty">${empty}</p>`}`;

  return hero("Crane Center",
      "Your crane and rigging qualification, lift plans you've submitted, and the ones waiting on you.")
    + `<div class="crane">`
    + craneCard()
    + (isAdmin() ? group("Waiting on you", others.filter(p => p.status === "submitted"),
        "Nothing to approve right now.") : "")
    + group("Your plans", mine, "You haven't submitted a lift plan yet. Plans are written in the app.")
    + (isAdmin() ? group("Everything else at your location", others.filter(p => p.status !== "submitted"),
        "Nothing else here.") : "")
    + craneAdminSection()
    + `</div>`;
}

function planRow(plan) {
  const reviewable = isAdmin() && plan.status === "submitted" && plan.created_by !== me.id;
  const photos = (plan.photo_paths || []).length;

  return `<div class="plan-card ${esc(plan.status || "")}">
    <div class="plan-main">
      <span class="cab-tag">${planLabel(plan)}</span>
      <span class="plan-title">${esc(plan.job_description || "Untitled lift")}</span>
      <span class="plan-meta">
        <span>${icon("calendar", 13)}${fmtDate((plan.lift_date || "").slice(0, 10))}</span>
        <span>${icon("pin", 13)}${esc(plan.location || "No site")}</span>
        ${plan.created_by === me.id ? "" : `<span>${icon("person", 13)}${esc(plan.created_by_name || "Unknown")}</span>`}
        ${photos ? `<span>${icon("camera", 13)}${photos} photo${photos === 1 ? "" : "s"} in the PDF</span>` : ""}
      </span>
      ${plan.review_note ? `<span class="plan-note"><b>Note</b>${esc(plan.review_note)}</span>` : ""}
    </div>
    <div class="plan-actions">
      ${reviewable ? `<button type="button" class="approve" data-approve="${esc(plan.id)}">Approve</button>
         <button type="button" class="quiet" data-return="${esc(plan.id)}">Request changes</button>` : ""}
      <button type="button" class="quiet" data-plan="${esc(plan.id)}">${icon("doc", 14)}PDF</button>
    </div>
  </div>`;
}

const planLabel = (plan) => ({ submitted: "Awaiting approval", changes_requested: "Changes requested",
  approved: "Approved" })[plan.status] || "—";

$("view").addEventListener("click", async (event) => {
  const approve = event.target.closest("[data-approve]");
  const back = event.target.closest("[data-return]");
  if (!approve && !back) return;

  const id = approve ? approve.dataset.approve : back.dataset.return;
  let payload = { status: "approved", review_note: null };

  if (back) {
    const note = prompt("What needs changing?");
    if (note === null || !note.trim()) return;
    payload = { status: "changes_requested", review_note: note.trim() };
  }

  // reviewed_by and reviewed_at are stamped by a database trigger, so the
  // record can't claim someone else did the review.
  const { data, error } = await db.from("lift_plans")
    .update(payload).eq("id", id).select();

  if (error) return alert(error.message);
  if (!data || !data.length) return alert("Nothing changed - you can't review this plan.");

  // The technician is waiting to hear either way.
  notify("lift_plan", id);

  Object.assign(plans.find(p => p.id === id), data[0]);
  showView("rigging");
});

function renderPlans() {
  const q = $("planSearch").value.trim().toLowerCase();
  const rows = plans.filter(r => !q ||
    (r.job_description || "").toLowerCase().includes(q) ||
    (r.location || "").toLowerCase().includes(q) ||
    (r.created_by_name || "").toLowerCase().includes(q));

  const pending = plans.filter(p => p.status === "submitted").length;
  $("planStats").innerHTML =
    `<span class="stat"><b>${plans.length}</b>total</span>` +
    `<span class="stat"><b style="color:var(--red)">${pending}</b>awaiting approval</span>`;

  const badge = { submitted: ["Awaiting", "b-expiring"],
                  changes_requested: ["Changes requested", "b-expired"],
                  approved: ["Approved", "b-current"] };

  $("planTable").querySelector("tbody").innerHTML = rows.map(r => {
    const [label, cls] = badge[r.status] || ["—", "b-none"];
    const pct = r.percent_capacity == null ? "—" : Math.round(r.percent_capacity) + "%";
    return `<tr>
      <td>${r.submitted_at ? new Date(r.submitted_at).toLocaleDateString() : "—"}</td>
      <td>${esc(r.created_by_name || "—")}</td>
      <td><b>${esc(r.job_description || "Untitled lift")}</b></td>
      <td>${esc(r.location || "—")}</td>
      <td>${esc(locations[r.location_id] || "—")}</td>
      <td>${r.total_weight == null ? "—" : Number(r.total_weight).toLocaleString()}</td>
      <td>${pct}</td>
      <td><span class="badge ${cls}">${label}</span></td>
      <td><button class="ghost pdf" data-plan="${esc(r.id)}">PDF</button></td>
    </tr>`;
  }).join("") || `<tr><td colspan="9" class="note">No lift plans yet.</td></tr>`;
}

document.addEventListener("click", async (event) => {
  const button = event.target.closest("button.pdf[data-plan]");
  if (!button) return;
  const plan = plans.find(p => p.id === button.dataset.plan);
  if (!plan || button.disabled) return;
  const original = button.textContent;
  button.disabled = true;
  button.textContent = "Preparing…";
  try {
    await downloadPlanPDF(plan);
  } finally {
    button.disabled = false;
    button.textContent = original;
  }
});

// ---------------------------------------------------------------- lift plan PDF

// Mirrors LiftPlanPDF.swift in the app, so a plan printed from a desk and one
// printed from a phone are the same document. US Letter at 72dpi, which is
// what jsPDF's "pt" unit measures in.
//
// Labels are duplicated from the app rather than stored in the database: the
// database keeps raw values on purpose, so the wording can be corrected without
// rewriting old records.

const CRANE_TYPES = {
  bridge: "Bridge crane - single trolley",
  truck: "Service truck crane"
};

const WEIGHT_METHODS = {
  nameplate: "Equipment / nameplate data",
  specSheet: "Manufacturer spec sheet",
  calculation: "Engineering calculation",
  scale: "Certified scale weight",
  billOfLading: "Bill of lading / shipping docs",
  estimated: "Estimated by rigger"
};

const INSPECTION_ITEMS = [
  ["slings", "Slings/chains free of cuts, fraying, kinks or corrosion"],
  ["hooks", "Hooks free of cracks or deformation; safety latches work"],
  ["shackles", "Shackles - correct pin, no wear, hand-tight plus a turn"],
  ["hardwareMarked", "Rigging hardware rated capacity marked and legible"],
  ["wireRope", "Wire rope free of broken wires, birdcaging, corrosion"],
  ["belowHookTagged", "Below-the-hook device inspected and tagged current"],
  ["limitSwitches", "Crane hoist limit switches / brakes tested"],
  ["outriggers", "Outriggers fully deployed and cribbed (truck crane)"]
];

const STATUS_LABELS = {
  submitted: "Awaiting approval",
  changes_requested: "Changes requested",
  approved: "Approved"
};

async function downloadPlanPDF(plan) {
  // The picture of the lift, fetched first. One that can't be fetched is left
  // out rather than holding up the export.
  const photos = (await Promise.all((plan.photo_paths || [])
    .map(path => storagePhotoData("lift-plan-photos", path)))).filter(Boolean);

  const PAGE_W = 612, PAGE_H = 792, MARGIN = 44;
  const WIDTH = PAGE_W - MARGIN * 2;

  const doc = new jspdf.jsPDF({ unit: "pt", format: "letter" });
  let y = MARGIN;

  // Every writer below asks for room first, so nothing straddles a page break.
  const ensure = (needed) => {
    if (y + needed > PAGE_H - MARGIN - 20) { doc.addPage(); y = MARGIN; }
  };

  const text = (str, x, top, { size = 11, style = "normal", grey, width } = {}) => {
    doc.setFont("helvetica", style);
    doc.setFontSize(size);
    doc.setTextColor(grey == null ? 0 : grey);
    const lines = width ? doc.splitTextToSize(String(str), width) : [String(str)];
    // jsPDF positions text on the baseline; everything here is measured from
    // the top of the line, so shift down by roughly the ascender.
    doc.text(lines, x, top + size * 0.85);
    return lines.length * size * 1.25;
  };

  const clean = (v) => String(v ?? "").trim();
  const or = (v) => clean(v) || "-";

  const title = (str) => {
    ensure(30);
    doc.setFillColor(204, 0, 51);
    doc.rect(MARGIN, y, WIDTH, 24, "F");
    text(str, MARGIN + 6, y + 4, { size: 15, style: "bold", grey: 255 });
    y += 28;
  };

  const caption = (str) => {
    ensure(14);
    text(str, MARGIN, y, { size: 9, grey: 90 });
    y += 14;
  };

  const section = (str) => {
    ensure(28);
    y += 8;
    doc.setFillColor(237, 237, 237);
    doc.rect(MARGIN, y, WIDTH, 16, "F");
    text(str.toUpperCase(), MARGIN + 5, y + 2, { size: 11, style: "bold" });
    y += 21;
  };

  // An empty field is left out rather than printed as a dash: a plan is easier
  // to read when what's on it was actually filled in.
  const field = (label, value) => {
    const body = clean(value);
    if (!body) return;
    doc.setFontSize(11);
    const lines = doc.splitTextToSize(body, WIDTH);
    ensure(lines.length * 14 + 14);
    text(label, MARGIN, y, { size: 8, style: "bold", grey: 128 });
    y += 10;
    y += text(body, MARGIN, y, { width: WIDTH });
  };

  const pair = (l1, v1, l2, v2) => {
    const half = (WIDTH - 12) / 2;
    ensure(30);
    text(l1, MARGIN, y, { size: 8, style: "bold", grey: 128 });
    text(l2, MARGIN + half + 12, y, { size: 8, style: "bold", grey: 128 });
    y += 10;
    text(or(v1), MARGIN, y, { width: half });
    text(or(v2), MARGIN + half + 12, y, { width: half });
    y += 18;
  };

  const check = (label, on) => {
    ensure(15);
    // "[x]" rather than a ballot-box character: jsPDF's built-in fonts are
    // Latin-1 only and would drop it silently.
    text(on ? "[x]" : "[ ]", MARGIN, y, { style: "bold" });
    text(label, MARGIN + 22, y, { grey: on ? 0 : 90, width: WIDTH - 22 });
    y += 15;
  };

  const COLUMNS = [130, 80, 70, 80, 40, 80];

  const riggingRow = (values, header) => {
    ensure(16);
    let x = MARGIN;
    values.forEach((value, i) => {
      text(or(value), x, y, header
        ? { size: 8, style: "bold", grey: 128 }
        : { size: 10 });
      x += COLUMNS[i];
    });
    y += header ? 12 : 14;
  };

  const date = (value) => value
    ? new Date(String(value).length <= 10 ? value + "T00:00:00" : value)
        .toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })
    : "-";

  // ---- the document -------------------------------------------------------

  title("CRANE LIFT / RIGGING PLAN");
  caption("Bridge Crane (Single Trolley) & Service Truck Crane Lifts");

  const status = [`Status: ${STATUS_LABELS[plan.status] || plan.status}`];
  if (plan.created_by_name) status.push(`Submitted by ${plan.created_by_name}`);
  if (plan.reviewed_at) status.push(`Reviewed ${date(plan.reviewed_at)}`);
  caption(status.join("    -    "));
  y += 8;

  section("Job Information");
  pair("Date", date(plan.lift_date), "Location / Facility", plan.location);
  field("Job / Task Description", plan.job_description);
  pair("Rigger-in-Charge", plan.rigger_in_charge, "Signal Person", plan.signal_person);

  section("Crane Type, Configuration & Capacity");
  pair("Crane Type", CRANE_TYPES[plan.crane_type] || "-",
       "Rated Capacity", plan.rated_capacity);
  if (plan.crane_type === "truck") {
    field("Truck Crane Details", plan.truck_details);
    field("Working Radius / Boom Angle", plan.working_radius);
  }
  field("Crane Capacity at This Radius / Config", plan.capacity_at_config);
  check("Centre of gravity confirmed", plan.center_of_gravity_confirmed);
  check("Lift is within the crane's rated capacity", plan.within_rated_capacity);
  check("Load chart consulted / capacity plate verified", plan.load_chart_consulted);

  section("Load Weight");
  field("Load Description", plan.load_description);
  pair("Load Weight (lbs)", plan.load_weight == null ? "" : Math.round(plan.load_weight),
       "Total Weight (lbs)", plan.total_weight == null ? "" : Math.round(plan.total_weight));
  field("How Was Weight Determined?",
        (plan.weight_methods || []).map(m => WEIGHT_METHODS[m] || m).join(", "));
  field("Source / Reference", plan.weight_source);
  if (plan.percent_capacity != null) {
    field("% of Crane Capacity Used", Math.round(plan.percent_capacity) + "%" +
      (plan.percent_capacity > 100 ? "  - EXCEEDS RATED CAPACITY" : ""));
  }

  const rigging = (plan.rigging || []).filter(r =>
    [r.item, r.type, r.size, r.wll, r.qty, r.angle].some(v => clean(v)));
  if (rigging.length) {
    section("Rigging - Size & Type");
    riggingRow(["Component", "Type", "Size", "Rated WLL", "Qty", "Angle"], true);
    rigging.forEach(r => riggingRow([r.item, r.type, r.size, r.wll, r.qty, r.angle]));
  }
  // Taken off the form in September 2026; older plans that filled them in still show them.
  field("Below-the-Hook Lifting Device", plan.below_hook_device);
  field("Hitch Type & Sling Angle", plan.hitch_type);

  section("Pre-Lift Inspection Checklist");
  INSPECTION_ITEMS.forEach(([key, label]) =>
    check(label, (plan.inspection || {})[key] === true));

  section("Hazards & Lift Path");
  field("Hazards Identified", plan.hazards);
  field("Lift Path / Sketch", plan.lift_path);

  if (photos.length) {
    const cw = (WIDTH - 10) / 2, ch = cw * 0.75;
    ensure(ch + 34);                       // the heading stays with the first row
    section("Picture of Lift");
    photos.forEach((p, i) => {
      if (i % 2 === 0) { if (i > 0) y += ch + 10; ensure(ch + 4); }
      const cx = MARGIN + (i % 2) * (cw + 10);
      doc.setFillColor(242, 242, 242);
      doc.rect(cx, y, cw, ch, "F");
      const scale = Math.min(cw / p.width, ch / p.height);
      const w = p.width * scale, h = p.height * scale;
      doc.addImage(p.url, "JPEG", cx + (cw - w) / 2, y + (ch - h) / 2, w, h);
    });
    y += ch + 10;
  }

  text(`Generated from the Agri-Service web page - ${new Date().toLocaleDateString()}`,
       MARGIN, PAGE_H - MARGIN, { size: 9, grey: 128 });

  // Named so a folder of these sorts by date and stays unambiguous when two
  // people lifted on the same day.
  const stamp = (plan.lift_date || plan.submitted_at || "").slice(0, 10);
  const who = clean(plan.created_by_name).replace(/[^\w -]/g, "");
  doc.save(["Lift Plan", stamp, who].filter(Boolean).join(" - ") + ".pdf");
}

$("planSearch").addEventListener("input", renderPlans);
