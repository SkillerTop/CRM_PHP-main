export function envBool(key: string, fallback = false): boolean {
  const value = process.env[key]?.trim().toLowerCase();
  if (!value) return fallback;
  return ["true", "1", "yes", "on"].includes(value);
}
