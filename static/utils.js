(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.PlayerUtils = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function srtToVtt(srt) {
    // long: 浏览器字幕轨只接受 WebVTT；同时移除常见 BOM 和 CRLF，避免首条字幕被识别成非法头。
    return "WEBVTT\n\n" + String(srt).replace(/^\uFEFF/, "").replace(/\r/g, "")
      .replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, "$1.$2");
  }

  function createSafeStorage(getStorage) {
    const memory = new Map();
    const pending = new Set();
    const api = {
      getItem(key) {
        if (pending.has(key)) return memory.get(key) ?? null;
        try {
          const value = getStorage().getItem(key);
          memory.set(key, value);
          return value;
        } catch { return memory.get(key) ?? null; }
      },
      keys() {
        const keys = new Set(memory.keys());
        try {
          const backing = getStorage();
          for (let i = 0; i < backing.length; i++) keys.add(backing.key(i));
        } catch { /* long: 禁用存储时仍用会话内记录渲染续播列表。 */ }
        return [...keys].filter(key => key && api.getItem(key) !== null);
      },
      removeItem(key) {
        memory.set(key, null);
        try { getStorage().removeItem(key); pending.delete(key); }
        catch { pending.add(key); }
      },
      setItem(key, value) {
        value = String(value);
        memory.set(key, value);
        try { getStorage().setItem(key, value); pending.delete(key); return true; }
        catch { pending.add(key); }
        // long: 播放记录比可重新生成的缩略图重要，配额不足时先腾出缓存空间。
        if (!key.startsWith("vp-thumb:")) {
          api.keys().filter(k => k.startsWith("vp-thumb:")).forEach(k => api.removeItem(k));
          try { getStorage().setItem(key, value); pending.delete(key); return true; }
          catch { /* long: 存储完全不可用也不能中断播放和服务端同步。 */ }
        }
        pending.add(key);
        return false;
      },
    };
    return api;
  }

  return { srtToVtt, createSafeStorage };
});
