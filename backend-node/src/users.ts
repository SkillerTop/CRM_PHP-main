import type { ServerResponse } from "node:http";
import argon2 from "argon2";
import type { PoolConnection } from "mysql2/promise";
import { ApiError, db, first, now, rows, utc, type Row } from "./core.js";
import { requireRole, type Identity } from "./auth.js";
import {
  bool,
  emailError,
  max,
  optimistic,
  requiredField,
  str,
  validate,
} from "./domain.js";
import { pagination } from "./lookups.js";
import { decodeImage } from "./image.js";
import { logAudit, redactEvent } from "./audit.js";
import { createPasswordToken } from "./password-tokens.js";
import { sendMail } from "./mailer.js";
import { ensureManagerForId } from "./bootstrap.js";
import { listSessions } from "./profile.js";

const roles = ["admin", "manager", "editor", "readonly"];
function mapUser(row: Row): Record<string, unknown> {
  return {
    id: Number(row.id),
    full_name: String(row.full_name),
    email: String(row.email),
    phone: row.phone ?? null,
    photo_data_url:
      row.has_photo || row.photo_data_url ? `/api/users/${row.id}/photo` : null,
    role: String(row.role),
    is_active: Boolean(row.is_active),
    pending_approval: Boolean(row.pending_approval),
    must_change_password: Boolean(row.must_change_password),
    last_login_at: utc(row.last_login_at),
    created_at: utc(row.created_at),
    updated_at: utc(row.updated_at),
  };
}
async function findUser(id: number): Promise<Row> {
  const row = await first("SELECT * FROM users WHERE id=?", [id]);
  if (!row)
    throw new ApiError(404, "user_not_found", "Пользователь не найден.");
  return row;
}
async function lockedUser(conn: PoolConnection, id: number): Promise<Row> {
  const [result] = await conn.execute<Row[]>(
    "SELECT * FROM users WHERE id=? FOR UPDATE",
    [id],
  );
  if (!result[0])
    throw new ApiError(404, "user_not_found", "Пользователь не найден.");
  return result[0];
}
export async function userIndex(
  url: URL,
  identity: Identity,
): Promise<{ data: unknown[]; meta: Record<string, number> }> {
  requireRole(identity, "admin");
  const page = pagination(url);
  const total = Number(
    (await first("SELECT COUNT(*) AS total FROM users"))?.total ?? 0,
  );
  const data = (
    await rows(
      `SELECT id,full_name,email,phone,role,is_active,pending_approval,must_change_password,
    last_login_at,created_at,updated_at,(photo_data_url IS NOT NULL) AS has_photo
    FROM users ORDER BY pending_approval DESC,is_active DESC,full_name LIMIT ? OFFSET ?`,
      [page.perPage, page.offset],
    )
  ).map(mapUser);
  return { data, meta: page.meta(total) };
}
export async function userPhoto(
  res: ServerResponse,
  identity: Identity,
  id: number,
): Promise<void> {
  if (id !== identity.user.id) requireRole(identity, "admin");
  const row = await first("SELECT photo_data_url FROM users WHERE id=?", [id]);
  if (!row?.photo_data_url)
    throw new ApiError(404, "image_not_found", "Изображение не найдено.");
  const { mime, content } = decodeImage(String(row.photo_data_url));
  res.writeHead(200, {
    "Content-Type": mime,
    "Content-Length": content.length,
    "X-Content-Type-Options": "nosniff",
  });
  res.end(content);
}
export async function userStore(
  identity: Identity,
  input: Record<string, unknown>,
): Promise<{
  data: Record<string, unknown>;
  warnings?: Record<string, string>;
}> {
  requireRole(identity, "admin");
  const name = str(input, "full_name", "")!,
    email = str(input, "email", "")!.toLowerCase(),
    role = str(input, "role", "editor")!,
    active = bool(input, "is_active", true),
    delivery = str(input, "delivery", "temporary_password")!,
    password = str(input, "temporary_password", "")!;
  validate({
    full_name: requiredField(name) || max(name, 150),
    email: requiredField(email) || emailError(email) || max(email, 255),
    role: roles.includes(role) ? "" : "Неизвестная роль.",
    delivery: ["invite", "temporary_password"].includes(delivery)
      ? ""
      : "Допустимы invite или temporary_password.",
    temporary_password:
      delivery === "temporary_password" && [...password].length < 8
        ? "Минимум 8 символов."
        : "",
  });
  const hash =
    delivery === "temporary_password"
      ? await argon2.hash(password, { type: argon2.argon2id })
      : null;
  const conn = await db.getConnection();
  let id = 0,
    token: string | null = null;
  try {
    await conn.beginTransaction();
    const [result] = await conn.execute(
      `INSERT INTO users
      (full_name,email,password_hash,role,is_active,pending_approval,must_change_password,created_by,updated_by,created_at,updated_at)
      VALUES (?,?,?,?,?,0,?,?,?,?,?)`,
      [
        name,
        email,
        hash,
        role,
        active ? 1 : 0,
        delivery === "temporary_password" ? 1 : 0,
        identity.user.id,
        identity.user.id,
        now(),
        now(),
      ],
    );
    id = "insertId" in result ? Number(result.insertId) : 0;
    await logAudit(conn, identity, {
      action: "CREATE",
      entityType: "User",
      entityId: id,
      entityLabel: name,
      detail: { role, delivery },
    });
    if (delivery === "invite")
      token = await createPasswordToken(id, "invite", 1440, conn);
    await conn.commit();
  } catch (error) {
    await conn.rollback();
    if ((error as { code?: string }).code === "ER_DUP_ENTRY")
      throw new ApiError(
        409,
        "email_exists",
        "Пользователь с таким email уже существует.",
      );
    throw error;
  } finally {
    conn.release();
  }
  await ensureManagerForId(id);
  const response: {
    data: Record<string, unknown>;
    warnings?: Record<string, string>;
  } = { data: mapUser(await findUser(id)) };
  if (delivery === "invite") {
    const link = `${(process.env.APP_URL ?? "").replace(/\/$/, "")}/reset-password?token=${encodeURIComponent(token ?? "")}`;
    try {
      await sendMail(
        email,
        "Приглашение в Client Data CRM",
        `Здравствуйте, ${name}.\n\nУстановите пароль по ссылке (действует 24 часа):\n${link}\n`,
      );
    } catch {
      response.warnings = {
        mail: "Пользователь создан, но приглашение не отправлено. Проверьте настройки почтового сервера.",
      };
    }
  }
  return response;
}

async function protectLastAdmin(
  conn: PoolConnection,
  before: Row,
  role: string,
  active: boolean,
): Promise<void> {
  if (
    before.role !== "admin" ||
    !before.is_active ||
    (role === "admin" && active)
  )
    return;
  const [admins] = await conn.execute<Row[]>(
    "SELECT id FROM users WHERE role='admin' AND is_active=1 AND pending_approval=0 FOR UPDATE",
  );
  if (admins.length <= 1)
    throw new ApiError(
      409,
      "last_active_admin",
      "Нельзя изменить роль или деактивировать последнего активного Admin.",
    );
}
export async function userUpdate(
  identity: Identity,
  id: number,
  input: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  requireRole(identity, "admin");
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const before = await lockedUser(conn, id);
    optimistic(before, input.updated_at);
    const name = str(input, "full_name", String(before.full_name))!,
      role = str(input, "role", String(before.role))!,
      active = bool(input, "is_active", Boolean(before.is_active));
    validate({
      full_name: requiredField(name) || max(name, 150),
      role: roles.includes(role) ? "" : "Неизвестная роль.",
    });
    await protectLastAdmin(conn, before, role, active);
    await conn.execute(
      "UPDATE users SET full_name=?,role=?,is_active=?,updated_by=?,updated_at=? WHERE id=?",
      [name, role, active ? 1 : 0, identity.user.id, now(), id],
    );
    if (role !== before.role)
      await logAudit(conn, identity, {
        action: "ROLE CHANGE",
        entityType: "User",
        entityId: id,
        entityLabel: name,
        field: "Role",
        from: String(before.role),
        to: role,
      });
    if (active !== Boolean(before.is_active)) {
      await logAudit(conn, identity, {
        action: "FIELD CHANGE",
        entityType: "User",
        entityId: id,
        entityLabel: name,
        field: "Active",
        from: before.is_active ? "true" : "false",
        to: active ? "true" : "false",
      });
      if (!active)
        await conn.execute(
          "UPDATE user_sessions SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL",
          [now(), id],
        );
    }
    if (name !== before.full_name)
      await logAudit(conn, identity, {
        action: "FIELD CHANGE",
        entityType: "User",
        entityId: id,
        entityLabel: name,
        field: "Full name",
        from: String(before.full_name),
        to: name,
      });
    await conn.commit();
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
  await ensureManagerForId(id);
  return mapUser(await findUser(id));
}

export async function userApprove(
  identity: Identity,
  id: number,
  input: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  requireRole(identity, "admin");
  const role = str(input, "role", "editor")!;
  if (!roles.includes(role))
    throw new ApiError(400, "validation_error", "Неизвестная роль.");
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const before = await lockedUser(conn, id);
    if (!before.pending_approval)
      throw new ApiError(
        409,
        "not_pending",
        "Пользователь не ожидает подтверждения.",
      );
    await conn.execute(
      "UPDATE users SET role=?,is_active=1,pending_approval=0,updated_by=?,updated_at=? WHERE id=?",
      [role, identity.user.id, now(), id],
    );
    const label = String(before.full_name),
      detail = { approved: true };
    if (role !== before.role)
      await logAudit(conn, identity, {
        action: "ROLE CHANGE",
        entityType: "User",
        entityId: id,
        entityLabel: label,
        field: "Role",
        from: String(before.role),
        to: role,
        detail,
      });
    await logAudit(conn, identity, {
      action: "FIELD CHANGE",
      entityType: "User",
      entityId: id,
      entityLabel: label,
      field: "Active",
      from: "false",
      to: "true",
      detail,
    });
    await logAudit(conn, identity, {
      action: "FIELD CHANGE",
      entityType: "User",
      entityId: id,
      entityLabel: label,
      field: "Registration",
      from: "pending",
      to: "approved",
    });
    await conn.commit();
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
  await ensureManagerForId(id);
  return mapUser(await findUser(id));
}

export async function userReject(
  identity: Identity,
  id: number,
): Promise<void> {
  requireRole(identity, "admin");
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const user = await lockedUser(conn, id);
    if (!user.pending_approval)
      throw new ApiError(
        409,
        "not_pending",
        "Удалить можно только неподтверждённую регистрацию.",
      );
    await logAudit(conn, identity, {
      action: "FIELD CHANGE",
      entityType: "User",
      entityId: id,
      entityLabel: String(user.full_name),
      field: "Registration",
      from: "pending",
      to: "rejected",
    });
    await conn.execute("DELETE FROM users WHERE id=?", [id]);
    await conn.commit();
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

export async function userResetPassword(
  identity: Identity,
  id: number,
  input: Record<string, unknown>,
): Promise<{
  data: Record<string, string>;
  warnings?: Record<string, string>;
}> {
  requireRole(identity, "admin");
  const delivery = str(input, "delivery", "temporary_password")!,
    password = str(input, "temporary_password", "")!;
  if (!["invite", "temporary_password"].includes(delivery))
    throw new ApiError(
      400,
      "validation_error",
      "Допустимы invite или temporary_password.",
    );
  if (delivery === "temporary_password" && [...password].length < 8)
    throw new ApiError(
      400,
      "validation_error",
      "Временный пароль должен содержать минимум 8 символов.",
    );
  const hash =
    delivery === "temporary_password"
      ? await argon2.hash(password, { type: argon2.argon2id })
      : null;
  const conn = await db.getConnection();
  let token: string | null = null,
    user: Row | null = null;
  try {
    await conn.beginTransaction();
    user = await lockedUser(conn, id);
    if (delivery === "temporary_password") {
      await conn.execute(
        "UPDATE users SET password_hash=?,must_change_password=1,updated_by=?,updated_at=? WHERE id=?",
        [hash, identity.user.id, now(), id],
      );
      await conn.execute(
        "UPDATE user_sessions SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL",
        [now(), id],
      );
    } else token = await createPasswordToken(id, "admin_reset", 1440, conn);
    await logAudit(conn, identity, {
      action: "FIELD CHANGE",
      entityType: "User",
      entityId: id,
      entityLabel: String(user.full_name),
      field: "Password",
      from: "—",
      to: "reset",
      detail: { delivery },
    });
    await conn.commit();
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
  const response: {
    data: Record<string, string>;
    warnings?: Record<string, string>;
  } = { data: { message: "Сброс пароля подготовлен." } };
  if (delivery === "invite") {
    const link = `${(process.env.APP_URL ?? "").replace(/\/$/, "")}/reset-password?token=${encodeURIComponent(token ?? "")}`;
    try {
      await sendMail(
        String(user!.email),
        "Сброс пароля Client Data CRM",
        `Установите новый пароль по ссылке (действует 24 часа):\n${link}\n`,
      );
    } catch {
      response.warnings = {
        mail: "Ссылка создана, но письмо не отправлено. Проверьте настройки почтового сервера.",
      };
    }
  }
  return response;
}

export async function userLog(
  url: URL,
  identity: Identity,
  id: number,
): Promise<{ data: Row[]; meta: Record<string, number> }> {
  requireRole(identity, "admin");
  await findUser(id);
  const page = pagination(url);
  const total = Number(
    (
      await first(
        "SELECT COUNT(*) AS total FROM change_events WHERE entity_type=? AND entity_id=?",
        ["User", id],
      )
    )?.total ?? 0,
  );
  const data = (
    await rows(
      "SELECT * FROM change_events WHERE entity_type=? AND entity_id=? ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?",
      ["User", id, page.perPage, page.offset],
    )
  ).map(redactEvent);
  return { data, meta: page.meta(total) };
}
export async function userSessions(
  url: URL,
  identity: Identity,
  id: number,
): Promise<{ data: unknown[]; meta: Record<string, number> }> {
  requireRole(identity, "admin");
  await findUser(id);
  return listSessions(url, identity, id);
}
