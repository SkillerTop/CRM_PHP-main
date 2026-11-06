#!/usr/bin/env python3
"""Qwen3-VL (served by Ollama) runner for conference business cards.

Prints the same JSON as the former PaddleOCR runner ({"text", "average_confidence",
"device"}), so BusinessCardOcrService keeps classifying the lines itself.
Needs only the standard library and Pillow.
"""

from __future__ import annotations

import argparse
import base64
import io
import json
import re
import sys
import urllib.error
import urllib.request

PROMPT = (
    "Transcribe all text printed on this business card. "
    "Write each printed line on its own line in reading order, top to bottom and left to right; "
    "keep separate columns as separate lines. "
    "Copy the text exactly as printed: original language and alphabet (Latin, Cyrillic and others), "
    "spelling, capitalization, punctuation, phone numbers, e-mail and web addresses. "
    "Do not translate, correct, summarize, or add labels, comments or Markdown. "
    "If there is no text, reply with nothing."
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--url", default="http://127.0.0.1:11434")
    parser.add_argument("--model", default="qwen3-vl:4b-instruct")
    # Card text stays legible at 1600 px; full 4000 px phone photos only cost vision tokens.
    parser.add_argument("--max-side", type=int, default=1600)
    parser.add_argument("--timeout", type=float, default=170)
    return parser.parse_args()


def encode_image(path: str, max_side: int) -> str:
    """JPEG base64 of the upload: EXIF rotation applied, alpha flattened, downscaled."""
    from PIL import Image, ImageOps

    with Image.open(path) as source:
        image = ImageOps.exif_transpose(source)
        if image.mode in ("RGBA", "LA") or "transparency" in image.info:
            image = image.convert("RGBA")
            background = Image.new("RGBA", image.size, "white")
            background.alpha_composite(image)
            image = background
        image = image.convert("RGB")
        image.thumbnail((max_side, max_side), Image.LANCZOS)
        buffer = io.BytesIO()
        image.save(buffer, "JPEG", quality=92)
    return base64.b64encode(buffer.getvalue()).decode("ascii")


def clean_text(text: str) -> str:
    text = re.sub(r"<think>.*?</think>", "", text, flags=re.S)
    lines = (line.strip() for line in text.splitlines())
    return "\n".join(line for line in lines if line and not line.startswith("```"))


def recognize(url: str, model: str, image: str, timeout: float) -> str:
    body = json.dumps({
        "model": model,
        "stream": False,
        "messages": [{"role": "user", "content": PROMPT, "images": [image]}],
        # num_predict stops the rare repetition loop of greedy decoding.
        "options": {"temperature": 0, "num_ctx": 8192, "num_predict": 1024},
    }).encode("utf-8")
    request = urllib.request.Request(url.rstrip("/") + "/api/chat", data=body,
                                     headers={"Content-Type": "application/json"})
    # Ollama is an internal service: never route it through an HTTP(S)_PROXY.
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    with opener.open(request, timeout=timeout) as response:
        payload = json.load(response)
    return str((payload.get("message") or {}).get("content") or "")


def main() -> int:
    args = parse_args()
    try:
        text = clean_text(recognize(args.url, args.model, encode_image(args.input, args.max_side), args.timeout))
        # ASCII-safe JSON avoids console code-page failures; PHP restores the Unicode text.
        print(json.dumps({"text": text, "average_confidence": None, "device": "ollama"}, ensure_ascii=True))
        return 0
    except urllib.error.HTTPError as error:  # 404: the model is not pulled into Ollama yet.
        print(json.dumps({"error": f"HTTP {error.code}", "model": args.model}), file=sys.stderr)
        return 1
    except Exception as error:  # Avoid echoing image paths or recognized text.
        print(json.dumps({"error": type(error).__name__}), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
