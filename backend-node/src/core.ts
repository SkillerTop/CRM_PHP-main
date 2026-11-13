import { createHash, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createPool, type Pool, type RowDataPacket } from "mysql2/promise";

export type Row = RowDataPacket & Record<string, unknown>;
export const db: Pool = createPool({
  host: process.env.DB_HOST ?? "127.0.0.1",
  port: Number(process.env.DB_PORT ?? 3306),
  database: process.env.DB_DATABASE ?? "crm_client_data",
  user: process.env.DB_USERNAME ?? "root",
  password: process.env.DB_PASSWORD ?? "",
  waitForConnections: true,
  connectionLimit: Number(process.env.DB_POOL_SIZE ?? 10),
  timezone: "Z",
  dateStrings: true,
  decimalNumbers: true,
  charset: "utf8mb4",
});

export async function rows<T extends Row = Row>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const [result] = await db.execute<T[]>(
    sql,
    params as Array<string | number | boolean | null>,
  );
  return result;
}

export async function first<T extends Row = Row>(
  sql: string,
  params: unknown[] = [],
): Promise<T | undefined> {
  return (await rows<T>(sql, params))[0];
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details: unknown = null,
  ) {
    super(message);
  }
}

export function reply(res: ServerResponse, data: unknown, status = 200): void {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(JSON.stringify(data));
}

export function utc(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  const raw = String(value);
  const mysql = /^(\d{4}-\d\d-\d\d)[ T](\d\d:\d\d:\d\d)(?:\.(\d{1,6}))?$/.exec(
    raw,
  );
  if (mysql)
    return `${mysql[1]}T${mysql[2]}.${(mysql[3] ?? "").padEnd(6, "0")}Z`;
  const parsed = new Date(
    raw.replace(" ", "T") +
      (/[Z+-]\d\d:?\d\d$/.test(raw) || raw.endsWith("Z") ? "" : "Z"),
  );
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().replace(/\.(\d{3})Z$/, ".$1000Z");
}

export function now(): string {
  return new Date()
    .toISOString()
    .replace("T", " ")
    .replace("Z", "000")
    .slice(0, 26);
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function equal(a: string, b: string): boolean {
  const left = Buffer.from(a),
    right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function clientIp(req: IncomingMessage): string {
  const remote = req.socket.remoteAddress ?? "0.0.0.0";
  const trusted = (process.env.TRUSTED_PROXIES ?? "")
    .split(",")
    .map((x) => x.trim());
  const providedSecret = String(req.headers["x-crm-proxy-secret"] ?? "");
  const secret = process.env.PROXY_SHARED_SECRET ?? "";
  if (secret && providedSecret && equal(secret, providedSecret)) {
    const forwarded = String(req.headers["x-forwarded-for"] ?? "").trim();
    return isIP(forwarded) ? forwarded : isIP(remote) ? remote : "0.0.0.0";
  }
  if (!trusted.includes(remote)) return isIP(remote) ? remote : "0.0.0.0";
  const chain = String(req.headers["x-forwarded-for"] ?? "")
    .split(",")
    .map((x) => x.trim());
  for (const address of chain.reverse())
    if (isIP(address) && !trusted.includes(address)) return address;
  return isIP(remote) ? remote : "0.0.0.0";
}

export async function body(
  req: IncomingMessage,
): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 64_000_000)
      throw new ApiError(413, "body_too_large", "Слишком большой запрос.");
    chunks.push(buffer);
  }
  if (!chunks.length) return {};
  try {
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      throw new Error("Expected object");
    return parsed as Record<string, unknown>;
  } catch {
    throw new ApiError(
      400,
      "invalid_json",
      "Тело запроса содержит некорректный JSON.",
    );
  }
}
