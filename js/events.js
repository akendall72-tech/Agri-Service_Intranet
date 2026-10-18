// Events
//
// The Event Center for everyone (with Who's going), and the admin tab for
// adding and changing events.

// ---------------------------------------------------------------- events
//
// Every event records the moment it starts and the time zone of its venue,
// because the company straddles Mountain and Pacific — and not along state
// lines. The form is filled in as the venue's wall clock ("8:00 AM in Twin
// Falls"), and converted here to the instant the database stores, whatever
// zone this computer happens to be in. See migration 0028.

const EVENT_CATEGORIES = [
  ["company", "Company"],
  ["training", "Training"],
  ["customer", "Customer"],
  ["safety", "Safety"],
  ["holiday", "Holiday"]
];

const EVENT_ZONES = [
  ["America/Boise", "Mountain (Idaho, Ontario)"],
  ["America/Los_Angeles", "Pacific (Washington)"],
  ["America/Chicago", "Central"],
  ["America/New_York", "Eastern"]
];

// Which clock each location keeps, so picking the hosting location sets the zone.
// Ontario is in Oregon but runs on Mountain time. Locations now carry their own
// time zone (migration 0029); this is the fallback until that's been run.
const SHOP_ZONES = {
  "moses-lake": "America/Los_Angeles", "pasco": "America/Los_Angeles",
  "walla-walla": "America/Los_Angeles", "pullman": "America/Los_Angeles",
  "marsing": "America/Boise", "twin-falls": "America/Boise",
  "heyburn": "America/Boise", "blackfoot": "America/Boise",
  "sugar-city": "America/Boise", "ontario": "America/Boise"
};

// How far `zone` is ahead of UTC at a given instant, in minutes.
function zoneOffset(ms, zone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: zone, hourCycle: "h23", year: "numeric", month: "2-digit",
    day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit"
  }).formatToParts(new Date(ms)).map(p => [p.type, p.value]));
  const asUTC = Date.UTC(+parts.year, +parts.month - 1, +parts.day,
                         +parts.hour, +parts.minute, +parts.second);
  return Math.round((asUTC - ms) / 60000);
}

// "2026-09-15T08:00" on the venue's clock -> ISO instant. Two passes, so a
// time on the day the clocks change still lands on the right hour.
function wallToISO(wall, zone) {
  const [date, time = "00:00"] = wall.split("T");
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  let ms = guess - zoneOffset(guess, zone) * 60000;
  ms = guess - zoneOffset(ms, zone) * 60000;
  return new Date(ms).toISOString();
}

// ISO instant -> "2026-09-15T08:00" on the venue's clock.
function isoToWall(iso, zone) {
  const ms = new Date(iso).getTime();
  const t = new Date(ms + zoneOffset(ms, zone) * 60000);
  return `${t.getUTCFullYear()}-${pad2(t.getUTCMonth() + 1)}-${pad2(t.getUTCDate())}` +
         `T${pad2(t.getUTCHours())}:${pad2(t.getUTCMinutes())}`;
}

const eventEnd = (e) => e.ends_at ||
  (e.all_day ? e.starts_at : new Date(new Date(e.starts_at).getTime() + 3600000).toISOString());

// Over once the day it ends on is over, so this morning's meeting is still
// "upcoming" this afternoon — the same rule the app uses.
function eventIsPast(e) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  if (e.all_day) {
    const last = isoToWall(eventEnd(e), e.timezone).slice(0, 10);
    return last < `${today.getFullYear()}-${pad2(today.getMonth() + 1)}-${pad2(today.getDate())}`;
  }
  return new Date(eventEnd(e)) < today;
}

// "Tue, Sep 15 · 8:00 AM – 4:30 PM MDT", on the venue's clock.
function eventWhen(e) {
  const zone = e.timezone || "America/Boise";
  if (e.all_day) {
    const first = isoToWall(e.starts_at, zone).slice(0, 10);
    const last = isoToWall(eventEnd(e), zone).slice(0, 10);
    const fmt = (ymd) => dateOnly(ymd).toLocaleDateString("en-US",
      { weekday: "short", month: "short", day: "numeric" });
    return first === last ? `${fmt(first)} · All day` : `${fmt(first)} – ${fmt(last)} · All day`;
  }
  const day = new Date(e.starts_at).toLocaleDateString("en-US",
    { timeZone: zone, weekday: "short", month: "short", day: "numeric" });
  const time = (iso, withZone) => new Date(iso).toLocaleTimeString("en-US",
    { timeZone: zone, hour: "numeric", minute: "2-digit",
      ...(withZone ? { timeZoneName: "short" } : {}) });
  return `${day} · ${time(e.starts_at)} – ${time(eventEnd(e), true)}`;
}

let editingEventId = null;
let eventFilter = "upcoming";

function renderEvents() {
  const editor = $("eventEditor");
  if (!editor) return;

  // Fill the fixed choices once; the form keeps its values between renders.
  const cat = editor.querySelector('[data-e="category"]');
  if (!cat.options.length) {
    cat.innerHTML = EVENT_CATEGORIES.map(([v, l]) =>
      `<option value="${v}">${l}</option>`).join("");
    editor.querySelector('[data-e="timezone"]').innerHTML = EVENT_ZONES.map(([v, l]) =>
      `<option value="${v}">${l}</option>`).join("");
  }

  // Refilled every time, so a location added on the Groups & Locations tab is here
  // without a reload. Switched-off locations are left out unless already chosen.
  const shopSelect = editor.querySelector('[data-e="location_id"]');
  const chosenShop = shopSelect.value;
  shopSelect.innerHTML = `<option value="">Not at a location</option>` +
    allLocations.filter(l => l.is_active !== false || l.id === chosenShop)
      .map(l => `<option value="${esc(l.id)}">${esc(l.name)}</option>`).join("");
  shopSelect.value = chosenShop;

  const box = $("eventList");
  if (eventsError) {
    box.innerHTML = `<p class="error">Events couldn't be loaded (${esc(eventsError)}).
      If that says the table doesn't exist, run migration 0028_events.sql in the
      SQL editor, then reload this page.</p>`;
    return;
  }

  document.querySelectorAll("[data-event-filter]").forEach(b =>
    b.classList.toggle("on", b.dataset.eventFilter === eventFilter));

  const list = companyEvents
    .filter(e => (eventFilter === "past") === eventIsPast(e))
    .sort((a, b) => (eventFilter === "past" ? -1 : 1) *
      (new Date(a.starts_at) - new Date(b.starts_at)));

  if (!list.length) {
    box.innerHTML = `<p class="note">${eventFilter === "past"
      ? "Nothing in the past yet." : "Nothing coming up. Add one above."}</p>`;
    return;
  }

  box.innerHTML = list.map(e => `
    <div class="role" style="padding:14px 16px${e.is_published ? "" : ";opacity:.65"}"
         data-event="${esc(e.id)}">
      <div class="row" style="align-items:flex-start">
        <span class="evdot ev-${esc(e.category)}"></span>
        <div style="flex:1;min-width:220px">
          <b style="font-size:16px">${esc(e.title)}</b>
          ${e.is_published ? "" : ` <span class="badge b-none">Draft — not showing</span>`}
          <div class="note">${esc(eventWhen(e))}</div>
          ${eventOnlineLabel(e)
            ? `<div class="note" style="color:var(--slate,#2F5D7C);font-weight:600">${esc(
                eventOnlineLabel(e))}${e.meeting_url ? "" : " — link not added yet"}</div>`
            : e.location_name || e.address ? `<div class="note">${esc(
              [e.location_name, e.address].filter(Boolean).join(" · "))}</div>` : ""}
          ${eventTakesSignups(e) ? `<div class="note">${e.enrollment === "open" ? "Open enrollment" : "Private enrollment"}
            · ${eventGoing(e).length} on the list ·
            <button type="button" class="linkish" data-view="event" data-event="${esc(e.id)}">Open Who's going</button></div>` : ""}
        </div>
        <div class="row" style="gap:6px">
          <button class="pdf" data-act="edit-event">Edit</button>
          <button class="pdf" data-act="copy-event" title="Start a new event with these details">Copy</button>
          <button class="pdf" data-act="delete-event">Delete</button>
        </div>
      </div>
      <span class="msg"></span>
    </div>`).join("");
}

// Timed events edit as date and time; all-day ones as dates only. Switching
// carries the date across rather than letting the browser blank the field.
// The joining link only means anything for an online meeting, so it only
// appears for one.
function setOnline(online) {
  const editor = $("eventEditor");
  editor.querySelectorAll("[data-online-only]").forEach(el =>
    el.classList.toggle("hidden", !online));
}

function setAllDay(allDay) {
  const editor = $("eventEditor");
  editor.querySelector('[data-e="all_day"]').checked = allDay;
  ["start", "end"].forEach(f => {
    const input = editor.querySelector(`[data-e="${f}"]`);
    const was = input.value;
    const type = allDay ? "date" : "datetime-local";
    if (input.type === type) return;
    input.type = type;
    if (!was) return;
    input.value = allDay ? was.slice(0, 10)
                         : `${was}T${f === "start" ? "08:00" : "17:00"}`;
  });
}

function fillEventForm(e, { copy = false } = {}) {
  const editor = $("eventEditor");
  const set = (f, v) => { editor.querySelector(`[data-e="${f}"]`).value = v ?? ""; };

  editingEventId = e && !copy ? e.id : null;
  const zone = (e && e.timezone) || "America/Boise";

  set("title", e ? e.title + (copy ? " (copy)" : "") : "");
  set("category", (e && e.category) || "company");
  set("location_id", (e && e.location_id) || "");
  set("timezone", zone);
  set("location_name", e && e.location_name);
  set("address", e && e.address);
  set("details", e && e.details);
  set("contact", e && e.contact);
  set("link_url", e && e.link_url);
  set("meeting_url", e && e.meeting_url);
  set("is_published", !e || e.is_published ? "yes" : "no");
  set("enrollment", (e && e.enrollment) || "none");
  editor.querySelector('[data-e="is_online"]').checked = !!(e && e.is_online);
  setOnline(!!(e && e.is_online));

  setAllDay(!!(e && e.all_day));
  const cut = (iso) => {
    const wall = isoToWall(iso, zone);
    return e.all_day ? wall.slice(0, 10) : wall;
  };
  set("start", e ? cut(e.starts_at) : "");
  set("end", e && e.ends_at ? cut(e.ends_at) : "");

  $("eventEditorTitle").textContent = editingEventId ? "Edit event" : "Add an event";
  editor.querySelector('[data-act="save-event"]').textContent =
    editingEventId ? "Save changes" : "Add event";
  editor.querySelector('[data-act="cancel-event"]').classList.toggle(
    "hidden", !e);
  speak(editor, "", false);
}

$("admin").addEventListener("change", (event) => {
  const editor = $("eventEditor");
  if (!editor || !editor.contains(event.target)) return;
  const field = event.target.dataset.e;
  const get = (f) => editor.querySelector(`[data-e="${f}"]`);

  if (field === "all_day") return setAllDay(event.target.checked);
  if (field === "is_online") return setOnline(event.target.checked);

  // Picking the location sets its clock; it can still be changed afterwards.
  const shop = allLocations.find(l => l.id === event.target.value);
  const shopZone = shop && (shop.timezone || SHOP_ZONES[shop.id]);
  if (field === "location_id" && shopZone) {
    get("timezone").value = shopZone;
    if (!get("location_name").value.trim()) {
      get("location_name").value = `${locations[event.target.value]}`;
    }
  }

  // A start after the end is always a slip, so the end follows it: an hour
  // later for a meeting, the same day for an all-day event.
  if (field === "start" && event.target.value) {
    const end = get("end");
    if (!end.value || end.value < event.target.value) {
      if (get("all_day").checked) {
        end.value = event.target.value;
      } else {
        const t = new Date(`${event.target.value}:00Z`).getTime() + 3600000;
        end.value = new Date(t).toISOString().slice(0, 16);
      }
    }
  }
});

$("admin").addEventListener("click", async (event) => {
  const filter = event.target.closest("[data-event-filter]");
  if (filter) {
    eventFilter = filter.dataset.eventFilter;
    return renderEvents();
  }

  const button = event.target.closest("button[data-act]");
  if (!button) return;
  const act = button.dataset.act;
  if (!["save-event", "cancel-event", "edit-event", "copy-event",
        "delete-event"].includes(act)) return;

  if (act === "cancel-event") return fillEventForm(null);

  if (act === "edit-event" || act === "copy-event") {
    const e = companyEvents.find(x => x.id === button.closest("[data-event]").dataset.event);
    fillEventForm(e, { copy: act === "copy-event" });
    $("eventEditor").scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }

  if (act === "delete-event") {
    const row = button.closest("[data-event]");
    const e = companyEvents.find(x => x.id === row.dataset.event);
    if (!confirm(`Delete "${e.title}"? It comes off everyone's Event Center. ` +
                 `Anyone who already added it to their own calendar keeps their copy.`)) return;
    const { data, error } = await db.from("events").delete().eq("id", e.id).select();
    if (error) return speak(row, error.message, true);
    // A delete the policy refused matches no rows and reports no error.
    if (!data || !data.length) {
      return speak(row, "Nothing deleted — only an admin can remove events.", true);
    }
    if (editingEventId === e.id) fillEventForm(null);
    await loadEvents();
    return renderEvents();
  }

  // save-event
  const editor = $("eventEditor");
  const get = (f) => editor.querySelector(`[data-e="${f}"]`).value.trim();
  const allDay = editor.querySelector('[data-e="all_day"]').checked;
  const zone = get("timezone");

  if (!get("title")) return speak(editor, "The event needs a name.", true);
  if (!get("start")) return speak(editor, "When does it start?", true);

  const startsAt = wallToISO(get("start"), zone);
  const endsAt = get("end") ? wallToISO(get("end"), zone) : null;
  if (endsAt && endsAt < startsAt) {
    return speak(editor, "It ends before it starts — check the dates.", true);
  }

  // The app only opens web addresses, and the database refuses anything else.
  let link = get("link_url");
  if (link && !/^https?:\/\//i.test(link)) {
    if (/^[\w-]+(\.[\w-]+)+/.test(link)) link = "https://" + link;
    else return speak(editor, "The link has to be a web address, starting https://", true);
  }

  const isOnline = editor.querySelector('[data-e="is_online"]').checked;
  const meetingURL = get("meeting_url").trim();
  if (meetingURL && !/^https?:\/\/.+/i.test(meetingURL)) {
    return speak(editor, "The joining link has to start with https://", true);
  }

  const row = {
    title: get("title"),
    category: get("category"),
    starts_at: startsAt,
    ends_at: endsAt,
    all_day: allDay,
    timezone: zone,
    location_id: get("location_id") || null,
    location_name: get("location_name") || null,
    address: get("address") || null,
    details: get("details") || null,
    contact: get("contact") || null,
    link_url: link || null,
    is_online: isOnline,
    // The database refuses a joining link on an event not marked online, so
    // don't send one: unticking the box clears the link rather than failing.
    meeting_url: isOnline ? (meetingURL || null) : null,
    enrollment: get("enrollment") || "none",
    is_published: get("is_published") === "yes"
  };

  speak(editor, "Saving…", false);
  const query = editingEventId
    ? db.from("events").update(row).eq("id", editingEventId).select()
    : db.from("events").insert(row).select();
  const { data, error } = await query;

  if (error) {
    return speak(editor, error.message.includes("row-level")
      ? "Only an admin can add or change events." : error.message, true);
  }
  if (!data || !data.length) {
    return speak(editor, "Nothing changed — only an admin can edit events.", true);
  }

  const added = !editingEventId;
  await loadEvents();
  fillEventForm(null);
  eventFilter = eventIsPast(data[0]) ? "past" : "upcoming";
  renderEvents();
  speak(editor, row.is_published
    ? `${added ? "Added" : "Saved"}. Phones show it next time the Event Center is opened.`
    : `${added ? "Added" : "Saved"} as a draft — nobody sees it until Showing is Yes.`, false);
});

async function loadEvents() {
  const [ev, att] = await Promise.all([
    db.from("events").select("*").order("starts_at"),
    loadAttendeesQuery()
  ]);
  eventsError = ev.error ? ev.error.message : null;
  companyEvents = ev.data || [];
  eventAttendees = att.data || [];
}

// Only the lists of events this person can see come back, and none for an
// event that takes no sign-ups — the database's rule, not the page's.
const loadAttendeesQuery = () => db.from("event_attendees")
  .select("event_id,person_id,person_name,added_by,added_by_name,added_at");

async function loadAttendees() {
  const { data, error } = await loadAttendeesQuery();
  if (!error) eventAttendees = data || [];
  return error;
}

// ---- the Event Center, for everyone ----------------------------------------
//
// In the Cab look, as the app's Events tab: a slate card per event, lit in its
// kind's colour, that opens the event's own page. An event that takes sign-ups
// (0077) shows who's going there, with Sign me up on an open one; owners add
// and take off people from the same place.

// Each kind's colour, lit for the slate, as Cab.lit(category.color) in the app.
const EVENT_ACCENT = { company: "red", training: "deep", customer: "slate", safety: "amber", holiday: "violet" };
const eventAccent = (e) => lit(EVENT_ACCENT[e.category] || "red");

const eventGoing = (e) => eventAttendees.filter(a => a.event_id === e.id)
  .sort((a, b) => (a.person_name || "").localeCompare(b.person_name || ""));
const eventIsMine = (e) => eventAttendees.some(a => a.event_id === e.id && a.person_id === me.id);
const eventTakesSignups = (e) => e.enrollment === "open" || e.enrollment === "private";

// The venue's date of an event, for the calendar-page block.
const eventDay = (e) => dateOnly(isoToWall(e.starts_at, e.timezone || "America/Boise").slice(0, 10));

function eventsView() {
  const upcoming = companyEvents
    .filter(e => e.is_published && !eventIsPast(e))
    .sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at));

  const head = hero("Event Center",
    "What's coming up across the company, and how to take part.");

  if (eventsError) {
    return head + `<div class="ev"><div class="ev-card ev-note" style="${lit("red")}"><b>Events couldn't be loaded</b>
      <p>Try again in a minute.</p></div></div>`;
  }
  if (!upcoming.length) {
    return head + `<div class="ev"><div class="ev-card ev-note" style="${lit("red")}"><b>Nothing coming up</b>
      <p>New events show up here as soon as they're posted.</p></div></div>`;
  }

  // A heading per month, with how many are in it.
  const months = [];
  upcoming.forEach(e => {
    const label = eventDay(e).toLocaleDateString("en-US", { month: "long", year: "numeric" });
    if (!months.length || months[months.length - 1].label !== label) months.push({ label, events: [] });
    months[months.length - 1].events.push(e);
  });

  return head + `<div class="ev">` + months.map(m => `
    <div class="group-title">${esc(m.label)}<span class="ev-count">${m.events.length} ${m.events.length === 1 ? "event" : "events"}</span></div>
    <div class="ev-list">${m.events.map(eventRowHtml).join("")}</div>`).join("") + `</div>`;
}

function eventRowHtml(e) {
  const d = eventDay(e);
  const tag = eventIsMine(e) && eventTakesSignups(e) ? `<span class="cab-tag ev-going">Going</span>`
    : e.enrollment === "open" ? `<span class="cab-tag">Open sign-up</span>` : "";
  const online = eventOnlineLabel(e);
  return `<button type="button" class="cab-card ev-row" data-view="event" data-event="${esc(e.id)}"
      style="${eventAccent(e)}">
    <span class="ev-date"><small>${esc(d.toLocaleDateString("en-US", { weekday: "short" }))}</small><b>${d.getDate()}</b></span>
    <span class="ev-main">
      ${tag}
      <b>${esc(e.title)}</b>
      <span class="ev-meta">${icon("clock", 13)}${esc(eventWhen(e))}</span>
      ${online ? `<span class="ev-meta ev-online">${icon("video", 13)}${esc(online)}</span>`
        : e.location_name ? `<span class="ev-meta">${icon("pin", 13)}${esc(e.location_name)}</span>` : ""}
    </span>
    <span class="ev-chev" aria-hidden="true">&rsaquo;</span>
  </button>`;
}

// One event: when and where, Who's going if it takes sign-ups, then what it is.
function eventView() {
  const e = companyEvents.find(x => x.id === openEventId);
  if (!e) {
    return hero("Event") + `<div class="ev"><div class="ev-card ev-note" style="${lit("red")}"><b>This event isn't on the calendar any more</b>
      <p><button type="button" class="ghost" data-view="events">Back to the Event Center</button></p></div></div>`;
  }
  const online = eventOnlineLabel(e);
  const join = e.meeting_url && /^https?:\/\//i.test(e.meeting_url) ? e.meeting_url : null;
  const maps = e.address || e.location_name;
  const kind = (EVENT_CATEGORIES.find(c => c[0] === e.category) || ["", "Company"])[1];
  const past = eventIsPast(e);

  return hero(e.title, eventWhen(e)) + `<div class="ev ev-detail" style="${eventAccent(e)}">
    <div class="ev-card">
      <div class="ev-tags"><span class="cab-tag">${esc(kind)}</span>
        ${eventTakesSignups(e) ? `<span class="cab-tag ev-quiet">${e.enrollment === "open" ? "Open sign-up" : "Private list"}</span>` : ""}
        ${e.is_published ? "" : `<span class="cab-tag ev-quiet">Draft — only admins see it</span>`}</div>
      <div class="ev-lines">
        <span class="ev-line strong">${icon("calendar", 15)}${esc(eventWhen(e))}</span>
        ${online ? `<span class="ev-line strong ev-online">${icon("video", 15)}${esc(online)}${
          join ? " — attend from anywhere" : " — the joining link hasn't been added yet"}</span>` : ""}
        ${e.location_name ? `<span class="ev-line">${icon("pin", 15)}${esc(e.location_name)}</span>` : ""}
        ${e.address ? `<span class="ev-line">${icon("map", 15)}${esc(e.address)}</span>` : ""}
      </div>
      ${join && !past ? `<a class="join ev-join" href="${esc(join)}" target="_blank" rel="noopener">${icon("video", 16)}Join the meeting</a>` : ""}
      <div class="ev-actions">
        ${past ? "" : `<button type="button" class="ev-link" data-ics="${esc(e.id)}">Add to my calendar &rsaquo;</button>`}
        ${maps ? `<a class="ev-link" href="https://maps.google.com/?q=${encodeURIComponent(maps)}" target="_blank" rel="noopener">Directions &nearr;</a>` : ""}
        ${e.link_url && /^https?:\/\//i.test(e.link_url)
          ? `<a class="ev-link" href="${esc(e.link_url)}" target="_blank" rel="noopener">More information &nearr;</a>` : ""}
      </div>
    </div>

    ${eventTakesSignups(e) ? eventGoingHtml(e) : ""}

    ${e.details || e.contact ? `<div class="group-title">About it</div>
      <div class="ev-card ev-about">
        ${e.details ? `<p>${esc(e.details).replace(/\n/g, "<br>")}</p>` : ""}
        ${e.contact ? `<span class="ev-line">${icon("person", 15)}Questions? ${esc(e.contact)}</span>` : ""}
      </div>` : ""}

    <p class="ev-foot">${past ? "This event has already happened."
      : "Add to my calendar downloads a calendar file. Open it and Outlook adds the event to your calendar."}</p>
  </div>`;
}

// "Signed up Sep 28", or "Added by Andrew Kendall, Sep 28".
function attendeeHow(a) {
  const day = new Date(a.added_at).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  if (a.added_by && a.added_by === a.person_id) return `Signed up ${day}`;
  return a.added_by_name ? `Added by ${a.added_by_name}, ${day}` : `Added ${day}`;
}

// Who's going: your place on the list, the button, the list itself, and for
// an owner, adding people. Redrawn on its own after every change.
function eventGoingHtml(e) {
  const going = eventGoing(e);
  const mine = going.find(a => a.person_id === me.id);
  const past = eventIsPast(e);
  const open = e.enrollment === "open";
  const [title, line] = mine
    ? [past ? "You went" : "You're going",
       attendeeHow(mine) + (open && !past && mine.added_by === mine.person_id
         ? ". You can take yourself off until it's over." : ".")]
    : open
      ? [past ? "Sign-ups closed" : "Open enrollment",
         past ? "This event is over, so the list can't change." : "Anyone can sign up. You're not on the list yet."]
      : ["Private enrollment", "An owner puts people on this list. Ask the training department if you should be on it."];

  return `<section id="evGoing" data-event-box="${esc(e.id)}">
    <div class="group-title">Who's going<span class="ev-count">${going.length} ${going.length === 1 ? "person" : "people"}</span></div>
    <div class="ev-card ev-going-card">
      <div class="ev-status${mine ? " in" : ""}">${icon(mine ? "checkCircle" : open ? "userPlus" : "lock", 20)}
        <span><b>${title}</b><span>${esc(line)}</span></span></div>
      ${open && !past ? (mine
        ? `<button type="button" class="ev-quiet-btn" data-ev-act="leave">Take me off the list</button>`
        : `<button type="button" class="ev-signup" data-ev-act="signup">Sign me up</button>`) : ""}
      <span class="msg"></span>
      ${going.length ? `<ul class="ev-people">${going.map(a => `<li>
          <span class="ev-initials">${esc(initials(a.person_name || "?"))}</span>
          <span class="ev-who"><b>${esc(a.person_name || "Someone")}</b>${a.person_id === me.id ? `<span class="cab-tag ev-going">You</span>` : ""}
            <small>${esc(attendeeHow(a))}</small></span>
          ${isOwner() ? `<button type="button" class="ev-remove" data-ev-act="remove" data-person="${esc(a.person_id)}"
              title="Take ${esc(a.person_name || "them")} off the list">Take off</button>` : ""}
        </li>`).join("")}</ul>`
        : `<p class="ev-empty">${isOwner() ? "Nobody yet. Add people below."
            : open ? "Nobody yet. Be the first." : "Nobody yet."}</p>`}
      ${isOwner() ? `<div class="ev-add">
          <label for="evAddSearch">Add people</label>
          <input id="evAddSearch" type="search" class="search" data-ev-search placeholder="Search by name or location" autocomplete="off">
          <div class="ev-results" id="evAddResults">${eventCandidatesHtml(e, "")}</div>
        </div>` : ""}
    </div>
    <p class="ev-foot">${open
      ? "Open enrollment: anyone can sign themselves up, or take themselves off, until it's over." + (isOwner() ? " Owners can add or take off anyone." : "")
      : "Private enrollment: only owners put people on this list or take them off."}</p>
  </section>`;
}

// Everyone with an account who hasn't left and isn't on the list yet, for an
// owner to add. Owners read every profile (0021), so `people` is everyone.
function eventCandidatesHtml(e, query) {
  const on = new Set(eventGoing(e).map(a => a.person_id));
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const matches = people
    .filter(p => !p.deactivated_at && !on.has(p.id))
    .filter(p => {
      const hay = `${p.full_name || ""} ${p.email || ""} ${locations[p.location_id] || ""}`.toLowerCase();
      return words.every(w => hay.includes(w));
    })
    .sort((a, b) => (a.full_name || a.email || "").localeCompare(b.full_name || b.email || ""));
  if (!words.length) return `<p class="ev-hint">Type a name or a location to find people.</p>`;
  if (!matches.length) return `<p class="ev-hint">Nobody matches${on.size ? " who isn't already on the list" : ""}.</p>`;
  return matches.slice(0, 8).map(p => `<div class="ev-result">
      <span><b>${esc(p.full_name || p.email)}</b><small>${esc(locations[p.location_id] || "")}</small></span>
      <button type="button" data-ev-act="add" data-person="${esc(p.id)}">Add</button>
    </div>`).join("") + (matches.length > 8 ? `<p class="ev-hint">${matches.length - 8} more — keep typing.</p>` : "");
}

function redrawGoing(message, isError) {
  const box = $("evGoing");
  const e = companyEvents.find(x => x.id === openEventId);
  if (!box || !e) return;
  const query = ($("evAddSearch") || {}).value || "";
  box.outerHTML = eventGoingHtml(e);
  if (query && $("evAddSearch")) {
    $("evAddSearch").value = query;
    $("evAddResults").innerHTML = eventCandidatesHtml(e, query);
  }
  // The row lists count too.
  if (message) speak($("evGoing"), message, isError);
}

$("view").addEventListener("input", (event) => {
  if (!event.target.matches("[data-ev-search]")) return;
  const e = companyEvents.find(x => x.id === openEventId);
  if (e) $("evAddResults").innerHTML = eventCandidatesHtml(e, event.target.value);
});

$("view").addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-ev-act]");
  if (!button) return;
  const e = companyEvents.find(x => x.id === openEventId);
  if (!e) return;
  const act = button.dataset.evAct;
  const person = act === "signup" || act === "leave" ? me.id : button.dataset.person;
  const who = act === "add" ? (people.find(p => p.id === person) || {}).full_name
    : (eventGoing(e).find(a => a.person_id === person) || {}).person_name;

  if (act === "leave" && !confirm("Take yourself off the list? You can sign up again until the event is over.")) return;
  if (act === "remove" && !confirm(`Take ${who || "them"} off the list?`)) return;

  button.disabled = true;
  let error = null, refused = false;
  if (act === "signup" || act === "add") {
    ({ error } = await db.from("event_attendees").insert({ event_id: e.id, person_id: person }));
    // Already on it, from another tab: nothing went wrong.
    if (error && error.code === "23505") error = null;
  } else {
    const res = await db.from("event_attendees").delete()
      .eq("event_id", e.id).eq("person_id", person).select("event_id");
    error = res.error;
    refused = !error && !(res.data || []).length;
  }
  const loadError = await loadAttendees();
  button.disabled = false;

  if (error || refused) {
    const rule = act === "signup" ? "Sign-ups for this event have closed."
      : act === "leave" ? "Sign-ups for this event have closed, so the list can't change. Ask an owner."
      : "Only an owner can change this list.";
    return redrawGoing(error && !/row-level/i.test(error.message) ? error.message : rule, true);
  }
  redrawGoing(loadError ? "Saved, but the list couldn't be reloaded. Refresh the page to see it." : {
    signup: "You're on the list.", leave: "You're off the list.",
    add: `${who || "They"} ${who ? "is" : "are"} on the list.`, remove: `${who || "They"} ${who ? "is" : "are"} off the list.`
  }[act], !!loadError);
  if (act === "add" && $("evAddSearch")) $("evAddSearch").focus();
});

// "Online · Teams", or "Online" before the link exists. Matches
// CompanyEvent.onlineLabel in the app so both call it the same thing.
function eventOnlineLabel(e) {
  if (!e.is_online) return null;
  const host = (() => {
    try { return new URL(e.meeting_url).host.toLowerCase(); } catch { return ""; }
  })();
  if (host.includes("teams.microsoft") || host.includes("teams.live")) return "Online · Teams";
  if (host.includes("zoom.")) return "Online · Zoom";
  if (host.includes("meet.google")) return "Online · Google Meet";
  if (host.includes("webex")) return "Online · Webex";
  return "Online";
}

// iCalendar text: backslashes, commas, semicolons and newlines are escaped,
// and long lines are folded, as the format requires.
function icsText(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/;/g, "\\;")
    .replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

function icsFold(line) {
  const out = [];
  while (line.length > 72) { out.push(line.slice(0, 72)); line = " " + line.slice(72); }
  out.push(line);
  return out.join("\r\n");
}

function downloadICS(e) {
  const zone = e.timezone || "America/Boise";
  const stamp = (iso) => new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const lines = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Agri-Service//Event Center//EN",
    "METHOD:PUBLISH", "BEGIN:VEVENT",
    `UID:${e.id}@agri-service-app`,
    `DTSTAMP:${stamp(new Date().toISOString())}`
  ];

  if (e.all_day) {
    // All-day ends are exclusive in iCalendar: the day after the last day.
    const first = isoToWall(e.starts_at, zone).slice(0, 10);
    const last = dateOnly(isoToWall(eventEnd(e), zone).slice(0, 10));
    last.setDate(last.getDate() + 1);
    const after = `${last.getFullYear()}${pad2(last.getMonth() + 1)}${pad2(last.getDate())}`;
    lines.push(`DTSTART;VALUE=DATE:${first.replace(/-/g, "")}`, `DTEND;VALUE=DATE:${after}`);
  } else {
    lines.push(`DTSTART:${stamp(e.starts_at)}`, `DTEND:${stamp(eventEnd(e))}`);
  }

  lines.push(`SUMMARY:${icsText(e.title)}`);
  // An online meeting's "where" is the platform, which is what a calendar
  // shows in its one-line preview. Same rule as AddToCalendar.swift.
  const join = e.meeting_url && /^https?:\/\//i.test(e.meeting_url) ? e.meeting_url : null;
  const where = e.is_online
    ? (eventOnlineLabel(e) || "Online").replace(/^Online · /, "") || "Online"
    : [e.location_name, e.address].filter(Boolean).join(", ");
  if (where) lines.push(`LOCATION:${icsText(where)}`);
  const notes = [join && `Join the meeting: ${join}`, e.details,
                 e.contact && `Contact: ${e.contact}`, e.link_url,
                 "From the Agri-Service app"].filter(Boolean).join("\n\n");
  lines.push(`DESCRIPTION:${icsText(notes)}`);
  // The join link wins the URL slot: tapping the entry should open the
  // meeting, not a page about it.
  const url = join || (e.link_url && /^https?:\/\//i.test(e.link_url) ? e.link_url : null);
  if (url) lines.push(`URL:${url}`);
  lines.push("END:VEVENT", "END:VCALENDAR");

  const blob = new Blob([lines.map(icsFold).join("\r\n") + "\r\n"],
                        { type: "text/calendar;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = (e.title.replace(/[^\w -]+/g, "").trim() || "event") + ".ics";
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

$("view").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-ics]");
  if (!button) return;
  const e = companyEvents.find(x => x.id === button.dataset.ics);
  if (e) downloadICS(e);
});
