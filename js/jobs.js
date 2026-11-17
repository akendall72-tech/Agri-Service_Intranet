// Jobs (migration 0150)
//
// Admin → People → Jobs: what each job title counts as. Technician, parts,
// sales, or everyone else. Technicians are who the dealer metric, Training
// Status, the Location Dashboard, the AGCO maps, the Mock Schedule and the
// reports count, so every technician's title has to count as one; parts and
// sales are kept for what comes later.
//
// A title nobody has set is guessed from its words. The database decides who's
// marked a technician (job_kind_for() in 0150, on every save of someone's job,
// and again for everyone with a title when its mapping changes); jobKey() and
// jobKindGuess() here must say exactly what job_key() and job_kind_guess() say
// there, so the upload's preview matches what's published.

let jobKinds = [], jobKindsError = null, jobsQuery = "", jobsFilter = "all", jobsBusy = "";

const JOB_KINDS = [
  { id: "technician", label: "Technician", plural: "Technicians", colour: "teal", what: "Counted by the dealer metric and Training Status" },
  { id: "parts", label: "Parts", plural: "Parts", colour: "amber", what: "For what comes later" },
  { id: "sales", label: "Sales", plural: "Sales", colour: "violet", what: "For what comes later" },
  { id: "other", label: "Everyone else", plural: "Everyone else", colour: "steel", what: "Not counted as any of these" },
];

// "4070 - Technician  Master" → "technician master": lower case, single
// spaces, a leading code left off. The same as job_key() in the database.
const jobKey = (job) => String(job || "").trim().toLowerCase().replace(/^[0-9]+\s*-\s*/, "").replace(/\s+/g, " ").trim();

// A title nobody has set, from its words: the same as job_kind_guess().
function jobKindGuess(job) {
  const key = jobKey(job);
  if (/\btechnician\b/.test(key)) return "technician";
  if (/\bparts\b/.test(key)) return "parts";
  if (/\bsales\b/.test(key)) return "sales";
  return "other";
}

// What a title counts as: the company's mapping, else the guess.
function jobKind(job) {
  const set = jobKinds.find(k => k.job_key === jobKey(job));
  return set ? set.kind : jobKindGuess(job);
}

async function loadJobKinds() {
  if (!me || !isOwner()) return;
  const { data, error } = await db.from("job_kinds").select("*").order("job_key");
  jobKindsError = error ? error.message : null;
  jobKinds = error ? [] : data || [];
}

// Every title someone here has: on the People list (here now), or on Training
// Status, with how many on each.
function jobsTitles() {
  const titles = new Map();
  const add = (job, field) => {
    const key = jobKey(job);
    if (!key) return;
    const t = titles.get(key) || { key, job: String(job).trim().replace(/^[0-9]+\s*-\s*/, ""), list: 0, status: 0 };
    t[field]++;
    titles.set(key, t);
  };
  plRows.filter(e => e.here).forEach(e => add(e.job, "list"));
  tsRows().forEach(r => add(r.job, "status"));
  jobKinds.forEach(k => { if (!titles.has(k.job_key)) titles.set(k.job_key, { key: k.job_key, job: k.job || k.job_key, list: 0, status: 0 }); });
  return [...titles.values()].map(t => {
    const set = jobKinds.find(k => k.job_key === t.key);
    return { ...t, kind: set ? set.kind : jobKindGuess(t.job), set, people: Math.max(t.list, t.status) };
  }).sort((a, b) => b.people - a.people || a.job.localeCompare(b.job));
}

// Training Status's people, as published (training-status.js keeps them).
const tsRows = () => (Array.isArray(tsPeople) ? tsPeople : []);

function renderJobs() {
  const box = $("jobsAdmin");
  if (!box) return;
  if (jobKindsError && /job_kinds|does not exist|schema cache/i.test(jobKindsError)) {
    box.innerHTML = `<div class="card"><p class="error">Run migration 0150_job_kinds.sql in the SQL editor, then reload this page.</p></div>`;
    return;
  }
  const all = jobsTitles();
  const guessed = all.filter(t => !t.set);
  const q = jobsQuery.trim().toLowerCase();
  const shown = all.filter(t => jobsFilter === "all" ? true : jobsFilter === "guessed" ? !t.set : t.kind === jobsFilter)
    .filter(t => !q || t.job.toLowerCase().includes(q));
  const peopleOf = (kind) => all.filter(t => t.kind === kind).reduce((n, t) => n + t.people, 0);
  const tile = (id, label, n, sub, colour, hot) =>
    cabTile(label, sxNum(n), sub, { colour, data: `data-jobs-filter="${id}"`, on: jobsFilter === id, hot });
  const labels = { all: "Every title", guessed: "Not set yet" };
  JOB_KINDS.forEach(k => { labels[k.id] = k.plural; });

  box.innerHTML = `<div class="sx cab-admin jobs" style="${lit("teal")}">
    <section class="sx-hero">
      <div class="sx-hero-text">
        <span class="sx-kicker">People · Jobs</span>
        <h2>Who counts as what</h2>
        <p>Every job title on the People list and Training Status counts as a technician, parts, sales or everyone else.
          <b>Technicians are who the dealer metric counts</b>, and Training Status, the Location Dashboard${companyHas("agco")
          ? ", the AGCO maps and the Mock Schedule" : ""} with it, so every technician's title has to count as one. A title
          nobody has set is guessed from its words: Technician, Parts or Sales. Set it to be sure; a change counts at once,
          with no new upload.</p>
      </div>
    </section>
    ${jobKindsError ? `<p class="error">${esc(jobKindsError)}</p>` : ""}
    <div class="sx-tiles six" style="--n:6">
      ${tile("all", "Titles", all.length, `${sxNum(all.reduce((n, t) => n + t.people, 0))} people`, "slate")}
      ${JOB_KINDS.map(k => { const n = all.filter(t => t.kind === k.id).length;
        return tile(k.id, k.plural, peopleOf(k.id), `${n} ${n === 1 ? "title" : "titles"}`, k.colour); }).join("")}
      ${tile("guessed", "Not set yet", guessed.length, guessed.length ? "Guessed from their words" : "Every title is set", guessed.length ? "amber" : "green", guessed.length > 0)}
    </div>
    <section class="sx-panel" style="${lit("teal")}">
      <header><h3>${esc(labels[jobsFilter] || labels.all)}</h3><span>${sxNum(shown.length)} ${shown.length === 1 ? "title" : "titles"}</span>
        <input type="search" id="jobsSearch" class="cab-search" placeholder="Search a title" aria-label="Search job titles" value="${esc(jobsQuery)}"></header>
      <span class="msg" role="status"></span>
      ${!shown.length ? `<p class="sx-empty">${all.length ? "No title matches." : "No job titles yet: they come from the People list and Training Status."}</p>` : `
      <div class="lc-scroll"><table class="lc-table jobs-table">
        <thead><tr><th>Job title</th><th>People</th><th>Counts as</th><th></th></tr></thead>
        <tbody>${shown.map(t => `<tr>
          <td><b>${esc(t.job)}</b>${t.set ? `<small>Set${t.set.updated_by_name ? ` by ${esc(t.set.updated_by_name)}` : ""}, ${esc(new Date(t.set.updated_at).toLocaleDateString())}</small>`
            : `<small>Guessed from its words</small>`}</td>
          <td>${sxNum(t.people)}</td>
          <td><select data-job-kind="${esc(t.key)}" data-job-title="${esc(t.job)}" aria-label="What ${esc(t.job)} counts as" ${jobsBusy ? "disabled" : ""}>
            ${JOB_KINDS.map(k => `<option value="${k.id}"${t.kind === k.id ? " selected" : ""}>${esc(k.label)}</option>`).join("")}</select></td>
          <td class="pl-do">${t.set ? `<button type="button" class="pdf" data-job-guess="${esc(t.key)}" ${jobsBusy ? "disabled" : ""}>Use the guess (${esc(JOB_KINDS.find(k => k.id === jobKindGuess(t.job)).label)})</button>`
            : `<span class="badge">Guessed</span>`}</td>
        </tr>`).join("")}</tbody>
      </table></div>`}
    </section>
    <section class="sx-panel" style="${lit("steel")}">
      <header><h3>How it works</h3></header>
      <dl class="cab-rules">
        <div><dt>Technicians</dt><dd>Counted by the dealer metric, Training Status, the Location Dashboard and the reports. A title
          set to <b>Technician</b> counts, whatever its words; one set to anything else doesn't, even with Technician in it.</dd></div>
        <div><dt>Parts and sales</dt><dd>Recorded now, for the pages that will count them later. Nothing counts them yet.</dd></div>
        <div><dt>A new title</dt><dd>Arrives with the next All employees upload or Microsoft sync, guessed from its words. It shows
          under <b>Not set yet</b> until someone sets it.</dd></div>
        <div><dt>Skills</dt><dd>Keeps its own list of who's in its program, added by location admins. This page doesn't change it.</dd></div>
      </dl>
    </section>
  </div>`;
}

// Saved as soon as it's picked, and everyone with the title is marked again
// by the database; then the page reads Training Status again to show it.
async function jobsSaved(message) {
  await Promise.all([loadJobKinds(), loadTrainingStatus()]);
  if (companyHas("agco") && typeof agcoRebuild === "function") { try { await agcoRebuild(); } catch { /* maps catch up at the next upload */ } }
  jobsBusy = "";
  renderJobs();
  const msg = document.querySelector("#jobsAdmin .msg");
  if (msg) speak(msg.parentElement, message, false);
}

document.addEventListener("change", async (e) => {
  const pick = e.target.closest("[data-job-kind]");
  if (!pick) return;
  const key = pick.dataset.jobKind, kind = pick.value, title = pick.dataset.jobTitle;
  jobsBusy = key; renderJobs();
  const { error } = await db.from("job_kinds").upsert({ job_key: key, job: title, kind }, { onConflict: "company_id,job_key" });
  if (error) { jobsBusy = ""; jobKindsError = error.message; return renderJobs(); }
  jobsSaved(`${title} counts as ${JOB_KINDS.find(k => k.id === kind).label.toLowerCase()} now.`);
});

document.addEventListener("click", async (e) => {
  const tile = e.target.closest("[data-jobs-filter]");
  if (tile) {
    jobsFilter = jobsFilter === tile.dataset.jobsFilter && tile.dataset.jobsFilter !== "all" ? "all" : tile.dataset.jobsFilter;
    return renderJobs();
  }
  const back = e.target.closest("[data-job-guess]");
  if (back) {
    const key = back.dataset.jobGuess;
    jobsBusy = key; renderJobs();
    const { error } = await db.from("job_kinds").delete().eq("job_key", key);
    if (error) { jobsBusy = ""; jobKindsError = error.message; return renderJobs(); }
    jobsSaved("Back to the guess from its words.");
  }
});

document.addEventListener("input", (e) => {
  if (e.target.id !== "jobsSearch") return;
  jobsQuery = e.target.value;
  const at = e.target.selectionStart;
  renderJobs();
  const box = $("jobsSearch");
  if (box) { box.focus(); box.setSelectionRange(at, at); }
});
