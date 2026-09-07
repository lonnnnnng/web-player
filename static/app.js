/* 本地视频播放器 - 前端逻辑（无任何外部依赖） */
"use strict";

const $ = (sel) => document.querySelector(sel);
const browsePage = $("#browse-page");
const playerPage = $("#player-page");
const { srtToVtt, createSafeStorage } = window.PlayerUtils;
const storage = createSafeStorage(() => window.localStorage);

/* ---------------- 工具函数 ---------------- */

function formatSize(bytes) {
  if (bytes >= 1073741824) return (bytes / 1073741824).toFixed(2) + " GB";
  if (bytes >= 1048576) return (bytes / 1048576).toFixed(1) + " MB";
  if (bytes >= 1024) return (bytes / 1024).toFixed(1) + " KB";
  return bytes + " B";
}

function formatDuration(sec) {
  if (!isFinite(sec) || sec <= 0) return "";
  sec = Math.round(sec);
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  const mm = h > 0 ? String(m).padStart(2, "0") : m;
  return (h > 0 ? h + ":" : "") + mm + ":" + String(s).padStart(2, "0");
}

function encodePath(p) {
  // 按路径段编码，保留 /
  return p.split("/").map(encodeURIComponent).join("/");
}

function makeCardInteractive(card, handler) {
  // long: 文件卡片原本只有鼠标 click，补上键盘语义后，移动端键盘和无障碍阅读器也能打开资源。
  card.setAttribute("role", "button");
  card.tabIndex = 0;
  card.addEventListener("click", handler);
  card.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      handler();
    }
  });
}

const DIR_SVG = '<svg viewBox="0 0 24 24" fill="none"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" fill="#4a7bd4"/><path d="M3 10h18v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-8z" fill="#5a8de0"/></svg>';

const VIDEO_SVG = '<svg viewBox="0 0 24 24" fill="none"><rect x="2" y="4" width="20" height="16" rx="3" fill="#6c5ce7"/><path d="M10 9l6 3-6 3V9z" fill="#fff"/></svg>';

const AUDIO_SVG = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M9 18.5a2.5 2.5 0 1 1-2-2.45V6.2a1 1 0 0 1 .76-.97l8.5-2.1A1 1 0 0 1 17.5 4.1v10.95a2.5 2.5 0 1 1-2-2.45V6.53l-6.5 1.6v10.37z"/></svg>';

// 与服务端 AUDIO_EXTS 保持一致
const AUDIO_EXTS_JS = ["mp3", "m4a", "aac", "flac", "wav", "ogg", "opus"];

// 浏览器普遍无法直接解码的视频格式（列表页打"不支持"角标，点击仍可尝试）
const UNPLAYABLE_EXTS = ["avi", "flv", "wmv", "mpg", "mpeg", "ts", "mts", "m2ts", "3gp"];

function isAudioFile(name) {
  const ext = name.split(".").pop().toLowerCase();
  return AUDIO_EXTS_JS.includes(ext);
}

/* ---------------- 路由 ---------------- */

function navigate(hash) { location.hash = hash; }

function parseRoute() {
  // #/  -> 浏览根目录; #/子/目录 -> 浏览; #/watch/路径 -> 播放
  let h;
  try {
    h = decodeURIComponent(location.hash.replace(/^#/, "")) || "/";
  } catch {
    // long: 手工粘贴或外部链接里的损坏百分号不能让整个单页应用停止渲染，回到安全根目录。
    h = "/";
  }
  h = h.replace(/\/+$/, "") || "/";
  if (h.startsWith("/watch/")) {
    return { page: "watch", path: h.slice("/watch/".length) };
  }
  return { page: "browse", path: h === "/" ? "" : h.slice(1) };
}

// hashchange 监听在"浏览页"区（离开目录时需先记录滚动位置）

/* ---------------- 浏览页 ---------------- */

let currentListing = null;   // 仅供浏览页使用，不能覆盖播放页的同目录队列
let playerListing = null;
let currentPath = "";
let searchActive = false;    // 当前展示的是搜索结果还是目录列表
let searchSeq = 0;           // 搜索请求序号，丢弃过期响应

/* ---------------- 缩略图与时长探测（懒加载 + localStorage 缓存） ---------------- */

function thumbKey(path) { return "vp-thumb:" + path; }

const thumbProbing = new Set();   // 正在探测的 path，避免重复

function readThumbCache(path, mtime, size) {
  try {
    const c = JSON.parse(storage.getItem(thumbKey(path)));
    if (c && c.m === mtime && c.s === size) return c;
    if (c) storage.removeItem(thumbKey(path));   // 文件已变，缓存作废
  } catch { /* 忽略坏缓存 */ }
  return null;
}

function writeThumbCache(path, mtime, size, rec) {
  const payload = JSON.stringify(Object.assign({ m: mtime, s: size, at: Date.now() }, rec));
  storage.setItem(thumbKey(path), payload);
  evictThumbCache();
}

function evictThumbCache() {
  const entries = [];
  for (const k of storage.keys()) {
    if (!k || !k.startsWith("vp-thumb:")) continue;
    let at = 0;
    const raw = storage.getItem(k) || "";
    try { at = Number(JSON.parse(raw).at) || 0; } catch { /* 忽略 */ }
    entries.push([k, at, raw.length]);
  }
  entries.sort((a, b) => a[1] - b[1]);
  let chars = entries.reduce((sum, entry) => sum + entry[2], 0);
  // long: 缩略图是可重建数据，限制 40 条/约 2 MB，给手机上的播放记录和重试队列预留配额。
  while (entries.length && (entries.length > 40 || chars > 1000000)) {
    const [key, , size] = entries.shift();
    storage.removeItem(key);
    chars -= size;
  }
}

function applyThumbImage(thumbEl, dataUrl) {
  thumbEl.classList.add("has-thumb");
  thumbEl.style.backgroundImage = `url("${dataUrl}")`;
}

const durationObserver = new IntersectionObserver((entries) => {
  for (const en of entries) {
    if (!en.isIntersecting) continue;
    durationObserver.unobserve(en.target);
    probeCardMedia(en.target);
  }
}, { rootMargin: "120px" });

// 探测时长（音频/视频通用）；视频顺带在 10% 处截一帧做缩略图
function probeCardMedia(thumbEl) {
  const path = thumbEl.dataset.path;
  if (!path || thumbProbing.has(path)) return;
  thumbProbing.add(path);
  const isAudio = thumbEl.dataset.kind === "audio";
  const mtime = Number(thumbEl.dataset.mtime) || 0;
  const size = Number(thumbEl.dataset.size) || 0;
  const badge = thumbEl.querySelector(".thumb-badge");

  const probe = document.createElement("video");
  probe.preload = "metadata";
  probe.muted = true;
  let settled = false;
  const timer = setTimeout(() => finish(null, null), 6000);

  const finish = (duration, dataUrl) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    if (duration && badge) badge.textContent = formatDuration(duration);
    if (dataUrl) {
      // 应用到所有同路径的缩略图容器（可能同时存在列表页和搜索结果）
      document.querySelectorAll(`.file-thumb[data-path="${CSS.escape(path)}"]`)
        .forEach(el => applyThumbImage(el, dataUrl));
    }
    if (duration || dataUrl) writeThumbCache(path, mtime, size, { d: duration, u: dataUrl });
    thumbProbing.delete(path);
    probe.onloadedmetadata = probe.onseeked = probe.onerror = null;
    probe.removeAttribute("src");
    probe.load();
  };

  probe.onerror = () => finish(null, null);
  probe.onloadedmetadata = () => {
    const d = probe.duration;
    if (!isFinite(d) || d <= 0) { finish(null, null); return; }
    if (badge) badge.textContent = formatDuration(d);
    if (isAudio) { finish(d, null); return; }
    // 截帧位置：10% 处（极短视频取 0.1s，避免黑屏首帧）
    probe.currentTime = Math.min(Math.max(d * 0.1, 0.1), Math.max(d - 0.1, 0.1));
    probe.onseeked = () => {
      try {
        const canvas = document.createElement("canvas");
        const w = 320;
        const h = Math.max(60, Math.round(w * (probe.videoHeight || 180) / (probe.videoWidth || 320)));
        canvas.width = w;
        canvas.height = h;
        canvas.getContext("2d").drawImage(probe, 0, 0, w, h);
        finish(d, canvas.toDataURL("image/jpeg", 0.6));
      } catch { finish(d, null); }
    };
  };
  probe.src = "/api/file?path=" + encodeURIComponent(path);
}

const listingCache = new Map();    // path -> {data, json}，返回目录时秒开
const scrollPositions = new Map(); // path -> 滚动位置
let lastBrowsePath = null;         // 离开浏览页时用于记录滚动位置
let browseSeq = 0;                 // 目录请求序号，丢弃过期响应

window.addEventListener("hashchange", () => {
  // 离开当前目录时记住滚动位置（此时浏览页尚未切换）
  if (!browsePage.classList.contains("hidden") && lastBrowsePath !== null) {
    scrollPositions.set(lastBrowsePath, window.scrollY);
  }
  render();
});

async function renderBrowse(relPath) {
  currentPath = relPath;
  currentListing = null;
  lastBrowsePath = relPath;
  searchActive = false;
  searchSeq++;               // 作废在途搜索响应
  $("#search-box").value = "";
  const seq = ++browseSeq;

  const cached = listingCache.get(relPath);
  if (cached) {
    applyListing(cached.data, relPath);
    refreshListing(relPath, seq);   // 后台刷新，数据有变才重绘
    return;
  }
  await fetchAndApplyListing(relPath, seq);
}

async function fetchAndApplyListing(relPath, seq) {
  let data;
  try {
    const res = await fetch("/api/list?path=" + encodeURIComponent(relPath));
    data = await res.json();
    if (data.error) throw new Error(data.error);
  } catch (e) {
    if (seq === browseSeq) {
      $("#file-grid").innerHTML = "";
      showEmpty("加载失败：" + e.message);
    }
    return;
  }
  if (seq !== browseSeq) return;
  applyListing(data, relPath, true);
}

// 后台重新拉取目录，内容有变化时才重绘（避免多余的时间探测）
async function refreshListing(relPath, seq) {
  try {
    const res = await fetch("/api/list?path=" + encodeURIComponent(relPath));
    const data = await res.json();
    if (data.error || seq !== browseSeq) return;
    const json = JSON.stringify(data);
    const cached = listingCache.get(relPath);
    if (cached && json === cached.json) return;
    listingCache.set(relPath, { data, json });
    if (currentPath === relPath && !searchActive) applyListing(data, relPath);
  } catch { /* 刷新失败保留缓存 */ }
}

function applyListing(data, relPath, cacheIt) {
  if (parseRoute().page !== "browse" || currentPath !== relPath || searchActive) return;
  currentListing = data;
  const json = JSON.stringify(data);
  const cached = listingCache.get(relPath);
  if (cacheIt || !cached) listingCache.set(relPath, { data, json });
  else cached.data = data, cached.json = json;

  renderBreadcrumb(relPath);
  $("#list-meta").textContent =
    `${data.dirs.length} 个文件夹 · ${data.videos.length} 个视频 · ${(data.audios || []).length} 个音频`;
  renderGrid();
  renderResumeRow();
  const seq = browseSeq;
  requestAnimationFrame(() => {
    if (seq === browseSeq && parseRoute().page === "browse") window.scrollTo(0, scrollPositions.get(relPath) || 0);
  });
}

function renderBreadcrumb(relPath) {
  const bc = $("#breadcrumb");
  bc.innerHTML = "";
  const parts = relPath ? relPath.split("/") : [];
  const rootLink = document.createElement(parts.length ? "a" : "span");
  rootLink.textContent = "🎬 音视频根目录";
  if (parts.length) rootLink.href = "#/";
  else rootLink.className = "current";
  bc.appendChild(rootLink);

  let acc = "";
  parts.forEach((p, i) => {
    acc = acc ? acc + "/" + p : p;
    const sep = document.createElement("span");
    sep.className = "sep"; sep.textContent = "›";
    bc.appendChild(sep);
    const isLast = i === parts.length - 1;
    const el = document.createElement(isLast ? "span" : "a");
    el.textContent = p;
    if (isLast) el.className = "current";
    else el.href = "#/" + encodePath(acc);
    bc.appendChild(el);
  });
}

function showEmpty(text) {
  $("#empty-text").textContent = text;
  $("#empty-tip").classList.remove("hidden");
}

function progressKey(path) { return "vp-progress:" + path; }

// 进度存储 v2：{"t": 已看秒数, "d": 总时长秒数}。兼容 v1（0~1 的比例数字，无绝对时间）。
function readProgress(path) {
  const raw = storage.getItem(progressKey(path));
  if (!raw) return null;
  let v;
  try { v = JSON.parse(raw); } catch { v = Number(raw); }
  if (typeof v === "number") {
    return isFinite(v) && v > 0 && v <= 1 ? { ratio: v, frac: v } : null;
  }
  if (v && typeof v === "object" && isFinite(v.t) && isFinite(v.d) && v.d > 0 && v.t >= 0) {
    return { t: v.t, d: v.d, frac: Math.min(1, v.t / v.d) };
  }
  return null;
}

const progressSync = window.PlayerProgress.createProgressSync({
  storage, fetch: (...args) => fetch(...args),
  beacon: (...args) => navigator.sendBeacon(...args),
  onChange: () => {
    if (parseRoute().page !== "browse") return;
    renderResumeRow();
    if (!searchActive) renderGrid();
  },
});

function writeProgress(path, t, d) {
  if (!isFinite(t) || !isFinite(d) || d <= 0) return;
  progressSync.write(path, t, d);
}

// 清除进度：本地 + 服务端（"从头看"）
function removeProgress(path) {
  if (path === currentWatchPath) progressCleared = true;
  progressSync.remove(path);
}

function progressPct(path) {
  const p = readProgress(path);
  return p ? Math.min(100, Math.round(p.frac * 100)) : 0;
}

function renderGrid() {
  const grid = $("#file-grid");
  grid.innerHTML = "";
  $("#empty-tip").classList.add("hidden");
  durationObserver.disconnect();

  if (!currentListing) return;
  const dirs = currentListing.dirs;
  const videos = currentListing.videos;
  const audios = currentListing.audios || [];

  if (dirs.length === 0 && videos.length === 0 && audios.length === 0) {
    showEmpty("这个目录还没有音视频文件");
    $("#list-meta").textContent = "0 个文件夹 · 0 个视频 · 0 个音频";
    return;
  }

  for (const d of dirs) {
    const card = document.createElement("div");
    card.className = "file-card is-dir";
    card.innerHTML = `
      <div class="file-thumb">${DIR_SVG}</div>
      <div class="file-info">
        <div class="file-name">${escapeHtml(d.name)}</div>
        <div class="file-sub"><span>文件夹</span></div>
      </div>`;
    makeCardInteractive(card, () => navigate("#/" + encodePath(currentPath ? currentPath + "/" + d.name : d.name)));
    grid.appendChild(card);
  }

  for (const v of videos) {
    const vPath = currentPath ? currentPath + "/" + v.name : v.name;
    const pct = progressPct(vPath);
    const unplayable = UNPLAYABLE_EXTS.includes(v.ext.toLowerCase());
    const card = document.createElement("div");
    card.className = "file-card" + (unplayable ? " is-unsupported" : "");
    card.innerHTML = `
      <div class="file-thumb">${VIDEO_SVG}<span class="thumb-badge">${v.ext.toUpperCase()}</span>${unplayable ? '<span class="thumb-flag">不支持</span>' : ""}</div>
      ${pct > 0 ? `<div class="progress-bar"><div style="width:${pct}%"></div></div>` : ""}
      <div class="file-info">
        <div class="file-name">${escapeHtml(v.name)}</div>
        <div class="file-sub"><span>${formatSize(v.size)}</span><span>${new Date(v.mtime * 1000).toLocaleDateString()}</span></div>
      </div>`;
    makeCardInteractive(card, () => navigate("#/watch/" + encodePath(vPath)));
    const thumb = card.querySelector(".file-thumb");
    thumb.dataset.path = vPath;
    thumb.dataset.mtime = v.mtime;
    thumb.dataset.size = v.size;
    const cached = readThumbCache(vPath, v.mtime, v.size);
    if (cached) {
      if (cached.d) thumb.querySelector(".thumb-badge").textContent = formatDuration(cached.d);
      if (cached.u) applyThumbImage(thumb, cached.u);
    }
    if (!cached || !cached.u) durationObserver.observe(thumb);   // 缩略图缺失（含上次截帧失败）则重新探测
    grid.appendChild(card);
  }

  for (const a of audios) {
    const aPath = currentPath ? currentPath + "/" + a.name : a.name;
    const pct = progressPct(aPath);
    const card = document.createElement("div");
    card.className = "file-card is-audio";
    card.innerHTML = `
      <div class="file-thumb">${AUDIO_SVG}<span class="thumb-badge">${a.ext.toUpperCase()}</span></div>
      ${pct > 0 ? `<div class="progress-bar"><div style="width:${pct}%"></div></div>` : ""}
      <div class="file-info">
        <div class="file-name">${escapeHtml(a.name)}</div>
        <div class="file-sub"><span>${formatSize(a.size)}</span><span>${new Date(a.mtime * 1000).toLocaleDateString()}</span></div>
      </div>`;
    makeCardInteractive(card, () => navigate("#/watch/" + encodePath(aPath)));
    const thumb = card.querySelector(".file-thumb");
    thumb.dataset.path = aPath;
    thumb.dataset.mtime = a.mtime;
    thumb.dataset.size = a.size;
    thumb.dataset.kind = "audio";
    const cachedA = readThumbCache(aPath, a.mtime, a.size);
    if (cachedA && cachedA.d) thumb.querySelector(".thumb-badge").textContent = formatDuration(cachedA.d);
    if (!cachedA || !cachedA.d) durationObserver.observe(thumb);
    grid.appendChild(card);
  }

  if (dirs.length + videos.length + audios.length > 0) {
    $("#list-meta").textContent = `${dirs.length} 个文件夹 · ${videos.length} 个视频 · ${audios.length} 个音频`;
  }
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/* ---------------- 继续观看（仅根目录顶部显示） ---------------- */

function renderResumeRow() {
  const sec = $("#resume-row");
  if (!sec) return;
  const wrap = $("#resume-cards");
  wrap.innerHTML = "";
  const items = [];
  for (const k of storage.keys()) {
    if (!k || !k.startsWith("vp-progress:")) continue;
    const path = k.slice("vp-progress:".length);
    const p = readProgress(path);
    if (!p || p.frac <= 0.02 || p.frac >= 0.97) continue;
    let ts = 0;
    try { ts = Number(JSON.parse(storage.getItem(k)).ts) || 0; } catch { /* 忽略 */ }
    items.push({ path, frac: p.frac, ts });
  }
  if (currentPath !== "" || searchActive || items.length === 0) {
    sec.classList.add("hidden");
    return;
  }
  items.sort((a, b) => b.ts - a.ts);
  for (const it of items.slice(0, 8)) {
    const name = it.path.split("/").pop();
    const isAudio = isAudioFile(name);
    const pct = Math.min(100, Math.round(it.frac * 100));
    const card = document.createElement("div");
    card.className = "file-card" + (isAudio ? " is-audio" : "");
    card.innerHTML = `
      <div class="file-thumb">${isAudio ? AUDIO_SVG : VIDEO_SVG}</div>
      <div class="file-info">
        <div class="file-name">${escapeHtml(name)}</div>
        <div class="file-sub"><span>已看 ${pct}%</span></div>
      </div>
      <div class="progress-bar"><div style="width:${pct}%"></div></div>`;
    makeCardInteractive(card, () => navigate("#/watch/" + encodePath(it.path)));
    wrap.appendChild(card);
  }
  sec.classList.remove("hidden");
}

/* ---------------- 全库搜索 ---------------- */

$("#search-box").addEventListener("input", (e) => {
  const kw = e.target.value.trim();
  clearTimeout(runSearch._t);
  runSearch._t = setTimeout(() => runSearch(kw), 250);
});

async function runSearch(kw) {
  if (parseRoute().page !== "browse") return;
  const seq = ++searchSeq;
  browseSeq++; // long: 输入搜索后作废目录刷新，避免较晚返回的目录盖掉搜索结果。
  if (!kw) {
    // long: 即使搜索结果尚未返回也要重取目录，否则被搜索作废的首次目录请求会留下空页面。
    renderBrowse(currentPath);
    return;
  }
  let data;
  try {
    const res = await fetch("/api/search?q=" + encodeURIComponent(kw));
    data = await res.json();
    if (data.error) throw new Error(data.error);
  } catch {
    return; /* 搜索失败保持现状 */
  }
  if (seq !== searchSeq || parseRoute().page !== "browse") return;
  searchActive = true;
  renderSearchResults(data, kw);
}

function renderSearchResults(data, kw) {
  const grid = $("#file-grid");
  grid.innerHTML = "";
  $("#empty-tip").classList.add("hidden");
  durationObserver.disconnect();

  const bc = $("#breadcrumb");
  bc.innerHTML = "";
  const cur = document.createElement("span");
  cur.className = "current";
  cur.textContent = `搜索“${kw}”`;
  bc.appendChild(cur);

  $("#resume-row").classList.add("hidden");

  const results = data.results || [];
  $("#list-meta").textContent =
    `搜索“${kw}”：${results.length} 个结果` + (data.truncated ? "（仅显示前 200 条）" : "");
  if (results.length === 0) {
    showEmpty(`没有匹配“${kw}”的结果`);
    return;
  }

  for (const r of results) {
    const parent = r.path.split("/").slice(0, -1).join("/") || "根目录";
    const isDir = r.type === "dir";
    const isAudio = r.kind === "audio";
    const unplayable = !isDir && !isAudio && UNPLAYABLE_EXTS.includes(r.ext.toLowerCase());
    const pct = (!isDir && r.kind) ? progressPct(r.path) : 0;
    const card = document.createElement("div");
    card.className = "file-card" + (isDir ? " is-dir" : isAudio ? " is-audio" : unplayable ? " is-unsupported" : "");
    card.innerHTML = `
      <div class="file-thumb">${isDir ? DIR_SVG : isAudio ? AUDIO_SVG : VIDEO_SVG}${isDir ? "" : `<span class="thumb-badge">${r.ext.toUpperCase()}</span>`}${unplayable ? '<span class="thumb-flag">不支持</span>' : ""}</div>
      ${pct > 0 ? `<div class="progress-bar"><div style="width:${pct}%"></div></div>` : ""}
      <div class="file-info">
        <div class="file-name">${escapeHtml(r.name)}</div>
        <div class="file-sub"><span>${isDir ? "文件夹" : formatSize(r.size || 0)}</span><span>${escapeHtml(parent)}</span></div>
      </div>`;
    makeCardInteractive(card, () => navigate(isDir ? "#/" + encodePath(r.path) : "#/watch/" + encodePath(r.path)));
    grid.appendChild(card);
  }
}

/* ---------------- 播放页 ---------------- */

const video = $("#video");
const audioCover = $("#audio-cover");
const videoError = $("#video-error");
const resumeToast = $("#resume-toast");
let currentWatchPath = "";
let nextMediaPath = "";      // 同目录下一个媒体路径（连播用），空表示没有
let subtitleUrls = [];       // 已创建的字幕 Blob URL，切换视频时释放
let saveTimer = null;
let resumeTimer = null;
let resumeState = null;   // 恢复提示当前对应的进度 {path, p}
let pendingSeek = null;   // 已点"继续播放"但元数据未就绪，等 loadedmetadata 后跳转
let watchRequestSeq = 0;  // 播放页异步请求代次，快速换集时丢弃旧结果
let progressCleared = false;

function isCurrentWatch(requestSeq, vPath) {
  return requestSeq === watchRequestSeq && currentWatchPath === vPath;
}

function hideResumeToast() {
  clearTimeout(resumeTimer);
  resumeTimer = null;
  resumeState = null;
  resumeToast.classList.add("hidden");
}

// 立即保存当前视频进度；须在 currentWatchPath 被覆盖前调用
function flushProgress() {
  clearTimeout(saveTimer);
  saveTimer = null;
  if (!currentWatchPath || !isFinite(video.duration) || video.duration <= 0) return;
  if (video.dataset.watchPath !== currentWatchPath || video.readyState < 1 || video.currentSrc !== video.src) return;
  if (video.ended || video.error) return;
  // long: 从头看后尚未重新播放就离页时，保留删除版本；只有时间真正前进才建立新进度。
  if (progressCleared && video.currentTime === 0) return;
  progressCleared = false;
  writeProgress(currentWatchPath, video.currentTime, video.duration);
}

async function renderWatch(vPath) {
  const requestSeq = ++watchRequestSeq;
  hideResumeToast();
  pendingSeek = null;
  videoError.classList.add("hidden");
  nextMediaPath = "";
  $("#btn-next").classList.add("hidden");
  subtitleUrls.forEach(u => URL.revokeObjectURL(u));
  subtitleUrls = [];

  const name = vPath.split("/").pop();
  const isAudio = isAudioFile(name);
  $("#player-title").textContent = name;
  audioCover.classList.toggle("hidden", !isAudio);
  video.classList.toggle("is-audio", isAudio);
  video.dataset.watchPath = vPath;
  $("#audio-title").textContent = name;
  audioCover.classList.remove("playing");

  // 清理旧的字幕轨道
  video.querySelectorAll("track").forEach(t => t.remove());
  video.removeAttribute("src");
  video.load();

  video.src = "/api/file?path=" + encodeURIComponent(vPath);
  video.playbackRate = Number($("#speed-select").value) || 1;

  restoreProgress(vPath);
  const listing = await loadSiblingListing(vPath);
  // long: 视频 A 的目录/字幕请求可能晚于视频 B 返回；只有当前代次才能修改全局列表、字幕和连播状态。
  if (!isCurrentWatch(requestSeq, vPath)) return;
  playerListing = listing;
  if (!isAudio) await attachSubtitle(vPath, listing, requestSeq);
  if (!isCurrentWatch(requestSeq, vPath)) return;
  nextMediaPath = findNextMedia(vPath, isAudio) || "";
  $("#btn-next").classList.toggle("hidden", !nextMediaPath);
  updateMediaSession(vPath);
}

// 拉取同目录列表，供字幕匹配与连播使用
async function loadSiblingListing(vPath) {
  const dir = vPath.split("/").slice(0, -1).join("/");
  try {
    const res = await fetch("/api/list?path=" + encodeURIComponent(dir));
    if (!res.ok) return null;
    const data = await res.json();
    return data.error ? null : data;
  } catch {
    return null; // 列表拉取失败不影响播放
  }
}

// 同目录中排在当前文件之前/之后的媒体（服务端已自然排序）
function findSiblingMedia(vPath, isAudio, offset) {
  if (!playerListing) return null;
  const name = vPath.split("/").pop();
  const pool = isAudio ? (playerListing.audios || []) : (playerListing.videos || []);
  const idx = pool.findIndex(x => x.name === name);
  if (idx === -1) return null;
  const target = pool[idx + offset];
  if (!target) return null;
  const dir = vPath.split("/").slice(0, -1).join("/");
  return dir ? dir + "/" + target.name : target.name;
}

function findNextMedia(vPath, isAudio) { return findSiblingMedia(vPath, isAudio, 1); }

function stepMedia(offset) {
  if (!currentWatchPath) return;
  const target = findSiblingMedia(currentWatchPath, isAudioFile(currentWatchPath.split("/").pop()), offset);
  if (target) navigate("#/watch/" + encodePath(target));
}

// 锁屏/系统级播放控制（手机息屏后仍可上下首与封面）
function updateMediaSession(vPath) {
  if (!("mediaSession" in navigator)) return;
  try {
    const name = vPath.split("/").pop();
    let artwork = [];
    if (playerListing) {
      const pool = isAudioFile(name) ? (playerListing.audios || []) : (playerListing.videos || []);
      const item = pool.find(x => x.name === name);
      if (item) {
        const c = readThumbCache(vPath, item.mtime, item.size);
        if (c && c.u) artwork = [{ src: c.u, sizes: "320x180", type: "image/jpeg" }];
      }
    }
    navigator.mediaSession.metadata = new MediaMetadata({
      title: name,
      artist: vPath.split("/").slice(0, -1).join("/") || "本地音视频播放器",
      artwork,
    });
    navigator.mediaSession.setActionHandler("previoustrack", () => stepMedia(-1));
    navigator.mediaSession.setActionHandler("nexttrack", () => stepMedia(1));
  } catch { /* 浏览器不支持相应能力时忽略 */ }
}

// 音频封面上的均衡器动画随播放状态启停
video.addEventListener("play", () => audioCover.classList.add("playing"));
video.addEventListener("pause", () => audioCover.classList.remove("playing"));
video.addEventListener("ended", () => audioCover.classList.remove("playing"));

// 解码失败（浏览器不支持的容器/编码）给出明确提示
video.addEventListener("error", () => {
  if (!currentWatchPath || video.dataset.watchPath !== currentWatchPath || !video.error) return;
  hideResumeToast();
  pendingSeek = null;
  const name = currentWatchPath.split("/").pop();
  const base = name.replace(/\.[^.]+$/, "");
  const ext = name.includes(".") ? name.split(".").pop().toUpperCase() : "该";
  $("#video-error-text").textContent =
    `浏览器无法解码 ${ext} 格式，可先转码为 MP4 后播放：` +
    `ffmpeg -i "${name}" -c:v libx264 -c:a aac "${base}.mp4"`;
  videoError.classList.remove("hidden");
});

video.addEventListener("loadedmetadata", () => {
  // 旧版比例进度没有绝对时间，元数据就绪后补出"上次看到 xx:xx"
  if (resumeState && resumeState.p.t === undefined && !resumeToast.classList.contains("hidden")
      && isFinite(video.duration) && video.duration > 0) {
    const el = $("#resume-time");
    if (el) el.textContent = formatDuration(resumeState.p.ratio * video.duration);
  }
  // 元数据未就绪时点过"继续播放"，这里执行跳转
  if (pendingSeek && pendingSeek.path === currentWatchPath) {
    const st = pendingSeek;
    pendingSeek = null;
    performSeek(st);
  }
});

// 按保存的进度跳转；文件时长对不上（±5%，可能已被替换）则作废进度
function performSeek(st) {
  if (!isFinite(video.duration) || video.duration <= 0) return;
  const p = st.p;
  if (p.t !== undefined) {
    if (Math.abs(video.duration - p.d) / p.d > 0.05) {
      removeProgress(st.path);
      return;
    }
    video.currentTime = Math.min(p.t, Math.max(0, video.duration - 1));
  } else {
    video.currentTime = p.ratio * video.duration;
  }
}

// 常见字幕语言后缀 → 显示名
const SUB_LANGS = {
  chs: "简体中文", sc: "简体中文", zhs: "简体中文", zh: "中文",
  cht: "繁體中文", tc: "繁體中文", big5: "繁體中文",
  eng: "English", en: "English",
  jpn: "日本語", jp: "日本語", ja: "日本語",
  kor: "한국어", kr: "한국어", ko: "한국어",
};

async function attachSubtitle(vPath, listing, requestSeq) {
  if (!listing || !listing.subs || !listing.subs.length) return;
  const name = vPath.split("/").pop();
  const base = name.replace(/\.[^.]+$/, "").toLowerCase();
  // 第一优先：同名或同名.语言后缀（Movie.srt / Movie.chs.srt）
  let matches = listing.subs.filter(s => {
    const sb = s.name.replace(/\.[^.]+$/, "").toLowerCase();
    return sb === base || sb.startsWith(base + ".");
  });
  // 第二优先：视频名包含字幕名（"Movie [1080p].mp4" 配 "Movie.srt"）
  if (!matches.length) {
    matches = listing.subs.filter(s => {
      const sb = s.name.replace(/\.[^.]+$/, "").toLowerCase();
      return sb.length >= 3 && base.includes(sb);
    });
  }
  if (!matches.length) return;

  const dir = vPath.split("/").slice(0, -1).join("/");
  for (let i = 0; i < matches.length; i++) {
    const sub = matches[i];
    const subPath = dir ? dir + "/" + sub.name : sub.name;
    try {
      const res = await fetch("/api/file?path=" + encodeURIComponent(subPath));
      if (!res.ok || !isCurrentWatch(requestSeq, vPath)) return;
      let text = await res.text();
      if (!isCurrentWatch(requestSeq, vPath)) return;
      if (/\.srt$/i.test(sub.name)) text = srtToVtt(text);
      const url = URL.createObjectURL(new Blob([text], { type: "text/vtt" }));
      subtitleUrls.push(url);
      const track = document.createElement("track");
      track.kind = "subtitles";
      const suffix = sub.name.replace(/\.[^.]+$/, "").slice(base.length).replace(/^\./, "").toLowerCase();
      track.label = SUB_LANGS[suffix] || (suffix ? "字幕 " + suffix : "字幕");
      if (/^(chs|sc|zhs|zh)$/.test(suffix)) track.srclang = "zh-CN";
      else if (/^(cht|tc|big5)$/.test(suffix)) track.srclang = "zh-TW";
      else if (/^(eng|en)$/.test(suffix)) track.srclang = "en";
      if (i === 0) track.default = true;
      track.src = url;
      video.appendChild(track);
    } catch { /* 字幕加载失败不影响播放 */ }
  }
}

function restoreProgress(vPath) {
  const p = readProgress(vPath);
  if (!p || p.frac <= 0.02 || p.frac >= 0.97) return;

  const st = { path: vPath, p };
  resumeState = st;
  resumeToast.innerHTML =
    `上次看到 <span id="resume-time">${p.t !== undefined ? formatDuration(p.t) : "上次位置"}</span> ` +
    `<button id="resume-yes">继续播放</button> <button id="resume-no" class="ghost">从头看</button>`;
  resumeToast.classList.remove("hidden");
  $("#resume-yes").onclick = () => {
    hideResumeToast();
    if (isFinite(video.duration) && video.duration > 0) performSeek(st);
    else pendingSeek = st;
  };
  $("#resume-no").onclick = () => {
    removeProgress(vPath);
    if (video.readyState >= 1) video.currentTime = 0;
    hideResumeToast();
  };
  resumeTimer = setTimeout(hideResumeToast, 10000);
}

// 记录播放进度：播放时节流保存（3 秒），暂停/切换视频/关闭页面时立即保存
video.addEventListener("timeupdate", () => {
  if (!currentWatchPath || !isFinite(video.duration) || video.duration <= 0) return;
  if (saveTimer !== null) return;
  const path = currentWatchPath, seq = watchRequestSeq;
  // long: 保留首次事件的定时器，后续事件只更新媒体时间；换片后的旧定时器不能保存到新文件。
  saveTimer = setTimeout(() => {
    saveTimer = null;
    if (isCurrentWatch(seq, path)) flushProgress();
  }, 3000);
});
video.addEventListener("pause", flushProgress);
video.addEventListener("ended", () => {
  if (currentWatchPath && isFinite(video.duration) && video.duration > 0) {
    writeProgress(currentWatchPath, video.duration, video.duration);
  }
  // 自动连播：播完接同目录下一个
  if (nextMediaPath && storage.getItem("vp-autonext") !== "0") {
    navigate("#/watch/" + encodePath(nextMediaPath));
  }
});
window.addEventListener("pagehide", () => { flushProgress(); progressSync.flushBeacon(); });
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") { flushProgress(); progressSync.flushBeacon(); }
  else { progressSync.push(); progressSync.pull(); }
});
window.addEventListener("online", () => { progressSync.push(); progressSync.pull(); });
window.addEventListener("pageshow", () => { progressSync.push(); });

/* ---------------- 播放页快捷键 ---------------- */

document.addEventListener("keydown", (e) => {
  if (playerPage.classList.contains("hidden")) return;
  if (e.target.tagName === "INPUT" || e.target.tagName === "SELECT") return;
  switch (e.key) {
    case " ":
      e.preventDefault();
      video.paused ? video.play() : video.pause();
      break;
    case "ArrowLeft": video.currentTime = Math.max(0, video.currentTime - 10); break;
    case "ArrowRight": video.currentTime = Math.min(video.duration || 0, video.currentTime + 10); break;
    case "ArrowUp": video.volume = Math.min(1, video.volume + 0.1); break;
    case "ArrowDown": video.volume = Math.max(0, video.volume - 0.1); break;
    case "m": case "M":
      toggleSound();
      break;
    case "f": case "F":
      if (document.fullscreenElement) document.exitFullscreen();
      else video.requestFullscreen().catch(() => {});
      break;
    case "n": case "N":
      if (nextMediaPath) navigate("#/watch/" + encodePath(nextMediaPath));
      break;
    case "Escape":
      if (!document.fullscreenElement) goBackToBrowse();
      break;
  }
});

// 记住倍速、音量、静音
const speedSelect = $("#speed-select");
(() => {
  const savedSpeed = Number(storage.getItem("vp-speed"));
  if ([...speedSelect.options].some(o => Number(o.value) === savedSpeed)) {
    speedSelect.value = String(savedSpeed);
  }
  const rawVolume = storage.getItem("vp-volume");
  const savedVolume = Number(rawVolume);
  // long: 没有设置不等于零音量；首次使用保持浏览器默认，同时尊重用户主动保存的零音量。
  if (rawVolume !== null && rawVolume.trim() !== "" && isFinite(savedVolume)) {
    try { video.volume = Math.min(1, Math.max(0, savedVolume)); } catch { /* 部分手机由系统管理音量。 */ }
  }
  video.muted = storage.getItem("vp-muted") === "1";
})();
speedSelect.addEventListener("change", (e) => {
  video.playbackRate = Number(e.target.value);
  storage.setItem("vp-speed", e.target.value);
});

// 静音偏好只在用户主动操作时记录：
// 移动端浏览器的自动播放策略常会"强制静音起播"，若无条件记录，
// 策略性静音会被当成用户偏好永久保存，导致手机上一直是静音
let inUserGesture = false;
function markGesture() {
  inUserGesture = true;
  setTimeout(() => { inUserGesture = false; }, 1000);
}
video.addEventListener("pointerdown", markGesture, true);
video.addEventListener("touchstart", markGesture, { passive: true });
document.addEventListener("keydown", (e) => {
  if (!playerPage.classList.contains("hidden") && ["ArrowUp", "ArrowDown", "m", "M"].includes(e.key)) markGesture();
}, true);

video.addEventListener("volumechange", () => {
  if (inUserGesture) {
    storage.setItem("vp-volume", String(video.volume));
    storage.setItem("vp-muted", video.muted ? "1" : "0");
  }
  updateMuteBtn();
});

// 自定义静音按钮：iOS 等移动端原生控制条没有静音键，这里提供统一入口
const btnMute = $("#btn-mute");
function updateMuteBtn() {
  btnMute.textContent = (video.muted || video.volume === 0) ? "声音 关" : "声音 开";
}
function toggleSound() {
  const enable = video.muted || video.volume === 0;
  video.muted = !enable;
  if (enable && video.volume === 0) {
    try { video.volume = 1; } catch { /* iOS 上 volume 只读，忽略 */ }
  }
  // long: 显式按钮操作当场保存，不能依赖异步 volumechange 是否仍处于触屏手势窗口。
  storage.setItem("vp-volume", String(video.volume));
  storage.setItem("vp-muted", video.muted ? "1" : "0");
  updateMuteBtn();
}
btnMute.addEventListener("click", toggleSound);
updateMuteBtn();

// 若被自动播放策略静音、但用户偏好有声，则在播放开始/首次触屏时自动恢复声音
function tryRestoreSound() {
  if (video.muted && storage.getItem("vp-muted") !== "1") video.muted = false;
}
video.addEventListener("play", tryRestoreSound);
document.addEventListener("touchend", tryRestoreSound, { passive: true });

// 连播开关与"下一集"按钮
function updateAutonextBtn() {
  $("#btn-autonext").textContent = storage.getItem("vp-autonext") === "0" ? "连播 关" : "连播 开";
}
$("#btn-autonext").addEventListener("click", () => {
  storage.setItem("vp-autonext", storage.getItem("vp-autonext") === "0" ? "1" : "0");
  updateAutonextBtn();
});
updateAutonextBtn();
// 系统级播放/暂停/快进快退（Media Session）
if ("mediaSession" in navigator) {
  try {
    navigator.mediaSession.setActionHandler("play", () => video.play());
    navigator.mediaSession.setActionHandler("pause", () => video.pause());
    navigator.mediaSession.setActionHandler("seekbackward", () => { video.currentTime = Math.max(0, video.currentTime - 10); });
    navigator.mediaSession.setActionHandler("seekforward", () => { video.currentTime = Math.min(video.duration || 0, video.currentTime + 10); });
  } catch { /* 浏览器不支持 */ }
}

// 触屏设备双击视频左/右区域快退/快进（桌面端双击保留浏览器全屏切换）
video.addEventListener("dblclick", (e) => {
  if (!matchMedia("(pointer: coarse)").matches) return;
  if (video.classList.contains("is-audio") || !isFinite(video.duration)) return;
  const rect = video.getBoundingClientRect();
  const x = (e.clientX - rect.left) / rect.width;
  if (x < 0.4) video.currentTime = Math.max(0, video.currentTime - 10);
  else if (x > 0.6) video.currentTime = Math.min(video.duration, video.currentTime + 10);
});

$("#btn-next").addEventListener("click", () => {
  if (nextMediaPath) navigate("#/watch/" + encodePath(nextMediaPath));
});

function goBackToBrowse() {
  // 返回视频所在的目录（而不是固定回根目录）
  const dir = currentWatchPath.split("/").slice(0, -1).join("/");
  navigate("#/" + encodePath(dir));
}

$("#btn-back").addEventListener("click", goBackToBrowse);

/* ---------------- 总入口 ---------------- */

function render() {
  const route = parseRoute();
  browseSeq++;
  searchSeq++;
  clearTimeout(runSearch._t);
  flushProgress();   // currentWatchPath 被覆盖前保存上一个视频的进度
  currentWatchPath = "";
  progressCleared = false;
  playerListing = null;
  nextMediaPath = "";
  if (route.page === "watch") {
    browsePage.classList.add("hidden");
    playerPage.classList.remove("hidden");
    currentWatchPath = route.path;
    renderWatch(route.path);
  } else {
    watchRequestSeq++; // 作废尚未返回的目录和字幕请求，防止离开播放页后回写状态
    playerPage.classList.add("hidden");
    browsePage.classList.remove("hidden");
    video.pause();
    delete video.dataset.watchPath;
    video.removeAttribute("src");
    video.load();
    currentWatchPath = "";
    renderBrowse(route.path);
  }
}

render();
evictThumbCache(); // long: 升级后也收敛旧版本留下的无限缓存。
progressSync.start();
