from __future__ import annotations

import http.client
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import tempfile
import time
import unittest


ROOT = Path(__file__).resolve().parents[1]
CONTROLLER = ROOT / "deploy" / "mirohost-public" / "index.php"


def php_binary() -> str:
    configured = os.environ.get("PHP_BINARY")
    if configured:
        return configured
    bundled = ROOT / ".runtime" / "php" / "php.exe"
    if bundled.is_file():
        return str(bundled)
    resolved = shutil.which("php")
    if resolved:
        return resolved
    raise RuntimeError("PHP 8.3 binary was not found")


def free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as listener:
        listener.bind(("127.0.0.1", 0))
        return int(listener.getsockname()[1])


class NginxFrontControllerTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.temporary = tempfile.TemporaryDirectory(prefix="crm-nginx-controller-")
        cls.backend = Path(cls.temporary.name) / "backend"
        cls.public = cls.backend / "public"
        assets = cls.public / "assets"
        assets.mkdir(parents=True)

        shutil.copy2(CONTROLLER, cls.public / "index.php")
        (cls.public / "index.html").write_text(
            '<!doctype html><html><body><div id="root">CRM SPA</div></body></html>',
            encoding="utf-8",
        )
        (assets / "app-ABC123.js").write_text("window.CRM_READY = true;", encoding="utf-8")
        (assets / "app-ABC123.css").write_text("body { color: #123; }", encoding="utf-8")
        (assets / "dictionary-ABC123.aff").write_text("SET UTF-8", encoding="utf-8")
        (assets / "dictionary-ABC123.dic").write_text("1\nслово", encoding="utf-8")
        (cls.backend / "bootstrap.php").write_text(
            """<?php
return new class {
    public function run(): void {
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode(['path' => parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH)]);
    }
};
""",
            encoding="utf-8",
        )

        cls.port = free_port()
        cls.process = subprocess.Popen(
            [
                php_binary(),
                "-S",
                f"127.0.0.1:{cls.port}",
                "-t",
                str(cls.public),
                str(cls.public / "index.php"),
            ],
            cwd=cls.backend,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
        )
        deadline = time.monotonic() + 8
        while time.monotonic() < deadline:
            try:
                connection = http.client.HTTPConnection("127.0.0.1", cls.port, timeout=0.25)
                connection.request("GET", "/")
                response = connection.getresponse()
                response.read()
                connection.close()
                break
            except OSError:
                time.sleep(0.05)
        else:
            output = cls.process.stdout.read() if cls.process.stdout else ""
            cls.process.terminate()
            raise RuntimeError(f"PHP test server did not start:\n{output}")

    @classmethod
    def tearDownClass(cls) -> None:
        cls.process.terminate()
        try:
            cls.process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            cls.process.kill()
            cls.process.wait(timeout=5)
        cls.temporary.cleanup()

    def request(self, method: str, path: str, headers: dict[str, str] | None = None):
        connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=3)
        connection.request(method, path, headers=headers or {})
        response = connection.getresponse()
        body = response.read()
        result = response.status, {key.lower(): value for key, value in response.getheaders()}, body
        connection.close()
        return result

    def test_serves_root_and_spa_route(self) -> None:
        for path in ["/", "/reset-password?token=test"]:
            status, headers, body = self.request("GET", path)
            self.assertEqual(status, 200)
            self.assertTrue(headers["content-type"].startswith("text/html"))
            self.assertIn(b"CRM SPA", body)
            self.assertEqual(headers["cache-control"], "no-cache, no-store, must-revalidate")

    def test_serves_hashed_assets_and_head(self) -> None:
        status, headers, body = self.request("GET", "/assets/app-ABC123.js")
        self.assertEqual(status, 200)
        self.assertTrue(headers["content-type"].startswith("text/javascript"))
        self.assertEqual(body, b"window.CRM_READY = true;")
        self.assertEqual(headers["cache-control"], "public, max-age=31536000, immutable")

        status, headers, body = self.request("HEAD", "/assets/app-ABC123.js")
        self.assertEqual(status, 200)
        self.assertEqual(body, b"")
        self.assertEqual(int(headers["content-length"]), len(b"window.CRM_READY = true;"))

        for path in ["/assets/dictionary-ABC123.aff", "/assets/dictionary-ABC123.dic"]:
            status, headers, body = self.request("GET", path)
            self.assertEqual(status, 200)
            self.assertTrue(headers["content-type"].startswith("text/plain"))
            self.assertGreater(len(body), 0)

    def test_preserves_api_request_for_backend(self) -> None:
        status, headers, body = self.request("GET", "/api/health")
        self.assertEqual(status, 200)
        self.assertTrue(headers["content-type"].startswith("application/json"))
        self.assertEqual(json.loads(body), {"path": "/api/health"})

    def test_rejects_missing_assets_hidden_files_and_php(self) -> None:
        for path in ["/assets/missing.js", "/.env", "/index.php", "/..%2Fbootstrap.php"]:
            status, headers, body = self.request("GET", path)
            self.assertEqual(status, 404, path)
            self.assertTrue(headers["content-type"].startswith("application/json"))
            self.assertEqual(json.loads(body)["error"]["code"], "static_file_not_found")

    def test_rejects_non_api_mutations(self) -> None:
        status, headers, body = self.request("POST", "/reset-password")
        self.assertEqual(status, 405)
        self.assertEqual(headers["allow"], "GET, HEAD")
        self.assertEqual(json.loads(body)["error"]["code"], "method_not_allowed")


if __name__ == "__main__":
    unittest.main()
