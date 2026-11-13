import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { PoolConnection } from "mysql2/promise";
import { db, sha256, type Row } from "./core.js";
import { backendRoot } from "./paths.js";

export function splitSql(sql: string): string[] {
  const statements: string[] = [];
  let buffer = "",
    quote: string | null = null;
  for (let index = 0; index < sql.length; index++) {
    const char = sql[index]!,
      next = sql[index + 1] ?? "";
    if (quote === null && char === "-" && next === "-") {
      while (index < sql.length && sql[index] !== "\n") index++;
      buffer += "\n";
      continue;
    }
    if (
      (char === "'" || char === '"') &&
      (index === 0 || sql[index - 1] !== "\\")
    )
      quote = quote === null ? char : quote === char ? null : quote;
    if (char === ";" && quote === null) {
      if (buffer.trim()) statements.push(buffer.trim());
      buffer = "";
      continue;
    }
    buffer += char;
  }
  if (buffer.trim()) statements.push(buffer.trim());
  return statements;
}
async function runStep(
  conn: PoolConnection,
  migration: string,
  step: number,
  statement: string,
): Promise<void> {
  const hash = sha256(statement);
  const [foundRows] = await conn.execute<Row[]>(
    "SELECT statement_hash,status FROM schema_migration_steps WHERE migration=? AND step_number=?",
    [migration, step],
  );
  const found = foundRows[0];
  if (found) {
    if (String(found.statement_hash) !== hash)
      throw new Error(
        `Migration ${migration} step ${step} changed after it was journaled.`,
      );
    if (found.status === "applied") return;
    if (found.status === "running")
      throw new Error(
        `Migration ${migration} step ${step} has an ambiguous running state. Verify the schema, then run: npm run cli -- migrate:resolve ${migration} ${step} applied|retry`,
      );
  } else
    await conn.execute(
      `INSERT INTO schema_migration_steps
    (migration,step_number,statement_hash,status,updated_at) VALUES (?,?,?,'pending',UTC_TIMESTAMP(6))`,
      [migration, step, hash],
    );
  await conn.execute(
    `UPDATE schema_migration_steps SET status='running',error_message=NULL,
    started_at=UTC_TIMESTAMP(6),updated_at=UTC_TIMESTAMP(6) WHERE migration=? AND step_number=?`,
    [migration, step],
  );
  try {
    await conn.query(statement);
    await conn.execute(
      `UPDATE schema_migration_steps SET status='applied',applied_at=UTC_TIMESTAMP(6),
      updated_at=UTC_TIMESTAMP(6) WHERE migration=? AND step_number=?`,
      [migration, step],
    );
  } catch (error) {
    await conn.execute(
      `UPDATE schema_migration_steps SET status='failed',error_message=?,
      updated_at=UTC_TIMESTAMP(6) WHERE migration=? AND step_number=?`,
      [String(error).slice(0, 2000), migration, step],
    );
    throw error;
  }
}
export async function migrate(): Promise<string[]> {
  const conn = await db.getConnection();
  try {
    const [lock] = await conn.query<Row[]>(
      "SELECT GET_LOCK('crm_schema_migrations',0) AS acquired",
    );
    if (Number(lock[0]?.acquired) !== 1)
      throw new Error("Another migration process is already running.");
    await conn.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      migration VARCHAR(255) PRIMARY KEY,applied_at DATETIME(6) NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`);
    await conn.query(`CREATE TABLE IF NOT EXISTS schema_migration_steps (
      migration VARCHAR(255) NOT NULL,step_number INT UNSIGNED NOT NULL,
      statement_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      status VARCHAR(20) NOT NULL,error_message TEXT NULL,started_at DATETIME(6) NULL,
      applied_at DATETIME(6) NULL,updated_at DATETIME(6) NOT NULL,
      PRIMARY KEY (migration,step_number)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`);
    const [appliedRows] = await conn.query<Row[]>(
      "SELECT migration FROM schema_migrations",
    );
    const applied = new Set(appliedRows.map((row) => String(row.migration)));
    const directory = join(backendRoot, "database", "migrations");
    const completed: string[] = [];
    for (const name of (await readdir(directory))
      .filter((x) => x.endsWith(".sql"))
      .sort()) {
      if (applied.has(name)) continue;
      for (const [index, statement] of splitSql(
        await readFile(join(directory, name), "utf8"),
      ).entries())
        await runStep(conn, name, index + 1, statement);
      await conn.execute(
        "INSERT INTO schema_migrations (migration,applied_at) VALUES (?,UTC_TIMESTAMP(6))",
        [name],
      );
      completed.push(name);
    }
    return completed;
  } finally {
    await conn
      .query("SELECT RELEASE_LOCK('crm_schema_migrations')")
      .catch(() => {});
    conn.release();
  }
}
export async function resolveMigration(
  migration: string,
  step: number,
  resolution: string,
): Promise<void> {
  if (!migration || step < 1 || !["applied", "retry"].includes(resolution))
    throw new Error(
      "Usage: migrate:resolve <migration.sql> <step> applied|retry",
    );
  const status = resolution === "applied" ? "applied" : "failed";
  const [result] = await db.execute(
    `UPDATE schema_migration_steps SET status=?,
    applied_at=IF(?='applied',UTC_TIMESTAMP(6),NULL),error_message=NULL,updated_at=UTC_TIMESTAMP(6)
    WHERE migration=? AND step_number=? AND status='running'`,
    [status, status, migration, step],
  );
  if (!("affectedRows" in result) || result.affectedRows !== 1)
    throw new Error(
      "Only an ambiguous running migration step can be resolved.",
    );
}
