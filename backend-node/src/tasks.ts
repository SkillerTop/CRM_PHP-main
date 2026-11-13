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
import {
  taskMap,
  bool,
  max,
  optimistic,
  requiredField,
  str,
  validate,
} from "./domain.js";
import { pagination, mapLookup } from "./lookups.js";
import { logAudit, redactEvent } from "./audit.js";
import { DateTime } from "luxon";
import type { PoolConnection } from "mysql2/promise";
import { integer, lookup, nullable, taskMap as mapTask } from "./domain.js";
import { parseDeadline, reschedule, syncReminderLeads } from "./reminders.js";

const baseSelect = `SELECT t.*,c.name AS company_name,m.value AS manager_value,COALESCE(u.email,m.email) AS manager_email,
  s.value AS status_value,s.key_code AS status_key,creator.full_name AS created_by_name,creator.email AS created_by_email,
  s.is_closed AS status_is_closed,o.value AS outcome_status_value,
  TRIM(CONCAT(COALESCE(k.first_name,''),' ',COALESCE(k.last_name,''))) AS contact_person_name,
  (s.is_closed=0 AND t.deadline IS NOT NULL AND t.deadline < UTC_TIMESTAMP(6)) AS is_overdue,
  (CASE WHEN m.user_id IS NOT NULL THEN u.is_active=1 AND u.pending_approval=0 AND u.email<>''
    ELSE m.email IS NOT NULL AND m.email<>'' END) AS reminder_possible,
  (SELECT COUNT(*) FROM task_comments tc WHERE tc.task_id=t.id) AS comment_count,
  (SELECT COUNT(*) FROM change_events ce WHERE ce.entity_type='Task' AND ce.entity_id=t.id) AS change_count,
  (SELECT GROUP_CONCAT(tp.contact_id ORDER BY tp.id) FROM task_participants tp WHERE tp.task_id=t.id AND tp.contact_id IS NOT NULL) AS participant_contact_ids,
  (SELECT GROUP_CONCAT(pm.value ORDER BY tp.id SEPARATOR '\x1F') FROM task_participants tp JOIN lookups pm ON pm.id=tp.manager_lookup_id WHERE tp.task_id=t.id) AS participant_managers
  FROM tasks t JOIN companies c ON c.id=t.company_id JOIN lookups m ON m.id=t.manager_lookup_id
  LEFT JOIN users u ON u.id=m.user_id LEFT JOIN users creator ON creator.id=t.created_by
  JOIN lookups s ON s.id=t.status_lookup_id LEFT JOIN lookups o ON o.id=t.outcome_status_lookup_id
  LEFT JOIN contacts k ON k.id=t.contact_person_id`;

export async function findTask(
  identity: Identity,
  id: number,
  includeArchived = identity.user.role === "admin",
): Promise<Row> {
  const row = await first(
    `${baseSelect} WHERE t.id=? ${includeArchived ? "" : "AND t.is_archived=0 AND c.is_archived=0"}`,
    [id],
  );
  if (!row) throw new ApiError(404, "task_not_found", "Задача не найдена.");
  return row;
}

export async function taskIndex(
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
  const where = includeArchived ? [] : ["t.is_archived=0", "c.is_archived=0"];
  const params: Array<string | number> = [];
  if (companyId !== null) {
    where.push("t.company_id=?");
    params.push(companyId);
  } else {
    for (const [key, column] of [
      ["manager", "t.manager_lookup_id"],
      ["company", "t.company_id"],
    ] as const) {
      const raw = url.searchParams.get(key);
      if (raw && /^-?\d+$/.test(raw)) {
        where.push(`${column}=?`);
        params.push(Number(raw));
      }
    }
    const state = (url.searchParams.get("state") ?? "actual").toLowerCase();
    if (state === "overdue")
      where.push(
        "s.is_closed=0 AND t.deadline IS NOT NULL AND t.deadline < UTC_TIMESTAMP(6)",
      );
    else if (["completed", "deferred", "canceled"].includes(state)) {
      where.push("s.key_code=?");
      params.push(state);
    } else if (state !== "all") where.push("s.is_closed=0");
  }
  const predicate = where.length ? where.join(" AND ") : "1=1";
  const total = Number(
    (
      await first(
        `SELECT COUNT(*) AS total FROM tasks t JOIN companies c ON c.id=t.company_id JOIN lookups s ON s.id=t.status_lookup_id WHERE ${predicate}`,
        params,
      )
    )?.total ?? 0,
  );
  const sorts: Record<string, string> = {
    contact_date: "t.contact_date",
    deadline: "t.deadline",
    manager: "manager_value",
    status: "status_value",
    company: "c.name",
    name: "t.name",
    updated_at: "t.updated_at",
  };
  const sort =
    companyId === null
      ? (sorts[url.searchParams.get("sort") ?? "contact_date"] ??
        "t.contact_date")
      : "t.contact_date";
  const dir =
    companyId === null && url.searchParams.get("dir")?.toLowerCase() === "asc"
      ? "ASC"
      : "DESC";
  const data = (
    await rows(
      `${baseSelect} WHERE ${predicate} ORDER BY ${sort} ${dir},t.id ${dir} LIMIT ? OFFSET ?`,
      [...params, page.perPage, page.offset],
    )
  ).map(taskMap);
  return { data, meta: page.meta(total) };
}

export function mapComment(row: Row, admin: boolean): Record<string, unknown> {
  return {
    id: Number(row.id),
    task_id: Number(row.task_id),
    author_user_id:
      row.author_user_id == null ? null : Number(row.author_user_id),
    author_name: String(row.author_name),
    text: row.is_hidden && !admin ? null : String(row.text),
    is_hidden: Boolean(row.is_hidden),
    created_at: utc(row.created_at),
    updated_at: utc(row.updated_at),
  };
}

function mapAttachment(row: Row): Record<string, unknown> {
  return {
    id: Number(row.id),
    task_id: Number(row.task_id),
    original_name: String(row.original_name),
    mime_type: String(row.mime_type),
    size_bytes: Number(row.size_bytes),
    author_user_id: Number(row.author_user_id),
    author_name: String(row.author_name),
    created_at: utc(row.created_at),
  };
}

function mapReminder(row: Row, admin: boolean): Record<string, unknown> {
  const result: Record<string, unknown> = {
    id: Number(row.id),
    lead_time: String(row.lead_time),
    scheduled_at: utc(row.scheduled_at),
    state: String(row.state),
    sent_at: utc(row.sent_at),
    created_at: utc(row.created_at),
    updated_at: utc(row.updated_at),
  };
  if (admin)
    Object.assign(result, {
      attempts: Number(row.attempts),
      recipient_email: row.recipient_email,
      error_message: row.error_message,
      locked_at: utc(row.locked_at),
    });
  return result;
}

function collectionPage(
  url: URL,
  prefix: string,
): {
  perPage: number;
  offset: number;
  meta: (total: number) => Record<string, number>;
} {
  const page = Math.max(
    1,
    Number.parseInt(url.searchParams.get(`${prefix}_page`) ?? "1", 10) || 1,
  );
  const perPage = Math.max(
    1,
    Math.min(
      100,
      Number.parseInt(url.searchParams.get(`${prefix}_per_page`) ?? "50", 10) ||
        50,
    ),
  );
  return {
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

export async function taskDetail(
  url: URL,
  identity: Identity,
  id: number,
): Promise<Record<string, unknown>> {
  const task = taskMap(await findTask(identity, id));
  const admin = identity.user.role === "admin";
  const leads = await rows(
    "SELECT reminder_lead_lookup_id FROM task_reminder_leads WHERE task_id=? ORDER BY reminder_lead_lookup_id",
    [id],
  );
  task.reminder_lead_ids = leads.map((row) =>
    Number(row.reminder_lead_lookup_id),
  );
  task.reminder_leads = await Promise.all(
    leads.map(async (row) => {
      const found = await first("SELECT * FROM lookups WHERE id=? AND type=?", [
        row.reminder_lead_lookup_id,
        "reminder_lead_time",
      ]);
      return found ? mapLookup(found, true) : null;
    }),
  );
  const sections = [
    ["comments", "task_comments", admin ? "" : " AND is_hidden=0"],
    ["attachments", "task_attachments", " AND deleted_at IS NULL"],
    ["reminders", "task_reminders", ""],
  ] as const;
  const meta: Record<string, unknown> = {};
  for (const [name, table, visibility] of sections) {
    const page = collectionPage(url, name);
    const total = Number(
      (
        await first(
          `SELECT COUNT(*) AS total FROM ${table} WHERE task_id=?${visibility}`,
          [id],
        )
      )?.total ?? 0,
    );
    const order =
      name === "reminders" ? "created_at DESC,id DESC" : "created_at,id";
    const sql =
      name === "reminders"
        ? `SELECT r.*,l.value AS lead_time FROM task_reminders r JOIN lookups l ON l.id=r.reminder_lead_lookup_id WHERE r.task_id=? ORDER BY r.${order.replace(",id", ",r.id")} LIMIT ? OFFSET ?`
        : `SELECT * FROM ${table} WHERE task_id=?${visibility} ORDER BY ${order} LIMIT ? OFFSET ?`;
    const result = await rows(sql, [id, page.perPage, page.offset]);
    task[name] =
      name === "comments"
        ? result.map((row) => mapComment(row, admin))
        : name === "attachments"
          ? result.map(mapAttachment)
          : result.map((row) => mapReminder(row, admin));
    meta[name] = page.meta(total);
  }
  task.collections_meta = meta;
  return task;
}

type Participants = { contacts: number[]; managers: number[] };
type TaskRecord = {
  company_id: number;
  parent_task_id: number | null;
  name: string;
  contact_date: string;
  manager_id: number;
  contact_person_id: number | null;
  description: string | null;
  status_id: number;
  priority: string;
  outcome_status_id: number | null;
  outcome_notes: string | null;
  deadline: string | null;
};
type TaskInput = {
  record: TaskRecord;
  participants: Participants;
  reminderLeadIds: number[];
  statusKey: string;
  deadlinePast: boolean;
};

function intList(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(value.filter((x) => /^-?\d+$/.test(String(x))).map(Number)),
  ].sort((a, b) => a - b);
}

async function leadIds(taskId: number): Promise<number[]> {
  return (
    await rows(
      "SELECT reminder_lead_lookup_id FROM task_reminder_leads WHERE task_id=? ORDER BY reminder_lead_lookup_id",
      [taskId],
    )
  ).map((row) => Number(row.reminder_lead_lookup_id));
}

async function participantIds(taskId: number): Promise<Participants> {
  const result: Participants = { contacts: [], managers: [] };
  for (const row of await rows(
    "SELECT contact_id,manager_lookup_id FROM task_participants WHERE task_id=?",
    [taskId],
  ))
    if (row.contact_id == null)
      result.managers.push(Number(row.manager_lookup_id));
    else result.contacts.push(Number(row.contact_id));
  result.contacts.sort((a, b) => a - b);
  result.managers.sort((a, b) => a - b);
  return result;
}

async function isBlacklisted(companyId: number): Promise<boolean> {
  return (
    (
      await first(
        `SELECT s.key_code FROM companies c JOIN lookups s ON s.id=c.status_lookup_id
    WHERE c.id=? AND s.type='client_status'`,
        [companyId],
      )
    )?.key_code === "black_list"
  );
}

export async function assertTaskEditable(task: Row): Promise<void> {
  if (await isBlacklisted(Number(task.company_id)))
    throw new ApiError(
      409,
      "blacklisted_task_locked",
      "Задачи компаний из Black List доступны только для просмотра.",
    );
  const status =
    task.status_key ??
    (
      await first(
        "SELECT key_code FROM lookups WHERE id=? AND type='task_status'",
        [task.status_lookup_id],
      )
    )?.key_code;
  if (status !== "completed") return;
  const completed = task.completed_at ?? task.updated_at;
  if (!completed)
    throw new ApiError(
      409,
      "task_locked",
      "Завершённая задача больше недоступна для редактирования.",
    );
  if (
    DateTime.fromSQL(String(completed), { zone: "UTC" })
      .plus({ days: 7 })
      .toMillis() <= Date.now()
  )
    throw new ApiError(
      409,
      "task_locked",
      "Прошло 7 дней после завершения задачи. Редактирование заблокировано.",
    );
}

async function validated(
  input: Record<string, unknown>,
  current: Row | null = null,
  oldLeads: number[] = [],
  oldParticipants: Participants = { contacts: [], managers: [] },
): Promise<TaskInput> {
  const company = integer(input, "company_id");
  const parent =
    "parent_task_id" in input
      ? integer(input, "parent_task_id")
      : current?.parent_task_id == null
        ? null
        : Number(current.parent_task_id);
  const name = str(input, "name", "")!;
  const contactDate = str(
    input,
    "contact_date",
    current?.contact_date
      ? String(current.contact_date)
      : (DateTime.now()
          .setZone(process.env.APP_TIMEZONE ?? "Europe/Kyiv")
          .toISODate() ?? ""),
  )!;
  if (
    !/^\d{4}-\d\d-\d\d$/.test(contactDate) ||
    !DateTime.fromISO(contactDate).isValid
  )
    throw new ApiError(
      400,
      "validation_error",
      "Поле contact_date должно иметь формат YYYY-MM-DD.",
      { fields: { contact_date: "Ожидается YYYY-MM-DD." } },
    );
  const manager = integer(input, "manager_id");
  const contactPerson = integer(input, "contact_person_id");
  const defaultStatus = await first(
    "SELECT id FROM lookups WHERE type='task_status' AND key_code='not_started' LIMIT 1",
  );
  const status = integer(input, "status_id") ?? Number(defaultStatus?.id ?? 0);
  let priority = str(input, "priority", String(current?.priority ?? "Low"))!;
  if (priority === "Normal") priority = "Low";
  const outcome = integer(input, "outcome_status_id");
  const parsed = parseDeadline(str(input, "deadline"));
  const leads = intList(input.reminder_lead_ids);
  const contactParticipants =
    "participant_contact_ids" in input
      ? intList(input.participant_contact_ids)
      : oldParticipants.contacts;
  const managerParticipants =
    "participant_manager_ids" in input
      ? intList(input.participant_manager_ids)
      : oldParticipants.managers;
  validate({
    company_id: company === null ? "Обязательное поле." : "",
    name: requiredField(name) || max(name, 255),
    contact_date: contactDate ? "" : "Обязательное поле.",
    manager_id: manager === null ? "Обязательное поле." : "",
    status_id: status ? "" : "Обязательное поле.",
    priority: ["Low", "Medium", "High"].includes(priority)
      ? ""
      : "Неизвестный приоритет.",
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
  if (await isBlacklisted(company!))
    priority = String(current?.priority ?? "Low");
  if (!current) {
    if (parent !== null)
      throw new ApiError(
        400,
        "task_threads_removed",
        "Задачи компании создаются последовательно, без родительской задачи.",
      );
    const previous = await first(
      `SELECT s.key_code AS status_key FROM tasks t JOIN lookups s ON s.id=t.status_lookup_id
      WHERE t.company_id=? AND t.is_archived=0 ORDER BY t.id DESC LIMIT 1`,
      [company!],
    );
    if (previous && previous.status_key !== "completed")
      throw new ApiError(
        409,
        "previous_task_not_completed",
        "Перед созданием новой задачи завершите предыдущую задачу этой компании.",
      );
  }
  if (parent !== null) {
    if (current && Number(current.id) === parent)
      throw new ApiError(
        400,
        "invalid_parent_task",
        "Задача не может быть собственной веткой.",
      );
    const parentRow = await first(
      `SELECT t.*,s.key_code AS status_key FROM tasks t JOIN lookups s ON s.id=t.status_lookup_id
      WHERE t.id=? AND t.is_archived=0`,
      [parent],
    );
    if (!parentRow || Number(parentRow.company_id) !== company)
      throw new ApiError(
        400,
        "invalid_parent_task",
        "Основная задача должна принадлежать выбранной компании.",
      );
    if (parentRow.parent_task_id !== null)
      throw new ApiError(
        400,
        "nested_task_branch",
        "Ветку можно создать только у основной задачи.",
      );
  }
  await lookup(
    manager!,
    "cjn_manager",
    current?.manager_lookup_id == null
      ? null
      : Number(current.manager_lookup_id),
  );
  const statusLookup = await lookup(
    status,
    "task_status",
    current?.status_lookup_id == null ? null : Number(current.status_lookup_id),
  );
  if (outcome !== null)
    await lookup(
      outcome,
      "outcome_status",
      current?.outcome_status_lookup_id == null
        ? null
        : Number(current.outcome_status_lookup_id),
    );
  for (const lead of leads)
    await lookup(
      lead,
      "reminder_lead_time",
      oldLeads.includes(lead) ? lead : null,
    );
  if (
    contactPerson !== null &&
    !(await first(
      "SELECT id FROM contacts WHERE id=? AND company_id=?" +
        (Number(current?.contact_person_id) === contactPerson
          ? ""
          : " AND is_archived=0"),
      [contactPerson, company!],
    ))
  )
    throw new ApiError(
      400,
      "invalid_contact_person",
      "Контактное лицо должно принадлежать выбранной компании.",
    );
  const contacts = contactParticipants.filter((id) => id !== contactPerson);
  for (const id of contacts)
    if (
      !(await first(
        "SELECT id FROM contacts WHERE id=? AND company_id=?" +
          (oldParticipants.contacts.includes(id) ? "" : " AND is_archived=0"),
        [id, company!],
      ))
    )
      throw new ApiError(
        400,
        "invalid_participant",
        "Участники-контакты должны принадлежать выбранной компании.",
      );
  for (const id of managerParticipants)
    await lookup(
      id,
      "cjn_manager",
      oldParticipants.managers.includes(id) ? id : null,
    );
  return {
    record: {
      company_id: company!,
      parent_task_id: parent,
      name,
      contact_date: contactDate,
      manager_id: manager!,
      contact_person_id: contactPerson,
      description: nullable(input, "description"),
      status_id: status,
      priority,
      outcome_status_id: outcome,
      outcome_notes: nullable(input, "outcome_notes"),
      deadline: parsed.db,
    },
    participants: { contacts, managers: managerParticipants },
    reminderLeadIds: leads,
    statusKey: String(statusLookup.key_code),
    deadlinePast: parsed.past,
  };
}

async function syncParticipants(
  conn: PoolConnection,
  taskId: number,
  participants: Participants,
): Promise<void> {
  await conn.execute("DELETE FROM task_participants WHERE task_id=?", [taskId]);
  for (const id of participants.contacts)
    await conn.execute(
      "INSERT INTO task_participants (task_id,contact_id,manager_lookup_id,created_at) VALUES (?,?,NULL,?)",
      [taskId, id, now()],
    );
  for (const id of participants.managers)
    await conn.execute(
      "INSERT INTO task_participants (task_id,contact_id,manager_lookup_id,created_at) VALUES (?,NULL,?,?)",
      [taskId, id, now()],
    );
}

async function recalculateLastContact(
  conn: PoolConnection,
  identity: Identity,
  companyId: number,
): Promise<void> {
  const [rowsBefore] = await conn.execute<Row[]>(
    "SELECT id,name,last_contact_date FROM companies WHERE id=? FOR UPDATE",
    [companyId],
  );
  const before = rowsBefore[0];
  if (!before) return;
  const [maxRows] = await conn.execute<Row[]>(
    "SELECT MAX(contact_date) AS last_date FROM tasks WHERE company_id=? AND is_archived=0",
    [companyId],
  );
  const after = maxRows[0]?.last_date ?? null;
  if (String(before.last_contact_date ?? "") === String(after ?? "")) return;
  await conn.execute(
    "UPDATE companies SET last_contact_date=?,updated_by=?,updated_at=? WHERE id=?",
    [after, identity.user.id, now(), companyId],
  );
  await logAudit(conn, identity, {
    action: "FIELD CHANGE",
    entityType: "Company",
    entityId: companyId,
    entityLabel: String(before.name),
    field: "Last Contact Date",
    from: String(before.last_contact_date ?? "—"),
    to: String(after ?? "—"),
  });
}

export async function taskStore(
  identity: Identity,
  input: Record<string, unknown>,
): Promise<{
  data: Record<string, unknown>;
  warnings?: Record<string, string>;
}> {
  requireRole(identity, "admin", "manager", "editor");
  const data = await validated(input);
  const record = data.record;
  const conn = await db.getConnection();
  let id = 0;
  try {
    await conn.beginTransaction();
    const timestamp = now();
    const [result] = await conn.execute(
      `INSERT INTO tasks
      (company_id,parent_task_id,name,contact_date,manager_lookup_id,contact_person_id,description,status_lookup_id,
       priority,outcome_status_lookup_id,outcome_notes,deadline,completed_at,is_archived,created_by,updated_by,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,0,?,?,?,?)`,
      [
        record.company_id,
        record.parent_task_id,
        record.name,
        record.contact_date,
        record.manager_id,
        record.contact_person_id,
        record.description,
        record.status_id,
        record.priority,
        record.outcome_status_id,
        record.outcome_notes,
        record.deadline,
        data.statusKey === "completed" ? timestamp : null,
        identity.user.id,
        identity.user.id,
        timestamp,
        timestamp,
      ],
    );
    id = "insertId" in result ? Number(result.insertId) : 0;
    await syncReminderLeads(conn, id, data.reminderLeadIds);
    await syncParticipants(conn, id, data.participants);
    await recalculateLastContact(conn, identity, record.company_id);
    await logAudit(conn, identity, {
      action: "CREATE",
      entityType: "Task",
      entityId: id,
      entityLabel: record.name,
      detail: { company_id: record.company_id },
    });
    await conn.commit();
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
  const response: {
    data: Record<string, unknown>;
    warnings?: Record<string, string>;
  } = {
    data: await taskDetail(new URL("http://localhost/api/tasks"), identity, id),
  };
  if (data.deadlinePast)
    response.warnings = {
      deadline:
        "Дедлайн в прошлом: напоминания для уже прошедших моментов помечены skipped.",
    };
  return response;
}

export async function taskUpdate(
  identity: Identity,
  id: number,
  input: Record<string, unknown>,
): Promise<{
  data: Record<string, unknown>;
  warnings?: Record<string, string>;
}> {
  requireRole(identity, "admin", "manager", "editor");
  const conn = await db.getConnection();
  let deadlinePast = false;
  try {
    await conn.beginTransaction();
    const [beforeRows] = await conn.execute<Row[]>(
      "SELECT * FROM tasks WHERE id=? FOR UPDATE",
      [id],
    );
    const before = beforeRows[0];
    if (!before)
      throw new ApiError(404, "task_not_found", "Задача не найдена.");
    await assertTaskEditable(before);
    optimistic(before, input.updated_at);
    const oldLeads = await leadIds(id),
      oldParticipants = await participantIds(id);
    const data = await validated(input, before, oldLeads, oldParticipants);
    if (await isBlacklisted(data.record.company_id))
      throw new ApiError(
        409,
        "blacklisted_task_locked",
        "Задачи компаний из Black List доступны только для просмотра.",
      );
    deadlinePast = data.deadlinePast;
    const r = data.record,
      timestamp = now();
    const completed =
      data.statusKey === "completed"
        ? (before.completed_at ?? timestamp)
        : null;
    await conn.execute(
      `UPDATE tasks SET company_id=?,parent_task_id=?,name=?,contact_date=?,manager_lookup_id=?,contact_person_id=?,
      description=?,status_lookup_id=?,priority=?,outcome_status_lookup_id=?,outcome_notes=?,deadline=?,completed_at=?,
      updated_by=?,updated_at=? WHERE id=?`,
      [
        r.company_id,
        r.parent_task_id,
        r.name,
        r.contact_date,
        r.manager_id,
        r.contact_person_id,
        r.description,
        r.status_id,
        r.priority,
        r.outcome_status_id,
        r.outcome_notes,
        r.deadline,
        completed,
        identity.user.id,
        timestamp,
        id,
      ],
    );
    const [afterRows] = await conn.execute<Row[]>(
      "SELECT * FROM tasks WHERE id=? FOR UPDATE",
      [id],
    );
    const after = afterRows[0]!;
    for (const [field, label] of Object.entries({
      company_id: "Company",
      name: "Task title",
      contact_date: "Contact Date",
      status_lookup_id: "Status",
      outcome_status_lookup_id: "Outcome status",
      deadline: "Deadline",
      manager_lookup_id: "CJN Manager",
      contact_person_id: "Contact Person",
      description: "Description",
      priority: "Priority",
      outcome_notes: "Outcome notes",
    })) {
      if (String(before[field] ?? "") !== String(after[field] ?? ""))
        await logAudit(conn, identity, {
          action: "FIELD CHANGE",
          entityType: "Task",
          entityId: id,
          entityLabel: r.name,
          field: label,
          from: String(before[field] ?? "—"),
          to: String(after[field] ?? "—"),
        });
    }
    if (JSON.stringify(oldLeads) !== JSON.stringify(data.reminderLeadIds))
      await logAudit(conn, identity, {
        action: "FIELD CHANGE",
        entityType: "Task",
        entityId: id,
        entityLabel: r.name,
        field: "Reminder lead time",
        from: oldLeads.join(", ") || "—",
        to: data.reminderLeadIds.join(", ") || "—",
      });
    await syncReminderLeads(conn, id, data.reminderLeadIds);
    if (JSON.stringify(oldParticipants) !== JSON.stringify(data.participants)) {
      await logAudit(conn, identity, {
        action: "FIELD CHANGE",
        entityType: "Task",
        entityId: id,
        entityLabel: r.name,
        field: "Participants",
        from: JSON.stringify(oldParticipants),
        to: JSON.stringify(data.participants),
      });
      await syncParticipants(conn, id, data.participants);
    }
    await recalculateLastContact(conn, identity, Number(before.company_id));
    if (r.company_id !== Number(before.company_id))
      await recalculateLastContact(conn, identity, r.company_id);
    await conn.commit();
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
  const response: {
    data: Record<string, unknown>;
    warnings?: Record<string, string>;
  } = {
    data: await taskDetail(new URL("http://localhost/api/tasks"), identity, id),
  };
  if (deadlinePast)
    response.warnings = {
      deadline:
        "Дедлайн в прошлом: новые напоминания не будут отправлены задним числом.",
    };
  return response;
}

export async function taskArchive(
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
      "SELECT * FROM tasks WHERE id=? FOR UPDATE",
      [id],
    );
    const task = result[0];
    if (!task) throw new ApiError(404, "task_not_found", "Задача не найдена.");
    optimistic(task, input.updated_at);
    await conn.execute(
      "UPDATE tasks SET is_archived=?,updated_by=?,updated_at=? WHERE id=?",
      [archived ? 1 : 0, identity.user.id, now(), id],
    );
    await reschedule(conn, id);
    await recalculateLastContact(conn, identity, Number(task.company_id));
    await logAudit(conn, identity, {
      action: "ARCHIVE",
      entityType: "Task",
      entityId: id,
      entityLabel: String(task.name),
      detail: { archived },
    });
    await conn.commit();
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
  return taskDetail(new URL("http://localhost/api/tasks"), identity, id);
}

export async function taskComments(
  url: URL,
  identity: Identity,
  id: number,
): Promise<{ data: unknown[]; meta: Record<string, number> }> {
  await findTask(identity, id);
  const page = pagination(url),
    visibility = identity.user.role === "admin" ? "" : " AND tc.is_hidden=0";
  const total = Number(
    (
      await first(
        `SELECT COUNT(*) AS total FROM task_comments tc WHERE tc.task_id=?${visibility}`,
        [id],
      )
    )?.total ?? 0,
  );
  const data = (
    await rows(
      `SELECT tc.*,u.full_name AS author_current_name FROM task_comments tc LEFT JOIN users u ON u.id=tc.author_user_id
    WHERE tc.task_id=?${visibility} ORDER BY tc.created_at,tc.id LIMIT ? OFFSET ?`,
      [id, page.perPage, page.offset],
    )
  ).map((row) => mapComment(row, identity.user.role === "admin"));
  return { data, meta: page.meta(total) };
}

export async function addComment(
  identity: Identity,
  id: number,
  input: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  requireRole(identity, "admin", "manager", "editor");
  const task = await findTask(identity, id, false);
  await assertTaskEditable(task);
  const text = str(input, "text", "")!;
  validate({ text: requiredField(text) || max(text, 10000) });
  const conn = await db.getConnection();
  let commentId = 0;
  try {
    await conn.beginTransaction();
    const [result] = await conn.execute(
      `INSERT INTO task_comments
      (task_id,author_user_id,author_name,text,is_hidden,created_by,updated_by,created_at,updated_at)
      VALUES (?,?,?,?,0,?,?,?,?)`,
      [
        id,
        identity.user.id,
        identity.user.full_name,
        text,
        identity.user.id,
        identity.user.id,
        now(),
        now(),
      ],
    );
    commentId = "insertId" in result ? Number(result.insertId) : 0;
    await logAudit(conn, identity, {
      action: "COMMENT",
      entityType: "Task",
      entityId: id,
      entityLabel: String(task.name),
      detail: { comment_id: commentId },
    });
    await conn.commit();
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
  const row = await first("SELECT * FROM task_comments WHERE id=?", [
    commentId,
  ]);
  return mapComment(row!, identity.user.role === "admin");
}

export async function updateComment(
  identity: Identity,
  taskId: number,
  commentId: number,
  input: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  requireRole(identity, "admin", "manager", "editor");
  const task = await findTask(identity, taskId, false);
  await assertTaskEditable(task);
  const before = await first(
    "SELECT * FROM task_comments WHERE id=? AND task_id=?",
    [commentId, taskId],
  );
  if (!before)
    throw new ApiError(404, "comment_not_found", "Комментарий не найден.");
  if (
    identity.user.role !== "admin" &&
    Number(before.author_user_id) !== identity.user.id
  )
    throw new ApiError(
      403,
      "forbidden",
      "Редактировать комментарий может только его автор или Admin.",
    );
  const text = str(input, "text", "")!;
  validate({ text: requiredField(text) || max(text, 10000) });
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    await conn.execute(
      "UPDATE task_comments SET text=?,updated_by=?,updated_at=? WHERE id=? AND task_id=?",
      [text, identity.user.id, now(), commentId, taskId],
    );
    await logAudit(conn, identity, {
      action: "FIELD CHANGE",
      entityType: "Task",
      entityId: taskId,
      entityLabel: String(task.name),
      field: "Comment",
      from: String(before.text),
      to: text,
      detail: { comment_id: commentId },
    });
    await conn.commit();
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
  return mapComment(
    (await first("SELECT * FROM task_comments WHERE id=?", [commentId]))!,
    identity.user.role === "admin",
  );
}

export async function commentVisibility(
  identity: Identity,
  taskId: number,
  commentId: number,
  input: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  requireRole(identity, "admin");
  const task = await findTask(identity, taskId, true);
  await assertTaskEditable(task);
  const hidden = bool(input, "hidden", true),
    conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [result] = await conn.execute(
      "UPDATE task_comments SET is_hidden=?,updated_by=?,updated_at=? WHERE id=? AND task_id=?",
      [hidden ? 1 : 0, identity.user.id, now(), commentId, taskId],
    );
    if (!("affectedRows" in result) || result.affectedRows === 0)
      throw new ApiError(404, "comment_not_found", "Комментарий не найден.");
    await logAudit(conn, identity, {
      action: "FIELD CHANGE",
      entityType: "Task",
      entityId: taskId,
      entityLabel: String(task.name),
      field: "Comment visibility",
      from: hidden ? "visible" : "hidden",
      to: hidden ? "hidden" : "visible",
      detail: { comment_id: commentId },
    });
    await conn.commit();
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
  return { id: commentId, hidden };
}

export async function taskLog(
  url: URL,
  identity: Identity,
  id: number,
): Promise<{ data: Row[]; meta: Record<string, number> }> {
  await findTask(identity, id);
  const page = pagination(url);
  const total = Number(
    (
      await first(
        "SELECT COUNT(*) AS total FROM change_events WHERE entity_type=? AND entity_id=?",
        ["Task", id],
      )
    )?.total ?? 0,
  );
  const data = (
    await rows(
      "SELECT * FROM change_events WHERE entity_type=? AND entity_id=? ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?",
      ["Task", id, page.perPage, page.offset],
    )
  ).map((source) => {
    const row = redactEvent(source);
    row.id = Number(row.id);
    row.entity_id = row.entity_id == null ? null : Number(row.entity_id);
    row.actor_user_id =
      row.actor_user_id == null ? null : Number(row.actor_user_id);
    row.created_at = utc(row.created_at);
    row.detail = row.detail_json ? JSON.parse(String(row.detail_json)) : null;
    delete row.detail_json;
    return row;
  });
  return { data, meta: page.meta(total) };
}
