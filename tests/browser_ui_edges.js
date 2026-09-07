// long: 分页与竞态用受控响应覆盖边界；实际播放仍读取资源目录中的 MP3、MP4。
async (page) => {
  const origin = await page.evaluate(() => location.origin);
  if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(origin)) throw new Error("仅允许隔离测试服务");
  const check = (value, message) => { if (!value) throw new Error(message); };
  const results = [];
  await page.goto(origin + "/");
  await page.waitForFunction(() => !catalogState.loading && catalogState.items.length === 3);
  const real = await page.evaluate(() => catalogState.items.find(item => item.ext === "mp3"));
  const fixtures = Array.from({ length: 61 }, (_, i) => ({ name: `entry-${i}.avi`, path: `ui-fixture/entry-${i}.avi`, ext: "avi", kind: "video", size: 10, mtime: 100 }));
  fixtures[59] = real;
  await page.route("**/api/library?**", async route => {
    const offset = await page.evaluate(url => Number(new URL(url).searchParams.get("offset")), route.request().url());
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({
      items: offset === 0 ? fixtures.slice(0, 60) : [fixtures[59], fixtures[60]],
      counts: { video: 60, audio: 1 }, total: 61, offset, has_more: offset === 0,
    }) });
  });
  await page.setViewportSize({ width: 360, height: 732 });
  await page.locator("#refresh-library").click();
  await page.waitForFunction(() => !catalogState.loading && catalogState.items.length === 60);
  await page.locator("#load-more").click();
  await page.waitForFunction(() => catalogState.items.length === 61);
  check(await page.locator(".file-card").count() === 61, "分页没有追加或去重");
  await page.locator(`.file-card[data-media-path="${real.path}"]`).click();
  await page.waitForFunction(() => video.readyState >= 1 && playerListing);
  await page.evaluate(() => video.pause());
  const before = await page.evaluate(() => scrollPositions.get("library:"));
  await page.locator("#btn-back").click();
  await page.waitForFunction(() => !catalogState.loading && catalogState.items.length === 61);
  await page.waitForFunction(before => Math.abs(scrollY - before) < 4, before);
  check(before > 1000, "分页返回测试未真正滚动");
  await page.unroute("**/api/library?**");
  await page.evaluate(() => { catalogState.sort = "newest"; updateCatalogControls(); reloadCatalog(); });
  await page.waitForFunction(() => !catalogState.loading && catalogState.items.length === 3);
  results.push({ case: "pagination-dedup-and-scroll-return", scroll: before });

  const race = await page.evaluate(async () => {
    const originalFetch = window.fetch;
    let release;
    window.fetch = async (url, options) => {
      const response = await originalFetch(url, options);
      if (String(url).startsWith("/api/library?") && new URL(url, location.origin).searchParams.get("kind") === "all") {
        await new Promise(resolve => { release = resolve; });
      }
      return response;
    };
    try {
      const delayed = loadLibrary();
      const deadline = Date.now() + 5000;
      while (!release && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
      if (!release) throw new Error("没有截获全库请求");
      catalogState.kind = "audio";
      updateCatalogControls();
      await loadLibrary();
      release();
      await delayed;
      return { kind: catalogState.kind, kinds: catalogState.items.map(item => item.kind) };
    } finally { if (release) release(); window.fetch = originalFetch; }
  });
  check(race.kind === "audio" && race.kinds.length === 2 && race.kinds.every(kind => kind === "audio"), "迟到的全库结果覆盖了音频筛选");
  results.push({ case: "late-library-filter-isolation", ...race });

  await page.locator(`.file-card[data-media-path="${real.path}"]`).click();
  await page.waitForFunction(() => video.readyState >= 1 && playerListing);
  await page.evaluate(() => video.pause());
  await page.locator("#btn-play").focus();
  await page.keyboard.press("Space");
  await page.waitForFunction(() => !video.paused);
  await page.keyboard.press("Space");
  await page.waitForFunction(() => video.paused);
  for (const [width, height, fontSize] of [[320, 568, ""], [390, 844, ""], [844, 390, ""], [320, 568, "32px"], [1440, 1000, ""]]) {
    await page.setViewportSize({ width, height });
    await page.evaluate(size => { document.documentElement.style.fontSize = size; window.scrollTo(0, 0); }, fontSize);
    const layout = await page.evaluate(() => {
      const controls = [...document.querySelectorAll(".transport button")].map(el => el.getBoundingClientRect());
      return { overflow: document.documentElement.scrollWidth > innerWidth, overlap: controls.some((rect, i) => i > 0 && rect.left < controls[i - 1].right) };
    });
    check(!layout.overflow && !layout.overlap, `音频控件在 ${width}px / ${fontSize || "默认文字"} 下溢出或重叠`);
    await page.screenshot({ path: `output/playwright/ui-player-${width}${fontSize ? "-text200" : ""}.png`, fullPage: true });
  }
  results.push({ case: "player-keyboard-touch-targets-and-text-scale", passed: true });

  await page.evaluate(() => { document.documentElement.style.fontSize = ""; location.hash = "#/watch/videos/1.mp4"; });
  await page.waitForFunction(() => currentWatchPath === "videos/1.mp4" && video.readyState >= 2 && playerListing);
  await page.evaluate(async () => { hideResumeToast(); video.currentTime = 1; await video.play(); });
  await page.waitForFunction(() => video.currentTime > 2);
  await page.evaluate(() => video.pause());
  const pixels = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 48; canvas.height = 27;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(video, 0, 0, 48, 27);
    const data = ctx.getImageData(0, 0, 48, 27).data;
    const colors = new Set();
    for (let i = 0; i < data.length; i += 4) colors.add([data[i] >> 4, data[i + 1] >> 4, data[i + 2] >> 4].join(","));
    return { colors: colors.size, time: video.currentTime, duration: video.duration, controls: video.controls };
  });
  check(pixels.colors > 20 && pixels.controls, "真实视频帧为空或原生控件缺失");
  for (const [width, height] of [[320, 568], [390, 844], [844, 390], [1440, 1000]]) {
    await page.setViewportSize({ width, height });
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}px 视频页横向溢出`);
    await page.screenshot({ path: `output/playwright/ui-video-${width}.png`, fullPage: true });
  }
  results.push({ case: "real-video-rendered-frame-and-responsive", ...pixels });
  await page.goto(origin + "/");
  await page.setViewportSize({ width: 390, height: 844 });
  return { passed: results.length, results };
}
