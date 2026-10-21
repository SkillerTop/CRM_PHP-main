#!/usr/bin/env python3
"""Local GPU speech transcription for the CRM.

Prints one small JSON object to stdout. Audio and transcript content are never
written to logs by this runner.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--model", default="large-v3-turbo")
    parser.add_argument("--cache-dir", required=True)
    parser.add_argument("--device", default="cuda")
    parser.add_argument("--compute-type", default="float16")
    parser.add_argument("--beam-size", type=int, default=5)
    parser.add_argument("--language", default="")
    parser.add_argument("--initial-prompt", default="")
    parser.add_argument("--ffmpeg-bin", default="")
    return parser.parse_args()


def transcribe_with_openai_whisper(args: argparse.Namespace) -> tuple[str, str | None]:
    """Use an existing CPU Whisper installation when Faster-Whisper is absent."""
    if args.device != "cpu":
        raise RuntimeError("faster_whisper is required for GPU transcription")
    if args.ffmpeg_bin:
        ffmpeg = Path(args.ffmpeg_bin)
        if not ffmpeg.is_file():
            raise FileNotFoundError("Configured FFmpeg executable is unavailable")
        os.environ["PATH"] = str(ffmpeg.parent) + os.pathsep + os.environ.get("PATH", "")

    import whisper

    model = whisper.load_model(args.model, device="cpu", download_root=args.cache_dir)
    result = model.transcribe(
        args.input,
        language=args.language or None,
        beam_size=max(1, min(args.beam_size, 10)),
        fp16=False,
        verbose=None,
        condition_on_previous_text=False,
        initial_prompt=args.initial_prompt or None,
    )
    return str(result.get("text") or ""), result.get("language")


def main() -> int:
    args = parse_args()
    try:
        try:
            from faster_whisper import WhisperModel
        except ModuleNotFoundError as error:
            if error.name != "faster_whisper":
                raise
            text, language = transcribe_with_openai_whisper(args)
        else:
            model = WhisperModel(
                args.model,
                device=args.device,
                compute_type=args.compute_type,
                download_root=args.cache_dir,
            )
            segments, info = model.transcribe(
                args.input,
                language=args.language or None,
                beam_size=max(1, min(args.beam_size, 10)),
                vad_filter=True,
                vad_parameters={"min_silence_duration_ms": 350},
                condition_on_previous_text=False,
                initial_prompt=args.initial_prompt or None,
            )
            text = " ".join(segment.text.strip() for segment in segments if segment.text.strip())
            language = getattr(info, "language", None)
        text = re.sub(r"\s+", " ", text).strip()
        # Keep the pipe ASCII-safe on Windows, where PHP may launch Python with
        # a legacy console encoding. PHP's JSON decoder restores Unicode text.
        print(json.dumps({"text": text, "language": language}))
        return 0
    except Exception as error:  # Content-free diagnostic for the PHP wrapper.
        print(json.dumps({"error": type(error).__name__}), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
