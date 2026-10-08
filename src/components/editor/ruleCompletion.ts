import {
  autocompletion,
  pickedCompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
  type CompletionSource,
} from "@codemirror/autocomplete";
import type { Extension } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import type { FunctionInfoT, JoinedDatasetT } from "../../api/types";
import { enumAt, ITEM, keysAt } from "../../engine/schemaWalk";
import {
  EXPRESSION_KEYS,
  isLeftJoin,
  joinedNamed,
  joinedOf,
  MATCHED,
  matchEntries,
  variablesOf,
  type EngineContext,
} from "./engineContext";
import {
  classifyExpression,
  expressionBefore,
  JOINED,
  OPERATOR_DETAIL,
  type CallArgument,
  type ExpressionPosition,
} from "./expressionContext";
import { displayType, renderMarkdownLine, renderSummary } from "./functionDocs";
import { cursorContext, type CursorContext } from "./yamlPath";

/**
 * The completion of PLAN-rule-editor §5.4: keys and enum values from the branch's schema at the
 * cursor's YAML path (no schema ⇒ no key completion), variables from the analysis' scope universe
 * (SDTM in `--` form, tagged with the datasets / products they occur in), functions with their
 * signature, `$binding` names from the buffer's own `Bindings`, and the qualified names of the
 * datasets joined via `Match_Datasets` (`DM.RFSTDTC`, `DM._matched_`; {@link joinedOptions}). A
 * `Match_Datasets` entry's `Filter` runs on that dataset's own rows: its variables bare, functions
 * — nothing of the primary ({@link filterOptions}).
 */
export function ruleCompletionSource(getContext: () => EngineContext): CompletionSource {
  return (cm: CompletionContext): CompletionResult | null => {
    const engine = getContext();
    const word = cm.matchBefore(/[\w$&.-]*/);
    if (!word || (word.from === word.to && !cm.explicit)) return null;
    const ctx = cursorContext(cm.state.doc.toString(), word.from);

    // a scalar list item (`- "AE"` under Scope, `- "AETERM"` under Output_Variables) completes
    // like a value: enum values of the list's items, then variables — under Scope the axis'
    // known values instead (scopeAxisValues), never variables
    const listItem = ctx.kind === "key" && ctx.path[ctx.path.length - 1] === ITEM;
    if (listItem) {
      const enums = engine.schema ? enumAt(engine.schema, ctx.path) : [];
      if (ctx.path[0] === "Scope") return scopeResult(cm, engine, scopeAxisAt(ctx), enums);
      const options: Completion[] = [];
      const quoted = word.from > 0 && cm.state.sliceDoc(word.from - 1, word.from) === '"';
      for (const value of enums) {
        options.push({ label: value, type: "enum", apply: quoted ? value : `"${value}"` });
      }
      for (const v of variablesOf(engine.analysis)) {
        options.push({ label: v.name ?? "", type: v.classLevel ? "class" : "variable" });
      }
      options.push(...qualifiedValueOptions(engine, ctx, cm));
      return wordResult(engine, word, options);
    }
    if (ctx.kind === "key") {
      if (!engine.schema) return null;
      const keys = keysAt(engine.schema, ctx.path);
      if (keys.length === 0) return null;
      const options: Completion[] = keys.map((k) => ({
        label: k.name,
        type: "property",
        detail: k.required ? "required" : undefined,
        info: k.description ?? undefined,
        apply: `${k.name}: `,
      }));
      return { from: word.from, options, validFor: /^[\w-]*$/ };
    }

    const options: Completion[] = [];
    const key = ctx.key ?? "";
    const enums = engine.schema ? enumAt(engine.schema, [...ctx.path, key]) : [];
    // a scalar under Scope (`Include: "…"`, `Include: [ … ]`): the axis' known values — only
    // under an axis' Include / Exclude — and the schema's enum values, never variables
    if (ctx.path[0] === "Scope") return scopeResult(cm, engine, scopeAxisAt(ctx), enums);
    const quoted = word.from > 0 && cm.state.sliceDoc(word.from - 1, word.from) === '"';
    for (const value of enums) {
      options.push({ label: value, type: "enum", apply: quoted ? value : `"${value}"` });
    }
    const expression = ctx.blockScalar || EXPRESSION_KEYS.has(key);
    // inside an expression: where the grammar wants an operator, only operators (owner 2026-10-08)
    const position = expressionPositionAt(cm.state.doc.toString(), word.from, key);
    if (position.kind === "operator") return operatorResult(cm, word.from, position.operators);
    if (ctx.path[0] === "Match_Datasets" && key === "Filter") {
      return wordResult(engine, word, [...options, ...filterOptions(engine, cm, position)]);
    }
    for (const v of variablesOf(engine.analysis)) {
      const where = v.classLevel ? (v.concrete ?? []).join(", ") : (v.datasets ?? []).join(", ");
      options.push({
        label: v.name ?? "",
        type: v.classLevel ? "class" : "variable",
        detail: [v.type, where].filter(Boolean).join(" · "),
        info: [v.label, (v.products ?? []).join(", ")].filter(Boolean).join(" — ") || undefined,
        boost: v.classLevel ? 1 : 0,
      });
    }
    if (expression) {
      if (position.kind === "operand" && position.call) {
        const named = namedArgumentOptions(engine.functions, position.call);
        // after a keyword argument only another one parses ("Positional argument after keyword
        // argument", CheckExpressionParser.parseArg)
        if (position.call.named.length > 0) {
          return named.length ? { from: word.from, options: named, validFor: /^[\w$&.-]*$/ } : null;
        }
        options.push(...named);
      }
      for (const name of engine.analysis?.bindings ?? []) {
        options.push({ label: name, type: "variable", detail: "binding", boost: 2 });
      }
      // the flag only where a boolean stands (StageAChecker.collectMatchedFlags)
      options.push(...joinedOptions(engine, position.kind === "operand" && !!position.boolean));
      options.push(...functionOptions(engine.functions));
    } else {
      options.push(...qualifiedValueOptions(engine, ctx, cm));
    }
    return wordResult(engine, word, options);
  };
}

/** The functions, applied as `name()`. */
function functionOptions(functions: FunctionInfoT[]): Completion[] {
  return functions.map((f) => {
    const summary = f.summary;
    return {
      label: f.name ?? "",
      type: "function",
      detail: f.signature ?? undefined,
      // the guide's summary: first sentence, inline markdown rendered, the rest behind "more…"
      info: summary ? () => renderSummary(summary) : undefined,
      apply: applyFunction(f.name ?? ""),
    };
  });
}

/** The calls a `Filter` may not make: no joined rows to quantify over before the join. */
const NOT_IN_FILTER = new Set([JOINED, "any", "all", "none"]);

/**
 * The completion inside a `Match_Datasets` entry's `Filter`. The filter is evaluated on that
 * dataset's OWN rows before the join (`StageAChecker.checkFilterRefs`): a dotted name, a
 * `_matched_` flag or a `$binding` is FILTER_LEFT_REFERENCE, a wildcard and a quantifier /
 * `joined(…)` FILTER_INVALID. So: the entry's own variables bare (from the analysis' `joined`,
 * the entry found by the `Name` of the entry the cursor is in; none for an entry the server does
 * not list), named arguments at a call's argument, and the functions but those four.
 */
function filterOptions(
  engine: EngineContext,
  cm: CompletionContext,
  position: ExpressionPosition,
): Completion[] {
  const options: Completion[] = [];
  const entry = entryAt(cm.state.doc.toString(), cm.pos);
  const joined = entry ? joinedNamed(engine.analysis, entry.name) : undefined;
  for (const v of joined?.variables ?? []) {
    if (!v.name || v.classLevel) continue;
    options.push({
      label: v.name,
      type: "variable",
      detail: [`${joined!.name}`, v.type].filter(Boolean).join(" · "),
      info: v.label || undefined,
    });
  }
  if (position.kind === "operand" && position.call) {
    const named = namedArgumentOptions(engine.functions, position.call);
    if (position.call.named.length > 0) return named;
    options.push(...named);
  }
  options.push(
    ...functionOptions(engine.functions.filter((f) => !NOT_IN_FILTER.has(f.name ?? ""))),
  );
  return options;
}

/** The `Match_Datasets` entry (block style) the offset `pos` is in, by its `Name`. */
function entryAt(doc: string, pos: number) {
  const entries = matchEntries(doc);
  let index = -1;
  entries.forEach((e, i) => {
    if (e.from <= pos) index = i;
  });
  return index < 0 ? undefined : { ...entries[index], index, entries };
}

/**
 * The qualified joined names a non-expression value offers (a list item or an inline / flow
 * value): `Output_Variables`, `Requirements.Variables.All` / `All_Or_None` and the like carry
 * `DM.USUBJID` — never `_matched_`, a flag and no variable. Under `Match_Datasets` only a `Keys`
 * item: a qualified key names an EARLIER entry, an inner one ({@link keyOptions}).
 */
function qualifiedValueOptions(
  engine: EngineContext,
  ctx: CursorContext,
  cm: CompletionContext,
): Completion[] {
  if (ctx.path[0] !== "Match_Datasets") return joinedOptions(engine, false);
  const p = ctx.path;
  const keysItem = ctx.kind === "key" && p.length === 4 && p[2] === "Keys" && p[3] === ITEM;
  const keysValue = ctx.kind === "value" && p.length === 2 && ctx.key === "Keys";
  return keysItem || keysValue ? keyOptions(engine, cm) : [];
}

/**
 * The qualified keys a `Match_Datasets` entry's `Keys` may name (guide authoring/joins.md "A
 * qualified key"): `<D>.<VAR>` of an entry BEFORE the current one — the source must be bound
 * before this join runs — that is an ordinary inner join (a `left` source is refused; the
 * server lists only ordinary keyed entries), never a wildcard.
 */
function keyOptions(engine: EngineContext, cm: CompletionContext): Completion[] {
  const at = entryAt(cm.state.doc.toString(), cm.pos);
  if (!at) return [];
  const earlier = at.entries
    .slice(0, at.index)
    .map((e) => joinedNamed(engine.analysis, e.name))
    .filter((j): j is JoinedDatasetT => !!j && !isLeftJoin(j));
  return joinedOptions(engine, false, earlier).filter((o) => o.type !== "class");
}

/** The completion word: `[\w$&.-]*` keeps the dot, so a qualified name is one word. */
interface Word {
  from: number;
  text: string;
}

/**
 * The result for the word before the cursor. A word qualified by a joined dataset (`DM.`,
 * `dm.RF` — the qualifier matched case-insensitively, the names ruling) narrows the list to that
 * dataset's entries, and stays valid only while the qualifier is typed; the range is the whole
 * qualified word, so taking `DM.RFSTDTC` replaces `DM.RF`.
 */
function wordResult(
  engine: EngineContext,
  word: Word,
  options: Completion[],
): CompletionResult | null {
  const dot = word.text.indexOf(".");
  const typed = dot > 0 ? word.text.slice(0, dot).toUpperCase() : "";
  const joined = typed
    ? joinedOf(engine.analysis).find((j) => j.name!.toUpperCase() === typed)
    : undefined;
  if (joined) {
    const prefix = `${joined.name!.toUpperCase()}.`;
    const narrowed = options.filter((o) => o.label.toUpperCase().startsWith(prefix));
    const validFor = new RegExp(`^${escapeRegex(joined.name!)}\\.[\\w$&.-]*$`, "i");
    return narrowed.length ? { from: word.from, options: narrowed, validFor } : null;
  }
  return options.length ? { from: word.from, options, validFor: /^[\w$&.-]*$/ } : null;
}

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The qualified names of the datasets the rule joins via `Match_Datasets` (`only`: those of these
 * entries), from the analysis' `joined` (absent from an older server or without a join: nothing;
 * without a store the names come with no variables): `<Name>.<VAR>` for every variable listed for
 * the dataset and, at a boolean position of an expression (`matched`), the flag `<Name>._matched_`
 * of a `left` join — with an inner one it is constant-true and refused ({@link isLeftJoin}).
 */
export function joinedOptions(
  engine: EngineContext,
  matched: boolean,
  only?: JoinedDatasetT[],
): Completion[] {
  const options: Completion[] = [];
  for (const j of only ?? joinedOf(engine.analysis)) {
    for (const v of j.variables ?? []) {
      if (!v.name) continue;
      options.push({
        label: `${j.name}.${v.name}`,
        type: v.classLevel ? "class" : "variable",
        detail: [`joined ${j.name}`, v.type].filter(Boolean).join(" · "),
        info: v.label || undefined,
      });
    }
    if (matched && isLeftJoin(j)) {
      options.push({
        label: `${j.name}.${MATCHED}`,
        type: "variable",
        detail: "join matched — boolean",
        info: `true on a row that found a partner in ${j.name}`,
      });
    }
  }
  return options;
}

/**
 * Where the cursor is in the expression of `key` (only the {@link EXPRESSION_KEYS}; another
 * key's value is `unknown`, and so is a position the scan cannot place — the operand list).
 */
export function expressionPositionAt(doc: string, pos: number, key: string): ExpressionPosition {
  if (!EXPRESSION_KEYS.has(key)) return { kind: "unknown" };
  const text = expressionBefore(doc, pos, key);
  return text === null ? { kind: "unknown" } : classifyExpression(text);
}

/**
 * The operators valid at an operator position, applied with the spaces around them that are not
 * already there (`X)` + `and` gives `X) and `; a line end still gets the space after).
 */
function operatorResult(
  cm: CompletionContext,
  from: number,
  operators: string[],
): CompletionResult {
  const spaceBefore = from > 0 && !/\s/.test(cm.state.sliceDoc(from - 1, from)) ? " " : "";
  const after = cm.state.sliceDoc(cm.pos, cm.pos + 1);
  const spaceAfter = /[ \t]/.test(after) ? "" : " ";
  const options: Completion[] = operators.map((op) => ({
    label: op,
    type: "keyword",
    detail: OPERATOR_DETAIL[op],
    apply: `${spaceBefore}${op}${spaceAfter}`,
  }));
  return { from, options, validFor: /^[\w$&.-]*$/ };
}

/**
 * The parameters of the call the cursor starts an argument of, as named arguments `name=` (the
 * engine's `CheckExpressionParser.parseArg`: an identifier directly followed by `=`; every
 * parameter can be named, guide §Arguments). Names match exactly, as the engine's do
 * (`FunctionRegistry.descriptor`, `ArgumentBinder.indexOf`). Left out: the ones already given by
 * name, the ones already bound by position (naming one again is an error), every parameter of a
 * collector function (it absorbs its positionals as one list), and `joined` (it takes exactly one
 * condition, never a keyword argument).
 */
export function namedArgumentOptions(functions: FunctionInfoT[], call: CallArgument): Completion[] {
  if (call.name === JOINED) return [];
  const f = functions.find((fn) => fn.name === call.name);
  const parameters = f?.parameters ?? [];
  if (parameters.some((p) => p.collector)) return [];
  const given = new Set(call.named);
  return parameters
    .filter((p, i) => !!p.name && i >= call.positionals && !given.has(p.name))
    .map((p) => {
      const description = p.description;
      return {
        label: `${p.name}=`,
        type: "property",
        detail: [displayType(p.type), p.required ? "required" : "optional"]
          .filter(Boolean)
          .join(" · "),
        info: description ? () => renderMarkdownLine(description) : undefined,
        apply: `${p.name}=`,
        boost: 3,
      };
    });
}

/**
 * A function completion's apply: `name()` with the caret between the brackets, so the buffer
 * stays an expression; when a `(` already follows the cursor, only the name, and the caret moves
 * past that `(`.
 */
export function applyFunction(name: string) {
  return (view: EditorView, completion: Completion, from: number, to: number): void => {
    const paren = view.state.sliceDoc(to, to + 1) === "(";
    view.dispatch({
      changes: { from, to, insert: paren ? name : `${name}()` },
      selection: { anchor: from + name.length + 1 },
      scrollIntoView: true,
      userEvent: "input.complete",
      annotations: pickedCompletion.of(completion),
    });
  };
}

/**
 * The known values of one Scope axis, from the analysis' scope universe — every dataset (SDTM,
 * SEND) or data structure (ADaM) of the rule's Standards, admitted or not, as the metadata store
 * knows them. Without a store the universe is empty and so is this list.
 *
 * - `Domains`, `Datasets`: the dataset names of the non-ADaM products (an ADaM product names
 *   structures, not datasets);
 * - `Classes`: the observation classes (EVENTS, …) and the ADaM structure tokens (an ADaM
 *   `Classes` scope names structure tokens — the engine judges it that way);
 * - `Data_Structures`: the ADaM structure tokens (SUBJECT LEVEL ANALYSIS DATASET, …). An SDTM
 *   dataset's `dataStructure` is its prose structure ("One record per …"), never a token: skipped.
 * - any other axis (`Subclasses`, …): nothing — the analysis carries no values for it.
 */
/**
 * An ADaM product key. The scope universe's keys are metadata-store keys
 * (`MetadataProductKeys.standardsKey`): `standards/adam/adamig-1-3`, `standards/adam/adam-occds-1-1`
 * — every ADaM product normalises to family `adam` — beside `standards/sdtmig/3-4`,
 * `standards/sendig/3-1`; a bare `adamig-1-3` is accepted too.
 */
export const ADAM_PRODUCT = /^(?:standards\/)?adam/i;

export function scopeAxisValues(engine: EngineContext, axis: string | undefined): string[] {
  const datasets = engine.analysis?.scope?.datasets ?? [];
  const adam = (product?: string) => ADAM_PRODUCT.test(product ?? "");
  const values: (string | undefined)[] = [];
  for (const d of datasets) {
    if (axis === "Domains" || axis === "Datasets") {
      if (!adam(d.product)) values.push(d.name);
    } else if (axis === "Classes") {
      values.push(d.datasetClass);
    } else if (axis === "Data_Structures") {
      if (adam(d.product)) values.push(d.dataStructure);
    }
  }
  return [...new Set(values.filter((v): v is string => !!v && v.trim() !== ""))].sort();
}

/**
 * The Scope axis whose values the cursor is at: a list item of `Scope.<axis>.Include` /
 * `.Exclude`, or that key's inline value (a scalar or a flow sequence). Anything else under Scope
 * (`include_split_datasets`, …) is no axis.
 */
export function scopeAxisAt(ctx: CursorContext): string | undefined {
  const p = ctx.path;
  const included = (k: string | undefined) => k === "Include" || k === "Exclude";
  if (ctx.kind === "key") {
    return p.length === 4 && included(p[2]) && p[3] === ITEM ? p[1] : undefined;
  }
  return p.length === 2 && included(ctx.key) ? p[1] : undefined;
}

/** A YAML scalar on one line: where its text starts and how it is quoted. */
export interface LineScalar {
  /** The offset in the line of the scalar's first character (after an opening quote). */
  start: number;
  quote: '"' | "'" | null;
}

/** Where the value region of a line starts: after its indentation, a `- ` and a `key:`. */
const VALUE_REGION =
  /^\s*(?:-(?:\s+|$))?(?:(?:[A-Za-z_$][\w$.-]*|"[^"]*"|'[^']*')\s*:(?=\s|$)\s*)?/;

/**
 * The scalar the cursor (at `col` of `line`) is in — plain, `'…'` or `"…"`, a list item's, a
 * key's inline value, or an element of a flow sequence `[a, "b", …]` — or, between scalars, an
 * empty plain one at the cursor. `null` past a closed quoted scalar (nothing to complete there).
 */
export function scalarAt(line: string, col: number): LineScalar | null {
  let start = -1;
  let quote: LineScalar["quote"] = null;
  let closed = false;
  for (let i = VALUE_REGION.exec(line)![0].length; i < col; i++) {
    const c = line[i];
    if (start >= 0 && quote && !closed) {
      if (quote === '"' && c === "\\") i++;
      else if (quote === "'" && c === "'" && line[i + 1] === "'" && i + 1 < col) i++;
      else if (c === quote) closed = true;
      continue;
    }
    if (c === "[" || c === "," || c === "]") {
      start = -1;
      quote = null;
      closed = c === "]";
    } else if (/\s/.test(c)) {
      // a plain scalar may hold spaces: it goes on
    } else if (closed) {
      return null; // text after a closed quoted scalar
    } else if (start < 0) {
      quote = c === '"' || c === "'" ? c : null;
      start = quote ? i + 1 : i;
    }
  }
  if (closed) return null;
  return start < 0 ? { start: col, quote: null } : { start, quote };
}

/** A value as the text of a scalar quoted by `quote`; a plain one becomes `"…"`. */
function quotedFor(value: string, quote: LineScalar["quote"]): string {
  if (quote === "'") return value.replace(/'/g, "''");
  const escaped = value.replace(/[\\"]/g, "\\$&");
  return quote === '"' ? escaped : `"${escaped}"`;
}

/**
 * The Scope result: the schema's enum values and, at an axis' Include / Exclude, the axis' known
 * values. A structure token has spaces ("SUBJECT LEVEL ANALYSIS DATASET") and the completion word
 * stops at one, so the replaced range is the whole scalar the cursor is in — typing
 * `SUBJECT LE` (plain, `'…'` or `"…"`) and taking the token must not leave `SUBJECT ` behind; a
 * plain scalar is replaced by a `"…"` one, a quoted one keeps its quotes.
 */
function scopeResult(
  cm: CompletionContext,
  engine: EngineContext,
  axis: string | undefined,
  enums: string[],
): CompletionResult | null {
  const line = cm.state.doc.lineAt(cm.pos);
  const scalar = scalarAt(line.text, cm.pos - line.from);
  if (!scalar) return null;
  const options: Completion[] = [
    ...enums.map((value) => ({
      label: value,
      type: "enum",
      apply: quotedFor(value, scalar.quote),
    })),
    ...(axis ? scopeAxisOptions(engine, axis, scalar.quote) : []),
  ];
  return options.length
    ? { from: line.from + scalar.start, options, validFor: /^[\w$&. -]*$/ }
    : null;
}

function scopeAxisOptions(
  engine: EngineContext,
  axis: string,
  quote: LineScalar["quote"],
): Completion[] {
  const where = (value: string) =>
    (engine.analysis?.scope?.datasets ?? [])
      .filter((d) => d.datasetClass === value || d.dataStructure === value)
      .map((d) => d.name ?? "")
      .filter(Boolean);
  return scopeAxisValues(engine, axis).map((value) => {
    const names = axis === "Classes" || axis === "Data_Structures" ? where(value) : [];
    return {
      label: value,
      type: "constant",
      detail: names.length
        ? names.slice(0, 6).join(", ") + (names.length > 6 ? ", …" : "")
        : undefined,
      apply: quotedFor(value, quote),
      boost: 1,
    };
  });
}

/**
 * The autocompletion extension of the rule editor, reading its context lazily. It opens only on
 * request — Ctrl+Space (CodeMirror's completion keymap; owner 2026-10-08: never while typing);
 * once open, typing narrows the list.
 */
export function ruleCompletion(getContext: () => EngineContext): Extension {
  return autocompletion({ override: [ruleCompletionSource(getContext)], activateOnTyping: false });
}
