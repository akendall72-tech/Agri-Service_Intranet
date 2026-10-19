// Lift Plans
//
// Crane lift and rigging plans, as the app has them: writing one, fixing one
// that came back, reading one, approving it or sending it back, its PDF, and
// the table on the Safety dashboard. The Crane Center lists them (riggingView,
// in crane.js).
//
// The database is the rule, not this page (0003, 0009, 0024, 0034, 0037,
// 0099). You see your own plans, a location admin the plans of the locations
// they look after, an owner all of them. Nobody approves their own; a reviewer
// approves or sends back but can't edit; an approved plan can't be changed.
// Who wrote a plan, its location and its review are stamped by the database,
// so this page never sends them.

// ---- the form's words, as the app has them (LiftPlan.swift) -----------------
//
// The database keeps raw values on purpose, so the wording can be corrected
// without rewriting old records. The PDF takes the same words, made plain.

const CRANE_TYPES = {
  bridge: "Bridge crane — single trolley",
  truck: "Service truck crane"
};

const WEIGHT_METHODS = {
  nameplate: "Equipment / nameplate data",
  specSheet: "Manufacturer spec sheet",
  calculation: "Engineering calculation",
  scale: "Certified scale weight",
  billOfLading: "Bill of lading / shipping docs",
  estimated: "Estimated by rigger"
};

// Split as the paper form splits them: the first four are the rigging, the
// rest the crane and the site.
const INSPECTION_ITEMS = [
  ["slings", "Slings/chains free of cuts, fraying, kinks or corrosion"],
  ["hooks", "Hooks free of cracks or deformation; safety latches work"],
  ["shackles", "Shackles — correct pin, no wear, hand-tight plus a turn"],
  ["hardwareMarked", "Rigging hardware rated capacity marked and legible"],
  ["wireRope", "Wire rope free of broken wires, birdcaging, corrosion"],
  ["belowHookTagged", "Below-the-hook device inspected and tagged current"],
  ["limitSwitches", "Crane hoist limit switches / brakes tested"],
  ["outriggers", "Outriggers fully deployed and cribbed (truck crane)"]
];
const LP_RIGGING_CHECKS = ["slings", "hooks", "shackles", "hardwareMarked"];

const STATUS_LABELS = {
  submitted: "Awaiting approval",
  changes_requested: "Changes requested",
  approved: "Approved"
};
const planLabel = (plan) => STATUS_LABELS[plan.status] || "—";

// The form as it is now (LiftPlan.currentFormVersion). Version 2 dropped the
// below-the-hook device and hitch type fields and added the picture of the
// lift; version 3 takes the crane's capacity at this configuration in pounds.
const LP_FORM_VERSION = 3;
// LiftPlan.maxPhotos, and what the database allows.
const LP_MAX_PHOTOS = 4;

// ---- figures -----------------------------------------------------------------

// A number of pounds as someone wrote it: "4000", "4,000" or "4,000 lbs".
// One number, and no words but lb, lbs or pounds: "5 ton", "about 3,000",
// "2,000 lbs at 10 ft" and "5 ton (10,000 lbs)" are null rather than a guess.
// Until form version 3 every digit was read as one figure, so the last of
// those was 510,000 and a lift looked like 1% of capacity.
//
// LiftPlan.pounds(in:) in the app reads exactly the same way. Change both or
// neither.
function lpPounds(text) {
  // A comma between thousands is part of the number: "10,000" is one.
  const plain = String(text ?? "").replace(/(?<=[0-9]),(?=[0-9]{3}(?![0-9]))/g, "");
  const numbers = plain.match(/[0-9]+(?:\.[0-9]+)?/g) || [];
  if (numbers.length !== 1) return null;
  const words = plain.replace(numbers[0], "").toLowerCase().replace(/[^a-z]/g, "");
  return ["", "lb", "lbs", "pound", "pounds"].includes(words) ? Number(numbers[0]) : null;
}

// How a capacity is kept on the plan, as the app keeps it: "4,000 lbs".
const lpPoundsText = (n) => `${n.toLocaleString("en-US", { maximumFractionDigits: 2 })} lbs`;

// The share of the crane's capacity a lift uses, worked out rather than typed:
// the one figure on the form where a slip is most likely to hurt someone. As
// the app works it out (computedPercentCapacity), and nothing rather than a
// guess when the capacity isn't one number of pounds.
function lpPercent(total, capacityText) {
  const capacity = lpPounds(capacityText);
  if (total == null || !Number.isFinite(Number(total)) || capacity == null || capacity <= 0) return null;
  return Number(total) / capacity * 100;
}
// A saved plan's, worked out from what's on it, as the app shows it.
const lpPlanPercent = (plan) => lpPercent(plan.total_weight, plan.capacity_at_config);
// A total weight and a capacity in words, from before form version 3.
const lpPercentUnknown = (plan) => lpPlanPercent(plan) == null && plan.total_weight != null
  && !!String(plan.capacity_at_config || "").trim();

// Caution from 80%, not only over 100: by the time a plan reads 100% it's
// already wrong, and there's still time to change the set-up at 80.
const lpLevel = (percent) => percent == null || percent < 80 ? "normal" : percent <= 100 ? "caution" : "over";

const lpLbs = (n) => n == null || n === "" ? "" : `${Math.round(Number(n)).toLocaleString("en-US")} lbs`;
const lpWhen = (iso) => iso ? new Date(iso).toLocaleString("en-US",
  { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }) : "";
const lpSummary = (plan) => String(plan.job_description || "").trim() || String(plan.location || "").trim() || "Untitled lift";
const lpTint = { submitted: "amber", changes_requested: "red", approved: "deep" };
const lpLevelTint = { normal: "green", caution: "amber", over: "red" };

// The database says no in plain words for the rules that matter; say them as
// the app does (LiftPlanStore.message).
function lpRefusal(error) {
  const text = String((error && error.message) || error || "");
  if (/approved and can no longer be changed/.test(text)) return "This plan has been approved, so it can't be changed.";
  if (/Only an administrator/.test(text)) return "Only an administrator can approve or return a lift plan.";
  if (/cannot approve your own/.test(text)) return "You can't approve your own lift plan — someone else has to review it.";
  if (/cannot edit it/.test(text)) return "A reviewer can approve this plan or ask for changes, but can't edit it.";
  if (/row-level security/i.test(text)) return "Your account isn't allowed to do that with this plan.";
  if (/failed to fetch|network|offline/i.test(text)) return "No connection. Check you're online and try again.";
  return `That didn't save. ${text}`;
}

// Plans again after a change, so what's shown is what the database made of
// it: the stamped name and location, the review, the new submitted time.
async function loadPlans() {
  const { data, error } = await db.from("lift_plans").select("*").order("submitted_at", { ascending: false });
  if (!error) plans = data || [];
}

// ---- where things are --------------------------------------------------------

let lpOpenId = null;       // the plan on the plan page
let lpDraft = null;        // the plan being written, or fixed after it came back
let lpReturning = false;   // a reviewer's "what needs to change?" box is open
let lpNotice = "";         // said once at the top of the plan page, after a change
const lpPhotoUrls = {};    // signed links to plan photos, so each is signed once

function lpOpen(id) {
  lpOpenId = id;
  lpReturning = false;
  lpNotice = "";
  showView("liftplan");
}

// Signed links for the photos, then into whichever pictures on the page are
// waiting for them.
async function lpSignPhotos(paths) {
  const missing = [...new Set(paths)].filter(p => !lpPhotoUrls[p]);
  try {
    if (missing.length) {
      const { data } = await db.storage.from("lift-plan-photos").createSignedUrls(missing, 3600);
      (data || []).forEach(r => { if (r.signedUrl) lpPhotoUrls[r.path] = r.signedUrl; });
    }
  } catch (error) {
    console.log("lift plan photos not signed", error);
  }
  document.querySelectorAll("img[data-lp-photo]").forEach(img => {
    const url = lpPhotoUrls[img.dataset.lpPhoto];
    if (url) { img.src = url; img.removeAttribute("data-lp-photo"); }
  });
}

// A picture as it waits for its link: signed already, or filled in once it is.
const lpImg = (path) => lpPhotoUrls[path]
  ? `<img src="${esc(lpPhotoUrls[path])}" alt="Picture of lift">`
  : `<img data-lp-photo="${esc(path)}" alt="Picture of lift">`;

// ---- the list, on the Crane Center ---------------------------------------------

function planRow(plan) {
  const own = plan.created_by === me.id;
  const photos = (plan.photo_paths || []).length;
  const pct = lpPlanPercent(plan);

  return `<div class="plan-card ${esc(plan.status || "")}">
    <button type="button" class="plan-main" data-lp-open="${esc(plan.id)}">
      <span class="cab-tag">${planLabel(plan)}</span>
      <span class="plan-title">${esc(lpSummary(plan))}</span>
      <span class="plan-meta">
        <span>${icon("calendar", 13)}${fmtDate((plan.lift_date || "").slice(0, 10))}</span>
        <span>${icon("pin", 13)}${esc(plan.location || "No site")}</span>
        ${own ? "" : `<span>${icon("person", 13)}${esc(plan.created_by_name || "Unknown")}</span>`}
        ${pct == null ? "" : `<span class="lp-pct ${lpLevel(pct)}">${Math.round(pct)}% of capacity</span>`}
        ${photos ? `<span>${icon("camera", 13)}${photos} photo${photos === 1 ? "" : "s"}</span>` : ""}
      </span>
      ${plan.review_note ? `<span class="plan-note"><b>Note</b>${esc(plan.review_note)}</span>` : ""}
    </button>
    <div class="plan-actions">
      ${isAdmin() && plan.status === "submitted" && !own
        ? `<button type="button" class="approve" data-lp-open="${esc(plan.id)}">Review</button>` : ""}
      ${own && plan.status === "changes_requested"
        ? `<button type="button" class="approve" data-lp-edit="${esc(plan.id)}">${icon("pencil", 14)}Edit &amp; resubmit</button>` : ""}
      <button type="button" class="quiet pdf" data-plan="${esc(plan.id)}">${icon("doc", 14)}PDF</button>
    </div>
  </div>`;
}

// The way into the form, at the top of the Crane Center: a new plan, or the
// one already started.
function lpNewCard() {
  const d = lpDraft;
  const started = d && lpSummary(d.values) !== "Untitled lift" ? lpSummary(d.values) : "";
  return `<button type="button" class="cab-card lp-new" data-lp-new style="${lit("green")}">
    <span class="cab-glyph">${icon(d ? "pencil" : "plus", 22)}</span>
    <span class="lp-new-main"><b>${d ? (d.editing ? "Continue fixing your plan" : "Continue your lift plan") : "New Lift Plan"}</b>
      <span>${d ? esc(started || "Started, not sent yet.") : "Fill out a crane lift and rigging plan."}</span></span>
    <span class="cab-chev" aria-hidden="true">&rsaquo;</span>
  </button>`;
}

// ---- one plan ---------------------------------------------------------------

function liftPlanView() {
  const plan = plans.find(p => p.id === lpOpenId);
  if (!plan) {
    return hero("Lift Plan") + `<div class="sr-empty"><b>That lift plan isn't in your list.</b>
      <p>It may have been deleted, or it belongs to a location you don't look after.</p>
      <p><button type="button" class="ghost" data-view="rigging">Back to the Crane Center</button></p></div>`;
  }
  const own = plan.created_by === me.id;
  const approved = plan.status === "approved";
  // As the app: an admin acts on a plan until it's approved, never their own.
  const canReview = isAdmin() && !approved && !own;
  const canEdit = own && plan.status === "changes_requested";
  const pct = lpPlanPercent(plan);
  const level = lpLevel(pct);
  const reviewer = plan.reviewed_by && people.find(p => p.id === plan.reviewed_by);
  const rigging = (plan.rigging || []).filter(r => ["item", "type", "size", "wll", "qty", "angle"].some(k => String(r[k] || "").trim()));
  const inspection = plan.inspection || {};
  const photos = plan.photo_paths || [];
  const notice = lpNotice;
  lpNotice = "";
  if (photos.length) Promise.resolve().then(() => lpSignPhotos(photos));

  const row = (label, value) => String(value ?? "").trim()
    ? `<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>` : "";
  const check = (label, on) => `<li class="${on ? "on" : ""}"><span class="lp-tick" role="img" aria-label="${on ? "Done" : "Not done"}">${
    on ? icon("checkCircle", 17) : ""}</span><span>${esc(label)}</span></li>`;
  const section = (iconName, title, body) => `<section class="card lp-sec"><h2>${icon(iconName, 17)}${title}</h2>${
    body.replace(/<dl>\s*<\/dl>/g, "").trim() || `<p class="note">Nothing filled in.</p>`}</section>`;

  return hero(lpSummary(plan), ["Lift plan", fmtDate((plan.lift_date || "").slice(0, 10)), plan.location].filter(Boolean).join(" · "))
    + `<div class="lp-detail">
      ${notice ? `<p class="lp-notice">${icon("checkCircle", 18)}<span>${esc(notice)}</span></p>` : ""}

      <div class="lp-status" style="${lit(lpTint[plan.status] || "slate")}">
        <span class="cab-tag">${planLabel(plan)}</span>
        <p>Submitted ${esc(lpWhen(plan.submitted_at))}${plan.created_by_name ? ` by ${esc(plan.created_by_name)}` : ""}${
          plan.location_id ? ` · ${esc(shopName(plan.location_id))}` : ""}</p>
        ${plan.reviewed_at ? `<p>Reviewed ${esc(lpWhen(plan.reviewed_at))}${reviewer && reviewer.full_name ? ` by ${esc(reviewer.full_name)}` : ""}</p>` : ""}
        ${plan.review_note ? `<q>${esc(plan.review_note)}</q>` : ""}
      </div>

      <div class="st-facts lp-facts">
        <div style="${lit("slate")}"><b>${esc(plan.crane_type === "truck" ? "Truck crane" : plan.crane_type === "bridge" ? "Bridge crane" : "—")}</b><span>Crane</span></div>
        <div style="${lit("steel")}"><b>${esc(lpLbs(plan.total_weight) || "—")}</b><span>Total weight</span></div>
        <div style="${lit("steel")}"><b>${esc(String(plan.capacity_at_config || "").trim() || "—")}</b><span>Capacity at config</span></div>
        <div style="${lit(pct == null ? "steel" : lpLevelTint[level])}"><b>${pct == null ? "—" : `${Math.round(pct)}%`}</b><span>Of capacity</span></div>
      </div>
      ${lpWarningHtml(pct, true)}

      <div class="lp-sections">
        ${section("doc", "Job information", `<dl>
          ${row("Date", fmtDate((plan.lift_date || "").slice(0, 10)))}
          ${row("Location / facility", plan.location)}
          ${row("Job / task", plan.job_description)}
          ${row("Rigger-in-charge", plan.rigger_in_charge)}
          ${row("Signal person", plan.signal_person)}</dl>`)}

        ${section("rigging", "Crane type &amp; capacity", `<dl>
          ${row("Crane type", CRANE_TYPES[plan.crane_type] || "")}
          ${row("Rated capacity", plan.rated_capacity)}
          ${row("Truck details", plan.truck_details)}
          ${row("Working radius", plan.working_radius)}
          ${row("Capacity at this radius / config", plan.capacity_at_config)}</dl>
          <ul class="lp-checks">
          ${check("Centre of gravity confirmed", plan.center_of_gravity_confirmed)}
          ${check("Within rated capacity", plan.within_rated_capacity)}
          ${check("Load chart consulted", plan.load_chart_consulted)}</ul>`)}

        ${section("box", "Load weight", `<dl>
          ${row("Load description", plan.load_description)}
          ${row("Load weight", lpLbs(plan.load_weight))}
          ${row("Weight determined by", (plan.weight_methods || []).map(m => WEIGHT_METHODS[m] || m).join(", "))}
          ${row("Source / reference", plan.weight_source)}
          ${row("Total weight", lpLbs(plan.total_weight))}
          ${pct == null ? "" : `<div><dt>% of capacity</dt><dd class="lp-pct ${level}">${Math.round(pct)}%</dd></div>`}
          ${lpPercentUnknown(plan) ? row("% of capacity", "Not worked out: the capacity isn't written as one number of pounds.") : ""}</dl>`)}

        ${rigging.length || plan.below_hook_device || plan.hitch_type ? section("link", "Rigging", `
          ${rigging.length ? `<div class="lp-rig-scroll"><table class="lp-rig-table">
            <thead><tr><th>Component</th><th>Type</th><th>Size</th><th>Rated WLL</th><th>Qty</th><th>Angle</th></tr></thead>
            <tbody>${rigging.map(r => `<tr>${["item", "type", "size", "wll", "qty", "angle"].map(k =>
              `<td>${esc(String(r[k] || "").trim() || "—")}</td>`).join("")}</tr>`).join("")}</tbody></table></div>` : ""}
          <dl>${row("Below-the-hook device", plan.below_hook_device)}${row("Hitch type & sling angle", plan.hitch_type)}</dl>`) : ""}

        ${section("inspection", "Pre-lift inspection", `
          <h3>Rigging inspection</h3>
          <ul class="lp-checks">${INSPECTION_ITEMS.filter(([k]) => LP_RIGGING_CHECKS.includes(k)).map(([k, label]) => check(label, inspection[k] === true)).join("")}</ul>
          <h3>Crane / site inspection</h3>
          <ul class="lp-checks">${INSPECTION_ITEMS.filter(([k]) => !LP_RIGGING_CHECKS.includes(k)).map(([k, label]) => check(label, inspection[k] === true)).join("")}</ul>`)}

        ${section("warning", "Hazards &amp; lift path", `<dl>
          ${row("Hazards identified", plan.hazards)}
          ${row("Lift path / sketch notes", plan.lift_path)}</dl>`)}

        ${photos.length ? section("camera", "Picture of lift", `<div class="lp-thumbs">${photos.map(p =>
          `<button type="button" class="lp-thumb" data-lp-view="${esc(p)}" aria-label="See the picture larger">${lpImg(p)}</button>`).join("")}</div>`) : ""}
      </div>

      ${canReview && lpReturning ? `<div class="card lp-return">
        <h2>What needs to change?</h2>
        <p class="note">This note goes back to ${esc(plan.created_by_name || "the technician")} and stays on the record.</p>
        <textarea id="lpReturnNote" rows="4" aria-label="What needs to change"></textarea>
        <div class="row">
          <button type="button" data-lp-send-back="${esc(plan.id)}" disabled>Send back to ${esc((plan.created_by_name || "").split(" ")[0] || "the technician")}</button>
          <button type="button" class="ghost" data-lp-return-cancel>Cancel</button>
          <span class="msg"></span>
        </div>
      </div>` : ""}

      <div class="row lp-actions">
        ${canReview && !lpReturning ? `<button type="button" class="green" data-lp-approve="${esc(plan.id)}">${icon("checkCircle", 16)}Approve plan</button>
          <button type="button" class="ghost" data-lp-return>Request changes</button>` : ""}
        ${canEdit ? `<button type="button" data-lp-edit="${esc(plan.id)}">${icon("pencil", 15)}Edit &amp; resubmit</button>` : ""}
        <button type="button" class="ghost pdf" data-plan="${esc(plan.id)}">${icon("doc", 15)}Export PDF</button>
        <span class="msg"></span>
      </div>
      ${isAdmin() && own && plan.status === "submitted" ? `<p class="note lp-own">${icon("info", 15)}This is your own plan, so someone else has to approve it.</p>` : ""}
    </div>`;
}

// Warns from 80%: a calculated figure, not an engineering control, but the
// number on a plan where a mistake is most likely to hurt someone.
function lpWarningHtml(pct, reading) {
  const level = lpLevel(pct);
  if (level === "normal") return "";
  const words = level === "over"
    ? reading ? "The total weight is more than the crane capacity given for this configuration."
      : "The total weight exceeds the crane capacity you entered for this configuration. Check the figures before submitting."
    : reading ? "This lift uses 80% or more of the crane's capacity at this configuration."
      : "This lift uses 80% or more of the crane's capacity at this configuration. Re-check the weight and the setup before going ahead.";
  return `<div class="crane-alert lp-warn ${level === "over" ? "removed" : "caution"}">${warnIcon}<div>
    <b>${level === "over" ? "Over rated capacity" : "Approaching rated capacity"}</b><p>${words}</p></div></div>`;
}

// A picture, large, over the page. A click anywhere or Escape puts it away.
function lpViewPhoto(path) {
  const url = lpPhotoUrls[path];
  if (!url) return;
  const box = document.createElement("div");
  box.className = "lp-viewer";
  box.setAttribute("role", "dialog");
  box.setAttribute("aria-label", "Picture of lift");
  box.innerHTML = `<img src="${esc(url)}" alt="Picture of lift"><button type="button" aria-label="Close">×</button>`;
  const close = () => { box.remove(); document.removeEventListener("keydown", onKey); };
  const onKey = (event) => { if (event.key === "Escape") close(); };
  box.addEventListener("click", close);
  document.addEventListener("keydown", onKey);
  document.body.appendChild(box);
  box.querySelector("button").focus();
}

// ---- the form -----------------------------------------------------------------
//
// Kept while you move around the page, as an inspection is, so going to look
// something up and coming back finds it as it was. All of it on one page, as
// a computer has the room for, in the app's order and the app's words.

const LP_TEXT_KEYS = ["location", "job_description", "rigger_in_charge", "signal_person", "rated_capacity",
  "truck_details", "working_radius", "capacity_at_config", "load_description", "weight_source", "hazards",
  "lift_path", "below_hook_device", "hitch_type"];
const LP_SWITCHES = [["center_of_gravity_confirmed", "Centre of gravity confirmed"],
  ["within_rated_capacity", "Lift is within the crane's rated capacity"],
  ["load_chart_consulted", "Load chart consulted / capacity plate verified"]];
const LP_RIG_FIELDS = [["item", "Component", "Sling, shackle…"], ["type", "Type", ""], ["size", "Size", ""],
  ["wll", "Rated WLL", ""], ["qty", "Qty", ""], ["angle", "Angle", ""]];

function lpStartDraft(plan) {
  const v = plan || {};
  const values = { lift_date: String(v.lift_date || todayISO()).slice(0, 10), crane_type: v.crane_type || "",
    load_weight: v.load_weight == null ? "" : String(v.load_weight),
    total_weight: v.total_weight == null ? "" : String(v.total_weight),
    weight_methods: (v.weight_methods || []).filter(m => WEIGHT_METHODS[m]) };
  LP_TEXT_KEYS.forEach(k => { values[k] = String(v[k] ?? ""); });
  LP_SWITCHES.forEach(([k]) => { values[k] = v[k] === true; });
  // The capacity is edited as a number of pounds. Words from before form
  // version 3 stay on the plan, shown under the box, until a number replaces them.
  const before = String(v.capacity_at_config ?? "").trim();
  const pounds = lpPounds(before);
  values.capacity_at_config = pounds == null ? "" : pounds.toLocaleString("en-US", { maximumFractionDigits: 2 });
  lpDraft = {
    // Made here, so the photos have a folder before the plan is sent, and a
    // second try after a lost answer finds the same plan instead of a new one.
    id: plan ? plan.id : crypto.randomUUID(),
    editing: !!plan,
    reviewNote: plan ? String(plan.review_note || "") : "",
    values,
    rigging: (v.rigging && v.rigging.length ? v.rigging : [{}]).map(r => ({ id: r.id || crypto.randomUUID(),
      ...Object.fromEntries(LP_RIG_FIELDS.map(([k]) => [k, String(r[k] ?? "")])) })),
    inspection: Object.fromEntries(INSPECTION_ITEMS.map(([k]) => [k, (v.inspection || {})[k] === true])),
    kept: [...(v.photo_paths || [])],      // on the plan already, when fixing one
    photos: [],                            // new: { id, blob, url }
    capacityBefore: lpPounds(before) == null ? before : "", capacityEdited: false,
    photoProblem: "", preparing: false, showMissing: false, touched: false
  };
}

function lpDiscardDraft() {
  if (lpDraft) lpDraft.photos.forEach(p => URL.revokeObjectURL(p.url));
  lpDraft = null;
}

// Deliberately few, as in the app: the things without which a plan means
// nothing. Asking for more on a safety form makes people invent answers.
const LP_REQUIRED = [["lift_date", "the date"], ["job_description", "the job description"],
  ["crane_type", "the crane type"], ["load_weight", "the load weight"], ["total_weight", "the total weight"]];
const lpMissing = (d) => LP_REQUIRED.filter(([k]) => ["load_weight", "total_weight"].includes(k)
  ? lpPounds(d.values[k]) === null : !String(d.values[k] || "").trim());

function lpMissingText(d) {
  const missing = lpMissing(d).map(([k, words]) => String(d.values[k] || "").trim() && k.endsWith("weight")
    ? `${words} (in pounds, as a number)` : words);
  if (!missing.length) return "";
  const list = missing.length === 1 ? missing[0] : `${missing.slice(0, -1).join(", ")} and ${missing[missing.length - 1]}`;
  return `Fill in ${list} before submitting.`;
}

function liftPlanFormView() {
  // Opened with nothing started (from an old link, or a reload): a new plan.
  if (!lpDraft) lpStartDraft();
  const d = lpDraft;
  const plan = d.editing ? plans.find(p => p.id === d.id) : null;
  if (d.editing && (!plan || plan.status !== "changes_requested")) {
    lpDiscardDraft();
    return hero("Edit Lift Plan") + `<div class="sr-empty"><b>That plan can't be changed now.</b>
      <p>It may have been approved, or isn't waiting on changes any more.</p>
      <p><button type="button" class="ghost" data-view="rigging">Back to the Crane Center</button></p></div>`;
  }
  const pct = lpPercent(lpPounds(d.values.total_weight), lpCapacityText(d));
  const sec = (key, iconName, title, body) => `<section class="card lp-sec" id="lp-sec-${key}">
    <h2>${icon(iconName, 17)}${title}</h2>${body}</section>`;

  return hero(d.editing ? "Edit Lift Plan" : "New Lift Plan", d.editing ? lpSummary(plan)
      : "Plan the lift, get it approved, and keep the record. Every plan is reviewed before the lift goes ahead.")
    + `<div class="lp-form" data-lp-form>
      ${d.reviewNote ? `<div class="lp-status" style="${lit("red")}"><span class="cab-tag">Changes requested</span>
        <q>${esc(d.reviewNote)}</q></div>` : ""}

      ${sec("job", "doc", "Job information", `<div class="fields">
        ${lpField("lift_date", "Date", { date: true, required: true })}
        ${lpField("location", "Location / facility")}
        ${lpField("job_description", "Job / task description", { multi: true, wide: true, required: true })}
        ${lpField("rigger_in_charge", "Rigger-in-charge (qualified rigger)")}
        ${lpField("signal_person", "Signal person (if used)")}
      </div>`)}

      ${sec("crane", "rigging", "Crane type &amp; capacity", `<div class="fields">
        <div class="lp-field wide${lpFlagged("crane_type") ? " missing" : ""}" data-lp-field="crane_type">
          <span class="lp-label" id="lpCraneLabel">Crane type<span class="req" aria-hidden="true">*</span></span>
          <div class="lp-seg" role="radiogroup" aria-labelledby="lpCraneLabel">${Object.entries(CRANE_TYPES).map(([k, label]) =>
            `<label class="lp-seg-opt"><input type="radio" name="lpCrane" value="${k}" data-lp-crane${d.values.crane_type === k ? " checked" : ""}>
              <span>${esc(label)}</span></label>`).join("")}</div>
        </div>
        ${lpField("rated_capacity", "Rated capacity (nameplate)")}
        <div class="lp-cap">${lpField("capacity_at_config", "Crane capacity at this radius / config (lbs)", { number: true })}
          <span class="lp-hint${lpCapacityNote(d) === LP_CAP_NOTE ? "" : " lp-odd"}" id="lpCapNote">${esc(lpCapacityNote(d))}</span></div>
        <div class="lp-truck wide" data-lp-truck${d.values.crane_type === "truck" ? "" : " hidden"}><div class="fields">
          ${lpField("truck_details", "Truck crane details — boom length, outrigger spread, ground conditions", { multi: true, wide: true })}
          ${lpField("working_radius", "Working radius / boom angle")}
        </div></div>
        <div class="wide lp-switches">${LP_SWITCHES.map(([k, label]) => `<label class="lp-switch">
          <input type="checkbox" role="switch" data-lp-check="${k}"${d.values[k] ? " checked" : ""}>
          <span class="lp-knob" aria-hidden="true"></span><span>${esc(label)}</span></label>`).join("")}</div>
      </div>`)}

      ${sec("load", "box", "Load weight", `<div class="fields">
        ${lpField("load_description", "Load description", { multi: true, wide: true })}
        ${lpField("load_weight", "Load weight (lbs)", { number: true, required: true })}
        <div class="lp-field wide"><span class="lp-label">How was the weight determined?</span>
          <div class="lp-boxes">${Object.entries(WEIGHT_METHODS).map(([k, label]) => `<label class="lp-box">
            <input type="checkbox" data-lp-method="${k}"${d.values.weight_methods.includes(k) ? " checked" : ""}><span>${esc(label)}</span></label>`).join("")}</div>
        </div>
        ${lpField("weight_source", "Source / reference (doc #, calc sheet, scale ticket)", { wide: true })}
        ${lpField("total_weight", "Total weight to be lifted — load + rigging + below-the-hook (lbs)", { number: true, required: true, wide: true })}
        <div class="wide" id="lpGauge">${lpGaugeHtml(pct)}</div>
      </div>`)}

      ${sec("rigging", "link", "Rigging", `<div id="lpRigging">${lpRiggingHtml()}</div>`)}

      ${sec("inspection", "inspection", "Pre-lift inspection", `
        <h3>Rigging inspection</h3>
        <div class="lp-boxes">${INSPECTION_ITEMS.filter(([k]) => LP_RIGGING_CHECKS.includes(k)).map(([k, label]) => lpInspBox(k, label)).join("")}</div>
        <h3>Crane / site inspection</h3>
        <div class="lp-boxes">${INSPECTION_ITEMS.filter(([k]) => !LP_RIGGING_CHECKS.includes(k)).map(([k, label]) => lpInspBox(k, label)).join("")}</div>`)}

      ${sec("hazards", "warning", "Hazards &amp; lift path", `<div class="fields">
        ${lpField("hazards", "Hazards identified", { multi: true, wide: true })}
        ${lpField("lift_path", "Lift path / sketch notes", { multi: true, wide: true })}
      </div>`)}

      ${sec("photos", "camera", "Picture of lift", `<div id="lpPhotos">${lpPhotosHtml()}</div>`)}

      <div id="lpWarn">${lpWarningHtml(pct)}</div>
      <p class="error" id="lpMissing">${d.showMissing ? esc(lpMissingText(d)) : ""}</p>
      <div class="row lp-submit">
        <button type="button" data-lp-submit>${d.editing ? "Resubmit for approval" : "Submit for approval"}</button>
        <button type="button" class="ghost" data-lp-cancel>Cancel</button>
        <span class="msg" id="lpFormMsg"></span>
      </div>
    </div>`;
}

const lpFlagged = (key) => lpDraft.showMissing && lpMissing(lpDraft).some(([k]) => k === key);

function lpField(key, label, { multi, wide, required, number, date, hint } = {}) {
  const id = `lp-${key}`, value = esc(lpDraft.values[key]);
  const input = multi ? `<textarea id="${id}" rows="3" data-lp="${key}">${value}</textarea>`
    : date ? `<input id="${id}" type="date" data-lp="${key}" value="${value}">`
    : number ? `<input id="${id}" type="text" inputmode="decimal" placeholder="0" autocomplete="off" data-lp="${key}" value="${value}">`
    // Autocorrect turns "Fendt" into "Fender".
    : `<input id="${id}" type="text" autocomplete="off" autocorrect="off" spellcheck="false" data-lp="${key}" value="${value}">`;
  return `<div class="lp-field${wide ? " wide" : ""}${lpFlagged(key) ? " missing" : ""}" data-lp-field="${key}">
    <label for="${id}">${esc(label)}${required ? `<span class="req" aria-hidden="true">*</span>` : ""}</label>
    ${input}${hint ? `<span class="lp-hint">${esc(hint)}</span>` : ""}</div>`;
}

const lpInspBox = (key, label) => `<label class="lp-box">
  <input type="checkbox" data-lp-insp="${key}"${lpDraft.inspection[key] ? " checked" : ""}><span>${esc(label)}</span></label>`;

// The capacity at this configuration, as it'll be kept: the pounds as
// "4,000 lbs", or what was written before form version 3 until a number
// replaces it — as the app's form leaves it.
function lpCapacityText(d) {
  const typed = String(d.values.capacity_at_config || "").trim();
  if (!typed) return d.capacityEdited ? "" : d.capacityBefore;
  const n = lpPounds(typed);
  return n == null ? typed : lpPoundsText(n);
}

// Under the capacity box: what the % is worked out from, or why it can't be.
const LP_CAP_NOTE = "The % of capacity is worked out from this.";
function lpCapacityNote(d) {
  const typed = String(d.values.capacity_at_config || "").trim();
  if (typed && lpPounds(typed) == null) return "Put the capacity in pounds as one number, like 4,000, so the % of capacity can be worked out.";
  if (!typed && !d.capacityEdited && d.capacityBefore) {
    return `Written before as “${d.capacityBefore}”. Put the capacity in pounds so the % of capacity can be worked out.`;
  }
  return LP_CAP_NOTE;
}

function lpGaugeHtml(pct) {
  if (pct == null) {
    return `<p class="lp-hint lp-gauge-empty">With the total weight and the crane's capacity at this configuration filled in,
      the share of its capacity this lift uses is worked out here.</p>`;
  }
  const level = lpLevel(pct);
  return `<div class="lp-gauge" style="${lit(lpLevelTint[level])}">
    <div class="lp-gauge-top"><span>% of crane capacity used</span><b>${Math.round(pct)}%</b></div>
    <div class="lp-gauge-bar" aria-hidden="true"><i style="width:${Math.min(100, Math.max(0, pct)).toFixed(1)}%"></i><s></s></div>
    <span class="lp-hint">Calculated from total weight and the capacity at this configuration. Caution from 80%.</span>
  </div>`;
}

function lpRiggingHtml() {
  const rows = lpDraft.rigging;
  return rows.map((r, i) => `<div class="lp-rig">
      <div class="lp-rig-head"><span>Item ${i + 1}</span>${rows.length > 1
        ? `<button type="button" class="icon-btn" data-lp-rig-remove="${i}" aria-label="Remove item ${i + 1}">${icon("trash", 15)}</button>` : ""}</div>
      <div class="lp-rig-grid">${LP_RIG_FIELDS.map(([k, label, placeholder]) => `<label class="lp-rig-${k}">
        <span>${label}</span><input type="text" data-lp-rig="${i}" data-key="${k}" value="${esc(r[k])}"${
          placeholder ? ` placeholder="${esc(placeholder)}"` : ""} autocomplete="off" autocorrect="off" spellcheck="false"></label>`).join("")}</div>
    </div>`).join("")
    + `<button type="button" class="ghost lp-add" data-lp-rig-add>${icon("plus", 15)}Add rigging component</button>`;
}

function lpPhotosHtml() {
  const d = lpDraft, count = d.kept.length + d.photos.length;
  if (d.kept.some(p => !lpPhotoUrls[p])) Promise.resolve().then(() => lpSignPhotos(d.kept));
  const tile = (img, attr) => `<span class="lp-thumb">${img}<button type="button" ${attr} aria-label="Remove photo">×</button></span>`;
  return `<p class="lp-hint">A photo of the load and rigging as it's set up. Up to ${LP_MAX_PHOTOS}, each one shrunk to keep it small.</p>
    ${count ? `<div class="lp-thumbs">${d.kept.map(p => tile(lpImg(p), `data-lp-unkeep="${esc(p)}"`)).join("")}${
      d.photos.map(p => tile(`<img src="${esc(p.url)}" alt="Picture of lift">`, `data-lp-unphoto="${esc(p.id)}"`)).join("")}</div>` : ""}
    ${d.photoProblem ? `<p class="error">${esc(d.photoProblem)}</p>` : ""}
    ${count < LP_MAX_PHOTOS
      ? `<label class="pdf insp-add-photo" for="lpPhotoInput">${icon("camera", 15)} ${count ? "Add another photo" : "Add photos"}</label>
        <input type="file" id="lpPhotoInput" accept="image/*" multiple class="hidden" data-lp-photos>
        ${d.preparing ? `<span class="msg">Shrinking…</span>` : ""}`
      : `<p class="lp-hint">That's the most a plan can have. Remove one to add another.</p>`}`;
}

// The parts that change as you type, drawn again on their own so the field
// you're in keeps its place.
function lpRedrawFigures() {
  const pct = lpPercent(lpPounds(lpDraft.values.total_weight), lpCapacityText(lpDraft));
  if ($("lpGauge")) $("lpGauge").innerHTML = lpGaugeHtml(pct);
  if ($("lpCapNote")) {
    $("lpCapNote").textContent = lpCapacityNote(lpDraft);
    $("lpCapNote").classList.toggle("lp-odd", lpCapacityNote(lpDraft) !== LP_CAP_NOTE);
  }
  if ($("lpWarn")) $("lpWarn").innerHTML = lpWarningHtml(pct);
}

function lpRedrawFlags() {
  document.querySelectorAll("[data-lp-field]").forEach(el => el.classList.toggle("missing", lpFlagged(el.dataset.lpField)));
  if ($("lpMissing")) $("lpMissing").textContent = lpDraft.showMissing ? lpMissingText(lpDraft) : "";
}

// Shrunk as the app shrinks them (LiftPlanPhotos): 1600 pixels on the long
// side, then the quality stepped down until it's under 600 KB, so a plan goes
// up quickly on a weak signal and the bucket's 5 MB limit is nowhere near.
async function lpShrink(file) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  if (bitmap.close) bitmap.close();
  for (const quality of [0.8, 0.6, 0.45, 0.3]) {
    const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/jpeg", quality));
    if (blob && blob.size <= 600000) return blob;
  }
  return null;
}

async function lpAddPhotos(files) {
  const d = lpDraft;
  const room = LP_MAX_PHOTOS - d.kept.length - d.photos.length;
  const chosen = [...files].slice(0, Math.max(0, room));
  if (!chosen.length) return;
  d.preparing = true;
  d.photoProblem = "";
  $("lpPhotos").innerHTML = lpPhotosHtml();
  let failed = 0;
  for (const file of chosen) {
    let blob = null;
    try { blob = await lpShrink(file); } catch { blob = null; }
    // Still the same draft, and still room: the form may have been left meanwhile.
    if (lpDraft !== d) return;
    if (!blob) { failed++; continue; }
    if (d.kept.length + d.photos.length < LP_MAX_PHOTOS) d.photos.push({ id: crypto.randomUUID(), blob, url: URL.createObjectURL(blob) });
  }
  d.preparing = false;
  d.touched = true;
  if (failed) d.photoProblem = failed === chosen.length && chosen.length === 1
    ? "That photo couldn't be read. Try a JPEG or PNG." : "A photo couldn't be read. Try a JPEG or PNG.";
  else if (files.length > chosen.length) d.photoProblem = `A plan has room for ${LP_MAX_PHOTOS} photos, so only the first ${chosen.length} were added.`;
  if ($("lpPhotos")) $("lpPhotos").innerHTML = lpPhotosHtml();
}

// Every column the app writes, every time, as the app writes them: the app
// reads a plan only when each is there (LiftPlan's Codable), and skips one it
// can't read, so a plan written here must look exactly like one from a phone.
function lpBody(d, photoPaths) {
  const v = d.values;
  const total = lpPounds(v.total_weight);
  const capacity = lpCapacityText(d);
  const body = {
    status: "submitted",
    form_version: LP_FORM_VERSION,
    lift_date: v.lift_date,
    crane_type: v.crane_type,
    center_of_gravity_confirmed: v.center_of_gravity_confirmed,
    within_rated_capacity: v.within_rated_capacity,
    load_chart_consulted: v.load_chart_consulted,
    load_weight: lpPounds(v.load_weight),
    weight_methods: Object.keys(WEIGHT_METHODS).filter(m => v.weight_methods.includes(m)),
    total_weight: total,
    percent_capacity: lpPercent(total, capacity),
    rigging: d.rigging.map(r => ({ id: r.id, ...Object.fromEntries(LP_RIG_FIELDS.map(([k]) => [k, r[k].trim()])) })),
    inspection: { ...d.inspection },
    photo_paths: photoPaths
  };
  LP_TEXT_KEYS.forEach(k => { body[k] = v[k].trim(); });
  body.capacity_at_config = capacity;
  return body;
}

async function lpSubmit(button) {
  const d = lpDraft;
  d.showMissing = true;
  lpRedrawFlags();
  const missing = lpMissing(d);
  if (missing.length) {
    const first = document.querySelector(`[data-lp-field="${missing[0][0]}"]`);
    if (first) {
      first.scrollIntoView({ behavior: "smooth", block: "center" });
      const input = first.querySelector("input, textarea");
      if (input) input.focus({ preventScroll: true });
    }
    return;
  }

  const msg = $("lpFormMsg");
  button.disabled = true;
  msg.className = "msg";
  msg.textContent = d.photos.length ? "Sending the photos…" : "Sending…";
  try {
    // The photos first, each to a path made from the plan and the photo, so a
    // second try overwrites rather than duplicates. Then the plan, pointing at them.
    const paths = [...d.kept];
    for (const photo of d.photos) {
      const path = `${me.id}/${d.id}/${photo.id}.jpg`;
      const { error } = await db.storage.from("lift-plan-photos")
        .upload(path, photo.blob, { contentType: "image/jpeg", upsert: true });
      if (error) throw new Error(`A photo didn't upload: ${error.message}`);
      paths.push(path);
    }
    msg.textContent = "Sending…";
    const body = lpBody(d, [...new Set(paths)].slice(0, LP_MAX_PHOTOS));
    if (d.editing) {
      const { data, error } = await db.from("lift_plans").update(body).eq("id", d.id).select("id");
      if (error) throw new Error(lpRefusal(error));
      if (!data || !data.length) throw new Error("This plan isn't yours to change, or it's gone.");
    } else {
      const { error } = await db.from("lift_plans").insert({ id: d.id, ...body });
      // Already there: an earlier try got through and only the answer was lost.
      if (error && error.code !== "23505") throw new Error(lpRefusal(error));
    }
  } catch (error) {
    button.disabled = false;
    msg.className = "msg error";
    msg.textContent = `It wasn't sent. ${error.message.replace(/^That didn't save\. /, "")}`;
    return;
  }

  // Their location's administrators have a plan to review.
  notify("lift_plan", d.id);
  const editing = d.editing, id = d.id;
  lpDiscardDraft();
  await loadPlans();
  lpOpenId = id;
  lpReturning = false;
  lpNotice = editing ? "Resubmitted. It's back with your location admin for approval."
    : "Submitted for approval. It's with your location admin now, and the lift waits until it's approved.";
  showView("liftplan");
}

async function lpReview(id, status, note, button) {
  const say = (text) => speak(button.closest(".row"), text, true);
  button.disabled = true;
  // reviewed_by and reviewed_at are stamped by a database trigger, so the
  // record can't claim someone else did the review.
  const { data, error } = await db.from("lift_plans").update({ status, review_note: note }).eq("id", id).select("id");
  if (error || !data || !data.length) {
    button.disabled = false;
    return say(error ? lpRefusal(error) : "Nothing changed. This plan isn't yours to review.");
  }
  // Whoever wrote it is waiting to hear either way.
  notify("lift_plan", id);
  lpReturning = false;
  await loadPlans();
  lpNotice = status === "approved" ? "Approved. It's on the record now, and can't be changed."
    : "Sent back with your note. It comes back for approval once it's fixed and resubmitted.";
  showView("liftplan");
}

document.addEventListener("click", async (event) => {
  const open = event.target.closest("[data-lp-open]");
  if (open) return lpOpen(open.dataset.lpOpen);

  if (event.target.closest("[data-lp-new]")) {
    if (!lpDraft) lpStartDraft();
    return showView("liftplanform");
  }

  const edit = event.target.closest("[data-lp-edit]");
  if (edit) {
    const plan = plans.find(p => p.id === edit.dataset.lpEdit);
    if (!plan) return;
    if (!lpDraft || lpDraft.id !== plan.id) {
      if (lpDraft && lpDraft.touched && !confirm("Discard the lift plan you started and fix this one instead?")) return;
      lpDiscardDraft();
      lpStartDraft(plan);
    }
    return showView("liftplanform");
  }

  const view = event.target.closest("[data-lp-view]");
  if (view) return lpViewPhoto(view.dataset.lpView);

  if (event.target.closest("[data-lp-return]")) {
    lpReturning = true;
    showView("liftplan");
    return $("lpReturnNote") && $("lpReturnNote").focus();
  }
  if (event.target.closest("[data-lp-return-cancel]")) { lpReturning = false; return showView("liftplan"); }

  const approve = event.target.closest("[data-lp-approve]");
  if (approve) {
    if (!confirm("Approve this lift plan? Once it's approved it's on the record and can't be changed.")) return;
    return lpReview(approve.dataset.lpApprove, "approved", null, approve);
  }
  const back = event.target.closest("[data-lp-send-back]");
  if (back) {
    const note = $("lpReturnNote").value.trim();
    if (!note) return;
    return lpReview(back.dataset.lpSendBack, "changes_requested", note, back);
  }

  if (!lpDraft) return;
  if (event.target.closest("[data-lp-rig-add]")) {
    lpDraft.rigging.push({ id: crypto.randomUUID(), ...Object.fromEntries(LP_RIG_FIELDS.map(([k]) => [k, ""])) });
    $("lpRigging").innerHTML = lpRiggingHtml();
    const inputs = $("lpRigging").querySelectorAll(`[data-lp-rig="${lpDraft.rigging.length - 1}"]`);
    return inputs[0] && inputs[0].focus();
  }
  const remove = event.target.closest("[data-lp-rig-remove]");
  if (remove) {
    lpDraft.rigging.splice(Number(remove.dataset.lpRigRemove), 1);
    lpDraft.touched = true;
    return ($("lpRigging").innerHTML = lpRiggingHtml());
  }
  const unkeep = event.target.closest("[data-lp-unkeep]");
  const unphoto = event.target.closest("[data-lp-unphoto]");
  if (unkeep || unphoto) {
    if (unkeep) lpDraft.kept = lpDraft.kept.filter(p => p !== unkeep.dataset.lpUnkeep);
    else {
      const gone = lpDraft.photos.find(p => p.id === unphoto.dataset.lpUnphoto);
      if (gone) URL.revokeObjectURL(gone.url);
      lpDraft.photos = lpDraft.photos.filter(p => p !== gone);
    }
    lpDraft.photoProblem = "";
    lpDraft.touched = true;
    return ($("lpPhotos").innerHTML = lpPhotosHtml());
  }
  const submit = event.target.closest("[data-lp-submit]");
  if (submit) return lpSubmit(submit);
  if (event.target.closest("[data-lp-cancel]")) {
    if (lpDraft.touched && !confirm(lpDraft.editing ? "Discard your changes to this plan?" : "Discard this lift plan?")) return;
    const editing = lpDraft.editing, id = lpDraft.id;
    lpDiscardDraft();
    if (editing) return lpOpen(id);
    return showView("rigging");
  }
});

document.addEventListener("input", (event) => {
  const t = event.target;
  // The reviewer's note: Send back once there's something in it.
  if (t.id === "lpReturnNote") {
    const send = document.querySelector("[data-lp-send-back]");
    if (send) send.disabled = !t.value.trim();
    return;
  }
  if (!lpDraft) return;
  if (t.dataset.lp) {
    lpDraft.values[t.dataset.lp] = t.value;
    lpDraft.touched = true;
    if (t.dataset.lp === "capacity_at_config") lpDraft.capacityEdited = true;
    if (["total_weight", "capacity_at_config"].includes(t.dataset.lp)) lpRedrawFigures();
    if (lpDraft.showMissing) lpRedrawFlags();
  } else if (t.dataset.lpRig !== undefined) {
    const row = lpDraft.rigging[Number(t.dataset.lpRig)];
    if (row) row[t.dataset.key] = t.value;
    lpDraft.touched = true;
  }
});

document.addEventListener("change", (event) => {
  if (!lpDraft) return;
  const t = event.target;
  if (t.hasAttribute("data-lp-crane")) {
    lpDraft.values.crane_type = t.value;
    const truck = document.querySelector("[data-lp-truck]");
    if (truck) truck.hidden = t.value !== "truck";
  } else if (t.dataset.lpCheck) {
    lpDraft.values[t.dataset.lpCheck] = t.checked;
  } else if (t.dataset.lpMethod) {
    const methods = lpDraft.values.weight_methods.filter(m => m !== t.dataset.lpMethod);
    lpDraft.values.weight_methods = t.checked ? methods.concat(t.dataset.lpMethod) : methods;
  } else if (t.dataset.lpInsp) {
    lpDraft.inspection[t.dataset.lpInsp] = t.checked;
  } else if (t.hasAttribute("data-lp-photos")) {
    const files = [...t.files];
    t.value = "";
    return lpAddPhotos(files);
  } else return;
  lpDraft.touched = true;
  if (lpDraft.showMissing) lpRedrawFlags();
});

// A plan half written is a lot to lose to a stray reload.
window.addEventListener("beforeunload", (event) => {
  if (lpDraft && lpDraft.touched) event.preventDefault();
});

// ---- the Safety dashboard's table ---------------------------------------------

function renderPlans() {
  const q = $("planSearch").value.trim().toLowerCase();
  const rows = plans.filter(r => !q ||
    (r.job_description || "").toLowerCase().includes(q) ||
    (r.location || "").toLowerCase().includes(q) ||
    (r.created_by_name || "").toLowerCase().includes(q));

  const pending = plans.filter(p => p.status === "submitted").length;
  $("planStats").innerHTML =
    `<span class="stat"><b>${plans.length}</b>total</span>` +
    `<span class="stat"><b style="color:var(--red)">${pending}</b>awaiting approval</span>`;

  const badge = { submitted: ["Awaiting", "b-expiring"],
                  changes_requested: ["Changes requested", "b-expired"],
                  approved: ["Approved", "b-current"] };

  $("planTable").querySelector("tbody").innerHTML = rows.map(r => {
    const [label, cls] = badge[r.status] || ["—", "b-none"];
    const pct = lpPlanPercent(r) == null ? "—" : Math.round(lpPlanPercent(r)) + "%";
    return `<tr>
      <td>${r.submitted_at ? new Date(r.submitted_at).toLocaleDateString() : "—"}</td>
      <td>${esc(r.created_by_name || "—")}</td>
      <td><b>${esc(r.job_description || "Untitled lift")}</b></td>
      <td>${esc(r.location || "—")}</td>
      <td>${esc(locations[r.location_id] || "—")}</td>
      <td>${r.total_weight == null ? "—" : Number(r.total_weight).toLocaleString()}</td>
      <td>${pct}</td>
      <td><span class="badge ${cls}">${label}</span></td>
      <td><div class="row" style="flex-wrap:nowrap;gap:6px">
        <button class="ghost" data-lp-open="${esc(r.id)}">Open</button>
        <button class="ghost pdf" data-plan="${esc(r.id)}">PDF</button></div></td>
    </tr>`;
  }).join("") || `<tr><td colspan="9" class="note">No lift plans yet.</td></tr>`;
}

$("planSearch").addEventListener("input", renderPlans);

document.addEventListener("click", async (event) => {
  const button = event.target.closest("button.pdf[data-plan]");
  if (!button) return;
  const plan = plans.find(p => p.id === button.dataset.plan);
  if (!plan || button.disabled) return;
  const original = button.innerHTML;
  button.disabled = true;
  button.textContent = "Preparing…";
  try {
    await downloadPlanPDF(plan);
  } finally {
    button.disabled = false;
    button.innerHTML = original;
  }
});

// ---- the PDF -------------------------------------------------------------------

// Mirrors LiftPlanPDF.swift in the app, so a plan printed from a desk and one
// printed from a phone are the same document. US Letter at 72dpi, which is
// what jsPDF's "pt" unit measures in.
async function downloadPlanPDF(plan) {
  // The picture of the lift, fetched first. One that can't be fetched is left
  // out rather than holding up the export.
  const photos = (await Promise.all((plan.photo_paths || [])
    .map(path => storagePhotoData("lift-plan-photos", path)))).filter(Boolean);

  const PAGE_W = 612, PAGE_H = 792, MARGIN = 44;
  const WIDTH = PAGE_W - MARGIN * 2;

  const doc = new jspdf.jsPDF({ unit: "pt", format: "letter" });
  let y = MARGIN;

  // Every writer below asks for room first, so nothing straddles a page break.
  const ensure = (needed) => {
    if (y + needed > PAGE_H - MARGIN - 20) { doc.addPage(); y = MARGIN; }
  };

  // jsPDF's built-in fonts are Latin-1: dashes and curly quotes go plain, and
  // anything else outside it is dropped rather than printed as rubbish.
  const plain = (s) => pdfSafe(s).replace(/[^\x00-\xFF]/g, "");

  const text = (str, x, top, { size = 11, style = "normal", grey, width } = {}) => {
    doc.setFont("helvetica", style);
    doc.setFontSize(size);
    doc.setTextColor(grey == null ? 0 : grey);
    const lines = width ? doc.splitTextToSize(plain(str), width) : [plain(str)];
    // jsPDF positions text on the baseline; everything here is measured from
    // the top of the line, so shift down by roughly the ascender.
    doc.text(lines, x, top + size * 0.85);
    return lines.length * size * 1.25;
  };

  const clean = (v) => String(v ?? "").trim();
  const or = (v) => clean(v) || "-";

  const title = (str) => {
    ensure(30);
    doc.setFillColor(204, 0, 51);
    doc.rect(MARGIN, y, WIDTH, 24, "F");
    text(str, MARGIN + 6, y + 4, { size: 15, style: "bold", grey: 255 });
    y += 28;
  };

  const caption = (str) => {
    ensure(14);
    text(str, MARGIN, y, { size: 9, grey: 90 });
    y += 14;
  };

  const section = (str) => {
    ensure(28);
    y += 8;
    doc.setFillColor(237, 237, 237);
    doc.rect(MARGIN, y, WIDTH, 16, "F");
    text(str.toUpperCase(), MARGIN + 5, y + 2, { size: 11, style: "bold" });
    y += 21;
  };

  // An empty field is left out rather than printed as a dash: a plan is easier
  // to read when what's on it was actually filled in.
  const field = (label, value) => {
    const body = clean(value);
    if (!body) return;
    doc.setFontSize(11);
    const lines = doc.splitTextToSize(plain(body), WIDTH);
    ensure(lines.length * 14 + 14);
    text(label, MARGIN, y, { size: 8, style: "bold", grey: 128 });
    y += 10;
    y += text(body, MARGIN, y, { width: WIDTH });
  };

  const pair = (l1, v1, l2, v2) => {
    const half = (WIDTH - 12) / 2;
    ensure(30);
    text(l1, MARGIN, y, { size: 8, style: "bold", grey: 128 });
    text(l2, MARGIN + half + 12, y, { size: 8, style: "bold", grey: 128 });
    y += 10;
    text(or(v1), MARGIN, y, { width: half });
    text(or(v2), MARGIN + half + 12, y, { width: half });
    y += 18;
  };

  const check = (label, on) => {
    ensure(15);
    // "[x]" rather than a ballot-box character, which the fonts don't have.
    text(on ? "[x]" : "[ ]", MARGIN, y, { style: "bold" });
    text(label, MARGIN + 22, y, { grey: on ? 0 : 90, width: WIDTH - 22 });
    y += 15;
  };

  const COLUMNS = [130, 80, 70, 80, 40, 80];

  const riggingRow = (values, header) => {
    ensure(16);
    let x = MARGIN;
    values.forEach((value, i) => {
      text(or(value), x, y, header
        ? { size: 8, style: "bold", grey: 128 }
        : { size: 10 });
      x += COLUMNS[i];
    });
    y += header ? 12 : 14;
  };

  const date = (value) => value
    ? new Date(String(value).length <= 10 ? value + "T00:00:00" : value)
        .toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })
    : "-";

  // ---- the document -------------------------------------------------------

  title("CRANE LIFT / RIGGING PLAN");
  caption("Bridge Crane (Single Trolley) & Service Truck Crane Lifts");

  const status = [`Status: ${STATUS_LABELS[plan.status] || plan.status}`];
  if (plan.created_by_name) status.push(`Submitted by ${plan.created_by_name}`);
  if (plan.reviewed_at) status.push(`Reviewed ${date(plan.reviewed_at)}`);
  caption(status.join("    -    "));
  y += 8;

  section("Job Information");
  pair("Date", date(plan.lift_date), "Location / Facility", plan.location);
  field("Job / Task Description", plan.job_description);
  pair("Rigger-in-Charge", plan.rigger_in_charge, "Signal Person", plan.signal_person);

  section("Crane Type, Configuration & Capacity");
  pair("Crane Type", CRANE_TYPES[plan.crane_type] || "-",
       "Rated Capacity", plan.rated_capacity);
  if (plan.crane_type === "truck") {
    field("Truck Crane Details", plan.truck_details);
    field("Working Radius / Boom Angle", plan.working_radius);
  }
  field("Crane Capacity at This Radius / Config", plan.capacity_at_config);
  check("Centre of gravity confirmed", plan.center_of_gravity_confirmed);
  check("Lift is within the crane's rated capacity", plan.within_rated_capacity);
  check("Load chart consulted / capacity plate verified", plan.load_chart_consulted);

  section("Load Weight");
  field("Load Description", plan.load_description);
  pair("Load Weight", lpLbs(plan.load_weight), "Total Weight", lpLbs(plan.total_weight));
  field("How Was Weight Determined?",
        (plan.weight_methods || []).map(m => WEIGHT_METHODS[m] || m).join(", "));
  field("Source / Reference", plan.weight_source);
  const percent = lpPlanPercent(plan);
  if (percent != null) {
    field("% of Crane Capacity Used", Math.round(percent) + "%" + (percent > 100 ? "  - EXCEEDS RATED CAPACITY" : ""));
  }

  const rigging = (plan.rigging || []).filter(r =>
    [r.item, r.type, r.size, r.wll, r.qty, r.angle].some(v => clean(v)));
  if (rigging.length) {
    section("Rigging - Size & Type");
    riggingRow(["Component", "Type", "Size", "Rated WLL", "Qty", "Angle"], true);
    rigging.forEach(r => riggingRow([r.item, r.type, r.size, r.wll, r.qty, r.angle]));
  }
  // Taken off the form in September 2026; older plans that filled them in still show them.
  field("Below-the-Hook Lifting Device", plan.below_hook_device);
  field("Hitch Type & Sling Angle", plan.hitch_type);

  section("Pre-Lift Inspection Checklist");
  INSPECTION_ITEMS.forEach(([key, label]) =>
    check(label, (plan.inspection || {})[key] === true));

  section("Hazards & Lift Path");
  field("Hazards Identified", plan.hazards);
  field("Lift Path / Sketch", plan.lift_path);

  if (photos.length) {
    const cw = (WIDTH - 10) / 2, ch = cw * 0.75;
    ensure(ch + 34);                       // the heading stays with the first row
    section("Picture of Lift");
    photos.forEach((p, i) => {
      if (i % 2 === 0) { if (i > 0) y += ch + 10; ensure(ch + 4); }
      const cx = MARGIN + (i % 2) * (cw + 10);
      doc.setFillColor(242, 242, 242);
      doc.rect(cx, y, cw, ch, "F");
      const scale = Math.min(cw / p.width, ch / p.height);
      const w = p.width * scale, h = p.height * scale;
      doc.addImage(p.url, "JPEG", cx + (cw - w) / 2, y + (ch - h) / 2, w, h);
    });
    y += ch + 10;
  }

  text(`Generated from the Agri-Service web page - ${new Date().toLocaleDateString()}`,
       MARGIN, PAGE_H - MARGIN, { size: 9, grey: 128 });

  // Named so a folder of these sorts by date and stays unambiguous when two
  // people lifted on the same day.
  const stamp = (plan.lift_date || plan.submitted_at || "").slice(0, 10);
  const who = clean(plan.created_by_name).replace(/[^\w -]/g, "");
  doc.save(["Lift Plan", stamp, who].filter(Boolean).join(" - ") + ".pdf");
}
