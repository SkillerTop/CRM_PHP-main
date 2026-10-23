#!/usr/bin/env python3
"""PaddleOCR PP-OCRv5 runner for conference business cards."""

from __future__ import annotations

import argparse
import contextlib
import io
import json
import os
import sys
from pathlib import Path
from typing import Any


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--language", default="uk")
    parser.add_argument("--device", default="gpu")
    parser.add_argument("--model-dir", required=True)
    return parser.parse_args()


def result_payload(result: Any) -> Any:
    value = getattr(result, "json", result)
    if callable(value):
        value = value()
    if isinstance(value, str):
        return json.loads(value)
    return value


def collect_recognition(node: Any, texts: list[str], scores: list[float], boxes: list[Any] | None = None) -> None:
    if isinstance(node, dict):
        rec_texts = node.get("rec_texts")
        if isinstance(rec_texts, list):
            rec_boxes = node.get("rec_boxes")
            aligned = isinstance(rec_boxes, list) and len(rec_boxes) == len(rec_texts)
            for index, item in enumerate(rec_texts):
                if str(item).strip():
                    texts.append(str(item).strip())
                    if boxes is not None:
                        boxes.append(rec_boxes[index] if aligned else None)
        rec_scores = node.get("rec_scores")
        if isinstance(rec_scores, list):
            for score in rec_scores:
                try:
                    scores.append(float(score))
                except (TypeError, ValueError):
                    pass
        for key, value in node.items():
            if key not in {"rec_texts", "rec_scores", "rec_boxes"}:
                collect_recognition(value, texts, scores, boxes)
    elif isinstance(node, list):
        for item in node:
            collect_recognition(item, texts, scores, boxes)


def group_lines(texts: list[str], boxes: list[Any]) -> list[str]:
    """Join word boxes into card lines.

    PP-OCRv5 often returns single words ("Sales" | "&" | "Department"). Words
    are chained left to right when they share a baseline, have a similar
    height, and sit close together; a wide gap starts a new line, so two-column
    cards ("Name ... Mob. +47 ...") keep their columns apart.
    """
    items = []
    for text, box in zip(texts, boxes):
        try:
            x1, y1, x2, y2 = (float(value) for value in box)
        except (TypeError, ValueError):
            return texts
        items.append({"text": text, "x1": x1, "x2": x2, "cy": (y1 + y2) / 2, "h": max(1.0, y2 - y1)})

    segments: list[list[dict[str, Any]]] = []
    for item in sorted(items, key=lambda entry: entry["x1"]):
        best = None
        best_gap = None
        for segment in segments:
            last = segment[-1]
            height = min(last["h"], item["h"])
            gap = item["x1"] - last["x2"]
            if (
                -0.3 * height <= gap <= 1.2 * max(last["h"], item["h"])
                and abs(item["cy"] - last["cy"]) <= 0.5 * height
                and max(last["h"], item["h"]) <= 1.6 * height
                and (best_gap is None or gap < best_gap)
            ):
                best, best_gap = segment, gap
        if best is None:
            segments.append([item])
        else:
            best.append(item)

    # Reading order: top to bottom; the classifier labels each line on its own.
    segments.sort(key=lambda segment: (segment[0]["cy"], segment[0]["x1"]))
    return [" ".join(item["text"] for item in segment) for segment in segments]


def resolve_device(requested: str) -> str:
    """Use CPU when a requested GPU is unavailable to the service account."""
    if not requested.lower().startswith("gpu"):
        return requested
    try:
        import paddle

        if paddle.is_compiled_with_cuda() and paddle.device.cuda.device_count() > 0:
            return requested
    except Exception:
        pass
    return "cpu"


def load_image(path: str) -> Any:
    """Decode uploaded image bytes; PHP temporary paths have no image suffix."""
    import numpy as np
    from PIL import Image, ImageOps

    with Image.open(path) as source:
        image = ImageOps.exif_transpose(source)
        if image.mode in ("RGBA", "LA") or "transparency" in image.info:
            image = image.convert("RGBA")
            background = Image.new("RGBA", image.size, "white")
            background.alpha_composite(image)
            image = background.convert("RGB")
        else:
            image = image.convert("RGB")
        # PaddleOCR's ndarray input uses OpenCV's BGR channel order.
        return np.asarray(image)[:, :, ::-1].copy()


def main() -> int:
    args = parse_args()
    os.makedirs(args.model_dir, exist_ok=True)
    os.environ.setdefault("PADDLE_HOME", args.model_dir)
    os.environ.setdefault("PADDLE_PDX_CACHE_HOME", args.model_dir)
    os.environ.setdefault("HF_HOME", os.path.join(args.model_dir, "huggingface"))
    os.environ.setdefault("XDG_CACHE_HOME", args.model_dir)
    try:
        # Paddle/PaddleX may print model-loading diagnostics to stdout. Keep
        # stdout machine-readable for the PHP caller.
        diagnostics = io.StringIO()
        with contextlib.redirect_stdout(diagnostics):
            from paddleocr import PaddleOCR

            device = resolve_device(args.device)

            # Explicit project-local paths keep deployment independent of
            # provider caches and prevent downloading the bundled models again.
            bundled = Path(args.model_dir) / "official_models"
            model_paths = {}
            for parameter, name in {
                "doc_orientation_classify_model_dir": "PP-LCNet_x1_0_doc_ori",
                "textline_orientation_model_dir": "PP-LCNet_x1_0_textline_ori",
                "text_detection_model_dir": "PP-OCRv5_server_det",
                "text_recognition_model_dir": "eslav_PP-OCRv5_mobile_rec",
            }.items():
                directory = bundled / name
                if directory.is_dir() and (parameter != "text_recognition_model_dir" or args.language == "uk"):
                    model_paths[parameter] = str(directory.resolve())
                    # When explicit directories are provided, PaddleOCR ignores
                    # ocr_version/lang. Pin matching names so newer defaults
                    # cannot select PP-OCRv6 for our bundled PP-OCRv5 weights.
                    model_paths[parameter.removesuffix("_dir") + "_name"] = name

            ocr = PaddleOCR(
                lang=args.language,
                ocr_version="PP-OCRv5",
                device=device,
                use_doc_orientation_classify=True,
                # Unwarping is built for full-page scans; on phone photos of a
                # card lying on a desk it distorts the card and loses most text.
                use_doc_unwarping=False,
                use_textline_orientation=True,
                # Phone photos are ~4000 px; detecting at 1920 px keeps card
                # text in the detector's sweet spot and is several times faster.
                text_det_limit_side_len=1920,
                text_det_limit_type="max",
                **model_paths,
            )
            results = list(ocr.predict(load_image(args.input)))
        texts: list[str] = []
        scores: list[float] = []
        boxes: list[Any] = []
        for result in results:
            collect_recognition(result_payload(result), texts, scores, boxes)
        if texts and all(box is not None for box in boxes):
            texts = group_lines(texts, boxes)
        average = sum(scores) / len(scores) if scores else None
        # ASCII-safe JSON avoids Windows service/console code-page failures;
        # PHP's JSON decoder restores the original Unicode text.
        print(json.dumps({"text": "\n".join(texts), "average_confidence": average, "device": device}, ensure_ascii=True))
        return 0
    except Exception as error:  # Avoid echoing image paths or recognized text.
        print(json.dumps({"error": type(error).__name__}), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
