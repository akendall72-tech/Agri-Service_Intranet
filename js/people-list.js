// People list (migration 0140, multi-org step 5)
//
// Who works for the company, kept up to date by its feeds: the All employees
// upload (training-status.js sends it here after publishing), the company's
// Microsoft 365 directory (0145, below: checked and synced from here, and every
// night by the microsoft-directory function), and anyone an owner adds by
// hand. Leavers are kept, marked as left. The admin page's People list tab is
// drawn here, and join slips are given from it.

let plRows = [], plRuns = [], plError = null, plMissing = false;
let plQuery = "", plFilter = "here", plAdding = false, plMessage = "", plProblem = "";
// Slips given while this page is open (0141). Their codes are shown only now:
// the database keeps a fingerprint, never the code.
let plSlips = [], plSlipBusy = false;

async function loadEmployees() {
  // Owners see everyone; a location's admins their locations' people (the
  // database decides), for the Location Dashboard's Join slips tab.
  if (!me || !(isOwner() || isLocationAdmin())) return;
  const [rows, runs, nights] = await Promise.all([
    allRows(() => db.from("employees").select("*").order("last_name").order("first_name").order("id")),
    db.from("employee_runs").select("*").order("at", { ascending: false }).limit(5),
    company.microsoft_tenant && isOwner()
      ? db.from("microsoft_syncs").select("*").order("at", { ascending: false }).limit(1) : { data: [] }]);
  plMsLast = (!nights.error && nights.data && nights.data[0]) || null;
  plError = rows.error ? rows.error.message : null;
  plMissing = !!rows.error && /does not exist|schema cache/i.test(rows.error.message);
  plRows = rows.error ? [] : rows.data || [];
  plRuns = runs.error ? [] : runs.data || [];
}

// The account that's this person's, by number then email, as the database
// matches them.
function plAccount(e) {
  return people.find(p => e.employee_number && p.employee_number === e.employee_number)
    || people.find(p => e.email && (p.email || "").toLowerCase() === e.email) || null;
}

const plName = (e) => `${e.first_name || ""} ${e.last_name || ""}`.trim() || e.email || e.person_key;
const plPlace = (e) => locations[e.location_id] || e.store || "";

// What an upload (or Microsoft) would do to the list, for its preview: the
// same counting and the same guard as sync_employees().
function plPreview(list, feed = "upload") {
  const mine = plRows.filter(e => e.source === feed);
  const byKey = new Map(plRows.map(e => [e.person_key, e]));
  const keys = new Set(list.map(p => p.person_key));
  const joined = list.filter(p => !byKey.has(p.person_key)).length;
  const back = list.filter(p => byKey.has(p.person_key) && !byKey.get(p.person_key).here).length;
  const moved = list.filter(p => { const e = byKey.get(p.person_key);
    return e && e.here && storeLocation(p.store) !== e.location_id; }).length;
  const leaving = mine.filter(e => e.here && !keys.has(e.person_key));
  const hereNow = mine.filter(e => e.here).length;
  const placesNext = new Set(list.map(p => storeLocation(p.store)).filter(Boolean));
  const emptied = [...new Set(mine.filter(e => e.here && e.location_id && !placesNext.has(e.location_id)).map(e => e.location_id))]
    .map(id => locations[id] || id);
  const tooMany = leaving.length > Math.max(3, Math.ceil(hereNow * 0.1)) || emptied.length > 0;
  return { joined, back, moved, leaving, hereNow, emptied, tooMany };
}

function renderPeopleList() {
  const box = $("peopleListAdmin");
  if (!box) return;
  if (plMissing) {
    box.innerHTML = `<div class="card"><p class="error">Run migration 0140_people_list.sql in the SQL editor, then reload this page.</p></div>`;
    return;
  }
  const here = plRows.filter(e => e.here), gone = plRows.filter(e => !e.here);
  const noAccount = here.filter(e => !plAccount(e));
  const byHand = plRows.filter(e => e.source === "by hand");
  const q = plQuery.trim().toLowerCase();
  const shown = (plFilter === "left" ? gone : plFilter === "noaccount" ? noAccount : plFilter === "byhand" ? byHand : here)
    .filter(e => !q || [plName(e), e.email, e.employee_number, e.job, plPlace(e)].some(v => String(v || "").toLowerCase().includes(q)));
  const last = plRuns[0];
  const feed = company.microsoft_tenant && company.microsoft_sync ? "Microsoft 365, every night" : "the All employees upload";
  const tile = (id, label, n, sub, colour, hot) =>
    cabTile(label, sxNum(n), sub, { colour, data: `data-pl-filter="${id}"`, on: plFilter === id, hot });
  const titles = { here: "Here now", noaccount: "No account yet", byhand: "Added by hand", left: "Left" };

  // The slips sheet is printed, so it stays a plain white card, above the rest.
  box.innerHTML = plSlipSheet() + `<div class="sx cab-admin pl" style="${lit("teal")}">
    <section class="sx-hero">
      <div class="sx-hero-text">
        <span class="sx-kicker">People · People list</span>
        <h2>${sxNum(here.length)} ${here.length === 1 ? "person" : "people"} here</h2>
        <p>Everyone who works for ${esc(companyName())}, kept up to date by ${esc(feed)}${company.microsoft_tenant ? "" : " or Microsoft 365"},
          and anyone added by hand. Being on it is what lets someone in, with a join slip or Microsoft. Nobody is ever deleted:
          someone who drops off is marked as left. Who can sign in, and what they can do, is on
          <button type="button" class="cab-goto" data-goto-tab="people">Accounts</button>.</p>
      </div>
    </section>
    ${plError && !plMissing ? `<p class="error">${esc(plError)}</p>` : ""}
    ${plMessage ? `<p class="pf-ok">${esc(plMessage)}</p>` : ""}
    ${plProblem ? `<p class="error">${esc(plProblem)}</p>` : ""}
    <div class="sx-tiles" style="--n:4">
      ${tile("here", "Here", here.length, "On the list now", "teal")}
      ${tile("noaccount", "No account yet", noAccount.length, noAccount.length ? "Give them a join slip" : "Everyone has one", noAccount.length ? "amber" : "green", noAccount.length > 0)}
      ${tile("byhand", "Added by hand", byHand.length, "No feed takes them off", "steel")}
      ${tile("left", "Left", gone.length, "Kept, marked as left", "muted")}
    </div>

    <section class="sx-panel" style="${lit("teal")}">
      <header><h3>${esc(titles[plFilter] || titles.here)}</h3><span>${sxNum(shown.length)}${q ? " matching" : ""}</span>
        <input type="search" id="plSearch" class="cab-search" placeholder="Search name, number, email, job or location"
          aria-label="Search the People list" value="${esc(plQuery)}"></header>
      ${last ? `<div class="pl-run">
        <span><b>${last.undone_at ? "Undone:" : "Last change:"}</b> ${esc(new Date(last.at).toLocaleString())}${last.file ? ` from ${esc(last.file)}` : ""}
          · ${last.joined} joined, ${last.changed} changed, ${last.left_list} left, ${last.back} back${last.by_name ? ` · ${esc(last.by_name)}` : ""}</span>
        ${!last.undone_at && last.by_name !== "migration 0140" ? `<button type="button" class="btn-secondary" data-pl-undo>Undo it</button>` : ""}
      </div>` : ""}
      ${plFilter === "noaccount" && noAccount.length ? `<div class="pl-actions"><button type="button"
        data-pl-slips-all ${plSlipBusy ? "disabled" : ""}>Join slips for all ${noAccount.length} with no account</button></div>` : ""}
      ${!shown.length ? `<p class="sx-empty">Nobody${q ? " matches" : " here"}.</p>` : `
      <div class="lc-scroll"><table class="lc-table pl-table">
        <thead><tr><th>Name</th><th>Number</th><th>Email</th><th>Job</th><th>Location</th><th>From</th><th>Account</th><th></th></tr></thead>
        <tbody>${shown.map(e => { const a = plAccount(e); return `<tr class="${e.here ? "" : "pl-gone"}">
          <td><b>${esc(plName(e))}</b>${e.here ? "" : `<small>Left ${esc(new Date(e.left_at).toLocaleDateString())}</small>`}</td>
          <td>${esc(e.employee_number || "")}</td><td>${esc(e.email || "")}</td><td>${esc(e.job || "")}</td><td>${esc(plPlace(e))}</td>
          <td>${e.source === "by hand" ? "By hand" : e.source === "upload" ? "Upload" : e.source === "microsoft" ? "Microsoft" : esc(e.source)}</td>
          <td>${!a ? `<span class="note">None yet</span>` : a.deactivated_at ? `<span class="badge b-none">Switched off</span>` : `<span class="badge b-current">Has one</span>`}</td>
          <td class="pl-do">${plSlipButton(e)}${e.source === "by hand" ? `<button type="button" class="pdf" data-pl-remove="${esc(e.id)}">Remove</button>` : ""}</td>
        </tr>`; }).join("")}</tbody>
      </table></div>`}
    </section>

    <div id="plUploadSlot"></div>

    <section class="sx-panel" style="${lit("ember")}">
      <header><h3>When someone leaves</h3></header>
      <label class="pl-setting"><input type="checkbox" id="plDeactivate" ${company.deactivate_leavers ? "checked" : ""}>
        <span><b>Switch off the account of someone who leaves the list</b>, and back on if they return.
          Owners' accounts are never switched off this way. Off, an owner switches accounts off by hand on Accounts.</span></label>
    </section>

    ${company.microsoft_tenant && isOwner() ? plMicrosoftCard() : ""}

    <section class="sx-panel" style="${lit("green")}">
      <header><h3>Add someone by hand</h3></header>
      <p class="sx-sub">For someone the feed doesn't have yet: a new hire, a contractor. They need an employee number or a work
        email. If a later upload or Microsoft has them, it takes them over.</p>
      <div class="pl-fields">
        <div><label for="plFirst">First name</label><input type="text" id="plFirst" maxlength="60"></div>
        <div><label for="plLast">Last name</label><input type="text" id="plLast" maxlength="60"></div>
        <div><label for="plNumber">Employee number</label><input type="text" id="plNumber" maxlength="20"></div>
        <div><label for="plEmail">Work email</label><input type="email" id="plEmail" maxlength="120"></div>
        <div><label for="plJob">Job</label><input type="text" id="plJob" maxlength="80"></div>
        <div><label for="plLocation">Location</label><select id="plLocation"><option value="">—</option>
          ${allLocations.filter(l => l.is_active !== false).map(l => `<option value="${esc(l.id)}">${esc(l.name)}</option>`).join("")}</select></div>
      </div>
      <div class="pl-actions"><button type="button" id="plAdd" ${plAdding ? "disabled" : ""}>Add to the list</button></div>
    </section>
  </div>`;
  // The All employees upload: the same panel each time, with any file still waiting in it.
  const upload = plUploadPanel || (plUploadPanel = $("plUpload"));
  const slot = $("plUploadSlot");
  if (upload && slot) slot.replaceWith(upload);
}
let plUploadPanel = null;

// A slip button for someone on the list: a join slip with no account yet, a
// password slip with one. An admin doesn't give password slips for admins or
// owners (the database refuses too).
function plSlipButton(e) {
  if (!e.here || (!e.employee_number && !e.email)) return "";
  const a = plAccount(e);
  if (a && (a.deactivated_at || (["admin", "owner"].includes(a.role) && !isOwner()))) return "";
  return `<button type="button" class="pdf" data-pl-slip="${esc(e.id)}" data-kind="${a ? "password" : "join"}"
    ${plSlipBusy ? "disabled" : ""}>${a ? "Password slip" : "Join slip"}</button>`;
}

// The slips given so far, to print or copy before leaving the page.
function plSlipSheet() {
  if (!plSlips.length) return "";
  const until = (at) => new Date(at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  return `<div class="card pl-sheet">
      <h2>Slips to hand out (${plSlips.length})</h2>
      <p class="note">These codes are shown only now. Print them, or copy them down, before leaving this page; a lost one is
        replaced by giving a new slip, which cancels the old.</p>
      <div class="pl-actions"><button type="button" data-pl-print>Print slips</button>
        <button type="button" class="btn-secondary" data-pl-clear>Done</button></div>
      <div class="pl-print">${plSlips.map(s => `<div class="pl-slip">
        <div class="pl-slip-head"><b>${esc(companyName())}</b><span>${s.kind === "password" ? "Password slip" : "Join slip"}${s.location ? ` · ${esc(s.location)}` : ""}</span></div>
        <div class="pl-slip-name">${esc(s.full_name)}</div>
        <div class="pl-slip-code">${esc(s.code)}</div>
        <div class="pl-slip-small">Sign in as <b>${esc(s.sign_in)}</b> · use by ${esc(until(s.expires_at))} · works once</div>
        <ol>
          <li>Open the ${esc(companyName())} app on your phone.</li>
          <li>Tap <b>Have a join slip?</b> on the sign-in screen and enter the code.</li>
          <li>Check it's your name, then pick ${s.kind === "password" ? "a new" : "your own"} password. Keep this slip private.</li>
        </ol>
      </div>`).join("")}</div>
    </div>`;
}

async function plMakeSlips(list) {
  plSlipBusy = true; plProblem = ""; plMessage = "";
  plRedrawSlips();
  const problems = [];
  for (const e of list) {
    const kind = plAccount(e) ? "password" : "join";
    const { data, error } = await db.rpc("make_join_slip", { person: e.id, slip_kind: kind });
    if (error) problems.push(error.message);
    else if (data && data[0]) {
      plSlips = plSlips.filter(s => s.person !== e.id);
      plSlips.push({ ...data[0], kind, person: e.id });
    }
  }
  plSlipBusy = false;
  plProblem = problems.length ? [...new Set(problems)].join(" ") : "";
  plRedrawSlips();
  const sheet = document.querySelector(".pl-sheet");
  if (sheet) sheet.scrollIntoView({ behavior: "smooth", block: "start" });
}

// Wherever the slips were given from: the People list or the Location Dashboard.
function plRedrawSlips() {
  renderPeopleList();
  if (typeof renderLocationSlips === "function") renderLocationSlips();
}

// The Location Dashboard's Join slips tab: this location's people, for its admins.
function renderLocationSlips() {
  const box = $("locationSlips");
  if (!box) return;
  if (plMissing) {
    box.innerHTML = `<div class="card"><p class="error">Run migration 0140_people_list.sql in the SQL editor, then reload this page.</p></div>`;
    return;
  }
  const loc = lxCurrent();
  const here = plRows.filter(e => e.here && e.location_id === loc);
  const waiting = here.filter(e => !plAccount(e) && (e.employee_number || e.email));
  const withAccount = here.filter(e => plAccount(e)).length;
  // The Field Ready tick (0162), for an employee here with an account, at a
  // company linked to it: an admin gives it to their location's employees.
  const tickCell = (a) => {
    if (!a || a.deactivated_at || a.role !== "employee" || !companyLinkedToInspect()) return "";
    if (!inspectTicks) {
      if (!inspectTicksLoading) loadInspectTicks();
      return "";
    }
    const on = !!(inspectTicks[a.id] || {}).inspect_access;
    return `<label class="check" style="margin:6px 0 0;font-size:12.5px;white-space:nowrap">
      <input type="checkbox" data-inspect-for="${esc(a.id)}"${on ? " checked" : ""}> Opens ${esc(INSPECT_APP_NAME)}</label>`;
  };
  box.innerHTML = plSlipSheet() + `<div class="sx cab-admin lx" style="${lit("slate")}">
    <section class="sx-hero">
      <div class="sx-hero-text">
        <span class="sx-kicker">${esc(lxName())} · Join slips</span>
        <h2>${waiting.length ? `${sxNum(waiting.length)} with no account yet` : "Everyone here has an account"}</h2>
        <p>Someone here with no account yet gets a join slip: a code they type into the app to make their own account and
          password. Someone who's forgotten their password gets a password slip. Each lasts 14 days and works once; giving a
          new one cancels the last.</p>
      </div>
    </section>
    ${plProblem ? `<p class="error">${esc(plProblem)}</p>` : ""}
    <div class="sx-tiles" style="--n:3">
      ${cabTile("On the list", sxNum(here.length), `at ${esc(lxName())}`, { colour: "slate", data: 'data-sx-go=""' })}
      ${cabTile("Have an account", sxNum(withAccount), "Can sign in", { colour: "green", data: 'data-sx-go=""' })}
      ${cabTile("No account yet", sxNum(waiting.length), waiting.length ? "Give them a join slip" : "Nobody waiting", { colour: waiting.length ? "amber" : "green", hot: waiting.length > 0, data: 'data-sx-go=""' })}
    </div>
    <section class="sx-panel" style="${lit("slate")}">
      <header><h3>People at ${esc(lxName())}</h3><span>${sxNum(here.length)}</span></header>
      ${waiting.length ? `<div class="pl-actions"><button type="button" data-pl-slips-here ${plSlipBusy ? "disabled" : ""}>
        Join slips for all ${waiting.length} at ${esc(lxName())} with no account</button></div>` : ""}
      ${!here.length ? `<p class="sx-empty">Nobody at ${esc(lxName())} on the People list yet.</p>` : `
      <div class="lc-scroll"><table class="lc-table pl-table">
        <thead><tr><th>Name</th><th>Sign in as</th><th>Job</th><th>Account</th><th></th></tr></thead>
        <tbody>${here.map(e => { const a = plAccount(e); return `<tr>
          <td><b>${esc(plName(e))}</b></td><td>${esc(e.email || (e.employee_number ? `${e.employee_number}@${company.id}` : ""))}</td>
          <td>${esc(e.job || "")}</td>
          <td>${!a ? `<span class="note">None yet</span>` : a.deactivated_at ? `<span class="badge b-none">Switched off</span>` : `<span class="badge b-current">Has one</span>`}${tickCell(a)}</td>
          <td class="pl-do">${plSlipButton(e)}</td></tr>`; }).join("")}</tbody>
      </table></div>`}
    </section>
  </div>`;
}

// ------------------------------------------------------------ Microsoft 365
// The directory's people, checked here before they change the list (0145).
// The microsoft-directory function reads Microsoft with the company's choices
// (or the ones being tried); the preview is the upload's; the list changes
// through sync_employees(), as an upload's does. Each night the function does
// the same on its own, and stops for an owner when the upload's guard would.
let plMsLast = null, plMsGroups = null, plMsBusy = "", plMsRead = null, plMsMessage = "", plMsProblem = "";
const PL_MS_PLACES = [["officeLocation", "Office"], ["department", "Department"], ["city", "City"],
  ["companyName", "Company name"], ["none", "Not from Microsoft"]];

// The choices as they stand on the page, saved or not.
function plMsChoices() {
  const who = $("plMsWho"), group = $("plMsGroup");
  const groupId = who && who.value === "group" ? (group && group.value) || company.microsoft_group_id || "" : "";
  return {
    group_id: groupId || null,
    group_name: groupId ? ((plMsGroups || []).find(g => g.id === groupId) || {}).name || company.microsoft_group_name || null : null,
    location_field: ($("plMsPlace") && $("plMsPlace").value) || company.microsoft_location_field || "officeLocation",
    number_field: ($("plMsNumber") && $("plMsNumber").value) || company.microsoft_number_field || "employeeId",
  };
}

// The directory's people, keyed as the uploads key them: number, then email.
const plMsPeople = () => (plMsRead ? plMsRead.people : []).map(p =>
  ({ ...p, person_key: (p.employee_number && tsEmployeeNumber(p.employee_number)) || p.email }));

function plMicrosoftCard() {
  const groupMode = plMsGroupMode();
  const groupId = groupMode ? plMsChoices().group_id : null;
  const groups = plMsGroups || (company.microsoft_group_id ? [{ id: company.microsoft_group_id, name: company.microsoft_group_name || "The chosen group" }] : []);
  const last = plMsLast;
  return `<section class="sx-panel" id="plMicrosoft" style="${lit("slate")}">
      <header><h3>From Microsoft 365</h3></header>
      <p class="note">${esc(company.name)}'s Microsoft 365 is connected, so the list can keep itself up to date from its directory: each
        person's name, work email, job and location. Someone added in Microsoft is on the list by the next morning and can sign in with
        Microsoft; someone switched off or removed there is marked as left. Check what it would do first.</p>
      ${last ? `<p class="${last.ok ? "pl-ms-last" : "error"}"><b>${last.ok ? "Last night" : "The overnight sync stopped"}</b>
        (${esc(new Date(last.at).toLocaleString())}): ${esc(last.note)}${last.ok ? "." : ". Check it below and update the list by hand if it's right."}</p>` : ""}
      <label class="pl-setting"><input type="checkbox" id="plMsSync" ${company.microsoft_sync ? "checked" : ""}>
        <span><b>Keep the list up to date from Microsoft 365, every night.</b> It takes off at most a tenth of the list in one night
          (and never everyone at a location) without an owner checking it here.</span></label>
      <div class="pl-fields">
        <div><label for="plMsWho">Who's on the list</label><select id="plMsWho">
          <option value="everyone" ${groupMode ? "" : "selected"}>Everyone in the directory</option>
          <option value="group" ${groupMode ? "selected" : ""}>Members of one Microsoft group</option></select></div>
        ${groupMode ? `<div><label for="plMsGroup">Group</label><select id="plMsGroup">
          ${!groups.length ? `<option value="">${plMsBusy === "groups" ? "Loading the groups…" : "No groups"}</option>` : ""}
          ${groups.map(g => `<option value="${esc(g.id)}" ${g.id === groupId ? "selected" : ""}>${esc(g.name)}</option>`).join("")}</select></div>` : ""}
        <div><label for="plMsPlace">Location comes from</label><select id="plMsPlace">
          ${PL_MS_PLACES.map(([v, label]) => `<option value="${v}" ${v === plMsChoices().location_field ? "selected" : ""}>${label}</option>`).join("")}</select></div>
        <div><label for="plMsNumber">Employee number comes from</label><select id="plMsNumber">
          <option value="employeeId" ${plMsChoices().number_field === "employeeId" ? "selected" : ""}>Employee ID</option>
          <option value="none" ${plMsChoices().number_field === "none" ? "selected" : ""}>Not from Microsoft</option></select></div>
      </div>
      <div class="pl-actions">
        <button type="button" class="btn-secondary" id="plMsSave" ${plMsBusy ? "disabled" : ""}>Save these choices</button>
        <button type="button" id="plMsCheck" ${plMsBusy ? "disabled" : ""}>${plMsBusy === "read" ? "Reading Microsoft 365…" : "Check what it would do"}</button>
      </div>
      ${plMsMessage ? `<p class="pf-ok">${esc(plMsMessage)}</p>` : ""}
      ${plMsProblem ? `<p class="error">${esc(plMsProblem)}</p>` : ""}
      ${plMsRead ? plMsPreviewHtml() : ""}
    </section>`;
}

const plCount = (n, one, many = one + "s") => `${n} ${n === 1 ? one : many}`;
const plMsGroupMode = () => $("plMsWho") ? $("plMsWho").value === "group" : !!company.microsoft_group_id;

function plMsPreviewHtml() {
  const list = plMsPeople();
  const pv = plPreview(list, "microsoft");
  const out = plMsRead.left_out || {};
  const unplaced = {};
  list.forEach(p => { if (p.store && !storeLocation(p.store)) unplaced[p.store] = (unplaced[p.store] || 0) + 1; });
  const noPlace = list.filter(p => !p.store).length;
  const takeOff = pv.leaving.slice(0, 12).map(plName);
  return `<div class="pl-ms-preview">
      <p><b>Microsoft has ${list.length} ${list.length === 1 ? "person" : "people"} for the list.</b>
        ${pv.joined} would join, ${pv.back} come back, ${pv.moved} move location and ${pv.leaving.length} leave.</p>
      ${pv.leaving.length ? `<p class="note">Leaving: ${esc(takeOff.join(", "))}${pv.leaving.length > takeOff.length ? `, and ${pv.leaving.length - takeOff.length} more` : ""}.</p>` : ""}
      ${Object.keys(unplaced).length ? `<p class="error">These locations from Microsoft don't match one here:
        ${esc(Object.entries(unplaced).map(([k, n]) => `${k} (${n})`).join(", "))}. Add them to a location's other names on
        Groups &amp; Locations, or choose another field.</p>` : ""}
      ${noPlace && plMsChoices().location_field !== "none" ? `<p class="note">${plCount(noPlace, "person has", "people have")} nothing in that field in Microsoft, so no location.</p>` : ""}
      ${out.no_email && out.no_email.length ? `<p class="note">Left out, with no email in Microsoft (fill in their Email there to add them):
        ${esc(out.no_email.slice(0, 12).join(", "))}${out.no_email.length > 12 ? `, and ${out.no_email.length - 12} more` : ""}.</p>` : ""}
      ${out.guests || out.switched_off ? `<p class="note">Also left out: ${plCount(out.guests || 0, "guest")} and ${
        plCount(out.switched_off || 0, "account")} switched off in Microsoft.</p>` : ""}
      ${pv.tooMany ? `<label class="pl-setting"><input type="checkbox" id="plMsEveryone">
        <span><b>That's right: take them off.</b> This takes off ${pv.leaving.length} of ${pv.hereNow}${pv.emptied.length ? `, and everyone at ${esc(pv.emptied.join(", "))}` : ""}.</span></label>` : ""}
      <div class="pl-actions"><button type="button" id="plMsApply" ${plMsBusy || !list.length ? "disabled" : ""}>Update the list now</button></div>
    </div>`;
}

async function plMsCall(body) {
  const { data, error } = await db.functions.invoke("microsoft-directory", { body });
  if (error) {
    let said = error.message;
    try { said = (await error.context.json()).error || said; } catch { /* no body */ }
    throw new Error(/Failed to send|not found|404/i.test(said) ? "The microsoft-directory function isn't deployed yet." : said);
  }
  return data;
}

async function plMsLoadGroups() {
  if (plMsGroups || plMsBusy) return;
  plMsBusy = "groups"; renderPeopleList();
  try { plMsGroups = (await plMsCall({ action: "groups" })).groups || []; }
  catch (err) { plMsProblem = err.message; plMsGroups = null; }
  plMsBusy = ""; renderPeopleList();
}

async function plReload(message) {
  await loadEmployees();
  plMessage = message || ""; plAdding = false;
  renderPeopleList();
}

document.addEventListener("click", async (e) => {
  const filter = e.target.closest("[data-pl-filter]");
  if (filter) { plFilter = filter.dataset.plFilter; return renderPeopleList(); }
  if (e.target.closest("#plAdd")) {
    const first = $("plFirst").value.trim(), last = $("plLast").value.trim();
    const number = $("plNumber").value.trim(), email = $("plEmail").value.trim().toLowerCase();
    plProblem = ""; plMessage = "";
    if (!first && !last) { plProblem = "A person on the list needs a name."; return renderPeopleList(); }
    if (!number && !email) { plProblem = "A person on the list needs an employee number or a work email."; return renderPeopleList(); }
    const place = $("plLocation").value;
    plAdding = true; renderPeopleList();
    const { error } = await db.from("employees").insert({ first_name: first, last_name: last, employee_number: number || null,
      email: email || null, job: $("plJob").value.trim(), location_id: place || null,
      store: place ? locations[place] || "" : "", source: "by hand" });
    if (error) { plAdding = false; plProblem = /duplicate|unique/i.test(error.message)
      ? "Someone with that employee number or email is already on the list." : error.message; return renderPeopleList(); }
    return plReload(`${first} ${last}`.trim() + " is on the list.");
  }
  const remove = e.target.closest("[data-pl-remove]");
  if (remove) {
    const row = plRows.find(r => r.id === remove.dataset.plRemove);
    if (!row || !confirm(`Take ${plName(row)} off the list? Their account, if they have one, isn't touched.`)) return;
    const { error } = await db.from("employees").delete().eq("id", row.id);
    if (error) { plProblem = error.message; return renderPeopleList(); }
    return plReload(`${plName(row)} is off the list.`);
  }
  const slip = e.target.closest("[data-pl-slip]");
  if (slip) {
    const row = plRows.find(r => r.id === slip.dataset.plSlip);
    if (row) plMakeSlips([row]);
    return;
  }
  if (e.target.closest("[data-pl-slips-all]")) {
    const list = plRows.filter(r => r.here && !plAccount(r) && (r.employee_number || r.email));
    if (list.length && confirm(`Give ${list.length} join slips? Any slip they already have stops working.`)) plMakeSlips(list);
    return;
  }
  if (e.target.closest("[data-pl-slips-here]")) {
    const list = plRows.filter(r => r.here && r.location_id === lxCurrent() && !plAccount(r) && (r.employee_number || r.email));
    if (list.length && confirm(`Give ${list.length} join slips for ${lxName()}? Any slip they already have stops working.`)) plMakeSlips(list);
    return;
  }
  if (e.target.closest("[data-pl-print]")) {
    document.body.classList.add("printing-slips");
    window.print();
    return;
  }
  if (e.target.closest("[data-pl-clear]")) {
    if (!confirm("Done with these slips? Their codes won't be shown again.")) return;
    plSlips = [];
    return plRedrawSlips();
  }
  if (e.target.closest("#plMsSave")) {
    const c = plMsChoices();
    plMsMessage = ""; plMsProblem = "";
    if ($("plMsWho").value === "group" && !c.group_id) { plMsProblem = "Choose the group."; return renderPeopleList(); }
    const { error } = await db.from("companies").update({ microsoft_group_id: c.group_id, microsoft_group_name: c.group_name,
      microsoft_location_field: c.location_field, microsoft_number_field: c.number_field }).eq("id", company.id);
    if (error) { plMsProblem = /column/.test(error.message) ? "Run migration 0145 first." : error.message; return renderPeopleList(); }
    setCompany(await db.rpc("my_company"));
    plMsMessage = "Saved. The next sync reads Microsoft 365 this way.";
    return renderPeopleList();
  }
  if (e.target.closest("#plMsCheck")) {
    const c = plMsChoices();
    plMsMessage = ""; plMsProblem = ""; plMsRead = null;
    if ($("plMsWho").value === "group" && !c.group_id) { plMsProblem = "Choose the group."; return renderPeopleList(); }
    plMsBusy = "read"; renderPeopleList();
    try { plMsRead = await plMsCall({ action: "read", group_id: c.group_id, location_field: c.location_field, number_field: c.number_field }); }
    catch (err) { plMsProblem = err.message; }
    plMsBusy = ""; renderPeopleList();
    return;
  }
  if (e.target.closest("#plMsApply")) {
    const list = plMsPeople();
    const everyone = !!($("plMsEveryone") && $("plMsEveryone").checked);
    if (plPreview(list, "microsoft").tooMany && !everyone) { plMsProblem = "Tick that it's right to take them off, or check Microsoft first."; return renderPeopleList(); }
    plMsBusy = "apply"; plMsProblem = ""; renderPeopleList();
    const { data, error } = await db.rpc("sync_employees", { people: list, feed: "microsoft", file: "Microsoft 365", everyone_confirmed: everyone });
    plMsBusy = "";
    if (error) { plMsProblem = error.message; return renderPeopleList(); }
    plMsRead = null;
    return plReload(`From Microsoft 365: ${data.joined} joined, ${data.changed} changed, ${data.left} left${data.back ? `, ${data.back} back` : ""}${
      data.accounts ? `; ${data.accounts} accounts switched off or on` : ""}.`);
  }
  if (e.target.closest("[data-pl-undo]")) {
    if (!confirm("Put the list back as it was before the last change? Anyone it switched off is switched back on.")) return;
    const { data, error } = await db.rpc("undo_employee_run");
    if (error) { plProblem = error.message; return renderPeopleList(); }
    return plReload(`Undone: ${data.restored} put back, ${data.removed} taken off${data.accounts ? `, ${data.accounts} accounts on again` : ""}.`);
  }
});

document.addEventListener("change", async (e) => {
  if (["plMsWho", "plMsGroup", "plMsPlace", "plMsNumber"].includes(e.target.id)) {
    // Choices changed: what was read no longer says what they'd do. Drawing
    // again keeps what's picked, since the card reads it from the page.
    plMsRead = null; plMsMessage = "";
    if (e.target.id === "plMsWho" && e.target.value === "group") plMsLoadGroups();
    return renderPeopleList();
  }
  if (e.target.id === "plMsSync") {
    const on = e.target.checked;
    if (on && !confirm("Every night, the People list is brought up to date from Microsoft 365, with the choices saved here. Turn it on?")) {
      e.target.checked = false; return;
    }
    const { error } = await db.from("companies").update({ microsoft_sync: on }).eq("id", company.id);
    if (error) { plMsProblem = /column/.test(error.message) ? "Run migration 0145 first." : error.message; e.target.checked = !on; return renderPeopleList(); }
    setCompany(await db.rpc("my_company"));
    plMsMessage = on ? "The list will be brought up to date from Microsoft 365 every night, at about 2 AM Mountain." : "The nightly sync is off.";
    return renderPeopleList();
  }
  if (e.target.id !== "plDeactivate") return;
  const on = e.target.checked;
  if (on && !confirm("From the next upload, anyone who leaves the list has their account switched off. Turn this on?")) {
    e.target.checked = false; return;
  }
  const { error } = await db.from("companies").update({ deactivate_leavers: on }).eq("id", company.id);
  if (error) { plProblem = error.message; e.target.checked = !on; return renderPeopleList(); }
  company = { ...company, deactivate_leavers: on };
  plMessage = on ? "Leavers' accounts will be switched off from the next upload." : "Leavers' accounts are left alone.";
  renderPeopleList();
});

document.addEventListener("input", (e) => {
  if (e.target.id !== "plSearch") return;
  plQuery = e.target.value;
  const at = e.target.selectionStart;
  renderPeopleList();
  const box = $("plSearch");
  if (box) { box.focus(); box.setSelectionRange(at, at); }
});

window.addEventListener("afterprint", () => document.body.classList.remove("printing-slips"));
