import { randomBytes } from "node:crypto";
import type { PoolConnection } from "mysql2/promise";
import { ApiError, db, now, sha256, type Row } from "./core.js";
import { DateTime } from "luxon";
import { dbTime } from "./reminders.js";

export async function createPasswordToken(
  userId: number,
  purpose: string,
  minutes: number,
  existing?: PoolConnection,
): Promise<string> {
  const conn = existing ?? (await db.getConnection());
  const token = randomBytes(32).toString("hex");
  try {
    if (!existing) await conn.beginTransaction();
    const [user] = await conn.execute<Row[]>(
      "SELECT id FROM users WHERE id=? FOR UPDATE",
      [userId],
    );
    if (!user.length)
      throw new ApiError(404, "user_not_found", "Пользователь не найден.");
    await conn.execute(
      "UPDATE password_tokens SET used_at=? WHERE user_id=? AND used_at IS NULL",
      [now(), userId],
    );
    await conn.execute(
      `INSERT INTO password_tokens (user_id,token_hash,purpose,expires_at,created_at) VALUES (?,?,?,?,?)`,
      [
        userId,
        sha256(token),
        purpose,
        dbTime(DateTime.utc().plus({ minutes })),
        now(),
      ],
    );
    if (!existing) await conn.commit();
    return token;
  } catch (error) {
    if (!existing) await conn.rollback();
    throw error;
  } finally {
    if (!existing) conn.release();
  }
}
