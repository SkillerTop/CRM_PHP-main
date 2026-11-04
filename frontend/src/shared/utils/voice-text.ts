export function appendVoiceText(current: string, text: string, maxLength: number) {
  const clean = text.trim();
  if (!clean) return current;
  const combined = current.trim() ? `${current.trim()}\n${clean}` : clean;
  return combined.slice(0, maxLength);
}
