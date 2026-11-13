import type { IncomingMessage } from "node:http";
import argon2 from "argon2";
import {
  ApiError,
  clientIp,
  db,
  first,
  now,
  sha256,
  type Row,
} from "./core.js";
import { emailError, max, requiredField, str, validate } from "./domain.js";
import { ensureAllowed, recordAttempt } from "./rate.js";
import { settingsPayload } from "./settings.js";
import { sendMail } from "./mailer.js";
import { logAudit } from "./audit.js";
import { createPasswordToken } from "./password-tokens.js";

const accepted = {
  message:
    "Если регистрация может быть принята, заявка будет доступна администратору.",
};
export async function register(
  req: IncomingMessage,
  input: Record<string, unknown>,
): Promise<Record<string, string>> {
  const name = str(input, "full_name", "")!,
    email = str(input, "email", "")!.toLowerCase(),
    password = str(input, "password", "")!;
  validate({
    full_name: requiredField(name) || max(name, 150),
    email: requiredField(email) || emailError(email) || max(email, 255),
    password: [...password].length >= 8 ? "" : "Минимум 8 символов.",
    password_confirmation:
      password === str(input, "password_confirmation", "")
        ? ""
        : "Пароли не совпадают.",
  });
  const ip = clientIp(req);
  await ensureAllowed("register_ip", ip);
  await ensureAllowed("register_email", email);
  await recordAttempt("register_ip", ip);
  await recordAttempt("register_email", email);
  const settings = await settingsPayload(),
    domains = settings.registration_allowed_domains as string[];
  if (domains.length && !domains.includes(email.split("@")[1] ?? ""))
    throw new ApiError(
      403,
      "registration_domain_denied",
      "Регистрация для этого адреса недоступна.",
    );
  if (await first("SELECT id FROM users WHERE email=? LIMIT 1", [email]))
    return accepted;
  const conn = await db.getConnection();
  let id = 0;
  try {
    await conn.beginTransaction();
    const [result] = await conn.execute(
      `INSERT INTO users
      (full_name,email,password_hash,role,is_active,pending_approval,must_change_password,created_at,updated_at)
      VALUES (?,?,?,'readonly',0,1,0,?,?)`,
      [
        name,
        email,
        await argon2.hash(password, { type: argon2.argon2id }),
        now(),
        now(),
      ],
    );
    id = "insertId" in result ? Number(result.insertId) : 0;
    await logAudit(conn, null, {
      action: "USER REGISTERED",
      entityType: "User",
      entityId: id,
      entityLabel: name,
      detail: { email },
      actorUserId: id,
      actorName: name,
    });
    await conn.commit();
  } catch (error) {
    await conn.rollback();
    if ((error as { code?: string }).code === "ER_DUP_ENTRY") return accepted;
    throw error;
  } finally {
    conn.release();
  }
  if (settings.notify_new_registrations && settings.system_notification_email) {
    const link = `${(process.env.APP_URL ?? "").replace(/\/$/, "")}/?view=users&user=${id}`;
    try {
      await sendMail(
        String(settings.system_notification_email),
        "Новая регистрация CRM",
        `Новый пользователь ожидает подтверждения.\n\n${name}\n${email}\n${link}\n`,
      );
    } catch {}
  }
  return accepted;
}

export async function forgotPassword(
  req: IncomingMessage,
  input: Record<string, unknown>,
): Promise<Record<string, string>> {
  const email = str(input, "email", "")!.toLowerCase();
  validate({ email: requiredField(email) || emailError(email) });
  const ip = clientIp(req);
  await ensureAllowed("forgot_password_ip", ip);
  await ensureAllowed("forgot_password_email", email);
  await recordAttempt("forgot_password_ip", ip);
  await recordAttempt("forgot_password_email", email);
  const user = await first(
    "SELECT id,full_name,email FROM users WHERE email=? AND is_active=1 AND pending_approval=0 LIMIT 1",
    [email],
  );
  if (user) {
    const token = await createPasswordToken(
      Number(user.id),
      "password_reset",
      60,
    );
    const url = `${(process.env.APP_URL ?? "").replace(/\/$/, "")}/reset-password?token=${encodeURIComponent(token)}`;
    try {
      await sendMail(
        String(user.email),
        "Восстановление пароля CRM",
        `Здравствуйте, ${user.full_name}.\n\nСсылка действует 1 час:\n${url}\n`,
      );
    } catch {}
  }
  return { message: "Если адрес зарегистрирован, инструкция отправлена." };
}

export async function resetPassword(
  input: Record<string, unknown>,
): Promise<Record<string, string>> {
  const token = str(input, "token", "")!,
    password = str(input, "password", "")!;
  validate({
    token: requiredField(token),
    password: [...password].length >= 8 ? "" : "Минимум 8 символов.",
    password_confirmation:
      password === str(input, "password_confirmation", "")
        ? ""
        : "Пароли не совпадают.",
  });
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [matches] = await conn.execute<Row[]>(
      `SELECT * FROM password_tokens WHERE token_hash=? AND used_at IS NULL
      AND expires_at>UTC_TIMESTAMP(6) LIMIT 1 FOR UPDATE`,
      [sha256(token)],
    );
    const row = matches[0];
    if (!row)
      throw new ApiError(
        400,
        "invalid_token",
        "Ссылка недействительна или срок её действия истёк.",
      );
    const userId = Number(row.user_id),
      timestamp = now();
    await conn.execute(
      "UPDATE users SET password_hash=?,must_change_password=0,updated_at=? WHERE id=?",
      [
        await argon2.hash(password, { type: argon2.argon2id }),
        timestamp,
        userId,
      ],
    );
    await conn.execute(
      "UPDATE password_tokens SET used_at=? WHERE user_id=? AND used_at IS NULL",
      [timestamp, userId],
    );
    await conn.execute(
      "UPDATE user_sessions SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL",
      [timestamp, userId],
    );
    const [users] = await conn.execute<Row[]>(
      "SELECT full_name FROM users WHERE id=?",
      [userId],
    );
    const name = String(users[0]?.full_name ?? "");
    await logAudit(conn, null, {
      action: "FIELD CHANGE",
      entityType: "User",
      entityId: userId,
      entityLabel: name,
      field: "Password",
      from: "—",
      to: "changed",
      actorUserId: userId,
      actorName: name,
    });
    await conn.commit();
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
  return { message: "Пароль изменён. Теперь можно войти." };
}
