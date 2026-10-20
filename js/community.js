// Social: the Company community
//
// The Company feed: posts, shout-outs, comments, reactions, @mentions and
// what's new since last read.

// ---- Social: the Company community (0088) -----------------------------------
//
// The app's Social tab: Events, and the Company community, everyone at every
// location. People post, give shout-outs, @mention each other, react and
// comment. Who wrote a post, their location, and the names of anyone @mentioned are
// stamped by the database from their profiles, not taken from here. Authors
// edit and delete their own posts; owners anyone's (and, once there are
// location communities, that location's admins theirs: the database already says
// so). Being @mentioned is a push to the app, sent by the notify function. A
// new post is only a count, kept in the same place as the app's, so reading the
// feed here clears it on the phone too.

const CM = "company";
const CM_BUCKET = "community-photos";
const CM_REACTIONS = [["clap", "👏"], ["fire", "🔥"], ["heart", "❤️"], ["muscle", "💪"], ["party", "🎉"]];
// Avatar colours, lit and plain, as CommunityAvatar's palette in the app, so
// each person has the same colour in both.
const CM_AVATAR = [["#FF6728", "#C2410C"], ["#5AB0FF", "#2F5D7C"], ["#45FF62", "#22B439"], ["#3ED3C6", "#0F766E"],
  ["#9C8FE0", "#5B4BB7"], ["#FFAC2A", "#B8760D"], ["#2BAC43", "#137026"]];

let cmPosts = [], cmReactions = [], cmComments = [], cmPeople = [];
let cmPhotoUrls = {};              // photo path -> signed URL
let cmSeenThrough = undefined;     // ms; undefined until known
let cmFresh = new Set();           // new when the feed was opened, marked NEW
let cmError = null, cmNotSetUp = false;
let openCommunityPostId = null;
// What's being written: a new post, an edit to one, and a comment. Kept here
// so a redraw doesn't lose it.
let cmDrafts = { new: cmBlankDraft(), edit: null, comment: cmBlankDraft() };
let cmPickAt = {};                 // draft -> the highlighted row in the @ list
let cmPickOff = {};                // draft -> the @ list was closed with Escape

function cmBlankDraft(shoutout = false) {
  return { body: "", shoutout, mentions: [], photo: null, removePhoto: false, busy: false };
}

async function loadCommunity() {
  const posts = await db.from("community_posts")
    .select("id, community_id, author_id, author_name, author_location, body, shoutout, mentions, photo_path, created_at, edited_at, edited_by_name")
    .eq("community_id", CM).order("created_at", { ascending: false }).limit(150);
  if (posts.error) {
    cmError = posts.error.message || "unknown";
    cmNotSetUp = /does not exist|schema cache/i.test(cmError);
    return;
  }
  cmError = null; cmNotSetUp = false;
  cmPosts = posts.data || [];
  const ids = cmPosts.map(p => p.id);
  const none = Promise.resolve({ data: [] });
  const [taps, comments, reader, folks] = await Promise.all([
    ids.length ? db.from("community_reactions").select("post_id, user_id, reaction").in("post_id", ids) : none,
    ids.length ? db.from("community_comments").select("id, post_id, author_id, author_name, body, mentions, created_at")
      .in("post_id", ids).order("created_at") : none,
    db.from("community_readers").select("seen_through").eq("community_id", CM),
    cmPeople.length ? Promise.resolve({ data: cmPeople }) : db.rpc("community_people")
  ]);
  cmReactions = taps.data || [];
  cmComments = comments.data || [];
  cmPeople = folks.data || cmPeople;
  if (!reader.error) {
    const row = (reader.data || [])[0];
    if (row) {
      // Forward only: another device may have read further.
      cmSeenThrough = Math.max(cmSeenThrough || 0, Date.parse(row.seen_through));
    } else if (cmSeenThrough === undefined) {
      // Nothing recorded yet: what's there now is the starting point, so a
      // first look doesn't count every post ever written as new.
      const newest = cmNewest();
      cmSeenThrough = newest ? Date.parse(newest) : Date.now();
      db.rpc("mark_community_seen", { community: CM, through: newest || new Date().toISOString() }).then(() => {}, () => {});
    }
  }
  await cmSignPhotos();
}

// Photos are in a private bucket, so an <img> needs a signed URL.
async function cmSignPhotos() {
  const paths = [...new Set(cmPosts.map(p => p.photo_path).filter(p => p && !cmPhotoUrls[p]))];
  if (!paths.length) return;
  const { data } = await db.storage.from(CM_BUCKET).createSignedUrls(paths, 3600);
  (data || []).forEach(item => { if (item.signedUrl) cmPhotoUrls[item.path] = item.signedUrl; });
}

// ---- new since last read --------------------------------------------------

const cmNewest = () => (cmPosts[0] || {}).created_at || null;
const cmIsNew = (p) => cmSeenThrough !== undefined && p.author_id !== me.id && Date.parse(p.created_at) > cmSeenThrough;
const cmUnseenCount = () => cmPosts.filter(cmIsNew).length;

// The feed is on screen: what's new is marked NEW for this visit and stops
// counting, here and in the app.
function markCommunitySeen(opening) {
  const fresh = cmPosts.filter(cmIsNew).map(p => p.id);
  cmFresh = opening ? new Set(fresh) : new Set([...cmFresh, ...fresh]);
  const newest = cmNewest();
  if (!newest || (cmSeenThrough !== undefined && Date.parse(newest) <= cmSeenThrough)) return;
  cmSeenThrough = Date.parse(newest);
  // Sent exactly as the database wrote it, so nothing is lost to rounding.
  db.rpc("mark_community_seen", { community: CM, through: newest }).then(() => {}, () => {});
  setTimeout(cmRenav);
}

// The sidebar again, for its count, keeping whichever page is lit.
function cmRenav() {
  const on = document.querySelector("#appNav .nav-item.active");
  renderAppNav(on ? on.dataset.nav : undefined);
}

// Opening Social, the feed or a post fetches what's changed since, then
// redraws only the parts that show it, leaving anything being typed alone.
const cmSignature = () => cmPosts.map(p => p.id + (p.edited_at || "")).join() + "|" + cmReactions.length
  + "|" + cmComments.length + "|" + cmSeenThrough;

async function cmRefresh() {
  const before = cmSignature();
  await loadCommunity();
  if (cmSignature() === before) return;
  const root = $("view").classList.contains("hidden") ? null : $("view").querySelector("[data-cm-page]");
  const where = root ? root.dataset.cmPage : null;
  if (where === "social") root.outerHTML = cmSocialHtml();
  if (where === "community") { markCommunitySeen(false); cmRedrawFeed(); }
  if (where === "post") { cmRedrawPost(openCommunityPostId); cmRedrawComments(openCommunityPostId); }
  cmRenav();
}

// ---- pieces -----------------------------------------------------------------

// A person's initials in a coloured circle, the colour from the name.
function cmAvatar(name, size = 38) {
  const words = (name || "").split(/\s+/).filter(w => /\p{L}/u.test(w.charAt(0)));
  const initials = (words.length ? words[0].charAt(0) : "") + (words.length > 1 ? words[words.length - 1].charAt(0) : "");
  const sum = [...(name || "")].reduce((total, c) => total + c.codePointAt(0), 0);
  const [bright, base] = CM_AVATAR[sum % CM_AVATAR.length];
  return `<span class="cm-avatar" aria-hidden="true" style="width:${size}px;height:${size}px;font-size:${Math.round(size * 0.4)}px;background:linear-gradient(135deg, ${bright}, ${base})">${esc((initials || "?").toUpperCase())}</span>`;
}

// The words, with each @mention picked out. Longest names first, so "@Dan"
// doesn't light up the start of "@Dana Price".
function cmBodyHtml(text, mentions) {
  const tags = [...new Set((mentions || []).map(m => esc("@" + m.name)))].sort((a, b) => b.length - a.length);
  const html = esc(text);
  if (!tags.length) return html;
  const pattern = new RegExp(tags.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), "g");
  return html.replace(pattern, (tag) => `<b class="cm-at">${tag}</b>`);
}

// The mentions whose "@Name" is still in the words: someone tagged and then
// deleted from the text isn't told.
function cmKept(mentions, text) {
  const seen = new Set();
  return (mentions || []).filter(m => text.includes("@" + m.name) && !seen.has(m.id) && seen.add(m.id));
}

function cmWhen(iso) {
  const t = Date.parse(iso), s = (Date.now() - t) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) { const h = Math.floor(s / 3600); return `${h} hour${h === 1 ? "" : "s"} ago`; }
  if (s < 7 * 86400) { const d = Math.floor(s / 86400); return d === 1 ? "yesterday" : `${d} days ago`; }
  return new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric",
    year: new Date(t).getFullYear() === new Date().getFullYear() ? undefined : "numeric" });
}

function cmNames(names) {
  return names.length < 3 ? names.join(" and ") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

// Your own, or any for an owner. The database decides; this only decides
// whether to offer it.
const cmCanChange = (p) => p.author_id === me.id || isOwner();
const cmCommentsOn = (postId) => cmComments.filter(c => c.post_id === postId);
const cmPostTitle = (p) => p.shoutout && (p.mentions || []).length
  ? `Shout-out for ${cmNames(p.mentions.map(m => m.name))}` : `${p.author_name || "Someone"}'s post`;

// ---- Social -----------------------------------------------------------------

function socialView() {
  setTimeout(cmRefresh);
  // This month's leader, or your place, on the Fitness Challenge's and Trivia's doors.
  setTimeout(async () => {
    await Promise.all([loadFitness(fxThisMonth()), loadTrivia()]);
    const root = $("view").querySelector('[data-cm-page="social"]');
    if (root && !$("view").classList.contains("hidden")) root.outerHTML = cmSocialHtml();
  });
  return hero("Social", "Share wins, give shout-outs, and see what's coming up across Agri-Service.") + cmSocialHtml();
}

function cmSocialHtml() {
  const n = cmUnseenCount(), latest = cmPosts[0];
  const upcoming = (companyEvents || []).filter(e => e.is_published && !eventIsPast(e))
    .sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at));
  return `<div class="cm" data-cm-page="social">
    <h2 class="group-title">Communities</h2>
    <button type="button" class="cab-card cm-door" data-view="community" style="${lit("amber")}">
      <span class="cm-door-glyph">${icon("megaphone", 24)}</span>
      <span class="cm-door-main">
        <b>Company${n ? `<span class="cm-count">${n} new</span>` : ""}</b>
        <span>Everyone, at every location. Post a win or a photo, or give someone a shout-out with @.</span>
        ${latest ? `<span class="cm-latest">${latest.shoutout ? "★ " : ""}${esc(latest.author_name || "Someone")}: ${esc(latest.body)}</span>` : ""}
        <span class="cm-go">Open the feed &rarr;</span>
      </span>
    </button>
    <h2 class="group-title">Events</h2>
    <button type="button" class="cab-card cm-door" data-view="events" style="${lit("teal")}">
      <span class="cm-door-glyph">${icon("events", 24)}</span>
      <span class="cm-door-main">
        <b>Events</b>
        <span>Training, customer days, company get-togethers and holidays. See who's going, and sign up.</span>
        ${upcoming.length ? `<span class="cm-latest">Next: ${esc(upcoming[0].title)} · ${esc(eventWhen(upcoming[0]))}</span>` : ""}
        <span class="cm-go">Open events &rarr;</span>
      </span>
    </button>
    ${fxDoorHtml()}
    ${tvDoorHtml()}
  </div>`;
}

// ---- the Company feed -------------------------------------------------------

function communityView() {
  markCommunitySeen(true);
  setTimeout(cmRefresh);
  const head = hero("Company", "Everyone, at every location. Share a win, post a photo, or call someone out for great work with @.");
  if (cmNotSetUp || cmError) {
    return head + `<div class="cm"><div class="cm-card cm-empty">
      <b>${cmNotSetUp ? "The community isn't switched on yet" : "The feed couldn't be loaded"}</b>
      <p>${cmNotSetUp ? "It opens once the database is ready for it." : "Try again in a minute."}</p></div></div>`;
  }
  return head + `<div class="cm" data-cm-page="community">
    <div class="cm-card cm-spot" id="cmSpot">${cmSpotlightHtml()}</div>
    ${cmComposerHtml("new")}
    <h2 class="group-title">Latest</h2>
    <p class="cm-msg" id="cm-msg-feed" role="alert"></p>
    <div class="cm-feed" id="cmFeed">${cmFeedHtml()}</div>
  </div>`;
}

// This month: the shout-outs, the posts, who's had the most shout-outs (a tie
// at the top names nobody), and how many people can be tagged.
function cmSpotlightHtml() {
  const start = new Date(); start.setDate(1); start.setHours(0, 0, 0, 0);
  const month = cmPosts.filter(p => Date.parse(p.created_at) >= start.getTime());
  const shouts = month.filter(p => p.shoutout);
  const tally = {};
  shouts.forEach(p => (p.mentions || []).forEach(m => {
    tally[m.id] = tally[m.id] || { name: m.name, n: 0 };
    tally[m.id].n++;
  }));
  const ranked = Object.values(tally).sort((a, b) => b.n - a.n);
  const top = ranked.length && (ranked.length === 1 || ranked[0].n > ranked[1].n) ? ranked[0] : null;
  const monthName = start.toLocaleDateString("en-US", { month: "long" });
  const stat = (value, label) => `<div><span class="cm-stat"><b>${value}</b><small>${esc(label)}</small></span></div>`;
  return `<p class="cm-eyebrow">${icon("people", 15)}Agri-Service community · ${esc(monthName)}</p>
    <div class="cm-stats">
      ${stat(shouts.length, `shout-out${shouts.length === 1 ? "" : "s"} this month`)}
      ${stat(month.length, `post${month.length === 1 ? "" : "s"} this month`)}
      <div class="cm-star">${top ? cmAvatar(top.name, 34) : `<span class="cm-star-icon" aria-hidden="true">★</span>`}
        <span class="cm-stat"><b>${top ? esc(top.name) : ranked.length ? "A tie" : "Nobody yet"}</b>
        <small>${top ? `most shout-outs · ${top.n}` : "most shout-outs this month"}</small></span></div>
      ${stat(cmPeople.length || "–", "people to tag")}
    </div>`;
}

function cmFeedHtml() {
  if (!cmPosts.length) {
    return `<div class="cm-card cm-empty"><b>Nothing posted yet</b>
      <p>Be the first: share a win, or give someone a shout-out.</p></div>`;
  }
  return cmPosts.map(p => cmPostHtml(p, false)).join("");
}

function cmRedrawFeed() {
  const feed = $("cmFeed"), spot = $("cmSpot");
  if (feed) feed.innerHTML = cmFeedHtml();
  if (spot) spot.innerHTML = cmSpotlightHtml();
}

function cmPostHtml(p, onPage) {
  const editing = cmDrafts.edit && cmDrafts.edit.id === p.id;
  const meta = [locations[p.author_location] || "", cmWhen(p.created_at),
    p.edited_at ? `edited${p.edited_by_name && p.edited_by_name !== p.author_name ? ` by ${p.edited_by_name}` : ""}` : ""]
    .filter(Boolean).join(" · ");
  const comments = cmCommentsOn(p.id).length;
  const photo = !p.photo_path ? ""
    : cmPhotoUrls[p.photo_path] ? `<img class="cm-photo" src="${esc(cmPhotoUrls[p.photo_path])}" alt="The photo with ${esc(p.author_name || "this")}'s post" loading="lazy">`
    : `<div class="cm-photo cm-photo-wait" aria-hidden="true"></div>`;
  const reactions = CM_REACTIONS.map(([kind, emoji]) => {
    const taps = cmReactions.filter(r => r.post_id === p.id && r.reaction === kind);
    const mine = taps.some(r => r.user_id === me.id);
    const who = taps.map(r => r.user_id === me.id ? "You" : (cmPeople.find(x => x.id === r.user_id) || {}).full_name).filter(Boolean);
    return `<button type="button" class="cm-react${mine ? " mine" : ""}" data-cm-act="react" data-post="${esc(p.id)}" data-kind="${kind}"
      aria-pressed="${mine}" aria-label="${kind}, ${taps.length}"${who.length ? ` title="${esc(who.join(", "))}"` : ""}><span class="e">${emoji}</span>${taps.length ? `<b>${taps.length}</b>` : ""}</button>`;
  }).join("");
  return `<article class="cm-card cm-post${p.shoutout ? " shout" : ""}" id="cm-post-${esc(p.id)}" data-on-page="${onPage ? 1 : 0}">
    ${p.shoutout ? `<div class="cm-shout"><span class="cm-shout-label">${icon("megaphone", 15)}Shout-out</span>
      <div class="cm-chips">${(p.mentions || []).map(m => `<span class="cm-chip">${cmAvatar(m.name, 22)}${esc(m.name)}<i aria-hidden="true">★</i></span>`).join("")}</div></div>` : ""}
    <header class="cm-head">${cmAvatar(p.author_name, 40)}
      <span class="cm-who"><b>${esc(p.author_name || "Someone")}</b><small>${esc(meta)}</small></span>
      ${cmFresh.has(p.id) ? `<span class="cab-tag cm-new">New</span>` : ""}
      ${cmCanChange(p) && !editing ? `<span class="cm-tools">
        <button type="button" class="cm-link" data-cm-act="edit" data-post="${esc(p.id)}">Edit</button>
        <button type="button" class="cm-link danger" data-cm-act="delete" data-post="${esc(p.id)}">Delete</button></span>` : ""}
    </header>
    ${editing ? cmComposerHtml("edit") : `<div class="cm-body">${cmBodyHtml(p.body, p.mentions)}</div>${photo}`}
    <footer class="cm-foot">
      <span class="cm-reacts">${reactions}</span>
      ${onPage ? "" : `<button type="button" class="cm-comments" data-view="communitypost" data-cm-post="${esc(p.id)}">${icon("chat", 15)}${
        comments ? `${comments} comment${comments === 1 ? "" : "s"}` : "Comment"}</button>`}
    </footer>
  </article>`;
}

function cmRedrawPost(id) {
  const el = id && $("cm-post-" + id);
  if (!el) return;
  const p = cmPosts.find(x => x.id === id);
  if (!p) { el.remove(); return; }
  el.outerHTML = cmPostHtml(p, el.dataset.onPage === "1");
}

// ---- one post and its comments ------------------------------------------------

function communityPostView() {
  const p = cmPosts.find(x => x.id === openCommunityPostId);
  if (!p) {
    return hero("Post") + `<div class="cm"><div class="cm-card cm-empty"><b>This post isn't there any more</b>
      <p><button type="button" class="cm-quiet" data-view="community">Back to the feed</button></p></div></div>`;
  }
  if (cmDrafts.comment.postId !== p.id) cmDrafts.comment = { ...cmBlankDraft(), postId: p.id };
  setTimeout(cmRefresh);
  const n = cmCommentsOn(p.id).length;
  return hero(cmPostTitle(p)) + `<div class="cm" data-cm-page="post">
    ${cmPostHtml(p, true)}
    <h2 class="group-title">Comments<span class="cm-n" id="cmCommentN">${n || ""}</span></h2>
    <div id="cmComments">${cmCommentsHtml(p.id)}</div>
    ${cmComposerHtml("comment")}
  </div>`;
}

function cmCommentsHtml(postId) {
  const list = cmCommentsOn(postId);
  if (!list.length) return `<p class="cm-none">No comments yet. Say something nice.</p>`;
  return `<div class="cm-comment-list">${list.map(c => `<div class="cm-comment">${cmAvatar(c.author_name, 32)}
    <div><span class="cm-c-head"><b>${esc(c.author_name || "Someone")}</b><small>${esc(cmWhen(c.created_at))}</small>
      ${c.author_id === me.id || isOwner() ? `<button type="button" class="cm-link danger" data-cm-act="uncomment" data-comment="${esc(c.id)}">Delete</button>` : ""}</span>
    <p>${cmBodyHtml(c.body, c.mentions)}</p></div></div>`).join("")}</div>`;
}

function cmRedrawComments(postId) {
  const host = $("cmComments"), count = $("cmCommentN");
  if (host) host.innerHTML = cmCommentsHtml(postId);
  if (count) count.textContent = cmCommentsOn(postId).length || "";
}

// ---- writing: a post, an edit, a comment ---------------------------------------

function cmComposerHtml(key) {
  const d = cmDrafts[key];
  const comment = key === "comment", edit = key === "edit";
  const existing = edit && !d.removePhoto && !d.photo ? (cmPosts.find(p => p.id === d.id) || {}).photo_path : null;
  const thumb = d.photo ? d.photo.url : existing ? cmPhotoUrls[existing] : null;
  const label = comment ? "Add a comment" : edit ? `Edit the ${d.shoutout ? "shout-out" : "post"}`
    : d.shoutout ? "Who did something great?" : "Share something with everyone";
  const placeholder = comment ? "Say something. Type @ to tag someone."
    : d.shoutout ? "Type @ and pick who it's for, then say what they did."
    : "A win, a photo, what's going on. Type @ to tag someone.";
  const go = edit ? "Save" : comment ? "Send" : d.shoutout ? "Post shout-out" : "Post";
  const tags = cmTagsHtml(key);
  return `<div class="cm-compose${edit ? " cm-inline" : " cm-card"}${comment ? " cm-reply" : ""}${d.shoutout ? " shout" : ""}" id="cm-compose-${key}">
    ${comment ? "" : `<div class="cm-kind" role="group" aria-label="Kind of post">
      <button type="button" class="${d.shoutout ? "" : "on"}" data-cm-act="kind" data-for="${key}" data-shout="0" aria-pressed="${!d.shoutout}">${icon("chat", 15)}Post</button>
      <button type="button" class="${d.shoutout ? "on" : ""}" data-cm-act="kind" data-for="${key}" data-shout="1" aria-pressed="${d.shoutout}">${icon("megaphone", 15)}Shout-out</button></div>`}
    <label class="cm-label" for="cm-text-${key}">${esc(label)}</label>
    <div class="cm-field">
      <textarea id="cm-text-${key}" data-cm-draft="${key}" rows="${comment ? 2 : edit ? 4 : 3}" maxlength="${comment ? 1000 : 2000}"
        placeholder="${esc(placeholder)}" autocomplete="off">${esc(d.body)}</textarea>
      <div class="cm-pick" id="cm-pick-${key}" role="listbox" aria-label="People to tag" hidden></div>
    </div>
    <div class="cm-tags" id="cm-tags-${key}"${tags ? "" : " hidden"}>${tags}</div>
    ${comment ? "" : thumb
      ? `<div class="cm-thumb"><img src="${esc(thumb)}" alt="The photo going with it">
          <button type="button" class="cm-link danger" data-cm-act="unphoto" data-for="${key}">Remove photo</button></div>`
      : `<label class="cm-addphoto">${icon("camera", 16)}<span>Add a photo</span>
          <input type="file" accept="image/*" data-cm-photo="${key}"></label>`}
    <p class="cm-msg" id="cm-msg-${key}" role="alert"></p>
    <div class="cm-actions">
      ${edit ? `<button type="button" class="cm-quiet" data-cm-act="cancel" data-for="edit">Cancel</button>` : ""}
      <button type="button" class="cm-go-btn" data-cm-act="submit" data-for="${key}">${go}</button>
    </div>
  </div>`;
}

function cmTagsHtml(key) {
  const d = cmDrafts[key];
  const kept = cmKept(d.mentions, d.body);
  if (!kept.length) return "";
  const told = key === "edit" ? "Anyone newly tagged gets a notification in the app."
    : kept.length === 1 ? "They'll get a notification in the app." : "Each of them gets a notification in the app.";
  return `<span class="cm-tags-label">Tagged</span>${kept.map(m =>
    `<span class="cm-chip">${cmAvatar(m.name, 20)}${esc(m.name)}</span>`).join("")}<small>${told}</small>`;
}

function cmDrawTags(key) {
  const host = $(`cm-tags-${key}`);
  if (!host) return;
  host.innerHTML = cmTagsHtml(key);
  host.hidden = !host.innerHTML;
}

// The "@word" being typed just before the caret, if there is one.
function cmQuery(key) {
  const box = $(`cm-text-${key}`), d = cmDrafts[key];
  if (!box || !d || cmPickOff[key]) return null;
  const upto = box.value.slice(0, box.selectionStart ?? box.value.length);
  const at = upto.lastIndexOf("@");
  if (at < 0 || (at > 0 && !/\s/.test(upto[at - 1]))) return null;
  const after = upto.slice(at + 1);
  if (after.includes("\n") || after.length > 30) return null;
  // Already a tag: "@Casey Olsen " isn't a search for more Caseys.
  if (d.mentions.some(m => after.startsWith(m.name))) return null;
  return { at, text: after };
}

function cmMatches(key) {
  const q = cmQuery(key);
  if (!q) return [];
  const words = q.text.toLowerCase().split(/\s+/).filter(Boolean);
  const taken = new Set(cmDrafts[key].mentions.map(m => m.id));
  return cmPeople.filter(p => p.id !== me.id && !taken.has(p.id)
    && words.every(w => (p.full_name || "").toLowerCase().includes(w))).slice(0, 6);
}

function cmDrawPick(key) {
  const host = $(`cm-pick-${key}`);
  if (!host) return;
  const list = cmMatches(key);
  const at = Math.min(cmPickAt[key] || 0, Math.max(0, list.length - 1));
  host.innerHTML = list.map((p, i) => `<button type="button" class="${i === at ? "on" : ""}" role="option" aria-selected="${i === at}"
      data-cm-pick="${esc(p.id)}" data-for="${key}">${cmAvatar(p.full_name, 28)}
      <span><b>${esc(p.full_name)}</b>${p.location ? `<small>${esc(p.location)}</small>` : ""}</span><i aria-hidden="true">@</i></button>`).join("");
  host.hidden = !list.length;
}

// A name from the list: "@Full Name " goes in place of what was typed, and the
// person goes on the list of who's tagged.
function cmPickPerson(key, personId) {
  const box = $(`cm-text-${key}`), d = cmDrafts[key];
  const person = cmPeople.find(p => p.id === personId);
  const q = cmQuery(key);
  if (!box || !d || !person || !q) return;
  const insert = `@${person.full_name} `;
  const caret = box.selectionStart ?? box.value.length;
  box.value = box.value.slice(0, q.at) + insert + box.value.slice(caret);
  d.body = box.value;
  if (!d.mentions.some(m => m.id === person.id)) d.mentions.push({ id: person.id, name: person.full_name });
  const pos = q.at + insert.length;
  box.focus();
  box.setSelectionRange(pos, pos);
  cmPickAt[key] = 0;
  cmDrawPick(key);
  cmDrawTags(key);
}

function cmRedrawComposer(key, focus) {
  const el = $(`cm-compose-${key}`);
  if (!el) return;
  const box = $(`cm-text-${key}`);
  const had = focus || (box && document.activeElement === box);
  const caret = box ? box.selectionStart : null;
  el.outerHTML = cmComposerHtml(key);
  const again = $(`cm-text-${key}`);
  if (had && again) {
    const at = caret ?? again.value.length;
    again.focus();
    again.setSelectionRange(at, at);
  }
}

function cmSay(key, text) {
  const el = $(`cm-msg-${key}`);
  if (el) el.textContent = text; else if (text) alert(text);
}

async function cmUpload(blob) {
  const path = `${me.id}/${crypto.randomUUID()}.jpg`;
  const { error } = await db.storage.from(CM_BUCKET).upload(path, blob, { contentType: "image/jpeg" });
  if (error) throw new Error("The photo didn't upload. Try again, or post without it.");
  return path;
}

async function cmSubmit(key, button) {
  const d = cmDrafts[key];
  if (!d || d.busy) return;
  const text = d.body.trim();
  cmSay(key, "");
  if (!text) return cmSay(key, "Write something first.");
  if (d.shrinking) return cmSay(key, "The photo is still getting ready. Try again in a second.");
  const tagged = cmKept(d.mentions, text);
  if (key !== "comment" && d.shoutout && !tagged.length) {
    return cmSay(key, "A shout-out calls someone out: type @ and pick who it's for.");
  }
  d.busy = true;
  button.disabled = true;
  const label = button.textContent;
  button.textContent = key === "edit" ? "Saving…" : key === "comment" ? "Sending…" : "Posting…";
  try {
    if (key === "comment") {
      const id = crypto.randomUUID();
      const { error } = await db.from("community_comments").insert({ id, post_id: d.postId, body: text, mentions: tagged });
      if (error) throw new Error("That wasn't sent. Try again in a minute.");
      if (tagged.length) notify("community_comment", id);
      cmDrafts.comment = { ...cmBlankDraft(), postId: d.postId };
      await loadCommunity();
      cmRedrawComposer("comment");
      cmRedrawComments(d.postId);
      cmRedrawPost(d.postId);
    } else if (key === "new") {
      const id = crypto.randomUUID();
      const path = d.photo ? await cmUpload(d.photo.blob) : null;
      const { error } = await db.from("community_posts")
        .insert({ id, community_id: CM, body: text, shoutout: d.shoutout, mentions: tagged, photo_path: path });
      if (error) {
        if (path) db.storage.from(CM_BUCKET).remove([path]).then(() => {}, () => {});
        throw new Error("That wasn't posted. Try again in a minute.");
      }
      if (tagged.length) notify("community_post", id);
      if (d.photo) URL.revokeObjectURL(d.photo.url);
      cmDrafts.new = cmBlankDraft();
      await loadCommunity();
      markCommunitySeen(false);
      cmRedrawComposer("new");
      cmRedrawFeed();
      const made = $("cm-post-" + id);
      if (made) made.classList.add("cm-arrive");
    } else {
      const post = cmPosts.find(p => p.id === d.id);
      if (!post) throw new Error("That post isn't there any more.");
      let path = d.removePhoto ? null : post.photo_path;
      if (d.photo) path = await cmUpload(d.photo.blob);
      const { data, error } = await db.from("community_posts")
        .update({ body: text, shoutout: d.shoutout, mentions: tagged, photo_path: path }).eq("id", d.id).select("id");
      if (error) throw new Error("That wasn't saved. Try again in a minute.");
      if (!(data || []).length) throw new Error("That wasn't saved: it isn't yours to change.");
      if (post.photo_path && post.photo_path !== path) db.storage.from(CM_BUCKET).remove([post.photo_path]).then(() => {}, () => {});
      // Only those not already told are told: the notify function keeps track.
      if (tagged.length) notify("community_post", d.id);
      if (d.photo) URL.revokeObjectURL(d.photo.url);
      cmDrafts.edit = null;
      await loadCommunity();
      cmRedrawPost(d.id);
      const heading = $("view").querySelector('[data-cm-page="post"]') && $("view").querySelector(".hero h1");
      if (heading) heading.textContent = cmPostTitle(cmPosts.find(p => p.id === d.id) || post);
      const spot = $("cmSpot");
      if (spot) spot.innerHTML = cmSpotlightHtml();
    }
  } catch (e) {
    d.busy = false;
    button.disabled = false;
    button.textContent = label;
    cmSay(key, e.message || "That didn't go through. Try again.");
  }
}

function cmStartEdit(id) {
  const p = cmPosts.find(x => x.id === id);
  if (!p || !cmCanChange(p)) return;
  const old = cmDrafts.edit;
  if (old && old.id !== id) {
    const was = cmPosts.find(x => x.id === old.id);
    if (was && old.body.trim() !== was.body && !confirm("Drop your changes to the other post?")) return;
    cmDrafts.edit = null;
    cmRedrawPost(old.id);
  }
  cmDrafts.edit = { ...cmBlankDraft(p.shoutout), id, body: p.body, mentions: (p.mentions || []).map(m => ({ ...m })) };
  cmRedrawPost(id);
  const box = $("cm-text-edit");
  if (box) { box.focus(); box.setSelectionRange(box.value.length, box.value.length); }
}

async function cmDelete(id) {
  const p = cmPosts.find(x => x.id === id);
  if (!p) return;
  const whose = p.author_id === me.id ? "your" : `${p.author_name || "this person"}'s`;
  if (!confirm(`Delete ${whose} ${p.shoutout ? "shout-out" : "post"}? It comes off the feed for everyone, with its comments and reactions.`)) return;
  const { data, error } = await db.from("community_posts").delete().eq("id", id).select("id");
  if (error || !(data || []).length) return cmSay("feed", "That wasn't deleted. Try again in a minute.");
  if (p.photo_path) db.storage.from(CM_BUCKET).remove([p.photo_path]).then(() => {}, () => {});
  cmPosts = cmPosts.filter(x => x.id !== id);
  cmComments = cmComments.filter(c => c.post_id !== id);
  cmReactions = cmReactions.filter(r => r.post_id !== id);
  if (cmDrafts.edit && cmDrafts.edit.id === id) cmDrafts.edit = null;
  if ($("view").querySelector('[data-cm-page="post"]')) return showView("community");
  cmRedrawFeed();
}

async function cmDeleteComment(id) {
  const c = cmComments.find(x => x.id === id);
  if (!c || !confirm("Delete this comment?")) return;
  const { data, error } = await db.from("community_comments").delete().eq("id", id).select("id");
  if (error || !(data || []).length) return cmSay("comment", "That comment wasn't deleted. Try again in a minute.");
  cmComments = cmComments.filter(x => x.id !== id);
  cmRedrawComments(c.post_id);
}

// A tap on a reaction shows straight away, and is put back if the server says no.
async function cmReact(id, kind) {
  const mine = (r) => r.post_id === id && r.user_id === me.id && r.reaction === kind;
  const had = cmReactions.some(mine);
  const show = (on) => {
    cmReactions = on ? cmReactions.concat({ post_id: id, user_id: me.id, reaction: kind }) : cmReactions.filter(r => !mine(r));
    cmRedrawPost(id);
  };
  show(!had);
  const button = document.querySelector(`#cm-post-${id} [data-kind="${kind}"]`);
  if (button) { if (!had) button.classList.add("pop"); button.focus(); }
  const { error } = had
    ? await db.from("community_reactions").delete().eq("post_id", id).eq("user_id", me.id).eq("reaction", kind)
    : await db.from("community_reactions").insert({ post_id: id, reaction: kind });
  if (error && error.code !== "23505") show(had);
}

$("view").addEventListener("input", (event) => {
  const box = event.target.closest("textarea[data-cm-draft]");
  if (!box) return;
  const key = box.dataset.cmDraft, d = cmDrafts[key];
  if (!d) return;
  d.body = box.value;
  cmPickAt[key] = 0;
  cmPickOff[key] = false;
  cmDrawPick(key);
  cmDrawTags(key);
});

$("view").addEventListener("keydown", (event) => {
  const box = event.target.closest("textarea[data-cm-draft]");
  if (!box) return;
  const key = box.dataset.cmDraft;
  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
    event.preventDefault();
    const go = document.querySelector(`#cm-compose-${key} [data-cm-act="submit"]`);
    if (go) cmSubmit(key, go);
    return;
  }
  const list = cmMatches(key);
  if (!list.length) return;
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    const at = Math.min(cmPickAt[key] || 0, list.length - 1);
    cmPickAt[key] = (at + (event.key === "ArrowDown" ? 1 : list.length - 1)) % list.length;
    cmDrawPick(key);
  } else if (event.key === "Enter" || event.key === "Tab") {
    event.preventDefault();
    cmPickPerson(key, list[Math.min(cmPickAt[key] || 0, list.length - 1)].id);
  } else if (event.key === "Escape") {
    event.preventDefault();
    cmPickOff[key] = true;
    cmDrawPick(key);
  }
});

// The caret moved: the @ list follows it.
$("view").addEventListener("keyup", (event) => {
  const box = event.target.closest("textarea[data-cm-draft]");
  if (box && ["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) cmDrawPick(box.dataset.cmDraft);
});

// Keeps the caret in the box while a name in the list is clicked.
$("view").addEventListener("mousedown", (event) => {
  if (event.target.closest("[data-cm-pick]")) event.preventDefault();
});

$("view").addEventListener("click", (event) => {
  const pick = event.target.closest("[data-cm-pick]");
  if (pick) return cmPickPerson(pick.dataset.for, pick.dataset.cmPick);
  const box = event.target.closest("textarea[data-cm-draft]");
  if (box) return cmDrawPick(box.dataset.cmDraft);
  if (!event.target.closest(".cm-field")) $("view").querySelectorAll(".cm-pick").forEach(list => { list.hidden = true; });
  const button = event.target.closest("[data-cm-act]");
  if (!button) return;
  const key = button.dataset.for, d = key && cmDrafts[key];
  switch (button.dataset.cmAct) {
    case "react": return cmReact(button.dataset.post, button.dataset.kind);
    case "edit": return cmStartEdit(button.dataset.post);
    case "delete": return cmDelete(button.dataset.post);
    case "uncomment": return cmDeleteComment(button.dataset.comment);
    case "cancel": {
      const id = cmDrafts.edit && cmDrafts.edit.id;
      cmDrafts.edit = null;
      return cmRedrawPost(id);
    }
    case "kind":
      if (d) { d.shoutout = button.dataset.shout === "1"; cmRedrawComposer(key, true); }
      return;
    case "unphoto":
      if (d) {
        if (d.photo) URL.revokeObjectURL(d.photo.url);
        d.photo = null;
        if (key === "edit") d.removePhoto = true;
        cmRedrawComposer(key);
      }
      return;
    case "submit": return cmSubmit(key, button);
  }
});

$("view").addEventListener("change", async (event) => {
  const input = event.target.closest("input[data-cm-photo]");
  if (!input || !input.files || !input.files[0]) return;
  const key = input.dataset.cmPhoto, d = cmDrafts[key];
  if (!d) return;
  d.shrinking = true;
  try {
    // 1600 pixels on the long side, as the app sends.
    const blob = await inspShrink(input.files[0]);
    if (d.photo) URL.revokeObjectURL(d.photo.url);
    d.photo = { blob, url: URL.createObjectURL(blob) };
    cmRedrawComposer(key);
  } catch {
    cmSay(key, "That photo couldn't be read. Try a JPEG or a PNG.");
  } finally {
    d.shrinking = false;
  }
});
