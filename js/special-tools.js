// Special Tools
//
// Every special tool and where it is: the list, one tool, adding and
// changing one, checking out and in, the admin tab, and the spreadsheet download
// and upload.

// ---- special tools --------------------------------------------------------
//
// Where every special tool lives, and where it is right now (migration 0061),
// as in the app: a list to search and filter, and a page per tool with where
// it is, where it's been, and — for the admin of its home location, or an owner —
// Check out, Check in, Edit and Delete (migration 0062). The database decides
// who can do each; the buttons only show for the people it will accept.
//
// A tool's answers to the fields owners add are kept in `extra`, keyed by the
// field's id, so renaming a field keeps them — the same as the app. The admin
// area has the whole list as a CSV, the bulk upload, and those fields.
//
// Nothing here waits to send later: a checkout that went through late could
// claim a tool someone else took in the meantime.

let tools = [], toolFields = [], toolsError = null;
let toolQuery = "", toolFilter = "all", toolImport = null;
// The tool open, whether its checkout form is showing, what the last check-in
// said, and the add or edit form's contents.
let openToolId = null, toolCheckingOut = false, toolNotice = "", toolDraft = null;

const TOOL_TYPES = [["text", "Text"], ["long_text", "Long text"], ["number", "Number"],
  ["date", "Date"], ["choice", "Pick from a list"], ["yes_no", "Yes / No"]];
const TOOL_COLUMNS = ["Part Number", "Name", "Description", "Home Location", "Quantity"];
const TOOL_READ_ONLY = ["Checked Out", "Where"];

async function loadTools() {
  const [t, f] = await Promise.all([
    db.from("special_tools")
      .select("id, part_number, name, description, extra, location_id, quantity, "
        + "special_tool_checkouts(id, to_location_id, quantity, note, checked_out_by_name, "
        + "checked_out_at, returned_at, returned_by_name)")
      .order("name"),
    db.from("special_tool_fields").select("*").order("sort_order")
  ]);
  // Before migration 0061 there's no table; the page leaves the section out.
  toolsError = t.error ? t.error.message : null;
  tools = t.data || [];
  toolFields = f.data || [];
}

const toolOpen = (t) => (t.special_tool_checkouts || []).filter(c => !c.returned_at)
  .sort((a, b) => String(b.checked_out_at).localeCompare(String(a.checked_out_at)));
const toolHistory = (t) => (t.special_tool_checkouts || []).filter(c => c.returned_at)
  .sort((a, b) => String(b.returned_at).localeCompare(String(a.returned_at)));
const toolOutCount = (t) => toolOpen(t).reduce((n, c) => n + (c.quantity || 0), 0);
const activeToolFields = () => toolFields.filter(f => f.is_active)
  .sort((a, b) => (a.sort_order - b.sort_order) || a.label.localeCompare(b.label));

// A timestamp as the day it was here, not the day it was in UTC.
const localDay = (ts) => ts ? new Date(ts).toLocaleDateString("en-US") : "";
const toolDay = (ts) => ts ? new Date(ts).toLocaleDateString("en-US",
  { month: "short", day: "numeric", year: "numeric" }) : "";
const toolFieldText = (field, value) =>
  field.field_type === "date" ? (usDate(value) || value || "") : (value || "");
// Part numbers compare the way the database does: trimmed, single spaces, any case.
const partKey = (p) => String(p || "").trim().replace(/\s+/g, " ").toUpperCase();

// Owners anywhere; a location admin at the locations they look after. The
// same rules as manages_special_tool() (0062, 0099), which has the final word.
const canAddTools = () => isOwner() || (isAdmin() && myLocations().length > 0);
const canManageTool = (t) => isOwner() || adminAt(t.location_id);

function toolStatusText(t) {
  const out = toolOutCount(t), home = shopName(t.location_id);
  if (!out) return t.quantity === 1 ? `At ${home}` : `All ${t.quantity} at ${home}`;
  const places = [...new Set(toolOpen(t).map(c => shopName(c.to_location_id)))].join(", ");
  return `${toolOutLead(t)} · at ${places}`;
}

function toolOutLead(t) {
  const out = toolOutCount(t);
  return out >= t.quantity
    ? (t.quantity === 1 ? "Checked out" : `All ${t.quantity} checked out`)
    : `${out} of ${t.quantity} checked out`;
}

function toolMatches(t, q) {
  if (!q) return true;
  return [t.name, t.part_number, t.description, ...Object.values(t.extra || {})]
    .join(" ").toLowerCase().includes(q.toLowerCase());
}

const NOT_YOURS = "That's not yours to change. A location admin can only change tools at their own location.";
const NOT_HOME_SHOP = "Only the admin at the tool's home location, or an owner, can check it out or back in.";

// The database's own sentence when it's one of ours, and plain words for the
// codes it uses when it isn't.
function toolSentence(error, partNumber, refusal = NOT_YOURS) {
  if (error.code === "23505") {
    return `Part number ${partNumber || ""} is already in the list. Each part number is one tool — change its quantity instead.`;
  }
  if (error.code === "42501") return refusal;
  return error.message;
}

// ---- special tools: the list

function toolsView() {
  // Your location, or every location you look after.
  const mine = isAdmin() && !isOwner() ? myLocations() : [profile && profile.location_id].filter(Boolean);
  if (toolFilter === "mine" && !mine.length) toolFilter = "all";
  const pills = [["all", "All", tools.length],
    ["out", "Checked out", tools.filter(t => toolOutCount(t) > 0).length]]
    .concat(mine.length ? [["mine", mine.length > 1 ? "My locations" : shopName(mine[0]),
      tools.filter(t => mine.includes(t.location_id)).length]] : []);

  return hero("Special Tools", "Where every special tool lives, and where it is right now.")
    + `<div class="st">
      <div class="st-controls">
        <input class="search" id="toolSearch" placeholder="Name or part number"
               value="${esc(toolQuery)}" autocomplete="off" aria-label="Search special tools">
        ${canAddTools() ? `<button type="button" class="st-add" data-tool-add>${icon("plus", 16)}Add a tool</button>` : ""}
      </div>
      <div class="cab-pills">${pills.map(([id, label, n]) => `
        <button type="button" class="cab-pill${toolFilter === id ? " on" : ""}"
          data-tool-filter="${id}">${esc(label)}<span>${n}</span></button>`).join("")}</div>
      <div class="st-list" id="toolList">${toolRowsHtml()}</div>
      <p class="st-how">${icon("info", 16)}<span>Need one? Your location admin asks the admin at the
        tool's home location, who checks it out to you, and back in when it's returned.</span></p>
    </div>`;
}

function toolRowsHtml() {
  const mine = isAdmin() && !isOwner() ? myLocations() : [profile && profile.location_id].filter(Boolean);
  const shown = tools.filter(t => toolMatches(t, toolQuery)
    && (toolFilter !== "out" || toolOutCount(t) > 0)
    && (toolFilter !== "mine" || mine.includes(t.location_id)));
  if (!shown.length) {
    const why = !tools.length
        ? (canAddTools() ? "No special tools yet. Add the first with Add a tool." : "No special tools have been added yet.")
      : toolQuery ? `Nothing matches "${toolQuery}".`
      : toolFilter === "out" ? "Nothing is checked out. Every tool is at home."
      : `No special tools live at ${shopName(mine)} yet.`;
    return `<p class="st-empty">${esc(why)}</p>`;
  }
  // Out is the thing to notice, so those are the ones in amber.
  return shown.map(t => {
    const out = toolOutCount(t) > 0;
    return `<button type="button" class="st-row cab-card" data-view="tool" data-tool="${esc(t.id)}"
        style="${lit(out ? "amber" : "deep")}">
      <span class="st-main">
        <b>${esc(t.name)}</b>
        <span class="st-sub"><span class="st-pn">${esc(t.part_number)}</span>
          <span>${esc(shopName(t.location_id))} · Qty ${t.quantity}</span></span>
        <span class="st-status">${icon(out ? "arrowOut" : "checkCircle", 14)}${esc(toolStatusText(t))}</span>
      </span>
      <span class="cab-chev" aria-hidden="true">&rsaquo;</span>
    </button>`;
  }).join("");
}

document.addEventListener("input", (event) => {
  if (event.target.id !== "toolSearch") return;
  toolQuery = event.target.value.trim();
  $("toolList").innerHTML = toolRowsHtml();
});

// ---- special tools: one tool

function toolView() {
  const t = tools.find(x => x.id === openToolId);
  if (!t) {
    return hero("Special Tool") + `<div class="sr-empty"><b>This tool isn't in the list any more.</b>
      <p><button type="button" class="ghost" data-view="tools">Back to the list</button></p></div>`;
  }
  const home = shopName(t.location_id), out = toolOutCount(t), atHome = Math.max(0, t.quantity - out);
  const manage = canManageTool(t);
  const answered = activeToolFields().map(f => [f, (t.extra || {})[f.id]]).filter(([, v]) => v);
  const open = toolOpen(t), history = toolHistory(t);
  const notice = toolNotice;
  toolNotice = "";

  // Where it is now, and the one thing to do about it.
  let action;
  if (!manage) {
    // The way to get one: through your own admin, to the location that owns it.
    action = `<p class="st-hint">${icon("info", 16)}<span>${profile && t.location_id === profile.location_id
      ? "Need it? Ask your location admin. They check it out to you, and back in when it's returned."
      : `Need it? Your location admin asks the ${esc(home)} admin, who checks it out to you and back in when it's returned.`}</span></p>`;
  } else if (toolCheckingOut && atHome > 0) {
    action = checkoutFormHtml(t, atHome);
  } else if (atHome > 0) {
    action = `<div class="row"><button type="button" class="st-out" data-tool-checkout>${
      icon("arrowOut", 16)}Check out</button></div>`;
  } else {
    action = `<p class="st-hint">None at ${esc(home)} to check out.</p>`;
  }

  return hero(t.name, t.part_number)
    + `<div class="st-detail">
      <div class="st-facts">
        <div style="${lit("slate")}"><b>${esc(home)}</b><span>Home</span></div>
        <div style="${lit("steel")}"><b>${t.quantity}</b><span>Quantity</span></div>
        <div style="${lit("deep")}"><b>${atHome}</b><span>At home</span></div>
        <div style="${lit(out ? "amber" : "steel")}"><b>${out}</b><span>Checked out</span></div>
      </div>

      ${t.description || answered.length ? `<div class="card st-about">
        ${t.description ? `<p class="st-desc">${esc(t.description).replace(/\n/g, "<br>")}</p>` : ""}
        ${answered.length ? `<dl class="st-fields">${answered.map(([f, v]) =>
          `<div><dt>${esc(f.label)}</dt><dd>${esc(toolFieldText(f, v))}</dd></div>`).join("")}</dl>` : ""}
      </div>` : ""}

      <div class="st-where${out ? " out" : ""}">
        <div class="st-where-head">${icon(out ? "arrowOut" : "checkCircle", 20)}<b>${
          esc(out ? toolOutLead(t) : toolStatusText(t))}</b></div>
        ${notice ? `<p class="error st-notice">${esc(notice)}</p>` : ""}
        ${open.map(c => `<div class="st-trip">
          <div><b>${c.quantity} at ${esc(shopName(c.to_location_id))}</b>
            <span>Since ${esc(toolDay(c.checked_out_at))} · by ${esc(c.checked_out_by_name || "an administrator")}</span>
            ${c.note ? `<span class="st-note">${esc(c.note)}</span>` : ""}</div>
          ${manage ? `<button type="button" class="ghost" data-tool-checkin="${esc(c.id)}">Check in</button>` : ""}
        </div>`).join("")}
        ${action}
      </div>

      ${history.length ? `<div class="group-title">History</div>
        <div class="card st-history">${history.slice(0, 15).map(c => `<div class="st-past">
          <b>${c.quantity} to ${esc(shopName(c.to_location_id))}</b>
          <span>${esc(toolDay(c.checked_out_at))} – ${esc(toolDay(c.returned_at))} · out by ${
            esc(c.checked_out_by_name || "an administrator")}${
            c.returned_by_name ? `, in by ${esc(c.returned_by_name)}` : ""}</span>
          ${c.note ? `<span>${esc(c.note)}</span>` : ""}
        </div>`).join("")}</div>` : ""}

      ${manage ? `<div class="row st-manage">
        <button type="button" class="ghost" data-tool-edit>${icon("pencil", 15)}Edit</button>
        <button type="button" class="ghost danger" data-tool-delete>${icon("trash", 15)}Delete</button>
        <span class="msg"></span>
      </div>` : ""}
    </div>`;
}

// Where it's going, how many, and a note for who has it. The destination is a
// location; the note carries anything finer than that.
function checkoutFormHtml(t, atHome) {
  // Anywhere but home: checking a tool out to its own location isn't "out".
  const places = allLocations.filter(l => l.is_active !== false && l.id !== t.location_id);
  return `<div class="st-checkout">
    <div class="fields">
      <div><label for="coTo">Going to</label>
        <select id="coTo"><option value="">Choose a location</option>${places.map(l =>
          `<option value="${esc(l.id)}">${esc(l.name)}</option>`).join("")}</select></div>
      ${atHome > 1 ? `<div><label for="coQty">How many</label>
        <input id="coQty" type="number" min="1" max="${atHome}" value="1"></div>` : ""}
      <div class="wide"><label for="coNote">Who has it, or which job (optional)</label>
        <input id="coNote" type="text" maxlength="200"></div>
    </div>
    <p class="note">Everyone sees it as out, and where, until it's checked back in.
      ${atHome} at ${esc(shopName(t.location_id))} now.</p>
    <div class="row">
      <button type="button" data-tool-checkout-save>Check out</button>
      <button type="button" class="ghost" data-tool-checkout-cancel>Cancel</button>
      <span class="msg"></span>
    </div>
  </div>`;
}

document.addEventListener("click", async (event) => {
  const b = event.target.closest("[data-tool-filter], [data-tool-add], [data-tool-checkout], "
    + "[data-tool-checkout-save], [data-tool-checkout-cancel], [data-tool-checkin], "
    + "[data-tool-edit], [data-tool-delete]");
  if (!b) return;
  const t = tools.find(x => x.id === openToolId);
  const say = (text, bad) => speak(b.closest(".row"), text, bad);

  if (b.dataset.toolFilter) {
    toolFilter = b.dataset.toolFilter;
    return redraw("tools");
  }

  if (b.hasAttribute("data-tool-add")) {
    // A new tool starts at your own location. An owner can change that; a
    // location admin can't.
    toolDraft = { mode: "add", name: "", part_number: "", description: "",
      location_id: (profile && profile.location_id) || "", quantity: 1, extra: {} };
    return showView("toolform");
  }
  if (!t) return;

  if (b.hasAttribute("data-tool-checkout")) {
    toolCheckingOut = true;
    redraw("tool");
    return $("coTo") && $("coTo").focus();
  }
  if (b.hasAttribute("data-tool-checkout-cancel")) {
    toolCheckingOut = false;
    return redraw("tool");
  }

  if (b.hasAttribute("data-tool-checkout-save")) {
    const atHome = Math.max(0, t.quantity - toolOutCount(t));
    const to = $("coTo").value;
    const quantity = $("coQty") ? Number($("coQty").value) : 1;
    const note = $("coNote").value.trim();
    if (!to) return say("Where is it going?", true);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > atHome) {
      return say(`Only ${atHome} at ${shopName(t.location_id)} to check out.`, true);
    }
    say("Checking out…", false);
    // Who and when are stamped by the database.
    const { error } = await db.from("special_tool_checkouts")
      .insert({ tool_id: t.id, to_location_id: to, quantity, note });
    if (error) return say(toolSentence(error, "", NOT_HOME_SHOP), true);
    toolCheckingOut = false;
    await loadTools();
    return redraw("tool");
  }

  if (b.dataset.toolCheckin) {
    const trip = toolOpen(t).find(c => c.id === b.dataset.toolCheckin);
    if (!trip) return;
    if (!confirm(`Check in ${trip.quantity} from ${shopName(trip.to_location_id)}?\n\n`
        + `Only once it's back at ${shopName(t.location_id)}.`)) return;
    b.disabled = true;
    // The time and who are replaced by the database's own, in its trigger.
    const { data, error } = await db.from("special_tool_checkouts")
      .update({ returned_at: new Date().toISOString() })
      .eq("id", trip.id).is("returned_at", null).select("id");
    await loadTools();
    if (error) {
      toolNotice = toolSentence(error, "", NOT_HOME_SHOP);
    } else if (!data || !data.length) {
      // Nothing matched. Either someone checked it in a moment ago, which the
      // reload now shows, or it isn't this person's to check in.
      const now = tools.find(x => x.id === t.id);
      toolNotice = now && toolOpen(now).some(c => c.id === trip.id)
        ? NOT_HOME_SHOP : "That was already checked back in.";
    }
    return redraw("tool");
  }

  if (b.hasAttribute("data-tool-edit")) {
    toolDraft = { mode: "edit", id: t.id, name: t.name, part_number: t.part_number,
      description: t.description || "", location_id: t.location_id, quantity: t.quantity,
      extra: { ...(t.extra || {}) } };
    return showView("toolform");
  }

  if (b.hasAttribute("data-tool-delete")) {
    if (!confirm(`Delete ${t.name}?\n\nIt comes off the list for every location, with its checkout history.`)) return;
    say("Deleting…", false);
    const { data, error } = await db.from("special_tools").delete().eq("id", t.id).select("id");
    if (error) return say(toolSentence(error), true);
    if (!data || !data.length) return say(NOT_YOURS, true);
    await loadTools();
    return showView("tools");
  }
});

// ---- special tools: adding one, or changing one

function toolFormView() {
  const d = toolDraft;
  if (!d) return hero("Special Tool") + `<div class="sr-empty">
    <p><button type="button" class="ghost" data-view="tools">Back to the list</button></p></div>`;
  const owner = isOwner();
  // Active locations, plus the tool's own if it has since been switched off, so
  // an old tool's home still shows. An admin covering another location picks
  // between the ones they look after.
  const shops = allLocations.filter(l => (l.is_active !== false || l.id === d.location_id)
    && (owner || myLocations().includes(l.id) || l.id === d.location_id));
  const choose = owner || myLocations().length > 1;
  const fields = activeToolFields();

  return hero(d.mode === "add" ? "Add a Tool" : "Edit Tool",
      d.mode === "add" ? "It's in every location's list as soon as it's saved." : `${d.name} · ${d.part_number}`)
    + `<div class="st-form" data-tool-form>
      <div class="card">
        <div class="fields">
          <div class="wide"><label for="tfName">Name</label>
            <input id="tfName" type="text" maxlength="120" placeholder="What it's called" value="${esc(d.name)}"></div>
          <div><label for="tfPart">Part number</label>
            <input id="tfPart" class="mono" type="text" maxlength="60" placeholder="As on the tool"
                   autocapitalize="characters" spellcheck="false" value="${esc(d.part_number)}"></div>
          <div><label for="tfQty">Quantity</label>
            <input id="tfQty" type="number" min="1" max="999" value="${esc(d.quantity)}"></div>
          <div class="wide"><label for="tfDesc">Description</label>
            <textarea id="tfDesc" rows="3" maxlength="1000"
              placeholder="Optional: what it's for, what it fits">${esc(d.description)}</textarea></div>
          <div class="wide"><label for="tfHome">Home location</label>
            ${choose ? `<select id="tfHome"><option value="">Choose a location</option>${shops.map(l =>
              `<option value="${esc(l.id)}"${l.id === d.location_id ? " selected" : ""}>${esc(l.name)}</option>`).join("")}</select>`
            : `<input id="tfHome" type="text" value="${esc(shopName(d.location_id))}" disabled>`}</div>
        </div>
        <p class="note">The part number is what makes a tool unique. No two tools share one, so a
          second of the same tool is its quantity going up. ${owner
          ? "The home location is where it lives when it isn't checked out."
          : choose ? "Tools you add live at one of the locations you look after. An owner can move one anywhere."
          : "Tools you add live at your own location. An owner can move one to another location."}</p>
      </div>
      ${fields.length ? `<div class="card">
        <h2>Details</h2>
        <div class="fields">${fields.map(f => toolFieldInput(f, (d.extra || {})[f.id] || "")).join("")}</div>
        <p class="note">These fields are set by an owner on the admin page.</p>
      </div>` : ""}
      <div class="row">
        <button type="button" data-tool-save>${d.mode === "add" ? "Add tool" : "Save changes"}</button>
        <button type="button" class="ghost" data-tool-cancel>Cancel</button>
        <span class="msg"></span>
      </div>
    </div>`;
}

// One of the owner's fields, as the input its type calls for.
function toolFieldInput(f, value) {
  const id = `tfx-${f.id}`, attrs = `id="${esc(id)}" data-tx="${esc(f.id)}"`;
  const option = (v, label = v) => `<option value="${esc(v)}"${v === value ? " selected" : ""}>${esc(label)}</option>`;
  let input;
  switch (f.field_type) {
    case "long_text":
      input = `<textarea ${attrs} rows="3" placeholder="Not set">${esc(value)}</textarea>`; break;
    case "number":
      input = `<input ${attrs} type="text" inputmode="decimal" placeholder="Not set" value="${esc(value)}">`; break;
    case "date":
      input = `<input ${attrs} type="date" value="${esc(value)}">`; break;
    case "choice": {
      // An old answer since taken off the list stays, so opening the form
      // doesn't quietly blank it.
      const choices = (f.options || []).slice();
      if (value && !choices.includes(value)) choices.push(value);
      input = `<select ${attrs}>${option("", "Not set")}${choices.map(c => option(c)).join("")}</select>`; break;
    }
    case "yes_no":
      input = `<select ${attrs}>${option("", "Not set")}${option("Yes")}${option("No")}</select>`; break;
    default:
      input = `<input ${attrs} type="text" placeholder="Not set" value="${esc(value)}">`;
  }
  return `<div${f.field_type === "long_text" ? ' class="wide"' : ""}>
    <label for="${esc(id)}">${esc(f.label)}${f.is_required ? ' <span class="req">(required)</span>' : ""}</label>
    ${input}${f.help_text ? `<small class="note st-help">${esc(f.help_text)}</small>` : ""}</div>`;
}

document.addEventListener("click", async (event) => {
  const b = event.target.closest("[data-tool-save], [data-tool-cancel]");
  if (!b || !toolDraft) return;
  const d = toolDraft;

  if (b.hasAttribute("data-tool-cancel")) {
    toolDraft = null;
    return showView(d.mode === "add" ? "tools" : "tool");
  }

  const form = b.closest("[data-tool-form]");
  const say = (text, bad) => speak(b.closest(".row"), text, bad);
  const tidy = (s) => s.trim().replace(/\s+/g, " ");
  // Answers to fields that are hidden now are kept, so saving doesn't wipe them.
  const extra = { ...(d.extra || {}) };
  form.querySelectorAll("[data-tx]").forEach(el => { extra[el.dataset.tx] = el.value.trim(); });
  Object.keys(extra).forEach(k => { if (!String(extra[k] || "").trim()) delete extra[k]; });
  const row = {
    name: tidy($("tfName").value), part_number: tidy($("tfPart").value),
    // Line breaks kept: a description can be a short list.
    description: $("tfDesc").value.trim(),
    location_id: $("tfHome").tagName === "SELECT" ? $("tfHome").value : d.location_id,
    quantity: Number($("tfQty").value),
    extra
  };
  Object.assign(d, row);

  // What's still missing, in the order someone would fix it.
  const problem = !row.name ? "What's the tool called?"
    : !row.part_number ? "Every tool needs its part number."
    : !row.location_id ? "Which location is its home?"
    : !(Number.isInteger(row.quantity) && row.quantity >= 1 && row.quantity <= 999)
      ? "The quantity has to be between 1 and 999."
    : row.description.length > 1000 ? "The description is too long. Keep it under 1,000 characters."
    : activeToolFields().map(f => {
        const v = extra[f.id];
        if (f.is_required && !v) return `${f.label} is required.`;
        if (f.field_type === "number" && v && !isFinite(Number(v.replace(/,/g, "")))) {
          return `${f.label} has to be a number.`;
        }
        return null;
      }).find(Boolean);
  if (problem) return say(problem, true);

  say("Saving…", false);
  let saved;
  if (d.mode === "add") {
    const { data, error } = await db.from("special_tools").insert(row).select("id");
    if (error) return say(toolSentence(error, row.part_number), true);
    saved = data && data[0] && data[0].id;
  } else {
    // Asked to return the row, because a change the rules don't allow updates
    // nothing rather than failing.
    const { data, error } = await db.from("special_tools").update(row).eq("id", d.id).select("id");
    if (error) return say(toolSentence(error, row.part_number), true);
    if (!data || !data.length) return say(NOT_YOURS, true);
    saved = d.id;
  }
  await loadTools();
  toolDraft = null;
  if (!saved) return showView("tools");
  openToolId = saved;
  toolCheckingOut = false;
  showView("tool");
});

// ---- special tools: the admin tab

function renderToolsAdmin() {
  const box = $("toolsSummary");
  if (!box) return;
  if (toolsError) {
    box.innerHTML = `<p class="error">${esc(toolsError)} Run migration 0061 in the SQL editor first.</p>`;
  } else {
    const out = tools.filter(t => toolOutCount(t) > 0).length;
    const perShop = {};
    tools.forEach(t => { perShop[t.location_id] = (perShop[t.location_id] || 0) + 1; });
    const shops = Object.entries(perShop)
      .sort((a, b) => shopName(a[0]).localeCompare(shopName(b[0])))
      .map(([id, n]) => `${esc(shopName(id))} ${n}`).join(", ");
    box.innerHTML = `<p class="note"><b>${tools.length}</b> ${tools.length === 1 ? "tool" : "tools"}
      · <b>${out}</b> checked out${shops ? ` · ${shops}` : ""}.</p>`;
  }
  renderToolFields();
}

function renderToolFields() {
  const list = $("toolFieldList");
  if (!list) return;
  if (!$("newToolFieldType").options.length) {
    $("newToolFieldType").innerHTML = TOOL_TYPES
      .map(([value, label]) => `<option value="${value}">${label}</option>`).join("");
  }
  const yesNo = (on) => `<option value="yes"${on ? " selected" : ""}>Yes</option>`
    + `<option value="no"${on ? "" : " selected"}>No</option>`;
  list.innerHTML = [...toolFields]
    .sort((a, b) => (a.sort_order - b.sort_order) || a.label.localeCompare(b.label))
    .map(f => `<div class="tool-field" data-tool-field="${esc(f.id)}">
      <div class="fields">
        <div><label>Name</label>
          <input type="text" data-tf="label" maxlength="60" value="${esc(f.label)}"></div>
        <div><label>Type</label>
          <select data-tf="field_type">${TOOL_TYPES.map(([value, label]) =>
            `<option value="${value}"${f.field_type === value ? " selected" : ""}>${label}</option>`).join("")}</select></div>
        <div class="wide"><label>Choices, for a pick list — separated by commas</label>
          <input type="text" data-tf="options" value="${esc((f.options || []).join(", "))}"></div>
        <div class="wide"><label>Help text (optional)</label>
          <input type="text" data-tf="help_text" maxlength="200" value="${esc(f.help_text || "")}"></div>
        <div><label>Required</label><select data-tf="is_required">${yesNo(f.is_required)}</select></div>
        <div><label>Showing</label><select data-tf="is_active">${yesNo(f.is_active)}</select></div>
        <div><label>Order</label>
          <input type="number" data-tf="sort_order" value="${esc(f.sort_order)}"></div>
      </div>
      <div class="row">
        <button data-act="tool-field-save">Save</button>
        <button class="ghost" data-act="tool-field-delete">Delete</button>
        <span class="msg"></span>
      </div>
    </div>`).join("")
    || `<p class="note">No extra fields yet. Name one below and pick its type.</p>`;
}

function toolFieldFromEditor(box) {
  const get = (key) => box.querySelector(`[data-tf="${key}"]`).value;
  const options = get("options").split(",").map(o => o.trim()).filter(Boolean)
    .filter((o, i, all) => all.findIndex(x => x.toLowerCase() === o.toLowerCase()) === i);
  return {
    label: get("label").trim().replace(/\s+/g, " "),
    field_type: get("field_type"),
    options,
    help_text: get("help_text").trim(),
    is_required: get("is_required") === "yes",
    is_active: get("is_active") === "yes",
    sort_order: parseInt(get("sort_order"), 10) || 0
  };
}

// The name is also the column heading in the CSV, so it has to be unique and
// can't be one of the fixed columns.
function toolFieldProblem(row, id) {
  if (!row.label) return "A field needs a name.";
  const lower = row.label.toLowerCase();
  if ([...TOOL_COLUMNS, ...TOOL_READ_ONLY].some(c => c.toLowerCase() === lower)) {
    return `"${row.label}" is one of the fixed columns already. Pick another name.`;
  }
  if (toolFields.some(f => f.id !== id && f.label.trim().toLowerCase() === lower)) {
    return `There's already a field called "${row.label}".`;
  }
  if (row.field_type === "choice" && row.is_active && !row.options.length) {
    return "A pick list needs at least one choice before it can show.";
  }
  return null;
}

const toolFieldError = (error) => /special_tool_fields_label_key|duplicate/i.test(error.message)
  ? "There's already a field with that name." : error.message;

document.addEventListener("click", async (event) => {
  const button = event.target.closest('button[data-act^="tool-field-"]');
  if (!button) return;
  const act = button.dataset.act;

  if (act === "tool-field-add") {
    const row = {
      label: $("newToolFieldLabel").value.trim().replace(/\s+/g, " "),
      field_type: $("newToolFieldType").value, options: [], help_text: "",
      is_required: false, is_active: true,
      sort_order: toolFields.reduce((m, f) => Math.max(m, f.sort_order || 0), 0) + 10
    };
    // A pick list starts hidden: an empty one would show on every phone.
    if (row.field_type === "choice") row.is_active = false;
    const where = button.closest(".row");
    const problem = toolFieldProblem(row, null);
    if (problem) return speak(where, problem, true);
    const { error } = await db.from("special_tool_fields").insert(row);
    if (error) return speak(where, toolFieldError(error), true);
    $("newToolFieldLabel").value = "";
    await loadTools();
    renderToolFields();
    return speak(where, row.field_type === "choice"
      ? `Added "${row.label}", hidden for now. Type its choices, set Showing to Yes and Save.`
      : `Added "${row.label}". It's on the app's form now.`, false);
  }

  const box = button.closest("[data-tool-field]");
  const field = toolFields.find(f => f.id === box.dataset.toolField);
  if (!field) return;

  if (act === "tool-field-save") {
    const row = toolFieldFromEditor(box);
    const problem = toolFieldProblem(row, field.id);
    if (problem) return speak(box, problem, true);
    const { data, error } = await db.from("special_tool_fields")
      .update(row).eq("id", field.id).select();
    if (error) return speak(box, toolFieldError(error), true);
    if (!data || !data.length) return speak(box, "Nothing changed — only an owner can change the form.", true);
    Object.assign(field, data[0]);
    return speak(box, "Saved. Phones pick it up the next time the list is opened.", false);
  }

  if (act === "tool-field-delete") {
    const used = tools.filter(t => (t.extra || {})[field.id]).length;
    const ok = confirm(`Delete the field "${field.label}"?`
      + (used ? `\n\n${used} ${used === 1 ? "tool has an answer" : "tools have answers"} for it. `
        + "Those stay with the tools but are no longer shown. To stop asking and keep them, "
        + "set Showing to No instead." : ""));
    if (!ok) return;
    const { error } = await db.from("special_tool_fields").delete().eq("id", field.id);
    if (error) return speak(box, error.message, true);
    await loadTools();
    renderToolFields();
  }
});

// ---- special tools: download and upload

function toolFieldColumns() { return activeToolFields().map(f => f.label); }

function toolExport() {
  const fields = activeToolFields();
  return [[...TOOL_COLUMNS, ...toolFieldColumns(), ...TOOL_READ_ONLY],
    ...tools.map(t => [
      t.part_number, t.name, t.description || "", shopName(t.location_id), t.quantity,
      ...fields.map(f => toolFieldText(f, (t.extra || {})[f.id])),
      toolOutCount(t) || "",
      toolOpen(t).map(c => `${c.quantity} at ${shopName(c.to_location_id)} since `
        + `${localDay(c.checked_out_at)}${c.note ? ` (${c.note})` : ""}`).join("; ")
    ])];
}

function toolTemplate() {
  const shop = (allLocations.find(l => l.is_active !== false) || { name: "Pasco" }).name;
  const blanks = toolFieldColumns().map(() => "");
  return [[...TOOL_COLUMNS, ...toolFieldColumns()],
    ["ACW1234560", "Injector puller", "Pulls common-rail injectors", shop, 2, ...blanks],
    ["ACX2201400", "Hydraulic pressure test kit", "", shop, 1, ...blanks]];
}

// A cell as the database keeps it: dates yyyy-mm-dd, yes/no as Yes or No, a
// pick-list answer spelled as the list spells it. Null when it can't be.
function toolFieldFromSheet(field, raw, text) {
  switch (field.field_type) {
    case "number": {
      const plain = text.replace(/,/g, "");
      return plain !== "" && isFinite(Number(plain)) ? plain : null;
    }
    case "date": {
      // toISODate checks the shape, not the calendar: 13/45/2026 would pass.
      const iso = excelDate(raw) || toISODate(text);
      if (!iso) return null;
      const [y, m, d] = iso.split("-").map(Number);
      const real = new Date(Date.UTC(y, m - 1, d));
      return real.getUTCFullYear() === y && real.getUTCMonth() === m - 1 && real.getUTCDate() === d
        ? iso : null;
    }
    case "yes_no": {
      const b = toBool(text);
      return b === null ? null : (b ? "Yes" : "No");
    }
    case "choice":
      return (field.options || []).find(o => o.toLowerCase() === text.toLowerCase()) || null;
    default: return text;
  }
}

// What's different about one tool, in words, for the preview.
function toolChanges(before, row) {
  const changes = [];
  if (before.name !== row.name) changes.push(`name → ${row.name}`);
  if ((before.description || "") !== row.description) changes.push("description");
  if (before.location_id !== row.location_id) {
    changes.push(`home ${shopName(before.location_id)} → ${shopName(row.location_id)}`);
  }
  if (before.quantity !== row.quantity) changes.push(`quantity ${before.quantity} → ${row.quantity}`);
  for (const f of toolFields) {
    const a = (before.extra || {})[f.id] || "", b = (row.extra || {})[f.id] || "";
    if (a !== b) changes.push(f.label.toLowerCase());
  }
  return changes;
}

async function importTools(file) {
  const result = $("toolsResult");
  const say = (html, cls) => { result.innerHTML = `<p class="${cls}">${html}</p>`; };
  toolImport = null;
  if (toolsError) return say("Run migration 0061 in the SQL editor first.", "error");

  let rows;
  try { rows = await rowsFromFile(file); }
  catch (e) { return say(`Couldn't read that file: ${esc(e.message)}`, "error"); }

  const headAt = rows.findIndex(r => (r || []).some(c => String(c ?? "").trim().toLowerCase() === "part number"));
  if (headAt < 0) {
    return say("There's no <b>Part Number</b> heading in that file. Start from the blank sheet "
      + "or the download.", "error");
  }
  const heads = rows[headAt].map(c => String(c ?? "").trim().toLowerCase());
  const col = (...names) => names.map(n => heads.indexOf(n)).find(i => i >= 0) ?? -1;
  const at = { part: col("part number"), name: col("name"), description: col("description"),
               home: col("home location", "home shop", "location"), qty: col("quantity", "qty") };
  const missing = [["Name", at.name], ["Home Location", at.home], ["Quantity", at.qty]]
    .filter(([, i]) => i < 0).map(([n]) => `<b>${n}</b>`);
  if (missing.length) return say(`That file has no ${missing.join(", ")} column.`, "error");

  const fieldCols = toolFields.map(f => [f, heads.indexOf(f.label.trim().toLowerCase())])
    .filter(([, i]) => i >= 0);
  const shopIds = new Map();
  allLocations.forEach(l => {
    shopIds.set(l.name.trim().toLowerCase(), l.id);
    shopIds.set(String(l.id).toLowerCase(), l.id);
  });
  const existing = new Map(tools.map(t => [partKey(t.part_number), t]));
  const problems = [], seen = new Set(), incoming = [];

  rows.slice(headAt + 1).forEach((r, i) => {
    const line = headAt + i + 2;              // the row number the spreadsheet shows
    const part = cell(r, at.part).replace(/\s+/g, " ");
    const name = cell(r, at.name).replace(/\s+/g, " ");
    if (!part && !name) return;               // a blank line
    if (!part) return problems.push(`Row ${line}: ${esc(name)} has no part number.`);
    if (!name) return problems.push(`Row ${line}: ${esc(part)} has no name.`);
    const key = partKey(part);
    if (seen.has(key)) return problems.push(`Row ${line}: ${esc(part)} is in the file more than once.`);
    seen.add(key);
    // Every mistake on the row at once, so it's fixed in one go rather than
    // one upload per mistake.
    const before = problems.length;
    const home = shopIds.get(cell(r, at.home).toLowerCase());
    if (!home) problems.push(`Row ${line}: "${esc(cell(r, at.home))}" isn't one of the locations.`);
    const qtyText = cell(r, at.qty), qty = Number(qtyText);
    if (!Number.isInteger(qty) || qty < 1 || qty > 999) {
      problems.push(`Row ${line}: ${esc(part)} needs a whole-number quantity from 1 to 999`
        + (qtyText ? `, not "${esc(qtyText)}".` : "."));
    }
    const current = existing.get(key);
    // Start from what the tool has, so a field the file has no column for
    // keeps its answer; a column that's there but blank clears it.
    const extra = { ...((current && current.extra) || {}) };
    for (const [f, idx] of fieldCols) {
      const text = cell(r, idx);
      if (!text) { delete extra[f.id]; continue; }
      const value = toolFieldFromSheet(f, r[idx], text);
      if (value === null) {
        problems.push(`Row ${line}: ${esc(part)}'s ${esc(f.label)} can't be "${esc(text)}"`
          + (f.field_type === "choice" ? ` — it's one of: ${esc((f.options || []).join(", "))}.` : "."));
        continue;
      }
      extra[f.id] = value;
    }
    if (problems.length > before) return;
    incoming.push({
      part_number: part, name, location_id: home, quantity: qty, extra,
      description: at.description >= 0 ? cell(r, at.description) : ((current && current.description) || ""),
      before: current
    });
  });

  if (!incoming.length && !problems.length) return say("No tools found in that file.", "error");

  // The same refusals the database makes, said before anything is sent.
  const removed = tools.filter(t => !seen.has(partKey(t.part_number)));
  removed.filter(t => toolOutCount(t) > 0).forEach(t => problems.push(
    `${esc(t.name)} (${esc(t.part_number)}) isn't in the file but is checked out, so it can't be `
    + "removed. Check it in first, or keep it in the file."));
  incoming.filter(r => r.before && toolOutCount(r.before) > 0).forEach(r => {
    const out = toolOutCount(r.before);
    if (r.location_id !== r.before.location_id) {
      problems.push(`${esc(r.name)} (${esc(r.part_number)}) is checked out, so it can't move to `
        + `${esc(shopName(r.location_id))} until it's checked back in.`);
    }
    if (r.quantity < out) {
      problems.push(`${esc(r.name)} (${esc(r.part_number)}) has ${out} checked out, so its quantity `
        + `can't go down to ${r.quantity}.`);
    }
  });

  if (problems.length) {
    result.innerHTML = `<div class="tool-preview"><p class="error" style="margin-top:0">Nothing was
      changed. Fix ${problems.length === 1 ? "this" : `these ${problems.length}`} and upload again:</p>
      <ul>${problems.slice(0, 15).map(p => `<li>${p}</li>`).join("")}</ul>
      ${problems.length > 15 ? `<p class="note">…and ${problems.length - 15} more.</p>` : ""}</div>`;
    return;
  }

  const added = incoming.filter(r => !r.before);
  const changed = incoming.filter(r => r.before && toolChanges(r.before, r).length);
  const unchanged = incoming.length - added.length - changed.length;
  const list = (items, text) => items.length
    ? `<ul>${items.slice(0, 20).map(x => `<li>${text(x)}</li>`).join("")}</ul>`
      + (items.length > 20 ? `<p class="note">…and ${items.length - 20} more.</p>` : "") : "";

  toolImport = incoming.map(({ before: _before, ...row }) => row);
  result.innerHTML = `<div class="tool-preview">
    <p style="margin-top:0"><b>Check this before publishing.</b> ${added.length} new,
      ${changed.length} changed, ${unchanged} unchanged, ${removed.length} removed.</p>
    ${added.length ? `<b>New</b>${list(added, r => `${esc(r.name)} (${esc(r.part_number)}) · ${esc(shopName(r.location_id))} · Qty ${r.quantity}`)}` : ""}
    ${changed.length ? `<b>Changed</b>${list(changed, r => `${esc(r.name)} (${esc(r.part_number)}): ${esc(toolChanges(r.before, r).join(", "))}`)}` : ""}
    ${removed.length ? `<b class="gone">Removed — not in the file</b>${list(removed, t => `<span class="gone">${esc(t.name)} (${esc(t.part_number)}) · ${esc(shopName(t.location_id))}</span>`)}` : ""}
    <div class="row">
      <button data-act="tools-publish"${added.length || changed.length || removed.length ? "" : " disabled"}>Publish</button>
      <button class="ghost" data-act="tools-cancel">Cancel</button>
      <span class="msg"></span>
    </div>
  </div>`;
}

document.addEventListener("click", async (event) => {
  const button = event.target.closest('button[data-act="tools-publish"], button[data-act="tools-cancel"]');
  if (!button) return;
  const result = $("toolsResult");
  if (button.dataset.act === "tools-cancel" || !toolImport) {
    toolImport = null;
    result.innerHTML = `<p class="note">Nothing was changed.</p>`;
    return;
  }
  button.disabled = true;
  speak(button.closest(".row"), "Publishing…", false);
  const { data, error } = await db.rpc("import_special_tools", { tools: toolImport });
  if (error) {
    button.disabled = false;
    return speak(button.closest(".row"), error.message, true);
  }
  toolImport = null;
  await loadTools();
  renderToolsAdmin();
  const n = data || {};
  result.innerHTML = `<p class="ok">Published. ${n.added || 0} added, ${n.changed || 0} changed,
    ${n.unchanged || 0} unchanged, ${n.removed || 0} removed.</p>`;
});
