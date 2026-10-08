import { describe, expect, it } from "vitest";
import {
  ARITHMETIC_OPERATORS,
  classifyExpression,
  COMPARISON_OPERATORS,
  expressionBefore,
  LOGICAL_OPERATORS,
  MEMBERSHIP_OPERATORS,
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

const ALL = [
  ...COMPARISON_OPERATORS,
  ...MEMBERSHIP_OPERATORS,
  ...ARITHMETIC_OPERATORS,
  ...LOGICAL_OPERATORS,
];

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
    expect(operators("A == B ")).toEqual([...ARITHMETIC_OPERATORS, ...LOGICAL_OPERATORS]);
    expect(operators("A not in B ")).toEqual([...ARITHMETIC_OPERATORS, ...LOGICAL_OPERATORS]);
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
    expect(operators("A == f(B ")).toEqual([...ARITHMETIC_OPERATORS]);
    expect(operators("f(B ")).toEqual([...ARITHMETIC_OPERATORS]);
    expect(operators("f(x=B ")).toEqual([...ARITHMETIC_OPERATORS]);
    expect(operators("f(A, g(B) ")).toEqual([...ARITHMETIC_OPERATORS]);
    // joined(<condition>) parses its argument with parseOr — exactly that name
    expect(operators("joined(A ")).toEqual(ALL);
    expect(operators("none(joined(A == B ")).toEqual([
      ...ARITHMETIC_OPERATORS,
      ...LOGICAL_OPERATORS,
    ]);
    expect(operators("Joined(A ")).toEqual([...ARITHMETIC_OPERATORS]);
    // a parenthesised group inside an argument is a whole expression again
    expect(operators("read_value(X, filter=(A ")).toEqual(ALL);
    expect(operators("read_value(X, filter=(A == 1) ")).toEqual([...ARITHMETIC_OPERATORS]);
    // joined takes no keyword argument
    expect(kind("joined(A=")).toBe("unknown");
  });

  it("completes `X not` with in only, and a list element with arithmetic only", () => {
    expect(operators("AETERM not ")).toEqual(["in"]);
    expect(operators("A and (B not ")).toEqual(["in"]);
    expect(operators("joined(B not ")).toEqual(["in"]);
    expect(kind("not ")).toBe("operand");
    expect(operators('X in ["A" ')).toEqual([...ARITHMETIC_OPERATORS]);
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
    expect(operators(text)).toEqual([...ARITHMETIC_OPERATORS, ...LOGICAL_OPERATORS]);
    expect(call("f(A,\n    ")).toEqual({ name: "f", positionals: 1, named: [] });
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
