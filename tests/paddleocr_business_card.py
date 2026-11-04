"""Regression checks for image uploads passed to PaddleOCR."""

from __future__ import annotations

import importlib.util
import contextlib
import io
import json
import math
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

    def test_latin_card_is_read_again_with_latin_model(self) -> None:
        # The East Slavic model garbles Latin cards; the bundled Latin model wins on confidence.
        readings = {
            "eslav_PP-OCRv5_mobile_rec": ("SHUPANO BOAT DESAGN Barcelona", 0.96),
            "latin_PP-OCRv5_mobile_rec": ("SHIP AND BOAT DESIGN Barcelona", 0.99),
        }

        class FakeOCR:
            def __init__(self, **kwargs):
                self.reading = readings[kwargs["text_recognition_model_name"]]

            def predict(self, image):
                return [{"rec_texts": [self.reading[0]], "rec_scores": [self.reading[1]]}]

        with tempfile.TemporaryDirectory() as directory:
            for name in ["PP-OCRv5_server_det", *readings]:
                (Path(directory) / "official_models" / name).mkdir(parents=True)
            args = SimpleNamespace(model_dir=directory, language="uk", device="cpu", input="test.png",
                                   latin_rec_model="latin_PP-OCRv5_mobile_rec")
            output = io.StringIO()
            with patch.object(module, "parse_args", return_value=args), \
                 patch.object(module, "load_image", return_value=None), \
                 patch.dict("sys.modules", {"paddleocr": SimpleNamespace(PaddleOCR=FakeOCR)}), \
                 contextlib.redirect_stdout(output):
                self.assertEqual(module.main(), 0)
        self.assertEqual(json.loads(output.getvalue())["text"], "SHIP AND BOAT DESIGN Barcelona")

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

    def test_words_on_a_tilted_card_are_grouped_along_the_baseline(self) -> None:
        # A card photographed at about -18°: axis-aligned boxes of a short and a long word
        # differ in height and centre, which split the name into "Jose" | "Luis Linares" | "Llamas".
        angle = math.radians(-18)
        along = (math.cos(angle), math.sin(angle))
        across = (-math.sin(angle), math.cos(angle))

        def quad(start: float, line: float, width: float, height: float = 40.0) -> list[list[float]]:
            origin = (300 + start * along[0] + line * across[0], 500 + start * along[1] + line * across[1])
            corner = lambda a, c: [origin[0] + a * along[0] + c * across[0], origin[1] + a * along[1] + c * across[1]]
            return [corner(0, 0), corner(width, 0), corner(width, height), corner(0, height)]

        texts = ["Llamas", "Luis Linares", "Jose", "Technical Director"]
        polys = [quad(400, 0, 140), quad(130, 0, 250), quad(0, 0, 110), quad(0, 70, 330, 28)]
        boxes = [[min(x for x, _ in poly), min(y for _, y in poly), max(x for x, _ in poly), max(y for _, y in poly)] for poly in polys]

        self.assertEqual(module.group_lines(texts, polys), ["Jose Luis Linares Llamas", "Technical Director"])
        self.assertNotIn("Jose Luis Linares Llamas", module.group_lines(texts, boxes))

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
