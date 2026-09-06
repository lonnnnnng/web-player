#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
本地视频在线播放器服务端

仅依赖 Python 标准库，无需 pip 安装任何东西。

用法:
    python3 server.py                          # 使用 config.json / 默认目录 ./videos
    python3 server.py --dir /data/movies       # 指定视频目录
    python3 server.py --port 8080 --host 0.0.0.0
    python3 server.py --password mypass        # 开启简单密码保护(HTTP Basic)

配置优先级: 命令行参数 > 环境变量 > config.json > 默认值
"""

import argparse
import base64
import json
import os
import re
import sys
import time
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

# 支持的视频扩展名
VIDEO_EXTS = {".mp4", ".m4v", ".mkv", ".webm", ".mov", ".avi", ".flv",
              ".ts", ".mts", ".m2ts", ".wmv", ".mpg", ".mpeg", ".3gp", ".ogv"}
# 支持的音频扩展名（浏览器可直接解码的格式）
AUDIO_EXTS = {".mp3", ".m4a", ".aac", ".flac", ".wav", ".ogg", ".opus"}
# 支持的字幕扩展名（浏览器可显示的，或前端可转换的）
SUB_EXTS = {".srt", ".vtt"}

MIME = {
    ".mp4": "video/mp4", ".m4v": "video/mp4",
    ".mkv": "video/x-matroska",
    ".webm": "video/webm", ".ogv": "video/ogg",
    ".mov": "video/quicktime",
    ".ts": "video/mp2t", ".mts": "video/mp2t", ".m2ts": "video/mp2t",
    ".mp3": "audio/mpeg", ".m4a": "audio/mp4", ".aac": "audio/aac",
    ".flac": "audio/flac", ".wav": "audio/wav", ".ogg": "audio/ogg",
    ".opus": "audio/opus",
    ".srt": "text/plain; charset=utf-8", ".vtt": "text/vtt; charset=utf-8",
}

STATIC_DIR = os.path.join(BASE_DIR, "static")
STATIC_MIME = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".ico": "image/x-icon",
}

# 全局配置（启动时由 main() 填充）
CONFIG = {
    "video_dir": os.path.join(BASE_DIR, "videos"),
    "password": "",
}


class VideoRequestHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "VideoPlayer/1.0"

    # ---------- 基础 ----------

    def log_message(self, fmt, *args):
        sys.stderr.write("[%s] %s\n" % (self.log_date_time_string(), fmt % args))

    def send_json(self, obj, status=200):
        data = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def send_error_json(self, status, msg):
        self.send_json({"error": msg}, status)

    def check_auth(self):
        """密码为空表示不启用鉴权。"""
        if not CONFIG["password"]:
            return True
        auth = self.headers.get("Authorization", "")
        if auth.startswith("Basic "):
            try:
                userpass = base64.b64decode(auth[6:].strip()).decode("utf-8")
                # 用户名随意，密码匹配即可
                if ":" in userpass and userpass.split(":", 1)[1] == CONFIG["password"]:
                    return True
            except Exception:
                pass
        self.send_response(401)
        self.send_header("WWW-Authenticate", 'Basic realm="Video Player"')
        self.send_header("Content-Length", "0")
        self.end_headers()
        return False

    # ---------- 路径安全 ----------

    def resolve_under_root(self, rel):
        """把 URL 中的相对路径解析为根目录下的绝对路径，越界返回 None。"""
        rel = (rel or "").strip().strip("/")
        if rel in ("", "."):
            return CONFIG["video_dir"]
        parts = rel.split("/")
        if any(p in ("", "..", ".") for p in parts):
            return None
        root_real = os.path.realpath(CONFIG["video_dir"])
        target = os.path.realpath(os.path.join(root_real, *parts))
        if target != root_real and not target.startswith(root_real + os.sep):
            return None
        return target

    # ---------- 请求路由 ----------

    def do_GET(self):
        if not self.check_auth():
            return
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        query = urllib.parse.parse_qs(parsed.query)

        if path == "/" or path == "/index.html":
            self.serve_static_file("index.html")
        elif path.startswith("/static/"):
            self.serve_static_file(path[len("/static/"):])
        elif path == "/favicon.ico":
            self.send_response(204)
            self.send_header("Content-Length", "0")
            self.end_headers()
        elif path == "/api/list":
            self.api_list(query)
        elif path == "/api/file":
            self.api_file(query, head_only=False)
        else:
            self.send_error_json(404, "not found")

    def do_HEAD(self):
        if not self.check_auth():
            return
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/api/file":
            self.api_file(urllib.parse.parse_qs(parsed.query), head_only=True)
        else:
            self.send_response(200)
            self.send_header("Content-Length", "0")
            self.end_headers()

    # ---------- 静态文件 ----------

    def serve_static_file(self, rel):
        rel = rel.replace("\\", "/").lstrip("/")
        parts = [p for p in rel.split("/") if p not in ("", "..", ".")]
        fp = os.path.join(STATIC_DIR, *parts)
        fp = os.path.realpath(fp)
        if not fp.startswith(os.path.realpath(STATIC_DIR) + os.sep) and fp != os.path.realpath(STATIC_DIR):
            self.send_error_json(403, "forbidden")
            return
        if not os.path.isfile(fp):
            self.send_error_json(404, "not found")
            return
        ext = os.path.splitext(fp)[1].lower()
        with open(fp, "rb") as f:
            data = f.read()
        self.send_response(200)
        self.send_header("Content-Type", STATIC_MIME.get(ext, "application/octet-stream"))
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        self.wfile.write(data)

    # ---------- API: 目录列表 ----------

    def api_list(self, query):
        rel = query.get("path", [""])[0]
        target = self.resolve_under_root(rel)
        if target is None or not os.path.isdir(target):
            self.send_error_json(404, "目录不存在")
            return

        dirs, videos, audios, subs = [], [], [], []
        try:
            entries = os.scandir(target)
        except PermissionError:
            self.send_error_json(403, "无权限读取该目录")
            return
        with entries:
            for e in entries:
                name = e.name
                if name.startswith("."):
                    continue
                try:
                    if e.is_dir():
                        dirs.append({"name": name, "type": "dir"})
                    elif e.is_file():
                        ext = os.path.splitext(name)[1].lower()
                        st = e.stat()
                        item = {
                            "name": name, "type": "file", "ext": ext.lstrip("."),
                            "size": st.st_size, "mtime": int(st.st_mtime),
                        }
                        if ext in VIDEO_EXTS:
                            item["kind"] = "video"
                            videos.append(item)
                        elif ext in AUDIO_EXTS:
                            item["kind"] = "audio"
                            audios.append(item)
                        elif ext in SUB_EXTS:
                            item["kind"] = "subtitle"
                            subs.append(item)
                except OSError:
                    continue

        dirs.sort(key=lambda x: x["name"].lower())
        videos.sort(key=lambda x: x["name"].lower())
        audios.sort(key=lambda x: x["name"].lower())
        subs.sort(key=lambda x: x["name"].lower())

        self.send_json({
            "path": rel.strip("/"),
            "dirs": dirs,
            "videos": videos,
            "audios": audios,
            "subs": subs,
        })

    # ---------- API: 文件流（支持 Range） ----------

    def api_file(self, query, head_only):
        rel = query.get("path", [""])[0]
        target = self.resolve_under_root(rel)
        if target is None:
            self.send_error_json(403, "forbidden")
            return
        if not os.path.isfile(target):
            self.send_error_json(404, "文件不存在")
            return

        ext = os.path.splitext(target)[1].lower()
        ctype = MIME.get(ext, "application/octet-stream")
        size = os.path.getsize(target)

        range_header = self.headers.get("Range")
        start, end = 0, size - 1
        status = 200

        if range_header:
            m = re.match(r"bytes=(\d*)-(\d*)$", range_header.strip())
            if m and (m.group(1) or m.group(2)):
                if m.group(1):  # bytes=start-end
                    start = int(m.group(1))
                    if m.group(2):
                        end = min(int(m.group(2)), size - 1)
                else:           # bytes=-N （最后 N 字节）
                    start = max(0, size - int(m.group(2)))
                if start > end or start >= size:
                    self.send_response(416)
                    self.send_header("Content-Range", "bytes */%d" % size)
                    self.send_header("Content-Length", "0")
                    self.end_headers()
                    return
                status = 206

        length = end - start + 1
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Content-Length", str(length))
        if status == 206:
            self.send_header("Content-Range", "bytes %d-%d/%d" % (start, end, size))
        filename = os.path.basename(target)
        try:
            quoted = urllib.parse.quote(filename)
            self.send_header("Content-Disposition", "inline; filename*=UTF-8''%s" % quoted)
        except Exception:
            pass
        self.end_headers()
        if head_only:
            return

        CHUNK = 256 * 1024
        with open(target, "rb") as f:
            f.seek(start)
            remaining = length
            while remaining > 0:
                chunk = f.read(min(CHUNK, remaining))
                if not chunk:
                    break
                try:
                    self.wfile.write(chunk)
                except (BrokenPipeError, ConnectionResetError):
                    return
                remaining -= len(chunk)


def load_config_file():
    """读取 config.json（可选）。"""
    cfg_path = os.path.join(BASE_DIR, "config.json")
    if os.path.isfile(cfg_path):
        try:
            with open(cfg_path, "r", encoding="utf-8") as f:
                data = json.load(f)
            if data.get("video_dir"):
                CONFIG["video_dir"] = data["video_dir"]
            if "password" in data:
                CONFIG["password"] = str(data["password"] or "")
            return data
        except Exception as e:
            print("警告: 读取 config.json 失败: %s" % e)
    return {}


def main():
    parser = argparse.ArgumentParser(description="本地视频在线播放器")
    parser.add_argument("--dir", "-d", help="视频资源目录（优先级最高）")
    parser.add_argument("--port", "-p", type=int, help="监听端口，默认 8080")
    parser.add_argument("--host", default=None, help="监听地址，默认 0.0.0.0")
    parser.add_argument("--password", help="访问密码（HTTP Basic，留空则不启用）")
    args = parser.parse_args()

    file_cfg = load_config_file()

    # 优先级: 命令行 > 环境变量 > config.json > 默认
    video_dir = args.dir or os.environ.get("VIDEO_DIR") or CONFIG["video_dir"]
    port = args.port or int(os.environ.get("PORT") or file_cfg.get("port") or 8080)
    host = args.host or os.environ.get("HOST") or file_cfg.get("host") or "0.0.0.0"
    password = args.password or os.environ.get("PASSWORD") or str(file_cfg.get("password") or "")
    CONFIG["password"] = password

    video_dir = os.path.abspath(video_dir)
    CONFIG["video_dir"] = video_dir

    if not os.path.isdir(video_dir):
        try:
            os.makedirs(video_dir)
            print("视频目录不存在，已创建: %s" % video_dir)
        except OSError as e:
            print("错误: 无法创建视频目录 %s: %s" % (video_dir, e))
            sys.exit(1)

    if not os.path.isdir(STATIC_DIR):
        print("错误: 缺少 static 目录: %s" % STATIC_DIR)
        sys.exit(1)

    server = ThreadingHTTPServer((host, port), VideoRequestHandler)
    print("=" * 50)
    print("  本地视频播放器已启动")
    print("  视频目录 : %s" % video_dir)
    print("  监听地址 : http://%s:%d/" % (host if host != "0.0.0.0" else "0.0.0.0(所有网卡)", port))
    print("  密码保护 : %s" % ("已启用" if password else "未启用"))
    print("=" * 50)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n已停止")
        server.server_close()


if __name__ == "__main__":
    main()
