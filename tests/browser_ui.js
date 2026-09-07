// long: 使用只读真实媒体与临时记录服务，模拟数据仅限浏览器响应，不写入用户资源目录。
async (page) => {
  const origin = await page.evaluate(() => location.origin);
  if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(origin)) throw new Error("仅允许隔离测试服务");
  const check = (ok, message) => { if (!ok) throw new Error(message); };
  const results = [], errors = [];
  page.on("pageerror", error => errors.push(error.message));
  const mp3 = "audios/500w播放福利厨房大作战.mp3", m4a = "audios/番外一 .m4a";
  const card = path => page.locator(".file-card").filter({ has: page.locator(`.file-thumb[data-path="${path}"]`) });
  const ready = () => page.waitForFunction(() => !catalogState.loading && document.querySelectorAll(".file-card").length > 0);
  await page.goto(origin + "/");
  await ready();
  await page.setViewportSize({ width: 390, height: 844 });
  check(await page.locator(".file-card").count() === 3, "全库没有显示三个真实媒体");
  await page.locator('button[data-kind="audio"]').click();
  await page.waitForFunction(() => !catalogState.loading && document.querySelectorAll(".file-card").length === 2);
  check(await page.locator(".file-card.is-audio").count() === 2, "音频筛选错误");
  await page.locator('button[data-kind="video"]').click();
  await page.waitForFunction(() => !catalogState.loading && document.querySelectorAll(".file-card").length === 1);
  await page.locator('button[data-kind="all"]').click();
  await page.waitForFunction(() => !catalogState.loading && document.querySelectorAll(".file-card").length === 3);
  await page.getByLabel("排序方式").selectOption("size");
  await page.waitForFunction(() => !catalogState.loading && catalogState.items[0]?.size > 60000000);
  check(await page.locator(".file-card").first().getAttribute("data-media-path") === m4a, "大小排序没有显示真实最大文件");
  await page.getByRole("button", { name: "列表视图", exact: true }).click();
  await page.reload();
  await ready();
  check(await page.locator("#file-grid").evaluate(el => el.classList.contains("is-list")), "列表视图偏好未保存");
  await page.getByRole("button", { name: "网格视图", exact: true }).click();
  results.push({ case: "library-filter-sort-layout", passed: true });

  const priorTheme = await page.evaluate(() => document.documentElement.dataset.theme);
  await page.locator("#theme-toggle").click();
  await page.reload();
  await ready();
  check(await page.evaluate(() => document.documentElement.dataset.theme) !== priorTheme, "主题偏好未保存");
  await page.screenshot({ path: "output/playwright/ui-library-dark-390.png" });
  await page.evaluate(() => { storage.setItem("vp-theme", "light"); setTheme("light"); });
  results.push({ case: "theme-persistence", passed: true });

  await page.getByRole("searchbox").fill("500w");
  await page.waitForFunction(() => searchActive && !catalogState.loading && document.querySelectorAll(".file-card").length === 1);
  await card(mp3).click();
  await page.waitForFunction(path => currentWatchPath === path && video.readyState >= 1 && playerListing, mp3);
  await page.locator("#btn-back").click();
  await page.waitForFunction(() => searchActive && !catalogState.loading && document.querySelectorAll(".file-card").length === 1);
  check(await page.getByRole("searchbox").inputValue() === "500w", "播放后返回丢失搜索条件");
  await page.getByRole("searchbox").fill("missing-resource-ui-test");
  await page.getByRole("heading", { name: "没有找到匹配的内容" }).waitFor();
  await page.getByRole("button", { name: "清空搜索" }).click();
  await ready();
  await page.locator('.mobile-nav [data-view="folders"]').click();
  await page.waitForFunction(() => catalogState.view === "folders" && !catalogState.loading);
  await page.locator(".folder-card").filter({ hasText: "audios" }).click();
  await ready();
  check(await page.locator(".file-card").count() === 2, "文件夹导航错误");
  await page.locator('.mobile-nav [data-view="library"]').click();
  await ready();
  results.push({ case: "search-back-empty-and-folders", passed: true });

  await card(mp3).click();
  await page.waitForFunction(path => currentWatchPath === path && video.readyState >= 1 && playerListing, mp3);
  await page.evaluate(() => { video.pause(); video.currentTime = 20; });
  await page.getByRole("button", { name: "播放", exact: true }).click();
  await page.waitForFunction(() => !video.paused && video.currentTime > 20.2);
  await page.getByRole("button", { name: "暂停", exact: true }).click();
  await page.getByRole("button", { name: "前进 10 秒" }).click();
  check(await page.evaluate(() => video.currentTime >= 30), "快进没有生效");
  await page.getByRole("button", { name: "后退 10 秒" }).click();
  check(await page.evaluate(() => video.currentTime < 25), "快退没有生效");
  const seek = await page.getByRole("slider", { name: "播放进度" }).boundingBox();
  await page.touchscreen.tap(seek.x + seek.width * .5, seek.y + seek.height * .5);
  check(await page.evaluate(() => video.currentTime > 200 && video.currentTime < 300), "触屏拖动进度未生效");
  await page.getByLabel("播放速度", { exact: true }).selectOption("1.5");
  check(await page.evaluate(() => video.playbackRate === 1.5), "倍速未更新");
  const autoplayBefore = await page.getByRole("switch", { name: "自动连播" }).getAttribute("aria-checked");
  await page.getByRole("switch", { name: "自动连播" }).click();
  check(await page.getByRole("switch", { name: "自动连播" }).getAttribute("aria-checked") !== autoplayBefore, "连播开关未切换");
  await page.getByRole("button", { name: "下一首", exact: true }).click();
  await page.waitForFunction(path => currentWatchPath === path && video.duration > 1000 && playerListing, m4a);
  await page.evaluate(() => video.pause());
  check(await page.locator('.queue-item[aria-current="true"]').count() === 1, "队列当前歌曲标记错误");
  await page.getByRole("button", { name: "上一首", exact: true }).click();
  await page.waitForFunction(path => currentWatchPath === path && video.readyState >= 1 && playerListing, mp3);
  await page.evaluate(() => video.pause());
  check(await page.getByRole("button", { name: "上一首", exact: true }).isDisabled(), "第一首的上一首按钮未禁用");
  check(await page.evaluate(() => readProgress(currentWatchPath)?.t >= 200), "等待续播选择时初始位置覆盖了上次记录");
  await page.getByLabel("播放速度", { exact: true }).selectOption("1");
  await page.screenshot({ path: "output/playwright/ui-audio-390.png", fullPage: true });
  results.push({ case: "real-audio-touch-controls-and-queue", passed: true });

  await page.locator("#btn-back").click();
  await ready();
  await page.locator('.mobile-nav [data-view="recent"]').click();
  await ready();
  check(await page.locator(".file-card").count() > 0, "播放记录没有出现在最近播放页");
  await page.screenshot({ path: "output/playwright/ui-history-390.png" });
  await page.locator('.mobile-nav [data-view="library"]').click();
  await ready();
  results.push({ case: "recent-and-continue", passed: true });

  for (const [width, height] of [[320, 568], [360, 732], [390, 844], [768, 1024], [1440, 1000], [844, 390]]) {
    await page.setViewportSize({ width, height });
    await page.evaluate(() => window.scrollTo(0, 0));
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}px 媒体库横向溢出`);
    await page.screenshot({ path: `output/playwright/ui-library-${width}.png` });
  }
  await page.setViewportSize({ width: 320, height: 568 });
  await page.evaluate(() => { document.documentElement.style.fontSize = "32px"; });
  check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "200% 文字导致页面横向溢出");
  await page.screenshot({ path: "output/playwright/ui-text-200.png", fullPage: true });
  await page.evaluate(() => { document.documentElement.style.fontSize = ""; });
  await page.emulateMedia({ reducedMotion: "reduce" });
  const reduced = await page.evaluate(() => getComputedStyle(document.querySelector(".file-thumb .icon")).transitionDuration);
  check(reduced === "0s", "减少动态效果偏好未生效");
  await page.emulateMedia({ reducedMotion: "no-preference" });
  results.push({ case: "responsive-320-to-desktop-and-text-scale", passed: true });

  await page.route("**/api/library?**", route => route.fulfill({ status: 503, contentType: "application/json", body: '{"error":"test unavailable"}' }));
  await page.getByRole("button", { name: "刷新媒体库", exact: true }).click();
  await page.getByRole("heading", { name: "加载失败", exact: true }).waitFor();
  await page.unroute("**/api/library?**");
  await page.getByRole("button", { name: "重新加载", exact: true }).click();
  await ready();
  results.push({ case: "library-failure-and-retry", passed: true });

  const escaped = await page.evaluate(() => {
    const before = location.href;
    history.replaceState(null, "", "#/watch/audios/question%3F%23.mp3");
    const route = parseRoute();
    history.replaceState(null, "", before);
    return route;
  });
  check(escaped.path === "audios/question?#.mp3", "查询参数破坏了含特殊字符的文件路径");
  check(errors.length === 0, "页面异常: " + errors.join("; "));
  await page.setViewportSize({ width: 390, height: 844 });
  return { passed: results.length, pageErrors: errors, results };
}
