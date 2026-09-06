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

  return { srtToVtt };
});
