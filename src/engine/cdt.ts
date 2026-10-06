import type { AnalysisT, ColumnT, DatasetT, VariableT } from "../api/types";
import { SCENARIOS_DIR } from "../state/tabs";

/**
 * Client-side helpers over a scenario text (PLAN-rule-editor §5.6). The server's `CdtDocument`
 * owns the dataset blocks (parse / splice); this file edits only the prelude's expectation lines
 * in place and composes new scenarios — the text stays the truth.
 */

/** The `#test` header fields and the `#expectViolation*` lines of a scenario. */
export interface Expectations {
  /** The `#test <rule> …` tokens other than expect / domain, kept as written. */
  ruleId: string | null;
  expect: string | null;
  domain: string | null;
  expectViolationCount: number | null;
  expectViolationAt: string[];
}

const TEST = /^#test\s+(\S+)(.*)$/;
const KEY_VALUE = /(\w+)=("[^"]*"|\S+)/g;
const COUNT = /^#expectViolationCount\s+(\d+)\s*$/;
const AT = /^#expectViolationAt\b\s*(.*)$/;

function splitLines(text: string): string[] {
  return text.split(/\r?\n/);
}

function newlineOf(text: string): string {
  return text.includes("\r\n") ? "\r\n" : "\n";
}

/** The expectation facts of a scenario text (the first `#test` line, every `#expectViolation*`). */
export function readExpectations(text: string): Expectations {
  const out: Expectations = {
    ruleId: null,
    expect: null,
    domain: null,
    expectViolationCount: null,
    expectViolationAt: [],
  };
  for (const raw of splitLines(text)) {
    const line = raw.trim();
    if (line.startsWith("dataset ")) break;
    const t = TEST.exec(line);
    if (t && out.ruleId === null) {
      out.ruleId = t[1];
      for (const m of t[2].matchAll(KEY_VALUE)) {
        const value = m[2].replace(/^"|"$/g, "");
        if (m[1].toLowerCase() === "expect") out.expect = value;
        if (m[1].toLowerCase() === "domain") out.domain = value;
      }
      continue;
    }
    const c = COUNT.exec(line);
    if (c) {
      out.expectViolationCount = Number(c[1]);
      continue;
    }
    const a = AT.exec(line);
    if (a) out.expectViolationAt.push(a[1].trim());
  }
  return out;
}

/** The `#expectViolation*` lines of a text, as written (for the "take actual as expected" diff). */
export function expectationLines(text: string): string[] {
  return splitLines(text)
    .map((l) => l.trim())
    .filter((l) => l.startsWith("#expectViolation"));
}

/**
 * Edit the header in place: the first `#test` line's `expect=` / `domain=` tokens, the
 * `#expectViolationCount` line (added after the `#test` line when absent, removed when `null`) and
 * the `#expectViolationAt` lines (replaced as a group where the first one was, else after the
 * count). Everything else — every other line, the line terminator — is untouched.
 */
export function writeExpectations(text: string, e: Expectations): string {
  const nl = newlineOf(text);
  const lines = splitLines(text);
  const count =
    e.expectViolationCount === null ? [] : [`#expectViolationCount ${e.expectViolationCount}`];
  const ats = e.expectViolationAt.map((a) => `#expectViolationAt ${a}`.trimEnd());
  let testIndex = -1;
  let countIndex = -1;
  let firstAt = -1;
  let preludeEnd = lines.length;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith("dataset ")) {
      preludeEnd = i;
      break;
    }
    const t = TEST.exec(line);
    if (testIndex < 0 && t) {
      testIndex = i;
      let rest = t[2];
      rest = setToken(rest, "expect", e.expect);
      rest = setToken(rest, "domain", e.domain);
      lines[i] = `#test ${t[1]}${rest}`;
    } else if (countIndex < 0 && COUNT.test(line)) {
      countIndex = i;
    } else if (firstAt < 0 && AT.test(line)) {
      firstAt = i;
    }
  }
  const out: string[] = [];
  const afterTest = [
    ...(countIndex < 0 ? count : []),
    ...(countIndex < 0 && firstAt < 0 ? ats : []),
  ];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (i === countIndex) {
      out.push(...count);
      if (firstAt < 0) out.push(...ats);
    }
    if (i === firstAt) out.push(...ats);
    if (i < preludeEnd && (COUNT.test(line) || AT.test(line))) continue;
    out.push(lines[i]);
    if (i === testIndex) out.push(...afterTest);
  }
  if (testIndex < 0) out.unshift(...afterTest);
  return out.join(nl);
}

/** The first `#test` line of a text's prelude, trimmed, or `null`. */
export function testLine(text: string): string | null {
  for (const raw of splitLines(text)) {
    const line = raw.trim();
    if (line.startsWith("dataset ")) return null;
    if (TEST.test(line)) return line;
  }
  return null;
}

/**
 * The text with the first `#test` line's `expect=` set to `expect` — that one token, nothing else
 * (the line terminator, every other line and token are untouched). No `#test` line: unchanged.
 */
export function setTestExpect(text: string, expect: string): string {
  const nl = newlineOf(text);
  const lines = splitLines(text);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith("dataset ")) break;
    const t = TEST.exec(line);
    if (t) {
      lines[i] = `#test ${t[1]}${setToken(t[2], "expect", expect)}`;
      return lines.join(nl);
    }
  }
  return text;
}

/** What "take actual as expected" proposes for a scenario text, as the confirm diff shows it. */
export interface ExpectationProposal {
  /** The lines the diff starts from: the `#test` line when `expect=` changes, the expectation lines. */
  current: string[];
  /** The lines the diff ends with, in the same shape. */
  proposed: string[];
  /** The `#expectViolation*` lines to write (`POST /api/cdt/expectations`). */
  lines: string[];
  /** The `expect=` value to write into the `#test` line, or `null` when it stays. */
  expect: string | null;
}

/**
 * A run's proposal against a scenario text (review 1 + REST fold): the proposed
 * `#expectViolation*` lines, and — when the run says the scenario should expect something else —
 * the `#test` line with its new `expect=`. The REST app names the token as `expect` (with the
 * line it would write as `testLine`); a `#test` line among the proposed lines reads the same. The
 * diff's `#test` line is computed against the BUFFER, which may have changed since the run.
 */
export function expectationProposal(
  text: string,
  proposedLines: string[],
  proposedExpect?: string | null,
): ExpectationProposal {
  const lines = proposedLines.map((l) => l.trim()).filter((l) => !TEST.test(l));
  const fromLine = proposedLines.map((l) => l.trim()).find((l) => TEST.test(l));
  const wanted = proposedExpect || (fromLine ? readExpectations(fromLine).expect : null);
  const currentTest = testLine(text);
  const currentExpect = readExpectations(text).expect;
  // the parser reads the token case-insensitively, so `noviolation` already says `noViolation`
  const expect =
    wanted && currentTest && wanted.toLowerCase() !== (currentExpect ?? "").toLowerCase()
      ? wanted
      : null;
  if (!expect || !currentTest) {
    return { current: expectationLines(text), proposed: lines, lines, expect: null };
  }
  return {
    current: [currentTest, ...expectationLines(text)],
    proposed: [testLine(setTestExpect(text, expect)) ?? currentTest, ...lines],
    lines,
    expect,
  };
}

/**
 * Whether the dataset block `name` (the first of that name, case-insensitive — the splice's
 * target) carries comment lines between its fences: a splice rewrites the block and drops them
 * (`CdtDocument`, PLAN-rule-editor §12).
 */
export function blockHasComments(text: string, name: string): boolean {
  const lines = splitLines(text);
  const lower = name.toLowerCase();
  const start = lines.findIndex((l) => {
    const t = l.trim();
    return t.startsWith("dataset ") && t.slice(8).trim().split(/\s+/)[0].toLowerCase() === lower;
  });
  if (start < 0) return false;
  let fences = 0;
  for (let i = start + 1; i < lines.length; i++) {
    const t = lines[i].trim();
    if (/^-{3,}$/.test(t)) {
      if (++fences === 2) return false;
      continue;
    }
    if (t.startsWith("dataset ")) return false;
    if (t.startsWith("#")) return true;
  }
  return false;
}

function setToken(rest: string, key: string, value: string | null): string {
  const re = new RegExp(`\\s*\\b${key}=("[^"]*"|\\S+)`, "i");
  const token =
    value === null || value === "" ? "" : ` ${key}=${/\s/.test(value) ? `"${value}"` : value}`;
  return re.test(rest) ? rest.replace(re, token) : rest + token;
}

/** The suite directory of a rule id (`CDISC-CG0270` → `…/ruletestsuites/cdisc/CDISC-CG0270`). */
export function suiteDirOf(ruleId: string): string {
  const family = ruleId.includes("-") ? ruleId.slice(0, ruleId.indexOf("-")) : ruleId;
  return `${SCENARIOS_DIR}${family.toLowerCase()}/${ruleId}`;
}

/** A column for a variable the catalogue knows, else a Char column without a label. */
export function columnFor(name: string, analysis: AnalysisT | null): ColumnT {
  const upper = name.toUpperCase();
  const v: VariableT | undefined = (analysis?.scope?.variables ?? []).find(
    (x) => (x.name ?? "").toUpperCase() === upper,
  );
  const type = (v?.type ?? "").toLowerCase();
  return {
    name: upper,
    type:
      type === "integer" || type === "float" || type === "num" || type === "numeric"
        ? "Num"
        : "Char",
    label: v?.label ?? undefined,
    attrs: {},
  };
}

/** The `col` line of a column in the `.cdt` syntax. */
export function colLine(c: ColumnT): string {
  const parts = [`col ${c.name}`, `type=${c.type ?? "Char"}`];
  if (c.label) parts.push(`label="${c.label.replace(/"/g, "'")}"`);
  if (c.length !== undefined && c.length !== null) parts.push(`length=${c.length}`);
  if (c.format) parts.push(`format=${c.format}`);
  if (c.codelist) parts.push(`codelist=${c.codelist}`);
  for (const [k, v] of Object.entries(c.attrs ?? {}))
    parts.push(`${k}=${/\s/.test(v) ? `"${v}"` : v}`);
  return parts.join(" ");
}

/** The text of a dataset block in the `.cdt` syntax (rows in the parser's field encoding). */
export function datasetText(d: DatasetT): string {
  const head = [`dataset ${d.name}${d.label ? ` label="${d.label}"` : ""}`];
  const cols = (d.columns ?? []).map(colLine);
  const fence = d.fence || "---";
  const rows = (d.rows ?? []).map((r) => r.join(" | "));
  return [...head, ...cols, fence, ...rows, fence].join("\n");
}

/**
 * The variables a new scenario's datasets carry (§5.6): the rule's referenced variables ∪ its
 * required ones (`analysis.requiredVariables`, the buffer's `Requirements.Variables` All then
 * Any) ∪ `always` (USUBJID). Class-level (`--X`), `$binding` and `&NAME&` references are not
 * columns; a `DM.RFSTDTC` reference contributes `RFSTDTC`.
 */
export function scenarioColumns(analysis: AnalysisT | null, always: string[]): string[] {
  const names = new Set<string>();
  const add = (raw: string | undefined) => {
    const n = (raw ?? "").toUpperCase();
    if (!n || n.startsWith("--") || n.startsWith("$") || n.includes("&")) return;
    names.add(n.includes(".") ? n.slice(n.lastIndexOf(".") + 1) : n);
  };
  for (const r of analysis?.referencedVariables ?? []) add(r.name);
  for (const r of analysis?.requiredVariables ?? []) add(r);
  for (const r of always) add(r);
  return [...names];
}

/**
 * A new scenario "from the rule" (§5.6): the `#test` line, one dataset per chosen in-scope
 * dataset with the referenced ∪ required variables (types / labels from the catalogue) and one
 * empty row (every cell a missing sentinel).
 */
export function newScenarioFromRule(
  ruleId: string,
  datasets: string[],
  columns: string[],
  analysis: AnalysisT | null,
  /** A `RuleTestCdt` token: `noViolation`, never `no-violation` (the parser refuses that). */
  expect: "violation" | "noViolation",
): string {
  const header = [
    "#!RuleTest",
    `#test ${ruleId} expect=${expect}${datasets.length === 1 ? ` domain=${datasets[0]}` : ""}`,
    ...(expect === "violation" ? ["#expectViolationCount 1"] : []),
  ];
  const cols = columns.map((c) => columnFor(c, analysis));
  const blocks = datasets.map((name) =>
    datasetText({
      name,
      columns: cols,
      fence: "---",
      rows: [cols.map(() => ".")],
      attrs: {},
    }),
  );
  return [...header, "", ...blocks.flatMap((b) => [b, ""])].join("\n");
}

/** A diff of the expectation lines: `-` removed, `+` added, ` ` kept, in order. */
export function diffLines(
  current: string[],
  proposed: string[],
): { op: "-" | "+" | " "; line: string }[] {
  const out: { op: "-" | "+" | " "; line: string }[] = [];
  const proposedSet = new Set(proposed);
  const currentSet = new Set(current);
  for (const l of current) out.push({ op: proposedSet.has(l) ? " " : "-", line: l });
  for (const l of proposed) if (!currentSet.has(l)) out.push({ op: "+", line: l });
  return out;
}
