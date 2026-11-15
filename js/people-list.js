// People list (migration 0140, multi-org step 5)
//
// Who works for the company, kept up to date by its feeds: the All employees
// upload today (training-status.js sends it here after publishing), and anyone
// an owner adds by hand. Leavers are kept, marked as left. The admin page's
// People list tab is drawn here; join slips (next) are given from it.

let plRows = [], plRuns = [], plError = null, plMissing = false;
let plQuery = "", plFilter = "here", plAdding = false, plMessage = "", plProblem = "";
// Slips given while this page is open (0141). Their codes are shown only now:
// the database keeps a fingerprint, never the code.
let plSlips = [], plSlipBusy = false;

async function loadEmployees() {
  // Owners see everyone; a location's admins their locations' people (the
  // database decides), for the Location Dashboard's Join slips tab.
  if (!me || !(isOwner() || isLocationAdmin())) return;
  const [rows, runs] = await Promise.all([
    allRows(() => db.from("employees").select("*").order("last_name").order("first_name").order("id")),
    db.from("employee_runs").select("*").order("at", { ascending: false }).limit(5)]);
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

// What an upload would do to the list, for its preview: the same counting and
// the same guard as sync_employees().
function plPreview(list) {
  const mine = plRows.filter(e => e.source === "upload");
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
  const chip = (id, label, n) => `<button type="button" class="pl-chip ${plFilter === id ? "on" : ""}" data-pl-filter="${id}">${esc(label)} <b>${n}</b></button>`;

  box.innerHTML = plSlipSheet() + `<div class="card">
      <h2>People list</h2>
      <p class="note">Everyone who works here, kept up to date by the All employees upload (Training → Uploads), and anyone added by
        hand below. Someone missing from an upload is marked as left, never deleted; an upload never takes off someone added by hand.
        Join slips are given from here.</p>
      ${plError && !plMissing ? `<p class="error">${esc(plError)}</p>` : ""}
      ${plMessage ? `<p class="pf-ok">${esc(plMessage)}</p>` : ""}
      ${plProblem ? `<p class="error">${esc(plProblem)}</p>` : ""}
      ${last ? `<div class="pl-run">
        <span><b>${last.undone_at ? "Undone:" : "Last change:"}</b> ${esc(new Date(last.at).toLocaleString())}${last.file ? ` from ${esc(last.file)}` : ""}
          · ${last.joined} joined, ${last.changed} changed, ${last.left_list} left, ${last.back} back${last.by_name ? ` · ${esc(last.by_name)}` : ""}</span>
        ${!last.undone_at && last.by_name !== "migration 0140" ? `<button type="button" class="btn-secondary" data-pl-undo>Undo it</button>` : ""}
      </div>` : ""}
      <label class="pl-setting"><input type="checkbox" id="plDeactivate" ${company.deactivate_leavers ? "checked" : ""}>
        <span><b>Switch off the account of someone who leaves the list</b>, and back on if they return.
          Owners' accounts are never switched off this way.</span></label>
      ${plFilter === "noaccount" && noAccount.length ? `<div class="pl-actions"><button type="button" class="btn-secondary"
        data-pl-slips-all ${plSlipBusy ? "disabled" : ""}>Join slips for all ${noAccount.length} with no account</button></div>` : ""}
      <div class="pl-chips">${chip("here", "Here", here.length)}${chip("noaccount", "No account yet", noAccount.length)}${chip("byhand", "Added by hand", byHand.length)}${chip("left", "Left", gone.length)}</div>
      <input type="search" id="plSearch" placeholder="Search by name, number, email, job or location" value="${esc(plQuery)}">
      ${!shown.length ? `<p class="note">Nobody${q ? " matches" : " here"}.</p>` : `
      <div class="table-wrap"><table class="pl-table">
        <thead><tr><th>Name</th><th>Number</th><th>Email</th><th>Job</th><th>Location</th><th>From</th><th>Account</th><th></th></tr></thead>
        <tbody>${shown.map(e => { const a = plAccount(e); return `<tr class="${e.here ? "" : "pl-gone"}">
          <td>${esc(plName(e))}${e.here ? "" : `<small>Left ${esc(new Date(e.left_at).toLocaleDateString())}</small>`}</td>
          <td>${esc(e.employee_number || "")}</td><td>${esc(e.email || "")}</td><td>${esc(e.job || "")}</td><td>${esc(plPlace(e))}</td>
          <td>${e.source === "by hand" ? "By hand" : e.source === "upload" ? "Upload" : esc(e.source)}</td>
          <td>${!a ? `<span class="note">None yet</span>` : a.deactivated_at ? `<span class="badge b-none">Switched off</span>` : `<span class="badge b-current">Has one</span>`}</td>
          <td class="pl-do">${plSlipButton(e)}${e.source === "by hand" ? `<button type="button" class="pdf" data-pl-remove="${esc(e.id)}">Remove</button>` : ""}</td>
        </tr>`; }).join("")}</tbody>
      </table></div>`}
    </div>
    <div class="card">
      <h2>Add someone by hand</h2>
      <p class="note">For someone the upload doesn't have yet: a new hire, a contractor. They need an employee number or a work
        email. If a later upload has them, it takes them over.</p>
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
    </div>`;
}

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
  box.innerHTML = plSlipSheet() + `<div class="card">
      <h2>Join slips</h2>
      <p class="note">Someone here with no account yet gets a join slip: a code they type into the app to make their own account
        and password. Someone who's forgotten their password gets a password slip. Each lasts 14 days and works once; giving a new
        one cancels the last.</p>
      ${plProblem ? `<p class="error">${esc(plProblem)}</p>` : ""}
      ${waiting.length ? `<div class="pl-actions"><button type="button" data-pl-slips-here ${plSlipBusy ? "disabled" : ""}>
        Join slips for all ${waiting.length} at ${esc(lxName())} with no account</button></div>` : ""}
      ${!here.length ? `<p class="note">Nobody at ${esc(lxName())} on the People list yet.</p>` : `
      <div class="table-wrap"><table class="pl-table">
        <thead><tr><th>Name</th><th>Sign in as</th><th>Job</th><th>Account</th><th></th></tr></thead>
        <tbody>${here.map(e => { const a = plAccount(e); return `<tr>
          <td>${esc(plName(e))}</td><td>${esc(e.email || (e.employee_number ? `${e.employee_number}@${company.id}` : ""))}</td>
          <td>${esc(e.job || "")}</td>
          <td>${!a ? `<span class="note">None yet</span>` : a.deactivated_at ? `<span class="badge b-none">Switched off</span>` : `<span class="badge b-current">Has one</span>`}</td>
          <td class="pl-do">${plSlipButton(e)}</td></tr>`; }).join("")}</tbody>
      </table></div>`}
    </div>`;
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
  if (e.target.closest("[data-pl-undo]")) {
    if (!confirm("Put the list back as it was before the last change? Anyone it switched off is switched back on.")) return;
    const { data, error } = await db.rpc("undo_employee_run");
    if (error) { plProblem = error.message; return renderPeopleList(); }
    return plReload(`Undone: ${data.restored} put back, ${data.removed} taken off${data.accounts ? `, ${data.accounts} accounts on again` : ""}.`);
  }
});

document.addEventListener("change", async (e) => {
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
