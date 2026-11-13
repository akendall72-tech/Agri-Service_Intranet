// Operator's Manuals (migration 0131)
//
// PDFs of machines' operator's manuals, each for one or more locations or for
// every location. Everyone finds the ones for their location in the Support
// Center, under Special Tools; an admin also sees the locations they cover,
// and an owner all of them. Owners add, change and remove them on the admin
// page's Operator's Manuals tab. The database decides who sees what; this only
// draws it.

// The most a PDF can be: the free Supabase plan's limit on any one file. On
// Pro, raise it here and on the bucket (see 0131).
const MANUAL_MAX_MB = 50;
// The free plan's storage, all buckets together.
const STORAGE_PLAN_BYTES = 1024 * 1024 * 1024;

let omManuals = [], omError = null, omNotSetUp = false, omStorage = null;
let omQuery = "", omPlace = null;
// The admin form: null, "new", or the id of the manual being changed.
let omEditing = null;

async function loadManuals() {
  if (!me) return;
  const { data, error } = await allRows(() => db.from("operator_manuals").select("*")
    .order("make").order("title").order("id"));
  omError = error ? error.message : null;
  omNotSetUp = !!error && /does not exist|schema cache/i.test(error.message);
  omManuals = error ? [] : data || [];
  if (isOwner() && !error) {
    const usage = await db.rpc("storage_in_use");
    omStorage = usage.error ? null : usage.data || [];
  }
}

// The locations this person can pick between: every active one for an
// owner, their own and any they cover for an admin, their own for anyone else.
function omPlaces() {
  return isOwner() ? allLocations.filter(l => l.is_active !== false).map(l => l.id) : myLocations();
}
function omCurrentPlace() {
  const places = omPlaces();
  if (omPlace === "all" && places.length > 1) return "all";
  if (places.includes(omPlace)) return omPlace;
  return places.includes(profile && profile.location_id) ? profile.location_id : places.length > 1 ? "all" : places[0] || "all";
}
const omFor = (place) => omManuals.filter(m => place === "all" || m.everywhere || (m.location_ids || []).includes(place));
const omWhere = (m) => m.everywhere ? "Every location" : (m.location_ids || []).map(id => locations[id] || id).join(", ");

// ---- the Support Center's list -----------------------------------------------------

function manualsView() {
  const head = hero("Operator's Manuals", "The operator's manuals for the machines at your location: open one to read, search or print it.");
  if (omNotSetUp) return head + `<div class="card"><p class="note" style="margin:0">Operator's manuals aren't switched on yet.</p></div>`;
  if (omError) return head + `<div class="card"><p class="error" style="margin:0">${esc(omError)}</p></div>`;
  const places = omPlaces(), place = omCurrentPlace();
  return head + `<div class="inv om">
    <div class="inv-bar">
      <input id="omSearch" class="search" type="search" placeholder="Search by machine, make or model" value="${esc(omQuery)}"
        aria-label="Search the manuals">
      ${places.length > 1 ? `<select id="omPlace" aria-label="Location">
        <option value="all"${place === "all" ? " selected" : ""}>${isOwner() ? "Every location" : "All your locations"}</option>
        ${places.map(id => `<option value="${esc(id)}"${place === id ? " selected" : ""}>${esc(locations[id] || id)}</option>`).join("")}
      </select>` : ""}
    </div>
    <div id="omList">${omListHtml()}</div>
  </div>`;
}

function omListHtml() {
  const place = omCurrentPlace();
  const words = omQuery.toLowerCase().split(/\s+/).filter(Boolean);
  const all = omFor(place);
  const shown = all.filter(m => words.every(w => [m.title, m.make, m.model, m.note].join(" ").toLowerCase().includes(w)));
  if (!all.length) {
    return `<p class="st-empty">No operator's manuals for ${esc(place === "all" ? "these locations" : locations[place] || "your location")} yet.
      ${isOwner() ? "Add them on the admin page, under Operator's Manuals." : "The owners add them; ask your location admin if one's missing."}</p>`;
  }
  if (!shown.length) return `<p class="st-empty">Nothing matches “${esc(omQuery)}”.</p>`;
  const makes = [...new Set(shown.map(m => m.make || ""))].sort((a, b) => (a === "") - (b === "") || a.localeCompare(b));
  const showWhere = place === "all";
  return makes.map(make => {
    const here = shown.filter(m => (m.make || "") === make);
    return `<div class="cab-heading">${esc(make || "Other")}<span class="trail">${here.length} manual${here.length === 1 ? "" : "s"}</span></div>
      <div class="inv-list">${here.map(m => `<button type="button" class="cab-card inv-row om-row" data-om-open="${esc(m.id)}" style="${lit("teal")}">
          <span class="om-glyph">${icon("book", 20)}</span>
          <span class="inv-main"><b>${esc(m.title)}</b>
            <span>${esc([m.model, fileSize(m.file_size), showWhere || m.everywhere ? omWhere(m) : ""].filter(Boolean).join(" · "))}</span>
            ${m.note ? `<span>${esc(m.note)}</span>` : ""}</span>
          <span class="cab-tag">PDF</span><span class="cab-chev" aria-hidden="true">&nearr;</span>
        </button>`).join("")}</div>`;
  }).join("") + `<p class="st-empty om-foot">Each opens in a new tab, where you can search it, print it or save it.</p>`;
}

// Opened straight away so the browser doesn't take it for a pop-up, then pointed at the PDF.
async function omOpen(id) {
  const m = omManuals.find(x => x.id === id);
  if (!m) return;
  const tab = window.open("", "_blank");
  const { data, error } = await db.storage.from("operator-manuals").createSignedUrl(m.file_path, 3600);
  if (error || !data) { if (tab) tab.close(); return alert(error ? error.message : "The manual couldn't be opened."); }
  if (tab) tab.location = data.signedUrl; else window.location.href = data.signedUrl;
}

// ---- the admin page's tab ------------------------------------------------------------

function renderManualsAdmin() {
  const box = $("manualsAdmin");
  if (!box) return;
  if (omNotSetUp) {
    box.innerHTML = `<div class="card"><p class="error">Run migration 0131_operator_manuals.sql in the SQL editor, then reload this page.</p></div>`;
    return;
  }
  const used = (omStorage || []).reduce((t, b) => t + Number(b.bytes || 0), 0);
  const mine = (omStorage || []).find(b => b.bucket === "operator-manuals");
  const share = used / STORAGE_PLAN_BYTES;
  box.innerHTML = `<div class="card">
      <h2>Operator's manuals</h2>
      <p class="note">PDFs everyone sees in the Support Center, in the app and on this page, for the locations you
        pick. Up to ${MANUAL_MAX_MB} MB each on the current Supabase plan.</p>
      ${omStorage ? `<p class="note om-storage${share > 0.85 ? " om-full" : ""}">Storage in use: <b>${esc(fileSize(used) || "0 KB")}</b> of 1 GB
        (${Math.round(share * 100)}%), ${esc(fileSize(mine ? Number(mine.bytes) : 0) || "nothing")} of it manuals.
        ${share > 0.85 ? "Nearly full: remove old course versions or manuals, or move to the Pro plan." : ""}</p>` : ""}
      ${omError ? `<p class="error">${esc(omError)}</p>` : ""}
      ${omEditing ? omFormHtml() : `<button type="button" data-om-new>${icon("plus", 15)} Add a manual</button>`}
    </div>
    <div class="card">
      <h2>${omManuals.length} manual${omManuals.length === 1 ? "" : "s"}</h2>
      ${omManuals.length ? `<div style="overflow-x:auto"><table class="om-table">
        <thead><tr><th>Manual</th><th>Locations</th><th>Size</th><th>Added</th><th></th></tr></thead>
        <tbody>${omManuals.map(m => `<tr>
          <td><b>${esc(m.title)}</b>${m.make || m.model ? `<div class="note">${esc([m.make, m.model].filter(Boolean).join(" · "))}</div>` : ""}</td>
          <td>${esc(omWhere(m))}</td>
          <td>${esc(fileSize(m.file_size))}</td>
          <td><span class="note">${esc(fmtDate(String(m.created_at || "").slice(0, 10)))}${m.added_by_name ? ` · ${esc(m.added_by_name)}` : ""}</span></td>
          <td class="om-actions"><button type="button" class="ghost" data-om-open="${esc(m.id)}">Open</button>
            <button type="button" class="ghost" data-om-edit="${esc(m.id)}">Change</button>
            <button type="button" class="ghost danger" data-om-remove="${esc(m.id)}">Remove</button></td>
        </tr>`).join("")}</tbody></table></div>` : `<p class="note">None yet. <b>Add a manual</b> above.</p>`}
    </div>`;
}

function omFormHtml() {
  const m = omEditing === "new" ? null : omManuals.find(x => x.id === omEditing);
  const places = allLocations.filter(l => l.is_active !== false || (m && (m.location_ids || []).includes(l.id)));
  const picked = new Set(m ? m.location_ids || [] : []);
  const every = !!(m && m.everywhere);
  return `<div class="om-form" data-om-form>
    <h3>${m ? `Change ${esc(m.title)}` : "Add a manual"}</h3>
    <div class="fields">
      <div class="wide"><label for="omTitle">What it is</label>
        <input id="omTitle" maxlength="160" placeholder="e.g. Fendt 700 Vario Gen7 Operator's Manual" value="${esc(m ? m.title : "")}"></div>
      <div><label for="omMake">Make (optional)</label><input id="omMake" maxlength="80" placeholder="e.g. Fendt" value="${esc(m ? m.make : "")}"></div>
      <div><label for="omModel">Model (optional)</label><input id="omModel" maxlength="120" placeholder="e.g. 724 Vario" value="${esc(m ? m.model : "")}"></div>
      <div class="wide"><label for="omNote">Note (optional)</label><input id="omNote" maxlength="500" placeholder="e.g. Serial numbers from …" value="${esc(m ? m.note : "")}"></div>
      <div class="wide"><label>Locations</label>
        <label class="check"><input id="omEvery" type="checkbox"${every ? " checked" : ""}> Every location</label>
        <div class="om-places">${places.map(l => `<label class="check"><input type="checkbox" data-om-place="${esc(l.id)}"${
          picked.has(l.id) ? " checked" : ""}${every ? " disabled" : ""}> ${esc(l.name)}</label>`).join("")}</div></div>
      <div class="wide"><label for="omFile">The PDF${m ? " (choose one only to replace it)" : ""}</label>
        <input id="omFile" type="file" accept="application/pdf,.pdf">
        <p class="note">Up to ${MANUAL_MAX_MB} MB. A big one takes a minute to upload; keep this tab open until it says it's saved.</p></div>
    </div>
    <div class="row" style="margin-top:12px">
      <button type="button" data-om-save>${m ? "Save changes" : "Upload it"}</button>
      <button type="button" class="ghost" data-om-cancel>Cancel</button>
      <span class="msg" role="status"></span>
    </div>
  </div>`;
}

// A name for the stored file: the uploaded one's, made safe for a path.
function omFileName(file) {
  const base = String(file.name || "manual.pdf").replace(/\.pdf$/i, "").replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
  return `${base || "manual"}.pdf`;
}

async function omSave(button) {
  const form = button.closest("[data-om-form]");
  const say = (text, bad) => speak(form, text, bad);
  const existing = omEditing === "new" ? null : omManuals.find(x => x.id === omEditing);
  const title = $("omTitle").value.trim();
  if (!title) return say("Say what it is.", true);
  const everywhere = $("omEvery").checked;
  const places = [...form.querySelectorAll("[data-om-place]:checked")].map(b => b.dataset.omPlace);
  if (!everywhere && !places.length) return say("Pick at least one location, or Every location.", true);
  const file = $("omFile").files[0];
  if (!existing && !file) return say("Choose the PDF.", true);
  if (file && !/\.pdf$/i.test(file.name) && file.type !== "application/pdf") return say("That isn't a PDF.", true);
  if (file && file.size > MANUAL_MAX_MB * 1024 * 1024) {
    return say(`That PDF is ${fileSize(file.size)}; the most the current plan takes is ${MANUAL_MAX_MB} MB.`, true);
  }
  const fields = { title, make: $("omMake").value.trim(), model: $("omModel").value.trim(), note: $("omNote").value.trim(),
    everywhere, location_ids: everywhere ? [] : places };
  button.disabled = true;
  const id = existing ? existing.id : crypto.randomUUID();
  let uploaded = null;
  if (file) {
    say(`Uploading ${fileSize(file.size)}…`, false);
    uploaded = `${id}/${crypto.randomUUID().slice(0, 8)}-${omFileName(file)}`;
    const { error } = await db.storage.from("operator-manuals").upload(uploaded, file, { contentType: "application/pdf" });
    if (error) {
      button.disabled = false;
      return say(/exceed|too large|payload/i.test(error.message)
        ? `That PDF is bigger than the storage allows (${MANUAL_MAX_MB} MB on the current plan).` : `The PDF didn't upload: ${error.message}`, true);
    }
    Object.assign(fields, { file_path: uploaded, file_name: file.name, file_size: file.size });
  }
  say("Saving…", false);
  const { data, error } = existing
    ? await db.from("operator_manuals").update(fields).eq("id", id).select()
    : await db.from("operator_manuals").insert({ id, ...fields }).select();
  if (error || !(data || []).length) {
    if (uploaded) await db.storage.from("operator-manuals").remove([uploaded]);
    button.disabled = false;
    return say(error ? error.message : "Not saved: only owners add manuals.", true);
  }
  // The old PDF goes once the new one is in its place.
  if (uploaded && existing && existing.file_path) await db.storage.from("operator-manuals").remove([existing.file_path]);
  omEditing = null;
  await loadManuals();
  renderManualsAdmin();
}

async function omRemove(id) {
  const m = omManuals.find(x => x.id === id);
  if (!m || !confirm(`Remove ${m.title}? Nobody can open it any more, and the PDF is deleted. This can't be undone.`)) return;
  const { data, error } = await db.from("operator_manuals").delete().eq("id", id).select("id");
  if (error || !(data || []).length) return alert(error ? error.message : "Not removed: only owners remove manuals.");
  if (m.file_path) await db.storage.from("operator-manuals").remove([m.file_path]);
  if (omEditing === id) omEditing = null;
  await loadManuals();
  renderManualsAdmin();
}

document.addEventListener("input", (event) => {
  if (event.target.id !== "omSearch") return;
  omQuery = event.target.value;
  $("omList").innerHTML = omListHtml();
});
document.addEventListener("change", (event) => {
  if (event.target.id === "omPlace") { omPlace = event.target.value; $("omList").innerHTML = omListHtml(); }
  if (event.target.id === "omEvery") {
    document.querySelectorAll("[data-om-place]").forEach(b => { b.disabled = event.target.checked; });
  }
});
document.addEventListener("click", (event) => {
  const t = event.target;
  const open = t.closest("[data-om-open]");
  if (open) return omOpen(open.dataset.omOpen);
  if (t.closest("[data-om-new]")) { omEditing = "new"; renderManualsAdmin(); return $("omTitle") && $("omTitle").focus(); }
  const edit = t.closest("[data-om-edit]");
  if (edit) {
    omEditing = edit.dataset.omEdit; renderManualsAdmin();
    const form = document.querySelector("[data-om-form]");
    if (form) form.scrollIntoView({ block: "center" });
    return;
  }
  if (t.closest("[data-om-cancel]")) { omEditing = null; return renderManualsAdmin(); }
  const save = t.closest("[data-om-save]");
  if (save) return omSave(save);
  const remove = t.closest("[data-om-remove]");
  if (remove) return omRemove(remove.dataset.omRemove);
});
