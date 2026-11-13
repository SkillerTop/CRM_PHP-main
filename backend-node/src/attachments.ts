import { randomBytes } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createReadStream } from "node:fs";
import { mkdir, stat, unlink, writeFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import Busboy from "busboy";
import { ApiError, db, first, now, utc, type Row } from "./core.js";
import { requireRole, type Identity } from "./auth.js";
import { assertTaskEditable, findTask } from "./tasks.js";
import { logAudit } from "./audit.js";
import {
  checkQuota,
  purgeQuarantine,
  quarantine,
  resourceConsume,
  restoreQuarantine,
  storedPath,
  uploadRoot,
} from "./storage.js";

type IncomingFile = { name: string; content: Buffer };
export async function parseUpload(
  req: IncomingMessage,
  limit = Number(process.env.UPLOAD_MAX_BYTES ?? 20 * 1024 * 1024),
): Promise<IncomingFile> {
  return new Promise((resolve, reject) => {
    let file: IncomingFile | null = null,
      failed: Error | null = null;
    const busboy = Busboy({
      headers: req.headers,
      limits: { files: 1, fileSize: limit + 1, fields: 10 },
    });
    busboy.on("file", (field, stream, info) => {
      if (field !== "file") {
        stream.resume();
        return;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      stream.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size <= limit + 1) chunks.push(chunk);
      });
      stream.on("end", () => {
        if (size > limit)
          failed = new ApiError(
            413,
            "file_too_large",
            "Размер файла превышает допустимый лимит.",
          );
        else
          file = {
            name: basename(info.filename ?? ""),
            content: Buffer.concat(chunks),
          };
      });
    });
    busboy.on("error", reject);
    busboy.on("close", () =>
      failed
        ? reject(failed)
        : file
          ? resolve(file)
          : reject(
              new ApiError(
                400,
                "upload_failed",
                "Файл не получен или загрузка завершилась ошибкой.",
              ),
            ),
    );
    req.pipe(busboy);
  });
}

function validate(file: IncomingFile): { extension: string; mime: string } {
  const extension = extname(file.name).slice(1).toLowerCase(),
    content = file.content;
  if (!content.length)
    throw new ApiError(
      413,
      "file_too_large",
      "Размер файла превышает допустимый лимит.",
    );
  const hex = content.subarray(0, 8).toString("hex");
  const zip = hex.startsWith("504b0304"),
    ole = hex.startsWith("d0cf11e0a1b11ae1");
  const types: Record<string, { mime: string; valid: boolean }> = {
    pdf: {
      mime: "application/pdf",
      valid: content.subarray(0, 5).toString() === "%PDF-",
    },
    doc: { mime: "application/msword", valid: ole },
    xls: { mime: "application/vnd.ms-excel", valid: ole },
    docx: {
      mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      valid:
        zip &&
        content.includes(Buffer.from("[Content_Types].xml")) &&
        content.includes(Buffer.from("word/document.xml")),
    },
    xlsx: {
      mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      valid:
        zip &&
        content.includes(Buffer.from("[Content_Types].xml")) &&
        content.includes(Buffer.from("xl/workbook.xml")),
    },
    msg: { mime: "application/vnd.ms-outlook", valid: ole },
    eml: {
      mime: "message/rfc822",
      valid: /^(From|To|Subject|Date|MIME-Version):/im.test(
        content.subarray(0, 4096).toString(),
      ),
    },
    jpg: { mime: "image/jpeg", valid: hex.startsWith("ffd8ff") },
    jpeg: { mime: "image/jpeg", valid: hex.startsWith("ffd8ff") },
    png: { mime: "image/png", valid: hex === "89504e470d0a1a0a" },
    gif: {
      mime: "image/gif",
      valid: content.subarray(0, 3).toString() === "GIF",
    },
    webp: {
      mime: "image/webp",
      valid:
        content.subarray(0, 4).toString() === "RIFF" &&
        content.subarray(8, 12).toString() === "WEBP",
    },
  };
  const selected = types[extension];
  if (!selected)
    throw new ApiError(
      400,
      "file_type_not_allowed",
      "Разрешены PDF, DOC/DOCX, XLS/XLSX, MSG/EML и изображения.",
    );
  if (!selected.valid)
    throw new ApiError(
      415,
      "file_type_not_allowed",
      "Расширение файла не соответствует его фактическому содержимому.",
    );
  return { extension, mime: selected.mime };
}

async function attachment(id: number, taskId: number): Promise<Row> {
  const row = await first(
    "SELECT * FROM task_attachments WHERE id=? AND task_id=? AND deleted_at IS NULL",
    [id, taskId],
  );
  if (!row)
    throw new ApiError(404, "attachment_not_found", "Вложение не найдено.");
  return row;
}
const mapped = (row: Row) => ({
  id: Number(row.id),
  task_id: Number(row.task_id),
  original_name: String(row.original_name),
  mime_type: String(row.mime_type),
  size_bytes: Number(row.size_bytes),
  author_user_id: Number(row.author_user_id),
  author_name: String(row.author_name),
  created_at: utc(row.created_at),
});

export async function uploadAttachment(
  req: IncomingMessage,
  identity: Identity,
  taskId: number,
): Promise<Record<string, unknown>> {
  requireRole(identity, "admin", "manager", "editor");
  const task = await findTask(identity, taskId, false);
  await assertTaskEditable(task);
  const file = await parseUpload(req),
    type = validate(file);
  await resourceConsume(
    "upload",
    identity.user.id,
    Number(process.env.UPLOAD_MAX_REQUESTS_PER_HOUR ?? 100),
  );
  const conn = await db.getConnection();
  let path = "";
  let id = 0;
  try {
    const [lock] = await conn.query<Row[]>(
      "SELECT GET_LOCK('crm_upload_quota',0) AS acquired",
    );
    if (Number(lock[0]?.acquired) !== 1)
      throw new ApiError(
        503,
        "storage_busy",
        "Не удалось зарезервировать место в хранилище.",
      );
    await checkQuota(file.content.length);
    const date = new Date(),
      relative = `tasks/${taskId}/${date.getUTCFullYear()}/${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
    const directory = join(uploadRoot(), relative);
    await mkdir(directory, { recursive: true });
    const storedName = `${randomBytes(20).toString("hex")}.${type.extension}`;
    path = join(directory, storedName);
    await writeFile(path, file.content, { flag: "wx" });
    await conn.beginTransaction();
    const [result] = await conn.execute(
      `INSERT INTO task_attachments
      (task_id,original_name,stored_path,mime_type,size_bytes,author_user_id,author_name,created_by,updated_by,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [
        taskId,
        file.name,
        `${relative}/${storedName}`,
        type.mime,
        file.content.length,
        identity.user.id,
        identity.user.full_name,
        identity.user.id,
        identity.user.id,
        now(),
        now(),
      ],
    );
    id = "insertId" in result ? Number(result.insertId) : 0;
    await logAudit(conn, identity, {
      action: "FIELD CHANGE",
      entityType: "Task",
      entityId: taskId,
      entityLabel: String(task.name),
      field: "Attachment",
      from: "—",
      to: file.name,
      detail: { attachment_id: id },
    });
    await conn.commit();
  } catch (error) {
    await conn.rollback();
    if (path) await unlink(path).catch(() => {});
    throw error;
  } finally {
    await conn.query("SELECT RELEASE_LOCK('crm_upload_quota')").catch(() => {});
    conn.release();
  }
  return mapped(await attachment(id, taskId));
}

export async function downloadAttachment(
  res: ServerResponse,
  identity: Identity,
  taskId: number,
  id: number,
): Promise<void> {
  await findTask(identity, taskId);
  const row = await attachment(id, taskId),
    path = storedPath(String(row.stored_path));
  const info = await stat(path).catch(() => null);
  if (!info?.isFile())
    throw new ApiError(404, "file_not_found", "Файл не найден.");
  res.writeHead(200, {
    "Content-Type": String(row.mime_type),
    "Content-Length": info.size,
    "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(String(row.original_name))}`,
    "X-Content-Type-Options": "nosniff",
  });
  createReadStream(path).pipe(res);
}

export async function deleteAttachment(
  identity: Identity,
  taskId: number,
  id: number,
): Promise<void> {
  requireRole(identity, "admin", "manager", "editor");
  const task = await findTask(identity, taskId);
  await assertTaskEditable(task);
  const row = await attachment(id, taskId);
  if (
    identity.user.role !== "admin" &&
    Number(row.author_user_id) !== identity.user.id
  )
    throw new ApiError(
      403,
      "forbidden",
      "Удалить вложение может только его автор или Admin.",
    );
  const paths = await quarantine(String(row.stored_path)),
    conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    await conn.execute(
      "DELETE FROM task_attachments WHERE id=? AND deleted_at IS NULL",
      [id],
    );
    await logAudit(conn, identity, {
      action: "FIELD CHANGE",
      entityType: "Task",
      entityId: taskId,
      entityLabel: String(task.name),
      field: "Attachment",
      from: String(row.original_name),
      to: "—",
      detail: { attachment_id: id },
    });
    await conn.commit();
  } catch (error) {
    await conn.rollback();
    await restoreQuarantine(paths);
    throw error;
  } finally {
    conn.release();
  }
  await purgeQuarantine(paths);
}
