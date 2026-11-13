import type { ServerResponse } from "node:http";
import { ApiError, db, first, now, reply, rows, type Row } from "./core.js";
import { requireRole, type Identity } from "./auth.js";
import { logAudit, auditDiff, redactEvent } from "./audit.js";
import { pagination } from "./lookups.js";
import {
  bool,
  companyMap,
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
import { identicalName, matchingNames, nameKeys } from "./name-match.js";

const select = `SELECT c.*, ct.value AS type_value,cs.value AS status_value,mgr.value AS manager_value,
  COALESCE(manager_user.email,mgr.email) AS manager_email,creator.full_name AS created_by_name,
  creator.email AS created_by_email FROM companies c
  JOIN lookups ct ON ct.id=c.type_lookup_id JOIN lookups cs ON cs.id=c.status_lookup_id
  JOIN lookups mgr ON mgr.id=c.manager_lookup_id LEFT JOIN users manager_user ON manager_user.id=mgr.user_id
  LEFT JOIN users creator ON creator.id=c.created_by`;

export async function findCompany(
  id: number,
  includeArchived: boolean,
): Promise<Row> {
  const row = await first(
    `${select} WHERE c.id=? ${includeArchived ? "" : "AND c.is_archived=0"}`,
    [id],
  );
  if (!row)
    throw new ApiError(404, "company_not_found", "Компания не найдена.");
  return row;
}

export async function companyIndex(
  url: URL,
  identity: Identity,
): Promise<{ data: unknown[]; meta: Record<string, number> }> {
  const page = pagination(url);
  const includeArchived =
    identity.user.role === "admin" &&
    ["true", "1"].includes(url.searchParams.get("include_archived") ?? "");
  const where = includeArchived ? [] : ["c.is_archived=0"];
  const params: Array<string | number> = [];
  for (const key of ["type", "status"] as const) {
    const raw = url.searchParams.get(key);
    if (raw && /^-?\d+$/.test(raw)) {
      where.push(`c.${key}_lookup_id=?`);
      params.push(Number(raw));
    }
  }
  const q = (url.searchParams.get("q") ?? "").trim();
  if (q) {
    where.push(
      "(c.name LIKE ? OR c.country LIKE ? OR c.city LIKE ? OR c.description LIKE ? OR c.website LIKE ? OR c.linkedin LIKE ?)",
    );
    params.push(...Array(6).fill(`%${q}%`));
  }
  const predicate = where.length ? where.join(" AND ") : "1=1";
  const total = Number(
    (
      await first(
        `SELECT COUNT(*) AS total FROM companies c WHERE ${predicate}`,
        params,
      )
    )?.total ?? 0,
  );
  const sorts: Record<string, string> = {
    name: "c.name",
    type: "type_value",
    country: "c.country",
    city: "c.city",
    status: "status_value",
    last_contact_date: "c.last_contact_date",
    updated_at: "c.updated_at",
  };
  const sort = sorts[url.searchParams.get("sort") ?? "name"] ?? "c.name";
  const dir =
    url.searchParams.get("dir")?.toLowerCase() === "desc" ? "DESC" : "ASC";
  const result = await rows(
    `${select} WHERE ${predicate} ORDER BY ${sort} ${dir},c.id ${dir} LIMIT ? OFFSET ?`,
    [...params, page.perPage, page.offset],
  );
  return { data: result.map(companyMap), meta: page.meta(total) };
}

export async function companyShow(
  identity: Identity,
  id: number,
): Promise<Record<string, unknown>> {
  return companyMap(await findCompany(id, identity.user.role === "admin"));
}

export async function companyLogo(
  res: ServerResponse,
  identity: Identity,
  id: number,
): Promise<void> {
  const row = await findCompany(id, identity.user.role === "admin");
  if (!row.logo_data_url)
    throw new ApiError(404, "image_not_found", "Изображение не найдено.");
  const { mime, content } = decodeImage(String(row.logo_data_url));
  res.writeHead(200, {
    "Content-Type": mime,
    "Content-Length": content.length,
    "X-Content-Type-Options": "nosniff",
  });
  res.end(content);
}

type CompanyInput = {
  name: string;
  type_id: number;
  country: string;
  city: string | null;
  status_id: number;
  manager_id: number;
  website: string | null;
  linkedin: string | null;
  nda_status: string;
  logo_data_url: string | null;
  description: string | null;
};

async function validated(
  input: Record<string, unknown>,
  current: Row | null = null,
): Promise<CompanyInput> {
  const name = str(input, "name", "")!,
    type = integer(input, "type_id"),
    country = str(input, "country", "")!;
  const status = integer(input, "status_id"),
    manager = integer(input, "manager_id");
  const website = normalizeUrl(nullable(input, "website")),
    linkedin = normalizeUrl(nullable(input, "linkedin"));
  const nda = str(
    input,
    "nda_status",
    String(current?.nda_status ?? "Not Signed"),
  )!;
  validate({
    name: requiredField(name) || max(name, 255),
    type_id: type === null ? "Обязательное поле." : "",
    country: requiredField(country) || max(country, 100),
    city: max(nullable(input, "city"), 100),
    status_id: status === null ? "Обязательное поле." : "",
    manager_id: manager === null ? "Обязательное поле." : "",
    website: urlError(website),
    linkedin: urlError(linkedin),
    nda_status: [
      "Not Signed",
      "Company-wide",
      "Project-specific",
      "Expired",
    ].includes(nda)
      ? ""
      : "Неизвестный статус NDA.",
  });
  await Promise.all([
    lookup(
      type!,
      "company_type",
      current?.type_lookup_id == null ? null : Number(current.type_lookup_id),
    ),
    lookup(
      status!,
      "client_status",
      current?.status_lookup_id == null
        ? null
        : Number(current.status_lookup_id),
    ),
    lookup(
      manager!,
      "cjn_manager",
      current?.manager_lookup_id == null
        ? null
        : Number(current.manager_lookup_id),
    ),
  ]);
  return {
    name,
    type_id: type!,
    country,
    city: nullable(input, "city"),
    status_id: status!,
    manager_id: manager!,
    website,
    linkedin,
    nda_status: nda,
    logo_data_url:
      "logo_data_url" in input
        ? validateImage(
            nullable(input, "logo_data_url"),
            5 * 1024 * 1024,
            "invalid_company_logo",
            "Логотип должен быть JPG, PNG или WebP размером не более 5 МБ.",
          )
        : ((current?.logo_data_url as string | null) ?? null),
    description: nullable(input, "description"),
  };
}

async function duplicateGuard(
  name: string,
  exceptId: number | null,
  allow: boolean,
  changed = true,
): Promise<void> {
  if (!changed) return;
  const candidates = await rows(
    "SELECT id,name,is_archived FROM companies WHERE id<>?",
    [exceptId ?? 0],
  );
  const wanted = nameKeys(name);
  for (const row of candidates) {
    const candidate = String(row.name);
    if (identicalName(candidate, name)) {
      const archived = Boolean(row.is_archived);
      throw new ApiError(
        409,
        "company_exists",
        `Company "${candidate}"${archived ? " (archived)" : ""} already exists. Use the existing record.`,
        {
          duplicate: {
            id: Number(row.id),
            name: candidate,
            is_archived: archived,
          },
        },
      );
    }
  }
  if (allow) return;
  const similar = candidates.find((row) =>
    matchingNames(wanted, nameKeys(String(row.name))),
  );
  if (similar)
    throw new ApiError(
      409,
      "possible_duplicate",
      `A similar company already exists: ${similar.name}.`,
      {
        duplicate: { id: Number(similar.id), name: similar.name },
        retry_with: { allow_duplicate: true },
      },
    );
}

export async function companyStore(
  identity: Identity,
  input: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  requireRole(identity, "admin", "manager", "editor");
  const data = await validated(input);
  await duplicateGuard(data.name, null, bool(input, "allow_duplicate"));
  const conn = await db.getConnection();
  let id = 0;
  try {
    await conn.beginTransaction();
    const [result] = await conn.execute(
      `INSERT INTO companies
      (name,type_lookup_id,country,city,status_lookup_id,manager_lookup_id,website,linkedin,nda_status,logo_data_url,description,
       is_archived,created_by,updated_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,0,?,?,?,?)`,
      [
        data.name,
        data.type_id,
        data.country,
        data.city,
        data.status_id,
        data.manager_id,
        data.website,
        data.linkedin,
        data.nda_status,
        data.logo_data_url,
        data.description,
        identity.user.id,
        identity.user.id,
        now(),
        now(),
      ],
    );
    id = "insertId" in result ? Number(result.insertId) : 0;
    await logAudit(conn, identity, {
      action: "CREATE",
      entityType: "Company",
      entityId: id,
      entityLabel: data.name,
      detail: { company_id: id },
    });
    await conn.commit();
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
  return companyMap(await findCompany(id, true));
}

export async function companyUpdate(
  identity: Identity,
  id: number,
  input: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  requireRole(identity, "admin", "manager", "editor");
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [currentRows] = await conn.execute<Row[]>(
      "SELECT * FROM companies WHERE id=? FOR UPDATE",
      [id],
    );
    const before = currentRows[0];
    if (!before)
      throw new ApiError(404, "company_not_found", "Компания не найдена.");
    optimistic(before, input.updated_at);
    const data = await validated(input, before);
    await duplicateGuard(
      data.name,
      id,
      bool(input, "allow_duplicate"),
      data.name !== before.name,
    );
    await conn.execute(
      `UPDATE companies SET name=?,type_lookup_id=?,country=?,city=?,status_lookup_id=?,manager_lookup_id=?,
      website=?,linkedin=?,nda_status=?,logo_data_url=?,description=?,updated_by=?,updated_at=? WHERE id=?`,
      [
        data.name,
        data.type_id,
        data.country,
        data.city,
        data.status_id,
        data.manager_id,
        data.website,
        data.linkedin,
        data.nda_status,
        data.logo_data_url,
        data.description,
        identity.user.id,
        now(),
        id,
      ],
    );
    const [afterRows] = await conn.execute<Row[]>(
      "SELECT * FROM companies WHERE id=? FOR UPDATE",
      [id],
    );
    await auditDiff(
      conn,
      identity,
      "Company",
      id,
      data.name,
      before,
      afterRows[0]!,
      {
        name: "Company Name",
        type_lookup_id: "Company Type",
        country: "Country",
        city: "City",
        status_lookup_id: "Status",
        manager_lookup_id: "CJN Manager",
        website: "Website",
        linkedin: "LinkedIn",
        nda_status: "NDA",
        logo_data_url: "Logo",
        description: "Description",
      },
    );
    await conn.commit();
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
  return companyMap(await findCompany(id, true));
}

export async function companyArchive(
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
      "SELECT * FROM companies WHERE id=? FOR UPDATE",
      [id],
    );
    const row = result[0];
    if (!row)
      throw new ApiError(404, "company_not_found", "Компания не найдена.");
    optimistic(row, input.updated_at);
    if (archived) {
      const [counts] = await conn.execute<Row[]>(
        `SELECT COUNT(*) AS total FROM tasks t JOIN lookups s ON s.id=t.status_lookup_id
        WHERE t.company_id=? AND t.is_archived=0 AND s.is_closed=0`,
        [id],
      );
      if (Number(counts[0]?.total ?? 0) > 0)
        throw new ApiError(
          409,
          "company_has_open_tasks",
          "Сначала закройте актуальные задачи компании.",
        );
    }
    await conn.execute(
      "UPDATE companies SET is_archived=?,updated_by=?,updated_at=? WHERE id=?",
      [archived ? 1 : 0, identity.user.id, now(), id],
    );
    await logAudit(conn, identity, {
      action: "ARCHIVE",
      entityType: "Company",
      entityId: id,
      entityLabel: String(row.name),
      detail: { archived },
    });
    await conn.commit();
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
  return companyMap(await findCompany(id, true));
}

export async function companyLog(
  url: URL,
  identity: Identity,
  id: number,
): Promise<{ data: Row[]; meta: Record<string, number> }> {
  await findCompany(id, identity.user.role === "admin");
  const page = pagination(url);
  const total = Number(
    (
      await first(
        "SELECT COUNT(*) AS total FROM change_events WHERE entity_type=? AND entity_id=?",
        ["Company", id],
      )
    )?.total ?? 0,
  );
  const data = (
    await rows(
      `SELECT * FROM change_events WHERE entity_type=? AND entity_id=? ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?`,
      ["Company", id, page.perPage, page.offset],
    )
  ).map(redactEvent);
  return { data, meta: page.meta(total) };
}
