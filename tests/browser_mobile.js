// long: 仅在隔离浏览器和临时 PROGRESS_PATH 服务上运行，避免故障注入改动真实续播记录。
// 使用 playwright-cli -s=<隔离会话> run-code --filename tests/browser_mobile.js。
async (page) => {
  const origin = await page.evaluate(() => location.origin);
  if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(origin)) throw new Error("仅允许本机隔离测试服务");
  const check = (ok, message) => { if (!ok) throw new Error(message); };
  const results = [];
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  const mp3 = "audios/500w播放福利厨房大作战.mp3";
  const m4a = "audios/番外一 .m4a";
  const mp4 = "videos/1.mp4";
  const watch = async path => {
    await page.evaluate(path => { location.hash = "#/watch/" + path.split("/").map(encodeURIComponent).join("/"); }, path);
    await page.waitForFunction(path => currentWatchPath === path && video.readyState >= 1 && playerListing,
      path, { timeout: 15000 });
  };
  await page.evaluate(() => {
    video.pause();
    localStorage.removeItem("vp-volume");
    localStorage.removeItem("vp-muted");
  });
  await page.goto(origin + "/");
  const first = await page.evaluate(() => ({ volume: video.volume, muted: video.muted,
    coarse: matchMedia("(pointer: coarse)").matches, touch: navigator.maxTouchPoints }));
  check(first.volume === 1 && !first.muted && first.coarse && first.touch > 0, "首次音量或触屏环境错误");
  results.push({ case: "fresh-mobile-sound", ...first });

  await watch(mp3);
  await page.getByRole("button", { name: "声音 开", exact: true }).click();
  await page.getByRole("button", { name: "声音 关", exact: true }).click();
  await page.evaluate(async () => { video.currentTime = 0; await video.play(); });
  await page.waitForFunction(() => video.currentTime >= 7, null, { timeout: 15000 });
  // long: 以实际服务端确认作为完成条件，避免恰好在第二次发送前的毫秒边界读取旧回包。
  const continuous = await page.evaluate(async () => {
    const deadline = Date.now() + 5000;
    let rec;
    do {
      rec = (await (await fetch("/api/progress")).json()).items[currentWatchPath];
      if (rec?.t >= 3 && progressSync.read(currentWatchPath)?.t >= 3) break;
      await new Promise(resolve => setTimeout(resolve, 250));
    } while (Date.now() < deadline);
    return { time: video.currentTime, paused: video.paused, local: progressSync.read(currentWatchPath), server: rec };
  });
  check(!continuous.paused && continuous.local?.t >= 3 && continuous.server?.t >= 3,
    "持续播放没有定时保存并同步: " + JSON.stringify(continuous));
  results.push({ case: "continuous-mp3-progress", ...continuous });
  await page.evaluate(async () => { video.pause(); await progressSync.push(); video.volume = 0; video.muted = false; });
  await page.getByRole("button", { name: "声音 关", exact: true }).click();
  check(await page.evaluate(() => video.volume === 1 && !video.muted && storage.getItem("vp-muted") === "0"), "零音量首次点击未恢复");
  results.push({ case: "zero-volume-one-click", passed: true });

  await page.getByRole("button", { name: "下一集 ›", exact: true }).click();
  await page.waitForFunction(path => currentWatchPath === path && video.readyState >= 1 && video.duration > 1000, m4a);
  await page.evaluate(async () => { video.currentTime = 20; await video.play(); });
  await page.waitForFunction(() => video.currentTime > 21);
  results.push({ case: "real-m4a-next-track", ...(await page.evaluate(() => ({ duration: video.duration, time: video.currentTime, error: video.error }))) });
  await watch(mp4);
  await page.evaluate(async () => { video.currentTime = 1; await video.play(); });
  await page.waitForFunction(() => video.currentTime > 2);
  await page.evaluate(async () => { video.pause(); await progressSync.push(); });
  await page.setViewportSize({ width: 320, height: 568 });
  check(await page.evaluate(() => document.documentElement.scrollWidth === innerWidth), "320px 页面横向溢出");
  await page.screenshot({ path: "output/playwright/fix-mobile-video-320.png" });
  results.push({ case: "real-mp4-small-screen", ...(await page.evaluate(() => ({ duration: video.duration, time: video.currentTime, width: innerWidth }))) });
  await page.setViewportSize({ width: 732, height: 360 });
  check(await page.evaluate(() => document.documentElement.scrollWidth === innerWidth), "横屏页面横向溢出");
  await page.setViewportSize({ width: 360, height: 732 });

  const retry = await page.evaluate(async path => {
    const originalFetch = window.fetch;
    let failures = 0;
    window.fetch = (url, options) => {
      if (url === "/api/progress" && options?.method === "POST") {
        failures++;
        return Promise.resolve(new Response('{"error":"test disk failure"}', { status: 503 }));
      }
      return originalFetch(url, options);
    };
    let retained;
    try {
      writeProgress(path, 123, 504.7);
      await progressSync.push();
      retained = JSON.parse(storage.getItem("vp-pending-progress")).some(([p, r]) => p === path && r.t === 123);
    } finally { window.fetch = originalFetch; }
    await progressSync.push();
    const server = (await (await fetch("/api/progress")).json()).items[path];
    return { failures, retained, server, pending: JSON.parse(storage.getItem("vp-pending-progress")).length };
  }, mp3);
  check(retry.failures === 1 && retry.retained && retry.server.t === 123 && retry.pending === 0, "失败重试丢失记录");
  results.push({ case: "503-retention-and-retry", ...retry });

  await page.route("**/api/progress", route => route.request().method() === "POST"
    ? route.fulfill({ status: 503, contentType: "application/json", body: '{"error":"offline test"}' }) : route.continue());
  await page.evaluate(async path => { writeProgress(path, 234, 504.7); await progressSync.push(); }, mp3);
  await page.reload();
  await page.unroute("**/api/progress");
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  const recovered = await page.evaluate(async path => {
    const deadline = Date.now() + 10000;
    do {
      if ((await (await fetch("/api/progress")).json()).items[path]?.t === 234) return true;
      await new Promise(resolve => setTimeout(resolve, 250));
    } while (Date.now() < deadline);
    return false;
  }, mp3);
  check(recovered, "刷新后队列没有在恢复联网时补传");
  results.push({ case: "reload-pending-online-retry", passed: true });
  const deletion = await page.evaluate(async path => {
    removeProgress(path);
    const rec = progressSync.read(path);
    await progressSync.push();
    await fetch("/api/progress", { method: "POST", body: JSON.stringify({ items: [{ path, t: 2, d: 504.7, ts: rec.ts - 1 }] }) });
    await progressSync.pull();
    return progressSync.read(path);
  }, mp3);
  check(deletion.d === 0, "删除后旧设备上传使记录复活");
  results.push({ case: "delete-versus-stale-upload", ...deletion });

  // long: 故意延迟已经离开的根目录响应，确认它不能覆盖当前音频的上下首队列。
  await page.evaluate(() => { location.hash = "#/"; });
  await page.waitForFunction(() => parseRoute().page === "browse" && currentPath === "" && currentListing?.dirs);
  const listingRace = await page.evaluate(async path => {
    const originalFetch = window.fetch;
    let release;
    window.fetch = async (url, options) => {
      const response = await originalFetch(url, options);
      if (url === "/api/list?path=") {
        const data = await response.json();
        data.dirs.push({ name: "late-test" });
        await new Promise(resolve => { release = resolve; });
        return new Response(JSON.stringify(data));
      }
      return response;
    };
    try {
      const delayed = refreshListing("", browseSeq);
      const deadline = Date.now() + 10000;
      while (!release && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
      if (!release) throw new Error("目录延迟测试未拦截到请求");
      location.hash = "#/watch/" + path.split("/").map(encodeURIComponent).join("/");
      while ((currentWatchPath !== path || !playerListing) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
      if (!playerListing) throw new Error("音频目录未就绪");
      const before = playerListing.path;
      release();
      await delayed;
      return { before, after: playerListing.path, previous: findSiblingMedia(path, true, -1), watch: currentWatchPath };
    } finally { if (release) release(); window.fetch = originalFetch; }
  }, m4a);
  check(listingRace.before === "audios" && listingRace.after === "audios" && listingRace.previous === mp3, "迟到目录覆盖播放队列");
  results.push({ case: "late-listing-route-isolation", ...listingRace });

  await page.goto(origin + "/");
  // long: 离开播放页后再建立续播样本，否则正常 pagehide 会用实际播放位置覆盖测试预设。
  await page.evaluate(async path => { writeProgress(path, 50, 1182.1); await progressSync.push(); }, m4a);
  await watch(m4a);
  await page.evaluate(() => video.pause());
  await page.getByRole("button", { name: "从头看", exact: true }).click({ timeout: 5000 });
  const cleared = await page.evaluate(async () => {
    window.dispatchEvent(new Event("pagehide"));
    await progressSync.push();
    return progressSync.read(currentWatchPath);
  });
  check(cleared.d === 0, "清除后未播放就离页丢失删除标记");
  results.push({ case: "restart-then-pagehide", ...cleared });

  await page.addInitScript(() => {
    for (const method of ["getItem", "setItem", "removeItem", "key"]) {
      Storage.prototype[method] = () => { throw new DOMException("storage disabled for test", "SecurityError"); };
    }
    Object.defineProperty(Storage.prototype, "length", { get() { throw new DOMException("storage disabled", "SecurityError"); } });
  });
  await page.goto(origin + "/");
  await watch(mp3);
  const disabled = await page.evaluate(async () => {
    video.pause();
    await progressSync.pull();
    writeProgress(currentWatchPath, 345, video.duration);
    await progressSync.push();
    return { local: readProgress(currentWatchPath), server: (await (await fetch("/api/progress")).json()).items[currentWatchPath] };
  });
  check(disabled.local?.t === 345 && disabled.server?.t === 345, "禁用存储时播放或同步失效");
  results.push({ case: "storage-disabled-network-sync", ...disabled });
  await page.screenshot({ path: "output/playwright/fix-mobile-audio-360.png" });
  check(errors.length === 0, "未捕获页面异常: " + errors.join("; "));
  const report = { passed: results.length, pageErrors: errors, results };
  await page.evaluate(report => { window.__mobileRegressionReport = report; }, report);
  return report;
}
