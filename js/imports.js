// Uploads and downloads
//
// The importer several admin tabs share (CSV and spreadsheets), the blank
// templates and the downloads, and the drop zones for the certification,
// payroll, directory and special tools uploads.

// ---------------------------------------------------------------- CSV import

// A small RFC-4180 parser: fields may be quoted, quotes are doubled to escape,
// and quoted fields may contain commas and newlines. The Truck Type column is
// a quoted JSON array, so none of that is optional.
function parseCSV(text) {
  const rows = [];
  let row = [], field = "", quoted = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (ch !== "\r") field += ch;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.some(v => v.trim() !== ""));
}

// The export writes dates as M/D/YY, which Date() reads inconsistently across
// browsers, so it's converted explicitly.
function toISODate(value) {
  const v = String(value ?? "").trim();
  if (!v) return null;
  // Already the way the database wants it — how a spreadsheet often saves a date.
  const iso = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
  const m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (!m) return null;
  let [, mm, dd, yy] = m;
  yy = yy.length === 2 ? String(2000 + Number(yy)) : yy;
  return `${yy}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
}

function toBool(v) {
  const s = (v || "").trim().toLowerCase();
  if (["true", "yes", "y", "1"].includes(s)) return true;
  if (["false", "no", "n", "0"].includes(s)) return false;
  return null;
}

function toClasses(v) {
  const s = (v || "").trim();
  if (!s) return [];
  try {
    const parsed = JSON.parse(s);
    if (Array.isArray(parsed)) return parsed.map(String);
  } catch (_) { /* fall through to a plain list */ }
  return s.split(/[;,]/).map(x => x.trim()).filter(Boolean);
}

// ---------------------------------------------------------------- templates
//
// Every importer replaces a whole table, which means the file has to be
// the complete list — so the two things worth downloading are a blank sheet
// with the right columns, and what's in there now to edit and send back.
//
// Written as CSV because a spreadsheet opens it, saves it, and the importers
// read either. The byte order mark is what makes Excel treat it as UTF-8, so
// names with accents survive the round trip.

function csvText(rows) {
  return "﻿" + rows.map(row => row.map(cell => {
    const value = String(cell ?? "");
    return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
  }).join(",")).join("\r\n") + "\r\n";
}

function downloadCSV(filename, rows) {
  const blob = new Blob([csvText(rows)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// Dates go out the way the importers read them back: M/D/YYYY.
const usDate = (iso) => {
  const m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${Number(m[2])}/${Number(m[3])}/${m[1]}` : "";
};

const CERT_COLUMNS = ["Operator Name", "Email", "Evaluation Date", "Evaluator Name",
  "Expiration Date", "Truck Type Authorized",
  "Successful Completion of Driving Evaluation", "Inspection", "Use of Controls",
  "Maneuvering Skills", "Driving with Load", "Modified By"];

const DIRECTORY_COLUMNS = ["Topic", "Contact 1", "Phone #", "Contact 2", "Phone #"];

const PAYROLL_COLUMNS = ["Payroll #", "Pay Period Start", "Pay Period End",
  "Paid Holiday", "Payday"];

// The UKG exports. These aren't ours to design — an importer recognises a file
// by its column headings, so a blank sheet has to carry the exact ones it looks
// for. tsIdentify and osrRead are where those lists live; if you change a
// heading there, change it here.
const TS_EMPLOYEE_COLUMNS = ["Firstname", "Lastname", "Email", "Jobs", "Store", "Department", "Employee Number"];

const TS_HISTORY_COLUMNS = ["Firstname", "Lastname", "Employee Number", "Email", "Course", "Date Completed",
  "% Completed"];

const TS_CREDITS_COLUMNS = ["Firstname", "Lastname", "Employee Number", "Email", "Credit Type", "Credits Number",
  "Earned At", "Credits Rule Title", "Credits Period Cycle", "External Certificate Title"];

const OSR_COLUMNS = ["Event Title", "Event City", "Status", "Event Start Date", "Event End Date",
  "Registered", "Available Seats"];

const IN_CLASS_COLUMNS = ["Firstname", "Lastname", "Employee Number", "Email", "Store", "Event Title", "Event Id",
  "Event City", "Event Start Date", "Instructor Names"];

const TEMPLATES = {
  tools: () => toolTemplate(),
  certs: () => [
    CERT_COLUMNS,
    ["Jordan Miller", "jordanmiller@agri-service.com", "3/4/2026", "Andrew Kendall",
     "3/4/2029", "Class IV; Class V", "Yes", "Yes", "Yes", "Yes", "Yes", "Andrew Kendall"],
    ["Sam Ruiz", "samruiz@agri-service.com", "3/4/2026", "Andrew Kendall",
     "3/4/2029", "Class IV", "Yes", "Yes", "Yes", "Yes", "Yes", "Andrew Kendall"]
  ],
  directory: () => [
    DIRECTORY_COLUMNS,
    ["Warranty claims", "Andrew Kendall", "2085551234", "Parts desk", "2085555678"],
    ["IT help", "helpdesk@agri-service.com", "", "", ""]
  ],
  tsEmployees: () => [
    TS_EMPLOYEE_COLUMNS,
    ["Jordan", "Miller", "jordanmiller@agri-service.com", "4070 - Technician Master",
     "Store - 12 - Pasco", "Service", "004217"],
    ["Sam", "Ruiz", "samruiz@agri-service.com", "4060 - Technician", "Store - 14 - Nampa", "Service", "004388"]
  ],
  tsHistory: () => [
    TS_HISTORY_COLUMNS,
    ["Jordan", "Miller", "004217", "jordanmiller@agri-service.com", "Lifting and Rigging ILT",
     "3/4/2026", "100%"],
    ["Sam", "Ruiz", "004388", "samruiz@agri-service.com", "Forklift Certification", "4/18/2026", "100%"]
  ],
  tsCredits: () => [
    TS_CREDITS_COLUMNS,
    ["Jordan", "Miller", "004217", "jordanmiller@agri-service.com", "AGCO Training Hours", "8",
     "2/11/2026", "AGCO Training Hours - Number of Credits: 24", "2026", "Fendt 1000 Series"],
    ["Sam", "Ruiz", "004388", "samruiz@agri-service.com", "EPA 609", "1",
     "6/3/2026", "EPA 609 - Number of Credits: 1", "2026", "EPA 609 Certification"]
  ],
  openSeat: () => [
    ["Export date: " + usDate(new Date().toISOString().slice(0, 10))],
    [],
    OSR_COLUMNS,
    ["Fendt 1000 Series Service", "Jackson, MN", "Open", "10/14/2026", "10/16/2026", "6", "4"],
    ["Combine Header Service", "Hesston, KS", "Full", "11/3/2026", "11/5/2026", "12", "0"]
  ],
  inClass: () => [
    ["Export date: " + usDate(new Date().toISOString().slice(0, 10))],
    [],
    IN_CLASS_COLUMNS,
    ["Jordan", "Miller", "004217", "jordanmiller@agri-service.com", "Store - 12 - Pasco",
     "Fendt 1000 Series Service", "E10042", "Jackson, MN", "10/14/2026", "Chris Bauer"]
  ],
  payroll: () => [
    PAYROLL_COLUMNS,
    [1, "12/21/2025", "1/3/2026", "", "1/9/2026"],
    [2, "1/4/2026", "1/17/2026", "", "1/23/2026"],
    [3, "1/18/2026", "1/31/2026", "", "2/6/2026"],
    [],
    ["Paid Holidays"],
    ["New Year's Day 1/1/2026", "8 hrs"],
    ["Memorial Day 5/25/2026", "8 hrs"]
  ]
};

// What's in the database now, in the same columns as the blank sheet.
const EXPORTS = {
  tools: () => toolExport(),
  certs: () => [CERT_COLUMNS, ...certs.map(c => [
    c.operator_name, c.email || "", usDate(c.evaluation_date), c.evaluator_name || "",
    usDate(c.expiration_date), (c.truck_classes || []).join("; "),
    yesNo(c.passed_driving), yesNo(c.inspection), yesNo(c.use_of_controls),
    yesNo(c.maneuvering), yesNo(c.driving_with_load), c.modified_by || ""
  ])],
  directory: () => [DIRECTORY_COLUMNS, ...directory.map(d =>
    [d.topic, d.contact1 || "", d.phone1 || "", d.contact2 || "", d.phone2 || ""])],
  payroll: () => [
    PAYROLL_COLUMNS,
    ...payroll.map(p => [p.number, usDate(p.period_start), usDate(p.period_end),
                         p.holiday || "", usDate(p.payday)]),
    [],
    ["Paid Holidays"],
    ...holidays.map(h => [h.name, h.hours || ""])
  ]
};

const yesNo = (v) => v === true ? "Yes" : v === false ? "No" : "";

const TEMPLATE_NAMES = {
  tools: "Special Tools",
  certs: "Forklift Certifications",
  directory: "Who Does What",
  payroll: "Payroll Calendar",
  tsEmployees: "All Employees",
  tsCredits: "Credits All Time",
  tsHistory: "OLT and ILT",
  openSeat: "Open Seat Report",
  inClass: "In-Class Event Report"
};

document.addEventListener("click", (event) => {
  const button = event.target.closest("[data-template], [data-export]");
  if (!button) return;
  const blank = button.dataset.template;
  const kind = blank || button.dataset.export;
  const rows = (blank ? TEMPLATES : EXPORTS)[kind]();
  if (!blank && rows.length < 2) {
    return alert("There's nothing imported yet to download.");
  }
  downloadCSV(`Agri-Service ${TEMPLATE_NAMES[kind]}${blank ? " template" : ""}.csv`, rows);
});

const drop = $("drop");
["dragenter", "dragover"].forEach(e =>
  drop.addEventListener(e, ev => { ev.preventDefault(); drop.classList.add("over"); }));
["dragleave", "drop"].forEach(e =>
  drop.addEventListener(e, ev => { ev.preventDefault(); drop.classList.remove("over"); }));
drop.addEventListener("drop", ev => {
  const file = ev.dataTransfer.files[0];
  if (file) importCertifications(file);
});
$("file").addEventListener("change", ev => {
  const file = ev.target.files[0];
  if (file) importCertifications(file);
});

// Drop zones, same behaviour as the certification import above.
[["payrollDrop", "payrollFile", importPayroll],
 ["directoryDrop", "directoryFile", importDirectory],
 ["toolsDrop", "toolsFile", importTools]].forEach(([zone, input, run]) => {
  $(input).addEventListener("change", (e) => {
    if (e.target.files[0]) run(e.target.files[0]);
  });

  ["dragenter", "dragover"].forEach(type =>
    $(zone).addEventListener(type, (e) => {
      e.preventDefault(); $(zone).classList.add("over");
    }));

  ["dragleave", "drop"].forEach(type =>
    $(zone).addEventListener(type, () => $(zone).classList.remove("over")));

  $(zone).addEventListener("drop", (e) => {
    e.preventDefault();
    if (e.dataTransfer.files[0]) run(e.dataTransfer.files[0]);
  });
});
