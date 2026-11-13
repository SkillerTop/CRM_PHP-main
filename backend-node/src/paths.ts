import { existsSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const backendRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../backend",
);

export function localPath(path: string): string {
  return isAbsolute(path) ? path : resolve(backendRoot, path);
}

export function pythonPath(value: string): string {
  if (!value.includes("/") && !value.includes("\\")) return value;
  const path = localPath(value);
  return existsSync(path) && statSync(path).isDirectory()
    ? join(
        path,
        process.platform === "win32" ? "Scripts/python.exe" : "bin/python",
      )
    : path;
}

export function modelPath(value: string): string {
  return value.startsWith(".") || existsSync(localPath(value))
    ? localPath(value)
    : value;
}
