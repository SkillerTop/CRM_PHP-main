import { ApiError } from "./core.js";

const formats = new Set(["image/jpeg", "image/png", "image/webp"]);
export function decodeImage(dataUrl: string): {
  mime: string;
  content: Buffer;
} {
  const match =
    /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!match)
    throw new ApiError(404, "image_not_found", "Изображение не найдено.");
  const content = Buffer.from(match[2] ?? "", "base64");
  if (!content.length)
    throw new ApiError(404, "image_not_found", "Изображение не найдено.");
  return { mime: match[1]!, content };
}

export function validateImage(
  value: string | null,
  maxBytes: number,
  code: string,
  message: string,
): string | null {
  if (!value) return null;
  const match =
    /^data:(image\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=\r\n]+)$/i.exec(
      value.trim(),
    );
  if (!match || !formats.has(match[1]!.toLowerCase()))
    throw new ApiError(400, code, message);
  const content = Buffer.from(
    (match[2] ?? "").replace(/[\r\n]/g, ""),
    "base64",
  );
  const jpeg = content.subarray(0, 3).toString("hex") === "ffd8ff";
  const png = content.subarray(0, 8).toString("hex") === "89504e470d0a1a0a";
  const webp =
    content.subarray(0, 4).toString() === "RIFF" &&
    content.subarray(8, 12).toString() === "WEBP";
  const detected = jpeg
    ? "image/jpeg"
    : png
      ? "image/png"
      : webp
        ? "image/webp"
        : null;
  if (
    !content.length ||
    content.length > maxBytes ||
    detected !== match[1]!.toLowerCase()
  )
    throw new ApiError(400, code, message);
  return `data:${detected};base64,${content.toString("base64")}`;
}
