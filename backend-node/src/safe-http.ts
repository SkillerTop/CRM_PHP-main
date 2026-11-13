import { lookup } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import { BlockList, isIP } from "node:net";
import { ApiError } from "./core.js";

const blocked = new BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as Array<[string, number]>)
  blocked.addSubnet(address, prefix, "ipv4");
for (const [address, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["64:ff9b:1::", 48],
  ["100::", 64],
  ["2001:db8::", 32],
  ["2001:10::", 28],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as Array<[string, number]>)
  blocked.addSubnet(address, prefix, "ipv6");

export function isPublicIp(address: string): boolean {
  const family = isIP(address);
  if (!family) return false;
  if (
    family === 6 &&
    (/^(?:0*:){2,}ffff:/i.test(address) ||
      /^::\d+\.\d+\.\d+\.\d+$/i.test(address))
  )
    return false;
  return !blocked.check(address, family === 4 ? "ipv4" : "ipv6");
}

export type SafeResponse = {
  url: string;
  status: number;
  contentType: string;
  body: Buffer;
};
async function publicTarget(url: URL): Promise<string> {
  const host = url.hostname
    .toLowerCase()
    .replace(/\.$/, "")
    .replace(/^\[|\]$/g, "");
  if (
    !["http:", "https:"].includes(url.protocol) ||
    !host ||
    url.username ||
    url.password
  )
    throw new ApiError(
      422,
      "lookup_invalid_url",
      "Укажите адрес сайта в формате example.com.",
    );
  if (url.port && !["80", "443"].includes(url.port))
    throw new ApiError(
      422,
      "lookup_blocked_address",
      "Разрешены только стандартные веб-порты 80 и 443.",
    );
  if (
    host === "localhost" ||
    /\.(?:localhost|local|internal|lan|home|corp|intranet)$/i.test(host)
  )
    throw new ApiError(
      422,
      "lookup_blocked_address",
      "Адрес указывает на внутреннюю сеть.",
    );
  if (
    !isIP(host) &&
    !/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9-]{2,63}$/i.test(
      host,
    )
  )
    throw new ApiError(
      422,
      "lookup_invalid_url",
      "Укажите адрес сайта в формате example.com.",
    );
  let addresses: Array<{ address: string; family: number }>;
  try {
    addresses = isIP(host)
      ? [{ address: host, family: isIP(host) }]
      : await lookup(host, { all: true });
  } catch {
    throw new ApiError(502, "lookup_unreachable", "Домен сайта не найден.");
  }
  if (!addresses.length)
    throw new ApiError(502, "lookup_unreachable", "Домен сайта не найден.");
  if (addresses.some((x) => !isPublicIp(x.address)))
    throw new ApiError(
      422,
      "lookup_blocked_address",
      "Адрес указывает на внутреннюю сеть.",
    );
  return (
    addresses.find((x) => x.family === 4)?.address ?? addresses[0]!.address
  );
}
async function request(
  url: URL,
  address: string,
  maxBytes: number,
  acceptedTypes: string[],
  timeoutMs: number,
): Promise<SafeResponse & { location: string }> {
  return new Promise((resolve, reject) => {
    const transport = url.protocol === "https:" ? https : http;
    const req = transport.get(
      url,
      {
        agent: false,
        family: isIP(address),
        timeout: timeoutMs,
        lookup: (_hostname, _options, callback) =>
          callback(null, address, isIP(address)),
        headers: {
          "User-Agent":
            "Mozilla/5.0 (compatible; ClientDataCRM company lookup)",
          Accept: acceptedTypes.join(", "),
          "Accept-Language": "en;q=1, *;q=0.5",
        },
      },
      (res) => {
        const status = res.statusCode ?? 0;
        const contentType = String(res.headers["content-type"] ?? "")
          .split(";")[0]!
          .trim()
          .toLowerCase();
        const location = String(res.headers.location ?? "");
        if (![301, 302, 303, 307, 308].includes(status)) {
          if (status < 200 || status >= 300) {
            res.resume();
            reject(
              new ApiError(
                502,
                "lookup_http_error",
                `Сайт ответил с кодом ${status}.`,
              ),
            );
            return;
          }
          if (!acceptedTypes.some((type) => contentType.startsWith(type))) {
            res.resume();
            reject(
              new ApiError(
                502,
                "lookup_unexpected_content",
                "Сайт вернул данные неожиданного типа.",
              ),
            );
            return;
          }
        }
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > maxBytes) {
            req.destroy(
              new ApiError(
                502,
                "lookup_response_too_large",
                "Ответ сайта слишком большой.",
              ),
            );
            return;
          }
          chunks.push(chunk);
        });
        res.on("end", () =>
          resolve({
            url: url.href,
            status,
            contentType,
            location,
            body: Buffer.concat(chunks),
          }),
        );
      },
    );
    req.on("timeout", () =>
      req.destroy(
        new ApiError(504, "lookup_timeout", "Сайт не ответил вовремя."),
      ),
    );
    req.on("error", (error) =>
      reject(
        error instanceof ApiError
          ? error
          : new ApiError(502, "lookup_unreachable", "Сайт недоступен."),
      ),
    );
  });
}
export async function safeGet(
  input: string,
  maxBytes: number,
  acceptedTypes: string[],
  timeoutMs = 8000,
): Promise<SafeResponse> {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new ApiError(
      422,
      "lookup_invalid_url",
      "Укажите адрес сайта в формате example.com.",
    );
  }
  for (let redirects = 0; redirects <= 3; redirects++) {
    const address = await publicTarget(url);
    const result = await request(
      url,
      address,
      maxBytes,
      acceptedTypes,
      timeoutMs,
    );
    if (![301, 302, 303, 307, 308].includes(result.status) || !result.location)
      return result;
    if (redirects === 3)
      throw new ApiError(
        502,
        "lookup_too_many_redirects",
        "Сайт перенаправляет запрос слишком много раз.",
      );
    try {
      url = new URL(result.location, url);
    } catch {
      throw new ApiError(
        422,
        "lookup_invalid_url",
        "Укажите адрес сайта в формате example.com.",
      );
    }
  }
  throw new ApiError(
    502,
    "lookup_too_many_redirects",
    "Сайт перенаправляет запрос слишком много раз.",
  );
}
