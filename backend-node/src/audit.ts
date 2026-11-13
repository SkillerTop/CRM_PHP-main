import type { ServerResponse } from "node:http";
import type { PoolConnection } from "mysql2/promise";
import {
  ApiError,
  db,
  first,
  now,
  reply,
  rows,
  utc,
  type Row,
} from "./core.js";
import { requireRole, type Identity } from "./auth.js";
import { pagination } from "./lookups.js";

type Executor = Pick<PoolConnection, "execute">;
export type AuditEvent = {
  action: string;
  entityType: string;
  entityId: number | null;
  entityLabel: string;
  field?: string | null;
  from?: string | null;
  to?: string | null;
  detail?: Record<string, unknown>;
  actorUserId?: number | null;
  actorName?: string;
};

function redactValue(field: string, value: unknown): unknown {
  const normalized = field.toLowerCase().replace(/[ -]/g, "_");
  return /photo|logo|image|password|token/.test(normalized) &&
    value !== null &&
    value !== ""
    ? "[redacted]"
    : value;
}

export function redactEvent(row: Row): Row {
  const result = { ...row };
  const field = String(result.field_name ?? "");
  result.value_from = redactValue(field, result.value_from);
  result.value_to = redactValue(field, result.value_to);
  if (typeof result.detail_json === "string" && result.detail_json) {
    try {
      const detail = JSON.parse(result.detail_json) as Record<string, unknown>;
      for (const key of ["error", "hint", "exception", "debug"])
        if (key in detail) detail[key] = "[redacted]";
      result.detail_json = JSON.stringify(detail);
    } catch {
      /* Preserve malformed legacy detail as stored. */
    }
  }
  return result;
}

export async function logAudit(
  executor: Executor,
  identity: Identity | null,
  event: AuditEvent,
): Promise<void> {
  await executor.execute(
    `INSERT INTO change_events
    (actor_user_id,actor_name,action,entity_type,entity_id,entity_label,field_name,value_from,value_to,detail_json,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [
      event.actorUserId ?? identity?.user.id ?? null,
      event.actorName ?? identity?.user.full_name ?? "system",
      event.action,
      event.entityType,
      event.entityId,
      event.entityLabel,
      event.field ?? null,
      redactValue(event.field ?? "", event.from ?? null),
      redactValue(event.field ?? "", event.to ?? null),
      event.detail && Object.keys(event.detail).length
        ? JSON.stringify(event.detail)
        : null,
      now(),
    ] as Array<string | number | null>,
  );
}

export async function auditDiff(
  executor: Executor,
  identity: Identity,
  entityType: string,
  entityId: number,
  label: string,
  before: Row,
  after: Row,
  fields: Record<string, string>,
): Promise<number> {
  let changes = 0;
  for (const [field, name] of Object.entries(fields)) {
    if (String(before[field] ?? "") === String(after[field] ?? "")) continue;
    const format = (value: unknown) =>
      value === null || value === "" ? "—" : String(value);
    await logAudit(executor, identity, {
      action: "FIELD CHANGE",
      entityType,
      entityId,
      entityLabel: label,
      field: name,
      from: format(before[field]),
      to: format(after[field]),
    });
    changes++;
  }
  return changes;
}

export function mapAudit(row: Row): Record<string, unknown> {
  const x = redactEvent(row);
  return {
    id: Number(x.id),
    timestamp: utc(x.created_at),
    actor_user_id: x.actor_user_id === null ? null : Number(x.actor_user_id),
    actor: x.actor_name,
    action: x.action,
    entity_type: x.entity_type,
    entity_id: x.entity_id === null ? null : Number(x.entity_id),
    entity_label: x.entity_label,
    field: x.field_name,
    from: x.value_from,
    to: x.value_to,
    detail:
      typeof x.detail_json === "string" && x.detail_json
        ? JSON.parse(x.detail_json)
        : null,
  };
}

function csvCell(value: unknown): string {
  const raw = value === null || value === undefined ? "" : String(value);
  const safe = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  return `"${safe.replaceAll('"', '""')}"`;
}

function csv(data: Row[]): string {
  const lines = [
    [
      "Timestamp",
      "Actor",
      "Action",
      "Entity",
      "Entity ID",
      "Label",
      "Field",
      "From",
      "To",
      "Detail",
    ]
      .map(csvCell)
      .join(","),
  ];
  for (const source of data) {
    const row = redactEvent(source);
    lines.push(
      [
        utc(row.created_at),
        row.actor_name,
        row.action,
        row.entity_type,
        row.entity_id,
        row.entity_label,
        row.field_name,
        row.value_from,
        row.value_to,
        row.detail_json,
      ]
        .map(csvCell)
        .join(","),
    );
  }
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}

export async function auditIndex(
  url: URL,
  res: ServerResponse,
  identity: Identity,
): Promise<void> {
  requireRole(identity, "admin");
  const conditions = ["1=1"];
  const params: Array<string | number> = [];
  const user = url.searchParams.get("user");
  if (user && /^\d+$/.test(user)) {
    conditions.push("actor_user_id = ?");
    params.push(Number(user));
  }
  for (const field of ["action", "entity_type"]) {
    const value = url.searchParams.get(field)?.trim();
    if (value) {
      conditions.push(`${field} = ?`);
      params.push(value);
    }
  }
  for (const [key, condition] of [
    ["from", "created_at >= ?"],
    ["to", "created_at < DATE_ADD(?, INTERVAL 1 DAY)"],
  ] as const) {
    const value = url.searchParams.get(key)?.trim();
    if (value) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value)))
        throw new ApiError(
          400,
          "validation_error",
          `Поле ${key} должно иметь формат YYYY-MM-DD.`,
          { fields: { [key]: "Ожидается YYYY-MM-DD." } },
        );
      conditions.push(condition);
      params.push(value);
    }
  }
  const where = conditions.join(" AND ");
  if (url.searchParams.get("format")?.toLowerCase() === "csv") {
    const result = await rows(
      `SELECT * FROM change_events WHERE ${where} ORDER BY created_at DESC,id DESC LIMIT 10000`,
      params,
    );
    res.writeHead(200, {
      "Content-Type": "text/csv; charset=UTF-8",
      "Content-Disposition": "attachment; filename*=UTF-8''audit-log.csv",
      "X-Content-Type-Options": "nosniff",
    });
    res.end(csv(result));
    return;
  }
  const paging = pagination(url);
  const total = Number(
    (
      await first(
        `SELECT COUNT(*) AS total FROM change_events WHERE ${where}`,
        params,
      )
    )?.total ?? 0,
  );
  const result = await rows(
    `SELECT * FROM change_events WHERE ${where} ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?`,
    [...params, paging.perPage, paging.offset],
  );
  reply(res, { data: result.map(mapAudit), meta: paging.meta(total) });
}
