// Online Courses
//
// Courses taken right on the page, and adding and updating them.

// ---- Online courses (migration 0091) -------------------------------------------------------
//
// SCORM 1.2 courses, taken in the app or here: Online Courses in the Training
// Center lists them with where each person stands, and opens course.html to
// play one. Training Managers add and update them on the Training dashboard
// by uploading the zip the authoring tool publishes: the page unzips it right
// here, reads the manifest for the title and the page it starts on, and puts
// every file in the private online-courses bucket under <course>/<version>/. A new
// upload is a new version; anyone partway through finishes the old one.

let ocCourses = [], ocVersions = [], ocAttempts = [], ocError = null, ocNotSetUp = false;
let ocBusy = null;               // { courseId, text } while an upload runs
// The free plan's limit on one file. A bigger one is refused before anything uploads.
const OC_FILE_LIMIT = 50 * 1024 * 1024;

async function loadOnlineCourses() {
  const [courses, versions, attempts] = await Promise.all([
    db.from("online_courses").select("*").order("sort_order").order("title"),
    db.from("online_course_versions").select("course_id, version, title, launch_path, mastery_score, total_bytes, uploaded_at, uploaded_by_name"),
    db.from("online_course_attempts").select("id, course_id, version, user_id, status, score_raw, score_max, started_at, updated_at, completed_at, total_seconds")
      .order("started_at", { ascending: false })
  ]);
  const err = courses.error || versions.error || attempts.error;
  if (err) {
    ocError = err.message || "unknown";
    ocNotSetUp = /does not exist|schema cache/i.test(ocError);
    return;
  }
  ocError = null; ocNotSetUp = false;
  ocCourses = courses.data || [];
  ocVersions = versions.data || [];
  ocAttempts = attempts.data || [];
}

const ocVersion = (c, v = c.current_version) => ocVersions.find(x => x.course_id === c.id && x.version === v);
const ocMine = (c) => ocAttempts.filter(a => a.course_id === c.id && a.user_id === me.id);
const ocBytes = (n) => n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
const ocLink = (c) => `course.html?c=${encodeURIComponent(c.id)}`;

// Where this person stands: passed (and when), partway, didn't pass, or not started.
function ocStanding(c) {
  const mine = ocMine(c);
  const done = mine.filter(a => a.completed_at).sort((a, b) => b.completed_at.localeCompare(a.completed_at))[0];
  const last = mine[0];
  if (last && !["passed", "completed", "failed"].includes(last.status) && last.status !== "not attempted") {
    return { kind: "going", label: `In progress · last opened ${newsDate(last.updated_at)}`, action: "Resume", done };
  }
  if (done) return { kind: "done", label: `${done.status === "completed" ? "Completed" : "Passed"} ${newsDate(done.completed_at)}${
    done.score_raw != null && done.score_max ? ` · ${Math.round(done.score_raw / done.score_max * 100)}%` : ""}`, action: "Take it again", done };
  if (last && last.status === "failed") return { kind: "failed", label: "Not passed yet · take it again", action: "Take it again" };
  if (last) return { kind: "going", label: "Started", action: "Resume" };
  return { kind: "new", label: "Not started", action: "Start" };
}

// ---- Online Courses, in the Training Center ------------------------------------------------

function onlineCoursesView() {
  setTimeout(async () => { await loadOnlineCourses(); const box = $("ocList"); if (box) box.innerHTML = ocListHtml(); });
  return hero("Online Courses", "Courses you take right here or in the app. Your place is saved as you go, so you can stop and pick up again on any device.")
    + `<div class="oc" id="ocList">${ocListHtml()}</div>`;
}

function ocListHtml() {
  if (ocNotSetUp) return `<div class="ev-card ev-note" style="${lit("teal")}"><b>Not switched on yet</b><p>Online courses open once the database is ready for them.</p></div>`;
  if (ocError) return `<div class="ev-card ev-note" style="${lit("red")}"><b>Couldn't load the courses</b><p>Try again in a minute.</p></div>`;
  const list = ocCourses.filter(c => c.is_published && c.current_version);
  if (!list.length) return `<div class="ev-card ev-note" style="${lit("teal")}"><b>No courses yet</b><p>New courses show up here as soon as they're added.</p></div>`;
  return list.map(c => {
    const s = ocStanding(c);
    return `<div class="cab-card oc-card${s.kind === "done" ? " done" : ""}" style="${lit(s.kind === "done" ? "green" : c.purpose === "forklift" ? "amber" : "teal")}">
      <div class="oc-main">
        ${c.purpose === "forklift" ? `<span class="cab-tag">Forklift certification</span>` : ""}
        <b>${esc(c.title)}</b>
        ${c.description ? `<p>${esc(c.description)}</p>` : ""}
        <span class="oc-state ${s.kind}">${esc(s.label)}</span>
      </div>
      <a class="oc-go" href="${ocLink(c)}">${esc(s.action)} &rarr;</a>
    </div>`;
  }).join("");
}

// ---- the Training dashboard: adding and updating courses -----------------------------------

function renderOltAdmin() {
  const host = $("oltAdmin");
  if (!host) return;
  if (ocNotSetUp || ocError) {
    host.innerHTML = `<div class="card"><p class="error">${ocNotSetUp
      ? "Run migration 0091_online_courses.sql in the SQL editor, then reload this page." : esc(ocError || "")}</p></div>`;
    return;
  }
  host.innerHTML = `<div class="card oc-admin">
      <h2>Add a course</h2>
      <p class="note">Upload the zip your authoring tool publishes for <b>SCORM 1.2</b> (Captivate: Publish → SCORM 1.2, zipped).
        The page reads the course's title and the page it starts on, and the course is added unpublished so you can open it
        and check it first. Each file in it can be up to 50 MB on the current Supabase plan; a bigger video needs a lower
        quality setting when it's published.</p>
      <div class="row">
        <input type="file" id="ocNewZip" accept=".zip,application/zip" style="max-width:420px;margin:0">
        <button type="button" data-oc-act="add">Upload the course</button>
      </div>
      <div class="oc-progress" id="ocProgress-new"${ocBusy && ocBusy.courseId === "new" ? "" : " hidden"}>${ocBusy && ocBusy.courseId === "new" ? esc(ocBusy.text) : ""}</div>
      <p class="msg" style="margin:8px 0 0"></p>
    </div>
    ${ocCourses.length && !ocCourses.some(c => c.purpose === "forklift" && c.is_published)
      ? `<div class="card" style="background:#FFF7E6"><b>No course is ticked as the forklift certification course</b>
          <p class="note" style="margin:6px 0 0">Until one is, published, nobody can be given a forklift driving test: passing that
          course is what puts someone on the list (migration 0092). Tick <b>The forklift certification course</b> on it below,
          then Save.</p></div>` : ""}
    ${ocCourses.length ? ocCourses.map(ocAdminCard).join("") : `<div class="card"><p class="note" style="margin:0">No courses yet.</p></div>`}`;
}

function ocAdminCard(c) {
  const v = ocVersion(c);
  const all = ocAttempts.filter(a => a.course_id === c.id);
  const people = (pred) => new Set(all.filter(pred).map(a => a.user_id)).size;
  const passed = people(a => a.completed_at);
  const going = people(a => !a.completed_at && !["failed", "not attempted"].includes(a.status));
  return `<div class="card oc-admin" data-oc-course="${esc(c.id)}">
    <div class="oc-admin-head">
      <div style="flex:1;min-width:240px">
        <label for="oc-title-${esc(c.id)}">Title</label>
        <input type="text" id="oc-title-${esc(c.id)}" data-oc-field="title" maxlength="160" value="${esc(c.title)}">
      </div>
      <div class="oc-admin-tags">
        ${c.is_published ? `<span class="badge b-current">Published</span>` : `<span class="badge b-none">Not published</span>`}
        ${c.purpose === "forklift" ? `<span class="badge b-expiring">Forklift course</span>` : ""}
      </div>
    </div>
    <label for="oc-desc-${esc(c.id)}">What it covers (optional)</label>
    <textarea id="oc-desc-${esc(c.id)}" data-oc-field="description" rows="2" maxlength="2000"
      placeholder="Shown under the title in Online Courses">${esc(c.description)}</textarea>
    <div class="row" style="gap:6px 22px">
      <label class="check"><input type="checkbox" data-oc-field="is_published"${c.is_published ? " checked" : ""}${c.current_version ? "" : " disabled"}> Published: people can see and take it</label>
      <label class="check"><input type="checkbox" data-oc-field="purpose"${c.purpose === "forklift" ? " checked" : ""}> The forklift certification course</label>
    </div>
    <p class="note oc-version">${v ? `Version ${v.version} · ${esc(v.title || "untitled package")} · starts at ${esc(v.launch_path)} · ${ocBytes(v.total_bytes)}${
        v.mastery_score != null ? ` · passing score ${esc(v.mastery_score)}` : ""} · uploaded ${newsDate(v.uploaded_at)}${v.uploaded_by_name ? ` by ${esc(v.uploaded_by_name)}` : ""}`
      : "Not uploaded yet."}<br>${passed} passed · ${going} in progress</p>
    ${ocOldVersions(c)}
    <div class="row">
      <button type="button" data-oc-act="save">Save</button>
      ${v ? `<a class="pdf" href="${ocLink(c)}" target="_blank" rel="noopener" style="text-decoration:none">Open it</a>` : ""}
      <label class="pdf oc-upload">Upload a new version<input type="file" accept=".zip,application/zip" data-oc-act="version" hidden></label>
      <button type="button" class="ghost danger" data-oc-act="delete" style="margin-left:auto">${icon("trash", 15)}Delete course</button>
    </div>
    <div class="oc-progress" id="ocProgress-${esc(c.id)}"${ocBusy && ocBusy.courseId === c.id ? "" : " hidden"}>${ocBusy && ocBusy.courseId === c.id ? esc(ocBusy.text) : ""}</div>
    <p class="msg" style="margin:8px 0 0"></p>
  </div>`;
}

// Each upload keeps its files, so anyone partway through a version can finish
// it. Once nobody is, an older version's files only take up room (the free
// plan has 1 GB), so they can be removed. The version's record, and everyone's
// results on it, stay.
const ocUnfinished = (c, version) => ocAttempts.filter(a => a.course_id === c.id && a.version === version
  && !a.completed_at && !["failed", "passed", "completed"].includes(a.status));
function ocOldVersions(c) {
  const old = ocVersions.filter(v => v.course_id === c.id && v.version !== c.current_version)
    .sort((a, b) => b.version - a.version);
  if (!old.length) return "";
  return `<div class="oc-old"><b>Earlier versions</b>${old.map(v => {
    const going = new Set(ocUnfinished(c, v.version).map(a => a.user_id)).size;
    const state = !v.total_bytes ? "files removed"
      : going ? `${going} ${going === 1 ? "person is" : "people are"} partway through it, so its files stay until they finish`
      : `${ocBytes(v.total_bytes)}, nobody partway through`;
    return `<div class="oc-old-row"><span>Version ${v.version} · uploaded ${newsDate(v.uploaded_at)} · ${state}</span>${
      v.total_bytes && !going ? `<button type="button" class="ghost" data-oc-act="removeold" data-oc-version="${v.version}">Remove its files</button>` : ""}</div>`;
  }).join("")}</div>`;
}

// Deleting a course takes its versions with it, and with them every attempt
// on it: people's places and passes. So the forklift course can't go while
// it's the forklift course, and a course anyone has taken asks for its title
// to be typed, with the count of what goes. The record comes out of the
// database first and the files after, so a file that won't go leaves only
// unused storage, never a course that can't open.
async function ocDeleteCourse(c, card, button) {
  if (c.purpose === "forklift") {
    return speak(card, "This is the forklift certification course, which decides who can be given a driving test. "
      + "Untick The forklift certification course and Save first.", true);
  }
  const attempts = ocAttempts.filter(a => a.course_id === c.id);
  const people = new Set(attempts.map(a => a.user_id)).size;
  const passed = new Set(attempts.filter(a => a.completed_at).map(a => a.user_id)).size;
  if (!people) {
    if (!confirm(`Delete "${c.title}"? It comes off Online Courses and its files are removed. This can't be undone.`)) return;
  } else {
    const typed = prompt(`${people} ${people === 1 ? "person has" : "people have"} taken "${c.title}"`
      + (passed ? `, and ${passed} passed it` : "") + `. Deleting the course deletes their results too, for good.\n\n`
      + `To delete it, type its title:`);
    if (typed === null) return;
    if (typed.trim().toLowerCase() !== c.title.trim().toLowerCase()) {
      return speak(card, "That didn't match the course's title, so nothing was deleted.", true);
    }
  }
  button.disabled = true;
  speak(card, "Deleting…", false);
  // Every version's files, read before the versions go with the course.
  const { data: versions, error: listError } = await db.from("online_course_versions").select("version, files").eq("course_id", c.id);
  if (listError) { button.disabled = false; return speak(card, listError.message, true); }
  const paths = (versions || []).flatMap(v => Object.keys(v.files || {}).map(f => `${c.id}/${v.version}/${f}`));
  const gone = await db.from("online_courses").delete().eq("id", c.id).select("id");
  if (gone.error || !(gone.data || []).length) {
    button.disabled = false;
    return speak(card, gone.error ? gone.error.message : "It wasn't deleted: only owners and the Training Manager can.", true);
  }
  let stuck = 0;
  for (let i = 0; i < paths.length; i += 100) {
    const removed = await db.storage.from("online-courses").remove(paths.slice(i, i + 100));
    if (removed.error) stuck += paths.slice(i, i + 100).length;
  }
  await loadOnlineCourses();
  renderOltAdmin();
  speak(document.querySelector("#oltAdmin .oc-admin"), stuck
    ? `"${c.title}" is deleted. ${stuck} of its files couldn't be removed; they take up room but nothing uses them.`
    : `"${c.title}" is deleted.`, !!stuck);
}

async function ocRemoveOld(c, version, card, button) {
  if (ocUnfinished(c, version).length) return speak(card, "Someone has started that version since. Its files stay until they finish.", true);
  if (!confirm(`Remove the files of version ${version} of "${c.title}"? Everyone's results on it stay; nobody can open that version again.`)) return;
  button.disabled = true;
  const { data: v, error } = await db.from("online_course_versions").select("files")
    .eq("course_id", c.id).eq("version", version).maybeSingle();
  if (error || !v) { button.disabled = false; return speak(card, error ? error.message : "That version couldn't be found.", true); }
  const paths = Object.keys(v.files || {}).map(f => `${c.id}/${version}/${f}`);
  for (let i = 0; i < paths.length; i += 100) {
    const gone = await db.storage.from("online-courses").remove(paths.slice(i, i + 100));
    if (gone.error) { button.disabled = false; return speak(card, `Some files couldn't be removed: ${gone.error.message}`, true); }
  }
  const marked = await db.from("online_course_versions").update({ files: {}, total_bytes: 0 })
    .eq("course_id", c.id).eq("version", version);
  if (marked.error) { button.disabled = false; return speak(card, marked.error.message, true); }
  await loadOnlineCourses();
  renderOltAdmin();
  const again = document.querySelector(`[data-oc-course="${CSS.escape(c.id)}"]`);
  if (again) speak(again, `Version ${version}'s files are removed.`, false);
}

$("admin").addEventListener("click", async (event) => {
  const b = event.target.closest("[data-oc-act]");
  if (!b || b.tagName === "INPUT") return;
  const card = b.closest(".card");
  if (b.dataset.ocAct === "delete") {
    const c = ocCourses.find(x => x.id === card.dataset.ocCourse);
    return ocDeleteCourse(c, card, b);
  }
  if (b.dataset.ocAct === "removeold") {
    const c = ocCourses.find(x => x.id === card.dataset.ocCourse);
    return ocRemoveOld(c, Number(b.dataset.ocVersion), card, b);
  }
  if (b.dataset.ocAct === "add") {
    const file = $("ocNewZip").files[0];
    if (!file) return speak(card, "Pick the course's zip file first.", true);
    return ocUpload(file, null, card, b);
  }
  if (b.dataset.ocAct === "save") {
    const id = card.dataset.ocCourse, c = ocCourses.find(x => x.id === id);
    const title = card.querySelector('[data-oc-field="title"]').value.trim();
    if (!title) return speak(card, "Give it a title.", true);
    const forklift = card.querySelector('[data-oc-field="purpose"]').checked;
    b.disabled = true;
    // Only one course is the forklift course.
    if (forklift && c.purpose !== "forklift") {
      const off = await db.from("online_courses").update({ purpose: null }).eq("purpose", "forklift").neq("id", id);
      if (off.error) { b.disabled = false; return speak(card, off.error.message, true); }
    }
    const { error } = await db.from("online_courses").update({ title,
      description: card.querySelector('[data-oc-field="description"]').value.trim(),
      is_published: card.querySelector('[data-oc-field="is_published"]').checked,
      purpose: forklift ? "forklift" : null }).eq("id", id);
    b.disabled = false;
    if (error) return speak(card, error.message, true);
    await loadOnlineCourses();
    renderOltAdmin();
    const again = document.querySelector(`[data-oc-course="${CSS.escape(id)}"]`);
    if (again) speak(again, "Saved.", false);
  }
});

$("admin").addEventListener("change", (event) => {
  const input = event.target.closest('input[data-oc-act="version"]');
  if (!input || !input.files[0]) return;
  const card = input.closest(".card");
  const c = ocCourses.find(x => x.id === card.dataset.ocCourse);
  ocUpload(input.files[0], c, card, null);
  input.value = "";
});

// ---- the upload -------------------------------------------------------------------------

async function ocUpload(file, course, card, button) {
  if (ocBusy) return speak(card, "Another upload is still going. Wait for it to finish.", true);
  const progress = card.querySelector(".oc-progress");
  const say = (text) => { ocBusy = { courseId: course ? course.id : "new", text }; progress.hidden = false; progress.textContent = text; };
  if (button) button.disabled = true;
  try {
    say("Reading the zip…");
    const zip = await ocReadZip(file);
    const pkg = await ocReadPackage(zip);
    const big = pkg.files.filter(f => f.size > OC_FILE_LIMIT);
    if (big.length) {
      throw new Error(`${big.map(f => `${f.path} (${ocBytes(f.size)})`).join(", ")} ${big.length === 1 ? "is" : "are"} over the 50 MB a file the ` +
        `current Supabase plan allows. Publish the course again with a lower video quality, then upload that.`);
    }
    const id = course ? course.id : crypto.randomUUID();
    const version = course ? Math.max(0, ...ocVersions.filter(v => v.course_id === id).map(v => v.version)) + 1 : 1;
    if (!course) {
      const made = await db.from("online_courses").insert({ id, title: pkg.title || file.name.replace(/\.zip$/i, ""), is_published: false });
      if (made.error) throw new Error(made.error.message);
    }
    // Every file, four at a time.
    const total = pkg.files.reduce((t, f) => t + f.size, 0);
    let sent = 0, sentBytes = 0, next = 0;
    const worker = async () => {
      while (next < pkg.files.length) {
        const f = pkg.files[next++];
        const blob = await f.read();
        let tries = 0, result;
        do {
          result = await db.storage.from("online-courses").upload(`${id}/${version}/${f.path}`, blob,
            { contentType: ocType(f.path), upsert: true, cacheControl: "31536000" });
        } while (result.error && ++tries < 3);
        if (result.error) throw new Error(`${f.path} didn't upload: ${result.error.message}`);
        sent++; sentBytes += f.size;
        say(`Uploading ${sent} of ${pkg.files.length} files · ${ocBytes(sentBytes)} of ${ocBytes(total)}…`);
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
    const saved = await db.from("online_course_versions").insert({ course_id: id, version, launch_path: pkg.launch, title: pkg.title,
      mastery_score: pkg.mastery, files: Object.fromEntries(pkg.files.map(f => [f.path, f.size])), total_bytes: total });
    if (saved.error) throw new Error(saved.error.message);
    const current = await db.from("online_courses").update({ current_version: version }).eq("id", id);
    if (current.error) throw new Error(current.error.message);
    ocBusy = null;
    await loadOnlineCourses();
    renderOltAdmin();
    const again = document.querySelector(`[data-oc-course="${CSS.escape(id)}"]`);
    if (again) speak(again, course ? `Version ${version} is up. Anyone partway through finishes the version they started.`
      : "Added, not published yet. Open it to check it, then tick Published and Save.", false);
  } catch (e) {
    ocBusy = null;
    progress.hidden = true;
    if (button) button.disabled = false;
    speak(card, e.message || String(e), true);
  }
}

// The zip, read here with the browser's own unzip (DecompressionStream).
async function ocReadZip(file) {
  const buf = new Uint8Array(await file.arrayBuffer());
  const view = new DataView(buf.buffer);
  let end = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) { end = i; break; }
  }
  if (end < 0) throw new Error("That isn't a zip file.");
  const count = view.getUint16(end + 10, true), offset = view.getUint32(end + 16, true);
  if (count === 0xffff || offset === 0xffffffff) throw new Error("That zip is too big to read here (over 4 GB).");
  const entries = [];
  let p = offset;
  const text = new TextDecoder();
  for (let n = 0; n < count; n++) {
    if (view.getUint32(p, true) !== 0x02014b50) throw new Error("That zip looks damaged.");
    const method = view.getUint16(p + 10, true), csize = view.getUint32(p + 20, true), size = view.getUint32(p + 24, true);
    const nameLen = view.getUint16(p + 28, true), extraLen = view.getUint16(p + 30, true), noteLen = view.getUint16(p + 32, true);
    const local = view.getUint32(p + 42, true);
    const name = text.decode(buf.subarray(p + 46, p + 46 + nameLen)).replace(/\\/g, "/");
    entries.push({ name, method, csize, size, local });
    p += 46 + nameLen + extraLen + noteLen;
  }
  return entries.map(e => ({ ...e, read: async () => {
    const start = e.local + 30 + view.getUint16(e.local + 26, true) + view.getUint16(e.local + 28, true);
    const raw = buf.subarray(start, start + e.csize);
    if (e.method === 0) return new Blob([raw]);
    if (e.method === 8) return await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream("deflate-raw"))).blob();
    throw new Error(`${e.name} is packed in a way this page can't read. Zip it again with the Mac's or Windows' own Compress.`);
  } }));
}

// The manifest: SCORM 1.2, its title, the page it starts on, the passing score.
async function ocReadPackage(entries) {
  const files = entries.filter(e => !e.name.endsWith("/") && !/(^|\/)(__MACOSX|\.DS_Store)/.test(e.name));
  const manifests = files.filter(e => /(^|\/)imsmanifest\.xml$/i.test(e.name)).sort((a, b) => a.name.length - b.name.length);
  if (!manifests.length) throw new Error("There's no imsmanifest.xml in that zip, so it isn't a SCORM package. Publish it as SCORM 1.2.");
  const base = manifests[0].name.slice(0, manifests[0].name.length - "imsmanifest.xml".length);
  const xml = new DOMParser().parseFromString(await (await manifests[0].read()).text(), "application/xml");
  if (xml.querySelector("parsererror")) throw new Error("The course's imsmanifest.xml couldn't be read.");
  const byLocal = (root, local) => [...root.getElementsByTagName("*")].filter(n => n.localName === local);
  const schema = (byLocal(xml, "schemaversion")[0] || {}).textContent || "";
  if (/2004|CAM/i.test(schema)) throw new Error("That's a SCORM 2004 course. Only SCORM 1.2 plays here for now: publish it as SCORM 1.2.");
  const attr = (node, local) => node && [...node.attributes].find(a => a.localName === local);
  const orgs = byLocal(xml, "organizations")[0];
  const org = orgs && (byLocal(orgs, "organization").find(o => o.getAttribute("identifier") === orgs.getAttribute("default"))
    || byLocal(orgs, "organization")[0]);
  const item = org && byLocal(org, "item").find(i => i.getAttribute("identifierref"));
  const resources = byLocal(xml, "resource");
  const resource = (item && resources.find(r => r.getAttribute("identifier") === item.getAttribute("identifierref")))
    || resources.find(r => /^sco$/i.test((attr(r, "scormtype") || {}).value || "")) || resources.find(r => r.getAttribute("href"));
  const launch = resource && resource.getAttribute("href");
  if (!launch) throw new Error("The manifest doesn't say which page the course starts on.");
  const title = (org && [...org.children].find(n => n.localName === "title") || {}).textContent || "";
  const masteryNode = item && byLocal(item, "masteryscore")[0];
  const mastery = masteryNode && masteryNode.textContent.trim() !== "" ? Number(masteryNode.textContent) : null;
  const inside = files.filter(e => e.name.startsWith(base)).map(e => ({ path: e.name.slice(base.length), size: e.size, read: e.read }));
  if (!inside.some(f => f.path === launch.split(/[?#]/)[0])) throw new Error(`The course starts at ${launch}, but that file isn't in the zip.`);
  return { title: title.trim(), launch: launch.split(/[?#]/)[0], mastery: Number.isFinite(mastery) ? mastery : null, files: inside };
}

const OC_TYPES = { html: "text/html", htm: "text/html", js: "text/javascript", css: "text/css", json: "application/json",
  xml: "application/xml", xsd: "application/xml", txt: "text/plain", svg: "image/svg+xml", png: "image/png", jpg: "image/jpeg",
  jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", ico: "image/x-icon", mp3: "audio/mpeg", m4a: "audio/mp4",
  wav: "audio/wav", mp4: "video/mp4", m4v: "video/mp4", webm: "video/webm", woff: "font/woff", woff2: "font/woff2",
  ttf: "font/ttf", otf: "font/otf", vtt: "text/vtt", pdf: "application/pdf" };
const ocType = (path) => OC_TYPES[((/\.([a-z0-9]+)$/i.exec(path) || [])[1] || "").toLowerCase()] || "application/octet-stream";
