// Crane Qualifications, on the Safety dashboard
//
// Everyone on All employees and where they stand on the Crane & Rigging
// Qualification: qualified (and until when), running out in the next 60 days,
// expired, removed, or not taken. One table, every column sortable, with a
// search, a location to narrow to, and a spreadsheet of what's showing. The
// qualification is worked out exactly as everywhere else (craneStatus, in
// crane.js); Remove and Restore are the Crane Center's own.
//
// A person's location is the one their UKG store answers to (storeLocation,
// in core.js): its name, its id, or a UKG name on Groups & Locations, so
// Field Support's people sit under Admin, the name it has now. A store no
// location answers to is named at the top, to be added there.

const CQ_SOON_DAYS = 60;
let cqQuery = "", cqFilter = "taken", cqPlace = "all", cqTechs = false;
let cqSort = { key: "status", dir: 1 };

// What each row needs, worked out once a draw.
function cqRows() {
  const today = new Date(new Date().toDateString());
  const required = reqKinds.crane.rows;
  return tsPeople.map(r => {
    const st = craneStatus(r);
    const loc = storeLocation(r.store);
    const days = st.expires ? Math.round((st.expires - today) / 86400000) : null;
    const state = st.kind === "qualified" ? (days !== null && days <= CQ_SOON_DAYS ? "expiring" : "qualified") : st.kind;
    return {
      r, st, loc, state, days,
      name: `${r.first_name || ""} ${r.last_name || ""}`.trim() || r.email || "Someone",
      last: `${r.last_name || ""} ${r.first_name || ""}`.trim().toLowerCase(),
      place: loc ? locations[loc] || loc : r.store || "No location",
      job: (r.job || "").replace(/^\d+\s*-\s*/, ""),
      completed: st.completion ? st.completion.completed : "",
      required: required.some(q => q.person_key === r.person_key
        || (q.employee_number && q.employee_number === r.employee_number)
        || (q.email && r.email && q.email.toLowerCase() === r.email.toLowerCase()))
    };
  });
}

const CQ_STATES = {
  qualified: ["Qualified", "b-current", 0],
  expiring: ["Expiring", "b-expiring", 1],
  expired: ["Expired", "b-expired", 2],
  removed: ["Removed", "b-expired", 3],
  none: ["Not taken", "b-none", 4]
};
const CQ_FILTERS = [
  ["taken", "Has taken it", x => x.state !== "none"],
  ["qualified", "Qualified", x => x.state === "qualified" || x.state === "expiring"],
  ["expiring", `Expiring in ${CQ_SOON_DAYS} days`, x => x.state === "expiring"],
  ["expired", "Expired", x => x.state === "expired"],
  ["removed", "Removed", x => x.state === "removed"],
  ["none", "Not taken", x => x.state === "none"],
  ["requirednot", "Required, not qualified", x => x.required && x.state !== "qualified" && x.state !== "expiring"],
  ["all", "Everyone", () => true]
];

function cqSorted(rows) {
  const by = {
    name: (a, b) => a.last.localeCompare(b.last),
    place: (a, b) => a.place.localeCompare(b.place) || a.last.localeCompare(b.last),
    job: (a, b) => a.job.localeCompare(b.job) || a.last.localeCompare(b.last),
    status: (a, b) => CQ_STATES[a.state][2] - CQ_STATES[b.state][2] || (a.st.expires || 0) - (b.st.expires || 0) || a.last.localeCompare(b.last),
    completed: (a, b) => String(a.completed || "0").localeCompare(String(b.completed || "0")) || a.last.localeCompare(b.last),
    expires: (a, b) => (a.st.expires ? a.st.expires.getTime() : Infinity) - (b.st.expires ? b.st.expires.getTime() : Infinity) || a.last.localeCompare(b.last),
    required: (a, b) => (b.required - a.required) || a.last.localeCompare(b.last)
  }[cqSort.key];
  return rows.sort((a, b) => by(a, b) * cqSort.dir);
}

// What the search, the location and the technicians box leave, before the
// status filter: what the filters count.
function cqNarrowed(rows) {
  const words = cqQuery.toLowerCase().split(/\s+/).filter(Boolean);
  return rows.filter(x => (cqPlace === "all" || (cqPlace === "none" ? !x.loc : x.loc === cqPlace))
    && (!cqTechs || x.r.is_technician)
    && words.every(w => `${x.name} ${x.place} ${x.r.store || ""} ${x.job} ${x.r.email || ""}`.toLowerCase().includes(w)));
}

function renderCraneQuals() {
  const box = $("craneQuals");
  if (!box) return;
  if (trainingStatusError || craneError) {
    box.innerHTML = `<div class="card"><h2>Crane qualifications</h2><p class="error">${esc(trainingStatusError || craneError)}</p></div>`;
    return;
  }
  const all = cqRows();
  const narrowed = cqNarrowed(all);
  const filter = CQ_FILTERS.find(f => f[0] === cqFilter) || CQ_FILTERS[0];
  const shown = cqSorted(narrowed.filter(filter[2]));
  const placesHere = [...new Set(all.filter(x => x.loc).map(x => x.loc))]
    .sort((a, b) => (locations[a] || a).localeCompare(locations[b] || b));
  const unmatched = [...new Set(all.filter(x => !x.loc).map(x => x.r.store || "(blank)"))].sort();
  const canChange = isAdmin();
  const myKey = (tsMine() || {}).person_key;
  const arrow = (key) => cqSort.key === key ? (cqSort.dir > 0 ? " ▲" : " ▼") : "";
  const head = (key, label) => `<th scope="col" aria-sort="${cqSort.key === key ? (cqSort.dir > 0 ? "ascending" : "descending") : "none"}">
    <button type="button" class="cq-sort${cqSort.key === key ? " on" : ""}" data-cq-sort="${key}">${label}<span aria-hidden="true">${arrow(key)}</span></button></th>`;
  const count = (state) => all.filter(x => x.state === state).length;

  box.innerHTML = `<div class="card cq">
    <h2>Crane qualifications</h2>
    <p class="note" style="margin:0 0 12px">Everyone on All employees and where they stand on the Crane &amp; Rigging
      Qualification: qualified means ${esc(craneCourse())} is on their training history${craneValidMonths()
      ? `, completed in the last ${craneValidMonths()} months` : ", with no expiry"}. Click a column to sort by it, again to reverse.</p>
    <div class="cq-tally">
      <div><b>${count("qualified") + count("expiring")}</b><span>Qualified</span></div>
      <div class="warn"><b>${count("expiring")}</b><span>Expiring in ${CQ_SOON_DAYS} days</span></div>
      <div class="bad"><b>${count("expired") + count("removed")}</b><span>Expired or removed</span></div>
      <div class="quiet"><b>${all.filter(x => x.r.is_technician && x.state === "none").length}</b><span>Technicians who haven't taken it</span></div>
    </div>
    ${unmatched.length ? `<p class="cq-unmatched">${icon("warning", 15)}<span>UKG lists ${unmatched.map(s =>
      `<b>${esc(s)}</b> (${all.filter(x => !x.loc && (x.r.store || "(blank)") === s).length})`).join(", ")} as a location, and no location here
      answers to ${unmatched.length === 1 ? "it" : "them"}. ${isOwner() ? "Add it as a UKG name on the location it means, under Admin → Groups &amp; Locations, and they'll show there."
      : "An owner can add it as a UKG name on Groups &amp; Locations."}</span></p>` : ""}
    <div class="cq-bar">
      <input id="cqSearch" class="search" type="search" placeholder="Find someone by name, location or job" value="${esc(cqQuery)}" aria-label="Search">
      <select id="cqPlace" aria-label="Location">
        <option value="all">All locations</option>
        ${placesHere.map(id => `<option value="${esc(id)}"${cqPlace === id ? " selected" : ""}>${esc(locations[id] || id)}</option>`).join("")}
        ${unmatched.length ? `<option value="none"${cqPlace === "none" ? " selected" : ""}>No matching location</option>` : ""}
      </select>
      <label class="check"><input id="cqTechs" type="checkbox"${cqTechs ? " checked" : ""}> Technicians only</label>
      <button type="button" class="ghost" data-cq-csv>${icon("doc", 15)} Download spreadsheet</button>
      <span class="msg" role="status"></span>
    </div>
    <div class="chips">${CQ_FILTERS.map(([id, label, test]) =>
      `<button type="button" class="chip${cqFilter === id ? " on" : ""}" data-cq-filter="${id}">${label} · ${narrowed.filter(test).length}</button>`).join("")}</div>
    ${shown.length ? `<div class="cq-scroll"><table class="cq-table">
      <thead><tr>${head("name", "Name")}${head("place", "Location")}${head("status", "Status")}${head("completed", "Completed")}${
        head("expires", "Expires")}${head("required", "Required")}${canChange ? "<th></th>" : ""}</tr></thead>
      <tbody>${shown.map(x => `<tr class="cq-${x.state}">
        <td><b>${esc(x.name)}</b>${x.job ? `<small>${esc(x.job)}</small>` : ""}</td>
        <td>${esc(x.place)}${x.loc && x.r.store && storeKey(x.r.store) !== storeKey(locations[x.loc] || "")
          ? `<small>UKG: ${esc(x.r.store)}</small>` : !x.loc ? `<small class="cq-nomatch">No matching location</small>` : ""}</td>
        <td><span class="badge ${CQ_STATES[x.state][1]}">${CQ_STATES[x.state][0]}</span>${
          x.state === "expiring" ? `<small>${x.days === 0 ? "Runs out today" : `${x.days} day${x.days === 1 ? "" : "s"} left`}</small>`
          : x.state === "removed" && x.st.change ? `<small>${esc(x.st.change.changed_by_name || "")}: ${esc(x.st.change.reason || "")}</small>` : ""}</td>
        <td>${x.completed ? esc(fmtDate(String(x.completed).slice(0, 10))) : "—"}</td>
        <td>${x.st.expires ? esc(craneDay(x.st.expires)) : x.state === "none" ? "—" : "No expiry"}</td>
        <td>${x.required ? `<span class="badge ${x.state === "qualified" || x.state === "expiring" ? "b-current" : "b-expired"}">Required</span>` : ""}</td>
        ${canChange ? `<td class="cq-act">${x.r.person_key === myKey || x.state === "none" || x.state === "expired" ? ""
          : x.state === "removed" ? `<button type="button" class="ghost" data-crane="restore" data-key="${esc(x.r.person_key)}">Restore</button>`
          : `<button type="button" class="ghost" data-crane="remove" data-key="${esc(x.r.person_key)}">Remove</button>`}</td>` : ""}
      </tr>`).join("")}</tbody></table></div>`
      : `<p class="note">${tsPeople.length ? "Nobody matches." : "All employees hasn't been uploaded yet."}</p>`}
  </div>`;
}

function cqSpreadsheet() {
  const narrowed = cqNarrowed(cqRows());
  const filter = CQ_FILTERS.find(f => f[0] === cqFilter) || CQ_FILTERS[0];
  const rows = cqSorted(narrowed.filter(filter[2]));
  const iso = (d) => d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}` : "";
  downloadCSV(`Crane Qualifications ${fvToday()}.csv`, [["Name", "Job", "Location", "UKG location", "Status", "Completed", "Expires", "Required", "Work email"],
    ...rows.map(x => [x.name, x.job, x.place, x.r.store || "", CQ_STATES[x.state][0], x.completed ? String(x.completed).slice(0, 10) : "",
      iso(x.st.expires), x.required ? "Yes" : "", x.r.email || ""])]);
  return rows.length;
}

// Typing keeps the cursor where it was: the table is drawn again under it.
$("admin").addEventListener("input", (event) => {
  if (event.target.id !== "cqSearch") return;
  cqQuery = event.target.value;
  const at = event.target.selectionStart;
  renderCraneQuals();
  const again = $("cqSearch");
  if (again) { again.focus(); again.setSelectionRange(at, at); }
});
$("admin").addEventListener("change", (event) => {
  if (event.target.id === "cqPlace") { cqPlace = event.target.value; renderCraneQuals(); }
  if (event.target.id === "cqTechs") { cqTechs = event.target.checked; renderCraneQuals(); }
});
$("admin").addEventListener("click", (event) => {
  const sort = event.target.closest("[data-cq-sort]");
  if (sort) {
    const key = sort.dataset.cqSort;
    cqSort = cqSort.key === key ? { key, dir: -cqSort.dir } : { key, dir: key === "required" || key === "completed" ? -1 : 1 };
    return renderCraneQuals();
  }
  const filter = event.target.closest("[data-cq-filter]");
  if (filter) { cqFilter = filter.dataset.cqFilter; return renderCraneQuals(); }
  const csv = event.target.closest("[data-cq-csv]");
  if (csv) {
    const row = csv.closest(".cq-bar");
    try { const n = cqSpreadsheet(); speak(row, `Downloaded ${n} ${n === 1 ? "person" : "people"}.`, false); }
    catch (e) { speak(row, `Couldn't make it: ${e.message}`, true); }
  }
});
