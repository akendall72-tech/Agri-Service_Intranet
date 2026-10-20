// Social: Trivia
//
// Rounds of questions about AGCO and its machines on Social, with a
// leaderboard for every game, and the admin page's Trivia tab for the games,
// the questions and their categories.

// ---- Trivia (0107) ----------------------------------------------------------
//
// Owners set up games on the admin page: when one runs, the categories it
// draws from, how long a round is, what a right answer is worth, and which
// rules from the database's catalog it plays by. People join a game to go on
// its leaderboard; practice is open to anyone, any time, and never counts.
//
// The database runs every round (trivia_start, trivia_turn, trivia_answer), so
// this page never has a right answer before it's been given and can't make up
// a score. After every answer comes the right one and why: that's the point.

let tvCategories = [], tvKinds = [], tvGames = [], tvMine = [], tvMyCats = [];
let tvError = null, tvNotSetUp = false;
let tvGameId = null;                  // the game page that's open
let tvBoard = [], tvBoardFor = null;  // its leaderboard
let tvRounds = [];                    // your rounds in it, newest first
let tvTab = "people", tvOpenPerson = null, tvOpenRound = null;
const tvReviews = {};                 // rounds looked back on, by id
let tvPlay = null, tvTimer = null, tvStarting = false;
// The admin page's.
let tvQuestions = [], tvStats = {}, tvQError = null;
let tvGameDraft = null, tvQDraft = null;
const tvQFilter = { category: "", show: "active", text: "" };

const TV_LETTERS = "ABCD";
const TV_LEVELS = ["", "Easy", "Medium", "Hard"];
const TV_ACCENTS = ["amber", "green", "teal", "violet", "slate", "ember", "red"];
// What a new game starts from: quick answers, streaks and a perfect round pay,
// one 50/50, and a round a day, so the leaderboard rewards coming back.
const TV_STANDARD = [{ id: "speed_bonus", value: 50 }, { id: "streak_bonus", value: 25 }, { id: "final_double" },
  { id: "perfect_round", value: 200 }, { id: "daily_limit", value: 1 }, { id: "fifty_fifty", value: 1 }];

async function loadTrivia() {
  const [cats, kinds, games, mine, myCats] = await Promise.all([
    db.from("trivia_categories").select("*").order("sort_order"),
    tvKinds.length ? Promise.resolve({ data: tvKinds }) : db.from("trivia_rule_kinds").select("*").order("sort_order"),
    db.from("trivia_games").select("*").order("starts_on", { ascending: false }),
    db.rpc("trivia_my_games"),
    db.rpc("trivia_my_categories")
  ]);
  const err = cats.error || kinds.error || games.error || mine.error || myCats.error;
  if (err) {
    tvError = err.message || "unknown";
    tvNotSetUp = /does not exist|schema cache|Could not find/i.test(tvError);
    return;
  }
  tvError = null; tvNotSetUp = false;
  tvCategories = cats.data || [];
  tvKinds = kinds.data || [];
  tvGames = games.data || [];
  tvMine = mine.data || [];
  tvMyCats = myCats.data || [];
  if (isOwner()) await loadTriviaQuestions();
}

// Owners only: every question, and how each has gone.
async function loadTriviaQuestions() {
  const [qs, stats] = await Promise.all([
    db.from("trivia_questions").select("*").order("created_at", { ascending: false }),
    db.rpc("trivia_question_stats")]);
  const err = qs.error || stats.error;
  tvQError = err ? err.message : null;
  tvQuestions = qs.data || [];
  tvStats = Object.fromEntries((stats.data || []).map(s => [s.question_id, s]));
}

// A game's leaderboard, and your rounds in it.
async function loadTriviaGame(id) {
  const [board, rounds] = await Promise.all([
    db.rpc("trivia_leaderboard", { for_game: id }),
    db.from("trivia_rounds").select("id, game_id, practice, started_at, finished_at, score, answered, correct, perfect_bonus")
      .eq("game_id", id).eq("user_id", me.id).order("started_at", { ascending: false }).limit(20)]);
  tvBoard = board.data || [];
  tvBoardFor = id;
  tvRounds = rounds.data || [];
}

// ---- wording, the same as the app's ------------------------------------------

// The company's day, in Boise, as the database counts rounds and dates.
const tvToday = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Boise" });
const tvGame = (id) => tvGames.find(g => g.id === id);
const tvMineFor = (id) => tvMine.find(m => m.game_id === id) || {};
const tvCat = (id) => tvCategories.find(c => c.id === id);
const tvKind = (id) => tvKinds.find(k => k.id === id);
const tvNum = (n) => Number(n || 0).toLocaleString("en-US");
const tvDay = (ymd) => dateOnly(ymd).toLocaleDateString("en-US", { month: "short", day: "numeric" });
const tvState = (g) => !g.is_published ? "draft" : tvToday() < g.starts_on ? "soon" : tvToday() > g.ends_on ? "done" : "on";
const tvLive = () => tvGames.filter(g => tvState(g) === "on").sort((a, b) => a.ends_on.localeCompare(b.ends_on));

// Days left, today included.
function tvLeft(g) {
  const n = Math.round((dateOnly(g.ends_on) - dateOnly(tvToday())) / 86400000) + 1;
  return n <= 1 ? "last day" : `${n} days left`;
}

// A rule's number in a game: its own, the catalog's, 1 for a rule without
// one, or null when the game doesn't have the rule.
function tvRuleValue(g, id) {
  const r = ((g && g.rules) || []).find(x => x.id === id);
  if (!r) return null;
  return r.value ?? (tvKind(id) || {}).default_value ?? 1;
}

// "Strikes: the round ends at 3 wrong answers".
function tvRuleLabel(rule) {
  const k = tvKind(rule.id);
  if (!k) return rule.id;
  const v = rule.value ?? k.default_value;
  return k.label.replace(/\{value\}/g, v == null ? "" : tvNum(v)).replace(/\{s\}/g, Number(v) === 1 ? "" : "s");
}

const tvCap = (text) => text.charAt(0).toUpperCase() + text.slice(1);
const tvStat = (value, label) => `<div><span class="cm-stat"><b>${esc(String(value))}</b><small>${esc(label)}</small></span></div>`;

// A message on the card a button sits in.
function tvSay(from, text) {
  const card = from && from.closest && from.closest(".cm-card");
  const msg = card && card.querySelector(".tv-msg");
  if (msg) msg.textContent = text; else if (text) alert(text);
}

// ---- on Social ---------------------------------------------------------------

// The door on the Social page.
function tvDoorHtml() {
  if (tvNotSetUp) return "";
  const g = tvLive()[0], m = g ? tvMineFor(g.id) : {};
  const line = !g ? ""
    : m.my_place ? `You're #${m.my_place} of ${m.players} in ${g.title} · ${tvNum(m.my_points)} pts`
    : m.leader_points > 0 ? `${g.title}: ${m.leader_name || "Someone"} leads with ${tvNum(m.leader_points)} pts · ${tvLeft(g)}`
    : `${g.title} is on · ${tvLeft(g)}`;
  return `<h2 class="group-title">Trivia</h2>
    <button type="button" class="cab-card cm-door" data-view="trivia" style="${lit("violet")}">
      <span class="cm-door-glyph">${icon("trivia", 24)}</span>
      <span class="cm-door-main">
        <b>AGCO Trivia</b>
        <span>History, operation, identification and specs. Play a round, learn something new, and climb the leaderboard.</span>
        ${line ? `<span class="cm-latest">${esc(line)}</span>` : ""}
        <span class="cm-go">${g ? (m.joined ? "Play a round" : "Join the game") : "Practice"} &rarr;</span>
      </span>
    </button>`;
}

function tvTroubleHtml() {
  return `<div class="cm"><div class="cm-card cm-empty">
    <b>${tvNotSetUp ? "Trivia isn't switched on yet" : "Trivia couldn't be loaded"}</b>
    <p>${tvNotSetUp ? "It opens once the database is ready for it." : "Try again in a minute."}</p></div></div>`;
}

// Draws the Trivia page that's showing again, with what's just loaded.
function tvRedraw() {
  if ($("view").classList.contains("hidden")) return;
  if (viewShown === "trivia" && $("tvPage")) $("tvPage").innerHTML = tvHubHtml();
  const g = tvGame(tvGameId);
  if (viewShown === "triviagame" && $("tvGamePage") && g) $("tvGamePage").innerHTML = tvGamePageHtml(g);
}

function triviaView() {
  setTimeout(async () => { await loadTrivia(); tvRedraw(); });
  const head = hero("AGCO Trivia", "History, operation, identification and specs. Play a round, learn something new, and climb the leaderboard.");
  if (tvNotSetUp || tvError) return head + tvTroubleHtml();
  return head + `<div class="cm tv" id="tvPage">${tvHubHtml()}</div>`;
}

function tvHubHtml() {
  const live = tvLive();
  const soon = tvGames.filter(g => tvState(g) === "soon").sort((a, b) => a.starts_on.localeCompare(b.starts_on));
  const done = tvGames.filter(g => tvState(g) === "done").slice(0, 6);
  return `${live.length ? `<h2 class="group-title">On now</h2>${live.map(tvGameCardHtml).join("")}`
      : `<div class="cm-card tv-none"><b>No game on right now</b>
          <p>${soon.length ? `The next one starts ${esc(tvDay(soon[0].starts_on))}.` : "Watch this space."}
            Practice in the meantime: it's how the best players learn the answers.</p></div>`}
    ${soon.length ? `<h2 class="group-title">Coming up</h2>${soon.map(g => `<div class="cm-card tv-soon">
        <p class="cm-eyebrow">${icon("calendar", 15)}Starts ${esc(tvDay(g.starts_on))} · runs to ${esc(tvDay(g.ends_on))}</p>
        <h3 class="tv-title">${esc(g.title)}</h3>${g.description ? `<p class="tv-desc">${esc(g.description)}</p>` : ""}
        ${g.prize ? `<p class="fx-prize">${icon("trophy", 16)}${esc(g.prize)}</p>` : ""}
        <button type="button" class="tv-quiet" data-tv-game="${esc(g.id)}">See the rules &rarr;</button></div>`).join("")}` : ""}
    <h2 class="group-title">Practice</h2>
    <div class="cm-card tv-practice" style="${lit("teal")}">
      <p class="tv-lead">Ten questions, no clock, and nothing counts. After each one you'll see the right answer and why.</p>
      <div class="tv-cats">
        <button type="button" class="tv-cat" data-tv-free="" style="${lit("slate")}">${icon("trivia", 16)}Every category</button>
        ${tvCategories.map(c => `<button type="button" class="tv-cat" data-tv-free="${esc(c.id)}" style="${lit(c.accent)}">${esc(c.name)}</button>`).join("")}
      </div>
      <p class="tv-msg" role="alert"></p>
    </div>
    ${tvKnowHtml()}
    ${done.length ? `<h2 class="group-title">Finished</h2><div class="cm-card tv-done">${done.map(g => { const m = tvMineFor(g.id);
      return `<button type="button" class="tv-done-row" data-tv-game="${esc(g.id)}">
        <span><b>${esc(g.title)}</b><small>Finished ${esc(tvDay(g.ends_on))}${m.my_place ? ` · you were #${m.my_place} of ${m.players}` : ""}</small></span>
        ${m.leader_points > 0 ? `<em>${icon("trophy", 15)}${esc(m.leader_name || "Someone")}</em>` : ""}</button>`; }).join("")}</div>` : ""}`;
}

// A game that's on, on the Trivia page.
function tvGameCardHtml(g) {
  const m = tvMineFor(g.id);
  return `<div class="cm-card tv-game">
    <p class="cm-eyebrow">${icon("trivia", 15)}On now · ${esc(tvLeft(g))}</p>
    <h3 class="tv-title">${esc(g.title)}</h3>
    ${g.description ? `<p class="tv-desc">${esc(g.description)}</p>` : ""}
    ${g.prize ? `<p class="fx-prize">${icon("trophy", 16)}${esc(g.prize)}</p>` : ""}
    <div class="cm-stats tv-stats">${tvStatsHtml(g, m)}</div>
    <div class="tv-actions">${tvActionHtml(g, m)}
      <button type="button" class="tv-quiet" data-tv-game="${esc(g.id)}">Leaderboard and rules &rarr;</button></div>
    <p class="tv-msg" role="alert"></p>
  </div>`;
}

function tvStatsHtml(g, m) {
  return (m.my_place ? tvStat(`#${m.my_place}`, `of ${m.players} · ${tvNum(m.my_points)} pts`)
      : tvStat(m.players || 0, m.players === 1 ? "player" : "players"))
    + (m.leader_points > 0 ? tvStat(tvNum(m.leader_points), `${m.leader_name || "Someone"} leads`) : tvStat("–", "No scores yet"))
    + (m.joined && m.rounds_left != null && tvState(g) === "on"
      ? tvStat(m.rounds_left, m.rounds_left === 1 ? "round left today" : "rounds left today")
      : tvStat(g.questions_per_round, "questions a round"));
}

// Join, play, carry on, or come back tomorrow.
function tvActionHtml(g, m) {
  const id = esc(g.id);
  if (!m.joined) return `<button type="button" class="tv-go" data-tv-join="${id}">${icon("plus", 17)}Join the game</button>`;
  if (m.open_round) return `<button type="button" class="tv-go" data-tv-play="${id}">${icon("trivia", 17)}Carry on with your round</button>`;
  if (m.rounds_left === 0) {
    return `<span class="tv-note">That's your ${tvRuleValue(g, "daily_limit") === 1 ? "round" : "rounds"} for today. Back tomorrow!</span>
      <button type="button" class="tv-quiet" data-tv-practice="${id}">Practice instead</button>`;
  }
  return `<button type="button" class="tv-go" data-tv-play="${id}">${icon("trivia", 17)}Play a round</button>`;
}

// What you know: how you do in each category, from every round you've played.
function tvKnowHtml() {
  const rows = tvCategories.map(c => ({ c, s: tvMyCats.find(x => x.category_id === c.id) })).filter(r => r.s && r.s.asked > 0)
    .map(r => ({ ...r, pct: Math.round(r.s.got_right / r.s.asked * 100) }));
  if (!rows.length) return "";
  const weakest = rows.filter(r => r.s.asked >= 3 && r.pct < 70).sort((a, b) => a.pct - b.pct)[0];
  return `<h2 class="group-title">What you know</h2>
    <div class="cm-card tv-know">
      ${rows.map(({ c, s, pct }) => `<div class="tv-know-row" style="${lit(c.accent)}">
        <span><b>${esc(c.name)}</b><small>${s.got_right} of ${s.asked} right</small></span>
        <i class="fx-bar"><i style="width:${pct}%"></i></i><em>${pct}%</em></div>`).join("")}
      ${weakest ? `<p class="fx-foot">Brush up on ${esc(weakest.c.name)}: practice it above.</p>` : ""}
    </div>`;
}

// ---- a game's page -----------------------------------------------------------

function triviaGameView() {
  const g = tvGame(tvGameId);
  if (!g) {
    return hero("AGCO Trivia") + `<div class="cm"><div class="cm-card cm-empty"><b>That game isn't here</b>
      <p>It may have been taken down.</p></div></div>`;
  }
  setTimeout(async () => { await Promise.all([loadTrivia(), loadTriviaGame(g.id)]); tvRedraw(); });
  return hero(g.title, g.description) + `<div class="cm tv" id="tvGamePage">${tvGamePageHtml(g)}</div>`;
}

function tvGamePageHtml(g) {
  const m = tvMineFor(g.id), st = tvState(g), board = tvBoardFor === g.id ? tvBoard : [];
  const when = st === "on" ? `On now · ${tvDay(g.starts_on)} to ${tvDay(g.ends_on)} · ${tvLeft(g)}`
    : st === "soon" ? `Starts ${tvDay(g.starts_on)} · runs to ${tvDay(g.ends_on)}`
    : st === "done" ? `Finished ${tvDay(g.ends_on)} · final standings` : `Draft · ${tvDay(g.starts_on)} to ${tvDay(g.ends_on)}`;
  return `<div class="cm-card tv-game">
      <p class="cm-eyebrow">${icon("trivia", 15)}${esc(when)}</p>
      ${g.prize ? `<p class="fx-prize">${icon("trophy", 16)}${esc(g.prize)}</p>` : ""}
      <div class="cm-stats tv-stats">${tvStatsHtml(g, m)}</div>
      ${st === "on" ? `<div class="tv-actions">${tvActionHtml(g, m)}</div>` : ""}
      ${st === "draft" ? `<p class="tv-lead">Not published yet, so only owners can see it. Practice it to try it out.</p>` : ""}
      <p class="tv-msg" role="alert"></p>
    </div>
    <div class="cm-kind fx-tabs tv-tabs" role="group" aria-label="Leaderboard">
      <button type="button" class="${tvTab === "people" ? "on" : ""}" data-tv-tab="people" aria-pressed="${tvTab === "people"}">${icon("person", 15)}People</button>
      <button type="button" class="${tvTab === "shops" ? "on" : ""}" data-tv-tab="shops" aria-pressed="${tvTab === "shops"}">${icon("building", 15)}Locations</button>
    </div>
    ${tvBoardFor !== g.id ? `<p class="cm-none">Loading the leaderboard…</p>`
      : !board.length ? `<p class="cm-none">${st === "done" ? "Nobody played this one." : "Nobody's joined yet. Be the first."}</p>`
      : tvTab === "people" ? `<div class="cm-card fx-board">${board.map(tvPersonHtml).join("")}</div>`
      : `<div class="cm-card fx-board">${tvShopsHtml(board)}</div>
         <p class="cm-none">Each location's average points per player, so a small location can beat a big one.</p>`}
    <h2 class="group-title">How to play</h2>
    ${tvRulesHtml(g)}
    ${tvRoundsHtml()}
    <div class="tv-foot">
      <button type="button" class="tv-quiet" data-tv-practice="${esc(g.id)}">${icon("trivia", 16)}Practice this game</button>
      ${m.joined && st !== "done" ? `<button type="button" class="tv-quiet tv-leave" data-tv-leave="${esc(g.id)}">Leave the game</button>` : ""}
    </div>
    <p class="tv-msg tv-foot-msg" role="alert"></p>`;
}

function tvPersonHtml(s) {
  const place = tvBoard.findIndex(x => x.points === s.points) + 1, mine = s.user_id === me.id, open = tvOpenPerson === s.user_id;
  return `<div class="fx-row${mine ? " mine" : ""}${open ? " open" : ""}">
    <button type="button" class="fx-person" data-tv-person="${esc(s.user_id)}" aria-expanded="${open}">
      ${fxBadge(place)}${cmAvatar(s.full_name, 34)}
      <span class="fx-who"><b>${esc(s.full_name || "Someone")}${mine ? " (you)" : ""}</b><small>${esc(s.location || "")}</small></span>
      <span class="fx-pts"><b>${tvNum(s.points)}</b><small>pts</small></span>
    </button>
    ${open ? `<div class="fx-lines">
      <div><span>Rounds played</span><em>${tvNum(s.rounds)}</em></div>
      <div><span>Right answers</span><em>${tvNum(s.correct)} of ${tvNum(s.answered)}${s.answered ? ` · ${Math.round(s.correct / s.answered * 100)}%` : ""}</em></div>
      <div><span>Best round</span><em>${tvNum(s.best_round)} pts</em></div>
      ${s.last_played ? `<p>Last played ${esc(cmWhen(s.last_played))}.</p>` : `<p>Hasn't played a round yet.</p>`}
    </div>` : ""}
  </div>`;
}

function tvShopsHtml(board) {
  const by = {};
  board.forEach(s => { const k = s.location || "No location"; (by[k] = by[k] || []).push(s); });
  const shops = Object.entries(by).map(([name, people]) => ({ name, players: people.length,
    avg: people.reduce((t, s) => t + s.points, 0) / people.length })).sort((a, b) => b.avg - a.avg || a.name.localeCompare(b.name));
  const top = Math.max(1, shops.length ? shops[0].avg : 1);
  return shops.map((s, i) => `<div class="fx-row"><div class="fx-person fx-shop">
      ${fxBadge(i + 1)}
      <span class="fx-who"><b>${esc(s.name)}</b><small>${s.players} ${s.players === 1 ? "player" : "players"}</small>
        <i class="fx-bar tv-bar"><i style="width:${Math.round(s.avg / top * 100)}%"></i></i></span>
      <span class="fx-pts"><b>${tvNum(Math.round(s.avg))}</b><small>avg pts</small></span>
    </div></div>`).join("");
}

// The game's settings and rules, in plain words.
function tvRulesHtml(g) {
  const cats = (g.category_ids || []).map(id => (tvCat(id) || {}).name || id);
  const lines = [
    [`${g.questions_per_round} questions a round${g.seconds_per_question ? `, ${g.seconds_per_question} seconds for each` : ", with no clock"}`,
      cats.length ? `From ${cmNames(cats)}.` : "From every category."],
    [`${tvNum(g.points_per_answer)} points for every right answer`, "After each answer you'll see the right one, and why."],
    ...(g.rules || []).map(r => [tvRuleLabel(r), (tvKind(r.id) || {}).detail || ""])];
  return `<div class="cm-card fx-rules tv-rules">
    ${lines.map(([b, s]) => `<div class="fx-rule-line"><span><b>${esc(b)}</b>${s ? `<small>${esc(s)}</small>` : ""}</span></div>`).join("")}
    <p class="fx-foot">Only scored rounds count, once you've joined.${tvRuleValue(g, "best_round") == null ? " Every one adds to your total." : ""}
      Practice never counts.</p>
  </div>`;
}

// Your rounds in the game, each opening to the questions, your answers and why.
function tvRoundsHtml() {
  if (!tvRounds.length) return "";
  return `<h2 class="group-title">Your rounds</h2>
    <div class="cm-card tv-rounds">${tvRounds.map(r => {
      const open = tvOpenRound === r.id;
      return `<div class="tv-round${open ? " open" : ""}">
        <button type="button" class="tv-round-head" data-tv-review="${esc(r.id)}" aria-expanded="${open}">
          <span><b>${esc(tvCap(cmWhen(r.started_at)))}${r.practice ? ` <i class="tv-tag">Practice</i>` : ""}</b>
            <small>${r.correct} of ${r.answered} right${r.finished_at ? "" : " · not finished"}${r.perfect_bonus ? " · perfect round" : ""}</small></span>
          <em>${tvNum(r.score)} pts</em></button>
        ${open ? (tvReviews[r.id] ? tvReviewHtml(tvReviews[r.id]) : `<p class="tv-note">Loading…</p>`) : ""}
      </div>`; }).join("")}</div>`;
}

function tvReviewHtml(rows) {
  if (!rows.length) return `<p class="tv-note">No questions answered in this round.</p>`;
  return `<ol class="tv-review">${rows.map(r => {
    const said = r.choice == null ? "Time ran out" : `You said ${r.choices[r.choice]}`;
    return `<li class="${r.is_correct ? "right" : "wrong"}">
      <p class="tv-q">${esc(r.question)}</p>
      <p class="tv-a">${esc(said)}${r.is_correct ? "" : ` · <b>Right answer: ${esc(r.choices[r.correct_choice])}</b>`}</p>
      ${r.explanation ? `<p class="tv-why">${esc(r.explanation)}</p>` : ""}
      <span class="tv-pts">${r.points > 0 ? "+" : ""}${tvNum(r.points)}</span></li>`; }).join("")}</ol>`;
}

// ---- playing a round ---------------------------------------------------------

async function tvStart(gameId, practice, category, from) {
  if (tvStarting) return;
  tvStarting = true;
  const { data, error } = await db.rpc("trivia_start", { for_game: gameId || null, just_practice: !!practice, in_category: category || null });
  tvStarting = false;
  if (error) return tvSay(from, error.message);
  tvPlay = { id: data, gameId: gameId || null, practice: !!practice, category: category || null,
    turn: null, result: null, picked: null, hidden: [], marks: [], busy: false, error: null, deadline: null };
  showView("triviaplay");
}

function tvPlayTitle() {
  if (!tvPlay) return "AGCO Trivia";
  const g = tvPlay.gameId && tvGame(tvPlay.gameId);
  if (g) return tvPlay.practice ? `Practice: ${g.title}` : g.title;
  return `Practice: ${tvPlay.category ? (tvCat(tvPlay.category) || {}).name || "Trivia" : "Every category"}`;
}

function triviaPlayView() {
  if (!tvPlay) {
    return hero("AGCO Trivia") + `<div class="cm tv"><div class="cm-card cm-empty"><b>No round going</b>
      <p>Start one from the Trivia page.</p><p><button type="button" class="tv-go" data-view="trivia">Go to Trivia</button></p></div></div>`;
  }
  setTimeout(() => {
    if (!tvPlay) return;
    if (!tvPlay.turn) tvNextTurn();
    else if (tvPlay.deadline && !tvPlay.result) tvTick();
  });
  return hero(tvPlayTitle(), tvPlay.practice ? "A practice round: it doesn't count." : "")
    + `<div class="cm tv tv-play" id="tvPlayHost">${tvPlayHtml()}</div>`;
}

function tvDrawPlay() {
  const host = $("tvPlayHost");
  if (host && viewShown === "triviaplay") host.innerHTML = tvPlayHtml();
}

// The next question, or where the round stands: the server starts its clock.
async function tvNextTurn() {
  const p = tvPlay;
  if (!p || p.busy) return;
  p.busy = true; p.error = null;
  const { data, error } = await db.rpc("trivia_turn", { this_round: p.id });
  if (tvPlay !== p) return;
  p.busy = false;
  if (error || !data) { p.error = error ? error.message : "The round didn't load."; return tvDrawPlay(); }
  p.turn = data; p.result = null; p.picked = null; p.imageUrl = null;
  if (data.finished) return tvFinish();
  const q = data.question;
  p.hidden = q.hidden || [];
  p.deadline = data.seconds ? performance.now() + Math.max(0, data.seconds - Number(q.elapsed || 0)) * 1000 : null;
  tvDrawPlay();
  if (p.deadline) tvTick();
  if (q.image_path) {
    const { data: signed } = await db.storage.from("trivia").createSignedUrl(q.image_path, 900);
    if (tvPlay === p && p.turn === data) { p.imageUrl = signed && signed.signedUrl; tvDrawPlay(); }
  }
}

// The clock: a bar that drains, and the seconds. At nothing, the time's up.
function tvTick() {
  clearInterval(tvTimer);
  tvTimer = setInterval(() => {
    const p = tvPlay;
    if (!p || viewShown !== "triviaplay" || !p.deadline || p.result) { clearInterval(tvTimer); return; }
    if (p.busy) return;
    const left = Math.max(0, (p.deadline - performance.now()) / 1000);
    const clock = $("tvClock");
    if (clock) {
      clock.style.setProperty("--left", String(left / p.turn.seconds));
      clock.classList.toggle("low", left <= 5);
      const n = clock.querySelector("b");
      if (n) n.textContent = String(Math.ceil(left));
    }
    if (left <= 0) { clearInterval(tvTimer); tvAnswer(null); }
  }, 100);
}

async function tvAnswer(choice) {
  const p = tvPlay;
  if (!p || !p.turn || !p.turn.question || p.result || p.busy) return;
  p.busy = true; p.picked = choice; p.error = null;
  clearInterval(tvTimer);
  tvDrawPlay();
  const { data, error } = await db.rpc("trivia_answer", { this_round: p.id, at_position: p.turn.question.number, picked: choice });
  if (tvPlay !== p) return;
  p.busy = false;
  if (error || !data) {
    // Sent again, the server gives the same result, so trying again is safe.
    p.error = error ? error.message : "That didn't go through.";
    p.retry = true;
    return tvDrawPlay();
  }
  p.retry = false;
  p.result = data;
  p.marks[p.turn.question.number - 1] = data.is_correct ? "right" : "wrong";
  tvDrawPlay();
}

async function tvFifty() {
  const p = tvPlay;
  if (!p || !p.turn || !p.turn.question || p.result || p.busy) return;
  p.busy = true;
  const { data, error } = await db.rpc("trivia_fifty", { this_round: p.id, at_position: p.turn.question.number });
  if (tvPlay !== p) return;
  p.busy = false;
  if (error) { p.error = error.message; return tvDrawPlay(); }
  p.hidden = data || [];
  p.turn.fifty_left = Math.max(0, (p.turn.fifty_left || 0) - 1);
  tvDrawPlay();
}

function tvAfterResult() {
  const p = tvPlay;
  if (!p || !p.result || p.busy) return;
  if (p.result.finished) tvFinish(); else tvNextTurn();
}

async function tvFinish() {
  const p = tvPlay;
  p.finished = true; p.deadline = null;
  clearInterval(tvTimer);
  tvDrawPlay();
  const [review] = await Promise.all([db.rpc("trivia_review", { this_round: p.id }), loadTrivia()]);
  if (tvPlay !== p) return;
  p.review = review.data || [];
  tvReviews[p.id] = p.review;
  tvDrawPlay();
}

function tvVerdict(correct, total) {
  const pct = total ? correct / total : 0;
  if (pct === 1) return ["Perfect round!", "Every one right. That's how it's done."];
  if (pct >= 0.8) return ["Field expert", "You know your stuff."];
  if (pct >= 0.6) return ["Solid work", "A couple to brush up on below."];
  if (pct >= 0.4) return ["Getting there", "Read the answers below: they'll come up again."];
  return ["Keep learning", "Every answer below comes with the why. Practice makes it stick."];
}

function tvPlayHtml() {
  const p = tvPlay;
  if (!p.turn) {
    return p.error ? `<div class="cm-card cm-empty"><b>The round didn't load</b><p>${esc(p.error)}</p>
        <p><button type="button" class="tv-go" data-view="trivia">Back to Trivia</button></p></div>`
      : `<div class="cm-card tv-loading"><p class="tv-note">Getting your first question…</p></div>`;
  }
  if (p.finished) return tvSummaryHtml();
  const t = p.turn, q = t.question, r = p.result, cat = tvCat(q.category_id);
  const score = r ? r.score : t.score, streak = r ? r.streak : t.streak, wrong = r ? r.wrong : t.wrong;
  const dots = Array.from({ length: t.total }, (_, i) => {
    const cls = p.marks[i] || (i < q.number - 1 ? "done" : i === q.number - 1 ? "now" : "");
    return `<i class="${cls}"></i>`;
  }).join("");
  const left = p.deadline ? Math.max(0, (p.deadline - performance.now()) / 1000) : 0;
  return `<div class="tv-top">
      <span class="tv-progress">Question <b>${q.number}</b> of ${t.total}</span>
      ${streak >= 2 ? `<span class="tv-streak">${icon("flame", 15)}${streak} in a row</span>` : ""}
      ${t.strikes ? `<span class="tv-strikes" title="Strikes">${Array.from({ length: t.strikes }, (_, i) =>
        `<i class="${i < wrong ? "on" : ""}"></i>`).join("")}<small>strikes</small></span>` : ""}
      <span class="tv-score"><b>${tvNum(score)}</b> pts</span>
    </div>
    <div class="tv-dots" aria-hidden="true">${dots}</div>
    ${t.seconds && !r ? `<div class="tv-clock${left <= 5 ? " low" : ""}" id="tvClock" style="--left:${(left / t.seconds).toFixed(3)}"
        role="timer" aria-label="Seconds left"><span><i></i></span><b>${Math.ceil(left)}</b></div>` : ""}
    <div class="cm-card tv-card" style="${lit(cat ? cat.accent : "violet")}">
      <p class="cm-eyebrow">${esc(q.category || "Trivia")} · ${esc(TV_LEVELS[q.difficulty] || "")}</p>
      <h2 class="tv-question" aria-live="polite">${esc(q.text)}</h2>
      ${q.image_path ? `<div class="tv-pic">${p.imageUrl ? `<img src="${esc(p.imageUrl)}" alt="The picture for this question">`
        : `<span class="tv-note">Loading the picture…</span>`}</div>` : ""}
      <div class="tv-choices">${q.choices.map((c, i) => {
        const gone = p.hidden.includes(i);
        const cls = r ? (i === r.correct_choice ? " right" : i === r.choice ? " wrong" : " dim") : p.picked === i ? " picked" : "";
        return `<button type="button" class="tv-choice${cls}${gone ? " gone" : ""}" data-tv-pick="${i}"${r || gone || p.busy ? " disabled" : ""}>
          <span class="tv-letter">${TV_LETTERS[i]}</span><span class="tv-text">${esc(c)}</span>${r && i === r.correct_choice ? icon("check", 20) : ""}</button>`;
      }).join("")}</div>
      ${!r && t.fifty_left > 0 && q.choices.length > 2 && !p.hidden.length
        ? `<button type="button" class="tv-fifty" data-tv-fifty${p.busy ? " disabled" : ""}>50/50 <small>${t.fifty_left} left</small></button>` : ""}
      ${r ? tvResultHtml(r, t) : ""}
      ${p.error ? `<p class="tv-msg">${esc(p.error)}${p.retry ? ` <button type="button" class="tv-quiet" data-tv-retry>Send it again</button>` : ""}</p>` : ""}
    </div>
    <p class="tv-keys">Keys: 1 to ${q.choices.length} or A to ${TV_LETTERS[q.choices.length - 1]} to answer, Enter for the next question.</p>`;
}

function tvResultHtml(r, t) {
  const b = r.breakdown || {}, parts = [];
  if (b.base) parts.push(`${tvNum(b.base)} for the answer${b.doubled ? ` (doubled${b.doubled > 2 ? " twice" : ""})` : ""}`);
  if (b.speed) parts.push(`+${tvNum(b.speed)} speed`);
  if (b.streak) parts.push(`+${tvNum(b.streak)} streak`);
  const out = r.finished && !r.is_correct && t.strikes && r.wrong >= t.strikes;
  return `<div class="tv-result ${r.is_correct ? "right" : "wrong"}" role="status">
    <p class="tv-verdict"><span>${r.is_correct ? "Right!" : r.timed_out ? "Time's up" : "Not quite"}</span>
      <b>${r.points > 0 ? "+" : ""}${tvNum(r.points)}</b></p>
    ${parts.length > 1 ? `<p class="tv-chips">${parts.map(x => `<span>${esc(x)}</span>`).join("")}</p>` : ""}
    ${r.explanation ? `<p class="tv-why"><b>Why:</b> ${esc(r.explanation)}</p>` : ""}
    ${out ? `<p class="tv-note">That's ${t.strikes} ${t.strikes === 1 ? "strike" : "strikes"}: the round's over.</p>` : ""}
    <button type="button" class="tv-go tv-next" data-tv-next>${r.finished ? "See how you did" : "Next question"} &rarr;</button>
  </div>`;
}

function tvSummaryHtml() {
  const p = tvPlay, s = p.result || p.turn;
  const [title, line] = tvVerdict(s.correct, s.answered || s.total);
  const g = p.gameId && tvGame(p.gameId), m = g ? tvMineFor(g.id) : {};
  const perfect = s.answered > 0 && s.correct === s.total;
  const again = p.practice ? `<button type="button" class="tv-go" data-tv-again>${icon("trivia", 17)}Practice again</button>`
    : g && tvState(g) === "on" && m.rounds_left !== 0 ? `<button type="button" class="tv-go" data-tv-again>${icon("trivia", 17)}Play another round</button>`
    : "";
  return `<div class="cm-card tv-summary${perfect ? " perfect" : ""}">
      <p class="cm-eyebrow">${icon("trivia", 15)}${p.practice ? "Practice · it doesn't count" : "Round over"}</p>
      <h2 class="tv-big">${esc(title)}</h2>
      <p class="tv-lead">${esc(line)}</p>
      <div class="cm-stats">
        ${tvStat(tvNum(s.score), "points")}${tvStat(`${s.correct} of ${s.total}`, "right")}${tvStat(s.best_streak, "best streak")}
        ${!p.practice && m.my_place ? tvStat(`#${m.my_place}`, `of ${m.players} in the game`) : ""}
      </div>
      ${s.perfect_bonus ? `<p class="fx-prize tv-bonus">${icon("trophy", 16)}Perfect-round bonus: +${tvNum(s.perfect_bonus)}</p>` : ""}
      ${!p.practice && g && m.rounds_left === 0 ? `<p class="tv-note">That's your ${tvRuleValue(g, "daily_limit") === 1 ? "round" : "rounds"} for today. Practice any time.</p>` : ""}
      <div class="tv-actions">${again}
        ${g ? `<button type="button" class="tv-quiet" data-tv-game="${esc(g.id)}">Back to ${esc(g.title)}</button>`
          : `<button type="button" class="tv-quiet" data-view="trivia">Back to Trivia</button>`}</div>
      <p class="tv-msg" role="alert"></p>
    </div>
    <h2 class="group-title">Your answers</h2>
    <div class="cm-card tv-rounds">${p.review ? tvReviewHtml(p.review) : `<p class="tv-note">Loading…</p>`}</div>`;
}

$("view").addEventListener("click", async (event) => {
  const t = event.target.closest("[data-tv-pick], [data-tv-next], [data-tv-fifty], [data-tv-retry], [data-tv-join], [data-tv-play], "
    + "[data-tv-practice], [data-tv-free], [data-tv-again], [data-tv-game], [data-tv-tab], [data-tv-person], [data-tv-review], [data-tv-leave]");
  if (!t) return;
  const d = t.dataset;
  if (d.tvPick !== undefined) return tvAnswer(Number(d.tvPick));
  if (d.tvNext !== undefined) return tvAfterResult();
  if (d.tvFifty !== undefined) return tvFifty();
  if (d.tvRetry !== undefined && tvPlay) { tvPlay.busy = false; return tvAnswer(tvPlay.picked); }
  if (d.tvPlay) return tvStart(d.tvPlay, false, null, t);
  if (d.tvPractice) return tvStart(d.tvPractice, true, null, t);
  if (d.tvFree !== undefined) return tvStart(null, true, d.tvFree, t);
  if (d.tvAgain !== undefined && tvPlay) return tvStart(tvPlay.gameId, tvPlay.practice, tvPlay.category, t);
  if (d.tvGame) { tvGameId = d.tvGame; tvOpenPerson = null; tvOpenRound = null; return showView("triviagame"); }
  if (d.tvJoin) {
    t.disabled = true;
    const { error } = await db.from("trivia_players").insert({ game_id: d.tvJoin, user_id: me.id });
    if (error && error.code !== "23505") { t.disabled = false; return tvSay(t, "That didn't go through. Check the game is still on, and try again."); }
    await Promise.all([loadTrivia(), tvGameId === d.tvJoin ? loadTriviaGame(d.tvJoin) : null]);
    return tvRedraw();
  }
  if (d.tvLeave) {
    if (!confirm("Leave this game? You come off its leaderboard. Your rounds are kept, and count again if you rejoin.")) return;
    const { error } = await db.from("trivia_players").delete().eq("game_id", d.tvLeave).eq("user_id", me.id);
    if (error) { const msg = document.querySelector(".tv-foot-msg"); if (msg) msg.textContent = "That didn't go through. Try again."; return; }
    await Promise.all([loadTrivia(), loadTriviaGame(d.tvLeave)]);
    return tvRedraw();
  }
  if (d.tvTab) { tvTab = d.tvTab; tvOpenPerson = null; return tvRedraw(); }
  if (d.tvPerson) {
    tvOpenPerson = tvOpenPerson === d.tvPerson ? null : d.tvPerson;
    tvRedraw();
    const again = document.querySelector(`[data-tv-person="${CSS.escape(d.tvPerson)}"]`);
    if (again) again.focus();
    return;
  }
  if (d.tvReview) {
    const id = d.tvReview;
    tvOpenRound = tvOpenRound === id ? null : id;
    tvRedraw();
    if (tvOpenRound && !tvReviews[id]) {
      const { data } = await db.rpc("trivia_review", { this_round: id });
      tvReviews[id] = data || [];
      tvRedraw();
    }
  }
});

// 1 to 4 or A to D answers; Enter goes on.
document.addEventListener("keydown", (event) => {
  const p = tvPlay;
  if (viewShown !== "triviaplay" || !p || !p.turn || p.finished || event.metaKey || event.ctrlKey || event.altKey) return;
  if (event.target.closest && event.target.closest("input, textarea, select")) return;
  const q = p.turn.question;
  if (!p.result && q && event.key.length === 1) {
    const n = "1234".includes(event.key) ? "1234".indexOf(event.key) : "abcd".indexOf(event.key.toLowerCase());
    if (n >= 0 && n < q.choices.length && !p.hidden.includes(n)) { event.preventDefault(); tvAnswer(n); }
    return;
  }
  if (p.result && event.key === "Enter" && !event.target.closest("button, a")) { event.preventDefault(); tvAfterResult(); }
});

// ---- the admin page: games, questions and categories ------------------------------

function renderTriviaAdmin() {
  const host = $("triviaAdmin");
  if (!host) return;
  if (tvNotSetUp || tvError) {
    host.innerHTML = `<div class="card"><p class="error">${tvNotSetUp
      ? "Run migration 0107_trivia.sql in the SQL editor, then reload this page." : esc(tvError || "")}</p></div>`;
    return;
  }
  host.innerHTML = tvAdminGamesHtml() + tvAdminQuestionsHtml() + tvAdminCategoriesHtml();
}

function tvStateBadge(g) {
  const st = tvState(g);
  return st === "on" ? `<span class="badge b-current">On now</span>` : st === "soon" ? `<span class="badge b-pending">Coming up</span>`
    : st === "done" ? `<span class="badge b-none">Finished</span>` : `<span class="badge b-open">Draft</span>`;
}

const tvActiveCount = (catId) => tvQuestions.filter(q => q.is_active && (!catId || q.category_id === catId)).length;

function tvAdminGamesHtml() {
  return `<div class="card tv-admin" id="tvAdminGames">
    <h2>Games</h2>
    <p class="note">A game runs between two dates, with its own leaderboard. People join it and play scored rounds, in the app or on
      this page; anyone can practice, and practice never counts. Pick how long a round is and the rules it plays by. A change
      applies to rounds started after it; rounds already played keep their scores.</p>
    ${tvGames.length ? `<div style="overflow-x:auto"><table class="tv-table"><thead><tr><th>Game</th><th>Dates</th><th>A round</th><th>Status</th><th></th></tr></thead>
      <tbody>${tvGames.map(g => `<tr>
        <td><b>${esc(g.title)}</b><div class="note">${(g.category_ids || []).length
          ? esc(cmNames(g.category_ids.map(id => (tvCat(id) || {}).name || id))) : "Every category"}</div></td>
        <td>${esc(tvDay(g.starts_on))} to ${esc(tvDay(g.ends_on))}</td>
        <td>${g.questions_per_round} questions · ${g.seconds_per_question ? `${g.seconds_per_question} s each` : "no clock"}</td>
        <td>${tvStateBadge(g)}</td>
        <td class="tv-acts"><button type="button" class="pdf" data-tv-edit-game="${esc(g.id)}">Edit</button>
          <button type="button" class="pdf" data-tv-open-game="${esc(g.id)}">Open</button></td></tr>`).join("")}</tbody></table></div>`
      : `<p class="note">No games yet.</p>`}
    ${tvGameDraft ? tvGameEditorHtml(tvGameDraft) : `<div class="row" style="margin-top:12px"><button type="button" data-tv-act="new-game">New game</button></div>`}
    <p class="msg" style="margin:8px 0 0"></p>
  </div>`;
}

function tvDraftFor(g) {
  const start = todayISO(), end = new Date(); end.setDate(end.getDate() + 30);
  return { id: g ? g.id : null, title: g ? g.title : "", description: g ? g.description : "", prize: g ? g.prize : "",
    starts_on: g ? g.starts_on : start,
    ends_on: g ? g.ends_on : `${end.getFullYear()}-${pad2(end.getMonth() + 1)}-${pad2(end.getDate())}`,
    questions_per_round: String(g ? g.questions_per_round : 10), seconds_per_question: String(g ? g.seconds_per_question : 20),
    points_per_answer: String(g ? g.points_per_answer : 100), category_ids: g ? [...(g.category_ids || [])] : [],
    rules: new Map((g ? g.rules || [] : TV_STANDARD).map(r => [r.id, { value: r.value == null ? "" : String(r.value) }])),
    is_published: g ? g.is_published : false };
}

// "About 4 minutes a round": the questions, the clock, and reading the answers.
function tvLengthText(d) {
  const n = Number(d.questions_per_round) || 0, s = Number(d.seconds_per_question) || 0;
  const minutes = Math.max(1, Math.round(n * ((s || 15) * 0.7 + 8) / 60));
  return `About ${minutes} ${minutes === 1 ? "minute" : "minutes"} a round${s ? `, at most ${s} seconds a question` : ", with no clock"}.`;
}

function tvGameEditorHtml(d) {
  const groups = [...new Set(tvKinds.map(k => k.category))];
  const secs = [0, 10, 15, 20, 30, 45, 60, 90, 120];
  if (!secs.includes(Number(d.seconds_per_question))) secs.push(Number(d.seconds_per_question));
  return `<div class="role tv-editor" id="tvGameEditor">
    <div class="role-head"><b>${d.id ? `Edit ${esc(d.title || "the game")}` : "New game"}</b></div>
    <div class="fields">
      <div class="wide"><label for="tvgTitle">Title</label>
        <input id="tvgTitle" type="text" maxlength="80" data-tvg="title" value="${esc(d.title)}" placeholder="Fall Trivia Showdown"></div>
      <div class="wide"><label for="tvgDesc">Description (optional)</label>
        <input id="tvgDesc" type="text" maxlength="500" data-tvg="description" value="${esc(d.description)}"
          placeholder="A month of questions on Fendt, Massey Ferguson and the rest of the AGCO family"></div>
      <div class="wide"><label for="tvgPrize">Prize (optional)</label>
        <input id="tvgPrize" type="text" maxlength="500" data-tvg="prize" value="${esc(d.prize)}" placeholder="A Fendt jacket for the winner"></div>
      <div><label for="tvgStart">Starts</label><input id="tvgStart" type="date" data-tvg="starts_on" value="${esc(d.starts_on)}"></div>
      <div><label for="tvgEnd">Ends (its last day)</label><input id="tvgEnd" type="date" data-tvg="ends_on" value="${esc(d.ends_on)}"></div>
      <div><label for="tvgCount">Questions a round</label>
        <input id="tvgCount" type="number" min="3" max="50" step="1" data-tvg="questions_per_round" value="${esc(d.questions_per_round)}"></div>
      <div><label for="tvgSecs">Time for each question</label>
        <select id="tvgSecs" data-tvg="seconds_per_question">${secs.map(s => `<option value="${s}"${String(s) === String(d.seconds_per_question) ? " selected" : ""}>${
          s ? `${s} seconds` : "No clock"}</option>`).join("")}</select></div>
      <div><label for="tvgPts">Points for a right answer</label>
        <input id="tvgPts" type="number" min="10" max="1000" step="10" data-tvg="points_per_answer" value="${esc(d.points_per_answer)}"></div>
    </div>
    <p class="tv-length" id="tvgLength">${esc(tvLengthText(d))}</p>
    <label>Categories it draws from</label>
    <div class="tv-catpicks">${tvCategories.map(c => `<label class="check"><input type="checkbox" data-tvg-cat="${esc(c.id)}"${
      d.category_ids.includes(c.id) ? " checked" : ""}> ${esc(c.name)} <span class="note">(${tvActiveCount(c.id)})</span></label>`).join("")}</div>
    <p class="note">Tick none for every category. The number is how many active questions each has.</p>
    <h3 class="fx-group">Rules <span class="fx-count" id="tvgCountRules">${d.rules.size} picked</span></h3>
    <p class="note">Every game has the basics: the points for a right answer, and the right answer with its "why" after each question.
      Pick what else it plays by.</p>
    ${groups.map(gr => `<h3 class="fx-group">${esc(gr)}</h3>${tvKinds.filter(k => k.category === gr).map(tvAdminRuleHtml).join("")}`).join("")}
    <label class="check" style="margin-top:14px"><input type="checkbox" data-tvg="is_published"${d.is_published ? " checked" : ""}>
      Published: people can see it, join it and play</label>
    <div class="row">
      <button type="button" data-tv-act="save-game">${d.id ? "Save" : "Add the game"}</button>
      <button type="button" class="ghost" data-tv-act="cancel-game">Cancel</button>
      ${d.id ? `<button type="button" class="ghost danger" data-tv-act="delete-game">Delete the game</button>` : ""}
    </div>
    <p class="msg" style="margin:8px 0 0"></p>
  </div>`;
}

function tvAdminRuleHtml(k) {
  const r = tvGameDraft.rules.get(k.id), on = !!r, id = esc(k.id);
  const val = on && r.value !== "" ? r.value : (k.default_value == null ? "" : String(k.default_value));
  const [before, after] = k.label.replace(/\{s\}/g, "s").split("{value}");
  // The rule's number sits in its sentence: "Wrong answers cost [25] points".
  const text = k.value_unit
    ? `<label for="tv-on-${id}">${esc(before)}</label><input type="number" class="fx-val" data-tvg-val="${id}" min="${k.min_value}"
         max="${k.max_value}" step="1" value="${esc(val)}" aria-label="${esc(k.value_unit)}"><label for="tv-on-${id}">${esc(after || "")}</label>`
    : `<label for="tv-on-${id}">${esc(k.label)}</label>`;
  return `<div class="fx-pick tv-pick${on ? " on" : ""}">
    <input type="checkbox" id="tv-on-${id}" data-tvg-on="${id}"${on ? " checked" : ""}>
    <div class="fx-pick-main"><div class="fx-pick-label">${text}</div>${k.detail ? `<small>${esc(k.detail)}</small>` : ""}</div>
  </div>`;
}

function tvAdminQuestionsHtml() {
  const active = tvActiveCount(), hidden = tvQuestions.length - active, f = tvQFilter;
  return `<div class="card tv-admin" id="tvAdminQuestions">
    <h2>Questions <span class="fx-count">${active} active${hidden ? ` · ${hidden} hidden` : ""}</span></h2>
    <p class="note">One right answer and one to three wrong ones, shuffled every time the question is asked, and a "why" that
      everyone sees after answering, right or wrong: that's where the learning happens. A hidden question is kept but never asked.
      Lots at once can be loaded with SQL; the format is at the top of migration 0107.</p>
    ${tvQError ? `<p class="error">${esc(tvQError)}</p>` : ""}
    <p class="tv-catcounts">${tvCategories.map(c => `<span class="pill"><i class="tv-dot" style="${lit(c.accent)}"></i>${esc(c.name)} ${tvActiveCount(c.id)}</span>`).join("")}</p>
    <div class="row tv-qbar">
      <select id="tvqCat" data-tvq-filter="category" aria-label="Category"><option value="">Every category</option>
        ${tvCategories.map(c => `<option value="${esc(c.id)}"${f.category === c.id ? " selected" : ""}>${esc(c.name)}</option>`).join("")}</select>
      <select id="tvqShow" data-tvq-filter="show" aria-label="Which questions">
        ${[["active", "Active"], ["hidden", "Hidden"], ["all", "Active and hidden"]].map(([v, l]) =>
          `<option value="${v}"${f.show === v ? " selected" : ""}>${l}</option>`).join("")}</select>
      <input id="tvqText" class="search" type="text" data-tvq-filter="text" value="${esc(f.text)}" placeholder="Search the questions" aria-label="Search the questions">
      ${tvQDraft && !tvQDraft.id ? "" : `<button type="button" data-tv-act="new-question">Add a question</button>`}
    </div>
    ${tvQDraft && !tvQDraft.id ? tvQuestionEditorHtml(tvQDraft) : ""}
    <div id="tvqList">${tvQListHtml()}</div>
    <p class="msg" style="margin:8px 0 0"></p>
  </div>`;
}

function tvQListHtml() {
  const f = tvQFilter, text = f.text.trim().toLowerCase();
  const list = tvQuestions.filter(q => (!f.category || q.category_id === f.category)
    && (f.show === "all" || (f.show === "active") === q.is_active)
    && (!text || [q.question, q.answer, ...q.wrong_answers, q.explanation].join(" ").toLowerCase().includes(text)));
  if (!list.length) {
    return `<p class="note tv-qnone">${tvQuestions.length ? "No questions match." : "No questions yet. Add the first one above, or load them in bulk with SQL."}</p>`;
  }
  return list.map(q => {
    if (tvQDraft && tvQDraft.id === q.id) return tvQuestionEditorHtml(tvQDraft);
    const s = tvStats[q.id], c = tvCat(q.category_id) || { name: q.category_id, accent: "slate" };
    return `<div class="tv-qrow${q.is_active ? "" : " off"}">
      <div class="tv-qmain"><b>${esc(q.question)}</b>
        <div class="note"><i class="tv-dot" style="${lit(c.accent)}"></i>${esc(c.name)} · ${esc(TV_LEVELS[q.difficulty])}${q.image_path ? " · has a picture" : ""}</div>
        <div class="note"><span class="tv-ok">${esc(q.answer)}</span> · not ${esc(q.wrong_answers.join(", "))}</div>
        <div class="note">${s ? `Asked ${tvNum(s.asked)} ${s.asked === 1 ? "time" : "times"} · ${Math.round(s.got_right / s.asked * 100)}% got it right` : "Not asked yet"}</div>
      </div>
      ${q.is_active ? "" : `<span class="badge b-none">Hidden</span>`}
      <button type="button" class="pdf" data-tv-edit-q="${esc(q.id)}">Edit</button>
    </div>`;
  }).join("");
}

function tvQDraftFor(q) {
  return { id: q ? q.id : null, category_id: q ? q.category_id : (tvQFilter.category || (tvCategories[0] || {}).id || ""),
    difficulty: String(q ? q.difficulty : 2), question: q ? q.question : "", answer: q ? q.answer : "",
    wrong: [0, 1, 2].map(i => (q && q.wrong_answers[i]) || ""), explanation: q ? q.explanation : "",
    is_active: q ? q.is_active : true, image_path: q ? q.image_path : null, savedImage: q ? q.image_path : null,
    file: null, fileUrl: null, shownUrl: null, another: tvQDraft ? !!tvQDraft.another : false };
}

function tvQuestionEditorHtml(d) {
  const pic = d.fileUrl || d.shownUrl;
  return `<div class="role tv-editor" id="tvQEditor">
    <div class="role-head"><b>${d.id ? "Edit the question" : "New question"}</b></div>
    <div class="fields">
      <div><label for="tvqeCat">Category</label><select id="tvqeCat" data-tvq="category_id">${tvCategories.map(c =>
        `<option value="${esc(c.id)}"${c.id === d.category_id ? " selected" : ""}>${esc(c.name)}</option>`).join("")}</select></div>
      <div><label for="tvqeDiff">Difficulty</label><select id="tvqeDiff" data-tvq="difficulty">${[1, 2, 3].map(n =>
        `<option value="${n}"${String(n) === d.difficulty ? " selected" : ""}>${TV_LEVELS[n]}</option>`).join("")}</select></div>
      <div class="wide"><label for="tvqeQ">Question</label>
        <textarea id="tvqeQ" rows="2" maxlength="500" data-tvq="question" placeholder="Which Fendt series was the first with the Vario transmission?">${esc(d.question)}</textarea></div>
      <div class="wide"><label for="tvqeA">The right answer</label>
        <input id="tvqeA" type="text" maxlength="200" data-tvq="answer" value="${esc(d.answer)}"></div>
      ${d.wrong.map((w, i) => `<div><label for="tvqeW${i}">${i === 0 ? "A wrong answer" : "Another wrong answer (optional)"}</label>
        <input id="tvqeW${i}" type="text" maxlength="200" data-tvq-wrong="${i}" value="${esc(w)}"></div>`).join("")}
      <div class="wide"><label for="tvqeWhy">Why: shown after answering, right or wrong</label>
        <textarea id="tvqeWhy" rows="3" maxlength="1000" data-tvq="explanation" placeholder="The fact behind the answer, in a sentence or two.">${esc(d.explanation)}</textarea></div>
    </div>
    <div class="row tv-tf"><span class="note">True or false?</span>
      <button type="button" class="pdf" data-tv-tf="True">The answer is True</button>
      <button type="button" class="pdf" data-tv-tf="False">The answer is False</button></div>
    <label for="tvqeFile">A picture (optional): for "Which model is this?" and the like</label>
    <div class="row tv-picrow">
      ${pic ? `<img src="${esc(pic)}" alt="The question's picture">` : ""}
      <input id="tvqeFile" type="file" accept="image/jpeg,image/png,image/webp">
      ${pic ? `<button type="button" class="pdf" data-tv-act="remove-picture">Remove the picture</button>` : ""}
    </div>
    <label class="check" style="margin-top:12px"><input type="checkbox" data-tvq="is_active"${d.is_active ? " checked" : ""}> Active: asked in games and practice</label>
    <div class="row">
      <button type="button" data-tv-act="save-question">${d.id ? "Save" : "Add the question"}</button>
      <button type="button" class="ghost" data-tv-act="cancel-question">Cancel</button>
      ${d.id ? `<button type="button" class="ghost danger" data-tv-act="delete-question">Delete it</button>`
        : `<label class="check" style="margin:0"><input type="checkbox" id="tvqeAnother"${d.another ? " checked" : ""}> Start another after adding</label>`}
    </div>
    <p class="msg" style="margin:8px 0 0"></p>
  </div>`;
}

function tvAdminCategoriesHtml() {
  const row = (c) => `<div class="tv-catrow" data-tv-catrow="${esc(c ? c.id : "")}">
      <input type="text" maxlength="40" data-tvc="name" value="${esc(c ? c.name : "")}" placeholder="${c ? "" : "New category"}" aria-label="Name">
      <input type="text" maxlength="200" data-tvc="description" value="${esc(c ? c.description : "")}" placeholder="What it covers" aria-label="What it covers">
      <select data-tvc="accent" aria-label="Colour">${TV_ACCENTS.map(a => `<option value="${a}"${a === (c ? c.accent : "slate") ? " selected" : ""}>${a}</option>`).join("")}</select>
      <input type="number" step="1" data-tvc="sort_order" value="${c ? c.sort_order : (tvCategories.length + 1) * 10}" aria-label="Order" class="tv-order">
      ${c ? `<button type="button" class="pdf" data-tv-cat-save="${esc(c.id)}">Save</button>
        <button type="button" class="pdf danger" data-tv-cat-remove="${esc(c.id)}">Remove</button>`
        : `<button type="button" class="pdf" data-tv-cat-add>Add</button>`}
    </div>`;
  return `<div class="card tv-admin" id="tvAdminCats">
    <h2>Categories</h2>
    <p class="note">What the questions are sorted into, shown in this order, each in its colour. One with questions can't be
      removed: move or delete its questions first.</p>
    <div class="tv-cathead"><span>Name</span><span>What it covers</span><span>Colour</span><span>Order</span></div>
    ${tvCategories.map(row).join("")}${row(null)}
    <p class="msg" style="margin:8px 0 0"></p>
  </div>`;
}

// "Safety & PPE" -> "safety_ppe", kept apart from any there already.
function tvSlug(name) {
  const base = name.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "").slice(0, 36) || "category";
  let id = base, n = 2;
  while (tvCategories.some(c => c.id === id)) id = `${base}_${n++}`;
  return id;
}

async function tvShrink(file) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return await new Promise(resolve => canvas.toBlob(resolve, "image/jpeg", 0.86));
}

// The picture already saved with a question, to show in its editor.
async function tvShowSavedPicture(d) {
  if (!d.savedImage) return;
  const { data } = await db.storage.from("trivia").createSignedUrl(d.savedImage, 600);
  if (tvQDraft !== d || !data) return;
  d.shownUrl = data.signedUrl;
  renderTriviaAdmin();
}

$("admin").addEventListener("input", (event) => {
  const t = event.target;
  if (!t.closest || !t.closest("#triviaAdmin")) return;
  const g = tvGameDraft, q = tvQDraft;
  if (t.dataset.tvg && g && t.type !== "checkbox") {
    g[t.dataset.tvg] = t.value;
    const len = $("tvgLength");
    if (len) len.textContent = tvLengthText(g);
    return;
  }
  if (t.dataset.tvgVal && g) {
    // Changing a rule's number picks it.
    const id = t.dataset.tvgVal;
    g.rules.set(id, { value: t.value });
    const box = $(`tv-on-${id}`);
    if (box && !box.checked) { box.checked = true; box.closest(".fx-pick").classList.add("on"); }
    const n = $("tvgCountRules");
    if (n) n.textContent = `${g.rules.size} picked`;
    return;
  }
  if (t.dataset.tvq && q && t.type !== "checkbox") { q[t.dataset.tvq] = t.value; return; }
  if (t.dataset.tvqWrong !== undefined && q) { q.wrong[Number(t.dataset.tvqWrong)] = t.value; return; }
  if (t.dataset.tvqFilter === "text") { tvQFilter.text = t.value; $("tvqList").innerHTML = tvQListHtml(); }
});

$("admin").addEventListener("change", async (event) => {
  const t = event.target;
  if (!t.closest || !t.closest("#triviaAdmin")) return;
  const g = tvGameDraft, q = tvQDraft;
  if (t.dataset.tvg === "is_published" && g) { g.is_published = t.checked; return; }
  if (t.dataset.tvgCat && g) {
    g.category_ids = t.checked ? [...new Set([...g.category_ids, t.dataset.tvgCat])] : g.category_ids.filter(c => c !== t.dataset.tvgCat);
    return;
  }
  if (t.dataset.tvgOn && g) {
    const id = t.dataset.tvgOn, pick = t.closest(".fx-pick");
    if (t.checked) g.rules.set(id, { value: (pick.querySelector("[data-tvg-val]") || {}).value || "" });
    else g.rules.delete(id);
    pick.classList.toggle("on", t.checked);
    const n = $("tvgCountRules");
    if (n) n.textContent = `${g.rules.size} picked`;
    return;
  }
  if (t.dataset.tvq === "is_active" && q) { q.is_active = t.checked; return; }
  if (t.id === "tvqeAnother" && q) { q.another = t.checked; return; }
  if (t.id === "tvqeFile" && q && t.files[0]) {
    const blob = await tvShrink(t.files[0]).catch(() => null);
    if (!blob) return speak($("tvQEditor"), "That picture couldn't be read. Try a JPEG or PNG.", true);
    if (q.fileUrl) URL.revokeObjectURL(q.fileUrl);
    q.file = blob; q.fileUrl = URL.createObjectURL(blob);
    renderTriviaAdmin();
    return;
  }
  if (t.dataset.tvqFilter && t.dataset.tvqFilter !== "text") { tvQFilter[t.dataset.tvqFilter] = t.value; $("tvqList").innerHTML = tvQListHtml(); }
});

$("admin").addEventListener("click", async (event) => {
  const b = event.target.closest("[data-tv-act], [data-tv-edit-game], [data-tv-open-game], [data-tv-edit-q], [data-tv-tf], "
    + "[data-tv-cat-save], [data-tv-cat-remove], [data-tv-cat-add]");
  if (!b || !b.closest("#triviaAdmin")) return;
  const act = b.dataset.tvAct, card = b.closest(".card"), editor = b.closest(".tv-editor") || card;

  if (b.dataset.tvOpenGame) { tvGameId = b.dataset.tvOpenGame; tvOpenPerson = null; tvOpenRound = null; return showView("triviagame"); }
  if (b.dataset.tvEditGame || act === "new-game") {
    tvGameDraft = tvDraftFor(b.dataset.tvEditGame ? tvGame(b.dataset.tvEditGame) : null);
    renderTriviaAdmin();
    $("tvGameEditor").scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }
  if (act === "cancel-game") { tvGameDraft = null; return renderTriviaAdmin(); }
  if (act === "delete-game") {
    const d = tvGameDraft;
    if (!confirm(`Delete ${d.title || "this game"}? Its leaderboard and every round played in it go too. This can't be undone.`)) return;
    const { error } = await db.from("trivia_games").delete().eq("id", d.id);
    if (error) return speak(editor, error.message, true);
    tvGameDraft = null;
    await loadTrivia();
    renderTriviaAdmin();
    return speak($("tvAdminGames"), `Deleted ${d.title}.`, false);
  }
  if (act === "save-game") return tvSaveGame(editor);

  if (b.dataset.tvEditQ || act === "new-question") {
    if (tvQDraft && tvQDraft.fileUrl) URL.revokeObjectURL(tvQDraft.fileUrl);
    tvQDraft = tvQDraftFor(b.dataset.tvEditQ ? tvQuestions.find(x => x.id === b.dataset.tvEditQ) : null);
    renderTriviaAdmin();
    $("tvQEditor").scrollIntoView({ behavior: "smooth", block: "center" });
    tvShowSavedPicture(tvQDraft);
    return;
  }
  if (act === "cancel-question") {
    if (tvQDraft && tvQDraft.fileUrl) URL.revokeObjectURL(tvQDraft.fileUrl);
    tvQDraft = null;
    return renderTriviaAdmin();
  }
  if (b.dataset.tvTf && tvQDraft) {
    tvQDraft.answer = b.dataset.tvTf;
    tvQDraft.wrong = [b.dataset.tvTf === "True" ? "False" : "True", "", ""];
    return renderTriviaAdmin();
  }
  if (act === "remove-picture" && tvQDraft) {
    if (tvQDraft.fileUrl) URL.revokeObjectURL(tvQDraft.fileUrl);
    Object.assign(tvQDraft, { file: null, fileUrl: null, shownUrl: null, image_path: null });
    return renderTriviaAdmin();
  }
  if (act === "delete-question") {
    const d = tvQDraft;
    if (!confirm("Delete this question? Rounds it was in keep it as it was asked. To stop asking it but keep it, untick Active instead.")) return;
    const { error } = await db.from("trivia_questions").delete().eq("id", d.id);
    if (error) return speak(editor, error.message, true);
    if (d.savedImage) await db.storage.from("trivia").remove([d.savedImage]);
    tvQDraft = null;
    await loadTriviaQuestions();
    renderTriviaAdmin();
    return speak($("tvAdminQuestions"), "Deleted.", false);
  }
  if (act === "save-question") return tvSaveQuestion(editor, b);

  if (b.dataset.tvCatSave || b.dataset.tvCatAdd !== undefined) return tvSaveCategory(b);
  if (b.dataset.tvCatRemove) {
    const c = tvCat(b.dataset.tvCatRemove), n = tvQuestions.filter(q => q.category_id === c.id).length;
    if (n) return speak(card, `${c.name} has ${n} ${n === 1 ? "question" : "questions"}. Move or delete ${n === 1 ? "it" : "them"} first.`, true);
    if (!confirm(`Remove ${c.name}? Any game drawing from it stops drawing from it.`)) return;
    const { error } = await db.from("trivia_categories").delete().eq("id", c.id);
    if (error) return speak(card, /foreign key/i.test(error.message) ? `${c.name} still has questions. Move or delete them first.` : error.message, true);
    await loadTrivia();
    renderTriviaAdmin();
    return speak($("tvAdminCats"), `Removed ${c.name}.`, false);
  }
});

async function tvSaveGame(editor) {
  const d = tvGameDraft;
  const n = Number(d.questions_per_round), s = Number(d.seconds_per_question), pts = Number(d.points_per_answer);
  if (!d.title.trim()) return speak(editor, "Give the game a title.", true);
  if (!d.starts_on || !d.ends_on) return speak(editor, "Give the game a first and a last day.", true);
  if (d.ends_on < d.starts_on) return speak(editor, "The last day can't be before the first.", true);
  if (!(Number.isInteger(n) && n >= 3 && n <= 50)) return speak(editor, "A round is 3 to 50 questions.", true);
  if (!(Number.isInteger(pts) && pts >= 10 && pts <= 1000)) return speak(editor, "A right answer is worth 10 to 1,000 points.", true);
  const rules = [];
  for (const k of tvKinds) {
    const r = d.rules.get(k.id);
    if (!r) continue;
    const rule = { id: k.id };
    if (k.value_unit) {
      const v = Number(r.value === "" ? k.default_value : r.value);
      if (!(Number.isInteger(v) && v >= k.min_value && v <= k.max_value)) {
        return speak(editor, `"${k.label.replace("{value}", "…").replace(/\{s\}/g, "s")}" needs a whole number from ${k.min_value} to ${tvNum(k.max_value)}.`, true);
      }
      rule.value = v;
    }
    rules.push(rule);
  }
  if (!s && rules.some(r => r.id === "speed_bonus")) return speak(editor, "The speed bonus needs a clock: give each question a time, or untick the speed bonus.", true);
  const active = d.category_ids.length ? d.category_ids.reduce((t, c) => t + tvActiveCount(c), 0) : tvActiveCount();
  const row = { title: d.title.trim(), description: d.description.trim(), prize: d.prize.trim(), starts_on: d.starts_on, ends_on: d.ends_on,
    category_ids: d.category_ids, questions_per_round: n, seconds_per_question: s, points_per_answer: pts, rules, is_published: d.is_published };
  const button = editor.querySelector("[data-tv-act='save-game']");
  button.disabled = true;
  const { error } = d.id ? await db.from("trivia_games").update(row).eq("id", d.id) : await db.from("trivia_games").insert(row);
  button.disabled = false;
  if (error) return speak(editor, error.message, true);
  tvGameDraft = null;
  await loadTrivia();
  renderTriviaAdmin();
  speak($("tvAdminGames"), `Saved ${row.title}.${active < n ? ` It has ${active} active ${active === 1 ? "question" : "questions"} to draw from, fewer than a round, so rounds will be shorter until more are added.` : ""}${
    row.is_published ? "" : " It's a draft until you tick Published."}`, false);
}

async function tvSaveQuestion(editor, button) {
  const d = tvQDraft;
  const wrong = d.wrong.map(w => w.trim()).filter(Boolean);
  const all = [d.answer.trim(), ...wrong].map(x => x.toLowerCase());
  if (!d.question.trim()) return speak(editor, "Write the question.", true);
  if (!d.answer.trim()) return speak(editor, "Give the right answer.", true);
  if (!wrong.length) return speak(editor, "Give at least one wrong answer.", true);
  if (new Set(all).size !== all.length) return speak(editor, "The answers must all be different.", true);
  button.disabled = true;
  let image = d.image_path;
  if (d.file) {
    image = `questions/${crypto.randomUUID()}.jpg`;
    const up = await db.storage.from("trivia").upload(image, d.file, { contentType: "image/jpeg" });
    if (up.error) { button.disabled = false; return speak(editor, `The picture didn't upload: ${up.error.message}`, true); }
  }
  const row = { category_id: d.category_id, difficulty: Number(d.difficulty), question: d.question.trim(), answer: d.answer.trim(),
    wrong_answers: wrong, explanation: d.explanation.trim(), is_active: d.is_active, image_path: image };
  const { error } = d.id ? await db.from("trivia_questions").update(row).eq("id", d.id) : await db.from("trivia_questions").insert(row);
  button.disabled = false;
  if (error) {
    if (d.file) await db.storage.from("trivia").remove([image]);
    return speak(editor, error.message, true);
  }
  // The picture it had before, replaced or taken off.
  if (d.savedImage && d.savedImage !== image) await db.storage.from("trivia").remove([d.savedImage]);
  if (d.fileUrl) URL.revokeObjectURL(d.fileUrl);
  const another = !d.id && d.another;
  tvQDraft = another ? { ...tvQDraftFor(null), category_id: d.category_id, difficulty: d.difficulty, another: true } : null;
  await loadTriviaQuestions();
  renderTriviaAdmin();
  speak(another ? $("tvQEditor") : $("tvAdminQuestions"), another ? "Added. Here's a fresh one." : "Saved.", false);
  if (another) $("tvqeQ").focus();
}

async function tvSaveCategory(b) {
  const rowEl = b.closest(".tv-catrow"), card = b.closest(".card");
  const get = (f) => rowEl.querySelector(`[data-tvc="${f}"]`).value;
  const name = get("name").trim();
  if (!name) return speak(card, "Give the category a name.", true);
  const row = { name, description: get("description").trim(), accent: get("accent"), sort_order: Math.round(Number(get("sort_order")) || 0) };
  const adding = b.dataset.tvCatAdd !== undefined;
  const { error } = adding ? await db.from("trivia_categories").insert({ id: tvSlug(name), ...row })
    : await db.from("trivia_categories").update(row).eq("id", b.dataset.tvCatSave);
  if (error) return speak(card, error.message, true);
  await loadTrivia();
  renderTriviaAdmin();
  speak($("tvAdminCats"), adding ? `Added ${name}.` : `Saved ${name}.`, false);
}
