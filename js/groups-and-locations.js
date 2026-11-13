// Groups & Locations
//
// The admin tab for locations and the groups people belong to.

// ---------------------------------------------------------------- groups & locations
//
// Both lists are company-wide, so only an owner can change them (migration
// 0029). A group or location can be switched off, which takes it out of the lists
// people pick from without touching anything already recorded against it, or
// deleted, which is for mistakes and things that are truly gone.

// "Service Writers" -> "service_writers" for a group, "Walla Walla" ->
// "walla-walla" for a location, matching the ids already in use. The id never
// changes after it's made, so renaming later is safe.
function slugify(text, separator) {
  return text.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, separator)
    .split(separator).filter(Boolean).join(separator);
}

const nextSortOrder = (rows) =>
  rows.reduce((max, r) => Math.max(max, r.sort_order || 0), 0) + 10;

const needsMigration = (error) =>
  /is_active|timezone|delete_group|schema cache|does not exist/i.test(error.message)
    ? "Run migration 0029_manage_groups_locations.sql in the SQL editor first, then reload this page."
    : error.message.includes("row-level") ? "Only an owner can change these." : error.message;

const showingSelect = (on) => `
  <select data-o="is_active">
    <option value="yes"${on ? " selected" : ""}>Yes</option>
    <option value="no"${on ? "" : " selected"}>No — switched off</option>
  </select>`;

function renderOrg() {
  const groupBox = $("groupList");
  const shopBox = $("shopList");
  if (!groupBox || !shopBox) return;

  groupBox.innerHTML = workGroups.map(g => {
    const on = g.is_active !== false;
    const count = people.filter(p => (p.groups || []).includes(g.id)).length;
    return `
      <div class="role" style="padding:14px 16px${on ? "" : ";opacity:.6"}" data-group="${esc(g.id)}">
        <div class="fields">
          <div><label>Name</label>
            <input type="text" data-o="name" value="${esc(g.name)}"></div>
          <div><label>Order</label>
            <input type="text" data-o="sort_order" value="${esc(g.sort_order)}"></div>
          <div><label>Showing</label>${showingSelect(on)}</div>
        </div>
        <div class="row">
          <button data-act="save-group">Save</button>
          <button class="ghost" data-act="delete-group">Delete</button>
          <span class="note">${count} ${count === 1 ? "person" : "people"} · id ${esc(g.id)}</span>
          <span class="msg"></span>
        </div>
      </div>`;
  }).join("") || `<p class="note">No groups yet.</p>`;

  // UKG's stores that no location answers to (0132): their people are on no
  // location's lists until one does.
  const unmatched = [...new Set(tsPeople.filter(t => !storeLocation(t.store)).map(t => t.store || "(blank)"))].sort();
  shopBox.innerHTML = (unmatched.length ? `<p class="cq-unmatched">${icon("warning", 15)}<span>UKG's All employees lists ${unmatched.map(st =>
      `<b>${esc(st)}</b> (${tsPeople.filter(t => !storeLocation(t.store) && (t.store || "(blank)") === st).length})`).join(", ")}, and no
      location here answers to ${unmatched.length === 1 ? "it" : "them"}, so those people are on no location's lists. Add the name under
      <b>UKG names</b> on the location it means.</span></p>` : "") + allLocations.map(l => {
    const on = l.is_active !== false;
    const count = people.filter(p => p.location_id === l.id).length;
    const onRoster = tsPeople.filter(t => storeLocation(t.store) === l.id).length;
    const kept = Array.isArray(l.ukg_names);
    const zone = l.timezone || SHOP_ZONES[l.id] || "America/Boise";
    return `
      <div class="role" style="padding:14px 16px${on ? "" : ";opacity:.6"}" data-shop="${esc(l.id)}">
        <div class="fields">
          <div><label>Name</label>
            <input type="text" data-o="name" value="${esc(l.name)}"></div>
          <div><label>Time zone</label>
            <select data-o="timezone">${EVENT_ZONES.map(([v, label]) =>
              `<option value="${v}"${v === zone ? " selected" : ""}>${label}</option>`).join("")}
            </select></div>
          <div><label>Order</label>
            <input type="text" data-o="sort_order" value="${esc(l.sort_order)}"></div>
          <div><label>Showing</label>${showingSelect(on)}</div>
          ${kept ? `<div class="wide"><label>UKG names</label>
            <input type="text" data-o="ukg_names" value="${esc(l.ukg_names.join(", "))}"
              placeholder="Other names UKG's reports use for it, separated by commas">
            <p class="note" style="margin:4px 0 0">UKG's reports find a location by its name, its id, or any of these. Renaming it adds the old name here by itself.</p></div>` : ""}
        </div>
        <div class="row">
          <button data-act="save-shop">Save</button>
          <button class="ghost" data-act="delete-shop">Delete</button>
          <span class="note">${count} ${count === 1 ? "person" : "people"} · ${onRoster} on All employees · id ${esc(l.id)}</span>
          <span class="msg"></span>
        </div>
      </div>`;
  }).join("") || `<p class="note">No locations yet.</p>`;

  const newZone = $("newShopZone");
  if (!newZone.options.length) {
    newZone.innerHTML = EVENT_ZONES.map(([v, label]) =>
      `<option value="${v}">${label}</option>`).join("");
  }
}

$("admin").addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-act]");
  if (!button) return;
  const act = button.dataset.act;
  if (!["add-group", "save-group", "delete-group",
        "add-shop", "save-shop", "delete-shop"].includes(act)) return;

  // ---- adding
  if (act === "add-group" || act === "add-shop") {
    const isGroup = act === "add-group";
    const box = button.closest(".row");
    const nameInput = $(isGroup ? "newGroupName" : "newShopName");
    const name = nameInput.value.trim();
    if (!name) return speak(box, `Type the ${isGroup ? "group" : "location"}'s name first.`, true);

    const id = slugify(name, isGroup ? "_" : "-");
    const existing = isGroup ? workGroups : allLocations;
    if (!id) return speak(box, "That name needs some letters or numbers in it.", true);
    if (existing.some(r => r.id === id)) {
      return speak(box, `There's already one called that (id ${id}).`, true);
    }

    const row = { id, name, sort_order: nextSortOrder(existing), is_active: true };
    if (!isGroup) row.timezone = $("newShopZone").value;

    speak(box, "Adding…", false);
    const { data, error } = await db.from(isGroup ? "groups" : "locations").insert(row).select();
    if (error) return speak(box, needsMigration(error), true);
    if (!data || !data.length) return speak(box, "Nothing added — only an owner can add these.", true);

    nameInput.value = "";
    await loadAll();
    renderOrg();
    return speak(box, isGroup
      ? `Added ${name}. It's in the app's group lists next time they're opened.`
      : `Added ${name}. New people can pick it when they first sign in.`, false);
  }

  const isGroup = act.endsWith("-group");
  const box = button.closest(isGroup ? "[data-group]" : "[data-shop]");
  const id = isGroup ? box.dataset.group : box.dataset.shop;
  const table = isGroup ? "groups" : "locations";
  const record = (isGroup ? workGroups : allLocations).find(r => r.id === id);
  const get = (f) => box.querySelector(`[data-o="${f}"]`).value.trim();
  const count = isGroup
    ? people.filter(p => (p.groups || []).includes(id)).length
    : people.filter(p => p.location_id === id).length;

  // ---- deleting
  if (act === "delete-group") {
    if (!confirm(`Delete the ${record.name} group?\n\n` +
        `${count} ${count === 1 ? "person is" : "people are"} taken out of it. ` +
        `Requests already aimed at it stay as they are, and can still be seen ` +
        `by whoever asked and by admins.\n\n` +
        `To just stop people choosing it, set Showing to No instead.`)) return;
    speak(box, "Deleting…", false);
    const { error } = await db.rpc("delete_group", { target: id });
    if (error) return speak(box, needsMigration(error), true);
    await loadAll();
    return renderOrg();
  }

  if (act === "delete-shop") {
    if (!confirm(`Delete ${record.name}?\n\nThis only works for a location nothing ` +
        `belongs to yet — one added by mistake. For a location that's closed, set ` +
        `Showing to No instead.`)) return;
    speak(box, "Deleting…", false);
    const { data, error } = await db.from("locations").delete().eq("id", id).select();
    if (error) {
      return speak(box, error.code === "23503"
        ? "People, lift plans or events belong to this location, so it can't be deleted. Set Showing to No instead."
        : needsMigration(error), true);
    }
    if (!data || !data.length) return speak(box, "Nothing deleted — only an owner can remove locations.", true);
    await loadAll();
    return renderOrg();
  }

  // ---- saving
  if (!get("name")) return speak(box, "It needs a name.", true);

  const update = {
    name: get("name"),
    sort_order: parseInt(get("sort_order"), 10) || 0,
    is_active: get("is_active") === "yes"
  };
  if (!isGroup) update.timezone = get("timezone");
  // Before 0132 there's no such column, and no box.
  if (!isGroup && box.querySelector('[data-o="ukg_names"]')) {
    update.ukg_names = get("ukg_names").split(",").map(n => n.trim()).filter(Boolean);
  }

  speak(box, "Saving…", false);
  const { data, error } = await db.from(table).update(update).eq("id", id).select();
  if (error) return speak(box, needsMigration(error), true);
  if (!data || !data.length) return speak(box, "Nothing changed — only an owner can edit these.", true);

  await loadAll();
  renderOrg();
  const again = (isGroup ? $("groupList") : $("shopList"))
    .querySelector(`[data-${isGroup ? "group" : "shop"}="${CSS.escape(id)}"]`);
  if (again) speak(again, isGroup
    ? "Saved. Phones pick it up next time the group list is opened."
    : "Saved. Phones pick it up next time the app is opened.", false);
});
