# 路线图

基于现有代码评审得出的开发计划，按「正确性 → 低成本高价值 → 体验补强 → 进阶」分阶段推进。
每完成一项就把 `[ ]` 改成 `[x]`。

## 阶段 0：正确性修复（先于一切新功能）

- [x] **P0 启动崩溃**：`ThreadingHTTPServer` 构造时 `server_bind()` 会对监听地址做
  `socket.getfqdn()` 反向解析，主机名含非 ASCII 字符（中文电脑名的 Mac/部分 Linux 很常见）
  时抛 `UnicodeEncodeError`，服务无法启动。修法：子类化覆盖 `server_bind`，跳过反解。
- [x] 切换视频时"继续播放"toast 不清理：10 秒内从视频 A 切到 B，A 的 toast 仍叠在 B 上，
  点"继续播放"会把 B seek 到 A 的进度（`static/app.js` `renderWatch` 开头未隐藏 toast）。
- [x] 元数据未加载时点"继续播放"失效：`seekTo` 直接算 `saved * video.duration`，
  duration 为 NaN 时赋值无效（格式不支持的文件永远 NaN）；toast 文案会短暂出现
  "上次看到 上次位置"。
- [x] 视频解码失败零反馈：`<video>` 未监听 `error`，点开 avi/rmvb 等不支持的格式只有黑屏，
  应提示"浏览器不支持该格式"。
- [x] 进度存储加固：按比例存储在文件替换后会错位，改为存绝对秒数并校验 duration；
  目前仅 timeupdate 每 3 秒 debounce 保存，应在 `pagehide`/`visibilitychange` 补一次 flush。

## 阶段 1：低成本、高价值功能

- [x] **全局搜索**：新增 `/api/search?q=` 递归扫描，顶栏搜索框全库生效（现在只能过滤当前目录）。
- [x] **剧集连播**：文件名自然排序（"第2集"排在"第10集"前）；播完自动播同目录下一个视频；
  播放页加"下一集"按钮。
- [x] **多字幕挂载**：同名/同前缀的多个 `.srt/.vtt`（如 `.chs/.eng`）全部挂成 track，
  用浏览器原生菜单切换（现在只挂第一个匹配的）。
- [x] **记住倍速和音量**：localStorage 持久化，刷新后不重置。

## 阶段 2：体验补强

- [x] **进度服务端化 + 首页"继续观看"**：新增 `/api/progress`，进度落服务端 JSON 文件
  （保持零依赖），跨设备续看；首页顶部加"继续观看"一行。
- [x] **不支持格式的显式处理**：列表页给 avi/wmv/rmvb 等打"不支持"角标；播放失败时
  给出转码命令提示。（ffmpeg 实时转码端点移入远期）
- [x] **浏览页状态保持**：从播放页返回时不再重新 fetch、滚动归零；按路径缓存 listing + 恢复滚动位置。

## 阶段 3：进阶

- [x] **视频缩略图**：复用现有 IntersectionObserver 探测机制，seek 到 10% 处 canvas 截帧，
  结果按 mtime 缓存到 localStorage；解码失败回退现有图标。
- [x] **移动端体验包**：Media Session API（锁屏封面/控制）、PWA manifest（添加到主屏幕）、
  双击左右区域快退快进。
- [x] **HTTP 缓存**：`/api/file` 补 `Last-Modified`/`ETag`（重播同一视频可走缓存）；
  静态文件补缓存头，避免每次全量读入内存。

## 远期 / 工程化

- [ ] 补 LICENSE（当前仓库缺失）
- [ ] 抽取 `resolve_under_root`、Range 解析、`srtToVtt` 为可测纯函数并加单测（安全性所在）
- [ ] ffmpeg 检测 + 实时转码端点（直接播放 avi/rmvb 等老格式，可选能力）
- [ ] 收藏/星标
- [ ] 音频专辑视图（按文件夹成专辑，纯 JS 解析 ID3/FLAC 内嵌封面）
- [ ] Dockerfile 一键部署

## 已知不做的

- 上传/管理功能：违背"播放已下载资源"的定位
- 引入前端框架/构建链：保持零依赖单文件
