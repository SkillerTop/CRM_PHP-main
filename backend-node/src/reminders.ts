import type { PoolConnection } from "mysql2/promise";
import { DateTime } from "luxon";
import { now, type Row } from "./core.js";
import { ApiError } from "./core.js";

export function dbTime(date: DateTime): string {
  return date.toUTC().toFormat("yyyy-MM-dd HH:mm:ss.SSS") + "000";
}
export function parseDeadline(
  value: unknown,
  field = "deadline",
): { db: string | null; past: boolean } {
  if (value === null || value === undefined || String(value).trim() === "")
    return { db: null, past: false };
  const input = String(value).trim();
  if (!/^\d{4}-\d\d-\d\d[T ]\d\d:\d\d/.test(input))
    throw new ApiError(
      400,
      "validation_error",
      `Поле ${field} содержит некорректную дату и время.`,
      { fields: { [field]: "Некорректная дата и время." } },
    );
  const zone = process.env.APP_TIMEZONE ?? "Europe/Kyiv";
  const parsed = DateTime.fromISO(input.replace(" ", "T"), {
    zone,
    setZone: true,
  });
  if (!parsed.isValid)
    throw new ApiError(
      400,
      "validation_error",
      `Поле ${field} содержит некорректную дату и время.`,
      { fields: { [field]: "Некорректная дата и время." } },
    );
  return { db: dbTime(parsed), past: parsed.toMillis() < Date.now() };
}

export async function syncReminderLeads(
  conn: PoolConnection,
  taskId: number,
  leadIds: number[],
): Promise<void> {
  await conn.execute("DELETE FROM task_reminder_leads WHERE task_id=?", [
    taskId,
  ]);
  for (const id of leadIds)
    await conn.execute(
      "INSERT INTO task_reminder_leads (task_id,reminder_lead_lookup_id,created_at) VALUES (?,?,?)",
      [taskId, id, now()],
    );
  await reschedule(conn, taskId);
}

export async function reschedule(
  conn: PoolConnection,
  taskId: number,
): Promise<void> {
  await conn.execute(
    "UPDATE task_reminders SET state='cancelled',updated_at=? WHERE task_id=? AND state IN ('pending','failed')",
    [now(), taskId],
  );
  const [results] = await conn.execute<Row[]>(
    `SELECT t.id,t.deadline,t.manager_lookup_id,t.is_archived,ts.is_closed,
    trl.reminder_lead_lookup_id,rl.minutes_before FROM tasks t JOIN lookups ts ON ts.id=t.status_lookup_id
    JOIN task_reminder_leads trl ON trl.task_id=t.id JOIN lookups rl ON rl.id=trl.reminder_lead_lookup_id WHERE t.id=?`,
    [taskId],
  );
  for (const row of results) {
    if (!row.deadline || row.is_archived || row.is_closed) continue;
    const deadline = DateTime.fromSQL(String(row.deadline), { zone: "UTC" });
    const scheduled = deadline.minus({ minutes: Number(row.minutes_before) });
    await conn.execute(
      `INSERT INTO task_reminders
      (task_id,reminder_lead_lookup_id,deadline_snapshot,manager_lookup_id,scheduled_at,state,attempts,created_at,updated_at)
      VALUES (?,?,?,?,?,?,0,?,?)`,
      [
        taskId,
        row.reminder_lead_lookup_id,
        row.deadline,
        row.manager_lookup_id,
        dbTime(scheduled),
        scheduled.toMillis() <= Date.now() ? "skipped" : "pending",
        now(),
        now(),
      ],
    );
  }
}
