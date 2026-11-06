"""Regression checks for the Qwen3-VL (Ollama) business-card runner."""

from __future__ import annotations

import base64
import contextlib
import importlib.util
import io
import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from PIL import Image


SCRIPT = Path(__file__).resolve().parents[1] / "backend" / "ai" / "qwen_vl_business_card.py"
spec = importlib.util.spec_from_file_location("qwen_vl_business_card", SCRIPT)
assert spec is not None and spec.loader is not None
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def decode(encoded: str) -> Image.Image:
    return Image.open(io.BytesIO(base64.b64decode(encoded)))


class QwenVlRunnerTest(unittest.TestCase):
    def test_supported_image_bytes_in_php_temporary_file(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            image_path = Path(directory) / "php123.tmp"
            for image_format in ("PNG", "JPEG", "WEBP", "BMP", "TIFF"):
                with self.subTest(image_format=image_format):
                    Image.new("RGB", (32, 20), (12, 34, 56)).save(image_path, format=image_format)
                    image = decode(module.encode_image(str(image_path), 1600))
                    self.assertEqual((image.format, image.size), ("JPEG", (32, 20)))

    def test_transparent_background_becomes_white(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            image_path = Path(directory) / "php456.tmp"
            Image.new("RGBA", (8, 8), (0, 0, 0, 0)).save(image_path, format="PNG")
            pixel = decode(module.encode_image(str(image_path), 1600)).getpixel((0, 0))
            self.assertTrue(all(channel > 245 for channel in pixel))

    def test_phone_photo_is_downscaled_keeping_aspect(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            image_path = Path(directory) / "php789.tmp"
            Image.new("RGB", (4000, 3000), "white").save(image_path, format="JPEG")
            self.assertEqual(decode(module.encode_image(str(image_path), 1600)).size, (1600, 1200))

    def test_reply_is_cleaned_to_card_lines(self) -> None:
        reply = "<think>reading</think>```text\nOlena Petrenko\n\n  Sales Director  \n```"
        self.assertEqual(module.clean_text(reply), "Olena Petrenko\nSales Director")

    def test_main_prints_php_contract(self) -> None:
        args = SimpleNamespace(input="card.png", url="http://ollama:11434", model="qwen3-vl:4b-instruct",
                               max_side=1600, timeout=10)
        output = io.StringIO()
        with patch.object(module, "parse_args", return_value=args), \
             patch.object(module, "encode_image", return_value="aW1n"), \
             patch.object(module, "recognize", return_value="Олена Петренко\n+380 67 123 45 67") as recognize, \
             contextlib.redirect_stdout(output):
            self.assertEqual(module.main(), 0)
        recognize.assert_called_once_with("http://ollama:11434", "qwen3-vl:4b-instruct", "aW1n", 10)
        self.assertEqual(json.loads(output.getvalue()),
                         {"text": "Олена Петренко\n+380 67 123 45 67", "average_confidence": None, "device": "ollama"})


if __name__ == "__main__":
    unittest.main()
