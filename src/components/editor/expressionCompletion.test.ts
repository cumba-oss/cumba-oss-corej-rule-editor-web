import { afterEach, describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { CompletionContext, type Completion } from "@codemirror/autocomplete";
import type { FunctionInfoT } from "../../api/types";
import { fake } from "../../test/handlers";
import { FAKE_FUNCTIONS } from "../../test/fakeEngine";
import type { EngineContext } from "./engineContext";
import { EMPTY_CONTEXT } from "./engineContext";
import { applyFunction, namedArgumentOptions, ruleCompletionSource } from "./ruleCompletion";

const WITHIN: FunctionInfoT = {
  name: "empty_within_except_last_row",
  kind: "BOOLEAN",
  signature: "empty_within_except_last_row(name, group, by=, keep_missings=)",
  parameters: [
    { name: "name", type: "COLUMN_REFERENCE", required: true, collector: false },
    { name: "group", type: "UNKNOWN", required: true, collector: false, description: "the `keys`" },
    { name: "by", type: "STRING", required: false, collector: false },
    { name: "keep_missings", type: "BOOLEAN", required: false, collector: false },
  ],
  sections: {},
};
const TUPLE: FunctionInfoT = {
  name: "tuple",
  kind: "VALUE",
  signature: "tuple(...columns)",
  parameters: [{ name: "columns", type: "LIST", required: true, collector: true }],
  sections: {},
};

const RULE = (expression: string) =>
  [
    "Core:",
    '  Id: "CDISC-CG0270"',
    "Scope:",
    "  Domains:",
    "    Include:",
    '    - "AE"',
    "Bindings:",
    '- name: "$t"',
    '  expression: "upper(AETERM)"',
    "Check:",
    "  expression: >-",
    expression,
    "Outcome:",
    '  Message: "m"',
    "Standards:",
    '- Organization: "CDISC"',
    "",
  ].join("\n");

const context: EngineContext = {
  ...EMPTY_CONTEXT,
  functions: [...FAKE_FUNCTIONS, WITHIN, TUPLE],
  analysis: fake.engine.analyse(RULE("    X")),
};

/** Complete at the `|` of `expression` (a block-scalar line). */
function complete(expression: string) {
  const marked = RULE(expression);
  const pos = marked.indexOf("|", marked.indexOf("Check:"));
  const doc = marked.slice(0, pos) + marked.slice(pos + 1);
  const state = EditorState.create({ doc });
  const result = ruleCompletionSource(() => context)(new CompletionContext(state, pos, true));
  return result && "options" in result ? result : null;
}
const labels = (expression: string) => (complete(expression)?.options ?? []).map((o) => o.label);

describe("expression completion by position", () => {
  it("offers only operators after a complete operand", () => {
    const ops = labels("    not empty(AETERM) |");
    expect(ops).toEqual([
      "==",
      "!=",
      "<",
      "<=",
      ">",
      ">=",
      "=~",
      "!~",
      "in",
      "not in",
      "+",
      "-",
      "*",
      "/",
      "~",
      "and",
      "or",
    ]);
    expect(labels("    AETERM == $t a|")).toEqual(["+", "-", "*", "/", "~", "and", "or"]);
    expect(labels("    AETERM not |")).toEqual(["in"]);
    // a call argument is one arithmetic operand (parseArg → parseOperand)
    expect(labels("    empty(AETERM |")).toEqual(["+", "-", "*", "/", "~"]);
    expect(labels("    none(joined(AETERM == $t |")).toEqual([
      "+",
      "-",
      "*",
      "/",
      "~",
      "and",
      "or",
    ]);
  });

  it("reads upper-case keywords as the keywords (O21): operands after AND, in after NOT", () => {
    for (const expression of [
      "    A == 1 AND |",
      "    A == 1 Or |",
      "    NOT |",
      "    X NOT IN |",
    ]) {
      const got = labels(expression);
      expect(got, expression).toContain("empty");
      expect(got, expression).toContain("$t");
      expect(got, expression).not.toContain("==");
    }
    expect(labels("    AETERM NOT |")).toEqual(["in"]);
    expect(labels("    TRUE |")).not.toContain("+");
  });

  it("offers ~ with its detail, and keeps the context after a /pattern/replacement/", () => {
    const tilde = complete("    AETERM |")!.options.find((o) => o.label === "~")!;
    expect(tilde.detail).toMatch(/replace/);
    expect(tilde.apply).toBe("~ ");
    // after the literal: an operand again — the same operators as after AETERM
    expect(labels("    AETERM ~ /a/b/ |")).toEqual(labels("    AETERM |"));
    expect(labels("    empty(AETERM ~ /a\\/b/c/ |")).toEqual(["+", "-", "*", "/", "~"]);
    expect(labels("    X ~ /a/b/ == $t and |")).toContain("empty");
    // right after ~ only the literal parses: no operand list
    expect(complete("    AETERM ~ |")?.options ?? []).toEqual([]);
  });

  it("offers columns inside a sided group member {left: X, right: Y}", () => {
    for (const expression of [
      '    sequence(ETCD, domain="TA", group=[{left: |',
      '    sequence(ETCD, domain="TA", group=[{left: ACTARMCD, right: |',
    ]) {
      const got = labels(expression);
      expect(got, expression).toContain("AETERM");
      expect(got, expression).not.toContain("==");
      expect(
        got.filter((l) => l.endsWith("=")),
        expression,
      ).toEqual([]); // no named arguments
    }
    // after the member the call's argument context is back: named arguments of the call
    const at = (e: string) => complete(e)!.options.filter((o) => o.type === "property");
    expect(
      at("    empty_within_except_last_row(AETERM, group=[{left: A, right: B}], |").map(
        (o) => o.label,
      ),
    ).toEqual(["by=", "keep_missings="]);
    expect(labels("    f(group=[{left: A |")).toEqual(["+", "-", "*", "/", "~"]);
  });

  it("applies an operator with the spaces it needs", () => {
    const r = complete("    empty(X)|");
    const and = r!.options.find((o) => o.label === "and")!;
    expect(and.apply).toBe(" and ");
    const r2 = complete("    X |");
    expect(r2!.options.find((o) => o.label === "or")!.apply).toBe("or ");
  });

  it("offers variables, bindings and functions at operand positions, as before", () => {
    for (const expression of ["    |", "    X and |", "    empty(|", '    X in ["A", |']) {
      const got = labels(expression);
      expect(got, expression).toContain("empty");
      expect(got, expression).toContain("$t");
      expect(got, expression).not.toContain("and");
    }
  });

  it("falls back to the operand list where the position is unclear", () => {
    expect(labels('    X == "open |')).toContain("empty"); // inside a string
    expect(labels("    X = |")).toContain("empty"); // a half-typed ==
  });

  it("offers a call's parameters as named arguments, boosted, omitting the given ones", () => {
    const at = (e: string) => complete(e)!.options.filter((o) => o.type === "property");
    expect(at("    empty_within_except_last_row(|").map((o) => o.label)).toEqual([
      "name=",
      "group=",
      "by=",
      "keep_missings=",
    ]);
    // positionally bound and already named ones are left out
    expect(at("    empty_within_except_last_row(AETERM, by=AESEQ, |").map((o) => o.label)).toEqual([
      "group=",
      "keep_missings=",
    ]);
    // the typed prefix is part of the completion word
    expect(at("    empty_within_except_last_row(AETERM, b|").map((o) => o.label)).toContain("by=");
    const group = at("    empty_within_except_last_row(|").find((o) => o.label === "group=")!;
    expect(group).toMatchObject({ apply: "group=", detail: "any · required", boost: 3 });
    expect(group.boost!).toBeGreaterThan(2); // above bindings (2) and variables (0 / 1)
    // not mid-argument, not inside a nested list, not for a collector function
    expect(at("    empty_within_except_last_row(AETERM + |")).toEqual([]);
    expect(at("    empty_within_except_last_row(AETERM, [|")).toEqual([]);
    expect(at("    tuple(|")).toEqual([]);
    // the inner call's parameters inside a nested call
    expect(at("    not empty(empty_within_except_last_row(|").map((o) => o.label)).toContain(
      "keep_missings=",
    );
  });

  it("names functions and parameters exactly, as the engine binds them", () => {
    // FunctionRegistry.descriptor and ArgumentBinder.indexOf compare case-sensitively
    expect(
      namedArgumentOptions([WITHIN], {
        name: "EMPTY_WITHIN_EXCEPT_LAST_ROW",
        positionals: 0,
        named: [],
      }),
    ).toEqual([]);
    expect(
      namedArgumentOptions([WITHIN], {
        name: "empty_within_except_last_row",
        positionals: 0,
        named: ["GROUP"],
      }).map((o) => o.label),
    ).toEqual(["name=", "group=", "by=", "keep_missings="]);
    expect(namedArgumentOptions([WITHIN], { name: "nope", positionals: 0, named: [] })).toEqual([]);
  });

  it("offers joined no named argument — it takes exactly one condition", () => {
    const joined: FunctionInfoT = {
      ...WITHIN,
      name: "joined",
      parameters: [{ name: "condition", type: "BOOLEAN", required: true, collector: false }],
    };
    expect(namedArgumentOptions([joined], { name: "joined", positionals: 0, named: [] })).toEqual(
      [],
    );
  });

  it("offers only named arguments after a keyword argument", () => {
    // "Positional argument after keyword argument" (CheckExpressionParser.parseArg)
    expect(labels("    empty_within_except_last_row(AETERM, by=AESEQ, |")).toEqual([
      "group=",
      "keep_missings=",
    ]);
    expect(labels("    empty_within_except_last_row(AETERM, by=AESEQ, ke|")).toEqual([
      "group=",
      "keep_missings=",
    ]);
    // all of them given: nothing parses there
    expect(
      complete("    empty_within_except_last_row(name=A, group=B, by=C, keep_missings=D, |"),
    ).toBeNull();
    // before any keyword argument, positionals stay on offer
    expect(labels("    empty_within_except_last_row(AETERM, |")).toContain("empty");
  });
});

describe("applyFunction", () => {
  let view: EditorView | null = null;
  afterEach(() => view?.destroy());

  const apply = (doc: string, from: number, to: number) => {
    view = new EditorView({ state: EditorState.create({ doc }), parent: document.body });
    applyFunction("empty")(view, { label: "empty" } as Completion, from, to);
    return { doc: view.state.doc.toString(), caret: view.state.selection.main.head };
  };

  it("inserts both brackets with the caret between them", () => {
    expect(apply("not empt", 4, 8)).toEqual({ doc: "not empty()", caret: 10 });
  });

  it("inserts only the name before an existing ( and moves the caret past it", () => {
    expect(apply("not empt(X)", 4, 8)).toEqual({ doc: "not empty(X)", caret: 10 });
  });

  it("is the apply of every function completion", () => {
    const fn = complete("    emp|")!.options.find((o) => o.label === "empty")!;
    expect(typeof fn.apply).toBe("function");
  });
});
