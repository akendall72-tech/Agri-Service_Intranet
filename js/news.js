// News
//
// Posts and links, pins, what's new since last read, and writing posts.

// ---------------------------------------------------------------- news
//
// The News page and the admin News tab (migration 0041). Owners post two kinds
// of story: a link to an article somewhere else, filled in by the link-preview
// function from the details the site publishes for sharing, or a post written
// here. Everyone signed in reads what's showing, and can pin stories to read
// later — the same pins the app shows.

let newsPosts = [], newsError = null;
let newsPins = new Map();          // post id -> when it was pinned
let newsImageUrls = {};            // uploaded picture path -> signed URL
let openNewsId = null;
let newsSeenThrough = undefined;   // ms; undefined until known (migration 0042)
let newsFresh = new Set();         // new when News was opened, marked NEW
let newsDraft = null;              // the story in the editor
let newsDirty = false;

async function loadNews() {
  const [posts, pins, reader] = await Promise.all([
    db.from("news_posts").select("*")
      .order("published_on", { ascending: false }).order("created_at", { ascending: false }),
    db.from("news_pins").select("post_id, pinned_at"),
    db.from("news_readers").select("seen_through")
  ]);
  newsError = posts.error ? posts.error.message : null;
  newsPosts = posts.data || [];
  newsPins = new Map((pins.data || []).map(p => [p.post_id, p.pinned_at]));
  if (!reader.error) {
    const row = (reader.data || [])[0];
    if (row) {
      newsSeenThrough = Date.parse(row.seen_through);
    } else {
      // Nothing recorded yet: what's showing now is the starting point, so a
      // first look doesn't count every story as new.
      const newest = newestListed(newsLive());
      newsSeenThrough = newest ? Date.parse(newest) : Date.now();
      // A query builder only runs once it's awaited or then-ed.
      db.rpc("mark_news_seen", { through: newest || new Date().toISOString() }).then(() => {}, () => {});
    }
  }
  await signNewsImages();
}

// ---- new since last read ------------------------------------------------------------
//
// The same marker as the app's count on its News tab: opening News here clears
// it there too, and the other way round.

const newsIsNew = (p) => newsSeenThrough !== undefined && !!p.listed_at
  && Date.parse(p.listed_at) > newsSeenThrough;

const newsUnseenCount = () => newsLive().filter(newsIsNew).length;

function newestListed(list) {
  return list.map(p => p.listed_at).filter(Boolean)
    .sort((a, b) => Date.parse(b) - Date.parse(a))[0] || null;
}

// News is on screen: new stories are marked NEW for this visit, and stop counting.
function markNewsSeen() {
  const fresh = newsLive().filter(newsIsNew);
  newsFresh = new Set(fresh.map(p => p.id));
  const newest = newestListed(fresh);
  if (!newest) return;
  newsSeenThrough = Date.parse(newest);
  // Sent exactly as the database wrote it, so nothing is lost to rounding.
  db.rpc("mark_news_seen", { through: newest }).then(() => {}, () => {});
  setTimeout(() => renderAppNav("news"));
}

// Uploaded pictures are in a private bucket, so an <img> needs a signed URL.
async function signNewsImages() {
  const paths = [...new Set(newsPosts.map(p => p.image_path).filter(p => p && !newsImageUrls[p]))];
  if (!paths.length) return;
  const { data } = await db.storage.from("news-images").createSignedUrls(paths, 3600);
  (data || []).forEach(item => { if (item.signedUrl) newsImageUrls[item.path] = item.signedUrl; });
}

const newsLive = () => newsPosts.filter(p => p.is_published);

function newsHost(url) {
  try { return new URL(url).hostname.replace(/^www\d?\./i, ""); } catch { return ""; }
}

const newsLink = (p) => p.kind === "link" && /^https?:\/\/\S+/i.test(p.url || "") ? p.url : null;

const newsSource = (p) => (p.source_name || "").trim()
  || (p.kind === "post" ? "Agri-Service" : newsHost(p.url) || "News");

// The uploaded picture, the article's own, or a plain tile with an icon. A
// picture that fails to load (a site that moved it) falls back to the tile.
function newsPicture(p, extra = "", override = null) {
  const src = override
    || (p.image_path ? newsImageUrls[p.image_path] : null)
    || (!p.image_path && /^https:\/\//i.test(p.image_url || "") ? p.image_url : null);
  const kind = p.kind === "post" ? "post" : "link";
  return `<span class="news-pic ${kind}${src ? "" : " stand-in"} ${extra}">${src
    ? `<img src="${esc(src)}" alt="" loading="lazy" referrerpolicy="no-referrer"
         data-stand-in>` : ""}${
    icon(kind === "post" ? "megaphone" : "news")}</span>`;
}

// The fallback, as a listener: the page's policy doesn't run onerror="" attributes.
// Errors from an image don't bubble, so it listens on the way down.
document.addEventListener("error", (event) => {
  const picture = event.target;
  if (picture instanceof HTMLImageElement && picture.hasAttribute("data-stand-in")) {
    picture.parentNode.classList.add("stand-in");
    picture.remove();
  }
}, true);

// A link opens the original in a new tab; a post opens here.
function newsOpen(p, inner, preview) {
  if (preview) return `<span class="news-open">${inner}</span>`;
  const link = newsLink(p);
  return link
    ? `<a class="news-open" href="${esc(link)}" target="_blank" rel="noopener noreferrer">${inner}</a>`
    : `<button type="button" class="news-open" data-view="newspost" data-news="${esc(p.id)}">${inner}</button>`;
}

function newsPinButton(p, preview) {
  const on = !preview && newsPins.has(p.id);
  const label = on ? "Unpin" : "Pin to read later";
  return `<button type="button" class="news-pin${on ? " on" : ""}" title="${label}" aria-label="${label}"
    aria-pressed="${on}" ${preview ? "disabled" : `data-news-pin="${esc(p.id)}"`}>${icon(on ? "pinFilled" : "pin", 18)}</button>`;
}

function newsTag(p) {
  return `<span class="news-tag${p.kind === "post" ? " post" : ""}">${esc(newsSource(p))}</span>`;
}

function newsCard(p, { preview = false, pictureOverride = null } = {}) {
  const site = newsLink(p) ? newsHost(p.url) : "";
  return `<article class="news-card">
    ${newsOpen(p, `${newsPicture(p, "", pictureOverride)}
      <div class="news-text"><b>${esc(p.title || "Title")}</b>${p.summary ? `<span>${esc(p.summary)}</span>` : ""}</div>`,
      preview)}
    <div class="news-meta">${newsTag(p)}<span>${esc(newsDate(p.published_on))}</span>
      ${!preview && newsFresh.has(p.id) ? `<span class="news-new">New</span>` : ""}
      ${site ? `<span class="site">${esc(site)} &nearr;</span>` : ""}${newsPinButton(p, preview)}</div>
  </article>`;
}

function newsRow(p) {
  return `<div class="news-row">${newsOpen(p, `${newsPicture(p)}
    <span style="min-width:0"><b>${esc(p.title)}</b>
      <small>${esc(newsSource(p))} · ${esc(newsDate(p.published_on))}${newsLink(p) ? " &nearr;" : ""}</small></span>`,
    false)}${newsPinButton(p, false)}</div>`;
}

// Paragraphs at blank lines; web and email addresses as links. Escaped first,
// so nothing typed can become markup.
function newsParagraphs(text) {
  return String(text || "").replace(/\r\n/g, "\n").split(/\n[ \t]*\n/)
    .map(part => part.trim()).filter(Boolean)
    .map(part => `<p>${esc(part)
      .replace(/\bhttps?:\/\/[^\s<]+[^\s<.,;:!?)\]'"]/gi,
        url => `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`)
      .replace(/(^|[\s(])([\w.+-]+@[\w-]+(\.[\w-]+)+)/g,
        (_m, before, mail) => `${before}<a href="mailto:${mail}">${mail}</a>`)
      .replace(/\n/g, "<br>")}</p>`).join("");
}

// ---- reading ----------------------------------------------------------------------

function newsView() {
  markNewsSeen();
  return hero("News", "Stories picked by the training department. Pin one to read later — your pins are the same here and in the app.")
    + `<div id="newsPage">${newsPageInner()}</div>`;
}

function newsPageInner() {
  if (newsError) {
    return `<p class="error">${/does not exist|schema cache/i.test(newsError)
      ? "News isn't set up yet." : esc(newsError)}</p>`;
  }
  const live = newsLive();
  if (!live.length) {
    return `<div class="card" style="text-align:center;padding:34px 24px">
      <b style="font-size:18px;display:block;margin-bottom:4px">No news yet</b>
      <span class="note">Stories the training department posts will show up here.</span></div>`;
  }
  const pinned = live.filter(p => newsPins.has(p.id))
    .sort((a, b) => Date.parse(newsPins.get(b.id)) - Date.parse(newsPins.get(a.id)));
  const latest = live.filter(p => !newsPins.has(p.id));
  return (pinned.length
      ? `<div class="news-section">${icon("pinFilled", 14)} Pinned to read later</div>
         <div class="news-pinned">${pinned.map(newsRow).join("")}</div>`
      : "")
    + (latest.length
      ? (pinned.length ? `<div class="news-section">Latest</div>` : "")
        + `<div class="news-grid">${latest.map(p => newsCard(p)).join("")}</div>`
      : "");
}

function newsPostView() {
  const p = newsPosts.find(x => x.id === openNewsId && (x.is_published || isOwner()));
  if (!p) return `<p class="note">That story isn't available.</p>`;
  const link = newsLink(p);
  return `<article class="news-read" id="newsRead">
    ${p.image_path || p.image_url ? newsPicture(p) : ""}
    <div class="body">
      <div class="news-meta">${newsTag(p)}<span>${esc(newsDate(p.published_on))}</span>${newsPinButton(p, false)}</div>
      <h1>${esc(p.title)}</h1>
      ${p.summary ? `<p class="lede">${esc(p.summary)}</p>` : ""}
      ${newsParagraphs(p.body)}
      ${link ? `<p><a href="${esc(link)}" target="_blank" rel="noopener noreferrer">Read the full article &nearr;</a></p>` : ""}
    </div>
  </article>`;
}

// Whatever news is on screen, drawn again after a pin changes.
function redrawNews() {
  if ($("newsPage")) $("newsPage").innerHTML = newsPageInner();
  const read = $("newsRead");
  if (read) {
    const p = newsPosts.find(x => x.id === openNewsId);
    const old = read.querySelector("[data-news-pin]");
    if (p && old) old.outerHTML = newsPinButton(p, false);
  }
}

document.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-news-pin]");
  if (!button) return;
  event.preventDefault();
  const id = button.dataset.newsPin;
  const was = newsPins.get(id);
  if (was) newsPins.delete(id); else newsPins.set(id, new Date().toISOString());
  redrawNews();

  const { error } = was
    ? await db.from("news_pins").delete().eq("post_id", id)
    : await db.from("news_pins").upsert({ post_id: id }, { onConflict: "user_id,post_id", ignoreDuplicates: true });
  if (error) {
    if (was) newsPins.set(id, was); else newsPins.delete(id);
    redrawNews();
    alert(`That story couldn't be ${was ? "unpinned" : "pinned"}. ${error.message}`);
  }
});

// ---- admin ------------------------------------------------------------------------

function renderNewsAdmin() {
  const list = $("newsAdminList");
  if (!list) return;
  if (newsError) {
    list.innerHTML = `<p class="error">${/does not exist|schema cache/i.test(newsError)
      ? "Run migration 0041_news.sql in the SQL editor, then reload this page." : esc(newsError)}</p>`;
    return;
  }
  list.innerHTML = newsPosts.length ? newsPosts.map(p => `
    <div class="role news-admin-row${p.is_published ? "" : " off"}" data-news-row="${esc(p.id)}">
      ${newsPicture(p, "thumb")}
      <div style="flex:1;min-width:0">
        <b>${esc(p.title)}</b>${p.is_published ? "" : ` <span class="badge b-none">Hidden</span>`}
        <div class="note">${p.kind === "post" ? "Post" : "Link"} · ${esc(newsSource(p))} · ${esc(newsDate(p.published_on))}</div>
      </div>
      ${newsLink(p) ? `<a class="pdf" href="${esc(newsLink(p))}" target="_blank" rel="noopener noreferrer"
          style="font-size:13px">Open &nearr;</a>` : ""}
      <button class="pdf" data-act="news-edit">Edit</button>
    </div>`).join("") : `<p class="note">No stories yet. Paste a link above to add the first one.</p>`;
}

function newsUuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return "10000000-1000-4000-8000-100000000000".replace(/[018]/g, c =>
    (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16));
}

function openNewsEditor(story) {
  const editor = $("newsEditor");
  if (newsDraft && newsDraft.fileUrl) URL.revokeObjectURL(newsDraft.fileUrl);
  newsDraft = {
    id: story.id || null, kind: story.kind,
    url: story.url || "", title: story.title || "", summary: story.summary || "", body: story.body || "",
    source_name: story.source_name ?? "", published_on: story.published_on || todayISO(),
    is_published: story.is_published !== false,
    image_url: story.image_url || null, image_path: story.image_path || null,
    savedImagePath: story.id ? story.image_path || null : null,
    file: null, fileUrl: null
  };
  const set = (f, v) => { editor.querySelector(`[data-n="${f}"]`).value = v ?? ""; };
  ["url", "title", "summary", "body", "source_name", "published_on"].forEach(f => set(f, newsDraft[f]));
  set("is_published", newsDraft.is_published ? "yes" : "no");
  editor.querySelectorAll("[data-news-kind]").forEach(el =>
    el.classList.toggle("hidden", el.dataset.newsKind !== newsDraft.kind));
  $("newsEditorTitle").textContent = story.id
    ? (story.kind === "post" ? "Edit post" : "Edit link")
    : (story.kind === "post" ? "Write a post" : "New link");
  editor.querySelector('[data-act="news-delete"]').classList.toggle("hidden", !story.id);
  $("newsPictureFile").value = "";
  newsDirty = false;
  speak(editor, "", false);
  drawNewsPreview();
  editor.classList.remove("hidden");
  editor.scrollIntoView({ behavior: "smooth", block: "start" });
}

// The fields typed so far, over what the editor opened with.
function readNewsEditor() {
  const editor = $("newsEditor");
  const get = (f) => editor.querySelector(`[data-n="${f}"]`).value;
  Object.assign(newsDraft, {
    url: get("url").trim(), title: get("title").trim(), summary: get("summary").trim(),
    body: get("body").replace(/\s+$/, ""), source_name: get("source_name").trim(),
    published_on: get("published_on") || todayISO(), is_published: get("is_published") === "yes"
  });
  return newsDraft;
}

function drawNewsPreview() {
  const d = readNewsEditor();
  $("newsSaveBtn").textContent = d.is_published ? (d.id ? "Save" : "Publish") : "Save hidden";
  $("newsPictureNote").textContent = d.file ? "A new picture, uploaded when you save."
    : d.image_path ? "Uploaded."
    : d.image_url ? "From the article's page. Upload one to use a different picture."
    : `None — a plain ${d.kind === "post" ? "red" : "blue"} tile shows instead. Wide pictures work best.`;
  $("newsPreview").innerHTML = newsCard(d, { preview: true, pictureOverride: d.fileUrl });
}

$("newsEditor").addEventListener("input", (event) => {
  if (!event.target.matches("[data-n]")) return;
  newsDirty = true;
  drawNewsPreview();
});

$("newsUrl").addEventListener("keydown", (event) => {
  if (event.key === "Enter") { event.preventDefault(); fetchNewsLink(); }
});

// Shrunk in the browser to 1600 pixels on the long side, so a phone photo
// uploads quickly and loads quickly on a phone.
async function shrinkNewsPicture(file) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return await new Promise(resolve => canvas.toBlob(resolve, "image/jpeg", 0.85));
}

$("newsPictureFile").addEventListener("change", async (event) => {
  const file = event.target.files[0];
  if (!file || !newsDraft) return;
  const editor = $("newsEditor");
  try {
    const blob = await shrinkNewsPicture(file);
    if (!blob) throw new Error("no picture");
    if (newsDraft.fileUrl) URL.revokeObjectURL(newsDraft.fileUrl);
    newsDraft.file = blob;
    newsDraft.fileUrl = URL.createObjectURL(blob);
    newsDirty = true;
    speak(editor, "", false);
    drawNewsPreview();
  } catch {
    speak(editor, "That picture couldn't be opened. Use a JPEG or PNG.", true);
  }
});

async function fetchNewsLink() {
  const box = $("newsAdd");
  const url = $("newsUrl").value.trim();
  if (!/^https?:\/\/[^\s/]+\.[^\s]+/i.test(url)) {
    return speak(box, "Paste the article's full web address — it starts with https://", true);
  }
  if (newsDirty && !$("newsEditor").classList.contains("hidden")
      && !confirm("Leave the story you're editing? Changes you haven't saved will be lost.")) return;

  const same = newsPosts.find(p => p.url && p.url.replace(/[#?].*$/, "").replace(/\/$/, "")
    === url.replace(/[#?].*$/, "").replace(/\/$/, ""));

  const fetchButton = box.querySelector('[data-act="news-fetch"]');
  fetchButton.disabled = true;
  speak(box, "Reading the page…", false);

  let preview = {}, problem = null;
  try {
    const { data, error } = await db.functions.invoke("link-preview", { body: { url } });
    if (error) {
      let message = error.message || "";
      try {
        const body = await error.context.json();
        if (body && body.error) message = body.error;
      } catch { /* no body to read */ }
      problem = /failed to send|fetch|404|not found/i.test(message)
        ? "The link reader isn't switched on yet." : message;
    } else if (data && data.error) {
      problem = data.error;
    } else {
      preview = data || {};
    }
  } catch {
    problem = "The page couldn't be read.";
  }
  fetchButton.disabled = false;

  // A site posted from before keeps the name it was given then.
  const host = newsHost(preview.url || url);
  const earlier = newsPosts.find(p => p.kind === "link" && p.source_name && newsHost(p.url) === host);

  openNewsEditor({
    kind: "link", url: preview.url || url,
    title: preview.title || "", summary: preview.summary || "",
    source_name: earlier ? earlier.source_name : preview.source_name || host,
    published_on: preview.published_on || todayISO(),
    image_url: preview.image_url || null
  });
  newsDirty = true;
  $("newsUrl").value = "";

  if (problem) speak(box, `${problem} Fill in the title and summary by hand.`, true);
  else if (same) speak(box, `Heads up: this link was already posted on ${newsDate(same.published_on)} as "${same.title}".`, true);
  else speak(box, "Filled in. Check it over, change anything you like, then publish.", false);
}

async function saveNews() {
  const editor = $("newsEditor");
  const d = readNewsEditor();
  if (d.kind === "link" && !/^https?:\/\/[^\s/]+\.[^\s]+/i.test(d.url)) {
    return speak(editor, "The link needs to be a full web address, starting with https://", true);
  }
  if (!d.title) return speak(editor, "The story needs a title.", true);
  if (d.kind === "post" && !d.body.trim()) return speak(editor, "Write the post before publishing it.", true);

  const button = $("newsSaveBtn");
  button.disabled = true;
  speak(editor, "Saving…", false);
  const id = d.id || newsUuid();

  let uploaded = null;
  if (d.file) {
    uploaded = `${id}/${Date.now()}.jpg`;
    const { error } = await db.storage.from("news-images")
      .upload(uploaded, d.file, { contentType: "image/jpeg", upsert: false });
    if (error) {
      button.disabled = false;
      return speak(editor, `The picture didn't upload. ${error.message}`, true);
    }
  }

  const row = {
    kind: d.kind, title: d.title, summary: d.summary,
    body: d.kind === "post" ? d.body : "",
    url: d.kind === "link" ? d.url : null,
    source_name: d.source_name || (d.kind === "post" ? "Agri-Service" : newsHost(d.url)),
    published_on: d.published_on, is_published: d.is_published,
    image_url: uploaded ? null : d.image_url,
    image_path: uploaded || d.image_path
  };
  const { data, error } = d.id
    ? await db.from("news_posts").update(row).eq("id", id).select()
    : await db.from("news_posts").insert({ id, ...row }).select();
  button.disabled = false;

  if (error || !data || !data.length) {
    if (uploaded) await db.storage.from("news-images").remove([uploaded]);
    return speak(editor, error ? error.message : "Nothing saved — only an owner can post news.", true);
  }

  // The picture this one replaced or took away.
  if (d.savedImagePath && d.savedImagePath !== row.image_path) {
    await db.storage.from("news-images").remove([d.savedImagePath]);
  }

  newsDirty = false;
  if (d.fileUrl) URL.revokeObjectURL(d.fileUrl);
  newsDraft = null;
  editor.classList.add("hidden");
  await loadNews();
  renderNewsAdmin();
  speak($("newsAdd"), row.is_published
    ? `${d.id ? "Saved" : "Published"}: "${row.title}". Phones show it the next time News is opened.`
    : `Saved "${row.title}", hidden — it isn't showing anywhere yet.`, false);
  $("newsAdd").scrollIntoView({ behavior: "smooth", block: "start" });
}

$("admin").addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-act]");
  if (!button || !button.dataset.act.startsWith("news-")) return;
  const act = button.dataset.act;
  const editor = $("newsEditor");
  const leaving = () => !newsDirty || editor.classList.contains("hidden")
    || confirm("Leave the story you're editing? Changes you haven't saved will be lost.");

  if (act === "news-fetch") return fetchNewsLink();

  if (act === "news-write") {
    if (!leaving()) return;
    speak($("newsAdd"), "", false);
    return openNewsEditor({ kind: "post", source_name: "Agri-Service" });
  }

  if (act === "news-edit") {
    if (!leaving()) return;
    const row = button.closest("[data-news-row]");
    const story = newsPosts.find(p => p.id === row.dataset.newsRow);
    if (story) openNewsEditor(story);
    return;
  }

  if (act === "news-no-picture") {
    if (!newsDraft) return;
    if (newsDraft.fileUrl) URL.revokeObjectURL(newsDraft.fileUrl);
    Object.assign(newsDraft, { file: null, fileUrl: null, image_url: null, image_path: null });
    $("newsPictureFile").value = "";
    newsDirty = true;
    return drawNewsPreview();
  }

  if (act === "news-cancel") {
    if (newsDirty && !confirm("Throw away the changes to this story?")) return;
    if (newsDraft && newsDraft.fileUrl) URL.revokeObjectURL(newsDraft.fileUrl);
    newsDraft = null;
    newsDirty = false;
    editor.classList.add("hidden");
    return;
  }

  if (act === "news-delete") {
    const story = newsDraft && newsPosts.find(p => p.id === newsDraft.id);
    if (!story || !confirm(`Delete "${story.title}"? It comes off the app and this page, and out of everyone's pins.`)) return;
    const { data, error } = await db.from("news_posts").delete().eq("id", story.id).select();
    if (error) return speak(editor, error.message, true);
    if (!data || !data.length) return speak(editor, "Nothing deleted — only an owner can remove news.", true);
    if (story.image_path) await db.storage.from("news-images").remove([story.image_path]);
    newsDraft = null;
    newsDirty = false;
    editor.classList.add("hidden");
    await loadNews();
    renderNewsAdmin();
    return speak($("newsAdd"), `Deleted "${story.title}".`, false);
  }

  if (act === "news-save") return saveNews();
});
