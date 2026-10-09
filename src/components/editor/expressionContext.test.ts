import { describe, expect, it } from "vitest";
import {
  ARITHMETIC_OPERATORS,
  classifyExpression,
  COMPARISON_OPERATORS,
  expressionBefore,
  LOGICAL_OPERATORS,
  MEMBERSHIP_OPERATORS,
  OPERATOR_DETAIL,
  SUBSTITUTION_OPERATORS,
} from "./expressionContext";

const kind = (text: string) => classifyExpression(text).kind;
const operators = (text: string) => {
  const p = classifyExpression(text);
  return p.kind === "operator" ? p.operators : null;
};
const call = (text: string) => {
  const p = classifyExpression(text);
  return p.kind === "operand" ? (p.call ?? null) : undefined;
};

/** What follows a value operand inside one operand: arithmetic, then the `~` postfix. */
const VALUE = [...ARITHMETIC_OPERATORS, ...SUBSTITUTION_OPERATORS];
const ALL = [...COMPARISON_OPERATORS, ...MEMBERSHIP_OPERATORS, ...VALUE, ...LOGICAL_OPERATORS];

describe("classifyExpression", () => {
  it("places operand positions: the start, after an operator, after ( [ , and keywords", () => {
    for (const text of [
      "",
      "   ",
      "not ",
      "AETERM == ",
      "AETERM in ",
      "X and ",
      "X or\n  ",
      "empty(",
      "f(A, ",
      "[",
      '["A", ',
      "(",
      "X + ",
      "X && ",
      "! ",
      "f(x=",
      "X not in ",
    ]) {
      expect(kind(text), JSON.stringify(text)).toBe("operand");
    }
  });

  it("places operator positions after a complete operand", () => {
    for (const text of [
      "AETERM ",
      "--TERM ",
      "42 ",
      "-1.5 ",
      '"text" ',
      "empty(X) ",
      "empty(X)",
      '["A"] ',
      "$t ",
      "&DOM& ",
      "&DOM&.&DOM&SEQ ",
      "`PROTOCOL MILESTONE` ",
      "${a:b} ",
      "DM.RFSTDTC ",
    ]) {
      expect(operators(text), JSON.stringify(text)).toEqual(ALL);
    }
  });

  it("offers no second comparison in one comparison, but and / or / arithmetic", () => {
    expect(operators("A == B ")).toEqual([...VALUE, ...LOGICAL_OPERATORS]);
    expect(operators("A not in B ")).toEqual([...VALUE, ...LOGICAL_OPERATORS]);
    // no arithmetic after a regex (the lexer's afterOperand excludes REGEX / TRUE / FALSE)
    expect(operators("AETERM =~ /^A\\/B$/ ")).toEqual([...LOGICAL_OPERATORS]);
    // and / or start a new comparison; parentheses have their own
    expect(operators("A == B and C ")).toEqual(ALL);
    expect(operators("A == (B ")).toEqual(ALL);
  });

  it("offers no arithmetic after a regex, true or false — comparison and logic only", () => {
    const noArithmetic = [...COMPARISON_OPERATORS, ...MEMBERSHIP_OPERATORS, ...LOGICAL_OPERATORS];
    expect(operators("true ")).toEqual(noArithmetic);
    expect(operators("false ")).toEqual(noArithmetic);
    expect(operators("/^A/ ")).toEqual(noArithmetic);
    expect(operators("f(true ")).toEqual([]); // a call argument: one arithmetic operand
    expect(operators('["A", /x/ ')).toEqual([]);
    // what follows lexes in operand position, as the engine's lexer reads it
    expect(kind("true + ")).toBe("unknown"); // '+' starts nothing
    expect(operators("true -1 ")).toEqual(ALL); // a negative number (then a parse error)
  });

  it("offers one arithmetic operand's operators inside a call argument — but joined's", () => {
    // parseArg → parseOperand → parseSum: no comparison, no and / or (H2)
    expect(operators("A == f(B ")).toEqual(VALUE);
    expect(operators("f(B ")).toEqual(VALUE);
    expect(operators("f(x=B ")).toEqual(VALUE);
    expect(operators("f(A, g(B) ")).toEqual(VALUE);
    // joined(<condition>) parses its argument with parseOr — exactly that name
    expect(operators("joined(A ")).toEqual(ALL);
    expect(operators("none(joined(A == B ")).toEqual([...VALUE, ...LOGICAL_OPERATORS]);
    expect(operators("Joined(A ")).toEqual(VALUE);
    // a parenthesised group inside an argument is a whole expression again
    expect(operators("read_value(X, filter=(A ")).toEqual(ALL);
    expect(operators("read_value(X, filter=(A == 1) ")).toEqual(VALUE);
    // joined takes no keyword argument
    expect(kind("joined(A=")).toBe("unknown");
  });

  it("completes `X not` with in only, and a list element with arithmetic only", () => {
    expect(operators("AETERM not ")).toEqual(["in"]);
    expect(operators("A and (B not ")).toEqual(["in"]);
    expect(operators("joined(B not ")).toEqual(["in"]);
    expect(kind("not ")).toBe("operand");
    expect(operators('X in ["A" ')).toEqual(VALUE);
    // not where no membership test can stand: after a comparison, in a list or a call argument
    expect(kind("A == B not ")).toBe("unknown");
    expect(kind("f(B not ")).toBe("unknown");
    expect(kind("[B not ")).toBe("unknown");
  });

  it("lexes numbers and expansion tokens as the engine does", () => {
    // scanNumber: -?\d+(\.\d+)? — `1e5` is the number 1, then the identifier e5
    expect(call("1e5(")).toEqual({ name: "e5", positionals: 0, named: [] });
    expect(kind("1.(")).toBe("unknown"); // '.' starts no token
    expect(kind(".5 ")).toBe("unknown");
    expect(operators("1.5 ")).toEqual(ALL);
    expect(operators("-2 ")).toEqual(ALL);
    // &NAME&: [A-Z][A-Z0-9]* (ExpansionTokens.TOKEN), never two back to back
    expect(operators("&DOM2& ")).toEqual(ALL);
    expect(kind("&dom& ")).toBe("unknown");
    expect(kind("&D_X& ")).toBe("unknown");
    expect(kind("&A&&B& ")).toBe("unknown");
    expect(operators("&A& && B ")).toEqual(ALL);
  });

  it("reads strings of both quote kinds as one operand, whatever they contain", () => {
    expect(operators('X == "a) and (" ')).not.toBeNull();
    expect(operators("X == 'a) and (' ")).not.toBeNull();
    expect(operators('X == "say \\"and\\" (" ')).not.toBeNull();
    // `)` inside the string must not close the call
    expect(call('f("a)", ')).toEqual({ name: "f", positionals: 1, named: [] });
    expect(call("f('a,b', ")).toEqual({ name: "f", positionals: 1, named: [] });
  });

  it("is unknown — the fallback — where it cannot place the cursor", () => {
    expect(kind('X == "open')).toBe("unknown"); // inside a string
    expect(kind("X == 'open")).toBe("unknown");
    expect(kind("X == /open")).toBe("unknown"); // inside a regex
    expect(kind("X)")).toBe("unknown"); // unbalanced
    expect(kind("(X]")).toBe("unknown");
    expect(kind("X = ")).toBe("unknown"); // a half-typed ==
    expect(kind("X ; ")).toBe("unknown"); // a stray character
    expect(kind("X - ")).toBe("operand"); // arithmetic after an operand
    expect(kind("- ")).toBe("unknown"); // a lone '-' does not lex
  });

  it("tracks the call whose argument starts at the cursor, through nesting", () => {
    expect(call("empty_within_except_last_row(")).toEqual({
      name: "empty_within_except_last_row",
      positionals: 0,
      named: [],
    });
    expect(call("f(A, group=[X, Y], ")).toEqual({ name: "f", positionals: 1, named: ["group"] });
    expect(call("f(A, g(B, ")).toEqual({ name: "g", positionals: 1, named: [] });
    expect(call("f(A, g(B), ")).toEqual({ name: "f", positionals: 2, named: [] });
    expect(call("f(A, filter=(X == 1), ")).toEqual({
      name: "f",
      positionals: 1,
      named: ["filter"],
    });
    // not an argument start: inside a list, a group, after a keyword's =, mid-argument
    expect(call("f([")).toBeNull();
    expect(call("not (")).toBeNull();
    expect(call("f(x=")).toBeNull();
    expect(call("f(A + ")).toBeNull();
    expect(call("")).toBeNull();
  });

  it("reads a multi-line block scalar as one expression", () => {
    const text = 'not empty(AESEV)\n  and AESEV not in\n  ["MILD",\n   "SEVERE"]\n  ';
    expect(operators(text)).toEqual([...VALUE, ...LOGICAL_OPERATORS]);
    expect(call("f(A,\n    ")).toEqual({ name: "f", positionals: 1, named: [] });
  });

  it("reads the keywords in any case, as the engine's lexer does (O21)", () => {
    // ExpressionLexer: KEYWORDS.get(text.toLowerCase(Locale.ROOT))
    expect(kind("A == 1 AND ")).toBe("operand");
    expect(kind("A == 1 Or ")).toBe("operand");
    expect(kind("NOT ")).toBe("operand");
    expect(operators("AETERM NOT ")).toEqual(["in"]);
    expect(kind("AETERM NOT IN ")).toBe("operand");
    expect(operators("A IN B ")).toEqual([...VALUE, ...LOGICAL_OPERATORS]);
    // TRUE / FALSE are the boolean literals: no arithmetic, no ~ after them
    const noValue = [...COMPARISON_OPERATORS, ...MEMBERSHIP_OPERATORS, ...LOGICAL_OPERATORS];
    expect(operators("TRUE ")).toEqual(noValue);
    expect(operators("False ")).toEqual(noValue);
    // the boolean position after a capitalised and / not, as after the lowercase ones
    expect(classifyExpression("X == 1 AND ")).toEqual({ kind: "operand", boolean: true });
    expect(classifyExpression("NOT ")).toEqual({ kind: "operand", boolean: true });
    // a keyword is a whole word: an identifier merely starting with one stays a name
    expect(operators("ANDX ")).toEqual(ALL);
    expect(operators("INDH ")).toEqual(ALL);
    // never an Object.prototype member read as a keyword
    expect(operators("constructor ")).toEqual(ALL);
    expect(operators("__proto__ ")).toEqual(ALL);
  });

  it("offers the ~ substitution and reads /pattern/replacement/ as one operand", () => {
    expect(OPERATOR_DETAIL["~"]).toBeTruthy();
    // the literal ends the operand, and arithmetic may follow (afterOperand: SUBSTITUTION)
    expect(operators("X ~ /a/b/ ")).toEqual(ALL);
    expect(operators("X ~ /a/b/")).toEqual(ALL);
    expect(operators("X ~ /a/b/ ~ /b/c/ ")).toEqual(ALL); // left-associative chaining
    expect(operators('AESTDTC ~ /(?i)^(.*)DTC$/$1/ == "AEST" ')).toEqual([
      ...VALUE,
      ...LOGICAL_OPERATORS,
    ]);
    // in a call argument, one arithmetic operand — the call context survives the literal
    expect(operators("num(MIDS ~ /^.*?([0-9]+)$/$1/ ")).toEqual(VALUE);
    expect(call("f(MIDS ~ /x/y/, ")).toEqual({ name: "f", positionals: 1, named: [] });
    // `,` `)` `]` inside either part are the literal's text, not code
    expect(call("f(X ~ /a,(b/c)]/, ")).toEqual({ name: "f", positionals: 1, named: [] });
    expect(operators("X ~ /a)/b(/ ")).toEqual(ALL);
    // the regex literal's escapes: \/ is the delimiter, \\ a backslash
    expect(operators("X ~ /a\\/b/c\\/d/ ")).toEqual(ALL);
    expect(operators("X ~ /a\\\\/b/ ")).toEqual(ALL);
    expect(kind("X ~ /a\\\\/b\\/")).toBe("unknown"); // `\\/` escapes the closing slash
    // directly after ~ only the literal parses: nothing to offer, never the operand list
    expect(classifyExpression("X ~ ")).toEqual({ kind: "operator", operators: [] });
    expect(classifyExpression("X ~")).toEqual({ kind: "operator", operators: [] });
    // inside either part of the literal, or after only its pattern: unknown
    expect(kind("X ~ /a")).toBe("unknown");
    expect(kind("X ~ /a/")).toBe("unknown");
    expect(kind("X ~ /a/b")).toBe("unknown");
    // anything but the literal after ~ is the parser's error
    expect(kind('X ~ "a" ')).toBe("unknown");
    expect(kind("X ~ Y ")).toBe("unknown");
    // =~ / !~ are still the match operators, the /…/ after them a plain regex
    expect(operators("X =~ /a/ ")).toEqual([...LOGICAL_OPERATORS]);
    expect(operators("X !~ /a/ ")).toEqual([...LOGICAL_OPERATORS]);
    // no ~ after a regex, true or a list element closing with ] … but after a group's )
    expect(operators("/a/ ")).not.toContain("~");
    expect(operators("(X) ")).toContain("~");
  });

  it("reads the sided group member {left: X, right: Y} as a frame of its own", () => {
    // inside a side: one column operand, the call context of the enclosing call kept
    expect(classifyExpression("f(D, group=[{left: A, right: ")).toEqual({ kind: "operand" });
    expect(classifyExpression("f(D, group=[{left: ")).toEqual({ kind: "operand" });
    expect(operators("f(D, group=[{left: A ")).toEqual(VALUE);
    expect(operators("f(D, group=[{right: B, left: A ")).toEqual(VALUE);
    // after the member, the list and the call carry on
    expect(operators("f(D, group=[{left: A, right: B} ")).toEqual([]);
    expect(kind("f(D, group=[{left: A, right: B}, ")).toBe("operand");
    expect(operators("f(D, group=[{left: A, right: B}] ")).toEqual(VALUE);
    expect(call('sequence(ETCD, domain="TA", group=[{left: ACTARMCD, right: ARMCD}], ')).toEqual({
      name: "sequence",
      positionals: 1,
      named: ["domain", "group"],
    });
    // a `:` and the keys: at the key, or between key and `:`, nothing the scan can place
    expect(kind("f(group=[{")).toBe("unknown");
    expect(kind("f(group=[{left: A, ")).toBe("unknown");
    expect(kind("f(group=[{left ")).toBe("unknown");
    // a `:` anywhere else, or after a key that is not left / right, is no grammar
    expect(kind("A: ")).toBe("unknown");
    expect(kind("f(x: ")).toBe("unknown");
    expect(kind("[{up: ")).toBe("unknown");
    expect(kind("[{left: A: ")).toBe("unknown");
    // brackets must match their own frame
    expect(kind("[{left: A]")).toBe("unknown");
    expect(kind("[{left: A)")).toBe("unknown");
    expect(kind("[(A}")).toBe("unknown");
    expect(kind("}")).toBe("unknown");
  });
});

describe("expressionBefore", () => {
  const at = (doc: string, marker = "|") => {
    const pos = doc.indexOf(marker);
    return { doc: doc.slice(0, pos) + doc.slice(pos + 1), pos };
  };

  it("reads an inline value, undoing YAML quoting", () => {
    let { doc, pos } = at('Check:\n  expression: "X == \\"a\\" and |"\n');
    expect(expressionBefore(doc, pos, "expression")).toBe('X == "a" and ');
    ({ doc, pos } = at("Check:\n  expression: 'X == \"a\" and ''b'' |'\n"));
    expect(expressionBefore(doc, pos, "expression")).toBe("X == \"a\" and 'b' ");
    ({ doc, pos } = at("Bindings:\n- name: x\n  expression: upper(|"));
    expect(expressionBefore(doc, pos, "expression")).toBe("upper(");
    ({ doc, pos } = at("- Filter: A == 1 |"));
    expect(expressionBefore(doc, pos, "Filter")).toBe("A == 1 ");
  });

  it("is null past a quoted scalar's closing quote", () => {
    const { doc, pos } = at('Check:\n  expression: "X" |\n');
    expect(expressionBefore(doc, pos, "expression")).toBeNull();
  });

  it("reads a block scalar's lines up to the cursor, and a continued inline value", () => {
    let { doc, pos } = at(
      "Check:\n  expression: >-\n    not empty(X)\n      and f(\n    A, |\nOutcome: {}\n",
    );
    expect(expressionBefore(doc, pos, "expression")).toBe(
      "    not empty(X)\n      and f(\n    A, ",
    );
    ({ doc, pos } = at('Check:\n  expression: "not empty(X)\n    and |"\n'));
    expect(expressionBefore(doc, pos, "expression")).toBe("not empty(X)\n    and ");
    ({ doc, pos } = at("\n\nexpression: |\n  X ^", "^"));
    expect(expressionBefore(doc, pos, "expression")).toBe("  X ");
    // chomping and indentation indicator in either order
    for (const header of [">2-", "|-2", "|+", ">1 # note"]) {
      ({ doc, pos } = at(`Check:\n  expression: ${header}\n    X ^`, "^"));
      expect(expressionBefore(doc, pos, "expression"), header).toBe("    X ");
    }
  });

  it("is null without the key", () => {
    expect(expressionBefore("\n\nfoo: X ", 9, "expression")).toBeNull();
  });
});
