import createClient, { type Client, type Middleware } from "openapi-fetch";
import type { paths } from "./schema";

/**
 * Same-origin base URL for every request. In dev the Vite server proxies `/api` → the rest app;
 * in prod the SPA is served from the rest jar's `static/` (bundled) or by a reverse proxy that
 * forwards `/api` (PLAN-rule-editor §4.2) — the browser sees ONE origin either way, so the
 * session cookie and the CSRF token need no cross-site handling.
 */
function resolveBaseUrl(): string {
  return typeof window !== "undefined" && window.location?.origin
    ? window.location.origin
    : "http://localhost";
}

/** Methods that carry a CSRF token (everything Spring Security treats as mutating). */
const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

let csrfInfo: Promise<{ headerName: string; token: string }> | null = null;

/**
 * Drop the cached CSRF token. The rest app rotates it with the session, so the SPA re-fetches
 * it after login and after logout (rest README § Session and CSRF).
 */
export function resetCsrf(): void {
  csrfInfo = null;
}

async function fetchCsrf(): Promise<{ headerName: string; token: string }> {
  const { data, response } = await getClient().GET("/api/session/csrf");
  if (!data?.token || !data.headerName) {
    throw new Error(`CSRF token unavailable (${response.status})`);
  }
  return { headerName: data.headerName, token: data.token };
}

/**
 * Attaches the session's CSRF token to every mutating request, the login included — the server
 * refuses a mutating request without it (`403 CSRF`). The token is fetched lazily and cached
 * until {@link resetCsrf}; a failed fetch is not cached, so the next request retries.
 */
const csrfMiddleware: Middleware = {
  async onRequest({ request }) {
    if (!MUTATING.has(request.method)) return request;
    csrfInfo ??= fetchCsrf().catch((e: unknown) => {
      csrfInfo = null;
      throw e;
    });
    const { headerName, token } = await csrfInfo;
    request.headers.set(headerName, token);
    return request;
  },
};

let client: Client<paths> | undefined;

function getClient(): Client<paths> {
  if (!client) {
    client = createClient<paths>({ baseUrl: resolveBaseUrl() });
    client.use(csrfMiddleware);
  }
  return client;
}

/** The shared type-safe API client (lazy proxy over the real openapi-fetch client). */
export const api: Client<paths> = new Proxy({} as Client<paths>, {
  get(_target, prop: keyof Client<paths>) {
    return getClient()[prop];
  },
});

/**
 * A normalised API error. The rest app reports failures as RFC 9457 problems with a stable
 * `code` (rest README § The API); extra properties (`paths`, `branch`, `head`, …) ride along in
 * `extra` so a dialog can name the files or the current head.
 */
export interface ProblemError {
  status: number;
  code: string;
  detail: string;
  extra: Record<string, unknown>;
}

interface ProblemBody {
  status?: number;
  detail?: string;
  title?: string;
  code?: string;
  [key: string]: unknown;
}

const KNOWN = new Set(["type", "title", "status", "detail", "instance", "code"]);

/** Map an openapi-fetch error payload + Response into a {@link ProblemError}. */
export function toProblem(error: unknown, response: Response): ProblemError {
  const body = (typeof error === "object" && error !== null ? error : {}) as ProblemBody;
  const status = typeof body.status === "number" ? body.status : response.status;
  const detail = body.detail || body.title || response.statusText || `Request failed (${status})`;
  const code = typeof body.code === "string" ? body.code : `HTTP_${status}`;
  const extra: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) if (!KNOWN.has(k)) extra[k] = v;
  return { status, code, detail, extra };
}

/** A discriminated result: either the typed `data`, or a normalised `problem`. */
export type ApiResult<T> =
  { data: T; problem?: undefined } | { data?: undefined; problem: ProblemError };

/**
 * Run an openapi-fetch call and fold its `{ data, error, response }` into an {@link ApiResult}.
 * A thrown fetch error (network down, CSRF fetch failed) becomes a `NETWORK` problem so no
 * caller needs a try/catch.
 */
export async function call<T>(
  request: Promise<{ data?: T; error?: unknown; response: Response }>,
): Promise<ApiResult<T>> {
  try {
    const { data, error, response } = await request;
    if (!response.ok) return { problem: toProblem(error, response) };
    return { data: data as T };
  } catch (e) {
    return {
      problem: {
        status: 0,
        code: "NETWORK",
        detail: e instanceof Error ? e.message : String(e),
        extra: {},
      },
    };
  }
}
