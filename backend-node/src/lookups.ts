import { ApiError, first, rows, utc, type Row } from "./core.js";
import { requireRole, type Identity } from "./auth.js";
import { db, now } from "./core.js";
import { auditDiff, logAudit, redactEvent } from "./audit.js";
import {
  bool,
  emailError,
  integer,
  max,
  optimistic,
  requiredField,
  str,
  validate,
} from "./domain.js";

const types = new Set([
  "company_type",
  "client_status",
  "task_status",
  "outcome_status",
  "contact_source",
  "reminder_lead_time",
  "cjn_manager",
]);

export function mapLookup(
  row: Row,
  delivery: boolean,
): Record<string, unknown> {
  const mapped: Record<string, unknown> = {
    id: Number(row.id),
    type: String(row.type),
    key: String(row.key_code),
    value: String(row.value),
    sort_order: Number(row.sort_order),
    is_active: Boolean(row.is_active),
    is_closed: Boolean(row.is_closed),
    minutes_before:
      row.minutes_before === null ? null : Number(row.minutes_before),
    requires_detail: Boolean(row.requires_detail),
    requires_referral: Boolean(row.requires_referral),
    created_at: utc(row.created_at),
    updated_at: utc(row.updated_at),
  };
  if (delivery) {
    mapped.user_id = row.user_id === null ? null : Number(row.user_id);
    mapped.email = row.email;
  }
  return mapped;
}

export function checkType(type: string): void {
  if (!types.has(type))
    throw new ApiError(
      404,
      "lookup_type_not_found",
      "Неизвестный тип справочника.",
    );
}

export function pagination(url: URL): {
  page: number;
  perPage: number;
  offset: number;
  meta: (total: number) => Record<string, number>;
} {
  const page = Math.max(
    1,
    Number.parseInt(url.searchParams.get("page") ?? "1", 10) || 1,
  );
  const perPage = Math.max(
    1,
    Math.min(
      100,
      Number.parseInt(url.searchParams.get("per_page") ?? "50", 10) || 50,
    ),
  );
  return {
    page,
    perPage,
    offset: (page - 1) * perPage,
    meta: (total) => ({
      page,
      per_page: perPage,
      total,
      pages: Math.max(1, Math.ceil(total / perPage)),
    }),
  };
}

export async function allLookups(
  url: URL,
  identity: Identity,
): Promise<Record<string, unknown[]>> {
  const includeInactive =
    url.searchParams.get("include_inactive") === "true" ||
    url.searchParams.get("include_inactive") === "1";
  if (includeInactive) requireRole(identity, "admin");
  const all = await rows(
    `SELECT * FROM lookups ${includeInactive ? "" : "WHERE is_active = 1"} ORDER BY type,sort_order,id`,
  );
  const grouped: Record<string, unknown[]> = {};
  for (const row of all)
    (grouped[String(row.type)] ??= []).push(
      mapLookup(row, identity.user.role === "admin"),
    );
  return grouped;
}

export async function typedLookups(
  url: URL,
  identity: Identity,
  type: string,
): Promise<{ data: unknown[]; meta: Record<string, number> }> {
  checkType(type);
  const includeInactive =
    url.searchParams.get("include_inactive") === "true" ||
    url.searchParams.get("include_inactive") === "1";
  if (includeInactive) requireRole(identity, "admin");
  const paging = pagination(url);
  const where = `type = ? ${includeInactive ? "" : "AND is_active = 1"}`;
  const total = Number(
    (
      await first(`SELECT COUNT(*) AS total FROM lookups WHERE ${where}`, [
        type,
      ])
    )?.total ?? 0,
  );
  const result = await rows(
    `SELECT * FROM lookups WHERE ${where} ORDER BY sort_order,id LIMIT ? OFFSET ?`,
    [type, paging.perPage, paging.offset],
  );
  return {
    data: result.map((row) => mapLookup(row, identity.user.role === "admin")),
    meta: paging.meta(total),
  };
}

async function extraFields(
  type: string,
  input: Record<string, unknown>,
  fallback: Row | null = null,
): Promise<Record<string, unknown>> {
  const values: Record<string, unknown> = {
    is_closed:
      type === "task_status" &&
      bool(input, "is_closed", Boolean(fallback?.is_closed))
        ? 1
        : 0,
    minutes_before:
      type === "reminder_lead_time"
        ? integer(
            input,
            "minutes_before",
            fallback?.minutes_before == null
              ? null
              : Number(fallback.minutes_before),
          )
        : null,
    requires_detail:
      type === "contact_source" &&
      bool(input, "requires_detail", Boolean(fallback?.requires_detail))
        ? 1
        : 0,
    requires_referral:
      type === "contact_source" &&
      bool(input, "requires_referral", Boolean(fallback?.requires_referral))
        ? 1
        : 0,
    user_id:
      type === "cjn_manager"
        ? "user_id" in input
          ? integer(input, "user_id")
          : (fallback?.user_id ?? null)
        : null,
    email:
      type === "cjn_manager"
        ? "email" in input
          ? str(input, "email") || null
          : (fallback?.email ?? null)
        : null,
  };
  if (
    type === "reminder_lead_time" &&
    (!values.minutes_before || Number(values.minutes_before) < 1)
  )
    throw new ApiError(
      400,
      "validation_error",
      "Для Reminder Lead Time укажите minutes_before больше нуля.",
    );
  if (values.email && emailError(String(values.email)))
    throw new ApiError(
      400,
      "validation_error",
      "Fallback email указан некорректно.",
    );
  if (
    values.user_id &&
    !(await first("SELECT id FROM users WHERE id=?", [values.user_id]))
  )
    throw new ApiError(
      400,
      "invalid_user",
      "Связанный пользователь не найден.",
    );
  return values;
}

async function getRow(id: number): Promise<Record<string, unknown>> {
  const row = await first("SELECT * FROM lookups WHERE id=?", [id]);
  if (!row)
    throw new ApiError(
      404,
      "lookup_not_found",
      "Значение справочника не найдено.",
    );
  return mapLookup(row, true);
}

export async function lookupStore(
  identity: Identity,
  type: string,
  input: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  requireRole(identity, "admin");
  checkType(type);
  const value = str(input, "value", "")!;
  const key = str(input, "key", `custom_${randomBytes(5).toString("hex")}`)!;
  validate({
    value: requiredField(value) || max(value, 255),
    key: /^[a-z0-9_-]+$/.test(key) ? "" : "Только a-z, 0-9, _ и -.",
  });
  const sort =
    integer(input, "sort_order") ??
    Number(
      (
        await first(
          "SELECT COALESCE(MAX(sort_order),0)+1 AS next FROM lookups WHERE type=?",
          [type],
        )
      )?.next ?? 1,
    );
  const extra = await extraFields(type, input);
  const conn = await db.getConnection();
  let id = 0;
  try {
    await conn.beginTransaction();
    const [result] = await conn.execute(
      `INSERT INTO lookups
      (type,key_code,value,sort_order,is_active,is_closed,minutes_before,requires_detail,requires_referral,user_id,email,
      created_by,updated_by,created_at,updated_at) VALUES (?,?,?,?,1,?,?,?,?,?,?,?,?,?,?)`,
      [
        type,
        key,
        value,
        sort,
        extra.is_closed,
        extra.minutes_before,
        extra.requires_detail,
        extra.requires_referral,
        extra.user_id,
        extra.email,
        identity.user.id,
        identity.user.id,
        now(),
        now(),
      ] as Array<string | number | null>,
    );
    id = "insertId" in result ? Number(result.insertId) : 0;
    await logAudit(conn, identity, {
      action: "LOOKUP CHANGE",
      entityType: "Lookup",
      entityId: id,
      entityLabel: value,
      detail: { operation: "create", type },
    });
    await conn.commit();
  } catch (error) {
    await conn.rollback();
    if ((error as { code?: string }).code === "ER_DUP_ENTRY")
      throw new ApiError(
        409,
        "lookup_duplicate",
        "Такой ключ или значение уже существует в справочнике.",
      );
    throw error;
  } finally {
    conn.release();
  }
  return getRow(id);
}

export async function lookupUpdate(
  identity: Identity,
  type: string,
  id: number,
  input: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  requireRole(identity, "admin");
  checkType(type);
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [result] = await conn.execute<Row[]>(
      "SELECT * FROM lookups WHERE id=? AND type=? FOR UPDATE",
      [id, type],
    );
    const before = result[0];
    if (!before)
      throw new ApiError(
        404,
        "lookup_not_found",
        "Значение справочника не найдено.",
      );
    optimistic(before, input.updated_at);
    const value = str(input, "value", String(before.value))!;
    validate({ value: requiredField(value) || max(value, 255) });
    const sort = integer(input, "sort_order", Number(before.sort_order))!;
    const active = bool(input, "is_active", Boolean(before.is_active));
    const extra = await extraFields(type, input, before);
    await conn.execute(
      `UPDATE lookups SET value=?,sort_order=?,is_active=?,is_closed=?,minutes_before=?,
      requires_detail=?,requires_referral=?,user_id=?,email=?,updated_by=?,updated_at=? WHERE id=? AND type=?`,
      [
        value,
        sort,
        active ? 1 : 0,
        extra.is_closed,
        extra.minutes_before,
        extra.requires_detail,
        extra.requires_referral,
        extra.user_id,
        extra.email,
        identity.user.id,
        now(),
        id,
        type,
      ] as Array<string | number | null>,
    );
    const [afterRows] = await conn.execute<Row[]>(
      "SELECT * FROM lookups WHERE id=? FOR UPDATE",
      [id],
    );
    await auditDiff(
      conn,
      identity,
      "Lookup",
      id,
      value,
      before,
      afterRows[0]!,
      {
        value: "Value",
        sort_order: "Sort order",
        is_active: "Active",
        is_closed: "Closed status",
        minutes_before: "Minutes before",
        requires_detail: "Requires detail",
        requires_referral: "Requires referral",
        user_id: "Linked user",
        email: "Fallback email",
      },
    );
    await logAudit(conn, identity, {
      action: "LOOKUP CHANGE",
      entityType: "Lookup",
      entityId: id,
      entityLabel: value,
      detail: { operation: "update", type },
    });
    await conn.commit();
  } catch (error) {
    await conn.rollback();
    if ((error as { code?: string }).code === "ER_DUP_ENTRY")
      throw new ApiError(
        409,
        "lookup_duplicate",
        "Такое значение уже существует в справочнике.",
      );
    throw error;
  } finally {
    conn.release();
  }
  return getRow(id);
}

export async function lookupLog(
  url: URL,
  identity: Identity,
  type: string,
  id: number,
): Promise<{ data: Row[]; meta: Record<string, number> }> {
  requireRole(identity, "admin");
  checkType(type);
  const row = await getRow(id);
  if (row.type !== type)
    throw new ApiError(
      404,
      "lookup_not_found",
      "Значение справочника не найдено.",
    );
  const paging = pagination(url);
  const total = Number(
    (
      await first(
        "SELECT COUNT(*) AS total FROM change_events WHERE entity_type=? AND entity_id=?",
        ["Lookup", id],
      )
    )?.total ?? 0,
  );
  const data = (
    await rows(
      `SELECT * FROM change_events WHERE entity_type=? AND entity_id=? ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?`,
      ["Lookup", id, paging.perPage, paging.offset],
    )
  ).map(redactEvent);
  return { data, meta: paging.meta(total) };
}
import { randomBytes } from "node:crypto";
