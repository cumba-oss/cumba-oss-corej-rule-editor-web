import type {
  AnalysisT,
  CodelistLookupT,
  FunctionInfoT,
  JoinedDatasetT,
  RelatedRuleT,
  VariableT,
} from "../../api/types";
import type { JsonSchema } from "../../engine/schemaWalk";

/**
 * What the rule editor's completion and tooltips read (PLAN-rule-editor §5.4): the branch's
 * schema (`null` when it carries none — then no key completion), the function catalogue, the
 * buffer's latest analysis (possibly stale), the related rules and a codelist lookup.
 */
export interface EngineContext {
  schema: JsonSchema | null;
  functions: FunctionInfoT[];
  analysis: AnalysisT | null;
  related: RelatedRuleT[] | null;
  lookupCodelist: (id: string) => Promise<CodelistLookupT | null>;
}

export const EMPTY_CONTEXT: EngineContext = {
  schema: null,
  functions: [],
  analysis: null,
  related: null,
  lookupCodelist: () => Promise.resolve(null),
};

/** Keys whose value is an expression of the rule language. */
export const EXPRESSION_KEYS = new Set(["expression", "Filter", "Precondition", "Condition"]);

/** The variables of the analysis' scope universe. */
export function variablesOf(analysis: AnalysisT | null): VariableT[] {
  return analysis?.scope?.variables ?? [];
}

/** Find a variable by name, case-insensitively (the names ruling); `DM.RFSTDTC` looks up `RFSTDTC`. */
export function findVariable(analysis: AnalysisT | null, name: string): VariableT | undefined {
  const bare = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1) : name;
  const upper = bare.toUpperCase();
  return variablesOf(analysis).find((v) => (v.name ?? "").toUpperCase() === upper);
}

/** One line describing a variable: label · type · core · role. */
export function describeVariable(v: VariableT): string {
  return [v.label, v.type, v.core, v.role].filter(Boolean).join(" · ");
}

/** The flag every joined dataset carries: `<DATASET>._matched_` (guide authoring/joins.md). */
export const MATCHED = "_matched_";

/**
 * A join-match flag as the engine classifies it (`OperandClassifier.MATCHED_FLAG`): the qualifier
 * in any letter case, the `_matched_` suffix exactly — `DM._MATCHED_` is no flag.
 */
export const MATCHED_FLAG = /^[A-Za-z][A-Za-z0-9]*\._matched_$/;

/** The datasets the rule joins via `Match_Datasets` (none from an older server or without a join). */
export function joinedOf(analysis: AnalysisT | null): JoinedDatasetT[] {
  return (analysis?.joined ?? []).filter((j) => !!j.name);
}

/** The joined dataset a qualifier names, case-insensitively (the names ruling). */
export function joinedNamed(
  analysis: AnalysisT | null,
  qualifier: string,
): JoinedDatasetT | undefined {
  const upper = qualifier.toUpperCase();
  return joinedOf(analysis).find((j) => j.name!.toUpperCase() === upper);
}

/**
 * Whether a joined dataset's `_matched_` flag may be read: a `left` join only — with an inner one
 * (`Join_Type: "inner"` or none, the server's default) the flag is constant-true and the engine
 * refuses it (`StageAChecker.checkMatchedFlags`, MATCHED_FLAG_INNER_JOIN). The guide allows
 * `inner` and `left`, lower case; an older server sends no `joinType`: inner.
 */
export function isLeftJoin(j: JoinedDatasetT): boolean {
  return (j.joinType ?? "").toLowerCase() === "left";
}

/** What a qualified name `<DATASET>.<rest>` resolves to among the joined datasets. */
export type JoinedRef =
  | { kind: "variable"; dataset: string; variable: VariableT }
  | { kind: "matched"; dataset: string }
  /** The qualifier names a joined dataset whose variables do not include `name`. */
  | { kind: "unknown"; dataset: string; name: string };

/**
 * Resolve `DM.RFSTDTC` / `DM._matched_` against the joined datasets — the qualifier and the
 * variable name case-insensitively (the names ruling), the flag's suffix exactly (the engine's
 * {@link MATCHED_FLAG}); `undefined` when the qualifier names no joined dataset, `unknown` when it
 * does but the dataset does not carry the variable (never the primary's variable of that name).
 */
export function findJoined(analysis: AnalysisT | null, name: string): JoinedRef | undefined {
  const dot = name.indexOf(".");
  if (dot <= 0) return undefined;
  const joined = joinedNamed(analysis, name.slice(0, dot));
  if (!joined) return undefined;
  const rest = name.slice(dot + 1);
  if (MATCHED_FLAG.test(name)) return { kind: "matched", dataset: joined.name! };
  const upper = rest.toUpperCase();
  const variable = (joined.variables ?? []).find((v) => (v.name ?? "").toUpperCase() === upper);
  return variable
    ? { kind: "variable", dataset: joined.name!, variable }
    : { kind: "unknown", dataset: joined.name!, name: rest };
}

/** One entry of the buffer's block-style `Match_Datasets` list: its `Name` and its text range. */
export interface MatchEntry {
  /** The entry's `Name` (unquoted), `""` when it has none (yet). */
  name: string;
  from: number;
  to: number;
}

/**
 * The entries of the buffer's top-level `Match_Datasets` list, in order, by a line scan: an entry
 * starts at a `- ` line at the list's item indent and runs to the next one or to the next
 * top-level key; its `Name` is the `Name:` key at the entry's own level (the first line's, or a
 * later line indented like the entry's keys). A flow-style list is not read.
 */
export function matchEntries(doc: string): MatchEntry[] {
  const entries: MatchEntry[] = [];
  const header = /^Match_Datasets\s*:\s*(?:#.*)?$/m.exec(doc);
  if (!header) return entries;
  let at = header.index + header[0].length + 1;
  let itemIndent = -1;
  let keyIndent = -1;
  let current: MatchEntry | null = null;
  while (at <= doc.length) {
    const nl = doc.indexOf("\n", at);
    const end = nl < 0 ? doc.length : nl;
    const line = doc.slice(at, end);
    if (/^[^\s#-]/.test(line)) break; // the next top-level key
    const item = /^(\s*)-(\s+|$)/.exec(line);
    if (item && (itemIndent < 0 || item[1].length === itemIndent)) {
      itemIndent = item[1].length;
      keyIndent = item[0].length;
      if (current) entries.push(current);
      current = { name: "", from: at, to: end };
    }
    if (current) {
      if (line.trim()) current.to = end;
      const rest = item && item[1].length === itemIndent ? line.slice(keyIndent) : line;
      const indent =
        item && item[1].length === itemIndent ? keyIndent : /^\s*/.exec(line)![0].length;
      const m = /^\s*Name\s*:\s*(?:"([^"]*)"|'([^']*)'|([^\s#]+))/.exec(rest);
      if (m && indent === keyIndent && !current.name) current.name = m[1] ?? m[2] ?? m[3] ?? "";
    }
    if (nl < 0) break;
    at = nl + 1;
  }
  if (current) entries.push(current);
  return entries;
}
