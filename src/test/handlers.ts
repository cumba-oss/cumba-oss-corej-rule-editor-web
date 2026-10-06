import { http, HttpResponse, type HttpHandler } from "msw";
import { FakeEngine } from "./fakeEngine";
import type {
  BranchInfoT,
  ChangedFileT,
  CommitInfoT,
  ExplorerTreeT,
  SessionInfoT,
} from "../api/types";

/**
 * An in-memory stand-in for the rest app (`cumba-corej-rule-editor-rest`), shaped to its OpenAPI
 * snapshot: a session, a working tree of files, branches, uncommitted / unpushed state, the
 * optimistic-concurrency stamp, the CSRF token and the problem codes the SPA reacts to. Tests
 * reset it in `setup.ts` and poke it directly (`fake.mode = "READ_ONLY"`, `fake.sessionOpen =
 * false`, …) to drive a scenario.
 */
export class FakeWorkspace {
  csrfHeader = "X-CSRF-TOKEN";
  csrfToken = "csrf-1";
  /** Whether a session exists (GET /api/session answers 200 or 401). */
  sessionOpen = true;
  mode: SessionInfoT["mode"] = "EDIT";
  user: SessionInfoT = {
    id: 7,
    login: "alice",
    name: "Alice Author",
    email: "alice@example.org",
    mode: "EDIT",
    defaultBranch: "main",
  };
  branch = "feature/x";
  head = "aaaa111";
  defaultBranch = "main";
  files = new Map<string, { content: string; blob: string }>();
  /** The files as HEAD holds them: what a discard restores (set at reset and on commit). */
  headFiles = new Map<string, { content: string; blob: string }>();
  uncommitted: ChangedFileT[] = [];
  unpushedCommits: CommitInfoT[] = [];
  branches: BranchInfoT[] = [];
  /** Problem code to answer the next write/commit/push/switch with, then cleared. */
  nextWriteProblem: { status: number; code: string; extra?: Record<string, unknown> } | null = null;
  nextPushProblem: { status: number; code: string; extra?: Record<string, unknown> } | null = null;
  nextSwitchProblem: { status: number; code: string; extra?: Record<string, unknown> } | null =
    null;
  /** Every mutating request seen, with the CSRF header it carried. */
  mutations: { method: string; path: string; csrf: string | null; body: unknown }[] = [];
  loginAttempts: { login: string; token: string }[] = [];
  /** The next login's verdict. */
  loginAnswer: "ok" | "FORGE_REFUSED" | "FORGE_UNAVAILABLE" = "ok";
  blobSeq = 1;
  /** Every search's query parameters. */
  searches: Record<string, string>[] = [];
  /** The engine half (phase 3): analysis, catalogues, scenarios, grid, runs. */
  engine: FakeEngine = new FakeEngine(this);

  constructor() {
    this.reset();
  }

  reset(): void {
    this.engine.reset();
    this.searches = [];
    this.csrfToken = "csrf-1";
    this.sessionOpen = true;
    this.mode = "EDIT";
    this.user = { ...this.user, mode: "EDIT" };
    this.branch = "feature/x";
    this.head = "aaaa111";
    this.files = new Map([
      [
        "rules-src/checks/CDISC/CDISC-CG0270.yaml",
        { content: 'Core:\n  Id: "CDISC-CG0270"\nDescription: "x"\n', blob: "b270" },
      ],
      [
        "rules-src/docs/CDISC/CDISC-CG0270.yaml",
        { content: 'Core: "CDISC-CG0270"\nCitations: {}\n', blob: "d270" },
      ],
      [
        "rules-src/checks/FDA/FDA-SD1142.yaml",
        { content: 'Core:\n  Id: "FDA-SD1142"\n', blob: "b1142" },
      ],
      [
        "src/test/resources/net/cumba/corej/core/ruletestsuites/cdisc/CDISC-CG0270/CDISC-CG0270-invalid-AE.cdt",
        {
          content: [
            "#!RuleTest",
            "#test CDISC-CG0270 expect=violation domain=AE",
            "#expectViolationCount 1",
            "#expectViolationAt AETERM=HEADACHE",
            "dataset AE",
            'col USUBJID type=Char label="Unique Subject Identifier"',
            'col AETERM type=Char label="Reported Term"',
            "col AESEQ type=Num",
            "---",
            "01-701-1015 | HEADACHE | 1",
            "01-701-1016 | . | 2",
            "---",
            "",
            "dataset DM",
            "col USUBJID type=Char",
            "---",
            "01-701-1015",
            "---",
            "",
          ].join("\n"),
          blob: "s1",
        },
      ],
      [
        "src/test/resources/net/cumba/corej/core/ruletestsuites/cdisc/CDISC-CG0270/CDISC-CG0270-valid-AE.cdt",
        {
          content:
            "#!RuleTest\n#test CDISC-CG0270 expect=noViolation domain=AE\ndataset AE\ncol AETERM type=Char\n---\nx\n---\n",
          blob: "s2",
        },
      ],
      [
        "src/test/resources/net/cumba/corej/core/ruletestsuites/cdisc/CDISC-CG0270/library.json",
        { content: "{}", blob: "s3" },
      ],
    ]);
    this.headFiles = new Map(this.files);
    this.uncommitted = [];
    this.unpushedCommits = [];
    this.branches = [
      { name: "main", kind: "LOCAL", head: "0000main", current: false, isDefault: true },
      {
        name: "feature/x",
        kind: "LOCAL",
        head: "aaaa111",
        current: true,
        isDefault: false,
        unpushed: { unpushed: false, hasTrackingRef: true, aheadCount: 0, behindCount: 0 },
      },
      { name: "feature/other", kind: "REMOTE", head: "cccc333", current: false, isDefault: false },
    ];
    this.nextWriteProblem = null;
    this.nextPushProblem = null;
    this.nextSwitchProblem = null;
    this.mutations = [];
    this.loginAttempts = [];
    this.loginAnswer = "ok";
    this.blobSeq = 1;
  }

  session(): SessionInfoT {
    return { ...this.user, mode: this.mode };
  }

  explorer(): ExplorerTreeT {
    const families = new Map<string, ExplorerTreeT["families"]>();
    const tree: ExplorerTreeT = {
      branch: this.branch,
      head: this.head,
      anonymous: false,
      families: [],
      languageLevel: this.engine.branchLanguageLevel ?? undefined,
    };
    for (const path of [...this.files.keys()].sort()) {
      const m = /^rules-src\/checks\/([^/]+)\/([^/]+)\.yaml$/.exec(path);
      if (!m) continue;
      const [, family, id] = m;
      let fam = tree.families!.find((f) => f.name === family);
      if (!fam) {
        fam = { name: family, rules: [] };
        tree.families!.push(fam);
      }
      const docsPath = `rules-src/docs/${family}/${id}.yaml`;
      const changed = this.uncommitted.find((c) => c.path === path);
      fam.rules!.push({
        id,
        path,
        docsPath: this.files.has(docsPath) ? docsPath : undefined,
        marker: changed ? (changed.kind === "UNTRACKED" ? "NEW" : "MODIFIED") : "CLEAN",
      });
    }
    void families;
    return tree;
  }

  problem(status: number, code: string, detail: string, extra: Record<string, unknown> = {}) {
    return HttpResponse.json(
      { type: "about:blank", title: code, status, detail, code, ...extra },
      { status, headers: { "content-type": "application/problem+json" } },
    );
  }

  /** The stamp check every mutating endpoint performs. */
  stale(body: { branch?: string; head?: string }) {
    if (body.branch !== this.branch || body.head !== this.head) {
      return this.problem(409, "STALE", "the workspace moved on", {
        branch: this.branch,
        head: this.head,
      });
    }
    return null;
  }

  handlers(): HttpHandler[] {
    const record = async (request: Request) => {
      const body =
        request.method === "GET"
          ? null
          : await request
              .clone()
              .json()
              .catch(() => null);
      this.mutations.push({
        method: request.method,
        path: new URL(request.url).pathname,
        csrf: request.headers.get(this.csrfHeader),
        body,
      });
      return body as Record<string, string | undefined> | null;
    };
    const csrfOk = (request: Request) => request.headers.get(this.csrfHeader) === this.csrfToken;
    const authed = () => this.sessionOpen;

    return [
      http.get("/api/info", () =>
        HttpResponse.json({
          service: "corej-rule-editor-rest",
          version: "0.1.0-SNAPSHOT",
          commit: "abc",
          repository: {
            url: "https://git.example.org/cumba/cumba-corej-rules.git",
            owner: "cumba",
            name: "cumba-corej-rules",
            forge: "gitea",
          },
          anonymousRead: false,
          engine: this.engine.info,
        }),
      ),
      http.get("/api/session/csrf", () =>
        HttpResponse.json({
          headerName: this.csrfHeader,
          parameterName: "_csrf",
          token: this.csrfToken,
        }),
      ),
      http.get("/api/session", () =>
        authed()
          ? HttpResponse.json(this.session())
          : this.problem(401, "UNAUTHENTICATED", "log in first"),
      ),
      http.post("/api/session/login", async ({ request }) => {
        const body = (await record(request)) as { login: string; token: string };
        if (!csrfOk(request)) return this.problem(403, "CSRF", "missing or invalid CSRF token");
        this.loginAttempts.push(body);
        if (this.loginAnswer === "FORGE_REFUSED")
          return this.problem(401, "FORGE_REFUSED", "refused");
        if (this.loginAnswer === "FORGE_UNAVAILABLE")
          return this.problem(502, "FORGE_UNAVAILABLE", "down");
        this.sessionOpen = true;
        this.csrfToken = `csrf-${++this.blobSeq}`;
        return HttpResponse.json(this.session());
      }),
      http.post("/api/session/logout", async ({ request }) => {
        await record(request);
        if (!csrfOk(request)) return this.problem(403, "CSRF", "missing or invalid CSRF token");
        this.sessionOpen = false;
        return new HttpResponse(null, { status: 204 });
      }),
      http.get("/api/status", () => {
        if (!authed()) return this.problem(401, "UNAUTHENTICATED", "log in first");
        return HttpResponse.json({
          branch: this.branch,
          head: this.head,
          defaultBranch: this.defaultBranch,
          readOnly: this.mode === "READ_ONLY",
          uncommitted: this.uncommitted,
          ignored: [],
          unpushed: {
            unpushed: this.unpushedCommits.length > 0,
            hasTrackingRef: true,
            aheadCount: this.unpushedCommits.length,
            behindCount: 0,
            commits: this.unpushedCommits,
          },
        });
      }),
      http.get("/api/branches", () => {
        if (!authed()) return this.problem(401, "UNAUTHENTICATED", "log in first");
        return HttpResponse.json(this.branchesBody());
      }),
      http.post("/api/branches", async ({ request }) => {
        const body = (await record(request)) as { name: string; branch: string; head: string };
        if (!csrfOk(request)) return this.problem(403, "CSRF", "missing or invalid CSRF token");
        if (this.mode === "READ_ONLY") return this.problem(403, "READ_ONLY", "read-only session");
        const s = this.stale(body);
        if (s) return s;
        if (this.nextSwitchProblem) {
          const p = this.nextSwitchProblem;
          this.nextSwitchProblem = null;
          return this.problem(p.status, p.code, p.code, p.extra);
        }
        if (this.uncommitted.length > 0) {
          return this.problem(409, "DIRTY_TREE", "uncommitted changes", {
            paths: this.uncommitted.map((c) => c.path),
          });
        }
        this.branches = this.branches.map((b) => ({ ...b, current: false }));
        this.branches.push({
          name: body.name,
          kind: "LOCAL",
          head: "0000main",
          current: true,
          isDefault: false,
        });
        this.branch = body.name;
        this.head = "0000main";
        return HttpResponse.json(this.branchesBody());
      }),
      http.post("/api/branches/switch", async ({ request }) => {
        const body = (await record(request)) as { name: string; branch: string; head: string };
        if (!csrfOk(request)) return this.problem(403, "CSRF", "missing or invalid CSRF token");
        const s = this.stale(body);
        if (s) return s;
        if (this.nextSwitchProblem) {
          const p = this.nextSwitchProblem;
          this.nextSwitchProblem = null;
          return this.problem(p.status, p.code, p.code, p.extra);
        }
        if (this.uncommitted.length > 0) {
          return this.problem(409, "DIRTY_TREE", "uncommitted changes", {
            paths: this.uncommitted.map((c) => c.path),
          });
        }
        const target = this.branches.find((b) => b.name === body.name);
        if (!target) return this.problem(404, "NOT_FOUND", "no such branch");
        this.branches = this.branches.map((b) => ({
          ...b,
          kind: b.name === body.name ? "LOCAL" : b.kind,
          current: b.name === body.name,
        }));
        this.branch = body.name;
        this.head = target.head ?? "0000";
        return HttpResponse.json(this.branchesBody());
      }),
      http.post("/api/branches/delete", async ({ request }) => {
        const body = (await record(request)) as { name: string };
        if (!csrfOk(request)) return this.problem(403, "CSRF", "missing or invalid CSRF token");
        this.branches = this.branches.filter((b) => b.name !== body.name || b.kind !== "LOCAL");
        return HttpResponse.json(this.branchesBody());
      }),
      http.post("/api/branches/update-from-default", async ({ request }) => {
        const body = (await record(request)) as { branch: string; head: string };
        if (!csrfOk(request)) return this.problem(403, "CSRF", "missing or invalid CSRF token");
        const s = this.stale(body);
        if (s) return s;
        return HttpResponse.json({
          merge: { ref: "origin/main", status: "ALREADY_UP_TO_DATE", head: this.head },
          branch: this.branch,
          head: this.head,
        });
      }),
      http.post("/api/branches/update-from-remote", async ({ request }) => {
        const body = (await record(request)) as { branch: string; head: string };
        if (!csrfOk(request)) return this.problem(403, "CSRF", "missing or invalid CSRF token");
        const s = this.stale(body);
        if (s) return s;
        if (this.nextSwitchProblem) {
          const p = this.nextSwitchProblem;
          this.nextSwitchProblem = null;
          return this.problem(p.status, p.code, p.code, p.extra);
        }
        this.head = "merged44";
        return HttpResponse.json({
          merge: { ref: `origin/${this.branch}`, status: "MERGED", head: this.head },
          branch: this.branch,
          head: this.head,
        });
      }),
      http.post("/api/commit", async ({ request }) => {
        const body = (await record(request)) as { message: string; branch: string; head: string };
        if (!csrfOk(request)) return this.problem(403, "CSRF", "missing or invalid CSRF token");
        if (this.mode === "READ_ONLY") return this.problem(403, "READ_ONLY", "read-only session");
        const s = this.stale(body);
        if (s) return s;
        if (this.uncommitted.length === 0)
          return this.problem(409, "NOTHING_TO_COMMIT", "nothing to commit");
        const sha = `c${++this.blobSeq}`;
        const commit: CommitInfoT = { sha, message: body.message, author: "Alice Author" };
        this.unpushedCommits.push(commit);
        this.uncommitted = [];
        this.headFiles = new Map(this.files);
        this.head = sha;
        return HttpResponse.json({ commit, branch: this.branch, head: this.head });
      }),
      http.post("/api/discard", async ({ request }) => {
        const body = (await record(request)) as {
          paths?: string[];
          branch: string;
          head: string;
        } | null;
        if (!csrfOk(request)) return this.problem(403, "CSRF", "missing or invalid CSRF token");
        if (this.mode === "READ_ONLY") return this.problem(403, "READ_ONLY", "read-only session");
        if (!body?.paths)
          return this.problem(400, "BAD_REQUEST", "the confirmed paths are required");
        const s = this.stale(body);
        if (s) return s;
        const current = this.uncommitted.map((c) => c.path ?? "").sort();
        const confirmed = [...new Set(body.paths)].sort();
        if (current.join("\n") !== confirmed.join("\n")) {
          return this.problem(409, "STALE", "the uncommitted files changed", {
            paths: current,
            branch: this.branch,
            head: this.head,
          });
        }
        const discarded = this.uncommitted;
        for (const c of discarded) {
          const path = c.path ?? "";
          const original = this.headFiles.get(path);
          if (original) this.files.set(path, original);
          else this.files.delete(path);
        }
        this.uncommitted = [];
        return HttpResponse.json({ discarded, branch: this.branch, head: this.head });
      }),
      http.post("/api/push", async ({ request }) => {
        const body = (await record(request)) as { branch: string; head: string };
        if (!csrfOk(request)) return this.problem(403, "CSRF", "missing or invalid CSRF token");
        if (this.mode === "READ_ONLY") return this.problem(403, "READ_ONLY", "read-only session");
        const s = this.stale(body);
        if (s) return s;
        if (this.nextPushProblem) {
          const p = this.nextPushProblem;
          this.nextPushProblem = null;
          return this.problem(p.status, p.code, p.code, p.extra);
        }
        this.unpushedCommits = [];
        return HttpResponse.json({
          push: { branch: this.branch, head: this.head, status: "OK", created: false },
          pullRequestUrl: `https://git.example.org/cumba/cumba-corej-rules/compare/main...${this.branch}`,
        });
      }),
      http.get("/api/files", ({ request }) => {
        if (!authed()) return this.problem(401, "UNAUTHENTICATED", "log in first");
        const path = new URL(request.url).searchParams.get("path") ?? "";
        const prefix = `${path}/`;
        const entries = [...this.files.keys()]
          .filter((p) => p.startsWith(prefix))
          .map((p) => p.slice(prefix.length))
          .map((rest) =>
            rest.includes("/")
              ? { name: rest.split("/")[0], directory: true, size: 0 }
              : {
                  name: rest,
                  directory: false,
                  size: this.files.get(path + "/" + rest)!.content.length,
                },
          );
        if (entries.length === 0)
          return this.problem(404, "NOT_FOUND", `no directory ${path}`, { path });
        return HttpResponse.json({ path, entries, branch: this.branch, head: this.head });
      }),
      http.get("/api/files/content", ({ request }) => {
        if (!authed()) return this.problem(401, "UNAUTHENTICATED", "log in first");
        const path = new URL(request.url).searchParams.get("path") ?? "";
        const f = this.files.get(path);
        if (!f) return this.problem(404, "NOT_FOUND", `no file ${path}`, { path });
        return HttpResponse.json({
          path,
          content: f.content,
          blob: f.blob,
          branch: this.branch,
          head: this.head,
        });
      }),
      http.put("/api/files/content", async ({ request }) => {
        const body = (await record(request)) as {
          path: string;
          content: string;
          blob?: string;
          branch: string;
          head: string;
        };
        if (!csrfOk(request)) return this.problem(403, "CSRF", "missing or invalid CSRF token");
        if (!authed()) return this.problem(401, "UNAUTHENTICATED", "log in first");
        if (this.nextWriteProblem) {
          const p = this.nextWriteProblem;
          this.nextWriteProblem = null;
          return this.problem(p.status, p.code, p.code, p.extra);
        }
        if (this.mode === "READ_ONLY") return this.problem(403, "READ_ONLY", "read-only session");
        if (this.branch === this.defaultBranch)
          return this.problem(409, "DEFAULT_BRANCH", "default branch is read-only");
        const s = this.stale(body);
        if (s) return s;
        const existing = this.files.get(body.path);
        if ((existing?.blob ?? null) !== (body.blob ?? null)) {
          return this.problem(409, "STALE", "blob changed", {
            branch: this.branch,
            head: this.head,
          });
        }
        const blob = `w${++this.blobSeq}`;
        this.files.set(body.path, { content: body.content, blob });
        if (!this.uncommitted.some((c) => c.path === body.path)) {
          this.uncommitted.push({ path: body.path, kind: existing ? "MODIFIED" : "UNTRACKED" });
        }
        return HttpResponse.json({ path: body.path, blob, branch: this.branch, head: this.head });
      }),
      http.get("/api/explorer", () => {
        if (!authed()) return this.problem(401, "UNAUTHENTICATED", "log in first");
        return HttpResponse.json(this.explorer());
      }),
      http.get("/api/search", ({ request }) => {
        if (!authed()) return this.problem(401, "UNAUTHENTICATED", "log in first");
        const params = new URL(request.url).searchParams;
        this.searches.push(Object.fromEntries(params.entries()));
        const q = (params.get("q") ?? "").toLowerCase();
        const hits = [...this.files.entries()]
          .filter(
            ([p, f]) => p.startsWith("rules-src/checks/") && f.content.toLowerCase().includes(q),
          )
          .map(([p, f]) => {
            const m = /^rules-src\/checks\/([^/]+)\/([^/]+)\.yaml$/.exec(p)!;
            const line = f.content.split("\n").findIndex((l) => l.toLowerCase().includes(q));
            return {
              id: m[2],
              family: m[1],
              path: p,
              docsPath: `rules-src/docs/${m[1]}/${m[2]}.yaml`,
              description: "desc",
              snippets: [{ file: "check", line: line + 1, text: f.content.split("\n")[line] }],
            };
          });
        return HttpResponse.json({
          branch: this.branch,
          head: this.head,
          query: q,
          hits,
          total: hits.length,
          truncated: false,
        });
      }),
      ...this.engine.handlers(),
    ];
  }

  private branchesBody() {
    return {
      current: this.branch,
      defaultBranch: this.defaultBranch,
      head: this.head,
      branches: this.branches,
    };
  }
}

/** The one fake every test shares; `setup.ts` resets it before each test. */
export const fake = new FakeWorkspace();

export const handlers: HttpHandler[] = fake.handlers();
