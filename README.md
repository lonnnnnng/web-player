# 本地音视频在线播放器

一个运行时仅依赖 Python 标准库的本地音视频网页播放器，支持 macOS / Linux 部署，
用浏览器就能播放服务器上已下载好的视频和音乐资源。

原生 Android 音频客户端「本地听」位于 `android/`，默认对接 `http://192.168.1.2/`，支持配置 HTTP/HTTPS 服务地址、前台媒体服务、后台及锁屏播放、播放历史、倍速和可选灵动岛悬浮窗。构建、测试与限制见 [Android 说明](android/README.md)。

## 功能

- **媒体库界面**：浅色 / 深色主题，手机底部导航、桌面侧栏；媒体库、最近播放、文件夹三种视图
- **全库分类与排序**：视频 / 音频筛选，按修改时间、自然名称或文件大小排序，每页 60 条，支持网格 / 列表切换
- **触屏音频控制**：大尺寸播放按钮、进度拖动、前后 10 秒、上下首及同目录播放列表；视频保留原生全屏和字幕菜单
- **加载与失败反馈**：骨架占位、空列表、可重试错误和真实播放记录同步状态
- 📂 **自定义资源目录**：命令行参数 / 环境变量 / config.json 三种方式指定，支持多级子目录浏览
- 🎬 **视频在线播放**：支持 HTTP Range 请求，可随意拖动进度条、边下边播
- 🎵 **音频播放**：mp3 / m4a / flac / wav / ogg 等，带封面式播放界面和播放动画
- ⏯️ **播放进度记忆**：每个视频/音频记住看到的位置，下次打开提示"继续播放"；
  进度自动同步到服务端，换设备/浏览器接着看
- ▶️ **继续观看**：首页顶部一行展示最近没看完的内容，点击直达
- 💬 **自动加载字幕**：`.srt` / `.vtt` 自动挂载（SRT 自动转 VTT），支持多语言字幕
  （`电影.chs.srt` / `电影.eng.srt` 全部挂载，播放器菜单可切换）
- ⏭️ **剧集连播**：按自然排序（第2集排在第10集前）播完自动播放同目录下一个，可一键关闭；
  `N` 键、"下一个"或"下一首"按钮手动切换
- 🔍 **全局搜索**：顶栏搜索框搜索整个资源库的文件与文件夹
- 🖼️ **视频缩略图**：列表页懒加载截取视频画面并本地缓存，重访秒开
- 📱 **移动端体验**：锁屏播放控制与封面（Media Session）、PWA 添加到主屏幕、
  双击视频左/右区域快退/快进
- ⏩ **倍速播放**：0.5x ~ 3x
- ⚙️ **记住播放偏好**：倍速、音量、静音状态自动保存，刷新不丢失
- ⌨️ **快捷键**：`空格` 播放/暂停，`←/→` 快退/快进 10 秒，`↑/↓` 音量，`F` 全屏，`N` 下一集，`Esc` 返回
- 📂 文件大小/修改时间显示、视频时长懒加载显示
- 🔒 **可选密码保护**（HTTP Basic）

## 快速开始

把整个 `web-player` 目录上传到服务器，然后：

**方式一：启动脚本（推荐）**

```bash
# Linux：后台启动（默认读取 config.json 里的视频目录）
bash start.sh

# 带参数后台启动
bash start.sh --dir /data/videos --port 8080

# 其他命令
bash start.sh stop       # 停止后台进程
bash start.sh restart    # 重启
bash start.sh status     # 查看状态
bash start.sh fg         # 前台运行（调试用，Ctrl+C 停止）
```

后台启动使用 `nohup`，日志写入 `player.log`，PID 记录在 `player.pid`，
关掉 SSH 终端后服务继续运行。若日志里提示缺少 `nohup`/`sleep` 等命令属环境异常，正常 Linux 发行版均自带。

Linux/macOS 的停止脚本会核对进程路径、随机启动标识和启动时间，只发送 TERM，不强制 KILL。
旧版仅一行 PID 的 `player.pid` 无法证明进程归属，脚本会保留它并拒绝停止/覆盖；
升级前请先用旧服务的管理方式正常停止，核实进程已退出后再移走旧 PID 文件。

**方式二：直接运行**

```bash
python3 server.py --dir /data/videos --port 8080
```

**Windows**：双击 `start.bat` 启动（可编辑文件顶部的视频目录/端口），
双击 `stop.bat` 停止。

无论哪种方式，启动后控制台会打印**本机 IP 和访问地址**，浏览器打开即可（如 `http://192.168.1.10:8080`）。
无需安装任何第三方库，Python 3.6+ 即可运行（`python3 --version` 检查）。

## 参数说明

| 参数 | 环境变量 | config.json | 说明 |
|------|----------|-------------|------|
| `--dir` | `VIDEO_DIR` | `video_dir` | 音视频资源目录（**必填其一**，默认 `./videos`） |
| `--port` | `PORT` | `port` | 监听端口，默认 `8080` |
| `--host` | `HOST` | `host` | 监听地址，默认 `0.0.0.0`（仅本机访问可改为 `127.0.0.1`） |
| `--password` | `PASSWORD` | `password` | 访问密码，留空不启用；浏览器会弹出登录框，用户名随意填 |

优先级：**命令行参数 > 环境变量 > config.json > 默认值**

## 开机自启（systemd）

创建 `/etc/systemd/system/video-player.service`：

```ini
[Unit]
Description=Local Video Player
After=network.target

[Service]
Type=simple
# 改成实际路径、视频目录和端口
WorkingDirectory=/opt/web-player
ExecStart=/usr/bin/python3 /opt/web-player/server.py --dir /data/videos --port 8080
Restart=always
RestartSec=3
User=www-data

[Install]
WantedBy=multi-user.target
```

启用：

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now video-player
sudo systemctl status video-player   # 查看运行状态
```

## 使用说明

- 首页递归列出全库媒体；从"文件夹"进入目录浏览，从"最近播放"查看历史，点击媒体卡片播放
- 音频使用自定义触屏控件，视频使用浏览器原生控制条；手机系统音量仍以设备自身控制为准
- 排序、网格/列表和主题偏好保存在浏览器；搜索结果进入播放页后点"返回"保留原搜索条件
- **视频格式**：浏览器能直接解码的格式（**mp4 / webm / mov / m4v** 最稳；
  **mkv** 在 Chrome/Edge 通常可以；**avi / wmv / flv / rmvb** 等老格式浏览器不支持
  （列表中会标"兼容性受限"角标），建议转码：`ffmpeg -i 1.avi -c:v libx264 -c:a aac 1.mp4`）
- **音频格式**：**mp3 / m4a / aac / flac / wav / ogg / opus** 均可直接播放
- 字幕：把 `xxx.srt` 放在视频旁边并同名（如 `电影.mp4` + `电影.srt`）即自动加载；
  多语言可命名为 `电影.chs.srt`、`电影.eng.srt` 等，播放时可切换
- 防火墙放行端口：`sudo ufw allow 8080`（或云服务器安全组规则）

## 目录结构

```
web-player/
├── server.py        # 服务端（唯一需要运行的文件）
├── config.json      # 可选配置
├── static/
│   ├── index.html   # 页面
│   ├── style.css    # 样式
│   ├── app.js       # 路由、媒体加载与播放记录接入
│   ├── catalog.js   # 媒体库、搜索、记录与主题
│   ├── player-ui.js # 音频控制与播放列表
│   ├── progress.js # 可靠进度同步
│   ├── utils.js    # 存储适配与字幕转换
│   └── icons.svg   # 已构建的本地 Lucide 图标
├── scripts/build_icons.py # 可选的图标构建脚本
└── videos/          # 默认资源目录（未配置时使用）
```

## 开发验证

运行服务不需要 npm。图标使用固定版本的 Lucide Static，生成的精灵图和 ISC 许可随代码提交，浏览器无需访问 CDN。
仅在更新图标时运行（需要 Python 3.9+ 与 Node/npm）：

```bash
npm ci --ignore-scripts
npm run build:icons
```

提交前可直接运行标准库测试和前端纯函数测试：

```bash
python3 -m unittest discover -s tests -v
node --test tests/test_frontend_utils.js tests/test_progress.js
python3 -m py_compile server.py
node --check static/utils.js
node --check static/progress.js
node --check static/app.js
node --check static/catalog.js
node --check static/player-ui.js
bash -n start.sh
```

### 播放记录的可靠性与边界

- 持续播放约每 3 秒保存本地记录，网络发送再合并约 1 秒；暂停、切换和进入后台立即保存本地。
- 前台使用 fetch，收到服务端落盘确认后才清除待同步记录。失败按 2～30 秒退避重试，联网或返回前台时立即再试。
- 待同步队列保存在本地，正常存储环境下刷新后可补传。后台 beacon 只是尽力发送，不当作保存成功。
- 新旧记录按秒时间戳比较，新客户端保留毫秒精度。同时间戳删除优先，其他冲突保留服务端先保存的版本。
  清除操作保留 `d: 0` 的删除标记，防止离线设备的旧记录复活；开始新的播放后可产生更新的记录。
- 多设备需保持系统时间准确；这不是多人实时协作协议。旧版浏览器页面应刷新后再使用新服务端。
- 浏览器拒绝本地存储时退化为会话内记录，仍尝试网络同步；此时断网并关闭页面，无法保证未上传记录恢复。
  缩略图限制为 40 条、约 2 MB，配额不足时优先让位给播放记录；封面探测最多同时解码两个媒体。
- 续播提示等待用户选择，不自动消失；尚未选择续播/从头播放时，初始位置不会覆盖上次记录。
- 服务端记录读取损坏、权限不足或写盘失败返回 503，并保留原文件；修复权限/磁盘或从备份恢复后重试。

### 手机触屏浏览器回归

真实资源脚本使用 `videos/1.mp4`、`audios/500w播放福利厨房大作战.mp3`、`audios/番外一 .m4a`。
**只能对隔离测试服务运行**，脚本会注入同步失败和存储不可用情形，不应连接正式记录库：

```bash
python3 tests/mobile_server.py --dir /path/to/resources
# 在另一个终端，把下面地址换成上一条命令打印的 TEST_URL
playwright-cli -s=mobile-regression open http://127.0.0.1:PORT/ --mobile
playwright-cli -s=mobile-regression run-code --filename tests/browser_mobile.js
playwright-cli -s=mobile-regression close

# UI 回归使用新的浏览器会话，避免上一组存储故障注入继续生效
playwright-cli -s=ui-regression open http://127.0.0.1:PORT/ --mobile
playwright-cli -s=ui-regression run-code --filename tests/browser_ui.js
playwright-cli -s=ui-regression run-code --filename tests/browser_ui_edges.js
playwright-cli -s=ui-regression close
```

截图输出到 `output/playwright/`。浏览器需另行提供 Playwright CLI，不属于应用运行依赖。
触屏浏览器模拟不能替代 Android/iPhone 真机对系统音量、锁屏及后台存活的验收。
UI 边界脚本会使用受控分页响应验证重复条目、返回滚动位置和请求竞态；视频帧与音频播放仍读取真实资源。

## 安全说明

- 服务端对路径做了严格校验，无法通过 `..` 等方式访问视频目录之外的文件
- 该工具面向个人/内网使用，如需暴露公网，建议启用密码，并配合 nginx 反代 + HTTPS
