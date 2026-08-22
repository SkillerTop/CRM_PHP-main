import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

function normalizedCloudflareIp(value: string | null): string | null {
  const candidate = value?.trim() ?? "";
  if (!candidate || candidate.length > 45 || candidate.includes(",")) return null;
  if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(candidate)) {
    const octets = candidate.split(".").map(Number);
    return octets.every((octet) => octet >= 0 && octet <= 255) ? candidate : null;
  }
  if (!candidate.includes(":") || !/^[0-9a-f:]+$/i.test(candidate)) return null;
  try {
    const parsed = new URL(`http://[${candidate}]/`).hostname;
    return parsed.startsWith("[") && parsed.endsWith("]") ? parsed.slice(1, -1) : null;
  } catch {
    return null;
  }
}

async function proxy(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const backend = process.env.CRM_BACKEND_URL?.replace(/\/$/, "");
  const proxySecret = process.env.CRM_PROXY_SHARED_SECRET;
  if (!backend || !proxySecret || proxySecret.length < 32) {
    return Response.json(
      { error: { code: "backend_not_configured", message: "Backend proxy configuration is incomplete." } },
      { status: 503 },
    );
  }

  const { path } = await context.params;
  const target = new URL(`${backend}/api/${path.map(encodeURIComponent).join("/")}`);
  target.search = request.nextUrl.search;

  const headers = new Headers();
  for (const name of ["accept", "content-type", "cookie", "x-csrf-token", "user-agent"]) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  headers.set("x-forwarded-host", request.headers.get("host") ?? request.nextUrl.host);
  headers.set("x-forwarded-proto", request.nextUrl.protocol.replace(":", ""));
  const clientIp = normalizedCloudflareIp(request.headers.get("cf-connecting-ip"));
  if (clientIp) headers.set("x-forwarded-for", clientIp);
  headers.set("x-crm-proxy-secret", proxySecret);

  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method: request.method,
      headers,
      body: ["GET", "HEAD"].includes(request.method) ? undefined : await request.arrayBuffer(),
      redirect: "manual",
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    return Response.json(
      {
        error: {
          code: "backend_unavailable",
          message: "Сервер CRM временно недоступен. Проверьте запуск backend.",
        },
      },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }

  const responseHeaders = new Headers();
  for (const name of ["content-type", "content-disposition", "cache-control", "set-cookie"]) {
    const value = upstream.headers.get(name);
    if (value) responseHeaders.set(name, value);
  }
  responseHeaders.set("cache-control", "no-store");
  return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
