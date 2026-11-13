import { decode } from "html-entities";
import { ApiError } from "./core.js";

function chunks(text: string): string[] {
  if ([...text].length <= 450) return [text];
  const tokens = text.match(/\s+|\S+/gu) ?? [text];
  const result: string[] = [];
  let current = "";
  for (let token of tokens) {
    while ([...token].length > 450) {
      if (current.trim()) {
        result.push(current.trim());
        current = "";
      }
      const chars = [...token];
      result.push(chars.slice(0, 450).join(""));
      token = chars.slice(450).join("");
    }
    if (current && [...current, ...token].length > 450) {
      result.push(current.trim());
      current = token.trimStart();
    } else current += token;
  }
  if (current.trim()) result.push(current.trim());
  return result;
}

async function translateChunk(text: string): Promise<string> {
  const endpoint = (
    process.env.TRANSLATION_ENDPOINT ??
    "https://api.mymemory.translated.net/get"
  ).replace(/\?$/, "");
  const url = new URL(endpoint);
  url.searchParams.set("q", text);
  url.searchParams.set("langpair", "Autodetect|en");
  const timeout =
    Math.max(
      5,
      Math.min(Number(process.env.TRANSLATION_TIMEOUT_SECONDS ?? 20), 60),
    ) * 1000;
  let response: Response;
  try {
    response = await fetch(url, {
      redirect: "manual",
      headers: {
        Accept: "application/json",
        "User-Agent": "ClientDataCRM/1.0",
      },
      signal: AbortSignal.timeout(timeout),
    });
  } catch (error) {
    throw new ApiError(
      502,
      "translation_failed",
      "Не удалось перевести текст. Повторите попытку.",
      { provider_status: 0, provider_error: String(error).slice(0, 160) },
    );
  }
  const length = Number(response.headers.get("content-length") ?? 0);
  if (!response.ok || length > 262144)
    throw new ApiError(
      502,
      "translation_failed",
      "Не удалось перевести текст. Повторите попытку.",
      {
        provider_status: response.status,
        provider_error: length > 262144 ? "response_too_large" : "",
      },
    );
  const reader = response.body?.getReader();
  let size = 0;
  const parts: Uint8Array[] = [];
  if (reader)
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 262144) {
        await reader.cancel();
        throw new ApiError(
          502,
          "translation_failed",
          "Не удалось перевести текст. Повторите попытку.",
          {
            provider_status: response.status,
            provider_error: "response_too_large",
          },
        );
      }
      parts.push(value);
    }
  const payload = JSON.parse(
    Buffer.concat(parts.map((x) => Buffer.from(x))).toString("utf8"),
  ) as { responseData?: { translatedText?: unknown }; responseStatus?: number };
  const translated =
    typeof payload.responseData?.translatedText === "string"
      ? decode(payload.responseData.translatedText).trim()
      : "";
  if (
    !translated ||
    (payload.responseStatus !== undefined &&
      Number(payload.responseStatus) !== 200)
  )
    throw new ApiError(
      502,
      "translation_invalid_response",
      "Сервис перевода вернул некорректный ответ.",
    );
  return translated;
}

export async function toEnglish(input: string): Promise<string> {
  const text = input.trim();
  if (!text)
    throw new ApiError(
      422,
      "translation_text_required",
      "Введите текст для перевода.",
    );
  if ([...text].length > 10000)
    throw new ApiError(
      422,
      "translation_text_too_long",
      "Текст для перевода не должен превышать 10 000 символов.",
    );
  let result = "";
  for (const part of text.split(/(\r\n|\r|\n)+/u)) {
    if (!part) continue;
    if (/^(\r\n|\r|\n)+$/.test(part)) {
      result += part;
      continue;
    }
    const translated: string[] = [];
    for (const chunk of chunks(part.trim()))
      translated.push(await translateChunk(chunk));
    result += translated.join(" ");
  }
  if (!result.trim())
    throw new ApiError(
      502,
      "translation_empty_response",
      "Сервис перевода не вернул текст.",
    );
  return result.trim();
}
