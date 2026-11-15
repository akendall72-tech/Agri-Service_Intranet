// Join slips on the web page (migration 0141)
//
// "Have a join slip?" under the sign-in form, as in the app: someone on the
// People list types the code a location admin gave them, sees whose it is,
// picks a password, and is signed in. The join edge function does the work
// and guards itself; see supabase/functions/join. Giving slips is on the
// People list and the Location Dashboard (people-list.js).

let joinSlip = null, joinCode = "", joinBusy = false, joinProblem = "";

function showJoin(on) {
  $("signInForm").classList.toggle("hidden", on);
  $("joinForm").classList.toggle("hidden", !on);
  $("joinToggle").textContent = on ? "Back to signing in" : "Have a join slip?";
  const heading = document.querySelector(".auth-card h1");
  if (heading) heading.textContent = on ? "Join" : "Sign in";
  if (on) { joinSlip = null; joinProblem = ""; drawJoin(); setTimeout(() => $("joinCode") && $("joinCode").focus()); }
}

function drawJoin() {
  const box = $("joinForm");
  if (!box) return;
  box.innerHTML = !joinSlip ? `
    <label for="joinCode">The code on your slip</label>
    <input id="joinCode" type="text" autocapitalize="characters" spellcheck="false" autocomplete="one-time-code"
      placeholder="K7QM-4XRP" value="${esc(joinCode)}" class="join-code">
    <p class="note">Your location admin gives you one. Capitals, spaces and the dash don't matter.</p>
    <button type="button" id="joinLook" ${joinBusy ? "disabled" : ""}>Continue</button>
    <p class="error">${esc(joinProblem)}</p>` : `
    <div class="join-who"><span>This code is for</span><b>${esc(joinSlip.full_name)}</b>
      <span>${esc([joinSlip.job, joinSlip.location, joinSlip.company].filter(Boolean).join(" · "))}</span>
      <span>You'll sign in as <b>${esc(joinSlip.sign_in)}</b></span></div>
    <label for="joinPassword">${joinSlip.kind === "password" ? "New password" : "Pick a password"}</label>
    <input id="joinPassword" type="password" autocomplete="new-password">
    <label for="joinAgain">Type it again</label>
    <input id="joinAgain" type="password" autocomplete="new-password">
    <p class="note">At least 8 characters. Only you will know it.</p>
    <button type="button" id="joinUse" ${joinBusy ? "disabled" : ""}>That's me, sign in</button>
    <p class="error">${esc(joinProblem)}</p>
    <p class="note">Not you? Hand the slip back to whoever gave it to you.</p>`;
}

// The join function's answer, or its own words when it says no.
async function callJoin(body) {
  const { data, error } = await db.functions.invoke("join", { body });
  if (error) {
    let message = "That didn't go through. Check your connection and try again.";
    try { const said = await error.context.json(); if (said && said.error) message = said.error; } catch { /* not its words */ }
    throw new Error(message);
  }
  return data;
}

async function joinStep(work) {
  joinBusy = true; joinProblem = ""; drawJoin();
  try { await work(); } catch (error) { joinProblem = error.message; }
  joinBusy = false;
  if (!$("joinForm").classList.contains("hidden")) drawJoin();
}

$("auth").addEventListener("click", (e) => {
  if (e.target.closest("#joinToggle")) return showJoin($("joinForm").classList.contains("hidden"));
  if (e.target.closest("#joinLook")) {
    joinCode = $("joinCode").value;
    if (joinCode.replace(/[^A-Za-z0-9]/g, "").length !== 8) { joinProblem = "A code is eight letters and numbers, like K7QM-4XRP."; return drawJoin(); }
    return joinStep(async () => { joinSlip = await callJoin({ action: "look", code: joinCode }); });
  }
  if (e.target.closest("#joinUse")) {
    const password = $("joinPassword").value, again = $("joinAgain").value;
    if (password.length < 8) { joinProblem = "A password is at least 8 characters."; return drawJoin(); }
    if (password !== again) { joinProblem = "The two passwords don't match."; return drawJoin(); }
    return joinStep(async () => {
      const done = await callJoin({ action: "use", code: joinCode, password });
      const { error } = await db.auth.signInWithPassword({ email: done.email, password });
      if (error) throw new Error(`Your account is ready, but signing in didn't work: ${error.message} Sign in as ${done.sign_in}.`);
      joinSlip = null; joinCode = "";
      showJoin(false);
      await start();
    });
  }
});

$("auth").addEventListener("keydown", (e) => {
  if (e.key !== "Enter") return;
  if (e.target.id === "joinCode") $("joinLook") && $("joinLook").click();
  if (e.target.id === "joinAgain") $("joinUse") && $("joinUse").click();
});
