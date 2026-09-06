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

let currentListing = null;   // 当前目录数据
let currentPath = "";
let searchKeyword = "";

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
  searchKeyword = "";
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

function renderGrid() {
  const grid = $("#file-grid");
  grid.innerHTML = "";
  $("#empty-tip").classList.add("hidden");
  durationObserver.disconnect();

  if (!currentListing) return;
  const kw = searchKeyword.trim().toLowerCase();
  const match = (name) => !kw || name.toLowerCase().includes(kw);

  const dirs = currentListing.dirs.filter(d => match(d.name));
  const videos = currentListing.videos.filter(v => match(v.name));
  const audios = (currentListing.audios || []).filter(a => match(a.name));

  if (dirs.length === 0 && videos.length === 0 && audios.length === 0) {
    showEmpty(kw ? `没有匹配“${searchKeyword}”的结果` : "这个目录还没有音视频文件");
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
    const saved = Number(localStorage.getItem(progressKey(vPath)) || 0);
    const pct = saved > 0 ? Math.min(100, Math.round(saved * 100)) : 0;
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
    const saved = Number(localStorage.getItem(progressKey(aPath)) || 0);
    const pct = saved > 0 ? Math.min(100, Math.round(saved * 100)) : 0;
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

$("#search-box").addEventListener("input", (e) => {
  searchKeyword = e.target.value;
  if (currentListing) renderGrid();
});

/* ---------------- 播放页 ---------------- */

const video = $("#video");
const audioCover = $("#audio-cover");
let saveTimer = null;

async function renderWatch(vPath) {
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

  if (!isAudio) await attachSubtitle(vPath);
  restoreProgress(vPath);
}

// 音频封面上的均衡器动画随播放状态启停
video.addEventListener("play", () => audioCover.classList.add("playing"));
video.addEventListener("pause", () => audioCover.classList.remove("playing"));
video.addEventListener("ended", () => audioCover.classList.remove("playing"));

async function attachSubtitle(vPath) {
  if (!currentListing) {
    // 直接进入播放页时，先拉取同目录列表以获得字幕信息
    const dir = vPath.split("/").slice(0, -1).join("/");
    try {
      const res = await fetch("/api/list?path=" + encodeURIComponent(dir));
      currentListing = await res.json();
      if (currentListing.error) currentListing = null;
    } catch { return; }
  }
  if (!currentListing || !currentListing.subs) return;

  const base = vPath.split("/").pop().replace(/\.[^.]+$/, "");
  const dir = vPath.split("/").slice(0, -1).join("/");
  const sub = currentListing.subs.find(s => s.name.replace(/\.[^.]+$/, "") === base)
    || currentListing.subs.find(s => s.name.toLowerCase().includes(base.toLowerCase()));
  if (!sub) return;

  const subPath = dir ? dir + "/" + sub.name : sub.name;
  try {
    const res = await fetch("/api/file?path=" + encodeURIComponent(subPath));
    let text = await res.text();
    if (/\.srt$/i.test(sub.name)) text = srtToVtt(text);
    const url = URL.createObjectURL(new Blob([text], { type: "text/vtt" }));
    const track = document.createElement("track");
    track.kind = "subtitles";
    track.label = "字幕";
    track.src = url;
    track.default = true;
    video.appendChild(track);
  } catch { /* 字幕加载失败不影响播放 */ }
}

function srtToVtt(srt) {
  // SRT -> WebVTT（时间轴逗号改为点号）
  return "WEBVTT\n\n" + srt.replace(/\r/g, "").replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, "$1.$2");
}

function restoreProgress(vPath) {
  const saved = Number(localStorage.getItem(progressKey(vPath)) || 0);
  if (saved > 0.02 && saved < 0.97) {
    const toast = $("#resume-toast");
    const seekTo = () => {
      video.currentTime = saved * video.duration;
      toast.classList.add("hidden");
    };
    toast.innerHTML = `上次看到 ${formatDuration(saved * (video.duration || 0)) || "上次位置"} <button id="resume-yes">继续播放</button> <button id="resume-no" class="ghost">从头看</button>`;
    toast.classList.remove("hidden");
    $("#resume-yes").onclick = seekTo;
    $("#resume-no").onclick = () => { localStorage.removeItem(progressKey(vPath)); toast.classList.add("hidden"); };
    video.addEventListener("loadedmetadata", function once() {
      video.removeEventListener("loadedmetadata", once);
      if (!toast.classList.contains("hidden")) {
        toast.innerHTML = `上次看到 ${formatDuration(saved * video.duration)} <button id="resume-yes">继续播放</button> <button id="resume-no" class="ghost">从头看</button>`;
        $("#resume-yes").onclick = seekTo;
        $("#resume-no").onclick = () => { localStorage.removeItem(progressKey(vPath)); toast.classList.add("hidden"); };
      }
    });
    setTimeout(() => toast.classList.add("hidden"), 10000);
  }
}

// 记录播放进度（每 3 秒 / 暂停 / 关闭时保存）
video.addEventListener("timeupdate", () => {
  if (!video.duration || !currentWatchPath) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    if (video.duration > 0) {
      localStorage.setItem(progressKey(currentWatchPath), String(video.currentTime / video.duration));
    }
  }, 3000);
});
video.addEventListener("ended", () => {
  if (currentWatchPath) localStorage.setItem(progressKey(currentWatchPath), "1");
});

let currentWatchPath = "";

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
    case "Escape":
      if (!document.fullscreenElement) goBackToBrowse();
      break;
  }
});

$("#speed-select").addEventListener("change", (e) => {
  video.playbackRate = Number(e.target.value);
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
