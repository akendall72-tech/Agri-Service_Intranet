// The Forklift Center
//
// Certification cards and their status, the driving test (the form, the
// evaluator's terms and its PDF), approving tests, the Certification Report, your
// own card, the online course and the 30 days after it, Driving Tests Due, the
// forklift cards admin table, and importing certifications.

// The forklift certification course, as named on the printed record. A
// setting because course names change. Since 0059 it is no longer required
// before a driving test. It only names the course whose date goes on the card.
const FORKLIFT_COURSE_FALLBACK = "Forklift Certification";
const forkliftCourse = () => {
  const named = tsText(tsSources && tsSources.forklift_course).trim();
  return named || FORKLIFT_COURSE_FALLBACK;
};

// ---- approving driving tests (the Training Manager, migration 0068) --------

const isTrainingManager = () => isOwner() && personDesignations.some(pd =>
  pd.person_id === me.id && pd.designation_id === "training_manager");

const approvedCerts = () => certs.filter(c => (c.approval || "approved") === "approved");
const pendingTests = () => certs.filter(c => c.approval === "pending")
  .sort((a, b) => String(a.submitted_at || "").localeCompare(String(b.submitted_at || "")));

// The online forklift course behind each test (0105): when it was passed and
// how long after it was started, both timed by the database. A course reports
// its own pass, so a pass a few minutes after starting is worth a question
// before approving. Only the Training Manager and owners can ask; before 0105
// is run, or for anyone else, the line just isn't shown.
let fkPasses = null;
const FK_QUICK_MINUTES = 10;

async function loadFkPasses() {
  const { data, error } = await db.rpc("forklift_course_record");
  fkPasses = error ? false : Object.fromEntries((data || []).map(r => [String(r.email || "").toLowerCase(), r]));
}

const fkMinutes = (m) => m < 60 ? `${m} minute${m === 1 ? "" : "s"}`
  : m < 1440 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${Math.round(m / 1440)} day${Math.round(m / 1440) === 1 ? "" : "s"}`;

function fkPassLine(t) {
  if (!fkPasses) return "";
  const r = fkPasses[String(t.email || "").toLowerCase()];
  if (!r) return `<div class="note fk-course">No online course pass on record${t.email ? ` for ${esc(t.email)}` : ""}.</div>`;
  const quick = r.minutes_to_pass < FK_QUICK_MINUTES;
  const own = r.seconds_in_course ? ` The course's own clock says ${fkMinutes(Math.round(r.seconds_in_course / 60))}.` : "";
  return `<div class="fk-course${quick ? " quick" : ""}">${icon(quick ? "warning" : "checkCircle", 15)}<span>Online course passed
    ${esc(newsDate(String(r.passed_at).slice(0, 10)))}, ${fkMinutes(r.minutes_to_pass)} after starting it.${own}${quick
      ? " That's quicker than the course takes: check they really did it before approving." : ""}</span></div>`;
}

function approvalsView() {
  const tests = pendingTests();
  if (fkPasses === null) {
    fkPasses = false;
    loadFkPasses().then(() => { if (viewShown === "approvals" && fkPasses) showView("approvals"); });
  }
  const tick = (ok, label) => `<div style="color:${ok ? "#137026" : "var(--red-dark)"}">${ok ? "✓" : "✗"} ${esc(label)}</div>`;
  return hero("Driving Tests to Approve",
              "A driving test only counts once you approve it. Someone who already holds a card keeps it meanwhile.")
    + `<div class="card">${tests.length ? tests.map(t => `
        <div class="ticket" style="padding:12px 14px" data-approval="${esc(t.id)}">
          <div style="display:flex;justify-content:space-between;gap:10px;align-items:baseline">
            <b>${esc(t.operator_name)}</b>
            <span class="badge ${t.passed_driving ? "b-current" : "b-none"}">${t.passed_driving ? "Passed" : "Not passed"}</span></div>
          <div class="note">Tested ${fmtDate(t.evaluation_date)}${t.evaluator_name ? ` by ${esc(t.evaluator_name)}` : ""}
            ${(t.truck_classes || []).length ? ` · ${esc(t.truck_classes.join(", "))}` : ""}</div>
          <div style="margin:6px 0;font-size:13.5px">
            ${EVAL_CHECKS.map(([key, label]) => tick(!!t[key], label)).join("")}</div>
          ${fkPassLine(t)}
          <div class="note">${t.passed_driving
            ? `Certified until ${fmtDate(t.expiration_date)} once you approve it.`
            : "Not passed, so no card either way. Approving puts the result on record."}</div>
          <div class="row" style="margin-top:8px">
            <button data-review="approve" data-id="${esc(t.id)}">Approve</button>
            <button class="ghost" data-review="reject" data-id="${esc(t.id)}">Not approved</button>
            <button class="pdf" data-eval-pdf="${esc(t.id)}">Driving test PDF</button>
          </div>
        </div>`).join("")
      : `<p class="note">Nothing waiting. New driving tests show up here, and you get a notification
          on the app when one is recorded.</p>`}</div>`;
}

document.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-review]");
  if (!button) return;
  const test = certs.find(c => String(c.id) === button.dataset.id);
  if (!test) return;
  const approve = button.dataset.review === "approve";
  let note = "";
  if (!approve) {
    note = (prompt(`Why isn't ${test.operator_name}'s driving test approved? ${test.evaluator_name || "Whoever recorded it"} will see this.`) || "").trim();
    if (!note) return;
  }
  button.disabled = true;
  const { error } = await db.rpc("review_forklift_evaluation", { target: test.id, approve, note });
  button.disabled = false;
  if (error) return alert(/Only the Training Manager/.test(error.message)
    ? "Only the Training Manager approves driving tests." : error.message);
  // Whoever recorded it is told how it went.
  notify("forklift_evaluation", test.id);
  const fresh = await db.from("forklift_certifications").select("*");
  if (fresh.data) certs = fresh.data;
  showView("approvals");
});

// ---- forklift driving test ------------------------------------------------
//
// Anyone signed in can carry one out, as in the app (migration 0059); it used
// to be only in the owners' admin area here. The form keeps its ids, so
// renderEvalForm() and saveEvaluation() work it wherever it's drawn.

function evalTestView() {
  const intro = hero("Forklift Driving Test",
              "Evaluate someone on a truck and record the result. Anyone can carry it out; it's usually the location admin.");
  if (!evalAgreed) return intro + evalTermsCard();
  setTimeout(renderEvalForm);
  return intro
    + `<div class="card" id="evalCard">
        <p class="note">Pick the operator, the truck classes they were tested on, and the four
          parts of the test. All four have to be met for a card; anything less is recorded as not
          passed. The card lasts three years, and counts once the Training Manager approves the test;
          they're told it's waiting. An import won't remove it. Anyone who passed the online forklift course in
          the last 30 days can be evaluated, except yourself. The database checks that, not just this page.</p>
        <div class="fields">
          <div><label for="evalName">Operator</label>
            <select id="evalName"></select></div>
          <div><label for="evalEmail">Work email</label>
            <input type="email" id="evalEmail" maxlength="160" readonly></div>
          <div><label for="evalDate">Evaluated on</label>
            <input type="date" id="evalDate"></div>
          <div><label for="evalExpires">Expires</label>
            <input type="date" id="evalExpires" disabled></div>
          <div><label for="evalCoursePassed">Certification course passed</label>
            <input type="text" id="evalCoursePassed" readonly></div>
        </div>
        <p class="note" style="margin-bottom:4px" id="evalEligibleNote"></p>

        <h3 style="margin:16px 0 6px">Truck type authorised</h3>
        <div class="row" id="evalClasses"></div>

        <h3 style="margin:16px 0 6px">The driving test</h3>
        <div class="row" id="evalChecks"></div>
        <p class="note" id="evalVerdict"></p>

        <div class="row" style="margin-top:12px">
          <button data-act="eval-save">Record the result</button>
          <span class="msg"></span>
        </div>
      </div>`;
}

// ---- certification report ------------------------------------------------
//
// Who is certified to drive a forklift, the same as the app's report: one row
// per person, their newest record; certified, expiring or not valid; each
// person's driving test as a PDF. Owners remove a certification, with a reason,
// and restore it (migration 0067). Everyone sees that it was removed; owners
// also see who removed it and why.

let certReportFilter = "all", certReportQuery = "";

// The row that counts for each person: the newest by expiry, then evaluation.
// Grouped on the work email, or the name when there isn't one, as the app does.
function certsPerPerson() {
  const byPerson = {};
  const approved = approvedCerts();
  const approvedKeys = new Set(approved.map(r => r.match_key));
  const waitingOnly = pendingTests().filter(r => !approvedKeys.has(r.match_key));
  [...approved, ...waitingOnly].forEach(r => {
    const email = (r.email || "").trim().toLowerCase();
    const key = email || "name:" + tsNameKey(r.operator_name || "", "");
    const held = byPerson[key];
    const newer = !held || [r.expiration_date || "", r.evaluation_date || ""].join("|")
      > [held.expiration_date || "", held.evaluation_date || ""].join("|");
    if (newer) byPerson[key] = r;
  });
  return Object.values(byPerson).sort((a, b) =>
    (a.operator_name || "").localeCompare(b.operator_name || "", undefined, { sensitivity: "base" }));
}

function certReportView() {
  const filters = [["all", "All"], ["certified", "Certified"], ["expiring", "Expiring"], ["lapsed", "Not valid"]];
  return hero("Certification Report", isOwner() ? "Who is certified to drive a forklift at every location, and when each card runs out."
      : "Who at your location is certified to drive a forklift, and when each card runs out.")
    + `<div class="card">
        <div class="stats" id="certReportStats"></div>
        <div class="chips">${filters.map(([value, label]) => `<button type="button"
          class="chip${certReportFilter === value ? " on" : ""}" data-cert-filter="${value}">${label}</button>`).join("")}</div>
        <input class="search" id="certReportSearch" placeholder="Name or email"
          value="${esc(certReportQuery)}" style="margin-bottom:10px">
        <div id="certReportList">${certReportList()}</div>
        ${isOwner() ? `<p class="note" style="margin-top:12px">As an owner you can remove a certification, with
          a reason, and restore it. It shows as not valid until it's restored or they pass a new
          driving test, and they see who removed it and why. Never your own.</p>` : ""}
      </div>`;
}

function certReportList() {
  const everyone = certsPerPerson();
  const kind = (r) => {
    const [, cls] = certStatusNow(r);
    return cls === "b-current" ? "certified" : cls === "b-expiring" ? "expiring" : "lapsed";
  };
  const tally = { certified: 0, expiring: 0, lapsed: 0 };
  everyone.forEach(r => tally[kind(r)]++);
  setTimeout(() => {
    const stats = $("certReportStats");
    if (stats) stats.innerHTML =
      `<span class="stat"><b style="color:#178A2A">${tally.certified}</b>certified</span>` +
      `<span class="stat"><b style="color:#8a5e00">${tally.expiring}</b>expiring</span>` +
      `<span class="stat"><b style="color:var(--red-dark)">${tally.lapsed}</b>not valid</span>`;
  });

  const q = certReportQuery.trim().toLowerCase();
  const shown = everyone.filter(r => (certReportFilter === "all" || kind(r) === certReportFilter)
    && (!q || (r.operator_name || "").toLowerCase().includes(q) || (r.email || "").toLowerCase().includes(q)));
  if (!shown.length) return `<p class="note">${certs.length ? "Nobody matches." : "No certifications yet."}</p>`;

  const myEmail = ((me && me.email) || "").toLowerCase();
  // A newer test on its way, while this card still stands.
  const waitingKeys = new Set(pendingTests().map(t => t.match_key));
  return shown.map(r => {
    const [label, cls] = certStatusNow(r);
    const removal = certRemoval(r);
    const valid = cls === "b-current" || cls === "b-expiring";
    const expiry = valid ? `Expires ${fmtDate(r.expiration_date)}`
      : removal ? `Expires ${fmtDate(r.expiration_date)} if restored`
      : r.approval === "pending" ? `Tested ${fmtDate(r.evaluation_date)}, waiting for the Training Manager`
      : cls === "b-expired" ? `Expired ${fmtDate(r.expiration_date)}` : "No valid evaluation";
    const mayChange = isOwner() && r.match_key && r.match_key !== myEmail;
    return `<div class="ticket" style="padding:12px 14px">
        <div style="display:flex;justify-content:space-between;gap:10px;align-items:baseline">
          <b>${esc(r.operator_name)}</b><span class="badge ${cls}">${esc(label)}</span></div>
        ${(r.truck_classes || []).length ? `<div class="note">${esc(r.truck_classes.join(", "))}</div>` : ""}
        ${r.approval !== "pending" && waitingKeys.has(r.match_key)
          ? `<div style="color:#8a5e00;font-size:13px;margin-top:4px">New driving test awaiting approval</div>` : ""}
        ${removal && removal.changed_by_name ? `<div style="color:var(--red-dark);font-size:13px;margin-top:4px">${esc(removalLine(removal))}</div>` : ""}
        <div class="note">${esc(expiry)}${r.evaluation_date && r.approval !== "pending" ? ` · evaluated ${fmtDate(r.evaluation_date)}` : ""}</div>
        <div class="row" style="margin-top:8px">
          <button class="pdf" data-eval-pdf="${esc(r.id)}">Driving test PDF</button>
          ${mayChange && removal ? `<button class="pdf" data-cert-restore="${esc(r.match_key)}">Restore</button>` : ""}
          ${mayChange && !removal && valid ? `<button class="ghost" data-cert-remove="${esc(r.match_key)}">Remove</button>` : ""}
        </div>
      </div>`;
  }).join("");
}

const redrawCertReport = () => {
  const list = $("certReportList");
  if (list) list.innerHTML = certReportList();
};

document.addEventListener("input", (event) => {
  if (event.target.id !== "certReportSearch") return;
  certReportQuery = event.target.value;
  redrawCertReport();
});

document.addEventListener("click", async (event) => {
  const chip = event.target.closest("[data-cert-filter]");
  if (chip) {
    certReportFilter = chip.dataset.certFilter;
    document.querySelectorAll("[data-cert-filter]").forEach(b =>
      b.classList.toggle("on", b === chip));
    return redrawCertReport();
  }

  const button = event.target.closest("[data-cert-remove], [data-cert-restore]");
  if (!button) return;
  const removing = "certRemove" in button.dataset;
  const key = removing ? button.dataset.certRemove : button.dataset.certRestore;
  const row = certsPerPerson().find(r => r.match_key === key);
  const who = (row && row.operator_name) || "this person";

  let reason = "";
  if (removing) {
    reason = (prompt(`Why is ${who}'s forklift certification being removed? They'll see this.`) || "").trim();
    if (!reason) return;
  } else if (!confirm(`Restore ${who}'s forklift certification?`)) {
    return;
  }

  button.disabled = true;
  const { data, error } = await db.from("forklift_certification_removals")
    .upsert({ person_key: key, revoked: removing, reason }, { onConflict: "person_key" })
    .select();
  button.disabled = false;
  if (error || !data || !data.length) {
    return alert(error ? error.message
      : "That wasn't saved: only an owner can change it, and never their own.");
  }
  const saved = data[0];
  forkliftRemovals[key] = saved;
  if (saved.revoked) forkliftRemovedAt[key] = saved.changed_at;
  else delete forkliftRemovedAt[key];
  redrawCertReport();
});

// ---- my certification ----------------------------------------------------

// Email first, because it's an identity rather than a spelling. Falls back to
// the name, as the app does: an account set up by hand may not use the address
// the CSV carries.
function myCertification(list = approvedCerts()) {
  const email = (me.email || "").toLowerCase();
  const byEmail = list.find(c => (c.email || "").toLowerCase() === email);
  if (byEmail) return byEmail;

  // A name only for a record with no email (an old spreadsheet row), and only
  // when it's one person's: an owner gets everyone's records, and a
  // namesake's card must never show as theirs.
  const myName = (profile && profile.full_name) || "";
  if (!tokens(myName).size) return null;
  const byName = list.filter(c => !(c.email || "").trim() && sameName(c.operator_name || "", myName));
  // Every one has to be the same person written differently (a middle initial
  // on one test, not on another); two people means no answer.
  if (!byName.length || !byName.every(c => sameName(c.operator_name || "", byName[0].operator_name || ""))) return null;
  return byName[0];
}

// The same person written differently: every word of one name is in the other.
function sameName(a, b) {
  const x = tokens(a), y = tokens(b);
  return x.size > 0 && y.size > 0 && ([...x].every(w => y.has(w)) || [...y].every(w => x.has(w)));
}

const tokens = (name) =>
  new Set(name.toLowerCase().split(/[^a-z]+/).filter(w => w.length > 1));

// ---- the online course and the 30 days after it (migration 0092) ----------------
//
// Nobody can be given a driving test until they've passed the online forklift
// course, and then they have 30 days, to the end of the 30th day. Past that,
// the course again. my_forklift_course() is the database's own answer, the
// same one the app shows and the insert policy applies.

let fkCourse = null;

async function loadForkliftCourse() {
  const { data, error } = await db.rpc("my_forklift_course");
  fkCourse = error ? null : (data || [])[0] || null;
}

// "2026-11-08" as a day on this computer's calendar.
const fkDay = (text) => { const [y, m, d] = String(text).split("-").map(Number); return new Date(y, m - 1, d); };

function fkStage(status) {
  if (!status || !status.passed_at || !status.last_day) return { kind: "notPassed" };
  if (status.tested) return { kind: "tested" };
  const last = fkDay(status.last_day);
  if (new Date(status.deadline) > new Date()) {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    return { kind: "due", last, daysLeft: Math.max(0, Math.round((last - today) / 86400000)) };
  }
  return { kind: "expired", last };
}

const fkCourseLink = () => fkCourse && fkCourse.course_ready && fkCourse.course_id
  ? `course.html?c=${encodeURIComponent(fkCourse.course_id)}` : null;

// The spot for the card while there's no valid one: how to get certified, the
// days left for the driving test, or the course again. A test that's due shows
// even beside a valid card, for someone renewing.
function forkliftCourseCard() {
  if (!fkCourse) return "";
  const stage = fkStage(fkCourse);
  const cert = myCertification();
  const valid = cert && ["b-current", "b-expiring"].includes(certStatusNow(cert)[1]);
  const waiting = myCertification(pendingTests());
  const link = fkCourseLink();
  const longDay = (d) => d.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });

  if (stage.kind === "due") {
    const accent = stage.daysLeft <= 3 ? "red" : "amber";
    const count = stage.daysLeft === 0 ? "Last day" : stage.daysLeft === 1 ? "1 day left" : `${stage.daysLeft} days left`;
    const passed = new Date(fkCourse.passed_at).toLocaleDateString(undefined, { month: "short", day: "numeric" });
    return `<div class="cab-card fk-card" style="${lit(accent)}">
      <span class="fk-eyebrow">Driving test due</span>
      <b class="fk-count">${count}</b>
      <p>Get it done by ${longDay(stage.last)}. Ask your location admin to give it.</p>
      <p class="fk-small">You passed the online course on ${passed}. If the test isn't done by then, you'll take the course again.</p>
    </div>`;
  }
  if (valid || waiting) return "";
  if (stage.kind === "expired") {
    return `<div class="cab-card fk-card" style="${lit("amber")}">
      <b>Take the course again</b>
      <p>Your 30 days for the driving test ran out on ${stage.last.toLocaleDateString(undefined, { month: "long", day: "numeric" })}.
        Pass the online course again and you'll have another 30 days.</p>
      ${link ? `<a class="oc-go" href="${link}">Take the online course &rarr;</a>` : ""}
    </div>`;
  }
  return `<div class="cab-card fk-card" style="${lit("green")}">
    <b>Get certified</b>
    <p>You need a forklift card before you can drive a forklift. Three steps:</p>
    <ol class="fk-steps">
      <li><b>Take the online course</b><span>${link
        ? "Click below to start, or find it any time in Training Center → Online Courses, here or in the app. Pass the quiz at the end; if you don't, take it again. You can stop partway and pick up where you left off."
        : "It isn't up yet. When the training department adds it, it'll be in Training Center → Online Courses."}</span></li>
      <li><b>Get your driving test within 30 days</b><span>Once you pass, ask your location admin for the driving test. They
        watch you inspect and drive the truck, and record it in the app or here. Miss the 30 days and you'll take the course again.</span></li>
      <li><b>Your card shows up here</b><span>The Training Manager approves the test, then your card appears in this spot.
        It's good for three years.</span></li>
    </ol>
    ${link ? `<a class="oc-go" href="${link}">Take the online course &rarr;</a>` : ""}
  </div>`;
}

function certificationCard() {
  const cert = myCertification();
  // A test of theirs waiting for the Training Manager, newer than the card.
  const waiting = myCertification(pendingTests());
  const waitingNote = waiting && (!cert || String(waiting.submitted_at || waiting.evaluation_date)
      > String(cert.submitted_at || cert.evaluation_date))
    ? `<div class="card" style="background:#FFF7E6"><b>Driving test awaiting approval</b>
        <p class="note">Your driving test on ${fmtDate(waiting.evaluation_date)} is waiting for the Training
        Manager. ${cert ? "The card below stands until it's approved." : "Your card appears here once it's approved."}</p></div>`
    : "";
  if (!cert && waitingNote) return waitingNote;
  if (!cert && fkCourse) return "";
  if (!cert) {
    return `<div class="card"><b>Not on the certification list</b>
      <p class="note">You're matched on your work email first, then your name.
      Check the training department has you under the address you sign in with.</p></div>`;
  }

  const [label, cls] = certStatusNow(cert);
  const removal = certRemoval(cert);
  const classes = (cert.truck_classes || []).join(", ");

  return waitingNote + `<div class="cert">
    <div class="band">CERTIFIED FORKLIFT OPERATOR</div>
    <div class="body">
      <div class="name">${esc(cert.operator_name)}</div>
      <span class="badge ${cls}">${label}</span>
      <dl>
        ${classes ? `<div><dt>Truck classes authorised</dt>
          <dd>${esc(classes)}</dd></div>` : ""}
        <div><dt>Location</dt>
          <dd>${esc((profile && locations[profile.location_id]) || "-")}</dd></div>
        <div><dt>Valid through</dt><dd>${fmtDate(cert.expiration_date)}</dd></div>
        ${cert.evaluation_date ? `<div><dt>Evaluated</dt>
          <dd>${fmtDate(cert.evaluation_date)}${cert.evaluator_name
            ? " by " + esc(cert.evaluator_name) : ""}</dd></div>` : ""}
      </dl>
      ${removal ? `<p style="color:var(--red-dark);margin:14px 0 0">${esc(removalLine(removal))}
        You can't operate a forklift until it's restored or you pass a new driving test.</p>` : ""}
      <p class="note" style="margin-top:16px">
        Issued by the Agri-Service Training Department</p>
    </div>
  </div>`;
}

// ---------------------------------------------------------------- status

// Mirrors the app: a failed driving evaluation is not a certification, and the
// expiry date decides the rest. Sixty days is enough notice to re-evaluate.
function certStatus(row) {
  // Recorded, and waiting for the Training Manager, or turned down (0068).
  if (row.approval === "pending") return ["Awaiting approval", "b-pending"];
  if (row.approval === "rejected") return ["Not approved", "b-none"];
  if (row.passed_driving === false) return ["Not certified", "b-none"];
  if (!row.expiration_date) return ["Not certified", "b-none"];
  const days = Math.round((new Date(row.expiration_date) - new Date()) / 86400000);
  if (days < 0) return ["Expired", "b-expired"];
  if (days < 60) return [`Expiring · ${days}d`, "b-expiring"];
  return ["Certified", "b-current"];
}

// The removal covering this certification, if an owner has removed it
// (migration 0067): one made on or after the day it was issued. A driving
// test passed after a removal is a new certification and counts again. The
// app's ForkliftCertification.isCovered(byRemovalAt:) is the same rule.
function certRemoval(row) {
  const at = row && row.match_key && forkliftRemovedAt[row.match_key];
  if (!at) return null;
  const issued = row.submitted_at ? new Date(row.submitted_at)
    : row.evaluation_date ? new Date(row.evaluation_date + "T00:00:00") : null;
  if (issued && issued > new Date(at)) return null;
  return forkliftRemovals[row.match_key] || { removed_at: at };
}

// Whether they can drive today: the record's own status, unless it's been
// removed since. The driving test PDF keeps certStatus(), because a removal
// later doesn't change what happened at the test.
const certStatusNow = (row) => certRemoval(row) ? ["Removed", "b-expired"] : certStatus(row);

// "Removed by Andrew Kendall, Sep 29, 2026: reason", where the reason can be read.
function removalLine(removal) {
  if (!removal.changed_by_name) return "Removed.";
  const when = new Date(removal.changed_at).toLocaleDateString(undefined,
    { year: "numeric", month: "short", day: "numeric" });
  return `Removed by ${removal.changed_by_name}, ${when}: “${removal.reason}”`;
}

function renderCerts() {
  const q = $("certSearch").value.trim().toLowerCase();
  const rows = certs.filter(r => !q ||
    (r.operator_name || "").toLowerCase().includes(q) ||
    (r.email || "").toLowerCase().includes(q));

  const counts = { current: 0, expiring: 0, expired: 0, none: 0, removed: 0 };
  certs.forEach(r => {
    const [label, cls] = certStatusNow(r);
    counts[label === "Removed" ? "removed" : cls === "b-current" ? "current" : cls === "b-expiring" ? "expiring"
      : cls === "b-expired" ? "expired" : "none"]++;
  });
  $("certStats").innerHTML =
    `<span class="stat"><b>${certs.length}</b>total</span>` +
    `<span class="stat"><b style="color:#178A2A">${counts.current}</b>certified</span>` +
    `<span class="stat"><b style="color:#8a5e00">${counts.expiring}</b>expiring</span>` +
    `<span class="stat"><b style="color:var(--red-dark)">${counts.expired}</b>expired</span>` +
    (counts.removed ? `<span class="stat"><b style="color:var(--red-dark)">${counts.removed}</b>removed</span>` : "");

  // Which row the app would show for each person, so a superseded record is
  // obviously superseded rather than looking like a second live certification.
  const current = new Set();
  const byPerson = {};
  certs.forEach(r => {
    const key = (r.email || r.operator_name || "").trim().toLowerCase();
    const held = byPerson[key];
    if (!held || (r.expiration_date || "") > (held.expiration_date || "")) {
      byPerson[key] = r;
    }
  });
  Object.values(byPerson).forEach(r => current.add(r));

  $("certTable").querySelector("tbody").innerHTML = rows.map(r => {
    const [label, cls] = certStatusNow(r);
    return `<tr${current.has(r) ? "" : ' style="opacity:.55"'}>
      <td><b>${esc(r.operator_name)}</b>${current.has(r) ? ""
        : ` <span class="note">· superseded</span>`}</td>
      <td>${esc(r.email || "—")}</td>
      <td>${esc((r.truck_classes || []).join(", ") || "—")}</td>
      <td>${fmtDate(r.evaluation_date)}</td>
      <td>${esc(r.evaluator_name || "—")}</td>
      <td>${fmtDate(r.expiration_date)}</td>
      <td><span class="badge ${cls}">${label}</span></td>
      <td><button class="pdf" data-eval-pdf="${esc(r.id)}">PDF</button></td>
    </tr>`;
  }).join("") || `<tr><td colspan="8" class="note">No certifications yet — record one above or import a CSV.</td></tr>`;
}

// ---- Driving Tests Due (migration 0093) --------------------------------------------
//
// People who passed the online forklift course and haven't had their driving
// test: still inside their 30 days, or ran out and due to take the course
// again; and people whose card expires in the next 60 days who haven't
// started renewing. Like Who's taken it on the Safety Desk: pick a group (and
// a location), and one click opens an email to all of them in BCC.
let fkWaiting = [], fkWaitingError = null, fkWaitingView = "waiting", fkWaitingStore = "all";

async function loadFkWaiting() {
  const { data, error } = await db.rpc("forklift_waiting_report");
  fkWaitingError = error ? error.message : null;
  fkWaiting = data || [];
}

function renderFkWaiting() {
  const box = $("fkWaiting");
  if (!box) return;
  if (fkWaitingError) {
    box.innerHTML = `<h2>Driving tests due</h2><p class="error">${/Could not find|does not exist|schema cache/i.test(fkWaitingError)
      ? "Run migration 0093_forklift_waiting_report.sql in the SQL editor, then reload this page." : esc(fkWaitingError)}</p>`;
    return;
  }
  const lower = (e) => (e || "").trim().toLowerCase();
  // Cards running out in the next 60 days ("Expiring soon"), for anyone who
  // hasn't started renewing: not already waiting for a test after passing the
  // course, and no test waiting for approval.
  const waitingNow = new Set(fkWaiting.filter(r => !r.ran_out).map(r => lower(r.email)));
  const pendingKeys = new Set(pendingTests().map(t => t.match_key).filter(Boolean));
  const byEmail = Object.fromEntries(people.filter(p => p.email).map(p => [lower(p.email), p]));
  const expiringAll = certsPerPerson()
    .filter(c => certStatusNow(c)[1] === "b-expiring" && !waitingNow.has(lower(c.email)) && !pendingKeys.has(c.match_key))
    .map(c => ({ c, p: byEmail[lower(c.email)] }))
    .filter(({ p }) => !(p && p.deactivated_at))
    .map(({ c, p }) => ({ name: (p && p.full_name) || c.operator_name, email: c.email || (p && p.email) || "",
      location: p ? locations[p.location_id] : null, expires: c.expiration_date }))
    .sort((a, b) => String(a.expires).localeCompare(String(b.expires)));

  const where = (r) => r.location || "No location set";
  const stores = [...new Set([...fkWaiting, ...expiringAll].map(where))].sort();
  if (fkWaitingStore !== "all" && !stores.includes(fkWaitingStore)) fkWaitingStore = "all";
  const atStore = (r) => fkWaitingStore === "all" || where(r) === fkWaitingStore;
  const here = fkWaiting.filter(atStore);
  const waiting = here.filter(r => !r.ran_out);
  const ranOut = here.filter(r => r.ran_out).reverse();   // most recent first
  const expiring = expiringAll.filter(atStore);
  const view = fkWaitingView;
  const shown = view === "ranout" ? ranOut : view === "expiring" ? expiring : waiting;
  const emails = [...new Set(shown.map(r => (r.email || "").trim()).filter(e => /@/.test(e)))];
  const noEmail = shown.filter(r => !/@/.test(r.email || "")).length;
  const { html: buttons, split } = bccButtons(emails);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const until = (text) => Math.round((fkDay(text) - today) / 86400000);
  const day = (text) => fkDay(text).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  const passed = (iso) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  const left = (d) => d <= 0 ? "Last day" : d === 1 ? "1 day" : `${d} days`;
  const leftCell = (d, hot) => `<td${d <= hot ? ' style="color:var(--red);font-weight:600"' : ""}>${esc(left(d))}</td>`;
  const n = (k, one, many) => `<b>${k}</b> ${k === 1 ? one : many}`;

  const sum = view === "ranout"
    ? (ranOut.length ? `${n(ranOut.length, "person's", "people's")} 30 days ran out without a driving test. They need to take the online course again.`
                     : "Nobody's 30 days have run out.")
    : view === "expiring"
    ? (expiring.length ? `${n(expiring.length, "person's card expires", "people's cards expire")} in the next 60 days, and they haven't started renewing.
        To renew, they take the online course again, then the driving test within 30 days.`
                       : "No cards expire in the next 60 days without a renewal under way.")
    : (waiting.length ? `${n(waiting.length, "person is", "people are")} waiting for a driving test, soonest deadline first.`
                      : "Nobody is waiting for a driving test right now.");
  const head = view === "expiring" ? "<th>Card expires</th><th>Left</th>"
    : `<th>Passed the course</th>${view === "ranout" ? "<th>Ran out after</th>" : "<th>Last day for the test</th><th>Left</th>"}`;
  const cells = (r) => view === "expiring" ? `<td>${esc(day(r.expires))}</td>${leftCell(until(r.expires), 7)}`
    : `<td>${esc(passed(r.passed_at))}</td><td>${esc(day(r.last_day))}</td>${view === "ranout" ? "" : leftCell(until(r.last_day), 3)}`;

  box.innerHTML = `<h2>Driving tests due</h2>
    <p class="note" style="margin:0 0 12px">Getting certified or renewing is the online forklift course, then a driving test within
      30 days of passing it. These are the people part-way, or due to start.</p>
    <div class="row" style="margin-bottom:10px">
      <select id="fkWaitingStore" style="max-width:260px;margin:0" aria-label="Location">
        <option value="all">All locations</option>${stores.map(x => `<option${x === fkWaitingStore ? " selected" : ""}>${esc(x)}</option>`).join("")}
      </select>
    </div>
    <div class="chips sd-missing-toggle">
      <button type="button" class="chip${view === "waiting" ? " on" : ""}" data-fk-view="waiting">Waiting for a test · ${waiting.length}</button>
      <button type="button" class="chip${view === "ranout" ? " on" : ""}" data-fk-view="ranout">30 days ran out · ${ranOut.length}</button>
      <button type="button" class="chip${view === "expiring" ? " on" : ""}" data-fk-view="expiring">Card expiring · ${expiring.length}</button></div>
    <p class="sd-missing-sum">${sum}</p>
    ${shown.length ? `<div class="row sd-mail-row">${buttons}
        ${emails.length ? `<button type="button" class="ghost" data-sd-copy="${esc(emails.join("; "))}">Copy the addresses</button>` : ""}
        <span class="msg"></span></div>
      <p class="note" style="margin:6px 0 12px">Opens a new email in your mail app with everyone in <b>BCC</b>, so nobody sees the
        others; write the subject and message yourself.${split ? " The list is long, so it's split into a few emails." : ""}${
        noEmail ? ` ${noEmail} ${noEmail === 1 ? "person has" : "people have"} no email on file and ${noEmail === 1 ? "isn't" : "aren't"} included.` : ""}</p>
      <div style="overflow-x:auto"><table class="sd-missing">
        <thead><tr><th>Name</th><th>Location</th><th>Email</th>${head}</tr></thead>
        <tbody>${shown.map(r => `<tr><td><b>${esc(r.name || "No name yet")}</b></td><td>${esc(where(r))}</td>
          <td>${esc(r.email || "—")}</td>${cells(r)}</tr>`).join("")}</tbody>
      </table></div>` : ""}`;
}

$("admin").addEventListener("click", (event) => {
  const view = event.target.closest("[data-fk-view]");
  if (view) { fkWaitingView = view.dataset.fkView; renderFkWaiting(); }
});
$("admin").addEventListener("change", (event) => {
  if (event.target.id === "fkWaitingStore") { fkWaitingStore = event.target.value; renderFkWaiting(); }
});

// ---------------------------------------------------------------- driving test

// The forklift driving evaluation, recorded here as well as in the app. Both
// write the same row into forklift_certifications, and the database stamps who
// did it — see migration 0054. An import no longer deletes these.
//
// The four checks ARE the test: all four have to be met for a card to be
// issued, so "passed" is worked out rather than asked. There is no honest way
// to tick all four and fail.

const EVAL_CLASSES = ["Class I", "Class II", "Class III", "Class IV",
                      "Class V", "Class VI", "Class VII"];

const EVAL_CHECKS = [
  ["inspection", "Inspection"],
  ["use_of_controls", "Use of controls"],
  ["maneuvering", "Manoeuvring skills"],
  ["driving_with_load", "Driving with a load"]
];

const evalState = { classes: new Set(), checks: new Set() };

// The evaluator's responsibilities, accepted before the form opens. The same
// words as EvaluatorTerms in ForkliftEvaluationFormView.swift: change both
// together, and give new wording a new version, which each test records
// (migration 0071).
const EVALUATOR_TERMS = {
  version: "2026-09-30",
  intro: "This evaluation becomes part of Agri-Service, LLC's operator certification record under the "
    + "Occupational Safety and Health Administration standard for powered industrial trucks. Before "
    + "recording it, you must read and accept the following responsibilities.",
  clauses: [
    ["Qualified evaluator",
     "Operator evaluations must be conducted by a person who has the knowledge, training, and experience "
     + "to train powered industrial truck operators and to evaluate their competence. By proceeding, you "
     + "confirm that you meet this requirement for each type of truck you evaluate.",
     "29 CFR 1910.178(l)(2)(iii)"],
    ["Observed in the workplace",
     "The evaluation must be based on your direct observation of the operator's performance in the "
     + "workplace, on the type of truck for which authorization is sought. Record only what you personally "
     + "observe during this evaluation, never results from memory, from another person's account, or from "
     + "a previous evaluation.",
     "29 CFR 1910.178(l)(2)(ii)"],
    ["Truck in safe operating condition",
     "The truck must be examined before it is placed in service. A truck found in need of repair, "
     + "defective, or in any way unsafe must be taken out of service until it has been restored to safe "
     + "operating condition. No evaluation may be conducted on such a truck.",
     "29 CFR 1910.178(q)(7) and (p)(1)"],
    ["Safe conduct of the evaluation",
     "The operator may drive only under your direct supervision, and only where doing so does not "
     + "endanger the operator or other employees. Keep pedestrians clear of the evaluation area, ensure "
     + "the operator restraint is used where one is fitted, and stop the evaluation immediately if the "
     + "operator's performance creates a hazard.",
     "29 CFR 1910.178(l)(2)(i)"],
    ["Accurate results",
     "Mark a part of the evaluation as met only if the operator demonstrated it competently. Authorize "
     + "only the truck types on which the operator was actually evaluated. No operator may be certified "
     + "unless every part of the evaluation is met.",
     "29 CFR 1910.178(l)(1)(i)"],
    ["Certification record",
     "Your name and the date will be recorded as the evaluator on this certification, and the result "
     + "takes effect only when approved by the Training Manager. An evaluation is valid for no more than "
     + "three years. Re-evaluation is required sooner if the operator is observed operating unsafely, is "
     + "involved in an accident or near-miss, is assigned a different type of truck, or workplace "
     + "conditions change.",
     "29 CFR 1910.178(l)(6), (l)(4)(ii) and (l)(4)(iii)"],
    ["Integrity of the record",
     "Recording an evaluation that is false or incomplete endangers the operator and co-workers, and "
     + "exposes the company to liability. It is a violation of Agri-Service safety policy and may result "
     + "in disciplinary action.",
     "Agri-Service safety policy"]
  ],
  acknowledgment: "I have read and understand these responsibilities. I am qualified to conduct this "
    + "evaluation, and I will record only results I personally observe, in accordance with OSHA "
    + "29 CFR 1910.178(l) and Agri-Service safety policy."
};

// The version accepted for the test being recorded, or null. Each visit to the
// page, and each test recorded, asks again, as the app does.
let evalAgreed = null;
// What the last test recorded said, shown above the statement for the next.
let evalNotice = "";

function evalTermsCard() {
  return `${evalNotice ? `<div class="card terms-notice"><p class="ok" style="margin:0">${esc(evalNotice)}</p></div>` : ""}
    <article class="card terms-card">
      <div class="terms-eyebrow">Powered Industrial Truck Operator Evaluation</div>
      <h2 class="terms-title">Evaluator Responsibilities</h2>
      <div class="terms-cite">${icon("safety", 14)} OSHA 29 CFR 1910.178(l) · Operator training</div>
      <p class="terms-intro">${esc(EVALUATOR_TERMS.intro)}</p>
      <ol class="terms-list">${EVALUATOR_TERMS.clauses.map(([title, text, cite]) => `
        <li><b>${esc(title)}</b><p>${esc(text)}</p><small>${esc(cite)}</small></li>`).join("")}</ol>
      <label class="terms-accept" for="evalAccept">
        <input type="checkbox" id="evalAccept">
        <span>${esc(EVALUATOR_TERMS.acknowledgment)}</span>
      </label>
      <button type="button" class="terms-agree" data-eval-agree disabled>Agree and Begin the Evaluation</button>
    </article>`;
}

// Three years, the most OSHA allows between evaluations.
function evalExpiry(on) {
  const d = new Date(on + "T00:00:00");
  if (isNaN(d)) return "";
  d.setFullYear(d.getFullYear() + 3);
  return d.toISOString().slice(0, 10);
}

// "12 days left", for the picker.
function fkLeft(lastDay) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const days = Math.round((fkDay(lastDay) - today) / 86400000);
  return days <= 0 ? "last day" : days === 1 ? "1 day left" : `${days} days left`;
}

function renderEvalForm() {
  const classes = $("evalClasses");
  if (!classes) return;

  const picker = $("evalName");
  const keep = picker.value;
  picker.innerHTML = `<option value="">Choose someone</option>` + evalPeople
    .map(r => `<option value="${esc(r.person_key)}">${esc(r.name)}${r.last_day ? ` · ${esc(fkLeft(r.last_day))}` : ""}</option>`)
    .join("");
  if (keep && evalPeople.some(r => r.person_key === keep)) picker.value = keep;
  const chosen = evalPeople.find(r => r.person_key === picker.value);
  $("evalEmail").value = chosen ? (chosen.email || "") : "";
  $("evalCoursePassed").value = !chosen ? ""
    : (chosen.course_completed ? usDate(chosen.course_completed) : "Not on file yet")
      + (chosen.last_day ? ` · test due by ${fkDay(chosen.last_day).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}` : "");
  $("evalEligibleNote").textContent = evalPeople.length
    ? `People who passed the online course in the last 30 days and haven't had their test, soonest deadline first: ${evalPeople.length}.`
    : `Nobody can be given a driving test right now. People are listed here once they pass the online forklift course, for 30 days.`;
  classes.innerHTML = EVAL_CLASSES.map(c =>
    `<button class="pdf${evalState.classes.has(c) ? " on" : ""}" data-eval-class="${esc(c)}"
      aria-pressed="${evalState.classes.has(c)}">${esc(c)}</button>`).join(" ");
  $("evalChecks").innerHTML = EVAL_CHECKS.map(([key, label]) =>
    `<button class="pdf${evalState.checks.has(key) ? " on" : ""}" data-eval-check="${esc(key)}"
      aria-pressed="${evalState.checks.has(key)}">${evalState.checks.has(key) ? "&#10003; " : ""}${esc(label)}</button>`).join(" ");

  const passed = EVAL_CHECKS.every(([key]) => evalState.checks.has(key));
  $("evalVerdict").textContent = passed
    ? "All four met — this issues a certification card."
    : "Every part has to be met for the card to be issued. Anything left off is recorded as not passed.";
  $("evalVerdict").style.color = passed ? "var(--green-deep, #137026)" : "";

  const date = $("evalDate");
  // Local, not toISOString(): that is UTC, which after about 6 pm Mountain
  // is already tomorrow, and the record would carry the wrong day.
  if (date && !date.value) date.value = todayISO();
  if (date) $("evalExpires").value = evalExpiry(date.value);
}

async function saveEvaluation(button) {
  const card = $("evalCard");
  const chosen = evalPeople.find(r => r.person_key === $("evalName").value);
  const name = chosen ? chosen.name : "";
  const email = chosen ? (chosen.email || "").toLowerCase() : "";
  const on = $("evalDate").value;

  if (!name) return speak(card, "Choose who was evaluated.", true);
  if (!on) return speak(card, "When was the evaluation?", true);
  if (!evalState.classes.size) return speak(card, "Pick at least one truck class.", true);

  const passed = EVAL_CHECKS.every(([key]) => evalState.checks.has(key));
  const row = {
    operator_name: name,
    email: email || null,
    evaluation_date: on,
    expiration_date: evalExpiry(on),
    truck_classes: EVAL_CLASSES.filter(c => evalState.classes.has(c)),
    passed_driving: passed
  };
  EVAL_CHECKS.forEach(([key]) => { row[key] = evalState.checks.has(key); });
  row.evaluator_attestation = evalAgreed;

  button.disabled = true;
  let { data: saved, error } = await db.from("forklift_certifications").insert(row).select("id");
  if (error && /evaluator_attestation/.test(error.message)) {
    // A database without migration 0071 yet: the test still counts.
    delete row.evaluator_attestation;
    ({ data: saved, error } = await db.from("forklift_certifications").insert(row).select("id"));
  }
  button.disabled = false;
  if (error) {
    // Say what the database refused rather than show its wording. Two rules
    // share this refusal, so name both rather than guess which.
    return speak(card, /row-level security|violates/i.test(error.message)
      ? `That wasn't allowed. The person has to be on the All Employees report, `
        + `and you can't record your own.`
      : error.message, true);
  }

  evalState.classes.clear();
  evalState.checks.clear();
  $("evalName").value = "";
  renderEvalForm();
  const fresh = await db.from("forklift_certifications").select("*");
  if (fresh.data) certs = fresh.data;
  renderCerts();
  // The Training Manager is told there's a test to approve.
  if (saved && saved[0]) notify("forklift_evaluation", saved[0].id);
  // Back to the statement: the next test is accepted afresh.
  evalNotice = passed
    ? `Sent for approval. ${name}'s card will run until ${usDate(row.expiration_date)} once the Training Manager approves it.`
    : `Recorded. ${name} hasn't passed, so no card is issued. It goes on record once the Training Manager approves it.`;
  evalAgreed = null;
  showView("evaltest");
}

// Mirrors ForkliftEvaluationPDF.swift, so a result printed from a desk and one
// printed from a phone are the same document.
function downloadEvaluationPDF(cert) {
  const doc = new jspdf.jsPDF({ unit: "pt", format: "letter" });
  const MARGIN = 54, WIDTH = 612 - MARGIN * 2;
  let y = MARGIN;

  const text = (str, x, top, { size = 11, style = "normal", grey, width } = {}) => {
    doc.setFont("helvetica", style);
    doc.setFontSize(size);
    doc.setTextColor(grey == null ? 0 : grey);
    const lines = width ? doc.splitTextToSize(String(str), width) : [String(str)];
    doc.text(lines, x, top + size * 0.85);
    return lines.length * size * 1.25;
  };
  const or = (v) => String(v ?? "").trim() || "-";

  doc.setFillColor(204, 0, 51);
  doc.rect(MARGIN, y, WIDTH, 26, "F");
  text("FORKLIFT DRIVING TEST", MARGIN + 8, y + 5, { size: 15, style: "bold", grey: 255 });
  y += 30;
  text("Powered industrial truck operator evaluation - Agri-Service, LLC", MARGIN, y,
       { size: 9, grey: 90 });
  y += 24;

  const [statusLabel, statusClass] = certStatus(cert);
  const passed = statusClass === "b-current" || statusClass === "b-expiring";
  if (passed) doc.setFillColor(232, 243, 235); else doc.setFillColor(251, 233, 237);
  doc.rect(MARGIN, y, WIDTH, 44, "F");
  if (passed) doc.setFillColor(19, 112, 38); else doc.setFillColor(204, 0, 51);
  doc.rect(MARGIN, y, 4, 44, "F");
  text(statusLabel.toUpperCase(), MARGIN + 14, y + 8,
       { size: 13, style: "bold", grey: passed ? 40 : 60 });
  text(passed
       ? `Certified to operate the truck types listed below until ${usDate(cert.expiration_date)}.`
       : "Not certified to operate a powered industrial truck.",
       MARGIN + 14, y + 26, { size: 9, grey: 90 });
  y += 60;

  const section = (label) => {
    y += 6;
    text(label.toUpperCase(), MARGIN, y, { size: 11, style: "bold" });
    y += 16;
    doc.setFillColor(200, 200, 200);
    doc.rect(MARGIN, y, WIDTH, 0.5, "F");
    y += 8;
  };
  const pair = (l1, v1, l2, v2) => {
    const half = (WIDTH - 16) / 2;
    text(l1.toUpperCase(), MARGIN, y, { size: 8, style: "bold", grey: 128 });
    text(l2.toUpperCase(), MARGIN + half + 16, y, { size: 8, style: "bold", grey: 128 });
    y += 11;
    text(or(v1), MARGIN, y, { width: half });
    text(or(v2), MARGIN + half + 16, y, { width: half });
    y += 19;
  };

  section("Operator");
  pair("Name", cert.operator_name, "Work email", cert.email);
  pair("Evaluated", usDate(cert.evaluation_date), "Expires", usDate(cert.expiration_date));
  text("TRUCK TYPES AUTHORISED", MARGIN, y, { size: 8, style: "bold", grey: 128 });
  y += 11;
  y += text((cert.truck_classes || []).join(", ") || "None recorded", MARGIN, y, { width: WIDTH });
  y += 8;
  // The classroom half of the certification.
  pair("Certification course passed",
       cert.course_completed_on ? usDate(cert.course_completed_on) : "Not on the training record",
       "Course", forkliftCourse());

  section("The evaluation");
  EVAL_CHECKS.forEach(([key, label]) => {
    const met = cert[key];
    // "[x]" rather than a tick: jsPDF's built-in fonts are Latin-1 only.
    text(met ? "[x]" : "[ ]", MARGIN, y, { style: "bold" });
    text(label, MARGIN + 22, y, { grey: met ? 0 : 90 });
    text(met === true ? "Met" : met === false ? "Not met" : "Not recorded",
         612 - MARGIN - 90, y, { grey: met ? 0 : 90 });
    y += 16;
  });

  section("Signed off by");
  pair("Evaluated by", cert.evaluator_name || "Not recorded",
       "On", usDate(cert.evaluation_date));
  // The evaluator's acceptance of their responsibilities (migration 0071).
  if (cert.evaluator_attested_at) {
    y += text(`The evaluator accepted the evaluator responsibilities under OSHA 29 CFR 1910.178(l) `
      + `(statement of ${cert.evaluator_attestation || "-"}) when recording this test, on `
      + `${new Date(cert.evaluator_attested_at).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })}.`,
      MARGIN, y, { size: 9, grey: 90, width: WIDTH }) + 4;
  }

  y += 16;
  y += text("An evaluation is valid for three years, which is the maximum OSHA "
            + "1910.178(l)(4)(iii) allows between evaluations. Keep this with the "
            + "operator's training record.", MARGIN, y, { size: 9, grey: 90, width: WIDTH });

  text(`Agri-Service, LLC - printed ${usDate(todayISO())}`,
       MARGIN, 792 - MARGIN + 6, { size: 9, grey: 128 });

  doc.save(`Forklift Driving Test - ${cert.operator_name}.pdf`);
}

document.addEventListener("click", (event) => {
  const truckClass = event.target.closest("[data-eval-class]");
  if (truckClass) {
    const name = truckClass.dataset.evalClass;
    if (evalState.classes.has(name)) evalState.classes.delete(name);
    else evalState.classes.add(name);
    return renderEvalForm();
  }
  const check = event.target.closest("[data-eval-check]");
  if (check) {
    const key = check.dataset.evalCheck;
    if (evalState.checks.has(key)) evalState.checks.delete(key);
    else evalState.checks.add(key);
    return renderEvalForm();
  }
  const save = event.target.closest('button[data-act="eval-save"]');
  if (save) return saveEvaluation(save);
  if (event.target.closest("[data-eval-agree]")) {
    if (!$("evalAccept") || !$("evalAccept").checked) return;
    evalAgreed = EVALUATOR_TERMS.version;
    evalNotice = "";
    showView("evaltest");
    return;
  }

  const pdf = event.target.closest("[data-eval-pdf]");
  if (pdf) {
    const cert = certs.find(c => String(c.id) === pdf.dataset.evalPdf);
    if (cert) downloadEvaluationPDF(cert);
    return;
  }
});

document.addEventListener("change", (event) => {
  if (event.target && event.target.id === "evalDate") renderEvalForm();
});

// A saved template can come back as a spreadsheet as easily as a CSV, so both
// are read the same way.
async function importCertifications(file) {
  let rows;
  try { rows = await rowsFromFile(file); }
  catch (e) {
    $("importResult").innerHTML = `<p class="error">Couldn't read that file: ${esc(e.message)}</p>`;
    return;
  }
  return importCertRows(rows);
}

async function importCertRows(rows) {
  if (rows.length < 2) {
    $("importResult").innerHTML = `<p class="error">That file has no data rows.</p>`;
    return;
  }

  const header = (rows[0] || []).map(h => String(h ?? "").trim().toLowerCase());
  const col = (name) => header.indexOf(name.toLowerCase());
  const need = ["operator name", "expiration date"];
  const missing = need.filter(n => col(n) === -1);
  if (missing.length) {
    $("importResult").innerHTML =
      `<p class="error">This doesn't look like the certification export — missing: ${missing.join(", ")}.</p>`;
    return;
  }

  // A spreadsheet hands dates back as serial numbers and everything else as
  // whatever type the cell held, so read both shapes rather than assuming text.
  const at = (row, name) => cell(row, col(name));
  const dateAt = (row, name) => {
    const raw = (row || [])[col(name)];
    return excelDate(raw) || toISODate(cell(row, col(name)));
  };

  const records = rows.slice(1).map(r => ({
    operator_name:     at(r, "Operator Name"),
    email:             at(r, "Email") || null,
    evaluation_date:   dateAt(r, "Evaluation Date"),
    evaluator_name:    at(r, "Evaluator Name") || null,
    expiration_date:   dateAt(r, "Expiration Date"),
    truck_classes:     toClasses(at(r, "Truck Type Authorized")),
    passed_driving:    toBool(at(r, "Successful Completion of Driving Evaluation")),
    inspection:        toBool(at(r, "Inspection")),
    use_of_controls:   toBool(at(r, "Use of Controls")),
    maneuvering:       toBool(at(r, "Maneuvering Skills")),
    driving_with_load: toBool(at(r, "Driving with Load")),
    modified_by:       at(r, "Modified By") || null
  })).filter(r => r.operator_name);

  // One call that empties the table and refills it inside a single database
  // transaction. A delete followed by an insert meant one bad date could leave
  // the table empty, with no backup on the free plan to restore from. See
  // migration 0022.
  const { error } = await db.rpc("replace_forklift_certifications", { records });

  if (error) {
    $("importResult").innerHTML =
      `<p class="error">Import failed: ${esc(error.message)}</p>
       <p class="note">Only administrators can import. Check you're signed in as one.</p>`;
    return;
  }

  await loadAll();
  renderCerts();

  // Rows and people are different numbers now that one person can hold several
  // records, so say both.
  const people = new Set(records.map(r =>
    (r.email || r.operator_name || "").trim().toLowerCase())).size;
  $("importResult").innerHTML =
    `<p class="ok">Imported ${records.length} record${records.length === 1 ? "" : "s"}
     for ${people} ${people === 1 ? "person" : "people"}.</p>`;
}

$("certSearch").addEventListener("input", renderCerts);
