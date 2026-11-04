let csrfToken = "";
const REQUEST_TIMEOUT_MS = 30_000;
const DOWNLOAD_TIMEOUT_MS = 120_000;

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(
    status: number,
    code: string,
    message: string,
    details?: unknown,
  ) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function setCsrfToken(token: string) {
  csrfToken = token;
}

async function withTimeout<T>(operation: (signal: AbortSignal) => Promise<T>, timeoutMs: number, callerSignal?: AbortSignal | null): Promise<T> {
  const controller = new AbortController();
  let timedOut = false;
  const forwardAbort = () => controller.abort(callerSignal?.reason);
  if (callerSignal?.aborted) forwardAbort();
  else callerSignal?.addEventListener("abort", forwardAbort, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  try {
    return await operation(controller.signal);
  } catch (error) {
    if (timedOut) throw new ApiError(408, "request_timeout", "The server took too long to respond. Check whether the change was saved before trying again.");
    throw error;
  } finally {
    clearTimeout(timer);
    callerSignal?.removeEventListener("abort", forwardAbort);
  }
}

export async function apiRequest<T>(path: string, init: RequestInit = {}, baseUrl = "", timeoutMs = REQUEST_TIMEOUT_MS): Promise<T> {
  const headers = new Headers(init.headers);
  const isForm = init.body instanceof FormData;
  if (init.body && !isForm && !headers.has("content-type")) headers.set("content-type", "application/json");
  if (csrfToken && init.method && !["GET", "HEAD"].includes(init.method.toUpperCase())) headers.set("x-csrf-token", csrfToken);

  const normalizedBaseUrl = baseUrl.replace(/\/+$/, "");
  return withTimeout(async (signal) => {
    const response = await fetch(`${normalizedBaseUrl}/api${path.startsWith("/") ? path : `/${path}`}`, {
      ...init,
      signal,
      headers,
      credentials: normalizedBaseUrl === "" ? "same-origin" : "include",
      cache: "no-store",
    });
    if (response.status === 204) return undefined as T;
    const contentType = response.headers.get("content-type") ?? "";
    const isJson = contentType.includes("application/json");
    const payload = isJson ? await response.json() : await response.text();
    if (!isJson) {
      throw new ApiError(
        response.ok ? 502 : response.status,
        "invalid_server_response",
        "The CRM server returned an invalid response. Check that the backend is running correctly.",
      );
    }
    if (!response.ok) {
      const error = typeof payload === "object" && payload && "error" in payload ? (payload as { error: { code?: string; message?: string; details?: unknown } }).error : undefined;
      throw new ApiError(response.status, error?.code ?? "request_failed", error?.message ?? `Request failed (${response.status}).`, error?.details);
    }
    return payload as T;
  }, timeoutMs, init.signal);
}

export async function loadAllPages<T>(path: string, sort: string, dir: "asc" | "desc", includeArchived = false): Promise<T[]> {
  const separator = path.includes("?") ? "&" : "?";
  const pageUrl = (page: number) => `${path}${separator}page=${page}&sort=${sort}&dir=${dir}${includeArchived ? "&include_archived=1" : ""}`;
  const fetchPage = (page: number) => apiRequest<{ data: T[]; meta: { pages: number } }>(pageUrl(page));
  const first = await fetchPage(1);
  const records = [...first.data];
  const pages = first.meta.pages;
  const concurrency = 4;
  for (let next = 2; next <= pages; next += concurrency) {
    const batch = Array.from({ length: Math.min(concurrency, pages - next + 1) }, (_, index) => next + index);
    const responses = await Promise.all(batch.map(fetchPage));
    for (const response of responses) records.push(...response.data);
  }
  return records;
}

export function apiMessage(error: unknown) {
  return error instanceof ApiError ? error.message : error instanceof Error ? error.message : "The server request failed.";
}

export async function apiDownload(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  if (csrfToken && init.method && !["GET", "HEAD"].includes(init.method.toUpperCase())) headers.set("x-csrf-token", csrfToken);
  return withTimeout(async (signal) => {
    const response = await fetch(`/api${path.startsWith("/") ? path : `/${path}`}`, {
      ...init,
      signal,
      headers,
      credentials: "same-origin",
      cache: "no-store",
    });
    if (!response.ok) {
      const contentType = response.headers.get("content-type") ?? "";
      if (contentType.includes("application/json")) {
        const payload = await response.json() as { error?: { code?: string; message?: string; details?: unknown } };
        throw new ApiError(response.status, payload.error?.code ?? "request_failed", payload.error?.message ?? `Request failed (${response.status}).`, payload.error?.details);
      }
      throw new ApiError(response.status, "request_failed", `Request failed (${response.status}).`);
    }
    return { blob: await response.blob(), disposition: response.headers.get("content-disposition") ?? "" };
  }, DOWNLOAD_TIMEOUT_MS, init.signal);
}
