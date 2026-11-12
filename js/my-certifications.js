// My Certifications
//
// Every certification a person holds, together, as the app's HR tab has it:
// the company's (the forklift card, the crane and rigging qualification, EPA
// 609), then four asked about by name, all optional (0130): DOT Medical Card,
// Welding Certification, CPR and First Aid, which their location admin and
// owners can see; then any others they add (0129), which only they can. Each
// has its expiry date and a picture of the card. Reminders before one runs
// out come from the app, which sets them on the phone.

let mycCerts = [], mycEpa = null, mycError = null;
// The form, while it's open: the kind being added or changed, and the row if
// it's one already saved.
let mycEditing = null;

async function loadMyCerts() {
  if (!me) return;
  const [own, epa] = await Promise.all([
    db.from("personal_certifications").select("id,kind,name,issued_by,number,issued_on,expires_on,note,photo_path")
      .eq("user_id", me.id).order("id"),
    mycLoadEpa()]);
  mycError = own.error ? own.error.message : null;
  // Soonest to run out first; those that don't run out last.
  mycCerts = (own.data || []).sort((a, b) => String(a.expires_on || "9999").localeCompare(String(b.expires_on || "9999"))
    || String(a.name).localeCompare(String(b.name)));
  mycEpa = epa;
}

// Their own EPA 609 row: by employee number, then work email. An admin or
// owner can read other people's, so it's asked for by theirs.
async function mycLoadEpa() {
  const columns = "id,certified_on,certificate_number,photo_path,employee_number,email";
  const number = profile && profile.employee_number;
  if (number) {
    const { data } = await db.from("epa_certifications").select(columns).eq("employee_number", number).limit(1);
    const hit = (data || []).find(c => c.employee_number === number);
    if (hit) return hit;
  }
  const email = String((me && me.email) || "").trim().toLowerCase();
  if (!email) return null;
  const { data } = await db.from("epa_certifications").select(columns).eq("email", email).limit(1);
  return (data || []).find(c => String(c.email || "").toLowerCase() === email) || null;
}

const mycKind = (id) => CERT_KINDS.find(k => k.id === id);
const mycHeld = (kind) => mycCerts.find(c => c.kind === kind);
const mycOthers = () => mycCerts.filter(c => !mycKind(c.kind));
const mycTitle = (c) => (mycKind(c.kind) || {}).name || c.name;
// For one of the four, what the person added to its name, if anything.
const mycDetail = (c) => mycKind(c.kind) && c.name && c.name !== mycKind(c.kind).name ? c.name : "";

// Where one stands against its expiry date: the app's 30 days.
function mycStanding(expires) {
  if (!expires) return { tag: "Current", tint: "green", line: "No expiration" };
  const today = new Date(new Date().toDateString());
  const days = Math.round((new Date(String(expires).slice(0, 10) + "T00:00:00") - today) / 86400000);
  const when = fmtDate(String(expires).slice(0, 10));
  if (days < 0) return { tag: "Expired", tint: "ember", line: `Expired ${when}`, bad: true };
  if (days <= 30) return { tag: "Expiring", tint: "amber", line: days === 0 ? "Expires today" : days === 1 ? "Expires tomorrow"
    : `Expires ${when}, in ${days} days`, soon: true };
  return { tag: "Current", tint: "green", line: `Expires ${when}` };
}

// Expired, or thirty days or fewer to go: what the HR page counts.
const mycNeedingAttention = () => mycCerts.filter(c => { const s = mycStanding(c.expires_on); return s.bad || s.soon; }).length;

function myCertsView() {
  const head = hero("My Certifications", "Every certification you hold, together, and when each one runs out.");
  if (mycError) return head + `<div class="card"><p class="error" style="margin:0">${
    /does not exist|schema cache/i.test(mycError)
      ? "My Certifications isn't switched on yet. Run migrations 0129 and 0130, then reload this page."
      : esc(mycError)}</p></div>`;

  const row = (o) => `<${o.button ? `button type="button" ${o.button}` : "div"} class="${o.button ? "cab-card " : ""}inv-row myc-row" style="${lit(o.tint)}">
      <span class="myc-glyph">${icon(o.icon, 20)}</span>
      <span class="inv-main"><b>${esc(o.title)}</b><span>${esc(o.line)}</span>${o.extra ? `<span>${esc(o.extra)}</span>` : ""}</span>
      ${o.tag ? `<span class="cab-tag">${esc(o.tag)}</span>` : ""}${o.after || ""}
      ${o.button ? `<span class="cab-chev" aria-hidden="true">&rsaquo;</span>` : ""}
    </${o.button ? "button" : "div"}>`;

  // The company's three, from their own records.
  const card = myCertification();
  const [fkLabel, fkCls] = card ? certStatusNow(card) : ["", ""];
  const forklift = card
    ? { line: fkLabel === "Expired" ? `Expired ${fmtDate(card.expiration_date)}` : fkLabel === "Removed" ? "Removed. Speak to your location admin"
        : `${fkCls === "b-expiring" ? "Expires" : "Valid through"} ${fmtDate(card.expiration_date)}`,
        tag: fkCls === "b-current" ? "Certified" : fkCls === "b-expiring" ? "Expiring" : fkLabel,
        tint: fkCls === "b-current" ? "green" : fkCls === "b-expiring" ? "amber" : "ember" }
    : { line: "Not certified yet. The Forklift Center has the course.", tag: "None", tint: "slate" };
  const mine = tsMine();
  const crane = mine ? craneStatus(mine) : { kind: "none" };
  const craneSoon = crane.kind === "qualified" && crane.expires && (crane.expires - new Date()) / 86400000 <= 30;
  const craneRow = crane.kind === "qualified"
    ? { line: crane.expires ? `${craneSoon ? "Expires" : "Valid through"} ${craneDay(crane.expires)}` : "Qualified · no expiration",
        tag: craneSoon ? "Expiring" : "Qualified", tint: craneSoon ? "amber" : "green" }
    : crane.kind === "expired" ? { line: `Expired ${craneDay(crane.expires)}: take the course again`, tag: "Expired", tint: "ember" }
    : crane.kind === "removed" ? { line: "Removed. Speak to your location admin", tag: "Removed", tint: "ember" }
    : { line: "Not qualified yet: pass Lifting and Rigging", tag: "None", tint: "slate" };
  const epaHeld = mycEpa || (mine && mine.epa_609);
  const epaLine = mycEpa ? [mycEpa.certified_on ? `Certified ${fmtDate(mycEpa.certified_on)}` : "",
    mycEpa.certificate_number ? `#${mycEpa.certificate_number}` : "", "No expiration"].filter(Boolean).join(" · ")
    : epaHeld ? "Certified · no expiration" : "Not certified";

  const tracked = CERT_KINDS.map(k => {
    const c = mycHeld(k.id);
    if (!c) return row({ button: `data-myc-edit="${k.id}"`, icon: k.icon, title: k.name, line: "Not added. Add it if you hold one.",
      tag: "Add", tint: "slate" });
    const s = mycStanding(c.expires_on);
    return row({ button: `data-myc-edit="${k.id}"`, icon: k.icon, title: k.name, line: s.line, tag: s.tag, tint: s.tint,
      extra: [mycDetail(c), c.issued_by, c.photo_path ? "Picture saved" : ""].filter(Boolean).join(" · ") });
  });
  const others = mycOthers().map(c => {
    const s = mycStanding(c.expires_on);
    return row({ button: `data-myc-edit="other" data-myc-id="${esc(c.id)}"`, icon: "checkCircle", title: c.name, line: s.line,
      tag: c.expires_on ? s.tag : "", tint: s.tint === "green" ? "slate" : s.tint,
      extra: [c.issued_by, c.number ? `#${c.number}` : "", c.photo_path ? "Picture saved" : ""].filter(Boolean).join(" · ") });
  });

  return head + `<div class="inv myc">
    ${mycEditing ? mycFormHtml() : ""}
    <div class="cab-heading">Company certifications</div>
    <div class="inv-list">
      ${row({ button: `data-view="forklift"`, icon: "forklift", title: "Forklift", ...forklift })}
      ${row({ button: `data-view="rigging"`, icon: "rigging", title: "Crane & rigging", ...craneRow })}
      ${row({ icon: "safety", title: "EPA 609", line: epaLine, tag: epaHeld ? "Certified" : "None", tint: epaHeld ? "green" : "slate",
        after: mycEpa && mycEpa.photo_path ? `<button type="button" class="ghost myc-view" data-myc-epa>View certificate</button>` : "" })}
    </div>
    <div class="cab-heading">Optional<span class="trail">Your location admin sees these</span></div>
    <div class="inv-list">${tracked.join("")}</div>
    <div class="cab-heading">Others you hold${others.length ? `<span class="trail">${others.length} certification${others.length === 1 ? "" : "s"}</span>` : ""}</div>
    <div class="inv-list">${others.join("")}
      <button type="button" class="myc-add" data-myc-edit="other">${icon("plus", 16)}Add a certification</button></div>
    <p class="st-empty myc-note">None of these is required. If you hold a DOT medical card, a welding certification, CPR or first aid,
      add it with when it expires and a picture of the card; your location admin and the owners can see those four. Anything else
      you add, such as a CDL, only you can see. The app reminds you 30 days and a week before one expires, and on the day.</p>
  </div>`;
}

function mycFormHtml() {
  const kind = mycKind(mycEditing.kind);
  const c = mycEditing.id ? mycCerts.find(x => x.id === mycEditing.id) : kind ? mycHeld(kind.id) : null;
  const years = kind ? kind.years : 1;
  const later = new Date(); later.setFullYear(later.getFullYear() + years);
  const expires = c ? c.expires_on || "" : later.toISOString().slice(0, 10);
  const name = c ? (kind ? mycDetail(c) : c.name) : "";
  return `<div class="card inv-form myc-form" data-myc-form>
    <h2>${kind ? (c ? kind.name : `Add ${kind.name}`) : c ? "Certification" : "Add a certification"}</h2>
    <div class="fields">
      <div class="wide"><label for="mycName">${kind ? "Details (optional)" : "What it is"}</label>
        <input id="mycName" type="text" maxlength="120" placeholder="${esc(kind ? kind.prompt : "e.g. CDL Class A")}" value="${esc(name)}"></div>
      <div><label for="mycBy">Issued by (optional)</label>
        <input id="mycBy" type="text" maxlength="120" value="${esc(c ? c.issued_by : "")}"></div>
      <div><label for="mycNumber">Certificate number (optional)</label>
        <input id="mycNumber" type="text" maxlength="100" value="${esc(c ? c.number : "")}"></div>
      <div><label for="mycExpires">Expires on</label>
        <input id="mycExpires" type="date" value="${esc(expires)}"${c && !c.expires_on ? " disabled" : ""}>
        <label class="check"><input id="mycNoExpiry" type="checkbox"${c && !c.expires_on ? " checked" : ""}> It doesn't expire</label></div>
      <div><label for="mycIssued">Issued on (optional)</label>
        <input id="mycIssued" type="date" max="${todayISO()}" value="${esc(c ? c.issued_on || "" : "")}"></div>
      <div class="wide"><label for="mycPhoto">Picture of the certificate (optional)${c && c.photo_path ? ": choose one to replace it" : ""}</label>
        <input id="mycPhoto" type="file" accept="image/*,application/pdf">
        <p class="note">A photo or a PDF, up to 10 MB. ${kind ? "You, your location admin and the owners can see it." : "Only you can see it."}
          ${c && c.photo_path ? `<button type="button" class="myc-link" data-myc-photo="${esc(c.id)}">View the picture saved</button>` : ""}</p></div>
      <div class="wide"><label for="mycNote">Note (optional)</label>
        <input id="mycNote" type="text" maxlength="500" value="${esc(c ? c.note : "")}"></div>
    </div>
    <div class="row" style="margin-top:12px">
      <button type="button" data-myc-save>${c ? "Save changes" : "Add it"}</button>
      <button type="button" class="ghost" data-myc-cancel>Cancel</button>
      ${c ? `<button type="button" class="ghost danger" data-myc-remove>Delete</button>` : ""}
      <span class="msg"></span>
    </div>
  </div>`;
}

async function mycSave(button) {
  const form = button.closest("[data-myc-form]");
  const kind = mycKind(mycEditing.kind);
  const existing = mycEditing.id ? mycCerts.find(x => x.id === mycEditing.id) : kind ? mycHeld(kind.id) : null;
  const name = $("mycName").value.trim();
  if (!kind && !name) return speak(form, "Say what it is.", true);
  const noExpiry = $("mycNoExpiry").checked;
  const expires = noExpiry ? null : $("mycExpires").value || null;
  if (!noExpiry && !expires) return speak(form, "Choose when it expires, or tick that it doesn't.", true);
  const issued = $("mycIssued").value || null;
  if (issued && expires && expires < issued) return speak(form, "It can't expire before it was issued.", true);
  const file = $("mycPhoto").files[0];
  if (file && file.size > 10 * 1024 * 1024) return speak(form, "That file is over 10 MB. Choose a smaller picture or PDF.", true);
  const fields = { kind: kind ? kind.id : "other", name, issued_by: $("mycBy").value.trim(), number: $("mycNumber").value.trim(),
    issued_on: issued, expires_on: expires, note: $("mycNote").value.trim() };
  button.disabled = true;
  speak(form, "Saving…", false);
  const { data, error } = existing
    ? await db.from("personal_certifications").update(fields).eq("id", existing.id).select()
    : await db.from("personal_certifications").insert(fields).select();
  if (error || !(data || []).length) { button.disabled = false; return speak(form, error ? error.message : "That didn't save. Reload and try again.", true); }
  const saved = data[0];
  if (file) {
    const picture = await certificatePicture(file);
    const path = `${me.id}/${saved.id}/${crypto.randomUUID()}.${picture.ext}`;
    const { error: upload } = await db.storage.from("personal-certificates").upload(path, picture.blob, { contentType: picture.type });
    if (upload) {
      button.disabled = false;
      await loadMyCerts();
      mycEditing = { kind: fields.kind, id: saved.id };
      showView("mycerts");
      return speak(document.querySelector("[data-myc-form]"), `Saved, but the picture didn't upload (${upload.message}). Try it again.`, true);
    }
    const { error: link } = await db.from("personal_certifications").update({ photo_path: path }).eq("id", saved.id);
    if (!link && existing && existing.photo_path) await db.storage.from("personal-certificates").remove([existing.photo_path]);
  }
  mycEditing = null;
  await loadMyCerts();
  showView("mycerts");
}

async function mycRemove(button) {
  const form = button.closest("[data-myc-form]");
  const kind = mycKind(mycEditing.kind);
  const c = mycEditing.id ? mycCerts.find(x => x.id === mycEditing.id) : kind ? mycHeld(kind.id) : null;
  if (!c || !confirm(`Delete ${mycTitle(c)}? It and its picture are gone for good, along with its reminders.`)) return;
  button.disabled = true;
  if (c.photo_path) await db.storage.from("personal-certificates").remove([c.photo_path]);
  const { error } = await db.from("personal_certifications").delete().eq("id", c.id);
  if (error) { button.disabled = false; return speak(form, error.message, true); }
  mycEditing = null;
  await loadMyCerts();
  showView("mycerts");
}

// Opened straight away so the browser doesn't take it for a pop-up, then pointed at the picture.
async function mycOpenPicture(bucket, path) {
  const tab = window.open("", "_blank");
  const { data, error } = await db.storage.from(bucket).createSignedUrl(path, 600);
  if (error || !data) { if (tab) tab.close(); return alert(error ? error.message : "The picture couldn't be opened."); }
  if (tab) tab.location = data.signedUrl; else window.location.href = data.signedUrl;
}

document.addEventListener("change", (event) => {
  if (event.target.id === "mycNoExpiry") $("mycExpires").disabled = event.target.checked;
});
document.addEventListener("click", async (event) => {
  const t = event.target;
  const edit = t.closest("[data-myc-edit]");
  if (edit) {
    mycEditing = { kind: edit.dataset.mycEdit, id: edit.dataset.mycId || null };
    showView("mycerts");
    const form = document.querySelector("[data-myc-form]");
    if (form) { form.scrollIntoView({ block: "start" }); $("mycName").focus({ preventScroll: true }); }
    return;
  }
  if (t.closest("[data-myc-cancel]")) { mycEditing = null; return showView("mycerts"); }
  const save = t.closest("[data-myc-save]");
  if (save) return mycSave(save);
  const remove = t.closest("[data-myc-remove]");
  if (remove) return mycRemove(remove);
  const photo = t.closest("[data-myc-photo]");
  if (photo) {
    const c = mycCerts.find(x => x.id === photo.dataset.mycPhoto);
    if (c && c.photo_path) mycOpenPicture("personal-certificates", c.photo_path);
    return;
  }
  if (t.closest("[data-myc-epa]") && mycEpa && mycEpa.photo_path) mycOpenPicture("epa-certificates", mycEpa.photo_path);
});
