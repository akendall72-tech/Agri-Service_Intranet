// Shared Logins
//
// The shared accounts card and its admin tab.

// ---------------------------------------------------------------- shared logins

function renderLogins() {
  const box = $("loginList");
  if (!box) return;

  if (!sharedLogins.length) {
    box.innerHTML = `<p class="error">No shared logins found. Run migration
      0026_shared_logins.sql in the SQL editor, then reload this page.</p>`;
    return;
  }

  box.innerHTML = sharedLogins.map(l => `
    <div class="role" style="padding:16px" data-login="${esc(l.id)}">
      <div class="row" style="margin-bottom:12px">
        <b style="font-size:16px">${esc(l.name)}</b>
        <span class="note">${esc(l.id)}${l.updated_at
          ? " · changed " + new Date(l.updated_at).toLocaleDateString() : ""}</span>
      </div>
      <div class="fields">
        <div class="wide"><label>Site</label>
          <input type="text" data-l="site_url" value="${esc(l.site_url)}"></div>
        <div><label>Username${l.username === null
          ? " (this site doesn't use one)" : ""}</label>
          <input type="text" data-l="username" value="${esc(l.username ?? "")}"
                 placeholder="${l.username === null ? "Not used" : ""}"></div>
        <div><label>Password</label>
          <input type="text" data-l="password" value="${esc(l.password)}"></div>
        <div class="wide"><label>Note</label>
          <textarea data-l="note" rows="2">${esc(l.note || "")}</textarea></div>
      </div>
      <div class="row">
        <button data-act="save-login">Save</button>
        <span class="msg"></span>
      </div>
    </div>`).join("");
}

$("admin").addEventListener("click", async (event) => {
  const button = event.target.closest('button[data-act="save-login"]');
  if (!button) return;

  const box = button.closest("[data-login]");
  const get = (f) => box.querySelector(`[data-l="${f}"]`).value.trim();

  // The app refuses anything that isn't a web address rather than handing it to
  // Safari, so a bad one here would silently stop that screen working.
  const site = get("site_url");
  if (!/^https?:\/\//i.test(site)) {
    return speak(box, "The site has to start with https://", true);
  }
  if (!get("password")) return speak(box, "A password is needed.", true);

  speak(box, "Saving…", false);
  const { data, error } = await db.from("shared_logins").update({
    site_url: site,
    username: get("username") || null,
    password: get("password"),
    note: get("note") || null
  }).eq("id", box.dataset.login).select();

  if (error) return speak(box, error.message, true);
  if (!data || !data.length) {
    return speak(box, "Nothing changed — only an owner can edit these.", true);
  }

  Object.assign(sharedLogins.find(l => l.id === box.dataset.login), data[0]);
  speak(box, "Saved. Phones pick it up next time that screen is opened.", false);
});

function renderSupport() {
  const box = $("supportRoles");

  if (!supportRoles.length) {
    box.innerHTML = `<p class="error">No support roles found. Run migration
      0013_support_roles.sql in the SQL editor, then reload this page.</p>`;
    return;
  }

  const field = (label, name, value, opts = {}) => `
    <div class="${opts.wide ? "wide" : ""}">
      <label>${label}</label>
      <input type="${opts.type || "text"}" data-f="${name}"
             value="${esc(value ?? "")}" placeholder="${esc(opts.placeholder || "")}">
    </div>`;

  // A blank row at the end of every role is the "add someone" affordance:
  // fill it in, press Add, and it becomes a person. No separate mode.
  const personRow = (roleId, person) => `
    <div class="prow" data-person="${esc(person ? person.id : "")}">
      <div>
        <label>Name</label>
        <input type="text" data-f="name" value="${esc(person ? person.name : "")}"
               placeholder="${person ? "" : "Add someone"}">
      </div>
      <div>
        <label>Job title</label>
        <input type="text" data-f="title" value="${esc(person ? person.title : "")}">
      </div>
      <div>
        <label>Mobile</label>
        <input type="tel" data-f="phone" value="${esc(person ? person.phone : "")}"
               placeholder="208 555 0100">
      </div>
      <div class="row">
        <button data-act="${person ? "save-person" : "add-person"}"
                data-role="${esc(roleId)}">${person ? "Save" : "Add"}</button>
        ${person ? `<button class="ghost" data-act="remove-person">Remove</button>` : ""}
      </div>
      <div class="wide"><span class="msg"></span></div>
    </div>`;

  box.innerHTML = supportRoles.map(r => {
    const crew = (r.support_people || [])
      .sort((a, b) => (a.sort_order - b.sort_order) || a.name.localeCompare(b.name));

    return `
    <div class="role" data-id="${esc(r.id)}">
      <div class="role-head">
        <b>${esc(r.title)}</b>
        <span class="note">${esc(r.id)} · ${crew.length}
          ${crew.length === 1 ? "person" : "people"}${r.updated_at
          ? " · updated " + new Date(r.updated_at).toLocaleDateString() : ""}</span>
      </div>
      <div class="fields">
        ${field("Card title", "title", r.title)}
        ${field("Icon (SF Symbol)", "symbol", r.symbol)}
        ${field("Blurb", "subtitle", r.subtitle, { wide: true })}
      </div>
      <div class="row" style="margin-top:6px">
        <button data-act="save">Save card</button>
        <span class="msg"></span>
      </div>
      <div class="people">
        ${crew.map(person => personRow(r.id, person)).join("")}
        ${personRow(r.id, null)}
      </div>
    </div>`;
  }).join("");
}
