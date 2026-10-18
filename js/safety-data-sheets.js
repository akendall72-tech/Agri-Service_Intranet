// Safety Data Sheets
//
// The SDS library everyone reads, and uploading and replacing sheets.

// ---------------------------------------------------------------- safety data sheets
//
// The SDS library (migration 0033). PDFs go in the private "sds" bucket under a
// random name; the table holds the product name people search for. Uploading a
// sheet whose name is already there replaces that sheet's file, so a folder of
// new revisions can be dropped in the same way as the first batch.

let sdsSheets = [], sdsError = null;
let sdsPending = [];          // [{ file, name, manufacturer }]
let sdsUploading = false;
let sdsAdminSearch = "", sdsViewSearch = "";

async function loadSds() {
  const { data, error } = await db.from("safety_data_sheets").select("*");
  sdsError = error ? error.message : null;
  sdsSheets = (data || []).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));
}

const sdsSize = (bytes) => !bytes ? "" : bytes < 1048576
  ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1048576).toFixed(1)} MB`;

// "Brake_Parts-Cleaner (2024).PDF" -> "Brake Parts-Cleaner (2024)"
const sdsNameFromFile = (fileName) => fileName.replace(/\.pdf$/i, "").replace(/_+/g, " ").replace(/\s+/g, " ").trim();

const sdsExisting = (name) => sdsSheets.find(s => s.name.trim().toLowerCase() === name.trim().toLowerCase());

// Opens in a new tab. The tab is opened before the signed link is fetched, so
// the browser doesn't treat it as an unrequested pop-up.
async function openSds(sheet) {
  const tab = window.open("", "_blank");
  const { data, error } = await db.storage.from("sds").createSignedUrl(sheet.file_path, 3600);
  if (error || !data) {
    if (tab) tab.close();
    alert("Couldn't open that sheet: " + (error ? error.message : "no link"));
    return;
  }
  if (tab) tab.location = data.signedUrl; else window.location.href = data.signedUrl;
}

function sdsAddFiles(files) {
  const skipped = [];
  for (const file of files) {
    if (!/\.pdf$/i.test(file.name) && file.type !== "application/pdf") { skipped.push(file.name); continue; }
    if (file.size > 25 * 1048576) { skipped.push(`${file.name} (over 25 MB)`); continue; }
    sdsPending.push({ file, name: sdsNameFromFile(file.name), manufacturer: "", status: "" });
  }
  renderSdsPending(skipped.length ? `Skipped — not a PDF, or too big: ${skipped.join(", ")}` : "");
}

function renderSdsPending(note = "") {
  const box = $("sdsPending");
  if (!box) return;
  if (!sdsPending.length) {
    box.innerHTML = note ? `<p class="error" style="margin-top:12px">${esc(note)}</p>` : "";
    return;
  }

  const counts = {};
  sdsPending.forEach(p => { const k = p.name.trim().toLowerCase(); counts[k] = (counts[k] || 0) + 1; });
  const replacing = sdsPending.filter(p => sdsExisting(p.name)).length;
  const dupes = sdsPending.filter(p => counts[p.name.trim().toLowerCase()] > 1).length;

  box.innerHTML = `
    ${note ? `<p class="error" style="margin-top:12px">${esc(note)}</p>` : ""}
    <div class="row" style="margin:16px 0 8px">
      <b>${sdsPending.length} ready to upload</b>
      <span class="note">${replacing ? `${replacing} will replace an existing sheet · ` : ""}Check the names — they're what people search for.</span>
    </div>
    <div style="overflow-x:auto"><table>
      <thead><tr><th>Product name</th><th>Manufacturer (optional)</th><th>File</th><th></th></tr></thead>
      <tbody>${sdsPending.map((p, i) => {
        const dupe = counts[p.name.trim().toLowerCase()] > 1;
        const existing = sdsExisting(p.name);
        return `<tr data-sds-pending="${i}">
          <td><input type="text" data-sp="name" value="${esc(p.name)}" style="margin:0">
            ${dupe ? `<div class="error" style="font-size:12px">Same name twice in this batch</div>`
              : existing ? `<div class="note" style="font-size:12px;color:#92590A">Replaces the current sheet</div>` : ""}
            ${p.status ? `<div class="${p.status.startsWith("✓") ? "ok" : "error"}" style="font-size:12px">${esc(p.status)}</div>` : ""}</td>
          <td><input type="text" data-sp="manufacturer" value="${esc(p.manufacturer)}"
            placeholder="${esc(existing && existing.manufacturer || "")}" style="margin:0"></td>
          <td class="note" style="white-space:nowrap">${esc(p.file.name)}<br>${sdsSize(p.file.size)}</td>
          <td><button class="pdf" data-act="sds-unqueue" ${sdsUploading ? "disabled" : ""}>Remove</button></td>
        </tr>`;
      }).join("")}</tbody>
    </table></div>
    <div class="row" style="margin-top:12px">
      <button data-act="sds-upload" ${sdsUploading || dupes || sdsPending.some(p => !p.name.trim()) ? "disabled" : ""}>
        ${sdsUploading ? "Uploading…" : `Upload ${sdsPending.length} sheet${sdsPending.length === 1 ? "" : "s"}`}</button>
      <button class="ghost" data-act="sds-clear" ${sdsUploading ? "disabled" : ""}>Clear</button>
      <span class="msg" id="sdsUploadMsg"></span>
    </div>`;
}

function renderSdsAdmin() {
  const list = $("sdsList");
  if (!list) return;
  if (sdsError) {
    list.innerHTML = `<p class="error">${/does not exist|schema cache/i.test(sdsError)
      ? "Run migration 0033_safety_data_sheets.sql in the SQL editor, then reload this page."
      : esc(sdsError)}</p>`;
    return;
  }
  const total = sdsSheets.reduce((n, s) => n + (s.file_size || 0), 0);
  $("sdsStats").innerHTML = `<span class="stat"><b>${sdsSheets.length}</b>sheets</span>` +
    `<span class="stat"><b>${sdsSize(total) || "0 KB"}</b>stored</span>`;

  const q = sdsAdminSearch.trim().toLowerCase();
  const shown = sdsSheets.filter(s => !q || `${s.name} ${s.manufacturer || ""}`.toLowerCase().includes(q));
  list.innerHTML = shown.length ? `<div style="overflow-x:auto"><table>
    <thead><tr><th>Product name</th><th>Manufacturer</th><th>Updated</th><th></th></tr></thead>
    <tbody>${shown.map(s => `<tr data-sds="${esc(s.id)}">
      <td><input type="text" data-s="name" value="${esc(s.name)}" style="margin:0"></td>
      <td><input type="text" data-s="manufacturer" value="${esc(s.manufacturer || "")}" style="margin:0"></td>
      <td class="note" style="white-space:nowrap">${new Date(s.updated_at).toLocaleDateString()}<br>${sdsSize(s.file_size)}</td>
      <td style="white-space:nowrap">
        <button class="pdf" data-act="sds-save">Save</button>
        <button class="pdf" data-act="sds-open">Open</button>
        <label class="pdf" style="display:inline-flex;margin:0;padding:5px 11px;border:1px solid var(--line-strong);border-radius:8px;cursor:pointer;font-size:13px;color:var(--ink-2)">Replace PDF
          <input type="file" accept=".pdf,application/pdf" data-act="sds-replace" class="hidden"></label>
        <button class="pdf" data-act="sds-delete">Delete</button>
        <div class="msg"></div>
      </td></tr>`).join("")}</tbody></table></div>`
    : `<p class="note">${sdsSheets.length ? "No sheets match." : "No sheets yet. Upload some above."}</p>`;
}

async function sdsUploadAll() {
  sdsUploading = true;
  renderSdsPending();
  const msg = () => $("sdsUploadMsg");
  let done = 0, failed = 0;

  for (const item of [...sdsPending]) {
    msg().textContent = `Uploading ${done + failed + 1} of ${sdsPending.length}…`;
    msg().className = "msg";
    const existing = sdsExisting(item.name);
    const path = `sheets/${crypto.randomUUID()}.pdf`;

    const up = await db.storage.from("sds").upload(path, item.file, { contentType: "application/pdf", upsert: false });
    if (up.error) {
      item.status = /row-level|unauthorized|403/i.test(up.error.message) ? "Only an owner can upload sheets." : up.error.message;
      failed++; continue;
    }

    const fields = { name: item.name.trim(), file_path: path, file_size: item.file.size };
    if (item.manufacturer.trim()) fields.manufacturer = item.manufacturer.trim();
    const result = existing
      ? await db.from("safety_data_sheets").update(fields).eq("id", existing.id).select()
      : await db.from("safety_data_sheets").insert(fields).select();

    if (result.error || !result.data || !result.data.length) {
      await db.storage.from("sds").remove([path]);
      item.status = result.error ? result.error.message : "Not saved — only an owner can add sheets.";
      failed++; continue;
    }
    // The old revision's file is no longer used by anything.
    if (existing && existing.file_path !== path) await db.storage.from("sds").remove([existing.file_path]);
    item.status = "✓ Uploaded";
    item.done = true;
    done++;
  }

  await loadSds();
  sdsPending = sdsPending.filter(p => !p.done);
  sdsUploading = false;
  renderSdsAdmin();
  renderSdsPending();
  if (!sdsPending.length) {
    $("sdsPending").innerHTML = `<p class="ok" style="margin-top:12px">Uploaded ${done} sheet${done === 1 ? "" : "s"}. Phones see them next time the list is opened.</p>`;
  } else {
    msg().textContent = `${done} uploaded, ${failed} didn't — see the reasons above.`;
    msg().className = "msg error";
  }
}

$("sdsFile").addEventListener("change", (e) => { sdsAddFiles([...e.target.files]); e.target.value = ""; });
["dragenter", "dragover"].forEach(type =>
  $("sdsDrop").addEventListener(type, (e) => { e.preventDefault(); $("sdsDrop").classList.add("over"); }));
["dragleave", "drop"].forEach(type =>
  $("sdsDrop").addEventListener(type, () => $("sdsDrop").classList.remove("over")));
$("sdsDrop").addEventListener("drop", (e) => { e.preventDefault(); sdsAddFiles([...e.dataTransfer.files]); });

$("admin").addEventListener("input", (event) => {
  if (event.target.id === "sdsSearch") { sdsAdminSearch = event.target.value; return renderSdsAdmin(); }
  const row = event.target.closest("[data-sds-pending]");
  if (row && event.target.dataset.sp) {
    sdsPending[Number(row.dataset.sdsPending)][event.target.dataset.sp] = event.target.value;
  }
});
// Names are re-checked for duplicates and replacements once someone finishes typing.
$("admin").addEventListener("change", async (event) => {
  if (event.target.closest("[data-sds-pending]") && event.target.dataset.sp === "name") {
    // Redraw once focus has moved on, and put it back where it went.
    return setTimeout(() => {
      const el = document.activeElement;
      const row = el && el.closest && el.closest("[data-sds-pending]");
      const where = row && el.dataset.sp ? [row.dataset.sdsPending, el.dataset.sp] : null;
      renderSdsPending();
      if (where) {
        const again = document.querySelector(`[data-sds-pending="${where[0]}"] [data-sp="${where[1]}"]`);
        if (again) again.focus();
      }
    });
  }

  const input = event.target.closest('input[type=file][data-act="sds-replace"]');
  if (!input || !input.files[0]) return;
  const row = input.closest("[data-sds]");
  const sheet = sdsSheets.find(s => s.id === row.dataset.sds);
  const file = input.files[0];
  input.value = "";
  if (!/\.pdf$/i.test(file.name)) return speak(row, "That isn't a PDF.", true);
  speak(row, "Uploading…", false);
  const path = `sheets/${crypto.randomUUID()}.pdf`;
  const up = await db.storage.from("sds").upload(path, file, { contentType: "application/pdf" });
  if (up.error) return speak(row, up.error.message, true);
  const { data, error } = await db.from("safety_data_sheets")
    .update({ file_path: path, file_size: file.size }).eq("id", sheet.id).select();
  if (error || !data || !data.length) {
    await db.storage.from("sds").remove([path]);
    return speak(row, error ? error.message : "Not saved — only an owner can replace sheets.", true);
  }
  await db.storage.from("sds").remove([sheet.file_path]);
  await loadSds();
  renderSdsAdmin();
});

$("admin").addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-act]");
  if (!button || !button.dataset.act.startsWith("sds-")) return;
  const act = button.dataset.act;

  if (act === "sds-unqueue") {
    sdsPending.splice(Number(button.closest("[data-sds-pending]").dataset.sdsPending), 1);
    return renderSdsPending();
  }
  if (act === "sds-clear") { sdsPending = []; return renderSdsPending(); }
  if (act === "sds-upload") return sdsUploadAll();

  const row = button.closest("[data-sds]");
  const sheet = sdsSheets.find(s => s.id === row.dataset.sds);

  if (act === "sds-open") return openSds(sheet);

  if (act === "sds-save") {
    const name = row.querySelector('[data-s="name"]').value.trim();
    const manufacturer = row.querySelector('[data-s="manufacturer"]').value.trim();
    if (!name) return speak(row, "It needs a name.", true);
    const clash = sdsExisting(name);
    if (clash && clash.id !== sheet.id) return speak(row, "Another sheet already has that name.", true);
    const { data, error } = await db.from("safety_data_sheets")
      .update({ name, manufacturer: manufacturer || null }).eq("id", sheet.id).select();
    if (error) return speak(row, error.message, true);
    if (!data || !data.length) return speak(row, "Nothing changed — only an owner can edit sheets.", true);
    await loadSds();
    renderSdsAdmin();
    return;
  }

  if (act === "sds-delete") {
    if (!confirm(`Delete the safety data sheet for "${sheet.name}"? It comes off every phone.`)) return;
    const { data, error } = await db.from("safety_data_sheets").delete().eq("id", sheet.id).select();
    if (error) return speak(row, error.message, true);
    if (!data || !data.length) return speak(row, "Nothing deleted — only an owner can delete sheets.", true);
    await db.storage.from("sds").remove([sheet.file_path]);
    await loadSds();
    renderSdsAdmin();
  }
});

// ---- in the Safety Center, for everyone -----------------------------------------

function sdsSectionHtml() {
  if (sdsError) return "";
  return `<div class="group-title">Safety Data Sheets</div>
    <div class="card">
      <div class="row" style="margin-bottom:12px">
        <input class="search" id="sdsViewSearch" placeholder="Search by product name…" value="${esc(sdsViewSearch)}">
        <span class="note" id="sdsViewCount"></span>
      </div>
      <div id="sdsViewList"></div>
    </div>`;
}

function renderSdsView() {
  const box = $("sdsViewList");
  if (!box) return;
  const q = sdsViewSearch.trim().toLowerCase();
  const shown = sdsSheets.filter(s => !q || `${s.name} ${s.manufacturer || ""}`.toLowerCase().includes(q));
  $("sdsViewCount").textContent = `${shown.length} of ${sdsSheets.length} sheets`;
  box.innerHTML = shown.length ? `<div style="overflow-x:auto"><table><tbody>${shown.map(s => `
    <tr><td><b>${esc(s.name)}</b>${s.manufacturer ? `<div class="note">${esc(s.manufacturer)}</div>` : ""}</td>
      <td style="text-align:right;white-space:nowrap"><button class="pdf" data-sds-open="${esc(s.id)}">Open PDF</button></td></tr>`)
    .join("")}</tbody></table></div>`
    : `<p class="note">${sdsSheets.length ? "No sheets match your search." : "No safety data sheets have been added yet."}</p>`;
}

$("view").addEventListener("input", (event) => {
  if (event.target.id !== "sdsViewSearch") return;
  sdsViewSearch = event.target.value;
  renderSdsView();
});
$("view").addEventListener("click", (event) => {
  const button = event.target.closest("[data-sds-open]");
  if (!button) return;
  const sheet = sdsSheets.find(s => s.id === button.dataset.sdsOpen);
  if (sheet) openSds(sheet);
});
