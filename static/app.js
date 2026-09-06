/* 本地视频播放器 - 前端逻辑（无任何外部依赖） */
"use strict";

const $ = (sel) => document.querySelector(sel);
const browsePage = $("#browse-page");
const playerPage = $("#player-page");

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

const DIR_SVG = '<svg viewBox="0 0 24 24" fill="none"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" fill="#4a7bd4"/><path d="M3 10h18v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-8z" fill="#5a8de0"/></svg>';

const VIDEO_SVG = '<svg viewBox="0 0 24 24" fill="none"><rect x="2" y="4" width="20" height="16" rx="3" fill="#6c5ce7"/><path d="M10 9l6 3-6 3V9z" fill="#fff"/></svg>';

const AUDIO_SVG = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M9 18.5a2.5 2.5 0 1 1-2-2.45V6.2a1 1 0 0 1 .76-.97l8.5-2.1A1 1 0 0 1 17.5 4.1v10.95a2.5 2.5 0 1 1-2-2.45V6.53l-6.5 1.6v10.37z"/></svg>';

// 与服务端 AUDIO_EXTS 保持一致
const AUDIO_EXTS_JS = ["mp3", "m4a", "aac", "flac", "wav", "ogg", "opus"];

function isAudioFile(name) {
  const ext = name.split(".").pop().toLowerCase();
  return AUDIO_EXTS_JS.includes(ext);
}

/* ---------------- 路由 ---------------- */

function navigate(hash) { location.hash = hash; }

function parseRoute() {
  // #/  -> 浏览根目录; #/子/目录 -> 浏览; #/watch/路径 -> 播放
  let h = decodeURIComponent(location.hash.replace(/^#/, "")) || "/";
  h = h.replace(/\/+$/, "") || "/";
  if (h.startsWith("/watch/")) {
    return { page: "watch", path: h.slice("/watch/".length) };
  }
  return { page: "browse", path: h === "/" ? "" : h.slice(1) };
}

window.addEventListener("hashchange", render);

/* ---------------- 浏览页 ---------------- */

let currentListing = null;   // 当前目录数据（播放页复用为同目录列表）
let currentPath = "";
let searchActive = false;    // 当前展示的是搜索结果还是目录列表
let searchSeq = 0;           // 搜索请求序号，丢弃过期响应

const durationObserver = new IntersectionObserver((entries) => {
  for (const en of entries) {
    if (!en.isIntersecting) continue;
    durationObserver.unobserve(en.target);
    const path = en.target.dataset.path;
    const badge = en.target.querySelector(".thumb-badge");
    const probe = document.createElement("video");
    probe.preload = "metadata";
    probe.muted = true;
    probe.src = "/api/file?path=" + encodeURIComponent(path);
    probe.onloadedmetadata = () => {
      const d = formatDuration(probe.duration);
      if (d && badge) badge.textContent = d;
      probe.src = "";
    };
  }
}, { rootMargin: "120px" });

async function renderBrowse(relPath) {
  currentPath = relPath;
  searchActive = false;
  searchSeq++;               // 作废在途搜索响应
  $("#search-box").value = "";

  let data;
  try {
    const res = await fetch("/api/list?path=" + encodeURIComponent(relPath));
    data = await res.json();
    if (data.error) throw new Error(data.error);
  } catch (e) {
    $("#file-grid").innerHTML = "";
    showEmpty("加载失败：" + e.message);
    return;
  }
  currentListing = data;

  renderBreadcrumb(relPath);
  const total = data.dirs.length + data.videos.length + (data.audios || []).length;
  $("#list-meta").textContent =
    `${data.dirs.length} 个文件夹 · ${data.videos.length} 个视频 · ${(data.audios || []).length} 个音频` + (total === 0 ? "" : "");

  renderGrid();
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
  const raw = localStorage.getItem(progressKey(path));
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

function writeProgress(path, t, d) {
  if (!isFinite(t) || !isFinite(d) || d <= 0) return;
  localStorage.setItem(progressKey(path), JSON.stringify({ t: Math.round(t * 10) / 10, d: Math.round(d * 10) / 10 }));
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
    card.onclick = () => navigate("#/" + encodePath(currentPath ? currentPath + "/" + d.name : d.name));
    grid.appendChild(card);
  }

  for (const v of videos) {
    const vPath = currentPath ? currentPath + "/" + v.name : v.name;
    const pct = progressPct(vPath);
    const card = document.createElement("div");
    card.className = "file-card";
    card.innerHTML = `
      <div class="file-thumb">${VIDEO_SVG}<span class="thumb-badge">${v.ext.toUpperCase()}</span></div>
      ${pct > 0 ? `<div class="progress-bar"><div style="width:${pct}%"></div></div>` : ""}
      <div class="file-info">
        <div class="file-name">${escapeHtml(v.name)}</div>
        <div class="file-sub"><span>${formatSize(v.size)}</span><span>${new Date(v.mtime * 1000).toLocaleDateString()}</span></div>
      </div>`;
    card.onclick = () => navigate("#/watch/" + encodePath(vPath));
    const thumb = card.querySelector(".file-thumb");
    thumb.dataset.path = vPath;
    durationObserver.observe(thumb);
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
    card.onclick = () => navigate("#/watch/" + encodePath(aPath));
    const thumb = card.querySelector(".file-thumb");
    thumb.dataset.path = aPath;
    durationObserver.observe(thumb);
    grid.appendChild(card);
  }

  if (dirs.length + videos.length + audios.length > 0) {
    $("#list-meta").textContent = `${dirs.length} 个文件夹 · ${videos.length} 个视频 · ${audios.length} 个音频`;
  }
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/* ---------------- 全库搜索 ---------------- */

$("#search-box").addEventListener("input", (e) => {
  const kw = e.target.value.trim();
  clearTimeout(runSearch._t);
  runSearch._t = setTimeout(() => runSearch(kw), 250);
});

async function runSearch(kw) {
  const seq = ++searchSeq;
  if (!kw) {
    if (searchActive) renderBrowse(currentPath);
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
  if (seq !== searchSeq) return;   // 已有更新的请求或已切页
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
    const pct = (!isDir && r.kind) ? progressPct(r.path) : 0;
    const card = document.createElement("div");
    card.className = "file-card" + (isDir ? " is-dir" : isAudio ? " is-audio" : "");
    card.innerHTML = `
      <div class="file-thumb">${isDir ? DIR_SVG : isAudio ? AUDIO_SVG : VIDEO_SVG}${isDir ? "" : `<span class="thumb-badge">${r.ext.toUpperCase()}</span>`}</div>
      ${pct > 0 ? `<div class="progress-bar"><div style="width:${pct}%"></div></div>` : ""}
      <div class="file-info">
        <div class="file-name">${escapeHtml(r.name)}</div>
        <div class="file-sub"><span>${isDir ? "文件夹" : formatSize(r.size || 0)}</span><span>${escapeHtml(parent)}</span></div>
      </div>`;
    card.onclick = () => navigate(isDir ? "#/" + encodePath(r.path) : "#/watch/" + encodePath(r.path));
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

function hideResumeToast() {
  clearTimeout(resumeTimer);
  resumeTimer = null;
  resumeState = null;
  resumeToast.classList.add("hidden");
}

// 立即保存当前视频进度；须在 currentWatchPath 被覆盖前调用
function flushProgress() {
  if (!currentWatchPath || !isFinite(video.duration) || video.duration <= 0) return;
  if (video.ended || video.error) return;
  writeProgress(currentWatchPath, video.currentTime, video.duration);
}

async function renderWatch(vPath) {
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
  $("#audio-title").textContent = name;
  audioCover.classList.remove("playing");

  // 清理旧的字幕轨道
  video.querySelectorAll("track").forEach(t => t.remove());
  video.removeAttribute("src");
  video.load();

  video.src = "/api/file?path=" + encodeURIComponent(vPath);
  video.playbackRate = Number($("#speed-select").value) || 1;

  restoreProgress(vPath);
  await loadSiblingListing(vPath);
  if (!isAudio) await attachSubtitle(vPath);
  nextMediaPath = findNextMedia(vPath, isAudio) || "";
  $("#btn-next").classList.toggle("hidden", !nextMediaPath);
}

// 拉取同目录列表，供字幕匹配与连播使用
async function loadSiblingListing(vPath) {
  currentListing = null;
  const dir = vPath.split("/").slice(0, -1).join("/");
  try {
    const res = await fetch("/api/list?path=" + encodeURIComponent(dir));
    const data = await res.json();
    if (!data.error) currentListing = data;
  } catch { /* 列表拉取失败不影响播放 */ }
}

// 同目录中排在当前文件之后的下一个媒体（服务端已自然排序）
function findNextMedia(vPath, isAudio) {
  if (!currentListing) return null;
  const name = vPath.split("/").pop();
  const pool = isAudio ? (currentListing.audios || []) : (currentListing.videos || []);
  const idx = pool.findIndex(x => x.name === name);
  if (idx === -1 || idx + 1 >= pool.length) return null;
  const dir = vPath.split("/").slice(0, -1).join("/");
  const nextName = pool[idx + 1].name;
  return dir ? dir + "/" + nextName : nextName;
}

// 音频封面上的均衡器动画随播放状态启停
video.addEventListener("play", () => audioCover.classList.add("playing"));
video.addEventListener("pause", () => audioCover.classList.remove("playing"));
video.addEventListener("ended", () => audioCover.classList.remove("playing"));

// 解码失败（浏览器不支持的容器/编码）给出明确提示
video.addEventListener("error", () => {
  if (!currentWatchPath || !video.error) return;
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
      localStorage.removeItem(progressKey(st.path));
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

async function attachSubtitle(vPath) {
  if (!currentListing || !currentListing.subs || !currentListing.subs.length) return;
  const name = vPath.split("/").pop();
  const base = name.replace(/\.[^.]+$/, "").toLowerCase();
  // 第一优先：同名或同名.语言后缀（Movie.srt / Movie.chs.srt）
  let matches = currentListing.subs.filter(s => {
    const sb = s.name.replace(/\.[^.]+$/, "").toLowerCase();
    return sb === base || sb.startsWith(base + ".");
  });
  // 第二优先：视频名包含字幕名（"Movie [1080p].mp4" 配 "Movie.srt"）
  if (!matches.length) {
    matches = currentListing.subs.filter(s => {
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
      let text = await res.text();
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

function srtToVtt(srt) {
  // SRT -> WebVTT（时间轴逗号改为点号）
  return "WEBVTT\n\n" + srt.replace(/\r/g, "").replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, "$1.$2");
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
    localStorage.removeItem(progressKey(vPath));
    hideResumeToast();
  };
  resumeTimer = setTimeout(hideResumeToast, 10000);
}

// 记录播放进度：播放时节流保存（3 秒），暂停/切换视频/关闭页面时立即保存
video.addEventListener("timeupdate", () => {
  if (!currentWatchPath || !isFinite(video.duration) || video.duration <= 0) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushProgress, 3000);
});
video.addEventListener("pause", flushProgress);
video.addEventListener("ended", () => {
  if (currentWatchPath && isFinite(video.duration) && video.duration > 0) {
    writeProgress(currentWatchPath, video.duration, video.duration);
  }
  // 自动连播：播完接同目录下一个
  if (nextMediaPath && localStorage.getItem("vp-autonext") !== "0") {
    navigate("#/watch/" + encodePath(nextMediaPath));
  }
});
window.addEventListener("pagehide", flushProgress);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") flushProgress();
});

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
  const savedSpeed = Number(localStorage.getItem("vp-speed"));
  if ([...speedSelect.options].some(o => Number(o.value) === savedSpeed)) {
    speedSelect.value = String(savedSpeed);
  }
  const savedVolume = Number(localStorage.getItem("vp-volume"));
  if (isFinite(savedVolume)) video.volume = Math.min(1, Math.max(0, savedVolume));
  video.muted = localStorage.getItem("vp-muted") === "1";
})();
speedSelect.addEventListener("change", (e) => {
  video.playbackRate = Number(e.target.value);
  localStorage.setItem("vp-speed", e.target.value);
});
video.addEventListener("volumechange", () => {
  localStorage.setItem("vp-volume", String(video.volume));
  localStorage.setItem("vp-muted", video.muted ? "1" : "0");
});

// 连播开关与"下一集"按钮
function updateAutonextBtn() {
  $("#btn-autonext").textContent = localStorage.getItem("vp-autonext") === "0" ? "连播 关" : "连播 开";
}
$("#btn-autonext").addEventListener("click", () => {
  localStorage.setItem("vp-autonext", localStorage.getItem("vp-autonext") === "0" ? "1" : "0");
  updateAutonextBtn();
});
updateAutonextBtn();
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
  flushProgress();   // currentWatchPath 被覆盖前保存上一个视频的进度
  if (route.page === "watch") {
    browsePage.classList.add("hidden");
    playerPage.classList.remove("hidden");
    currentWatchPath = route.path;
    currentListing = null;
    renderWatch(route.path);
  } else {
    playerPage.classList.add("hidden");
    browsePage.classList.remove("hidden");
    video.pause();
    video.removeAttribute("src");
    video.load();
    currentWatchPath = "";
    renderBrowse(route.path);
  }
}

render();
