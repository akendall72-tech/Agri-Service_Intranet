// People
//
// The admin page's People tab: every account, roles, names and locations,
// covering a location, employee numbers, designations and deactivating.

function renderPeople() {
  const q = ($("peopleSearch") ? $("peopleSearch").value : "").trim().toLowerCase();
  // Deactivated accounts sink to the bottom rather than disappearing, so there's
  // somewhere to reactivate them from.
  // Email as well as name: an account nobody has named yet is findable by the
  // only thing it has.
  const rows = people.filter(r => !q ||
    (r.full_name || "").toLowerCase().includes(q) ||
    (r.email || "").toLowerCase().includes(q))
    .sort((a, b) => (!!a.deactivated_at) - (!!b.deactivated_at));

  const active = people.filter(r => !r.deactivated_at);
  const byRole = { owner: 0, admin: 0, employee: 0 };
  active.forEach(r => { byRole[r.role] = (byRole[r.role] || 0) + 1; });

  const withoutLocation = active.filter(r => !r.location_id).length;
  const deactivated = people.length - active.length;

  if ($("peopleStats")) {
    $("peopleStats").innerHTML =
      `<span class="stat"><b>${active.length}</b>accounts</span>` +
      `<span class="stat"><b>${byRole.admin + byRole.owner}</b>admins</span>` +
      (withoutLocation
        ? `<span class="stat"><b style="color:var(--red)">${withoutLocation}</b>no location set</span>`
        : "") +
      (deactivated ? `<span class="stat"><b>${deactivated}</b>deactivated</span>` : "");
  }

  // Under the name, so the table fits the page: when the People table ran
  // wider than its card, the Location dropdown sat at the cut-off edge with its
  // arrow hidden, and read as a plain box.
  const account = (r) => {
    if (r.deactivated_at) {
      return `<span class="badge b-none">Deactivated ${esc(new Date(r.deactivated_at).toLocaleDateString())}</span>
        ${isOwner() ? `<button class="pdf" data-account="reactivate" data-id="${esc(r.id)}">Reactivate</button>` : ""}`;
    }
    if (!isOwner() || r.id === me.id) return "";
    return `<button class="pdf" data-account="deactivate" data-id="${esc(r.id)}"
      style="padding:4px 10px;font-size:12.5px">Deactivate</button>`;
  };

  // A deactivated account isn't edited, the same way its role isn't. Your own
  // row is, though — an owner fixing their own spelling can't lock anyone out,
  // which is the only thing the role rule is protecting against.
  const editable = (r) => isOwner() && !r.deactivated_at;

  // Owners only. An owner ticks and unticks; everyone else reads what's held.
  const designationCell = (r) => {
    if (designationsError) return `<span class="note">Run migration 0066</span>`;
    const held = designations.filter(d => personDesignations.some(pd =>
      pd.person_id === r.id && pd.designation_id === d.id));
    if (r.role !== "owner" || r.deactivated_at) {
      return held.length ? esc(held.map(d => d.label).join(", ")) : `<span class="note">—</span>`;
    }
    if (!isOwner()) {
      return held.length ? esc(held.map(d => d.label).join(", ")) : `<span class="note">None</span>`;
    }
    return designations.map(d => `<label class="check" style="margin:2px 0;white-space:nowrap">
        <input type="checkbox" data-designation="${esc(d.id)}" data-person="${esc(r.id)}"${
          held.includes(d) ? " checked" : ""}> ${esc(d.label)}</label>`).join("");
  };

  // The UKG employee number, which finds their training records. Filled in from
  // All employees by work email at each Training Status upload; an owner types
  // it for someone who signs in with a different email.
  const numberCell = (r) => editable(r)
    ? `<label class="note" style="display:flex;align-items:center;gap:6px;font-size:12.5px;margin-top:6px">Employee #
         <input data-number-for="${esc(r.id)}" value="${esc(r.employee_number || "")}" placeholder="from UKG"
           inputmode="numeric" autocomplete="off" style="margin:0;width:90px;padding:4px 8px"></label>`
    : r.employee_number ? `<div class="note" style="font-size:12.5px;margin-top:4px">Employee #${esc(r.employee_number)}</div>` : "";

  // Locations an admin covers besides their own (0099), for when a location
  // has lost its admin. Owners add and take them away; anyone else reads them.
  // Only admins: an owner sees everywhere already, and an employee covers nothing.
  const coversCell = (r) => {
    if (r.role !== "admin" || r.deactivated_at) return "";
    const held = coveredLocations.filter(c => c.person_id === r.id).map(c => c.location_id);
    const name = (id) => locations[id] || id;
    if (!isOwner()) {
      return held.length ? `<div class="note" style="font-size:12.5px;margin-top:6px">Also covers
        ${esc(held.map(name).join(", "))}</div>` : "";
    }
    const options = allLocations.filter(l => l.is_active !== false && l.id !== r.location_id && !held.includes(l.id));
    return `<div class="covers">${held.map(id => `<span class="cover-chip">${esc(name(id))}<button type="button"
        data-cover-remove="${esc(id)}" data-person="${esc(r.id)}" aria-label="Stop covering ${esc(name(id))}"
        title="Stop covering ${esc(name(id))}">&times;</button></span>`).join("")}
      ${options.length ? `<select data-cover-add="${esc(r.id)}" aria-label="Locations ${esc(r.full_name || r.email || "they")} also covers">
        <option value="">${held.length ? "Also covers another…" : "Also covers…"}</option>${options.map(l =>
          `<option value="${esc(l.id)}">${esc(l.name)}</option>`).join("")}</select>` : ""}</div>`;
  };

  const shopPicker = (r) => `<select data-shop-for="${esc(r.id)}" style="margin:0;min-width:130px">
      <option value=""${!r.location_id ? " selected" : ""}>— not set —</option>
      ${allLocations.map(l => `<option value="${esc(l.id)}"${
        r.location_id === l.id ? " selected" : ""}>${esc(l.name)}</option>`).join("")}
    </select>`;

  $("peopleTable").querySelector("tbody").innerHTML = rows.map(r => `<tr${r.deactivated_at ? ' class="gone"' : ""}>
      <td style="min-width:180px">${editable(r)
        ? `<input data-name-for="${esc(r.id)}" value="${esc(r.full_name || "")}"
             placeholder="No name yet" style="margin:0;width:100%;max-width:200px">`
        : `<b>${esc(r.full_name || "—")}</b>`}
        <div class="note" style="font-size:12.5px;margin-top:4px;overflow-wrap:anywhere">${esc(
          [r.id === me.id ? "you" : "", r.email || "no email", groupNames(r.groups)].filter(Boolean).join(" · "))}</div>
        ${numberCell(r)}
        ${account(r) ? `<div style="margin-top:6px">${account(r)}</div>` : ""}</td>
      <td>${editable(r) ? shopPicker(r)
        : r.location_id ? esc(locations[r.location_id] || r.location_id)
        : `<span class="error">not set</span>`}${coversCell(r)}</td>
      <td>${isOwner() && !r.deactivated_at && r.id !== me.id
        ? `<select data-role-for="${esc(r.id)}" style="margin:0;min-width:110px">
            ${["employee", "admin", "owner"].map(role =>
              `<option value="${role}"${r.role === role ? " selected" : ""}>${role}</option>`).join("")}
          </select>`
        : esc(r.role) + (r.id === me.id ? ` <span class="note">· you</span>` : "")}</td>
      <td>${designationCell(r)}</td>
    </tr>`).join("")
    || `<tr><td colspan="4" class="note">Nothing visible to you. If this is only
        your own row, run migration 0021 in the SQL editor.</td></tr>`;
}

// One way in to the account function. Four controls use it now, and the part
// worth getting right — digging the server's own sentence out of a response
// that isn't 2xx, where supabase-js only hands you "Edge Function returned a
// non-2xx status code" — was copied out once per control.
async function accountAction(body) {
  try {
    const { data, error } = await db.functions.invoke("account", { body });
    if (error) {
      let problem = error.message;
      try {
        const sent = await error.context.json();
        if (sent && sent.error) problem = sent.error;
      } catch { /* not JSON — keep the generic message */ }
      if (/failed to send|404|not found/i.test(problem)) {
        problem = "The account function isn't deployed yet.";
      }
      return { problem };
    }
    if (data && data.error) return { problem: data.error };
    return { data: data || {} };
  } catch (e) {
    return { problem: String(e) };
  }
}

// Roles. Through the account function rather than a direct update, because
// protect_profile_columns refuses a role change from anyone signed in — only
// the service role gets through, which is the whole point of that guard.
//
// The function also refuses to change your own role or to demote the last
// owner. Both would leave nobody able to undo it.
document.addEventListener("change", async (event) => {
  const picker = event.target.closest("[data-role-for]");
  if (!picker) return;
  const id = picker.dataset.roleFor;
  const person = people.find(r => r.id === id);
  if (!person) return;
  const role = picker.value;
  const was = person.role;
  const name = person.full_name || "this account";

  const what = { employee: "an employee — their own records only",
                 admin: "a location admin — everyone at their location",
                 owner: "an owner — everyone, everywhere, including this page" };
  if (!confirm(`Make ${name} ${what[role]}?`)) {
    picker.value = was;
    return;
  }

  picker.disabled = true;
  const { problem } = await accountAction({ action: "setRole", id, role });
  picker.disabled = false;

  const card = picker.closest(".card") || $("peopleTable");
  if (problem) {
    picker.value = was;
    return speak(card, problem, true);
  }
  person.role = role;
  // The database takes their designations away with the owner role (0066).
  if (role !== "owner") {
    personDesignations = personDesignations.filter(pd => pd.person_id !== id);
  }
  renderPeople();
  speak(card, `${name} is now an ${role}.`, false);
});

// A name and a location, for somebody who never gets the screen that asks for
// them. Both are chosen once, by the person, on first sign-in in the app —
// so anyone who only ever opens this page has neither, and the guard in
// migration 0007 refuses a second location from anyone signed in. The account
// function holds the service key, where auth.uid() is null and that guard
// stands aside. Owners only, like everything else it does.
// Covering a location: an owner adds one for an admin, or takes it away. The
// database refuses anyone but an owner, and a location that's already theirs.
document.addEventListener("change", async (event) => {
  const pick = event.target.closest("[data-cover-add]");
  if (!pick || !pick.value) return;
  const person = people.find(r => r.id === pick.dataset.coverAdd);
  if (!person) return;
  const loc = pick.value, card = pick.closest(".card") || $("peopleTable");
  pick.disabled = true;
  const { error } = await db.from("covered_locations").insert({ person_id: person.id, location_id: loc });
  if (error) {
    pick.disabled = false; pick.value = "";
    return speak(card, /covered_locations|schema cache|does not exist/i.test(error.message) ? "Run migration 0099 first."
      : /row-level security/i.test(error.message) ? "Only an admin can cover a location, and not their own."
      : `Not saved: ${error.message}`, true);
  }
  coveredLocations = [...coveredLocations, { person_id: person.id, location_id: loc }];
  renderPeople();
  speak(card, `${person.full_name || person.email} now also covers ${locations[loc] || loc}: they're its admin as well as their own location's.`, false);
});
document.addEventListener("click", async (event) => {
  const b = event.target.closest("[data-cover-remove]");
  if (!b) return;
  const person = people.find(r => r.id === b.dataset.person);
  if (!person) return;
  const loc = b.dataset.coverRemove, card = b.closest(".card") || $("peopleTable");
  const name = person.full_name || person.email;
  if (!confirm(`Stop ${name} covering ${locations[loc] || loc}? They go back to looking after ${locations[person.location_id] || "their own location"} only.`)) return;
  b.disabled = true;
  const { error } = await db.from("covered_locations").delete().eq("person_id", person.id).eq("location_id", loc);
  if (error) { b.disabled = false; return speak(card, `Not changed: ${error.message}`, true); }
  coveredLocations = coveredLocations.filter(c => !(c.person_id === person.id && c.location_id === loc));
  renderPeople();
  speak(card, `${name} no longer covers ${locations[loc] || loc}.`, false);
});

// An employee number: owners only, through set_employee_number(), which
// refuses one another account already has.
document.addEventListener("change", async (event) => {
  const field = event.target.closest("[data-number-for]");
  if (!field) return;
  const person = people.find(r => r.id === field.dataset.numberFor);
  if (!person) return;
  const card = field.closest(".card") || $("peopleTable");
  const typed = field.value.trim();
  const clean = typed ? tsEmployeeNumber(typed) : "";
  if (clean === (person.employee_number || "")) { field.value = clean; return; }
  field.disabled = true;
  const { data, error } = await db.rpc("set_employee_number", { target: person.id, new_number: typed });
  field.disabled = false;
  if (error) {
    field.value = person.employee_number || "";
    return speak(card, /already has employee number/.test(error.message) ? error.message
      : /function|schema cache/i.test(error.message) ? "Run migration 0098 first." : `Not saved: ${error.message}`, true);
  }
  person.employee_number = data || null;
  if (person.id === me.id && profile) profile.employee_number = person.employee_number;
  field.value = person.employee_number || "";
  speak(card, person.employee_number
    ? `Saved — ${person.full_name || person.email} is employee #${person.employee_number}.`
    : `Cleared ${person.full_name || person.email}'s employee number.`, false);
});

document.addEventListener("change", async (event) => {
  const field = event.target.closest("[data-name-for], [data-shop-for]");
  if (!field) return;
  const isName = "nameFor" in field.dataset;
  const id = isName ? field.dataset.nameFor : field.dataset.shopFor;
  const person = people.find(r => r.id === id);
  if (!person) return;
  const card = field.closest(".card") || $("peopleTable");
  const who = person.full_name || person.email || "this account";

  if (isName) {
    const typed = field.value.trim().replace(/\s+/g, " ");
    if (!typed) {
      field.value = person.full_name || "";
      return speak(card, "A name can't be blank.", true);
    }
    if (typed === (person.full_name || "")) return;

    field.disabled = true;
    const { data, problem } = await accountAction(
      { action: "setProfile", id, fullName: typed });
    field.disabled = false;
    if (problem) {
      field.value = person.full_name || "";
      return speak(card, problem, true);
    }
    // Deliberately no renderPeople() here: rebuilding the table under
    // somebody who is still typing in it loses the caret and the scroll.
    person.full_name = (data && data.full_name) || typed;
    field.value = person.full_name;
    return speak(card, `Saved — this account is ${person.full_name}.`, false);
  }

  // A location decides which admin reviews that person's lift plans and
  // inspections, so it asks first, the same way a role does.
  const was = person.location_id || "";
  const picked = field.value;
  if (picked === was) return;
  const to = picked ? (locations[picked] || picked) : "no location";
  if (!confirm(`Move ${who} to ${to}?\n\nA location decides which admin sees their lift plans and inspections.`)) {
    field.value = was;
    return;
  }

  field.disabled = true;
  const { problem } = await accountAction(
    { action: "setProfile", id, locationId: picked || null });
  field.disabled = false;
  if (problem) {
    field.value = was;
    return speak(card, problem, true);
  }
  person.location_id = picked || null;
  renderPeople();          // the "no location set" count at the top changes
  speak(card, picked ? `${who} is at ${to}.` : `${who} has no location set.`, false);
});

// Designations: straight to the table, since the rules are in the database —
// owners only, and only onto an owner (0066). A refusal comes back as no row.
document.addEventListener("change", async (event) => {
  const box = event.target.closest("[data-designation]");
  if (!box) return;
  const person = people.find(r => r.id === box.dataset.person);
  const designation = designations.find(d => d.id === box.dataset.designation);
  if (!person || !designation) return;
  const card = box.closest(".card") || $("peopleTable");
  const who = person.full_name || person.email || "this account";
  const giving = box.checked;

  box.disabled = true;
  const query = giving
    ? db.from("person_designations").insert({ person_id: person.id, designation_id: designation.id })
    : db.from("person_designations").delete()
        .eq("person_id", person.id).eq("designation_id", designation.id);
  const { data, error } = await query.select();
  box.disabled = false;

  if (error || !data || !data.length) {
    box.checked = !giving;
    return speak(card, error ? error.message
      : "Nothing changed — only an owner can give or take away a designation.", true);
  }
  if (giving) personDesignations.push(data[0]);
  else personDesignations = personDesignations.filter(pd =>
    !(pd.person_id === person.id && pd.designation_id === designation.id));
  speak(card, giving ? `${who} is now ${designation.label}.`
                     : `${who} is no longer ${designation.label}.`, false);
});

// Leaving the company: the account function blocks sign-in and takes them off
// notifications, and everything they did stays. Owners only.
document.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-account]");
  if (!button) return;
  const person = people.find(r => r.id === button.dataset.id);
  if (!person) return;
  const name = person.full_name || "this account";
  const action = button.dataset.account;
  const ok = action === "deactivate"
    ? confirm(`Deactivate ${name}?\n\nThey won't be able to sign in to the app or this page, they're signed out, and they stop getting notifications. Everything they've done stays, with their name on it.\n\nYou can reactivate them any time.`)
    : confirm(`Reactivate ${name}? They can sign in again with the same email and password.`);
  if (!ok) return;

  button.disabled = true;
  const { problem } = await accountAction({ action, id: person.id });
  button.disabled = false;
  if (problem) return alert(problem);
  await loadAll();
  renderPeople();
});

$("peopleSearch").addEventListener("input", renderPeople);
