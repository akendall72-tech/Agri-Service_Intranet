// Reminders
//
// The daily, weekly and monthly checklist everyone ticks, and the shared
// reminders an owner sets.

// ---- reminders -----------------------------------------------------------
//
// Period keys mirror ReminderStore.swift: the column is called week_start, but
// it means "the start of the period this tick belongs to", so a daily task
// keys off today and a monthly one off the 1st.

function dayKey(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function periodKey(cadence) {
  const now = new Date();
  if (cadence === "daily") return dayKey(now);
  if (cadence === "monthly") return dayKey(new Date(now.getFullYear(), now.getMonth(), 1));
  // Weeks start on Monday, as they do in the app.
  const monday = new Date(now);
  monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
  return dayKey(monday);
}

function visibleTasks() {
  const done = (id, cadence) =>
    completions.some(c => c.task_id === id && c.week_start === periodKey(cadence));

  const shared = sharedTasks
    .filter(t => !hiddenTasks.includes(t.id))
    .map(t => ({ id: t.id, kind: "weekly", title: t.title, detail: t.detail,
                 cadence: t.cadence || "weekly", ticksItself: ["safety_brief", "safety_report"].includes(t.ticked_by),
                 ticker: t.ticked_by,
                 done: done(t.id, t.cadence || "weekly") }));

  const personal = personalTasks
    .map(t => ({ id: t.id, kind: "personal", title: t.title, detail: null,
                 cadence: t.cadence || "weekly",
                 done: done(t.id, t.cadence || "weekly") }));

  return shared.concat(personal);
}

function remindersView() {
  const items = visibleTasks();
  const outstanding = items.filter(t => !t.done).length;

  // Passing the month's Safety Brief, or sending a Safety Report, ticks that
  // reminder; it can't be ticked by hand (0080, 0082), so it links to the
  // brief or the form instead of a box.
  const list = items.map(t => t.ticksItself ? `
    <div class="task">
      <span class="sd-tick${t.done ? " on" : ""}" aria-label="${t.done ? "Done" : "Not done yet"}">${t.done ? "✓" : ""}</span>
      <span>
        <b class="${t.done ? "done" : ""}">${esc(t.title)}</b>
        ${t.detail ? `<br><span class="note">${esc(t.detail)}</span>` : ""}
        <br>${t.ticker === "safety_report" ? `<button type="button" class="linkish" data-view="safetyform">${t.done
            ? `Done: you sent a Safety Report this ${t.cadence === "daily" ? "day" : t.cadence === "monthly" ? "month" : "week"}`
            : "Open the Safety Report form. It ticks itself when you send one"} &rsaquo;</button>` : (() => {
          // Straight to this month's brief, or the Safety Desk if it isn't up yet.
          const current = deskBriefs().find(x => x.month === briefThisMonth());
          return `<button type="button" class="linkish" ${current ? `data-view="safetybrief" data-brief="${esc(current.id)}"`
            : `data-view="safetydesk"`}>${t.done ? "Done: you passed this month's Safety Brief"
            : current ? "Open this month's Safety Brief. It ticks itself when you pass" : "Open the Safety Desk. It ticks itself when you pass this month's brief"} &rsaquo;</button>`;
        })()}
      </span>
    </div>` : `
    <div class="task">
      <input type="checkbox" data-task="${esc(t.id)}" data-kind="${t.kind}"
             data-cadence="${t.cadence}" ${t.done ? "checked" : ""}>
      <span>
        <b class="${t.done ? "done" : ""}">${esc(t.title)}</b>
        ${t.detail ? `<br><span class="note">${esc(t.detail)}</span>` : ""}
        <br><span class="cadence">${esc(t.cadence)}${
          t.kind === "personal" ? " · yours" : ""}</span>
      </span>
    </div>`).join("") || `<p class="note">Nothing on the list.</p>`;

  const hidden = sharedTasks.filter(t => hiddenTasks.includes(t.id));

  return hero("Reminders",
      outstanding ? `${outstanding} still to do.` : "All caught up.")
    + `<div class="card">${list}</div>`
    + (hidden.length ? `<div class="card">
        <h2>Hidden shared reminders</h2>
        ${hidden.map(t => `<div class="task">
          <span><b>${esc(t.title)}</b></span>
          <button class="ghost" style="margin-left:auto"
                  data-unhide="${esc(t.id)}">Show again</button>
        </div>`).join("")}
      </div>` : "");
}

$("view").addEventListener("change", async (event) => {
  const box = event.target.closest("input[type=checkbox][data-task]");
  if (!box) return;

  const { task, kind, cadence } = box.dataset;
  const key = periodKey(cadence);
  box.disabled = true;

  if (box.checked) {
    const { error } = await db.from("task_completions")
      .insert({ task_id: task, task_kind: kind, week_start: key });
    if (error) { alert(error.message); box.checked = false; box.disabled = false; return; }
    completions.push({ task_id: task, week_start: key });
  } else {
    const { error } = await db.from("task_completions")
      .delete().eq("task_id", task).eq("week_start", key);
    if (error) { alert(error.message); box.checked = true; box.disabled = false; return; }
    completions = completions.filter(c =>
      !(c.task_id === task && c.week_start === key));
  }

  showView("reminders");
});

$("view").addEventListener("click", async (event) => {
  const unhide = event.target.closest("[data-unhide]");
  if (!unhide) return;
  const { error } = await db.from("hidden_shared_tasks")
    .delete().eq("task_id", unhide.dataset.unhide);
  if (error) return alert(error.message);
  hiddenTasks = hiddenTasks.filter(id => id !== unhide.dataset.unhide);
  showView("reminders");
});

// ---------------------------------------------------------------- shared reminders

const CADENCES = [
  ["daily", "Daily — resets every morning"],
  ["weekly", "Weekly — resets Monday"],
  ["monthly", "Monthly — resets on the 1st"]
];

function renderSharedReminders() {
  const box = $("sharedReminderList");
  if (!box) return;

  if (!allSharedTasks.length) {
    box.innerHTML = `<p class="note">No shared reminders yet.</p>`;
    return;
  }

  box.innerHTML = allSharedTasks.map(r => `
    <div class="role${r.is_active ? "" : " off"}" style="padding:16px${
      r.is_active ? "" : ";opacity:.6"}" data-shared-reminder="${esc(r.id)}">
      <div class="fields">
        <div class="wide"><label>Reminder</label>
          <input type="text" data-r="title" value="${esc(r.title)}"></div>
        <div class="wide"><label>Detail (optional, shown under the title)</label>
          <input type="text" data-r="detail" value="${esc(r.detail || "")}"></div>
        <div><label>How often</label>
          <select data-r="cadence">
            ${CADENCES.map(([value, label]) => `<option value="${value}"${
              (r.cadence || "weekly") === value ? " selected" : ""}>${label}</option>`).join("")}
          </select></div>
        <div><label>Order</label>
          <input type="text" data-r="sort_order" value="${esc(r.sort_order)}"></div>
        <div><label>Showing</label>
          <select data-r="is_active">
            <option value="yes"${r.is_active ? " selected" : ""}>Yes</option>
            <option value="no"${r.is_active ? "" : " selected"}>No</option>
          </select></div>
      </div>
      <div class="row">
        <button data-act="save-shared-reminder">Save</button>
        <button class="ghost" data-act="delete-shared-reminder">Delete</button>
        <span class="msg"></span>
      </div>
    </div>`).join("");
}

$("admin").addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-act]");
  if (!button) return;
  const act = button.dataset.act;
  if (!["add-shared-reminder", "save-shared-reminder",
        "delete-shared-reminder"].includes(act)) return;

  if (act === "add-shared-reminder") {
    const { error } = await db.from("weekly_tasks").insert({
      title: "New reminder",
      cadence: "weekly",
      is_active: false,
      sort_order: (allSharedTasks.length + 1) * 10
    });
    if (error) {
      $("sharedReminderMsg").textContent = error.message.includes("row-level")
        ? "Only an owner can add shared reminders." : error.message;
      $("sharedReminderMsg").className = "msg error";
      return;
    }
    // Added switched off, so nobody's phone shows "New reminder" while it's
    // still being written. Turn Showing to Yes once it reads right.
    $("sharedReminderMsg").textContent =
      "Added, not showing yet. Fill it in, set Showing to Yes, and save.";
    $("sharedReminderMsg").className = "msg ok";
    await loadAll();
    return renderSharedReminders();
  }

  const box = button.closest("[data-shared-reminder]");
  const id = box.dataset.sharedReminder;
  const reminder = allSharedTasks.find(r => r.id === id);
  const get = (f) => box.querySelector(`[data-r="${f}"]`).value.trim();

  if (act === "delete-shared-reminder") {
    if (!confirm(`Delete "${reminder.title}" from every phone? ` +
                 `This can't be undone — "Showing: No" can.`)) return;
    const { data, error } = await db.from("weekly_tasks")
      .delete().eq("id", id).select();
    if (error) return speak(box, error.message, true);
    // A delete the policy refused matches no rows and reports no error.
    if (!data || !data.length) {
      return speak(box, "Nothing deleted — only an owner can remove these.", true);
    }
    await loadAll();
    return renderSharedReminders();
  }

  if (!get("title")) return speak(box, "A reminder needs some words.", true);

  speak(box, "Saving…", false);
  const { data, error } = await db.from("weekly_tasks").update({
    title: get("title"),
    detail: get("detail") || null,
    cadence: get("cadence"),
    sort_order: parseInt(get("sort_order"), 10) || 0,
    is_active: get("is_active") === "yes"
  }).eq("id", id).select();

  if (error) return speak(box, error.message, true);
  if (!data || !data.length) {
    return speak(box, "Nothing changed — only an owner can edit these.", true);
  }

  Object.assign(reminder, data[0]);
  // Refresh the showing-only list too, so the Reminders view on this page and
  // the tile's badge agree with what was just saved.
  await loadAll();
  renderSharedReminders();
});
