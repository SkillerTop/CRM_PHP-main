// "Chrome · Windows" from a raw User-Agent header. Order matters: Edge and Opera also say "Chrome",
// Chrome also says "Safari", and iOS/Android also say "Mac OS X"/"Linux".
const BROWSERS: [RegExp, string][] = [[/Edg\//, "Edge"], [/OPR\//, "Opera"], [/Firefox\//, "Firefox"], [/Chrome\//, "Chrome"], [/Safari\//, "Safari"]];
const SYSTEMS: [RegExp, string][] = [[/iPhone|iPad/, "iOS"], [/Android/, "Android"], [/Windows/, "Windows"], [/Mac OS X/, "macOS"], [/Linux/, "Linux"]];

export function describeUserAgent(userAgent: string | null | undefined) {
  if (!userAgent) return "Unknown device";
  const browser = BROWSERS.find(([pattern]) => pattern.test(userAgent))?.[1];
  const system = SYSTEMS.find(([pattern]) => pattern.test(userAgent))?.[1];
  return [browser, system].filter(Boolean).join(" · ") || "Other device";
}
