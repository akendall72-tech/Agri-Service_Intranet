// course-sw.js — serves online course files from Supabase as if they were on
// this website.
//
// A SCORM course talks to the page around it (course.html, which provides
// the SCORM "API" object), and a browser only allows that between pages from
// the same website. The course files live in a private Supabase storage
// bucket, so this worker answers requests for
//
//     /course-files/<course id>/<version>/<file>
//
// by fetching that file from the bucket with the signed-in person's token,
// and handing it back with the right type. It only looks after
// /course-files/ (its scope); nothing else on the site goes through it.
//
// Files are kept in the browser's cache once fetched — a version never
// changes — so resuming a course doesn't download it again. Video and audio
// are asked for in pieces (Range requests), which pass straight through.
//
// The token comes from course.html by message, and is kept in IndexedDB too,
// because the browser stops idle workers and this one starts again empty.

const VERSION = "4";
const CACHE = "course-files-v1";
const PREFIX = new URL("./", self.registration.scope).pathname;   // ".../course-files/"

let auth = null;          // { token, url, key }
const sizes = new Map();  // "<course>/<version>" -> { "index.html": 1234, ... }

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("message", (event) => {
  const msg = event.data || {};
  if (msg.type === "auth" && msg.token) {
    auth = { token: msg.token, url: msg.url, key: msg.key };
    event.waitUntil(store("auth", auth));
  }
  if (msg.type === "sizes" && msg.key && msg.files) sizes.set(msg.key, msg.files);
  if (event.ports && event.ports[0]) event.ports[0].postMessage({ ok: true, version: VERSION });
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith(PREFIX)) return;
  if (event.request.method !== "GET" && event.request.method !== "HEAD") return;
  event.respondWith(serve(event.request, url));
});

async function serve(request, url) {
  const path = decodeURIComponent(url.pathname.slice(PREFIX.length));
  const parts = path.split("/");
  if (parts.length < 3 || parts.some(p => p === ".." || p === "")) return notFound();
  const range = request.headers.get("range");
  const cache = await caches.open(CACHE);

  // A whole file already fetched.
  const cached = await cache.match(url.pathname);
  if (cached) return range ? slice(cached, range, type(path)) : cached;

  let upstream = await fromBucket(path, range, false);
  if (upstream && (upstream.status === 400 || upstream.status === 401 || upstream.status === 403)) {
    // An expired token: ask the player for a fresh one, once.
    upstream = await fromBucket(path, range, true);
  }
  if (upstream === "no-auth") return new Response("Sign in again to open this course.", { status: 401 });
  if (!upstream) return new Response("No connection.", { status: 503 });
  if (!upstream.ok) return notFound();

  const headers = new Headers({ "Content-Type": type(path), "Cache-Control": "private, max-age=31536000, immutable" });
  for (const h of ["content-length", "etag", "last-modified"]) {
    const v = upstream.headers.get(h);
    if (v) headers.set(h, v);
  }
  headers.set("Accept-Ranges", "bytes");
  if (upstream.status === 206) {
    // The storage service may not let a page read Content-Range, so it's
    // worked out from the piece asked for and the file's size.
    const given = upstream.headers.get("content-range");
    const length = Number(upstream.headers.get("content-length"));
    const total = sizeOf(parts) || (given && Number(given.split("/")[1])) || null;
    const start = Number((/bytes=(\d+)-/.exec(range) || [])[1] || 0);
    headers.set("Content-Range", given || `bytes ${start}-${start + length - 1}/${total ?? "*"}`);
    return new Response(upstream.body, { status: 206, headers });
  }
  // A piece was asked for and the whole file came back: cut the piece here.
  // Safari won't play a video otherwise.
  if (range) return slice(new Response(await upstream.blob()), range, type(path));
  const response = new Response(upstream.body, { status: 200, headers });
  // Keep whole files for next time; not the long videos, which come in pieces.
  if (!range && !/\.(mp4|m4v|mov|webm)$/i.test(path)) {
    cache.put(url.pathname, response.clone()).catch(() => {});
  }
  return response;
}

// A course asks for a hundred files at once when it starts. They're fetched
// eight at a time, and one that fails on the way (a dropped connection) is
// tried twice more before it's given up on.
let running = 0;
const queue = [];
async function slot(task) {
  if (running >= 8) await new Promise((resolve) => queue.push(resolve));
  running++;
  try { return await task(); } finally { running--; const next = queue.shift(); if (next) next(); }
}

async function fromBucket(path, range, fresh) {
  let a = fresh ? await askPlayer() : (auth || await load("auth") || await askPlayer());
  if (!a) return "no-auth";
  auth = a;
  const headers = { Authorization: `Bearer ${a.token}`, apikey: a.key };
  if (range) headers.Range = range;
  const target = `${a.url}/storage/v1/object/authenticated/online-courses/${path.split("/").map(encodeURIComponent).join("/")}`;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await slot(() => fetch(target, { headers }));
      if (response.status < 500) return response;
    } catch (e) { /* tried again below */ }
    await new Promise((r) => setTimeout(r, 400 * (attempt + 1) * (attempt + 1)));
  }
  return null;
}

// The open course.html page has the current token.
async function askPlayer() {
  const pages = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  for (const page of pages) {
    if (!/course\.html/.test(page.url)) continue;
    const answer = await new Promise((resolve) => {
      const channel = new MessageChannel();
      const timer = setTimeout(() => resolve(null), 4000);
      channel.port1.onmessage = (e) => { clearTimeout(timer); resolve(e.data); };
      page.postMessage({ type: "need-auth" }, [channel.port2]);
    });
    if (answer && answer.token) {
      await store("auth", answer);
      return answer;
    }
  }
  return null;
}

function sizeOf(parts) {
  const files = sizes.get(`${parts[0]}/${parts[1]}`);
  return files ? files[parts.slice(2).join("/")] : null;
}

// A piece of a file already in the cache.
async function slice(response, range, contentType) {
  const blob = await response.blob();
  const m = /bytes=(\d*)-(\d*)/.exec(range) || [];
  let start = m[1] === "" || m[1] === undefined ? null : Number(m[1]);
  let end = m[2] === "" || m[2] === undefined ? null : Number(m[2]);
  if (start === null) { start = Math.max(0, blob.size - (end || 0)); end = blob.size - 1; }
  if (end === null || end >= blob.size) end = blob.size - 1;
  return new Response(blob.slice(start, end + 1), { status: 206, headers: {
    "Content-Type": contentType, "Content-Range": `bytes ${start}-${end}/${blob.size}`,
    "Content-Length": String(end - start + 1), "Accept-Ranges": "bytes" } });
}

function notFound() { return new Response("Not found", { status: 404 }); }

const TYPES = {
  html: "text/html; charset=utf-8", htm: "text/html; charset=utf-8", js: "text/javascript", mjs: "text/javascript",
  css: "text/css", json: "application/json", xml: "application/xml", xsd: "application/xml", txt: "text/plain; charset=utf-8",
  svg: "image/svg+xml", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", ico: "image/x-icon",
  mp3: "audio/mpeg", m4a: "audio/mp4", wav: "audio/wav", ogg: "audio/ogg", mp4: "video/mp4", m4v: "video/mp4", webm: "video/webm",
  woff: "font/woff", woff2: "font/woff2", ttf: "font/ttf", otf: "font/otf", eot: "application/vnd.ms-fontobject",
  vtt: "text/vtt", pdf: "application/pdf", swf: "application/x-shockwave-flash", br: "application/octet-stream"
};
function type(path) {
  const ext = (/\.([a-z0-9]+)$/i.exec(path) || [])[1];
  return TYPES[(ext || "").toLowerCase()] || "application/octet-stream";
}

// ---- a little IndexedDB, for the token across restarts ----
function db() {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open("course-sw", 1);
    open.onupgradeneeded = () => open.result.createObjectStore("kv");
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error);
  });
}
async function store(key, value) {
  try { const d = await db(); await new Promise((r) => { const t = d.transaction("kv", "readwrite"); t.objectStore("kv").put(value, key); t.oncomplete = r; t.onerror = r; }); } catch (e) {}
}
async function load(key) {
  try { const d = await db(); return await new Promise((r) => { const q = d.transaction("kv").objectStore("kv").get(key); q.onsuccess = () => r(q.result || null); q.onerror = () => r(null); }); } catch (e) { return null; }
}
