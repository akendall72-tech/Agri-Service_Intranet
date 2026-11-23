// Platform (migration 0138, multi-org step 4)
//
// The page above every company, for platform owners: the companies, with
// their people and when they were last in; a new company; the accounts
// waiting to be placed in one; and the log of what was done here. A platform
// owner belongs to no company, so this is all they see; the database decides
// who that is (platform_owners), and every question here is a platform_*()
// function that refuses anyone else.

let pfCompanies = [], pfWaiting = [], pfLog = [], pfPeople = {}, pfError = null;
let pfOpen = null, pfBusy = false, pfMessage = "", pfProblem = "";

async function loadPlatform() {
  if (!platformOwner) return;
  const [companies, waiting, log] = await Promise.all([
    db.rpc("platform_companies"), db.rpc("platform_people", { target: null }), db.rpc("platform_recent_log", { how_many: 40 })]);
  pfError = (companies.error || waiting.error || log.error || {}).message || null;
  pfCompanies = companies.data || [];
  pfWaiting = waiting.data || [];
  pfLog = log.data || [];
  if (pfOpen) await pfLoadPeople(pfOpen);
}

async function pfLoadPeople(id) {
  const { data, error } = await db.rpc("platform_people", { target: id });
  pfPeople[id] = error ? [] : data || [];
}

const pfWhen = (at) => at ? new Date(at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "never";
const pfSize = (bytes) => bytes >= 1073741824 ? `${(bytes / 1073741824).toFixed(1)} GB`
  : bytes >= 1048576 ? `${Math.round(bytes / 1048576)} MB` : bytes >= 1024 ? `${Math.round(bytes / 1024)} KB` : `${bytes || 0} bytes`;
const pfSlug = (name) => String(name || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
  .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);

function platformView() {
  setTimeout(() => { if (!pfCompanies.length && !pfError) loadPlatform().then(renderPlatformBody); });
  return hero("Platform", "Every company on Agri-Barn, the accounts waiting for one, and what's been done here.")
    + `<div id="platformBody">${platformBody()}</div>`;
}

function renderPlatformBody() {
  const box = $("platformBody");
  if (box) box.innerHTML = platformBody();
}

function platformBody() {
  if (pfError) {
    return `<div class="card"><p class="error">${esc(/platform_|does not exist|schema cache/i.test(pfError)
      ? "Run migration 0138_platform.sql in the SQL editor, then reload this page." : pfError)}</p></div>`;
  }
  const people = pfCompanies.reduce((n, c) => n + Number(c.active || 0), 0);
  return `
    <div class="pf-stats">
      <div><b>${pfCompanies.length}</b><span>${pfCompanies.length === 1 ? "company" : "companies"}</span></div>
      <div><b>${people}</b><span>active people</span></div>
      <div class="${pfWaiting.length ? "pf-hot" : ""}"><b>${pfWaiting.length}</b><span>${pfWaiting.length === 1 ? "account waiting" : "accounts waiting"}</span></div>
    </div>
    ${pfMessage ? `<p class="pf-ok">${esc(pfMessage)}</p>` : ""}
    ${pfProblem ? `<p class="error">${esc(pfProblem)}</p>` : ""}
    <div class="card">
      <h2>Companies</h2>
      <div class="pf-companies">${pfCompanies.map(pfCompanyCard).join("") || `<p class="note">None yet.</p>`}</div>
    </div>
    ${pfWaitingCard()}
    ${pfNewCompanyCard()}
    ${pfLogCard()}`;
}

function pfCompanyCard(c) {
  const open = pfOpen === c.id;
  return `<div class="pf-company ${open ? "open" : ""}${c.deactivated_at ? " off" : ""}">
      <button type="button" class="pf-company-head" data-pf-open="${esc(c.id)}" aria-expanded="${open}">
        <span class="pf-company-name"><b>${esc(c.name)}${c.deactivated_at ? ` <span class="badge b-expired">Deactivated</span>` : ""}</b><small>${esc(c.id)}${(c.email_domains || []).length ? ` · ${esc(c.email_domains.join(", "))}` : ""}</small></span>
        <span class="pf-company-facts">
          <span><b>${Number(c.active || 0)}</b> active</span>
          <span><b>${Number(c.owners || 0)}</b> ${Number(c.owners) === 1 ? "owner" : "owners"}</span>
          <span>last in ${esc(pfWhen(c.last_sign_in))}</span>
          <span>${esc(pfSize(Number(c.file_bytes || 0)))} of files</span>
        </span>
      </button>
      ${open ? pfCompanyDetail(c) : ""}
    </div>`;
}

function pfCompanyDetail(c) {
  const people = pfPeople[c.id];
  return `<div class="pf-detail">
      <div class="pf-fields">
        <div><label for="pfName-${esc(c.id)}">Name</label>
          <input type="text" id="pfName-${esc(c.id)}" maxlength="40" value="${esc(c.name)}"></div>
        <div><label for="pfLegal-${esc(c.id)}">Legal name</label>
          <input type="text" id="pfLegal-${esc(c.id)}" maxlength="80" value="${esc(c.legal_name)}"></div>
        <div class="pf-wide"><label for="pfDomains-${esc(c.id)}">Email domains</label>
          <input type="text" id="pfDomains-${esc(c.id)}" value="${esc((c.email_domains || []).join(", "))}" placeholder="dealer.com, dealer.onmicrosoft.com">
          <p class="note">A new account with one of these lands in this company by itself. Separate them with commas.</p></div>
      </div>
      <div class="pf-actions"><button type="button" data-pf-save="${esc(c.id)}" ${pfBusy ? "disabled" : ""}>Save changes</button>
        <span class="note">Made ${esc(pfWhen(c.created_at))}</span></div>
      <div class="pf-visit">
        <div><label for="pfWhy-${esc(c.id)}">Open it as its owner, to help</label>
          <input type="text" id="pfWhy-${esc(c.id)}" maxlength="300" placeholder="Why, for its owners: helping set up its locations">
          <p class="note">For two hours at most. You see and can change what its owners can, and everything you change is logged
            for them, with why you came.</p></div>
        <button type="button" class="btn-secondary" data-pf-visit="${esc(c.id)}" ${pfBusy ? "disabled" : ""}>Open as its owner</button>
      </div>
      ${pfActiveSection(c)}
      ${pfInspectSection(c)}
      <h3>People</h3>
      ${!people ? `<p class="note">Loading…</p>` : !people.length ? `<p class="note">Nobody yet. Place its first owner from Accounts waiting.</p>` : `
      <div class="table-wrap"><table class="pf-table">
        <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Location</th><th>Last in</th></tr></thead>
        <tbody>${people.map(p => `<tr class="${p.deactivated_at ? "pf-gone" : ""}">
          <td>${esc(p.full_name || "No name yet")}${p.deactivated_at ? ` <span class="badge b-none">Deactivated</span>` : ""}</td>
          <td>${esc(p.email || "")}</td><td>${esc(p.role)}</td><td>${esc(p.location || "—")}</td>
          <td>${esc(pfWhen(p.last_sign_in))}</td></tr>`).join("")}</tbody>
      </table></div>`}
    </div>`;
}

// Deactivating a company (0158): its people are signed out and see nothing
// until it's reactivated. Nothing is deleted. The reason goes in the log its
// owners read.
function pfActiveSection(c) {
  if (!("deactivated_at" in c)) {
    return `<p class="note pf-switch">Run migration 0158_company_deactivation.sql in the SQL editor to deactivate a company.</p>`;
  }
  if (c.deactivated_at) {
    return `<div class="pf-switch off">
        <div><b>Deactivated ${esc(pfWhen(c.deactivated_at))}</b>${c.deactivated_by_name ? ` by ${esc(c.deactivated_by_name)}` : ""}
          ${c.deactivated_reason ? `<q>${esc(c.deactivated_reason)}</q>` : ""}
          <p class="note">Its people are signed out and see nothing; no new accounts, join slips or notifications. Everything it had
            is still here. You can still open it as its owner.</p></div>
        <button type="button" data-pf-on="${esc(c.id)}" ${pfBusy ? "disabled" : ""}>Reactivate</button>
      </div>`;
  }
  return `<div class="pf-switch">
      <div><label for="pfOffWhy-${esc(c.id)}">Deactivate this company</label>
        <input type="text" id="pfOffWhy-${esc(c.id)}" maxlength="300" placeholder="Why, for its owners: the agreement ended">
        <p class="note">Everyone in it is signed out and sees nothing until it's reactivated: no new accounts, join slips or
          notifications. Nothing is deleted. Its owners read the reason in their log once it's back.</p></div>
      <button type="button" class="pf-danger" data-pf-off="${esc(c.id)}" ${pfBusy ? "disabled" : ""}>Deactivate</button>
    </div>`;
}

// The company's organization in Field Ready (0162). Field Ready names the
// company back (its setup/agri_barn_link.sql prints the organization's id);
// both have to, before anyone opens it from Agri-Barn. Empty unlinks.
function pfInspectSection(c) {
  if (!("inspect_org" in c)) {
    return `<p class="note pf-switch">Run migration 0162_field_ready_link.sql to link a company to ${esc(INSPECT_APP_NAME)}.</p>`;
  }
  return `<div class="pf-switch">
      <div><label for="pfInspect-${esc(c.id)}">${esc(INSPECT_APP_NAME)} organization</label>
        <input type="text" id="pfInspect-${esc(c.id)}" maxlength="36" spellcheck="false" autocomplete="off"
          value="${esc(c.inspect_org || "")}" placeholder="Its id in ${esc(INSPECT_APP_NAME)}, or empty: not linked">
        <p class="note">${c.inspect_org ? "Linked." : "Not linked."} Its owners tick who may open ${esc(INSPECT_APP_NAME)} from
          Agri-Barn, on People. ${esc(INSPECT_APP_NAME)} has to name this company back (${esc(c.id)}) before anyone gets in.</p></div>
      <button type="button" class="btn-secondary" data-pf-inspect="${esc(c.id)}" ${pfBusy ? "disabled" : ""}>Save link</button>
    </div>`;
}

function pfWaitingCard() {
  return `<div class="card">
      <h2>Accounts waiting</h2>
      <p class="note">Accounts that belong to no company yet: made under Supabase → Authentication → Users with an email no company
        lists. Place each in its company, as an employee, an admin or its owner. Someone already in a company can't be moved.</p>
      ${!pfWaiting.length ? `<p class="note">None waiting.</p>` : `
      <div class="pf-waiting">${pfWaiting.map(p => `<div class="pf-wait">
          <span class="pf-wait-who"><b>${esc(p.full_name || p.email || "An account")}</b><small>${esc(p.email || "")} · made ${esc(pfWhen(p.created_at))}</small></span>
          <select id="pfTo-${esc(p.id)}" aria-label="Company for ${esc(p.email || "")}">
            ${pfCompanies.map(c => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join("")}</select>
          <select id="pfRole-${esc(p.id)}" aria-label="Role for ${esc(p.email || "")}">
            <option value="employee">Employee</option><option value="admin">Admin</option><option value="owner">Owner</option></select>
          <button type="button" data-pf-place="${esc(p.id)}" ${pfBusy ? "disabled" : ""}>Place</button>
        </div>`).join("")}</div>`}
    </div>`;
}

function pfNewCompanyCard() {
  return `<div class="card">
      <h2>New company</h2>
      <p class="note">It starts empty. Then: make its first owner's account in Supabase (Authentication → Users), with an email at one of
        its domains so it lands here, or place it from Accounts waiting as its owner. They set up its locations and people from the admin page.</p>
      <div class="pf-fields">
        <div><label for="pfNewName">Name</label><input type="text" id="pfNewName" maxlength="40" placeholder="Ridgeline Ag"></div>
        <div><label for="pfNewLegal">Legal name</label><input type="text" id="pfNewLegal" maxlength="80" placeholder="Ridgeline Ag Supply, Inc."></div>
        <div><label for="pfNewId">Short name</label><input type="text" id="pfNewId" maxlength="40" placeholder="ridgeline-ag">
          <p class="note">Lower case and dashes. It can't change later.</p></div>
        <div><label for="pfNewDomains">Email domains</label><input type="text" id="pfNewDomains" placeholder="ridgelineag.com"></div>
      </div>
      <div class="pf-actions"><button type="button" id="pfCreate" ${pfBusy ? "disabled" : ""}>Make the company</button></div>
    </div>`;
}

function pfLogCard() {
  const name = (id) => (pfCompanies.find(c => c.id === id) || {}).name || id || "";
  const what = pfWhat;
  return `<div class="card">
      <h2>What's been done here</h2>
      ${!pfLog.length ? `<p class="note">Nothing yet.</p>` : `
      <ul class="pf-log">${pfLog.map(l => `<li><span>${esc(what(l))}${l.company_id ? ` · <b>${esc(name(l.company_id))}</b>` : ""}</span>
        <small>${esc(new Date(l.at).toLocaleString())}${l.by_name ? ` · ${esc(l.by_name)}` : ""}</small></li>`).join("")}</ul>`}
      <p class="note">A company's owners can read what was done to their company.</p>
    </div>`;
}

// One line of the log, in words: shared with Admin -> Company (company.js).
function pfWhat(l) {
  const d = l.detail || {};
  const table = String(d.table || "").replace(/_/g, " ");
  return l.action === "account placed" ? `${d.name || d.email || "An account"} placed as ${d.role}`
    : l.action === "company created" ? "Company made"
    : l.action === "company changed" ? "Company changed"
    : l.action === "company deactivated" ? `Company deactivated${d.reason ? `: ${d.reason}` : ""}`
    : l.action === "company reactivated" ? "Company reactivated"
    : l.action === "visit started" ? `Visit started${d.reason ? `: ${d.reason}` : ""}`
    : l.action === "visit ended" ? "Visit ended"
    : ["added", "changed", "removed"].includes(l.action)
      ? `${l.action[0].toUpperCase()}${l.action.slice(1)} in ${table}${d.name ? `: ${d.name}` : ""}`
    : l.action;
}

// The bar across the page while a platform owner is visiting a company, and
// back to the Platform when the visit runs out.
function showVisit() {
  const bar = $("visitBar");
  if (!bar) return;
  bar.classList.toggle("hidden", !visit);
  document.body.classList.toggle("visiting", !!visit);
  clearTimeout(showVisit.timer);
  if (!visit) return;
  const until = new Date(visit.ends_at);
  bar.innerHTML = `<span>Visiting <b>${esc(visit.company_name)}</b> as its owner until
      ${esc(until.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }))}. Everything you change here is logged for its owners.</span>
    <button type="button" data-pf-leave>Back to the Platform</button>`;
  showVisit.timer = setTimeout(() => location.reload(), Math.max(0, until - Date.now()) + 1000);
}

const pfDomains = (text) => String(text || "").split(/[\s,;]+/).map(d => d.trim().replace(/^@/, "").toLowerCase()).filter(Boolean);

async function pfRun(work, done) {
  pfBusy = true; pfMessage = ""; pfProblem = ""; renderPlatformBody();
  const { error } = await work();
  pfBusy = false;
  if (error) pfProblem = error.message;
  else pfMessage = done;
  await loadPlatform();
  renderPlatformBody();
}

document.addEventListener("click", (e) => {
  const open = e.target.closest("[data-pf-open]");
  if (open) {
    const id = open.dataset.pfOpen;
    pfOpen = pfOpen === id ? null : id;
    renderPlatformBody();
    if (pfOpen && !pfPeople[pfOpen]) pfLoadPeople(pfOpen).then(renderPlatformBody);
    return;
  }
  const save = e.target.closest("[data-pf-save]");
  if (save) {
    const id = save.dataset.pfSave;
    pfRun(() => db.rpc("platform_save_company", { target: id, new_name: $("pfName-" + id).value.trim(),
      new_legal_name: $("pfLegal-" + id).value.trim(), domains: pfDomains($("pfDomains-" + id).value), creating: false }), "Saved.");
    return;
  }
  const place = e.target.closest("[data-pf-place]");
  if (place) {
    const id = place.dataset.pfPlace, to = $("pfTo-" + id).value, role = $("pfRole-" + id).value;
    const who = (pfWaiting.find(p => p.id === id) || {}).email || "this account";
    const where = (pfCompanies.find(c => c.id === to) || {}).name || to;
    if (!confirm(`Place ${who} in ${where} as ${role === "owner" ? "its owner" : `an ${role === "admin" ? "admin" : "employee"}`}? It can't be moved to another company after.`)) return;
    pfOpen = to; delete pfPeople[to];
    pfRun(() => db.rpc("platform_place_person", { person: id, target: to, new_role: role }), `${who} is in ${where} now.`);
    return;
  }
  const go = e.target.closest("[data-pf-visit]");
  if (go) {
    const id = go.dataset.pfVisit;
    pfBusy = true; pfProblem = ""; renderPlatformBody();
    db.rpc("platform_start_visit", { target: id, why: ($("pfWhy-" + id).value || "").trim() }).then(({ error }) => {
      if (error) { pfBusy = false; pfProblem = error.message; renderPlatformBody(); return; }
      location.reload();
    });
    return;
  }
  const link = e.target.closest("[data-pf-inspect]");
  if (link) {
    const id = link.dataset.pfInspect, c = pfCompanies.find(x => x.id === id) || { name: id };
    const org = ($("pfInspect-" + id).value || "").trim().toLowerCase();
    if (org && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(org)) {
      pfProblem = `That isn't a ${INSPECT_APP_NAME} organization id: it looks like 8-4-4-4-12 letters and numbers.`;
      return renderPlatformBody();
    }
    if (!org && c.inspect_org && !confirm(`Unlink ${c.name} from ${INSPECT_APP_NAME}? Nobody can open it from Agri-Barn `
      + `until it's linked again. The ticks stay.`)) return;
    pfRun(() => db.rpc("platform_link_inspect", { target: id, org: org || null }),
      org ? `${c.name} is linked to ${INSPECT_APP_NAME}.` : `${c.name} isn't linked to ${INSPECT_APP_NAME}.`);
    return;
  }
  const off = e.target.closest("[data-pf-off]");
  if (off) {
    const id = off.dataset.pfOff, c = pfCompanies.find(x => x.id === id) || { name: id };
    const why = ($("pfOffWhy-" + id).value || "").trim();
    if (!why) { pfProblem = `Say why ${c.name} is being deactivated. Its owners read it in their log.`; return renderPlatformBody(); }
    const typed = prompt(`Deactivate ${c.name}? Everyone in it is signed out and sees nothing until it's reactivated. `
      + `Nothing is deleted.\n\nType ${id} to deactivate it.`);
    if (typed === null) return;
    if (typed.trim().toLowerCase() !== id) { pfProblem = `That wasn't ${id}, so nothing changed.`; return renderPlatformBody(); }
    pfRun(() => db.rpc("platform_set_company_active", { target: id, active: false, why }), `${c.name} is deactivated.`);
    return;
  }
  const on = e.target.closest("[data-pf-on]");
  if (on) {
    const id = on.dataset.pfOn, c = pfCompanies.find(x => x.id === id) || { name: id };
    if (!confirm(`Reactivate ${c.name}? Its people can sign in again and find everything as it was.`)) return;
    pfRun(() => db.rpc("platform_set_company_active", { target: id, active: true, why: null }), `${c.name} is active again.`);
    return;
  }
  if (e.target.closest("[data-pf-leave]")) {
    db.rpc("platform_end_visit").then(() => location.reload());
    return;
  }
  if (e.target.closest("#pfCreate")) {
    const name = $("pfNewName").value.trim(), legal = $("pfNewLegal").value.trim();
    const id = $("pfNewId").value.trim() || pfSlug(name);
    if (!name || !legal) { pfProblem = "A new company needs a name and a legal name."; return renderPlatformBody(); }
    pfOpen = id;
    pfRun(() => db.rpc("platform_save_company", { target: id, new_name: name, new_legal_name: legal,
      domains: pfDomains($("pfNewDomains").value), creating: true }), `${name} is made.`);
  }
});

// The short name follows the name until it's typed into itself.
document.addEventListener("input", (e) => {
  if (e.target.id === "pfNewName" && $("pfNewId") && !$("pfNewId").dataset.typed) $("pfNewId").value = pfSlug(e.target.value);
  if (e.target.id === "pfNewId") e.target.dataset.typed = "1";
});
