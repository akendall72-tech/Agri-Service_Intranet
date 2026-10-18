// The shell: the home page, the menu and moving between pages
//
// The Centers and their links (as in the app's HomeDestination), the home
// page and its summary, showView() and the other modes (Admin, Training,
// Safety, Location), the page registry (VIEWS), the sidebar, and the tab and
// column-sort wiring the admin workspace shares.

// ---------------------------------------------------------------- the app
//
// Same features, same order, same wording as HomeDestination.swift. News is
// one of the company pages below, as it's a tab rather than a Center in the app.

// `accent` is the colour of its home tile, the app's HomeDestination.tint lit
// for a dark card. Social (the community, and Events) is a tab in the app
// rather than a tile, so it has its own.
const FEATURES = [
  { id: "training",  title: "Training Center", sub: "Courses & requirements", accent: "deep" },
  { id: "reminders", title: "Reminders", sub: "Daily, weekly & monthly", accent: "red" },
  { id: "forklift",  title: "Forklift Center", sub: "Course, test & records", accent: "amber" },
  { id: "safety",    title: "Safety Center", sub: "Reports & training", accent: "ember" },
  { id: "rigging",   title: "Crane Center", sub: "Lift plans & approvals", accent: "steel" },
  { id: "support",   title: "Support Center", sub: "IT help & requests", accent: "slate" },
  { id: "inspection", title: "Inspection Center", sub: "Checks & walk-arounds", accent: "deep" },
  { id: "social",    title: "Social", sub: "Shout-outs & events", accent: "amber" }
];

// The home page's groups, as in the app's HomeGroup, with Social in "Your day"
// beside Reminders.
const HOME_GROUPS = [
  { title: "Your day", ids: ["reminders", "social"], rows: true },
  { title: "On the job", ids: ["rigging", "inspection", "forklift", "safety"] },
  { title: "Learning & help", ids: ["training", "support"] }
];

// `tint` and `icon` are the card's colour and glyph, the same colours as the
// app's cards for these (TrainingHubModel.swift and the Centers' views).
const TRAINING_LINKS = [
  // SCORM courses taken here or in the app (0091). See onlineCoursesView.
  { title: "Online Courses", sub: "Take a course here or in the app", view: "olt", tint: "teal", icon: "monitor" },
  // Edited on the Training dashboard's Course Catalog tab.
  { title: "Course Catalog", sub: "Agri-Service courses", view: "catalog", tint: "ember", icon: "doc" },
  // Competencies and sign-offs; see skillsView.
  { title: "Skills", sub: "Competencies and sign-offs", view: "skills", tint: "amber", icon: "wrench" },
  // Built from the uploads on the admin page's Open Seat Report tab.
  { title: "Open Seat Report", sub: "Request registration", view: "openseat", tint: "green", icon: "calendar" },
  // The classes you're registered for, found by your email on that report's
  // rosters, as the app's My Classes. See myClassesView.
  { title: "My Classes", sub: "Where you're registered", view: "myclasses", tint: "deep", icon: "calendarCheck" },
  // AGCO hours, 609 and history: yours, your location's, or everyone's. Its
  // Classes tab, for location admins and owners, is who has and hasn't taken a
  // class (it was the Course Report). See trainingStatusView.
  { title: "Training Status", sub: "AGCO hours, 609 and history", view: "trainingstatus", tint: "slate",
    icon: "training" },
  // The AGCO Development Map follows, as one wide button (agcoLinkCard), then
  // the articles from the Training dashboard's Training Articles tab.
];

// The same three as the app's Forklift Center, with the card drawn above them.
// Until there's a card, its spot shows the online course and the driving test
// countdown (forkliftCourseCard, migration 0092).
const FORKLIFT_LINKS = [
  { title: "Certification Report", sub: "Who is certified and when each card runs out.",
    view: "certreport", tint: "slate", icon: "people", adminOnly: true },
  { title: "Forklift Driving Test", sub: "Evaluate someone on a truck and record the result.",
    view: "evaltest", tint: "teal", icon: "reminders" }
];

const SAFETY_LINKS = [
  { title: "Safety Desk", sub: "This month's Safety Brief: read it, then answer a few questions. Everyone, every month.",
    tint: "teal", icon: "doc", view: "safetydesk" },
  { title: "Submit a Safety Report", sub: "Report an incident, near miss, hazard or idea. It goes to the Safety Manager.",
    tint: "ember", icon: "megaphone", view: "safetyform" }
];

// ---------------------------------------------------------------- routing

function showHome() {
  viewShown = null; screenTouched = false;
  $("admin").classList.add("hidden");
  $("view").classList.add("hidden");
  $("home").classList.remove("hidden");
  setMode("app", "home");
  document.body.dataset.page = "home";
  evalAgreed = null; evalNotice = "";

  const first = ((profile && profile.full_name) || "").split(" ")[0];
  $("greeting").textContent = first || "Welcome back";
  $("greetingEyebrow").classList.toggle("hidden", !first);
  const shop = (profile && locations[profile.location_id]) || "";
  $("homeLocation").innerHTML = shop ? `${icon("pin", 14)}${esc(shop)}` : "";
  $("homeDate").textContent = new Date().toLocaleDateString(undefined,
    { weekday: "long", month: "long", day: "numeric", year: "numeric" });
  safely(function homeSummary() {
    $("homeStats").innerHTML = homeStats();
    $("homeStats").style.setProperty("--n", $("homeStats").children.length);
  }, function homeCenters() {
    $("tiles").innerHTML = HOME_GROUPS.map(group => `
      <section>
        <h2 class="cab-heading">${esc(group.title)}</h2>
        <div class="cab-grid ${group.rows ? "rows" : group.ids.length === 4 ? "tiles4" : ""}">
          ${group.ids.map(id => homeTile(FEATURES.find(f => f.id === id), group.rows)).join("")}
        </div>
      </section>`).join("");
  }, function homeNewsColumn() {
    const news = homeNews();
    $("homeNews").innerHTML = news;
    $("homeNews").classList.toggle("hidden", !news);
    $("homeGrid").classList.toggle("solo", !news);
  });
  window.scrollTo(0, 0);
}

// A Center on the home page: a tile, or a full-width row in "Your day".
function homeTile(f, row) {
  const n = tileCount(f.id);
  const badge = n ? `<span class="cab-badge" aria-label="${n} ${f.id === "social" ? "new" : "waiting"}">${n}</span>` : "";
  return row
    ? `<button class="cab-row cab-glass cab-stripe" data-view="${f.id}" style="${lit(f.accent)}">
        <span class="cab-glyph">${icon(f.id, 22)}</span>
        <span><b>${esc(f.title)}</b><span>${esc(f.sub)}</span></span>
        ${badge}<span class="cab-chev" aria-hidden="true">&rsaquo;</span>
      </button>`
    : `<button class="cab-tile cab-glass cab-stripe" data-view="${f.id}" style="${lit(f.accent)}">
        <span class="cab-glyph">${icon(f.id, 23)}</span>
        <b>${esc(f.title)}</b><span>${esc(f.sub)}</span>${badge}
      </button>`;
}

// The newest three stories: the first with its picture, two more beneath.
// Opening one works as it does on News; only News itself marks them read.
function homeNews() {
  if (newsError) return "";
  const top = newsLive().slice(0, 3);
  if (!top.length) return "";
  const meta = (p) => `<span class="hn-meta"><span class="src${p.kind === "post" ? " post" : ""}">${
      esc(newsSource(p))}</span><span>${esc(newsDate(p.published_on))}${newsLink(p) ? " &nearr;" : ""}</span>${
      newsIsNew(p) ? `<span class="hn-new">New</span>` : ""}</span>`;
  const [lead, ...rest] = top;
  return `<h2 class="cab-heading">Latest news</h2>
    <div class="cab-glass">
      <div class="hn-lead">${newsOpen(lead, `${newsPicture(lead)}
        <span class="hn-text" style="display:block">${meta(lead)}<b>${esc(lead.title)}</b>${
          lead.summary ? `<span class="hn-sum">${esc(lead.summary)}</span>` : ""}</span>`)}</div>
      ${rest.map(p => `<div class="hn-row">${newsOpen(p, `${newsPicture(p)}
        <span style="min-width:0"><b>${esc(p.title)}</b>${meta(p)}</span>`)}</div>`).join("")}
      <button type="button" class="hn-all" data-view="news">All news <span aria-hidden="true">&rarr;</span></button>
    </div>`;
}

// The same two badges the app shows on its home screen.
function tileCount(id) {
  if (id === "reminders") return visibleTasks().filter(t => !t.done).length;
  // Posts since the feed was last read, here or on the phone.
  if (id === "social") return cmUnseenCount();
  // For a Safety Manager, the reports waiting for their approval.
  if (id === "safety") return isSafetyManager() ? srReports.filter(srPending).length : 0;
  if (id === "forklift") return isTrainingManager() ? pendingTests().length : 0;
  if (id === "rigging") {
    return isAdmin()
      ? plans.filter(p => p.status === "submitted" && p.created_by !== me.id).length
      : plans.filter(p => p.status === "changes_requested").length;
  }
  return 0;
}

// The Support Center's own pages, under it in the crumbs and the sidebar.
const SUPPORT_PAGES = ["requests", "request", "newrequest", "tools", "tool", "toolform"];
// Social's: Events and the Company community.
const SOCIAL_PAGES = ["events", "event", "community", "communitypost", "fitness"];

function showView(name) {
  viewShown = name; screenTouched = false;
  $("home").classList.add("hidden");
  $("admin").classList.add("hidden");
  const host = $("view");
  host.classList.remove("hidden");
  setMode("app", ["openseat", "myclasses", "catalog", "olt", "article", "skills", "trainingstatus", "coursereport", "agcomap"].includes(name) ? "training"
    : name === "newspost" ? "news" : ["payroll", "inventory"].includes(name) ? "hr" : ["certreport", "evaltest", "approvals"].includes(name) ? "forklift" : name === "inspform" ? "inspection"
    : SUPPORT_PAGES.includes(name) ? "support" : SOCIAL_PAGES.includes(name) ? "social" : SAFETY_PAGES.includes(name) ? "safety" : name);
  if (name !== "safetybrief" && briefTimer) { clearInterval(briefTimer); briefTimer = null; }
  document.body.dataset.page = "view";
  if (name !== "evaltest") { evalAgreed = null; evalNotice = ""; }
  if (name !== "tool") toolCheckingOut = false;
  let title = "Agri-Service", page;
  try { title = pageTitle(name); } catch (error) { reportFault(`The title of ${name}`, error); }
  try { page = VIEWS[name](); } catch (error) {
    reportFault(`The ${title} page`, error);
    page = hero(title) + `<div class="card"><b>This page didn't load.</b>
      <p class="note">Something went wrong drawing it. Reload to try again; if it keeps happening, tell the training department.</p>
      <button type="button" data-banner-reload>Reload</button></div>`;
  }
  host.innerHTML = `<nav class="crumbs"><button data-home>Home</button><span>/</span>
    ${name === "newspost" ? `<button data-view="news">News</button><span>/</span>` : ""}
    ${["payroll", "inventory"].includes(name) ? `<button data-view="hr">HR</button><span>/</span>` : ""}
    ${["certreport", "evaltest", "approvals"].includes(name) ? `<button data-view="forklift">Forklift Center</button><span>/</span>` : ""}
    ${name === "inspform" ? `<button data-view="inspection">Inspection Center</button><span>/</span>` : ""}
    ${SOCIAL_PAGES.includes(name) ? `<button data-view="social">Social</button><span>/</span>` : ""}
    ${name === "event" ? `<button data-view="events">Event Center</button><span>/</span>` : ""}
    ${name === "communitypost" ? `<button data-view="community">Company</button><span>/</span>` : ""}
    ${SAFETY_PAGES.includes(name) ? `<button data-view="safety">Safety Center</button><span>/</span>` : ""}
    ${["safetybrief", "safetyreport"].includes(name) ? `<button data-view="safetydesk">Safety Desk</button><span>/</span>` : ""}
    ${name === "safetyreportone" ? `<button data-view="safetyreportlist">Safety Reports</button><span>/</span>` : ""}
    ${SUPPORT_PAGES.includes(name) ? `<button data-view="support">Support Center</button><span>/</span>` : ""}
    ${["request", "newrequest"].includes(name) ? `<button data-view="requests">Support Requests</button><span>/</span>` : ""}
    ${["tool", "toolform"].includes(name) ? `<button data-view="tools">Special Tools</button><span>/</span>` : ""}
    ${name === "toolform" && toolDraft && toolDraft.mode === "edit"
      ? `<button data-view="tool">${esc(toolDraft.name)}</button><span>/</span>` : ""}
    ${["openseat", "myclasses", "catalog", "olt", "article", "skills", "trainingstatus", "coursereport", "agcomap"].includes(name) ? `<button data-view="training">Training Center</button><span>/</span>` : ""}
    <span>${esc(title)}</span></nav>` + page;
  // A page that opens with its title gets the red band across the top, like
  // the app's title bar, with the way back inside it.
  const head = host.children[1];
  if (head && head.classList.contains("hero")) {
    head.prepend(host.children[0]);
    head.classList.add("top");
  }
  window.scrollTo(0, 0);
}

function showAdmin() {
  viewShown = null; screenTouched = false;
  $("home").classList.add("hidden");
  $("view").classList.add("hidden");
  $("admin").classList.remove("hidden");
  setMode("admin");
  document.body.dataset.page = "admin";
  evalAgreed = null; evalNotice = "";
  safely(renderCerts, renderEvalForm, renderPlans, renderPeople, renderSupport, renderToolsAdmin,
    renderPayroll, renderDirectory, renderLogins, renderSharedReminders,
    renderEvents, renderOrg, renderOsrImport, renderOsrLive, renderInspectionsAdmin,
    renderCoursesAdmin, renderSdsAdmin, renderSdsPending, renderArticlesAdmin, renderSkillsAdmin,
    renderNewsAdmin, renderTsImport, renderTsLive, renderHandbook, renderAgcoImport, renderAgcoLive,
    renderAgcoTechs, renderAgcoRules, renderAgcoAdded, renderAgcoBales, renderMockSchedule, renderSafetyAdmin,
    renderSafetyReportAdmin, renderSafetyReportsAdmin, renderFitnessAdmin);
  (document.querySelector(`#adminNav [data-tab="${adminTab}"]`) || document.querySelector("#adminNav [data-tab]")).click();
  window.scrollTo(0, 0);
}

// The Safety dashboard: forklift certifications, lift plans, Safety Reports,
// the Safety Desk and the safety data sheets, for Safety Managers. It shares the admin workspace and
// its handlers, with its own sidebar and a dashboard at the front.
let adminTab = "people", safetyTab = "safetyoverview", trainingTab = "trainingoverview";

// The Training dashboard: the 24-hour metric and who has it, the planning, the
// Mock Schedule, AGCO Development and Skills, with the uploads that keep them
// current grouped together. For Training Managers; it shares the admin
// workspace and its handlers, like Safety.
function showTraining(tab) {
  viewShown = null; screenTouched = false;
  if (!isTrainingManager()) return showHome();
  $("home").classList.add("hidden");
  $("view").classList.add("hidden");
  $("admin").classList.remove("hidden");
  setMode("training");
  document.body.dataset.page = "training";
  evalAgreed = null; evalNotice = "";
  safely(renderMockSchedule, renderSkillsAdmin, renderCoursesAdmin, renderArticlesAdmin, renderTsImport, renderTsLive, renderOsrImport, renderOsrLive,
    renderAgcoImport, renderAgcoLive, renderAgcoTechs, renderAgcoRules, renderAgcoAdded, renderAgcoBales,
    renderTrainingOverview, renderReports, renderOltAdmin);
  (document.querySelector(`#trainingNav [data-tab="${tab || trainingTab}"]`) || document.querySelector("#trainingNav [data-tab]")).click();
  window.scrollTo(0, 0);
}

function showSafety(tab) {
  viewShown = null; screenTouched = false;
  if (!isSafetyManager()) return showHome();
  $("home").classList.add("hidden");
  $("view").classList.add("hidden");
  $("admin").classList.remove("hidden");
  setMode("safety");
  document.body.dataset.page = "safety";
  evalAgreed = null; evalNotice = "";
  safely(renderCerts, renderEvalForm, renderPlans, renderSafetyAdmin, renderSdsAdmin, renderSdsPending,
    renderSafetyReportAdmin, renderSafetyReportsAdmin, renderSafetyOverview, renderFkWaiting,
    renderRequired.bind(null, "forklift"), renderRequired.bind(null, "crane"));
  (document.querySelector(`#safetyNav [data-tab="${tab || safetyTab}"]`) || document.querySelector("#safetyNav [data-tab]")).click();
  window.scrollTo(0, 0);
}

document.addEventListener("click", (event) => {
  const tile = event.target.closest("[data-view]");
  if (tile && tile.dataset.article) openArticleId = tile.dataset.article;
  if (tile && tile.dataset.news) openNewsId = tile.dataset.news;
  if (tile && tile.dataset.cmPost) openCommunityPostId = tile.dataset.cmPost;
  if (tile && tile.dataset.ticket) openTicketId = tile.dataset.ticket;
  if (tile && tile.dataset.event) openEventId = tile.dataset.event;
  if (tile && tile.dataset.brief) openBriefId = tile.dataset.brief;
  if (tile && tile.dataset.tool) { openToolId = tile.dataset.tool; toolNotice = ""; }
  if (tile) return showView(tile.dataset.view);
  if (event.target.closest("[data-home]")) return showHome();
});

// ---------------------------------------------------------------- views

const VIEWS = {
  training: () =>
    hero("Training Center",
         "Course catalog, schedules, certifications, and the AGCO requirements behind them.")
    + linkGrid(TRAINING_LINKS.filter(l => !l.adminOnly || isAdmin()).map(linkCard).join("")
      + (agcoShowsButton() ? agcoLinkCard() : "")) + articleCards(),

  article: () => articleView(),

  safety: () => {
    setTimeout(renderSdsView);
    return hero("Safety Center", "Report what you see, keep your safety training current, and find the safety data sheet for any product.")
      + linkGrid(SAFETY_LINKS.map(linkCard).join("")
        + linkCard(isSafetyManager()
          ? { title: "View a Safety Report", tint: "slate", icon: "reminders", view: "safetyreportlist",
              sub: `Every report sent.${(n => n ? ` ${n} waiting for approval on the Safety dashboard.` : " Approve them on the Safety dashboard and everyone can read them.")(srReports.filter(srPending).length)}` }
          : { title: "View a Safety Report", tint: "slate", icon: "reminders", view: "safetyreportlist",
              sub: "Reports from across the company, approved by the Safety Manager: what happened and what we learned." }))
      + sdsSectionHtml();
  },

  forklift: () =>
    hero("Forklift Center",
         "Your operator card, the online course that starts it, and the driving test.",
         true)
    + forkliftCourseCard()
    + certificationCard()
    + linkGrid((isTrainingManager() ? linkCard({ title: `Driving Tests to Approve${pendingTests().length ? ` (${pendingTests().length})` : ""}`,
        sub: pendingTests().length ? "A test only counts once you approve it." : "Nothing waiting.", view: "approvals",
        tint: "amber", icon: "safety" }) : "")
      // The report is a location admin's or an owner's (0095); anyone else
      // would only find themselves, and their card is above.
      + FORKLIFT_LINKS.filter(l => !l.adminOnly || isAdmin()).map(linkCard).join("")),

  approvals: () => approvalsView(),

  support: () => supportView(),
  requests: () => requestsView(),
  request: () => requestView(),
  newrequest: () => newRequestView(),
  tools: () => toolsView(),
  tool: () => toolView(),
  toolform: () => toolFormView(),

  inspection: () => inspectionView(),

  social: () => socialView(),
  community: () => communityView(),
  communitypost: () => communityPostView(),
  fitness: () => fitnessView(),
  events: () => eventsView(),
  event: () => eventView(),
  safetydesk: () => safetyDeskView(),
  safetybrief: () => safetyBriefView(),
  safetyreport: () => safetyReportView(),
  safetyform: () => safetyFormView(),
  safetyreportlist: () => safetyReportListView(),
  safetyreportone: () => safetyReportOneView(),

  openseat: () => openSeatView(),
  catalog: () => catalogView(),
  olt: () => onlineCoursesView(),
  skills: () => skillsView(),
  trainingstatus: () => trainingStatusView(),
  // The Course Report is Training Status's Classes tab now; an old link lands there.
  coursereport: () => { tsState.tab = "classes"; return trainingStatusView(); },
  myclasses: () => myClassesView(),
  hr: () => hrView(),
  payroll: () => payrollView(),
  inventory: () => inventoryView(),
  directory: () => directoryView(),
  news: () => newsView(),
  newspost: () => newsPostView(),
  reminders: () => remindersView(),
  rigging: () => riggingView(),
  certreport: () => certReportView(),
  evaltest: () => evalTestView(),
  inspform: () => inspFormView(),
  agcomap: () => agcoMapView()
};

// ---------------------------------------------------------------- shell
//
// A top bar, a sidebar and one page at a time. The sidebar shows the app's
// sections, or the admin sections when the admin area is open. Below 960px it
// slides in from the left behind the menu button.

// Pages the web page has that aren't Centers in the app's home grid.
const COMPANY_PAGES = [
  { id: "hr", title: "HR", icon: "briefcase" },
  { id: "directory", title: "Who Does What", icon: "phone" },
  { id: "news", title: "News", icon: "news" }
];

const pageTitle = (id) => (FEATURES.find(f => f.id === id) || COMPANY_PAGES.find(p => p.id === id)
  || { openseat: { title: "Open Seat Report" }, catalog: { title: "Course Catalog" }, olt: { title: "Online Courses" },
       skills: { title: "Skills" },
       trainingstatus: { title: "Training Status" },
       coursereport: { title: "Training Status" },
       myclasses: { title: "My Classes" },
       agcomap: { title: "AGCO Development Map" },
       newspost: { title: (newsPosts.find(p => p.id === openNewsId) || {}).title || "News" },
       hr: { title: "HR" }, payroll: { title: "Payroll Calendar" },
       inventory: { title: invPerson && invPerson !== (me && me.id) ? invName(invPerson) : "Personal Inventory" },
       certreport: { title: "Certification Report" },
       evaltest: { title: "Forklift Driving Test" },
       inspform: { title: inspDraft ? (inspDraft.stage === "after" ? "After Class" : "New Inspection") : "Inspection" },
       approvals: { title: "Driving Tests to Approve" },
       requests: { title: "Support Requests" },
       event: { title: (companyEvents.find(e => e.id === openEventId) || {}).title || "Event" },
       events: { title: "Event Center" }, community: { title: "Company" }, fitness: { title: "Fitness Challenge" },
       communitypost: { title: (cmPosts.find(p => p.id === openCommunityPostId) || {}).shoutout ? "Shout-out" : "Post" },
       safetydesk: { title: "Safety Desk" }, safetyreport: { title: "Safety Brief Report" },
       safetyform: { title: "Safety Report" }, safetyreportlist: { title: "Safety Reports" },
       safetyreportone: { title: (srReports.find(r => r.id === openSafetyReportId) || {}).answers?.title || "Safety Report" },
       safetybrief: { title: (safetyBriefs.find(b => b.id === openBriefId) || {}).title || "Safety Brief" },
       request: { title: "Request" },
       newrequest: { title: "New Request" },
       tools: { title: "Special Tools" },
       tool: { title: (tools.find(t => t.id === openToolId) || {}).name || "Special Tool" },
       toolform: { title: toolDraft && toolDraft.mode === "edit" ? "Edit" : "Add a Tool" },
       // What the app's title bar says: the kicker, "AGCO Training Pathway · 2026".
       article: { title: (a => a && (a.kicker || a.title))(trainingArticles.find(a => a.id === openArticleId)) || "Article" } }[id]
  || { title: "" }).title;

function navButton(id, title, iconName, count, attr) {
  return `<button class="nav-item" ${attr}="${esc(id)}" data-nav="${esc(id)}">
    ${icon(iconName, 18)}<span>${esc(title)}</span>
    ${count ? `<span class="nav-count">${count}</span>` : ""}</button>`;
}

function renderAppNav(active) {
  $("appNav").innerHTML =
    `<button class="nav-item" data-home data-nav="home">${icon("home", 18)}<span>Home</span></button>`
    + `<div class="nav-group">Centers</div>`
    + FEATURES.map(f => navButton(f.id, f.title, f.id, tileCount(f.id), "data-view")).join("")
    + `<div class="nav-group">Company</div>`
    + COMPANY_PAGES.map(p => navButton(p.id, p.title, p.icon,
        p.id === "news" ? newsUnseenCount() : 0, "data-view")).join("")
    + (isOwner() ? `<div class="nav-group">Manage</div>
        <button class="nav-item" data-open-admin>${icon("settings", 18)}<span>Admin</span></button>` : "")
    + (isTrainingManager() ? `<button class="nav-item" data-open-training>${icon("training", 18)}<span>Training</span></button>` : "")
    + (isSafetyManager() ? `<button class="nav-item" data-open-safety>${icon("safety", 18)}<span>Safety</span>${
        (n => n ? `<span class="nav-count">${n}</span>` : "")(srReports.filter(srPending).length)}</button>` : "")
    + (isLocationAdmin() ? `${isOwner() ? "" : `<div class="nav-group">Manage</div>`}
        <button class="nav-item" data-open-location>${icon("building", 18)}<span>Location Dashboard</span></button>` : "");
  document.querySelectorAll("#appNav [data-nav]").forEach(b =>
    b.classList.toggle("active", b.dataset.nav === active));
}

function setMode(mode, active) {
  const admin = mode === "admin", safety = mode === "safety", training = mode === "training", place = mode === "location";
  document.body.classList.toggle("admin-mode", admin);
  document.body.classList.toggle("safety-mode", safety);
  document.body.classList.toggle("training-mode", training);
  document.body.classList.toggle("location-mode", place);
  $("appNav").classList.toggle("hidden", admin || safety || training || place);
  $("adminNav").classList.toggle("hidden", !admin);
  $("safetyNav").classList.toggle("hidden", !safety);
  $("trainingNav").classList.toggle("hidden", !training);
  $("locationNav").classList.toggle("hidden", !place);
  $("brandSub").textContent = admin ? "Admin" : safety ? "Safety" : training ? "Training" : place ? lxName() : "Team Portal";
  $("adminEyebrow").textContent = safety ? "Safety" : training ? "Training" : place ? "Location" : "Admin";
  $("adminBtn").textContent = admin ? "Exit admin" : "Admin";
  $("safetyBtn").textContent = safety ? "Exit safety" : "Safety";
  $("trainingBtn").textContent = training ? "Exit training" : "Training";
  // Not the location's name: a location can be called "Admin", which put two
  // Admin buttons side by side.
  $("locationBtn").textContent = place ? "Exit location" : "Location Dashboard";
  if (!admin && !safety && !training && !place) renderAppNav(active);
  document.body.classList.remove("nav-open");
}

$("menuBtn").onclick = () => document.body.classList.toggle("nav-open");
$("scrim").onclick = () => document.body.classList.remove("nav-open");

document.addEventListener("click", (event) => {
  if (event.target.closest("[data-open-admin]")) showAdmin();
  if (event.target.closest("[data-open-safety]")) showSafety();
  if (event.target.closest("[data-open-training]")) showTraining();
  if (event.target.closest("[data-open-location]")) showLocation();
});

// Icons in the Training dashboard's sidebar, the same way.
document.querySelectorAll("#trainingNav i[data-icon]").forEach(el => {
  el.outerHTML = icon(el.dataset.icon, 18);
});

// Icons in the Location dashboard's sidebar, the same way.
document.querySelectorAll("#locationNav i[data-icon]").forEach(el => {
  el.outerHTML = icon(el.dataset.icon, 18);
});

// Icons in the Safety dashboard's sidebar, the same way.
document.querySelectorAll("#safetyNav i[data-icon]").forEach(el => {
  el.outerHTML = icon(el.dataset.icon, 18);
});

// Icons in the admin sidebar are filled in once, from the same set as the rest.
document.querySelectorAll("#adminNav i[data-icon]").forEach(el => {
  el.outerHTML = icon(el.dataset.icon, 18);
});

// ---- home dashboard ----------------------------------------------------------

function homeStats() {
  const cards = [];
  const today = todayISO();

  const next = payroll.find(p => p.payday && p.payday >= today);
  if (next) {
    const days = Math.round((new Date(next.payday + "T00:00:00") - new Date(today + "T00:00:00")) / 86400000);
    cards.push({ view: "payroll", icon: "calendar", label: "Next payday", value: fmtDate(next.payday),
      sub: days === 0 ? "Today" : days === 1 ? "Tomorrow" : `In ${days} days` });
  }

  const todo = visibleTasks().filter(t => !t.done).length;
  cards.push({ view: "reminders", icon: "reminders", label: "Reminders",
    value: todo ? `${todo} to do` : "All done", sub: todo ? "Daily, weekly and monthly" : "Nothing left on the list" });

  const upcoming = (companyEvents || []).filter(e => e.is_published && !eventIsPast(e))
    .sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at));
  cards.push({ view: "events", icon: "events", label: "Upcoming events",
    value: upcoming.length ? String(upcoming.length) : "None",
    sub: upcoming.length ? `Next: ${upcoming[0].title}` : "Nothing on the calendar" });

  const afterClass = inspections.filter(r => !r.post_submitted_at &&
    (inspForms.find(f => f.id === r.form_id) || {}).has_after_class).length;
  if (isAdmin() && tileCount("rigging")) {
    cards.push({ view: "rigging", icon: "rigging", label: "Lift plans", value: `${tileCount("rigging")} waiting`,
      sub: "Waiting on your approval" });
  } else if (afterClass) {
    cards.push({ view: "inspection", icon: "inspection", label: "Inspections", value: `${afterClass} to finish`,
      sub: "After-class part still to do" });
  } else {
    const open = tickets.filter(t => t.status !== "closed").length;
    cards.push({ view: "requests", icon: "support", label: "Support requests",
      value: open ? `${open} open` : "None open", sub: "Across your groups" });
  }

  // Each in its Center's colour; payday in the app's Payroll Calendar orange.
  const accent = (view) => view === "payroll" ? "ember" : view === "requests" ? "slate"
    : (FEATURES.find(f => f.id === view) || {}).accent;
  return cards.map(c => `
    <button class="stat-card cab-glass cab-stripe" data-view="${esc(c.view)}" style="${lit(accent(c.view))}">
      <small>${icon(c.icon, 14)} ${esc(c.label)}</small>
      <strong>${esc(c.value)}</strong>
      <span>${esc(c.sub)}</span>
    </button>`).join("");
}

document.querySelectorAll(".tabs button[data-tab]").forEach(btn => {
  btn.onclick = () => {
    document.querySelectorAll(".tabs button[data-tab]").forEach(b =>
      b.classList.toggle("active", b === btn));
    ["certs", "plans", "people", "support", "payroll", "tools",
      "directory", "logins", "reminders", "events", "fitness", "org", "openseat", "inspections", "courses", "articles", "skillsadmin", "sds", "news", "trainingstatus", "handbook", "agco", "mock", "safetydesk", "safetyreportform", "safetyreports", "safetyoverview", "fkwaiting", "trainingoverview", "agcocatalog", "rpagco", "rpclass", "oltadmin", "locationoverview", "fkrequired", "crrequired"].forEach(name =>
      $("tab-" + name).classList.toggle("hidden", name !== btn.dataset.tab));
    $("adminTitle").textContent = btn.dataset.title || btn.querySelector("span").textContent.trim();
    if (btn.closest("#safetyNav")) safetyTab = btn.dataset.tab;
    else if (btn.closest("#trainingNav")) trainingTab = btn.dataset.tab;
    else if (btn.closest("#locationNav")) $("adminTitle").textContent = `${lxName()} Dashboard`;
    else adminTab = btn.dataset.tab;
    document.body.classList.remove("nav-open");
    window.scrollTo(0, 0);
  };
});

// Column sorting, shared by all three tables.
document.querySelectorAll("th[data-sort]").forEach(th => {
  th.onclick = () => {
    const key = th.dataset.sort;
    const table = th.closest("table").id;
    const list = table === "certTable" ? certs : table === "planTable" ? plans : people;
    const dir = th.dataset.dir === "asc" ? -1 : 1;
    th.dataset.dir = dir === 1 ? "asc" : "desc";
    list.sort((a, b) => {
      const x = key === "status" ? certStatusNow(a)[0] : a[key];
      const y = key === "status" ? certStatusNow(b)[0] : b[key];
      return String(x ?? "").localeCompare(String(y ?? ""), undefined, { numeric: true }) * dir;
    });
    renderCerts(); renderPlans(); renderPeople();
  };
});
