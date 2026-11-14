// Company (migration 0133, multi-org step 2)
//
// The admin page's Company tab, for owners: the name everyone sees, the legal
// name at the foot of PDFs, and the app's two logos. Where the name is read
// from, and the built-in Agri-Service that stands in when there's nothing to
// read, is in core.js (company, setCompany).

// The most a logo can be: the company-logos bucket's limit.
const LOGO_MAX_BYTES = 1024 * 1024;
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
    where: "On the app's red headers and certificates, drawn in white. A PNG with a clear background: everything that isn't clear turns white." }
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
      <h2>Logos</h2>
      <p class="note">For the app. Until one is added it shows its built-in logo, which is Agri-Service's.</p>
      <div class="co-logos">${COMPANY_LOGOS.map(coLogoSlot).join("")}</div>
    </div>
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
  return `<div class="co-logo">
      <b>${esc(slot.title)}</b>
      <p class="note">${esc(slot.where)}</p>
      <div class="co-preview ${mono ? "co-preview-mono" : ""}">
        ${url ? `<img src="${esc(url)}" alt="${esc(slot.title)}">` : `<span>The app's built-in logo</span>`}
      </div>
      <div class="co-actions">
        <button type="button" class="btn-secondary" data-co-pick="${esc(slot.field)}" ${coBusy ? "disabled" : ""}>${path ? "Replace" : "Add"} a PNG</button>
        <input type="file" accept="image/png" id="coFile-${esc(slot.field)}" data-co-logo="${esc(slot.field)}" hidden>
        ${path ? `<button type="button" class="btn-secondary" data-co-remove="${esc(slot.field)}" ${coBusy ? "disabled" : ""}>Use the built-in one</button>` : ""}
      </div>
    </div>`;
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
  if (file.type !== "image/png") { coError = "A logo has to be a PNG."; return renderCompanyAdmin(); }
  if (file.size > LOGO_MAX_BYTES) { coError = "That picture is over 1 MB. Save a smaller copy and try again."; return renderCompanyAdmin(); }
  coBusy = true; renderCompanyAdmin();
  // A new name each time, so the app sees the change and fetches it rather
  // than keeping its copy of the old one.
  const path = `${company.id}/${slot.file}-${Date.now()}.png`;
  const old = company[field];
  const up = await db.storage.from("company-logos").upload(path, file, { contentType: "image/png" });
  if (up.error) { coBusy = false; coError = up.error.message; return renderCompanyAdmin(); }
  const { error } = await db.from("companies").update({ [field]: path }).eq("id", company.id);
  if (error) {
    await db.storage.from("company-logos").remove([path]);
    coBusy = false; coError = error.message; return renderCompanyAdmin();
  }
  if (old) await db.storage.from("company-logos").remove([old]);
  await coReload();
  coBusy = false;
  coMessage = `${slot.title} saved. The app shows it from the next time its home page opens.`;
  renderCompanyAdmin();
}

async function coRemoveLogo(field) {
  const slot = COMPANY_LOGOS.find(s => s.field === field);
  if (!slot || !confirm(`Go back to the app's built-in logo for "${slot.title}"?`)) return;
  coMessage = ""; coError = "";
  coBusy = true; renderCompanyAdmin();
  const old = company[field];
  const { error } = await db.from("companies").update({ [field]: null }).eq("id", company.id);
  if (error) { coBusy = false; coError = error.message; return renderCompanyAdmin(); }
  if (old) await db.storage.from("company-logos").remove([old]);
  await coReload();
  coBusy = false;
  coMessage = "Back to the built-in logo.";
  renderCompanyAdmin();
}

document.addEventListener("click", (e) => {
  if (e.target.closest("#coSave")) coSave();
  const pick = e.target.closest("[data-co-pick]");
  if (pick) $("coFile-" + pick.dataset.coPick).click();
  const remove = e.target.closest("[data-co-remove]");
  if (remove) coRemoveLogo(remove.dataset.coRemove);
});
document.addEventListener("change", (e) => {
  const input = e.target.closest("[data-co-logo]");
  if (input) coSetLogo(input.dataset.coLogo, input.files && input.files[0]);
});
