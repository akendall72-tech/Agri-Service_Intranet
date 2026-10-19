// The Crane Center
//
// The Crane & Rigging Qualification (from the course on Training Status) and
// the Crane Center page. The lift plans it lists, their form, their own page
// and their PDF are lift-plans.js.

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
    + `<div class="lp-start">${lpNewCard()}</div>`
    + (isAdmin() ? group("Waiting on you", others.filter(p => p.status === "submitted"),
        "Nothing to approve right now.") : "")
    + group("Your plans", mine, "You haven't submitted a lift plan yet. Start one above, here or in the app.")
    + (isAdmin() ? group("Everything else at your location", others.filter(p => p.status !== "submitted"),
        "Nothing else here.") : "")
    + craneAdminSection()
    + `</div>`;
}
