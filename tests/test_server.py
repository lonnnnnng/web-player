import http.client
import json
import os
import tempfile
import threading
import unittest

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
        conn.request(method, target, body=body, headers=headers or {})
        response = conn.getresponse()
        payload = response.read()
        result = response.status, dict(response.getheaders()), payload
        conn.close()
        return result

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


if __name__ == "__main__":
    unittest.main()
