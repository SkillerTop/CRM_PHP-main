#!/usr/bin/env python3
"""Install OS-specific AI runtimes inside the extracted project; keep bundled weights."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import venv


def verify_models(root: Path) -> None:
    manifest = root / "AI-MODELS.json"
    if not manifest.is_file():
        raise RuntimeError("AI-MODELS.json is missing; use the complete deployment archive")
    records = json.loads(manifest.read_text(encoding="utf-8-sig"))
    if not records:
        raise RuntimeError("The model manifest is empty")
    for record in records:
        path = (root / record["path"]).resolve()
        if not path.is_relative_to(root / "backend/ai/models"):
            raise RuntimeError("Model manifest contains a path outside backend/ai/models")
        if not path.is_file() or path.stat().st_size != record["bytes"]:
            raise RuntimeError(f"Missing or incomplete bundled model: {record['path']}")
        with path.open("rb") as source:
            digest = hashlib.file_digest(source, "sha256").hexdigest()
        if digest != record["sha256"]:
            raise RuntimeError(f"Model checksum mismatch: {record['path']}")
    print(f"Verified {len(records)} bundled model files.", flush=True)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--verify-only", action="store_true")
    parser.add_argument("--php", default="php", help="PHP executable used for the final inference check")
    parser.add_argument("--paddle-index-url", default="https://www.paddlepaddle.org.cn/packages/stable/cu129/")
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    if sys.version_info < (3, 11):
        raise RuntimeError("Python 3.11 or newer is required; Python 3.11/3.12 is recommended")
    verify_models(root)
    if args.verify_only:
        return 0
    if os.name != "nt":
        # Production EnvironmentValidator requires a private backend .env.
        for directory in [root / "backend", root / "frontend"]:
            for file in directory.glob(".env*"):
                if file.is_file():
                    file.chmod(0o600)
    for engine, name in [("speech", "whisper"), ("ocr", "ocr")]:
        directory = root / ".runtime" / name
        python = directory / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
        if not python.is_file():
            venv.EnvBuilder(with_pip=True).create(directory)
        if engine == "ocr":
            subprocess.run([str(python), "-m", "pip", "install", "paddlepaddle-gpu==3.2.1",
                            "--index-url", args.paddle_index_url], check=True)
        subprocess.run([str(python), "-m", "pip", "install", "-r",
                        str(root / f"backend/ai/requirements-{engine}.txt")], check=True)
        subprocess.run([str(python), "-m", "pip", "check"], check=True)
    # PHP loads .env and resolves all paths exactly as the application does.
    subprocess.run([args.php, str(root / "deploy/check-ai.php")], cwd=root, check=True)
    print("AI runtimes and bundled models are ready on the configured devices.")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (RuntimeError, subprocess.CalledProcessError) as error:
        print(f"AI setup failed: {error}", file=sys.stderr)
        raise SystemExit(1)
