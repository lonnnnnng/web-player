#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
本地音视频在线播放器服务端

仅依赖 Python 标准库，无需 pip 安装任何东西。

用法:
    python3 server.py                          # 使用 config.json / 默认目录 ./videos
    python3 server.py --dir /data/movies       # 指定音视频资源目录
    python3 server.py --port 8080 --host 0.0.0.0
    python3 server.py --password mypass        # 开启简单密码保护(HTTP Basic)

配置优先级: 命令行参数 > 环境变量 > config.json > 默认值
"""

import argparse
import base64
import heapq
import json
import os
import re
import socket
import socketserver
import subprocess
import sys
import threading
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
    ".webmanifest": "application/manifest+json",
}

# 全局配置（启动时由 main() 填充）
CONFIG = {
    "video_dir": os.path.join(BASE_DIR, "videos"),
    "password": "",
}

# 播放进度落盘文件（跨设备同步），并发写入用锁串行化
PROGRESS_PATH = os.path.join(BASE_DIR, "player-progress.json")
PROGRESS_LOCK = threading.Lock()


def normalize_relative_path(rel):
    """规范化 URL 相对路径，统一分隔符并拒绝越界、空段和 NUL 字符。"""
    if not isinstance(rel, str):
        return None
    rel = rel.replace("\\", "/").strip("/")
    if rel in ("", "."):
        return ""
    parts = rel.split("/")
    # long: 目录和进度键共用同一套路径规则，避免 Windows 反斜杠绕过越界检查，
    # 也避免把重复分隔符或特殊段写入跨设备进度存储。
    if any(not part or part in (".", "..") or "\x00" in part for part in parts):
        return None
    return "/".join(parts)


def parse_range_header(value, size):
    """解析单段 bytes Range，返回 (start, end)；格式错误返回 None，越界返回 (-1, -1)。"""
    if not value or size <= 0:
        return None
    match = re.fullmatch(r"bytes=(\d*)-(\d*)", value.strip())
    if not match or not (match.group(1) or match.group(2)):
        return None
    try:
        if match.group(1):
            start = int(match.group(1))
            end = int(match.group(2)) if match.group(2) else size - 1
            end = min(end, size - 1)
        else:
            suffix_length = int(match.group(2))
            if suffix_length <= 0:
                return (-1, -1)
            start = max(0, size - suffix_length)
            end = size - 1
    except (TypeError, ValueError, OverflowError):
        return (-1, -1)
    if start > end or start >= size:
        return (-1, -1)
    return start, end


def resolve_under_root(root, rel):
    """把相对路径解析到指定根目录；目标经符号链接解析后越界时返回 None。"""
    normalized = normalize_relative_path(rel)
    if normalized is None:
        return None
    root_real = os.path.realpath(root)
    target = root_real if not normalized else os.path.realpath(
        os.path.join(root_real, *normalized.split("/")))
    try:
        return target if os.path.commonpath((root_real, target)) == root_real else None
    except ValueError:
        return None


def _load_progress_store():
    try:
        with open(PROGRESS_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
        if not isinstance(data, dict) or any(
                not isinstance(rec, dict) or not all(
                    _valid_progress_num(rec.get(key)) for key in ("t", "d", "ts"))
                for rec in data.values()):
            raise ValueError("invalid progress store")
        return data
    except FileNotFoundError:
        # long: 首次运行允许没有记录文件；损坏、权限和其他读取错误不能伪装成空记录后覆盖原文件。
        return {}


def _save_progress_store(store):
    tmp = PROGRESS_PATH + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(store, f, ensure_ascii=False, allow_nan=False)
        f.flush()
        os.fsync(f.fileno())
    # long: 只有完整写入并原子替换成功才确认同步；失败交给 HTTP 层通知客户端重试。
    os.replace(tmp, PROGRESS_PATH)


def _valid_progress_num(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and abs(value) < 1e15


def natural_key(s):
    """自然排序键：数字段按数值比较，"第2集"排在"第10集"前。"""
    parts = re.split(r"(\d+)", s)
    return tuple((0, int(p)) if p.isdigit() else (1, p.lower()) for p in parts if p)


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
        return resolve_under_root(CONFIG["video_dir"], rel)

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
        elif path == "/api/search":
            self.api_search(query)
        elif path == "/api/library":
            self.api_library(query)
        elif path == "/api/progress":
            self.api_progress_get()
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

    def do_POST(self):
        if not self.check_auth():
            return
        path = urllib.parse.urlparse(self.path).path
        if path == "/api/progress":
            self.api_progress_post()
        else:
            self.send_error_json(404, "not found")

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
        st = os.stat(fp)
        etag = '"%d-%d"' % (st.st_size, int(st.st_mtime))
        last_modified = self.date_time_string(int(st.st_mtime))
        if self.headers.get("If-None-Match", "").strip() == etag or \
                (not self.headers.get("If-None-Match")
                 and self.headers.get("If-Modified-Since", "").strip() == last_modified):
            self.send_response(304)
            self.send_header("ETag", etag)
            self.send_header("Last-Modified", last_modified)
            self.send_header("Cache-Control", "max-age=300")
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        with open(fp, "rb") as f:
            data = f.read()
        self.send_response(200)
        self.send_header("Content-Type", STATIC_MIME.get(ext, "application/octet-stream"))
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "max-age=300")
        self.send_header("ETag", etag)
        self.send_header("Last-Modified", last_modified)
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

        for lst in (dirs, videos, audios, subs):
            lst.sort(key=lambda x: (natural_key(x["name"]), x["name"].lower()))

        self.send_json({
            "path": rel.strip("/"),
            "dirs": dirs,
            "videos": videos,
            "audios": audios,
            "subs": subs,
        })

    def api_library(self, query):
        kind = query.get("kind", ["all"])[0]
        order = query.get("sort", ["newest"])[0]
        try:
            offset = int(query.get("offset", ["0"])[0])
            limit = int(query.get("limit", ["60"])[0])
            if kind not in ("all", "video", "audio") or order not in ("newest", "name", "size"):
                raise ValueError
            if not 0 <= offset <= 100000 or not 1 <= limit <= 100:
                raise ValueError
        except ValueError:
            self.send_error_json(400, "媒体筛选参数无效")
            return
        root = CONFIG["video_dir"]
        if not os.path.isdir(root):
            self.send_error_json(404, "资源目录不存在")
            return
        counts = {"video": 0, "audio": 0}

        def media_items():
            for directory, dirs, files in os.walk(root):
                # long: 全库视图不能展示目录外的链接或隐藏资源，和文件读取使用相同安全边界。
                dirs[:] = [d for d in dirs if not d.startswith(".") and not os.path.islink(os.path.join(directory, d))]
                for name in files:
                    ext = os.path.splitext(name)[1].lower()
                    if name.startswith(".") or ext not in VIDEO_EXTS | AUDIO_EXTS:
                        continue
                    rel = os.path.relpath(os.path.join(directory, name), root).replace(os.sep, "/")
                    target = self.resolve_under_root(rel)
                    if not target:
                        continue
                    try:
                        st = os.stat(target)
                        if not os.path.isfile(target):
                            continue
                    except OSError:
                        continue
                    media_kind = "audio" if ext in AUDIO_EXTS else "video"
                    counts[media_kind] += 1
                    if kind == "all" or kind == media_kind:
                        yield {"path": rel, "name": name, "type": "file", "kind": media_kind,
                               "ext": ext[1:], "size": st.st_size, "mtime": int(st.st_mtime)}

        def sort_key(item):
            primary = -item["mtime"] if order == "newest" else -item["size"] if order == "size" else 0
            return primary, natural_key(item["name"]), item["path"]

        # long: 分页只保留当前窗口所需的最前结果，大资源库不必把全部媒体同时传给手机或存进排序数组。
        items = heapq.nsmallest(offset + limit, media_items(), key=sort_key)
        total = sum(counts.values()) if kind == "all" else counts[kind]
        self.send_json({"items": items[offset:], "counts": counts, "total": total,
                        "offset": offset, "has_more": offset + limit < total})

    # ---------- API: 全库搜索 ----------

    def api_search(self, query):
        kw = (query.get("q", [""])[0] or "").strip().lower()
        if not kw:
            self.send_json({"results": [], "truncated": False})
            return
        root = CONFIG["video_dir"]
        limit = 200
        results = []
        truncated = False
        for dirpath, dirnames, filenames in os.walk(root):
            dirnames[:] = sorted((d for d in dirnames if not d.startswith(".")), key=natural_key)
            rel_dir = os.path.relpath(dirpath, root)
            rel_dir = "" if rel_dir == "." else rel_dir.replace(os.sep, "/")
            for name in dirnames:
                if kw in name.lower():
                    results.append({"name": name, "type": "dir",
                                    "path": rel_dir + "/" + name if rel_dir else name})
            for name in sorted(filenames, key=natural_key):
                if name.startswith(".") or kw not in name.lower():
                    continue
                ext = os.path.splitext(name)[1].lower()
                if ext not in VIDEO_EXTS and ext not in AUDIO_EXTS:
                    continue
                item = {"name": name, "type": "file", "ext": ext.lstrip("."),
                        "path": rel_dir + "/" + name if rel_dir else name}
                try:
                    st = os.stat(os.path.join(dirpath, name))
                    item["size"] = st.st_size
                    item["mtime"] = int(st.st_mtime)
                except OSError:
                    pass
                item["kind"] = "video" if ext in VIDEO_EXTS else "audio"
                results.append(item)
            if len(results) >= limit:
                truncated = True
                results = results[:limit]
                break
        self.send_json({"results": results, "truncated": truncated})

    # ---------- API: 播放进度（跨设备同步） ----------

    def api_progress_get(self):
        try:
            with PROGRESS_LOCK:
                store = _load_progress_store()
        except (OSError, ValueError) as exc:
            self.log_error("读取播放记录失败: %s", exc)
            self.send_error_json(503, "播放记录暂时无法读取，请稍后重试")
            return
        self.send_json({"items": store})

    def api_progress_post(self):
        try:
            length = int(self.headers.get("Content-Length") or 0)
            if not 0 < length < 1_000_000:
                raise ValueError
            body = json.loads(self.rfile.read(length).decode("utf-8"))
            items = body.get("items") if isinstance(body, dict) else body
            if not isinstance(items, list):
                raise ValueError
        except (ValueError, json.JSONDecodeError, OSError):
            self.send_error_json(400, "bad request")
            return

        confirmed, rejected = {}, []
        try:
            with PROGRESS_LOCK:
                store = _load_progress_store()
                for it in items[:1000]:
                    if not isinstance(it, dict) or not isinstance(it.get("path"), str):
                        continue
                    path = normalize_relative_path(it["path"])
                    t, d, ts = it.get("t"), it.get("d"), it.get("ts")
                    if (not path or os.path.splitext(path)[1].lower() not in VIDEO_EXTS | AUDIO_EXTS
                            or not all(_valid_progress_num(v) for v in (t, d, ts))):
                        rejected.append(it["path"])
                        continue
                    t, d, ts = float(t), float(d), float(ts)
                    deleted = d <= 0 or t < 0
                    if not deleted and not os.path.isfile(self.resolve_under_root(path) or ""):
                        rejected.append(it["path"])
                        continue
                    rec = {"t": 0 if deleted else round(min(t, d), 1),
                           "d": 0 if deleted else round(d, 1), "ts": ts if ts > 0 else time.time()}
                    old = store.get(path)
                    # long: 秒时间戳兼容旧客户端，并保留新客户端毫秒精度；乱序和重试不能回退已保存进度。
                    # 同版本删除优先，其他冲突保留先落盘版本，重试相同数据不产生新版本。
                    if (old is None or rec["ts"] > old["ts"]
                            or (rec["ts"] == old["ts"] and deleted and old["d"] > 0)):
                        # long: 删除也保留版本墓碑，离线设备上传的旧记录才不会使清除操作失效。
                        store[path] = rec
                    confirmed[it["path"]] = store[path]
                _save_progress_store(store)
        except (OSError, ValueError) as exc:
            self.log_error("保存播放记录失败: %s", exc)
            self.send_error_json(503, "播放记录保存失败，请稍后重试")
            return
        self.send_json({"ok": True, "items": confirmed, "rejected": rejected})

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
        st = os.stat(target)
        size = st.st_size
        etag = '"%d-%d"' % (size, int(st.st_mtime))
        last_modified = self.date_time_string(int(st.st_mtime))

        range_header = self.headers.get("Range")
        start, end = 0, size - 1
        status = 200

        if range_header:
            # If-Range 与当前文件不符（已更换/修改）时应忽略 Range，回退整文件 200
            if_range = self.headers.get("If-Range", "").strip()
            if if_range and if_range != etag and if_range != last_modified:
                range_header = None
        else:
            # 无 Range 的完整请求：内容未变则 304，浏览器直接复用缓存
            if self.headers.get("If-None-Match", "").strip() == etag or \
                    (not self.headers.get("If-None-Match")
                     and self.headers.get("If-Modified-Since", "").strip() == last_modified):
                self.send_response(304)
                self.end_headers()
                return

        if range_header:
            parsed_range = parse_range_header(range_header, size)
            if parsed_range == (-1, -1):
                self.send_response(416)
                self.send_header("Content-Range", "bytes */%d" % size)
                self.send_header("Content-Length", "0")
                self.end_headers()
                return
            if parsed_range:
                start, end = parsed_range
                status = 206

        length = end - start + 1
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Content-Length", str(length))
        self.send_header("Cache-Control", "no-cache")
        self.send_header("ETag", etag)
        self.send_header("Last-Modified", last_modified)
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


class VideoHTTPServer(ThreadingHTTPServer):
    # 跳过 getfqdn 反向解析：http.server 默认 server_bind 会对监听地址做
    # socket.getfqdn()，主机名含非 ASCII 字符（如中文电脑名）时抛
    # UnicodeEncodeError，服务无法启动。server_name 本项目未使用，直接取绑定地址。
    def server_bind(self):
        socketserver.TCPServer.server_bind(self)
        host, port = self.server_address[:2]
        self.server_name = str(host)
        self.server_port = port

    def handle_error(self, request, client_address):
        # long: 手机端拖动进度或切换音频时会主动取消旧 Range 连接，
        # 这属于正常生命周期，不应在服务日志中打印完整 traceback。
        exc_type = sys.exc_info()[0]
        if exc_type in (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            return
        super().handle_error(request, client_address)


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


def _udp_local_ip(target):
    """UDP connect 到目标拿本机出口地址（不实际发包）。失败返回空串。"""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect((target, 9))
        return s.getsockname()[0]
    except OSError:
        return ""
    finally:
        s.close()


def _is_private_lan(ip):
    """RFC1918 私网地址（排除代理软件常用的 198.18.0.0/15 fake-ip 段等）。"""
    m = re.match(r"^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$", ip or "")
    if not m:
        return False
    a, b = int(m.group(1)), int(m.group(2))
    if a == 10 or (a == 192 and b == 168):
        return True
    if a == 172 and 16 <= b <= 31:
        return True
    return False


def _get_gateways():
    """按优先级返回默认网关 IP 列表。"""
    gateways = []

    if os.name == "nt":
        try:
            out = subprocess.run(["route", "print", "-4"], capture_output=True,
                                 text=True, timeout=5, encoding="utf-8", errors="replace").stdout
            for line in out.splitlines():
                parts = line.split()
                # 默认路由行: 0.0.0.0  0.0.0.0  <网关>  <接口>  <跃点数>
                if len(parts) >= 3 and parts[0] == "0.0.0.0" and parts[1] == "0.0.0.0":
                    gw = parts[2]
                    if re.match(r"^\d{1,3}(\.\d{1,3}){3}$", gw) and gw != "0.0.0.0" and gw not in gateways:
                        gateways.append(gw)
        except Exception:
            pass
    else:
        # Linux: /proc/net/route（网关为小端十六进制）
        try:
            with open("/proc/net/route") as f:
                lines = f.readlines()[1:]
            for line in lines:
                parts = line.split()
                if len(parts) > 2 and parts[1] == "00000000" and parts[2] != "00000000":
                    n = int(parts[2], 16)
                    gw = "%d.%d.%d.%d" % (n & 0xFF, (n >> 8) & 0xFF, (n >> 16) & 0xFF, (n >> 24) & 0xFF)
                    if gw not in gateways:
                        gateways.append(gw)
        except Exception:
            pass
        # macOS 兜底
        if not gateways:
            try:
                out = subprocess.run(["route", "-n", "get", "default"], capture_output=True,
                                     text=True, timeout=5).stdout
                for line in out.splitlines():
                    s = line.strip()
                    if s.startswith("gateway:"):
                        gw = s.split()[-1]
                        if re.match(r"^\d{1,3}(\.\d{1,3}){3}$", gw) and gw not in gateways:
                            gateways.append(gw)
            except Exception:
                pass
    return gateways


def get_local_ip():
    """获取局域网 IP：优先沿默认网关探测（虚拟网卡/代理不干扰），多级兜底。"""
    # 1) 逐个默认网关尝试：UDP 探测到网关方向的本机地址，即真实局域网 IP
    for gw in _get_gateways():
        ip = _udp_local_ip(gw)
        if ip and _is_private_lan(ip):
            return ip
    # 2) 兜底：外网方向探测（可能被代理虚拟网卡干扰，过滤非私网结果）
    ip = _udp_local_ip("8.8.8.8")
    if ip and _is_private_lan(ip):
        return ip
    # 3) 兜底：枚举本机网卡地址，取第一个私网地址
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            ip = info[4][0]
            if _is_private_lan(ip):
                return ip
    except OSError:
        pass
    return "127.0.0.1"


def main():
    parser = argparse.ArgumentParser(description="本地音视频在线播放器")
    parser.add_argument("--dir", "-d", help="视频资源目录（优先级最高）")
    parser.add_argument("--port", "-p", type=int, help="监听端口，默认 8080")
    parser.add_argument("--host", default=None, help="监听地址，默认 0.0.0.0")
    parser.add_argument("--password", help="访问密码（HTTP Basic，留空则不启用）")
    parser.add_argument("--print-ip", action="store_true", help="打印本机局域网 IP 后退出（供启动脚本调用）")
    parser.add_argument("--instance-token", help=argparse.SUPPRESS)
    args = parser.parse_args()

    if args.print_ip:
        print(get_local_ip())
        return

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

    server = VideoHTTPServer((host, port), VideoRequestHandler)
    lan_ip = get_local_ip()
    print("=" * 56)
    print("  本地音视频播放器已启动")
    print("  资源目录   : %s" % video_dir)
    print("  本机访问   : http://127.0.0.1:%d/" % port)
    if host == "0.0.0.0" or host == "::":
        print("  局域网访问 : http://%s:%d/" % (lan_ip, port))
    print("  密码保护   : %s" % ("已启用" if password else "未启用"))
    print("=" * 56)
    # stdout 重定向到文件时是块缓冲，强制刷出保证横幅立即写入日志
    sys.stdout.flush()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n已停止")
        server.server_close()


if __name__ == "__main__":
    main()
