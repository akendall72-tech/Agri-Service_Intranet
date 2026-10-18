// Personal Inventory
//
// Each person's own tools and equipment, its people list for admins and
// owners, editing, and the PDF.

// ---- Personal Inventory (migration 0103) --------------------------------------------
//
// Each person's own tools and equipment, on the truck or in the shop, and what
// they're worth. You add to, change and remove from your own. A location admin
// sees the people at the locations they look after, and an owner everyone,
// read only: the database decides who, and this page shows what comes back.
// Every list prints as a PDF.
let invItems = [], invError = null, invPerson = null, invPlace = "all", invQuery = "", invDraft = null;

async function loadInventory() {
  const { data, error } = await db.from("personal_inventory")
    .select("id, person_id, description, make, quantity, value, location").order("description");
  invError = error ? error.message : null;
  invItems = error ? [] : (data || []).map(r => ({ ...r, value: Number(r.value) || 0 }));
}

const INV_PLACES = [["truck", "Truck", "slate"], ["shop", "Shop", "amber"]];
const invTotal = (rows) => rows.reduce((t, r) => t + r.quantity * r.value, 0);
// "$1,250", or "$12.50" when there are cents.
const invMoney = (n) => "$" + Number(n).toLocaleString("en-US",
  { minimumFractionDigits: Number.isInteger(Number(n)) ? 0 : 2, maximumFractionDigits: 2 });
const invOf = (id) => invItems.filter(r => r.person_id === id)
  .sort((a, b) => a.description.localeCompare(b.description, undefined, { numeric: true, sensitivity: "base" }));
const invName = (id) => { const p = people.find(x => x.id === id); return (p && p.full_name) || (p && p.email) || "No name yet"; };
const invLocation = (id) => { const p = people.find(x => x.id === id); return p && p.location_id ? shopName(p.location_id) : ""; };

function inventoryView() {
  if (invError) return hero("Personal Inventory") + `<div class="card"><p class="error" style="margin:0">${
    /personal_inventory|does not exist|schema cache/i.test(invError)
      ? "Personal Inventory isn't switched on yet. Run migration 0103_personal_inventory.sql, then reload this page."
      : esc(invError)}</p></div>`;
  // An admin or owner starts on the people they look after; everyone else on their own.
  if (!invPerson && isAdmin()) return inventoryPeopleHtml();
  return inventoryPersonHtml(invPerson || me.id);
}

function inventoryPeopleHtml() {
  const mine = invOf(me.id);
  const others = [...new Set(invItems.map(r => r.person_id))].filter(id => id !== me.id)
    .map(id => ({ id, name: invName(id), where: invLocation(id) || "No location set", rows: invOf(id) }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const groups = [...new Set(others.map(p => p.where))].sort();
  const card = (id, title, sub, total, tint) => `<button type="button" class="cab-card inv-row" data-inv-open="${esc(id)}" style="${lit(tint)}">
      <span class="inv-main"><b>${esc(title)}</b><span>${esc(sub)}</span></span>
      <span class="inv-total">${invMoney(total)}</span><span class="cab-chev" aria-hidden="true">&rsaquo;</span></button>`;
  return hero("Personal Inventory", isOwner() ? "Your own, and everyone's who has put something on their list."
      : "Your own, and the people at the locations you look after.")
    + `<div class="inv">
      <div class="cab-heading">Yours</div>
      <div class="inv-list">${card(me.id, "My Inventory",
        mine.length ? `${mine.length} item${mine.length === 1 ? "" : "s"}` : "Nothing on your list yet. Open it to add your tools.",
        invTotal(mine), "teal")}</div>
      ${groups.map(g => { const here = others.filter(p => p.where === g);
        return `<div class="cab-heading">${esc(g)}<span class="trail">${here.length} ${here.length === 1 ? "person" : "people"} · ${
          invMoney(here.reduce((t, p) => t + invTotal(p.rows), 0))}</span></div>
        <div class="inv-list">${here.map(p => card(p.id, p.name, `${p.rows.length} item${p.rows.length === 1 ? "" : "s"}`,
          invTotal(p.rows), "slate")).join("")}</div>`; }).join("")}
      ${others.length ? "" : `<p class="st-empty">${isOwner() ? "Nobody else has put anything on their list yet."
        : "Nobody at your location has put anything on their list yet."}</p>`}
    </div>`;
}

function inventoryPersonHtml(id) {
  const own = id === me.id;
  const all = invOf(id);
  const pieces = all.reduce((t, r) => t + r.quantity, 0);
  const where = invLocation(id);
  const d = own ? invDraft : null;
  const back = `<p style="margin:0 0 12px"><button type="button" class="ghost" data-inv-open="">${icon("chevronLeft", 14)}Everyone's inventory</button></p>`;
  return hero(own ? "Personal Inventory" : invName(id), own
      ? "Your tools and equipment, on the truck or in the shop, and what they're worth."
      : `Personal Inventory${where ? ` · ${where}` : ""}. Only they can change it.`)
    + `<div class="inv">
      ${isAdmin() ? back : ""}
      <div class="inv-sum">
        <small>TOTAL VALUE</small>
        <strong>${invMoney(invTotal(all))}</strong>
        <span>${all.length ? `${all.length} item${all.length === 1 ? "" : "s"} · ${pieces} piece${pieces === 1 ? "" : "s"}${where ? ` · ${esc(where)}` : ""}`
          : own ? "Nothing on your list yet." : "Nothing on this list yet."}</span>
        ${all.length ? `<div class="inv-split">${INV_PLACES.map(([key, label, tint]) => { const rows = all.filter(r => r.location === key);
          return `<div><small style="color:var(--lit-${tint})">${label.toUpperCase()}</small><b>${invMoney(invTotal(rows))}</b>
            <span>${rows.length} item${rows.length === 1 ? "" : "s"}</span></div>`; }).join("")}</div>` : ""}
      </div>
      ${d ? inventoryFormHtml(d) : ""}
      <div class="inv-bar">
        <input class="search" id="invSearch" placeholder="Description or make" value="${esc(invQuery)}" autocomplete="off" aria-label="Search the inventory">
        <div class="cab-pills">${[["all", "All", all.length]].concat(INV_PLACES.map(([key, label]) => [key, label, all.filter(r => r.location === key).length]))
          .map(([key, label, n]) => `<button type="button" class="cab-pill${invPlace === key ? " on" : ""}" data-inv-place="${key}">${label}<span>${n}</span></button>`).join("")}</div>
        ${own && !d ? `<button type="button" class="st-add" data-inv-add>${icon("plus", 16)}Add an item</button>` : ""}
        <button type="button" class="ghost" data-inv-pdf="${esc(id)}"${all.length ? "" : " disabled"}>${icon("doc", 15)}Export PDF</button>
      </div>
      <div id="invList">${inventoryRowsHtml(id)}</div>
    </div>`;
}

function inventoryRowsHtml(id) {
  const own = id === me.id;
  const words = invQuery.toLowerCase().split(/\s+/).filter(Boolean);
  const shown = invOf(id).filter(r => (invPlace === "all" || r.location === invPlace)
    && words.every(w => `${r.description} ${r.make}`.toLowerCase().includes(w)));
  if (!shown.length) return `<p class="st-empty">${invOf(id).length ? "Nothing matches. Clear the search or pick All."
    : own ? "Add the tools and equipment that are yours, on your truck or in the shop, with what each is worth." : ""}</p>`;
  return INV_PLACES.map(([key, label, tint]) => {
    const rows = shown.filter(r => r.location === key);
    if (!rows.length) return "";
    const tag = own ? "button" : "div";
    return `<div class="cab-heading">${label}<span class="trail">${rows.length} item${rows.length === 1 ? "" : "s"} · ${invMoney(invTotal(rows))}</span></div>
      <div class="inv-list">${rows.map(r => `<${tag}${own ? ` type="button" data-inv-edit="${esc(r.id)}"` : ""} class="${own ? "cab-card " : ""}inv-row" style="${lit(tint)}">
        <span class="inv-main"><b>${esc(r.description)}</b><span>${esc([r.make, `${r.quantity} × ${invMoney(r.value)}`].filter(Boolean).join(" · "))}</span></span>
        <span class="inv-total">${invMoney(r.quantity * r.value)}</span>${own ? `<span class="cab-chev" aria-hidden="true">&rsaquo;</span>` : ""}
      </${tag}>`).join("")}</div>`;
  }).join("");
}

function inventoryFormHtml(d) {
  return `<div class="card inv-form" data-inv-form>
    <h2>${d.id ? "Edit item" : "Add an item"}</h2>
    <div class="fields">
      <div><label for="ivDesc">Description</label>
        <input id="ivDesc" type="text" maxlength="200" placeholder="What it is" value="${esc(d.description)}"></div>
      <div><label for="ivMake">Make</label>
        <input id="ivMake" type="text" maxlength="100" placeholder="Optional: Milwaukee, Snap-on…" value="${esc(d.make)}"></div>
      <div><label for="ivQty">Quantity</label>
        <input id="ivQty" type="number" min="1" max="9999" step="1" value="${esc(d.quantity)}"></div>
      <div><label for="ivValue">Value of one</label>
        <span class="money"><span>$</span><input id="ivValue" type="text" inputmode="decimal" placeholder="0" value="${esc(d.value)}"></span></div>
      <div><label for="ivPlace">Location</label>
        <select id="ivPlace">${INV_PLACES.map(([key, label]) => `<option value="${key}"${d.location === key ? " selected" : ""}>${label}</option>`).join("")}</select></div>
    </div>
    <div class="row" style="margin-top:12px">
      <button type="button" data-inv-save>${d.id ? "Save changes" : "Add item"}</button>
      <button type="button" class="ghost" data-inv-cancel>Cancel</button>
      ${d.id ? `<button type="button" class="ghost danger" data-inv-remove>Remove</button>` : ""}
      <span class="msg"></span>
    </div>
  </div>`;
}

document.addEventListener("input", (event) => {
  if (event.target.id !== "invSearch") return;
  invQuery = event.target.value;
  $("invList").innerHTML = inventoryRowsHtml(invPerson || me.id);
});

document.addEventListener("click", async (event) => {
  const open = event.target.closest("[data-inv-open]");
  if (open) { invPerson = open.dataset.invOpen || null; invDraft = null; invQuery = ""; invPlace = "all"; return showView("inventory"); }
  const place = event.target.closest("[data-inv-place]");
  if (place) { invPlace = place.dataset.invPlace; return showView("inventory"); }
  if (event.target.closest("[data-inv-add]")) {
    invDraft = { id: null, description: "", make: "", quantity: 1, value: "", location: "truck" };
    showView("inventory");
    return $("ivDesc") && $("ivDesc").focus();
  }
  const edit = event.target.closest("[data-inv-edit]");
  if (edit) {
    const r = invItems.find(x => x.id === edit.dataset.invEdit);
    if (!r) return;
    invDraft = { id: r.id, description: r.description, make: r.make, quantity: r.quantity, value: String(r.value), location: r.location };
    showView("inventory");
    window.scrollTo({ top: 0, behavior: "smooth" });
    return $("ivDesc") && $("ivDesc").focus();
  }
  if (event.target.closest("[data-inv-cancel]")) { invDraft = null; return showView("inventory"); }
  const pdf = event.target.closest("[data-inv-pdf]");
  if (pdf) return inventoryPdf(pdf.dataset.invPdf);

  const save = event.target.closest("[data-inv-save], [data-inv-remove]");
  if (!save || !invDraft) return;
  const row = save.closest(".row"), say = (text, bad) => speak(row, text, bad);
  if (save.hasAttribute("data-inv-remove")) {
    if (!confirm(`Remove ${invDraft.description} from your inventory?`)) return;
    save.disabled = true;
    const { error } = await db.from("personal_inventory").delete().eq("id", invDraft.id);
    if (error) { save.disabled = false; return say(`Not removed: ${error.message}`, true); }
  } else {
    const description = $("ivDesc").value.trim(), make = $("ivMake").value.trim();
    const quantity = Number($("ivQty").value), typed = $("ivValue").value.replace(/[$,\s]/g, "");
    const value = typed === "" ? 0 : Number(typed);
    if (!description) return say("Say what it is.", true);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 9999) return say("The quantity is a whole number from 1 to 9,999.", true);
    if (!Number.isFinite(value) || value < 0 || value > 1000000) return say("Put in what one is worth, in dollars, like 150 or 12.50.", true);
    const fields = { description, make, quantity, value: Math.round(value * 100) / 100, location: $("ivPlace").value };
    save.disabled = true;
    const { error } = invDraft.id
      ? await db.from("personal_inventory").update(fields).eq("id", invDraft.id)
      : await db.from("personal_inventory").insert({ ...fields, person_id: me.id });
    if (error) { save.disabled = false; return say(/row-level security/i.test(error.message)
      ? "Not saved: only the person whose inventory it is can change it." : `Not saved: ${error.message}`, true); }
  }
  invDraft = null;
  await loadInventory();
  showView("inventory");
});

// A Personal Inventory as a PDF: whose, what it's all worth, then the truck and
// the shop, each item with what they come to, a subtotal under each and the
// total at the end. jsPDF's fonts are Latin-1, so dashes and quotes go plain.
function inventoryPdf(id) {
  const all = invOf(id), name = invName(id), where = invLocation(id);
  const latin = (t) => String(t ?? "").replace(/[–—]/g, "-").replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
    .replace(/…/g, "...").replace(/×/g, "x").replace(/[^\x00-\xFF]/g, "");
  const doc = new jspdf.jsPDF({ unit: "pt", format: "letter" });
  const W = 612, H = 792, M = 44, CW = W - M * 2, BOTTOM = H - M - 20;
  const red = [204, 0, 51], ink = [30, 30, 30], grey = [110, 110, 110], light = [246, 245, 243];
  // Columns: description, make, then quantity, value and total set from the right.
  const cols = [["Description", M + 5, "l"], ["Make", M + 250, "l"], ["Qty", M + CW - 175, "r"], ["Value each", M + CW - 90, "r"], ["Total", M + CW - 5, "r"]];
  let y = 0;
  const head = () => {
    doc.setFillColor(238, 236, 233); doc.rect(M, y, CW, 17, "F");
    doc.setFont("helvetica", "bold"); doc.setFontSize(7.5); doc.setTextColor(...grey);
    cols.forEach(([label, x, a]) => doc.text(label.toUpperCase(), x, y + 11.5, a === "r" ? { align: "right" } : {}));
    y += 19;
  };
  const newPage = (withHead) => {
    doc.addPage(); doc.setFillColor(...red); doc.rect(0, 0, W, 6, "F");
    doc.setFont("helvetica", "bold"); doc.setFontSize(8); doc.setTextColor(...grey);
    doc.text(latin(`AGRI-SERVICE  -  PERSONAL INVENTORY  -  ${name.toUpperCase()}`), M, 24);
    y = 40; if (withHead) head();
  };
  const ensure = (h, withHead) => { if (y + h > BOTTOM) newPage(withHead); };

  doc.setFillColor(...red); doc.rect(0, 0, W, 84, "F");
  doc.setTextColor(255); doc.setFont("helvetica", "bold"); doc.setFontSize(22); doc.text("AGRI-SERVICE", M, 38);
  doc.setFontSize(10); doc.text("PERSONAL INVENTORY", M, 56);
  doc.setFontSize(18); doc.text(latin(name), W - M, 40, { align: "right" });
  doc.setFont("helvetica", "normal"); doc.setFontSize(9);
  doc.text(latin([where, `Printed ${new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`].filter(Boolean).join("  -  ")), W - M, 58, { align: "right" });
  y = 106;

  // The total, and each place's.
  doc.setFillColor(...light); doc.roundedRect(M, y, CW, 58, 4, 4, "F"); doc.setFillColor(...red); doc.rect(M, y, 3, 58, "F");
  doc.setFont("helvetica", "bold"); doc.setFontSize(7.5); doc.setTextColor(...grey); doc.text("TOTAL VALUE", M + 14, y + 16);
  doc.setFontSize(24); doc.setTextColor(...ink); doc.text(invMoney(invTotal(all)), M + 14, y + 44);
  doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(...grey);
  doc.text(`${all.length} items - ${all.reduce((t, r) => t + r.quantity, 0)} pieces`, M + 210, y + 16);
  INV_PLACES.forEach(([key, label], i) => { const rows = all.filter(r => r.location === key);
    doc.setFont("helvetica", "bold"); doc.setFontSize(7.5); doc.setTextColor(...grey); doc.text(label.toUpperCase(), M + 210 + i * 140, y + 32);
    doc.setFont("helvetica", "normal"); doc.setFontSize(10); doc.setTextColor(...ink);
    doc.text(`${invMoney(invTotal(rows))} - ${rows.length} items`, M + 210 + i * 140, y + 46); });
  y += 78;

  INV_PLACES.forEach(([key, label]) => {
    const rows = all.filter(r => r.location === key);
    if (!rows.length) return;
    ensure(70);
    doc.setFont("helvetica", "bold"); doc.setFontSize(12); doc.setTextColor(...red); doc.text(label.toUpperCase(), M, y);
    doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(...grey); doc.text(`${rows.length} item${rows.length === 1 ? "" : "s"}`, M + 56, y);
    y += 8; head();
    rows.forEach((r, n) => {
      ensure(16, true);
      if (n % 2) { doc.setFillColor(...light); doc.rect(M, y - 1, CW, 15, "F"); }
      doc.setFontSize(9); doc.setFont("helvetica", "normal"); doc.setTextColor(...ink);
      doc.text(doc.splitTextToSize(latin(r.description), 238)[0], cols[0][1], y + 10);
      doc.setTextColor(...grey); doc.text(doc.splitTextToSize(latin(r.make), 140)[0], cols[1][1], y + 10);
      doc.setTextColor(...ink);
      doc.text(String(r.quantity), cols[2][1], y + 10, { align: "right" });
      doc.text(invMoney(r.value), cols[3][1], y + 10, { align: "right" });
      doc.setFont("helvetica", "bold"); doc.text(invMoney(r.quantity * r.value), cols[4][1], y + 10, { align: "right" });
      y += 15;
    });
    ensure(22);
    doc.setDrawColor(200); doc.line(M, y + 1, M + CW, y + 1);
    doc.setFont("helvetica", "bold"); doc.setFontSize(9.5); doc.setTextColor(...ink);
    doc.text(`${label} total`, cols[3][1], y + 14, { align: "right" });
    doc.text(invMoney(invTotal(rows)), cols[4][1], y + 14, { align: "right" });
    y += 32;
  });

  if (all.length) {
    ensure(34);
    doc.setFillColor(...red); doc.rect(M, y, CW, 26, "F");
    doc.setTextColor(255); doc.setFont("helvetica", "bold"); doc.setFontSize(11);
    doc.text(`TOTAL - ${all.length} ITEMS`, M + 10, y + 17);
    doc.setFontSize(13); doc.text(invMoney(invTotal(all)), M + CW - 10, y + 17, { align: "right" });
  }

  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p); doc.setDrawColor(220); doc.line(M, H - M + 2, M + CW, H - M + 2);
    doc.setFont("helvetica", "normal"); doc.setFontSize(7.5); doc.setTextColor(...grey);
    doc.text(latin(`Agri-Service, LLC  -  Personal Inventory  -  ${name}`), M, H - M + 14);
    doc.setFont("helvetica", "bold"); doc.text(`Page ${p} of ${pages}`, W - M, H - M + 14, { align: "right" });
  }
  doc.save(latin(`Personal Inventory - ${name}.pdf`));
}
