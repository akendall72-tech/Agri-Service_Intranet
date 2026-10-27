// The Fleet Center
//
// Company pickups and service trucks, the equipment on them, their
// maintenance log and the weekly check of mileage and tire wear, as in the
// app's Fleet Center (FleetView.swift).

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

let fvVehicles = [], fvEquipment = [], fvServices = [], fvChecks = [], fvPeople = [];
let fvLoaded = false, fvError = null, fvNotSetUp = false;
let openFleetId = null, fvAttentionOnly = false, fvShowRetired = false;
// On a vehicle's page: "check", "service" (the vehicle), "service:<id>" (a
// piece of its equipment), "equipment:new" or "equipment:<id>".
let fvPanel = null;
// The add or edit form.
let fvDraft = null;

const FV_KINDS = { pickup: "Pickup", service_truck: "Service Truck" };
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
  const [v, e, s, c] = await Promise.all([
    db.from("fleet_vehicles").select("*").order("fleet_number"),
    db.from("fleet_equipment").select("*").order("created_at"),
    db.from("fleet_services").select("*").order("done_on", { ascending: false }),
    db.from("fleet_checks").select("*").order("checked_on", { ascending: false }).limit(2000)
  ]);
  const err = v.error || e.error || s.error || c.error;
  if (err) {
    fvError = err.message || "unknown";
    fvNotSetUp = /does not exist|schema cache/i.test(fvError);
    return;
  }
  fvError = null; fvNotSetUp = false;
  fvVehicles = v.data || []; fvEquipment = e.data || []; fvServices = s.data || []; fvChecks = c.data || [];
  fvLoaded = true;
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
const fvChecksOf = (v) => fvChecks.filter(c => c.vehicle_id === v.id).sort((a, b) => a.checked_on.localeCompare(b.checked_on));
const fvName = (v) => `Fleet #${v.fleet_number}`;
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
// days, and ok, soon, overdue, or unknown before any service is logged.
function fvDueFrom(left, every, dueOn, soon) {
  const today = dateOnly(fvToday());
  const days = dueOn ? Math.round((dueOn - today) / 86400000) : null;
  let level;
  if (left == null && days == null) level = "unknown";
  else if ((left != null && left <= 0) || (days != null && days <= 0)) level = "overdue";
  else if ((left != null && left <= soon) || (days != null && days <= 21)) level = "soon";
  else level = "ok";
  return { left, every, days, dueOn, level, used: left != null && every ? Math.max(0, 1 - left / every) : 0 };
}

function fvDue(v) {
  const last = fvLastService(v);
  const left = last && last.odometer != null && v.odometer != null ? last.odometer + v.service_every_miles - v.odometer : null;
  const dueOn = last ? fvAddMonths(last.done_on, v.service_every_months) : null;
  return fvDueFrom(left, v.service_every_miles, dueOn, Math.max(500, v.service_every_miles * 0.15));
}

function fvGearDue(item) {
  if (!item.service_every_hours && !item.service_every_months) return null;
  const last = fvLastService(null, item);
  const left = item.service_every_hours && item.hours != null && last && last.hours != null
    ? Number(last.hours) + item.service_every_hours - Number(item.hours) : null;
  const dueOn = item.service_every_months && last ? fvAddMonths(last.done_on, item.service_every_months) : null;
  return fvDueFrom(left, item.service_every_hours || 0, dueOn, Math.max(10, (item.service_every_hours || 0) * 0.15));
}

const fvNeedsAttention = (v) => !fvCheckedThisWeek(v) || fvDue(v).level === "overdue" || v.tire_condition === "replace"
  || fvGearOn(v).some(e => (fvGearDue(e) || {}).level === "overdue");
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
  const head = hero("Fleet Center", "Mileage, tires, service and the equipment on board. Check your vehicles every Monday: it takes a minute.");
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
      <h2 class="fv-title">Your trucks, kept right</h2>
      <div class="cm-stats fv-stats">
        ${stat(mine.length, mine.length === 1 ? "vehicle" : "vehicles", "teal")}
        ${stat(due, due === 1 ? "check due" : "checks due", due ? "amber" : "green")}
        ${stat(service, "service due", service ? "ember" : "green")}
      </div>
      <div class="fv-actions"><button type="button" class="fv-go" data-fv-add>${icon("plus", 17)}Add a vehicle</button></div>
    </div>
    <h2 class="group-title">Your vehicles</h2>
    ${mine.length ? mine.map(v => fvCardHtml(v, false)).join("") : `<button type="button" class="cm-card fv-empty" data-fv-add>
        <b>Add your vehicle</b><span>The pickup or service truck you drive: its fleet number, when it was last serviced,
          its tires, and any equipment on it.</span><span class="cm-go">Add a vehicle &rarr;</span></button>`}
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
  return `<button type="button" class="cm-card fv-card${due.level === "overdue" || v.tire_condition === "replace" ? " alert" : ""}${
      v.retired_at ? " retired" : ""}" data-fv-open="${esc(v.id)}">
    <span class="fv-card-top">
      <span class="fv-glyph">${icon("fleet", 22)}</span>
      <span class="fv-who"><b>${esc(fvName(v))} ${tag}</b>
        <span>${esc([fvDescription(v), FV_KINDS[v.kind]].filter(Boolean).join(" · "))}</span>
        ${showDriver ? `<small>${esc([v.driver_name || "No driver", locations[v.location_id]].filter(Boolean).join(" · "))}</small>` : ""}</span>
      ${fvRing(due, 50)}
    </span>
    ${fvBar(due, "mi")}
    <span class="fv-card-foot">
      ${v.odometer != null ? `<span class="fv-odo">${fvMiles(v.odometer)} mi</span>` : ""}
      ${fvTireChip(v)}
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
      <div class="fv-odo-big"><b>${v.odometer != null ? fvMiles(v.odometer) : "–"}</b><span>mi</span>
        ${v.odometer_on ? `<small>as of ${esc(fvDay(v.odometer_on))}</small>` : ""}</div>
      ${v.retired_at ? `<p class="fv-note">Retired ${esc(new Date(v.retired_at).toLocaleDateString())}.</p>` : `
      ${checked ? "" : `<p class="fv-warn">${icon("calendar", 15)}This week's check is due: the odometer and the tires.</p>`}
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
        <p class="fv-due-big">${esc(fvDueText(due, "mi"))}</p>
        ${last ? `<small>Last service ${esc(fvDay(last.done_on, true))}${last.odometer != null ? ` at ${fvMiles(last.odometer)} mi` : ""}</small><br>` : ""}
        <small>Every ${fvMiles(v.service_every_miles)} mi or ${v.service_every_months} months</small></div>
    </div>
    <h2 class="group-title">Mileage &amp; maintenance</h2>
    <div class="cm-card fv-chart-card">${fvChartHtml(v, due)}</div>
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
      <div><span>Service every</span><b>${fvMiles(v.service_every_miles)} mi or ${v.service_every_months} months</b></div>
      ${v.notes ? `<p>${esc(v.notes)}</p>` : ""}
    </div>
    <div class="fv-foot">
      ${v.retired_at ? `<button type="button" class="fv-quiet" data-fv-act="restore">Bring it back</button>`
        : `<button type="button" class="fv-quiet" data-fv-act="retire">Retire it</button>`}
      ${canDelete ? `<button type="button" class="fv-quiet danger" data-fv-act="delete">Delete it</button>` : ""}
    </div>
    <p class="fv-msg" role="alert"></p>`;
}

// The odometer over time, every service marked on it, and a dashed line where
// the next one is due.
function fvChartHtml(v, due) {
  const readings = [
    ...fvChecksOf(v).map(c => ({ d: c.checked_on, m: c.odometer })),
    ...fvLog(v).filter(s => !s.equipment_id && s.odometer != null).map(s => ({ d: s.done_on, m: s.odometer }))
  ].sort((a, b) => a.d.localeCompare(b.d) || a.m - b.m);
  if (readings.length < 2) {
    return `<p class="fv-note">The chart fills in with each weekly check. Check the vehicle on Mondays and it builds up the
      miles, every service on the way, and where the next one's due.</p>`;
  }
  const events = fvLog(v).filter(s => !s.equipment_id && s.odometer != null);
  const last = fvLastService(v);
  const nextDue = last && last.odometer != null ? last.odometer + v.service_every_miles : null;
  const W = 640, H = 220, L = 44, R = 12, T = 18, B = 26;
  const t0 = dateOnly(readings[0].d).getTime(), t1 = Math.max(dateOnly(readings[readings.length - 1].d).getTime(), t0 + 86400000);
  const low = Math.min(...readings.map(r => r.m)), high = Math.max(...readings.map(r => r.m), nextDue || 0);
  const pad = Math.max(500, (high - low) / 8), y0 = low - pad, y1 = high + pad;
  const x = (d) => L + (dateOnly(d).getTime() - t0) / (t1 - t0) * (W - L - R);
  const y = (m) => T + (1 - (m - y0) / (y1 - y0)) * (H - T - B);
  const line = readings.map((r, i) => `${i ? "L" : "M"}${x(r.d).toFixed(1)},${y(r.m).toFixed(1)}`).join(" ");
  const area = `${line} L${x(readings[readings.length - 1].d).toFixed(1)},${H - B} L${x(readings[0].d).toFixed(1)},${H - B} Z`;
  const ticks = [];
  for (let k = 0; k <= 4; k++) {
    const m = y0 + (y1 - y0) * k / 4;
    ticks.push(`<line x1="${L}" x2="${W - R}" y1="${y(m).toFixed(1)}" y2="${y(m).toFixed(1)}" class="fv-grid"/>
      <text x="${L - 6}" y="${(y(m) + 4).toFixed(1)}" text-anchor="end" class="fv-axis">${(m / 1000).toFixed(m >= 100000 ? 0 : 1)}k</text>`);
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
  return `<svg class="fv-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Mileage over time, with each service marked and where the next service is due">
      <defs><linearGradient id="fvArea" x1="0" x2="0" y1="0" y2="1"><stop offset="0" class="fv-area-top"/><stop offset="1" class="fv-area-bottom"/></linearGradient></defs>
      ${ticks.join("")}${months.join("")}
      <path d="${area}" fill="url(#fvArea)"/>
      <path d="${line}" class="fv-line"/>
      ${nextDue && nextDue <= y1 ? `<line x1="${L}" x2="${W - R}" y1="${y(nextDue).toFixed(1)}" y2="${y(nextDue).toFixed(1)}" class="fv-due-line" style="${lit(dueColor)}"/>
        <text x="${L + 4}" y="${(y(nextDue) - 5).toFixed(1)}" class="fv-due-label" style="${lit(dueColor)}">Service due ${fvMiles(nextDue)} mi</text>` : ""}
      ${events.map(s => `<g class="fv-event"><circle cx="${x(s.done_on).toFixed(1)}" cy="${y(s.odometer).toFixed(1)}" r="7"/>
        <text x="${x(s.done_on).toFixed(1)}" y="${(y(s.odometer) + 3.5).toFixed(1)}" text-anchor="middle">${esc((FV_SERVICE[s.kind] || "S")[0])}</text>
        <title>${esc(FV_SERVICE[s.kind] || s.kind)}, ${esc(fvDay(s.done_on, true))}, ${fvMiles(s.odometer)} mi</title></g>`).join("")}
    </svg>
    ${t1 - t0 >= 6 * 86400000 ? `<p class="fv-note">About ${fvMiles(Math.round(perWeek))} miles a week.</p>` : ""}`;
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
    return `<div class="card fv-panel" id="fvPanel">
      <h2>This week's check</h2>
      <div class="fields">
        <div><label for="fvcOdo">Odometer (miles)</label><input id="fvcOdo" type="number" min="0" max="2000000" step="1" value="${v.odometer ?? ""}"></div>
        <div><label for="fvcTread">Shallowest tread, 32nds (optional)</label><input id="fvcTread" type="number" min="0" max="32" step="1" placeholder="Not measured"></div>
      </div>
      <label>Tire wear</label><div class="fv-tire-picks">${tires}</div>
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
        <div><label for="fvsReading">${gear ? "Hour meter" : "Odometer (miles)"}</label>
          <input id="fvsReading" type="number" min="0" step="${gear ? "0.1" : "1"}" value="${gear ? gear.hours ?? "" : v.odometer ?? ""}"></div>
        <div><label for="fvsCost">Cost, $ (optional)</label><input id="fvsCost" type="number" min="0" step="0.01"></div>
        <div class="wide"><label for="fvsNotes">Notes</label><textarea id="fvsNotes" rows="2" maxlength="2000"
          placeholder="What was done, where, any parts"></textarea></div>
      </div>
      <p class="note">A routine service restarts the service clock from this ${gear ? "hour reading" : "mileage"} and date.</p>
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
        ${f("fleet_number", "Fleet number (required)", d.fleet_number, 'maxlength="20" autocomplete="off"')}
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
      <p class="note">The fleet number is the one painted on it. No two vehicles on the road share one.${manages ? " It's kept at the driver's location, and they get the Fleet check on their To-Do list every week." : ""}</p>
      <h2>Mileage and service</h2>
      <div class="fields">
        ${f("odometer", "Odometer (miles)", d.odometer, 'type="number" min="0" max="2000000"')}
        ${f("service_every_miles", "Service every (miles)", d.service_every_miles, 'type="number" min="500" max="100000" step="500"')}
        ${f("service_every_months", "Or every (months)", d.service_every_months, 'type="number" min="1" max="36"')}
        ${editing ? "" : `${f("last_on", "Last serviced on", d.last_on, `type="date" max="${fvToday()}"`)}
          ${f("last_miles", "At (miles)", d.last_miles, 'type="number" min="0" max="2000000"')}`}
      </div>
      <p class="note">Service is due at whichever comes first.${editing ? "" : " Leave the last service empty if you don't know it; the clock starts with the first one you log."}</p>
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
  return v ? { id: v.id, kind: v.kind, fleet_number: v.fleet_number, year: v.year ?? "", make: v.make, model: v.model, vin: v.vin,
    plate: v.plate, driver_id: v.driver_id, driver_name: v.driver_name, odometer: v.odometer ?? "",
    service_every_miles: v.service_every_miles, service_every_months: v.service_every_months, tire_condition: v.tire_condition,
    tread_32nds: v.tread_32nds ?? "", notes: v.notes, gear: [] }
    : { id: null, kind: "pickup", fleet_number: "", year: "", make: "", model: "", vin: "", plate: "", driver_id: me ? me.id : null,
      driver_name: "", odometer: "", service_every_miles: 5000, service_every_months: 6, tire_condition: "good", tread_32nds: "",
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
  const odometer = Number($("fvcOdo").value), treadText = $("fvcTread").value;
  const tires = (document.querySelector("input[name=fvcTires]:checked") || {}).value;
  if (!$("fvcOdo").value || !Number.isInteger(odometer) || odometer < 0 || odometer > 2000000) return fvSay("Give the odometer in whole miles.");
  if (!tires) return fvSay("Pick how the tires look.");
  if (v.odometer != null && odometer < v.odometer && !confirm(`That's less than the last reading, ${fvMiles(v.odometer)} mi. Save it anyway?`)) return;
  const tread = treadText === "" ? null : Number(treadText);
  if (tread != null && !(Number.isInteger(tread) && tread >= 0 && tread <= 32)) return fvSay("Tread is a whole number of 32nds, from 0 to 32.");
  button.disabled = true;
  const { error } = await db.from("fleet_checks").insert({ vehicle_id: v.id, odometer, tire_condition: tires, tread_32nds: tread,
    notes: $("fvcNotes").value.trim() });
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
  const gearId = button.dataset.fvGear || null, kind = $("fvsKind").value, reading = $("fvsReading").value;
  const row = { vehicle_id: v.id, equipment_id: gearId, kind, done_on: $("fvsDate").value || fvToday(),
    odometer: !gearId && reading !== "" ? Math.round(Number(reading)) : null,
    hours: gearId && reading !== "" ? Number(reading) : null,
    cost: $("fvsCost").value === "" ? null : Number($("fvsCost").value), notes: $("fvsNotes").value.trim() };
  if (row.done_on > fvToday()) return fvSay("The date can't be in the future.");
  if (kind === "service" && row.odometer == null && row.hours == null) {
    return fvSay(`Give the ${gearId ? "hour meter" : "odometer"} reading: the service clock counts from it.`);
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
  const every = n(d.service_every_miles), months = n(d.service_every_months);
  if (!(every >= 500 && every <= 100000)) return fvSay("Service every 500 to 100,000 miles.");
  if (!(months >= 1 && months <= 36)) return fvSay("Or every 1 to 36 months.");
  const tread = n(d.tread_32nds);
  if (tread != null && !(Number.isInteger(tread) && tread >= 0 && tread <= 32)) return fvSay("Tread is a whole number of 32nds, from 0 to 32.");
  if (!d.id && d.last_on && d.last_miles === "") return fvSay("Give the mileage at the last service too, or leave the date empty.");
  const row = { kind: d.kind, fleet_number: fleetNumber, year, make: String(d.make).trim(), model: String(d.model).trim(),
    vin: String(d.vin).trim(), plate: String(d.plate).trim(), odometer: n(d.odometer), tire_condition: d.tire_condition || null,
    tread_32nds: tread, service_every_miles: every, service_every_months: months, notes: String(d.notes).trim() };
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
        odometer: n(d.last_miles), notes: "Last service before the Fleet Center" }));
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
