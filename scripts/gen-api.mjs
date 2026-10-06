// Resolve the OpenAPI source for type generation, then run openapi-typescript.
//
// Reads the committed ./openapi.snapshot.json by default, so a clean clone
// builds hermetically — no network, no running API, reproducible.
//
// ⚠ In the monorepo this preferred a LIVE spec at the sibling path
// ../corej-rest/target/openapi.json, dumped by the REST module's
// `generate-openapi` profile. That module now lives in a different repository
// of its own (cumba-oss-corej-rest), so the relative path can never
// resolve again. Left as-is it would not have failed: it would have silently
// taken the fallback forever, and the "types track the running app" property
// would have been quietly untrue.
//
// So the live spec is now an EXPLICIT, NAMED override with no usable default
// (runbook Phase 06d): set COREJ_OPENAPI_SPEC to a spec you dumped yourself.
// A path that is named but missing is a hard error — naming a spec and
// silently getting the snapshot instead is the failure this replaced.
//
// With `--check` (see the `gen:api:check` npm script, which is what the Maven
// build runs at generate-sources) the generated src/api/schema.d.ts must equal
// the version git already has, or the build fails. Without it a regeneration
// is a silent rewrite: the Maven build overwrites the committed file at
// generate-sources and the only trace is an unstaged diff nobody has to
// notice. `npm run gen:api` on its own keeps the plain rewrite behaviour and
// stays the documented way to *fix* a reported drift.
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const moduleRoot = resolve(here, "..");

/**
 * Opt-in override naming a spec to generate from instead of the committed snapshot.
 *
 * Named COREJ_* to match COREJ_SCHEMA_DRIFT_CHECK below rather than for the repository:
 * one file with two conventions is worse than one file carrying the product's.
 */
const SPEC_ENV = "COREJ_OPENAPI_SPEC";

const snapshot = resolve(moduleRoot, "openapi.snapshot.json");
const override = process.env[SPEC_ENV]?.trim();

// A named-but-missing spec is a hard error, never a silent fallback: falling back
// would reintroduce exactly the failure this override was written to remove.
if (override && !existsSync(override)) {
  console.error(
    [
      "",
      `[gen:api] ${SPEC_ENV} points at a spec that does not exist:`,
      `    ${resolve(override)}`,
      "",
      "  Refusing to fall back to the committed openapi.snapshot.json — you asked for a",
      "  specific spec, and generating from a different one would be silent and wrong.",
      "  Unset the variable to use the snapshot deliberately.",
      "",
    ].join("\n"),
  );
  process.exit(1);
}

const source = override ? resolve(override) : snapshot;
const output = resolve(moduleRoot, "src/api/schema.d.ts");
const check = process.argv.slice(2).includes("--check");

/**
 * Module-relative path of the generated file, for messages and git commands.
 *
 * ⚠ Was repository-relative twice over: "clients/corej-web/..." in the
 * monorepo. This module is now its own repository, so that prefix would have printed
 * `git add` advice naming a directory that does not exist — a broken instruction in the
 * one message a reader follows verbatim.
 */
const OUTPUT_REL = "src/api/schema.d.ts";

/** Explicit, loud opt-out. Set to "off" only where git genuinely cannot be run. */
const OPT_OUT = "COREJ_SCHEMA_DRIFT_CHECK";

console.log(`[gen:api] generating ${output} from ${source}`);

const bin = resolve(
  moduleRoot,
  "node_modules/.bin",
  process.platform === "win32" ? "openapi-typescript.cmd" : "openapi-typescript",
);

const result = spawnSync(bin, [source, "-o", output], {
  stdio: "inherit",
  cwd: moduleRoot,
});

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

if (check) {
  assertMatchesCommittedVersion();
}

/** Runs git in the module directory, capturing output rather than inheriting stdio. */
function git(args) {
  return spawnSync("git", args, { cwd: moduleRoot, encoding: "utf8" });
}

/**
 * Prints a blank-line-padded block on stderr and marks the process failed.
 *
 * Sets `process.exitCode` instead of calling `process.exit()`: the latter tears the process
 * down before Node has flushed a piped stderr, and every consumer here (frontend-maven-plugin,
 * npm) reads through a pipe. Callers must `return fail(...)` so nothing runs after it.
 */
function fail(lines) {
  console.error(["", ...lines, ""].join("\n"));
  process.exitCode = 1;
}

/** How the drift should be resolved, worded for the spec `gen:api` actually read. */
function sourceAdvice() {
  if (source === snapshot) {
    return [
      "  gen:api read the committed openapi.snapshot.json, so schema.d.ts had drifted from",
      "  the snapshot it is supposed to be generated from — the committed pair was",
      "  inconsistent. Staging the regenerated file fixes it.",
    ];
  }
  return [
    `  gen:api read the spec named by ${SPEC_ENV}, not the committed snapshot:`,
    `    ${source}`,
    "",
    "  If the API really did change, refresh openapi.snapshot.json from that same file as",
    "  well — the snapshot and schema.d.ts are committed as a pair, and the snapshot is",
    "  this repository's copy of record for the contract.",
    "",
    "  ⚠ Nothing in this repository can tell you whether that spec is the CURRENT published",
    "  contract. The monorepo's other half of this guard, OpenApiSnapshotDriftTest in",
    "  clients/corej-rest, pinned the snapshot against the live spec and could not",
    '  survive the repo split. See the README\'s "The API contract" section.',
  ];
}

/**
 * Fails the build unless the freshly generated schema.d.ts equals the version git has.
 *
 * Compares the working tree against the index (`git diff -- <file>`), so once the
 * regenerated file is staged the check is green and the build stops nagging. It is live
 * wherever the build runs inside a git checkout — which is every clean checkout and every
 * gate run — and it never needs the live spec or a running app. It cannot run at all
 * outside a git checkout, and rather than skip there (a guard that no-ops in the very
 * situation the drift survives guards nothing) it fails and points at the opt-out.
 */
function assertMatchesCommittedVersion() {
  if (process.env[OPT_OUT] === "off") {
    console.warn(
      `[gen:api] WARNING: ${OPT_OUT}=off — schema.d.ts drift check DISABLED. ` +
        `${OUTPUT_REL} may have just been rewritten silently.`,
    );
    return;
  }

  const insideRepo = git(["rev-parse", "--is-inside-work-tree"]);
  if (insideRepo.error || insideRepo.status !== 0 || insideRepo.stdout.trim() !== "true") {
    return fail([
      `[gen:api] cannot check ${OUTPUT_REL} for drift: git is unavailable, or this tree is`,
      "  not a git checkout. The build just regenerated that file, and without git there is",
      "  no committed version to compare it against — so the rewrite cannot be shown to be a",
      "  no-op. Failing rather than skipping: a skip here is exactly the silent rewrite this",
      "  check exists to stop.",
      "",
      `  Build outside a checkout on purpose? Set ${OPT_OUT}=off to opt out explicitly.`,
    ]);
  }

  const tracked = git(["ls-files", "--error-unmatch", "--", output]);
  if (tracked.status !== 0) {
    return fail([
      `[gen:api] ${OUTPUT_REL} is not tracked by git, so it has no committed version to`,
      "  compare against. It is a generated file that must nevertheless be committed: the",
      "  SPA typechecks and builds against it, and `npm run verify` alone does not generate",
      "  it. Stage and commit it.",
    ]);
  }

  const diff = git(["diff", "--quiet", "--exit-code", "--", output]);
  if (diff.status === 0) {
    console.log(`[gen:api] check: ${OUTPUT_REL} matches the version git has (no drift).`);
    return;
  }
  if (diff.status !== 1) {
    return fail([
      `[gen:api] could not diff ${OUTPUT_REL} against the version git has`,
      `  (git diff exited ${diff.status}). Treating that as a failure rather than a pass.`,
      ...(diff.stderr ? ["", diff.stderr.trimEnd()] : []),
    ]);
  }

  const stat = git(["diff", "--stat", "--", output]);
  fail([
    `[gen:api] DRIFT: the regenerated ${OUTPUT_REL} differs from the version git has.`,
    "",
    `  regenerated from : ${source}`,
    (stat.stdout || "").trimEnd(),
    "",
    "  The Maven build regenerates this file at generate-sources, so without this check the",
    "  rewrite would have landed silently and left only an unstaged diff. The file now in",
    "  your working tree is the correct, freshly generated one — review it and stage it:",
    "",
    `    git diff -- ${OUTPUT_REL}`,
    `    git add   ${OUTPUT_REL}`,
    "",
    ...sourceAdvice(),
  ]);
}
