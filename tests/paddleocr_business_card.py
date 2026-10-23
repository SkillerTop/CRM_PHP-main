"""Regression checks for image uploads passed to PaddleOCR."""

from __future__ import annotations

import importlib.util
import contextlib
import io
import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from PIL import Image


SCRIPT = Path(__file__).resolve().parents[1] / "backend" / "ai" / "paddleocr_business_card.py"
spec = importlib.util.spec_from_file_location("paddleocr_business_card", SCRIPT)
assert spec is not None and spec.loader is not None
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class UploadedImageTest(unittest.TestCase):
    def test_bundled_directories_pin_matching_model_names(self) -> None:
        # PaddleOCR ignores lang/ocr_version with explicit model directories;
        # leaving names unset can select newer incompatible default models.
        captured = {}

        class FakeOCR:
            def __init__(self, **kwargs):
                captured.update(kwargs)

            def predict(self, image):
                return [{"rec_texts": ["CRM"], "rec_scores": [1.0]}]

        with tempfile.TemporaryDirectory() as directory:
            for name in ["PP-LCNet_x1_0_doc_ori", "UVDoc", "PP-LCNet_x1_0_textline_ori",
                         "PP-OCRv5_server_det", "eslav_PP-OCRv5_mobile_rec"]:
                (Path(directory) / "official_models" / name).mkdir(parents=True)
            args = SimpleNamespace(model_dir=directory, language="uk", device="cpu", input="test.png")
            output = io.StringIO()
            with patch.object(module, "parse_args", return_value=args), \
                 patch.object(module, "load_image", return_value=None), \
                 patch.dict("sys.modules", {"paddleocr": SimpleNamespace(PaddleOCR=FakeOCR)}), \
                 patch.dict("os.environ", {}, clear=False), contextlib.redirect_stdout(output):
                self.assertEqual(module.main(), 0)
            for name, value in captured.items():
                if name.endswith("_model_dir"):
                    self.assertEqual(captured[name.removesuffix("_dir") + "_name"], Path(value).name)
            self.assertEqual(captured["text_detection_model_name"], "PP-OCRv5_server_det")
            self.assertEqual(captured["text_recognition_model_name"], "eslav_PP-OCRv5_mobile_rec")
            self.assertEqual(json.loads(output.getvalue())["text"], "CRM")

    def test_word_boxes_are_grouped_into_card_lines(self) -> None:
        # PP-OCRv5 returns words; a two-column card must keep its columns apart.
        texts = ["Gisle", "Thrane", "Mob.", "+47 481", "Vice", "President", "Sales", "&", "Department"]
        boxes = [
            [100, 100, 200, 140], [215, 102, 330, 140], [700, 100, 790, 140], [805, 101, 960, 139],
            [100, 160, 160, 190], [170, 161, 290, 190],
            [100, 220, 170, 250], [180, 221, 200, 250], [210, 220, 380, 251],
        ]

        self.assertEqual(module.group_lines(texts, boxes), [
            "Gisle Thrane", "Mob. +47 481", "Vice President", "Sales & Department",
        ])

    def test_unwarping_is_disabled_for_card_photos(self) -> None:
        captured = {}

        class FakeOCR:
            def __init__(self, **kwargs):
                captured.update(kwargs)

            def predict(self, image):
                return [{"rec_texts": ["Sales", "Director"], "rec_scores": [1.0, 1.0],
                         "rec_boxes": [[0, 0, 50, 20], [55, 0, 120, 20]]}]

        with tempfile.TemporaryDirectory() as directory:
            args = SimpleNamespace(model_dir=directory, language="uk", device="cpu", input="test.png")
            output = io.StringIO()
            with patch.object(module, "parse_args", return_value=args), \
                 patch.object(module, "load_image", return_value=None), \
                 patch.dict("sys.modules", {"paddleocr": SimpleNamespace(PaddleOCR=FakeOCR)}), \
                 contextlib.redirect_stdout(output):
                self.assertEqual(module.main(), 0)
        self.assertIs(captured["use_doc_unwarping"], False)
        self.assertEqual(captured["text_det_limit_side_len"], 1920)
        self.assertEqual(json.loads(output.getvalue())["text"], "Sales Director")

    def test_supported_image_bytes_in_php_temporary_file(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            image_path = Path(directory) / "php123.tmp"
            for image_format in ("PNG", "JPEG", "WEBP", "BMP", "TIFF"):
                with self.subTest(image_format=image_format):
                    Image.new("RGB", (32, 20), (12, 34, 56)).save(image_path, format=image_format)

                    pixels = module.load_image(str(image_path))

                    self.assertEqual(pixels.shape, (20, 32, 3))
                    self.assertLess(abs(int(pixels[0, 0, 0]) - 56), 8)
                    self.assertLess(abs(int(pixels[0, 0, 1]) - 34), 8)
                    self.assertLess(abs(int(pixels[0, 0, 2]) - 12), 8)

    def test_transparent_background_becomes_white(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            image_path = Path(directory) / "php456.tmp"
            Image.new("RGBA", (8, 8), (0, 0, 0, 0)).save(image_path, format="PNG")

            pixels = module.load_image(str(image_path))

            self.assertEqual(pixels[0, 0].tolist(), [255, 255, 255])


if __name__ == "__main__":
    unittest.main()
