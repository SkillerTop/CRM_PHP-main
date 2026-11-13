import { existsSync } from "node:fs";
import type { IncomingMessage } from "node:http";
import { ApiError } from "./core.js";
import { runEngine, withUploadedFile } from "./ai-runtime.js";
import { localPath, pythonPath } from "./paths.js";

type Line = { text: string; type: string; label?: string };
const EMAIL = /[\p{L}\p{N}._%+\-]+@[\p{L}\p{N}.\-]+\.\p{L}{2,}/gu;
const LINKEDIN =
  /(?:https?:\/\/)?(?:[a-z]{2,3}\.)?(?:www\.)?linkedin\.com\/[^\s,;]+/giu;
const URL =
  /(?:https?:\/\/)?(?:www\.)?[a-z0-9][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*)*\.[a-z]{2,24}(?:\/[^\s,;]*)?/giu;
const PHONE =
  /(?<label>(?:fax|факс|f|ф|mob(?:ile)?|cell|gsm|моб|m|м|office|off|direct|dir|work|tlf|telefon|tel|phone|тел|t|т|p)\s*[.:]{0,2}\s*)?(?<number>\+?\s?\(?\d[\d\s().\-/]{6,}\d)/giu;
const REGISTRY =
  /\b(?:nip|regon|krs|vat|edrpou|єдрпоу|едрпоу|іпн|инн|кпп|огрн|iban|swift|bic|kvk|ust-?idnr|tax\s?id|reg\.?\s?no)\b/iu;
const LEGAL =
  /(?:\b(?:sp\.?\s?z\.?\s?[o0]\.?\s?[o0]\.?|s\.?a\.?|s\.?r\.?l\.?|l\.?l\.?c\.?|ltd\.?|limited|inc\.?|corp\.?|gmbh|ag|b\.?v\.?|plc|kft|s\.?r\.?o\.?|d\.?o\.?o\.?|тзов|тов|прат|пат|ооо|оао|зао|пао|фоп)\b|\b(?:AS|ASA|A\/S|ApS|AB|Oy|Oyj|OÜ|UAB|SIA|SL|SpA)\b)/iu;
const COMPANY =
  /(?:group|holding|company|corporation|systems|solutions|technolog|industries|industrial|shipping|shipyard|logistics|consulting|services|partners|enterprises|agency|bureau|laborator|компані|компани|груп|холдинг|завод|верф|підприємств|предприят)/iu;
const POSITION =
  /(?:director|manager|founder|president|partner(?!s)|sales|marketing|engineer(?!ing)|specjalista|kierownik|dyrektor|prezes|inżynier|handlow|daglig leder|direktør|ingeniør|konsulent|rådgiver|prosjektleder|gerente|ingeniero|geschäftsführer|leiter|vertrieb|consultant|architect|officer|specialist|coordinator|analyst|advis[eo]r|assistant|representative|superintendent|captain|broker|developer|designer|accountant|lawyer|attorney|secretary|chairman|executive|procurement|purchasing|surveyor|inspector|operations|commercial|business development|account|керівник|директор|менеджер|спеціаліст|інженер|инженер|руководител|специалист|начальник|заступник|заместител|голова|председател|засновник|основател|власник|владел|консультант|бухгалтер|юрист|капітан|капитан|представник|представител|координатор|аналітик|аналитик|\b(?:ceo|cto|cfo|coo|cio|cmo|vp|head|lead|owner|board|chief|agent|buyer|master|vice)\b)/iu;
const ADDRESS =
  /(?:\b(?:ul|al|pl|str|ave|blvd|rd|вул|ул|пр|просп|пров|бул|буд|оф)\.|\b(?:street|strasse|straße|avenue|road|ulica|aleja|вулиця|улица|проспект|провулок|переулок|бульвар|площа|площадь|office|suite|floor|building|room|p\.?o\.?\s?box)\b|\b\d{2}-\d{3}\b|\b\d{5}\b|\p{L}{3,}\.?\s\d{1,4}\p{L}?)/iu;
const COUNTRY = [
  "ukraine",
  "україна",
  "украина",
  "poland",
  "polska",
  "польща",
  "польша",
  "germany",
  "deutschland",
  "netherlands",
  "nederland",
  "belgium",
  "france",
  "italy",
  "spain",
  "portugal",
  "norway",
  "norge",
  "sweden",
  "sverige",
  "finland",
  "suomi",
  "denmark",
  "danmark",
  "estonia",
  "latvia",
  "lithuania",
  "romania",
  "turkey",
  "united kingdom",
  "england",
  "usa",
  "united states",
  "canada",
  "china",
  "japan",
  "singapore",
  "india",
  "uae",
];
const CITY = [
  "kyiv",
  "kiev",
  "київ",
  "киев",
  "lviv",
  "львів",
  "odesa",
  "odessa",
  "одеса",
  "kharkiv",
  "харків",
  "dnipro",
  "дніпро",
  "warsaw",
  "warszawa",
  "gdansk",
  "gdynia",
  "szczecin",
  "krakow",
  "wroclaw",
  "poznan",
  "berlin",
  "hamburg",
  "bremen",
  "rotterdam",
  "amsterdam",
  "antwerp",
  "london",
  "paris",
  "oslo",
  "bergen",
  "stockholm",
  "copenhagen",
  "helsinki",
  "tallinn",
  "riga",
  "vilnius",
  "prague",
  "vienna",
  "istanbul",
  "athens",
  "dubai",
  "shanghai",
];
const FREE_MAIL = new Set([
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "icloud.com",
  "me.com",
  "ukr.net",
  "i.ua",
  "meta.ua",
  "bigmir.net",
  "mail.ru",
  "yandex.ru",
  "yandex.ua",
  "proton.me",
  "protonmail.com",
  "gmx.com",
  "gmx.de",
  "web.de",
  "wp.pl",
  "o2.pl",
  "onet.pl",
  "interia.pl",
]);
const fold = (value: string) =>
  value
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Mn}/gu, "")
    .replace(/[łøßđ]/gu, (c) => ({ ł: "l", ø: "o", ß: "ss", đ: "d" })[c] ?? c);
function first(lines: Line[], type: string): string {
  return lines.find((line) => line.type === type)?.text ?? "";
}
function isWebsite(value: string): boolean {
  return (
    /^(?:https?:\/\/|www\.)/i.test(value) ||
    /\.(?:com|net|org|info|biz|io|co|eu|ua|pl|de|nl|be|fr|it|es|pt|no|se|fi|dk|ee|lv|lt|cz|sk|hu|ro|md|bg|gr|tr|cy|mt|hr|si|at|ch|uk|ie|us|ca|cn|jp|kr|sg|in|ae|ge|az|kz|il|eg|online|site|tech|group|global|agency|marine|shipping)$/i.test(
      value.split("/")[0]!,
    )
  );
}
function looksLikeName(value: string): boolean {
  const words = value.split(/\s+/u);
  return (
    words.length >= 2 &&
    words.length <= 4 &&
    words.some((word) => [...word.matchAll(/\p{L}/gu)].length >= 2) &&
    words.every(
      (word) =>
        /^[\p{L}'’.\-]+$/u.test(word) &&
        (/^\p{Lu}/u.test(word) ||
          /^(?:van|von|der|den|de|da|di|du|la|le|del|dos|das|ter|ten|bin|al)$/iu.test(
            word,
          )),
    )
  );
}
function classify(value: string): string {
  const lower = fold(value);
  const countries = COUNTRY.filter((country) => lower.includes(fold(country)));
  if (countries.length >= 2) return "offices";
  if (ADDRESS.test(value)) return "address";
  if (
    [...COUNTRY, ...CITY].some(
      (place) =>
        lower === fold(place) ||
        (lower.endsWith(` ${fold(place)}`) && value.split(/\s+/).length <= 6),
    )
  )
    return "location";
  if (LEGAL.test(value)) return "company";
  if (POSITION.test(value)) return "position";
  if (COMPANY.test(value)) return "company";
  if (looksLikeName(value)) return "name";
  return "other";
}
function extract(
  text: string,
  pattern: RegExp,
  kind: string,
  entries: Line[],
  accept: (value: string) => boolean = () => true,
): string {
  return text.replace(pattern, (match) => {
    const value = match.replace(/^[\s,;|]+|[\s,;|]+$/g, "");
    if (accept(value)) {
      entries.push({ text: value, type: kind });
      return " ";
    }
    return match;
  });
}
function nameParts(name: string, email: string): [string, string] {
  const words = name
    .replace(
      /\b(?:dr|mr|mrs|ms|prof|eng|ing|mba|m\.?sc|ph\.?d|mgr|inż|inz)\.?(?=\s|$)/giu,
      "",
    )
    .trim()
    .split(/\s+/u)
    .map((word) =>
      word === word.toUpperCase()
        ? word.toLowerCase().replace(/^\p{L}/u, (c) => c.toUpperCase())
        : word,
    );
  if (
    words.length === 3 &&
    /(?:ович|евич|івна|ївна|овна|евна|ична)$/iu.test(words[2]!)
  )
    return [words[1]!, words[0]!];
  if (
    words.length === 3 &&
    /(?:ович|евич|івна|ївна|овна|евна|ична)$/iu.test(words[1]!)
  )
    return [words[0]!, words[2]!];
  let given = words.length === 4 ? 2 : 1;
  const local =
    email
      .split("@")[0]
      ?.toLowerCase()
      .split(/[._+\-\d]+/)
      .filter(Boolean) ?? [];
  if (words.length >= 3 && local[0])
    for (let count = words.length - 1; count >= 2; count--) {
      const initials = words
        .slice(0, count)
        .map((word) => fold(word)[0])
        .join("");
      if (
        local[0] === initials ||
        local[0] === words.slice(0, count).map(fold).join("")
      ) {
        given = count;
        break;
      }
    }
  return [words.slice(0, given).join(" "), words.slice(given).join(" ")];
}
export function classifyBusinessCard(text: string) {
  const entries: Line[] = [];
  for (const line of text
    .split(/\r\n|\r|\n/u)
    .map((x) => x.replace(/\s+/gu, " ").trim())
    .filter(Boolean)) {
    if (REGISTRY.test(line)) {
      entries.push({ text: line, type: "registry" });
      continue;
    }
    let rest = extract(line, EMAIL, "email", entries);
    rest = extract(rest, LINKEDIN, "linkedin", entries);
    rest = extract(rest, URL, "website", entries, isWebsite);
    rest = rest.replace(
      PHONE,
      (
        match,
        _label,
        _number,
        _offset,
        _input,
        groups: { label?: string; number?: string },
      ) => {
        const number = groups?.number?.trim() ?? "";
        const digits = number.replace(/\D/g, "");
        if (
          digits.length < 9 ||
          digits.length > 15 ||
          (number.includes("/") && !/^[+0]/.test(number))
        )
          return match;
        entries.push({
          text: number,
          type: "phone",
          label: (groups?.label ?? "").trim().toLowerCase(),
        });
        return " ";
      },
    );
    rest = rest
      .replace(
        /\b(?:tel|phone|mob|mobile|cell|gsm|fax|office|direct|work|e-?mail|web|website|site|тел|моб|факс)\s*[.:]/giu,
        " ",
      )
      .replace(
        /^\s*(?:address|addr|adresse|adres|adresa|адреса|адрес)\s*[.:]\s*/iu,
        "",
      )
      .replace(/^[\s,;|•·:\-–—/]+|[\s,;|•·:\-–—/]+$/gu, "")
      .trim();
    if ([...rest.matchAll(/\p{L}/gu)].length >= 2)
      entries.push({ text: rest, type: classify(rest) });
  }
  const merged = new Set<number>();
  for (let index = 0; index < entries.length; index++) {
    if (entries[index]?.type !== "position" || merged.has(index)) continue;
    let added = 0;
    for (let next = index + 1; next < entries.length && added < 2; next++) {
      const candidate = entries[next]!;
      if (["email", "phone", "website", "linkedin"].includes(candidate.type))
        continue;
      if (
        candidate.type === "position" ||
        (["other", "name"].includes(candidate.type) &&
          /[\/&,]\s*\p{L}*$/u.test(entries[index]!.text))
      ) {
        entries[index]!.text += ` ${candidate.text}`;
        merged.add(next);
        added++;
      } else break;
    }
  }
  for (const index of [...merged].sort((a, b) => b - a))
    entries.splice(index, 1);
  const email = first(entries, "email");
  const website = first(entries, "website");
  const emailDomain = email.split("@")[1]?.toLowerCase();
  const domain =
    emailDomain && !FREE_MAIL.has(emailDomain)
      ? emailDomain
      : website
        ? website.replace(/^(?:https?:\/\/)?(?:www\.)?/i, "").split("/")[0]
        : null;
  const stem =
    domain?.split(".")[
      Math.max(
        0,
        domain.split(".").length -
          (/\.(?:com|co|org|net|gov|in)\.[a-z]{2}$/i.test(domain) ? 3 : 2),
      )
    ];
  const nameCandidates = entries
    .map((entry, index) => ({ entry, index }))
    .filter((x) => x.entry.type === "name");
  const local = fold(email.split("@")[0] ?? "");
  nameCandidates.sort((a, b) => {
    const score = (x: typeof a) =>
      x.entry.text
        .split(/\s+/)
        .reduce(
          (total, word) =>
            total +
            (fold(word).length >= 3 && local.includes(fold(word)) ? 5 : 0),
          0,
        ) +
      (entries[x.index - 1]?.type === "position" ||
      entries[x.index + 1]?.type === "position"
        ? 1
        : 0);
    return score(b) - score(a) || a.index - b.index;
  });
  const chosen = nameCandidates[0]?.index;
  if (
    chosen === undefined ||
    (!email &&
      !first(entries, "phone") &&
      !entries.some((e) => e.type === "position"))
  )
    nameCandidates.forEach((x) => {
      entries[x.index]!.type = "other";
    });
  else
    nameCandidates
      .filter((x) => x.index !== chosen)
      .forEach((x) => {
        entries[x.index]!.type = "other";
      });
  const companies = entries
    .map((entry, index) => ({
      entry,
      index,
      score:
        (LEGAL.test(entry.text) ? 4 : 0) +
        (stem &&
        fold(entry.text)
          .replace(/[^\p{L}\p{N}]/gu, "")
          .includes(fold(stem))
          ? 3
          : 0) +
        (COMPANY.test(entry.text) ? 2 : 0),
    }))
    .filter((x) => ["company", "other"].includes(x.entry.type) && x.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index);
  if (!companies.length) {
    const fallback = entries.findIndex(
      (e) => e.type === "other" && e.text.length >= 3,
    );
    if (fallback >= 0)
      companies.push({ entry: entries[fallback]!, index: fallback, score: 0 });
  }
  const companyCandidates = companies.map((x) =>
    x.entry.text.replace(/^[,;\s]+|[,;\s]+$/g, ""),
  );
  companies.forEach((x) => {
    entries[x.index]!.type = "company";
  });
  const chosenName =
    chosen !== undefined && entries[chosen]?.type === "name"
      ? entries[chosen]!.text
      : "";
  const [firstName, lastName] = chosenName
    ? nameParts(chosenName, email)
    : ["", ""];
  const phones = entries.filter((e) => e.type === "phone");
  const usable = phones.filter(
    (e) => !/^(?:fax|факс|f|ф)/u.test(e.label ?? ""),
  );
  const selected = (usable.length ? usable : phones).sort(
    (a, b) =>
      Number(/^(?:mob|cell|gsm|моб|m|м)/u.test(b.label ?? "")) -
      Number(/^(?:mob|cell|gsm|моб|m|м)/u.test(a.label ?? "")),
  );
  const seen = new Set<string>();
  const numbers: string[] = [];
  for (const phone of selected) {
    const digits = phone.text.replace(/\D/g, "");
    if (
      !seen.has(digits) &&
      [...numbers, phone.text].join("; ").length <= 100
    ) {
      seen.add(digits);
      numbers.push(phone.text);
    }
  }
  const draft = Object.fromEntries(
    Object.entries({
      first_name: firstName,
      last_name: lastName,
      position: first(entries, "position").replace(/\s*\/\s*/g, " / "),
      phone: numbers.join("; "),
      email,
      linkedin: first(entries, "linkedin"),
      website,
      company: companyCandidates[0] ?? "",
      address: entries
        .filter((e) => ["address", "location"].includes(e.type))
        .map((e) => e.text)
        .join(", "),
    }).filter(([, value]) => value),
  );
  return {
    draft,
    lines: entries.map(({ text, type }) => ({ text, type })),
    company_candidates: companyCandidates,
    company_domain: domain,
  };
}
export async function recognizeFile(path: string) {
  const buffer = await (await import("node:fs/promises")).readFile(path);
  const prefix = buffer.subarray(0, 12).toString("hex");
  const valid =
    prefix.startsWith("ffd8ff") ||
    prefix.startsWith("89504e470d0a1a0a") ||
    prefix.startsWith("424d") ||
    (buffer.subarray(0, 4).toString() === "RIFF" &&
      buffer.subarray(8, 12).toString() === "WEBP") ||
    prefix.startsWith("49492a00") ||
    prefix.startsWith("4d4d002a");
  if (!valid)
    throw new ApiError(
      415,
      "unsupported_file_type",
      "Загрузите изображение визитки: JPG, PNG, WebP, BMP или TIFF.",
    );
  const script = localPath(
    process.env.OCR_SCRIPT ?? "ai/qwen_vl_business_card.py",
  );
  if (!existsSync(script))
    throw new ApiError(
      503,
      "ocr_engine_not_configured",
      "Скрипт OCR (Qwen3-VL) не найден по указанному пути.",
    );
  const model = process.env.OCR_VLM_MODEL ?? "qwen3-vl:4b-instruct";
  const timeout = Number(process.env.OCR_TIMEOUT_SECONDS ?? 180);
  const result = await runEngine(
    [
      pythonPath(process.env.OCR_PYTHON_BIN ?? "python3"),
      script,
      "--input",
      path,
      "--url",
      process.env.OCR_VLM_URL ?? "http://127.0.0.1:11434",
      "--model",
      model,
      "--timeout",
      String(Math.max(5, timeout - 10)),
    ],
    timeout,
  );
  if (result.exitCode !== 0)
    throw new ApiError(
      503,
      "ocr_engine_failed",
      `Qwen3-VL не смог обработать визитку: проверьте, что сервис Ollama запущен и модель ${model} загружена.`,
    );
  let payload: { text?: unknown; average_confidence?: unknown };
  try {
    payload = JSON.parse(result.stdout);
  } catch {
    throw new ApiError(
      503,
      "ocr_engine_failed",
      "Qwen3-VL вернул некорректный ответ.",
    );
  }
  const text = String(payload.text ?? "")
    .replace(/\r\n|\r/g, "\n")
    .split("\n")
    .map((x) => x.trim())
    .filter(Boolean)
    .join("\n");
  if (!text)
    throw new ApiError(
      422,
      "ocr_no_text",
      "На изображении не удалось распознать текст.",
    );
  const classified = classifyBusinessCard(text);
  const confidence =
    ["first_name", "email", "phone", "company"].filter(
      (field) => classified.draft[field],
    ).length + Number(text.length > 40);
  return {
    raw_text: text,
    ...classified,
    confidence: confidence >= 4 ? "high" : confidence >= 2 ? "medium" : "low",
    ocr_confidence:
      Number.isFinite(Number(payload.average_confidence)) &&
      payload.average_confidence !== null
        ? Math.max(0, Math.min(1, Number(payload.average_confidence)))
        : null,
    engine: `Qwen3-VL (${model})`,
  };
}
export async function recognizeBusinessCard(req: IncomingMessage) {
  return withUploadedFile(req, "ocr", recognizeFile);
}
