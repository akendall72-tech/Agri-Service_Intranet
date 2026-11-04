// The Fleet Center
//
// Company pickups, service trucks and forklifts, the equipment on them, their
// maintenance log and the weekly check (the meter, the tires and a checklist),
// as in the app's Fleet Center (FleetView.swift).

// ---- the Fleet Center (0111) ------------------------------------------------
//
// Everyone sees the vehicles they drive, a location's admins every vehicle at
// their locations, owners every vehicle: the database decides. A weekly
// reminder, Fleet check, is on the To-Do list of everyone who drives one and
// ticks itself once each of their vehicles has had this week's check.
//
// Service is due every so many miles or months (hours or months for
// equipment), whichever comes first, counted from the last routine service in
// the log. The numbers here are worked out the same way as the app's.
//
// A pickup or service truck has its mileage. A forklift (0118) has an hour
// meter, serviced by hours or months, or no meter, serviced by the calendar.
// The weekly checklist (fleet_check_items) is kept by owners on the Admin
// dashboard's Fleet Check tab; each check keeps the items as worded that day.

let fvVehicles = [], fvEquipment = [], fvServices = [], fvChecks = [], fvPeople = [];
let fvItems = [], fvItemsError = null;
let fvLoaded = false, fvError = null, fvNotSetUp = false;
let openFleetId = null, fvAttentionOnly = false, fvShowRetired = false;
// On a vehicle's page: "check", "service" (the vehicle), "service:<id>" (a
// piece of its equipment), "equipment:new" or "equipment:<id>".
let fvPanel = null;
// The add or edit form.
let fvDraft = null;

const FV_KINDS = { pickup: "Pickup", service_truck: "Service Truck", forklift: "Forklift" };
// A forklift's meter; a pickup or service truck always reads miles.
const FV_METERS = { hours: "Hour meter", none: "No meter" };
const FV_TIRES = {
  good: { title: "Good", detail: "Plenty of tread, even wear", accent: "green" },
  fair: { title: "Fair", detail: "Wearing, still safe", accent: "amber" },
  worn: { title: "Worn", detail: "Getting low: plan new tires", accent: "ember" },
  replace: { title: "Replace", detail: "Bald, damaged or 2/32\" or less", accent: "red" }
};
const FV_SERVICE = { service: "Service (oil & filters)", tires: "Tires", brakes: "Brakes", inspection: "Inspection",
  repair: "Repair", other: "Other" };
const FV_GEAR = ["Welder", "Air compressor", "Generator", "Crane", "Pressure washer", "Fuel tank & pump"];

async function loadFleet() {
  const [v, e, s, c, items] = await Promise.all([
    db.from("fleet_vehicles").select("*").order("fleet_number"),
    db.from("fleet_equipment").select("*").order("created_at"),
    allRows(() => db.from("fleet_services").select("*").order("done_on", { ascending: false }).order("id")),
    allRows(() => db.from("fleet_checks").select("*").order("checked_on", { ascending: false }).order("id"), 2000),
    db.from("fleet_check_items").select("*").order("sort_order").order("label")
  ]);
  // Before 0118 there's no checklist; the check is the meter and the tires.
  fvItemsError = items.error ? items.error.message : null;
  fvItems = items.error ? [] : items.data || [];
  const err = v.error || e.error || s.error || c.error;
  if (err) {
    fvError = err.message || "unknown";
    fvNotSetUp = /does not exist|schema cache/i.test(fvError);
  } else {
    fvError = null; fvNotSetUp = false;
    fvVehicles = v.data || []; fvEquipment = e.data || []; fvServices = s.data || []; fvChecks = c.data || [];
    fvLoaded = true;
  }
  // The Location Dashboard's Fleet panel may have drawn before this arrived.
  if (document.body.classList.contains("location-mode")) safely(renderLocationOverview);
}

// ---- days, on the company's clock ----------------------------------------------

const fvToday = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Boise" });
// This week's Monday, in Boise: when the Fleet check comes back round.
function fvMonday() {
  const [y, m, d] = fvToday().split("-").map(Number);
  const day = new Date(y, m - 1, d);
  day.setDate(day.getDate() - (day.getDay() + 6) % 7);
  return `${day.getFullYear()}-${pad2(day.getMonth() + 1)}-${pad2(day.getDate())}`;
}
const fvDay = (ymd, year) => ymd ? dateOnly(ymd).toLocaleDateString("en-US",
  year ? { month: "short", day: "numeric", year: "numeric" } : { month: "short", day: "numeric" }) : "";
const fvMiles = (n) => Number(n || 0).toLocaleString("en-US");
const fvHours = (n) => Number(n || 0).toLocaleString("en-US", { maximumFractionDigits: 1 });

// ---- what's shown, worked out as the app does --------------------------------------

const fvVehicle = (id) => fvVehicles.find(v => v.id === id);
const fvActive = () => fvVehicles.filter(v => !v.retired_at);
const fvMine = () => fvActive().filter(v => me && v.driver_id === me.id);
const fvOthers = () => fvActive().filter(v => !me || v.driver_id !== me.id);
const fvGearOn = (v) => fvEquipment.filter(e => e.vehicle_id === v.id && !e.retired_at);
const fvLog = (v) => fvServices.filter(s => s.vehicle_id === v.id).sort((a, b) => b.done_on.localeCompare(a.done_on));
const fvChecksOf = (v) => fvChecks.filter(c => c.vehicle_id === v.id)
  .sort((a, b) => a.checked_on.localeCompare(b.checked_on) || String(a.created_at).localeCompare(String(b.created_at)));
const fvLastCheck = (v) => fvChecksOf(v).slice(-1)[0] || null;
// The checklist items a check found needing attention, as worded that day.
const fvFlagged = (c) => c ? (c.items || []).filter(i => ((c.answers || {})[i.id] || {}).status === "attention") : [];
// The items asked on this vehicle: those for its kind, or for every kind.
const fvItemsFor = (v) => fvItems.filter(i => i.is_active && (!(i.kinds || []).length || i.kinds.includes(v.kind)));
// What the vehicle's meter reads (0118): miles, hours, or nothing.
const fvMeter = (v) => v.kind === "forklift" ? (v.meter === "none" ? "none" : "hours") : "miles";
const fvUnit = (v) => ({ miles: "mi", hours: "hr" })[fvMeter(v)] || "";
const fvReading = (v) => fvMeter(v) === "miles" ? v.odometer : fvMeter(v) === "hours" ? v.hours : null;
const fvReadingText = (v, n) => n == null || n === "" ? "" : fvMeter(v) === "hours" ? `${fvHours(n)} hr` : `${fvMiles(n)} mi`;
// "Every 5,000 mi or 6 months", "Every 250 hr or 12 months", "Every 12 months".
const fvEvery = (v) => fvMeter(v) === "miles" ? `Every ${fvMiles(v.service_every_miles)} mi or ${v.service_every_months} months`
  : fvMeter(v) === "hours" && v.service_every_hours ? `Every ${fvHours(v.service_every_hours)} hr or ${v.service_every_months} months`
  : `Every ${v.service_every_months} months`;
// "Fleet #214": a card's headline, with the nickname (0113) on its own line under it.
const fvNumber = (v) => `Fleet #${v.fleet_number}`;
const fvNick = (v) => String(v.nickname || "").trim();
// "Fleet #214 · Big Red", or "Fleet #214": the vehicle named in a line of text.
const fvName = (v) => fvNick(v) ? `${fvNumber(v)} · ${fvNick(v)}` : fvNumber(v);
const fvNickHtml = (v) => fvNick(v) ? `<span class="fv-nick">${icon("tag", 14)}${esc(fvNick(v))}</span>` : "";
const fvDescription = (v) => [v.year, v.make, v.model].filter(Boolean).join(" ");
const fvCheckedThisWeek = (v) => { const monday = fvMonday(); return fvChecks.some(c => c.vehicle_id === v.id && c.checked_on >= monday); };

// Fleet check is only for the people who drive a vehicle. The database keeps it
// from everyone else; an owner reads every reminder to manage them, so until
// the fleet has loaded, theirs stays hidden.
function fvDrives() {
  if (!fvLoaded) return !isOwner();
  return fvMine().length > 0;
}

function fvLastService(v, item) {
  return fvServices.filter(s => item ? s.equipment_id === item.id && s.kind === "service"
      : s.vehicle_id === v.id && !s.equipment_id && s.kind === "service")
    .sort((a, b) => b.done_on.localeCompare(a.done_on))[0] || null;
}

function fvAddMonths(ymd, months) {
  const d = dateOnly(ymd);
  d.setMonth(d.getMonth() + months);
  return d;
}

// { left, every, days, dueOn, level }: what's left in miles (or hours) and
// days, and ok, soon, overdue, or unknown before any service is logged. With
// no meter, how much is used up comes from the calendar (months).
function fvDueFrom(left, every, dueOn, soon, months) {
  const today = dateOnly(fvToday());
  const days = dueOn ? Math.round((dueOn - today) / 86400000) : null;
  let level;
  if (left == null && days == null) level = "unknown";
  else if ((left != null && left <= 0) || (days != null && days <= 0)) level = "overdue";
  else if ((left != null && left <= soon) || (days != null && days <= 21)) level = "soon";
  else level = "ok";
  const used = left != null && every ? Math.max(0, 1 - left / every)
    : days != null && months ? Math.max(0, 1 - days / (months * 30.44)) : 0;
  return { left, every, days, dueOn, level, used };
}

function fvDue(v) {
  const last = fvLastService(v), meter = fvMeter(v);
  const every = meter === "miles" ? v.service_every_miles : meter === "hours" ? v.service_every_hours || 0 : 0;
  const at = !last ? null : meter === "miles" ? last.odometer : meter === "hours" ? last.hours : null;
  const now = fvReading(v);
  const left = every && at != null && now != null ? Number(at) + every - Number(now) : null;
  const dueOn = last ? fvAddMonths(last.done_on, v.service_every_months) : null;
  return fvDueFrom(left, every, dueOn, meter === "hours" ? Math.max(10, every * 0.15) : Math.max(500, every * 0.15),
    left == null ? v.service_every_months : null);
}

function fvGearDue(item) {
  if (!item.service_every_hours && !item.service_every_months) return null;
  const last = fvLastService(null, item);
  const left = item.service_every_hours && item.hours != null && last && last.hours != null
    ? Number(last.hours) + item.service_every_hours - Number(item.hours) : null;
  const dueOn = item.service_every_months && last ? fvAddMonths(last.done_on, item.service_every_months) : null;
  return fvDueFrom(left, item.service_every_hours || 0, dueOn, Math.max(10, (item.service_every_hours || 0) * 0.15),
    left == null ? item.service_every_months : null);
}

const fvNeedsAttention = (v) => !fvCheckedThisWeek(v) || fvDue(v).level === "overdue" || v.tire_condition === "replace"
  || fvFlagged(fvLastCheck(v)).length > 0 || fvGearOn(v).some(e => (fvGearDue(e) || {}).level === "overdue");
// The count on the home page and in the sidebar: the vehicles you drive that need something.
const fvAttentionCount = () => fvMine().filter(fvNeedsAttention).length;

const FV_LEVEL = { ok: ["Service OK", "green"], soon: ["Service soon", "amber"], overdue: ["Service overdue", "red"],
  unknown: ["No service logged", "slate"] };

// "1,240 mi left · by Apr 12", "312 mi overdue", "due in 9 days".
function fvDueText(due, unit) {
  const parts = [];
  if (due.left != null) {
    const n = Math.round(Math.abs(due.left)).toLocaleString("en-US");
    parts.push(due.left > 0 ? `${n} ${unit} left` : `${n} ${unit} overdue`);
  }
  if (due.days != null && due.dueOn) {
    const on = due.dueOn.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    if (due.days < 0) parts.push(`${-due.days} ${due.days === -1 ? "day" : "days"} past ${on}`);
    else if (due.days <= 30) parts.push(due.days === 0 ? "due today" : `due in ${due.days} ${due.days === 1 ? "day" : "days"}`);
    else parts.push(`by ${due.dueOn.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`);
  }
  return parts.length ? parts.join(" · ") : "Log a service to start the clock";
}

// The service ring: how much of the interval is used, in the level's colour.
function fvRing(due, size = 52) {
  const r = 20, c = 2 * Math.PI * r, used = due.level === "unknown" ? 0 : Math.min(1, Math.max(0.02, due.used));
  const inner = due.level === "overdue" ? "!" : due.level === "unknown" ? "–" : `${Math.round(Math.min(1, due.used) * 100)}%`;
  return `<svg class="fv-ring" width="${size}" height="${size}" viewBox="0 0 48 48" style="${lit(FV_LEVEL[due.level][1])}"
      role="img" aria-label="${esc(FV_LEVEL[due.level][0])}">
    <circle cx="24" cy="24" r="${r}" class="fv-ring-track"/>
    <circle cx="24" cy="24" r="${r}" class="fv-ring-fill" stroke-dasharray="${(used * c).toFixed(1)} ${c.toFixed(1)}"
      transform="rotate(-90 24 24)"/>
    <text x="24" y="28.5" text-anchor="middle">${inner}</text></svg>`;
}

function fvBar(due, unit) {
  return `<div class="fv-bar" style="${lit(FV_LEVEL[due.level][1])}"><i style="width:${
    Math.round(Math.min(1, Math.max(0.02, due.used)) * 100)}%"></i></div>
    <p class="fv-due ${due.level}">${esc(fvDueText(due, unit))}</p>`;
}

function fvTireChip(v) {
  const t = FV_TIRES[v.tire_condition];
  return `<span class="fv-tire" style="${lit(t ? t.accent : "slate")}">${t ? `Tires ${t.title.toLowerCase()}` : "Tires not checked"}${
    v.tread_32nds != null ? ` <small>· ${v.tread_32nds}/32"</small>` : ""}</span>`;
}

// ---- the Fleet Center ---------------------------------------------------------------

function fleetView() {
  setTimeout(async () => { await loadFleet(); fvRedraw(); });
  const head = hero("Fleet Center", "Mileage or hours, tires, a quick checklist, service and the equipment on board. Check your vehicles every Monday: it takes a minute.");
  if (fvNotSetUp || fvError) {
    return head + `<div class="cm"><div class="cm-card cm-empty"><b>${fvNotSetUp ? "The Fleet Center isn't switched on yet"
      : "The Fleet Center couldn't be loaded"}</b><p>${fvNotSetUp ? "It opens once the database is ready for it." : "Try again in a minute."}</p></div></div>`;
  }
  return head + `<div class="cm fv" id="fvPage">${fvPageHtml()}</div>`;
}

function fvRedraw() {
  if ($("view").classList.contains("hidden")) return;
  if (viewShown === "fleet" && $("fvPage")) $("fvPage").innerHTML = fvPageHtml();
  if (viewShown === "fleetvehicle" && $("fvVehicle")) $("fvVehicle").innerHTML = fvVehicleHtml();
}

function fvPageHtml() {
  if (!fvLoaded) return `<p class="cm-none">Loading…</p>`;
  const mine = fvMine(), due = mine.filter(v => !fvCheckedThisWeek(v)).length;
  const service = mine.filter(v => ["soon", "overdue"].includes(fvDue(v).level)).length;
  const others = fvOthers(), shown = others.filter(v => !fvAttentionOnly || fvNeedsAttention(v));
  const byLocation = {};
  shown.forEach(v => { (byLocation[v.location_id || ""] = byLocation[v.location_id || ""] || []).push(v); });
  const order = Object.keys(byLocation).sort((a, b) => (locations[a] || "~").localeCompare(locations[b] || "~"));
  const retired = fvVehicles.filter(v => v.retired_at);
  const stat = (value, label, accent) => `<div style="${lit(accent)}"><span class="cm-stat"><b>${value}</b><small>${esc(label)}</small></span></div>`;
  return `<div class="cm-card fv-hero">
      <p class="cm-eyebrow">${icon("fleet", 15)}Fleet Center</p>
      <h2 class="fv-title">Your fleet, kept right</h2>
      <div class="cm-stats fv-stats">
        ${stat(mine.length, mine.length === 1 ? "vehicle" : "vehicles", "teal")}
        ${stat(due, due === 1 ? "check due" : "checks due", due ? "amber" : "green")}
        ${stat(service, "service due", service ? "ember" : "green")}
      </div>
      <div class="fv-actions"><button type="button" class="fv-go" data-fv-add>${icon("plus", 17)}Add a vehicle</button></div>
    </div>
    <h2 class="group-title">Your vehicles</h2>
    ${mine.length ? mine.map(v => fvCardHtml(v, false)).join("") : `<button type="button" class="cm-card fv-empty" data-fv-add>
        <b>Add your vehicle</b><span>The pickup, service truck or forklift you look after: its fleet number, when it was last
          serviced, its tires, and any equipment on it.</span><span class="cm-go">Add a vehicle &rarr;</span></button>`}
    ${others.length ? `<div class="cm-kind fv-tabs" role="group" aria-label="Which vehicles">
        <button type="button" class="${fvAttentionOnly ? "" : "on"}" data-fv-filter="all" aria-pressed="${!fvAttentionOnly}">All · ${others.length}</button>
        <button type="button" class="${fvAttentionOnly ? "on" : ""}" data-fv-filter="attention" aria-pressed="${fvAttentionOnly}">Needs attention · ${
          others.filter(fvNeedsAttention).length}</button></div>
      ${shown.length ? "" : `<p class="cm-none">Nothing needs attention. Every vehicle is checked and in service.</p>`}
      ${order.map(loc => `<h2 class="group-title">${esc(locations[loc] || "No location")}</h2>
        ${byLocation[loc].map(v => fvCardHtml(v, true)).join("")}`).join("")}` : ""}
    ${retired.length ? `<button type="button" class="fv-retired-toggle" data-fv-retired aria-expanded="${fvShowRetired}">
        Retired · ${retired.length} ${fvShowRetired ? "▾" : "▸"}</button>
      ${fvShowRetired ? retired.map(v => fvCardHtml(v, true)).join("") : ""}` : ""}`;
}

function fvCardHtml(v, showDriver) {
  const due = fvDue(v), checked = fvCheckedThisWeek(v), gear = fvGearOn(v).length;
  const tag = v.retired_at ? `<span class="cab-tag">Retired</span>`
    : checked ? `<span class="cab-tag" style="${lit("green")}">Checked</span>` : `<span class="cab-tag fv-due-tag">Check due</span>`;
  const flagged = fvFlagged(fvLastCheck(v)).length;
  return `<button type="button" class="cm-card fv-card${due.level === "overdue" || v.tire_condition === "replace" || flagged ? " alert" : ""}${
      v.retired_at ? " retired" : ""}" data-fv-open="${esc(v.id)}">
    <span class="fv-card-top">
      <span class="fv-glyph">${icon("fleet", 22)}</span>
      <span class="fv-who"><b>${esc(fvNumber(v))} ${tag}</b>${fvNickHtml(v)}
        <span>${esc([fvDescription(v), FV_KINDS[v.kind]].filter(Boolean).join(" · "))}</span>
        ${showDriver ? `<small>${esc([v.driver_name || "No driver", locations[v.location_id]].filter(Boolean).join(" · "))}</small>` : ""}</span>
      ${fvRing(due, 50)}
    </span>
    ${fvBar(due, fvUnit(v))}
    <span class="fv-card-foot">
      ${fvReading(v) != null ? `<span class="fv-odo">${fvReadingText(v, fvReading(v))}</span>` : ""}
      ${fvTireChip(v)}
      ${flagged ? `<span class="fv-tire" style="${lit("red")}">${flagged} flagged on the last check</span>` : ""}
      ${gear ? `<span class="fv-gear-count">${gear} on board</span>` : ""}
    </span>
  </button>`;
}

// ---- a vehicle ------------------------------------------------------------------------

function fleetVehicleView() {
  const v = fvVehicle(openFleetId);
  if (!v) return hero("Fleet Center") + `<div class="cm"><div class="cm-card cm-empty"><b>That vehicle isn't here</b>
    <p>It may have been deleted, or handed to someone at another location.</p></div></div>`;
  return hero(fvName(v), [fvDescription(v), FV_KINDS[v.kind]].filter(Boolean).join(" · ")) +
    `<div class="cm fv" id="fvVehicle">${fvVehicleHtml()}</div>`;
}

function fvVehicleHtml() {
  const v = fvVehicle(openFleetId);
  if (!v) return `<p class="cm-none">That vehicle isn't here.</p>`;
  const checked = fvCheckedThisWeek(v), due = fvDue(v), last = fvLastService(v);
  const canDelete = isOwner() || adminAt(v.location_id) || (me && v.driver_id === me.id && v.created_by === me.id);
  return `<div class="cm-card fv-head">
      <p class="cm-eyebrow">${icon("fleet", 15)}${esc([FV_KINDS[v.kind], v.driver_name, locations[v.location_id]].filter(Boolean).join(" · "))}</p>
      ${fvMeter(v) === "none" ? `<div class="fv-odo-big"><b>No meter</b><small>serviced by the calendar</small></div>`
        : `<div class="fv-odo-big"><b>${fvReading(v) != null ? (fvMeter(v) === "hours" ? fvHours(fvReading(v)) : fvMiles(fvReading(v))) : "–"}</b><span>${fvUnit(v)}</span>
        ${(fvMeter(v) === "hours" ? v.hours_on : v.odometer_on) ? `<small>as of ${esc(fvDay(fvMeter(v) === "hours" ? v.hours_on : v.odometer_on))}</small>` : ""}</div>`}
      ${v.retired_at ? `<p class="fv-note">Retired ${esc(new Date(v.retired_at).toLocaleDateString())}.</p>` : `
      ${checked ? "" : `<p class="fv-warn">${icon("calendar", 15)}This week's check is due: ${
        { miles: "the odometer, ", hours: "the hour meter, " }[fvMeter(v)] || ""}the tires${fvItemsFor(v).length ? " and the checklist" : ""}.</p>`}
      <div class="fv-actions">
        <button type="button" class="fv-go${checked ? " quiet" : ""}" data-fv-panel="check">${icon("checkCircle", 17)}${checked ? "Check again" : "Weekly check"}</button>
        <button type="button" class="fv-go quiet" data-fv-panel="service">${icon("wrench", 17)}Log service</button>
        <button type="button" class="fv-go quiet" data-fv-edit>${icon("pencil", 17)}Edit</button>
      </div>`}
    </div>
    ${fvPanel ? fvPanelHtml(v) : ""}
    <div class="cm-card fv-service${due.level === "overdue" ? " alert" : ""}">
      ${fvRing(due, 84)}
      <div><b class="fv-level ${due.level}">${esc(FV_LEVEL[due.level][0])}</b>
        <p class="fv-due-big">${esc(fvDueText(due, fvUnit(v)))}</p>
        ${last ? `<small>Last service ${esc(fvDay(last.done_on, true))}${(() => {
          const at = fvMeter(v) === "miles" ? last.odometer : fvMeter(v) === "hours" ? last.hours : null;
          return at != null ? ` at ${fvReadingText(v, at)}` : ""; })()}</small><br>` : ""}
        <small>${esc(fvEvery(v))}</small></div>
    </div>
    <h2 class="group-title">${{ miles: "Mileage &amp; maintenance", hours: "Hours &amp; maintenance" }[fvMeter(v)] || "Maintenance"}</h2>
    <div class="cm-card fv-chart-card">${fvChartHtml(v, due)}</div>
    ${fvLastCheckHtml(v)}
    <h2 class="group-title">Tires</h2>
    <div class="cm-card${v.tire_condition === "replace" ? " alert" : ""}">
      <div class="fv-row">${fvTireChip(v)}${v.tires_checked_on ? `<small>Checked ${esc(fvDay(v.tires_checked_on))}</small>` : ""}</div>
      ${fvTreadHtml(v)}
      <p class="fv-note">Tread in 32nds of an inch at the shallowest tire. 2/32" is the legal minimum; most shops replace at 4/32".</p>
    </div>
    <h2 class="group-title">Equipment on board</h2>
    ${fvGearOn(v).map(e => fvGearHtml(e)).join("")}
    ${v.retired_at ? "" : `<button type="button" class="fv-quiet" data-fv-panel="equipment:new">${icon("plus", 16)}Add equipment</button>`}
    <h2 class="group-title">Service log${(() => { const year = String(new Date().getFullYear());
      const spent = fvLog(v).filter(s => s.done_on.startsWith(year)).reduce((t, s) => t + Number(s.cost || 0), 0);
      return spent ? ` <span class="cm-n">${spent.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })} this year</span>` : ""; })()}</h2>
    <div class="cm-card fv-log">${fvLogHtml(v)}</div>
    <h2 class="group-title">Details</h2>
    <div class="cm-card fv-details">
      <div><span>Fleet number</span><b>${esc(v.fleet_number)}</b></div>
      ${v.vin ? `<div><span>VIN</span><b>${esc(v.vin)}</b></div>` : ""}
      ${v.plate ? `<div><span>Plate</span><b>${esc(v.plate)}</b></div>` : ""}
      ${v.kind === "forklift" ? `<div><span>Meter</span><b>${esc(FV_METERS[fvMeter(v)])}</b></div>` : ""}
      <div><span>Service</span><b>${esc(fvEvery(v))}</b></div>
      ${v.notes ? `<p>${esc(v.notes)}</p>` : ""}
    </div>
    <div class="fv-foot">
      ${v.retired_at ? `<button type="button" class="fv-quiet" data-fv-act="restore">Bring it back</button>`
        : `<button type="button" class="fv-quiet" data-fv-act="retire">Retire it</button>`}
      ${canDelete ? `<button type="button" class="fv-quiet danger" data-fv-act="delete">Delete it</button>` : ""}
    </div>
    <p class="fv-msg" role="alert"></p>`;
}

// The meter over time (miles, or a forklift's hours), every service marked on
// it, and a dashed line where the next one is due. A forklift with no meter
// has no chart: it's serviced by the calendar.
function fvChartHtml(v, due) {
  const meter = fvMeter(v), hours = meter === "hours";
  if (meter === "none") return `<p class="fv-note">No meter: it's serviced by the calendar, every ${v.service_every_months} months
    from the last service in the log.</p>`;
  const at = (x) => x == null ? null : Number(x);
  const readings = [
    ...fvChecksOf(v).filter(c => at(hours ? c.hours : c.odometer) != null).map(c => ({ d: c.checked_on, m: at(hours ? c.hours : c.odometer) })),
    ...fvLog(v).filter(s => !s.equipment_id && at(hours ? s.hours : s.odometer) != null).map(s => ({ d: s.done_on, m: at(hours ? s.hours : s.odometer) }))
  ].sort((a, b) => a.d.localeCompare(b.d) || a.m - b.m);
  if (readings.length < 2) {
    return `<p class="fv-note">The chart fills in with each weekly check. Check the ${hours ? "forklift" : "vehicle"} on Mondays and it
      builds up the ${hours ? "hours" : "miles"}, every service on the way, and where the next one's due.</p>`;
  }
  const events = fvLog(v).filter(s => !s.equipment_id && at(hours ? s.hours : s.odometer) != null);
  const last = fvLastService(v), every = hours ? v.service_every_hours : v.service_every_miles;
  const lastAt = last ? at(hours ? last.hours : last.odometer) : null;
  const nextDue = lastAt != null && every ? lastAt + every : null;
  const label = (n) => hours ? `${fvHours(n)} hr` : `${fvMiles(n)} mi`;
  const W = 640, H = 220, L = 44, R = 12, T = 18, B = 26;
  const t0 = dateOnly(readings[0].d).getTime(), t1 = Math.max(dateOnly(readings[readings.length - 1].d).getTime(), t0 + 86400000);
  const low = Math.min(...readings.map(r => r.m)), high = Math.max(...readings.map(r => r.m), nextDue || 0);
  const pad = Math.max(hours ? 20 : 500, (high - low) / 8), y0 = Math.max(0, low - pad), y1 = high + pad;
  const x = (d) => L + (dateOnly(d).getTime() - t0) / (t1 - t0) * (W - L - R);
  const y = (m) => T + (1 - (m - y0) / (y1 - y0)) * (H - T - B);
  const line = readings.map((r, i) => `${i ? "L" : "M"}${x(r.d).toFixed(1)},${y(r.m).toFixed(1)}`).join(" ");
  const area = `${line} L${x(readings[readings.length - 1].d).toFixed(1)},${H - B} L${x(readings[0].d).toFixed(1)},${H - B} Z`;
  const ticks = [];
  for (let k = 0; k <= 4; k++) {
    const m = y0 + (y1 - y0) * k / 4;
    ticks.push(`<line x1="${L}" x2="${W - R}" y1="${y(m).toFixed(1)}" y2="${y(m).toFixed(1)}" class="fv-grid"/>
      <text x="${L - 6}" y="${(y(m) + 4).toFixed(1)}" text-anchor="end" class="fv-axis">${hours ? Math.round(m).toLocaleString("en-US")
        : `${(m / 1000).toFixed(m >= 100000 ? 0 : 1)}k`}</text>`);
  }
  const months = [];
  const start = dateOnly(readings[0].d); start.setDate(1); start.setMonth(start.getMonth() + 1);
  for (let d = start; d.getTime() <= t1; d.setMonth(d.getMonth() + 1)) {
    const ymd = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-01`;
    months.push(`<text x="${x(ymd).toFixed(1)}" y="${H - 8}" text-anchor="middle" class="fv-axis">${
      d.toLocaleDateString("en-US", { month: "short" })}</text>`);
  }
  const perWeek = (readings[readings.length - 1].m - readings[0].m) / ((t1 - t0) / 86400000) * 7;
  const dueColor = FV_LEVEL[due.level][1];
  return `<svg class="fv-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${hours ? "Hours" : "Mileage"} over time, with each service marked and where the next service is due">
      <defs><linearGradient id="fvArea" x1="0" x2="0" y1="0" y2="1"><stop offset="0" class="fv-area-top"/><stop offset="1" class="fv-area-bottom"/></linearGradient></defs>
      ${ticks.join("")}${months.join("")}
      <path d="${area}" fill="url(#fvArea)"/>
      <path d="${line}" class="fv-line"/>
      ${nextDue && nextDue <= y1 ? `<line x1="${L}" x2="${W - R}" y1="${y(nextDue).toFixed(1)}" y2="${y(nextDue).toFixed(1)}" class="fv-due-line" style="${lit(dueColor)}"/>
        <text x="${L + 4}" y="${(y(nextDue) - 5).toFixed(1)}" class="fv-due-label" style="${lit(dueColor)}">Service due ${label(nextDue)}</text>` : ""}
      ${events.map(s => { const m = at(hours ? s.hours : s.odometer);
        return `<g class="fv-event"><circle cx="${x(s.done_on).toFixed(1)}" cy="${y(m).toFixed(1)}" r="7"/>
        <text x="${x(s.done_on).toFixed(1)}" y="${(y(m) + 3.5).toFixed(1)}" text-anchor="middle">${esc((FV_SERVICE[s.kind] || "S")[0])}</text>
        <title>${esc(FV_SERVICE[s.kind] || s.kind)}, ${esc(fvDay(s.done_on, true))}, ${label(m)}</title></g>`; }).join("")}
    </svg>
    ${t1 - t0 >= 6 * 86400000 ? `<p class="fv-note">About ${hours ? fvHours(Math.round(perWeek * 10) / 10) : fvMiles(Math.round(perWeek))} ${hours ? "hours" : "miles"} a week.</p>` : ""}`;
}

// The last weekly check: who did it, the checklist as they answered it, and
// their note. Anything needing attention stands out.
function fvLastCheckHtml(v) {
  const c = fvLastCheck(v);
  if (!c || !(c.items || []).length && !c.notes) return "";
  const flagged = fvFlagged(c);
  return `<h2 class="group-title">The last check${flagged.length ? ` <span class="cm-n">${flagged.length} need${flagged.length === 1 ? "s" : ""} attention</span>` : ""}</h2>
    <div class="cm-card fv-lastcheck${flagged.length ? " alert" : ""}">
      <p class="fv-note">${esc([fvDay(c.checked_on, true), c.created_by_name, fvReadingText(v, fvMeter(v) === "hours" ? c.hours : c.odometer)].filter(Boolean).join(" · "))}</p>
      ${(c.items || []).length ? `<ul class="fv-answers">${c.items.map(i => { const a = (c.answers || {})[i.id] || {};
        return `<li${a.status === "attention" ? ` class="bad"` : ""}>${icon(a.status === "attention" ? "warning" : "checkCircle", 15)}<span><b>${esc(i.label)}</b>${
          a.status === "attention" ? ` <em>Needs attention</em>` : ""}${a.note ? `<small>${esc(a.note)}</small>` : ""}</span></li>`; }).join("")}</ul>` : ""}
      ${c.notes ? `<p class="fv-note">${esc(c.notes)}</p>` : ""}
    </div>`;
}

// Tread at each check, as bars, with the 4/32" line.
function fvTreadHtml(v) {
  const rows = fvChecksOf(v).filter(c => c.tread_32nds != null);
  if (rows.length < 2) return "";
  const W = 640, H = 110, L = 28, B = 6, top = Math.max(14, ...rows.map(c => c.tread_32nds + 1));
  const bw = Math.min(26, (W - L) / rows.length - 4);
  const y = (t) => 6 + (1 - t / top) * (H - 6 - B);
  return `<svg class="fv-chart fv-tread" viewBox="0 0 ${W} ${H}" role="img" aria-label="Tread depth at each check">
    ${rows.map((c, i) => { const cx = L + (i + 0.5) * (W - L) / rows.length;
      return `<rect x="${(cx - bw / 2).toFixed(1)}" y="${y(c.tread_32nds).toFixed(1)}" width="${bw.toFixed(1)}"
        height="${(H - B - y(c.tread_32nds)).toFixed(1)}" rx="3" style="${lit((FV_TIRES[c.tire_condition] || {}).accent || "slate")}" class="fv-tread-bar">
        <title>${esc(fvDay(c.checked_on, true))}: ${c.tread_32nds}/32"</title></rect>`; }).join("")}
    <line x1="${L}" x2="${W}" y1="${y(4).toFixed(1)}" y2="${y(4).toFixed(1)}" class="fv-due-line" style="${lit("red")}"/>
    <text x="2" y="${(y(4) + 4).toFixed(1)}" class="fv-axis">4/32</text></svg>`;
}

function fvGearHtml(e) {
  const due = fvGearDue(e);
  return `<div class="cm-card fv-gear${due && due.level === "overdue" ? " alert" : ""}" style="${lit("amber")}">
    <div class="fv-card-top"><span class="fv-glyph gear">${icon("wrench", 18)}</span>
      <span class="fv-who"><b>${esc(e.kind)}</b>
        <span>${esc([[e.make, e.model].filter(Boolean).join(" "), e.serial ? `S/N ${e.serial}` : ""].filter(Boolean).join(" · "))}</span>
        ${e.hours != null ? `<small>${fvHours(e.hours)} hours</small>` : ""}</span>
      ${due ? fvRing(due, 44) : ""}</div>
    ${due ? fvBar(due, "hr") : ""}
    <div class="fv-gear-acts">
      <button type="button" class="fv-quiet" data-fv-panel="service:${esc(e.id)}">${icon("wrench", 15)}Log service</button>
      <button type="button" class="fv-quiet" data-fv-panel="equipment:${esc(e.id)}">${icon("pencil", 15)}Edit</button>
    </div>
  </div>`;
}

function fvLogHtml(v) {
  const rows = fvLog(v);
  if (!rows.length) return `<p class="fv-note">Nothing logged yet. Log each oil change, set of tires, repair or inspection,
    and the service clock keeps itself.</p>`;
  return rows.map(s => { const gear = s.equipment_id && fvEquipment.find(e => e.id === s.equipment_id);
    return `<div class="fv-log-row">
      <span><b>${esc(gear ? `${gear.kind}: ${s.kind === "service" ? "Service" : FV_SERVICE[s.kind]}` : FV_SERVICE[s.kind] || s.kind)}</b>
        <small>${esc([fvDay(s.done_on, true), s.odometer != null ? `${fvMiles(s.odometer)} mi` : "",
          s.hours != null ? `${fvHours(s.hours)} hr` : "", s.created_by_name].filter(Boolean).join(" · "))}</small>
        ${s.notes ? `<span class="fv-note">${esc(s.notes)}</span>` : ""}</span>
      ${s.cost != null ? `<em>${Number(s.cost).toLocaleString("en-US", { style: "currency", currency: "USD" })}</em>` : ""}
      <button type="button" class="fv-x" data-fv-del-service="${esc(s.id)}" aria-label="Delete this entry">&times;</button>
    </div>`; }).join("");
}

// ---- the panels on a vehicle's page: check, service, equipment ---------------------------

function fvPanelHtml(v) {
  if (fvPanel === "check") {
    const tires = Object.entries(FV_TIRES).map(([k, t]) => `<label class="fv-tire-pick" style="${lit(t.accent)}">
        <input type="radio" name="fvcTires" value="${k}"${v.tire_condition === k ? " checked" : ""}>
        <span><b>${t.title}</b><small>${esc(t.detail)}</small></span></label>`).join("");
    const meter = fvMeter(v), items = fvItemsFor(v);
    return `<div class="card fv-panel" id="fvPanel">
      <h2>This week's check</h2>
      <div class="fields">
        ${meter === "miles" ? `<div><label for="fvcOdo">Odometer (miles)</label><input id="fvcOdo" type="number" min="0" max="2000000" step="1" value="${v.odometer ?? ""}"></div>`
          : meter === "hours" ? `<div><label for="fvcHours">Hour meter</label><input id="fvcHours" type="number" min="0" max="100000" step="0.1" value="${v.hours ?? ""}"></div>` : ""}
        <div><label for="fvcTread">Shallowest tread, 32nds (optional)</label><input id="fvcTread" type="number" min="0" max="32" step="1" placeholder="Not measured"></div>
      </div>
      <label>Tire wear</label><div class="fv-tire-picks">${tires}</div>
      ${items.length ? `<label>Checklist</label>
        <div class="fv-items">${items.map(i => `<div class="fv-item" data-fv-item="${esc(i.id)}">
          <span class="fv-item-text"><b>${esc(i.label)}</b>${i.detail ? `<small>${esc(i.detail)}</small>` : ""}</span>
          <span class="fv-item-pick" role="radiogroup" aria-label="${esc(i.label)}">
            <label><input type="radio" name="fvi-${esc(i.id)}" value="ok"> OK</label>
            <label class="bad"><input type="radio" name="fvi-${esc(i.id)}" value="attention"> Needs attention</label>
          </span>
          <input class="fv-item-note" data-fv-note="${esc(i.id)}" maxlength="300" placeholder="What needs doing?" aria-label="What needs doing on ${esc(i.label)}">
        </div>`).join("")}</div>` : ""}
      <label for="fvcNotes">Anything else?</label>
      <textarea id="fvcNotes" rows="2" maxlength="1000" placeholder="A warning light, a noise, a chip in the windshield"></textarea>
      <div class="row"><button type="button" data-fv-act="save-check">Save this week's check</button>
        <button type="button" class="ghost" data-fv-act="close">Cancel</button></div>
      <p class="msg"></p>
    </div>`;
  }
  if (fvPanel.startsWith("service")) {
    const gear = fvPanel.includes(":") ? fvEquipment.find(e => e.id === fvPanel.split(":")[1]) : null;
    const kinds = gear ? ["service", "repair", "inspection", "other"] : Object.keys(FV_SERVICE);
    return `<div class="card fv-panel" id="fvPanel">
      <h2>Log service${gear ? `: ${esc(gear.kind)}` : ""}</h2>
      <div class="fields">
        <div><label for="fvsKind">What was done</label><select id="fvsKind">${kinds.map(k => `<option value="${k}">${esc(FV_SERVICE[k])}</option>`).join("")}</select></div>
        <div><label for="fvsDate">When</label><input id="fvsDate" type="date" max="${fvToday()}" value="${fvToday()}"></div>
        ${!gear && fvMeter(v) === "none" ? "" : `<div><label for="fvsReading">${gear || fvMeter(v) === "hours" ? "Hour meter" : "Odometer (miles)"}</label>
          <input id="fvsReading" type="number" min="0" step="${gear || fvMeter(v) === "hours" ? "0.1" : "1"}" value="${gear ? gear.hours ?? "" : fvReading(v) ?? ""}"></div>`}
        <div><label for="fvsCost">Cost, $ (optional)</label><input id="fvsCost" type="number" min="0" step="0.01"></div>
        <div class="wide"><label for="fvsNotes">Notes</label><textarea id="fvsNotes" rows="2" maxlength="2000"
          placeholder="What was done, where, any parts"></textarea></div>
      </div>
      <p class="note">A routine service restarts the service clock from this ${gear || fvMeter(v) === "hours" ? "hour reading and date"
        : fvMeter(v) === "none" ? "date" : "mileage and date"}.</p>
      <div class="row"><button type="button" data-fv-act="save-service" data-fv-gear="${gear ? esc(gear.id) : ""}">Save</button>
        <button type="button" class="ghost" data-fv-act="close">Cancel</button></div>
      <p class="msg"></p>
    </div>`;
  }
  // Equipment, new or being edited.
  const e = fvPanel === "equipment:new" ? null : fvEquipment.find(x => x.id === fvPanel.split(":")[1]);
  const val = (k, d = "") => esc(e ? e[k] ?? d : d);
  return `<div class="card fv-panel" id="fvPanel">
    <h2>${e ? `Edit ${esc(e.kind)}` : "Add equipment"}</h2>
    <div class="fields">
      <div><label for="fveKind">What it is</label><input id="fveKind" list="fveKinds" maxlength="40" value="${val("kind", "Welder")}">
        <datalist id="fveKinds">${FV_GEAR.map(k => `<option value="${esc(k)}">`).join("")}</datalist></div>
      <div><label for="fveMake">Make</label><input id="fveMake" maxlength="60" value="${val("make")}"></div>
      <div><label for="fveModel">Model</label><input id="fveModel" maxlength="60" value="${val("model")}"></div>
      <div><label for="fveSerial">Serial</label><input id="fveSerial" maxlength="60" value="${val("serial")}"></div>
      <div><label for="fveHours">Hour meter</label><input id="fveHours" type="number" min="0" step="0.1" value="${val("hours")}"></div>
      <div><label for="fveEvery">Service every (hours)</label><input id="fveEvery" type="number" min="10" max="10000" step="1"
        value="${e ? val("service_every_hours") : "250"}" placeholder="None"></div>
      <div><label for="fveMonths">Or every (months)</label><input id="fveMonths" type="number" min="1" max="36" step="1"
        value="${e ? val("service_every_months") : "12"}" placeholder="None"></div>
      <div class="wide"><label for="fveNotes">Notes</label><textarea id="fveNotes" rows="2" maxlength="2000"
        placeholder="Oil type, filter numbers, quirks">${val("notes")}</textarea></div>
    </div>
    <div class="row"><button type="button" data-fv-act="save-equipment">Save</button>
      <button type="button" class="ghost" data-fv-act="close">Cancel</button>
      ${e ? `<button type="button" class="ghost danger" data-fv-act="retire-equipment">Take it off this vehicle</button>` : ""}</div>
    <p class="msg"></p>
  </div>`;
}

// ---- adding or editing a vehicle ---------------------------------------------------------

function fleetFormView() {
  if (!fvDraft) fvDraft = fvDraftFor(null);
  const d = fvDraft, editing = !!d.id;
  const manages = isOwner() || isAdmin();
  const names = isOwner() ? null : new Set(myLocations().map(id => locations[id]));
  const drivers = fvPeople.filter(p => !names || names.has(p.location || "")).filter(p => !me || p.id !== me.id);
  if (manages && !fvPeople.length) setTimeout(fvLoadPeople);
  const f = (key, label, value, more = "") => `<div><label for="fvf-${key}">${label}</label><input id="fvf-${key}" data-fvf="${key}" value="${esc(value ?? "")}" ${more}></div>`;
  return hero(editing ? `Edit ${fvName({ fleet_number: d.fleet_number })}` : "Add a Vehicle",
      editing ? "" : "Everything the Fleet Center needs from day one: its fleet number, when it was last serviced, its mileage and tires, and the equipment on it.") +
    `<div class="card fv-form" id="fvForm">
      <h2>The vehicle</h2>
      <div class="fields">
        <div><label for="fvfKind">Kind</label><select id="fvfKind" data-fvf="kind">${Object.entries(FV_KINDS).map(([k, t]) =>
          `<option value="${k}"${d.kind === k ? " selected" : ""}>${t}</option>`).join("")}</select></div>
        ${d.kind === "forklift" ? `<div><label for="fvfMeter">Meter</label><select id="fvfMeter" data-fvf="meter">${Object.entries(FV_METERS).map(([k, t]) =>
          `<option value="${k}"${d.meter === k ? " selected" : ""}>${t}</option>`).join("")}</select></div>` : ""}
        ${f("fleet_number", "Fleet number (required)", d.fleet_number, 'maxlength="20" autocomplete="off"')}
        ${f("nickname", "Nickname (optional)", d.nickname, 'maxlength="30" placeholder="Big Red" autocomplete="off"')}
        ${f("year", "Year", d.year, 'type="number" min="1950" max="2100"')}
        ${f("make", "Make", d.make, 'maxlength="60" placeholder="Ford"')}
        ${f("model", "Model", d.model, 'maxlength="60" placeholder="F-350"')}
        ${f("vin", "VIN (optional)", d.vin, 'maxlength="40"')}
        ${f("plate", "Plate (optional)", d.plate, 'maxlength="20"')}
        ${manages ? `<div><label for="fvfDriver">Driven by</label><select id="fvfDriver" data-fvf="driver_id">
            <option value="${esc(me ? me.id : "")}">Me</option>
            ${drivers.map(p => `<option value="${esc(p.id)}"${d.driver_id === p.id ? " selected" : ""}>${esc(p.full_name)}${p.location ? ` · ${esc(p.location)}` : ""}</option>`).join("")}
            ${d.driver_id && d.driver_id !== (me && me.id) && !drivers.some(p => p.id === d.driver_id)
              ? `<option value="${esc(d.driver_id)}" selected>${esc(d.driver_name || "Their driver")}</option>` : ""}
          </select></div>` : ""}
      </div>
      <p class="note">The fleet number is the one painted on it. No two vehicles on the road share one. A nickname, like Big Red, shows beside it to tell similar trucks apart.${manages ? " It's kept at the driver's location, and they get the Fleet check on their To-Do list every week." : ""}</p>
      ${(() => { const meter = d.kind === "forklift" ? (d.meter === "none" ? "none" : "hours") : "miles";
        return `<h2>${{ miles: "Mileage and service", hours: "Hours and service" }[meter] || "Service"}</h2>
      <div class="fields">
        ${meter === "miles" ? `${f("odometer", "Odometer (miles)", d.odometer, 'type="number" min="0" max="2000000"')}
          ${f("service_every_miles", "Service every (miles)", d.service_every_miles, 'type="number" min="500" max="100000" step="500"')}` : ""}
        ${meter === "hours" ? `${f("hours", "Hour meter", d.hours, 'type="number" min="0" max="100000" step="0.1"')}
          ${f("service_every_hours", "Service every (hours)", d.service_every_hours, 'type="number" min="10" max="10000" step="10" placeholder="By the calendar only"')}` : ""}
        ${f("service_every_months", meter === "none" ? "Service every (months)" : "Or every (months)", d.service_every_months, 'type="number" min="1" max="36"')}
        ${editing ? "" : `${f("last_on", "Last serviced on", d.last_on, `type="date" max="${fvToday()}"`)}
          ${meter === "none" ? "" : f("last_miles", meter === "hours" ? "At (hours)" : "At (miles)", d.last_miles,
            meter === "hours" ? 'type="number" min="0" max="100000" step="0.1"' : 'type="number" min="0" max="2000000"')}`}
      </div>
      <p class="note">${meter === "none" ? "With no meter, service is due by the calendar." : "Service is due at whichever comes first."}${
        editing ? "" : " Leave the last service empty if you don't know it; the clock starts with the first one you log."}</p>`; })()}
      <h2>Tire wear</h2>
      <div class="fv-tire-picks">${Object.entries(FV_TIRES).map(([k, t]) => `<label class="fv-tire-pick light" style="${lit(t.accent)}">
        <input type="radio" name="fvfTires" value="${k}"${d.tire_condition === k ? " checked" : ""}>
        <span><b>${t.title}</b><small>${esc(t.detail)}</small></span></label>`).join("")}</div>
      <div class="fields">${f("tread_32nds", "Shallowest tread, 32nds (optional)", d.tread_32nds, 'type="number" min="0" max="32" placeholder="Not measured"')}</div>
      ${editing ? "" : `<h2>Equipment on it</h2>
        <p class="note">A welder, compressor, generator or crane: anything with its own service. Each starts with a service every
          250 hours or 12 months, changed on its own card later.</p>
        ${d.gear.map((g, i) => `<div class="fields fv-gear-row">
          <div><label for="fvg${i}k">What it is</label><input id="fvg${i}k" list="fveKinds2" data-fvg="${i}:kind" value="${esc(g.kind)}" maxlength="40"></div>
          <div><label for="fvg${i}m">Make</label><input id="fvg${i}m" data-fvg="${i}:make" value="${esc(g.make)}" maxlength="60"></div>
          <div><label for="fvg${i}o">Model</label><input id="fvg${i}o" data-fvg="${i}:model" value="${esc(g.model)}" maxlength="60"></div>
          <div><label for="fvg${i}h">Hours</label><input id="fvg${i}h" type="number" min="0" step="0.1" data-fvg="${i}:hours" value="${esc(g.hours)}"></div>
          <div class="fv-gear-del"><button type="button" class="ghost" data-fv-gear-del="${i}">Remove</button></div>
        </div>`).join("")}
        <datalist id="fveKinds2">${FV_GEAR.map(k => `<option value="${esc(k)}">`).join("")}</datalist>
        <div class="row"><button type="button" class="ghost" data-fv-gear-add>${icon("plus", 15)}Add equipment</button></div>`}
      <h2>Notes</h2>
      <textarea id="fvfNotes" data-fvf="notes" rows="3" maxlength="2000" placeholder="Anything worth knowing about it">${esc(d.notes)}</textarea>
      <div class="row"><button type="button" data-fv-act="save-vehicle">${editing ? "Save" : "Add the vehicle"}</button>
        <button type="button" class="ghost" data-fv-act="cancel-form">Cancel</button></div>
      <p class="msg"></p>
    </div>`;
}

function fvDraftFor(v) {
  return v ? { id: v.id, kind: v.kind, meter: fvMeter(v), fleet_number: v.fleet_number, nickname: v.nickname || "", year: v.year ?? "", make: v.make, model: v.model, vin: v.vin,
    plate: v.plate, driver_id: v.driver_id, driver_name: v.driver_name, odometer: v.odometer ?? "", hours: v.hours ?? "",
    service_every_miles: v.service_every_miles, service_every_hours: v.service_every_hours ?? "", service_every_months: v.service_every_months,
    tire_condition: v.tire_condition, tread_32nds: v.tread_32nds ?? "", notes: v.notes, gear: [] }
    : { id: null, kind: "pickup", meter: "miles", fleet_number: "", nickname: "", year: "", make: "", model: "", vin: "", plate: "", driver_id: me ? me.id : null,
      driver_name: "", odometer: "", hours: "", service_every_miles: 5000, service_every_hours: 250, service_every_months: 6, tire_condition: "good", tread_32nds: "",
      last_on: "", last_miles: "", notes: "", gear: [] };
}

async function fvLoadPeople() {
  const { data } = await db.rpc("community_people");
  fvPeople = data || [];
  if (viewShown === "fleetform" && fvPeople.length) {
    const y = window.scrollY;
    showView("fleetform");
    window.scrollTo(0, y);
  }
}

// ---- wiring ---------------------------------------------------------------------------

function fvSay(text, bad = true) {
  const where = document.querySelector("#fvPanel .msg") || document.querySelector("#fvForm .msg") || document.querySelector("#fvVehicle .fv-msg");
  if (where) { where.textContent = text; where.className = where.className.replace(/ ?(error|ok)/g, "") + (bad ? " error" : " ok"); }
  else if (bad) alert(text);
}

function fvProblem(error) {
  if (error.code === "23505") return "Another vehicle on the road already has that fleet number.";
  if (error.code === "42501") return "You can't change that vehicle.";
  return error.message || "That didn't save. Try again.";
}

async function fvAfterSave() {
  await loadFleet();
  fvPanel = null;
  fvRedraw();
}

$("view").addEventListener("input", (event) => {
  const t = event.target;
  if (!fvDraft || !t.closest("#fvForm")) return;
  if (t.dataset.fvf) fvDraft[t.dataset.fvf] = t.value;
  if (t.dataset.fvg) { const [i, key] = t.dataset.fvg.split(":"); fvDraft.gear[Number(i)][key] = t.value; }
});

$("view").addEventListener("change", (event) => {
  const t = event.target;
  if (fvDraft && t.closest("#fvForm")) {
    if (t.name === "fvfTires") fvDraft.tire_condition = t.value;
    if (t.dataset.fvf) fvDraft[t.dataset.fvf] = t.value;
    // A forklift asks which meter it has; the readings follow the meter.
    if (t.dataset.fvf === "kind" || t.dataset.fvf === "meter") {
      if (t.dataset.fvf === "kind") fvDraft.meter = fvDraft.kind === "forklift" ? "hours" : "miles";
      const y = window.scrollY; showView("fleetform"); window.scrollTo(0, y);
    }
  }
});

$("view").addEventListener("click", async (event) => {
  const b = event.target.closest("[data-fv-open], [data-fv-add], [data-fv-filter], [data-fv-retired], [data-fv-panel], [data-fv-edit], "
    + "[data-fv-act], [data-fv-del-service], [data-fv-gear-add], [data-fv-gear-del]");
  if (!b) return;
  const d = b.dataset;
  if (d.fvOpen) { openFleetId = d.fvOpen; fvPanel = null; return showView("fleetvehicle"); }
  if (d.fvAdd !== undefined) { fvDraft = fvDraftFor(null); return showView("fleetform"); }
  if (d.fvEdit !== undefined) { fvDraft = fvDraftFor(fvVehicle(openFleetId)); return showView("fleetform"); }
  if (d.fvFilter) { fvAttentionOnly = d.fvFilter === "attention"; return fvRedraw(); }
  if (d.fvRetired !== undefined) { fvShowRetired = !fvShowRetired; return fvRedraw(); }
  if (d.fvPanel) {
    fvPanel = d.fvPanel;
    fvRedraw();
    const panel = $("fvPanel");
    if (panel) { panel.scrollIntoView({ behavior: "smooth", block: "center" }); const first = panel.querySelector("input, select"); if (first) first.focus({ preventScroll: true }); }
    return;
  }
  if (d.fvGearAdd !== undefined) {
    fvDraft.gear.push({ kind: "Welder", make: "", model: "", hours: "" });
    const y = window.scrollY; showView("fleetform"); window.scrollTo(0, y);
    return;
  }
  if (d.fvGearDel !== undefined) {
    fvDraft.gear.splice(Number(d.fvGearDel), 1);
    const y = window.scrollY; showView("fleetform"); window.scrollTo(0, y);
    return;
  }
  if (d.fvDelService) {
    if (!confirm("Delete this entry from the log?")) return;
    const { error } = await db.from("fleet_services").delete().eq("id", d.fvDelService);
    if (error) return fvSay(fvProblem(error));
    return fvAfterSave();
  }
  const v = fvVehicle(openFleetId);
  switch (d.fvAct) {
    case "close": fvPanel = null; return fvRedraw();
    case "cancel-form": { const back = fvDraft && fvDraft.id; fvDraft = null; return showView(back ? "fleetvehicle" : "fleet"); }
    case "save-check": return fvSaveCheck(v, b);
    case "save-service": return fvSaveService(v, b);
    case "save-equipment": return fvSaveEquipment(v, b);
    case "retire-equipment": {
      const e = fvEquipment.find(x => x.id === fvPanel.split(":")[1]);
      if (!e || !confirm(`Take the ${e.kind} off ${fvName(v)}? Its service history is kept.`)) return;
      const { error } = await db.from("fleet_equipment").update({ retired_at: new Date().toISOString() }).eq("id", e.id);
      if (error) return fvSay(fvProblem(error));
      return fvAfterSave();
    }
    case "retire": case "restore": {
      if (d.fvAct === "retire" && !confirm(`Retire ${fvName(v)}? It comes off the lists and its Fleet check stops, but its history is kept.`)) return;
      const { error } = await db.from("fleet_vehicles").update({ retired_at: d.fvAct === "retire" ? new Date().toISOString() : null }).eq("id", v.id);
      if (error) return fvSay(fvProblem(error));
      return fvAfterSave();
    }
    case "delete": {
      if (!confirm(`Delete ${fvName(v)} and its history? Its checks, service log and equipment go too. To keep the history, retire it instead.`)) return;
      const { error } = await db.from("fleet_vehicles").delete().eq("id", v.id);
      if (error) return fvSay(fvProblem(error));
      await loadFleet();
      return showView("fleet");
    }
    case "save-vehicle": return fvSaveVehicle(b);
  }
});

async function fvSaveCheck(v, button) {
  const meter = fvMeter(v), treadText = $("fvcTread").value;
  const tires = (document.querySelector("input[name=fvcTires]:checked") || {}).value;
  let odometer = null, hours = null;
  if (meter === "miles") {
    odometer = Number($("fvcOdo").value);
    if (!$("fvcOdo").value || !Number.isInteger(odometer) || odometer < 0 || odometer > 2000000) return fvSay("Give the odometer in whole miles.");
    if (v.odometer != null && odometer < v.odometer && !confirm(`That's less than the last reading, ${fvMiles(v.odometer)} mi. Save it anyway?`)) return;
  }
  if (meter === "hours") {
    hours = Number($("fvcHours").value);
    if ($("fvcHours").value === "" || !(hours >= 0 && hours <= 100000)) return fvSay("Give the hour meter reading.");
    if (v.hours != null && hours < Number(v.hours) && !confirm(`That's less than the last reading, ${fvHours(v.hours)} hr. Save it anyway?`)) return;
  }
  if (!tires) return fvSay("Pick how the tires look.");
  const tread = treadText === "" ? null : Number(treadText);
  if (tread != null && !(Number.isInteger(tread) && tread >= 0 && tread <= 32)) return fvSay("Tread is a whole number of 32nds, from 0 to 32.");
  // Every item on the checklist, OK or needing attention, with a note for the second.
  const answers = {}, missing = [];
  fvItemsFor(v).forEach(i => {
    const picked = document.querySelector(`input[name="fvi-${CSS.escape(i.id)}"]:checked`);
    if (!picked) return missing.push(i.label);
    const note = (document.querySelector(`[data-fv-note="${CSS.escape(i.id)}"]`) || {}).value || "";
    answers[i.id] = { status: picked.value, note: picked.value === "attention" ? note.trim() : "" };
  });
  if (missing.length) return fvSay(`Answer every item on the checklist: ${missing.join(", ")}.`);
  button.disabled = true;
  const { error } = await db.from("fleet_checks").insert({ vehicle_id: v.id, odometer, hours, tire_condition: tires, tread_32nds: tread,
    notes: $("fvcNotes").value.trim(), answers });
  button.disabled = false;
  if (error) return fvSay(fvProblem(error));
  // The reminder ticks itself in the database; show it ticked here too.
  await Promise.all([fvAfterSave(), (async () => {
    const { data } = await db.from("task_completions").select("*").eq("user_id", me.id);
    if (data) completions = data;
  })()]);
  fvSay("Saved. Thanks: that's this week's check done.", false);
}

async function fvSaveService(v, button) {
  const gearId = button.dataset.fvGear || null, kind = $("fvsKind").value, reading = $("fvsReading") ? $("fvsReading").value : "";
  const byHours = gearId || fvMeter(v) === "hours";
  const row = { vehicle_id: v.id, equipment_id: gearId, kind, done_on: $("fvsDate").value || fvToday(),
    odometer: !byHours && reading !== "" ? Math.round(Number(reading)) : null,
    hours: byHours && reading !== "" ? Number(reading) : null,
    cost: $("fvsCost").value === "" ? null : Number($("fvsCost").value), notes: $("fvsNotes").value.trim() };
  if (row.done_on > fvToday()) return fvSay("The date can't be in the future.");
  if (kind === "service" && row.odometer == null && row.hours == null && (gearId || fvMeter(v) !== "none")) {
    return fvSay(`Give the ${byHours ? "hour meter" : "odometer"} reading: the service clock counts from it.`);
  }
  if (row.cost != null && !(row.cost >= 0)) return fvSay("The cost should be a number, like 214.18.");
  button.disabled = true;
  const { error } = await db.from("fleet_services").insert(row);
  button.disabled = false;
  if (error) return fvSay(fvProblem(error));
  await fvAfterSave();
}

async function fvSaveEquipment(v, button) {
  const editing = fvPanel !== "equipment:new" ? fvEquipment.find(x => x.id === fvPanel.split(":")[1]) : null;
  const num = (id) => $(id).value === "" ? null : Number($(id).value);
  const row = { vehicle_id: v.id, kind: $("fveKind").value.trim(), make: $("fveMake").value.trim(), model: $("fveModel").value.trim(),
    serial: $("fveSerial").value.trim(), hours: num("fveHours"), service_every_hours: num("fveEvery"),
    service_every_months: num("fveMonths"), notes: $("fveNotes").value.trim() };
  if (!row.kind) return fvSay("Say what it is: a welder, a compressor…");
  if (row.service_every_hours != null && !(row.service_every_hours >= 10 && row.service_every_hours <= 10000)) return fvSay("Service every 10 to 10,000 hours, or leave it empty.");
  if (row.service_every_months != null && !(row.service_every_months >= 1 && row.service_every_months <= 36)) return fvSay("Every 1 to 36 months, or leave it empty.");
  button.disabled = true;
  const { error } = editing ? await db.from("fleet_equipment").update(row).eq("id", editing.id) : await db.from("fleet_equipment").insert(row);
  button.disabled = false;
  if (error) return fvSay(fvProblem(error));
  await fvAfterSave();
}

async function fvSaveVehicle(button) {
  const d = fvDraft, n = (x) => x === "" || x == null ? null : Number(x);
  const fleetNumber = String(d.fleet_number).trim();
  if (!fleetNumber) return fvSay("Give the vehicle its fleet number.");
  const year = n(d.year);
  if (year != null && !(year >= 1950 && year <= 2100)) return fvSay("That year doesn't look right.");
  const meter = d.kind === "forklift" ? (d.meter === "none" ? "none" : "hours") : "miles";
  const every = meter === "miles" ? n(d.service_every_miles) : n(d.service_every_miles) || 5000;
  const everyHours = meter === "hours" ? n(d.service_every_hours) : null, months = n(d.service_every_months);
  if (meter === "miles" && !(every >= 500 && every <= 100000)) return fvSay("Service every 500 to 100,000 miles.");
  if (everyHours != null && !(everyHours >= 10 && everyHours <= 10000)) return fvSay("Service every 10 to 10,000 hours, or leave it empty.");
  if (!(months >= 1 && months <= 36)) return fvSay(meter === "none" ? "Service every 1 to 36 months." : "Or every 1 to 36 months.");
  const hours = meter === "hours" ? n(d.hours) : null;
  if (hours != null && !(hours >= 0 && hours <= 100000)) return fvSay("That hour meter reading doesn't look right.");
  const tread = n(d.tread_32nds);
  if (tread != null && !(Number.isInteger(tread) && tread >= 0 && tread <= 32)) return fvSay("Tread is a whole number of 32nds, from 0 to 32.");
  if (!d.id && d.last_on && meter !== "none" && d.last_miles === "") {
    return fvSay(`Give the ${meter === "hours" ? "hours" : "mileage"} at the last service too, or leave the date empty.`);
  }
  const row = { kind: d.kind, meter, fleet_number: fleetNumber, nickname: String(d.nickname || "").trim(), year, make: String(d.make).trim(), model: String(d.model).trim(),
    vin: String(d.vin).trim(), plate: String(d.plate).trim(), odometer: meter === "miles" ? n(d.odometer) : null, hours,
    tire_condition: d.tire_condition || null, tread_32nds: tread, service_every_miles: every, service_every_hours: everyHours,
    service_every_months: months, notes: String(d.notes).trim() };
  if (isOwner() || isAdmin()) row.driver_id = d.driver_id || (me && me.id);
  button.disabled = true;
  let id = d.id, error;
  if (id) {
    ({ error } = await db.from("fleet_vehicles").update(row).eq("id", id));
  } else {
    id = crypto.randomUUID();
    ({ error } = await db.from("fleet_vehicles").insert({ id, ...row }));
    if (!error && d.last_on) {
      ({ error } = await db.from("fleet_services").insert({ vehicle_id: id, kind: "service", done_on: d.last_on,
        odometer: meter === "miles" ? n(d.last_miles) : null, hours: meter === "hours" ? n(d.last_miles) : null,
        notes: "Last service before the Fleet Center" }));
    }
    for (const g of d.gear.filter(x => String(x.kind).trim())) {
      if (error) break;
      ({ error } = await db.from("fleet_equipment").insert({ vehicle_id: id, kind: String(g.kind).trim(), make: String(g.make).trim(),
        model: String(g.model).trim(), hours: n(g.hours), service_every_hours: 250, service_every_months: 12 }));
    }
  }
  button.disabled = false;
  if (error) return fvSay(fvProblem(error));
  await loadFleet();
  fvDraft = null;
  openFleetId = id;
  showView("fleetvehicle");
}

// ---- admin: the weekly checklist (0118) ------------------------------------------------
//
// The items every weekly check asks, each answered OK or Needs attention. Owners
// keep them here; an item can be for pickups, service trucks, forklifts, or
// all of them (none ticked). Taking one off the list or rewording it never
// changes a check already done: each check keeps the items as worded that day.

function renderFleetCheckAdmin() {
  const box = $("fleetCheckAdmin");
  if (!box) return;
  if (fvItemsError) {
    box.innerHTML = `<div class="card"><p class="error">${/does not exist|schema cache/i.test(fvItemsError)
      ? "Run migration 0118_fleet_checklist_and_forklifts.sql in the SQL editor, then reload this page." : esc(fvItemsError)}</p></div>`;
    return;
  }
  const kinds = (i) => Object.entries(FV_KINDS).map(([k, t]) => `<label class="fva-kind"><input type="checkbox" data-fva-kind="${k}"${
    (i.kinds || []).includes(k) ? " checked" : ""}> ${t}</label>`).join("");
  box.innerHTML = `<div class="card">
    <h2>Weekly fleet check</h2>
    <p class="note">The checklist on every vehicle's weekly check, after the meter and the tires. Each item is answered <b>OK</b> or
      <b>Needs attention</b>, with a note; anything needing attention shows on the vehicle and its Location Dashboard until the next
      check. Tick the kinds of vehicle an item is for, or none for all of them. Changes reach the app and this page straight away.</p>
    <p class="note"><b>Showing: No</b> takes an item off the check and can be switched back. Rewording or deleting one never changes a
      check already done: each check keeps the items as they were worded that day.</p>
    ${fvItems.length ? fvItems.map((i, n) => `<div class="role${i.is_active ? "" : " off"}" style="padding:16px${i.is_active ? "" : ";opacity:.6"}" data-fva-item="${esc(i.id)}">
      <div class="fields">
        <div class="wide"><label>Item</label><input type="text" data-fva="label" maxlength="80" value="${esc(i.label)}"></div>
        <div class="wide"><label>Help (optional, shown under it)</label><input type="text" data-fva="detail" maxlength="200" value="${esc(i.detail || "")}"></div>
        <div class="wide"><label>For</label><div class="fva-kinds">${kinds(i)}</div></div>
        <div><label>Showing</label><select data-fva="is_active">
          <option value="yes"${i.is_active ? " selected" : ""}>Yes</option><option value="no"${i.is_active ? "" : " selected"}>No</option></select></div>
      </div>
      <div class="row">
        <button data-fva-act="save">Save</button>
        <button class="ghost" data-fva-act="up"${n === 0 ? " disabled" : ""} aria-label="Move up">&uarr;</button>
        <button class="ghost" data-fva-act="down"${n === fvItems.length - 1 ? " disabled" : ""} aria-label="Move down">&darr;</button>
        <button class="ghost" data-fva-act="delete">Delete</button>
        <span class="msg"></span>
      </div>
    </div>`).join("") : `<p class="note">No items yet: the weekly check is the meter and the tires.</p>`}
    <div class="row" style="margin-top:10px"><button data-fva-act="add">Add an item</button><span class="msg" id="fvaMsg"></span></div>
  </div>`;
}

async function fvaReload() {
  const { data, error } = await db.from("fleet_check_items").select("*").order("sort_order").order("label");
  if (!error) fvItems = data || [];
  renderFleetCheckAdmin();
}

$("admin").addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-fva-act]");
  if (!button) return;
  const act = button.dataset.fvaAct;
  if (act === "add") {
    const { error } = await db.from("fleet_check_items").insert({ label: "New item", is_active: false,
      sort_order: (Math.max(0, ...fvItems.map(i => i.sort_order || 0)) + 10) });
    if (error) return speak(button.closest(".row"), error.message.includes("row-level") ? "Only an owner can change the checklist." : error.message, true);
    await fvaReload();
    return speak($("fvaMsg").closest(".row"), "Added, not showing yet. Word it, set Showing to Yes, and save.", false);
  }
  const box = button.closest("[data-fva-item]"), id = box.dataset.fvaItem, item = fvItems.find(i => i.id === id);
  if (act === "delete") {
    if (!confirm(`Delete "${item.label}" from the checklist? Checks already done keep it. "Showing: No" can be undone; this can't.`)) return;
    const { data, error } = await db.from("fleet_check_items").delete().eq("id", id).select("id");
    if (error || !(data || []).length) return speak(box, error ? error.message : "Not deleted — only an owner can change the checklist.", true);
    return fvaReload();
  }
  if (act === "up" || act === "down") {
    const at = fvItems.findIndex(i => i.id === id), other = fvItems[act === "up" ? at - 1 : at + 1];
    if (!other) return;
    // Spaced out first, so two items never share a place.
    const order = fvItems.map((i, n) => ({ id: i.id, sort_order: (n + 1) * 10 }));
    const a = order[at], b = order[act === "up" ? at - 1 : at + 1];
    [a.sort_order, b.sort_order] = [b.sort_order, a.sort_order];
    for (const row of order) {
      if (fvItems.find(i => i.id === row.id).sort_order === row.sort_order) continue;
      const { error } = await db.from("fleet_check_items").update({ sort_order: row.sort_order }).eq("id", row.id);
      if (error) return speak(box, error.message, true);
    }
    return fvaReload();
  }
  const label = box.querySelector('[data-fva="label"]').value.trim();
  if (!label) return speak(box, "An item needs some words.", true);
  speak(box, "Saving…", false);
  const { data, error } = await db.from("fleet_check_items").update({
    label, detail: box.querySelector('[data-fva="detail"]').value.trim(),
    kinds: [...box.querySelectorAll("[data-fva-kind]:checked")].map(c => c.dataset.fvaKind),
    is_active: box.querySelector('[data-fva="is_active"]').value === "yes"
  }).eq("id", id).select("id");
  if (error) return speak(box, error.message, true);
  if (!(data || []).length) return speak(box, "Not saved — only an owner can change the checklist.", true);
  await fvaReload();
  speak(document.querySelector(`[data-fva-item="${CSS.escape(id)}"]`), "Saved.", false);
});
