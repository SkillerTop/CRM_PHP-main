import { load, type CheerioAPI } from "cheerio";
import { decode } from "html-entities";
import { ApiError } from "./core.js";
import { safeGet } from "./safe-http.js";

const PAGE_MAX = 2 * 1024 * 1024;
const LOGO_MAX = 1024 * 1024;
const TYPES = new Set([
  "organization",
  "corporation",
  "localbusiness",
  "professionalservice",
  "store",
  "ngo",
  "educationalorganization",
  "governmentorganization",
]);
const text = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const cleaned = decode(value.replace(/<[^>]*>/g, ""))
    .replace(/\s+/gu, " ")
    .trim();
  return cleaned || null;
};
function organization(
  node: unknown,
  depth = 0,
): Record<string, unknown> | null {
  if (depth > 6 || !node || typeof node !== "object") return null;
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = organization(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  const record = node as Record<string, unknown>;
  const nodeTypes = (
    Array.isArray(record["@type"]) ? record["@type"] : [record["@type"]]
  ).map((x) => String(x).toLowerCase());
  if (nodeTypes.some((type) => TYPES.has(type))) return record;
  for (const value of Object.values(record)) {
    const found = organization(value, depth + 1);
    if (found) return found;
  }
  return null;
}
function structured(page: CheerioAPI): Record<string, unknown> {
  let found: Record<string, unknown> | null = null;
  page('script[type="application/ld+json"]').each((_, element) => {
    try {
      found ??= organization(JSON.parse(page(element).text()));
    } catch {
      /* malformed data on public sites */
    }
  });
  return found ?? {};
}
function postal(value: unknown): [string | null, string | null, string | null] {
  const entry = Array.isArray(value) ? value[0] : value;
  if (typeof entry === "string") return [text(entry), null, null];
  if (!entry || typeof entry !== "object") return [null, null, null];
  const record = entry as Record<string, unknown>;
  const country = text(
    typeof record.addressCountry === "object" && record.addressCountry
      ? (record.addressCountry as Record<string, unknown>).name
      : record.addressCountry,
  );
  const city = text(record.addressLocality);
  const components = [
    text(record.streetAddress),
    `${text(record.postalCode) ?? ""} ${city ?? ""}`.trim(),
    text(record.addressRegion),
    country,
  ].filter(Boolean);
  return [components.length ? components.join(", ") : null, city, country];
}
function markupAddress(page: CheerioAPI): string | null {
  for (const selector of [
    '[itemprop="address"]',
    "address",
    'footer [class*="address"]',
  ]) {
    let result: string | null = null;
    page(selector).each((_, node) => {
      const candidate = text(
        page(node)
          .text()
          .replace(/\s*\n\s*/gu, ", "),
      );
      if (
        !result &&
        candidate &&
        candidate.length <= 200 &&
        /\d/.test(candidate) &&
        !/@|https?:/i.test(candidate)
      )
        result = candidate;
    });
    if (result) return result;
  }
  return null;
}
function textAddress(
  page: CheerioAPI,
  city: string | null,
): [string | null, string | null] {
  page("script,style,svg,noscript,head").remove();
  page("br,p,div,li,h1,h2,h3,td,tr,span,a,address,strong,b").each((_, node) => {
    page(node).append("\n");
  });
  const lines = page("body")
    .text()
    .split("\n")
    .map((x) => text(x))
    .filter((x): x is string => !!x);
  const postal = /(?:\d{4}\s?[A-Z]{2}|\d{2}-\d{3}|\d{3}\s\d{2}|\d{5}|\d{4})/u;
  const streetLike = (line: string) =>
    line.length <= 80 &&
    /\p{L}{3,}\.?\s+\d{1,4}\p{L}?\b/u.test(line) &&
    !/@|https?:|\+\d|©/u.test(line);
  let best: [string | null, string | null] = [null, city];
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!;
    const match = postal.exec(line);
    if (
      !match ||
      line.length > 120 ||
      /@|https?:|©|\+\d|\(\d/u.test(line) ||
      (line.match(/\d/g)?.length ?? 0) > 12
    )
      continue;
    const previous = lines[index - 1] ?? "";
    const address = streetLike(line)
      ? line
      : streetLike(previous)
        ? `${previous.replace(/[ ,]+$/, "")}, ${line}`
        : "";
    if (!address) continue;
    const after =
      line
        .slice(match.index + match[0].length)
        .replace(/^[,\s]+/, "")
        .split(",")[0]
        ?.trim() ?? "";
    const candidate: [string | null, string | null] = [
      address,
      city ?? (/^\p{L}[\p{L}\s'-]{1,40}$/u.test(after) ? after : null),
    ];
    if (
      /(?:main|head|registered)\s+office|headquarters|\bhq\b|address|adres|adresse|anschrift|siedziba|biuro|адрес|адреса|офіс|офис|kontor/i.test(
        lines.slice(Math.max(0, index - 2), index).join(" "),
      )
    )
      return candidate;
    if (!best[0]) best = candidate;
  }
  return best;
}
function logoType(bytes: Buffer): string | null {
  const start = bytes.subarray(0, 16).toString("hex");
  if (start.startsWith("89504e470d0a1a0a")) return "image/png";
  if (start.startsWith("ffd8ff")) return "image/jpeg";
  if (
    bytes.subarray(0, 4).toString() === "RIFF" &&
    bytes.subarray(8, 12).toString() === "WEBP"
  )
    return "image/webp";
  if (bytes.subarray(0, 3).toString() === "GIF") return "image/gif";
  if (start.startsWith("00000100")) return "image/x-icon";
  if (
    /^\s*(?:<\?xml[^>]*>\s*)?(?:<!--.*?-->\s*)*<svg[\s>]/is.test(
      bytes.subarray(0, 4096).toString(),
    )
  )
    return "image/svg+xml";
  return null;
}
function imageDimensions(bytes: Buffer, type: string): [number, number] | null {
  if (type === "image/png" && bytes.length >= 24)
    return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
  if (type === "image/gif" && bytes.length >= 10)
    return [bytes.readUInt16LE(6), bytes.readUInt16LE(8)];
  if (type === "image/x-icon" && bytes.length >= 8)
    return [bytes[6] || 256, bytes[7] || 256];
  if (
    type === "image/webp" &&
    bytes.length >= 30 &&
    bytes.toString("ascii", 12, 16) === "VP8X"
  )
    return [1 + bytes.readUIntLE(24, 3), 1 + bytes.readUIntLE(27, 3)];
  if (
    type === "image/webp" &&
    bytes.length >= 30 &&
    bytes.toString("ascii", 12, 16) === "VP8 "
  )
    return [bytes.readUInt16LE(26) & 0x3fff, bytes.readUInt16LE(28) & 0x3fff];
  if (
    type === "image/webp" &&
    bytes.length >= 25 &&
    bytes.toString("ascii", 12, 16) === "VP8L"
  ) {
    const bits = bytes.readUInt32LE(21);
    return [(bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1];
  }
  if (type === "image/jpeg") {
    let offset = 2;
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) return null;
      const marker = bytes[offset + 1]!;
      if (
        [
          0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd,
          0xce, 0xcf,
        ].includes(marker)
      )
        return [bytes.readUInt16BE(offset + 7), bytes.readUInt16BE(offset + 5)];
      const length = bytes.readUInt16BE(offset + 2);
      if (length < 2) return null;
      offset += 2 + length;
    }
  }
  return null;
}
async function logo(
  page: CheerioAPI,
  base: string,
  structuredLogo: unknown,
  deadline: number,
  requestTimeout: number,
  getter: typeof safeGet,
): Promise<string | null> {
  const candidates: Array<{ url: string; score: number }> = [];
  const add = (url: unknown, score: number) => {
    if (
      typeof url === "string" &&
      url.trim() &&
      !url.startsWith("data:") &&
      !/white|negative|inverse|invert|[-_]light\b|[-_]wit\b/i.test(url)
    )
      candidates.push({ url, score });
  };
  add(
    typeof structuredLogo === "object" && structuredLogo
      ? ((structuredLogo as Record<string, unknown>).url ??
          (structuredLogo as Record<string, unknown>).contentUrl)
      : structuredLogo,
    1000,
  );
  page("header img, nav img, img").each((_, node) => {
    const image = page(node);
    if (
      /logo/i.test(
        `${image.attr("src")} ${image.attr("alt")} ${image.attr("class")} ${image.attr("id")}`,
      )
    )
      add(image.attr("src") ?? image.attr("data-src"), 500);
  });
  page('link[rel*="icon"]').each((_, node) => {
    const icon = page(node);
    const size = Number(
      /(\d+)x\d+/.exec(icon.attr("sizes") ?? "")?.[1] ??
        (icon.attr("rel")?.includes("apple") ? 180 : 32),
    );
    add(icon.attr("href"), size);
  });
  add("/favicon.ico", 0);
  candidates.sort((a, b) => b.score - a.score);
  const seen = new Set<string>();
  let attempts = 0;
  for (const candidate of candidates) {
    if (attempts >= 4 || Date.now() >= deadline) break;
    let url: string;
    try {
      url = new URL(candidate.url, base).href;
    } catch {
      continue;
    }
    if (seen.has(url)) continue;
    seen.add(url);
    attempts++;
    try {
      const response = await getter(
        url,
        LOGO_MAX,
        ["image/", "application/octet-stream"],
        Math.min(requestTimeout, Math.max(1000, deadline - Date.now())),
      );
      const type = logoType(response.body);
      const dimensions = type ? imageDimensions(response.body, type) : null;
      if (
        type &&
        (type === "image/svg+xml" ||
          (dimensions && Math.max(...dimensions) >= 32))
      )
        return `data:${type};base64,${response.body.toString("base64")}`;
    } catch {
      /* try another logo candidate */
    }
  }
  return null;
}
export async function lookupCompanyWebsite(
  input: string,
  getter: typeof safeGet = safeGet,
) {
  const website = input.trim();
  if (!website || website.length > 255)
    throw new ApiError(
      422,
      "lookup_invalid_url",
      "Укажите адрес сайта в формате example.com.",
    );
  let initial: URL;
  try {
    initial = new URL(
      /^https?:\/\//i.test(website) ? website : `https://${website}`,
    );
  } catch {
    throw new ApiError(
      422,
      "lookup_invalid_url",
      "Укажите адрес сайта в формате example.com.",
    );
  }
  const host = initial.hostname.toLowerCase();
  if (!host.includes("."))
    throw new ApiError(
      422,
      "lookup_invalid_url",
      "Укажите адрес сайта в формате example.com.",
    );
  const deadline =
    Date.now() +
    Number(process.env.COMPANY_LOOKUP_TIMEOUT_SECONDS ?? 20) * 1000;
  const requestTimeout =
    Number(process.env.COMPANY_LOOKUP_REQUEST_TIMEOUT_SECONDS ?? 8) * 1000;
  let home: Awaited<ReturnType<typeof safeGet>> | null = null;
  let lastError: unknown;
  const attempts = [
    ...new Set([
      `https://${host}/`,
      `https://${host.startsWith("www.") ? host : `www.${host}`}/`,
      `http://${host}/`,
    ]),
  ];
  for (const url of attempts) {
    if (Date.now() >= deadline) break;
    try {
      home = await getter(
        url,
        PAGE_MAX,
        ["text/html", "application/xhtml+xml"],
        Math.min(requestTimeout, deadline - Date.now()),
      );
      break;
    } catch (error) {
      if (
        error instanceof ApiError &&
        ["lookup_blocked_address", "lookup_invalid_url"].includes(error.code)
      )
        throw error;
      lastError = error;
    }
  }
  if (!home)
    throw (
      lastError ??
      new ApiError(504, "lookup_timeout", "Сайт не ответил вовремя.")
    );
  const page = load(home.body.toString("utf8"));
  const record = structured(page);
  const meta = (name: string) =>
    text(
      page(`meta[name="${name}"],meta[property="${name}"]`)
        .first()
        .attr("content"),
    );
  const name =
    text(record.name) ??
    meta("og:site_name") ??
    text(page("title").first().text())?.split(/\s+[|–—-]\s+/u)[0] ??
    null;
  const description =
    text(record.description) ?? meta("description") ?? meta("og:description");
  let [address, city, country] = postal(record.address);
  address ??= markupAddress(page);
  if (!address)
    [address, city] = textAddress(load(home.body.toString("utf8")), city);
  if (!address && Date.now() < deadline) {
    const originalHost = new URL(home.url).hostname.replace(/^www\./, "");
    const links = page("a[href]").toArray();
    for (const link of links) {
      const href = page(link).attr("href") ?? "";
      if (
        !/(?:contact|kontakt|impressum|imprint|about|om-oss|o-nas|контакт|про-нас|where|address|location)/iu.test(
          `${href} ${page(link).text()}`,
        )
      )
        continue;
      let target: URL;
      try {
        target = new URL(href, home.url);
      } catch {
        continue;
      }
      if (target.hostname.replace(/^www\./, "") !== originalHost) continue;
      try {
        const contact = await getter(
          target.href,
          PAGE_MAX,
          ["text/html", "application/xhtml+xml"],
          Math.min(requestTimeout, Math.max(1000, deadline - Date.now())),
        );
        const contactPage = load(contact.body.toString("utf8"));
        const values = postal(structured(contactPage).address);
        address = values[0] ?? markupAddress(contactPage);
        city = values[1] ?? city;
        country = values[2] ?? country;
        if (!address) [address, city] = textAddress(contactPage, city);
      } catch {
        /* optional contact page */
      }
      break;
    }
  }
  const logoData =
    Date.now() < deadline
      ? await logo(
          page,
          home.url,
          record.logo,
          deadline,
          requestTimeout,
          getter,
        )
      : null;
  if (!description && !address && !logoData)
    throw new ApiError(
      422,
      "lookup_no_data",
      "На сайте не найдено описание, адрес или логотип компании.",
    );
  const finalUrl = new URL(home.url);
  return {
    website: `${finalUrl.protocol}//${finalUrl.hostname}`.toLowerCase(),
    name,
    description: description?.slice(0, 600) ?? null,
    address,
    city,
    country,
    logo_data_url: logoData,
  };
}
