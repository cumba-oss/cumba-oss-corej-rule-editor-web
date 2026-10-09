/**
 * Where the cursor is inside a rule-language expression, by a lexer-level scan of the expression
 * text up to the cursor — what the completion offers there (owner 2026-10-08):
 *
 * - an **operand** position (the start, after an operator, after `(` `[` `,`, a keyword
 *   argument's `=` or a sided member's `left:` / `right:`): variables, bindings, functions — and,
 *   directly at an argument of a call, that function's parameters as named arguments;
 * - an **operator** position (after a complete operand): only the operators valid there.
 *
 * The scan mirrors the engine's lexer (`cumba-corej-core` `core/expr/ExpressionLexer.java`) and
 * parser (`CheckExpressionParser.java`): `"…"` strings with backslash escapes, `` `…` `` quoted
 * references, `/…/` regexes in operand position, identifiers with `- . * $` inside and `&NAME&`
 * tokens, the keywords in any case (`AND` is `and`), the contextual arithmetic `+ - * /` (an
 * operator only after an operand), the `~` substitution with its `/pattern/replacement/` literal,
 * and the sided group member `{left: X, right: Y}` as a frame of its own. A `'…'` string
 * is not in the language, but is skipped as one so that its content never reads as code. Anything
 * the scan cannot place — an unterminated string, a stray character, an unbalanced bracket — is
 * `unknown`, and the completion then falls back to the operand list rather than hide things.
 */

import { MATCHED_FLAG } from "./engineContext";
import { BLOCK_SCALAR } from "./yamlPath";

/** A call whose argument the cursor starts: what its earlier arguments already bound. */
export interface CallArgument {
  /** The function name. */
  name: string;
  /** How many positional arguments precede the cursor's one. */
  positionals: number;
  /** The keyword arguments already given (`name=` …), in order. */
  named: string[];
}

export type ExpressionPosition =
  | { kind: "unknown" }
  | {
      kind: "operand";
      call?: CallArgument;
      /**
       * A boolean position, where a join-match flag `<D>._matched_` may stand
       * (`StageAChecker.collectMatchedFlags`): a whole condition's frame (the top level, a group
       * opened at a boolean position, the argument of `joined(…)`), at its start or right after
       * `and` / `or` / `not` — never after a comparison, `in` or an arithmetic operator.
       */
      boolean?: boolean;
    }
  | { kind: "operator"; operators: string[] };

/**
 * The operators of the rule language, in the order the list shows them. Source: the engine's
 * `TokenType` / `ExpressionLexer.KEYWORDS` and `CheckExpressionParser.parseComparison` / `parseSum`
 * / `parseProduct` / `parseOr` / `parseAnd`; the guide's reference/expression-syntax.md §Operators.
 * `&&` / `||` are accepted by the lexer but deliberately not offered: the guide prefers the word
 * forms and nothing in the corpus uses them.
 */
export const COMPARISON_OPERATORS = ["==", "!=", "<", "<=", ">", ">=", "=~", "!~"] as const;
export const MEMBERSHIP_OPERATORS = ["in", "not in"] as const;
export const ARITHMETIC_OPERATORS = ["+", "-", "*", "/"] as const;
/**
 * `X ~ /pattern/replacement/` (`CheckExpressionParser.parsePostfix`): a postfix on an operand,
 * binding tighter than `* /` — offered wherever arithmetic is (the lexer's `afterOperand`).
 */
export const SUBSTITUTION_OPERATORS = ["~"] as const;
export const LOGICAL_OPERATORS = ["and", "or"] as const;

/** What an operator does, for the completion's detail column. */
export const OPERATOR_DETAIL: Record<string, string> = {
  "==": "equal",
  "!=": "not equal",
  "<": "less than",
  "<=": "less than or equal",
  ">": "greater than",
  ">=": "greater than or equal",
  "=~": "matches a /regex/ (a find)",
  "!~": "does not match a /regex/",
  in: "the value is in the set",
  "not in": "the value is not in the set",
  "+": "add",
  "-": "subtract",
  "*": "multiply",
  "/": "divide",
  "~": "replace the first match: ~ /pattern/replacement/",
  and: "all operands true",
  or: "at least one true",
};

type Kind =
  | "operand" // a number, string or quoted reference: arithmetic may follow
  | "literal" // a regex, `true`, `false`: an operand the lexer reads no arithmetic after
  | "subst" // `~`: only its /pattern/replacement/ literal may follow (an "operand" then)
  | "ident" // an identifier (also an operand) — a call when `(` follows
  | "flag" // a join-match flag `<D>._matched_`: a boolean condition, only and / or may follow
  | "lparen"
  | "rparen"
  | "lbracket"
  | "rbracket"
  | "lbrace"
  | "rbrace" // ends the sided member; the lexer reads no arithmetic after it
  | "comma"
  | "eq" // a single `=`: a keyword argument's separator
  | "colon" // a sided member's key separator
  | "compare" // == != < <= > >= =~ !~
  | "arith"
  | "and"
  | "or"
  | "not"
  | "in";

interface Frame {
  /** `sided`: the group member `{left: X, right: Y}` (`CheckExpressionParser.parseSided`). */
  kind: "group" | "call" | "list" | "sided";
  name?: string;
  /**
   * The frame holds a whole expression (`parseOr`: the top level, a `( … )` group, the argument
   * of `joined(…)`) rather than one arithmetic operand (`parseOperand`: a list element, an
   * argument of any other call, a keyword argument's value).
   */
  full: boolean;
  positionals: number;
  named: string[];
  /** Tokens of the frame's current argument / element / group so far. */
  tokens: number;
  /** The keyword name of the current argument (`name=` seen) — or the sided key (`left:`). */
  argName?: string;
  /** A comparison / membership operator already in the current comparison (they do not chain). */
  compared: boolean;
  /** The frame stands where a boolean is expected (a group opened there, joined's argument). */
  boolean: boolean;
}

/** The one call whose argument is a whole condition (`CheckExpressionParser.parseCall`). */
export const JOINED = "joined";

/** Looked up lower-cased, as `ExpressionLexer` does (`text.toLowerCase(Locale.ROOT)`, O21). */
const KEYWORDS = new Map<string, Kind>([
  ["and", "and"],
  ["or", "or"],
  ["not", "not"],
  ["in", "in"],
  ["true", "literal"],
  ["false", "literal"],
]);

/** The closing bracket of each frame kind. */
const CLOSER: Record<Frame["kind"], string> = { group: ")", call: ")", list: "]", sided: "}" };

/** A sided member's two keys, exactly as `parseSided` compares them. */
const SIDES = new Set(["left", "right"]);

const endsOperand = (k: Kind | undefined) =>
  k === "operand" ||
  k === "literal" ||
  k === "ident" ||
  k === "flag" ||
  k === "rparen" ||
  k === "rbracket" ||
  k === "rbrace";

/**
 * `ExpressionLexer.afterOperand`: `+ - * /` are arithmetic only after these (not a regex /
 * boolean / `}`; a substitution literal is an "operand"). A flag lexes as the identifier it is;
 * that arithmetic on it is refused is the checker's business, and the operator list's.
 */
const takesArithmetic = (k: Kind | undefined) =>
  k === "operand" || k === "ident" || k === "flag" || k === "rparen" || k === "rbracket";

const isLetter = (c: string) => /\p{L}/u.test(c);
const isIdentStart = (c: string) => isLetter(c) || c === "_" || c === "$" || c === "*";
const isIdentPart = (c: string) => /[\p{L}\p{N}_.*$-]/u.test(c);

/** The end of an `&NAME&` token at `at` (exclusive), or -1 (ExpansionTokens.TOKEN / tokenEndAt). */
function expansionEnd(text: string, at: number): number {
  const m = /^&[A-Z][A-Z0-9]*&/.exec(text.slice(at));
  return m ? at + m[0].length : -1;
}

/**
 * The end of a delimited literal starting at `at` (exclusive), or -1 when unterminated. A backslash
 * takes the next character with it — `\/` the delimiter, `\\` a backslash (the regex literal's
 * `scanSlashDelimited`).
 */
function delimitedEnd(text: string, at: number, close: string): number {
  for (let i = at + 1; i < text.length; i++) {
    if (text[i] === "\\") i++;
    else if (text[i] === close) return i + 1;
  }
  return -1;
}

/** The end of an identifier at `at` (with `${…}` and `&NAME&` inside), or -1 when malformed. */
function identEnd(text: string, at: number): number {
  let i = at;
  while (i < text.length) {
    const c = text[i];
    if (c === "$" && text[i + 1] === "{") {
      const close = text.indexOf("}", i);
      if (close < 0) return -1;
      i = close + 1;
    } else if (c === "&") {
      if (text[i + 1] === "&") break;
      const end = expansionEnd(text, i);
      // a malformed token, or two tokens back to back (`&A&&B&`: ExpansionTokens.ADJACENCY)
      if (end < 0 || text[end] === "&") return -1;
      i = end;
    } else if (isIdentPart(c)) {
      i++;
    } else {
      break;
    }
  }
  return i;
}

/**
 * Classifies the position at the END of `text` — the expression from its start up to (not
 * including) the word being completed.
 */
export function classifyExpression(text: string): ExpressionPosition {
  const unknown: ExpressionPosition = { kind: "unknown" };
  const stack: Frame[] = [
    {
      kind: "group",
      full: true,
      positionals: 0,
      named: [],
      tokens: 0,
      compared: false,
      boolean: true,
    },
  ];
  const top = () => stack[stack.length - 1];
  let prev: Kind | undefined;
  let beforePrev: Kind | undefined;
  let prevText = "";
  /** The last `=` was not a keyword argument's (a stray or half-typed `==`). */
  let strayEq = false;

  /** Whether the next operand stands where a boolean is expected (see the result's `boolean`). */
  const atBoolean = (): boolean => {
    const frame = top();
    if (!frame.full || !frame.boolean) return false;
    if (frame.tokens === 0 || prev === "and" || prev === "or") return true;
    // `not` at the frame's start or after and / or / not
    return (
      prev === "not" &&
      (frame.tokens === 1 || beforePrev === "and" || beforePrev === "or" || beforePrev === "not")
    );
  };

  const emit = (kind: Kind, value = "") => {
    const frame = top();
    if (kind === "compare" || kind === "in") frame.compared = true;
    if (kind === "and" || kind === "or") frame.compared = false;
    frame.tokens++;
    beforePrev = prev;
    prev = kind;
    prevText = value;
  };

  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    strayEq = false;
    if (takesArithmetic(prev) && "+-*/".includes(c)) {
      emit("arith", c);
      i++;
      continue;
    }
    const two = text.slice(i, i + 2);
    if (prev === "subst") {
      // ExpressionLexer: directly after `~` a `/` opens the /pattern/replacement/ literal, and
      // parsePostfix takes nothing else there
      if (c !== "/") return unknown;
      const patternEnd = delimitedEnd(text, i, "/");
      const end = patternEnd < 0 ? -1 : delimitedEnd(text, patternEnd - 1, "/");
      if (end < 0) return unknown; // the cursor is inside the literal
      emit("operand");
      i = end;
    } else if (c === '"' || c === "'" || c === "`") {
      const end = delimitedEnd(text, i, c);
      if (end < 0) return unknown; // the cursor is inside a string / quoted reference
      emit("operand");
      i = end;
    } else if (c === "/") {
      const end = delimitedEnd(text, i, "/");
      if (end < 0) return unknown;
      emit("literal");
      i = end;
    } else if (c === "(") {
      const call = prev === "ident";
      const name = prevText;
      // `joined(…)`'s argument is a boolean position wherever the call stands (collectMatchedFlags)
      const boolean = call ? name === JOINED : atBoolean();
      emit("lparen");
      stack.push({
        kind: call ? "call" : "group",
        name: call ? name : undefined,
        // `joined` is matched exactly, as the parser does (JoinedRowFold.JOINED.equals)
        full: !call || name === JOINED,
        positionals: 0,
        named: [],
        tokens: 0,
        compared: false,
        boolean,
      });
      i++;
    } else if (c === "[") {
      emit("lbracket");
      stack.push({
        kind: "list",
        full: false,
        positionals: 0,
        named: [],
        tokens: 0,
        compared: false,
        boolean: false,
      });
      i++;
    } else if (c === "{") {
      emit("lbrace");
      stack.push({
        kind: "sided",
        full: false,
        positionals: 0,
        named: [],
        tokens: 0,
        compared: false,
        boolean: false,
      });
      i++;
    } else if (c === ")" || c === "]" || c === "}") {
      const frame = stack.pop();
      if (!frame || stack.length === 0 || CLOSER[frame.kind] !== c) return unknown;
      emit(c === ")" ? "rparen" : c === "]" ? "rbracket" : "rbrace");
      i++;
    } else if (c === ":") {
      const frame = top();
      // a sided key: `left` / `right` opening a member of `{…}`; a `:` anywhere else is no grammar
      if (frame.kind !== "sided" || prev !== "ident" || frame.tokens !== 1) return unknown;
      if (!SIDES.has(prevText)) return unknown;
      frame.argName = prevText;
      beforePrev = prev;
      prev = "colon";
      i++;
    } else if (c === ",") {
      const frame = top();
      if (frame.kind === "call") {
        if (frame.argName) frame.named.push(frame.argName);
        else if (frame.tokens > 0) frame.positionals++;
      }
      beforePrev = prev;
      prev = "comma";
      frame.tokens = 0;
      frame.argName = undefined;
      frame.compared = false;
      i++;
    } else if (two === "==" || two === "!=" || two === "=~" || two === "!~") {
      emit("compare", two);
      i += 2;
    } else if (c === "~") {
      emit("subst", c);
      i++;
    } else if (c === "=") {
      const frame = top();
      // a keyword argument: `name=` opening an argument of a call (never of joined, which takes
      // exactly one condition)
      if (frame.kind === "call" && !frame.full && prev === "ident" && frame.tokens === 1) {
        frame.argName = prevText;
      } else {
        strayEq = true;
      }
      beforePrev = prev;
      prev = "eq";
      i++;
    } else if (c === "<" || c === ">") {
      const op = text[i + 1] === "=" ? two : c;
      emit("compare", op);
      i += op.length;
    } else if (c === "!") {
      emit("not");
      i++;
    } else if (two === "&&") {
      emit("and");
      i += 2;
    } else if (two === "||") {
      emit("or");
      i += 2;
    } else if (/\d/.test(c) || (c === "-" && /\d/.test(text[i + 1] ?? ""))) {
      // ExpressionLexer.scanNumber: `-?\d+(\.\d+)?` — no exponent (`1e5` is `1` then `e5`)
      const m = /^-?\d+(?:\.\d+)?/.exec(text.slice(i))!;
      emit("operand");
      i += m[0].length;
    } else if (isIdentStart(c) || c === "&" || two === "--") {
      const end = identEnd(text, i);
      if (end < 0 || end === i) return unknown;
      const word = text.slice(i, end);
      const keyword = KEYWORDS.get(word.toLowerCase());
      emit(keyword ?? (MATCHED_FLAG.test(word) ? "flag" : "ident"), word);
      i = end;
    } else {
      return unknown;
    }
  }

  if (strayEq) return unknown;
  const frame = top();
  // right after `~`: only the /pattern/replacement/ literal parses — nothing to offer
  if (prev === "subst") return { kind: "operator", operators: [] };
  // a sided member before its `:` — at the key, or between key and `:` — offers no operand
  if (frame.kind === "sided" && frame.argName === undefined) return unknown;
  if (prev === "flag") {
    // a boolean condition (D88b): no comparison, membership or arithmetic on it — and outside a
    // whole condition's frame it is misused anyway
    return { kind: "operator", operators: frame.full ? [...LOGICAL_OPERATORS] : [] };
  }
  if (endsOperand(prev)) {
    const arithmetic = takesArithmetic(prev)
      ? [...ARITHMETIC_OPERATORS, ...SUBSTITUTION_OPERATORS]
      : [];
    // a list element, a call argument (but joined's), a keyword value, a sided member's side: one
    // arithmetic operand
    if (!frame.full) return { kind: "operator", operators: arithmetic };
    const operators: string[] = [];
    if (!frame.compared) operators.push(...COMPARISON_OPERATORS, ...MEMBERSHIP_OPERATORS);
    operators.push(...arithmetic, ...LOGICAL_OPERATORS);
    return { kind: "operator", operators };
  }
  // `X not ` — only `in` completes it, where a membership test can stand
  if (prev === "not" && endsOperand(beforePrev)) {
    return frame.full && !frame.compared ? { kind: "operator", operators: ["in"] } : unknown;
  }
  const boolean = atBoolean();
  if (frame.kind === "call" && frame.tokens === 0 && frame.name) {
    return {
      kind: "operand",
      call: { name: frame.name, positionals: frame.positionals, named: [...frame.named] },
      ...(boolean ? { boolean } : {}),
    };
  }
  return boolean ? { kind: "operand", boolean } : { kind: "operand" };
}

/** Undo a YAML double-quoted scalar's escapes (`\"`, `\\`; any other escape keeps its char). */
function unescapeDouble(body: string): string | null {
  let out = "";
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c === "\\") {
      if (i + 1 < body.length) out += body[++i];
    } else if (c === '"') {
      return null; // the scalar closed before the cursor
    } else {
      out += c;
    }
  }
  return out;
}

/** Undo a YAML single-quoted scalar's escape (`''`). */
function unescapeSingle(body: string): string | null {
  let out = "";
  for (let i = 0; i < body.length; i++) {
    if (body[i] !== "'") out += body[i];
    else if (body[i + 1] === "'") out += body[++i];
    else return null; // the scalar closed before the cursor
  }
  return out;
}

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The expression text of `key`'s value from its start up to `pos`, YAML quoting undone — an
 * inline value (plain, `"…"` or `'…'`, possibly continued on later lines) or a block scalar
 * (`>-`, `|`) whose lines run up to the cursor. `null` when it cannot be found, or the cursor
 * is past a quoted scalar's closing quote.
 */
export function expressionBefore(doc: string, pos: number, key: string): string | null {
  const keyLine = new RegExp(
    `^(\\s*)(?:-\\s+)?(?:${escapeRegex(key)}|"${escapeRegex(key)}"|'${escapeRegex(key)}')\\s*:(?=\\s|$)`,
  );
  const lineStart = doc.lastIndexOf("\n", pos - 1) + 1;
  let start = lineStart;
  let minIndent = Number.POSITIVE_INFINITY;
  // walk up from the cursor's line to the key line: the first one declaring `key` that is
  // less indented than every line of the value below it
  for (;;) {
    const end = doc.indexOf("\n", start);
    const line = doc.slice(start, end < 0 || end > pos ? pos : end);
    const m = keyLine.exec(line);
    const indent = /^\s*/.exec(line)![0].length;
    if (m && (start === lineStart || m[1].length < minIndent)) {
      const value = doc.slice(start + m[0].length, pos);
      const first = value.split("\n", 1)[0].trim();
      if (BLOCK_SCALAR.test(first)) {
        const nl = value.indexOf("\n");
        return nl < 0 ? "" : value.slice(nl + 1);
      }
      const body = value.trimStart();
      if (body.startsWith('"')) return unescapeDouble(body.slice(1));
      if (body.startsWith("'")) return unescapeSingle(body.slice(1));
      return body;
    }
    if (line.trim()) minIndent = Math.min(minIndent, indent);
    if (start === 0) return null;
    start = start < 2 ? 0 : doc.lastIndexOf("\n", start - 2) + 1;
  }
}
