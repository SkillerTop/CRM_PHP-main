/**
 * Read a filter from a query string while falling back for missing or invalid values.
 *
 * @param {string} search
 * @param {string} name
 * @param {string} fallback
 * @param {readonly string[] | undefined} allowed
 */
export function readUrlFilter(search, name, fallback, allowed) {
  const value = new URLSearchParams(search).get(name);
  if (value === null || value === "") return fallback;
  return allowed && !allowed.includes(value) ? fallback : value;
}

/**
 * Return a same-origin path with one filter updated. Default values are omitted.
 *
 * @param {string} href
 * @param {string} name
 * @param {string} value
 * @param {string} fallback
 */
export function urlWithFilter(href, name, value, fallback) {
  const url = new URL(href, "http://localhost");
  if (value === fallback || value === "") url.searchParams.delete(name);
  else url.searchParams.set(name, value);
  return `${url.pathname}${url.search}${url.hash}`;
}
