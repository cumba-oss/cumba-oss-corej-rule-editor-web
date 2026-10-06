# cumba-oss-corej-rule-editor-web

The web half of the coreJ **rule editor** — a rule review and test tool for a coreJ rule
corpus such as [`cumba-oss-corej-rules`](https://github.com/cumba-oss/cumba-oss-corej-rules).
Part of the [cumba-oss](https://github.com/cumba-oss) set, licensed under AGPL-3.0-only
([LICENSE](LICENSE)). The API it talks to is
[`cumba-oss-corej-rule-editor-rest`](https://github.com/cumba-oss/cumba-oss-corej-rule-editor-rest),
in its own repository; this is the published twin of the internal `cumba-corej-rule-editor-web`,
kept source-identical.

**Phase 2** built the engine-free half: login, the IDE layout (Explorer · tabs · editor · bottom
panel), the name filter and the search dialog, a plain-YAML CodeMirror editor with folding and
the list keymap, branch picker, Save → "Push now?", Commit + Push, the exit guard, read-only
mode. **Phase 3** adds everything that needs the authoring API behind the rest app: analysis
on change with the greyed derived fields, completion and tooltips, the lint gutter and the
Problems / Related tabs, the semantic search filters, the scenario grid, new scenarios, Run +
Results + JSON, "take actual as expected", and the engine-version banner.

⚠⚠ **A Java-free Vite/TypeScript SPA**, shaped like `cumba-oss-corej-web`: the pom exists only
to drive frontend-maven-plugin, the gate is `npm run verify`, and the CI workflows must **never
be re-synced from the Java workflows** of the other cumba-oss repositories.

## Behaviour (PLAN-rule-editor §5)

| the user does | the SPA does | the server rule it relies on |
|---|---|---|
| logs in with a login name + personal access token | `POST /api/session/login` with the CSRF token; the mode (`EDIT` / `READ_ONLY`) comes back with the session | the **token** decides the mode (§5.1.3) |
| opens a rule from the Explorer or the search | `GET /api/files/content` into a tab; the tab remembers the blob id | path allow-list |
| edits | the buffer is the check file byte for byte; the Problems tab shows YAML syntax errors | — |
| Ctrl+S / Save | `PUT /api/files/content` with `{branch, head, blob}`; then **"Push now?"** (*Commit + Push* / *Later*) | `409 STALE` ⇒ the tab is rebased on the current file, the edit kept, "save again"; `409 DEFAULT_BRANCH` ⇒ the branch picker opens; `403 READ_ONLY` ⇒ reported |
| Ctrl+S in read-only mode | explains that edits are not saved — no request is sent (O12: edit and run without saving) | the server would refuse anyway |
| Commit + Push (header, badge = uncommitted files + unpushed commits) | `POST /api/commit` (message pre-filled from the rule ids) then `POST /api/push`; shows the forge's "create PR" link | `409 NON_FAST_FORWARD` ⇒ *Update from remote branch*; a `MERGE_CONFLICT` is reported with its paths |
| switches or creates a branch | `POST /api/branches[/switch]`; open tabs close | `409 DIRTY_TREE` ⇒ a dialog names the files and offers *Commit locally* / *Discard* / *Cancel*; *Discard* asks again naming every file that will lose its saved changes, then `POST /api/discard` with those paths; open tabs of discarded files reload (a deleted new file's tab closes) and the switch is retried. `409 STALE` (the files changed meanwhile) ⇒ nothing discarded, the confirmation shows the current list |
| leaves with work behind | `beforeunload` while anything is unsaved, uncommitted or unpushed; logout and branch switch open a dialog that **names** the buffers, files and commits | — |
| the session expires mid-edit | a `401` keeps every buffer, re-authenticates in a dialog and retries the save | the session id changes at login; the SPA drops its CSRF token and re-reads it |
| edits a rule (phase 3) | 400 ms after the last keystroke `POST /api/analyse` with the buffer (and the docs buffer when its tab is open and dirty); diagnostics become lint markers (range, else the YAML path through `pathToRange`) and Problems rows; a DOCS diagnostic opens / points into the docs tab. An answer for buffers that changed meanwhile — even back by an undo — is dropped; while an analysis is pending or failed the markers stay where the editor mapped them through the edits and Problems marks its list stale ("No problems." only for a fresh analysis). A docs tab whose rule tab is closed is analysed with the rule as saved | analysis is in-process, size-capped (`413 TOO_LARGE`) |
| reads a rule | `Sensitivity` and `Output_Variables` are greyed **block widgets** where the packaged shape puts them (O5): read-only, never in the document, never saved or copied, line numbers true; `Output_Variables` shows the EFFECTIVE list, the authored subset marked, the buffer's `!X` exclusions struck through; an empty effective list says "none listed — at run time the engine reports the columns the Check reads"; a rule that failed to load lists its `Output_Variables` as authored, said so; `Authorities` only via *Show Authorities*; the widgets dim and say "stale" while an analysis is pending or failed | derived by `RuleInsight` on the server |
| types / hovers | completion: keys and enum values from the branch's `GET /api/engine/schema` (404 ⇒ no key completion), variables from the analysis' scope universe (SDTM in `--` form, tagged with datasets / versions), functions with signatures (`GET /api/engine/functions`), `$binding` names; tooltips per §5.4: key descriptions, Scope ⇒ resolved datasets, variables and `--X` ⇒ concrete expansions, `&NAME&`, functions, C-codes (`GET /api/engine/ct`), `Core.Id` ⇒ related rules, `$binding` ⇒ its expression | CDISC Library content comes only from the metadata store; without one the notice says completion is limited |
| opens the Scenarios tab | `GET /api/scenarios?rule=` rows (name, expect, count, datasets, last run this session); click (or Space) selects the run target, double-click (or Enter) opens a tab; the rows re-read after any scenario save, an update from the remote branch and a discard; *New from rule* / *Clone* open **unsaved** tabs in the suite directory; sidecars open as plain text | the suite directory is read from the workspace |
| edits a scenario | Text and Grid views of one document — the text is the truth. Grid: one sub-tab per dataset (`POST /api/cdt/parse`), missing sentinels (`.`, `._`, `.A`…) shown distinctly, every edit is `POST /api/cdt/splice` of the text the grid was parsed from; a `CDT_UNREPRESENTABLE` answer is shown and nothing changes. Splices are one at a time: while one is in flight (or the grid shows the parse of older text) the grid and the header are read-only, the previous parse stays on screen (focus kept), and an answer lands only if the text is still the one it was computed from. The first splice of a block with comment lines asks first (a splice drops them). The expectations header edits the `#test … expect=` (the parser's tokens: `violation`, `noViolation`, `skipped`, `executionError`), `#expectViolationCount`, `#expectViolationAt` lines in place; a new `#expectViolationAt` line is written once it has text | the engine's own `CdtDocument` rewrites one block, nothing else |
| runs (F5 / Run) | the active rule's **buffer** against the selected scenario's **buffer**, `POST /api/run`; one run at a time per session; the report is kept per rule with the scenario and the branch it ran (another branch's report is hidden); Results (the scenario's name, verdict line, checks, one row per finding, SKIPPED / ERROR reasons), JSON (the v2 report, read-only, foldable, copy / download); `RUN_BUSY`, `RATE_LIMITED`, `TIMEOUT`, `WORKER_FAILED`, `RULE_ERRORS` are reported plainly | runs execute in a child JVM worker with a timeout and a queue limit |
| takes actual as expected | offered only while the scenario the report ran is the selected one (and on its branch); the run's proposed `#expectViolation*` lines — and the `#test` line when the proposal changes its `expect=` — are shown as a **diff** against THAT scenario's buffer; only on confirmation `POST /api/cdt/expectations` rewrites the buffer (not the file) — never automatically | a re-run or a branch switch before the confirmation refuses the write |
| switches to a branch on another language level | a banner on ANY mismatch between the branch's `rules-src/LANGUAGE-LEVEL` and the engine's level, naming both: higher ⇒ "this branch needs a newer editor", lower ⇒ "this branch predates the engine — update from default"; a branch without `rules-src/LANGUAGE-LEVEL` counts as level 0 (predates) (O13) | `GET /api/info` `engine.languageLevel`, `GET /api/explorer` `languageLevel` |

The default branch is listed in the picker but marked read-only: the server refuses writes,
commits and pushes to it (changes reach it through a PR).

*Discard* restores changed files to the last commit and deletes new ones; it never touches
commits or other branches (the rest README, § Server-side rules).

## Layout of the code

| directory | what |
|---|---|
| `src/api/` | `client.ts` — openapi-fetch client, the CSRF middleware, RFC 9457 problem mapping; `editor.ts` — one function per endpoint; `schema.d.ts` — **generated** from `openapi.snapshot.json`; `types.ts` — DTO aliases |
| `src/state/tabs.ts` | the tab reducer (pure): one tab per path, dirty = buffer ≠ file, path classification, the new-rule template |
| `src/engine/` | `useEngine.ts` — the hooks: debounced analysis, catalogues, related, suite, runs; `diagnostics.ts` — diagnostics → markers; `schemaWalk.ts` — keys / enums / descriptions at a YAML path of the JSON schema; `cdt.ts` — the expectation lines, new-scenario text, the diff |
| `src/components/` | `EditorShell` (the IDE and every flow), `Explorer`, `SearchDialog`, `EditorTabs`, `CodeEditor`, `BottomPanel` (Scenarios / Results / JSON / Problems / Related), `ScenarioEditor` (Text / Grid, expectations header), `ScenarioDialogs` (new scenario, take-as-expected diff), `EngineBanner`, `BranchDialog`, `Dialogs` (push-now, commit+push, dirty tree, leave, re-auth, close dirty tab), `NewRuleDialog`, `Header`, `LoginForm` / `LoginView` |
| `src/components/editor/` | `yamlPath.ts` (cursor context), `ruleCompletion.ts`, `ruleTooltips.ts`, `derivedWidgets.ts` (the greyed fields as block widgets), `jsonFold.ts`, `yamlListEditing.ts`; `src/util/yamlFold.ts`, `pathToRange.ts`, `yaml.ts` are reused from the retired monorepo editor |
| `src/test/` | the MSW server, `FakeWorkspace` — an in-memory stand-in for the rest app shaped to its OpenAPI snapshot (session, files, branches, stamps, problem codes) — and `FakeEngine` (analysis shaped from the buffer, catalogues, a `.cdt` parser / splicer, runs) |

## The API contract

`openapi.snapshot.json` is a **copy** of `cumba-oss-corej-rule-editor-rest/openapi.snapshot.json`,
which that repo's `OpenApiSnapshotTest` pins to the served document. `npm run gen:api` regenerates
`src/api/schema.d.ts` from it; the Maven build runs `gen:api:check` and fails when the committed
`schema.d.ts` drifts from the snapshot. When the API changes: copy the new snapshot here, run
`npm run gen:api`, commit both.

## Building and running

```bash
npm ci
npm run dev        # Vite on :5173, /api proxied to the rest app on :8081
npm run verify     # prettier → eslint → tsc → vitest (coverage 85/85/70/85) → vite build
mvn verify         # the same through frontend-maven-plugin + the release zip (target/*.zip)
```

⭐ **Running both apps with Docker, step by step (clone → build → compose → login): [`DOCKER.md`](DOCKER.md).**

Deployment shapes (bundled into the rest jar, or behind a reverse proxy, or `docker-compose`):
[`assembly/README.md`](assembly/README.md) and the rest repo's README. `Dockerfile` builds an
nginx image from `dist/` with [`docker/nginx.conf`](docker/nginx.conf) — the reference for any
reverse proxy in front of the two apps (what it forwards, on one origin; a 4 MB request-body
cap; the SPA document's `Content-Security-Policy`, `X-Content-Type-Options: nosniff` and
`frame-ancestors 'none'` — the CSP was measured in a headless browser: no violation, CodeMirror
and Mantine styled); the compose file that
pairs it with the rest container lives in `cumba-oss-corej-rule-editor-rest`. ⚠ Both were written
without docker available: shape-checked, not run.

CI: `.github/workflows/ci.yml` (GitHub Actions: the npm chain through frontend-maven-plugin,
one Maven pass, a signed release asset on a tag) and `.gitea/workflows/main.yml` (the same gate
on the internal Gitea) are copies of `cumba-oss-corej-web`'s — kept in step with those files,
never with the Java workflows; the two deliberately differ from each other (the header of
`ci.yml` lists the five inversions).
