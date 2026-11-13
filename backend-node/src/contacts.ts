import type { ServerResponse } from "node:http";
import { ApiError, db, first, now, rows, type Row } from "./core.js";
import { requireRole, type Identity } from "./auth.js";
import { auditDiff, logAudit, redactEvent } from "./audit.js";
import { pagination } from "./lookups.js";
import {
  bool,
  contactMap,
  emailError,
  integer,
  lookup,
  max,
  normalizeUrl,
  nullable,
  optimistic,
  requiredField,
  str,
  urlError,
  validate,
} from "./domain.js";
import { decodeImage, validateImage } from "./image.js";
import { randomBytes } from "node:crypto";
import { mkdir, writeFile, unlink } from "node:fs/promises";
import { basename, join } from "node:path";
import type { PoolConnection } from "mysql2/promise";
import { checkQuota, resourceConsume, uploadRoot } from "./storage.js";
import { identicalName, matchingNames, nameKeys } from "./name-match.js";

const select = `SELECT k.*,c.name AS company_name,src.value AS source_value,ini.value AS initiated_by_value,
  mgr.value AS manager_value,COALESCE(manager_user.email,mgr.email) AS manager_email,
  creator.full_name AS created_by_name,creator.email AS created_by_email
  FROM contacts k JOIN companies c ON c.id=k.company_id
  LEFT JOIN lookups src ON src.id=k.source_lookup_id LEFT JOIN lookups ini ON ini.id=k.initiated_by_lookup_id
  JOIN lookups mgr ON mgr.id=k.manager_lookup_id
  LEFT JOIN users manager_user ON manager_user.id=mgr.user_id LEFT JOIN users creator ON creator.id=k.created_by`;

async function findContact(id: number, archived: boolean): Promise<Row> {
  const row = await first(
    `${select} WHERE k.id=? ${archived ? "" : "AND k.is_archived=0 AND c.is_archived=0"}`,
    [id],
  );
  if (!row) throw new ApiError(404, "contact_not_found", "Контакт не найден.");
  return row;
}

export async function contactShow(
  identity: Identity,
  id: number,
): Promise<Record<string, unknown>> {
  return contactMap(await findContact(id, identity.user.role === "admin"));
}

export async function contactPhoto(
  res: ServerResponse,
  identity: Identity,
  id: number,
): Promise<void> {
  const row = await findContact(id, identity.user.role === "admin");
  if (!row.photo_data_url)
    throw new ApiError(404, "image_not_found", "Изображение не найдено.");
  const { mime, content } = decodeImage(String(row.photo_data_url));
  res.writeHead(200, {
    "Content-Type": mime,
    "Content-Length": content.length,
    "X-Content-Type-Options": "nosniff",
  });
  res.end(content);
}

export async function contactIndex(
  url: URL,
  identity: Identity,
  companyId: number | null = null,
): Promise<{ data: unknown[]; meta: Record<string, number> }> {
  if (
    companyId !== null &&
    !(await first("SELECT id FROM companies WHERE id=? AND is_archived=0", [
      companyId,
    ]))
  )
    throw new ApiError(
      400,
      "invalid_company",
      "Компания не найдена или заархивирована.",
    );
  const page = pagination(url);
  const includeArchived =
    companyId === null &&
    identity.user.role === "admin" &&
    ["true", "1"].includes(url.searchParams.get("include_archived") ?? "");
  const where = includeArchived ? [] : ["k.is_archived=0", "c.is_archived=0"];
  const params: Array<string | number> = [];
  if (companyId !== null) {
    where.push("k.company_id=?");
    params.push(companyId);
  } else
    for (const [key, column] of [
      ["company", "k.company_id"],
      ["source", "k.source_lookup_id"],
    ] as const) {
      const raw = url.searchParams.get(key);
      if (raw && /^-?\d+$/.test(raw)) {
        where.push(`${column}=?`);
        params.push(Number(raw));
      }
    }
  if (companyId === null) {
    const status = (url.searchParams.get("status") ?? "").trim().toLowerCase();
    if (status === "active" || status === "inactive") {
      where.push("k.contact_status=?");
      params.push(status);
    }
    const linkedin = url.searchParams.get("has_linkedin");
    if (linkedin === "has")
      where.push("k.linkedin IS NOT NULL AND k.linkedin<>''");
    if (linkedin === "no") where.push("(k.linkedin IS NULL OR k.linkedin='')");
    const q = (url.searchParams.get("q") ?? "").trim();
    if (q) {
      where.push(
        "(k.first_name LIKE ? OR k.last_name LIKE ? OR k.email LIKE ? OR k.phone LIKE ? OR k.position LIKE ? OR ini.value LIKE ?)",
      );
      params.push(...Array(6).fill(`%${q}%`));
    }
  }
  const predicate = where.length ? where.join(" AND ") : "1=1";
  const joins = `FROM contacts k JOIN companies c ON c.id=k.company_id LEFT JOIN lookups src ON src.id=k.source_lookup_id LEFT JOIN lookups ini ON ini.id=k.initiated_by_lookup_id`;
  const total = Number(
    (
      await first(
        `SELECT COUNT(*) AS total ${joins} WHERE ${predicate}`,
        params,
      )
    )?.total ?? 0,
  );
  const sorts: Record<string, string> = {
    first_name: "k.first_name",
    last_name: "k.last_name",
    company: "c.name",
    position: "k.position",
    status: "k.contact_status",
    source: "source_value",
    initiated_by: "initiated_by_value",
    email: "k.email",
    updated_at: "k.updated_at",
  };
  const sort =
    companyId === null
      ? (sorts[url.searchParams.get("sort") ?? "last_name"] ?? "k.last_name")
      : "k.last_name";
  const dir =
    companyId === null && url.searchParams.get("dir")?.toLowerCase() === "desc"
      ? "DESC"
      : "ASC";
  const data = (
    await rows(
      `${select} WHERE ${predicate} ORDER BY ${sort} ${dir},k.id ${dir} LIMIT ? OFFSET ?`,
      [...params, page.perPage, page.offset],
    )
  ).map(contactMap);
  return { data, meta: page.meta(total) };
}

type ContactInput = {
  company_id: number;
  first_name: string;
  last_name: string | null;
  position: string | null;
  phone: string | null;
  email: string | null;
  linkedin: string | null;
  source_id: number | null;
  source_detail: string | null;
  referred_by: string | null;
  initiated_by_id: number | null;
  manager_id: number;
  contact_status: string;
  initiated_by_text: string | null;
  photo_data_url: string | null;
};

async function validated(
  input: Record<string, unknown>,
  current: Row | null = null,
): Promise<ContactInput> {
  const company = integer(input, "company_id");
  const firstName = str(input, "first_name", "")!;
  const email = nullable(input, "email")?.toLowerCase() ?? null;
  const linkedin = normalizeUrl(nullable(input, "linkedin"));
  const sourceId = integer(input, "source_id");
  const initiatedBy = integer(input, "initiated_by_id");
  const manager = integer(input, "manager_id");
  const status = String(
    input.status ?? input.contact_status ?? current?.contact_status ?? "active",
  )
    .trim()
    .toLowerCase();
  const initiatedText = nullable(input, "initiated_by_text");
  const source = sourceId
    ? await lookup(
        sourceId,
        "contact_source",
        current?.source_lookup_id == null
          ? null
          : Number(current.source_lookup_id),
      )
    : null;
  const sourceDetail = source?.requires_detail
    ? nullable(input, "source_detail")
    : null;
  const referredBy = source?.requires_referral
    ? nullable(input, "referred_by")
    : null;
  const phone = nullable(input, "phone");
  const phoneError =
    phone &&
    phone
      .split(";")
      .some((part) => !part.trim() || !/^[\d+()\-\s]+$/.test(part.trim()))
      ? "Допустимы цифры, +, пробелы, скобки и дефисы; несколько номеров разделяйте «;»."
      : "";
  validate({
    company_id: company === null ? "Обязательное поле." : "",
    first_name: requiredField(firstName) || max(firstName, 100),
    last_name: max(nullable(input, "last_name"), 100),
    position: max(nullable(input, "position"), 150),
    phone: phoneError || max(phone, 100),
    email: emailError(email) || max(email, 255),
    linkedin: urlError(linkedin),
    source_detail: source?.requires_detail ? requiredField(sourceDetail) : "",
    referred_by: source?.requires_referral ? requiredField(referredBy) : "",
    manager_id: manager === null ? "Обязательное поле." : "",
    status: ["active", "inactive"].includes(status)
      ? ""
      : "Допустимы только значения active или inactive.",
    initiated_by: initiatedBy === null ? requiredField(initiatedText) : "",
  });
  if (
    !(await first("SELECT id FROM companies WHERE id=? AND is_archived=0", [
      company!,
    ]))
  )
    throw new ApiError(
      400,
      "invalid_company",
      "Компания не найдена или заархивирована.",
    );
  if (initiatedBy !== null)
    await lookup(
      initiatedBy,
      "cjn_manager",
      current?.initiated_by_lookup_id == null
        ? null
        : Number(current.initiated_by_lookup_id),
    );
  await lookup(
    manager!,
    "cjn_manager",
    current?.manager_lookup_id == null
      ? null
      : Number(current.manager_lookup_id),
  );
  return {
    company_id: company!,
    first_name: firstName,
    last_name: nullable(input, "last_name"),
    position: nullable(input, "position"),
    phone,
    email,
    linkedin,
    source_id: sourceId,
    source_detail: sourceDetail,
    referred_by: referredBy,
    initiated_by_id: initiatedBy,
    manager_id: manager!,
    contact_status: status,
    initiated_by_text: initiatedBy === null ? initiatedText : null,
    photo_data_url:
      "photo_data_url" in input
        ? validateImage(
            nullable(input, "photo_data_url"),
            5 * 1024 * 1024,
            "invalid_contact_photo",
            "Фото должно быть JPG, PNG или WebP размером не более 5 МБ.",
          )
        : ((current?.photo_data_url as string | null) ?? null),
  };
}

async function similarNameGuard(
  data: ContactInput,
  exceptId: number | null,
  allow: boolean,
): Promise<void> {
  const name = `${data.first_name} ${data.last_name ?? ""}`.trim();
  const candidates = await rows(
    `SELECT k.id,k.first_name,k.last_name,k.is_archived,c.id AS company_id,c.name AS company_name
    FROM contacts k JOIN companies c ON c.id=k.company_id WHERE k.id<>? ORDER BY k.company_id=? DESC,k.id`,
    [exceptId ?? 0, data.company_id],
  );
  const key = nameKeys(name);
  let similar: Row | undefined;
  for (const row of candidates) {
    const candidate = `${row.first_name} ${row.last_name ?? ""}`.trim();
    const sameCompany = Number(row.company_id) === data.company_id;
    if (identicalName(candidate, name)) {
      const archived = Boolean(row.is_archived);
      throw new ApiError(
        409,
        "contact_exists",
        `Contact "${candidate}"${archived ? " (archived)" : ""} already exists ${sameCompany ? "in this company" : `in company ${row.company_name}`}. Use the existing record.`,
        {
          duplicate: {
            id: Number(row.id),
            company_id: Number(row.company_id),
            company: row.company_name,
            is_archived: archived,
          },
        },
      );
    }
    if (!similar && !allow && matchingNames(key, nameKeys(candidate)))
      similar = row;
  }
  if (similar) {
    const same = Number(similar.company_id) === data.company_id;
    const candidate = `${similar.first_name} ${similar.last_name ?? ""}`.trim();
    throw new ApiError(
      409,
      "possible_duplicate",
      same
        ? `A contact with a similar name already exists in this company: ${candidate}.`
        : `A contact with a similar name already exists in another company (${similar.company_name}): ${candidate}.`,
      {
        duplicate: {
          id: Number(similar.id),
          company_id: Number(similar.company_id),
          company: similar.company_name,
        },
        retry_with: { allow_duplicate: true },
      },
    );
  }
}

async function duplicateEmail(
  email: string | null,
  exceptId: number | null,
  allow: boolean,
): Promise<void> {
  if (!email || allow) return;
  const duplicate = await first(
    `SELECT k.id,k.first_name,k.last_name,c.id AS company_id,c.name AS company_name
    FROM contacts k JOIN companies c ON c.id=k.company_id WHERE k.email=? AND k.id<>? LIMIT 1`,
    [email, exceptId ?? 0],
  );
  if (duplicate)
    throw new ApiError(
      409,
      "possible_duplicate",
      `A contact with this email already exists in company ${duplicate.company_name}.`,
      {
        duplicate: {
          id: Number(duplicate.id),
          company_id: Number(duplicate.company_id),
          company: duplicate.company_name,
        },
        retry_with: { allow_duplicate: true },
      },
    );
}

function cardDataUrl(value: string): {
  mime: string;
  content: Buffer;
  extension: string;
} {
  const match =
    /^data:(image\/(?:jpeg|png|webp|bmp|tiff));base64,([A-Za-z0-9+/=\r\n]+)$/i.exec(
      value.trim(),
    );
  if (!match)
    throw new ApiError(
      400,
      "invalid_business_card_file",
      "Файл визитки должен быть корректным изображением размером не более 20 МБ.",
    );
  const content = Buffer.from(
    (match[2] ?? "").replace(/[\r\n]/g, ""),
    "base64",
  );
  const mime = match[1]!.toLowerCase();
  const signatures: Record<string, boolean> = {
    "image/jpeg": content.subarray(0, 3).toString("hex") === "ffd8ff",
    "image/png": content.subarray(0, 8).toString("hex") === "89504e470d0a1a0a",
    "image/webp":
      content.subarray(0, 4).toString() === "RIFF" &&
      content.subarray(8, 12).toString() === "WEBP",
    "image/bmp": content.subarray(0, 2).toString() === "BM",
    "image/tiff": ["49492a00", "4d4d002a"].includes(
      content.subarray(0, 4).toString("hex"),
    ),
  };
  if (
    !content.length ||
    content.length > Number(process.env.OCR_MAX_FILE_MB ?? 20) * 1024 * 1024 ||
    !signatures[mime]
  )
    throw new ApiError(
      400,
      "invalid_business_card_file",
      "Файл визитки должен быть корректным изображением размером не более 20 МБ.",
    );
  return {
    mime,
    content,
    extension: (
      {
        "image/jpeg": "jpg",
        "image/png": "png",
        "image/webp": "webp",
        "image/bmp": "bmp",
        "image/tiff": "tiff",
      } as Record<string, string>
    )[mime]!,
  };
}

async function storeBusinessCard(
  conn: PoolConnection,
  identity: Identity,
  contactId: number,
  label: string,
  dataUrl: string | null,
  fileName: string | null,
  fallback: string,
): Promise<string | null> {
  if (!dataUrl) return null;
  const { mime, content, extension } = cardDataUrl(dataUrl);
  const root = uploadRoot();
  const [lock] = await conn.query<Row[]>(
    "SELECT GET_LOCK('crm_upload_quota',0) AS acquired",
  );
  if (Number(lock[0]?.acquired) !== 1)
    throw new ApiError(
      503,
      "storage_busy",
      "Не удалось зарезервировать место в хранилище.",
    );
  try {
    await checkQuota(content.length);
    const date = new Date();
    const relativeDirectory = `contacts/${contactId}/business-cards/${date.getUTCFullYear()}/${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
    const directory = join(root, relativeDirectory);
    await mkdir(directory, { recursive: true });
    const storedName = `${randomBytes(20).toString("hex")}.${extension}`;
    const path = join(directory, storedName);
    await writeFile(path, content, { flag: "wx" });
    const original = basename(fileName || `${fallback}.${extension}`);
    try {
      await conn.execute(
        `INSERT INTO contact_attachments
        (contact_id,original_name,stored_path,mime_type,size_bytes,attachment_kind,author_user_id,author_name,
         created_by,updated_by,created_at,updated_at) VALUES (?,?,?,?,?,'business_card',?,?,?,?,?,?)`,
        [
          contactId,
          original,
          `${relativeDirectory}/${storedName}`,
          mime,
          content.length,
          identity.user.id,
          identity.user.full_name,
          identity.user.id,
          identity.user.id,
          now(),
          now(),
        ],
      );
      await logAudit(conn, identity, {
        action: "FIELD CHANGE",
        entityType: "Contact",
        entityId: contactId,
        entityLabel: label,
        field: "Attachment",
        from: "—",
        to: original,
        detail: { attachment_kind: "business_card" },
      });
    } catch (error) {
      await unlink(path).catch(() => {});
      throw error;
    }
    return path;
  } finally {
    await conn.query("SELECT RELEASE_LOCK('crm_upload_quota')");
  }
}

export async function contactStore(
  identity: Identity,
  input: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  requireRole(identity, "admin", "manager", "editor");
  for (const field of ["business_card_data_url", "business_card_back_data_url"])
    if (nullable(input, field))
      await resourceConsume(
        "upload",
        identity.user.id,
        Number(process.env.UPLOAD_MAX_REQUESTS_PER_HOUR ?? 100),
      );
  const data = await validated(input);
  await similarNameGuard(data, null, bool(input, "allow_duplicate"));
  await duplicateEmail(data.email, null, bool(input, "allow_duplicate"));
  const conn = await db.getConnection();
  let id = 0;
  const storedPaths: string[] = [];
  try {
    await conn.beginTransaction();
    const [result] = await conn.execute(
      `INSERT INTO contacts
      (company_id,first_name,last_name,position,phone,email,linkedin,source_lookup_id,source_detail,referred_by,
       initiated_by_lookup_id,contact_status,manager_lookup_id,initiated_by_text,photo_data_url,is_archived,
       created_by,updated_by,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,?,?,?,?)`,
      [
        data.company_id,
        data.first_name,
        data.last_name,
        data.position,
        data.phone,
        data.email,
        data.linkedin,
        data.source_id,
        data.source_detail,
        data.referred_by,
        data.initiated_by_id,
        data.contact_status,
        data.manager_id,
        data.initiated_by_text,
        data.photo_data_url,
        identity.user.id,
        identity.user.id,
        now(),
        now(),
      ],
    );
    id = "insertId" in result ? Number(result.insertId) : 0;
    const label = `${data.first_name} ${data.last_name ?? ""}`.trim();
    for (const [field, fallback] of [
      ["business_card", "business-card"],
      ["business_card_back", "business-card-back"],
    ] as const) {
      const path = await storeBusinessCard(
        conn,
        identity,
        id,
        label,
        nullable(input, `${field}_data_url`),
        nullable(input, `${field}_file_name`),
        fallback,
      );
      if (path) storedPaths.push(path);
    }
    await logAudit(conn, identity, {
      action: "CREATE",
      entityType: "Contact",
      entityId: id,
      entityLabel: label,
      detail: { company_id: data.company_id },
    });
    await conn.commit();
  } catch (error) {
    await conn.rollback();
    for (const path of storedPaths) await unlink(path).catch(() => {});
    throw error;
  } finally {
    conn.release();
  }
  return contactMap(await findContact(id, true));
}

export async function contactUpdate(
  identity: Identity,
  id: number,
  input: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  requireRole(identity, "admin", "manager", "editor");
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [beforeRows] = await conn.execute<Row[]>(
      "SELECT * FROM contacts WHERE id=? FOR UPDATE",
      [id],
    );
    const before = beforeRows[0];
    if (!before)
      throw new ApiError(404, "contact_not_found", "Контакт не найден.");
    optimistic(before, input.updated_at);
    const data = await validated(input, before);
    const renamed =
      data.first_name !== before.first_name ||
      data.last_name !== before.last_name ||
      data.company_id !== Number(before.company_id);
    if (renamed)
      await similarNameGuard(data, id, bool(input, "allow_duplicate"));
    await duplicateEmail(data.email, id, bool(input, "allow_duplicate"));
    if (data.company_id !== Number(before.company_id))
      requireRole(identity, "admin");
    await conn.execute(
      `UPDATE contacts SET company_id=?,first_name=?,last_name=?,position=?,phone=?,email=?,linkedin=?,
      source_lookup_id=?,source_detail=?,referred_by=?,initiated_by_lookup_id=?,contact_status=?,manager_lookup_id=?,
      initiated_by_text=?,photo_data_url=?,updated_by=?,updated_at=? WHERE id=?`,
      [
        data.company_id,
        data.first_name,
        data.last_name,
        data.position,
        data.phone,
        data.email,
        data.linkedin,
        data.source_id,
        data.source_detail,
        data.referred_by,
        data.initiated_by_id,
        data.contact_status,
        data.manager_id,
        data.initiated_by_text,
        data.photo_data_url,
        identity.user.id,
        now(),
        id,
      ],
    );
    const [afterRows] = await conn.execute<Row[]>(
      "SELECT * FROM contacts WHERE id=? FOR UPDATE",
      [id],
    );
    await auditDiff(
      conn,
      identity,
      "Contact",
      id,
      `${data.first_name} ${data.last_name ?? ""}`.trim(),
      before,
      afterRows[0]!,
      {
        company_id: "Company",
        contact_status: "Contact status",
        first_name: "First name",
        last_name: "Last name",
        position: "Position",
        phone: "Phone",
        email: "Email",
        linkedin: "LinkedIn",
        source_lookup_id: "First Contact Source",
        source_detail: "Source detail",
        referred_by: "Referred By",
        initiated_by_lookup_id: "Initiated By",
        manager_lookup_id: "CJN Manager",
        initiated_by_text: "Initiated By (manual)",
        photo_data_url: "Photo",
      },
    );
    await conn.commit();
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
  return contactMap(await findContact(id, true));
}

export async function contactArchive(
  identity: Identity,
  id: number,
  input: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  requireRole(identity, "admin");
  const archived = bool(input, "archived", true);
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [result] = await conn.execute<Row[]>(
      "SELECT * FROM contacts WHERE id=? FOR UPDATE",
      [id],
    );
    const row = result[0];
    if (!row)
      throw new ApiError(404, "contact_not_found", "Контакт не найден.");
    optimistic(row, input.updated_at);
    await conn.execute(
      "UPDATE contacts SET is_archived=?,updated_by=?,updated_at=? WHERE id=?",
      [archived ? 1 : 0, identity.user.id, now(), id],
    );
    await logAudit(conn, identity, {
      action: "ARCHIVE",
      entityType: "Contact",
      entityId: id,
      entityLabel: `${row.first_name} ${row.last_name ?? ""}`.trim(),
      detail: { archived },
    });
    await conn.commit();
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
  return contactMap(await findContact(id, true));
}

export async function contactLog(
  url: URL,
  identity: Identity,
  id: number,
): Promise<{ data: Row[]; meta: Record<string, number> }> {
  await findContact(id, identity.user.role === "admin");
  const page = pagination(url);
  const total = Number(
    (
      await first(
        "SELECT COUNT(*) AS total FROM change_events WHERE entity_type=? AND entity_id=?",
        ["Contact", id],
      )
    )?.total ?? 0,
  );
  const data = (
    await rows(
      "SELECT * FROM change_events WHERE entity_type=? AND entity_id=? ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?",
      ["Contact", id, page.perPage, page.offset],
    )
  ).map(redactEvent);
  return { data, meta: page.meta(total) };
}
