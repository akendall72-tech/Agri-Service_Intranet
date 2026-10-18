// Inspections
//
// The forms, their questions, filling one in (and its after-class part),
// the records, and the PDFs.

// ---------------------------------------------------------------- inspections
//
// Inspection forms are data (migration 0031): an owner changes the questions
// here and phones pick them up without a new build. Every inspection keeps a
// copy of the questions it was answered with, so editing or deleting one never
// changes what an old inspection says. Answers are keyed by question id.

let inspForms = [], inspections = [], inspError = null;
let inspFormId = null, inspFilter = "all";
const inspPhotoUrls = {};

const INSP_TYPES = [
  ["text", "Short text"], ["long_text", "Long text"], ["number", "Number"],
  ["date", "Date"], ["choice", "Choice (pick one)"], ["yes_no", "Yes / No"], ["photos", "Photos"]
];

const inspKey = (id) => String(id).toLowerCase();

function inspDisplay(value, type) {
  if (value === undefined || value === null || value === "") return "";
  if (Array.isArray(value)) return `${value.length} photo${value.length === 1 ? "" : "s"}`;
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (type === "date" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return dateOnly(value).toLocaleDateString("en-US",
    { month: "short", day: "numeric", year: "numeric" });
  if (typeof value === "number") return value.toLocaleString("en-US");
  return String(value);
}

// "Fendt · 724 Vario": the first two short answers, as the app titles them.
function inspTitle(record) {
  const parts = (record.fields_snapshot || [])
    .filter(f => f.type === "text" || f.type === "choice")
    .map(f => record.answers && record.answers[inspKey(f.id)])
    .filter(v => typeof v === "string" && v.trim())
    .slice(0, 2);
  return parts.length ? parts.join(" · ") : "Inspection";
}

function inspPhotoPaths(record) {
  const from = (snapshot, answers) => (snapshot || []).filter(f => f.type === "photos")
    .flatMap(f => (answers && Array.isArray(answers[inspKey(f.id)])) ? answers[inspKey(f.id)] : []);
  return [...from(record.fields_snapshot, record.answers), ...from(record.post_fields_snapshot, record.post_answers)];
}

const inspWhen = (iso) => iso ? new Date(iso).toLocaleString("en-US",
  { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }) : "";

// What the summary PDF reads off an inspection: the hours the class put on the
// machine, and its condition after class. The form is edited on this page, so
// the questions are found by name: hours is the number question with "hour" in
// its name, condition any question with "condition" in its name. The app's
// summary (Inspection.swift) uses the same rule, so both PDFs agree.
function inspSummary(record) {
  const key = (f) => inspKey(f.id);
  const questions = [...(record.fields_snapshot || [])];
  (record.post_fields_snapshot || []).forEach(f => {
    if (!questions.some(q => key(q) === key(f))) questions.push(f);
  });
  // A number, or one typed as text with a comma in it.
  const num = (v) => {
    if (typeof v === "number") return v;
    if (typeof v !== "string" || !v.trim()) return null;
    const n = Number(v.replace(/,/g, "").trim());
    return Number.isFinite(n) ? n : null;
  };
  const hoursQuestion = questions.find(f => f.type === "number" && /hour/i.test(f.label || "")) || null;
  const before = hoursQuestion ? num((record.answers || {})[key(hoursQuestion)]) : null;
  const after = hoursQuestion ? num((record.post_answers || {})[key(hoursQuestion)]) : null;
  return {
    questions, hoursQuestion, before, after,
    used: before !== null && after !== null ? after - before : null,
    conditions: questions.filter(f => /condition/i.test(f.label || "")
      && !["photos", "number", "date"].includes(f.type))
  };
}

const inspHours = (n) => n.toLocaleString("en-US", { maximumFractionDigits: 1 });
const inspHoursPhrase = (n) => `${inspHours(n)} ${n === 1 ? "hour" : "hours"}`;

async function loadInspections() {
  const [forms, records] = await Promise.all([
    db.from("inspection_forms").select("*, inspection_fields(*)").order("sort_order"),
    db.from("inspections").select("*").order("submitted_at", { ascending: false }).limit(500)
  ]);
  inspError = forms.error ? forms.error.message : records.error ? records.error.message : null;
  inspForms = (forms.data || []).map(f => ({
    ...f, inspection_fields: (f.inspection_fields || []).sort((a, b) => a.sort_order - b.sort_order)
  }));
  inspections = records.data || [];
  if (!inspForms.some(f => f.id === inspFormId)) inspFormId = inspForms.length ? inspForms[0].id : null;
}

// One part of an inspection — before or after class — read-only or editable.
function inspPartHtml(record, stage, editable) {
  const snapshot = stage === "before" ? record.fields_snapshot : record.post_fields_snapshot;
  const answers = (stage === "before" ? record.answers : record.post_answers) || {};
  const form = inspForms.find(f => f.id === record.form_id);
  if (!snapshot) return "";

  const rows = snapshot.map(field => {
    const id = inspKey(field.id);
    const value = answers[id];
    const name = `${stage}|${id}`;
    let cell;

    if (field.type === "photos") {
      const paths = Array.isArray(value) ? value : [];
      cell = paths.length ? `<div class="insp-photos">${paths.map(path => `
        <label class="insp-photo">
          <a data-photo-link="${esc(path)}" target="_blank" rel="noopener"><img data-photo="${esc(path)}" alt=""></a>
          ${editable ? `<span><input type="checkbox" data-keep="${esc(name)}" value="${esc(path)}" checked> Keep</span>` : ""}
        </label>`).join("")}</div>` : `<span class="note">No photos</span>`;
    } else if (!editable) {
      const shown = inspDisplay(value, field.type);
      cell = shown ? `<span style="white-space:pre-wrap">${esc(shown)}</span>` : `<span class="note">—</span>`;
    } else {
      const current = value === undefined || value === null ? "" : value;
      const attrs = `data-ans="${esc(name)}" data-type="${esc(field.type)}" style="margin:0"`;
      const live = form && (form.inspection_fields || []).find(q => inspKey(q.id) === id);
      if (field.type === "long_text") {
        cell = `<textarea rows="3" ${attrs}>${esc(current)}</textarea>`;
      } else if (field.type === "date") {
        cell = `<input type="date" value="${esc(current)}" ${attrs}>`;
      } else if (field.type === "yes_no") {
        cell = `<select ${attrs}><option value="">—</option>
          <option value="yes"${current === true ? " selected" : ""}>Yes</option>
          <option value="no"${current === false ? " selected" : ""}>No</option></select>`;
      } else if (field.type === "choice" && live && live.options && live.options.length) {
        const options = live.options.includes(current) || current === "" ? live.options : [...live.options, current];
        cell = `<select ${attrs}><option value="">—</option>${options.map(o =>
          `<option${o === current ? " selected" : ""}>${esc(o)}</option>`).join("")}</select>`;
      } else {
        cell = `<input type="text" value="${esc(current)}" ${attrs}>`;
      }
    }
    return `<tr><td style="width:34%"><b>${esc(field.label)}</b></td><td>${cell}</td></tr>`;
  }).join("");

  return `<table style="margin-bottom:10px"><tbody>${rows}</tbody></table>`;
}

function inspRecordHtml(record, editable) {
  const form = inspForms.find(f => f.id === record.form_id);
  const twoPart = form ? form.has_after_class : !!record.post_fields_snapshot;
  const done = !!record.post_submitted_at;
  const photos = inspPhotoPaths(record).length;
  const shop = locations[record.location_id] || "";
  const used = inspSummary(record).used;
  // The summary needs both parts; the full PDF works at any stage.
  const pdfButtons = `${done ? `<button class="pdf" data-insp-summary="${esc(record.id)}">Summary PDF</button>` : ""}
    <button class="pdf" data-insp-pdf="${esc(record.id)}">Full PDF, with photos</button>`;

  return `
    <details class="ticket" data-insp="${esc(record.id)}">
      <summary>
        <b>${esc(inspTitle(record))}</b>
        ${twoPart ? (done ? `<span class="badge b-closed">Complete</span>`
                          : `<span class="badge b-answered">After class to do</span>`) : ""}
        <div class="note">${esc([inspWhen(record.submitted_at), record.created_by_name, shop].filter(Boolean).join(" · "))}
          ${photos ? ` · ${photos} photo${photos === 1 ? "" : "s"}` : ""}
          ${record.edited_by_name ? ` · edited by ${esc(record.edited_by_name)}` : ""}</div>
      </summary>
      <div class="inner">
        <h2 style="margin:4px 0 8px">${twoPart ? "Before class" : "Answers"}</h2>
        ${inspPartHtml(record, "before", editable)}
        ${twoPart ? `<h2 style="margin:14px 0 4px">After class</h2>
          ${done ? `<p class="note" style="margin-top:0">${esc([inspWhen(record.post_submitted_at), record.post_by_name,
                   used !== null ? `${inspHoursPhrase(used)} used` : ""].filter(Boolean).join(" · "))}</p>
                   ${inspPartHtml(record, "after", editable)}`
                 : `<p class="note">Not done yet. ${esc(record.created_by_name || "Whoever started it")} finishes it here or in the app,
                     under "After class to do". Only the person who started an inspection can finish it.</p>`}` : ""}
        ${editable ? `<div class="row">
          <button data-act="insp-save">Save changes</button>
          ${pdfButtons}
          <button class="ghost" data-act="insp-delete" style="margin-left:auto">Delete inspection</button>
          <span class="msg"></span></div>`
          : `<div class="row">${pdfButtons}</div>`}
      </div>
    </details>`;
}

// Private photos need signed links, fetched when an inspection is opened.
async function inspLoadPhotos(scope) {
  const images = [...scope.querySelectorAll("img[data-photo]")].filter(img => !img.src);
  const missing = [...new Set(images.map(img => img.dataset.photo).filter(p => !inspPhotoUrls[p]))];
  if (missing.length) {
    const { data } = await db.storage.from("inspection-photos").createSignedUrls(missing, 3600);
    (data || []).forEach(d => { if (d.signedUrl) inspPhotoUrls[d.path] = d.signedUrl; });
  }
  images.forEach(img => {
    const url = inspPhotoUrls[img.dataset.photo];
    if (!url) return;
    img.src = url;
    const link = img.closest("a");
    if (link) link.href = url;
  });
}

document.addEventListener("toggle", (event) => {
  const box = event.target;
  if (box.matches && box.matches("details[data-insp]") && box.open) inspLoadPhotos(box);
}, true);

function renderInspectionsAdmin() {
  const box = $("inspAdmin");
  if (!box) return;

  if (inspError) {
    box.innerHTML = `<div class="card"><p class="error">${/does not exist|schema cache/i.test(inspError)
      ? "Run migration 0031_inspections.sql in the SQL editor, then reload this page."
      : esc(inspError)}</p></div>`;
    return;
  }

  const form = inspForms.find(f => f.id === inspFormId);
  const records = inspections.filter(r => r.form_id === inspFormId)
    .filter(r => inspFilter === "all" || (inspFilter === "todo") === !r.post_submitted_at);
  const todo = inspections.filter(r => r.form_id === inspFormId && !r.post_submitted_at).length;

  const questionRows = form ? (form.inspection_fields || []).map(q => `
    <div class="role" style="padding:14px 16px${q.is_active ? "" : ";opacity:.6"}" data-question="${esc(q.id)}">
      <div class="fields">
        <div class="wide"><label>Question</label>
          <input type="text" data-q="label" value="${esc(q.label)}"></div>
        <div><label>Answer type</label>
          <select data-q="field_type">${INSP_TYPES.map(([v, l]) =>
            `<option value="${v}"${q.field_type === v ? " selected" : ""}>${l}</option>`).join("")}</select></div>
        <div><label>Required</label>
          <select data-q="is_required">
            <option value="yes"${q.is_required ? " selected" : ""}>Yes</option>
            <option value="no"${q.is_required ? "" : " selected"}>No</option></select></div>
        ${form.has_after_class ? `<div><label>After class</label>
          <select data-q="after_class">
            <option value="ask"${q.after_class !== "carry" ? " selected" : ""}>Ask again</option>
            <option value="carry"${q.after_class === "carry" ? " selected" : ""}>Carry over the before-class answer</option></select></div>` : ""}
        <div><label>Order</label>
          <input type="text" data-q="sort_order" value="${esc(q.sort_order)}"></div>
        <div><label>Showing</label>
          <select data-q="is_active">
            <option value="yes"${q.is_active ? " selected" : ""}>Yes</option>
            <option value="no"${q.is_active ? "" : " selected"}>No</option></select></div>
        <div class="wide"><label>Hint under the question (optional)</label>
          <input type="text" data-q="help_text" value="${esc(q.help_text || "")}"></div>
        <div class="wide"${q.field_type === "choice" ? "" : " hidden"} data-q-options><label>Choices, one per line</label>
          <textarea rows="4" data-q="options">${esc((q.options || []).join("\n"))}</textarea></div>
      </div>
      <div class="row">
        <button data-act="insp-save-question">Save</button>
        <button class="ghost" data-act="insp-delete-question">Delete</button>
        <span class="msg"></span>
      </div>
    </div>`).join("") : "";

  box.innerHTML = `
    <div class="card">
      <h2>Inspection forms</h2>
      <div class="row" style="margin-bottom:14px">
        <select id="inspFormPick" style="max-width:320px;margin:0">
          ${inspForms.map(f => `<option value="${esc(f.id)}"${f.id === inspFormId ? " selected" : ""}>${esc(f.title)}${f.is_active ? "" : " (not showing)"}</option>`).join("")}
        </select>
        <input type="text" id="inspNewForm" placeholder="New form name" style="max-width:240px;margin:0">
        <button class="pdf" data-act="insp-add-form">Add form</button>
        <span class="msg"></span>
      </div>
      ${form ? `
      <div class="role" style="padding:16px" data-form="${esc(form.id)}">
        <div class="fields">
          <div class="wide"><label>Title</label>
            <input type="text" data-f="title" value="${esc(form.title)}"></div>
          <div class="wide"><label>Description</label>
            <input type="text" data-f="description" value="${esc(form.description || "")}"></div>
          <div><label>Parts</label>
            <select data-f="has_after_class">
              <option value="yes"${form.has_after_class ? " selected" : ""}>Before class and after class</option>
              <option value="no"${form.has_after_class ? "" : " selected"}>One part only</option></select></div>
          <div><label>Showing in the app</label>
            <select data-f="is_active">
              <option value="yes"${form.is_active ? " selected" : ""}>Yes</option>
              <option value="no"${form.is_active ? "" : " selected"}>No</option></select></div>
        </div>
        <div class="row">
          <button data-act="insp-save-form">Save form</button>
          <button class="ghost" data-act="insp-delete-form">Delete form</button>
          <span class="msg"></span>
        </div>
      </div>` : `<p class="note">No forms yet. Add one above.</p>`}
    </div>

    ${form ? `
    <div class="card">
      <h2>Questions</h2>
      <p class="note">Changes reach phones the next time someone opens the Inspection
        Center. Past inspections keep the questions they were answered with, so
        renaming, changing or deleting a question never alters an old record.
        <b>Showing: No</b> stops asking it and can be undone.</p>
      ${form.has_after_class ? `<p class="note"><b>After class</b>: "Ask again" repeats the
        question after class, showing the before-class answer beside it.
        "Carry over" copies the before-class answer, for things that don't change
        during a class, like the make and model. Photos are always taken again.</p>` : ""}
      ${questionRows || `<p class="note">No questions yet.</p>`}
      <div class="row" style="margin-top:10px">
        <button data-act="insp-add-question">Add a question</button>
        <span class="msg" id="inspQuestionMsg"></span>
      </div>
    </div>

    <div class="card">
      <h2>Submitted inspections</h2>
      <div class="chips">
        <button class="chip${inspFilter === "all" ? " on" : ""}" data-insp-filter="all">All</button>
        ${form.has_after_class ? `<button class="chip${inspFilter === "todo" ? " on" : ""}" data-insp-filter="todo">After class to do (${todo})</button>
        <button class="chip${inspFilter === "done" ? " on" : ""}" data-insp-filter="done">Complete</button>` : ""}
      </div>
      <p class="note">Open one to see it, correct an answer, or remove a photo.
        Photos can only be added from the app.</p>
      ${records.map(r => inspRecordHtml(r, true)).join("") || `<p class="note">None yet.</p>`}
    </div>` : ""}`;
}

$("admin").addEventListener("change", (event) => {
  if (event.target.id === "inspFormPick") {
    inspFormId = event.target.value;
    inspFilter = "all";
    return renderInspectionsAdmin();
  }
  if (event.target.matches('[data-q="field_type"]')) {
    const box = event.target.closest("[data-question]");
    box.querySelector("[data-q-options]").hidden = event.target.value !== "choice";
  }
});

$("admin").addEventListener("click", async (event) => {
  const filter = event.target.closest("[data-insp-filter]");
  if (filter) { inspFilter = filter.dataset.inspFilter; return renderInspectionsAdmin(); }

  const button = event.target.closest("button[data-act]");
  if (!button || !button.dataset.act.startsWith("insp-")) return;
  const act = button.dataset.act;
  const refusal = (error) => /row-level/i.test(error.message)
    ? (act.includes("question") || act.includes("form") ? "Only an owner can change the forms." : "Only an admin can change inspections.")
    : error.message;
  const redraw = async () => { await loadInspections(); renderInspectionsAdmin(); };

  // ---- forms
  if (act === "insp-add-form") {
    const row = button.closest(".row");
    const title = $("inspNewForm").value.trim();
    if (!title) return speak(row, "Type the form's name first.", true);
    const id = slugify(title, "_");
    if (!id) return speak(row, "That name needs some letters or numbers.", true);
    if (inspForms.some(f => f.id === id)) return speak(row, "There's already a form with that name.", true);
    const { data, error } = await db.from("inspection_forms").insert({
      id, title, has_after_class: false, is_active: false, sort_order: nextSortOrder(inspForms)
    }).select();
    if (error) return speak(row, refusal(error), true);
    if (!data || !data.length) return speak(row, "Nothing added — only an owner can add forms.", true);
    inspFormId = id;
    await redraw();
    return;
  }

  const formBox = button.closest("[data-form]");
  if (act === "insp-save-form") {
    const get = (f) => formBox.querySelector(`[data-f="${f}"]`).value.trim();
    if (!get("title")) return speak(formBox, "The form needs a title.", true);
    speak(formBox, "Saving…", false);
    const { data, error } = await db.from("inspection_forms").update({
      title: get("title"), description: get("description") || null,
      has_after_class: get("has_after_class") === "yes", is_active: get("is_active") === "yes"
    }).eq("id", formBox.dataset.form).select();
    if (error) return speak(formBox, refusal(error), true);
    if (!data || !data.length) return speak(formBox, "Nothing changed — only an owner can edit forms.", true);
    await redraw();
    return;
  }

  if (act === "insp-delete-form") {
    const id = formBox.dataset.form;
    const count = inspections.filter(r => r.form_id === id).length;
    if (count) {
      return speak(formBox, `${count} inspection${count === 1 ? " uses" : "s use"} this form, so it can't be deleted. Set Showing to No instead.`, true);
    }
    if (!confirm("Delete this form and all its questions?")) return;
    const { data, error } = await db.from("inspection_forms").delete().eq("id", id).select();
    if (error) return speak(formBox, refusal(error), true);
    if (!data || !data.length) return speak(formBox, "Nothing deleted — only an owner can delete forms.", true);
    inspFormId = null;
    await redraw();
    return;
  }

  // ---- questions
  if (act === "insp-add-question") {
    const form = inspForms.find(f => f.id === inspFormId);
    const { error } = await db.from("inspection_fields").insert({
      form_id: inspFormId, label: "New question", field_type: "text",
      is_active: false, sort_order: nextSortOrder(form.inspection_fields || [])
    });
    if (error) { $("inspQuestionMsg").textContent = refusal(error); $("inspQuestionMsg").className = "msg error"; return; }
    await redraw();
    $("inspQuestionMsg").textContent = "Added at the bottom, not showing yet. Fill it in, set Showing to Yes, and save.";
    $("inspQuestionMsg").className = "msg ok";
    return;
  }

  const questionBox = button.closest("[data-question]");
  if (act === "insp-save-question") {
    const get = (f) => { const el = questionBox.querySelector(`[data-q="${f}"]`); return el ? el.value.trim() : null; };
    if (!get("label")) return speak(questionBox, "The question needs some words.", true);
    const options = uniqueText(get("options").split("\n").map(o => o.trim()).filter(Boolean));
    if (get("field_type") === "choice" && options.length < 2) {
      return speak(questionBox, "A choice question needs at least two choices, one per line.", true);
    }
    const update = {
      label: get("label"), field_type: get("field_type"), options,
      help_text: get("help_text") || null, is_required: get("is_required") === "yes",
      sort_order: parseInt(get("sort_order"), 10) || 0, is_active: get("is_active") === "yes"
    };
    if (get("after_class") !== null) update.after_class = get("after_class");
    speak(questionBox, "Saving…", false);
    const { data, error } = await db.from("inspection_fields").update(update)
      .eq("id", questionBox.dataset.question).select();
    if (error) return speak(questionBox, refusal(error), true);
    if (!data || !data.length) return speak(questionBox, "Nothing changed — only an owner can edit questions.", true);
    await redraw();
    return;
  }

  if (act === "insp-delete-question") {
    if (!confirm("Delete this question? Past inspections keep their answers to it. " +
                 "Setting Showing to No instead can be undone.")) return;
    const { data, error } = await db.from("inspection_fields").delete()
      .eq("id", questionBox.dataset.question).select();
    if (error) return speak(questionBox, refusal(error), true);
    if (!data || !data.length) return speak(questionBox, "Nothing deleted — only an owner can delete questions.", true);
    await redraw();
    return;
  }

  // ---- submitted inspections
  const recordBox = button.closest("[data-insp]");
  if (!recordBox) return;
  const inner = recordBox.querySelector(".inner");
  const record = inspections.find(r => r.id === recordBox.dataset.insp);

  if (act === "insp-delete") {
    if (!confirm(`Delete this inspection of ${inspTitle(record)}, photos and all? This can't be undone.`)) return;
    const { data, error } = await db.from("inspections").delete().eq("id", record.id).select();
    if (error) return speak(inner, refusal(error), true);
    if (!data || !data.length) return speak(inner, "Nothing deleted — only an admin can delete inspections.", true);
    const paths = inspPhotoPaths(record);
    if (paths.length) await db.storage.from("inspection-photos").remove(paths);
    await redraw();
    return;
  }

  if (act === "insp-save") {
    const removed = [];
    const collect = (stage, snapshot, base) => {
      const out = { ...(base || {}) };
      inner.querySelectorAll(`[data-ans^="${stage}|"]`).forEach(el => {
        const id = el.dataset.ans.split("|")[1];
        const raw = el.value.trim();
        if (raw === "") { delete out[id]; return; }
        if (el.dataset.type === "number") {
          const n = Number(raw.replace(/,/g, ""));
          if (!Number.isFinite(n)) throw new Error(`"${raw}" isn't a number.`);
          out[id] = n;
        } else if (el.dataset.type === "yes_no") {
          out[id] = raw === "yes";
        } else {
          out[id] = raw;
        }
      });
      (snapshot || []).filter(f => f.type === "photos").forEach(f => {
        const id = inspKey(f.id);
        const before = Array.isArray(out[id]) ? out[id] : [];
        const kept = [...inner.querySelectorAll(`[data-keep="${stage}|${id}"]`)].filter(c => c.checked).map(c => c.value);
        before.filter(p => !kept.includes(p)).forEach(p => removed.push(p));
        out[id] = kept;
      });
      return out;
    };

    let update;
    try {
      update = { answers: collect("before", record.fields_snapshot, record.answers) };
      if (record.post_fields_snapshot) {
        update.post_answers = collect("after", record.post_fields_snapshot, record.post_answers);
      }
    } catch (e) {
      return speak(inner, e.message, true);
    }

    speak(inner, "Saving…", false);
    const { data, error } = await db.from("inspections").update(update).eq("id", record.id).select();
    if (error) return speak(inner, refusal(error), true);
    if (!data || !data.length) return speak(inner, "Nothing changed — only an admin can edit inspections.", true);
    if (removed.length) await db.storage.from("inspection-photos").remove(removed);
    await redraw();
    const again = document.querySelector(`#inspAdmin details[data-insp="${CSS.escape(record.id)}"]`);
    if (again) { again.open = true; speak(again.querySelector(".inner"), "Saved.", false); }
  }
});

// ---- the Inspection Center, for everyone ----------------------------------

function inspectionView() {
  const head = hero("Inspection Center",
    "Walk-arounds, equipment checks and the records that go with them.", true);
  if (inspError) return head + `<div class="card"><p class="error">Inspections couldn't be loaded.</p></div>`;
  const forms = inspForms.filter(f => f.is_active);
  if (!forms.length) return head + comingSoon("No inspections have been set up yet.");

  const notice = inspNotice
    ? `<div class="card insp-notice"><p class="ok" style="margin:0">${esc(inspNotice)}</p></div>` : "";
  inspNotice = "";
  return head + notice + forms.map(form => {
    const records = inspections.filter(r => r.form_id === form.id);
    // Only whoever started an inspection can finish it (0065), so only theirs.
    const toDo = form.has_after_class
      ? records.filter(r => r.created_by === me.id && !r.post_submitted_at) : [];
    const draftHere = inspDraft && inspDraft.formId === form.id;
    return `
      <div class="group-title">${esc(form.title)}</div>
      ${form.description ? `<p class="note" style="margin:0 4px 10px">${esc(form.description)}</p>` : ""}
      <div class="row insp-start">
        <button type="button" data-insp-start="${esc(form.id)}">${form.has_after_class
          ? "Start a before-class inspection" : "Start an inspection"}</button>
        ${draftHere ? `<button type="button" class="ghost" data-view="inspform">Carry on with the one you started</button>` : ""}
      </div>
      ${toDo.length ? `<p class="insp-sub">After class to do</p>
        <div class="link-grid">${toDo.map(r => `
          <button type="button" class="link-card" data-insp-after="${esc(r.id)}" style="width:100%;text-align:left;${lit("deep")}">
            <span class="well">${icon("inspection")}</span>
            <span><b>${esc(inspTitle(r))}</b>
              <span>${esc(["Before class", inspWhen(r.submitted_at)].filter(Boolean).join(" · "))}</span>
              <span class="go">Finish after class &rarr;</span></span>
          </button>`).join("")}</div>` : ""}
      <p class="insp-sub">Recent inspections</p>
      ${records.map(r => inspRecordHtml(r, false)).join("") || `<p class="note" style="margin-left:4px">None yet.</p>`}`;
  }).join("");
}

// ---- filling one in --------------------------------------------------------------
//
// The same inspection as the app's InspectionFormView, from the same form
// definition, saved the same way: photos to inspection-photos under
// <you>/<inspection>/<photo>.jpg, then the row (before class, or the only
// part), or complete_inspection() for the after-class part, which checks it's
// yours to finish (0065). An inspection started here can be finished in the
// app, and the other way round.
//
// What's filled in is kept in inspDraft until it's sent or cancelled, so going
// to another page and coming back finds it as it was.

let inspDraft = null;
let inspNotice = "";

const inspActiveFields = (form) => (form.inspection_fields || []).filter(f => f.is_active);
// Asked once, before class, and shown after class as it was: as InspectionField.carriesOver.
const inspCarries = (f) => f.after_class === "carry" && f.field_type !== "photos";

function inspNumber(value) {
  const text = String(value ?? "").replace(/,/g, "").trim();
  return text !== "" && isFinite(Number(text)) ? Number(text) : null;
}

function inspAnswered(field, draft) {
  const v = draft.values[inspKey(field.id)];
  switch (field.field_type) {
    case "number": return inspNumber(v) !== null;
    case "date": return !!v;
    case "yes_no": return typeof v === "boolean";
    case "photos": return (draft.photos[inspKey(field.id)] || []).length > 0;
    default: return !!String(v ?? "").trim();
  }
}

function inspStartDraft(form, stage, recordId) {
  const values = {};
  // A date starts as today, as in the app.
  inspActiveFields(form).filter(f => f.field_type === "date").forEach(f => { values[inspKey(f.id)] = todayISO(); });
  inspDraft = { formId: form.id, stage, recordId: recordId || null, values, photos: {}, showMissing: false };
}

function inspDiscardDraft() {
  if (!inspDraft) return;
  Object.values(inspDraft.photos).flat().forEach(p => URL.revokeObjectURL(p.url));
  inspDraft = null;
}

function inspDraftParts() {
  const form = inspForms.find(f => f.id === inspDraft.formId);
  const record = inspDraft.recordId ? inspections.find(r => r.id === inspDraft.recordId) : null;
  const fields = form ? inspActiveFields(form) : [];
  const after = inspDraft.stage === "after";
  return { form, record, fields,
           asked: after ? fields.filter(f => !inspCarries(f)) : fields,
           carried: after ? fields.filter(inspCarries) : [] };
}

function inspFieldHtml(field, record) {
  const key = inspKey(field.id);
  const v = inspDraft.values[key];
  const flagged = inspDraft.showMissing && field.is_required && !inspAnswered(field, inspDraft);
  const earlier = inspDraft.stage === "after" && record && field.field_type !== "photos"
    ? inspDisplay((record.answers || {})[key], field.field_type) : "";
  const chip = (label, on, attrs) =>
    `<button type="button" class="chip${on ? " on" : ""}" ${attrs}>${on ? "✓ " : ""}${esc(label)}</button>`;

  let input;
  switch (field.field_type) {
    case "long_text":
      input = `<textarea rows="3" data-insp-field="${key}" id="insp-in-${key}">${esc(v || "")}</textarea>`; break;
    case "number":
      input = `<input type="text" inputmode="decimal" placeholder="0" data-insp-field="${key}" id="insp-in-${key}" value="${esc(v ?? "")}">`; break;
    case "date":
      input = `<input type="date" data-insp-field="${key}" id="insp-in-${key}" value="${esc(v || "")}">`; break;
    case "choice":
      input = `<div class="chips">${(field.options || []).map(o =>
        chip(o, v === o, `data-insp-choice="${key}" data-value="${esc(o)}"`)).join("")}</div>`; break;
    case "yes_no":
      input = `<div class="chips">${chip("Yes", v === true, `data-insp-yesno="${key}" data-value="true"`)}${
        chip("No", v === false, `data-insp-yesno="${key}" data-value="false"`)}</div>`; break;
    case "photos": {
      const list = inspDraft.photos[key] || [];
      input = `${list.length ? `<div class="insp-thumbs">${list.map(p => `<span class="insp-thumb">
          <img src="${esc(p.url)}" alt="">
          <button type="button" data-insp-unphoto="${key}" data-photo-id="${esc(p.id)}" aria-label="Remove photo">×</button>
        </span>`).join("")}</div>` : ""}
        <label class="pdf insp-add-photo" for="insp-in-${key}">${icon("inspection", 15)} ${list.length ? "Add more photos" : "Add photos"}</label>
        <input type="file" id="insp-in-${key}" accept="image/*" multiple data-insp-photos="${key}" class="hidden">`;
      break;
    }
    default:
      // Autocorrect turns "Fendt" into "Fender".
      input = `<input type="text" autocomplete="off" autocorrect="off" spellcheck="false" data-insp-field="${key}" id="insp-in-${key}" value="${esc(v || "")}">`;
  }

  return `<div class="card insp-field${flagged ? " missing" : ""}" id="insp-card-${key}">
    <label class="insp-label" for="insp-in-${key}">${esc(field.label)}${field.is_required ? `<span class="req">*</span>` : ""}</label>
    ${field.help_text ? `<p class="note insp-help">${esc(field.help_text)}</p>` : ""}
    ${earlier ? `<p class="insp-earlier">Before class: ${esc(earlier)}</p>` : ""}
    ${input}
  </div>`;
}

function inspFormView() {
  if (!inspDraft) {
    return hero("Inspection") + `<div class="card"><p class="note" style="margin:0">Nothing's being filled in.
      Start one from the <button type="button" class="linkish" data-view="inspection">Inspection Center</button>.</p></div>`;
  }
  const { form, record, asked, carried } = inspDraftParts();
  if (!form || (inspDraft.stage === "after" && !record)) {
    inspDiscardDraft();
    return hero("Inspection") + `<div class="card"><p class="note" style="margin:0">That inspection isn't available any more.</p></div>`;
  }
  const twoPart = form.has_after_class;
  const before = inspDraft.stage === "before";
  const missing = inspDraft.showMissing ? asked.filter(f => f.is_required && !inspAnswered(f, inspDraft)) : [];

  return hero(form.title, twoPart ? (before ? "Before class" : "After class") : "New inspection")
    + `<div class="insp-form">
      ${twoPart ? `<div class="card insp-stage">
          <b>${before ? "Part 1 of 2 · Before class" : "Part 2 of 2 · After class"}</b>
          <p>${before
            ? "Save this before the class starts. The after-class part will be waiting under “After class to do”, here or in the app."
            : `${esc(inspTitle(record))}: answer the same questions now the class is over.`}</p></div>`
        : form.description ? `<p class="note">${esc(form.description)}</p>` : ""}
      ${carried.length ? `<div class="card insp-carried">${carried.map(f => `<div class="insp-carried-row">
          <span>${esc(f.label)}</span><b>${esc(inspDisplay((record.answers || {})[inspKey(f.id)], f.field_type) || "—")}</b></div>`).join("")}
          <p class="note" style="margin:6px 0 0">Carried over from before class.</p></div>` : ""}
      ${asked.map(f => inspFieldHtml(f, record)).join("")}
      <p class="error" id="inspMissing">${missing.length ? `Still needed: ${esc(missing.map(f => f.label).join(", "))}.` : ""}</p>
      <div class="row insp-actions">
        <button type="button" data-insp-submit>${!twoPart ? "Submit inspection"
          : before ? "Save before-class inspection" : "Finish after-class inspection"}</button>
        <button type="button" class="ghost" data-insp-cancel>Cancel</button>
        <span class="msg" id="inspFormMsg"></span>
      </div>
    </div>`;
}

// One question's card drawn again, after a pick or a photo, without redrawing
// the rest of the page and losing what's being typed.
function inspRedrawField(key) {
  const { record, asked } = inspDraftParts();
  const field = asked.find(f => inspKey(f.id) === key);
  const card = $(`insp-card-${key}`);
  if (field && card) card.outerHTML = inspFieldHtml(field, record);
}

// A phone photo is several megabytes; 1600 pixels on the long side, as the
// app sends, is plenty to see a scratch.
async function inspShrink(file) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return await new Promise((resolve, reject) =>
    canvas.toBlob(b => b ? resolve(b) : reject(new Error("unreadable")), "image/jpeg", 0.8));
}

async function inspSubmit(button) {
  const { form, record, fields, asked, carried } = inspDraftParts();
  inspDraft.showMissing = true;
  const missing = asked.filter(f => f.is_required && !inspAnswered(f, inspDraft));
  if (missing.length) {
    missing.forEach(f => inspRedrawField(inspKey(f.id)));
    $("inspMissing").textContent = `Still needed: ${missing.map(f => f.label).join(", ")}.`;
    const first = $(`insp-card-${inspKey(missing[0].id)}`);
    if (first) first.scrollIntoView({ behavior: "smooth", block: "center" });
    return;
  }
  $("inspMissing").textContent = "";

  const msg = $("inspFormMsg");
  button.disabled = true;
  msg.className = "msg";
  msg.textContent = "Sending…";

  const before = inspDraft.stage === "before";
  const id = inspDraft.recordId || crypto.randomUUID();
  const folder = `${me.id}/${id}`;
  const answers = {};
  // Carried answers go into the after-class part too, so it reads complete on its own.
  carried.forEach(f => {
    const k = inspKey(f.id);
    if (record && record.answers && record.answers[k] !== undefined) answers[k] = record.answers[k];
  });

  try {
    for (const f of asked) {
      const k = inspKey(f.id);
      const v = inspDraft.values[k];
      if (["text", "long_text", "choice"].includes(f.field_type)) {
        if (String(v ?? "").trim()) answers[k] = String(v).trim();
      } else if (f.field_type === "number") {
        if (inspNumber(v) !== null) answers[k] = inspNumber(v);
      } else if (f.field_type === "date") {
        if (v) answers[k] = v;
      } else if (f.field_type === "yes_no") {
        if (typeof v === "boolean") answers[k] = v;
      } else if (f.field_type === "photos") {
        const paths = [];
        for (const photo of inspDraft.photos[k] || []) {
          const path = `${folder}/${photo.id}.jpg`;
          const { error } = await db.storage.from("inspection-photos")
            .upload(path, photo.blob, { contentType: "image/jpeg", upsert: true });
          if (error) throw new Error(`A photo didn't upload: ${error.message}`);
          paths.push(path);
        }
        if (paths.length) answers[k] = paths;
      }
    }

    const snapshot = fields.map(f => ({ id: f.id, label: f.label, type: f.field_type }));
    const { error } = before
      ? await db.from("inspections").insert({ id, form_id: form.id, answers, fields_snapshot: snapshot })
      : await db.rpc("complete_inspection", { target: id, after_answers: answers, after_snapshot: snapshot });
    if (error) throw new Error(error.message);
  } catch (e) {
    button.disabled = false;
    msg.className = "msg error";
    msg.textContent = `It wasn't saved. ${e.message}`;
    return;
  }

  inspDiscardDraft();
  await loadInspections();
  inspNotice = !form.has_after_class ? "Inspection submitted."
    : before ? "Before-class inspection saved. After class, finish it under “After class to do”, here or in the app."
    : "After-class inspection saved. The inspection is complete.";
  showView("inspection");
}

document.addEventListener("click", (event) => {
  const start = event.target.closest("[data-insp-start]");
  if (start) {
    const form = inspForms.find(f => f.id === start.dataset.inspStart);
    if (!form) return;
    if (inspDraft && !confirm("Discard the inspection you started and begin a new one?")) return;
    inspDiscardDraft();
    inspStartDraft(form, "before");
    return showView("inspform");
  }
  const after = event.target.closest("[data-insp-after]");
  if (after) {
    const record = inspections.find(r => r.id === after.dataset.inspAfter);
    const form = record && inspForms.find(f => f.id === record.form_id);
    if (!form) return;
    const same = inspDraft && inspDraft.recordId === record.id;
    if (!same && inspDraft && !confirm("Discard the inspection you started and finish this one instead?")) return;
    if (!same) { inspDiscardDraft(); inspStartDraft(form, "after", record.id); }
    return showView("inspform");
  }
  if (!inspDraft) return;
  const choice = event.target.closest("[data-insp-choice]");
  if (choice) {
    const key = choice.dataset.inspChoice;
    inspDraft.values[key] = inspDraft.values[key] === choice.dataset.value ? undefined : choice.dataset.value;
    return inspRedrawField(key);
  }
  const yesNo = event.target.closest("[data-insp-yesno]");
  if (yesNo) {
    const key = yesNo.dataset.inspYesno, value = yesNo.dataset.value === "true";
    inspDraft.values[key] = inspDraft.values[key] === value ? undefined : value;
    return inspRedrawField(key);
  }
  const unphoto = event.target.closest("[data-insp-unphoto]");
  if (unphoto) {
    const key = unphoto.dataset.inspUnphoto;
    const list = inspDraft.photos[key] || [];
    const gone = list.find(p => p.id === unphoto.dataset.photoId);
    if (gone) URL.revokeObjectURL(gone.url);
    inspDraft.photos[key] = list.filter(p => p !== gone);
    return inspRedrawField(key);
  }
  const submit = event.target.closest("[data-insp-submit]");
  if (submit) return inspSubmit(submit);
  if (event.target.closest("[data-insp-cancel]")) {
    if (!confirm("Discard this inspection? Nothing has been saved.")) return;
    inspDiscardDraft();
    return showView("inspection");
  }
});

// Typing is kept as it happens; nothing is redrawn, so the cursor stays put.
document.addEventListener("input", (event) => {
  const key = event.target.dataset && event.target.dataset.inspField;
  if (key && inspDraft) inspDraft.values[key] = event.target.value;
});

document.addEventListener("change", async (event) => {
  const key = event.target.dataset && event.target.dataset.inspPhotos;
  if (!key || !inspDraft) return;
  const files = [...event.target.files];
  event.target.value = "";
  const unread = [];
  for (const file of files) {
    try {
      const blob = await inspShrink(file);
      (inspDraft.photos[key] ||= []).push({ id: crypto.randomUUID(), blob, url: URL.createObjectURL(blob) });
    } catch { unread.push(file.name); }
  }
  inspRedrawField(key);
  if (unread.length) alert(`These couldn't be read as photos here: ${unread.join(", ")}. A JPEG or PNG works in any browser.`);
});

// ---- inspection PDF -----------------------------------------------------------
//
// The same layout as the app's export: before and after class side by side with
// a changed condition in red, then the photos from each part.

const pdfSafe = (s) => String(s ?? "").replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
  .replace(/[–—]/g, "-").replace(/…/g, "...").replace(/→/g, "->");

async function inspPhotoData(path) {
  return storagePhotoData("inspection-photos", path, inspPhotoUrls);
}

// A stored photo shrunk to 1200 pixels, as a JPEG data URL a PDF can take.
// `urls` remembers signed links so the same photo isn't signed twice.
async function storagePhotoData(bucket, path, urls = {}) {
  if (!urls[path]) {
    const { data } = await db.storage.from(bucket).createSignedUrl(path, 3600);
    if (data && data.signedUrl) urls[path] = data.signedUrl;
  }
  if (!urls[path]) return null;
  try {
    const blob = await (await fetch(urls[path])).blob();
    const bitmap = await createImageBitmap(blob);
    const scale = Math.min(1, 1200 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return { url: canvas.toDataURL("image/jpeg", 0.8), width: canvas.width, height: canvas.height };
  } catch {
    return null;
  }
}

async function downloadInspectionPDF(record, button) {
  const original = button ? button.textContent : "";
  if (button) { button.disabled = true; button.textContent = "Preparing…"; }

  try {
    const form = inspForms.find(f => f.id === record.form_id);
    const twoPart = (form && form.has_after_class) || !!record.post_fields_snapshot;
    const done = !!record.post_submitted_at;
    const key = (f) => inspKey(f.id);

    const questions = [...(record.fields_snapshot || [])];
    (record.post_fields_snapshot || []).forEach(f => {
      if (!questions.some(q => key(q) === key(f))) questions.push(f);
    });

    const photoPaths = (snapshot, answers) => (snapshot || []).filter(f => f.type === "photos")
      .flatMap(f => (answers && Array.isArray(answers[key(f)])) ? answers[key(f)] : []);
    const load = async (paths) => (await Promise.all(paths.map(inspPhotoData))).filter(Boolean);
    const beforePhotos = await load(photoPaths(record.fields_snapshot, record.answers));
    const afterPhotos = await load(photoPaths(record.post_fields_snapshot, record.post_answers));

    const PAGE_W = 612, PAGE_H = 792, MARGIN = 44, WIDTH = PAGE_W - MARGIN * 2;
    const doc = new jspdf.jsPDF({ unit: "pt", format: "letter" });
    let y = MARGIN;
    const ensure = (needed) => { if (y + needed > PAGE_H - MARGIN - 20) { doc.addPage(); y = MARGIN; } };
    const write = (str, x, top, { size = 10.5, style = "normal", color = [0, 0, 0], width } = {}) => {
      doc.setFont("helvetica", style); doc.setFontSize(size); doc.setTextColor(...color);
      const lines = width ? doc.splitTextToSize(pdfSafe(str), width) : [pdfSafe(str)];
      doc.text(lines, x, top + size * 0.85);
      return lines.length * size * 1.25;
    };
    const measure = (str, width, size = 10.5, style = "normal") => {
      doc.setFont("helvetica", style); doc.setFontSize(size);
      return doc.splitTextToSize(pdfSafe(str), width).length * size * 1.25;
    };
    const when = (iso) => iso ? new Date(iso).toLocaleString("en-US",
      { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }) : "";

    // Title band
    doc.setFillColor(204, 0, 51); doc.rect(MARGIN, y, WIDTH, 24, "F");
    write(((form && form.title) || "Inspection").toUpperCase(), MARGIN + 6, y + 5, { size: 14, style: "bold", color: [255, 255, 255] });
    y += 30;
    y += write(inspTitle(record), MARGIN, y, { size: 15, style: "bold", width: WIDTH }) + 2;
    const caption = (s) => { if (!s) return; ensure(14); write(s, MARGIN, y, { size: 9, color: [90, 90, 90] }); y += 13; };
    caption([locations[record.location_id], record.created_by_name && `Started by ${record.created_by_name}`]
      .filter(Boolean).join("    ·    "));
    if (twoPart) {
      caption(`Before class: ${when(record.submitted_at)}${record.created_by_name ? " by " + record.created_by_name : ""}`);
      caption(done ? `After class: ${when(record.post_submitted_at)}${record.post_by_name ? " by " + record.post_by_name : ""}`
                   : "After class: not done yet");
    } else {
      caption(`Submitted: ${when(record.submitted_at)}`);
    }
    if (record.edited_by_name) caption(`Corrected on the admin page by ${record.edited_by_name}`);

    const section = (title) => {
      ensure(40); y += 8;
      doc.setFillColor(237, 237, 237); doc.rect(MARGIN, y, WIDTH, 16, "F");
      write(title.toUpperCase(), MARGIN + 5, y + 3, { size: 10.5, style: "bold" });
      y += 21;
    };

    section("Answers");
    const cols = twoPart ? [150, (WIDTH - 150) / 2, (WIDTH - 150) / 2] : [150, WIDTH - 150];
    ensure(14);
    (twoPart ? ["QUESTION", "BEFORE CLASS", "AFTER CLASS"] : ["QUESTION", "ANSWER"]).reduce((x, t, i) => {
      write(t, x, y, { size: 7.5, style: "bold", color: [130, 130, 130] }); return x + cols[i];
    }, MARGIN);
    y += 12;

    questions.forEach(field => {
      const before = inspDisplay((record.answers || {})[key(field)], field.type) || "-";
      const afterRaw = done ? inspDisplay((record.post_answers || {})[key(field)], field.type) : "";
      const cells = twoPart ? [field.label, before, afterRaw || "-"] : [field.label, before];
      const height = Math.max(13, ...cells.map((c, i) => measure(c, cols[i] - 8, i === 0 ? 9.5 : 10.5, i === 0 ? "bold" : "normal")));
      ensure(height + 8);
      doc.setDrawColor(225, 225, 225); doc.line(MARGIN, y, MARGIN + WIDTH, y);
      y += 4;
      const highlight = twoPart && done && !["date", "number", "photos"].includes(field.type)
        && afterRaw && afterRaw !== before;
      let x = MARGIN;
      cells.forEach((c, i) => {
        write(c, x, y, { size: i === 0 ? 9.5 : 10.5, style: i === 0 ? "bold" : "normal", width: cols[i] - 8,
          color: i === 0 ? [80, 80, 80] : (i === 2 && highlight ? [204, 0, 51] : [0, 0, 0]) });
        x += cols[i];
      });
      y += height + 4;
    });

    const grid = (photos) => {
      const per = 3, gap = 10, cw = (WIDTH - gap * (per - 1)) / per, ch = cw * 0.75;
      photos.forEach((p, i) => {
        const col = i % per;
        if (col === 0) { if (i > 0) y += ch + gap; ensure(ch + 4); }
        const cx = MARGIN + col * (cw + gap);
        doc.setFillColor(242, 242, 242); doc.rect(cx, y, cw, ch, "F");
        const s = Math.min(cw / p.width, ch / p.height);
        const w = p.width * s, h = p.height * s;
        doc.addImage(p.url, "JPEG", cx + (cw - w) / 2, y + (ch - h) / 2, w, h);
      });
      if (photos.length) y += ch + gap;
    };
    const photoRowHeight = ((WIDTH - 20) / 3) * 0.75;
    if (beforePhotos.length) { ensure(photoRowHeight + 40); section(twoPart ? "Photos - Before Class" : "Photos"); grid(beforePhotos); }
    if (afterPhotos.length) { ensure(photoRowHeight + 40); section("Photos - After Class"); grid(afterPhotos); }

    write(`Generated from the Agri-Service web page · ${new Date().toLocaleDateString("en-US",
      { month: "short", day: "numeric", year: "numeric" })}`, MARGIN, PAGE_H - MARGIN, { size: 8, color: [130, 130, 130] });

    const date = (record.submitted_at || "").slice(0, 10);
    doc.save(pdfSafe(`${(form && form.title) || "Inspection"} ${inspTitle(record)} ${date}.pdf`)
      .replace(/[\\/:*?"<>|]/g, "-"));
  } finally {
    if (button) { button.disabled = false; button.textContent = original; }
  }
}

// One page: the hours used, and the condition after class beside what it was
// before, the same as the app's summary.
function downloadInspectionSummaryPDF(record) {
  const form = inspForms.find(f => f.id === record.form_id);
  const s = inspSummary(record);
  const key = (f) => inspKey(f.id);
  const RED = [204, 0, 51];

  const PAGE_W = 612, PAGE_H = 792, MARGIN = 44, WIDTH = PAGE_W - MARGIN * 2;
  const doc = new jspdf.jsPDF({ unit: "pt", format: "letter" });
  let y = MARGIN;
  const ensure = (needed) => { if (y + needed > PAGE_H - MARGIN - 20) { doc.addPage(); y = MARGIN; } };
  const write = (str, x, top, { size = 10.5, style = "normal", color = [0, 0, 0], width } = {}) => {
    doc.setFont("helvetica", style); doc.setFontSize(size); doc.setTextColor(...color);
    const lines = width ? doc.splitTextToSize(pdfSafe(str), width) : [pdfSafe(str)];
    doc.text(lines, x, top + size * 0.85);
    return lines.length * size * 1.25;
  };
  const measure = (str, width, size = 10.5, style = "normal") => {
    doc.setFont("helvetica", style); doc.setFontSize(size);
    return doc.splitTextToSize(pdfSafe(str), width).length * size * 1.25;
  };
  const caption = (str) => { if (!str) return; ensure(14); write(str, MARGIN, y, { size: 9, color: [90, 90, 90] }); y += 13; };
  const title = (form && form.title) || "Inspection";

  doc.setFillColor(...RED); doc.rect(MARGIN, y, WIDTH, 24, "F");
  write(`${title.toUpperCase()} · SUMMARY`, MARGIN + 6, y + 5, { size: 14, style: "bold", color: [255, 255, 255] });
  y += 30;
  y += write(inspTitle(record), MARGIN, y, { size: 15, style: "bold", width: WIDTH }) + 2;

  // "Class: Fendt Level 4", when the form asks which class.
  const classQuestion = s.questions.find(f => f.type === "text" && /class/i.test(f.label || ""));
  const classAnswer = classQuestion ? inspDisplay((record.answers || {})[key(classQuestion)], "text") : "";
  caption([classAnswer && `${classQuestion.label}: ${classAnswer}`, locations[record.location_id]]
    .filter(Boolean).join("    ·    "));
  caption(`Before class: ${inspWhen(record.submitted_at)}${record.created_by_name ? " by " + record.created_by_name : ""}`);
  caption(record.post_submitted_at
    ? `After class: ${inspWhen(record.post_submitted_at)}${record.post_by_name ? " by " + record.post_by_name : ""}`
    : "After class: not done yet");
  y += 10;

  // The hours box: the figure, and how it was worked out or why it's missing.
  let value = "Not recorded", note, warn = false;
  if (!s.hoursQuestion) note = "This form has no hours question.";
  else if (s.used !== null) {
    value = inspHoursPhrase(s.used);
    note = `${inspHours(s.before)} before class → ${inspHours(s.after)} after class`;
    if (s.used < 0) { warn = true; note += ". The after-class reading is lower: check the readings."; }
  }
  else if (s.before === null && s.after !== null) note = "No hours reading was taken before class.";
  else if (s.before !== null) note = "No hours reading was taken after class.";
  else note = "No hours readings were taken.";

  const noteHeight = measure(note, WIDTH - 28, 9);
  const boxHeight = 50 + noteHeight;
  doc.setFillColor(245, 245, 245); doc.rect(MARGIN, y, WIDTH, boxHeight, "F");
  doc.setFillColor(...RED); doc.rect(MARGIN, y, 4, boxHeight, "F");
  write("HOURS USED", MARGIN + 14, y + 8, { size: 7.5, style: "bold", color: [130, 130, 130] });
  write(value, MARGIN + 14, y + 17, { size: 24, style: "bold", color: warn ? RED : [0, 0, 0] });
  write(note, MARGIN + 14, y + 46, { size: 9, color: [90, 90, 90], width: WIDTH - 28 });
  y += boxHeight + 8;

  if (s.conditions.length) {
    ensure(40); y += 8;
    doc.setFillColor(237, 237, 237); doc.rect(MARGIN, y, WIDTH, 16, "F");
    write("CONDITION AFTER CLASS", MARGIN + 5, y + 3, { size: 10.5, style: "bold" });
    y += 21;
    const cols = [150, (WIDTH - 150) / 2, (WIDTH - 150) / 2];
    ["QUESTION", "BEFORE CLASS", "AFTER CLASS"].reduce((x, t, i) => {
      write(t, x, y, { size: 7.5, style: "bold", color: [130, 130, 130] }); return x + cols[i];
    }, MARGIN);
    y += 12;
    s.conditions.forEach(field => {
      const before = inspDisplay((record.answers || {})[key(field)], field.type) || "-";
      const after = inspDisplay((record.post_answers || {})[key(field)], field.type) || "-";
      const cells = [field.label, before, after];
      const height = Math.max(13, ...cells.map((c, i) => measure(c, cols[i] - 8, i === 0 ? 9.5 : 10.5, i === 0 ? "bold" : "normal")));
      ensure(height + 8);
      doc.setDrawColor(225, 225, 225); doc.line(MARGIN, y, MARGIN + WIDTH, y);
      y += 4;
      // A changed condition after class is in red, so it stands out.
      const changed = after !== "-" && after !== before;
      let x = MARGIN;
      cells.forEach((c, i) => {
        write(c, x, y, { size: i === 0 ? 9.5 : 10.5, style: i === 0 ? "bold" : "normal", width: cols[i] - 8,
          color: i === 0 ? [80, 80, 80] : (i === 2 && changed ? RED : [0, 0, 0]) });
        x += cols[i];
      });
      y += height + 4;
    });
  }

  write(`Generated from the Agri-Service web page · ${new Date().toLocaleDateString("en-US",
    { month: "short", day: "numeric", year: "numeric" })}`, MARGIN, PAGE_H - MARGIN, { size: 8, color: [130, 130, 130] });

  const date = (record.submitted_at || "").slice(0, 10);
  doc.save(pdfSafe(`${title} summary ${inspTitle(record)} ${date}.pdf`).replace(/[\\/:*?"<>|]/g, "-"));
}

document.addEventListener("click", (event) => {
  const button = event.target.closest("[data-insp-pdf], [data-insp-summary]");
  if (!button) return;
  event.preventDefault();
  if (button.dataset.inspSummary) {
    const record = inspections.find(r => r.id === button.dataset.inspSummary);
    if (record) downloadInspectionSummaryPDF(record);
    return;
  }
  const record = inspections.find(r => r.id === button.dataset.inspPdf);
  if (record) downloadInspectionPDF(record, button);
});
