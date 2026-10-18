// The Support Center
//
// Who to call, support requests (internal tickets), and the support roles
// the admin page edits.

// ---- support -------------------------------------------------------------
//
// The Support Center, laid out like the app's (SupportCenterView.swift): ask
// the company, IT help, special tools, and who to call. Requests and special
// tools are each a card to click into, so this page stays the same length
// however many of either there are.

// A page redrawn where it was, rather than back at the top.
function redraw(view) {
  const y = window.scrollY;
  showView(view);
  window.scrollTo(0, y);
}

function supportView() {
  const open = tickets.filter(t => t.status !== "closed").length;
  const out = tools.filter(t => toolOutCount(t) > 0).length;
  const body = "Describe the problem here:\n\n\n\n-\n"
    + ((profile && profile.full_name) ? "From: " + profile.full_name + "\n" : "")
    + ((profile && locations[profile.location_id])
       ? "Location: " + locations[profile.location_id] + "\n" : "")
    + "Sent from the Agri-Service web page";

  return hero("Support Center", "Something not working? Get it in front of the right people here.")
    + `<div class="sc-groups">
      <section>
        <div class="group-title">Ask the company</div>
        <button type="button" class="link-card" data-view="requests" style="${lit("slate")}">
          <span class="well">${icon("chat")}</span>
          <span><b>Internal Support Requests</b>
            <span>Ask the company a question about a machine, or answer someone else's.</span>
            <span class="sc-foot">${icon("tray", 14)}${open
              ? `${open} open ${open === 1 ? "request" : "requests"}` : "Nothing open right now"}</span>
            <span class="go">Open requests &rarr;</span></span>
        </button>
      </section>
      <section>
        <div class="group-title">IT help</div>
        <a class="link-card" href="mailto:IT@agri-service.com?body=${encodeURIComponent(body)}"
           style="${lit("steel")}">
          <span class="well">${icon("monitor")}</span>
          <span><b>Submit an IT Ticket</b>
            <span>Computer, phone, printer, or account trouble — email the IT team.</span>
            <span class="sc-foot">${icon("mail", 14)}Opens a message to IT@agri-service.com</span>
            <span class="go">Start a ticket &nearr;</span></span>
        </a>
      </section>
      ${toolsError ? "" : `<section>
        <div class="group-title">Special tools</div>
        <button type="button" class="link-card" data-view="tools" style="${lit("amber")}">
          <span class="well">${icon("wrench")}</span>
          <span><b>Special Tools</b>
            <span>Where every special tool lives, and where it is right now.</span>
            <span class="sc-foot">${icon("box", 14)}${tools.length
              ? `${tools.length} ${tools.length === 1 ? "tool" : "tools"}` : "None added yet"}${
              out ? `<em>· ${out} checked out</em>` : ""}</span>
            <span class="go">Open the list &rarr;</span></span>
        </button>
      </section>`}
    </div>
    <div id="whoToCall">${whoToCallHtml()}</div>`;
}

// Who to call is most of the page's length, a card per role with a row per
// person, so it folds. Folded, it still names the roles inside. Opened once,
// it stays open in this browser, as the app remembers it on the phone.
const WHO_TO_CALL = "support.whoToCall.open";
let whoToCallOpen = (() => {
  try { return localStorage.getItem(WHO_TO_CALL) === "1"; } catch { return false; }
})();

function whoToCallHtml() {
  const names = supportRoles.map(r => esc(r.title)).join(" · ");
  return `<button type="button" class="group-title sc-fold" data-who-to-call
      aria-expanded="${whoToCallOpen}">Who to call<span class="sc-fold-go">${
      whoToCallOpen ? "Hide" : "Show"}${icon("chevronDown", 14)}</span></button>
    ${whoToCallOpen
      ? `<div class="sc-roles">${supportRoles.map(roleCardHtml).join("")}</div>`
      : names ? `<p class="sc-role-names">${names}</p>` : ""}`;
}

// Not one link like the other cards: each person has two, so the card is a
// surface and Call and Text are the targets.
function roleCardHtml(role) {
  const crew = (role.support_people || []).slice()
    .sort((a, b) => (a.sort_order - b.sort_order) || a.name.localeCompare(b.name));
  // A role can be covered by more than one person, and one nobody covers yet
  // is shown rather than hidden, so people know the route is coming.
  const rows = crew.length ? crew.map(person => `
    <div class="sc-person">
      <div class="sc-who">
        <span class="sc-avatar">${esc(initials(person.name))}</span>
        <span><b>${esc(person.name)}</b>
          ${person.title ? `<span>${esc(person.title)}</span>` : ""}
          <span class="sc-phone">${esc(displayPhone(person.phone))}</span></span>
      </div>
      <div class="sc-reach">
        <a class="sc-call" href="tel:+1${esc(person.phone)}">${icon("phone", 15)}Call</a>
        <a class="sc-text" href="sms:+1${esc(person.phone)}">${icon("chat", 15)}Text</a>
      </div>
    </div>`).join("") : `
    <div class="sc-person">
      <div class="sc-who">
        <span class="sc-avatar empty">${icon("person", 18)}</span>
        <span><b>No one assigned yet</b>
          <span>The training department will add a name here.</span></span>
      </div>
    </div>`;

  return `<div class="sc-role">
    <div class="sc-role-head">${icon("phone", 19)}
      <span><b>${esc(role.title)}</b>${role.subtitle ? `<span>${esc(role.subtitle)}</span>` : ""}</span>
    </div>
    ${rows}
  </div>`;
}

document.addEventListener("click", (event) => {
  if (!event.target.closest("[data-who-to-call]")) return;
  whoToCallOpen = !whoToCallOpen;
  try { localStorage.setItem(WHO_TO_CALL, whoToCallOpen ? "1" : "0"); } catch { /* this visit only */ }
  $("whoToCall").innerHTML = whoToCallHtml();
});

const initials = (name) =>
  name.split(" ").filter(Boolean).slice(0, 2).map(w => w[0]).join("").toUpperCase();

const displayPhone = (p) => (p || "").length === 10
  ? `(${p.slice(0, 3)}) ${p.slice(3, 6)}-${p.slice(6)}` : (p || "");

// ---- internal support requests -------------------------------------------
//
// The list, one request, and the form for a new one, as three pages like the
// app's (SupportTicketsView, SupportTicketDetailView, NewSupportTicketView).

// Groups are the person's own to change, so the same chips appear on the
// request form and under the list.
const chips = (selected, attr) => `<div class="chips">` +
  workGroups.filter(g => g.is_active !== false || selected.includes(g.id))
    .map(g => `<button type="button" class="chip${
    selected.includes(g.id) ? " on" : ""}" data-chip="${esc(attr)}"
    data-id="${esc(g.id)}">${esc(g.name)}</button>`).join("") + `</div>`;

const groupNames = (ids) => (ids || [])
  .map(id => (workGroups.find(g => g.id === id) || {}).name || id)
  .join(", ");

// Chips toggle in place; nothing is saved until the surrounding button is used,
// except for your own groups, which save as you tap.
$("view").addEventListener("click", async (event) => {
  const chip = event.target.closest("button[data-chip]");
  if (!chip) return;
  chip.classList.toggle("on");

  if (chip.dataset.chip === "mine") {
    const picked = [...chip.parentElement.querySelectorAll(".chip.on")]
      .map(c => c.dataset.id);
    const { error } = await db.from("profiles")
      .update({ groups: picked }).eq("id", me.id);
    if (error) return alert(error.message);
    profile.groups = picked;
    // Which requests reach you follows your groups.
    await loadTickets();
    redraw("requests");
  }
});

async function loadTickets() {
  const { data, error } = await db.from("support_tickets").select("*, support_ticket_comments(*)")
    .order("last_activity_at", { ascending: false });
  if (!error) tickets = data || [];
}

const TICKET_STATUS = {
  open: { label: "Open", tint: "red", badge: "b-open" },
  answered: { label: "Answered", tint: "amber", badge: "b-answered" },
  closed: { label: "Closed", tint: "green", badge: "b-closed" }
};
const ticketStatus = (t) => TICKET_STATUS[t.status] || TICKET_STATUS.open;

// Which requests the list shows: open ones first, as in the app. Closed ones
// are the record of what fixed what.
let ticketFilter = "open", openTicketId = null;

const TICKET_FILTERS = [
  ["open", "Open", t => t.status !== "closed"],
  ["closed", "Closed", t => t.status === "closed"],
  ["all", "All", () => true],
  ["mine", "Mine", t => t.created_by === me.id]
];

const firstLine = (text) => {
  const line = String(text || "").trim().split("\n")[0];
  return line.length > 90 ? line.slice(0, 90) + "…" : line;
};

// "Fendt · 1050 · Tractor": what the request is about, in the fewest words.
const machineLine = (t) => [t.brand, t.model, t.machine_type]
  .map(v => (v || "").trim()).filter(Boolean).join(" · ");

const solutionOf = (t) => t.status === "closed" ? (t.solution || "").trim() : "";

// "3 days ago", as the app words it.
function ago(ts) {
  if (!ts) return "just now";
  const seconds = (new Date(ts) - Date.now()) / 1000;
  const say = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  for (const [size, unit] of [[31536000, "year"], [2592000, "month"], [604800, "week"],
                              [86400, "day"], [3600, "hour"], [60, "minute"]]) {
    if (Math.abs(seconds) >= size) return say.format(Math.round(seconds / size), unit);
  }
  return "just now";
}

function requestsView() {
  const [, , test] = TICKET_FILTERS.find(f => f[0] === ticketFilter) || TICKET_FILTERS[0];
  const shown = tickets.filter(test);
  const [heading, words] = ticketFilter === "closed"
    ? ["Nothing closed yet", "Closed requests appear here with what fixed them, for the next person with the same problem."]
    : [ticketFilter === "mine" ? "You haven't asked anything yet" : "No open requests",
       "Raise one with New request. Everyone in the groups you pick can see it, so the next person with the same problem finds the answer."];

  return hero("Support Requests",
      "Ask the company a question about a machine, or answer someone else's. A closed request shows what fixed it.")
    + `<div class="sr">
      <div class="sr-bar">
        <div class="cab-pills">${TICKET_FILTERS.map(([id, label, f]) => `
          <button type="button" class="cab-pill${ticketFilter === id ? " on" : ""}"
            data-ticket-filter="${id}">${label}<span>${tickets.filter(f).length}</span></button>`).join("")}</div>
        <button type="button" class="sr-new" data-view="newrequest">${icon("pencil", 16)}New request</button>
      </div>
      ${shown.length ? `<div class="sr-list">${shown.map(ticketRowHtml).join("")}</div>`
        : `<div class="sr-empty">${icon("tray", 34)}<b>${heading}</b><p>${words}</p></div>`}
      <div class="card sr-mine">
        <h2>Your groups</h2>
        ${chips((profile && profile.groups) || [], "mine")}
        <p class="note">Requests aimed at these reach you. Tap to change — this saves straight away.</p>
      </div>
    </div>`;
}

function ticketRowHtml(t) {
  const status = ticketStatus(t), replies = (t.support_ticket_comments || []).length;
  const machine = machineLine(t), fix = solutionOf(t);
  return `<button type="button" class="sr-row cab-card" data-view="request" data-ticket="${esc(t.id)}"
      style="${lit(status.tint)}">
    <span class="sr-top"><span class="cab-tag">${status.label}</span>
      ${replies ? `<span class="sr-count">${icon("chat", 13)}${replies}</span>` : ""}</span>
    <b>${esc(firstLine(t.description))}</b>
    ${machine ? `<span class="sr-machine">${esc(machine)}</span>` : ""}
    ${(t.groups || []).length ? `<span class="sr-for">${esc(groupNames(t.groups))}</span>` : ""}
    ${fix ? `<span class="sr-fix">${icon("checkCircle", 15)}<span>${esc(fix)}</span></span>` : ""}
    <span class="sr-by">${esc(t.created_by_name || "Someone")} · ${esc(ago(t.last_activity_at || t.created_at))}</span>
  </button>`;
}

function requestView() {
  const t = tickets.find(x => x.id === openTicketId);
  if (!t) {
    return hero("Request") + `<div class="sr-empty"><b>This request isn't in the list any more.</b>
      <p><button type="button" class="ghost" data-view="requests">Back to requests</button></p></div>`;
  }
  const status = ticketStatus(t), fix = solutionOf(t);
  const replies = (t.support_ticket_comments || []).slice()
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  const canClose = t.created_by === me.id || isAdmin();
  const fact = (label, value) => (value || "").trim()
    ? `<div><dt>${label}</dt><dd>${esc(value.trim())}</dd></div>` : "";
  const facts = fact("Machine or system", t.machine_type) + fact("Brand", t.brand)
    + fact("Model", t.model) + fact("Error codes", t.error_codes);

  return hero(firstLine(t.description) || "Request",
      `${t.created_by_name || "Someone"} · ${ago(t.created_at)}`
      + ((t.groups || []).length ? ` · For ${groupNames(t.groups)}` : ""))
    + `<div class="sr-detail" data-ticket-box="${esc(t.id)}">
      <div class="row sr-status-row">
        <span class="badge ${status.badge}">${status.label}</span>
        <span class="sr-when">Last activity ${esc(ago(t.last_activity_at || t.created_at))}</span>
        ${canClose ? `<span class="sr-acts">${t.status === "closed"
          ? `<button type="button" class="ghost" data-act="edit-solution">${icon("pencil", 15)}Edit solution</button>
             <button type="button" class="ghost" data-act="reopen">Reopen</button>`
          : `<button type="button" class="ghost" data-act="close">${icon("checkCircle", 15)}Mark as closed</button>`}
          </span><span class="msg"></span>` : ""}
      </div>

      ${fix ? `<div class="sr-solution">
        <span class="sr-label">${icon("checkCircle", 15)}Solution</span>
        <p>${esc(fix).replace(/\n/g, "<br>")}</p>
        ${t.closed_by_name ? `<small>Closed by ${esc(t.closed_by_name)}${
          t.closed_at ? ` · ${esc(ago(t.closed_at))}` : ""}</small>` : ""}
      </div>` : ""}

      <div class="card sr-facts">
        ${facts ? `<dl>${facts}</dl>` : ""}
        <dl class="sr-desc"><div><dt>Description</dt>
          <dd>${esc(t.description || "").replace(/\n/g, "<br>")}</dd></div></dl>
      </div>

      <div class="card sr-thread">
        <h2>${replies.length ? `${replies.length} ${replies.length === 1 ? "reply" : "replies"}` : "No replies yet"}</h2>
        ${replies.map(c => `<div class="sr-comment">
          <div class="sr-comment-head"><b>${esc(c.created_by_name || "Someone")}</b>
            <span title="${esc(new Date(c.created_at).toLocaleString())}">${esc(ago(c.created_at))}</span></div>
          <p>${esc(c.body).replace(/\n/g, "<br>")}</p>
        </div>`).join("")}
      </div>

      <div class="card sr-reply">
        <label for="replyText">Add a reply</label>
        <textarea id="replyText" data-reply rows="4"></textarea>
        <div class="row"><button type="button" data-act="reply">Post reply</button><span class="msg"></span></div>
      </div>
    </div>`;
}

function newRequestView() {
  return hero("New Request",
      "Ask about a machine or a system. Only the groups you pick see it, and anyone in them can answer.")
    + `<div class="sr-form" data-new-request>
      <div class="card">
        <label>Who should see this</label>
        ${chips([], "new")}
        <div class="fields">
          <div><label for="nrMachine">Machine or system</label>
            <input id="nrMachine" type="text" data-new="machine_type" placeholder="Tractor, combine, display…"></div>
          <div><label for="nrBrand">Brand</label>
            <input id="nrBrand" type="text" data-new="brand" placeholder="Fendt, Massey…"></div>
          <div><label for="nrModel">Model</label>
            <input id="nrModel" type="text" data-new="model" placeholder="1050 Vario"></div>
          <div><label for="nrCodes">Error codes</label>
            <input id="nrCodes" type="text" data-new="error_codes" placeholder="SPN 3216, FMI 4"></div>
          <div class="wide"><label for="nrDescription">Description</label>
            <textarea id="nrDescription" data-new="description" rows="6"
              placeholder="What's happening, what have you tried, and what did it do?"></textarea></div>
        </div>
        <div class="row">
          <button type="button" data-act="new-ticket">Send request</button>
          <button type="button" class="ghost" data-view="requests">Cancel</button>
          <span class="msg"></span>
        </div>
      </div>
    </div>`;
}

$("view").addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-act]");
  if (!button) return;

  const act = button.dataset.act;
  if (!["new-ticket", "reply", "close", "edit-solution", "close-confirm", "close-cancel",
        "reopen"].includes(act)) return;

  const say = (text, bad) => speak(button.closest(".row"), text, bad);
  const box = button.closest("[data-ticket-box]");
  const id = box && box.dataset.ticketBox;

  // Closing asks what fixed it first, and so does correcting the answer.
  if (act === "close" || act === "edit-solution") {
    const open = box.querySelector(".solution-form");
    if (open) return open.querySelector("textarea").focus();
    const ticket = tickets.find(t => t.id === id) || {};
    const editing = act === "edit-solution";
    button.closest(".row").insertAdjacentHTML("afterend", `<div class="card solution-form">
      <label for="solutionText">What fixed it?</label>
      <textarea id="solutionText" data-solution rows="4" maxlength="4000"
        placeholder="The fault, and what fixed it: the part, the setting, the step.">${
        editing ? esc(ticket.solution || "") : ""}</textarea>
      <p class="note">It stays on the closed request for the next person with the same problem.</p>
      <div class="row">
        <button type="button" data-act="close-confirm">${editing ? "Save solution" : "Close request"}</button>
        <button type="button" class="ghost" data-act="close-cancel">Cancel</button>
        <span class="msg"></span>
      </div>
    </div>`);
    box.querySelector("[data-solution]").focus();
    return;
  }
  if (act === "close-cancel") {
    button.closest(".solution-form").remove();
    return;
  }
  if (act === "reopen" && !confirm("Reopen this request?\n\nIt goes back on the open list, and "
      + "its solution is cleared, since it didn't fix it. The replies stay.")) return;

  if (act === "new-ticket") {
    const form = button.closest("[data-new-request]");
    const get = (f) => form.querySelector(`[data-new="${f}"]`).value.trim();
    const picked = [...form.querySelectorAll('[data-chip="new"].on')].map(c => c.dataset.id);

    if (!get("description")) return say("Say what's happening first.", true);
    // A request with no group would go to everybody, which is the thing groups
    // are meant to stop.
    if (!picked.length) return say("Pick at least one group.", true);

    say("Sending…", false);
    // created_by, the name and the location are all filled in by the database.
    const { data, error } = await db.from("support_tickets").insert({
      machine_type: get("machine_type"), brand: get("brand"), model: get("model"),
      error_codes: get("error_codes"), description: get("description"),
      groups: picked
    }).select("id");
    if (error) return say(error.message, true);
    await loadTickets();
    if (data && data[0]) { openTicketId = data[0].id; return showView("request"); }
    ticketFilter = "mine";
    return showView("requests");
  }

  if (act === "reply") {
    const field = box.querySelector("[data-reply]");
    if (!field.value.trim()) return say("Nothing to post.", true);

    say("Posting…", false);
    const { data, error } = await db.from("support_ticket_comments")
      .insert({ ticket_id: id, body: field.value.trim() })
      .select("id");
    if (error) return say(error.message, true);
    // Whoever asked is waiting on an answer.
    if (data && data[0]) notify("support_comment", data[0].id);

  } else if (act === "close-confirm") {
    const answer = (box.querySelector("[data-solution]").value || "").trim();
    if (!answer) return say("Say what fixed it before closing the request.", true);
    say("Saving…", false);
    // The database stamps who closed it, and refuses a blank solution.
    const { data, error } = await db.from("support_tickets")
      .update({ status: "closed", solution: answer })
      .eq("id", id).select();
    if (error) return say(error.message, true);
    if (!data || !data.length) return say("That isn't yours to change.", true);

  } else {
    // Reopening. The database clears the solution.
    const { data, error } = await db.from("support_tickets")
      .update({ status: "open" })
      .eq("id", id).select();
    if (error) return say(error.message, true);
    if (!data || !data.length) return say("That isn't yours to change.", true);
  }

  await loadTickets();
  redraw("request");
});

$("view").addEventListener("click", (event) => {
  const pill = event.target.closest("button[data-ticket-filter]");
  if (!pill) return;
  ticketFilter = pill.dataset.ticketFilter;
  redraw("requests");
});

// ---------------------------------------------------------------- people

// Anything typed — spaces, dashes, brackets, a leading 1 — becomes ten digits,
// so the app can build a tel: link straight from the column.
function normalisePhone(value) {
  return value.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
}

function readPerson(row) {
  return {
    name: row.querySelector('[data-f="name"]').value.trim(),
    title: row.querySelector('[data-f="title"]').value.trim(),
    phone: normalisePhone(row.querySelector('[data-f="phone"]').value)
  };
}

// Shared by adding and saving: a person needs a name and a number that dials.
function validPerson(row) {
  const person = readPerson(row);
  if (!person.name) { speak(row, "This person needs a name.", true); return null; }
  if (person.phone.length !== 10) {
    speak(row, "A mobile needs 10 digits.", true); return null;
  }
  return person;
}

async function addPerson(row, roleId) {
  const person = validPerson(row);
  if (!person) return;

  speak(row, "Adding…", false);
  const existing = (supportRoles.find(r => r.id === roleId).support_people || []).length;
  const { data, error } = await db.from("support_people")
    .insert({ role_id: roleId, ...person, title: person.title || null,
              sort_order: (existing + 1) * 10 })
    .select();

  if (error) return speak(row, error.message, true);
  if (!data || !data.length) {
    return speak(row, "Nothing was added — this account isn't an admin.", true);
  }
  await loadAll();
  renderSupport();
}

async function savePerson(row) {
  const person = validPerson(row);
  if (!person) return;

  speak(row, "Saving…", false);
  const { data, error } = await db.from("support_people")
    .update({ ...person, title: person.title || null })
    .eq("id", row.dataset.person).select();

  if (error) return speak(row, error.message, true);
  if (!data || !data.length) {
    return speak(row, "Nothing changed — this account isn't an admin.", true);
  }
  speak(row, "Saved.", false);
  const crew = supportRoles.find(r =>
    (r.support_people || []).some(p => p.id === row.dataset.person)).support_people;
  Object.assign(crew.find(p => p.id === row.dataset.person), data[0]);
}

async function removePerson(row) {
  const person = readPerson(row);
  if (!confirm(`Remove ${person.name || "this person"} from the app?`)) return;

  speak(row, "Removing…", false);
  const { error } = await db.from("support_people")
    .delete().eq("id", row.dataset.person);

  if (error) return speak(row, error.message, true);
  await loadAll();
  renderSupport();
}

async function saveRole(card) {
  const id = card.dataset.id;
  const msg = card.querySelector(".msg");
  const get = (f) => card.querySelector(`[data-f="${f}"]`).value.trim();

  const say = (text, bad) => {
    msg.textContent = text;
    msg.className = "msg " + (bad ? "error" : "ok");
  };

  if (!get("title")) return say("The card needs a title.", true);

  const payload = {
    title: get("title"),
    subtitle: get("subtitle"),
    symbol: get("symbol") || "lifepreserver.fill"
  };

  say("Saving…", false);
  const { data, error } = await db.from("support_roles")
    .update(payload).eq("id", id).select();

  if (error) return say(error.message, true);
  // An update the policy refused affects no rows and reports no error, which
  // would otherwise look exactly like success.
  if (!data || !data.length) {
    return say("Nothing changed — this account isn't an admin.", true);
  }

  // The update doesn't return the embedded people, so keep the ones we have.
  const role = supportRoles.find(r => r.id === id);
  Object.assign(role, data[0], { support_people: role.support_people });
  say("Saved.", false);
}

$("supportRoles").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-act]");
  if (!button) return;

  switch (button.dataset.act) {
    case "save":          return saveRole(button.closest(".role"));
    case "add-person":    return addPerson(button.closest(".prow"), button.dataset.role);
    case "save-person":   return savePerson(button.closest(".prow"));
    case "remove-person": return removePerson(button.closest(".prow"));
  }
});
