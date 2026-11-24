// Company (migration 0133, multi-org step 2)
//
// The admin page's Company tab, for owners: the name everyone sees, the legal
// name at the foot of PDFs, and the app's two logos. Where the name is read
// from, and the built-in Agri-Service that stands in when there's nothing to
// read, is in core.js (company, setCompany).

// The most a logo can be, and a home photo (0161's bucket limit is 3 MB).
const LOGO_MAX_BYTES = 1024 * 1024;
const PHOTO_MAX_BYTES = 3 * 1024 * 1024;
let coBusy = false, coMessage = "", coError = "";
// What the platform did to this company (0138, 0139): companies made, accounts
// placed, visits, and every change made during one.
let coLog = null;

async function loadCompanyLog() {
  const { data, error } = await db.from("platform_log").select("at,by_name,action,detail")
    .eq("company_id", company.id).order("at", { ascending: false }).limit(60);
  coLog = error ? [] : data || [];
}

const COMPANY_LOGOS = [
  { field: "logo_path", file: "logo", title: "Logo, in colour",
    where: "On the app's sign-in screens, on white. A PNG; a clear background looks best." },
  { field: "logo_mono_path", file: "mark", title: "Logo, one colour",
    where: "On the app's red headers and certificates, drawn in white. A PNG with a clear background: everything that isn't clear turns white." },
  { field: "home_photo_path", file: "home", title: "Home photo", photo: true,
    where: "Behind the home page, in the app and on this page. A JPEG or PNG, taller than it's wide works best on phones, up to 3 MB." }
];

function renderCompanyAdmin() {
  const box = $("companyAdmin");
  if (!box) return;
  if (companyMissing) {
    box.innerHTML = `<div class="card"><p class="error">Run migration 0133_companies.sql in the SQL editor, then reload this page.</p></div>`;
    return;
  }
  const changed = company.updated_at
    ? `Last changed ${esc(new Date(company.updated_at).toLocaleDateString())}${company.updated_by_name ? ` by ${esc(company.updated_by_name)}` : ""}.`
    : "";
  box.innerHTML = `<div class="card">
      <h2>Name</h2>
      <p class="note">The name everyone sees across the app and this page: headings, the Social page, certificates, reports.
        The legal name goes at the foot of PDFs and in the forklift evaluation's wording.</p>
      <div class="co-fields">
        <div><label for="coName">Name</label>
          <input type="text" id="coName" maxlength="40" value="${esc(company.name)}"></div>
        <div><label for="coLegal">Legal name</label>
          <input type="text" id="coLegal" maxlength="80" value="${esc(company.legal_name)}"></div>
      </div>
      <div class="co-actions">
        <button type="button" id="coSave" ${coBusy ? "disabled" : ""}>Save</button>
        <span class="note">${changed}</span>
      </div>
      ${coMessage ? `<p class="co-ok">${esc(coMessage)}</p>` : ""}
      ${coError ? `<p class="error">${esc(coError)}</p>` : ""}
    </div>
    <div class="card">
      <h2>Logos and home photo</h2>
      <p class="note">Your company's own, for the app and this page. Until a logo is added, your name shows in its place;
        until a home photo is, Agri-Barn's evening sky.</p>
      <div class="co-logos">${COMPANY_LOGOS.map(coLogoSlot).join("")}</div>
    </div>
    ${coItCard()}
    ${coSwitchesCard()}
    ${coMicrosoftCard()}
    ${coMotiveCard()}
    <div class="card">
      <h2>What Agri-Barn's platform did here</h2>
      <p class="note">Anything done to this company from the Platform page: accounts placed in it, and each visit by the platform
        owner, with why they came and every change they made while here.</p>
      ${coLog === null ? `<p class="note">Loading…</p>` : !coLog.length ? `<p class="note">Nothing yet.</p>` : `
      <ul class="pf-log">${coLog.map(l => `<li><span>${esc(pfWhat(l))}</span>
        <small>${esc(new Date(l.at).toLocaleString())}${l.by_name ? ` · ${esc(l.by_name)}` : ""}</small></li>`).join("")}</ul>`}
    </div>`;
  if (coLog === null) loadCompanyLog().then(renderCompanyAdmin);
}

function coLogoSlot(slot) {
  const path = company[slot.field];
  const url = path ? db.storage.from("company-logos").getPublicUrl(path).data.publicUrl : null;
  const mono = slot.field === "logo_mono_path";
  const kind = slot.photo ? "a JPEG or PNG" : "a PNG";
  return `<div class="co-logo">
      <b>${esc(slot.title)}</b>
      <p class="note">${esc(slot.where)}</p>
      <div class="co-preview ${mono ? "co-preview-mono" : ""}${slot.photo ? " co-preview-photo" : ""}">
        ${url ? `<img src="${esc(url)}" alt="${esc(slot.title)}">`
          : `<span>${slot.photo ? "Agri-Barn's evening sky" : "Your company's name"}</span>`}
      </div>
      <div class="co-actions">
        <button type="button" class="btn-secondary" data-co-pick="${esc(slot.field)}" ${coBusy ? "disabled" : ""}>${path ? "Replace" : "Add"} ${kind}</button>
        <input type="file" accept="${slot.photo ? "image/jpeg,image/png" : "image/png"}" id="coFile-${esc(slot.field)}" data-co-logo="${esc(slot.field)}" hidden>
        ${path ? `<button type="button" class="btn-secondary" data-co-remove="${esc(slot.field)}" ${coBusy ? "disabled" : ""}>Remove</button>` : ""}
      </div>
    </div>`;
}

// The features the company has switched on, of those some companies have and
// others don't (0147, 0149). The Training Center's mission, also 0147, is set
// on the Training dashboard's Training Articles tab (training-articles.js).
const CO_FEATURES = [
  { id: "agco", name: "AGCO dealer", what: "Everything that's AGCO's: the AGCO Development Map and catalog, AGCO's training-hours requirement (the dealer metric on Training Status, the Training dashboard and the Location Dashboard, the Mock Schedule, the AGCO Training Hours report), AGCO Academy's sessions on the Open Seat Report, and AGCO credit on courses." },
  { id: "apparel", name: "Apparel tab", what: "The app's Apparel tab, which opens your company's apparel store signed in. Set up the store's address and password under Shared Logins." },
];
let coSwBusy = false, coSwMessage = "", coSwError = "";
function coSwitchesCard() {
  const on = new Set(company.features || []);
  return `<div class="card">
      <h2>Features</h2>
      <p class="note">What ${esc(company.name)} has, of what some companies have and others don't. Without one, nobody sees it;
        nothing is deleted when it's switched off. The Training Center's mission is set by the Training Manager, with the
        Training Articles.</p>
      ${CO_FEATURES.map(f => `<label class="pl-setting"><input type="checkbox" data-co-feature="${esc(f.id)}" ${on.has(f.id) ? "checked" : ""}>
        <span><b>${esc(f.name)}.</b> ${esc(f.what)}</span></label>`).join("")}
      <div class="co-actions"><button type="button" id="coSwSave" ${coSwBusy ? "disabled" : ""}>Save</button></div>
      ${coSwMessage ? `<p class="co-ok">${esc(coSwMessage)}</p>` : ""}
      ${coSwError ? `<p class="error">${esc(coSwError)}</p>` : ""}
    </div>`;
}

async function coSwitchesSave() {
  const features = [...document.querySelectorAll("[data-co-feature]")].filter(b => b.checked).map(b => b.dataset.coFeature);
  coSwMessage = ""; coSwError = ""; coSwBusy = true; renderCompanyAdmin();
  const { error } = await db.from("companies").update({ features }).eq("id", company.id);
  coSwBusy = false;
  if (error) { coSwError = /features/.test(error.message) ? "Run migration 0147 first." : error.message; return renderCompanyAdmin(); }
  await coReload();
  coSwMessage = "Saved. The app picks it up the next time its home page opens.";
  renderCompanyAdmin();
}

// Where Submit an IT Ticket sends its email (0144), in the app and on this page.
let coItBusy = false, coItMessage = "", coItError = "";
function coItCard() {
  return `<div class="card">
      <h2>IT tickets</h2>
      <p class="note">The Support Center's <b>Submit an IT Ticket</b> opens an email to this address, filled in with who's asking and
        their location. Leave it empty if ${esc(company.name)} has no IT mailbox, and the card isn't shown.</p>
      <div class="co-fields co-fields-one">
        <div><label for="coIt">IT mailbox</label>
          <input type="email" id="coIt" maxlength="120" placeholder="it@yourcompany.com" value="${esc(company.it_ticket_email || "")}"></div>
      </div>
      <div class="co-actions"><button type="button" id="coItSave" ${coItBusy ? "disabled" : ""}>Save</button></div>
      ${coItMessage ? `<p class="co-ok">${esc(coItMessage)}</p>` : ""}
      ${coItError ? `<p class="error">${esc(coItError)}</p>` : ""}
    </div>`;
}

async function coItSave() {
  const address = $("coIt").value.trim();
  coItMessage = ""; coItError = "";
  if (address && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
    coItError = "That doesn't look like an email address."; return renderCompanyAdmin();
  }
  coItBusy = true; renderCompanyAdmin();
  const { error } = await db.from("companies").update({ it_ticket_email: address || null }).eq("id", company.id);
  coItBusy = false;
  if (error) { coItError = /it_ticket_email/.test(error.message) ? "Run migration 0144 first." : error.message; return renderCompanyAdmin(); }
  await coReload();
  coItMessage = address ? `IT tickets go to ${address}. The app picks it up the next time its home page opens.`
    : "No IT mailbox: the Submit an IT Ticket card is hidden.";
  renderCompanyAdmin();
}

// Microsoft 365 (0142): connecting it, and Microsoft sign-in on or off.
// What it says after IT's approval comes back starts as its message.
let coMsLink = "", coMsBusy = false, coMsMessage = "", coMsError = "";
if (window.microsoftResult) ({ ok: coMsMessage, no: coMsError } = window.microsoftResult);
function coMicrosoftCard() {
  const on = !!company.sign_in_microsoft, tenant = company.microsoft_tenant;
  const said = `${coMsMessage ? `<p class="co-ok">${esc(coMsMessage)}</p>` : ""}${coMsError ? `<p class="error">${esc(coMsError)}</p>` : ""}`;
  return `<div class="card" id="coMicrosoft">
      <h2>Microsoft 365</h2>
      ${tenant ? `
        <p class="note">Connected${company.microsoft_connected_at ? ` ${esc(new Date(company.microsoft_connected_at).toLocaleDateString())}` : ""}${
          company.microsoft_connected_by ? ` by ${esc(company.microsoft_connected_by)}` : ""}. People whose work email is at
          ${esc((company.email_domains || []).join(", ") || "its domains")} and who are on the People list can sign in with their
          Microsoft account: the sign-in screens offer it once they type their email. Anyone already with an account here signs in
          with Microsoft into the account they have.</p>
        <p class="note">The People list can keep itself up to date from Microsoft 365's directory, every night: see
          <b>From Microsoft 365</b> on Admin &rarr; People list.</p>
        <label class="pl-setting"><input type="checkbox" id="coMsOn" ${on ? "checked" : ""}>
          <span><b>Sign in with Microsoft</b> for ${esc(company.name)}.</span></label>
        <div class="co-actions"><button type="button" class="btn-secondary" id="coMsDisconnect" ${coMsBusy ? "disabled" : ""}>Disconnect</button></div>
        ${said}`
      : `
        <p class="note">If ${esc(company.name)} uses Microsoft 365, its people can sign in with their work Microsoft account instead of
          a password, and nobody hands out passwords. It needs your Microsoft 365 administrator to approve Agri-Barn once:
          make the link, send it to them, and they click <b>Accept</b>. The email domains come from Microsoft when they do.</p>
        <div class="co-actions"><button type="button" id="coMsLink" ${coMsBusy ? "disabled" : ""}>Make a link for IT</button></div>
        ${coMsLink ? `<div class="co-mslink"><input type="text" id="coMsLinkText" readonly value="${esc(coMsLink)}">
          <button type="button" class="btn-secondary" id="coMsCopy">Copy</button></div>
          <p class="note">Good for a week, once. It needs a Global Administrator or Privileged Role Administrator of your Microsoft 365;
            if that's you, open it yourself. When it's approved, this page says so.</p>` : ""}
        ${said}`}
    </div>`;
}

// Motive (0164): the company's vehicles, mileage and locations come into the
// Fleet Center. An owner connects it once, signing in to Motive themselves or
// sending the link to whoever manages their Motive account.
let coMoLink = "", coMoBusy = false, coMoMessage = "", coMoError = "";
if (window.motiveResult) ({ ok: coMoMessage, no: coMoError } = window.motiveResult);
function coMotiveCard() {
  if (!("motive_company" in company)) return "";
  const said = `${coMoMessage ? `<p class="co-ok">${esc(coMoMessage)}</p>` : ""}${coMoError ? `<p class="error">${esc(coMoError)}</p>` : ""}`;
  return `<div class="card" id="coMotive">
      <h2>Motive</h2>
      ${company.motive_company ? `
        <p class="note">Connected to <b>${esc(company.motive_company_name || "your Motive account")}</b>${
          company.motive_connected_at ? ` ${esc(new Date(company.motive_connected_at).toLocaleDateString())}` : ""}${
          company.motive_connected_by ? ` by ${esc(company.motive_connected_by)}` : ""}. Agri-Barn reads your vehicles, their
          mileage and where they are, and changes nothing in Motive.</p>
        <div class="co-actions"><button type="button" class="btn-secondary" id="coMoDisconnect" ${coMoBusy ? "disabled" : ""}>Disconnect</button></div>
        ${said}`
      : `
        <p class="note">If ${esc(company.name)} uses Motive, connect it once and your vehicles come into the Fleet Center by fleet
          number, their mileage keeps itself up to date, and owners and location admins see where they are on a map. Agri-Barn
          only reads from Motive. It needs someone who manages your Motive account to sign in and approve it.</p>
        <div class="co-actions"><button type="button" id="coMoConnect" ${coMoBusy ? "disabled" : ""}>Connect Motive</button></div>
        ${coMoLink ? `<div class="co-mslink"><input type="text" id="coMoLinkText" readonly value="${esc(coMoLink)}">
          <button type="button" class="btn-secondary" id="coMoCopy">Copy</button>
          <button type="button" id="coMoOpen">Open</button></div>
          <p class="note">Good for a day, once. Open it if you manage your Motive account; otherwise copy it to whoever does.
            When it's approved, this page says so.</p>` : ""}
        ${said}`}
    </div>`;
}

function coConsentLink(state) {
  const q = new URLSearchParams({ client_id: MICROSOFT_CLIENT_ID, scope: "https://graph.microsoft.com/.default",
    redirect_uri: `${SUPABASE_URL}/functions/v1/microsoft-connected`, state });
  return `https://login.microsoftonline.com/organizations/v2.0/adminconsent?${q}`;
}

// Asks for the company again, so what's shown is what was kept.
async function coReload() {
  setCompany(await db.rpc("my_company"));
}

async function coSave() {
  const name = $("coName").value.trim(), legal = $("coLegal").value.trim();
  coMessage = ""; coError = "";
  if (!name || !legal) { coError = "The name and the legal name both need filling in."; return renderCompanyAdmin(); }
  coBusy = true; renderCompanyAdmin();
  const { error } = await db.from("companies").update({ name, legal_name: legal }).eq("id", company.id);
  coBusy = false;
  if (error) { coError = error.message; return renderCompanyAdmin(); }
  await coReload();
  coMessage = "Saved. The app picks it up the next time someone opens its home page.";
  renderCompanyAdmin();
}

async function coSetLogo(field, file) {
  coMessage = ""; coError = "";
  const slot = COMPANY_LOGOS.find(s => s.field === field);
  if (!slot || !file) return;
  const types = slot.photo ? ["image/jpeg", "image/png"] : ["image/png"];
  if (!types.includes(file.type)) { coError = slot.photo ? "A home photo has to be a JPEG or PNG." : "A logo has to be a PNG."; return renderCompanyAdmin(); }
  const most = slot.photo ? PHOTO_MAX_BYTES : LOGO_MAX_BYTES;
  if (file.size > most) { coError = `That picture is over ${slot.photo ? 3 : 1} MB. Save a smaller copy and try again.`; return renderCompanyAdmin(); }
  coBusy = true; renderCompanyAdmin();
  // A new name each time, so the app sees the change and fetches it rather
  // than keeping its copy of the old one.
  const path = `${company.id}/${slot.file}-${Date.now()}.${file.type === "image/jpeg" ? "jpg" : "png"}`;
  const old = company[field];
  const up = await db.storage.from("company-logos").upload(path, file, { contentType: file.type });
  if (up.error) { coBusy = false; coError = up.error.message; return renderCompanyAdmin(); }
  const { error } = await db.from("companies").update({ [field]: path }).eq("id", company.id);
  if (error) {
    await db.storage.from("company-logos").remove([path]);
    coBusy = false;
    coError = /home_photo_path/.test(error.message) ? "Run migration 0161_company_home_photo.sql in the SQL editor first." : error.message;
    return renderCompanyAdmin();
  }
  if (old) await db.storage.from("company-logos").remove([old]);
  await coReload();
  coBusy = false;
  coMessage = slot.photo ? "Home photo saved. It's behind this page's home now, and the app's from the next time its home page opens."
    : `${slot.title} saved. The app shows it from the next time its home page opens.`;
  renderCompanyAdmin();
}

async function coRemoveLogo(field) {
  const slot = COMPANY_LOGOS.find(s => s.field === field);
  if (!slot || !confirm(slot.photo ? "Remove the home photo? The home page goes back to Agri-Barn's evening sky."
    : `Remove "${slot.title}"? Your company's name shows in its place.`)) return;
  coMessage = ""; coError = "";
  coBusy = true; renderCompanyAdmin();
  const old = company[field];
  const { error } = await db.from("companies").update({ [field]: null }).eq("id", company.id);
  if (error) { coBusy = false; coError = error.message; return renderCompanyAdmin(); }
  if (old) await db.storage.from("company-logos").remove([old]);
  await coReload();
  coBusy = false;
  coMessage = slot.photo ? "Removed. The home page shows Agri-Barn's evening sky." : "Removed. Your company's name shows in its place.";
  renderCompanyAdmin();
}

document.addEventListener("click", async (e) => {
  if (e.target.closest("#coMsLink")) {
    coMsMessage = ""; coMsError = ""; coMsBusy = true; renderCompanyAdmin();
    const { data, error } = await db.rpc("start_microsoft_connect");
    coMsBusy = false;
    if (error) { coMsError = error.message; return renderCompanyAdmin(); }
    coMsLink = coConsentLink(data); return renderCompanyAdmin();
  }
  if (e.target.closest("#coMsCopy")) {
    coMsError = "";
    try { await navigator.clipboard.writeText(coMsLink); coMsMessage = "Copied. Send it to your Microsoft 365 administrator."; }
    catch { $("coMsLinkText").select(); coMsMessage = "Select the link and copy it."; }
    return renderCompanyAdmin();
  }
  if (e.target.closest("#coMsDisconnect")) {
    if (!confirm("Disconnect Microsoft 365? Nobody new can join with Microsoft, and the sign-in screens stop offering it. Accounts made with Microsoft stay.")) return;
    coMsMessage = ""; coMsError = "";
    const { error } = await db.rpc("set_microsoft_sign_in", { turn_on: false, disconnect: true });
    if (error) coMsError = error.message; else { await coReload(); coMsMessage = "Microsoft 365 is disconnected."; }
    return renderCompanyAdmin();
  }
  if (e.target.closest("#coMoConnect")) {
    coMoMessage = ""; coMoError = ""; coMoBusy = true; renderCompanyAdmin();
    const { data, error } = await db.functions.invoke("motive", { body: { action: "connect" } });
    let said = data;
    if (error) said = await (error.context && error.context.json ? error.context.json().catch(() => null) : null);
    coMoBusy = false;
    if (!said || !said.url) { coMoError = (said && said.error) || "Motive couldn't be reached. Try again in a minute."; return renderCompanyAdmin(); }
    coMoLink = said.url; return renderCompanyAdmin();
  }
  if (e.target.closest("#coMoOpen")) { location.href = coMoLink; return; }
  if (e.target.closest("#coMoCopy")) {
    coMoError = "";
    try { await navigator.clipboard.writeText(coMoLink); coMoMessage = "Copied. Send it to whoever manages your Motive account."; }
    catch { $("coMoLinkText").select(); coMoMessage = "Select the link and copy it."; }
    return renderCompanyAdmin();
  }
  if (e.target.closest("#coMoDisconnect")) {
    if (!confirm("Disconnect Motive? Vehicles stop updating from it and their locations are forgotten. Nothing in Motive changes.")) return;
    coMoMessage = ""; coMoError = "";
    const { error } = await db.rpc("disconnect_motive");
    if (error) coMoError = error.message; else { await coReload(); coMoMessage = "Motive is disconnected."; }
    return renderCompanyAdmin();
  }
  if (e.target.closest("#coItSave")) return coItSave();
  if (e.target.closest("#coSwSave")) return coSwitchesSave();
  if (e.target.closest("#coSave")) coSave();
  const pick = e.target.closest("[data-co-pick]");
  if (pick) $("coFile-" + pick.dataset.coPick).click();
  const remove = e.target.closest("[data-co-remove]");
  if (remove) coRemoveLogo(remove.dataset.coRemove);
});
document.addEventListener("change", async (e) => {
  if (e.target.id === "coMsOn") {
    coMsMessage = ""; coMsError = "";
    const { error } = await db.rpc("set_microsoft_sign_in", { turn_on: e.target.checked, disconnect: false });
    if (error) coMsError = error.message; else { await coReload(); coMsMessage = e.target.checked ? "Microsoft sign-in is on." : "Microsoft sign-in is off."; }
    return renderCompanyAdmin();
  }
  const input = e.target.closest("[data-co-logo]");
  if (input) coSetLogo(input.dataset.coLogo, input.files && input.files[0]);
});
