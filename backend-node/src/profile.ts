import argon2 from "argon2";
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
import { verifyPassword, type Identity } from "./auth.js";
import { pagination } from "./lookups.js";
import { logAudit } from "./audit.js";
import { sendMail } from "./mailer.js";
import {
  emailError,
  max,
  phoneError,
  requiredField,
  str,
  validate,
} from "./domain.js";
import { validateImage } from "./image.js";

export async function listSessions(
  url: URL,
  identity: Identity,
  userId = identity.user.id,
): Promise<{ data: unknown[]; meta: Record<string, number> }> {
  const paging = pagination(url);
  const total = Number(
    (
      await first(
        "SELECT COUNT(*) AS total FROM user_sessions WHERE user_id = ?",
        [userId],
      )
    )?.total ?? 0,
  );
  const sessions = await rows(
    `SELECT id,ip_address,user_agent,created_at,last_activity_at,revoked_at,
    CASE WHEN revoked_at IS NOT NULL AND revoked_at < expires_at THEN 'signed_out'
      WHEN expires_at <= UTC_TIMESTAMP(6) THEN 'expired' ELSE 'active' END AS state
    FROM user_sessions WHERE user_id=? ORDER BY (revoked_at IS NULL AND expires_at > UTC_TIMESTAMP(6)) DESC,
      created_at DESC,id DESC LIMIT ? OFFSET ?`,
    [userId, paging.perPage, paging.offset],
  );
  const data = sessions.map((row) => ({
    id: Number(row.id),
    ip_address: row.ip_address,
    user_agent: row.user_agent,
    state: row.state,
    started_at: utc(row.created_at),
    last_activity_at: utc(row.last_activity_at),
    ended_at:
      row.state === "signed_out"
        ? utc(row.revoked_at)
        : row.state === "expired"
          ? utc(row.last_activity_at)
          : null,
    is_current: Number(row.id) === identity.sessionId,
  }));
  return { data, meta: paging.meta(total) };
}

export async function revokeOtherSessions(identity: Identity): Promise<void> {
  await db.execute(
    "UPDATE user_sessions SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL AND id<>?",
    [now(), identity.user.id, identity.sessionId],
  );
  await logAudit(db, identity, {
    action: "SESSION REVOKED",
    entityType: "User",
    entityId: identity.user.id,
    entityLabel: identity.user.full_name,
    detail: { scope: "all_other_devices" },
  });
}

export async function revokeSession(
  identity: Identity,
  id: number,
): Promise<void> {
  if (id === identity.sessionId)
    throw new ApiError(
      400,
      "current_session",
      "Для текущего устройства используйте обычный выход.",
    );
  const [result] = await db.execute(
    `UPDATE user_sessions SET revoked_at=? WHERE id=? AND user_id=?
    AND revoked_at IS NULL AND expires_at > UTC_TIMESTAMP(6)`,
    [now(), id, identity.user.id],
  );
  if (!("affectedRows" in result) || result.affectedRows !== 1)
    throw new ApiError(
      404,
      "session_not_found",
      "Сессия не найдена или уже завершена.",
    );
  await logAudit(db, identity, {
    action: "SESSION REVOKED",
    entityType: "User",
    entityId: identity.user.id,
    entityLabel: identity.user.full_name,
    detail: { session_id: id },
  });
}

export async function changePassword(
  identity: Identity,
  input: Record<string, unknown>,
): Promise<Record<string, string>> {
  const currentPassword = str(input, "current_password", "")!,
    password = str(input, "password", "")!;
  validate({
    current_password: requiredField(currentPassword),
    password: [...password].length >= 8 ? "" : "Минимум 8 символов.",
    password_confirmation:
      password === str(input, "password_confirmation", "")
        ? ""
        : "Пароли не совпадают.",
  });
  const current = await first("SELECT * FROM users WHERE id=?", [
    identity.user.id,
  ]);
  if (!current)
    throw new ApiError(401, "unauthenticated", "Пользователь не найден.");
  if (!(await verifyPassword(currentPassword, String(current.password_hash))))
    throw new ApiError(
      400,
      "invalid_current_password",
      "Текущий пароль указан неверно.",
      { fields: { current_password: "Неверный пароль." } },
    );
  if (await verifyPassword(password, String(current.password_hash)))
    throw new ApiError(
      400,
      "password_unchanged",
      "Новый пароль должен отличаться от текущего.",
      { fields: { password: "Укажите новый пароль, отличный от текущего." } },
    );
  const hash = await argon2.hash(password, { type: argon2.argon2id });
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    await conn.execute(
      "UPDATE users SET password_hash=?,must_change_password=0,updated_at=?,updated_by=? WHERE id=?",
      [hash, now(), identity.user.id, identity.user.id],
    );
    await conn.execute(
      "UPDATE user_sessions SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL AND id<>?",
      [now(), identity.user.id, identity.sessionId],
    );
    await logAudit(conn, identity, {
      action: "FIELD CHANGE",
      entityType: "User",
      entityId: identity.user.id,
      entityLabel: identity.user.full_name,
      field: "Password",
      from: "—",
      to: "changed",
    });
    await conn.commit();
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
  return { message: "Пароль изменён; остальные сессии завершены." };
}

export async function updateProfile(
  identity: Identity,
  input: Record<string, unknown>,
): Promise<Record<string, string>> {
  const current = await first("SELECT * FROM users WHERE id=?", [
    identity.user.id,
  ]);
  if (!current)
    throw new ApiError(401, "unauthenticated", "Пользователь не найден.");
  const name = String(input.full_name ?? current.full_name).trim();
  const email = String(input.email ?? current.email)
    .trim()
    .toLowerCase();
  const phone =
    input.phone === undefined ? current.phone : str(input, "phone") || null;
  const photo =
    input.photo_data_url === undefined
      ? current.photo_data_url
      : validateImage(
          str(input, "photo_data_url"),
          5 * 1024 * 1024,
          "invalid_profile_photo",
          "Фото должно быть JPG, PNG или WebP размером не более 5 МБ.",
        );
  validate({
    full_name: requiredField(name) || max(name, 150),
    email: requiredField(email) || emailError(email) || max(email, 255),
    phone:
      phoneError(phone == null ? null : String(phone)) ||
      max(phone == null ? null : String(phone), 50),
  });
  if (
    email !== current.email &&
    !(await verifyPassword(
      str(input, "current_password", "")!,
      String(current.password_hash),
    ))
  )
    throw new ApiError(
      400,
      "current_password_required",
      "Для смены email укажите текущий пароль.",
      { fields: { current_password: "Неверный текущий пароль." } },
    );
  if (
    await first("SELECT id FROM users WHERE email=? AND id<>? LIMIT 1", [
      email,
      identity.user.id,
    ])
  )
    throw new ApiError(409, "email_exists", "Этот email уже используется.");
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    await conn.execute(
      "UPDATE users SET full_name=?,email=?,phone=?,photo_data_url=?,updated_at=?,updated_by=? WHERE id=?",
      [name, email, phone, photo, now(), identity.user.id, identity.user.id],
    );
    if (name !== current.full_name)
      await logAudit(conn, identity, {
        action: "FIELD CHANGE",
        entityType: "User",
        entityId: identity.user.id,
        entityLabel: name,
        field: "Full name",
        from: String(current.full_name),
        to: name,
      });
    if (email !== current.email)
      await logAudit(conn, identity, {
        action: "FIELD CHANGE",
        entityType: "User",
        entityId: identity.user.id,
        entityLabel: name,
        field: "Email",
        from: String(current.email),
        to: email,
      });
    await conn.commit();
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
  if (email !== current.email)
    try {
      await sendMail(
        String(current.email),
        "Логин CRM изменён",
        `Ваш логин CRM изменён на ${email}. Если это сделали не вы, обратитесь к администратору.`,
      );
    } catch {
      /* PHP also ignores mail failure here. */
    }
  return { message: "Профиль обновлён." };
}
