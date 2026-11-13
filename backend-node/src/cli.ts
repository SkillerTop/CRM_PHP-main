import { hash } from "argon2";
import { readdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import { db, now, rows } from "./core.js";
import { validateEnvironment } from "./config.js";
import { migrate, resolveMigration } from "./migrations.js";
import { runReminders } from "./reminder-runner.js";
import { storedPath, uploadRoot } from "./storage.js";

async function cleanup(): Promise<number> {
  await db.query(
    "DELETE FROM user_sessions WHERE COALESCE(revoked_at,expires_at)<UTC_TIMESTAMP(6)-INTERVAL 90 DAY",
  );
  await db.query(
    "DELETE FROM password_tokens WHERE expires_at<UTC_TIMESTAMP(6)-INTERVAL 7 DAY OR used_at<UTC_TIMESTAMP(6)-INTERVAL 7 DAY",
  );
  await db.query(
    "DELETE FROM auth_attempts WHERE updated_at<UTC_TIMESTAMP(6)-INTERVAL 30 DAY",
  );
  let count = 0;
  for (const table of ["task_attachments", "contact_attachments"]) {
    for (const row of await rows(
      `SELECT id,stored_path FROM ${table} WHERE deleted_at IS NOT NULL`,
    )) {
      await unlink(storedPath(String(row.stored_path))).catch((error) => {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      });
      const [result] = await db.execute(
        `DELETE FROM ${table} WHERE id=? AND deleted_at IS NOT NULL`,
        [row.id],
      );
      if ("affectedRows" in result) count += result.affectedRows;
    }
  }
  const trash = join(uploadRoot(), ".trash");
  for (const name of await readdir(trash).catch(() => []))
    if (name.endsWith(".deleted")) await unlink(join(trash, name));
  return count;
}
async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  await validateEnvironment();
  if (command === "config:check") {
    console.log("Backend environment is valid.");
    return;
  }
  if (command === "migrate") {
    const applied = await migrate();
    console.log(
      applied.length
        ? `Applied: ${applied.join(", ")}`
        : "No pending migrations.",
    );
    return;
  }
  if (command === "migrate:resolve") {
    await resolveMigration(args[0] ?? "", Number(args[1] ?? 0), args[2] ?? "");
    console.log("Migration step resolved; run migrate again.");
    return;
  }
  if (command === "create-admin") {
    const name = process.env.ADMIN_NAME ?? "CRM Administrator",
      email = (process.env.ADMIN_EMAIL ?? "").toLowerCase().trim(),
      password = process.env.ADMIN_PASSWORD ?? "";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || [...password].length < 8)
      throw new Error(
        "Set ADMIN_EMAIL and ADMIN_PASSWORD (at least 8 characters) in .env.",
      );
    const timestamp = now();
    await db.execute(
      `INSERT INTO users
      (full_name,email,password_hash,role,is_active,pending_approval,must_change_password,created_at,updated_at)
      VALUES (?,?,?,'admin',1,0,1,?,?) ON DUPLICATE KEY UPDATE full_name=VALUES(full_name),
      password_hash=VALUES(password_hash),role='admin',is_active=1,pending_approval=0,
      must_change_password=1,updated_at=VALUES(updated_at)`,
      [name, email, await hash(password, { type: 2 }), timestamp, timestamp],
    );
    console.log(
      `Admin account is ready for ${email}; password change is required after login.`,
    );
    return;
  }
  if (command === "reminders:run") {
    const result = await runReminders();
    console.log(JSON.stringify(result));
    if (result.failed) process.exitCode = 2;
    return;
  }
  if (command === "cleanup") {
    const count = await cleanup();
    console.log(
      `Expired transient data removed; purged attachments: ${count}. ChangeEvent records were not touched.`,
    );
    return;
  }
  console.log(
    `Client Data CRM console\n\nCommands:\n  config:check\n  migrate\n  migrate:resolve <migration.sql> <step> applied|retry\n  create-admin\n  reminders:run\n  cleanup`,
  );
}
main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.end();
  });
