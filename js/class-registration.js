// Registering for a class on the schedule (migration 0123)
//
// Stage 3 of moving training off the UKG uploads (docs/lms-plan.html). Each
// class's setting says who registers whom: open to everyone (people register
// themselves, admins their people), admin only (admins register their
// people), or Training Manager only. The Training Manager registers anyone,
// any time. The database holds those rules, the seats and the waitlist; this
// draws the buttons and the lists, on the Open Seat Report for everyone, on
// My Classes, and on the Class Schedule for the Training Manager.
//
// Rosters come from the Open Seat Report itself, which the database keeps
// with the registrations, so they read the same as UKG's. Admins and owners
// also load the registrations they may manage (an admin's people, or
// everyone), to cancel them.

let crRegs = [];
// People picked to register, by class: class id -> All Employees keys.
let crPicked = {};

const crEmail = () => ((me && me.email) || "").trim().toLowerCase();
const crScheduled = () => ((trainingReports.internal && trainingReports.internal.data || {}).classes || [])
  .filter(c => c.source === "scheduled" && c.classId);
const crClass = (id) => crScheduled().find(c => c.classId === id);
const crName = (p) => `${p.first_name || ""} ${p.last_name || ""}`.trim() || p.email || p.person_key;

async function loadClassRegistrations() {
  if (!isAdmin()) return;
  const ids = crScheduled().map(c => c.classId);
  if (!ids.length) { crRegs = []; return; }
  const { data, error } = await allRows(() => db.from("class_registrations").select("*")
    .in("class_id", ids).order("listed_at").order("id"));
  crRegs = error ? [] : data || [];
}

// ---- what the viewer can do --------------------------------------------------------------

// On the roster or the waitlist, by the work email you sign in with.
function crMine(c) {
  const email = crEmail();
  if (!email) return null;
  const at = (list) => (list || []).findIndex(p => (p.email || "").trim().toLowerCase() === email);
  if (at(c.roster) >= 0) return { state: "registered" };
  const place = at(c.waitlist);
  return place >= 0 ? { state: "waitlisted", place: place + 1 } : null;
}
// Past the register-by date, or started: only the Training Manager then.
const crClosed = (c) => !isTrainingManager()
  && ((c.registerBy && c.registerBy < osrToday()) || (c.startDate && c.startDate < osrToday()));
const crCanSelf = (c) => isTrainingManager() || c.registration === "everyone" || (c.registration === "admins" && isAdmin());
const crCanOthers = (c) => isTrainingManager() || (isAdmin() && ["everyone", "admins"].includes(c.registration));
const CR_WHO = { everyone: "Open to everyone", admins: "Admin only", training_manager: "Training Manager only" };
const crDay = (ymd) => dateOnly(ymd).toLocaleDateString("en-US", { month: "short", day: "numeric" });

// The registration behind a name on a list, if the viewer may see it.
const crRegFor = (c, p, status) => crRegs.find(r => r.class_id === c.classId && r.status === status
  && (p.email ? (r.email || "").toLowerCase() === p.email.toLowerCase() : crName(r) === p.name));

// "Open to everyone · Register by Nov 22 · 2 waiting", under the seats.
function crNoteHtml(c) {
  const waiting = (c.waitlist || []).length;
  return `<div class="cr-note">${[CR_WHO[c.registration] || "", c.registerBy && `Register by ${crDay(c.registerBy)}`,
    waiting && `${waiting} on the waitlist`].filter(Boolean).map(esc).join(" · ")}</div>`;
}

// The card's buttons, in place of Request Registration.
function crActionsHtml(c, plainWhen) {
  const mine = crMine(c);
  const id = esc(c.classId);
  if (mine && mine.state === "registered") {
    return `<span class="cr-state on">${icon("check", 14)} You're registered</span>
      <button type="button" class="cr-leave" data-cr-leave="${id}">Cancel my registration</button>`;
  }
  if (mine) {
    return `<span class="cr-state wait">On the waitlist, #${mine.place}</span>
      <button type="button" class="cr-leave" data-cr-leave="${id}">Leave the waitlist</button>`;
  }
  if (crClosed(c)) return `<span class="cr-state">Registration closed</span>`;
  if (crCanSelf(c)) {
    return `<button type="button" class="osr-request" data-cr-join="${id}">${icon("pencil", 14)} ${c.available > 0 ? "Register" : "Join the waitlist"}</button>`;
  }
  if (c.registration === "admins") return `<span class="cr-state">Your location admin registers people for this class</span>`;
  return osrRequestButton(c.title, c.city, plainWhen);
}

// The roster and waitlist, with Cancel for the people the viewer looks after,
// and a picker to register more.
function crRosterHtml(c) {
  const manage = crCanOthers(c);
  const row = (p, n, status) => {
    const reg = crRegFor(c, p, status);
    const mine = (p.email || "").toLowerCase() === crEmail() && crEmail();
    const can = reg && (manage || isTrainingManager()) && !crClosed(c);
    return `<tr><td class="osr-num">${n}</td><td class="osr-name">${esc(p.name)}</td><td>${esc(p.store || "")}</td>
      <td>${p.email ? `<a href="mailto:${esc(p.email)}">${esc(p.email)}</a>` : ""}</td>
      <td class="cr-act">${reg ? `<small>${reg.listed_by_name ? `Added by ${esc(reg.listed_by_name)}` : ""}${reg.moved_up_at ? " · moved up" : ""}</small>` : ""}
        ${mine ? "" : can ? `<button type="button" class="cr-leave" data-cr-cancel="${esc(reg.id)}" data-cr-who="${esc(p.name)}">Cancel</button>` : ""}</td></tr>`;
  };
  const table = (list, status) => `<table class="osr-roster cr-roster"><thead><tr><th>#</th><th>Name</th><th>Location</th><th>Email</th><th></th></tr></thead>
    <tbody>${list.map((p, i) => row(p, i + 1, status)).join("")}</tbody></table>`;
  const waitlist = c.waitlist || [];
  return `${c.roster.length ? table(c.roster, "registered") : `<p class="osr-empty">No one is registered yet.</p>`}
    ${waitlist.length ? `<h4 class="cr-head">Waitlist</h4>
      <p class="cr-sub">They move up in this order when a seat opens, and are told.</p>${table(waitlist, "waitlisted")}` : ""}
    ${manage && !crClosed(c) ? crPickerHtml(c) : ""}`;
}

function crPickerHtml(c) {
  const picked = crPicked[c.classId] || [];
  const byKey = new Map(tsPeople.map(p => [p.person_key, p]));
  return `<div class="cr-picker" data-cr-picker="${esc(c.classId)}">
      <h4 class="cr-head">Register ${isTrainingManager() || isOwner() ? "people" : "your people"}</h4>
      <div class="cr-picked">${picked.map(k => `<button type="button" class="chip on" data-cr-unpick="${esc(k)}">${esc(crName(byKey.get(k) || { person_key: k }))} ×</button>`).join("")}</div>
      <div class="row">
        <input type="text" class="cr-find" data-cr-find="${esc(c.classId)}" enterkeyhint="search" autocomplete="off"
          aria-label="Find people to register" placeholder="Search by name or location">
        <button type="button" data-cr-add="${esc(c.classId)}"${picked.length ? "" : " disabled"}>${picked.length > 1
          ? `Register ${picked.length} people` : "Register"}</button>
      </div>
      <div class="cr-matches"></div>
      <span class="msg"></span>
    </div>`;
}

function crDrawMatches(input) {
  const id = input.dataset.crFind, c = crClass(id);
  const box = input.closest(".cr-picker").querySelector(".cr-matches");
  const words = input.value.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length || !c) { box.innerHTML = ""; return; }
  const on = new Set([...c.roster, ...(c.waitlist || [])].map(p => (p.email || p.name).toLowerCase()));
  const picked = crPicked[id] || [];
  const found = tsPeople.filter(p => !picked.includes(p.person_key) && !on.has((p.email || crName(p)).toLowerCase())
      && words.every(w => `${crName(p)} ${p.store || ""} ${p.email || ""}`.toLowerCase().includes(w)))
    .sort((a, b) => crName(a).localeCompare(crName(b))).slice(0, 8);
  box.innerHTML = found.map(p => `<button type="button" class="tc-match" data-cr-pick="${esc(p.person_key)}">
      <b>${esc(crName(p))}</b><span>${esc([p.store, (p.job || "").replace(/^\d+\s*-\s*/, "")].filter(Boolean).join(" · "))}</span></button>`).join("")
    || `<p class="note">Nobody by that name${isTrainingManager() || isOwner() ? "" : " at your locations"} who isn't on the list already.</p>`;
}

// ---- doing it ------------------------------------------------------------------------------

// After a change: tell whoever the database queued a notice for, reload the
// report (the rosters) and the registrations, and redraw where we are.
async function crAfter(classId) {
  notify("class_notices", classId);
  const { data, error } = await db.from("training_reports").select("*");
  if (!error) trainingReports = Object.fromEntries((data || []).map(r => [r.id, r]));
  await loadClassRegistrations();
  if (viewShown === "openseat" || viewShown === "myclasses") {
    const open = [...document.querySelectorAll("[data-osr-class-id]")]
      .filter(card => !card.querySelector(".osr-body").hidden).map(card => card.dataset.osrClassId);
    const y = window.scrollY;
    showView(viewShown);
    open.forEach(id => {
      const card = document.querySelector(`[data-osr-class-id="${CSS.escape(id)}"]`);
      if (!card) return;
      card.querySelector(".osr-body").hidden = false;
      card.querySelector("[data-osr-toggle]").setAttribute("aria-expanded", "true");
    });
    window.scrollTo(0, y);
  }
  if (typeof renderClassSchedule === "function") safely(renderClassSchedule);
}

async function crCall(name, args) {
  const { data, error } = await db.rpc(name, args);
  if (error) { alert(error.message); return null; }
  return data ?? true;
}

document.addEventListener("input", (event) => {
  if (event.target.matches("[data-cr-find]")) crDrawMatches(event.target);
});

document.addEventListener("click", async (event) => {
  const t = event.target;
  const join = t.closest("[data-cr-join]");
  if (join) {
    const c = crClass(join.dataset.crJoin);
    if (!c) return;
    join.disabled = true;
    const done = await crCall("register_for_class", { target_class: c.classId });
    join.disabled = false;
    if (!done) return;
    await crAfter(c.classId);
    if (done.waitlisted) alert(`${c.title} is full, so you're on the waitlist. You'll be told if a seat opens.`);
    return;
  }
  const leave = t.closest("[data-cr-leave]");
  if (leave) {
    const c = crClass(leave.dataset.crLeave);
    const mine = c && crMine(c);
    if (!c || !confirm(mine && mine.state === "waitlisted" ? `Leave the waitlist for ${c.title}?`
      : `Cancel your registration for ${c.title} on ${crDay(c.startDate)}? Your seat goes to the next person waiting.`)) return;
    leave.disabled = true;
    if (await crCall("cancel_my_class_registration", { target_class: c.classId })) await crAfter(c.classId);
    leave.disabled = false;
    return;
  }
  const cancel = t.closest("[data-cr-cancel]");
  if (cancel) {
    const reg = crRegs.find(r => r.id === cancel.dataset.crCancel);
    if (!reg || !confirm(`Cancel ${cancel.dataset.crWho}'s ${reg.status === "waitlisted" ? "place on the waitlist" : "registration"}? `
      + "They're told, and a seat that opens goes to the next person waiting.")) return;
    cancel.disabled = true;
    if (await crCall("cancel_class_registration", { target_registration: reg.id })) await crAfter(reg.class_id);
    cancel.disabled = false;
    return;
  }
  const pick = t.closest("[data-cr-pick]");
  if (pick) {
    const picker = pick.closest("[data-cr-picker]"), id = picker.dataset.crPicker;
    crPicked[id] = (crPicked[id] || []).concat(pick.dataset.crPick);
    picker.outerHTML = crPickerHtml(crClass(id));
    return document.querySelector(`[data-cr-find="${CSS.escape(id)}"]`).focus();
  }
  const unpick = t.closest("[data-cr-unpick]");
  if (unpick) {
    const picker = unpick.closest("[data-cr-picker]"), id = picker.dataset.crPicker;
    crPicked[id] = (crPicked[id] || []).filter(k => k !== unpick.dataset.crUnpick);
    picker.outerHTML = crPickerHtml(crClass(id));
    return;
  }
  const add = t.closest("[data-cr-add]");
  if (add) {
    const id = add.dataset.crAdd, people = crPicked[id] || [];
    if (!people.length) return;
    add.disabled = true;
    const done = await crCall("register_for_class", { target_class: id, people });
    add.disabled = false;
    if (!done) return;
    crPicked[id] = [];
    await crAfter(id);
    const parts = [done.registered && `${done.registered} registered`, done.waitlisted && `${done.waitlisted} on the waitlist (the class is full)`,
      done.already && `${done.already} already on the list`].filter(Boolean);
    const picker = document.querySelector(`[data-cr-picker="${CSS.escape(id)}"]`);
    if (picker) speak(picker, `Done: ${parts.join(", ")}.`, false);
  }
});
