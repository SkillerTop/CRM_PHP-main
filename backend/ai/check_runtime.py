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


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--engine", choices=["speech", "ocr"], required=True)
    parser.add_argument("--model-dir", required=True)
    parser.add_argument("--device", required=True)
    parser.add_argument("--compute-type", default="float16")
    parser.add_argument("--language", default="uk")
    args = parser.parse_args()
    started = time.perf_counter()
    model_dir = Path(args.model_dir).resolve()
    try:
        if not model_dir.is_dir():
            raise RuntimeError("Bundled model directory is missing")
        os.environ["HF_HUB_OFFLINE"] = "1"
        if args.engine == "speech":
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
            import paddle
            from PIL import Image, ImageDraw

            if args.device.startswith("gpu") and (
                not paddle.is_compiled_with_cuda() or paddle.device.cuda.device_count() == 0
            ):
                raise RuntimeError("GPU is configured but no NVIDIA GPU is visible to PaddleOCR")
            with tempfile.TemporaryDirectory(prefix="crm-ocr-check-") as tmp:
                image = Path(tmp) / "card.png"
                card = Image.new("RGB", (700, 240), "white")
                ImageDraw.Draw(card).text((40, 80), "CRM TEST 123", fill="black", font_size=40)
                card.save(image)
                command = [sys.executable, str(Path(__file__).with_name("paddleocr_business_card.py")),
                           "--input", str(image), "--model-dir", str(model_dir),
                           "--language", args.language, "--device", args.device]
                result = subprocess.run(command, capture_output=True, text=True, timeout=300)
                if result.returncode:
                    raise RuntimeError("PaddleOCR inference failed; verify its runtime and model files")
                payload = json.loads(result.stdout)
                device = payload.get("device")
                if args.device.startswith("gpu") and not str(device).startswith("gpu"):
                    raise RuntimeError("PaddleOCR fell back to CPU")
                if not payload.get("text", "").strip():
                    raise RuntimeError("PaddleOCR returned no text for the test card")
        print(json.dumps({"ok": True, "engine": args.engine, "device": device,
                          "seconds": round(time.perf_counter() - started, 2)}))
        return 0
    except Exception as error:
        print(json.dumps({"ok": False, "engine": args.engine,
                          "error": type(error).__name__, "message": str(error)[:500]}))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
