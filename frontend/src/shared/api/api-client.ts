let csrfToken = "";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export function setCsrfToken(token: string) {
  csrfToken = token;
}

export async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  const isForm = init.body instanceof FormData;
  if (init.body && !isForm && !headers.has("content-type")) headers.set("content-type", "application/json");
  if (csrfToken && init.method && !["GET", "HEAD"].includes(init.method.toUpperCase())) headers.set("x-csrf-token", csrfToken);

  const response = await fetch(`/api/backend${path.startsWith("/") ? path : `/${path}`}`, {
    ...init,
    headers,
    credentials: "same-origin",
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
}

export function apiMessage(error: unknown) {
  return error instanceof ApiError ? error.message : error instanceof Error ? error.message : "The server request failed.";
}

export async function apiDownload(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  if (csrfToken && init.method && !["GET", "HEAD"].includes(init.method.toUpperCase())) headers.set("x-csrf-token", csrfToken);
  const response = await fetch(`/api/backend${path.startsWith("/") ? path : `/${path}`}`, {
    ...init,
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
}
