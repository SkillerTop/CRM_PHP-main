import { ApiError, first, utc, type Row } from "./core.js";

export function str(
  data: Record<string, unknown>,
  key: string,
  fallback: string | null = null,
): string | null {
  return data[key] === undefined || data[key] === null
    ? fallback
    : String(data[key]).trim();
}
export function nullable(
  data: Record<string, unknown>,
  key: string,
): string | null {
  return str(data, key) || null;
}
export function integer(
  data: Record<string, unknown>,
  key: string,
  fallback: number | null = null,
): number | null {
  const raw = data[key];
  return raw === undefined ||
    raw === null ||
    raw === "" ||
    !/^-?\d+$/.test(String(raw))
    ? fallback
    : Number(raw);
}
export function bool(
  data: Record<string, unknown>,
  key: string,
  fallback = false,
): boolean {
  if (!(key in data)) return fallback;
  const value = String(data[key]).toLowerCase();
  return ["true", "1", "yes", "on"].includes(value)
    ? true
    : ["false", "0", "no", "off", ""].includes(value)
      ? false
      : fallback;
}
export function validate(fields: Record<string, string>): void {
  const errors = Object.fromEntries(
    Object.entries(fields).filter(([, value]) => value !== ""),
  );
  if (Object.keys(errors).length)
    throw new ApiError(400, "validation_error", "Проверьте заполнение полей.", {
      fields: errors,
    });
}
export const max = (value: string | null, n: number): string =>
  value !== null && [...value].length > n ? `Не более ${n} символов.` : "";
export const requiredField = (value: string | null): string =>
  value?.trim() ? "" : "Обязательное поле.";
export const emailError = (value: string | null): string =>
  value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
    ? "Некорректный email."
    : "";
export const urlError = (value: string | null): string =>
  value && !/^https?:\/\/[^\s.]+(?:\.[^\s]+|:\d+)/i.test(value)
    ? "Некорректный URL."
    : "";
export const phoneError = (value: string | null): string =>
  value && !/^[\d+()\-\s]+$/.test(value)
    ? "Допустимы цифры, +, пробелы, скобки и дефисы."
    : "";
export function normalizeUrl(value: string | null): string | null {
  return !value
    ? null
    : /^https?:\/\//i.test(value)
      ? value
      : `https://${value}`;
}

export async function lookup(
  id: number,
  type: string,
  currentId: number | null = null,
): Promise<Row> {
  const row = await first(
    "SELECT * FROM lookups WHERE id=? AND type=?" +
      (currentId === id ? "" : " AND is_active=1"),
    [id, type],
  );
  if (!row)
    throw new ApiError(
      400,
      "invalid_lookup",
      "Указано недоступное значение справочника.",
    );
  return row;
}

export function optimistic(row: Row, updatedAt: unknown): void {
  if (typeof updatedAt !== "string" || !updatedAt.trim())
    throw new ApiError(
      400,
      "updated_at_required",
      "Для сохранения требуется updated_at из последнего GET.",
      {
        fields: {
          updated_at:
            "Обязательное поле для защиты от одновременного редактирования.",
        },
      },
    );
  const server = utc(row.updated_at);
  if (
    updatedAt !== server &&
    updatedAt.replace(" ", "T").replace(/Z?$/, "Z") !== server
  )
    throw new ApiError(
      409,
      "edit_conflict",
      "Запись изменена другим пользователем. Обновите данные и повторите правки.",
      { server_updated_at: server },
    );
}

export function companyMap(row: Row): Record<string, unknown> {
  return {
    id: Number(row.id),
    name: String(row.name),
    type_id: Number(row.type_lookup_id),
    type: row.type_value ?? null,
    country: String(row.country),
    city: row.city,
    status_id: Number(row.status_lookup_id),
    status: row.status_value ?? null,
    manager_id:
      row.manager_lookup_id == null ? null : Number(row.manager_lookup_id),
    manager: row.manager_value ?? null,
    manager_email: row.manager_email ?? null,
    last_contact_date: row.last_contact_date,
    website: row.website,
    linkedin: row.linkedin,
    nda_status: row.nda_status ?? "Not Signed",
    logo_data_url:
      row.logo_data_url ??
      (row.has_logo ? `/api/companies/${row.id}/logo` : null),
    description: row.description,
    is_archived: Boolean(row.is_archived),
    created_at: utc(row.created_at),
    updated_at: utc(row.updated_at),
    created_by: row.created_by == null ? null : Number(row.created_by),
    updated_by: row.updated_by == null ? null : Number(row.updated_by),
    created_by_name: row.created_by_name ?? null,
    created_by_email: row.created_by_email ?? null,
  };
}

export function contactMap(row: Row): Record<string, unknown> {
  return {
    id: Number(row.id),
    company_id: Number(row.company_id),
    company: row.company_name ?? null,
    status: String(row.contact_status ?? "active"),
    first_name: String(row.first_name),
    last_name: row.last_name,
    position: row.position,
    phone: row.phone,
    email: row.email,
    linkedin: row.linkedin,
    source_id:
      row.source_lookup_id == null ? null : Number(row.source_lookup_id),
    source: row.source_value ?? null,
    source_detail: row.source_detail,
    referred_by: row.referred_by,
    initiated_by_id:
      row.initiated_by_lookup_id == null
        ? null
        : Number(row.initiated_by_lookup_id),
    initiated_by: row.initiated_by_value ?? row.initiated_by_text ?? null,
    initiated_by_text: row.initiated_by_text ?? null,
    manager_id:
      row.manager_lookup_id == null ? null : Number(row.manager_lookup_id),
    manager: row.manager_value ?? null,
    manager_email: row.manager_email ?? null,
    photo_data_url:
      row.photo_data_url ??
      (row.has_photo ? `/api/contacts/${row.id}/photo` : null),
    is_archived: Boolean(row.is_archived),
    created_at: utc(row.created_at),
    updated_at: utc(row.updated_at),
    created_by_name: row.created_by_name ?? null,
    created_by_email: row.created_by_email ?? null,
  };
}

export function taskMap(row: Row): Record<string, unknown> {
  const mapped: Record<string, unknown> = {
    id: Number(row.id),
    company_id: Number(row.company_id),
    parent_task_id:
      row.parent_task_id == null ? null : Number(row.parent_task_id),
    company: row.company_name ?? null,
    name: String(row.name),
    contact_date: String(row.contact_date),
    manager_id: Number(row.manager_lookup_id),
    manager: row.manager_value ?? null,
    manager_email: row.manager_email ?? null,
    contact_person_id:
      row.contact_person_id == null ? null : Number(row.contact_person_id),
    contact_person: row.contact_person_name ?? null,
    description: row.description,
    status_id: Number(row.status_lookup_id),
    status_key: row.status_key ?? null,
    status: row.status_value ?? null,
    priority: row.priority ?? "Low",
    is_closed: Boolean(row.status_is_closed),
    outcome_status_id:
      row.outcome_status_lookup_id == null
        ? null
        : Number(row.outcome_status_lookup_id),
    outcome_status: row.outcome_status_value ?? null,
    outcome_notes: row.outcome_notes,
    deadline: utc(row.deadline),
    completed_at: utc(row.completed_at),
    is_overdue: Boolean(row.is_overdue),
    reminder_possible:
      row.reminder_possible == null ? null : Boolean(row.reminder_possible),
    comment_count: row.comment_count == null ? null : Number(row.comment_count),
    change_count: row.change_count == null ? null : Number(row.change_count),
    is_archived: Boolean(row.is_archived),
    created_at: utc(row.created_at),
    updated_at: utc(row.updated_at),
    created_by_name: row.created_by_name ?? null,
    created_by_email: row.created_by_email ?? null,
  };
  if ("participant_contact_ids" in row) {
    mapped.participant_contact_ids =
      row.participant_contact_ids == null
        ? []
        : String(row.participant_contact_ids).split(",").map(Number);
    mapped.participant_managers =
      row.participant_managers == null
        ? []
        : String(row.participant_managers).split("\x1F");
  }
  return mapped;
}
