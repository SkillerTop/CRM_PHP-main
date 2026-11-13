import { mkdir } from "node:fs/promises";
import { basename } from "node:path";
import type { IncomingMessage } from "node:http";
import { ApiError } from "./core.js";
import { runEngine, withUploadedFile } from "./ai-runtime.js";
import { localPath, modelPath, pythonPath } from "./paths.js";

export async function transcribe(
  req: IncomingMessage,
): Promise<{ text: string; language: string | null; model: string }> {
  return withUploadedFile(req, "speech", async (path, name) => {
    const extension = /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase() ?? "";
    if (
      ![
        "webm",
        "wav",
        "mp3",
        "m4a",
        "ogg",
        "flac",
        "mp4",
        "aac",
        "opus",
        "wma",
        "aiff",
        "mkv",
      ].includes(extension)
    )
      throw new ApiError(
        415,
        "unsupported_file_type",
        "Загрузите аудио или запись с микрофона.",
      );
    const script = localPath(
      process.env.WHISPER_SCRIPT ?? "ai/faster_whisper_transcribe.py",
    );
    const { existsSync } = await import("node:fs");
    if (!existsSync(script))
      throw new ApiError(
        503,
        "speech_engine_not_configured",
        "Скрипт Faster-Whisper не найден по указанному пути.",
      );
    const model = modelPath(process.env.WHISPER_MODEL ?? "large-v3-turbo");
    const cache = localPath(
      process.env.WHISPER_MODEL_DIR ?? ".runtime/whisper-models",
    );
    await mkdir(cache, { recursive: true });
    const command = [
      pythonPath(process.env.WHISPER_PYTHON_BIN ?? "python3"),
      script,
      "--input",
      path,
      "--model",
      model,
      "--cache-dir",
      cache,
      "--device",
      process.env.WHISPER_DEVICE ?? "cuda",
      "--compute-type",
      process.env.WHISPER_COMPUTE_TYPE ?? "float16",
      "--beam-size",
      process.env.WHISPER_BEAM_SIZE ?? "5",
    ];
    const language = (process.env.WHISPER_LANGUAGE ?? "").trim().toLowerCase();
    const normalized =
      (
        { auto: "", english: "en", ukrainian: "uk", russian: "ru" } as Record<
          string,
          string
        >
      )[language] ?? language;
    if (normalized) command.push("--language", normalized);
    if (process.env.WHISPER_INITIAL_PROMPT?.trim())
      command.push(
        "--initial-prompt",
        process.env.WHISPER_INITIAL_PROMPT.trim(),
      );
    if (process.env.WHISPER_FFMPEG_BIN?.trim())
      command.push(
        "--ffmpeg-bin",
        localPath(process.env.WHISPER_FFMPEG_BIN.trim()),
      );
    const result = await runEngine(
      command,
      Number(process.env.WHISPER_TIMEOUT_SECONDS ?? 900),
    );
    if (
      result.exitCode !== 0 ||
      /\bSkipping\b.+\bdue to\b|Traceback \(most recent call last\)/is.test(
        `${result.stdout}\n${result.stderr}`,
      )
    )
      throw new ApiError(
        503,
        "speech_engine_failed",
        "Whisper не смог обработать запись. Проверьте формат аудио и повторите попытку.",
      );
    let payload: { text?: unknown; language?: unknown };
    try {
      payload = JSON.parse(result.stdout);
    } catch {
      throw new ApiError(
        503,
        "speech_engine_failed",
        "Faster-Whisper вернул некорректный ответ.",
      );
    }
    const text = String(payload.text ?? "")
      .replace(/\s+/gu, " ")
      .trim();
    if (!text)
      throw new ApiError(
        422,
        "speech_no_text",
        "Речь не распознана. Проверьте выбранный микрофон и говорите не менее 2 секунд.",
      );
    return {
      text,
      language: String(payload.language ?? "").trim() || null,
      model: basename(model.replaceAll("\\", "/")),
    };
  });
}
