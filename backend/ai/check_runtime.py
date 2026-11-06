#!/usr/bin/env python3
"""Verify local weights and actual inference on the configured device."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import urllib.request


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--engine", choices=["speech", "ocr"], required=True)
    parser.add_argument("--model-dir", default="")
    parser.add_argument("--device", default="cuda")
    parser.add_argument("--compute-type", default="float16")
    parser.add_argument("--url", default="http://127.0.0.1:11434")
    parser.add_argument("--model", default="qwen3-vl:4b-instruct")
    args = parser.parse_args()
    started = time.perf_counter()
    model_dir = Path(args.model_dir).resolve()
    try:
        os.environ["HF_HUB_OFFLINE"] = "1"
        if args.engine == "speech":
            if not model_dir.is_dir():
                raise RuntimeError("Bundled model directory is missing")
            import ctranslate2
            import numpy as np
            from faster_whisper import WhisperModel

            if args.device == "cuda" and ctranslate2.get_cuda_device_count() == 0:
                raise RuntimeError("CUDA is configured but no NVIDIA GPU is visible to Faster-Whisper")
            model = WhisperModel(str(model_dir), device=args.device,
                                 compute_type=args.compute_type, local_files_only=True)
            # Exercise the encoder/decoder and CUDA DLLs, not just the import.
            segments, _ = model.transcribe(np.zeros(16000, dtype=np.float32),
                                           language="en", beam_size=1, vad_filter=False)
            list(segments)
            device = args.device
        else:
            from PIL import Image, ImageDraw

            with tempfile.TemporaryDirectory(prefix="crm-ocr-check-") as tmp:
                image = Path(tmp) / "card.png"
                card = Image.new("RGB", (700, 240), "white")
                ImageDraw.Draw(card).text((40, 80), "CRM TEST 123", fill="black", font_size=40)
                card.save(image)
                command = [sys.executable, str(Path(__file__).with_name("qwen_vl_business_card.py")),
                           "--input", str(image), "--url", args.url, "--model", args.model]
                result = subprocess.run(command, capture_output=True, text=True, timeout=300)
                if result.returncode:
                    raise RuntimeError("Qwen3-VL inference failed (is Ollama running and the model pulled?): "
                                       + result.stderr.strip()[:200])
                if "CRM" not in json.loads(result.stdout).get("text", "").upper():
                    raise RuntimeError("Qwen3-VL did not read the test card")
            # Ollama reports how much of the loaded model sits in VRAM.
            opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
            with opener.open(args.url.rstrip("/") + "/api/ps", timeout=10) as response:
                loaded = [m for m in json.load(response).get("models", []) if args.model in (m.get("name"), m.get("model"))]
            device = "gpu" if loaded and loaded[0].get("size_vram", 0) > 0 else "cpu"
            if device == "cpu":
                raise RuntimeError("Qwen3-VL runs on CPU: Ollama sees no NVIDIA GPU")
        print(json.dumps({"ok": True, "engine": args.engine, "device": device,
                          "seconds": round(time.perf_counter() - started, 2)}))
        return 0
    except Exception as error:
        print(json.dumps({"ok": False, "engine": args.engine,
                          "error": type(error).__name__, "message": str(error)[:500]}))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
