import os
import shutil
import socket
import subprocess
import tempfile
import unittest


class StartScriptTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="web-player-start-test-")
        self.root = self.temp.name
        project = os.path.dirname(os.path.dirname(__file__))
        for name in ("start.sh", "server.py"):
            shutil.copyfile(os.path.join(project, name), os.path.join(self.root, name))
        os.mkdir(os.path.join(self.root, "static"))
        self.pid_file = os.path.join(self.root, "player.pid")

    def tearDown(self):
        self.temp.cleanup()

    def command(self, *args):
        return subprocess.run(["bash", os.path.join(self.root, "start.sh"), *args],
                              capture_output=True, text=True, timeout=15)

    def test_unrelated_process_is_not_stopped_by_legacy_or_forged_identity(self):
        # long: 只创建本测试拥有的无关进程，模拟旧 PID 文件及复用 PID，绝不向用户进程发信号。
        child = subprocess.Popen(["sleep", "60"])
        try:
            for content in (str(child.pid) + "\n", str(child.pid) + "\n" + "a" * 32 + "\nwrong birth\n", "-1\n"):
                with open(self.pid_file, "w", encoding="utf-8") as f:
                    f.write(content)
                result = self.command("stop")
                self.assertNotEqual(result.returncode, 0)
                self.assertIsNone(child.poll())
                with open(self.pid_file, encoding="utf-8") as f:
                    self.assertEqual(f.read(), content)
        finally:
            child.terminate()
            child.wait(timeout=3)

    def test_owned_server_start_status_stop_and_wrong_token(self):
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", 0))
            port = sock.getsockname()[1]
        identity = None
        try:
            result = self.command("--host", "127.0.0.1", "--port", str(port), "--dir", self.root)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            with open(self.pid_file, encoding="utf-8") as f:
                identity = f.read()
            self.assertIn("运行中", self.command("status").stdout)
            parts = identity.splitlines()
            parts[1] = "0" * 32
            with open(self.pid_file, "w", encoding="utf-8") as f:
                f.write("\n".join(parts) + "\n")
            self.assertNotEqual(self.command("stop").returncode, 0)
            with socket.create_connection(("127.0.0.1", port), timeout=3):
                pass
        finally:
            if identity:
                with open(self.pid_file, "w", encoding="utf-8") as f:
                    f.write(identity)
                stopped = self.command("stop")
                self.assertEqual(stopped.returncode, 0, stopped.stdout + stopped.stderr)
        self.assertFalse(os.path.exists(self.pid_file))
