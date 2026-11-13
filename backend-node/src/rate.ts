import { ApiError, db, now, sha256, type Row } from "./core.js";

export async function ensureAllowed(scope: string, key: string): Promise<void> {
  const [result] = await db.execute<Row[]>(
    "SELECT blocked_until FROM auth_attempts WHERE scope=? AND key_hash=?",
    [scope, sha256(key)],
  );
  const blocked = result[0]?.blocked_until;
  if (blocked) {
    const timestamp = new Date(
      String(blocked).replace(" ", "T") + "Z",
    ).getTime();
    if (timestamp > Date.now())
      throw new ApiError(
        429,
        "rate_limited",
        "Слишком много попыток. Повторите позже.",
        {
          retry_after_seconds: Math.max(
            1,
            Math.ceil((timestamp - Date.now()) / 1000),
          ),
        },
      );
  }
}

export async function recordAttempt(scope: string, key: string): Promise<void> {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const hash = sha256(key);
    const [result] = await conn.execute<Row[]>(
      "SELECT * FROM auth_attempts WHERE scope=? AND key_hash=? FOR UPDATE",
      [scope, hash],
    );
    const previous = result[0],
      window = Number(process.env.LOGIN_WINDOW_MINUTES ?? 15),
      maximum = Number(process.env.LOGIN_MAX_ATTEMPTS ?? 5);
    const previousStart = previous?.window_started_at
      ? new Date(
          String(previous.window_started_at).replace(" ", "T") + "Z",
        ).getTime()
      : 0;
    const sameWindow = previousStart >= Date.now() - window * 60000;
    const attempts = sameWindow ? Number(previous?.attempts ?? 0) + 1 : 1;
    const start = sameWindow ? String(previous!.window_started_at) : now();
    const blocked =
      attempts >= maximum
        ? new Date(
            Date.now() + Number(process.env.LOGIN_BLOCK_MINUTES ?? 15) * 60000,
          )
            .toISOString()
            .replace("T", " ")
            .replace("Z", "000")
        : null;
    await conn.execute(
      `INSERT INTO auth_attempts (scope,key_hash,attempts,window_started_at,blocked_until,updated_at)
      VALUES (?,?,?,?,?,?) ON DUPLICATE KEY UPDATE attempts=VALUES(attempts),window_started_at=VALUES(window_started_at),
      blocked_until=VALUES(blocked_until),updated_at=VALUES(updated_at)`,
      [scope, hash, attempts, start, blocked, now()],
    );
    await conn.commit();
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

export async function clearAttempts(scope: string, key: string): Promise<void> {
  await db.execute("DELETE FROM auth_attempts WHERE scope=? AND key_hash=?", [
    scope,
    sha256(key),
  ]);
}
