"""Check the full deployment ZIP, then smoke-test a relocated extraction on CPU."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile
from zipfile import ZipFile


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("archive", type=Path)
    parser.add_argument("--inference", action="store_true")
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    with ZipFile(args.archive) as archive:
        names = archive.namelist()
        assert all(not n.startswith(("/", "\\")) and ".." not in Path(n).parts for n in names)
        assert "backend/.env" in names and "frontend/.env" in names
        assert archive.read("backend/.env") == (root / "backend/.env").read_bytes()
        assert archive.read("frontend/.env") == (root / "frontend/.env").read_bytes()
        assert not any(n.startswith("backend/public/") and Path(n).name.startswith(".env") for n in names)
        assert not any("/site-packages/" in n or "/__pycache__/" in n or n.startswith("backend/storage/tmp/") for n in names)
        config = dict(line.split("=", 1) for line in archive.read("backend/.env").decode("utf-8-sig").splitlines()
                      if "=" in line and not line.startswith("#"))
        assert config["WHISPER_DEVICE"] == "cuda" and config["WHISPER_COMPUTE_TYPE"] == "float16"
        for name in ["WHISPER_PYTHON_BIN", "WHISPER_MODEL", "WHISPER_MODEL_DIR", "OCR_PYTHON_BIN", "OCR_MODEL_DIR"]:
            value = config[name]
            assert not value.startswith(("/", "\\")) and ":" not in value, name
        manifest = json.loads(archive.read("AI-MODELS.json").decode("utf-8-sig"))
        assert len(manifest) >= 19
        for item in manifest:
            assert archive.getinfo(item["path"]).file_size == item["bytes"]
            with archive.open(item["path"]) as stream:
                assert hashlib.file_digest(stream, "sha256").hexdigest() == item["sha256"], item["path"]
        print(f"Archive verified: environment files, relative GPU config, {len(manifest)} model checksums.", flush=True)
        if args.inference:
            temporary = root / ".tmp"
            temporary.mkdir(exist_ok=True)
            with tempfile.TemporaryDirectory(prefix="relocated-deploy-", dir=temporary) as directory:
                destination = Path(directory)
                archive.extractall(destination)
                python = root / ".runtime/whisper/Scripts/python.exe"
                php = root / ".runtime/php/php.exe"
                subprocess.run([str(python), str(destination / "deploy/setup-ai.py"), "--verify-only"],
                               cwd=temporary, check=True)
                env = os.environ.copy()
                # Test-only overrides reuse installed interpreters. Packaged .env
                # remains CUDA/FP16 and resolves its model paths in the new root.
                env.update(WHISPER_PYTHON_BIN=str(python),
                           OCR_PYTHON_BIN=str(root / ".runtime/ocr/Scripts/python.exe"),
                           WHISPER_DEVICE="cpu", WHISPER_COMPUTE_TYPE="int8", OCR_DEVICE="cpu")
                subprocess.run([str(php), str(destination / "deploy/check-ai.php")],
                               cwd=temporary, env=env, check=True)
                print("Relocated extraction passed actual offline inference for both engines.", flush=True)


if __name__ == "__main__":
    main()
