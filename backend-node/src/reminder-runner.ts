import { db, first, now, type Row } from "./core.js";
import { sendMail } from "./mailer.js";
import { taskCalendar } from "./ics.js";
import { logAudit } from "./audit.js";

async function mark(
  id: number,
  state: string,
  recipient: string | null,
  error: string | null,
): Promise<void> {
  await db.execute(
    `UPDATE task_reminders SET state=?,recipient_email=?,error_message=?,
    sent_at=IF(?='sent',UTC_TIMESTAMP(6),sent_at),updated_at=UTC_TIMESTAMP(6) WHERE id=?`,
    [state, recipient, error, state, id],
  );
}
async function claimNext(): Promise<number | null> {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [results] = await conn.query<Row[]>(`SELECT id FROM task_reminders
      WHERE scheduled_at<=UTC_TIMESTAMP(6) AND (state='pending' OR
        (state='failed' AND attempts<5 AND updated_at<=UTC_TIMESTAMP(6)-INTERVAL 15 MINUTE))
      ORDER BY scheduled_at,id LIMIT 1 FOR UPDATE SKIP LOCKED`);
    const id = results[0]?.id;
    if (id)
      await conn.execute(
        `UPDATE task_reminders SET state='processing',attempts=attempts+1,
      locked_at=UTC_TIMESTAMP(6),updated_at=UTC_TIMESTAMP(6) WHERE id=?`,
        [id],
      );
    await conn.commit();
    return id ? Number(id) : null;
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}
async function deliver(id: number): Promise<"sent" | "failed" | "skipped"> {
  const row = await first(
    `SELECT r.*,t.name,t.description,t.deadline,t.manager_lookup_id AS current_manager_id,
    t.is_archived,c.name AS company_name,ts.is_closed,m.value AS manager_value,
    CASE WHEN m.user_id IS NOT NULL AND u.is_active=1 AND u.pending_approval=0 THEN u.email
         WHEN m.user_id IS NULL THEN m.email ELSE NULL END AS recipient_email
    FROM task_reminders r JOIN tasks t ON t.id=r.task_id JOIN companies c ON c.id=t.company_id
    JOIN lookups ts ON ts.id=t.status_lookup_id JOIN lookups m ON m.id=t.manager_lookup_id
    LEFT JOIN users u ON u.id=m.user_id WHERE r.id=?`,
    [id],
  );
  if (
    !row ||
    row.is_archived ||
    row.is_closed ||
    Number(row.current_manager_id) !== Number(row.manager_lookup_id) ||
    String(row.deadline) !== String(row.deadline_snapshot)
  ) {
    await mark(
      id,
      "skipped",
      null,
      "Task is closed, archived, or rescheduled.",
    );
    return "skipped";
  }
  const recipient = String(row.recipient_email ?? "");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) {
    const error = "У ответственного менеджера отсутствует email.";
    await mark(id, "failed", null, error);
    await logAudit(db, null, {
      action: "REMINDER FAILED",
      entityType: "Task",
      entityId: Number(row.task_id),
      entityLabel: String(row.name),
      detail: { error },
      actorName: "system",
    });
    return "failed";
  }
  try {
    const calendar = taskCalendar(row);
    await sendMail(
      recipient,
      `CRM deadline: ${row.name}`,
      `Напоминание о задаче CRM\n\nКомпания: ${row.company_name}\nЗадача: ${row.name}\nДедлайн (UTC): ${row.deadline}\n`,
      [
        {
          filename: `task-${row.task_id}.ics`,
          content: calendar,
          contentType: "text/calendar; charset=UTF-8",
        },
      ],
    );
    await mark(id, "sent", recipient, null);
    await logAudit(db, null, {
      action: "REMINDER SENT",
      entityType: "Task",
      entityId: Number(row.task_id),
      entityLabel: String(row.name),
      detail: { recipient },
      actorName: "system",
    });
    return "sent";
  } catch {
    const error = "Почтовое напоминание не отправлено.";
    await mark(id, "failed", recipient, error);
    await logAudit(db, null, {
      action: "REMINDER FAILED",
      entityType: "Task",
      entityId: Number(row.task_id),
      entityLabel: String(row.name),
      detail: { recipient, error },
      actorName: "system",
    });
    return "failed";
  }
}
export async function runReminders(
  limit = 100,
): Promise<{ sent: number; failed: number; skipped: number }> {
  await db.execute(`UPDATE task_reminders SET state='failed',error_message='Recovered stale processing lock',
    updated_at=UTC_TIMESTAMP(6) WHERE state='processing' AND locked_at<UTC_TIMESTAMP(6)-INTERVAL 30 MINUTE`);
  const summary = { sent: 0, failed: 0, skipped: 0 };
  for (let index = 0; index < limit; index++) {
    const id = await claimNext();
    if (id === null) break;
    summary[await deliver(id)]++;
  }
  await db.execute(
    `INSERT INTO settings (setting_key,setting_value,updated_at) VALUES ('scheduler_last_run_at',?,?)
    ON DUPLICATE KEY UPDATE setting_value=VALUES(setting_value),updated_at=VALUES(updated_at)`,
    [now(), now()],
  );
  return summary;
}
