// The Fleet Center's maps (Motive, 0165; docs/motive-plan.html)
//
// Where Motive last saw each vehicle: on the Fleet Center for owners and
// location admins (the database gives nobody else a row), on a vehicle's own
// page, and on Admin → Vehicles & Locations, where an owner matches Motive's
// vehicles to the Fleet Center's, adds the rest, puts each at its location
// and places each location on the map. Only the latest report is kept, never
// a trail. The app's FleetMapView.swift shows the same.
//
// The maps are Apple's (MapKit JS), as in the app. Its script loads only when
// a map is first shown, and the map-token function hands it a token that
// lasts half an hour and works only on agri-barn.com. The page's security
// policy lets in cdn.apple-mapkit.com and Apple's map servers for it, and
// nothing else new. The test copy has a stand-in mapkit (stub.js), so nothing
// there reaches Apple.

// What Motive says about each vehicle, as this person may see it: an owner
// every one, an admin those matched to a vehicle at their locations.
let fmRows = [], fmError = null;
// The Fleet Center map: a location's id or "" for all, and the vehicle picked.
let fmPlace = "", fmPicked = null;
// Admin → Vehicles & Locations: Motive's own count and last read, the
// location being placed, which list is open, and a save under way.
let fmaStatus = null, fmaPlacing = null, fmaList = "waiting", fmaBusy = false, fmaLoaded = false, fmaPick = null;

const FM_COLOURS = { parked: "#0F8F86", moving: "#1E9E4A", stale: "#6B757C", picked: "#CC0033", waiting: "#CC0033", site: "#33475B" };
// A colour for each location on the admin map, in their order.
const FM_PALETTE = ["#0F8F86", "#C2410C", "#7C3AED", "#2563EB", "#B45309", "#BE185D", "#15803D", "#475569", "#0E7490", "#9333EA"];

async function fmLoad() {
  if (!(isOwner() || isAdmin())) { fmRows = []; return; }
  const { data, error } = await allRows(() => db.from("motive_vehicles")
    .select("motive_id,number,vin,year,make,model,active,group_names,fleet_vehicle_id,ignored,conflict,lat,lon,located_at,place,speed_mph,heading,odometer,seen_at")
    .order("motive_id"));
  // Before 0165 there's no table: no maps, and nothing to say about it.
  fmError = error && !/does not exist|schema cache/i.test(error.message) ? error.message : null;
  fmRows = error ? [] : data || [];
}

const fmHere = (r) => r && r.lat != null && r.lon != null;
const fmSpot = (v) => fmRows.find(r => r.fleet_vehicle_id === v.id && fmHere(r)) || null;
const fmSeconds = (r) => r && r.located_at ? (Date.now() - new Date(r.located_at)) / 1000 : Infinity;
// Going faster than a walk in a report from the last quarter hour; not heard from in a day.
const fmMoving = (r) => Number(r.speed_mph || 0) >= 3 && fmSeconds(r) < 15 * 60;
const fmStale = (r) => fmSeconds(r) > 24 * 3600;
const fmColour = (r) => fmStale(r) ? FM_COLOURS.stale : fmMoving(r) ? FM_COLOURS.moving : FM_COLOURS.parked;

// "25 min. ago", "3 hr. ago", "3 days ago".
function fmAgo(iso) {
  const s = iso ? (Date.now() - new Date(iso)) / 1000 : NaN;
  if (!Number.isFinite(s)) return "a while ago";
  if (s < 60) return "just now";
  const say = new Intl.RelativeTimeFormat("en", { numeric: "auto", style: "short" });
  if (s < 3600) return say.format(-Math.round(s / 60), "minute");
  if (s < 86400) return say.format(-Math.round(s / 3600), "hour");
  return say.format(-Math.round(s / 86400), "day");
}

// "Moving at 63 mph · 2 min. ago", "Parked · 25 min. ago", "Last seen 3 days ago".
function fmStatus(r) {
  if (fmStale(r)) return `Last seen ${fmAgo(r.located_at)}`;
  if (fmMoving(r)) return `Moving at ${Math.round(Number(r.speed_mph))} mph · ${fmAgo(r.located_at)}`;
  return `Parked · ${fmAgo(r.located_at)}`;
}

const fmDirections = (r) => `https://maps.apple.com/?daddr=${encodeURIComponent(`${r.lat},${r.lon}`)}&dirflg=d`;
const fmSites = () => allLocations.filter(l => l.lat != null && l.lon != null);

// ---- Apple's maps ------------------------------------------------------------------

let fmKit = null, fmKitProblem = "";
// The maps drawn now, by their box's id, so a redraw can let the old ones go.
const fmMaps = {};

function fmMapKit() {
  if (fmKit) return fmKit;
  fmKit = new Promise((resolve, reject) => {
    const ready = () => {
      mapkit.init({
        authorizationCallback: (done) => {
          db.functions.invoke("map-token", { body: {} })
            .then(({ data }) => done((data && data.token) || ""))
            .catch(() => done(""));
        }
      });
      mapkit.addEventListener("error", (event) => {
        fmKitProblem = event && event.status === "Unauthorized"
          ? "The map isn't available to you: only owners and location admins see where vehicles are."
          : "Apple's map didn't load. Try again in a minute.";
        document.querySelectorAll(".fm-map").forEach(b => { b.dataset.problem = fmKitProblem; });
      });
      resolve(window.mapkit);
    };
    if (window.mapkit) return ready();
    const script = document.createElement("script");
    script.src = "https://cdn.apple-mapkit.com/mk/5.x.x/mapkit.js";
    script.crossOrigin = "anonymous";
    script.addEventListener("load", ready);
    script.addEventListener("error", () => { fmKit = null; reject(new Error("Apple's maps couldn't be reached. Check the connection and reload.")); });
    document.head.appendChild(script);
  });
  return fmKit;
}

// After a page draws: maps whose box has gone are let go, and every box
// waiting for one (.fm-map[data-fm]) gets its map, drawn by what it says.
async function fmMount() {
  Object.entries(fmMaps).forEach(([id, m]) => {
    if (!m.box.isConnected) { try { m.map.destroy(); } catch { /* already gone */ } delete fmMaps[id]; }
  });
  const waiting = () => [...document.querySelectorAll(".fm-map[data-fm]")]
    .filter(b => !fmMaps[b.id] && b.offsetParent !== null);
  if (!waiting().length) return;
  let kit;
  try { kit = await fmMapKit(); } catch (e) { waiting().forEach(b => { b.dataset.problem = e.message; }); return; }
  for (const box of waiting()) {
    if (fmKitProblem) box.dataset.problem = fmKitProblem;
    const map = new kit.Map(box, {
      showsMapTypeControl: false, isRotationEnabled: false, showsCompass: kit.FeatureVisibility.Hidden,
      pointOfInterestFilter: kit.PointOfInterestFilter && kit.PointOfInterestFilter.excludingAllCategories
    });
    fmMaps[box.id] = { box, map };
    ({ fleet: fmDrawFleet, one: fmDrawOne, admin: fmaDraw })[box.dataset.fm](map, box);
  }
}

const fmPad = () => new mapkit.Padding(48, 48, 48, 48);
const fmCoordinate = (r) => new mapkit.Coordinate(Number(r.lat), Number(r.lon));

// A vehicle's marker: its fleet number on the balloon when it fits, and under it.
function fmMarker(r, v, colour) {
  const number = v ? v.fleet_number : r.number;
  return new mapkit.MarkerAnnotation(fmCoordinate(r), {
    color: colour, glyphText: String(number || "").length <= 3 ? String(number || "") : "",
    title: `#${number || "?"}`, subtitle: fmStatus(r), clusteringIdentifier: v ? `loc:${v.location_id || ""}` : "waiting",
    calloutEnabled: false, data: { fleet: v ? v.id : null, motive: r.motive_id }
  });
}

// A location, under its vehicles: its name over a round badge, the badge's
// middle on the spot (MapKit puts an element's bottom middle there; the
// offset moves it down half the badge).
function fmSiteAnnotation(l) {
  return new mapkit.Annotation(new mapkit.Coordinate(Number(l.lat), Number(l.lon)), () => {
    const e = document.createElement("span");
    e.className = "fm-site";
    e.innerHTML = `<small>${esc(l.name)}</small>${icon("building", 13)}`;
    return e;
  }, { title: l.name, calloutEnabled: false, displayPriority: 250, anchorOffset: new DOMPoint(0, 14), data: { site: l.id } });
}

// ---- the Fleet Center: where they are -----------------------------------------------------

// The vehicles in service that Motive has put on the map, at the place chosen.
function fmPins() {
  return fvActive().map(v => ({ v, r: fmSpot(v) })).filter(p => p.r && (!fmPlace || p.v.location_id === fmPlace));
}

function fmFleetHtml() {
  if (!(isOwner() || isAdmin())) return "";
  const all = fvActive().filter(v => fmSpot(v));
  if (!all.length) return "";
  const places = [...new Set(all.map(v => v.location_id).filter(Boolean))]
    .sort((a, b) => (locations[a] || "").localeCompare(locations[b] || ""));
  if (fmPlace && !places.includes(fmPlace)) fmPlace = "";
  return `<h2 class="group-title">Where they are</h2>
    <div class="cm-card fm-card">
      <div id="fmPills">${fmPillsHtml(places, all)}</div>
      <div class="fm-map" id="fmFleetMap" data-fm="fleet" role="region" aria-label="Map of where Motive last saw each vehicle"></div>
      <div id="fmPicked">${fmPickedHtml()}</div>
    </div>`;
}

function fmPillsHtml(places, all) {
  if (places.length < 2) return "";
  const pill = (id, label, n) => `<button type="button" class="${fmPlace === id ? "on" : ""}" data-fm-place="${esc(id)}"
    aria-pressed="${fmPlace === id}">${esc(label)} · ${n}</button>`;
  return `<div class="cm-kind fm-pills" role="group" aria-label="Which location">${pill("", "All", all.length)}${
    places.map(id => pill(id, locations[id] || "No location", all.filter(v => v.location_id === id).length)).join("")}</div>`;
}

function fmPickedHtml() {
  const v = fmPicked && fvVehicle(fmPicked), r = v && fmSpot(v);
  if (v && r) {
    return `<div class="fm-picked">
      <div class="fv-card-top">
        <span class="fv-glyph">${icon("fleet", 22)}</span>
        <span class="fv-who"><b>${esc(fvNumber(v))}</b>${fvNickHtml(v)}
          <span>${esc([fvDescription(v) || FV_KINDS[v.kind], v.driver_name || "No driver", locations[v.location_id]].filter(Boolean).join(" · "))}</span></span>
      </div>
      ${fmWhereLines(r)}
      <div class="fv-actions">
        <button type="button" class="fv-go" data-fv-open="${esc(v.id)}">${icon("fleet", 17)}Open vehicle</button>
        <a class="fv-go quiet" href="${fmDirections(r)}" target="_blank" rel="noopener">${icon("map", 17)}Directions</a>
      </div>
    </div>`;
  }
  const pins = fmPins(), moving = pins.filter(p => fmMoving(p.r)).length, stale = pins.filter(p => fmStale(p.r)).length;
  const shown = new Set(fvActive().filter(v => fmSpot(v)).map(v => v.location_id));
  const unplaced = fvActive().filter(v => !fmSpot(v) && v.location_id && (fmPlace ? v.location_id === fmPlace : shown.has(v.location_id)));
  return `<div class="fm-summary">
    <p><b>${pins.length} on the map</b>${moving ? ` <span class="cab-tag" style="${lit("green")}">${moving} moving</span>` : ""}${
      stale ? ` <span class="cab-tag">${stale} not seen today</span>` : ""}</p>
    <small>Where Motive last saw each one, every few minutes. Click a vehicle for more.</small>
    ${unplaced.length ? `<small>No location from Motive: ${esc(unplaced.map(v => `#${v.fleet_number}`).join(", "))}</small>` : ""}
  </div>`;
}

// Where and when: "Filer, ID", then "Parked · 25 min. ago".
const fmWhereLines = (r) => `<p class="fm-where">${icon("map", 16)}<span><b>${esc(r.place || "Somewhere Motive doesn't name")}</b>
  <small style="${lit(fmStale(r) ? "steel" : fmMoving(r) ? "green" : "teal")}">${esc(fmStatus(r))}</small></span></p>`;

function fmDrawFleet(map) {
  map.removeAnnotations(map.annotations);
  const pins = fmPins();
  const ids = new Set(pins.map(p => p.v.location_id));
  const sites = fmSites().filter(l => ids.has(l.id)).map(fmSiteAnnotation);
  const markers = pins.map(p => fmMarker(p.r, p.v, p.v.id === fmPicked ? FM_COLOURS.picked : fmColour(p.r)));
  map.addAnnotations([...sites, ...markers]);
  if (markers.length || sites.length) map.showItems([...markers, ...sites], { animate: true, padding: fmPad(), minimumSpan: new mapkit.CoordinateSpan(0.03, 0.03) });
  if (map.fmWired) return;
  map.fmWired = true;
  map.addEventListener("select", (event) => {
    const a = event.annotation;
    if (a.memberAnnotations) return map.showItems(a.memberAnnotations, { animate: true, padding: fmPad(), minimumSpan: new mapkit.CoordinateSpan(0.02, 0.02) });
    if (!a.data || !a.data.fleet) return;
    fmPicked = a.data.fleet;
    $("fmPicked").innerHTML = fmPickedHtml();
  });
  map.addEventListener("deselect", () => {
    fmPicked = null;
    if ($("fmPicked")) $("fmPicked").innerHTML = fmPickedHtml();
  });
}

// ---- a vehicle's page: where it is ----------------------------------------------------------

function fmWhereHtml(v) {
  const r = (isOwner() || isAdmin()) && fmSpot(v);
  if (!r) return "";
  return `<div class="cm-card fm-card" style="${lit(fmMoving(r) ? "green" : "teal")}">
    <p class="cm-eyebrow">${icon("map", 15)}Where it is <span class="fm-from">from Motive</span></p>
    <div class="fm-map small" id="fmOneMap" data-fm="one" data-vehicle="${esc(v.id)}" role="region" aria-label="Map of where ${esc(fvName(v))} is"></div>
    ${fmWhereLines(r)}
    <div class="fv-actions">
      <button type="button" class="fv-go quiet" data-fm-show="${esc(v.id)}">${icon("map", 17)}On the Fleet Center map</button>
      <a class="fv-go quiet" href="${fmDirections(r)}" target="_blank" rel="noopener">${icon("map", 17)}Directions</a>
    </div>
  </div>`;
}

function fmDrawOne(map, box) {
  const v = fvVehicle(box.dataset.vehicle), r = v && fmSpot(v);
  if (!r) return;
  const marker = fmMarker(r, v, fmColour(r));
  map.addAnnotation(marker);
  map.showItems([marker], { animate: false, padding: fmPad(), minimumSpan: new mapkit.CoordinateSpan(0.025, 0.025) });
}

$("view").addEventListener("click", (event) => {
  const place = event.target.closest("[data-fm-place]");
  if (place) {
    fmPlace = place.dataset.fmPlace;
    fmPicked = null;
    const all = fvActive().filter(v => fmSpot(v));
    $("fmPills").innerHTML = fmPillsHtml([...new Set(all.map(v => v.location_id).filter(Boolean))]
      .sort((a, b) => (locations[a] || "").localeCompare(locations[b] || "")), all);
    $("fmPicked").innerHTML = fmPickedHtml();
    const m = fmMaps.fmFleetMap;
    if (m) fmDrawFleet(m.map);
    return;
  }
  const show = event.target.closest("[data-fm-show]");
  if (show) { fmPicked = show.dataset.fmShow; fmPlace = ""; showView("fleet"); }
});

// ---- Admin → Vehicles & Locations (owners) --------------------------------------------------

// Where a Motive vehicle probably belongs: the location its Motive group is
// named for, else the location nearest where it's parked (within 40 miles).
function fmaSuggest(r) {
  for (const group of r.group_names || []) {
    const id = storeLocation(group);
    if (id) return { id, why: `its Motive group, ${group}` };
  }
  if (!fmHere(r)) return null;
  const miles = (l) => {
    const rad = Math.PI / 180, dLat = (l.lat - r.lat) * rad, dLon = (l.lon - r.lon) * rad;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(r.lat * rad) * Math.cos(l.lat * rad) * Math.sin(dLon / 2) ** 2;
    return 7918 * Math.asin(Math.sqrt(a));
  };
  const nearest = fmSites().filter(l => l.is_active !== false).map(l => ({ l, d: miles(l) })).sort((a, b) => a.d - b.d)[0];
  return nearest && nearest.d <= 40 ? { id: nearest.l.id, why: nearest.d < 1 ? "parked there" : `nearest, ${Math.round(nearest.d)} mi` } : null;
}

const fmaColourOf = (locationId) => {
  const order = allLocations.filter(l => l.is_active !== false).map(l => l.id);
  const at = order.indexOf(locationId);
  return at < 0 ? FM_COLOURS.stale : FM_PALETTE[at % FM_PALETTE.length];
};

async function fmaLoad() {
  const [, , status] = await Promise.all([loadFleet(), fmLoad(), db.rpc("motive_status")]);
  fmaStatus = status && !status.error ? status.data : null;
  fmaLoaded = true;
}

function fmaShowing() {
  const tab = $("tab-vehiclemap");
  return tab && !tab.classList.contains("hidden") && !$("admin").classList.contains("hidden");
}

function renderVehicleMapAdmin() {
  const box = $("vehicleMapAdmin");
  if (!box) return;
  if (!fmaLoaded) {
    box.innerHTML = `<div class="card"><p class="note">Loading…</p></div>`;
    fmaLoad().then(renderVehicleMapAdmin).catch(e => { box.innerHTML = `<div class="card"><p class="error">${esc(e.message)}</p></div>`; });
    return;
  }
  const connected = !!(company && company.motive_company);
  const rows = fmRows.filter(r => r.active !== false);
  const waiting = rows.filter(r => !r.fleet_vehicle_id && !r.ignored);
  const matched = rows.filter(r => r.fleet_vehicle_id);
  const ignored = rows.filter(r => r.ignored);
  const places = allLocations.filter(l => l.is_active !== false);
  const placed = places.filter(l => l.lat != null && l.lon != null);
  const taken = new Set(fmRows.map(r => r.fleet_vehicle_id).filter(Boolean));
  const free = fvActive().filter(v => !taken.has(v.id) && v.kind !== "forklift")
    .sort((a, b) => String(a.fleet_number).localeCompare(String(b.fleet_number), undefined, { numeric: true }));
  const tile = (id, label, n, sub, colour, hot) => cabTile(label, sxNum(n), sub, { colour, data: `data-fma-list="${id}"`, on: fmaList === id, hot });
  const lastRead = fmaStatus && fmaStatus.synced_at ? `Last read from Motive ${fmAgo(fmaStatus.synced_at)}.` : "";
  const locOptions = (selected, blank) => `${blank ? `<option value="">${esc(blank)}</option>` : ""}${places.map(l =>
    `<option value="${esc(l.id)}"${l.id === selected ? " selected" : ""}>${esc(l.name)}</option>`).join("")}`;
  const seen = (r) => fmHere(r) ? `<td><b>${esc(r.place || "–")}</b><small>${esc(fmStatus(r))}</small></td>` : `<td><small>No location from Motive</small></td>`;
  const what = (r) => `<td><b>#${esc(r.number || "?")}</b><small>${esc([r.year, r.make, r.model].filter(Boolean).join(" ") || "–")}${r.vin ? ` · ${esc(r.vin)}` : ""}</small>${
    r.conflict ? `<small class="fma-bad">${esc(r.conflict)}</small>` : ""}</td>`;
  const list = { waiting, matched, ignored }[fmaList] || waiting;

  box.innerHTML = `<div class="sx cab-admin fma" style="${lit("teal")}">
    <section class="sx-hero">
      <div class="sx-hero-text">
        <span class="sx-kicker">Fleet · Vehicles &amp; Locations</span>
        <h2>Every vehicle at its location</h2>
        <p>Motive's vehicles match the Fleet Center's by fleet number, by themselves. Link, add or ignore the ones that don't,
          put each at the location it works from, and place each location on the map. A vehicle's location decides whose admins see it
          and do its weekly check when nobody drives it.</p>
        ${connected ? "" : `<p><b>Motive isn't connected.</b> ${rows.length ? "What it last said is below; nothing updates until it's connected again." : ""}
          Connect it on <button type="button" class="pdf" data-fma-company>Company</button>.</p>`}
        ${fmaStatus && fmaStatus.problem ? `<p class="error">${esc(fmaStatus.problem)}</p>` : ""}
        ${fmError ? `<p class="error">Motive's vehicles couldn't be read: ${esc(fmError)}</p>` : ""}
        ${lastRead ? `<p class="note">${esc(lastRead)}</p>` : ""}
      </div>
    </section>
    <div class="sx-tiles" style="--n:4">
      ${tile("waiting", "Waiting", waiting.length, waiting.length ? "Link, add or ignore" : "Every one is sorted", waiting.length ? "amber" : "green", waiting.length > 0)}
      ${tile("matched", "In the Fleet Center", matched.length, "Matched to a vehicle", "teal")}
      ${tile("ignored", "Ignored", ignored.length, "Sold, trailers and the like", "steel")}
      ${cabTile("Locations placed", `${placed.length}/${places.length}`, placed.length < places.length ? "Place the rest on the map" : "Every one is on the map",
        { colour: placed.length < places.length ? "amber" : "green" })}
    </div>
    <section class="sx-panel" style="${lit("teal")}">
      <header><h3>The map</h3><span>${rows.filter(fmHere).length} with a location</span></header>
      ${fmaPlacing ? `<p class="fma-placing">${icon("map", 16)}Click the map where <b>${esc(locations[fmaPlacing] || "it")}</b> is.
        <button type="button" class="pdf" data-fma-cancel>Cancel</button></p>` : ""}
      <div class="fm-map big${fmaPlacing ? " placing" : ""}" id="fmaMap" data-fm="admin" role="region" aria-label="Map of every Motive vehicle and location"></div>
      <div id="fmaPicked" class="fma-picked">${fmaPickedHtml()}</div>
      <div class="fma-legend">${places.map(l => `<span><i style="background:${fmaColourOf(l.id)}"></i>${esc(l.name)}</span>`).join("")}
        <span><i style="background:${FM_COLOURS.waiting}"></i>Not in the Fleet Center</span></div>
      <span class="msg" role="status"></span>
    </section>
    <section class="sx-panel" style="${lit("slate")}">
      <header><h3>Locations on the map</h3><span>${placed.length} of ${places.length}</span></header>
      <div class="fma-sites">${places.map(l => `<div><b>${esc(l.name)}</b>${l.lat != null && l.lon != null
        ? `<small>Placed</small><button type="button" class="pdf" data-fma-place="${esc(l.id)}">Move it</button>`
        : `<small class="fma-bad">Not placed</small><button type="button" class="pdf" data-fma-place="${esc(l.id)}">Place it</button>`}</div>`).join("")}</div>
      <p class="note">A location's spot is used to suggest where a vehicle belongs (the nearest one), and shows on every map.</p>
    </section>
    <section class="sx-panel" style="${lit(fmaList === "waiting" ? "amber" : fmaList === "ignored" ? "steel" : "teal")}">
      <header><h3>${{ waiting: "Waiting", matched: "In the Fleet Center", ignored: "Ignored" }[fmaList]}</h3><span>${list.length}</span></header>
      ${fmaList === "waiting" && waiting.length ? `<div class="fma-all">
        <span>Add all ${waiting.length} to the Fleet Center: each at its suggested location, the rest at</span>
        <select id="fmaAllAt" aria-label="Where the ones with no suggestion go">${locOptions("", "Choose a location")}</select>
        <span>as</span><select id="fmaAllKind" aria-label="What they are"><option value="pickup">Pickups</option><option value="service_truck">Service trucks</option></select>
        <button type="button" data-fma-all ${fmaBusy ? "disabled" : ""}>Add all</button>
        <small>Motive doesn't say pickup or service truck; change any after. Nobody drives them until someone's assigned in the Fleet Center.</small>
      </div>` : ""}
      ${!list.length ? `<p class="sx-empty">${{ waiting: "Nothing's waiting: every Motive vehicle is matched or ignored.",
        matched: "None matched yet.", ignored: "None ignored." }[fmaList]}</p>` : `
      <div class="lc-scroll"><table class="lc-table fma-table">
        <thead><tr><th>Motive</th><th>Last seen</th>${fmaList === "matched" ? "<th>Fleet Center</th><th>Location</th><th></th>"
          : fmaList === "waiting" ? "<th>Link to a Fleet Center vehicle</th><th>Or add it</th><th></th>" : "<th></th>"}</tr></thead>
        <tbody>${list.map(r => {
          const id = esc(String(r.motive_id));
          if (fmaList === "matched") {
            const v = fvVehicle(r.fleet_vehicle_id), hint = fmaSuggest(r);
            return `<tr>${what(r)}${seen(r)}
              <td>${v ? `<b>${esc(fvName(v))}</b><small>${esc(fvDescription(v) || FV_KINDS[v.kind] || "")}</small>` : "<small>Retired or deleted</small>"}</td>
              <td>${v ? `<select data-fma-move="${esc(v.id)}" aria-label="Where ${esc(fvName(v))} works from" ${fmaBusy ? "disabled" : ""}>${locOptions(v.location_id, "No location")}</select>
                ${hint && hint.id !== v.location_id ? `<small>Suggested: ${esc(locations[hint.id] || hint.id)} (${esc(hint.why)})</small>` : ""}` : ""}</td>
              <td class="pl-do"><button type="button" class="pdf" data-fma-unlink="${id}" ${fmaBusy ? "disabled" : ""}>Unlink</button></td></tr>`;
          }
          if (fmaList === "waiting") {
            const hint = fmaSuggest(r);
            return `<tr>${what(r)}${seen(r)}
              <td>${free.length ? `<select data-fma-link="${id}" aria-label="Link Motive #${esc(r.number)} to" ${fmaBusy ? "disabled" : ""}>
                <option value="">Choose a vehicle</option>${free.map(v => `<option value="${esc(v.id)}">${esc(fvName(v))}${
                  locations[v.location_id] ? ` · ${esc(locations[v.location_id])}` : ""}</option>`).join("")}</select>` : "<small>No unmatched Fleet Center vehicle</small>"}</td>
              <td><span class="fma-add"><select data-fma-at="${id}" aria-label="Where it works from">${locOptions(hint && hint.id, "Choose a location")}</select>
                <select data-fma-kind="${id}" aria-label="What it is"><option value="pickup">Pickup</option><option value="service_truck">Service truck</option></select>
                <button type="button" class="pdf" data-fma-add="${id}" ${fmaBusy ? "disabled" : ""}>Add</button></span>
                ${hint ? `<small>Suggested: ${esc(hint.why)}</small>` : ""}</td>
              <td class="pl-do"><button type="button" class="pdf" data-fma-ignore="${id}" ${fmaBusy ? "disabled" : ""}>Ignore</button></td></tr>`;
          }
          return `<tr>${what(r)}${seen(r)}<td class="pl-do"><button type="button" class="pdf" data-fma-unignore="${id}" ${fmaBusy ? "disabled" : ""}>Bring it back</button></td></tr>`;
        }).join("")}</tbody>
      </table></div>`}
    </section>
    <section class="sx-panel" style="${lit("steel")}">
      <header><h3>How it works</h3></header>
      <dl class="cab-rules">
        <div><dt>Matching</dt><dd>A Motive vehicle's number is matched to a fleet number, ignoring case, a # and leading zeros, every few
          minutes. Where both have a VIN and they differ, it waits here instead.</dd></div>
        <div><dt>Mileage</dt><dd>A matched vehicle's mileage comes from Motive, and is never lowered. Forklifts keep their own hour meter.</dd></div>
        <div><dt>Who sees where</dt><dd>Owners see every vehicle; a location's admins see the vehicles at their locations. Nobody else does.
          Only the latest location is kept.</dd></div>
        <div><dt>Drivers</dt><dd>Stay the Fleet Center's own: Motive's driver isn't used. A vehicle nobody drives is looked after by its
          location's admins.</dd></div>
      </dl>
    </section>
  </div>`;
  if (fmaShowing()) fmMount();
}

function fmaPickedHtml() {
  const r = fmaPick != null && fmRows.find(x => x.motive_id === fmaPick);
  if (!r) return `<small>Click a vehicle for which it is.</small>`;
  const v = r.fleet_vehicle_id && fvVehicle(r.fleet_vehicle_id);
  return `<b>Motive #${esc(r.number || "?")}</b> · ${v ? `${esc(fvName(v))} · ${esc(locations[v.location_id] || "No location")}` : "not in the Fleet Center"}
    · ${esc(r.place || "")} · ${esc(fmStatus(r))}`;
}

function fmaDraw(map) {
  const markers = fmRows.filter(r => fmHere(r) && !r.ignored && r.active !== false).map(r => {
    const v = r.fleet_vehicle_id && fvVehicle(r.fleet_vehicle_id);
    return fmMarker(r, v || null, v ? fmaColourOf(v.location_id) : FM_COLOURS.waiting);
  });
  const sites = fmSites().filter(l => l.is_active !== false).map(fmSiteAnnotation);
  map.addAnnotations([...sites, ...markers]);
  if (markers.length || sites.length) map.showItems([...markers, ...sites], { animate: false, padding: fmPad(), minimumSpan: new mapkit.CoordinateSpan(0.05, 0.05) });
  map.addEventListener("select", (event) => {
    const a = event.annotation;
    if (a.memberAnnotations) return map.showItems(a.memberAnnotations, { animate: true, padding: fmPad(), minimumSpan: new mapkit.CoordinateSpan(0.02, 0.02) });
    if (!a.data || a.data.motive == null) return;
    fmaPick = a.data.motive;
    $("fmaPicked").innerHTML = fmaPickedHtml();
  });
  map.addEventListener("single-tap", async (event) => {
    if (!fmaPlacing) return;
    const at = map.convertPointOnPageToCoordinate(event.pointOnPage);
    const id = fmaPlacing;
    fmaPlacing = null;
    await fmaDo(() => db.from("locations").update({ lat: at.latitude, lon: at.longitude }).eq("id", id).select("id"),
      `${locations[id] || "It"} is on the map.`, async () => { const l = allLocations.find(x => x.id === id); if (l) Object.assign(l, { lat: at.latitude, lon: at.longitude }); });
  });
}

// A change, then everything read again and drawn, saying how it went (said
// may be a function, for words that depend on what the change did).
async function fmaDo(work, said, after) {
  fmaBusy = true;
  renderVehicleMapAdmin();
  let problem = null;
  try {
    const result = await work();
    if (result && result.error) problem = result.error.message;
    else if (result && Array.isArray(result.data) && !result.data.length) problem = "Not saved: only an owner can change that.";
    else if (after) await after(result);
  } catch (e) { problem = e.message; }
  await Promise.all([loadFleet(), fmLoad()]);
  fmaBusy = false;
  renderVehicleMapAdmin();
  const msg = document.querySelector("#vehicleMapAdmin .msg");
  if (msg) speak(msg.parentElement, problem || (typeof said === "function" ? said() : said), !!problem);
}

// The map is drawn once its tab is open: a map drawn in a hidden box has no size.
document.addEventListener("click", (event) => {
  if (event.target.closest('#adminNav [data-tab="vehiclemap"]')) setTimeout(fmMount);
});

$("admin").addEventListener("click", async (event) => {
  const b = event.target.closest("[data-fma-list], [data-fma-place], [data-fma-cancel], [data-fma-add], [data-fma-ignore], [data-fma-unignore], "
    + "[data-fma-unlink], [data-fma-all], [data-fma-company]");
  if (!b) return;
  const d = b.dataset;
  if (d.fmaCompany !== undefined) { const go = document.querySelector('#adminNav [data-tab="company"]'); if (go) go.click(); return; }
  if (d.fmaList) { fmaList = d.fmaList; return renderVehicleMapAdmin(); }
  if (d.fmaPlace) { fmaPlacing = d.fmaPlace; renderVehicleMapAdmin(); const m = $("fmaMap"); if (m) m.scrollIntoView({ behavior: "smooth", block: "center" }); return; }
  if (d.fmaCancel !== undefined) { fmaPlacing = null; return renderVehicleMapAdmin(); }
  const motive = (key) => Number(d[key]);
  const row = (key) => fmRows.find(r => r.motive_id === motive(key)) || {};
  if (d.fmaAdd) {
    const at = document.querySelector(`[data-fma-at="${CSS.escape(d.fmaAdd)}"]`).value;
    const kind = document.querySelector(`[data-fma-kind="${CSS.escape(d.fmaAdd)}"]`).value;
    if (!at) return speak(b.closest("td"), "Choose where it works from first.", true);
    return fmaDo(() => db.rpc("motive_add", { motives: [motive("fmaAdd")], location: at, vehicle_kind: kind }),
      `#${row("fmaAdd").number} is in the Fleet Center at ${locations[at]}.`);
  }
  if (d.fmaIgnore) return fmaDo(() => db.rpc("motive_ignore", { motive: motive("fmaIgnore"), ignore: true }), `#${row("fmaIgnore").number} is ignored.`);
  if (d.fmaUnignore) return fmaDo(() => db.rpc("motive_ignore", { motive: motive("fmaUnignore"), ignore: false }), `#${row("fmaUnignore").number} is back, waiting.`);
  if (d.fmaUnlink) {
    if (!confirm(`Unlink Motive #${row("fmaUnlink").number}? The Fleet Center vehicle stays, with its mileage; it just stops hearing from Motive.`)) return;
    return fmaDo(() => db.rpc("motive_link", { motive: motive("fmaUnlink"), vehicle: null }), "Unlinked. It's waiting again.");
  }
  if (d.fmaAll !== undefined) {
    const fallback = $("fmaAllAt").value, kind = $("fmaAllKind").value;
    const groups = {};
    const left = [];
    fmRows.filter(r => r.active !== false && !r.fleet_vehicle_id && !r.ignored).forEach(r => {
      const at = (fmaSuggest(r) || {}).id || fallback;
      if (at) (groups[at] = groups[at] || []).push(r.motive_id); else left.push(r.number);
    });
    if (!Object.keys(groups).length) return speak(b.closest(".fma-all"), "Choose where the ones with no suggestion go.", true);
    let added = 0;
    return fmaDo(async () => {
      for (const [at, motives] of Object.entries(groups)) {
        const { data, error } = await db.rpc("motive_add", { motives, location: at, vehicle_kind: kind });
        if (error) return { error };
        added += Number(data || 0);
      }
      return { data: null, error: null };
    }, () => `Added ${added}.${left.length ? ` ${left.length} had no suggestion: choose a location for them.` : ""}`);
  }
});

$("admin").addEventListener("change", async (event) => {
  const t = event.target;
  if (t.dataset.fmaLink) {
    if (!t.value) return;
    const v = fvVehicle(t.value), r = fmRows.find(x => x.motive_id === Number(t.dataset.fmaLink)) || {};
    return fmaDo(() => db.rpc("motive_link", { motive: Number(t.dataset.fmaLink), vehicle: t.value }),
      `Motive #${r.number} is ${v ? fvName(v) : "linked"}. Its mileage and location come from Motive now.`);
  }
  if (t.dataset.fmaMove) {
    const v = fvVehicle(t.dataset.fmaMove);
    return fmaDo(() => db.from("fleet_vehicles").update({ location_id: t.value || null }).eq("id", t.dataset.fmaMove).select("id"),
      `${v ? fvName(v) : "It"} is at ${locations[t.value] || "no location"} now.`);
  }
});
