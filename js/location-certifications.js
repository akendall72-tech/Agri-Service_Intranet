// Certifications, on the Location Dashboard
//
// Who at a location holds what, and when it runs out: the forklift card, the
// crane and rigging qualification, EPA 609, and the four people add for
// themselves in the app's My Certifications (0130): DOT Medical Card, Welding
// Certification, CPR and First Aid. Those four are optional; a location's
// admins and owners see them, with their pictures. Anything else a person adds
// stays theirs, and isn't loaded here at all.

// The columns, the company's three first.
const LC_COLUMNS = [
  { id: "forklift", name: "Forklift", short: "Forklift" },
  { id: "crane", name: "Crane & rigging", short: "Crane & rigging" },
  { id: "epa", name: "EPA 609", short: "EPA 609" },
  ...CERT_KINDS];
// The four warn this many days ahead, as the app's reminders do.
const LC_SOON_DAYS = 30;

let lcCerts = [], lcError = null, lcNotSetUp = false;
let lcFilter = "all", lcShow = "all";

async function loadTrackedCerts() {
  if (!isAdmin()) { lcCerts = []; return; }
  const { data, error } = await allRows(() => db.from("personal_certifications")
    .select("id,user_id,kind,name,issued_by,number,issued_on,expires_on,photo_path,person_name,email,employee_number")
    .neq("kind", "other").order("id"));
  lcError = error ? error.message : null;
  lcNotSetUp = !!error && /does not exist|schema cache/i.test(error.message);
  lcCerts = error ? [] : data || [];
}

// How one held certification reads: a tone, a few words, and the date for
// the spreadsheet. soonDays decides when it starts to show amber.
function lcDated(expires, soonDays, held = "Holds it") {
  if (!expires) return { tone: "ok", text: held, csv: `${held === "Holds it" ? "Yes" : held}, no expiry` };
  const today = new Date(new Date().toDateString());
  const day = new Date(String(expires).slice(0, 10) + "T00:00:00");
  const days = Math.round((day - today) / 86400000), when = fmtDate(String(expires).slice(0, 10));
  const iso = String(expires).slice(0, 10);
  if (days < 0) return { tone: "bad", text: `Expired ${when}`, csv: `${iso} (expired)`, days };
  if (days <= soonDays) return { tone: "warn", text: days === 0 ? "Expires today" : days === 1 ? "Expires tomorrow" : `${days} days left`,
    sub: when, csv: iso, days };
  return { tone: "ok", text: `Until ${when}`, csv: iso, days };
}
const LC_NONE = { tone: "none", text: "", csv: "" };

// Everyone at the location, each with a cell per certification. People are
// the UKG roster at this location and the app accounts here, joined by
// employee number, then work email.
function lcFigures(loc) {
  const name = lxName(loc);
  const num = (v) => v ? tsEmployeeNumber(v) : "";
  const mail = (v) => String(v || "").trim().toLowerCase();
  const rows = tsPeople.filter(r => storeLocation(r.store) === loc).map(r => ({
    name: `${r.first_name || ""} ${r.last_name || ""}`.trim() || r.email || "Someone",
    job: (r.job || "").replace(/^\d+\s*-\s*/, ""), number: num(r.employee_number), email: mail(r.email), roster: r, account: null }));
  const byNumber = new Map(rows.filter(x => x.number).map(x => [x.number, x]));
  const byEmail = new Map(rows.filter(x => x.email).map(x => [x.email, x]));
  people.filter(p => p.location_id === loc && !p.deactivated_at).forEach(p => {
    const number = num(p.employee_number), email = mail(p.email);
    const hit = (number && byNumber.get(number)) || (email && byEmail.get(email));
    if (hit) { hit.account = p; return; }
    rows.push({ name: p.full_name || p.email || "No name yet", job: "", number, email, roster: null, account: p });
  });

  // Forklift cards carry an email, or for an old one only a name.
  const cards = certsPerPerson();
  const cardByEmail = new Map(cards.filter(r => r.email).map(r => [mail(r.email), r]));
  const cardByName = new Map(cards.filter(r => !r.email).map(r => [tsNameKey(r.operator_name || "", ""), r]));
  const today = new Date(new Date().toDateString());

  rows.forEach(x => {
    const cells = {};
    const card = cardByEmail.get(x.email) || (x.account && cardByEmail.get(mail(x.account.email)))
      || cardByName.get(tsNameKey(x.name, ""));
    if (card) {
      const [label, cls] = certStatusNow(card), date = card.expiration_date ? String(card.expiration_date).slice(0, 10) : "";
      const days = date ? Math.round((new Date(date + "T00:00:00") - today) / 86400000) : null;
      // As the Forklift Center counts them: expiring is its own rule.
      cells.forklift = label === "Removed" ? { tone: "bad", text: "Removed", csv: "Removed" }
        : label === "Expired" ? { tone: "bad", text: `Expired ${fmtDate(date)}`, csv: `${date} (expired)`, days }
        : cls === "b-expiring" ? { tone: "warn", text: days === 1 ? "1 day left" : `${days} days left`, sub: fmtDate(date), csv: date, days }
        : cls === "b-current" ? { tone: "ok", text: date ? `Until ${fmtDate(date)}` : label, csv: date || label, days }
        // Passed the online course, waiting on a driving test.
        : { tone: "wait", text: label, csv: label };
    } else cells.forklift = LC_NONE;

    const crane = x.roster ? craneStatus(x.roster) : { kind: "none" };
    cells.crane = crane.kind === "removed" ? { tone: "bad", text: "Removed", csv: "Removed" }
      : crane.kind === "none" ? LC_NONE
      : lcDated(crane.expires ? craneIso(crane.expires) : null, 60, "Qualified");

    const epa = epaCertFor(x.roster || { employee_number: x.number, email: x.email });
    cells.epa = (x.roster && x.roster.epa_609) || epa
      ? { tone: "ok", text: epa && epa.certified_on ? `Since ${fmtDate(epa.certified_on)}` : "Certified", csv: "Certified" }
      : LC_NONE;

    const mine = lcCerts.filter(c => (x.account && c.user_id === x.account.id)
      || (c.employee_number && x.number && num(c.employee_number) === x.number) || (c.email && x.email && mail(c.email) === x.email));
    CERT_KINDS.forEach(k => {
      const c = mine.find(m => m.kind === k.id);
      if (!c) { cells[k.id] = LC_NONE; return; }
      const detail = c.name && c.name !== k.name ? c.name : "";
      cells[k.id] = { ...lcDated(c.expires_on, LC_SOON_DAYS), detail, cert: c };
    });
    x.cells = cells;
    x.holds = LC_COLUMNS.filter(col => cells[col.id].tone !== "none").length;
    x.attention = LC_COLUMNS.some(col => cells[col.id].tone === "bad" || cells[col.id].tone === "warn");
  });
  rows.sort((a, b) => a.name.localeCompare(b.name));

  // The four, run out or running out: what the Overview's To do lists.
  const flagged = (tone) => rows.flatMap(x => CERT_KINDS.filter(k => x.cells[k.id].tone === tone)
    .map(k => ({ who: x.name, kind: k.name, cell: x.cells[k.id] })))
    .sort((a, b) => (a.cell.days ?? 0) - (b.cell.days ?? 0) || a.who.localeCompare(b.who));
  const count = (id, tone) => rows.filter(x => tone ? x.cells[id].tone === tone : x.cells[id].tone !== "none").length;
  return { name, rows, expired: flagged("bad"), expiring: flagged("warn"), count };
}

// A crane expiry is a Date; the cells take "yyyy-mm-dd".
function craneIso(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function renderLocationCerts() {
  const box = $("lxCerts");
  if (!box) return;
  const loc = lxCurrent();
  if (!loc) {
    box.innerHTML = `<div class="card"><p class="note">You aren't the admin of a location yet.</p></div>`;
    return;
  }
  if (lcNotSetUp) {
    box.innerHTML = `<div class="card"><p class="error">Run migration 0130_tracked_certifications.sql in the SQL editor, then reload this page.</p></div>`;
    return;
  }
  const { name, rows, count } = lcFigures(loc);
  const flaggedOf = (x) => lcShow === "all" ? x.attention : ["bad", "warn"].includes(x.cells[lcShow].tone);
  const holding = lcShow === "all" ? rows : rows.filter(x => x.cells[lcShow].tone !== "none");
  const shown = lcFilter === "attention" ? holding.filter(flaggedOf) : holding;
  const expiredN = rows.reduce((n, x) => n + LC_COLUMNS.filter(c => x.cells[c.id].tone === "bad").length, 0);
  const soonN = rows.reduce((n, x) => n + LC_COLUMNS.filter(c => x.cells[c.id].tone === "warn").length, 0);
  const columns = lcShow === "all" ? LC_COLUMNS : LC_COLUMNS.filter(c => c.id === lcShow);

  const cell = (x, col) => {
    const c = x.cells[col.id];
    if (c.tone === "none") return `<td class="lc-none" aria-label="None">—</td>`;
    return `<td><span class="lc-cell lc-${c.tone}">${esc(c.text)}</span>${c.sub ? `<small>${esc(c.sub)}</small>` : ""}${
      c.detail ? `<small>${esc(c.detail)}</small>` : ""}${c.cert && c.cert.photo_path
      ? `<button type="button" class="lc-pic" data-lc-photo="${esc(c.cert.id)}" aria-label="${esc(`${x.name}'s ${col.name} card`)}">${icon("camera", 13)}Card</button>` : ""}</td>`;
  };
  const tile = (col) => {
    const have = count(col.id), bad = count(col.id, "bad"), warn = count(col.id, "warn");
    return sxTile(col.name, sxNum(have), !have ? "Nobody yet" : bad || warn ? `${warn} expiring · ${bad} expired` : "All current",
      { lit: bad ? "red" : warn ? "amber" : have ? "green" : "steel", hot: bad > 0 });
  };

  box.innerHTML = `<div class="sx lx lc" style="${lit("slate")}">
    <div class="lx-pdfbar"><span class="msg" role="status"></span>
      <button type="button" class="ghost" data-lc-csv>${icon("doc", 15)}Download spreadsheet</button>
      <button type="button" data-lx-pdf>${icon("doc", 15)}Export PDF</button></div>
    <section class="sx-hero lx-hero">
      <div class="sx-hero-text">
        <span class="sx-kicker">${esc(name)} · ${lxPlural(rows.length, "person", "people")}</span>
        <h2>${expiredN || soonN ? `${expiredN} expired · ${soonN} expiring` : "Nothing has run out"}</h2>
        <p>Who holds what at ${esc(name)}, and when it runs out. ${expiredN ? `<b>${lxPlural(expiredN, "certification has", "certifications have")} run out.</b> ` : ""}${
          soonN ? `${soonN} ${soonN === 1 ? "runs" : "run"} out soon: within ${LC_SOON_DAYS} days for the four people add themselves, 60 for forklift and crane.` : ""}${
          expiredN || soonN ? "" : `<b class="ok">Every certification held here is current.</b>`}</p>
      </div>
    </section>

    ${lcError && !lcNotSetUp ? `<p class="error">The certifications people added couldn't be loaded: ${esc(lcError)}</p>` : ""}
    <div class="sx-tiles lc-tiles lc-three">${LC_COLUMNS.slice(0, 3).map(tile).join("")}</div>
    <div class="sx-tiles lc-tiles lc-four">${CERT_KINDS.map(tile).join("")}</div>

    <section class="sx-panel sx-full" style="${lit(expiredN ? "red" : soonN ? "amber" : "green")}">
      <header><h3>Who has what</h3><span>${lcShow === "all" ? lxPlural(shown.length, "person", "people")
        : `${lxPlural(holding.length, "person", "people")} with ${esc(LC_COLUMNS.find(c => c.id === lcShow).name)}`}</span></header>
      <div class="sx-who-bar">
        <div class="sx-who-pills">${[["all", "Everyone", holding.length], ["attention", "Expiring or expired", holding.filter(flaggedOf).length]].map(([id, label, n]) =>
          `<button type="button" class="sx-who-pill${lcFilter === id ? " on" : ""}" data-lc-filter="${id}">${label}<span>${n}</span></button>`).join("")}</div>
        <label class="lc-show">Show <select id="lcShow" class="tx-store" aria-label="Which certification">
          <option value="all"${lcShow === "all" ? " selected" : ""}>Every certification</option>
          ${LC_COLUMNS.map(c => `<option value="${c.id}"${lcShow === c.id ? " selected" : ""}>Only ${esc(c.name)}</option>`).join("")}
        </select></label>
      </div>
      ${shown.length ? `<div class="lc-scroll"><table class="lc-table">
        <thead><tr><th scope="col">Name</th>${columns.map(c => `<th scope="col">${esc(c.short)}</th>`).join("")}</tr></thead>
        <tbody>${shown.map(x => `<tr><th scope="row" class="lc-who"><b>${esc(x.name)}</b>${x.job ? `<small>${esc(x.job)}</small>` : ""}</th>${
          columns.map(c => cell(x, c)).join("")}</tr>`).join("")}</tbody></table></div>`
        : `<p class="sx-empty${lcFilter === "attention" ? " sx-clear" : ""}">${lcFilter === "attention"
          ? `${icon("checkCircle", 18)} Nothing at ${esc(name)} has run out or is about to.`
          : lcShow !== "all" ? `Nobody at ${esc(name)} has ${esc(LC_COLUMNS.find(c => c.id === lcShow).name)} on record.`
          : `Nobody is on the UKG roster or has an app account at ${esc(name)} yet.`}</p>`}
      <p class="sx-sub">DOT Medical Card, Welding Certification, CPR and First Aid are optional. Each person adds their own in the app, under HR, My Certifications, with when it expires and a picture of the card; they're reminded before it runs out. Anything else they add there stays private. Forklift cards come from the Forklift Center, crane and rigging from ${esc(craneCourse())}, and EPA 609 from the Training Manager.</p>
    </section>
  </div>`;
}

function lcSpreadsheet(loc) {
  const { name, rows } = lcFigures(loc);
  const head = ["Name", "Job", "Work email", ...LC_COLUMNS.flatMap(c => CERT_KINDS.includes(c) ? [c.name, `${c.name} details`] : [c.name])];
  const body = rows.map(x => [x.name, x.job, x.email, ...LC_COLUMNS.flatMap(c => {
    const cell = x.cells[c.id];
    return CERT_KINDS.includes(c) ? [cell.csv, [cell.detail, cell.cert && cell.cert.issued_by, cell.cert && cell.cert.number && `#${cell.cert.number}`]
      .filter(Boolean).join(" · ")] : [cell.csv];
  })]);
  downloadCSV(`${name} Certifications ${fvToday()}.csv`, [head, ...body]);
  return name;
}

$("admin").addEventListener("change", (event) => {
  if (event.target.id === "lcShow") { lcShow = event.target.value; renderLocationCerts(); }
});
$("admin").addEventListener("click", async (event) => {
  const pill = event.target.closest("[data-lc-filter]");
  if (pill) { lcFilter = pill.dataset.lcFilter; return renderLocationCerts(); }
  const jump = event.target.closest("[data-lx-tab]");
  if (jump) { const tab = document.querySelector(`#locationNav [data-tab="${jump.dataset.lxTab}"]`); if (tab) tab.click(); return; }
  const csv = event.target.closest("[data-lc-csv]");
  if (csv) {
    const row = csv.closest(".lx-pdfbar");
    try { speak(row, `Downloaded the ${lcSpreadsheet(lxCurrent())} certifications.`, false); }
    catch (e) { speak(row, `Couldn't make it: ${e.message}`, true); }
    return;
  }
  const photo = event.target.closest("[data-lc-photo]");
  if (photo) {
    const c = lcCerts.find(x => x.id === photo.dataset.lcPhoto);
    if (!c || !c.photo_path) return;
    // Opened straight away so the browser doesn't take it for a pop-up, then pointed at the picture.
    const tab = window.open("", "_blank");
    const { data, error } = await db.storage.from("personal-certificates").createSignedUrl(c.photo_path, 600);
    if (error || !data) { if (tab) tab.close(); return alert(error ? error.message : "The picture couldn't be opened."); }
    if (tab) tab.location = data.signedUrl; else window.location.href = data.signedUrl;
  }
});
