// EPA 609 (migration 0126)
//
// A certification the company tracks, not a course it gives. The Training
// Manager ticks off who has it, with a picture of their certificate (a photo
// or a PDF), and it's on their training record at once: Training Status, the
// dashboard's EPA 609 tile and the reports read it there. Other owners can
// look. The database holds the rules and keeps the pictures private.

let epaCerts = [], epaError = null, epaNotSetUp = false;
let epaView = { who: "techs", show: "all", q: "" };
// The person being ticked off or changed, by their record's key.
let epaEditing = null;

// Owners see everyone's; a location's admins their people's, for the
// Location Dashboard's Certifications.
async function loadEpaCerts() {
  if (!isAdmin()) return;
  const { data, error } = await allRows(() => db.from("epa_certifications").select("*").order("added_at").order("id"));
  epaError = error ? error.message : null;
  epaNotSetUp = !!error && /does not exist|schema cache/i.test(error.message);
  epaCerts = error ? [] : data || [];
}

// Theirs by employee number when both have one, otherwise by work email.
const epaCertFor = (p) => epaCerts.find(c => c.employee_number && p.employee_number
  ? c.employee_number === p.employee_number
  : !!c.email && !!p.email && c.email.toLowerCase() === p.email.toLowerCase());
const epaName = (p) => `${p.first_name || ""} ${p.last_name || ""}`.trim() || p.email || p.person_key;

function renderEpa609() {
  const box = $("epa609");
  if (!box) return;
  if (epaNotSetUp) {
    box.innerHTML = `<div class="card"><p class="error">Run migration 0126_epa_609.sql in the SQL editor, then reload this page.</p></div>`;
    return;
  }
  const techs = tsPeople.filter(p => p.is_technician);
  const certifiedTechs = techs.filter(epaCertFor).length;
  const noPicture = epaCerts.filter(c => !c.photo_path).length;
  const words = epaView.q.toLowerCase().split(/\s+/).filter(Boolean);
  const people = (epaView.who === "techs" ? techs : tsPeople)
    .map(p => ({ p, c: epaCertFor(p) }))
    .filter(({ c }) => epaView.show === "all" || (epaView.show === "yes" ? c : epaView.show === "no" ? !c : c && !c.photo_path))
    .filter(({ p }) => words.every(w => `${epaName(p)} ${p.store || ""} ${p.job || ""} ${p.employee_number || ""}`.toLowerCase().includes(w)))
    .sort((a, b) => (a.p.store || "").localeCompare(b.p.store || "") || epaName(a.p).localeCompare(epaName(b.p)));
  const chip = (group, value, label) => `<button type="button" class="chip${epaView[group] === value ? " on" : ""}" data-epa-${group}="${value}">${label}</button>`;
  const manager = isTrainingManager();

  box.innerHTML = `<div class="card">
      <h2>EPA 609 certifications</h2>
      <p class="note">Who's EPA 609 certified, ticked off here with a picture of their certificate. It goes on their training record at once,
        for Training Status, the dashboard and the reports. ${manager ? "" : "Only the Training Manager ticks people off."}</p>
      <p class="epa-sum"><b>${certifiedTechs} of ${techs.length} technicians</b> certified${noPicture
        ? ` · <button type="button" class="linkish" data-epa-show="nopic">${noPicture} without a picture yet</button>` : ""}</p>
      <div class="row epa-filters">
        ${chip("who", "techs", "Technicians")}${chip("who", "all", "Everyone")}
        <span class="epa-gap"></span>
        ${chip("show", "all", "All")}${chip("show", "yes", "Certified")}${chip("show", "no", "Not yet")}${chip("show", "nopic", "No picture")}
        <input id="epaSearch" type="text" enterkeyhint="search" autocomplete="off" placeholder="Search by name, location or job"
          value="${esc(epaView.q)}" aria-label="Search people">
      </div>
      ${epaError && !epaNotSetUp ? `<p class="error">${esc(epaError)}</p>` : ""}
      ${people.length ? `<div style="overflow-x:auto"><table class="ts-table epa-table">
        <thead><tr><th>Person</th><th>EPA 609</th><th>Certificate</th><th></th></tr></thead>
        <tbody>${people.map(({ p, c }) => epaRowHtml(p, c, manager)).join("")}</tbody></table></div>`
        : `<p class="note">Nobody matches.</p>`}
    </div>`;
}

function epaRowHtml(p, c, manager) {
  const key = esc(p.person_key);
  const row = `<tr class="${c ? "epa-yes" : ""}${epaEditing === p.person_key ? " epa-open" : ""}">
    <td><b>${esc(epaName(p))}</b><small>${esc([p.store, (p.job || "").replace(/^\d+\s*-\s*/, "")].filter(Boolean).join(" · "))}</small></td>
    <td>${c ? `<span class="badge b-current">Certified</span><small>${esc([c.certified_on && newsDate(c.certified_on),
      c.certificate_number && `#${c.certificate_number}`].filter(Boolean).join(" · "))}</small>` : `<span class="badge b-none">Not yet</span>`}</td>
    <td>${c ? (c.photo_path ? `<button type="button" class="linkish" data-epa-view="${esc(c.id)}">View certificate</button>`
      : `<span class="epa-missing">No picture yet</span>`) : ""}</td>
    <td class="epa-act">${manager ? (c
      ? `<button type="button" class="pdf" data-epa-edit="${key}">Change</button><button type="button" class="pdf" data-epa-remove="${key}">Remove</button>`
      : `<button type="button" class="pdf" data-epa-edit="${key}">Tick off</button>`) : ""}</td>
  </tr>`;
  return epaEditing === p.person_key ? row + epaEditorHtml(p, c) : row;
}

function epaEditorHtml(p, c) {
  return `<tr class="epa-editor"><td colspan="4"><div class="epa-form" id="epaForm">
      <div class="fields">
        <div><label for="epaOn">Certified on (optional)</label><input id="epaOn" type="date" max="${tcToday()}" value="${esc((c && c.certified_on) || "")}"></div>
        <div><label for="epaNumber">Certificate number (optional)</label><input id="epaNumber" maxlength="100" value="${esc((c && c.certificate_number) || "")}"></div>
        <div class="wide"><label for="epaPhoto">Picture of the certificate${c && c.photo_path ? " (choose one to replace it)" : ""}</label>
          <input id="epaPhoto" type="file" accept="image/*,application/pdf">
          <p class="note">A photo or a PDF. Photos are shrunk to a size that's still easy to read.</p></div>
        <div class="wide"><label for="epaNote">Note (optional)</label><input id="epaNote" maxlength="500" value="${esc((c && c.note) || "")}"></div>
      </div>
      <div class="row"><button type="button" data-epa-save="${esc(p.person_key)}">${c ? "Save" : `Tick off ${esc(epaName(p))}`}</button>
        <button type="button" class="ghost" data-epa-cancel>Cancel</button><span class="msg"></span></div>
    </div></td></tr>`;
}

// A photo at a size that's still sharp to read a certificate number on; a PDF as it is.
async function epaPicture(file) {
  if (file.type === "application/pdf") return { blob: file, ext: "pdf", type: "application/pdf" };
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 2400 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve, reject) =>
      canvas.toBlob(b => b ? resolve(b) : reject(new Error("unreadable")), "image/jpeg", 0.85));
    return { blob, ext: "jpg", type: "image/jpeg" };
  } catch {
    // A picture the browser can't draw (an iPhone's HEIC, say) goes up as it is.
    return { blob: file, ext: (file.name.split(".").pop() || "img").toLowerCase(), type: file.type || "image/heic" };
  }
}

async function epaSave(button) {
  const p = tsPeople.find(x => x.person_key === button.dataset.epaSave);
  const form = $("epaForm");
  if (!p) return;
  const existing = epaCertFor(p);
  const file = $("epaPhoto").files[0];
  if (file && file.size > 25 * 1024 * 1024) return speak(form, "That file is too big. Choose a picture or PDF under 25 MB.", true);
  const fields = { certified_on: $("epaOn").value || null, certificate_number: $("epaNumber").value.trim(), note: $("epaNote").value.trim() };
  button.disabled = true;
  speak(form, "Saving…", false);
  let cert = existing;
  if (existing) {
    const { data, error } = await db.from("epa_certifications").update(fields).eq("id", existing.id).select();
    if (error || !(data || []).length) { button.disabled = false; return speak(form, error ? error.message : "Not saved: only the Training Manager changes EPA 609.", true); }
    cert = data[0];
  } else {
    const { data, error } = await db.from("epa_certifications").insert({ ...fields, employee_number: p.employee_number || null,
      email: p.email || null, person_name: epaName(p), store: p.store || "" }).select();
    if (error || !(data || []).length) { button.disabled = false; return speak(form, error ? error.message : "Not saved: only the Training Manager ticks people off.", true); }
    cert = data[0];
  }
  if (file) {
    const picture = await epaPicture(file);
    const path = `${cert.id}/${crypto.randomUUID()}.${picture.ext}`;
    const { error: upload } = await db.storage.from("epa-certificates").upload(path, picture.blob, { contentType: picture.type });
    if (upload) {
      button.disabled = false;
      await loadEpaCerts();
      renderEpa609();
      return speak($("epaForm") || document.querySelector("#epa609 .card"), `Saved, but the picture didn't upload (${upload.message}). Try it again.`, true);
    }
    const { error: link } = await db.from("epa_certifications").update({ photo_path: path }).eq("id", cert.id);
    if (!link && cert.photo_path) await db.storage.from("epa-certificates").remove([cert.photo_path]);
  }
  epaEditing = null;
  await Promise.all([loadEpaCerts(), loadTrainingStatus()]);
  renderEpa609();
  safely(renderTsLive, renderTrainingOverview);
}

document.addEventListener("input", (event) => {
  if (event.target.id !== "epaSearch") return;
  epaView.q = event.target.value;
  const at = event.target.selectionStart;
  renderEpa609();
  const again = $("epaSearch");
  again.focus();
  again.setSelectionRange(at, at);
});

document.addEventListener("click", async (event) => {
  const t = event.target;
  const who = t.closest("[data-epa-who]");
  if (who) { epaView.who = who.dataset.epaWho; return renderEpa609(); }
  const show = t.closest("[data-epa-show]");
  if (show) { epaView.show = show.dataset.epaShow; return renderEpa609(); }
  const edit = t.closest("[data-epa-edit]");
  if (edit) { epaEditing = edit.dataset.epaEdit; renderEpa609(); return $("epaOn") && $("epaOn").focus(); }
  if (t.closest("[data-epa-cancel]")) { epaEditing = null; return renderEpa609(); }
  const save = t.closest("[data-epa-save]");
  if (save) return epaSave(save);
  const view = t.closest("[data-epa-view]");
  if (view) {
    const c = epaCerts.find(x => x.id === view.dataset.epaView);
    if (!c || !c.photo_path) return;
    // Opened straight away so the browser doesn't take it for a pop-up, then pointed at the picture.
    const tab = window.open("", "_blank");
    const { data, error } = await db.storage.from("epa-certificates").createSignedUrl(c.photo_path, 600);
    if (error || !data) { if (tab) tab.close(); return alert(error ? error.message : "The picture couldn't be opened."); }
    if (tab) tab.location = data.signedUrl; else window.location.href = data.signedUrl;
    return;
  }
  const remove = t.closest("[data-epa-remove]");
  if (remove) {
    const p = tsPeople.find(x => x.person_key === remove.dataset.epaRemove);
    const c = p && epaCertFor(p);
    if (!c || !confirm(`Take EPA 609 off ${epaName(p)}? Their record shows them not certified${c.photo_path ? ", and the picture of the certificate is deleted" : ""}. This can't be undone.`)) return;
    remove.disabled = true;
    if (c.photo_path) await db.storage.from("epa-certificates").remove([c.photo_path]);
    const { data, error } = await db.from("epa_certifications").delete().eq("id", c.id).select("id");
    if (error || !(data || []).length) { remove.disabled = false; return alert(error ? error.message : "Not removed: only the Training Manager changes EPA 609."); }
    await Promise.all([loadEpaCerts(), loadTrainingStatus()]);
    renderEpa609();
    safely(renderTsLive, renderTrainingOverview);
  }
});
