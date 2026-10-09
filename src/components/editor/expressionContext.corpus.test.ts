import { describe, expect, it } from "vitest";
import { classifyExpression } from "./expressionContext";

/**
 * The sensitivity arm of the expression classifier: real corpus expressions (cumba-corej-rules
 * `rules-src/checks`, `Check.expression`), cut at their token boundaries. At each cut the engine's
 * next token is known — from a reference lexer below, written after `ExpressionLexer.java`, not
 * after the classifier — and the classifier must say `operator` exactly where that token is an
 * operator (and offer it), `operand` where it starts an operand, and inside an argument of any
 * call but `joined(…)` — or a sided member `{left: X, right: Y}` — never offer a comparison
 * (`parseArg` → `parseOperand`). The corpus does not yet carry the `~` substitution or a sided
 * member, so the guide's own examples (cumba-corej-rules `rule-guide/reference`) stand in for them,
 * and one corpus expression re-cased stands in for upper-case keywords (O21).
 */
const CORPUS: [string, string][] = [
  ["CDISC-AD0127", 'record_count(group=[USUBJID, PARAMCD], filter=(ABLFL == "Y"))'],
  ["CDISC-AD0152", 'max(AVAL, group=[USUBJID, PARAMCD, BASETYPE], filter=(ABLFL=="Y"))'],
  [
    "CDISC-AD0040-A",
    'upper(varname()) =~ /^.+[^D]TF$/ and not empty(value()) and value() not in ["H", "M", "S"]',
  ],
  ["CDISC-AD0015", "varname() !~ /^[A-Z0-9_]+$/"],
  ["CDISC-AD0006", "var_exists(*FL) and not empty(*FN) and *FN not in [0, 1]"],
  ["CDISC-AD0019", 'not empty(COMPLFL) and COMPLFL not in ["Y", "N"]'],
  ["CDISC-SEND-0202", 'date_diff_days(--DTC, min_date(EXSTDTC, domain="EX", group=[USUBJID])) + 1'],
  ["CDISC-SEND-0204", "date_diff_days(DS.DSSTDTC, $first_dose) + 1"],
  ["CDISC-SEND-0105.1", 'read_value(TSVAL, domain=TS, filter=(TSPARMCD=="SPECIES"), mode="FIRST")'],
  [
    "CDISC-CG0100",
    '(not var_exists("ECOCCUR") or ECOCCUR != "N") and empty(ECSTAT) and empty(ECDOSTXT) and ECDOSE <= 0',
  ],
  [
    "CDISC-AD0591",
    "not empty(&VAR&) and not empty(ADSL.&VAR&) and var_exists(&VAR&) and var_exists(ADSL.&VAR&) and &VAR& != ADSL.&VAR&",
  ],
  ["CDISC-AD0898", "var_exists(&DOM&.&DOM&SEQ) and empty(&DOM&.&DOM&SEQ)"],
  ["CDISC-AD0169", "not empty(CNSR) and (not is_integer(CNSR) or num(CNSR) < 0)"],
  ["CDISC-AD0002", "not empty($sdtm_label) and var_label() != $sdtm_label"],
  ["CDISC-AD0225", "not empty(PCHG) and PCHG != (((AVAL - BASE) / BASE) * 100)"],
  [
    "CDISC-CG0218",
    "date(SE.SESTDTC) <= date(SVSTDTC) and date(SVSTDTC) < date(SE.SEENDTC) and EPOCH != SE.EPOCH" +
      " and none(joined(not empty(earliest_possible(SE.SESTDTC)) and not empty(earliest_possible(SVSTDTC))" +
      " and date(earliest_possible(SE.SESTDTC)) <= latest_possible(SVSTDTC)" +
      " and (date(earliest_possible(SVSTDTC)) < latest_possible(SE.SEENDTC)" +
      " or date(earliest_possible(SVSTDTC)) == latest_possible(SE.SEENDTC)" +
      " and (SVSTDTC !~ /T/ or SE.SEENDTC !~ /T/)) and EPOCH == SE.EPOCH))",
  ],
  ["CDISC-AD0019 re-cased (O21)", 'NOT empty(COMPLFL) And COMPLFL NOT IN ["Y", "N"] OR FALSE'],
  ["guide expression-syntax.md ~", 'AESTDTC ~ /(?i)^(.*)DTC$/$1/ == "AEST"'],
  ["guide expression-syntax.md ~ in a call", "num(MIDS ~ /^.*?([0-9]+)$/$1/) > 0"],
  [
    "guide expression-syntax.md ~ (escapes added)",
    'coalesce(MIDS ~ /-/ /, MIDS ~ /a\\/b/\\\\/) == "HYPO 3"',
  ],
  [
    "guide functions.md sequence ~",
    "sequence(MIDS ~ /^.*?([0-9]+)$/$1/, group=[USUBJID, MIDSTYPE], by=[asc(SMSTDTC)], filter=(MIDS =~ /[0-9]$/))",
  ],
  [
    "guide functions.md sequence sided",
    'sequence(ETCD, domain="TA", group=[{left: ACTARMCD, right: ARMCD}], by=[asc(TAETORD)])',
  ],
];

type T =
  | "IDENT"
  | "NUMBER"
  | "STRING"
  | "REGEX"
  | "TRUE"
  | "FALSE"
  | "LPAREN"
  | "RPAREN"
  | "LBRACKET"
  | "RBRACKET"
  | "LBRACE"
  | "RBRACE"
  | "COLON"
  | "SUBST"
  | "SUBSTITUTION"
  | "COMMA"
  | "EQ"
  | "COMPARE"
  | "ARITH"
  | "AND"
  | "OR"
  | "NOT"
  | "IN";

interface Token {
  type: T;
  text: string;
  start: number;
}

/** ExpressionLexer.tokenize, for the token shapes the corpus above uses. */
const slashPartEnd = (src: string, from: number) => {
  let i = from;
  while (src[i] !== "/") i += src[i] === "\\" ? 2 : 1;
  return i + 1;
};

function lex(src: string): Token[] {
  const out: Token[] = [];
  const words: Record<string, T> = {
    and: "AND",
    or: "OR",
    not: "NOT",
    in: "IN",
    true: "TRUE",
    false: "FALSE",
  };
  const identPart = /[A-Za-z0-9_.*$-]/;
  let pos = 0;
  while (pos < src.length) {
    if (/\s/.test(src[pos])) {
      pos++;
      continue;
    }
    const start = pos;
    const c = src[pos];
    const prev = out[out.length - 1]?.type;
    const push = (type: T, end: number) => {
      out.push({ type, text: src.slice(start, end), start });
      pos = end;
    };
    const afterOperand =
      prev === "IDENT" ||
      prev === "NUMBER" ||
      prev === "STRING" ||
      prev === "RPAREN" ||
      prev === "RBRACKET" ||
      prev === "SUBSTITUTION";
    if (afterOperand && "+-*/".includes(c)) push("ARITH", pos + 1);
    else if (prev === "SUBST" && c === "/") {
      push("SUBSTITUTION", slashPartEnd(src, slashPartEnd(src, pos + 1)));
    } else if (c === "{") push("LBRACE", pos + 1);
    else if (c === "}") push("RBRACE", pos + 1);
    else if (c === ":") push("COLON", pos + 1);
    else if (c === "(") push("LPAREN", pos + 1);
    else if (c === ")") push("RPAREN", pos + 1);
    else if (c === "[") push("LBRACKET", pos + 1);
    else if (c === "]") push("RBRACKET", pos + 1);
    else if (c === ",") push("COMMA", pos + 1);
    else if (c === '"' || c === "/") {
      let i = pos + 1;
      while (src[i] !== c) i += src[i] === "\\" ? 2 : 1;
      push(c === '"' ? "STRING" : "REGEX", i + 1);
    } else if (/^(==|!=|=~|!~|<=|>=)/.test(src.slice(pos))) push("COMPARE", pos + 2);
    else if (c === "<" || c === ">") push("COMPARE", pos + 1);
    else if (c === "=") push("EQ", pos + 1);
    else if (c === "~") push("SUBST", pos + 1);
    else if (/\d/.test(c) || (c === "-" && /\d/.test(src[pos + 1]))) {
      push("NUMBER", pos + /^-?\d+(?:\.\d+)?/.exec(src.slice(pos))![0].length);
    } else if (/[A-Za-z_$*&]/.test(c) || src.startsWith("--", pos)) {
      let i = pos;
      while (i < src.length) {
        if (src[i] === "&") i = src.indexOf("&", i + 1) + 1;
        else if (identPart.test(src[i])) i++;
        else break;
      }
      const word = src.slice(pos, i);
      const lower = word.toLowerCase(); // KEYWORDS.get(text.toLowerCase(Locale.ROOT))
      push(Object.hasOwn(words, lower) ? words[lower] : "IDENT", i);
    } else throw new Error(`reference lexer: unexpected '${c}' at ${pos} in ${src}`);
  }
  return out;
}

const OPERAND_START: T[] = ["IDENT", "NUMBER", "STRING", "REGEX", "TRUE", "FALSE"];

describe("classifyExpression against the corpus (sensitivity arm)", () => {
  it("says operator exactly where the engine's next token is one, and never == in a call", () => {
    let operatorCuts = 0;
    let operandCuts = 0;
    let callCuts = 0;
    let substitutionCuts = 0;
    for (const [rule, expression] of CORPUS) {
      const tokens = lex(expression);
      /** The innermost frame: a call's name, `(` a group, `[` a list, `{` a sided member. */
      const frames: string[] = [];
      tokens.forEach((t, n) => {
        const prefix = expression.slice(0, t.start);
        const where = `${rule} at ${t.start}: ${JSON.stringify(prefix.slice(-30))} | ${t.text}`;
        const got = classifyExpression(prefix);
        const next = tokens[n + 1];
        // `not` directly before `in` is the operator `not in`; anywhere else the unary not
        const operator =
          t.type === "SUBST" ||
          t.type === "COMPARE" ||
          t.type === "ARITH" ||
          t.type === "AND" ||
          t.type === "OR" ||
          t.type === "IN" ||
          (t.type === "NOT" && next?.type === "IN");
        if (operator) {
          operatorCuts++;
          expect(got.kind, where).toBe("operator");
          // the list offers the keywords lower-case, whatever case the rule writes them in
          const label = t.type === "NOT" ? "not in" : t.text.toLowerCase();
          expect(got.kind === "operator" ? got.operators : [], where).toContain(label);
        } else if (t.type === "SUBSTITUTION") {
          substitutionCuts++; // after `~` only the literal parses: nothing on offer
          expect(got, where).toEqual({ kind: "operator", operators: [] });
        } else if (t.type === "IDENT" && next?.type === "COLON") {
          // a sided key (`left` / `right`), not an operand: the scan offers nothing it can place
          expect(got.kind, where).toBe("unknown");
        } else if (
          OPERAND_START.includes(t.type) ||
          t.type === "NOT" ||
          t.type === "LBRACKET" ||
          t.type === "LBRACE"
        ) {
          operandCuts++;
          expect(got.kind, where).toBe("operand");
        } else if (t.type === "LPAREN" && tokens[n - 1]?.type !== "IDENT") {
          operandCuts++; // a group's ( — a call's ( follows its name directly
          expect(got.kind, where).toBe("operand");
        }
        const frame = frames[frames.length - 1];
        if (frame && frame !== "(" && frame !== "[" && frame !== "joined") {
          callCuts++;
          expect(got.kind === "operator" ? got.operators : [], where).not.toContain("==");
        }
        if (t.type === "LPAREN") {
          frames.push(tokens[n - 1]?.type === "IDENT" ? tokens[n - 1].text : "(");
        } else if (t.type === "LBRACKET") {
          frames.push("[");
        } else if (t.type === "LBRACE") {
          frames.push("{");
        } else if (t.type === "RPAREN" || t.type === "RBRACKET" || t.type === "RBRACE") {
          frames.pop();
        }
      });
    }
    // the arm is not vacuous: it saw every kind of cut, many times
    expect(operatorCuts).toBeGreaterThanOrEqual(50);
    expect(operandCuts).toBeGreaterThanOrEqual(150);
    expect(callCuts).toBeGreaterThanOrEqual(120);
    expect(substitutionCuts).toBeGreaterThanOrEqual(5);
  });

  it("offers no == after an operand inside a call argument, but inside joined(…) and groups", () => {
    const at = (text: string) => {
      const p = classifyExpression(text);
      return p.kind === "operator" ? p.operators : [];
    };
    expect(at('read_value(TSVAL, domain=TS, filter=(TSPARMCD=="SPECIES"), mode="FIRST" ')).toEqual([
      "+",
      "-",
      "*",
      "/",
      "~",
    ]);
    expect(at("record_count(group=[USUBJID, PARAMCD], filter=(ABLFL ")).toContain("==");
    expect(at("none(joined(not empty(earliest_possible(SE.SESTDTC)) ")).toContain("==");
  });
});
