// Social: the Fitness Challenge
//
// The month's leaderboard and your place on Social, and the admin page's
// rules for each month.

// ---- the Fitness Challenge (0089) -----------------------------------------------
//
// A competition every month, scored from Apple Health, with a fresh leaderboard
// on the 1st. Joining is in the app, on an iPhone, where Health is; this page
// shows the leaderboard on Social, and owners pick each month's rules and their
// points on the admin page's Fitness Challenge tab. A month nobody set up
// carries on with the last one's rules. The database does the scoring
// (fitness_points), so the app and this page can't disagree on a score.

let fxKinds = [], fxChallenges = [], fxBoard = [], fxEffective = null;
let fxError = null, fxNotSetUp = false;
let fxMonth = null;              // the month Social shows, "2026-10-01"
let fxBoardMonth = null;         // the month fxBoard is for
let fxTab = "people", fxOpen = null;
let fxAdminMonth = null, fxDraft = null;
// The first month there was a challenge: the month lists stop here.
const FX_FIRST = "2026-10-01";
// What a month runs before any month has been set up: the database's default too.
const FX_DEFAULT = [{ id: "move_ring", points: 10 }, { id: "exercise_ring", points: 10 }, { id: "stand_ring", points: 10 },
  { id: "all_rings", points: 10 }, { id: "steps_goal", points: 10, value: 10000 }, { id: "streak_rings", points: 25, value: 7 }];

const fxMonthKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
const fxThisMonth = () => fxMonthKey(new Date());
const fxMonthName = (key) => dateOnly(key).toLocaleDateString("en-US", { month: "long", year: "numeric" });
const fxAddMonths = (key, n) => { const d = dateOnly(key); return fxMonthKey(new Date(d.getFullYear(), d.getMonth() + n, 1)); };

async function loadFitness(month = fxMonth || fxThisMonth()) {
  const [kinds, all, eff, board] = await Promise.all([
    fxKinds.length ? Promise.resolve({ data: fxKinds }) : db.from("fitness_rule_kinds").select("*").order("sort_order"),
    db.from("fitness_challenges").select("*").order("month"),
    db.rpc("fitness_challenge_for", { for_month: month }),
    db.rpc("fitness_leaderboard", { for_month: month })
  ]);
  const err = kinds.error || all.error || eff.error || board.error;
  if (err) {
    fxError = err.message || "unknown";
    fxNotSetUp = /does not exist|schema cache|Could not find/i.test(fxError);
    return;
  }
  fxError = null; fxNotSetUp = false;
  fxKinds = kinds.data || [];
  fxChallenges = all.data || [];
  fxEffective = (eff.data || [])[0] || null;
  fxBoard = board.data || [];
  fxMonth = fxBoardMonth = month;
}

// ---- wording, the same as the app's ----------------------------------------------

const fxKind = (id) => fxKinds.find(k => k.id === id);
const fxNum = (n) => Number(n).toLocaleString("en-US", { maximumFractionDigits: 1 });

// "Walk 10,000 steps in a day".
function fxLabel(rule) {
  const k = fxKind(rule.id);
  if (!k) return rule.id;
  const v = rule.value ?? k.default_value;
  return k.label.replace("{value}", v == null ? "" : fxNum(v));
}

const FX_PER = { day: "a day", unit: "each", run: "each time", week: "a week", weekend: "a weekend", month: "once" };

// "10 pts a day".
function fxWorth(rule) {
  const k = fxKind(rule.id) || {};
  const pts = `${fxNum(rule.points)} ${Number(rule.points) === 1 ? "pt" : "pts"}`;
  return k.per && k.per !== "month" ? `${pts} ${FX_PER[k.per]}` : pts;
}

// "12 days" — how often a rule scored for someone.
function fxTimes(line) {
  const k = fxKind(line.id) || {}, n = Math.round(Number(line.count));
  const s = (word) => `${n} ${word}${n === 1 ? "" : "s"}`;
  return ({ day: s("day"), run: s("time"), week: s("week"), weekend: s("weekend"), month: "Done" })[k.per] || n.toLocaleString("en-US");
}

const fxRules = () => ((fxEffective && fxEffective.rules) || []).filter(r => Number(r.points) > 0)
  .sort((a, b) => ((fxKind(a.id) || {}).sort_order || 999) - ((fxKind(b.id) || {}).sort_order || 999));
const fxPlace = (s) => fxBoard.findIndex(x => x.points === s.points) + 1;
const fxTitle = () => (fxEffective && fxEffective.title) || `${dateOnly(fxMonth || fxThisMonth()).toLocaleDateString("en-US", { month: "long" })} Fitness Challenge`;

function fxDaysLeft() {
  const start = dateOnly(fxMonth), next = new Date(start.getFullYear(), start.getMonth() + 1, 1);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return Math.max(0, Math.round((next - today) / 86400000));
}

// Each location's average per person who joined, so a small location can beat a big one.
function fxShops() {
  const by = {};
  fxBoard.forEach(s => { const k = s.location || "No location"; (by[k] = by[k] || []).push(s); });
  return Object.entries(by).map(([name, people]) => ({ name, members: people.length,
    avg: people.reduce((t, s) => t + s.points, 0) / people.length }))
    .sort((a, b) => b.avg - a.avg || a.name.localeCompare(b.name));
}

function fxMonths() {
  const out = [];
  for (let m = fxThisMonth(); m >= FX_FIRST && out.length < 36; m = fxAddMonths(m, -1)) out.push(m);
  return out.length ? out : [fxThisMonth()];
}

// ---- on Social --------------------------------------------------------------------

// The door on the Social page.
function fxDoorHtml() {
  const current = fxBoardMonth === fxThisMonth(), leader = current && fxBoard[0];
  const mine = current && fxBoard.find(s => s.user_id === me.id);
  return `<h2 class="group-title">Fitness</h2>
    <button type="button" class="cab-card cm-door" data-view="fitness" style="${lit("green")}">
      <span class="cm-door-glyph">${icon("fitness", 24)}</span>
      <span class="cm-door-main">
        <b>Fitness Challenge</b>
        <span>Steps, rings and workouts from Apple Health. A new competition and a fresh leaderboard every month.</span>
        ${mine ? `<span class="cm-latest">You're #${fxPlace(mine)} of ${fxBoard.length} · ${fxNum(mine.points)} pts</span>`
          : leader ? `<span class="cm-latest">${esc(leader.full_name || "Someone")} leads with ${fxNum(leader.points)} pts · ${fxDaysLeft()} days left</span>` : ""}
        <span class="cm-go">See the leaderboard &rarr;</span>
      </span>
    </button>`;
}

function fitnessView() {
  setTimeout(() => fxRefresh(fxMonth || fxThisMonth()));
  const head = hero("Fitness Challenge", "Steps, rings and workouts from Apple Health. A fresh leaderboard every month.");
  if (fxNotSetUp || fxError) {
    return head + `<div class="cm"><div class="cm-card cm-empty">
      <b>${fxNotSetUp ? "The Fitness Challenge isn't switched on yet" : "The leaderboard couldn't be loaded"}</b>
      <p>${fxNotSetUp ? "It opens once the database is ready for it." : "Try again in a minute."}</p></div></div>`;
  }
  return head + `<div class="cm fx" id="fxPage">${fxPageHtml()}</div>`;
}

async function fxRefresh(month) {
  await loadFitness(month);
  const page = $("fxPage");
  if (page && !$("view").classList.contains("hidden")) page.innerHTML = fxPageHtml();
}

function fxPageHtml() {
  const current = fxMonth === fxThisMonth(), mine = fxBoard.find(s => s.user_id === me.id);
  const prize = fxEffective && fxEffective.prize;
  const stat = (value, label) => `<div><span class="cm-stat"><b>${value}</b><small>${esc(label)}</small></span></div>`;
  const rules = fxRules();
  const cap = fxEffective && fxEffective.daily_cap;
  return `<div class="cm-card fx-hero">
      <p class="cm-eyebrow">${icon("fitness", 15)}Fitness Challenge · ${esc(fxMonthName(fxMonth))}</p>
      <h2 class="fx-title">${esc(fxTitle())}</h2>
      ${prize ? `<p class="fx-prize">${icon("trophy", 16)}${esc(prize)}</p>` : ""}
      <div class="cm-stats fx-stats">
        ${mine ? stat(`#${fxPlace(mine)}`, `of ${fxBoard.length} · ${fxNum(mine.points)} pts`) : stat(fxBoard.length, fxBoard.length === 1 ? "person in" : "people in")}
        ${current ? stat(fxDaysLeft(), fxDaysLeft() === 1 ? "day left" : "days left") : stat("Final", "standings")}
        <div class="fx-month"><label for="fxMonth">Month</label>
          <select id="fxMonth">${fxMonths().map(m => `<option value="${m}"${m === fxMonth ? " selected" : ""}>${esc(fxMonthName(m))}</option>`).join("")}</select></div>
      </div>
    </div>
    ${current && !mine ? `<div class="cm-card fx-join">
      <b>Join from the app on your iPhone</b>
      <p>Social, then Fitness Challenge. It reads your daily totals from Apple Health, so joining can't be done from
        here. Coworkers see your name, location, points and how you earned them, never your daily numbers.</p></div>` : ""}
    <div class="cm-kind fx-tabs" role="group" aria-label="Leaderboard">
      <button type="button" class="${fxTab === "people" ? "on" : ""}" data-fx-tab="people" aria-pressed="${fxTab === "people"}">${icon("person", 15)}People</button>
      <button type="button" class="${fxTab === "shops" ? "on" : ""}" data-fx-tab="shops" aria-pressed="${fxTab === "shops"}">${icon("building", 15)}Locations</button>
    </div>
    ${!fxBoard.length ? `<p class="cm-none">${current ? "Nobody's joined yet this month." : "Nobody took part that month."}</p>`
      : fxTab === "people" ? `<div class="cm-card fx-board">${fxBoard.map(fxPersonHtml).join("")}</div>`
      : `<div class="cm-card fx-board">${fxShopsHtml()}</div>
         <p class="cm-none">Each location's average points per person who joined, so a small location can beat a big one.</p>`}
    <h2 class="group-title">How to score</h2>
    <div class="cm-card fx-rules">
      ${rules.map(r => { const k = fxKind(r.id) || {};
        return `<div class="fx-rule-line"><span><b>${esc(fxLabel(r))}</b>${k.detail ? `<small>${esc(k.detail)}</small>` : ""}</span>
          <em>${esc(fxWorth(r))}</em></div>`; }).join("")}
      ${cap ? `<p class="fx-foot">At most ${fxNum(cap)} points a day from the daily rules; streaks, weeks and the month's total come on top.</p>` : ""}
      ${rules.some(r => (fxKind(r.id) || {}).needs_watch) ? `<p class="fx-foot">Exercise and stand come from an Apple Watch.</p>` : ""}
      <p class="fx-foot">Anything typed into the Health app by hand doesn't count.</p>
    </div>`;
}

function fxBadge(place) {
  return `<span class="fx-place${place <= 3 ? ` p${place}` : ""}">${place}</span>`;
}

function fxPersonHtml(s) {
  const open = fxOpen === s.user_id, mine = s.user_id === me.id;
  const lines = s.breakdown || [];
  const total = lines.reduce((t, l) => t + Number(l.points), 0);
  const cap = fxEffective && fxEffective.daily_cap;
  return `<div class="fx-row${mine ? " mine" : ""}${open ? " open" : ""}">
    <button type="button" class="fx-person" data-fx-person="${esc(s.user_id)}" aria-expanded="${open}">
      ${fxBadge(fxPlace(s))}${cmAvatar(s.full_name, 34)}
      <span class="fx-who"><b>${esc(s.full_name || "Someone")}${mine ? " (you)" : ""}</b><small>${esc(s.location || "")}</small></span>
      <span class="fx-pts"><b>${fxNum(s.points)}</b><small>pts</small></span>
    </button>
    ${open ? `<div class="fx-lines">
      ${lines.length ? lines.map(l => `<div><span>${esc(fxLabel((fxRules().find(r => r.id === l.id)) || { id: l.id }))}
          <small>${esc(fxTimes(l))}</small></span><em>${fxNum(l.points)} pts</em></div>`).join("")
        : `<p>No points yet this month.</p>`}
      ${cap && total > s.points ? `<p>The ${fxNum(cap)}-a-day cap trims these to ${fxNum(s.points)}.</p>` : ""}
      ${s.last_synced ? `<p>Updated ${esc(cmWhen(s.last_synced))} · ${s.days_synced} ${s.days_synced === 1 ? "day" : "days"} this month. Daily numbers stay private.</p>` : ""}
    </div>` : ""}
  </div>`;
}

function fxShopsHtml() {
  const shops = fxShops(), top = Math.max(1, shops.length ? shops[0].avg : 1);
  return shops.map((s, i) => `<div class="fx-row"><div class="fx-person fx-shop">
      ${fxBadge(i + 1)}
      <span class="fx-who"><b>${esc(s.name)}</b><small>${s.members} ${s.members === 1 ? "person" : "people"} in</small>
        <i class="fx-bar"><i style="width:${Math.round(s.avg / top * 100)}%"></i></i></span>
      <span class="fx-pts"><b>${fxNum(Math.round(s.avg * 10) / 10)}</b><small>avg pts</small></span>
    </div></div>`).join("");
}

$("view").addEventListener("click", (event) => {
  const tab = event.target.closest("[data-fx-tab]");
  if (tab) { fxTab = tab.dataset.fxTab; fxOpen = null; $("fxPage").innerHTML = fxPageHtml(); return; }
  const person = event.target.closest("[data-fx-person]");
  if (person) {
    fxOpen = fxOpen === person.dataset.fxPerson ? null : person.dataset.fxPerson;
    $("fxPage").innerHTML = fxPageHtml();
    const again = document.querySelector(`[data-fx-person="${CSS.escape(person.dataset.fxPerson)}"]`);
    if (again) again.focus();
  }
});

$("view").addEventListener("change", (event) => {
  if (event.target.id !== "fxMonth") return;
  fxOpen = null;
  fxRefresh(event.target.value);
});

// ---- on the admin page: each month's rules -------------------------------------------

// What the editor starts from: the month's own setup, or the one it carries
// over, or the standard set. Title and prize belong to their own month.
function fxDraftFor(month) {
  const own = fxChallenges.find(c => c.month === month);
  const before = fxChallenges.filter(c => c.month < month).sort((a, b) => b.month.localeCompare(a.month))[0];
  const from = own || before;
  return { month, title: own ? own.title : "", prize: own ? own.prize : "",
    daily_cap: from && from.daily_cap ? String(from.daily_cap) : "",
    rules: new Map(((from && from.rules) || FX_DEFAULT).map(r => [r.id, { points: String(r.points), value: r.value == null ? "" : String(r.value) }])),
    own: !!own, carriedFrom: own ? null : before ? before.month : null };
}

function renderFitnessAdmin() {
  const host = $("fitnessAdmin");
  if (!host) return;
  if (fxNotSetUp || fxError) {
    host.innerHTML = `<div class="card"><p class="error">${fxNotSetUp
      ? "Run migration 0089_fitness.sql in the SQL editor, then reload this page." : esc(fxError || "")}</p></div>`;
    return;
  }
  if (!fxAdminMonth) fxAdminMonth = fxThisMonth();
  if (!fxDraft || fxDraft.month !== fxAdminMonth) fxDraft = fxDraftFor(fxAdminMonth);
  const d = fxDraft, now = fxThisMonth();
  const months = [fxAddMonths(now, 3), fxAddMonths(now, 2), fxAddMonths(now, 1), ...fxMonths()];
  const state = d.own ? `Set up for ${fxMonthName(d.month)}${(fxChallenges.find(c => c.month === d.month) || {}).updated_by_name
      ? ` by ${(fxChallenges.find(c => c.month === d.month)).updated_by_name}` : ""}.`
    : d.carriedFrom ? `Not set up: ${fxMonthName(d.month)} carries on with ${fxMonthName(d.carriedFrom)}'s rules. Save to give it its own.`
    : `Not set up yet: ${fxMonthName(d.month)} uses the standard rules (rings, 10,000 steps and a week's streak). Save to change them.`;
  const groups = [...new Set(fxKinds.map(k => k.category))];
  host.innerHTML = `<div class="card fx-admin">
      <h2>The month</h2>
      <p class="note">A competition every month, scored from Apple Health, with a fresh leaderboard on the 1st. People
        join in the app on their iPhone. Pick the month's rules and what each is worth; a month you don't set up carries
        on with the last one's. Changing a month's rules rescores everyone in it straight away.</p>
      <div class="fields">
        <div><label for="fxAdminMonth">Month</label>
          <select id="fxAdminMonth">${months.map(m => `<option value="${m}"${m === d.month ? " selected" : ""}>${esc(fxMonthName(m))}${
            m === now ? " (this month)" : m > now ? " (coming up)" : ""}${fxChallenges.some(c => c.month === m) ? "" : " · not set up"}</option>`).join("")}</select></div>
        <div><label for="fxAdminCap">Most points a day (optional)</label>
          <input id="fxAdminCap" type="number" min="1" max="100000" step="1" data-fx-field="daily_cap" value="${esc(d.daily_cap)}"
            placeholder="No limit"></div>
        <div class="wide"><label for="fxAdminTitle">Title (optional)</label>
          <input id="fxAdminTitle" type="text" maxlength="80" data-fx-field="title" value="${esc(d.title)}"
            placeholder="${esc(dateOnly(d.month).toLocaleDateString("en-US", { month: "long" }))} Fitness Challenge"></div>
        <div class="wide"><label for="fxAdminPrize">Prize (optional)</label>
          <input id="fxAdminPrize" type="text" maxlength="500" data-fx-field="prize" value="${esc(d.prize)}"
            placeholder="A Fendt jacket for the winner, and lunch for the top location"></div>
      </div>
      <p class="fx-state">${esc(state)}</p>
    </div>
    <div class="card fx-admin">
      <h2>Rules <span class="fx-count">${d.rules.size} picked</span></h2>
      <p class="note">Tick the rules for ${esc(fxMonthName(d.month))} and set their points. The cap above limits what the
        daily and "each" rules add up to on any one day; streaks, weeks and month totals come on top.
        Rules marked <span class="fx-watch">Apple Watch</span> score nothing for someone with only a phone.</p>
      ${groups.map(g => `<h3 class="fx-group">${esc(g)}</h3>
        ${fxKinds.filter(k => k.category === g).map(fxAdminRuleHtml).join("")}`).join("")}
      <div class="row" style="margin-top:14px">
        <button type="button" data-fx-act="save">Save ${esc(fxMonthName(d.month))}</button>
        ${d.own ? `<button type="button" class="ghost" data-fx-act="unset" title="Delete this month's own setup">Carry over the month before instead</button>` : ""}
        <button type="button" class="ghost" data-fx-act="standard">Start from the standard rules</button>
      </div>
      <p class="msg" style="margin:8px 0 0"></p>
    </div>`;
}

function fxAdminRuleHtml(k) {
  const r = fxDraft.rules.get(k.id), on = !!r, id = esc(k.id);
  const pts = on ? r.points : String(k.default_points);
  const val = on && r.value !== "" ? r.value : (k.default_value == null ? "" : String(k.default_value));
  const [before, after] = k.label.split("{value}");
  // The rule's number sits in its sentence: "Walk [10000] steps in a day".
  const text = k.value_unit
    ? `<label for="fx-on-${id}">${esc(before)}</label><input type="number" class="fx-val" data-fx-val="${id}" min="0.1" step="any"
         value="${esc(val)}" aria-label="${esc(k.value_unit)}"><label for="fx-on-${id}">${esc(after || "")}</label>`
    : `<label for="fx-on-${id}">${esc(k.label)}</label>`;
  return `<div class="fx-pick${on ? " on" : ""}">
    <input type="checkbox" id="fx-on-${id}" data-fx-on="${id}"${on ? " checked" : ""}>
    <div class="fx-pick-main"><div class="fx-pick-label">${text}</div>
      ${k.detail ? `<small>${esc(k.detail)}</small>` : ""}${k.needs_watch ? `<span class="fx-watch">Apple Watch</span>` : ""}</div>
    <div class="fx-pick-pts"><input type="number" min="0" max="1000" step="1" data-fx-pts="${id}" value="${esc(pts)}"
        aria-label="Points for ${esc(k.label.replace("{value}", val))}"><span>${esc(k.per === "month" ? "pts once" : `pts ${FX_PER[k.per]}`)}</span></div>
  </div>`;
}

$("admin").addEventListener("input", (event) => {
  const t = event.target, d = fxDraft;
  if (!d || !t.closest || !t.closest("#fitnessAdmin")) return;
  if (t.dataset.fxField) { d[t.dataset.fxField] = t.value; return; }
  const id = t.dataset.fxPts || t.dataset.fxVal;
  if (!id) return;
  // Changing a rule's points or number picks it.
  const k = fxKind(id);
  const row = d.rules.get(id) || { points: String(k.default_points), value: k.default_value == null ? "" : String(k.default_value) };
  if (t.dataset.fxPts) row.points = t.value; else row.value = t.value;
  if (!d.rules.has(id)) {
    d.rules.set(id, row);
    const box = $(`fx-on-${id}`);
    if (box) { box.checked = true; box.closest(".fx-pick").classList.add("on"); }
    fxCountPicked();
  }
});

function fxCountPicked() {
  const n = document.querySelector("#fitnessAdmin .fx-count");
  if (n) n.textContent = `${fxDraft.rules.size} picked`;
}

$("admin").addEventListener("change", (event) => {
  const t = event.target;
  if (!t.closest || !t.closest("#fitnessAdmin")) return;
  if (t.id === "fxAdminMonth") { fxAdminMonth = t.value; fxDraft = null; return renderFitnessAdmin(); }
  const id = t.dataset.fxOn;
  if (!id) return;
  if (t.checked) {
    const pick = t.closest(".fx-pick");
    fxDraft.rules.set(id, { points: pick.querySelector("[data-fx-pts]").value,
      value: (pick.querySelector("[data-fx-val]") || {}).value || "" });
  } else {
    fxDraft.rules.delete(id);
  }
  t.closest(".fx-pick").classList.toggle("on", t.checked);
  fxCountPicked();
});

$("admin").addEventListener("click", async (event) => {
  const b = event.target.closest("[data-fx-act]");
  if (!b) return;
  const card = b.closest(".card"), d = fxDraft;
  if (b.dataset.fxAct === "standard") {
    d.rules = new Map(FX_DEFAULT.map(r => [r.id, { points: String(r.points), value: r.value == null ? "" : String(r.value) }]));
    return renderFitnessAdmin();
  }
  if (b.dataset.fxAct === "unset") {
    if (!confirm(`Delete ${fxMonthName(d.month)}'s own rules, title and prize? It carries on with the month before's rules instead.`)) return;
    const { error } = await db.from("fitness_challenges").delete().eq("month", d.month);
    if (error) return speak(card, error.message, true);
    await loadFitness(fxMonth || fxThisMonth());
    fxDraft = null;
    renderFitnessAdmin();
    return;
  }
  // Save: every picked rule, in the catalog's order, with its points and number.
  const rules = [];
  for (const k of fxKinds) {
    const r = d.rules.get(k.id);
    if (!r) continue;
    const points = Number(r.points);
    if (r.points === "" || !Number.isFinite(points) || points < 0 || points > 1000) {
      return speak(card, `Give "${k.label.replace("{value}", "…")}" points from 0 to 1,000.`, true);
    }
    const rule = { id: k.id, points };
    if (k.value_unit) {
      const value = Number(r.value === "" ? k.default_value : r.value);
      if (!Number.isFinite(value) || value <= 0) return speak(card, `"${k.label.replace("{value}", "…")}" needs a number more than 0.`, true);
      rule.value = value;
    }
    rules.push(rule);
  }
  if (!rules.length) return speak(card, "Pick at least one rule.", true);
  const cap = d.daily_cap === "" ? null : Math.round(Number(d.daily_cap));
  if (cap !== null && !(cap >= 1 && cap <= 100000)) return speak(card, "The most points a day must be a whole number from 1, or left empty.", true);
  b.disabled = true;
  const { error } = await db.from("fitness_challenges")
    .upsert({ month: d.month, title: d.title.trim(), prize: d.prize.trim(), daily_cap: cap, rules }, { onConflict: "month" });
  b.disabled = false;
  if (error) return speak(card, error.message, true);
  await loadFitness(fxMonth || fxThisMonth());
  fxDraft = null;
  renderFitnessAdmin();
  const again = document.querySelector("#fitnessAdmin [data-fx-act='save']");
  if (again) speak(again.closest(".card"), `Saved. ${fxMonthName(d.month)} scores with these rules now.`, false);
});
