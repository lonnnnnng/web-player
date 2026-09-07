(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.PlayerProgress = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const PREFIX = "vp-progress:";
  const QUEUE_KEY = "vp-pending-progress";
  const valid = r => r && Number.isFinite(r.t) && Number.isFinite(r.d) && Number.isFinite(r.ts);
  const deleted = r => r.d <= 0 || r.t < 0;
  const newer = (a, b) => !valid(b) || a.ts > b.ts || (a.ts === b.ts && deleted(a) && !deleted(b));

  function createProgressSync({ storage, fetch: request, beacon, now = Date.now,
    setTimer = setTimeout, clearTimer = clearTimeout, onChange = () => {}, onStatus = () => {} }) {
    const dirty = new Map();
    let timer = null, inFlight = null, retryDelay = 1000;
    let reachable = null, pulling = false;

    function notifyStatus() {
      // long: 只有服务端确认成功且没有待上传记录时显示已同步，不能把本地保存当成网络成功。
      onStatus(reachable === false ? "offline" : inFlight || pulling ? "syncing" : dirty.size ? "pending" : reachable ? "synced" : "pending");
    }

    function read(path) {
      try { return JSON.parse(storage.getItem(PREFIX + path)); } catch { return null; }
    }
    function persistQueue() {
      storage.setItem(QUEUE_KEY, JSON.stringify([...dirty]));
    }
    try {
      const saved = JSON.parse(storage.getItem(QUEUE_KEY));
      if (Array.isArray(saved)) for (const entry of saved) {
        if (!Array.isArray(entry)) continue;
        const [path, rec] = entry;
        if (typeof path === "string" && valid(rec)) dirty.set(path, rec);
      }
    } catch { /* long: 损坏的队列不阻止读取各媒体独立保存的进度。 */ }
    for (const [path, rec] of dirty) {
      if (newer(rec, read(path))) storage.setItem(PREFIX + path, JSON.stringify(rec));
    }

    function schedule(delay = 1000) {
      // long: 已安排的发送不被后续 timeupdate 推迟，持续播放也必须定期同步。
      if (timer !== null || !dirty.size) return;
      timer = setTimer(() => { timer = null; push(); }, delay);
    }
    function queue(path, rec) {
      dirty.set(path, rec);
      // long: 队列先持久化；任意一步配额失败都由存储适配器兜底，不阻断网络同步。
      persistQueue();
      storage.setItem(PREFIX + path, JSON.stringify(rec));
      schedule();
      notifyStatus();
    }
    function write(path, t, d) {
      if (!path || !Number.isFinite(t) || !Number.isFinite(d) || d < 0 || t < 0) return;
      const previous = Math.max(Number(read(path)?.ts) || 0, dirty.get(path)?.ts || 0);
      // long: 沿用秒单位并保留毫秒；同毫秒的暂停、清除和续播也产生严格递增版本。
      const ts = Math.max(now(), Math.round(previous * 1000) + 1) / 1000;
      queue(path, { t: Math.round(Math.min(t, d) * 10) / 10, d: Math.round(d * 10) / 10, ts });
    }
    function merge(path, rec) {
      if (!valid(rec)) return;
      const local = read(path);
      // long: 时间戳相同以服务端已落盘的版本为准，但删除优先，且不能压过本地更新的动作。
      if (newer(local || {}, rec) && valid(local)) return;
      storage.setItem(PREFIX + path, JSON.stringify(rec));
    }
    async function push() {
      if (inFlight) return inFlight;
      if (timer !== null) clearTimer(timer);
      timer = null;
      if (!dirty.size) return;
      const batch = [...dirty].slice(0, 100);
      const controller = new AbortController();
      const timeout = setTimer(() => controller.abort(), 10000);
      inFlight = Promise.resolve().then(async () => {
        try {
          const res = await request("/api/progress", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ items: batch.map(([path, rec]) => ({ path, ...rec })) }),
            signal: controller.signal,
          });
          if (!res.ok) throw new Error("progress HTTP " + res.status);
          const result = await res.json();
          if (result.ok !== true || !result.items || !Array.isArray(result.rejected)) {
            throw new Error("missing progress acknowledgment");
          }
          for (const [path, rec] of batch) {
            const confirmed = result.items[path];
            const rejected = result.rejected.includes(path);
            if (!valid(confirmed) && !rejected) throw new Error("incomplete progress acknowledgment");
            // long: 请求期间可能已写入下一次进度；只清除此次提交的对象，不能误删新版本。
            if (dirty.get(path) !== rec) continue;
            dirty.delete(path);
            if (valid(confirmed)) merge(path, confirmed);
          }
          persistQueue();
          retryDelay = 1000;
          reachable = true;
          onChange();
        } catch {
          // long: 断网、超时和写盘失败都保留队列；刷新后仍可重试，避免假成功丢进度。
          retryDelay = Math.min(retryDelay * 2, 30000);
          reachable = false;
        } finally {
          clearTimer(timeout);
          inFlight = null;
          schedule(retryDelay);
          notifyStatus();
        }
      });
      notifyStatus();
      return inFlight;
    }
    function flushBeacon() {
      persistQueue();
      // long: beacon 只能表示浏览器接受排队，不能证明服务端落盘，所以不删除任何待确认记录。
      let items = [];
      for (const [path, rec] of dirty) {
        const candidate = [...items, { path, ...rec }];
        if (new Blob([JSON.stringify({ items: candidate })]).size > 48000) break;
        items = candidate;
        if (items.length >= 100) break;
      }
      if (!items.length) return;
      try {
        if (beacon("/api/progress", new Blob([JSON.stringify({ items })], { type: "application/json" }))) return;
      } catch { /* long: 不支持或拒收 beacon 时，尝试仍有响应确认的普通请求。 */ }
      push();
    }
    async function pull() {
      pulling = true;
      notifyStatus();
      try {
        const res = await request("/api/progress");
        if (!res.ok) throw new Error("progress HTTP " + res.status);
        const { items } = await res.json();
        if (!items || typeof items !== "object" || Array.isArray(items)) throw new Error("invalid progress response");
        for (const [path, rec] of Object.entries(items)) merge(path, rec);
        // long: 兼容旧版本只落本地、没成功上传的进度；服务端删除标记会先合并，防止旧记录复活。
        for (const key of storage.keys()) {
          if (!key.startsWith(PREFIX)) continue;
          const path = key.slice(PREFIX.length), rec = read(path);
          if (valid(rec) && newer(rec, items[path]) && !dirty.has(path)) dirty.set(path, rec);
        }
        persistQueue();
        schedule();
        reachable = true;
        onChange();
      } catch {
        reachable = false;
      } finally {
        pulling = false;
        notifyStatus();
      }
    }
    return { read, write, remove: path => write(path, 0, 0), push, pull, flushBeacon,
      start() { schedule(); return pull(); } };
  }
  return { createProgressSync };
});
