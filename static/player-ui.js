"use strict";

let feedbackTimer = null;
let audioSeeking = false;
let audioWaiting = false;

function showFeedback(message) {
  const el = $("#action-feedback");
  clearTimeout(feedbackTimer);
  el.textContent = message;
  el.classList.remove("hidden");
  feedbackTimer = setTimeout(() => el.classList.add("hidden"), 4500);
}

async function togglePlayback() {
  if (!video.paused) { video.pause(); return; }
  try { await video.play(); }
  catch (error) {
    if (error.name !== "AbortError") showFeedback("播放未能开始，请重试。");
  }
}

function seekAudio(offset) {
  if (!Number.isFinite(video.duration) || video.duration <= 0) return;
  video.currentTime = Math.max(0, Math.min(video.duration, video.currentTime + offset));
  updatePlayerTimeline();
}

function updatePlayerTimeline() {
  const duration = Number.isFinite(video.duration) ? video.duration : 0;
  const current = video.currentTime || 0;
  const seek = $("#seek-range");
  seek.disabled = duration <= 0 || !!video.error;
  seek.max = duration || 100;
  if (!audioSeeking) {
    seek.value = current;
    $("#elapsed-time").textContent = formatDuration(current) || "0:00";
  }
  $("#duration-time").textContent = formatDuration(duration) || "0:00";
  seek.setAttribute("aria-valuetext", `${formatDuration(Number(seek.value)) || "0:00"} / ${formatDuration(duration) || "0:00"}`);
}

function updatePlaybackState(event) {
  if (event?.type === "waiting" || event?.type === "stalled") audioWaiting = true;
  else if (["playing", "canplay", "pause", "ended", "error", "emptied"].includes(event?.type)) audioWaiting = false;
  const active = !video.paused && !video.ended;
  const button = $("#btn-play"), label = active ? "暂停" : "播放";
  button.innerHTML = icon(active ? "pause" : "play");
  button.title = label;
  button.setAttribute("aria-label", label);
  $("#audio-status").textContent = video.error ? "播放失败" : !video.readyState ? "正在加载" : video.ended ? "播放结束" : audioWaiting ? "正在缓冲" : active ? "正在播放" : "已暂停";
  audioCover.classList.toggle("playing", active && !audioWaiting);
  const current = document.querySelector('.queue-item[aria-current="true"] .queue-state');
  if (current) current.innerHTML = icon(active ? "audio-lines" : "play");
  updatePlayerTimeline();
}

function preparePlayerUI(path, audio) {
  audioSeeking = false;
  audioWaiting = false;
  playerPage.classList.toggle("audio-mode", audio);
  $("#audio-controls").classList.toggle("hidden", !audio);
  video.controls = !audio;
  video.tabIndex = audio ? -1 : 0;
  $("#player-kind").textContent = audio ? "音频" : "视频";
  $("#player-parent").textContent = path.split("/").slice(0, -1).join(" / ") || "根目录";
  $("#artwork-format").textContent = path.split(".").pop().toUpperCase();
  $("#media-details").textContent = "";
  $("#audio-next").disabled = true;
  $("#btn-prev").disabled = true;
  $("#queue-count").textContent = "0";
  $("#queue-items").innerHTML = '<p class="queue-empty">正在读取播放列表...</p>';
  $("#queue-directory").href = "#/" + encodePath(path.split("/").slice(0, -1).join("/")) + (path.includes("/") ? "" : "?view=folders");
  document.title = path.split("/").pop() + " · 本地播放器";
  updatePlaybackState();
}

function renderPlaybackQueue() {
  const path = currentWatchPath;
  if (!path) return;
  const name = path.split("/").pop(), audio = isAudioFile(name);
  const dir = path.split("/").slice(0, -1).join("/");
  const pool = playerListing ? (audio ? playerListing.audios || [] : playerListing.videos || []) : [];
  $("#queue-count").textContent = pool.length;
  $("#queue-caption").textContent = (dir || "根目录") + " · " + (audio ? "音频" : "视频");
  $("#audio-next").disabled = !nextMediaPath;
  $("#btn-prev").disabled = !findSiblingMedia(path, audio, -1);
  const wrap = $("#queue-items");
  wrap.replaceChildren();
  if (!pool.length) {
    const empty = document.createElement("p");
    empty.className = "queue-empty";
    empty.textContent = playerListing ? "同目录中暂无其他媒体" : "播放列表暂时无法连接";
    wrap.appendChild(empty);
    if (!playerListing) {
      const retry = document.createElement("button");
      retry.className = "text-button";
      retry.innerHTML = icon("refresh-cw") + "重试";
      retry.addEventListener("click", async () => {
        retry.disabled = true;
        const seq = watchRequestSeq;
        const listing = await loadSiblingListing(path);
        if (!isCurrentWatch(seq, path)) return;
        playerListing = listing;
        nextMediaPath = findNextMedia(path, audio) || "";
        $("#btn-next").classList.toggle("hidden", !nextMediaPath);
        renderPlaybackQueue();
      });
      wrap.appendChild(retry);
    }
  }
  for (const [index, item] of pool.entries()) {
    const itemPath = dir ? dir + "/" + item.name : item.name;
    const current = item.name === name;
    const row = document.createElement("a");
    row.className = "queue-item";
    row.href = "#/watch/" + encodePath(itemPath);
    row.title = item.name;
    if (current) row.setAttribute("aria-current", "true");
    row.innerHTML = `<span class="queue-index">${String(index + 1).padStart(2, "0")}</span><div><div class="queue-name">${escapeHtml(item.name)}</div><div class="queue-meta">${escapeHtml(item.ext.toUpperCase())} · ${formatSize(item.size)}</div></div><span class="queue-state">${current ? icon(video.paused ? "play" : "audio-lines") : ""}</span>`;
    wrap.appendChild(row);
  }
  updateMediaDetails();
}

function updateMediaDetails() {
  if (!currentWatchPath) return;
  const audio = isAudioFile(currentWatchPath), name = currentWatchPath.split("/").pop();
  const item = playerListing && (audio ? playerListing.audios || [] : playerListing.videos || []).find(item => item.name === name);
  const details = [name.split(".").pop().toUpperCase()];
  if (item) details.push(formatSize(item.size));
  if (Number.isFinite(video.duration) && video.duration > 0) details.push(formatDuration(video.duration));
  if (!audio && video.videoWidth) details.push(video.videoWidth + " × " + video.videoHeight);
  $("#media-details").textContent = details.join(" · ");
}

function initPlayerUI() {
  $("#btn-play").addEventListener("click", togglePlayback);
  $("#btn-prev").addEventListener("click", () => stepMedia(-1));
  $("#audio-next").addEventListener("click", () => stepMedia(1));
  $("#seek-back").addEventListener("click", () => seekAudio(-10));
  $("#seek-forward").addEventListener("click", () => seekAudio(10));
  $("#seek-range").addEventListener("input", e => {
    audioSeeking = true;
    $("#elapsed-time").textContent = formatDuration(Number(e.target.value)) || "0:00";
    e.target.setAttribute("aria-valuetext", $("#elapsed-time").textContent + " / " + $("#duration-time").textContent);
  });
  $("#seek-range").addEventListener("change", e => {
    // long: 拖动过程中只预览时间，松手后再发起媒体 seek，避免手机反复请求 Range 数据。
    if (Number.isFinite(video.duration) && video.duration > 0) video.currentTime = Number(e.target.value);
    audioSeeking = false;
    updatePlayerTimeline();
  });
  $("#seek-range").addEventListener("pointercancel", () => { audioSeeking = false; updatePlayerTimeline(); });
  $("#volume-range").addEventListener("input", e => {
    try { video.volume = Number(e.target.value); } catch { showFeedback("音量由设备系统管理"); }
    video.muted = video.volume === 0;
    storage.setItem("vp-volume", String(video.volume));
    storage.setItem("vp-muted", video.muted ? "1" : "0");
    updateMuteBtn();
  });
  $("#retry-playback").addEventListener("click", () => {
    if (currentWatchPath) { flushProgress(); renderWatch(currentWatchPath); }
  });
  for (const type of ["play", "playing", "pause", "ended", "waiting", "stalled", "canplay", "error", "emptied"]) video.addEventListener(type, updatePlaybackState);
  video.addEventListener("timeupdate", updatePlayerTimeline);
  video.addEventListener("loadedmetadata", () => { updatePlayerTimeline(); updateMediaDetails(); });
  video.addEventListener("durationchange", updateMediaDetails);
}
