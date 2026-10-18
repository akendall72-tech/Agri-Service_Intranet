// ============================================================================
// Agri-Service web page: the script
// ============================================================================
//
// One page, its script in one file per feature. index.html loads them in a
// fixed order, as plain scripts (not modules), so they share one set of names
// exactly as when this was all one file: a function in skills.js can call one
// in core.js without importing anything. Served from GitHub Pages as it is,
// with no build step.
//
//   THE ORDER, AND THE ONE RULE IT BRINGS
//     core.js first, then shell.js, then the features, then boot.js, which
//     starts the page and must stay last. Code inside a function runs when it's
//     called, by which time every file has loaded, so it can use any name. Code
//     that runs while the files load (a top-level const's value, a forEach at
//     the top) can only use names from an earlier file, or earlier in its own.
//     check.py's smoke test fails on a mistake here.
//
//   WHERE THINGS GO
//     A feature's code, from its loading to its admin tab, lives in its file,
//     named as its page is: special-tools.js, safety-desk.js. A helper more
//     than one feature uses goes in core.js. A new file goes in index.html's
//     list, before boot.js, and in check.py's view of the world automatically.
//
//   NAMING
//     Newer features prefix everything they own, so a name tells you where it
//     belongs and nothing collides: ts* training status, news*, insp*
//     inspections, sds* safety data sheets, crane* the qualification, inv*
//     Personal Inventory. Older code predates the habit. Follow it for anything
//     new: every file shares one set of names.
//
//   THINGS THAT WILL BITE YOU
//     - This page is PUBLIC. It ships the publishable key, which is meant to
//       ship. The service_role key must never appear here. What a person may
//       see or change is decided by row level security in the database, not
//       by which buttons this page draws.
//     - No inline scripts or onclick="" attributes: the page's security policy
//       runs only this site's files (and the one inline script in the head, by
//       its hash). Wire a handler with addEventListener.
//     - supabase-js builders don't run until awaited. db.rpc(...) on its own
//       never fires; it needs an await or a .then().
//     - Edge functions need their CORS block or calls from here fail silently.
//
// ============================================================================

// The core: what every page needs before anything else
//
// Faults and the version check, the Supabase client and the shared state,
// signing in and out (including the idle sign-out), start() after sign-in,
// loading everything, the icons, and the small helpers every feature uses:
// esc(), fmtDate(), speak(), notify(), hero() and the rest.

// ---- faults & version ---------------------------------------------------------------
//
// A mistake in one part of the page mustn't blank the rest of it. Pages and
// admin tabs are drawn through safely() and showView(), which catch an error
// in one part, log it, and let the rest draw; anything else that throws, a
// button's handler say, shows the same small banner. The console has the
// details, and the person gets a way to reload. This comes first so that even
// a library that failed to load from its CDN ends in a message, not a blank page.
function reportFault(where, error) {
  console.error(`Agri-Service: ${where} failed.`, error);
  showBanner("faultBanner", "Part of this page didn't work. Reload to try again; if it keeps happening, tell the training department.");
}

// A message along the bottom of the window, once, with Reload and a close.
function showBanner(id, text) {
  if (document.getElementById(id) || !document.body) return;
  const bar = document.createElement("div");
  bar.id = id;
  bar.className = "page-banner";
  bar.setAttribute("role", "alert");
  bar.innerHTML = `<span>${esc(text)}</span><button type="button" data-banner-reload>Reload</button>
    <button type="button" class="ghost" data-banner-close aria-label="Close">&times;</button>`;
  document.body.appendChild(bar);
}

// Each part drawn on its own: one that fails leaves the others standing.
function safely(...parts) {
  for (const part of parts) {
    try { part(); } catch (error) { reportFault(part.name || "Part of the page", error); }
  }
}

window.addEventListener("error", (event) => {
  // Only this page's own mistakes: a browser extension's aren't ours to report.
  if (event.filename && !event.filename.startsWith(location.origin)) return;
  if (event.message === "Script error." || /ResizeObserver loop/.test(event.message || "")) return;
  reportFault("Something on the page", event.error || event.message);
});
window.addEventListener("unhandledrejection", (event) => {
  if (event.reason && event.reason.name === "AbortError") return;
  reportFault("Something on the page", event.reason);
});
document.addEventListener("click", (event) => {
  if (event.target.closest("[data-banner-reload]")) location.reload();
  const close = event.target.closest("[data-banner-close]");
  if (close) close.closest(".page-banner").remove();
});

// The version this page is, and whether a newer one has been published since
// it was opened. A tab left open for days would keep running old code against
// a database that has moved on, so every ten minutes, and whenever the tab
// comes back into view, it asks for version.json and offers to reload.
const PAGE_VERSION = (document.querySelector('meta[name="app-version"]') || {}).content || "dev";
// Shown at the foot of the sidebar, so "which version are you on?" has an answer.
if (PAGE_VERSION !== "dev") document.getElementById("appVersion").textContent = `Version ${PAGE_VERSION}`;

async function checkVersion() {
  if (PAGE_VERSION === "dev" || document.getElementById("versionBanner")) return;
  try {
    const response = await fetch(`version.json?t=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) return;
    const { version } = await response.json();
    if (version && version !== PAGE_VERSION) {
      showBanner("versionBanner", "A newer version of this page has been published. Reload to get it; anything you haven't saved will be lost.");
    }
  } catch { /* no signal: ask again next time */ }
}
setInterval(checkVersion, 10 * 60 * 1000);
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") checkVersion(); });

// The publishable key is a client key by design — row level security is what
// protects the data, not this string. It is the same key the iOS app ships.

const SUPABASE_URL = "https://gzmtxsgaulzkghaqyibt.supabase.co";
const SUPABASE_KEY = "sb_publishable_Yvapp2YhfG8tTRKw4ihCCg_OjmKkvNQ";

const db = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const $ = (id) => document.getElementById(id);
let me = null, profile = null;
let certs = [], plans = [], people = [], supportRoles = [], locations = {};
// Designations (migration 0066): what there is, and who holds which.
let designations = [], personDesignations = [], designationsError = null;
// Forklift certification removals (migration 0067): who, for everyone, and
// why, for owners and the person themselves. Both keyed on match_key.
let forkliftRemovedAt = {}, forkliftRemovals = {};
let sharedTasks = [], personalTasks = [], hiddenTasks = [], completions = [];
let tickets = [], workGroups = [];
let payroll = [], holidays = [], directory = [], sharedLogins = [];
// Every shared reminder, including ones switched off — sharedTasks above holds
// only the showing ones, because that's all the Reminders view needs.
let allSharedTasks = [];
// Admins get drafts back as well; the Event Center view filters them out.
let companyEvents = [], eventsError = null;
// Who's going (0077): every list this person can see, and the event open in
// the Event Center.
let eventAttendees = [], openEventId = null;
// Every location with all its columns, switched-off ones included. `locations`
// above stays a plain id -> name lookup for showing names.
let allLocations = [];

// Admins approve lift plans for their own location, so plenty of the page keys off
// this. The Admin button does not — see isOwner.
const isAdmin = () => profile && (profile.role === "admin" || profile.role === "owner");

// The admin tables are the whole company's records: every certification, every
// location's plans, the support roles everyone sees. That's an owner's view, not a
// location admin's, so the button is theirs alone.
//
// This hides a door rather than locking one. What anybody can actually read or
// change is decided by the database policies, which don't consult this.
const isOwner = () => profile && profile.role === "owner";

// Locations admins cover besides their own (migration 0099): every row for an
// owner, your own for anyone else.
let coveredLocations = [];
// Where you act as the location admin: your home, and any an owner has you
// covering. The database's admin_at() has the final word.
const myLocations = () => {
  const home = profile && profile.location_id;
  const covers = isAdmin() && !isOwner() && me
    ? coveredLocations.filter(c => c.person_id === me.id).map(c => c.location_id) : [];
  return [...new Set([home, ...covers].filter(Boolean))];
};
const adminAt = (loc) => !!loc && isAdmin() && myLocations().includes(loc);
const myLocationNames = () => myLocations().map(id => locations[id] || id);

// ---------------------------------------------------------------- auth

$("signIn").onclick = async () => {
  $("authError").textContent = "";
  const { data, error } = await db.auth.signInWithPassword({
    email: $("email").value.trim(),
    password: $("password").value
  });
  if (error) {
    $("authError").textContent = /banned/i.test(error.message)
      ? "This account has been deactivated. Ask the training department if that's a mistake."
      : error.message;
    return;
  }
  // Back in after a sign-in ran out (see onAuthStateChange below): the same
  // person carries on with the page as it was. Anybody else starts clean, so
  // one person's records never sit on screen under another's sign-in.
  if (me) {
    if (data.user && data.user.id === me.id) {
      me = data.user;
      document.body.classList.add("signed-in");
      return;
    }
    return location.reload();
  }
  await start();
};

// Set by the Sign out button, so its own sign-out isn't taken for one that ran out.
let signingOut = false;
$("signOut").onclick = async () => { signingOut = true; await db.auth.signOut(); location.reload(); };

// ---- signing out a computer left alone ----
//
// On a shared computer, a location's front desk or the parts counter, a page
// left signed in is the next person's way into an owner's or an admin's
// access. So an owner or admin who hasn't touched the page for 30 minutes, in
// any tab of it (a course playing counts, see course.html), is signed out,
// and the page starts again clean, with nothing of theirs left on it. Not
// while a course is uploading. Everyone else stays signed in: theirs only
// reaches their own records.
const IDLE_LIMIT = 30 * 60 * 1000;
const IDLE_KEY = "agri.lastActive";
let lastActive = Date.now();
function noteActive() {
  const now = Date.now();
  if (now - lastActive < 15000) return;   // written every 15 seconds at most
  lastActive = now;
  try { localStorage.setItem(IDLE_KEY, String(now)); } catch { /* private window: this tab only */ }
}
["pointerdown", "pointermove", "keydown", "wheel", "touchstart", "scroll"].forEach(type =>
  addEventListener(type, noteActive, { passive: true, capture: true }));
function idleFor() {
  let shared = 0;
  try { shared = Number(localStorage.getItem(IDLE_KEY)) || 0; } catch { /* private window: this tab only */ }
  return Date.now() - Math.max(lastActive, shared);
}
async function signOutIfIdle() {
  if (!me || !isAdmin() || signingOut || ocBusy || idleFor() < IDLE_LIMIT) return;
  signingOut = true;
  await db.auth.signOut().catch(() => {});
  location.replace(location.pathname + "?signedout=idle");
}
setInterval(signOutIfIdle, 60000);
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") signOutIfIdle(); });
if (new URLSearchParams(location.search).get("signedout") === "idle") {
  $("authError").textContent = "You were signed out after 30 minutes without use, so nobody else at this computer "
    + "can use your account. Sign in again to carry on.";
  history.replaceState(null, "", location.pathname);
}

// A sign-in can end without Sign out being pressed here: a renewal refused
// after the computer slept, or Sign out in another tab. The page used to carry
// on regardless, sending everything as nobody, so the database refused each
// change with "permission denied for function …". Now the sign-in box comes
// back over the page. Nothing underneath is cleared, so signing in again
// carries on where it was, an upload waiting to publish included.
function signInRanOut() {
  if (!me || signingOut || !document.body.classList.contains("signed-in")) return;
  document.body.classList.remove("signed-in");
  $("email").value = me.email || "";
  $("password").value = "";
  $("authError").textContent = "Your sign-in ran out. Sign in again to carry on — the page is kept as it was.";
}

db.auth.onAuthStateChange((event) => {
  if (event === "SIGNED_OUT") signInRanOut();
});

// Back to a tab left open for a while: check the sign-in is still good before
// anything is pressed, rather than finding out from a refused change.
document.addEventListener("visibilitychange", async () => {
  if (document.visibilityState !== "visible" || !me) return;
  const { data } = await db.auth.getSession();
  if (!data.session) signInRanOut();
});
$("adminBtn").onclick = () => document.body.classList.contains("admin-mode") ? showHome() : showAdmin();
$("safetyBtn").onclick = () => document.body.classList.contains("safety-mode") ? showHome() : showSafety();
$("trainingBtn").onclick = () => document.body.classList.contains("training-mode") ? showHome() : showTraining();
$("locationBtn").onclick = () => document.body.classList.contains("location-mode") ? showHome() : showLocation();
$("wordmark").onclick = () => { if (me) showHome(); };

async function start() {
  const { data: { user } } = await db.auth.getUser();
  if (!user) return;
  me = user;
  lastActive = Date.now();
  try { localStorage.setItem(IDLE_KEY, String(lastActive)); } catch { /* private window: this tab only */ }

  document.body.classList.add("signed-in");
  $("signOut").classList.remove("hidden");

  const { rest } = await loadAll({ restInBackground: true });

  // Deactivated since they last signed in: out, and told why.
  if (profile && profile.deactivated_at) {
    await db.auth.signOut();
    me = null;
    document.body.classList.remove("signed-in");
    $("authError").textContent = "This account has been deactivated. Ask the training department if that's a mistake.";
    return;
  }

  const name = (profile && profile.full_name) || user.email;
  $("who").innerHTML =
    `<span class="who-avatar">${esc(initials(name))}</span>` +
    `<span class="who-text"><b>${esc(name)}</b><small>${esc(
      locations[profile && profile.location_id] || "No location set")}</small></span>`;
  $("adminBtn").classList.toggle("hidden", !isOwner());
  $("safetyBtn").classList.toggle("hidden", !isSafetyManager());
  $("trainingBtn").classList.toggle("hidden", !isTrainingManager());
  $("locationBtn").classList.toggle("hidden", !isLocationAdmin());

  showHome();
  // The rest, once it's in: the screen showing is drawn again with it, unless
  // something on it has been typed into or picked since it opened.
  rest.then(() => { refreshShown(); agcoRepairMaps(); }, (error) => console.error("loading the rest of the page", error));
}

let viewShown = null, screenTouched = false;
["input", "change"].forEach(type => document.addEventListener(type, (event) => {
  if (event.target.closest && event.target.closest("#view, #admin")) screenTouched = true;
}, true));
function refreshShown() {
  if (!me || screenTouched) return;
  const y = window.scrollY;
  const page = document.body.dataset.page;
  if (page === "home") showHome();
  else if (page === "view" && viewShown) showView(viewShown);
  else if (page === "training") showTraining(trainingTab);
  else if (page === "safety") showSafety(safetyTab);
  else if (page === "location") showLocation();
  else if (page === "admin") showAdmin();
  window.scrollTo(0, y);
}

// ---------------------------------------------------------------- loading

// Everything the page shows, in two batches. The first is what the home page
// and the sign-in checks need: your profile, the locations, the counts. The
// rest (Training Status, AGCO, the Safety Desk, news, events and so on) is
// the bulk of it. Signing in waits only for the first, shows the home page,
// and lets the rest come in behind it (start); every other caller, after a
// change on an admin page, waits for both as it always did.
async function loadAll({ restInBackground = false } = {}) {
  const [locs, c, p, pe, sr, wt, pt, ht, tc, tk, gr, pr, ph, dir, sl, allWt, trr, ds, pds, frm, frr, cov, req, creq] =
    await Promise.all([
    db.from("locations").select("*").order("sort_order"),
    db.from("forklift_certifications").select("*"),
    db.from("lift_plans").select("*").order("submitted_at", { ascending: false }),
    db.from("profiles").select("id,full_name,email,role,location_id,groups,deactivated_at,created_at,employee_number"),
    db.from("support_roles").select("*, support_people(*)").order("sort_order"),
    db.from("weekly_tasks").select("*").eq("is_active", true).order("sort_order"),
    db.from("personal_tasks").select("*").is("archived_at", null),
    db.from("hidden_shared_tasks").select("task_id"),
    db.from("task_completions").select("task_id,week_start")
      .in("week_start", [periodKey("daily"), periodKey("weekly"), periodKey("monthly")]),
    db.from("support_tickets").select("*, support_ticket_comments(*)")
      .order("last_activity_at", { ascending: false }),
    db.from("groups").select("*").order("sort_order"),
    db.from("payroll_periods").select("*").order("payday"),
    db.from("payroll_holidays").select("*").order("sort_order"),
    db.from("directory_entries").select("*").order("sort_order"),
    db.from("shared_logins").select("*").order("id"),
    db.from("weekly_tasks").select("*").order("sort_order"),
    db.from("training_reports").select("*"),
    db.from("designations").select("*").order("sort_order"),
    db.from("person_designations").select("person_id,designation_id,assigned_by_name,assigned_at"),
    db.rpc("forklift_removals"),
    db.from("forklift_certification_removals").select("*"),
    db.from("covered_locations").select("person_id,location_id"),
    db.from("forklift_required").select("*").order("name"),
    db.from("crane_required").select("*").order("name")
  ]);

  allLocations = locs.data || [];
  locations = Object.fromEntries(allLocations.map(l => [l.id, l.name]));
  certs = c.data || []; plans = p.data || []; people = pe.data || [];
  designations = ds.data || []; personDesignations = pds.data || [];
  forkliftRemovedAt = Object.fromEntries((frm.data || []).map(r => [r.person_key, r.removed_at]));
  forkliftRemovals = Object.fromEntries((frr.data || []).map(r => [r.person_key, r]));
  // Before 0099 there's no such table, and nobody covers anywhere.
  coveredLocations = cov.error ? [] : cov.data || [];
  // Before 0100 and 0102 there's no such table: nobody is required, and the tab says why.
  [[reqKinds.forklift, req], [reqKinds.crane, creq]].forEach(([k, r]) => {
    k.rows = r.error ? [] : r.data || [];
    k.error = r.error ? r.error.message : null;
  });
  designationsError = ds.error || pds.error ? (ds.error || pds.error).message : null;
  supportRoles = sr.data || [];
  sharedTasks = wt.data || []; personalTasks = pt.data || [];
  hiddenTasks = (ht.data || []).map(r => r.task_id);
  completions = tc.data || [];
  tickets = tk.data || [];
  workGroups = gr.data || [];
  payroll = pr.data || []; holidays = ph.data || []; directory = dir.data || [];
  sharedLogins = sl.data || [];
  allSharedTasks = allWt.data || [];
  trainingReports = Object.fromEntries((trr.data || []).map(r => [r.id, r]));
  trainingReportsError = trr.error ? trr.error.message : null;
  // Only your own profile comes back for most people — that policy is the
  // point — so the page reads it out of the list rather than asking twice.
  // Set before the rest loads, so nothing in it reads last time's.
  profile = people.find(r => r.id === me.id) || null;

  const rest = Promise.all([loadEvents(), loadInspections(), loadCourses(), loadSds(),
    loadArticles(), loadSkills(), loadNews(), loadTrainingStatus(), loadCrane(), loadCompanyDocs(), loadTools(),
    loadAgco(), loadMockSchedules(), loadSafetyDesk(), loadSafetyReportData(), loadCommunity(), loadFitness(), loadOnlineCourses(), loadForkliftCourse(), loadFkWaiting(), loadInventory()]);
  // Wrapped, because an async function handing back a promise would wait for it.
  if (restInBackground) return { rest };
  await rest;
}

// ---------------------------------------------------------------- icons
//
// Line icons drawn from primitives rather than an icon font: this page is one
// file people save to a desktop, and a missing font would leave holes.

const ICONS = {
  training: '<path d="M3 8 12 3l9 5-9 5-9-5Z"/><path d="M7 11v5c0 1 2.2 2.5 5 2.5s5-1.5 5-2.5v-5"/>',
  reminders: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>',
  forklift: '<circle cx="7" cy="18" r="2"/><circle cx="15" cy="18" r="2"/><path d="M4 16V8h7v8"/><path d="M15 4v12M15 8h4"/>',
  safety: '<path d="M12 3 20 6v6c0 4.5-3.5 7.5-8 9-4.5-1.5-8-4.5-8-9V6l8-3Z"/><path d="m9 12 2 2 4-4"/>',
  rigging: '<path d="M4.5 21h7M8 21V8l11-4v8.5"/><path d="M19 12.5a2.6 2.6 0 1 0 2.6 2.6"/>',
  support: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3.5"/><path d="m5.6 5.6 3.9 3.9M14.5 14.5l3.9 3.9M18.4 5.6l-3.9 3.9M9.5 14.5l-3.9 3.9"/>',
  inspection: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h4"/><path d="M14 3v5h5v3"/><circle cx="16" cy="16" r="3"/><path d="m18.2 18.2 2.3 2.3"/>',
  events: '<path d="M3 8a2 2 0 0 0 2-2h14a2 2 0 0 0 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 0-2 2H5a2 2 0 0 0-2-2v-2a2 2 0 0 0 0-4Z"/><path d="M9 6v12"/>',
  doc: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z"/><path d="M14 3v5h5"/>',
  home: '<path d="m3 11 9-7 9 7"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  calendarCheck: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/><path d="m9 15.5 2 2 4-4"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  person: '<circle cx="12" cy="8" r="4"/><path d="M4.5 20.5c.9-3.8 3.9-6 7.5-6s6.6 2.2 7.5 6"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3.5 6.5 8.5 7 8.5-7"/>',
  pencil: '<path d="M4 20h4L19 9l-4-4L4 16v4Z"/><path d="m13.5 6.5 4 4"/>',
  level: '<path d="M5 20v-6M12 20V9M19 20V4"/>',
  phone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2Z"/>',
  social: '<circle cx="12" cy="7.5" r="3"/><circle cx="5" cy="9" r="2.2"/><circle cx="19" cy="9" r="2.2"/><path d="M7 19.5c.6-3.3 2.6-5.3 5-5.3s4.4 2 5 5.3"/><path d="M2 18c.3-2.3 1.4-3.8 3-4.2M22 18c-.3-2.3-1.4-3.8-3-4.2"/>',
  people: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.5 3.4-5.5 6.5-5.5s5.7 2 6.5 5.5"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14.5c2 .6 3.2 2.5 3.5 5.5"/>',
  megaphone: '<path d="M3 10v4h4l7 5V5L7 10H3Z"/><path d="M18 8a5 5 0 0 1 0 8"/>',
  fitness: '<path d="M3 12h4l2.5-6 4 12 2.5-6H21"/>',
  trophy: '<path d="M8 4h8v5a4 4 0 0 1-8 0Z"/><path d="M16 5.5h3a3 3 0 0 1-3.4 3.4M8 5.5H5a3 3 0 0 0 3.4 3.4"/><path d="M12 13v4M8.5 20h7M10 17h4"/>',
  news: '<path d="M4 5h12v14a2 2 0 0 0 2 2H6a2 2 0 0 1-2-2Z"/><path d="M16 9h4v10a2 2 0 0 1-2 2"/><path d="M7.5 9h5M7.5 13h5M7.5 17h3"/>',
  pin: '<path d="M9 3.5h6l-1 6.5 3.5 3.5h-11L10 10 9 3.5Z"/><path d="M12 13.5V21"/>',
  pinFilled: '<path d="M9 3.5h6l-1 6.5 3.5 3.5h-11L10 10 9 3.5Z" fill="currentColor"/><path d="M12 13.5V21"/>',
  briefcase: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/><path d="M3 12h18"/>',
  wrench: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.8-3.8a6 6 0 0 1-7.9 7.9l-6.9 6.9a2.1 2.1 0 0 1-3-3l6.9-6.9a6 6 0 0 1 7.9-7.9l-3.8 3.8Z"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9M16 7l3 3M14 9l2 2"/>',
  building: '<path d="M4 21V5l8-3v19M12 8h8v13"/><path d="M8 8v.01M8 12v.01M8 16v.01M16 12v.01M16 16v.01"/><path d="M2 21h20"/>',
  chat: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.4-4.9A8 8 0 1 1 21 12Z"/><path d="M8.5 10.5h7M8.5 13.5h4.5"/>',
  tray: '<path d="M3 13h5l1.5 3h5l1.5-3h5"/><path d="M5.5 5h13L21 13v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-6Z"/>',
  monitor: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
  box: '<path d="M3.5 7.5 12 3l8.5 4.5v9L12 21l-8.5-4.5Z"/><path d="M3.5 7.5 12 12l8.5-4.5M12 12v9"/>',
  arrowOut: '<circle cx="12" cy="12" r="9"/><path d="m9 15 6-6M10 9h5v5"/>',
  checkCircle: '<circle cx="12" cy="12" r="9"/><path d="m8 12.5 2.8 2.8 5.7-5.8"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.5v.01"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6"/><path d="m6 7 1 13h10l1-13M9 7V4h6v3"/>',
  chevronDown: '<path d="m6 9 6 6 6-6"/>',
  chevronLeft: '<path d="m15 6-6 6 6 6"/>',
  camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4Z"/><circle cx="12" cy="13" r="3.5"/>',
  video: '<rect x="3" y="6.5" width="12.5" height="11" rx="2"/><path d="m15.5 10.5 5-3v9l-5-3Z"/>',
  userPlus: '<circle cx="10" cy="8" r="4"/><path d="M3 20.5c.8-3.7 3.6-6 7-6 1.6 0 3 .5 4.2 1.3M18.5 14v6M15.5 17h6"/>',
  lock: '<rect x="5" y="11" width="14" height="9.5" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  map: '<path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2Z"/><path d="M9 4v14M15 6v14"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/>'
};

const icon = (name, size = 24) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none"
        stroke="currentColor" stroke-width="1.8" stroke-linecap="round"
        stroke-linejoin="round">${ICONS[name] || ICONS.support}</svg>`;

// A lit colour by name, for a style attribute: `--accent:var(--lit-amber)`.
const lit = (name) => `--accent:var(--lit-${name || "slate"})`;

// A page's name in red. Opening a page, showView turns it into the band
// across the top; anywhere else it's a red card.
const hero = (title, blurb) => `
  <header class="hero">
    <h1>${esc(title)}</h1>${blurb ? `<p>${esc(blurb)}</p>` : ""}
  </header>`;

const comingSoon = (message) => `
  <div class="card" style="text-align:center;border-style:dashed;padding:34px 24px">
    <b style="font-size:20px;display:block;margin-bottom:6px">Coming soon</b>
    <span class="note">${esc(message)}</span>
  </div>`;

// A Center's link, as a slate card in the link's colour (FeatureCard in the app).
const linkCard = (link) => link.view ? `
  <button type="button" class="link-card" data-view="${esc(link.view)}"
          style="width:100%;text-align:left;font:inherit;color:inherit;cursor:pointer;${lit(link.tint)}">
    <span class="well">${icon(link.icon || "doc")}</span>
    <span><b>${esc(link.title)}</b>
      ${link.sub ? `<span>${esc(link.sub)}</span>` : ""}
      <span class="go">Open &rarr;</span></span>
  </button>` : `
  <a class="link-card" href="${esc(link.url)}" target="_blank" rel="noopener" style="${lit(link.tint)}">
    <span class="well">${icon(link.icon || "doc")}</span>
    <span><b>${esc(link.title)}</b>
      ${link.sub ? `<span>${esc(link.sub)}</span>` : ""}
      <span class="go">Open &nearr;</span></span>
  </a>`;

// Cards side by side where there's room.
const linkGrid = (html) => html ? `<div class="link-grid">${html}</div>` : "";

function esc(s) {
  return String(s ?? "").replace(/[&<>"]/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

// Keeps the first of any entries that differ only by capitals.
function uniqueText(list) {
  const seen = new Set();
  return list.filter(item => {
    const key = item.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function fmtDate(d) {
  if (!d) return "—";
  return new Date(d + "T00:00:00").toLocaleDateString(undefined,
    { year: "numeric", month: "short", day: "numeric" });
}

// A venue date ("2026-09-15") as a local Date at noon, only for formatting —
// noon keeps it on the same day whatever zone this computer is in.
const dateOnly = (ymd) => new Date(`${ymd}T12:00:00`);

const pad2 = (n) => String(n).padStart(2, "0");

const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

// "2026-09-03" -> "Sep 3, 2026", read as a local date so it doesn't slip a day.
function newsDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || "");
  if (!m) return "";
  return new Date(+m[1], +m[2] - 1, +m[3])
    .toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function speak(element, text, bad) {
  // A card without a .msg used to throw here, which turned "the server said
  // no" into a silent exception and no feedback at all. Say it out loud
  // instead — an unmissable alert beats a message nobody can see.
  const msg = element && element.querySelector(".msg");
  if (!msg) {
    if (bad) alert(text);
    return;
  }
  msg.textContent = text;
  msg.className = "msg " + (bad ? "error" : "ok");

  // Refused because the sign-in has gone, not because of anything on the
  // card: say so, and bring the sign-in box back (signInRanOut).
  if (bad && /permission denied for function|jwt expired/i.test(text)) {
    db.auth.getSession().then(({ data }) => {
      if (data.session) return;
      msg.textContent = "That wasn't saved: your sign-in had run out. Sign in again, then press it once more.";
      signInRanOut();
    });
  }
}

// Buttons that open an email to everyone in BCC, so nobody sees the list. Mail
// apps refuse a link past about 2,000 characters, so a long list is split into
// a few emails. The @ stays as it is: some mail apps don't decode it.
function bccButtons(emails) {
  const mailto = (group) => "mailto:?bcc=" + group.map(e => encodeURIComponent(e).replace(/%40/g, "@")).join(",");
  const batches = [];
  emails.forEach(e => {
    const last = batches[batches.length - 1];
    if (last && mailto([...last, e]).length <= 1900) last.push(e); else batches.push([e]);
  });
  let from = 1;
  const html = batches.map(group => {
    const label = batches.length === 1 ? `Email all ${group.length}` : `Email ${from}–${from + group.length - 1}`;
    from += group.length;
    return `<a class="sd-mail" href="${esc(mailto(group))}">${icon("mail", 16)}${label}</a>`;
  }).join("");
  return { html, split: batches.length > 1 };
}

// Tells the notify function something changed, so the people waiting on it get
// a push. It's told only what changed — the function reads the record and
// decides who to tell. A failure here never fails the thing that just worked.
async function notify(kind, id) {
  try {
    await db.functions.invoke("notify", { body: { kind, id } });
  } catch (e) {
    console.log("notify failed", e);
  }
}

const fileSize = (bytes) => !bytes ? "" :
  bytes > 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;

const shopName = (id) => locations[id] || id || "another location";
