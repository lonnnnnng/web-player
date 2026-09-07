"use strict";

const catalogState = {
  view: "library", kind: "all", sort: "newest", layout: "grid", items: [],
  counts: { video: 0, audio: 0 }, total: 0, hasMore: false, loading: false,
  requestSeq: 0, nextOffset: 0, searchResults: [], searchTruncated: false, lastBrowseHash: "#/",
  returnSearch: "", restoreSearch: "",
  librarySnapshot: null, returningFromPlayer: false,
};

function icon(name) {
  return `<svg class="icon" aria-hidden="true"><use href="/static/icons.svg#${name}"/></svg>`;
}

function initCatalogUI() {
  const savedLayout = storage.getItem("vp-layout"), savedSort = storage.getItem("vp-sort");
  if (["grid", "list"].includes(savedLayout)) catalogState.layout = savedLayout;
  if (["newest", "name", "size"].includes(savedSort)) catalogState.sort = savedSort;
  setTheme(storage.getItem("vp-theme") || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"));
  $("#theme-toggle").addEventListener("click", () => {
    const theme = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    storage.setItem("vp-theme", theme);
    setTheme(theme);
  });
  for (const el of document.querySelectorAll("[data-view]")) el.addEventListener("click", () => {
    if (location.hash === el.getAttribute("href")) renderBrowse(parseRoute().path);
  });
  for (const el of document.querySelectorAll("button[data-kind]")) el.addEventListener("click", () => {
    if (catalogState.kind === el.dataset.kind) return;
    catalogState.kind = el.dataset.kind;
    updateCatalogControls();
    if (catalogState.view === "library" && !searchActive) loadLibrary();
    else renderGrid();
  });
  $("#sort-select").addEventListener("change", e => {
    catalogState.sort = e.target.value;
    storage.setItem("vp-sort", catalogState.sort);
    if (catalogState.view === "library" && !searchActive) loadLibrary();
    else renderGrid();
  });
  for (const layout of ["grid", "list"]) $("#view-" + layout).addEventListener("click", () => {
    catalogState.layout = layout;
    storage.setItem("vp-layout", layout);
    updateCatalogControls();
  });
  $("#search-clear").addEventListener("click", () => {
    clearTimeout(runSearch._t);
    $("#search-box").value = "";
    runSearch("");
    $("#search-box").focus();
  });
  $("#refresh-library").addEventListener("click", reloadCatalog);
  $("#empty-retry").addEventListener("click", reloadCatalog);
  $("#load-more").addEventListener("click", () => loadLibrary(true));
  updateCatalogControls();
}

function setTheme(theme) {
  const dark = theme === "dark";
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  document.querySelector('meta[name="theme-color"]').content = dark ? "#181b1c" : "#f7f8fa";
  const button = $("#theme-toggle"), label = dark ? "切换浅色模式" : "切换深色模式";
  button.innerHTML = icon(dark ? "sun" : "moon");
  button.title = label;
  button.setAttribute("aria-label", label);
}

function updateCatalogControls() {
  document.querySelectorAll("[data-view]").forEach(el => {
    if (el.dataset.view === catalogState.view) el.setAttribute("aria-current", "page");
    else el.removeAttribute("aria-current");
  });
  document.querySelectorAll("button[data-kind]").forEach(el => el.setAttribute("aria-pressed", String(el.dataset.kind === catalogState.kind)));
  for (const layout of ["grid", "list"]) $("#view-" + layout).setAttribute("aria-pressed", String(catalogState.layout === layout));
  $("#file-grid").classList.toggle("is-list", catalogState.layout === "list");
  $("#sort-select").value = catalogState.sort;
  $("#sort-select option[value=newest]").textContent = catalogState.view === "recent" && !searchActive ? "最近播放" : "最近修改";
}

function reloadCatalog() {
  const query = $("#search-box").value.trim();
  if (query) runSearch(query);
  else {
    listingCache.delete(currentPath);
    renderBrowse(currentPath);
  }
}

function prepareCatalog(relPath) {
  const snapshot = catalogState.librarySnapshot;
  const restoreLibrary = catalogState.returningFromPlayer && !catalogState.restoreSearch && snapshot
    && snapshot.kind === catalogState.kind && snapshot.sort === catalogState.sort;
  catalogState.returningFromPlayer = false;
  catalogState.requestSeq++;
  catalogState.view = relPath ? "folders" : parseRoute().view;
  catalogState.lastBrowseHash = location.hash || "#/";
  catalogState.items = [];
  catalogState.hasMore = false;
  finishCatalogLoading();
  $("#search-clear").classList.add("hidden");
  $("#load-more").classList.add("hidden");
  $("#resume-row").classList.add("hidden");
  $("#folder-grid").replaceChildren();
  $("#breadcrumb").classList.toggle("hidden", !relPath);
  $("#browse-title").textContent = relPath ? relPath.split("/").pop() : { library: "媒体库", recent: "最近播放", folders: "文件夹" }[catalogState.view];
  $("#browse-eyebrow").textContent = { library: "YOUR COLLECTION", recent: "RECENTLY PLAYED", folders: "YOUR FOLDERS" }[catalogState.view];
  document.title = $("#browse-title").textContent + " · 本地播放器";
  updateCatalogControls();
  renderBreadcrumb(relPath);
  if (catalogState.view === "library" && restoreLibrary) {
    // long: 播放后返回保留已加载的所有分页与滚动位置，不让手机用户重新翻到刚才的文件。
    Object.assign(catalogState, snapshot);
    renderGrid();
    renderResumeRow();
    const seq = browseSeq;
    requestAnimationFrame(() => {
      if (seq === browseSeq && parseRoute().page === "browse") window.scrollTo(0, scrollPositions.get("library:") || 0);
    });
  } else if (catalogState.view === "library") loadLibrary();
  else if (catalogState.view === "recent") {
    renderGrid();
    progressSync.pull();
  }
  else setCatalogLoading();
}

function setCatalogLoading() {
  catalogState.loading = true;
  $("#file-grid").setAttribute("aria-busy", "true");
  $("#file-grid").innerHTML = Array.from({ length: 4 }, () => '<div class="skeleton-card" aria-hidden="true"><div class="file-thumb"></div><div class="skeleton-line"></div><div class="skeleton-line"></div></div>').join("");
  $("#empty-tip").classList.add("hidden");
  $("#list-meta").textContent = "正在读取媒体...";
  $("#refresh-library").disabled = true;
  durationObserver.disconnect();
}

function finishCatalogLoading() {
  catalogState.loading = false;
  $("#file-grid").setAttribute("aria-busy", "false");
  $("#refresh-library").disabled = false;
  $("#load-more").disabled = false;
}

async function loadLibrary(append = false) {
  const seq = ++catalogState.requestSeq;
  if (!append) {
    catalogState.items = [];
    catalogState.nextOffset = 0;
    $("#load-more").classList.add("hidden");
    setCatalogLoading();
  } else $("#load-more").disabled = true;
  const params = new URLSearchParams({ kind: catalogState.kind, sort: catalogState.sort, offset: String(catalogState.nextOffset), limit: "60" });
  const stillCurrent = () => seq === catalogState.requestSeq && parseRoute().page === "browse" && catalogState.view === "library" && !searchActive;
  try {
    const response = await fetch("/api/library?" + params);
    if (!response.ok) throw new Error("HTTP " + response.status);
    const data = await response.json();
    if (!stillCurrent()) return;
    // long: 后一页加载期间文件可能有增删，按路径去重，避免手机列表出现重复卡片。
    catalogState.items = [...new Map([...catalogState.items, ...data.items].map(item => [item.path, item])).values()];
    catalogState.counts = data.counts;
    catalogState.total = data.total;
    catalogState.hasMore = data.has_more;
    catalogState.nextOffset = data.offset + data.items.length;
    catalogState.librarySnapshot = {
      kind: catalogState.kind, sort: catalogState.sort, items: catalogState.items, counts: data.counts,
      total: data.total, hasMore: data.has_more, nextOffset: catalogState.nextOffset,
    };
    finishCatalogLoading();
    renderGrid();
    renderResumeRow();
  } catch {
    if (!stillCurrent()) return;
    finishCatalogLoading();
    if (append) showFeedback("加载失败，请稍后重试");
    else {
      $("#file-grid").replaceChildren();
      $("#list-meta").textContent = "媒体库暂时无法连接";
      showEmpty("媒体服务暂时不可用。", "加载失败", true);
    }
  }
}

function directoryItems() {
  if (!currentListing) return [];
  return [ ...(currentListing.videos || []).map(item => ({ ...item, kind: "video" })),
    ...(currentListing.audios || []).map(item => ({ ...item, kind: "audio" })) ]
    .map(item => ({ ...item, path: currentPath ? currentPath + "/" + item.name : item.name }));
}

function historyItems() {
  const items = [];
  for (const key of storage.keys()) {
    if (!key.startsWith("vp-progress:")) continue;
    const path = key.slice("vp-progress:".length), progress = readProgress(path);
    if (!progress || progress.frac <= 0) continue;
    let timestamp = 0, cached = {};
    try { timestamp = JSON.parse(storage.getItem(key)).ts || 0; } catch { /* long: 旧版比例记录没有访问时间，仍可续播。 */ }
    try { cached = JSON.parse(storage.getItem(thumbKey(path))) || {}; } catch { /* long: 损坏封面不影响播放记录。 */ }
    const name = path.split("/").pop();
    items.push({ path, name, kind: isAudioFile(name) ? "audio" : "video", ext: name.split(".").pop(), size: cached.s,
      mtime: cached.m, ts: timestamp, progress, cached });
  }
  return items.sort((a, b) => b.ts - a.ts);
}

function sortCatalog(items) {
  return [...items].sort((a, b) => {
    const delta = catalogState.sort === "size" ? (b.size || 0) - (a.size || 0)
      : catalogState.sort === "newest" ? (b.ts || b.mtime || 0) - (a.ts || a.mtime || 0) : 0;
    return delta || a.name.localeCompare(b.name, "zh-CN", { numeric: true, sensitivity: "base" });
  });
}

function renderCatalogGrid() {
  if (catalogState.loading) return;
  const grid = $("#file-grid");
  grid.replaceChildren();
  durationObserver.disconnect();
  $("#empty-tip").classList.add("hidden");
  let items, dirs = [], counts;
  if (searchActive) {
    items = catalogState.searchResults.filter(item => item.type !== "dir");
    dirs = catalogState.searchResults.filter(item => item.type === "dir");
  } else if (catalogState.view === "recent") items = historyItems();
  else if (catalogState.view === "library") {
    items = catalogState.items;
    counts = catalogState.counts;
    dirs = (currentListing?.dirs || []).map(item => ({ ...item, path: item.name }));
  } else {
    items = directoryItems();
    dirs = (currentListing?.dirs || []).map(item => ({ ...item, path: currentPath ? currentPath + "/" + item.name : item.name }));
  }
  counts = counts || { video: items.filter(item => item.kind === "video").length, audio: items.filter(item => item.kind === "audio").length };
  $("#count-video").textContent = counts.video;
  $("#count-audio").textContent = counts.audio;
  $("#count-all").textContent = counts.video + counts.audio;
  items = items.filter(item => catalogState.kind === "all" || item.kind === catalogState.kind);
  // long: 全库分页必须保持服务端顺序；只对已完整加载的文件夹、搜索和记录在本地排序。
  if (searchActive || catalogState.view !== "library") items = sortCatalog(items);
  if (catalogState.kind !== "all") dirs = [];
  const total = !searchActive && catalogState.view === "library" ? catalogState.total : items.length;
  $("#list-meta").textContent = searchActive ? `${items.length + dirs.length} 个搜索结果${catalogState.searchTruncated ? " · 仅显示前 200 条匹配结果" : ""}`
    : catalogState.view === "recent" ? `${total} 条播放记录`
    : catalogState.view === "folders" ? `${dirs.length} 个文件夹 · ${total} 个媒体文件`
    : `${counts.video} 个视频 · ${counts.audio} 个音频`;
  renderFolderLinks(dirs);
  items.forEach(item => grid.appendChild(createMediaCard(item)));
  $("#load-more").classList.toggle("hidden", searchActive || catalogState.view !== "library" || !catalogState.hasMore);
  if (!items.length && !dirs.length) showEmpty(searchActive ? "没有与当前关键词匹配的媒体。" : catalogState.view === "recent" ? "暂无已保存的播放进度。" : "当前范围内没有匹配的音视频文件。",
    searchActive ? "没有找到匹配的内容" : catalogState.view === "recent" ? "还没有播放记录" : "暂无媒体");
}

function renderFolderLinks(dirs) {
  const grid = $("#folder-grid");
  grid.replaceChildren();
  for (const item of dirs) {
    const card = document.createElement("a");
    card.className = "folder-card";
    card.href = "#/" + encodePath(item.path);
    card.innerHTML = `${icon("folder")}<div><div class="folder-name">${escapeHtml(item.name)}</div><div class="folder-meta">${escapeHtml(searchActive ? item.path.split("/").slice(0, -1).join("/") || "根目录" : "文件夹")}</div></div>${icon("chevron-right")}`;
    grid.appendChild(card);
  }
}

function mediaLink(item, className) {
  const card = document.createElement("a");
  card.className = className + (item.kind === "audio" ? " is-audio" : "");
  card.href = "#/watch/" + encodePath(item.path);
  card.title = item.name;
  card.dataset.mediaPath = item.path;
  card.addEventListener("click", () => {
    catalogState.lastBrowseHash = location.hash || "#/";
    catalogState.returnSearch = searchActive ? $("#search-box").value.trim() : "";
  });
  return card;
}

function createMediaCard(item) {
  const card = mediaLink(item, "file-card"), audio = item.kind === "audio";
  const ext = String(item.ext || item.name.split(".").pop()).toUpperCase();
  const incompatible = !audio && UNPLAYABLE_EXTS.includes(ext.toLowerCase());
  const percent = progressPct(item.path);
  const parent = item.path.split("/").slice(0, -1).join("/") || "根目录";
  const detail = item.progress ? (item.progress.frac >= .97 ? "已播完" : "已播 " + formatDuration(item.progress.t || 0))
    : item.mtime ? new Date(item.mtime * 1000).toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" }) : "";
  card.innerHTML = `<div class="file-thumb">${icon(audio ? "audio-lines" : "film")}<span class="thumb-format">${escapeHtml(ext)} / ${audio ? "AUDIO" : "VIDEO"}</span><span class="thumb-badge">${escapeHtml(ext)}</span>${incompatible ? '<span class="thumb-flag">兼容性受限</span>' : ""}<span class="thumb-play">${icon("play")}</span><div class="progress-bar"><div style="width:${percent}%"></div></div></div><div class="file-info"><div class="file-name">${escapeHtml(item.name)}</div><div class="file-sub"><span>${item.size != null ? formatSize(item.size) : escapeHtml(ext)}</span><span>${detail}</span></div><div class="file-parent">${escapeHtml(parent)}</div></div>`;
  const thumb = card.querySelector(".file-thumb");
  Object.assign(thumb.dataset, { path: item.path, mtime: item.mtime || 0, size: item.size || 0, kind: item.kind });
  const cached = item.cached || readThumbCache(item.path, item.mtime, item.size);
  if (cached?.d) thumb.querySelector(".thumb-badge").textContent = formatDuration(cached.d);
  if (cached?.u) applyThumbImage(thumb, cached.u);
  if ((!cached?.d || (!audio && !cached?.u)) && !incompatible) durationObserver.observe(thumb);
  return card;
}

function renderContinueRow() {
  const section = $("#resume-row"), wrap = $("#resume-cards");
  const items = historyItems().filter(item => item.progress.frac > .02 && item.progress.frac < .97).slice(0, 8);
  section.classList.toggle("hidden", catalogState.view !== "library" || searchActive || !items.length);
  const signature = JSON.stringify(items.map(item => [item.path, item.progress]));
  if (wrap.dataset.signature === signature) return;
  wrap.dataset.signature = signature;
  wrap.replaceChildren();
  for (const item of items) {
    const card = mediaLink(item, "resume-card"), percent = Math.min(100, Math.round(item.progress.frac * 100));
    card.innerHTML = `<div class="file-thumb">${icon(item.kind === "audio" ? "audio-lines" : "film")}</div><div class="resume-copy"><div class="file-name">${escapeHtml(item.name)}</div><p>${item.progress.t ? formatDuration(item.progress.t) : percent + "%"}${item.progress.d ? " / " + formatDuration(item.progress.d) : ""}</p><div class="progress-bar"><div style="width:${percent}%"></div></div><span class="resume-action">${icon("play")}继续播放</span></div>`;
    if (item.cached?.u) applyThumbImage(card.querySelector(".file-thumb"), item.cached.u);
    wrap.appendChild(card);
  }
}

function refreshProgressUI() {
  if (parseRoute().page !== "browse") return;
  renderResumeRow();
  if (catalogState.view === "recent") renderGrid();
  else for (const card of document.querySelectorAll(".file-card[data-media-path]")) {
    const bar = card.querySelector(".progress-bar > div");
    if (bar) bar.style.width = progressPct(card.dataset.mediaPath) + "%";
  }
}

function updateSyncStatus(state) {
  const status = document.querySelector("#sync-status");
  if (!status) return;
  const states = { syncing: ["cloud-upload", "同步中"], synced: ["cloud-check", "已同步"], pending: ["cloud-upload", "待同步"], offline: ["cloud-off", "稍后同步"] };
  const [name, label] = states[state] || states.pending;
  status.dataset.state = state;
  status.innerHTML = icon(name) + `<span>${label}</span>`;
  status.title = state === "offline" ? "播放记录已在本机保留，联网后重试同步" : "播放记录" + label;
  status.setAttribute("aria-label", status.title);
}
