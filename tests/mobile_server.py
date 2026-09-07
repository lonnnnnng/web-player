"""long: 手机回归专用服务；媒体只读，播放记录随临时目录隔离，绝不写入正式记录。"""
import argparse
import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import server


def main():
    parser = argparse.ArgumentParser(description="真实媒体隔离回归服务")
    parser.add_argument("--dir", required=True, help="现有媒体资源目录")
    args = parser.parse_args()
    root = os.path.realpath(args.dir)
    if not os.path.isdir(root):
        parser.error("资源目录不存在，不会自动创建或修改该目录")
    with tempfile.TemporaryDirectory(prefix="web-player-mobile-test-") as scratch:
        server.CONFIG.update(video_dir=root, password="")
        server.PROGRESS_PATH = os.path.join(scratch, "progress.json")
        httpd = server.VideoHTTPServer(("127.0.0.1", 0), server.VideoRequestHandler)
        print("TEST_URL=http://127.0.0.1:%d/" % httpd.server_port, flush=True)
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            pass
        finally:
            httpd.server_close()


if __name__ == "__main__":
    main()
