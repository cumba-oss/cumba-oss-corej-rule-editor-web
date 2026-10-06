import { api, call, resetCsrf, type ApiResult } from "./client";
import type {
  AnalysedT,
  BranchesT,
  CdtTextT,
  CodelistLookupT,
  CommittedT,
  DatasetT,
  DiscardedT,
  DirectoryT,
  ExplorerTreeT,
  FileContentT,
  FunctionsT,
  ParsedT,
  PushedT,
  RelatedT,
  RunResultT,
  ScenariosT,
  SearchT,
  ServiceInfoT,
  SessionInfoT,
  StatusT,
  UpdatedT,
  WrittenT,
} from "./types";

/**
 * The optimistic-concurrency stamp every mutating request carries (rest README § Server-side
 * rules): the branch and HEAD the client believes it is on. A mismatch is `409 STALE`.
 */
export interface Expect {
  branch: string;
  head: string;
}

// ---- session ----------------------------------------------------------------------------

export function info(): Promise<ApiResult<ServiceInfoT>> {
  return call(api.GET("/api/info"));
}

export function session(): Promise<ApiResult<SessionInfoT>> {
  return call(api.GET("/api/session"));
}

/**
 * Logs in. The server changes the session id at login; whether the CSRF token survives that
 * change is the server's business, so the client never relies on either — it drops its cached
 * token and re-reads it with the next mutating request.
 */
export async function login(loginName: string, token: string): Promise<ApiResult<SessionInfoT>> {
  const result = await call(api.POST("/api/session/login", { body: { login: loginName, token } }));
  resetCsrf();
  return result;
}

export async function logout(): Promise<ApiResult<undefined>> {
  const result = await call(api.POST("/api/session/logout"));
  resetCsrf();
  return result;
}

// ---- workspace --------------------------------------------------------------------------

export function status(): Promise<ApiResult<StatusT>> {
  return call(api.GET("/api/status"));
}

export function branches(fetch = false): Promise<ApiResult<BranchesT>> {
  return call(api.GET("/api/branches", { params: { query: { fetch } } }));
}

export function createBranch(name: string, expect: Expect): Promise<ApiResult<BranchesT>> {
  return call(api.POST("/api/branches", { body: { name, ...expect } }));
}

export function switchBranch(name: string, expect: Expect): Promise<ApiResult<BranchesT>> {
  return call(api.POST("/api/branches/switch", { body: { name, ...expect } }));
}

export function deleteBranch(name: string): Promise<ApiResult<BranchesT>> {
  return call(api.POST("/api/branches/delete", { body: { name } }));
}

export function updateFromDefault(expect: Expect): Promise<ApiResult<UpdatedT>> {
  return call(api.POST("/api/branches/update-from-default", { body: expect }));
}

export function updateFromRemote(expect: Expect): Promise<ApiResult<UpdatedT>> {
  return call(api.POST("/api/branches/update-from-remote", { body: expect }));
}

export function commit(message: string, expect: Expect): Promise<ApiResult<CommittedT>> {
  return call(api.POST("/api/commit", { body: { message, ...expect } }));
}

/**
 * Discards every saved, uncommitted change under the editable trees: tracked files go back to
 * HEAD, new ones are deleted. `paths` are the files the user confirmed losing; when they are no
 * longer the workspace's uncommitted files the server answers `409 STALE` with the current
 * `paths`, and nothing is discarded.
 */
export function discard(paths: string[], expect: Expect): Promise<ApiResult<DiscardedT>> {
  return call(api.POST("/api/discard", { body: { paths, ...expect } }));
}

export function push(expect: Expect): Promise<ApiResult<PushedT>> {
  return call(api.POST("/api/push", { body: expect }));
}

// ---- files ------------------------------------------------------------------------------

export function listDirectory(path: string): Promise<ApiResult<DirectoryT>> {
  return call(api.GET("/api/files", { params: { query: { path } } }));
}

export function readFile(path: string): Promise<ApiResult<FileContentT>> {
  return call(api.GET("/api/files/content", { params: { query: { path } } }));
}

/** Writes a file; `blob` is the id of the content being replaced, `null` when creating. */
export function writeFile(
  path: string,
  content: string,
  blob: string | null,
  expect: Expect,
): Promise<ApiResult<WrittenT>> {
  return call(
    api.PUT("/api/files/content", {
      body: { path, content, blob: blob ?? undefined, ...expect },
    }),
  );
}

// ---- corpus -----------------------------------------------------------------------------

export function explorer(): Promise<ApiResult<ExplorerTreeT>> {
  return call(api.GET("/api/explorer"));
}

/** The semantic filters of the search dialog (§5.3); every one is optional. */
export interface SearchFilters {
  variable?: string;
  scope?: string;
  function?: string;
  status?: string;
  standard?: string;
  version?: string;
  noScenarios?: boolean;
}

export function search(
  q: string,
  filters: SearchFilters = {},
  limit = 100,
): Promise<ApiResult<SearchT>> {
  const query: Record<string, string | number | boolean> = { q, limit };
  for (const [k, v] of Object.entries(filters)) {
    if (v !== undefined && v !== "" && v !== false) query[k] = v;
  }
  return call(api.GET("/api/search", { params: { query } }));
}

// ---- the engine (phase 3) ---------------------------------------------------------------

/** Analyses a rule buffer (and the docs buffer when the client holds a dirty one): §5.4. */
export function analyse(
  path: string,
  content: string,
  docs?: string,
): Promise<ApiResult<AnalysedT>> {
  return call(api.POST("/api/analyse", { body: { path, content, docs } }));
}

export function functions(): Promise<ApiResult<FunctionsT>> {
  return call(api.GET("/api/engine/functions"));
}

/** The branch's `rule-check.schema.json`; `404 NO_SCHEMA` when the branch carries none. */
export function schema(): Promise<ApiResult<Record<string, unknown>>> {
  return call(api.GET("/api/engine/schema")) as Promise<ApiResult<Record<string, unknown>>>;
}

export function codelist(codelistId: string, term?: string): Promise<ApiResult<CodelistLookupT>> {
  return call(api.GET("/api/engine/ct", { params: { query: { codelist: codelistId, term } } }));
}

export function scenarios(rule: string): Promise<ApiResult<ScenariosT>> {
  return call(api.GET("/api/scenarios", { params: { query: { rule } } }));
}

export function related(rule: string): Promise<ApiResult<RelatedT>> {
  return call(api.GET("/api/related", { params: { query: { rule } } }));
}

export function cdtParse(content: string): Promise<ApiResult<ParsedT>> {
  return call(api.POST("/api/cdt/parse", { body: { content } }));
}

/** Rewrites one dataset block of the text from the grid; `400 CDT_UNREPRESENTABLE` is a refusal. */
export function cdtSplice(content: string, dataset: DatasetT): Promise<ApiResult<CdtTextT>> {
  return call(api.POST("/api/cdt/splice", { body: { content, dataset } }));
}

/** Replaces the `#expectViolation*` lines — called only after the user confirmed the diff. */
export function cdtExpectations(content: string, lines: string[]): Promise<ApiResult<CdtTextT>> {
  return call(api.POST("/api/cdt/expectations", { body: { content, lines } }));
}

/** Runs the rule buffer against the scenario buffer (O8): one rule, one scenario. */
export function run(
  path: string,
  content: string,
  scenarioPath: string,
  scenarioContent: string,
  docs?: string,
): Promise<ApiResult<RunResultT>> {
  return call(
    api.POST("/api/run", { body: { path, content, docs, scenarioPath, scenarioContent } }),
  );
}
