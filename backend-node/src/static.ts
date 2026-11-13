import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { extname, join, resolve, sep } from "node:path";
import { backendRoot } from "./paths.js";

const publicRoot = resolve(backendRoot, "public");
const contentTypes: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".map": "application/json; charset=utf-8",
};
export async function serveStatic(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
): Promise<void> {
  if (!["GET", "HEAD"].includes(req.method ?? "")) {
    res.writeHead(405);
    res.end();
    return;
  }
  if (
    path.includes("\0") ||
    path.includes("\\") ||
    path.split("/").includes("..")
  ) {
    res.writeHead(404);
    res.end();
    return;
  }
  const requested = resolve(publicRoot, `.${path}`);
  if (requested !== publicRoot && !requested.startsWith(publicRoot + sep)) {
    res.writeHead(404);
    res.end();
    return;
  }
  const info = await stat(requested).catch(() => null);
  const target = info?.isFile() ? requested : join(publicRoot, "index.html");
  const file = info?.isFile() ? info : await stat(target).catch(() => null);
  if (!file?.isFile()) {
    res.writeHead(404);
    res.end();
    return;
  }
  res.writeHead(200, {
    "Content-Type":
      contentTypes[extname(target).toLowerCase()] ?? "application/octet-stream",
    "Content-Length": file.size,
    "X-Content-Type-Options": "nosniff",
    "Cache-Control":
      target === requested && /[.-][a-f0-9]{8,}\./i.test(target)
        ? "public, max-age=31536000, immutable"
        : "no-cache",
  });
  if (req.method === "HEAD") res.end();
  else createReadStream(target).pipe(res);
}
