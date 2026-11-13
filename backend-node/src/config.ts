import { stat } from "node:fs/promises";
import { join } from "node:path";
import { backendRoot } from "./paths.js";
import { envBool } from "./env.js";

export async function validateEnvironment(): Promise<void> {
  const errors: string[] = [];
  const env = (process.env.APP_ENV ?? "").toLowerCase().trim();
  if (!["production", "development", "test"].includes(env))
    errors.push("APP_ENV must be production, development, or test.");
  const production = env === "production";
  let url: URL | null = null;
  try {
    url = new URL(process.env.APP_URL ?? "");
  } catch {
    errors.push("APP_URL must be an absolute URL.");
  }
  if (production && url?.protocol !== "https:")
    errors.push("APP_URL must use HTTPS in production.");
  if (production && envBool("APP_DEBUG"))
    errors.push("APP_DEBUG must be false in production.");
  const zone = process.env.APP_TIMEZONE ?? "Europe/Kyiv";
  try {
    new Intl.DateTimeFormat("en", { timeZone: zone });
  } catch {
    errors.push("APP_TIMEZONE must be a valid IANA timezone identifier.");
  }
  if (production && process.platform !== "win32") {
    const file = await stat(join(backendRoot, ".env")).catch(() => null);
    if (file && file.mode & 0o077)
      errors.push(
        "backend/.env must not be accessible by group or other users (use chmod 600).",
      );
  }
  for (const key of ["DB_HOST", "DB_DATABASE", "DB_USERNAME"])
    if (!process.env[key]?.trim()) errors.push(`${key} is required.`);
  if (production && !process.env.DB_PASSWORD?.trim())
    errors.push("DB_PASSWORD is required in production.");
  if (production && process.env.DB_USERNAME?.toLowerCase() === "root")
    errors.push("DB_USERNAME must not be root in production.");
  const sameSite = (process.env.SESSION_SAMESITE ?? "lax").toLowerCase();
  if (!["lax", "strict", "none"].includes(sameSite))
    errors.push("SESSION_SAMESITE must be Lax, Strict, or None.");
  if ((production || sameSite === "none") && !envBool("SESSION_SECURE", true))
    errors.push(
      "SESSION_SECURE must be true in production and with SameSite=None.",
    );
  const mail = (process.env.MAIL_TRANSPORT ?? "").toLowerCase();
  if (!["smtp", "mail", "log"].includes(mail))
    errors.push("MAIL_TRANSPORT must be smtp, mail, or log.");
  if (production && mail === "log")
    errors.push("MAIL_TRANSPORT=log is forbidden in production.");
  if (mail === "smtp") {
    if (!process.env.SMTP_HOST?.trim())
      errors.push("SMTP_HOST is required for smtp transport.");
    if (
      !["tls", "ssl"].includes(
        (process.env.SMTP_ENCRYPTION ?? "tls").toLowerCase(),
      )
    )
      errors.push("SMTP_ENCRYPTION must be tls or ssl.");
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(process.env.MAIL_FROM_ADDRESS ?? ""))
    errors.push("MAIL_FROM_ADDRESS must be a valid email address.");
  if (production && (process.env.PROXY_SHARED_SECRET ?? "").length < 32)
    errors.push(
      "PROXY_SHARED_SECRET must contain at least 32 bytes in production.",
    );
  for (const key of ["DB_PASSWORD", "SMTP_PASSWORD", "PROXY_SHARED_SECRET"])
    if (
      production &&
      ["change-me", "changeme", "replace-me", "password"].includes(
        (process.env[key] ?? "").toLowerCase().trim(),
      )
    )
      errors.push(`${key} still contains a placeholder value.`);
  const ranges: Array<[string, number, number, number]> = [
    ["DB_PORT", 1, 65535, 3306],
    ["SESSION_IDLE_HOURS", 1, 168, 12],
    ["LOGIN_MAX_ATTEMPTS", 1, 100, 5],
    ["LOGIN_WINDOW_MINUTES", 1, 1440, 15],
    ["LOGIN_BLOCK_MINUTES", 1, 1440, 15],
    ["OCR_MAX_REQUESTS_PER_HOUR", 1, 1000, 20],
    ["WHISPER_MAX_REQUESTS_PER_HOUR", 1, 1000, 10],
    ["UPLOAD_MAX_REQUESTS_PER_HOUR", 1, 10000, 100],
    ["UPLOAD_MAX_BYTES", 1024, 104857600, 20971520],
    ["UPLOAD_STORAGE_MAX_BYTES", 1048576, Number.MAX_SAFE_INTEGER, 10737418240],
    ["OCR_MAX_FILE_MB", 1, 100, 20],
    ["WHISPER_MAX_FILE_MB", 1, 500, 25],
    ["OCR_TIMEOUT_SECONDS", 1, 300, 180],
    ["WHISPER_TIMEOUT_SECONDS", 1, 900, 180],
    ["WHISPER_BEAM_SIZE", 1, 10, 5],
    ["AI_MAX_TIMEOUT_SECONDS", 1, 900, 900],
    ["AI_MAX_OUTPUT_BYTES", 1024, 10485760, 1048576],
    ["TRANSLATION_TIMEOUT_SECONDS", 5, 60, 20],
    ["TRANSLATION_MAX_REQUESTS_PER_HOUR", 1, 1000, 120],
    ["COMPANY_LOOKUP_MAX_REQUESTS_PER_HOUR", 1, 1000, 60],
    ["COMPANY_LOOKUP_TIMEOUT_SECONDS", 5, 60, 20],
    ["COMPANY_LOOKUP_REQUEST_TIMEOUT_SECONDS", 2, 30, 8],
    ["SMTP_PORT", 1, 65535, 587],
  ];
  for (const [key, min, max, fallback] of ranges) {
    const raw = process.env[key] ?? String(fallback),
      number = Number(raw);
    if (!/^\d+$/.test(raw) || number < min || number > max)
      errors.push(`${key} must be an integer between ${min} and ${max}.`);
  }
  const upload = (process.env.UPLOAD_DIR ?? "storage/uploads").replaceAll(
    "\\",
    "/",
  );
  if (
    !upload ||
    upload.startsWith("/") ||
    /^[A-Za-z]:/.test(upload) ||
    upload.split("/").includes("..")
  )
    errors.push("UPLOAD_DIR must be a relative path inside backend.");
  if (errors.length)
    throw new Error(
      `Invalid backend environment:\n- ${[...new Set(errors)].join("\n- ")}`,
    );
}
