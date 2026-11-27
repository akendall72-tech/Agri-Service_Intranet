// The forklift driving test (0054, 0172)
//
// The evaluator's responsibilities, then the form: who (picked from the people
// who can be tested, never typed), when, the truck classes they were tested
// on, and the test itself. Its questions are the Safety Manager's, kept on the
// Safety dashboard's Driving Test tab, each under a part of the test and for
// some classes of truck or all. Each is marked Met or Not met; a test is
// passed only with every one met, which the database works out (0172), and it
// keeps the questions as worded that day. Also the test's PDF, and a recorded
// test's result for the Training Manager approving it. The app records the
// same test: ForkliftEvaluationFormView.swift.

// The classes on a certification card, in OSHA's order.
const EVAL_CLASSES = ["Class I", "Class II", "Class III", "Class IV",
                      "Class V", "Class VI", "Class VII"];
// "Class V" on a card is V on a question.
const evalClassKey = (c) => String(c).replace(/^\s*class\s+/i, "").trim().toUpperCase();

// The test before 0172: four parts, still on the cards recorded then.
const EVAL_CHECKS = [
  ["inspection", "Inspection"],
  ["use_of_controls", "Use of controls"],
  ["maneuvering", "Manoeuvring skills"],
  ["driving_with_load", "Driving with a load"]
];

// The questions, loaded when the test or its Safety tab first opens.
let evalItems = null, evalItemsError = null, evalItemsLoading = null;
function loadEvalItems() {
  evalItemsLoading = evalItemsLoading || (async () => {
    const { data, error } = await db.from("forklift_evaluation_items").select("*").order("sort_order").order("label");
    evalItemsError = error ? error.message : null;
    evalItems = error ? [] : data || [];
    evalItemsLoading = null;
  })();
  return evalItemsLoading;
}

// The test being written: the classes picked, and each question's answer
// ("met" or "not_met") and note, by question id.
const evalState = { classes: new Set(), answers: {}, notes: {} };

// The questions a test of these classes asks, in order.
function evalAsked(classes = evalState.classes) {
  const keys = [...classes].map(evalClassKey);
  return (evalItems || []).filter(i => i.is_active
    && (!(i.classes || []).length || i.classes.some(k => keys.includes(k))));
}

// Questions by part of the test, each part where its first question comes.
function evalSections(items) {
  const parts = new Map();
  items.forEach(i => {
    const part = i.section || "The driving test";
    if (!parts.has(part)) parts.set(part, []);
    parts.get(part).push(i);
  });
  return [...parts];
}

// A recorded test's questions and answers: its own since 0172, the four
// parts before then. met is null where nothing was recorded.
function evalParts(cert) {
  if (Array.isArray(cert.test_items)) {
    const answers = cert.test_answers || {};
    return cert.test_items.map(i => {
      const a = answers[i.id] || {};
      return { section: i.section || "The driving test", label: i.label, detail: i.detail || "",
               met: a.status ? a.status === "met" : null, note: a.note || "" };
    });
  }
  return EVAL_CHECKS.map(([key, label]) => ({ section: "The driving test", label, detail: "",
    met: cert[key] == null ? null : !!cert[key], note: "" }));
}

// The evaluator's responsibilities, accepted before the form opens. The same
// words as EvaluatorTerms in ForkliftEvaluationFormView.swift: change both
// together, and give new wording a new version, which each test records
// (migration 0071).
const EVALUATOR_TERMS = {
  version: "2026-09-30",
  // Read when shown, so they carry the company's name as it is now (0133).
  get intro() {
    return `This evaluation becomes part of ${companyLegal()}'s operator certification record under the `
    + "Occupational Safety and Health Administration standard for powered industrial trucks. Before "
    + "recording it, you must read and accept the following responsibilities.";
  },
  get clauses() { return [
    ["Qualified evaluator",
     "Operator evaluations must be conducted by a person who has the knowledge, training, and experience "
     + "to train powered industrial truck operators and to evaluate their competence. By proceeding, you "
     + "confirm that you meet this requirement for each type of truck you evaluate.",
     "29 CFR 1910.178(l)(2)(iii)"],
    ["Observed in the workplace",
     "The evaluation must be based on your direct observation of the operator's performance in the "
     + "workplace, on the type of truck for which authorization is sought. Record only what you personally "
     + "observe during this evaluation, never results from memory, from another person's account, or from "
     + "a previous evaluation.",
     "29 CFR 1910.178(l)(2)(ii)"],
    ["Truck in safe operating condition",
     "The truck must be examined before it is placed in service. A truck found in need of repair, "
     + "defective, or in any way unsafe must be taken out of service until it has been restored to safe "
     + "operating condition. No evaluation may be conducted on such a truck.",
     "29 CFR 1910.178(q)(7) and (p)(1)"],
    ["Safe conduct of the evaluation",
     "The operator may drive only under your direct supervision, and only where doing so does not "
     + "endanger the operator or other employees. Keep pedestrians clear of the evaluation area, ensure "
     + "the operator restraint is used where one is fitted, and stop the evaluation immediately if the "
     + "operator's performance creates a hazard.",
     "29 CFR 1910.178(l)(2)(i)"],
    ["Accurate results",
     "Mark a part of the evaluation as met only if the operator demonstrated it competently. Authorize "
     + "only the truck types on which the operator was actually evaluated. No operator may be certified "
     + "unless every part of the evaluation is met.",
     "29 CFR 1910.178(l)(1)(i)"],
    ["Certification record",
     "Your name and the date will be recorded as the evaluator on this certification, and the result "
     + "takes effect only when approved by the Training Manager. An evaluation is valid for no more than "
     + "three years. Re-evaluation is required sooner if the operator is observed operating unsafely, is "
     + "involved in an accident or near-miss, is assigned a different type of truck, or workplace "
     + "conditions change.",
     "29 CFR 1910.178(l)(6), (l)(4)(ii) and (l)(4)(iii)"],
    ["Integrity of the record",
     "Recording an evaluation that is false or incomplete endangers the operator and co-workers, and "
     + `exposes the company to liability. It is a violation of ${companyName()} safety policy and may result `
     + "in disciplinary action.",
     `${companyName()} safety policy`]
  ]; },
  get acknowledgment() {
    return "I have read and understand these responsibilities. I am qualified to conduct this "
    + "evaluation, and I will record only results I personally observe, in accordance with OSHA "
    + `29 CFR 1910.178(l) and ${companyName()} safety policy.`;
  }
};

// The version accepted for the test being recorded, or null. Each visit to the
// page, and each test recorded, asks again, as the app does.
let evalAgreed = null;
// What the last test recorded said, shown above the statement for the next.
let evalNotice = "";

function evalTermsCard() {
  return `${evalNotice ? `<div class="card terms-notice"><p class="ok" style="margin:0">${esc(evalNotice)}</p></div>` : ""}
    <article class="card terms-card">
      <div class="terms-eyebrow">Powered Industrial Truck Operator Evaluation</div>
      <h2 class="terms-title">Evaluator Responsibilities</h2>
      <div class="terms-cite">${icon("safety", 14)} OSHA 29 CFR 1910.178(l) · Operator training</div>
      <p class="terms-intro">${esc(EVALUATOR_TERMS.intro)}</p>
      <ol class="terms-list">${EVALUATOR_TERMS.clauses.map(([title, text, cite]) => `
        <li><b>${esc(title)}</b><p>${esc(text)}</p><small>${esc(cite)}</small></li>`).join("")}</ol>
      <label class="terms-accept" for="evalAccept">
        <input type="checkbox" id="evalAccept">
        <span>${esc(EVALUATOR_TERMS.acknowledgment)}</span>
      </label>
      <button type="button" class="terms-agree" data-eval-agree disabled>Agree and Begin the Evaluation</button>
    </article>`;
}

// Three years, the most OSHA allows between evaluations.
function evalExpiry(on) {
  const d = new Date(on + "T00:00:00");
  if (isNaN(d)) return "";
  d.setFullYear(d.getFullYear() + 3);
  return d.toISOString().slice(0, 10);
}

// "12 days left", for the picker.
function fkLeft(lastDay) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const days = Math.round((fkDay(lastDay) - today) / 86400000);
  return days <= 0 ? "last day" : days === 1 ? "1 day left" : `${days} days left`;
}

// ---- the form ---------------------------------------------------------------------------------

// Anyone signed in can carry one out, as in the app (0059). The form keeps its
// ids, so renderEvalForm() and saveEvaluation() work it wherever it's drawn.
function evalTestView() {
  const intro = hero("Forklift Driving Test",
              "Evaluate someone on a truck and record the result. Anyone can carry it out; it's usually the location admin.");
  if (!evalAgreed) return intro + evalTermsCard();
  if (evalItems === null) loadEvalItems().then(() => { if (viewShown === "evaltest") renderEvalForm(); });
  setTimeout(renderEvalForm);
  return intro
    + `<div class="card dt" id="evalCard">
        <section class="dt-step">
          <h2 class="dt-h"><span class="dt-n">1</span>Who's being tested</h2>
          <label for="evalName">Operator</label>
          <select id="evalName"></select>
          <div id="evalWho"></div>
          <p class="note dt-under" id="evalEligibleNote"></p>
        </section>
        <section class="dt-step">
          <h2 class="dt-h"><span class="dt-n">2</span>When</h2>
          <div class="dt-when">
            <div><label for="evalDate">Evaluated on</label><input type="date" id="evalDate"></div>
            <dl class="dt-facts"><div><dt>Card expires</dt><dd id="evalExpires">—</dd></div></dl>
          </div>
          <p class="note dt-under">Three years from the test, the most OSHA allows between evaluations.</p>
        </section>
        <section class="dt-step">
          <h2 class="dt-h"><span class="dt-n">3</span>Truck classes</h2>
          <p class="note">Only the classes they were actually tested on. The test asks what applies to them.</p>
          <div class="dt-classes" id="evalClasses"></div>
        </section>
        <section class="dt-step">
          <h2 class="dt-h"><span class="dt-n">4</span>The driving test<span class="dt-count" id="evalCount"></span></h2>
          <div class="dt-progress" id="evalProgress"><i></i></div>
          <div id="evalTest"></div>
          <label for="evalNotes" class="dt-notes-label">Anything else? (optional)</label>
          <textarea id="evalNotes" rows="2" maxlength="1000" placeholder="How it went, or what they should practice"></textarea>
        </section>
        <div class="dt-verdict" id="evalVerdict" aria-live="polite"></div>
        <div class="dt-foot">
          <p class="ci-sign" id="evalSign"></p>
          <div class="row"><button type="button" data-act="eval-save" id="evalSave">Record the result</button><span class="msg"></span></div>
        </div>
      </div>`;
}

function renderEvalForm() {
  const classes = $("evalClasses");
  if (!classes) return;

  // Who: picked, never typed. Their email and course date come with them.
  const picker = $("evalName");
  const keep = picker.value;
  picker.innerHTML = `<option value="">Choose someone</option>` + evalPeople
    .map(r => `<option value="${esc(r.person_key)}">${esc(r.name)}${r.last_day ? ` · ${esc(fkLeft(r.last_day))}` : ""}</option>`)
    .join("");
  if (keep && evalPeople.some(r => r.person_key === keep)) picker.value = keep;
  const chosen = evalPeople.find(r => r.person_key === picker.value);
  const soon = chosen && chosen.last_day && /last day|^[1-3] day/.test(fkLeft(chosen.last_day));
  $("evalWho").innerHTML = chosen ? `<dl class="dt-facts">
      <div><dt>Work email</dt><dd>${esc(chosen.email || "None on file")}</dd></div>
      <div><dt>Passed the forklift course</dt><dd>${chosen.course_completed ? esc(usDate(chosen.course_completed)) : "Not on file yet"}</dd></div>
      ${chosen.last_day ? `<div class="${soon ? "soon" : ""}"><dt>Test due by</dt><dd>${esc(fkDay(chosen.last_day)
        .toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }))} · ${esc(fkLeft(chosen.last_day))}</dd></div>` : ""}
    </dl>` : "";
  $("evalEligibleNote").textContent = evalPeople.length
    ? `Everyone who passed the forklift course in the last 30 days and hasn't had their test, soonest deadline first (${evalPeople.length}). You can't test yourself.`
    : "Nobody can be given a driving test right now. People are listed here for 30 days once they pass the forklift course.";

  // When: not in the future. Local, not toISOString(), which is UTC and after
  // about 6 pm Mountain is already tomorrow.
  const date = $("evalDate");
  date.max = todayISO();
  if (!date.value) date.value = todayISO();
  $("evalExpires").textContent = date.value ? usDate(evalExpiry(date.value)) : "—";

  classes.innerHTML = EVAL_CLASSES.map(c => {
    const on = evalState.classes.has(c), info = FI_CLASSES[evalClassKey(c)];
    return `<button type="button" class="dt-class${on ? " on" : ""}" data-eval-class="${esc(c)}" aria-pressed="${on}">
      <span class="dt-class-tick">${on ? icon("check", 13) : ""}</span><b>${esc(c)}</b>${info ? `<small>${esc(info[1])}</small>` : ""}</button>`;
  }).join("");

  $("evalTest").innerHTML = evalTestHtml();
  evalTally();
}

// The questions for the classes picked, part by part, each answered as it was.
function evalTestHtml() {
  if (evalItemsError) {
    return `<p class="error">${/does not exist|schema cache/i.test(evalItemsError)
      ? "Run migration 0172_forklift_driving_test.sql in the SQL editor, then reload this page." : esc(evalItemsError)}</p>`;
  }
  if (evalItems === null) return `<p class="note">Loading the questions…</p>`;
  if (!evalState.classes.size) return `<p class="dt-wait">${icon("forklift", 18)}Pick the truck classes above, and the questions for them appear here.</p>`;
  const asked = evalAsked();
  if (!asked.length) {
    return `<p class="note">The Safety Manager hasn't set any questions for ${esc(EVAL_CLASSES.filter(c => evalState.classes.has(c)).join(", "))}
      yet. They're added on the Safety dashboard, under Driving Test.</p>`;
  }
  let n = 0;
  return evalSections(asked).map(([part, items]) => `<div class="dt-part">
      <h3 class="dt-part-h">${esc(part)}<small data-dt-part="${esc(part)}"></small></h3>
      ${items.map(i => {
        n++;
        const a = evalState.answers[i.id] || "";
        return `<div class="dt-q${a ? ` ${a}` : ""}" data-dt-q="${esc(i.id)}">
          <span class="dt-q-n">${n}</span>
          <span class="dt-q-text"><b>${esc(i.label)}</b>${i.detail ? `<small>${esc(i.detail)}</small>` : ""}</span>
          <span class="dt-q-pick" role="radiogroup" aria-label="${esc(i.label)}">
            <label class="met"><input type="radio" name="dtq-${esc(i.id)}" value="met"${a === "met" ? " checked" : ""}> Met</label>
            <label class="not"><input type="radio" name="dtq-${esc(i.id)}" value="not_met"${a === "not_met" ? " checked" : ""}> Not met</label>
          </span>
          <input class="dt-q-note" data-dt-note="${esc(i.id)}" maxlength="300" value="${esc(evalState.notes[i.id] || "")}"
            placeholder="What they need to work on" aria-label="What they need to work on: ${esc(i.label)}">
        </div>`;
      }).join("")}
    </div>`).join("");
}

// How far along the test is, each part's count, what it comes to, and the button.
function evalTally() {
  const asked = evalState.classes.size ? evalAsked() : [];
  const marked = asked.filter(i => evalState.answers[i.id]).length;
  const missed = asked.filter(i => evalState.answers[i.id] === "not_met").length;
  const done = asked.length > 0 && marked === asked.length;
  $("evalCount").textContent = asked.length ? `${marked} of ${asked.length} marked` : "";
  const bar = $("evalProgress");
  bar.hidden = !asked.length;
  bar.classList.toggle("bad", missed > 0);
  bar.firstElementChild.style.width = asked.length ? `${Math.round(marked / asked.length * 100)}%` : "0";
  evalSections(asked).forEach(([part, items]) => {
    const count = document.querySelector(`[data-dt-part="${CSS.escape(part)}"]`);
    if (count) count.textContent = `${items.filter(i => evalState.answers[i.id]).length} of ${items.length}`;
  });

  const verdict = $("evalVerdict");
  const passed = done && !missed;
  verdict.className = `dt-verdict${!done ? "" : passed ? " pass" : " fail"}`;
  verdict.hidden = !asked.length;
  verdict.innerHTML = !asked.length ? ""
    : !done ? `${icon("clock", 20)}<span><b>${asked.length - marked} to go</b>Mark every question Met or Not met. A test is passed only with every one met.</span>`
    : passed ? `${icon("checkCircle", 20)}<span><b>Passed</b>Every part met. This issues a certification card, valid until
        ${esc(usDate(evalExpiry($("evalDate").value)))}, once the Training Manager approves the test.</span>`
    : `${icon("warning", 20)}<span><b>Not passed</b>${missed} not met, so no card is issued. They can be tested again within their 30 days.</span>`;

  const save = $("evalSave");
  save.textContent = passed ? "Record the certification" : "Record the result";
  const who = (profile && profile.full_name) || (me && me.email) || "you";
  const on = $("evalDate").value;
  $("evalSign").innerHTML = `Recorded against your name, <b>${esc(who)}</b>${on ? `, on ${esc(usDate(on))}` : ""},
    with your acceptance of the evaluator responsibilities under OSHA 29 CFR 1910.178(l).`;
}

async function saveEvaluation(button) {
  const card = $("evalCard");
  const chosen = evalPeople.find(r => r.person_key === $("evalName").value);
  const on = $("evalDate").value;
  if (!chosen) return speak(card, "Choose who was evaluated.", true);
  if (!on) return speak(card, "When was the evaluation?", true);
  if (on > todayISO()) return speak(card, "The evaluation can't be in the future.", true);
  if (!evalState.classes.size) return speak(card, "Pick at least one truck class.", true);
  const asked = evalAsked();
  if (!asked.length) return speak(card, "The test has no questions for those classes yet. The Safety Manager adds them on the Safety dashboard.", true);
  const missing = asked.filter(i => !evalState.answers[i.id]);
  if (missing.length) return speak(card, `Mark every question Met or Not met: ${missing.map(i => i.label).join(", ")}.`, true);

  const test_answers = Object.fromEntries(asked.map(i => {
    const status = evalState.answers[i.id];
    return [i.id, { status, note: status === "not_met" ? (evalState.notes[i.id] || "").trim() : "" }];
  }));
  const row = {
    operator_name: chosen.name,
    email: (chosen.email || "").toLowerCase() || null,
    evaluation_date: on,
    expiration_date: evalExpiry(on),
    truck_classes: EVAL_CLASSES.filter(c => evalState.classes.has(c)),
    // The database works this out again, from the answers.
    passed_driving: asked.every(i => evalState.answers[i.id] === "met"),
    test_answers,
    test_notes: $("evalNotes").value.trim(),
    evaluator_attestation: evalAgreed
  };

  button.disabled = true;
  const { data: saved, error } = await db.from("forklift_certifications").insert(row).select("id, passed_driving");
  button.disabled = false;
  if (error) {
    // The two rules that refuse it, named, rather than the database's wording.
    return speak(card, /row-level security|violates/i.test(error.message)
      ? "That wasn't allowed. They have to have passed the forklift course in the last 30 days and not been tested since, and you can't record your own."
      : error.message, true);
  }
  const passed = saved && saved[0] ? saved[0].passed_driving : row.passed_driving;

  evalState.classes.clear();
  evalState.answers = {};
  evalState.notes = {};
  const [fresh, eligible] = await Promise.all([
    allRows(() => db.from("forklift_certifications").select("*").order("id")),
    db.rpc("forklift_eligible_people")
  ]);
  if (fresh.data) certs = fresh.data;
  if (eligible.data) {
    const mine = ((me && me.email) || "").toLowerCase();
    evalPeople = eligible.data.filter(r => (r.email || "").toLowerCase() !== mine);
  }
  renderCerts();
  // The Training Manager is told there's a test to approve.
  if (saved && saved[0]) notify("forklift_evaluation", saved[0].id);
  // Back to the statement: the next test is accepted afresh.
  evalNotice = passed
    ? `Sent for approval. ${chosen.name}'s card will run until ${usDate(row.expiration_date)} once the Training Manager approves it.`
    : `Recorded. ${chosen.name} hasn't passed, so no card is issued. It goes on record once the Training Manager approves it.`;
  evalAgreed = null;
  showView("evaltest");
}

document.addEventListener("click", (event) => {
  const truckClass = event.target.closest("[data-eval-class]");
  if (truckClass) {
    const name = truckClass.dataset.evalClass;
    if (evalState.classes.has(name)) evalState.classes.delete(name);
    else evalState.classes.add(name);
    return renderEvalForm();
  }
  const save = event.target.closest('button[data-act="eval-save"]');
  if (save) return saveEvaluation(save);
  if (event.target.closest("[data-eval-agree]")) {
    if (!$("evalAccept") || !$("evalAccept").checked) return;
    evalAgreed = EVALUATOR_TERMS.version;
    evalNotice = "";
    showView("evaltest");
    return;
  }
  const pdf = event.target.closest("[data-eval-pdf]");
  if (pdf) {
    const cert = certs.find(c => String(c.id) === pdf.dataset.evalPdf);
    if (cert) downloadEvaluationPDF(cert);
  }
});

document.addEventListener("change", (event) => {
  const target = event.target;
  if (!target) return;
  if (target.id === "evalDate" || target.id === "evalName") return renderEvalForm();
  if (target.name && target.name.startsWith("dtq-") && target.closest("#evalCard")) {
    const id = target.name.slice(4);
    evalState.answers[id] = target.value;
    const q = target.closest(".dt-q");
    q.classList.remove("met", "not_met");
    q.classList.add(target.value);
    if (target.value === "not_met") q.querySelector(".dt-q-note").focus();
    evalTally();
  }
});

document.addEventListener("input", (event) => {
  const note = event.target.closest && event.target.closest("[data-dt-note]");
  if (note) evalState.notes[note.dataset.dtNote] = note.value;
});

// ---- a recorded test, for the Training Manager approving it ------------------------------------

// How many were met, the ones that weren't with what to work on, and every
// question behind a fold. A test from before 0172 shows its four parts.
function evalResultHtml(cert) {
  const parts = evalParts(cert);
  const mark = (p) => `<li class="${p.met === true ? "met" : "not"}">${icon(p.met === true ? "check" : "close", 14)}<span>${esc(p.label)}${
    p.note ? `<small>${esc(p.note)}</small>` : ""}</span></li>`;
  if (!Array.isArray(cert.test_items)) return `<ul class="dt-marks">${parts.map(mark).join("")}</ul>`;
  const missed = parts.filter(p => p.met !== true);
  return `<div class="dt-result">
      <div class="dt-result-line ${missed.length ? "bad" : "ok"}">${icon(missed.length ? "warning" : "checkCircle", 15)}
        ${parts.length - missed.length} of ${parts.length} met${missed.length ? `, ${missed.length} not` : ""}</div>
      ${missed.length ? `<ul class="dt-marks">${missed.map(mark).join("")}</ul>` : ""}
      ${cert.test_notes ? `<p class="dt-said">${esc(cert.test_notes)}</p>` : ""}
      <details class="dt-all"><summary>Every question (${parts.length})</summary>
        ${evalSections(parts).map(([part, list]) => `<h4>${esc(part)}</h4><ul class="dt-marks">${list.map(mark).join("")}</ul>`).join("")}
      </details>
    </div>`;
}

// ---- the PDF ---------------------------------------------------------------------------------

// Mirrors ForkliftEvaluationPDF.swift, so a result printed from a desk and one
// printed from a phone are the same document. As long as the test needs:
// a page breaks before a question that won't fit.
function downloadEvaluationPDF(cert) {
  const doc = new jspdf.jsPDF({ unit: "pt", format: "letter" });
  const MARGIN = 54, WIDTH = 612 - MARGIN * 2, BOTTOM = 792 - MARGIN - 10;
  let y = MARGIN;

  // jsPDF's built-in fonts are Latin-1 only: curly quotes and dashes typed
  // into a question would come out as noise.
  const latin = (s) => String(s).replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, "-").replace(/…/g, "...");
  const text = (str, x, top, { size = 11, style = "normal", grey, width } = {}) => {
    doc.setFont("helvetica", style);
    doc.setFontSize(size);
    doc.setTextColor(grey == null ? 0 : grey);
    const lines = width ? doc.splitTextToSize(latin(str), width) : [latin(str)];
    doc.text(lines, x, top + size * 0.85);
    return lines.length * size * 1.25;
  };
  const height = (str, size, width) => {
    doc.setFontSize(size);
    return doc.splitTextToSize(latin(str), width).length * size * 1.25;
  };
  const or = (v) => String(v ?? "").trim() || "-";
  const footer = () => text(`${companyLegal()} - printed ${usDate(todayISO())}`, MARGIN, 792 - MARGIN + 6, { size: 9, grey: 128 });
  const room = (needed) => {
    if (y + needed <= BOTTOM) return;
    footer();
    doc.addPage();
    y = MARGIN;
  };

  doc.setFillColor(204, 0, 51);
  doc.rect(MARGIN, y, WIDTH, 26, "F");
  text("FORKLIFT DRIVING TEST", MARGIN + 8, y + 5, { size: 15, style: "bold", grey: 255 });
  y += 30;
  text(`Powered industrial truck operator evaluation - ${companyLegal()}`, MARGIN, y, { size: 9, grey: 90 });
  y += 24;

  const [statusLabel, statusClass] = certStatus(cert);
  const passed = statusClass === "b-current" || statusClass === "b-expiring";
  if (passed) doc.setFillColor(232, 243, 235); else doc.setFillColor(251, 233, 237);
  doc.rect(MARGIN, y, WIDTH, 44, "F");
  if (passed) doc.setFillColor(19, 112, 38); else doc.setFillColor(204, 0, 51);
  doc.rect(MARGIN, y, 4, 44, "F");
  text(statusLabel.toUpperCase(), MARGIN + 14, y + 8, { size: 13, style: "bold", grey: passed ? 40 : 60 });
  text(passed
       ? `Certified to operate the truck types listed below until ${usDate(cert.expiration_date)}.`
       : "Not certified to operate a powered industrial truck.",
       MARGIN + 14, y + 26, { size: 9, grey: 90 });
  y += 60;

  const section = (label) => {
    room(60);
    y += 6;
    text(label.toUpperCase(), MARGIN, y, { size: 11, style: "bold" });
    y += 16;
    doc.setFillColor(200, 200, 200);
    doc.rect(MARGIN, y, WIDTH, 0.5, "F");
    y += 8;
  };
  const pair = (l1, v1, l2, v2) => {
    const half = (WIDTH - 16) / 2;
    room(30);
    text(l1.toUpperCase(), MARGIN, y, { size: 8, style: "bold", grey: 128 });
    text(l2.toUpperCase(), MARGIN + half + 16, y, { size: 8, style: "bold", grey: 128 });
    y += 11;
    text(or(v1), MARGIN, y, { width: half });
    text(or(v2), MARGIN + half + 16, y, { width: half });
    y += 19;
  };

  section("Operator");
  pair("Name", cert.operator_name, "Work email", cert.email);
  pair("Evaluated", usDate(cert.evaluation_date), "Expires", usDate(cert.expiration_date));
  text("TRUCK TYPES AUTHORISED", MARGIN, y, { size: 8, style: "bold", grey: 128 });
  y += 11;
  y += text((cert.truck_classes || []).join(", ") || "None recorded", MARGIN, y, { width: WIDTH });
  y += 8;
  // The classroom half of the certification.
  pair("Certification course passed",
       cert.course_completed_on ? usDate(cert.course_completed_on) : "Not on the training record",
       "Course", forkliftCourse());

  section("The evaluation");
  const parts = evalParts(cert);
  const sections = evalSections(parts);
  const LABEL_W = WIDTH - 22 - 70;
  sections.forEach(([part, list]) => {
    if (sections.length > 1) {
      room(34);
      y += 4;
      text(part.toUpperCase(), MARGIN, y, { size: 8.5, style: "bold", grey: 90 });
      y += 13;
    }
    list.forEach(p => {
      const labelH = height(p.label, 10.5, LABEL_W);
      const noteH = p.note ? height(p.note, 9, LABEL_W) + 2 : 0;
      room(labelH + noteH + 4);
      // "[x]" rather than a tick, for the same Latin-1 reason.
      text(p.met ? "[x]" : "[ ]", MARGIN, y, { size: 10.5, style: "bold" });
      text(p.label, MARGIN + 22, y, { size: 10.5, grey: p.met ? 0 : 60, width: LABEL_W });
      text(p.met === true ? "Met" : p.met === false ? "Not met" : "Not recorded", 612 - MARGIN - 64, y,
           { size: 10.5, style: p.met === false ? "bold" : "normal", grey: p.met ? 0 : 60 });
      y += labelH;
      if (p.note) y += text(p.note, MARGIN + 22, y, { size: 9, grey: 90, width: LABEL_W }) + 2;
      y += 4;
    });
  });
  if (cert.test_notes) {
    room(40);
    y += 6;
    text("EVALUATOR'S NOTES", MARGIN, y, { size: 8, style: "bold", grey: 128 });
    y += 11;
    y += text(cert.test_notes, MARGIN, y, { size: 10, width: WIDTH });
  }

  section("Signed off by");
  pair("Evaluated by", cert.evaluator_name || "Not recorded", "On", usDate(cert.evaluation_date));
  // The evaluator's acceptance of their responsibilities (migration 0071).
  if (cert.evaluator_attested_at) {
    const said = `The evaluator accepted the evaluator responsibilities under OSHA 29 CFR 1910.178(l) `
      + `(statement of ${cert.evaluator_attestation || "-"}) when recording this test, on `
      + `${new Date(cert.evaluator_attested_at).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })}.`;
    room(height(said, 9, WIDTH) + 4);
    y += text(said, MARGIN, y, { size: 9, grey: 90, width: WIDTH }) + 4;
  }

  const valid = "An evaluation is valid for three years, which is the maximum OSHA 1910.178(l)(4)(iii) allows between "
    + "evaluations. Keep this with the operator's training record.";
  room(height(valid, 9, WIDTH) + 16);
  y += 16;
  text(valid, MARGIN, y, { size: 9, grey: 90, width: WIDTH });
  footer();

  doc.save(`Forklift Driving Test - ${cert.operator_name}.pdf`);
}

// ---- the Safety dashboard: the driving test's questions ---------------------------------------
//
// The Safety Manager keeps them here, as the daily forklift inspection's items:
// each under a part of the test, with what to look for, for some classes of
// truck or all of them (none ticked). Rewording or deleting one never changes
// a test already recorded: each keeps its questions as worded that day.

function renderDrivingTestAdmin() {
  const box = $("drivingTestAdmin");
  if (!box) return;
  if (evalItems === null) {
    box.innerHTML = `<div class="card"><p class="note">Loading the driving test…</p></div>`;
    loadEvalItems().then(renderDrivingTestAdmin);
    return;
  }
  if (evalItemsError) {
    box.innerHTML = `<div class="card"><p class="error">${/does not exist|schema cache/i.test(evalItemsError)
      ? "Run migration 0172_forklift_driving_test.sql in the SQL editor, then reload this page." : esc(evalItemsError)}</p></div>`;
    return;
  }
  const classes = (i) => Object.entries(FI_CLASSES).map(([k, [c, t]]) => `<label class="fva-kind" title="${esc(t)}"><input type="checkbox" data-dta-class="${k}"${
    (i.classes || []).includes(k) ? " checked" : ""}> ${esc(c)}</label>`).join("");
  const count = (k) => evalAsked([k]).length;
  const parts = [...new Set(evalItems.map(i => i.section))];
  box.innerHTML = `<div class="card">
    <h2>Forklift driving test</h2>
    <p class="note">The questions the driving test asks, in the Forklift Center on the app and this page. Whoever gives the test marks
      each one <b>Met</b> or <b>Not met</b>, with what to work on; a test is passed only with every one met. Each question sits under a
      part of the test, shown in the order the parts first come. Tick the classes a question is for, or none for every class: a test
      asks the questions for the classes it's for. Changes reach the app and this page straight away.</p>
    <p class="note">Right now each class is asked: ${Object.entries(FI_CLASSES).map(([k, [c, t]]) =>
      `<span title="${esc(t)}">${esc(c)} <b>${count(k)}</b></span>`).join(" · ")}. OSHA asks for an evaluation of the operator's
      performance in the workplace, on the type of truck they'll drive (1910.178(l)(2)(ii)).</p>
    <p class="note"><b>Showing: No</b> takes a question off the test and can be switched back. Rewording or deleting one never
      changes a test already recorded.</p>
    <datalist id="dtaParts">${parts.map(p => `<option value="${esc(p)}"></option>`).join("")}</datalist>
    ${evalItems.length ? evalItems.map((i, n) => `${n === 0 || evalItems[n - 1].section !== i.section
        ? `<h3 class="dta-part">${esc(i.section)}</h3>` : ""}<div class="role${i.is_active ? "" : " off"}" style="padding:16px${i.is_active ? "" : ";opacity:.6"}" data-dta-item="${esc(i.id)}">
      <div class="fields">
        <div><label>Part of the test</label><input type="text" data-dta="section" maxlength="40" list="dtaParts" value="${esc(i.section)}"></div>
        <div><label>Question</label><input type="text" data-dta="label" maxlength="80" value="${esc(i.label)}"></div>
        <div class="wide"><label>What to look for (optional, shown under it)</label><input type="text" data-dta="detail" maxlength="240" value="${esc(i.detail || "")}"></div>
        <div class="wide"><label>For</label><div class="fva-kinds">${classes(i)}</div></div>
        <div><label>Showing</label><select data-dta="is_active">
          <option value="yes"${i.is_active ? " selected" : ""}>Yes</option><option value="no"${i.is_active ? "" : " selected"}>No</option></select></div>
      </div>
      <div class="row">
        <button data-dta-act="save">Save</button>
        <button class="ghost" data-dta-act="up"${n === 0 ? " disabled" : ""} aria-label="Move up">&uarr;</button>
        <button class="ghost" data-dta-act="down"${n === evalItems.length - 1 ? " disabled" : ""} aria-label="Move down">&darr;</button>
        <button class="ghost" data-dta-act="delete">Delete</button>
        <span class="msg"></span>
      </div>
    </div>`).join("") : `<p class="note">No questions yet: the driving test can't be recorded until there are some.</p>`}
    <div class="row" style="margin-top:10px"><button data-dta-act="add">Add a question</button><span class="msg" id="dtaMsg"></span></div>
  </div>`;
}

async function dtaReload() {
  const { data, error } = await db.from("forklift_evaluation_items").select("*").order("sort_order").order("label");
  if (!error) evalItems = data || [];
  renderDrivingTestAdmin();
}

$("admin").addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-dta-act]");
  if (!button) return;
  const act = button.dataset.dtaAct;
  const refused = "Only the Safety Manager can change the driving test.";
  if (act === "add") {
    const last = evalItems[evalItems.length - 1];
    const { error } = await db.from("forklift_evaluation_items").insert({ label: "New question", is_active: false,
      section: last ? last.section : "The driving test",
      sort_order: (Math.max(0, ...evalItems.map(i => i.sort_order || 0)) + 10) });
    if (error) return speak(button.closest(".row"), error.message.includes("row-level") ? refused : error.message, true);
    await dtaReload();
    return speak($("dtaMsg").closest(".row"), "Added at the end, not showing yet. Word it, set Showing to Yes, and save.", false);
  }
  const box = button.closest("[data-dta-item]"), id = box.dataset.dtaItem, item = evalItems.find(i => i.id === id);
  if (act === "delete") {
    if (!confirm(`Delete "${item.label}" from the driving test? Tests already recorded keep it. "Showing: No" can be undone; this can't.`)) return;
    const { data, error } = await db.from("forklift_evaluation_items").delete().eq("id", id).select("id");
    if (error || !(data || []).length) return speak(box, error ? error.message : `Not deleted. ${refused}`, true);
    return dtaReload();
  }
  if (act === "up" || act === "down") {
    const at = evalItems.findIndex(i => i.id === id), other = evalItems[act === "up" ? at - 1 : at + 1];
    if (!other) return;
    // Spaced out first, so two questions never share a place.
    const order = evalItems.map((i, n) => ({ id: i.id, sort_order: (n + 1) * 10 }));
    const a = order[at], b = order[act === "up" ? at - 1 : at + 1];
    [a.sort_order, b.sort_order] = [b.sort_order, a.sort_order];
    for (const row of order) {
      if (evalItems.find(i => i.id === row.id).sort_order === row.sort_order) continue;
      const { error } = await db.from("forklift_evaluation_items").update({ sort_order: row.sort_order }).eq("id", row.id);
      if (error) return speak(box, error.message, true);
    }
    return dtaReload();
  }
  const label = box.querySelector('[data-dta="label"]').value.trim();
  if (!label) return speak(box, "A question needs some words.", true);
  speak(box, "Saving…", false);
  const { data, error } = await db.from("forklift_evaluation_items").update({
    section: box.querySelector('[data-dta="section"]').value.trim() || "The driving test",
    label, detail: box.querySelector('[data-dta="detail"]').value.trim(),
    classes: [...box.querySelectorAll("[data-dta-class]:checked")].map(c => c.dataset.dtaClass),
    is_active: box.querySelector('[data-dta="is_active"]').value === "yes"
  }).eq("id", id).select("id");
  if (error) return speak(box, error.message, true);
  if (!(data || []).length) return speak(box, `Not saved. ${refused}`, true);
  await dtaReload();
  speak(document.querySelector(`[data-dta-item="${CSS.escape(id)}"]`), "Saved.", false);
});
