import { randomBytes } from "node:crypto";
import { mkdir, readdir, rename, stat, unlink } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import { ApiError, db, now, sha256, type Row } from "./core.js";
import { backendRoot } from "./paths.js";

export function uploadRoot(): string {
  const configured = process.env.UPLOAD_DIR ?? "storage/uploads";
  return isAbsolute(configured) ? configured : resolve(backendRoot, configured);
}

export function storedPath(relative: string): string {
  const path = relative.replaceAll("\\", "/").trim();
  if (
    !path ||
    path.includes("\0") ||
    path.startsWith("/") ||
    /^[A-Za-z]:/.test(path) ||
    path.split("/").some((x) => x === "." || x === "..")
  )
    throw new ApiError(
      500,
      "invalid_stored_path",
      "Некорректный путь вложения в хранилище.",
    );
  const root = uploadRoot(),
    absolute = resolve(root, ...path.split("/"));
  if (!absolute.startsWith(root + sep))
    throw new ApiError(
      500,
      "invalid_stored_path",
      "Некорректный путь вложения в хранилище.",
    );
  return absolute;
}

export async function directoryBytes(root: string): Promise<number> {
  let total = 0;
  for (const entry of await readdir(root, { withFileTypes: true }).catch(
    () => [],
  )) {
    if (entry.isSymbolicLink()) continue;
    const path = join(root, entry.name);
    if (entry.isDirectory()) total += await directoryBytes(path);
    else if (entry.isFile()) total += (await stat(path)).size;
  }
  return total;
}

export async function checkQuota(incoming: number): Promise<void> {
  const max = Number(
    process.env.UPLOAD_STORAGE_MAX_BYTES ?? 10 * 1024 * 1024 * 1024,
  );
  if ((await directoryBytes(uploadRoot())) + Math.max(0, incoming) > max)
    throw new ApiError(
      507,
      "storage_quota_exceeded",
      "Квота файлового хранилища исчерпана.",
    );
}

export async function resourceConsume(
  scope: string,
  userId: number,
  maximum: number,
  windowMinutes = 60,
): Promise<void> {
  const conn = await db.getConnection(),
    keyHash = sha256(String(userId)),
    scoped = `resource_${scope}`;
  try {
    await conn.beginTransaction();
    const [found] = await conn.execute<Row[]>(
      "SELECT * FROM auth_attempts WHERE scope=? AND key_hash=? FOR UPDATE",
      [scoped, keyHash],
    );
    const previous = found[0];
    const oldStart = previous?.window_started_at
      ? new Date(
          String(previous.window_started_at).replace(" ", "T") + "Z",
        ).getTime()
      : 0;
    const inWindow =
      oldStart >= Date.now() - Math.max(1, windowMinutes) * 60000;
    const attempts = inWindow ? Number(previous?.attempts ?? 0) + 1 : 1;
    if (attempts > Math.max(1, maximum))
      throw new ApiError(
        429,
        "resource_rate_limited",
        "Лимит ресурсоёмких операций исчерпан. Повторите позже.",
        {
          retry_after_seconds: Math.max(
            1,
            Math.ceil((oldStart + windowMinutes * 60000 - Date.now()) / 1000),
          ),
        },
      );
    const start = inWindow ? String(previous!.window_started_at) : now();
    await conn.execute(
      `INSERT INTO auth_attempts (scope,key_hash,attempts,window_started_at,blocked_until,updated_at)
      VALUES (?,?,?,?,NULL,?) ON DUPLICATE KEY UPDATE attempts=VALUES(attempts),window_started_at=VALUES(window_started_at),
      blocked_until=NULL,updated_at=VALUES(updated_at)`,
      [scoped, keyHash, attempts, start, now()],
    );
    await conn.commit();
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

export async function quarantine(
  relative: string,
): Promise<{ original: string; quarantine: string }> {
  const original = storedPath(relative);
  if (!(await stat(original).catch(() => null))?.isFile())
    throw new ApiError(
      404,
      "attachment_file_not_found",
      "Файл вложения отсутствует в хранилище.",
    );
  const trash = join(uploadRoot(), ".trash");
  await mkdir(trash, { recursive: true });
  const target = join(trash, `${randomBytes(24).toString("hex")}.deleted`);
  await rename(original, target);
  return { original, quarantine: target };
}
export async function restoreQuarantine(paths: {
  original: string;
  quarantine: string;
}): Promise<void> {
  await rename(paths.quarantine, paths.original);
}
export async function purgeQuarantine(paths: {
  original: string;
  quarantine: string;
}): Promise<void> {
  await unlink(paths.quarantine);
}
