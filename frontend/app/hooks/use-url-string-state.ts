"use client";

import { useEffect, useState } from "react";
import { readUrlFilter, urlWithFilter } from "../url-filters.mjs";

/** Keeps a string filter in sync with the browser URL and back/forward history. */
export function useUrlStringState<T extends string = string>(
  name: string,
  fallback: string,
  allowed?: readonly string[],
) {
  const [value, setValue] = useState<T>(() => readUrlFilter(
    typeof window === "undefined" ? "" : window.location.search,
    name,
    fallback,
    allowed,
  ) as T);

  useEffect(() => {
    const restoreFromUrl = () => setValue(readUrlFilter(window.location.search, name, fallback, allowed) as T);
    window.addEventListener("popstate", restoreFromUrl);
    return () => window.removeEventListener("popstate", restoreFromUrl);
  }, [allowed, fallback, name]);

  useEffect(() => {
    const nextUrl = urlWithFilter(window.location.href, name, value, fallback);
    const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (nextUrl !== currentUrl) window.history.replaceState(window.history.state, "", nextUrl);
  }, [fallback, name, value]);

  return [value, setValue] as const;
}
