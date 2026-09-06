# 本地音视频在线播放器

一个零依赖（仅 Python 标准库）的本地音视频网页播放器，部署到 Linux 服务器后，
用浏览器就能播放服务器上已下载好的视频和音乐资源。

## 功能

- 📂 **自定义资源目录**：命令行参数 / 环境变量 / config.json 三种方式指定，支持多级子目录浏览
- 🎬 **视频在线播放**：支持 HTTP Range 请求，可随意拖动进度条、边下边播
- 🎵 **音频播放**：mp3 / m4a / flac / wav / ogg 等，带封面式播放界面和播放动画
- ⏯️ **播放进度记忆**：每个视频/音频记住看到的位置，下次打开提示"继续播放"；
  进度自动同步到服务端，换设备/浏览器接着看
- ▶️ **继续观看**：首页顶部一行展示最近没看完的内容，点击直达
- 💬 **自动加载字幕**：`.srt` / `.vtt` 自动挂载（SRT 自动转 VTT），支持多语言字幕
  （`电影.chs.srt` / `电影.eng.srt` 全部挂载，播放器菜单可切换）
- ⏭️ **剧集连播**：按自然排序（第2集排在第10集前）播完自动播放同目录下一个，可一键关闭；
  `N` 键或"下一集"按钮手动切换
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

- 首页列出资源根目录，点击文件夹进入子目录，点击卡片开始播放（视频/音频自动区分）
- **视频格式**：浏览器能直接解码的格式（**mp4 / webm / mov / m4v** 最稳；
  **mkv** 在 Chrome/Edge 通常可以；**avi / wmv / flv / rmvb** 等老格式浏览器不支持
  （列表中会标"不支持"角标），建议转码：`ffmpeg -i 1.avi -c:v libx264 -c:a aac 1.mp4`）
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
│   └── app.js       # 前端逻辑
└── videos/          # 默认资源目录（未配置时使用）
```

## 开发验证

项目保持零第三方依赖，提交前可直接运行标准库测试和前端纯函数测试：

```bash
python3 -m unittest discover -s tests -v
node --test tests/test_frontend_utils.js
python3 -m py_compile server.py
node --check static/utils.js
node --check static/app.js
```

## 安全说明

- 服务端对路径做了严格校验，无法通过 `..` 等方式访问视频目录之外的文件
- 该工具面向个人/内网使用，如需暴露公网，建议启用密码，并配合 nginx 反代 + HTTPS
