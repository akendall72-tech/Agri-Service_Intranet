// Skills
//
// Competencies and sign-offs (migrations 0040, 0064), and the competency
// list owners edit.

// ---------------------------------------------------------------- skills
//
// The Skills program (migration 0040, renamed from Tech Levels in 0064). Two lists since
// 0096: the service technicians' and Parts, each with four levels. Someone on a list sees
// their own progress on it; an admin sees each list's people at their location and signs
// them off; an owner sees everyone and keeps both competency lists on the Training dashboard.
//
// The database decides who may see and sign off whom — these screens only
// decide what to show, and never offer a button the database would refuse.

let competencies = [], compSignoffs = [], levelsDone = [], techPeople = [], levelChanges = [];
let skillsError = null;
let skillsState = { personId: null, level: null, track: "service" };
const SKILL_LEVELS = [1, 2, 3, 4];
// The two lists: what each is called, and whether someone is on it.
const SKILL_TRACKS = [
  { id: "service", people: "Technicians", person: "technician", prefix: "", on: (p) => !!p.is_technician },
  { id: "parts", people: "Parts", person: "parts person", prefix: "Parts ", on: (p) => !!p.is_parts }
];
const skillTrack = (id) => SKILL_TRACKS.find(t => t.id === id) || SKILL_TRACKS[0];
const compTrack = (c) => c.track || "service";

async function loadSkills() {
  const [c, p, s, d, h] = await Promise.all([
    db.from("competencies").select("*").order("sort_order"),
    // Someone who has left drops off the lists; their sign-offs stay.
    db.from("profiles").select("id,full_name,location_id,is_technician,is_parts").is("deactivated_at", null),
    db.from("competency_signoffs").select("*"),
    db.from("skill_level_completions").select("*"),
    db.from("skill_level_changes").select("*").order("changed_at", { ascending: false })
  ]);
  const failed = [c, p, s, d, h].find(r => r.error);
  skillsError = failed ? failed.error.message : null;
  competencies = c.data || [];
  techPeople = p.data || [];
  compSignoffs = s.data || [];
  levelsDone = d.data || [];
  levelChanges = h.data || [];
}

// Where one person is on one list: the level they're on and what's signed off.
function techProgress(personId, track = "service") {
  const items = competencies.filter(c => c.is_active && compTrack(c) === track);
  const signed = new Map(compSignoffs.filter(x => x.technician_id === personId).map(x => [x.competency_id, x]));
  const done = new Map(levelsDone.filter(x => x.technician_id === personId && (x.track || "service") === track)
    .map(x => [x.level, x]));
  const at = (level) => items.filter(c => c.level === level);
  const current = Math.min(Math.max(0, ...done.keys()) + 1, 4);
  return {
    items, signed, done, at, current,
    finished: done.has(4),
    count: (level) => at(level).filter(c => signed.has(c.id)).length
  };
}

function techSummary(pr) {
  return pr.finished ? "All four levels complete"
    : `Level ${pr.current} · ${pr.count(pr.current)} of ${pr.at(pr.current).length} signed off`;
}

// An owner looks after everyone; an admin, the people at the locations they
// look after (their own, and any they're covering).
const techManages = (person) => isOwner() || adminAt(person.location_id);

const techName = (person) => (person.full_name || "").trim() || "No name yet";

// Redraws the view without jumping to the top.
function refreshTechView() {
  const y = window.scrollY;
  showView("skills");
  window.scrollTo(0, y);
}

function techPersonCard(person, label, track = "service") {
  const pr = techProgress(person.id, track);
  const total = pr.at(pr.current).length;
  const pct = pr.finished ? 100 : (total ? Math.round(pr.count(pr.current) / total * 100) : 0);
  return `<button type="button" class="skill-person skill-level-${pr.current}" data-skill-open="${esc(person.id)}" data-skill-track="${track}">
    <span class="skill-ring" style="--p:${pct}"><span>${pr.finished ? "✓" : pr.current}</span></span>
    <span style="flex:1;min-width:0"><b>${esc(label || techName(person))}</b>
      <span class="note" style="display:block">${esc(techSummary(pr))}${
        isOwner() && !label ? " · " + esc(locations[person.location_id] || "No location") : ""}</span></span>
    <span class="note">&rsaquo;</span>
  </button>`;
}

function skillsView() {
  if (skillsError) {
    return hero("Skills", "") + `<div class="card"><p class="note">${
      /does not exist|schema cache/i.test(skillsError)
        ? "Skills isn't switched on yet — the training department is setting it up."
        : "Skills couldn't be loaded. " + esc(skillsError)}</p></div>`;
  }

  const open = skillsState.personId && techPeople.find(p => p.id === skillsState.personId);
  if (open) return techChecklist(open, skillsState.track || "service");

  const mine = techPeople.find(p => p.id === me.id);
  const myTracks = mine ? SKILL_TRACKS.filter(t => t.on(mine)) : [];
  let html = hero("Skills",
    "Four levels of competencies for technicians, and four for Parts, each signed off by your location admin. Finish every item in a level to move up to the next.");

  if (myTracks.length) {
    html += `<div class="section-title">Your progress</div>
      <div class="skill-people" style="margin-bottom:22px">${myTracks.map(t =>
        techPersonCard(mine, myTracks.length > 1 ? `You · ${t.people}` : "You", t.id)).join("")}</div>`;
  }

  if (isAdmin()) {
    SKILL_TRACKS.forEach(t => {
      const onIt = techPeople.filter(p => t.on(p) && techManages(p))
        .sort((a, b) => (locations[a.location_id] || "").localeCompare(locations[b.location_id] || "")
          || techName(a).localeCompare(techName(b)));
      const candidates = techPeople.filter(p => !t.on(p) && p.location_id && p.id !== me.id && techManages(p))
        .sort((a, b) => techName(a).localeCompare(techName(b)));
      html += `<div class="section-title" style="margin-top:8px">${isOwner() ? t.people : `${t.people} at your location`}</div>
        ${onIt.length ? `<div class="skill-people">${onIt.map(p => techPersonCard(p, "", t.id)).join("")}</div>`
          : `<p class="note">Nobody's on this list yet. Add the ${t.id === "parts" ? "parts people" : "technicians"} at your location below.</p>`}
        ${candidates.length ? `<div class="card" data-enroll-box="${t.id}" style="margin:18px 0 24px">
          <h2>Add a ${t.person}</h2>
          <div class="row" style="align-items:flex-end">
            <div style="flex:1;min-width:200px"><label>Person</label>
              <select data-enroll="person">${candidates.map(p =>
                `<option value="${esc(p.id)}">${esc(techName(p))}${isOwner() ? " — " + esc(locations[p.location_id] || "") : ""}</option>`).join("")}</select></div>
            <div><label>Working on</label>
              <select data-enroll="level">${SKILL_LEVELS.map(l => `<option value="${l}">${t.prefix}Level ${l}</option>`).join("")}</select></div>
            <button data-skill-enroll="${t.id}">Add</button>
          </div>
          <p class="note" style="margin:8px 0 0">Anyone already working above Level 1: pick their level, and the
            levels below are recorded as placed rather than signed off.</p>
          <span class="msg"></span>
        </div>` : ""}`;
    });
  }

  if (!myTracks.length && !isAdmin()) {
    html += `<div class="card"><b>Skills is for service technicians and parts staff.</b>
      <p class="note" style="margin:6px 0 0">If you're a technician or in Parts and don't see your progress here,
      ask your location admin to add you.</p></div>`;
  }
  return html;
}

function techChecklist(person, track = "service") {
  const t = skillTrack(track);
  const pr = techProgress(person.id, track);
  const level = skillsState.level || pr.current;
  const canSign = techManages(person) && person.id !== me.id;
  const own = person.id === me.id;
  const total = pr.at(pr.current).length, doneCount = pr.count(pr.current);
  const finishedThis = pr.done.get(level);
  const day = (iso) => iso ? new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "";

  // Categories in list order.
  const groups = [];
  pr.at(level).forEach(c => {
    let g = groups.find(x => x.category === c.category);
    if (!g) groups.push(g = { category: c.category, items: [] });
    g.items.push(c);
  });

  return `
  ${isAdmin() ? `<button type="button" class="ghost" data-skill-back style="margin-bottom:12px">&larr; Everyone in Skills</button>` : ""}
  <div class="card skill-level-${pr.current}">
    <div class="note" style="text-transform:uppercase;letter-spacing:.08em;font-weight:600">${esc(own ? "Your progress" : techName(person))}</div>
    <h2 style="font-size:24px;margin:4px 0 10px">${pr.finished ? `All four ${t.prefix}levels complete`
      : track === "parts" ? `Parts Level ${pr.current}` : `Level ${pr.current} technician`}</h2>
    ${pr.finished ? "" : `<div class="skill-bar"><i style="width:${total ? doneCount / total * 100 : 0}%"></i></div>
      <p class="note" style="margin:6px 0 0">${doneCount} of ${total} Level ${pr.current} competencies signed off · ${total - doneCount} to go</p>`}
    <div class="skill-chips">${SKILL_LEVELS.map(l => `<span class="skill-chip skill-level-${l}${
      pr.done.has(l) || l === pr.current ? " on" : ""}">${pr.done.has(l) ? "✓ " : ""}L${l}</span>`).join("")}</div>
    ${isOwner() && !own ? `<details class="skill-change" id="skillChange" style="margin-top:14px">
      <summary>Change level</summary>
      <div class="row" style="align-items:flex-end;margin-top:10px">
        <div><label>Move to</label>
          <select data-skill-change="level">${SKILL_LEVELS.map(l => `<option value="${l}"${
            l === Math.max(1, pr.current - (pr.finished ? 0 : 1)) ? " selected" : ""}>Level ${l}</option>`).join("")}</select></div>
        <div style="flex:1;min-width:220px"><label>Why — needed to move someone down</label>
          <input type="text" data-skill-change="reason" maxlength="500" placeholder="e.g. Placed too high; needs more time on hydraulics"></div>
        <button data-skill-setlevel>Change level</button>
      </div>
      <p class="note" style="margin:8px 0 0">Moving down takes the finished levels off their record; sign-offs stay.
        If the level you move them to is still fully signed off, undo the sign-offs that shouldn't count first —
        otherwise it would finish again at the next sign-off. Logged with your name, the date and the reason.</p>
      <span class="msg"></span>
    </details>` : ""}
  </div>

  ${levelChanges.filter(x => x.technician_id === person.id && (x.track || "service") === track).slice(0, 3).map(x => `
    <div class="card skill-level-${x.to_level}" style="padding:12px 16px">
      <b style="color:var(--tl)">${x.to_level < x.from_level ? "↓ Moved down" : "↑ Moved up"} from ${
        x.from_level === 5 ? "all four finished" : "Level " + x.from_level} to Level ${x.to_level}</b>
      <div class="note">${x.changed_by_name ? "by " + esc(x.changed_by_name) + " · " : ""}${day(x.changed_at)}</div>
      ${x.reason ? `<div class="note"><i>“${esc(x.reason)}”</i></div>` : ""}
    </div>`).join("")}

  <div class="skill-tabs">${SKILL_LEVELS.map(l => `<button type="button" class="skill-tab skill-level-${l}${l === level ? " on" : ""}"
    data-skill-level="${l}">Level ${l}<small>${pr.count(l)}/${pr.at(l).length}</small></button>`).join("")}</div>

  ${finishedThis ? `<p class="skill-level-${level}" style="color:var(--tl);margin:0 0 6px">✓ ${
      finishedThis.placed ? `Placed past Level ${level} when enrolled` : `Level ${level} finished`}${
      finishedThis.completed_at ? " on " + day(finishedThis.completed_at) : ""}.</p>`
    : level > pr.current ? `<p class="note" style="margin:0 0 6px">Items here can be signed off early. They count once
      Level ${pr.current} is finished.</p>` : ""}

  ${groups.map(g => `
    <div class="skill-cat">${esc(g.category)}</div>
    <div class="skill-list skill-level-${level}">${g.items.map(c => {
      const s = pr.signed.get(c.id);
      return `<div class="skill-item${s ? " done" : ""}">
        <span class="skill-check"></span>
        <span class="skill-name">${esc(c.name)}
          ${s ? `<span class="note">Signed off by ${esc(s.signed_by_name || "an admin")} · ${day(s.signed_at)}</span>
                 ${s.note ? `<span class="note"><i>“${esc(s.note)}”</i></span>` : ""}`
              : finishedThis ? `<span class="note" style="color:#8a5e00">Added after this level was finished — doesn't affect the level</span>` : ""}
        </span>
        ${canSign && !s ? `<button type="button" class="pdf" data-skill-signoff="${esc(c.id)}">Sign off</button>` : ""}
        ${canSign && s ? `<button type="button" class="ghost" data-skill-remove="${esc(s.id)}" title="Remove this sign-off">Undo</button>` : ""}
      </div>`;
    }).join("")}</div>`).join("")}`;
}

document.addEventListener("click", async (event) => {
  const openBtn = event.target.closest("[data-skill-open]");
  if (openBtn) {
    skillsState = { personId: openBtn.dataset.skillOpen, level: null, track: openBtn.dataset.skillTrack || "service" };
    return showView("skills");
  }
  if (event.target.closest("[data-skill-back]")) {
    skillsState = { personId: null, level: null, track: "service" };
    return showView("skills");
  }
  const levelBtn = event.target.closest("[data-skill-level]");
  if (levelBtn) {
    skillsState.level = Number(levelBtn.dataset.skillLevel);
    return refreshTechView();
  }

  const signBtn = event.target.closest("[data-skill-signoff]");
  if (signBtn) {
    const person = techPeople.find(p => p.id === skillsState.personId);
    const item = competencies.find(c => c.id === signBtn.dataset.skillSignoff);
    if (!person || !item) return;
    const note = window.prompt(`Sign off for ${techName(person)}:\n\n${item.name}\n\n` +
      `You're confirming you've seen them do this. Add a note if you like (the machine, the job):`, "");
    if (note === null) return;
    signBtn.disabled = true;
    const { error } = await db.from("competency_signoffs")
      .insert({ technician_id: person.id, competency_id: item.id, note: note.trim() || null });
    if (error) { signBtn.disabled = false; return alert(error.message); }
    // If that finished a level, the tech (and the owners) get a notification.
    // The server checks, and announces each finished level once.
    notify("skill_level", person.id);
    await loadSkills();
    return refreshTechView();
  }

  const undoBtn = event.target.closest("[data-skill-remove]");
  if (undoBtn) {
    if (!confirm("Remove this sign-off? Use this for one signed off by mistake. A level already finished stays finished.")) return;
    const { data, error } = await db.from("competency_signoffs").delete().eq("id", undoBtn.dataset.skillRemove).select();
    if (error) return alert(error.message);
    if (!data || !data.length) return alert("That sign-off wasn't removed — it isn't yours to change.");
    await loadSkills();
    return refreshTechView();
  }

  const setBtn = event.target.closest("[data-skill-setlevel]");
  if (setBtn) {
    const box = $("skillChange");
    const person = techPeople.find(p => p.id === skillsState.personId);
    const level = Number(box.querySelector('[data-skill-change="level"]').value);
    const reason = box.querySelector('[data-skill-change="reason"]').value.trim();
    setBtn.disabled = true;
    const { error } = await db.rpc("set_skill_level", { target: person.id, for_track: skillsState.track || "service",
      new_level: level, reason: reason || null });
    setBtn.disabled = false;
    // The database says exactly why a change isn't allowed; show that.
    if (error) return speak(box, error.message, true);
    skillsState.level = null;
    await loadSkills();
    return refreshTechView();
  }

  const enrollBtn = event.target.closest("[data-skill-enroll]");
  if (enrollBtn) {
    const box = enrollBtn.closest("[data-enroll-box]");
    const target = box.querySelector('[data-enroll="person"]').value;
    const level = Number(box.querySelector('[data-enroll="level"]').value);
    enrollBtn.disabled = true;
    const { error } = await db.rpc("set_skills_track", { target, for_track: enrollBtn.dataset.skillEnroll || "service",
      enrolled: true, starting_level: level });
    enrollBtn.disabled = false;
    if (error) return speak(box, error.message, true);
    await loadSkills();
    return refreshTechView();
  }
});

// ---- admin: the competency list (owners) ------------------------------------------

let skillsAdminTrack = "service";

function renderSkillsAdmin() {
  const box = $("skillsAdminList");
  if (!box) return;
  $("skillsAdminTracks").innerHTML = SKILL_TRACKS.map(t => `<button type="button" class="chip${
    t.id === skillsAdminTrack ? " on" : ""}" data-skills-track="${t.id}">${t.id === "parts" ? "Parts" : "Service technicians"} · ${
    competencies.filter(c => c.is_active && compTrack(c) === t.id).length}</button>`).join("");
  if (skillsError) {
    box.innerHTML = `<p class="error">${/does not exist|schema cache/i.test(skillsError)
      ? "Run migrations 0040 and 0064 in the SQL editor, then reload this page."
      : esc(skillsError)}</p>`;
    return;
  }
  const list = competencies.filter(c => compTrack(c) === skillsAdminTrack);
  const active = list.filter(c => c.is_active);
  $("skillsAdminStats").innerHTML = SKILL_LEVELS.map(l =>
    `<span class="stat"><b>${active.filter(c => c.level === l).length}</b>Level ${l}</span>`).join("")
    + `<span class="stat"><b>${list.length - active.length}</b>retired</span>`;
  $("skillCategories").innerHTML = [...new Set(list.map(c => c.category))]
    .map(c => `<option value="${esc(c)}">`).join("");
  $("techAdd").querySelector('[data-ca="name"]').placeholder = skillsAdminTrack === "parts"
    ? "e.g. Process a warranty parts return" : "e.g. Perform a hydraulic flow test";
  $("techAdd").querySelector('[data-ca="category"]').placeholder = skillsAdminTrack === "parts" ? "Counter" : "Hydraulics";

  if (!list.length) {
    box.innerHTML = `<p class="note" style="margin:0">No ${skillsAdminTrack === "parts" ? "Parts" : "service"} competencies yet.
      Add the first above; they're sorted into Levels 1 to 4 as you go.</p>`;
    return;
  }
  box.innerHTML = SKILL_LEVELS.map(level => {
    const rows = list.filter(c => c.level === level);
    return `<div class="section-title skill-level-${level}" style="margin-top:22px;color:var(--tl)">Level ${level}
      · ${rows.filter(c => c.is_active).length} competencies</div>
    ${rows.map(c => `<div class="skill-row${c.is_active ? "" : " retired"}" data-comp="${esc(c.id)}">
      <input type="text" data-cf="name" value="${esc(c.name)}" aria-label="Competency">
      <div class="skill-row-meta">
        <input type="text" data-cf="category" list="skillCategories" value="${esc(c.category)}" aria-label="Category">
        <select data-cf="level" aria-label="Level">${SKILL_LEVELS.map(l =>
          `<option value="${l}"${l === c.level ? " selected" : ""}>Level ${l}</option>`).join("")}</select>
        <input type="text" data-cf="sort_order" value="${esc(c.sort_order)}" aria-label="Order" title="Order in the list">
        <button class="pdf" data-comp-act="save">Save</button>
        <button class="ghost" data-comp-act="${c.is_active ? "retire" : "restore"}">${c.is_active ? "Retire" : "Restore"}</button>
        ${c.is_active ? "" : `<span class="badge b-none">Retired</span>`}
      </div>
    </div>`).join("")}`;
  }).join("");
}

$("admin").addEventListener("click", async (event) => {
  const trackBtn = event.target.closest("[data-skills-track]");
  if (trackBtn) { skillsAdminTrack = trackBtn.dataset.skillsTrack; $("skillsAdminMsg").textContent = ""; return renderSkillsAdmin(); }
  const btn = event.target.closest("[data-comp-act], [data-comp-add]");
  if (!btn) return;
  const say = (text, bad) => { $("skillsAdminMsg").textContent = text; $("skillsAdminMsg").className = "msg " + (bad ? "error" : "ok"); };

  if (btn.matches("[data-comp-add]")) {
    const form = $("techAdd");
    const get = (f) => form.querySelector(`[data-ca="${f}"]`).value.trim();
    if (!get("name") || !get("category")) return say("A competency needs a name and a category.", true);
    const level = Number(get("level"));
    const order = competencies.filter(c => c.level === level && compTrack(c) === skillsAdminTrack)
      .reduce((m, c) => Math.max(m, c.sort_order), 0) + 5;
    const { data, error } = await db.from("competencies")
      .insert({ name: get("name"), category: get("category"), level, sort_order: order, track: skillsAdminTrack }).select();
    if (error) return say(error.message, true);
    if (!data || !data.length) return say("Nothing added — only an owner can change the list.", true);
    form.querySelector('[data-ca="name"]').value = "";
    await loadSkills(); renderSkillsAdmin();
    return say(`Added to ${skillsAdminTrack === "parts" ? "Parts " : ""}Level ${level}. Anyone who already finished it keeps it.`, false);
  }

  const row = btn.closest("[data-comp]");
  const id = row.dataset.comp;
  const act = btn.dataset.compAct;
  const patch = act === "save" ? {
    name: row.querySelector('[data-cf="name"]').value.trim(),
    category: row.querySelector('[data-cf="category"]').value.trim(),
    level: Number(row.querySelector('[data-cf="level"]').value),
    sort_order: parseInt(row.querySelector('[data-cf="sort_order"]').value, 10) || 0
  } : { is_active: act === "restore" };
  if (act === "save" && (!patch.name || !patch.category)) return say("A competency needs a name and a category.", true);

  const { data, error } = await db.from("competencies").update(patch).eq("id", id).select();
  if (error) return say(error.message, true);
  if (!data || !data.length) return say("Nothing changed — only an owner can change the list.", true);
  await loadSkills(); renderSkillsAdmin();
  say(act === "retire" ? "Retired. It's off everyone's list; past sign-offs for it are kept."
    : act === "restore" ? "Restored." : "Saved.", false);
});
