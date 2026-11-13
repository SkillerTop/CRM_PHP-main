import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IncomingMessage } from "node:http";
import { ApiError, db, type Row } from "./core.js";
import { parseUpload } from "./attachments.js";

export async function runEngine(
  command: string[],
  timeoutSeconds: number,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  if (!command[0])
    throw new ApiError(
      503,
      "ai_engine_not_configured",
      "AI-движок не настроен на сервере.",
    );
  const timeout =
    Math.max(
      1,
      Math.min(
        timeoutSeconds,
        Number(process.env.AI_MAX_TIMEOUT_SECONDS ?? 900),
      ),
    ) * 1000;
  const maxOutput = Math.max(
    1024,
    Number(process.env.AI_MAX_OUTPUT_BYTES ?? 1024 * 1024),
  );
  return new Promise((resolveResult, reject) => {
    const child = spawn(command[0]!, command.slice(1), {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "",
      stderr = "",
      size = 0,
      settled = false;
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      child.kill();
      reject(error);
    };
    const timer = setTimeout(
      () =>
        fail(
          new ApiError(
            504,
            "ai_engine_timeout",
            "AI-движок не успел обработать файл вовремя.",
          ),
        ),
      timeout,
    );
    const collect = (which: "stdout" | "stderr", data: Buffer) => {
      size += data.length;
      if (size > maxOutput) {
        fail(
          new ApiError(
            503,
            "ai_engine_output_limit",
            "AI-движок превысил лимит диагностического вывода.",
          ),
        );
        return;
      }
      if (which === "stdout") stdout += data.toString("utf8");
      else stderr += data.toString("utf8");
    };
    child.stdout.on("data", (data: Buffer) => collect("stdout", data));
    child.stderr.on("data", (data: Buffer) => collect("stderr", data));
    child.on("error", () =>
      fail(
        new ApiError(
          503,
          "ai_engine_unavailable",
          "Не удалось запустить локальный AI-движок.",
        ),
      ),
    );
    child.on("close", (code) => {
      clearTimeout(timer);
      if (!settled) {
        settled = true;
        resolveResult({ exitCode: code ?? -1, stdout, stderr });
      }
    });
  });
}
export async function exclusive<T>(
  scope: string,
  operation: () => Promise<T>,
): Promise<T> {
  const conn = await db.getConnection();
  const name = `crm_resource_${randomBytes(20).toString("hex")}`;
  // MySQL advisory locks are bound to a connection, shared among all application instances.
  const lockName =
    scope === "ocr"
      ? "crm_resource_ocr"
      : scope === "speech"
        ? "crm_resource_speech"
        : name;
  try {
    const [result] = await conn.query<Row[]>(
      "SELECT GET_LOCK(?, 0) AS acquired",
      [lockName],
    );
    if (Number(result[0]?.acquired) !== 1)
      throw new ApiError(
        429,
        "resource_busy",
        "Сервис занят другой операцией. Повторите позже.",
      );
    return await operation();
  } finally {
    await conn.query("SELECT RELEASE_LOCK(?)", [lockName]).catch(() => {});
    conn.release();
  }
}
export async function withUploadedFile<T>(
  req: IncomingMessage,
  kind: "ocr" | "speech",
  operation: (path: string, name: string) => Promise<T>,
): Promise<T> {
  let file;
  try {
    file = await parseUpload(
      req,
      Number(
        process.env[
          kind === "ocr" ? "OCR_MAX_FILE_MB" : "WHISPER_MAX_FILE_MB"
        ] ?? (kind === "ocr" ? 20 : 25),
      ) *
        1024 *
        1024,
    );
  } catch (error) {
    if (error instanceof ApiError && error.code === "upload_failed")
      throw new ApiError(
        400,
        "file_required",
        kind === "ocr"
          ? "Добавьте фото или скан визитки."
          : "Добавьте аудиозапись.",
      );
    throw error;
  }
  const max =
    Number(
      process.env[kind === "ocr" ? "OCR_MAX_FILE_MB" : "WHISPER_MAX_FILE_MB"] ??
        (kind === "ocr" ? 20 : 25),
    ) *
    1024 *
    1024;
  if (!file.content.length || file.content.length > max)
    throw new ApiError(
      413,
      "file_too_large",
      kind === "ocr"
        ? "Файл визитки слишком большой."
        : "Аудиофайл слишком большой.",
    );
  const directory = await mkdtemp(join(tmpdir(), `crm-${kind}-`));
  const extension =
    /\.([a-z0-9]{2,8})$/i.exec(file.name)?.[1]?.toLowerCase() ??
    (kind === "ocr" ? "jpg" : "webm");
  const path = join(directory, `input.${extension}`);
  try {
    await writeFile(path, file.content);
    return await operation(path, file.name);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
