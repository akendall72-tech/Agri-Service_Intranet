// Training articles
//
// The Training Center's written pages, and writing them.

// ---------------------------------------------------------------- training articles
//
// The Training Center's articles (migration 0036). Each is stored as HTML and
// laid out by articles/article-styles.css — the same stylesheet the app ships —
// so what's edited here looks the way phones show it.
//
// An article is always shown inside a sandboxed frame that can't run scripts,
// and what's saved is cleaned to a list of allowed tags first, so a page can
// only ever be text and layout, wherever it's shown.

let trainingArticles = [];
let articlesError = null;
let openArticleId = null;
let editingArticleId = null;      // null while writing a new one
let articleHtmlMode = false;
let articleDirty = false;

async function loadArticles() {
  const [{ data, error }] = await Promise.all([
    db.from("training_articles").select("*").order("sort_order"),
    loadArticleStyles()
  ]);
  articlesError = error ? error.message : null;
  trainingArticles = data || [];
}

// The article stylesheet's text, put inside each article page the way the app
// does it, rather than linked. Linked, the frame had to load it itself, and on
// some browsers it never arrived: the article showed as bare text with its
// icons blown up to fill the page. Read here, by the page, the frame needs
// nothing from the network at all. If this read fails, the link is the
// fallback.
let articleCss = "";
async function loadArticleStyles() {
  if (articleCss) return;
  try {
    const response = await fetch("articles/article-styles.css");
    if (response.ok) articleCss = (await response.text()).replace(/<\/style/gi, "<\\/style");
  } catch { /* the link below stands in */ }
}

const ARTICLE_TAGS = new Set(["p", "h2", "h3", "h4", "ul", "ol", "li", "strong", "b", "em", "i",
  "u", "a", "br", "hr", "div", "span", "section", "article", "blockquote", "small", "sup", "sub",
  "table", "thead", "tbody", "tr", "th", "td", "details", "summary", "img",
  "svg", "path", "circle", "rect", "line", "polyline", "polygon", "g"]);
// Removed with everything inside them, rather than just unwrapped.
const ARTICLE_DROP = new Set(["script", "style", "iframe", "object", "embed", "link", "meta",
  "base", "form", "input", "button", "textarea", "select", "template", "noscript", "frame",
  "frameset", "audio", "video", "canvas", "math", "foreignobject"]);
const ARTICLE_ATTRS = new Set(["class", "href", "title", "aria-label", "colspan", "rowspan",
  "style", "open", "src", "alt", "width", "height", "viewbox", "fill", "stroke", "stroke-width",
  "stroke-linecap", "stroke-linejoin", "d", "cx", "cy", "r", "x", "y", "x1", "y1", "x2", "y2",
  "rx", "ry", "points", "transform"]);

// Keeps only the tags and attributes an article needs. Parsed with DOMParser,
// which never runs scripts or loads images, so nothing in the text can act
// while it's being checked.
function cleanArticleHtml(html) {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  const walk = (node) => {
    [...node.childNodes].forEach(child => {
      if (child.nodeType === Node.COMMENT_NODE) return child.remove();
      if (child.nodeType !== Node.ELEMENT_NODE) return;
      const tag = child.localName.toLowerCase();
      if (ARTICLE_DROP.has(tag)) return child.remove();
      walk(child);
      if (!ARTICLE_TAGS.has(tag)) return child.replaceWith(...child.childNodes);
      [...child.attributes].forEach(attr => {
        const name = attr.name.toLowerCase();
        const value = attr.value.trim();
        const ok = ARTICLE_ATTRS.has(name)
          && !(name === "href" && !/^(https?:|mailto:|tel:|#)/i.test(value))
          && !(name === "src" && !/^(https:|data:image\/(png|jpe?g|gif|webp);base64,)/i.test(value))
          && !(name === "style" && /url\s*\(|expression|javascript:|@import|behavior/i.test(value));
        if (!ok) child.removeAttribute(attr.name);
      });
      if (tag === "img" && !child.hasAttribute("src")) return child.remove();
      if (tag === "a" && child.hasAttribute("href")) {
        child.setAttribute("target", "_blank");
        child.setAttribute("rel", "noopener noreferrer");
      }
    });
  };
  walk(doc.body);
  return doc.body.innerHTML.trim();
}

// The page shown in a frame: the stylesheet, the title block and the article.
// editable puts the article (not the title block) into editing mode.
function articleDocument(article, { editable = false } = {}) {
  const green = article.accent === "green";
  const heroBlock = `<article class="article-hero">
  <span class="kicker${green ? " green" : ""}">${esc(article.kicker)}</span>
  <h1>${esc(article.title)}</h1>
  <div class="byline"><span class="avatar"${green ? ' style="background:var(--green-dark)"' : ""}>AS</span>
    <span>Agri-Service Training Department</span></div>
</article>`;
  const body = cleanArticleHtml(article.body || "");
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'self' 'unsafe-inline'; img-src https: data:">
${articleCss ? `<style>${articleCss}</style>` : `<link rel="stylesheet" href="articles/article-styles.css">`}
<style>body{padding-bottom:28px} :where(svg:not([width])){width:24px;height:24px}
main[contenteditable]{outline:none;min-height:240px}
main[contenteditable]:empty::before{content:"Start typing the article…";color:#aaa}</style>
</head><body>
${editable ? `<div class="container">${heroBlock}</div>
<main class="container" contenteditable="true">${body}</main>`
  : `<main class="container">${heroBlock}
${body}</main>`}
</body></html>`;
}

// ---- reading (the Training Center on this page) -----------------------------------

function articleCards() {
  const live = trainingArticles.filter(a => a.is_active);
  if (!live.length) return "";
  return `<div class="section-title" style="margin-top:22px">Read up</div>` + linkGrid(live.map(a => `
    <button type="button" class="link-card article-card" data-view="article" data-article="${esc(a.id)}"
            style="width:100%;text-align:left;font:inherit;color:inherit;cursor:pointer">
      <span class="well ${a.accent === "green" ? "green" : "red"}">${icon("doc")}</span>
      <span><span class="kick${a.accent === "green" ? " green" : ""}">${esc(a.kicker)}</span>
        <b>${esc(a.title)}</b>
        ${a.summary ? `<span>${esc(a.summary)}</span>` : ""}
        <span class="go">Read the article &rarr;</span></span>
    </button>`).join(""));
}

function articleView() {
  const article = trainingArticles.find(a => a.id === openArticleId);
  if (!article) return `<p class="note">That article isn't available.</p>`;
  setTimeout(() => {
    const frame = $("articleReadFrame");
    if (!frame) return;
    frame.onload = () => fitArticleFrame(frame);
    frame.srcdoc = articleDocument(article);
  });
  return hero(pageTitle("article"))
    + `<iframe id="articleReadFrame" class="article-frame" title="${esc(article.title)}"
    sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"></iframe>`;
}

// A reading frame is as tall as its page, so the page scrolls rather than the
// frame. Measured from the body: a decorative shape in the stylesheet is sized
// from the frame's height, so the whole document grows as the frame does.
//
// Measured again whenever the article changes size, not once: opening one of
// the Syllabus's sections, or a picture arriving late, made the article taller
// than its frame, and with the frame's own scrolling off, the bottom of it was
// cut off with no way to reach it.
function fitArticleFrame(frame) {
  const doc = frame.contentDocument;
  if (!doc || !doc.body) return;
  const fit = () => {
    doc.documentElement.style.overflow = "hidden";
    frame.style.height = doc.body.scrollHeight + 2 + "px";
  };
  fit();
  if (frame.articleWatch) frame.articleWatch.disconnect();
  frame.articleWatch = new ResizeObserver(fit);
  frame.articleWatch.observe(doc.body);
  // A section opening is also caught straight away, without waiting for the
  // next redraw. The page is the same one each time, so this is added once.
  if (!doc.articleToggleWatched) {
    doc.articleToggleWatched = true;
    doc.addEventListener("toggle", fit, true);
  }
}

window.addEventListener("resize", () => {
  const frame = $("articleReadFrame");
  if (frame) fitArticleFrame(frame);
});

// ---- admin ------------------------------------------------------------------------

function renderArticlesAdmin() {
  const list = $("articleList");
  if (!list) return;
  if (articlesError) {
    list.innerHTML = `<p class="error">${/does not exist|schema cache/i.test(articlesError)
      ? "Run migration 0036_training_articles.sql in the SQL editor, then reload this page."
      : esc(articlesError)}</p>`;
    return;
  }
  list.innerHTML = trainingArticles.length ? trainingArticles.map(a => `
    <div class="role" style="padding:12px 16px${a.is_active ? "" : ";opacity:.6"}" data-article-row="${esc(a.id)}">
      <div class="row" style="align-items:flex-start">
        <div style="flex:1;min-width:220px">
          <div class="note" style="text-transform:uppercase;letter-spacing:.06em;font-weight:600;
               color:${a.accent === "green" ? "var(--green)" : "var(--red)"}">${esc(a.kicker)}</div>
          <b>${esc(a.title)}</b>${a.is_active ? "" : ` <span class="badge b-none">Not showing</span>`}
          <div class="note">Order ${esc(a.sort_order)}${a.updated_at
            ? " · changed " + esc(new Date(a.updated_at).toLocaleDateString()) : ""}</div>
        </div>
        <button class="pdf" data-act="edit-article">Edit</button>
      </div>
    </div>`).join("") : `<p class="note">No articles yet.</p>`;
}

function articleEditorFields() {
  const editor = $("articleEditor");
  const get = (f) => editor.querySelector(`[data-a="${f}"]`).value.trim();
  return {
    kicker: get("kicker"), title: get("title"), summary: get("summary"),
    accent: get("accent") === "green" ? "green" : "red",
    sort_order: parseInt(get("sort_order"), 10) || 0,
    is_active: get("is_active") === "yes"
  };
}

function articleEditorBody() {
  if (articleHtmlMode) return $("articleHtml").value;
  const doc = $("articleEditorFrame").contentDocument;
  const main = doc && doc.querySelector("main");
  return main ? main.innerHTML : "";
}

// Draws the frame again from the fields and the body, keeping edits.
function loadArticleEditorFrame(body) {
  const frame = $("articleEditorFrame");
  frame.onload = () => {
    const doc = frame.contentDocument;
    if (!doc) return;
    try { doc.execCommand("defaultParagraphSeparator", false, "p"); } catch { /* older browsers */ }
    doc.addEventListener("input", () => { articleDirty = true; });
    // Links in the editor are for editing, not following.
    doc.addEventListener("click", (e) => { if (e.target.closest("a")) e.preventDefault(); });
  };
  frame.srcdoc = articleDocument({ ...articleEditorFields(), body }, { editable: true });
}

function openArticleEditor(article) {
  const editor = $("articleEditor");
  const set = (f, v) => { editor.querySelector(`[data-a="${f}"]`).value = v ?? ""; };
  editingArticleId = article ? article.id : null;
  set("kicker", article ? article.kicker : "");
  set("title", article ? article.title : "");
  set("summary", article ? article.summary : "");
  set("accent", article ? article.accent : "red");
  set("sort_order", article ? article.sort_order
    : trainingArticles.reduce((m, a) => Math.max(m, a.sort_order || 0), 0) + 10);
  set("is_active", !article || article.is_active ? "yes" : "no");

  setArticleHtmlMode(false);
  loadArticleEditorFrame(article ? article.body : "<div class=\"prose\">\n  <p></p>\n</div>");
  articleDirty = false;

  $("articleEditorTitle").textContent = article ? "Edit article" : "New article";
  editor.querySelector('[data-act="delete-article"]').classList.toggle("hidden", !article);
  editor.classList.remove("hidden");
  speak(editor, "", false);
  editor.scrollIntoView({ behavior: "smooth", block: "start" });
}

function setArticleHtmlMode(on) {
  const frame = $("articleEditorFrame");
  const area = $("articleHtml");
  if (on && !articleHtmlMode) {
    area.value = prettyArticleHtml(cleanArticleHtml(articleEditorBody()));
  } else if (!on && articleHtmlMode) {
    loadArticleEditorFrame(area.value);
  }
  articleHtmlMode = on;
  frame.classList.toggle("hidden", on);
  area.classList.toggle("hidden", !on);
  $("articleHtmlToggle").textContent = on ? "Back to the page" : "HTML";
  document.querySelectorAll("#articleTools [data-fmt]").forEach(b => {
    if (b.dataset.fmt !== "html") b.disabled = on;
  });
}

// Puts block tags on their own lines so the code is readable to edit.
function prettyArticleHtml(html) {
  return html.replace(/\s*(<\/?(div|section|article|ul|ol|li|h2|h3|h4|p|details|summary|table|tr|thead|tbody)\b[^>]*>)/gi, "\n$1")
    .replace(/\n{2,}/g, "\n").trim();
}

function articleSlug(title) {
  const base = slugify(title, "-") || "article";
  let id = /^[a-z0-9]/.test(base) ? base : "a-" + base;
  for (let n = 2; trainingArticles.some(a => a.id === id); n++) id = `${base}-${n}`;
  return id;
}

$("articleTools").addEventListener("click", (event) => {
  const button = event.target.closest("[data-fmt]");
  if (!button) return;
  const fmt = button.dataset.fmt;
  if (fmt === "html") return setArticleHtmlMode(!articleHtmlMode);

  const frame = $("articleEditorFrame");
  const doc = frame.contentDocument;
  if (!doc) return;
  frame.contentWindow.focus();

  if (["h2", "h3", "p"].includes(fmt)) {
    doc.execCommand("formatBlock", false, `<${fmt}>`);
  } else if (fmt === "link") {
    const url = window.prompt("Link to (a web address, email or phone number):", "https://");
    if (!url) return;
    const href = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(url.trim()) ? "mailto:" + url.trim()
      : /^\+?[\d\s().-]{7,}$/.test(url.trim()) ? "tel:" + url.replace(/[^\d+]/g, "") : url.trim();
    if (!/^(https?:\/\/|mailto:|tel:)/i.test(href)) return alert("That link needs to start with https://");
    doc.execCommand("createLink", false, href);
  } else {
    doc.execCommand(fmt, false, null);
  }
  articleDirty = true;
});

// The title block in the editor follows the fields as they're typed.
$("articleEditor").addEventListener("input", (event) => {
  if (!event.target.matches("[data-a]")) return;
  articleDirty = true;
  if (articleHtmlMode) return;
  const doc = $("articleEditorFrame").contentDocument;
  const hero = doc && doc.querySelector(".article-hero");
  if (!hero) return;
  const f = articleEditorFields();
  hero.querySelector(".kicker").textContent = f.kicker;
  hero.querySelector(".kicker").classList.toggle("green", f.accent === "green");
  hero.querySelector("h1").textContent = f.title;
  hero.querySelector(".avatar").style.background = f.accent === "green" ? "var(--green-dark)" : "";
});
$("articleEditor").addEventListener("change", (event) => {
  if (event.target.matches('[data-a="accent"]')) event.target.dispatchEvent(new Event("input", { bubbles: true }));
});

$("admin").addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-act]");
  if (!button) return;
  const act = button.dataset.act;
  if (!["new-article", "edit-article", "cancel-article", "save-article", "delete-article"].includes(act)) return;
  const editor = $("articleEditor");

  if (act === "new-article" || act === "edit-article") {
    if (articleDirty && !editor.classList.contains("hidden")
        && !confirm("Leave the article you're editing? Changes you haven't saved will be lost.")) return;
    const row = button.closest("[data-article-row]");
    return openArticleEditor(row ? trainingArticles.find(a => a.id === row.dataset.articleRow) : null);
  }

  if (act === "cancel-article") {
    if (articleDirty && !confirm("Throw away the changes to this article?")) return;
    articleDirty = false;
    editor.classList.add("hidden");
    return;
  }

  if (act === "delete-article") {
    const article = trainingArticles.find(a => a.id === editingArticleId);
    if (!article || !confirm(`Delete "${article.title}"? It comes off the Training Center everywhere.`)) return;
    const { data, error } = await db.from("training_articles").delete().eq("id", article.id).select();
    if (error) return speak(editor, error.message, true);
    if (!data || !data.length) return speak(editor, "Nothing deleted — only an owner can remove articles.", true);
    articleDirty = false;
    editor.classList.add("hidden");
    await loadArticles();
    return renderArticlesAdmin();
  }

  // save-article
  const fields = articleEditorFields();
  if (!fields.title) return speak(editor, "The article needs a title.", true);
  const body = cleanArticleHtml(articleEditorBody());
  if (!body.replace(/<[^>]*>/g, "").trim()) return speak(editor, "The article is empty.", true);
  if (body.length > 200000) return speak(editor, "That article is too long to save.", true);

  const row = { ...fields, body };
  speak(editor, "Saving…", false);
  const query = editingArticleId
    ? db.from("training_articles").update(row).eq("id", editingArticleId).select()
    : db.from("training_articles").insert({ id: articleSlug(fields.title), ...row }).select();
  const { data, error } = await query;
  if (error) return speak(editor, error.message, true);
  if (!data || !data.length) return speak(editor, "Nothing saved — only an owner can change articles.", true);

  editingArticleId = data[0].id;
  articleDirty = false;
  await loadArticles();
  renderArticlesAdmin();
  $("articleEditorTitle").textContent = "Edit article";
  editor.querySelector('[data-act="delete-article"]').classList.remove("hidden");
  // Show what was actually saved, after cleaning.
  if (articleHtmlMode) $("articleHtml").value = prettyArticleHtml(body);
  else loadArticleEditorFrame(body);
  speak(editor, fields.is_active
    ? "Saved. Phones show it the next time the Training Center is opened."
    : "Saved — hidden, so it isn't showing anywhere.", false);
});
