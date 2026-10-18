// The Safety dashboard
//
// The Safety Manager's front page, the monthly safety report PDF, and the
// required forklift and crane operators.

// ---- the Safety dashboard's front page -------------------------------------------
//
// Everything safety on one screen, Safety Reports first: what's waiting for
// approval, the reports sent this month, the reports by month, type and
// location, then this month's Safety Brief, forklift cards running out and
// lift plans waiting. Every number opens the tab behind it. In the Cab look.

const SX_DAY = 86400000;
const sxNum = (n) => Number(n || 0).toLocaleString();
const sxKind = (r) => (r.answers || {}).kind || "";
const sxEmoji = (kind) => { const first = kind.split(" ")[0]; return /[A-Za-z]/.test(first) ? "" : first; };

// Reports by month for the last twelve, split into approved and waiting.
function sxMonths(reports) {
  const now = new Date(), months = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({ key: `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`, label: d.toLocaleDateString("en-US", { month: "short" }),
      year: d.getFullYear(), approved: 0, waiting: 0 });
  }
  reports.forEach(r => {
    const m = months.find(x => x.key === String(r.created_at).slice(0, 7));
    if (m) srPending(r) ? m.waiting++ : m.approved++;
  });
  return months;
}

// Reports by where they happened, over the same twelve months: every location,
// even one with none, then "Not at a location", then any name no longer a location.
function sxLocations(reports) {
  const cols = allLocations.filter(l => l.is_active !== false)
    .map(l => ({ key: l.name, label: l.name, tip: l.name, approved: 0, waiting: 0 }));
  reports.forEach(r => {
    const w = (r.answers || {}).where;
    if (!w) return;
    let c = cols.find(x => x.key === w);
    if (!c) cols.push(c = { key: w, label: w === "N/A" ? "Not at a location" : w, tip: w === "N/A" ? "Not at a location" : w, approved: 0, waiting: 0 });
    srPending(r) ? c.waiting++ : c.approved++;
  });
  const na = cols.findIndex(c => c.key === "N/A");
  if (na >= 0) cols.push(...cols.splice(na, 1));
  return cols;
}

// Columns of { label, tip, approved, waiting }, each bar split into the two.
function sxBarsHtml(cols, aria, wide) {
  const top = Math.max(1, ...cols.map(c => c.approved + c.waiting));
  return `<div class="sx-chart${wide ? " sx-chart-wide" : ""}" role="img" aria-label="${esc(aria)}">
    ${cols.map(c => {
      const total = c.approved + c.waiting;
      return `<div class="sx-col" title="${esc(c.tip)}: ${total} report${total === 1 ? "" : "s"}${c.waiting ? `, ${c.waiting} waiting` : ""}">
        <span class="sx-val">${total || (wide ? "0" : "")}</span>
        <span class="sx-stack" style="height:${Math.round(total / top * 100)}%">
          ${c.waiting ? `<i class="w" style="flex:${c.waiting}"></i>` : ""}${c.approved ? `<i style="flex:${c.approved}"></i>` : ""}
        </span>
        <small>${esc(c.label)}</small>
      </div>`;
    }).join("")}
  </div>
  <div class="sx-legend"><span><i></i>Approved</span><span><i class="w"></i>Waiting</span></div>`;
}

const sxMonthBars = (reports) => sxBarsHtml(sxMonths(reports).map(m => ({ label: m.label.slice(0, 3), tip: `${m.label} ${m.year}`,
  approved: m.approved, waiting: m.waiting })), "Reports sent each month for the last twelve months");
const sxShopBars = (reports) => sxBarsHtml(sxLocations(reports), "Reports for each location this month", true);

// Horizontal bars: [label, count, emoji?].
function sxRankHtml(rows, empty) {
  if (!rows.length) return `<p class="sx-empty">${esc(empty)}</p>`;
  const top = Math.max(...rows.map(r => r[1]));
  return `<div class="sx-rank">${rows.map(([label, n, emoji]) => `<div class="sx-rank-row">
      <span class="sx-rank-label">${emoji ? `<em>${emoji}</em>` : ""}${esc(label)}</span>
      <span class="sx-rank-bar"><i style="width:${Math.max(4, n / top * 100)}%"></i></span><b>${n}</b></div>`).join("")}</div>`;
}

function sxByType(reports) {
  const tally = {};
  reports.forEach(r => { const k = sxKind(r); if (!k) return;
    const short = srShortKind(k) || k; (tally[short] = tally[short] || [short, 0, sxEmoji(k)])[1]++; });
  return Object.values(tally).sort((a, b) => b[1] - a[1]);
}

// Months as "2026-10", their names, and the last two years to pick from.
const sxMonthKey = (d = new Date()) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
const sxMonthName = (key) => dateOnly(key + "-01").toLocaleDateString("en-US", { month: "long", year: "numeric" });
const sxInMonth = (key) => (r) => String(r.created_at).slice(0, 7) === key;
function sxMonthOptions(selected) {
  const now = new Date();
  return Array.from({ length: 24 }, (_, i) => sxMonthKey(new Date(now.getFullYear(), now.getMonth() - i, 1)))
    .map(k => `<option value="${k}"${k === selected ? " selected" : ""}>${esc(sxMonthName(k))}</option>`).join("");
}
// Everyone expected to take part in a month: active, with an account by its end.
function sxPeopleIn(key) {
  const end = dateOnly(key + "-01"); end.setMonth(end.getMonth() + 1);
  return people.filter(p => !p.deactivated_at && (!p.created_at || new Date(p.created_at) < end));
}
let sxWhoMonth = sxMonthKey(), sxWhoFilter = "not", sxPdfMonth = sxMonthKey();

// Safety Reports sent this calendar month, and last month for comparison.
function sxThisMonth(reports) {
  const now = new Date();
  const key = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
  const thisKey = key(now), lastKey = key(new Date(now.getFullYear(), now.getMonth() - 1, 1));
  return { count: reports.filter(r => String(r.created_at).slice(0, 7) === thisKey).length,
           last: reports.filter(r => String(r.created_at).slice(0, 7) === lastKey).length,
           month: now.toLocaleDateString("en-US", { month: "long" }) };
}

function sxBrief() {
  const b = deskBriefs().find(x => x.month === briefThisMonth());
  if (!b) return null;
  const end = new Date(dateOnly(b.month)); end.setMonth(end.getMonth() + 1);
  const expected = people.filter(p => !p.deactivated_at && (!p.created_at || new Date(p.created_at) < end));
  const passed = expected.filter(p => (briefResult(b, p.id) || {}).passed_at);
  const shops = {};
  expected.forEach(p => { const s = locations[p.location_id] || "No location set";
    const t = shops[s] = shops[s] || { shop: s, expected: 0, passed: 0 }; t.expected++;
    if ((briefResult(b, p.id) || {}).passed_at) t.passed++; });
  return { brief: b, expected: expected.length, passed: passed.length, shops: Object.values(shops).sort((x, y) => x.shop.localeCompare(y.shop)) };
}

function sxForklift() {
  const rows = certsPerPerson().map(r => ({ r, cls: certStatusNow(r)[1] }));
  const days = (r) => Math.round((new Date(r.expiration_date) - new Date()) / SX_DAY);
  return {
    certified: rows.filter(x => x.cls === "b-current").length,
    expiring: rows.filter(x => x.cls === "b-expiring").sort((a, b) => String(a.r.expiration_date).localeCompare(String(b.r.expiration_date)))
      .map(x => ({ name: x.r.operator_name || x.r.email || "Someone", days: days(x.r) })),
    expired: rows.filter(x => x.cls === "b-expired").length,
    waiting: pendingTests().length
  };
}

function renderSafetyNavCounts() {
  const set = (key, n) => { const el = document.querySelector(`#safetyNav [data-sx-count="${key}"]`); if (el) el.textContent = n || ""; };
  const f = sxForklift();
  set("reports", srReports.filter(srPending).length);
  set("certs", f.expiring.length + f.expired);
  set("plans", plans.filter(p => p.status === "submitted").length);
  set("fkwaiting", fkWaiting.filter(r => !r.ran_out).length);
  set("fkrequired", reqNotMet("forklift").length);
  set("crrequired", reqNotMet("crane").length);
}

function sxTile(label, value, sub, opts = {}) {
  // A tile either opens a tab (go), or opens the people behind its number
  // under the row (drill, the Training dashboard), or does nothing.
  const open = opts.drill && txDrill === opts.drill;
  const action = opts.drill ? `data-tx-drill="${opts.drill}" aria-expanded="${open}" aria-controls="txDrill"`
    : `data-sx-go="${opts.go || ""}"`;
  return `<button type="button" class="sx-tile${opts.hot ? " hot" : ""}${opts.good ? " good" : ""}${open ? " open" : ""}" ${action} style="${lit(opts.lit || "ember")}">
    <span class="sx-tile-label">${esc(label)}</span>
    <b class="sx-tile-value">${value}</b>
    <span class="sx-tile-sub">${sub}</span>
  </button>`;
}

function sxQueueHtml(waiting, limit) {
  if (!waiting.length) return `<p class="sx-empty sx-clear">${icon("checkCircle", 18)} Nothing waiting. Every report has been approved.</p>`;
  const day = (iso) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return `<div class="sx-queue">${waiting.slice(0, limit).map(r => {
    const a = r.answers || {}, k = sxKind(r);
    return `<button type="button" class="sx-queue-row" data-sx-review="${esc(r.id)}">
      <span class="sx-queue-emoji">${sxEmoji(k) || "•"}</span>
      <span class="sx-queue-main"><b>${esc(srTitle(r))}</b>
        <small>${esc([srShortKind(k), a.where === "N/A" ? "Not at a location" : a.where, r.reporter_name, day(r.created_at)].filter(Boolean).join(" · "))}</small></span>
      ${a.follow_up === true ? `<span class="sx-flag">Follow up</span>` : ""}
      <span class="sx-go">Review &rsaquo;</span>
    </button>`;
  }).join("")}${waiting.length > limit ? `<button type="button" class="sx-more" data-sx-go="safetyreports">All ${waiting.length} waiting &rsaquo;</button>` : ""}</div>`;
}

function renderSafetyOverview() {
  const box = $("sxOverview");
  if (!box) return;
  renderSafetyNavCounts();
  const reports = srReports, waiting = reports.filter(srPending);
  const now = Date.now();
  const inDays = (r, from, to) => { const t = new Date(r.created_at).getTime(); return t >= now - from * SX_DAY && t < now - to * SX_DAY; };
  const last30 = reports.filter(r => inDays(r, 30, 0)).length, prior30 = reports.filter(r => inDays(r, 60, 30)).length;
  const year = reports.filter(r => inDays(r, 365, 0));
  const nearMisses = reports.filter(r => inDays(r, 90, 0) && /near miss/i.test(sxKind(r))).length;
  const follow = waiting.filter(r => (r.answers || {}).follow_up === true).length;
  const month = sxThisMonth(reports);
  const brief = sxBrief(), fork = sxForklift();
  const liftWaiting = plans.filter(p => p.status === "submitted");
  const delta = last30 - prior30;
  const briefPct = brief && brief.expected ? Math.round(brief.passed / brief.expected * 100) : 0;
  const today = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });

  const attention = [
    waiting.length && [`${waiting.length} Safety Report${waiting.length === 1 ? "" : "s"} to approve`, "safetyreports", "megaphone", "amber"],
    follow && [`${follow} asking for a follow-up`, "safetyreports", "phone", "amber"],
    liftWaiting.length && [`${liftWaiting.length} lift plan${liftWaiting.length === 1 ? "" : "s"} waiting for approval`, "plans", "rigging", "amber"],
    // The Safety Manager's required operators (0100, 0102) who don't hold it.
    ...[["forklift", "fkrequired", "forklift"], ["crane", "crrequired", "rigging"]].map(([kind, go, ic]) => {
      const n = reqNotMet(kind).length;
      return n && [`${n} required ${kind} operator${n === 1 ? " isn't" : "s aren't"} ${reqKinds[kind].met}`, go, ic, "red"];
    }),
    // Passed the online course and waiting for their driving test (0093): red
    // once anyone is in their last three days.
    (() => {
      const due = fkWaiting.filter(r => !r.ran_out);
      if (!due.length) return 0;
      const day0 = new Date(); day0.setHours(0, 0, 0, 0);
      const close = due.filter(r => Math.round((fkDay(r.last_day) - day0) / 86400000) <= 3).length;
      return [`${due.length} ${due.length === 1 ? "person" : "people"} waiting for a forklift driving test${close ? ` · ${close} in the last 3 days` : ""}`,
        "fkwaiting", "clock", close ? "red" : "amber"];
    })(),
    fork.expired && [`${fork.expired} forklift card${fork.expired === 1 ? "" : "s"} expired`, "certs", "forklift", "red"],
    fork.expiring.length && [`${fork.expiring.length} forklift card${fork.expiring.length === 1 ? "" : "s"} expiring within 60 days`, "certs", "forklift", "amber"],
    brief && brief.expected - brief.passed && [`${brief.expected - brief.passed} still to pass this month's Safety Brief`, "safetydesk", "doc", "amber"],
    !brief && ["This month's Safety Brief isn't up yet", "safetydesk", "doc", "red"]
  ].filter(Boolean);

  box.innerHTML = `<div class="sx">
    <section class="sx-hero">
      <div class="sx-hero-text">
        <span class="sx-kicker">${esc(today)}</span>
        <h2>${attention.length ? `${attention.length} thing${attention.length === 1 ? "" : "s"} need${attention.length === 1 ? "s" : ""} you` : "All clear"}</h2>
        <p>${attention.length ? esc(attention.slice(0, 2).map(a => a[0]).join(" · ")) : "Nothing waiting on the Safety Manager today."}</p>
        <div class="sx-pdfbar">
          <label for="sxPdfMonth">Monthly report</label>
          <select id="sxPdfMonth">${sxMonthOptions(sxPdfMonth)}</select>
          <button type="button" data-sx-pdf>${icon("doc", 15)}Download PDF</button>
          <span class="msg"></span>
        </div>
      </div>
      <button type="button" class="sx-count" data-sx-go="safetyreports" title="${sxNum(month.last)} last month">
        <b>${sxNum(month.count)}</b>
        <span>Safety Report${month.count === 1 ? "" : "s"} in ${esc(month.month)}</span>
      </button>
    </section>

    <div class="sx-tiles">
      ${sxTile("To approve", sxNum(waiting.length), waiting.length ? `${follow ? `${follow} want a follow-up` : "Safety Reports waiting"}` : "Nothing waiting", { go: "safetyreports", hot: waiting.length > 0, lit: "amber" })}
      ${sxTile("Reports · 30 days", sxNum(last30), `${delta === 0 ? "Same as" : delta > 0 ? `${delta} more than` : `${-delta} fewer than`} the 30 before`, { go: "safetyreports" })}
      ${sxTile("Near misses · 90 days", sxNum(nearMisses), "Every one is a lesson caught early", { go: "safetyreports" })}
      ${sxTile("Safety Brief", brief ? `${briefPct}<small>%</small>` : "—", brief ? `${brief.passed} of ${brief.expected} passed this month` : "This month's isn't up yet", { go: "safetydesk", lit: brief && briefPct >= 90 ? "green" : "ember", good: brief && briefPct >= 90 })}
      ${sxTile("Forklift cards", sxNum(fork.certified), `${fork.expiring.length} expiring · ${fork.expired} expired`, { go: "certs", lit: fork.expired ? "red" : "green", hot: fork.expired > 0 })}
      ${sxTile("Lift plans", sxNum(liftWaiting.length), liftWaiting.length ? "Waiting for approval" : "Nothing waiting", { go: "plans", lit: "slate", hot: liftWaiting.length > 0 })}
    </div>

    <div class="sx-grid">
      <section class="sx-panel sx-wide" style="${lit("ember")}">
        <header><h3>Safety Reports</h3><span>Last 12 months · ${sxNum(year.length)} sent</span>
          <button type="button" class="sx-link" data-sx-go="safetyreports">Open &rsaquo;</button></header>
        <div class="sx-split">
          <div>${sxMonthBars(reports)}</div>
          <div><h4>By type</h4>${sxRankHtml(sxByType(year).slice(0, 6), "No reports in the last year.")}</div>
        </div>
        <h4>By location · ${esc(sxMonthName(sxMonthKey()))} · ${sxNum(reports.filter(sxInMonth(sxMonthKey())).length)} sent</h4>
        ${sxShopBars(reports.filter(sxInMonth(sxMonthKey())))}
        <h4>Waiting for approval</h4>
        ${sxQueueHtml(waiting, 4)}
      </section>

      <section class="sx-panel" style="${lit("amber")}">
        <header><h3>Needs attention</h3></header>
        ${attention.length ? `<div class="sx-attn">${attention.map(([text, go, ic, tone]) => `<button type="button" class="sx-attn-row ${tone}" data-sx-go="${go}">
          ${icon(ic, 18)}<span>${esc(text)}</span><span class="sx-go">&rsaquo;</span></button>`).join("")}</div>`
          : `<p class="sx-empty sx-clear">${icon("checkCircle", 18)} All clear.</p>`}
      </section>

      <section class="sx-panel" style="${lit(brief && briefPct >= 90 ? "green" : "ember")}">
        <header><h3>Safety Desk</h3><button type="button" class="sx-link" data-sx-go="safetydesk">Open &rsaquo;</button></header>
        ${brief ? `<p class="sx-sub">${esc(briefMonthTitle(brief.brief))} · ${esc(brief.brief.title)}</p>
          <div class="sx-ring" style="--p:${briefPct}%"><b>${briefPct}<small>%</small></b></div>
          <div class="sx-shops">${brief.shops.map(t => { const pct = t.expected ? Math.round(t.passed / t.expected * 100) : 0;
            return `<div class="sx-shop"><span>${esc(t.shop)}</span><span class="sx-meter"><i style="width:${pct}%"></i></span><b>${t.passed}/${t.expected}</b></div>`; }).join("")}</div>`
          : `<p class="sx-empty">This month's Safety Brief isn't up yet. Write one, or reuse an old one.</p>`}
      </section>

      <section class="sx-panel" style="${lit(fork.expired ? "red" : "green")}">
        <header><h3>Forklift cards</h3><button type="button" class="sx-link" data-sx-go="certs">Open &rsaquo;</button></header>
        <div class="sx-trio"><div><b>${sxNum(fork.certified)}</b><span>Certified</span></div>
          <div class="amber"><b>${sxNum(fork.expiring.length)}</b><span>Expiring</span></div>
          <div class="red"><b>${sxNum(fork.expired)}</b><span>Expired</span></div></div>
        ${fork.expiring.length ? `<h4>Running out soonest</h4><div class="sx-list">${fork.expiring.slice(0, 5).map(x =>
          `<div><span>${esc(x.name)}</span><b>${x.days} day${x.days === 1 ? "" : "s"}</b></div>`).join("")}</div>`
          : `<p class="sx-empty">Nobody's card runs out in the next 60 days.</p>`}
        ${fork.waiting ? `<p class="sx-sub">${fork.waiting} driving test${fork.waiting === 1 ? "" : "s"} waiting for the Training Manager.</p>` : ""}
        ${(n => n ? `<button type="button" class="sx-attn-row red" data-sx-go="fkrequired" style="margin-top:8px">${icon("forklift", 16)}<span>${n} required forklift operator${n === 1 ? " isn't" : "s aren't"} certified</span></button>` : "")(reqNotMet("forklift").length)}
      </section>

      <section class="sx-panel" style="${lit("slate")}">
        <header><h3>Lift plans</h3><button type="button" class="sx-link" data-sx-go="plans">Open &rsaquo;</button></header>
        ${liftWaiting.length ? `<div class="sx-list">${liftWaiting.slice(0, 5).map(p => `<div><span>${esc(p.job_description || "Untitled lift")}
          <small>${esc([p.created_by_name, locations[p.location_id]].filter(Boolean).join(" · "))}</small></span>
          <b>${p.percent_capacity == null ? "" : Math.round(p.percent_capacity) + "%"}</b></div>`).join("")}</div>`
          : `<p class="sx-empty sx-clear">${icon("checkCircle", 18)} No lift plans waiting.</p>`}
        <p class="sx-sub">${sxNum(plans.filter(p => p.status === "approved").length)} approved · ${sxNum(plans.length)} in all</p>
        ${(n => n ? `<button type="button" class="sx-attn-row red" data-sx-go="crrequired" style="margin-top:8px">${icon("rigging", 16)}<span>${n} required crane operator${n === 1 ? " isn't" : "s aren't"} qualified</span></button>` : "")(reqNotMet("crane").length)}
      </section>
    </div>
  </div>`;
}

// The Safety Reports tab opens with the same picture, larger.
function renderSafetyReportStats() {
  const box = $("sxReportStats");
  if (!box) return;
  if (!isSafetyManager() || !srReports.length) { box.innerHTML = ""; return; }
  const reports = srReports, waiting = reports.filter(srPending);
  const year = reports.filter(r => Date.now() - new Date(r.created_at) < 365 * SX_DAY);
  const month = sxThisMonth(reports);
  box.innerHTML = `<div class="sx sx-reports">
    <div class="sx-tiles">
      ${sxTile("To approve", sxNum(waiting.length), "Waiting for a Safety Manager", { hot: waiting.length > 0, lit: "amber" })}
      ${sxTile("Approved", sxNum(reports.length - waiting.length), "In the Safety Center for everyone", { lit: "green" })}
      ${sxTile("Follow-ups asked", sxNum(year.filter(r => (r.answers || {}).follow_up === true).length), "In the last 12 months", {})}
      ${sxTile(`${month.month}`, sxNum(month.count), `Safety Reports this month · ${sxNum(month.last)} last month`, {})}
    </div>
    <section class="sx-panel" style="${lit("ember")}">
      <header><h3>The last 12 months</h3><span>${sxNum(year.length)} reports</span></header>
      <div class="sx-split">
        <div>${sxMonthBars(reports)}</div>
        <div><h4>By type</h4>${sxRankHtml(sxByType(year), "No reports in the last year.")}</div>
      </div>
      <h4>By location · ${esc(sxMonthName(sxMonthKey()))} · ${sxNum(month.count)} sent</h4>
      ${sxShopBars(reports.filter(sxInMonth(sxMonthKey())))}
    </section>
    ${sxWhoHtml()}
  </div>`;
}

// Who has and hasn't sent a Safety Report in a month, by location: everyone with an
// account by its end, and the reports each sent. Those who haven't can be
// emailed in BCC, as on the Safety Desk.
function sxWhoHtml() {
  const key = sxWhoMonth, everyone = sxPeopleIn(key);
  const sent = new Map();
  srReports.filter(sxInMonth(key)).forEach(r => { if (r.created_by) (sent.get(r.created_by) || sent.set(r.created_by, []).get(r.created_by)).push(r); });
  const shop = (p) => locations[p.location_id] || "No location set";
  const did = everyone.filter(p => sent.has(p.id)), didnt = everyone.filter(p => !sent.has(p.id));
  const shown = sxWhoFilter === "sent" ? did : sxWhoFilter === "not" ? didnt : everyone;
  const shops = {};
  shown.forEach(p => (shops[shop(p)] = shops[shop(p)] || []).push(p));
  const pct = everyone.length ? Math.round(did.length / everyone.length * 100) : 0;
  const day = (iso) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const emails = [...new Set(didnt.map(p => (p.email || "").trim()).filter(e => /@/.test(e)))];
  const bcc = bccButtons(emails);
  const pills = [["not", "Not yet", didnt.length], ["sent", "Sent one", did.length], ["all", "Everyone", everyone.length]];
  return `<section class="sx-panel sx-who-panel" style="${lit("teal")}">
    <header><h3>Who's sent a report</h3>
      <select id="sxWhoMonth" class="tx-store" aria-label="Month">${sxMonthOptions(key)}</select></header>
    <div class="sx-who-sum"><b>${did.length}</b><span>of ${everyone.length} people sent at least one in ${esc(sxMonthName(key))} · ${pct}%</span></div>
    <div class="sx-meter sx-who-meter"><i style="width:${pct}%"></i></div>
    <div class="sx-who-bar">
      <div class="sx-who-pills">${pills.map(([id, label, n]) => `<button type="button" class="sx-who-pill${sxWhoFilter === id ? " on" : ""}" data-sx-who="${id}">${label}<span>${n}</span></button>`).join("")}</div>
      ${didnt.length && sxWhoFilter !== "sent" ? `<div class="row sx-who-mail">${bcc.html}
        ${emails.length ? `<button type="button" class="ghost" data-sd-copy="${esc(emails.join("; "))}">Copy the addresses</button>` : ""}<span class="msg"></span></div>` : ""}
    </div>
    ${didnt.length && sxWhoFilter !== "sent" ? `<p class="sx-sub">Email opens your mail app with everyone who hasn't sent one in <b>BCC</b>; write the rest yourself.${
      bcc.split ? " The list is long, so it's split into a few emails." : ""}</p>` : ""}
    <div class="sx-who-shops">${Object.keys(shops).sort().map(name => `<div class="sx-who-shop">
      <h4>${esc(name)} <span>${shops[name].length}</span></h4>
      ${shops[name].sort((a, b) => (a.full_name || a.email || "").localeCompare(b.full_name || b.email || "")).map(p => {
        const mine = sent.get(p.id) || [];
        return `<div class="sx-who-row${mine.length ? " did" : ""}"><i></i><span>${esc(p.full_name || p.email || "No name yet")}</span>
          <small>${mine.length ? `${mine.length} report${mine.length === 1 ? "" : "s"} · ${mine.map(r => day(r.created_at)).join(", ")}` : "None yet"}</small></div>`;
      }).join("")}</div>`).join("") || `<p class="sx-empty sx-clear">${icon("checkCircle", 18)} ${sxWhoFilter === "not" ? "Everyone has sent one." : "Nobody to show."}</p>`}</div>
  </section>`;
}

$("admin").addEventListener("change", (event) => {
  if (event.target.id === "sxWhoMonth") { sxWhoMonth = event.target.value; renderSafetyReportStats(); }
});
$("admin").addEventListener("click", (event) => {
  const pill = event.target.closest("[data-sx-who]");
  if (pill) { sxWhoFilter = pill.dataset.sxWho; renderSafetyReportStats(); }
});

$("admin").addEventListener("click", (event) => {
  const review = event.target.closest("[data-sx-review]");
  if (review) {
    srrOpenId = review.dataset.sxReview;
    renderSafetyReportsAdmin();
    return document.querySelector('#safetyNav [data-tab="safetyreports"]').click();
  }
  const go = event.target.closest("[data-sx-go]");
  if (go && go.dataset.sxGo) document.querySelector(`#safetyNav [data-tab="${go.dataset.sxGo}"]`).click();
});

// ---- the monthly safety report, as a PDF -----------------------------------------
//
// One month, for leadership: the headline numbers, the Safety Reports trend, the
// month's Safety Brief by location and who hasn't passed it, the month's reports by
// type and location, who sent one and who didn't, the required forklift and crane
// operators who don't hold it, and every report in full.
// Confidential: it names who sent each report. jsPDF's fonts are Latin-1, so
// emoji are dropped and dashes and quotes made plain.
async function sxMonthlyPdf(key) {
  const month = sxMonthName(key);
  const latin = (t) => String(t ?? "").replace(/[–—]/g, "-").replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"').replace(/…/g, "...").replace(/[^\x00-\xFF]/g, "").replace(/[ \t]+\n/g, "\n").trim();
  const doc = new jspdf.jsPDF({ unit: "pt", format: "letter" });
  const W = 612, H = 792, M = 44, CW = W - M * 2, BOTTOM = H - M - 20;
  const red = [204, 0, 51], ink = [30, 30, 30], grey = [110, 110, 110], light = [246, 245, 243], rule = [226, 224, 222];
  const green = [23, 112, 47], amber = [180, 110, 10];
  const day = (iso) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const shopOf = (p) => locations[p.location_id] || "No location set";
  let y = 0;

  const smallHead = () => {
    doc.setFillColor(...red); doc.rect(0, 0, W, 6, "F");
    doc.setFont("helvetica", "bold"); doc.setFontSize(8); doc.setTextColor(...grey);
    doc.text(`AGRI-SERVICE  -  MONTHLY SAFETY REPORT  -  ${month.toUpperCase()}`, M, 24);
    y = 42;
  };
  const ensure = (h, then) => { if (y + h > BOTTOM) { doc.addPage(); smallHead(); if (then) then(); } };
  const section = (title, sub) => {
    ensure(70); y += 14;
    doc.setFont("helvetica", "bold"); doc.setFontSize(13); doc.setTextColor(...ink); doc.text(title.toUpperCase(), M, y);
    doc.setFillColor(...red); doc.rect(M, y + 6, 40, 2.5, "F"); y += 20;
    if (sub) { doc.setFont("helvetica", "normal"); doc.setFontSize(9.5); doc.setTextColor(...grey);
      doc.splitTextToSize(latin(sub), CW).forEach(l => { doc.text(l, M, y); y += 12; }); y += 4; }
  };
  // A table: columns of [label, width, "r" for right-aligned]; rows of strings.
  const table = (cols, rows, opts = {}) => {
    const xs = []; cols.reduce((x, c) => (xs.push(x), x + c[1]), opts.x || M);
    const width = cols.reduce((t, c) => t + c[1], 0);
    const head = () => {
      doc.setFillColor(238, 236, 233); doc.rect(opts.x || M, y, width, 17, "F");
      doc.setFont("helvetica", "bold"); doc.setFontSize(7.5); doc.setTextColor(...grey);
      cols.forEach(([label, w, a], i) => doc.text(label.toUpperCase(), a ? xs[i] + w - 5 : xs[i] + 5, y + 11.5, a ? { align: "right" } : {}));
      y += 17;
    };
    ensure(40); head();
    rows.forEach((row, n) => {
      doc.setFontSize(8.8);
      const cells = row.map((v, i) => doc.splitTextToSize(latin(v), cols[i][1] - 10));
      const h = Math.max(...cells.map(c => c.length)) * 11 + 8;
      ensure(h, head);
      // A page break redraws the header in its own smaller type.
      doc.setFontSize(8.8);
      if (n % 2) { doc.setFillColor(...light); doc.rect(opts.x || M, y, width, h, "F"); }
      cells.forEach((lines, i) => {
        const bold = opts.bold === i, color = opts.color ? opts.color(row, i) : null;
        doc.setFont("helvetica", bold ? "bold" : "normal"); doc.setTextColor(...(color || ink));
        lines.forEach((l, j) => doc.text(l, cols[i][2] ? xs[i] + cols[i][1] - 5 : xs[i] + 5, y + 12 + j * 11, cols[i][2] ? { align: "right" } : {}));
      });
      doc.setDrawColor(...rule); doc.line(opts.x || M, y + h, (opts.x || M) + width, y + h);
      y += h;
    });
    if (!rows.length) { doc.setFont("helvetica", "italic"); doc.setFontSize(9); doc.setTextColor(...grey); doc.text(opts.empty || "None.", (opts.x || M) + 5, y + 13); y += 20; }
  };

  // The month's figures.
  const reports = srReports.filter(sxInMonth(key)).sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  const everyone = sxPeopleIn(key);
  const waiting = reports.filter(srPending).length;
  const kindIs = (re) => reports.filter(r => re.test(sxKind(r))).length;
  const follow = reports.filter(r => (r.answers || {}).follow_up === true).length;
  const senders = new Map();
  reports.forEach(r => { if (r.created_by) senders.set(r.created_by, (senders.get(r.created_by) || 0) + 1); });
  const brief = (safetyBriefs || []).find(b => b.is_published && b.month === `${key}-01`);
  const briefPeople = brief ? everyone.map(p => ({ p, r: briefResult(brief, p.id) })) : [];
  const passed = briefPeople.filter(x => x.r && x.r.passed_at);
  const pct = (a, b) => b ? Math.round(a / b * 100) : 0;

  // The band.
  doc.setFillColor(...red); doc.rect(0, 0, W, 84, "F");
  doc.setTextColor(255); doc.setFont("helvetica", "bold"); doc.setFontSize(22); doc.text("AGRI-SERVICE", M, 38);
  doc.setFontSize(10); doc.text("MONTHLY SAFETY REPORT", M, 56);
  doc.setFontSize(20); doc.text(month, W - M, 40, { align: "right" });
  doc.setFont("helvetica", "normal"); doc.setFontSize(9);
  doc.text(latin(`Prepared ${new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}${profile && profile.full_name ? ` by ${profile.full_name}` : ""}`), W - M, 58, { align: "right" });
  y = 108;
  doc.setFont("helvetica", "normal"); doc.setFontSize(10); doc.setTextColor(...grey);
  doc.text(latin(`Safety Reports and the Safety Brief for ${month}, across every location.`), M, y); y += 18;

  // The headline numbers, two rows of three.
  const boxes = [
    ["SAFETY REPORTS", String(reports.length), `${reports.length - waiting} approved - ${waiting} waiting`, ink],
    ["NEAR MISSES", String(kindIs(/near miss/i)), "Close calls reported", ink],
    ["WORK-RELATED INJURIES", String(kindIs(/work-related injury/i)), "Reported this month", kindIs(/work-related injury/i) ? red : green],
    ["SAFETY BRIEF", brief ? `${pct(passed.length, briefPeople.length)}%` : "-", brief ? `${passed.length} of ${briefPeople.length} passed` : "None published", brief && pct(passed.length, briefPeople.length) >= 90 ? green : brief ? amber : grey],
    ["SENT A REPORT", `${senders.size}`, `of ${everyone.length} people - ${pct(senders.size, everyone.length)}%`, ink],
    ["FOLLOW-UPS ASKED", String(follow), "People asking to be contacted", follow ? amber : ink]
  ];
  const bw = (CW - 20) / 3, bh = 62;
  boxes.forEach(([label, value, sub, color], i) => {
    const bx = M + (i % 3) * (bw + 10), by = y + Math.floor(i / 3) * (bh + 10);
    doc.setFillColor(...light); doc.roundedRect(bx, by, bw, bh, 4, 4, "F");
    doc.setFillColor(...red); doc.rect(bx, by, 3, bh, "F");
    doc.setFont("helvetica", "bold"); doc.setFontSize(7.5); doc.setTextColor(...grey); doc.text(label, bx + 12, by + 15);
    doc.setFontSize(22); doc.setTextColor(...color); doc.text(value, bx + 12, by + 40);
    doc.setFont("helvetica", "normal"); doc.setFontSize(8.5); doc.setTextColor(...grey); doc.text(latin(sub), bx + 12, by + 53);
  });
  y += bh * 2 + 28;

  // Reports by month, up to twelve, ending this month. Only from the first
  // month anyone sent one: before that it's a row of empty bars. With a single
  // month there's nothing to compare, and the box above already has it.
  const end = dateOnly(key + "-01");
  const first = srReports.map(r => sxMonthKey(new Date(r.created_at))).sort()[0] || key;
  const [fy, fm] = first.split("-").map(Number);
  const span = Math.max(1, Math.min(12, (end.getFullYear() - fy) * 12 + end.getMonth() + 1 - fm + 1));
  if (span >= 2) {
    const months = Array.from({ length: span }, (_, i) => sxMonthKey(new Date(end.getFullYear(), end.getMonth() - span + 1 + i, 1)));
    doc.setFont("helvetica", "bold"); doc.setFontSize(8); doc.setTextColor(...grey);
    doc.text(span === 12 ? "SAFETY REPORTS, 12 MONTHS TO " + month.toUpperCase()
      : "SAFETY REPORTS BY MONTH, SINCE " + sxMonthName(months[0]).toUpperCase(), M, y);
    // Room for the count over the tallest bar.
    y += 16;
    const counts = months.map(k => srReports.filter(sxInMonth(k)).length);
    const top = Math.max(1, ...counts), ch = 50, cw = CW / 12;
    counts.forEach((n, i) => {
      const h = n / top * ch, x = M + i * cw;
      doc.setFillColor(...(months[i] === key ? red : [205, 200, 196])); doc.rect(x + cw * 0.18, y + ch - h, cw * 0.64, Math.max(h, 1), "F");
      doc.setFont("helvetica", "bold"); doc.setFontSize(7.5); doc.setTextColor(...ink); if (n) doc.text(String(n), x + cw / 2, y + ch - h - 3, { align: "center" });
      doc.setFont("helvetica", "normal"); doc.setTextColor(...grey);
      doc.text(dateOnly(months[i] + "-01").toLocaleDateString("en-US", { month: "short" }), x + cw / 2, y + ch + 11, { align: "center" });
    });
    y += ch + 16;
  }

  // The Safety Brief.
  section("Safety Brief", brief ? `${latin(brief.title)}. Everyone with an account by the end of ${month} is expected to pass it.`
    : `No Safety Brief was published for ${month}.`);
  if (brief) {
    const shops = {};
    briefPeople.forEach(x => { const s = shopOf(x.p); const t = shops[s] = shops[s] || { e: 0, p: 0 }; t.e++; if (x.r && x.r.passed_at) t.p++; });
    table([["Location", 230], ["Expected", 80, "r"], ["Passed", 80, "r"], ["Not passed", 80, "r"], ["Passed %", CW - 470, "r"]],
      Object.keys(shops).sort().map(s => [s, String(shops[s].e), String(shops[s].p), String(shops[s].e - shops[s].p), `${pct(shops[s].p, shops[s].e)}%`])
        .concat([["All locations", String(briefPeople.length), String(passed.length), String(briefPeople.length - passed.length), `${pct(passed.length, briefPeople.length)}%`]]),
      { bold: 0, color: (row, i) => i === 4 ? (parseInt(row[4]) >= 90 ? green : amber) : null });
    const notPassed = briefPeople.filter(x => !(x.r && x.r.passed_at)).sort((a, b) => shopOf(a.p).localeCompare(shopOf(b.p)) || (a.p.full_name || "").localeCompare(b.p.full_name || ""));
    if (notPassed.length) {
      y += 22; ensure(40);
      doc.setFont("helvetica", "bold"); doc.setFontSize(9); doc.setTextColor(...ink); doc.text(`Not passed (${notPassed.length})`, M, y); y += 8;
      const n = (brief.questions || []).length;
      table([["Name", 200], ["Location", 150], ["Where they are", CW - 350]], notPassed.map(({ p, r }) => [p.full_name || p.email || "No name yet", shopOf(p),
        !r ? "Not started" : r.tries ? `${r.tries} ${r.tries === 1 ? "try" : "tries"}, last ${r.last_score} of ${n}` : "Started, not answered"]));
    }
  }

  // The reports.
  section("Safety Reports", reports.length ? `${reports.length} sent in ${month}: ${reports.length - waiting} approved, ${waiting} waiting for approval.`
    : `No Safety Reports were sent in ${month}.`);
  if (reports.length) {
    const tally = (fn) => { const t = {}; reports.forEach(r => { const k = fn(r); if (k) t[k] = (t[k] || 0) + 1; }); return Object.entries(t).sort((a, b) => b[1] - a[1]); };
    const types = tally(r => srShortKind(sxKind(r)) || "No type");
    const wheres = tally(r => { const w = (r.answers || {}).where; return w ? (w === "N/A" ? "Not at a location" : w) : "Not given"; });
    const half = (CW - 16) / 2;
    // Side by side on one page, so the second doesn't start where the first
    // left off on the page before.
    ensure(17 + 19 * Math.max(types.length, wheres.length) + 4);
    const startY = y;
    table([["By type", half - 60], ["Reports", 60, "r"]], types.map(([k, n]) => [k, String(n)]));
    const leftEnd = y; y = startY;
    table([["By location", half - 60], ["Reports", 60, "r"]], wheres.map(([k, n]) => [k, String(n)]), { x: M + half + 16 });
    y = Math.max(y, leftEnd) + 14;
    table([["Sent", 52], ["Title", 150], ["Type", 92], ["Where", 74], ["Reported by", 96], ["Status", CW - 464]],
      reports.map(r => { const a = r.answers || {};
        return [day(r.created_at), srTitle(r), srShortKind(sxKind(r)) || "-", a.where ? (a.where === "N/A" ? "Not at a location" : a.where) : "-",
          r.reporter_name || "-", (srPending(r) ? "Waiting" : "Approved") + (a.follow_up === true ? " - follow-up asked" : "")]; }),
      { bold: 1, color: (row, i) => i === 5 ? (/Waiting/.test(row[5]) ? amber : green) : null });
  }

  // Who sent one.
  section("Participation", `${senders.size} of ${everyone.length} people sent at least one Safety Report in ${month}.`);
  const sentRows = everyone.filter(p => senders.has(p.id)).sort((a, b) => shopOf(a).localeCompare(shopOf(b)) || (a.full_name || "").localeCompare(b.full_name || ""));
  table([["Sent a report", 220], ["Location", 170], ["Reports", CW - 390, "r"]], sentRows.map(p => [p.full_name || p.email || "No name yet", shopOf(p), String(senders.get(p.id))]),
    { empty: "Nobody sent one this month." });
  const none = everyone.filter(p => !senders.has(p.id));
  if (none.length) {
    y += 22; ensure(40);
    doc.setFont("helvetica", "bold"); doc.setFontSize(9); doc.setTextColor(...ink); doc.text(`No report this month (${none.length})`, M, y); y += 14;
    const byShop = {};
    none.forEach(p => (byShop[shopOf(p)] = byShop[shopOf(p)] || []).push(p.full_name || p.email || "No name yet"));
    Object.keys(byShop).sort().forEach(s => {
      ensure(26);
      doc.setFont("helvetica", "bold"); doc.setFontSize(8.5); doc.setTextColor(...grey); doc.text(latin(`${s} (${byShop[s].length})`), M, y); y += 11;
      doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(...ink);
      doc.splitTextToSize(latin(byShop[s].sort().join(", ")), CW).forEach(l => { ensure(12); doc.text(l, M, y); y += 11.5; });
      y += 6;
    });
  }

  // The Safety Manager's required operators (0100, 0102) who don't hold it. As
  // of today, not the month's end: whether someone may drive or lift is a
  // question about now, and the lists keep no history.
  const asOf = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  section("Required operators", `People the Safety Manager requires to be forklift certified or crane qualified who aren't, as of ${asOf}.`);
  [["forklift", "Forklift - not certified"], ["crane", "Crane & rigging - not qualified"]].forEach(([kind, title], n) => {
    const k = reqKinds[kind];
    const rows = k.rows.map(r => ({ r, st: k.status(r), store: reqStoreOf(r), name: reqName(r) }));
    const not = rows.filter(x => !x.st.met).sort((a, b) => a.store.localeCompare(b.store) || a.name.localeCompare(b.name));
    y += n ? 22 : 6;
    ensure(40);
    doc.setFont("helvetica", "bold"); doc.setFontSize(9); doc.setTextColor(...ink);
    doc.text(latin(`${title} (${not.length} of ${rows.length} required)`), M, y); y += 8;
    const tones = new Map();
    table([["Name", 140], ["Location", 100], ["Status", 170], ["Why they're required", CW - 410]],
      not.map(x => { const row = [x.name, x.store, x.st.why ? `${x.st.label}: ${x.st.why}` : x.st.label, x.r.note || "-"];
        tones.set(row, x.st.tone); return row; }),
      { bold: 0, color: (row, i) => i === 2 ? (tones.get(row) === "warn" ? amber : red) : null,
        empty: k.error ? `The list couldn't be read: ${k.error}`
          : rows.length ? `Every required ${kind} operator is ${k.met}.` : "Nobody is on the list." });
  });

  // Every report in full, last.
  if (reports.length) {
    section("Report details");
    reports.forEach((r, n) => {
      const a = r.answers || {};
      ensure(70);
      doc.setFillColor(...light); doc.rect(M, y, CW, 34, "F"); doc.setFillColor(...red); doc.rect(M, y, 3, 34, "F");
      doc.setFont("helvetica", "bold"); doc.setFontSize(10.5); doc.setTextColor(...ink);
      doc.text(doc.splitTextToSize(latin(`${n + 1}. ${srTitle(r)}`), CW - 20)[0], M + 12, y + 14);
      doc.setFont("helvetica", "normal"); doc.setFontSize(8.5); doc.setTextColor(...grey);
      doc.text(doc.splitTextToSize(latin([srShortKind(sxKind(r)), `sent ${day(r.created_at)}`, a.date ? `happened ${dateOnly(a.date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}` : "",
        a.where ? (a.where === "N/A" ? "not at a location" : `at ${a.where}`) : "", r.reporter_name ? `by ${r.reporter_name}${r.reporter_location ? `, ${srShop(r.reporter_location)}` : ""}` : "",
        srPending(r) ? "waiting for approval" : "approved"].filter(Boolean).join("  -  ")), CW - 20)[0], M + 12, y + 27);
      y += 42;
      const skip = new Set(["title", "kind", "date", "where"]);
      (r.fields_snapshot || []).filter(f => !skip.has(f.id) && f.type !== "photos").forEach(f => {
        const v = srDisplay(r, f);
        if (!v) return;
        ensure(28);
        doc.setFont("helvetica", "bold"); doc.setFontSize(7.5); doc.setTextColor(...grey); doc.text(latin(f.label).toUpperCase(), M + 12, y); y += 11;
        doc.setFont("helvetica", "normal"); doc.setFontSize(9.5); doc.setTextColor(...ink);
        latin(v).split("\n").forEach(par => doc.splitTextToSize(par || " ", CW - 24).forEach(line => { ensure(13); doc.text(line, M + 12, y); y += 12; }));
        y += 5;
      });
      const photos = srPhotoPaths(r).length;
      if (photos) { doc.setFont("helvetica", "italic"); doc.setFontSize(8.5); doc.setTextColor(...grey); doc.text(`${photos} photo${photos === 1 ? "" : "s"} attached (see the report's own PDF).`, M + 12, y); y += 12; }
      y += 10;
    });
  }

  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p); doc.setDrawColor(220); doc.line(M, H - M + 2, M + CW, H - M + 2);
    doc.setFont("helvetica", "normal"); doc.setFontSize(7.5); doc.setTextColor(...grey);
    doc.text(latin(`Agri-Service, LLC  -  Monthly Safety Report  -  ${month}  -  Confidential: for safety and leadership use`), M, H - M + 14);
    doc.setFont("helvetica", "bold"); doc.text(`Page ${p} of ${pages}`, W - M, H - M + 14, { align: "right" });
  }
  doc.save(`Monthly Safety Report ${key}.pdf`);
}

$("admin").addEventListener("change", (event) => {
  if (event.target.id === "sxPdfMonth") sxPdfMonth = event.target.value;
});
$("admin").addEventListener("click", async (event) => {
  const btn = event.target.closest("[data-sx-pdf]");
  if (!btn) return;
  const row = btn.closest(".sx-pdfbar");
  btn.disabled = true; speak(row, "Making the report…", false);
  try { await sxMonthlyPdf(sxPdfMonth); speak(row, `Downloaded ${sxMonthName(sxPdfMonth)}.`, false); }
  catch (e) { speak(row, `Couldn't make it: ${e.message}`, true); }
  btn.disabled = false;
});

// ---- required operators: forklift (0100) and crane (0102) ---------------------------
//
// The Safety Manager's lists of the people who must hold a forklift
// certification, or the Crane & Rigging Qualification. Every other forklift
// and crane report starts from the cards or the course, so someone who does
// the work without one showed up nowhere. Each person is kept like their
// training record: employee number, then email. The two lists share all of
// this; only what counts as holding it, and the words, differ.
const reqKinds = {
  forklift: {
    table: "forklift_required", migration: "0100_forklift_required.sql", box: "fkRequired",
    title: "Required forklift operators", met: "certified", notMet: "Not certified", status: fkReqStatus,
    intro: () => `Everyone who drives a forklift and must hold a certification. The certification reports only show
      people who have a card; this list also catches anyone who drives one without. Their location's admin sees anyone
      here who isn't certified at the top of the Location Dashboard.`,
    placeholder: "Optional: what they drive", keeps: "Their certification records stay as they are.",
    rows: [], error: null, view: "not", store: "all", query: ""
  },
  crane: {
    table: "crane_required", migration: "0102_crane_required.sql", box: "crRequired",
    title: "Required crane operators", met: "qualified", notMet: "Not qualified", status: crReqStatus,
    intro: () => `Everyone who runs a crane or rigs a lift and must hold the Crane &amp; Rigging Qualification. The crane
      reports only show people who have taken ${esc(craneCourse())}; this list also catches anyone who does the work
      without it. Their location's admin sees anyone here who isn't qualified at the top of the Location Dashboard.`,
    placeholder: "Optional: which crane, or what they lift", keeps: "Their qualification stays as it is.",
    rows: [], error: null, view: "not", store: "all", query: ""
  }
};
// The people on a list who don't hold it today.
const reqNotMet = (kind) => reqKinds[kind].rows.filter(r => !reqKinds[kind].status(r).met);

// Their row on the UKG roster, where they still are on it.
function reqRoster(row) {
  return tsPeople.find(t => t.person_key === row.person_key)
    || (row.employee_number && tsPeople.find(t => t.employee_number === row.employee_number))
    || (row.email && tsPeople.find(t => (t.email || "").toLowerCase() === row.email)) || null;
}
const reqStoreOf = (row) => { const t = reqRoster(row); return (t && t.store) || row.store || "Not on the roster"; };
const reqName = (row) => { const t = reqRoster(row); return t ? `${t.first_name} ${t.last_name}`.trim() : row.name || row.email || "Someone"; };

// Whether they can drive today, and what to say: their newest card, by email,
// or by name for an old card with none.
function fkReqStatus(row) {
  const t = reqRoster(row);
  const number = (t && t.employee_number) || row.employee_number;
  // Their emails: UKG's, the one kept with them here, and their app account's.
  const account = number && people.find(p => p.employee_number === number);
  const emails = new Set([t && t.email, row.email, account && account.email]
    .map(e => (e || "").trim().toLowerCase()).filter(Boolean));
  const nameKey = tsNameKey(reqName(row), "");
  const card = certsPerPerson().find(c => {
    const e = (c.email || "").trim().toLowerCase();
    return e ? emails.has(e) : nameKey && tsNameKey(c.operator_name || "", "") === nameKey;
  });
  const due = evalPeople.find(p => emails.has((p.email || "").toLowerCase()));
  if (card) {
    const [label, cls] = certStatusNow(card);
    if (cls === "b-current") return { label: `Certified until ${fmtDate(card.expiration_date)}`, tone: "ok", met: true, card };
    if (cls === "b-expiring") return { label: `Certified · ${label.replace(/^Expiring · /, "")} left`, tone: "warn", met: true, card };
    if (cls === "b-pending") return { label: "Test waiting for approval", tone: "warn", met: false, card };
    if (due) return { label: `${label} · driving test due by ${fmtDate(due.last_day)}`, tone: "bad", met: false, card };
    return { label: label === "Expired" ? `Expired ${fmtDate(card.expiration_date)}` : label, tone: "bad", met: false, card };
  }
  if (due) return { label: `Not certified · passed the course, driving test due by ${fmtDate(due.last_day)}`, tone: "bad", met: false };
  return { label: "Not certified", tone: "bad", met: false };
}

// Whether they're qualified today, and what to say: the course on their
// training history, less any removal, as the Crane Center decides it.
function crReqStatus(row) {
  const t = reqRoster(row);
  const st = t ? craneStatus(t) : { kind: "none" };
  if (st.kind === "qualified") {
    const left = st.expires ? Math.round((st.expires - new Date(new Date().toDateString())) / 86400000) : null;
    if (left !== null && left <= 60) return { label: `Qualified · ${left} day${left === 1 ? "" : "s"} left`, tone: "warn", met: true };
    return { label: st.expires ? `Qualified until ${craneDay(st.expires)}` : "Qualified", tone: "ok", met: true };
  }
  if (st.kind === "expired") return { label: `Expired ${craneDay(st.expires)}`, tone: "bad", met: false };
  if (st.kind === "removed") return { label: "Qualification removed", tone: "bad", met: false, why: st.change.reason };
  return { label: t ? "Not qualified · hasn't taken the course" : "Not qualified", tone: "bad", met: false };
}

function renderRequired(kind) {
  const k = reqKinds[kind], box = $(k.box);
  if (!box) return;
  if (k.error) {
    box.innerHTML = `<h2>${k.title}</h2><p class="error">${new RegExp(`${k.table}|does not exist|schema cache`, "i").test(k.error)
      ? `Run migration ${k.migration} in the SQL editor, then reload this page.` : esc(k.error)}</p>`;
    return;
  }
  const canChange = isSafetyManager();
  const rows = k.rows.map(r => ({ r, st: k.status(r), store: reqStoreOf(r), name: reqName(r) }));
  const stores = [...new Set(rows.map(x => x.store))].sort();
  if (k.store !== "all" && !stores.includes(k.store)) k.store = "all";
  const atStore = rows.filter(x => k.store === "all" || x.store === k.store);
  const notMet = atStore.filter(x => !x.st.met);
  const shown = (k.view === "not" ? notMet : atStore)
    .sort((a, b) => (a.st.met - b.st.met) || a.store.localeCompare(b.store) || a.name.localeCompare(b.name));
  const emails = [...new Set(notMet.map(x => ((reqRoster(x.r) || {}).email || x.r.email || "").toLowerCase()).filter(e => /@/.test(e)))];
  const { html: mailButtons } = bccButtons(emails);

  // Adding: anyone on All employees who isn't on the list yet.
  const on = new Set(k.rows.map(r => r.person_key));
  const words = k.query.toLowerCase().split(/\s+/).filter(Boolean);
  const matches = words.length ? tsPeople.filter(t => !on.has(t.person_key)
      && words.every(w => `${t.first_name} ${t.last_name} ${t.store} ${t.job}`.toLowerCase().includes(w)))
    .sort((a, b) => a.last_name.localeCompare(b.last_name)).slice(0, 12) : [];
  const tone = (t) => t === "ok" ? "b-current" : t === "warn" ? "b-expiring" : "b-expired";
  const operators = (n) => n === 1 ? "operator" : "operators";

  box.innerHTML = `<h2>${k.title}</h2>
    <p class="note" style="margin:0 0 12px">${k.intro()}</p>
    ${canChange ? `<div class="fkreq-add">
      <label for="reqSearch-${kind}">Require someone</label>
      <input id="reqSearch-${kind}" class="search" type="search" data-req-search placeholder="Search All employees by name, location or job" autocomplete="off" value="${esc(k.query)}">
      ${words.length ? (matches.length ? `<div class="fkreq-matches">${matches.map(t => `<button type="button" data-req-add="${esc(t.person_key)}">
          <b>${esc(`${t.first_name} ${t.last_name}`.trim())}</b><span>${esc([t.store, (t.job || "").replace(/^\d+\s*-\s*/, "")].filter(Boolean).join(" · "))}</span>
          <em>Require</em></button>`).join("")}</div>`
        : `<p class="note">${tsPeople.length ? "Nobody on All employees by that name who isn't on the list already." : "Training Status hasn't loaded All employees yet."}</p>`) : ""}
    </div>` : `<p class="note">Only the Safety Manager adds people to this list.</p>`}
    <div class="row" style="margin:14px 0 10px">
      <select id="reqStore-${kind}" data-req-store style="max-width:260px;margin:0" aria-label="Location">
        <option value="all">All locations</option>${stores.map(x => `<option${x === k.store ? " selected" : ""}>${esc(x)}</option>`).join("")}
      </select>
    </div>
    <div class="chips sd-missing-toggle">
      <button type="button" class="chip${k.view === "not" ? " on" : ""}" data-req-view="not">${k.notMet} · ${notMet.length}</button>
      <button type="button" class="chip${k.view === "all" ? " on" : ""}" data-req-view="all">Everyone required · ${atStore.length}</button></div>
    <p class="sd-missing-sum">${!k.rows.length ? "Nobody is on the list yet."
      : notMet.length ? `<b>${notMet.length}</b> of ${atStore.length} required ${operators(atStore.length)} ${notMet.length === 1 ? "isn't" : "aren't"} ${k.met}.`
      : `Every required operator${k.store === "all" ? "" : ` at ${esc(k.store)}`} is ${k.met}.`}</p>
    ${k.view === "not" && emails.length ? `<div class="row sd-mail-row">${mailButtons}
      <button type="button" class="ghost" data-sd-copy="${esc(emails.join("; "))}">Copy the addresses</button><span class="msg"></span></div>
      <p class="note" style="margin:6px 0 12px">Opens a new email to the ones not ${k.met}, everyone in <b>BCC</b>.</p>` : ""}
    ${shown.length ? `<div style="overflow-x:auto"><table class="sd-missing fkreq-table">
      <thead><tr><th>Name</th><th>Location</th><th>Status</th><th>Why</th>${canChange ? "<th></th>" : ""}</tr></thead>
      <tbody>${shown.map(x => `<tr>
        <td><b>${esc(x.name)}</b><div class="note" style="font-size:12px">Added by ${esc(x.r.required_by_name || "the Safety Manager")}${
          x.r.required_at ? `, ${esc(fmtDate(String(x.r.required_at).slice(0, 10)))}` : ""}</div></td>
        <td>${esc(x.store)}</td>
        <td><span class="badge ${tone(x.st.tone)}">${esc(x.st.label)}</span>${
          x.st.why ? `<div class="note" style="font-size:12px">${esc(x.st.why)}</div>` : ""}</td>
        <td>${canChange ? `<input data-req-note="${esc(x.r.person_key)}" value="${esc(x.r.note || "")}" maxlength="300"
              placeholder="${k.placeholder}" aria-label="Why ${esc(x.name)} is required" style="margin:0;min-width:160px">` : esc(x.r.note || "—")}</td>
        ${canChange ? `<td style="text-align:right"><button type="button" class="ghost" data-req-remove="${esc(x.r.person_key)}">Remove</button></td>` : ""}
      </tr>`).join("")}</tbody></table></div>` : ""}`;
}

// Each list's card says which it is, so one set of handlers serves both.
const reqKindOf = (el) => { const host = el.closest("[data-req-kind]"); return host ? host.dataset.reqKind : null; };

$("admin").addEventListener("input", (event) => {
  if (!event.target.matches("[data-req-search]")) return;
  const kind = reqKindOf(event.target);
  reqKinds[kind].query = event.target.value;
  const at = event.target.selectionStart;
  renderRequired(kind);
  const again = $(`reqSearch-${kind}`);
  if (again) { again.focus(); again.setSelectionRange(at, at); }
});
$("admin").addEventListener("change", async (event) => {
  const kind = reqKindOf(event.target);
  if (!kind) return;
  const k = reqKinds[kind];
  if (event.target.matches("[data-req-store]")) { k.store = event.target.value; return renderRequired(kind); }
  const note = event.target.closest("[data-req-note]");
  if (!note) return;
  const row = k.rows.find(r => r.person_key === note.dataset.reqNote);
  if (!row) return;
  const text = note.value.trim();
  if (text === (row.note || "")) return;
  const { error } = await db.from(k.table).update({ note: text }).eq("person_key", row.person_key);
  if (error) { note.value = row.note || ""; return alert(`Not saved: ${error.message}`); }
  row.note = text;
});
$("admin").addEventListener("click", async (event) => {
  const kind = reqKindOf(event.target);
  if (!kind) return;
  const k = reqKinds[kind];
  const view = event.target.closest("[data-req-view]");
  if (view) { k.view = view.dataset.reqView; return renderRequired(kind); }
  const add = event.target.closest("[data-req-add]");
  if (add) {
    const t = tsPeople.find(x => x.person_key === add.dataset.reqAdd);
    if (!t) return;
    add.disabled = true;
    const row = { person_key: t.person_key, employee_number: t.employee_number || null,
      email: (t.email || "").trim().toLowerCase() || null, name: `${t.first_name} ${t.last_name}`.trim(), store: t.store || "" };
    const { data, error } = await db.from(k.table).insert(row).select();
    if (error) { add.disabled = false; return alert(/row-level security/i.test(error.message)
      ? "Only the Safety Manager can add people to this list." : `Not added: ${error.message}`); }
    k.rows = [...k.rows, (data && data[0]) || { ...row, required_at: new Date().toISOString(), required_by_name: (profile && profile.full_name) || "" }];
    k.query = "";
    renderRequired(kind); renderSafetyNavCounts();
    return $(`reqSearch-${kind}`) && $(`reqSearch-${kind}`).focus();
  }
  const remove = event.target.closest("[data-req-remove]");
  if (remove) {
    const row = k.rows.find(r => r.person_key === remove.dataset.reqRemove);
    if (!row || !confirm(`Take ${reqName(row)} off the ${k.title.toLowerCase()} list? ${k.keeps}`)) return;
    remove.disabled = true;
    const { error } = await db.from(k.table).delete().eq("person_key", row.person_key);
    if (error) { remove.disabled = false; return alert(`Not removed: ${error.message}`); }
    k.rows = k.rows.filter(r => r.person_key !== row.person_key);
    renderRequired(kind); renderSafetyNavCounts();
  }
});
