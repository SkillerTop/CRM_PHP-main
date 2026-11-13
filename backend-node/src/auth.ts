import { randomBytes } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import argon2 from "argon2";
import bcrypt from "bcryptjs";
import { envBool } from "./env.js";
import {
  ApiError,
  clientIp,
  db,
  equal,
  first,
  now,
  rows,
  sha256,
  utc,
  type Row,
} from "./core.js";
import { ensureAllowed, recordAttempt, clearAttempts } from "./rate.js";
import { logAudit } from "./audit.js";
import { ensureManagerForUser } from "./bootstrap.js";

export type User = {
  id: number;
  full_name: string;
  email: string;
  phone: string | null;
  photo_data_url: string | null;
  role: string;
  is_active: boolean;
  pending_approval: boolean;
  must_change_password: boolean;
  last_login_at: string | null;
  updated_at: string | null;
};
export type Identity = { user: User; sessionId: number; csrf: string };

function cookie(res: ServerResponse, token: string, maxAge: number): void {
  const secure = envBool("SESSION_SECURE", true) ? "; Secure" : "";
  const name = process.env.SESSION_COOKIE ?? "crm_session";
  res.setHeader(
    "Set-Cookie",
    `${name}=${token}; Path=/; HttpOnly; SameSite=${process.env.SESSION_SAMESITE ?? "Lax"}; Max-Age=${maxAge}${secure}`,
  );
}

export function publicUser(row: Row): User {
  return {
    id: Number(row.id),
    full_name: String(row.full_name),
    email: String(row.email),
    phone: (row.phone as string | null) ?? null,
    photo_data_url: row.has_photo ? `/api/users/${row.id}/photo` : null,
    role: String(row.role),
    is_active: Boolean(row.is_active),
    pending_approval: Boolean(row.pending_approval),
    must_change_password: Boolean(row.must_change_password),
    last_login_at: utc(row.last_login_at),
    updated_at: utc(row.updated_at),
  };
}

export async function resolve(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<Identity | null> {
  const name = process.env.SESSION_COOKIE ?? "crm_session";
  const cookieToken = req.headers.cookie
    ?.split(";")
    .map((x) => x.trim())
    .find((x) => x.startsWith(`${name}=`))
    ?.slice(name.length + 1);
  const bearer = /^Bearer\s+(.+)$/i.exec(
    String(req.headers.authorization ?? ""),
  )?.[1];
  const token = cookieToken ?? bearer;
  if (!token) return null;
  const row = await first(
    `SELECT s.id AS session_id, s.csrf_token, s.expires_at,
    u.id, u.full_name, u.email, u.phone, (u.photo_data_url IS NOT NULL) AS has_photo,
    u.role, u.is_active, u.pending_approval, u.must_change_password, u.last_login_at, u.updated_at
    FROM user_sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.revoked_at IS NULL LIMIT 1`,
    [sha256(token)],
  );
  if (!row || !row.is_active || row.pending_approval) return null;
  if (new Date(String(row.expires_at).replace(" ", "T") + "Z") <= new Date()) {
    await db.execute("UPDATE user_sessions SET revoked_at = ? WHERE id = ?", [
      now(),
      row.session_id,
    ]);
    return null;
  }
  const hours = Number(process.env.SESSION_IDLE_HOURS ?? 12);
  const expires = new Date(Date.now() + hours * 3600_000)
    .toISOString()
    .replace("T", " ")
    .replace("Z", "000");
  await db.execute(
    "UPDATE user_sessions SET last_activity_at = ?, expires_at = ? WHERE id = ?",
    [now(), expires, row.session_id],
  );
  cookie(res, token, hours * 3600);
  return {
    user: publicUser(row),
    sessionId: Number(row.session_id),
    csrf: String(row.csrf_token),
  };
}

export function requireRole(identity: Identity, ...roles: string[]): void {
  if (!roles.includes(identity.user.role))
    throw new ApiError(
      403,
      "forbidden",
      "Недостаточно прав для этой операции.",
    );
}

export function validateCsrf(req: IncomingMessage, identity: Identity): void {
  if (!equal(String(req.headers["x-csrf-token"] ?? ""), identity.csrf))
    throw new ApiError(
      419,
      "csrf_mismatch",
      "CSRF-токен отсутствует или устарел.",
    );
}

export async function verifyPassword(
  password: string,
  hash: string,
): Promise<boolean> {
  if (hash.startsWith("$argon2")) return argon2.verify(hash, password);
  if (hash.startsWith("$2")) return bcrypt.compare(password, hash);
  return false;
}

export async function login(
  req: IncomingMessage,
  res: ServerResponse,
  email: string,
  password: string,
): Promise<{
  user: User;
  csrf_token: string;
  session_expires_at: string | null;
}> {
  const ip = clientIp(req);
  await ensureAllowed("login_ip", ip);
  const row = await first(
    `SELECT id, full_name, email, phone, password_hash, role, is_active,
    pending_approval, must_change_password, last_login_at, updated_at, (photo_data_url IS NOT NULL) AS has_photo
    FROM users WHERE email = ? LIMIT 1`,
    [email.toLowerCase()],
  );
  const valid =
    row &&
    row.is_active &&
    !row.pending_approval &&
    (await verifyPassword(password, String(row.password_hash)));
  if (!valid) {
    await recordAttempt("login_ip", ip);
    await logAudit(db, null, {
      action: "LOGIN FAILED",
      entityType: "User",
      entityId: row ? Number(row.id) : null,
      entityLabel: row ? String(row.full_name) : email,
      detail: { ip },
      actorUserId: null,
      actorName: email,
    });
    throw new ApiError(
      401,
      "invalid_credentials",
      "Неверные учётные данные или аккаунт не активирован.",
    );
  }
  await clearAttempts("login_ip", ip);
  await db.execute("UPDATE users SET last_login_at = ? WHERE id = ?", [
    now(),
    row.id,
  ]);
  const token = randomBytes(32).toString("hex"),
    csrf = randomBytes(24).toString("hex");
  const hours = Number(process.env.SESSION_IDLE_HOURS ?? 12);
  const expiry = new Date(Date.now() + hours * 3600_000)
    .toISOString()
    .replace("T", " ")
    .replace("Z", "000");
  const [insert] = await db.execute(
    `INSERT INTO user_sessions (user_id,token_hash,csrf_token,ip_address,user_agent,last_activity_at,expires_at,created_at)
    VALUES (?,?,?,?,?,?,?,?)`,
    [
      row.id,
      sha256(token),
      csrf,
      ip,
      String(req.headers["user-agent"] ?? "").slice(0, 500),
      now(),
      expiry,
      now(),
    ],
  );
  const identity = {
    user: publicUser(row),
    sessionId: "insertId" in insert ? Number(insert.insertId) : 0,
    csrf,
  };
  await ensureManagerForUser(identity);
  await logAudit(db, identity, {
    action: "LOGIN",
    entityType: "User",
    entityId: identity.user.id,
    entityLabel: identity.user.full_name,
    detail: { ip },
  });
  cookie(res, token, hours * 3600);
  return {
    user: identity.user,
    csrf_token: csrf,
    session_expires_at: utc(expiry),
  };
}

export async function logout(
  res: ServerResponse,
  identity: Identity,
): Promise<void> {
  await db.execute(
    "UPDATE user_sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL",
    [now(), identity.sessionId],
  );
  cookie(res, "", 0);
}

export function permissions(role: string): Record<string, boolean> {
  return {
    read: true,
    write: ["admin", "manager", "editor"].includes(role),
    archive: role === "admin",
    admin: role === "admin",
  };
}
