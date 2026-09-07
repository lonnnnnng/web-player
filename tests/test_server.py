import http.client
import json
import os
import tempfile
import threading
import unittest
from concurrent.futures import ThreadPoolExecutor
from unittest import mock

import server


class ServerUnitTest(unittest.TestCase):
    def test_normalize_relative_path(self):
        self.assertEqual(server.normalize_relative_path("season\\第 01 集.mp4"), "season/第 01 集.mp4")
        self.assertEqual(server.normalize_relative_path("/movie.mp4/"), "movie.mp4")
        self.assertEqual(server.normalize_relative_path(""), "")
        self.assertIsNone(server.normalize_relative_path("../secret.mp4"))
        self.assertIsNone(server.normalize_relative_path("season//movie.mp4"))
        self.assertIsNone(server.normalize_relative_path("season/./movie.mp4"))
        self.assertIsNone(server.normalize_relative_path("movie.mp4\x00"))

    def test_parse_range_header(self):
        self.assertEqual(server.parse_range_header("bytes=2-5", 10), (2, 5))
        self.assertEqual(server.parse_range_header("bytes=2-", 10), (2, 9))
        self.assertEqual(server.parse_range_header("bytes=-3", 10), (7, 9))
        self.assertEqual(server.parse_range_header("bytes=2-99", 10), (2, 9))
        self.assertIsNone(server.parse_range_header("bytes=1-2,4-5", 10))
        self.assertEqual(server.parse_range_header("bytes=-0", 10), (-1, -1))
        self.assertEqual(server.parse_range_header("bytes=99-100", 10), (-1, -1))

    def test_resolve_under_root(self):
        with tempfile.TemporaryDirectory() as root:
            nested = os.path.join(root, "season", "clip.mp4")
            os.makedirs(os.path.dirname(nested))
            with open(nested, "wb") as f:
                f.write(b"video")
            self.assertEqual(server.resolve_under_root(root, "season\\clip.mp4"), os.path.realpath(nested))
            self.assertIsNone(server.resolve_under_root(root, "../outside.mp4"))


class ServerHTTPTest(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.root = self.temp_dir.name
        with open(os.path.join(self.root, "clip.mp4"), "wb") as f:
            f.write(b"0123456789")
        self.progress_file = os.path.join(self.root, "progress.json")
        self.old_config = server.CONFIG.copy()
        self.old_progress_path = server.PROGRESS_PATH
        server.CONFIG["video_dir"] = self.root
        server.CONFIG["password"] = ""
        server.PROGRESS_PATH = self.progress_file
        self.httpd = server.VideoHTTPServer(("127.0.0.1", 0), server.VideoRequestHandler)
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.httpd.shutdown()
        self.httpd.server_close()
        self.thread.join(timeout=2)
        server.CONFIG.clear()
        server.CONFIG.update(self.old_config)
        server.PROGRESS_PATH = self.old_progress_path
        self.temp_dir.cleanup()

    def request(self, method, target, headers=None, body=None):
        host, port = self.httpd.server_address
        conn = http.client.HTTPConnection(host, port, timeout=3)
        try:
            conn.request(method, target, body=body, headers=headers or {})
            response = conn.getresponse()
            payload = response.read()
            return response.status, dict(response.getheaders()), payload
        finally:
            conn.close()

    def test_range_and_conditional_file_requests(self):
        status, headers, body = self.request("GET", "/api/file?path=clip.mp4", {"Range": "bytes=2-5"})
        self.assertEqual(status, 206)
        self.assertEqual(body, b"2345")
        self.assertEqual(headers["Content-Range"], "bytes 2-5/10")

        status, headers, body = self.request("GET", "/api/file?path=clip.mp4", {"Range": "bytes=-3"})
        self.assertEqual(status, 206)
        self.assertEqual(body, b"789")

        status, headers, body = self.request("GET", "/api/file?path=clip.mp4", {"Range": "bytes=90-100"})
        self.assertEqual(status, 416)
        self.assertEqual(headers["Content-Range"], "bytes */10")

        status, headers, body = self.request("GET", "/static/index.html")
        self.assertEqual(status, 200)
        status, headers, body = self.request("GET", "/static/index.html", {"If-None-Match": headers["ETag"]})
        self.assertEqual(status, 304)
        self.assertEqual(body, b"")

    def test_progress_normalizes_and_clamps(self):
        body = json.dumps({
            "items": [
                {"path": "\\clip.mp4", "t": 99, "d": 10, "ts": 100},
                {"path": "../outside.mp4", "t": 1, "d": 10, "ts": 101},
                {"path": "clip.srt", "t": 1, "d": 10, "ts": 102},
            ]
        }).encode("utf-8")
        status, _, _ = self.request("POST", "/api/progress", {"Content-Type": "application/json"}, body)
        self.assertEqual(status, 200)
        status, _, payload = self.request("GET", "/api/progress")
        self.assertEqual(status, 200)
        items = json.loads(payload)["items"]
        self.assertEqual(items["clip.mp4"]["t"], 10.0)
        self.assertNotIn("../outside.mp4", items)
        self.assertNotIn("clip.srt", items)

    def post_progress(self, t, d, ts):
        return self.request("POST", "/api/progress", {"Content-Type": "application/json"},
                            json.dumps({"items": [{"path": "clip.mp4", "t": t, "d": d, "ts": ts}]}))

    def test_library_filter_sort_and_pagination(self):
        os.makedirs(os.path.join(self.root, "album"))
        for name, size, modified in [("album/track10.mp3", 30, 100), ("album/track2.mp3", 20, 300),
                                     ("clip2.mp4", 50, 200)]:
            target = os.path.join(self.root, name)
            with open(target, "wb") as media:
                media.write(b"x" * size)
            os.utime(target, (modified, modified))
        status, _, body = self.request("GET", "/api/library?kind=audio&sort=name&limit=1")
        result = json.loads(body)
        self.assertEqual(status, 200)
        self.assertEqual(result["counts"], {"audio": 2, "video": 2})
        self.assertEqual(result["total"], 2)
        self.assertEqual(result["items"][0]["path"], "album/track2.mp3")
        self.assertTrue(result["has_more"])
        _, _, body = self.request("GET", "/api/library?kind=audio&sort=name&limit=1&offset=1")
        self.assertEqual(json.loads(body)["items"][0]["name"], "track10.mp3")
        self.assertFalse(json.loads(body)["has_more"])
        _, _, body = self.request("GET", "/api/library?sort=size")
        self.assertEqual([item["size"] for item in json.loads(body)["items"]], [50, 30, 20, 10])
        _, _, body = self.request("GET", "/api/library?kind=audio&sort=newest")
        self.assertEqual(json.loads(body)["items"][0]["name"], "track2.mp3")
        _, _, body = self.request("GET", "/api/library?offset=99")
        self.assertEqual(json.loads(body)["items"], [])
        self.assertFalse(json.loads(body)["has_more"])

    def test_library_rejects_invalid_filters_and_missing_root(self):
        for query in ["kind=image", "sort=random", "limit=0", "limit=101", "offset=-1", "offset=100001", "limit=no"]:
            with self.subTest(query=query):
                self.assertEqual(self.request("GET", "/api/library?" + query)[0], 400)
        server.CONFIG["video_dir"] = os.path.join(self.root, "missing")
        self.assertEqual(self.request("GET", "/api/library")[0], 404)

    def test_library_excludes_hidden_and_outside_resources(self):
        with tempfile.TemporaryDirectory() as outside:
            external = os.path.join(outside, "secret.mp3")
            with open(external, "wb") as media:
                media.write(b"private")
            os.symlink(external, os.path.join(self.root, "linked.mp3"))
            os.symlink(outside, os.path.join(self.root, "linked-directory"))
            os.makedirs(os.path.join(self.root, ".private"))
            for name in [".hidden.mp3", ".private/hidden.mp4", "notes.txt"]:
                with open(os.path.join(self.root, name), "wb") as media:
                    media.write(b"hidden")
            status, _, body = self.request("GET", "/api/library")
            result = json.loads(body)
            self.assertEqual(status, 200)
            self.assertEqual([item["path"] for item in result["items"]], ["clip.mp4"])
            self.assertEqual(result["counts"], {"video": 1, "audio": 0})

    def test_progress_rejects_stale_versions_and_preserves_milliseconds(self):
        self.post_progress(9, 10, 200.123)
        status, _, payload = self.post_progress(1, 10, 200.122)
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(payload)["items"]["clip.mp4"], {"t": 9, "d": 10, "ts": 200.123})
        self.post_progress(3, 10, 200.123)
        self.assertEqual(server._load_progress_store()["clip.mp4"]["t"], 9)

    def test_deletion_tombstone_prevents_resurrection_and_allows_new_playback(self):
        self.post_progress(5, 10, 100)
        self.post_progress(0, 0, 100)
        self.post_progress(8, 10, 100)
        self.post_progress(1, 10, 99)
        status, _, payload = self.request("GET", "/api/progress")
        self.assertEqual(json.loads(payload)["items"]["clip.mp4"], {"t": 0, "d": 0, "ts": 100})
        self.post_progress(2, 10, 100.001)
        self.assertEqual(server._load_progress_store()["clip.mp4"]["t"], 2)

    def test_failed_persistence_returns_error_and_preserves_previous_file(self):
        self.post_progress(5, 10, 100)
        with mock.patch.object(server.os, "replace", side_effect=OSError("disk full")):
            status, _, payload = self.post_progress(9, 10, 200)
        self.assertEqual(status, 503)
        self.assertIn("error", json.loads(payload))
        self.assertEqual(server._load_progress_store()["clip.mp4"]["t"], 5)
        self.assertEqual(self.post_progress(9, 10, 200)[0], 200)

    def test_missing_progress_parent_returns_error(self):
        server.PROGRESS_PATH = os.path.join(self.root, "missing", "progress.json")
        self.assertEqual(self.post_progress(5, 10, 100)[0], 503)

    def test_corrupt_or_unreadable_store_is_not_overwritten(self):
        for content in ["{broken", "[]", '{"clip.mp4":{"t":1,"d":10}}']:
            with open(self.progress_file, "w", encoding="utf-8") as f:
                f.write(content)
            self.assertEqual(self.request("GET", "/api/progress")[0], 503)
            self.assertEqual(self.post_progress(5, 10, 100)[0], 503)
            with open(self.progress_file, encoding="utf-8") as f:
                self.assertEqual(f.read(), content)
        with mock.patch.object(server, "_load_progress_store", side_effect=PermissionError("denied")):
            self.assertEqual(self.request("GET", "/api/progress")[0], 503)
            self.assertEqual(self.post_progress(5, 10, 100)[0], 503)

    def test_concurrent_requests_converge_on_newest_progress(self):
        # long: 每个并发请求都必须成功，不能让工作线程异常被 unittest 当成通过。
        with ThreadPoolExecutor(max_workers=3) as pool:
            futures = [pool.submit(self.post_progress, i, 10, 100 + i / 1000) for i in range(10)]
            for future in futures:
                self.assertEqual(future.result(timeout=5)[0], 200)
        self.assertEqual(server._load_progress_store()["clip.mp4"], {"t": 9, "d": 10, "ts": 100.009})


if __name__ == "__main__":
    unittest.main()
