import { describe, expect, it, vi } from "vitest";
import { EditorState } from "@codemirror/state";
import { CompletionContext } from "@codemirror/autocomplete";
import { fake } from "../../test/handlers";
import { FAKE_FUNCTIONS, FAKE_SCHEMA } from "../../test/fakeEngine";
import type { EngineContext } from "./engineContext";
import { describeVariable, EMPTY_CONTEXT, findVariable } from "./engineContext";
import { ruleCompletionSource, scopeAxisValues } from "./ruleCompletion";
import {
  bindingExpression,
  expansionOf,
  renderTooltip,
  resolveScopeValue,
  tokenAt,
  tooltipAt,
} from "./ruleTooltips";
import { EMPTY_DERIVED, widgetPositions } from "./derivedWidgets";
import { matchingBracket } from "./jsonFold";

const RULE = [
  "Core:",
  '  Id: "CDISC-CG0270"',
  'Severity: "Error"',
  "Scope:",
  "  Domains:",
  "    Include:",
  '    - "AE"',
  "Bindings:",
  '- name: "$t"',
  '  expression: "upper(AETERM)"',
  "Expansion:",
  '- token: "&DOM&"',
  '  over: "shared_variables"',
  "Check:",
  "  expression: >-",
  "    not empty($t) and var_label(AEDECOD) != C66767 and --TERM = &DOM&",
  "Outcome:",
  '  Message: "m"',
  "  Output_Variables:",
  '  - "AETERM"',
  "Standards:",
  '- Organization: "CDISC"',
  "",
].join("\n");

const analysis = fake.engine.analyse(RULE);
const context: EngineContext = {
  schema: FAKE_SCHEMA,
  functions: FAKE_FUNCTIONS,
  analysis,
  related: [{ coreId: "FDA-SD1142", relation: "SHARED_REFERENCE", via: "CG0270" }],
  lookupCodelist: vi.fn(async (id: string) => ({
    query: id,
    hits:
      id === "C66767"
        ? [
            {
              ctPackage: "sdtmct-2024",
              conceptId: "C66767",
              submissionValue: "ACN",
              name: "Action Taken",
              extensible: true,
              termCount: 3,
              terms: [{ submissionValue: "DOSE INCREASED", preferredTerm: "Dose Increased" }],
            },
          ]
        : [],
  })),
};

function complete(doc: string, pos: number, ctx: EngineContext = context, explicit = true) {
  const state = EditorState.create({ doc });
  const result = ruleCompletionSource(() => ctx)(new CompletionContext(state, pos, explicit));
  return result && "options" in result ? result : null;
}

function labels(doc: string, pos: number, ctx: EngineContext = context, explicit = true): string[] {
  return (complete(doc, pos, ctx, explicit)?.options ?? []).map((o) => o.label);
}

describe("Scope completion", () => {
  // an SDTM product with prose structures plus an ADaM product (structure entries: the class and
  // the structure are the token), as the rest app's scope universe reports them
  const scoped: EngineContext = {
    ...context,
    analysis: {
      ...analysis,
      scope: {
        ...analysis.scope,
        datasets: [
          {
            product: "standards/sdtmig/3-3",
            name: "AE",
            datasetClass: "EVENTS",
            dataStructure: "One record per adverse event per subject",
          },
          { product: "standards/sdtmig/3-3", name: "DM", datasetClass: "SPECIAL PURPOSE" },
          {
            product: "standards/adam/adamig-1-3",
            name: "ADSL",
            datasetClass: "SUBJECT LEVEL ANALYSIS DATASET",
            dataStructure: "SUBJECT LEVEL ANALYSIS DATASET",
          },
          {
            product: "standards/adam/adamig-1-3",
            name: "BDS",
            datasetClass: "BASIC DATA STRUCTURE",
            dataStructure: "BASIC DATA STRUCTURE",
          },
        ],
      },
    },
  };
  const item = (axis: string, typed = "") => `Scope:\n  ${axis}:\n    Include:\n    - ${typed}`;

  it("offers each axis its own known values, never variables", () => {
    expect(scopeAxisValues(scoped, "Domains")).toEqual(["AE", "DM"]);
    expect(scopeAxisValues(scoped, "Datasets")).toEqual(["AE", "DM"]);
    expect(scopeAxisValues(scoped, "Classes")).toEqual([
      "BASIC DATA STRUCTURE",
      "EVENTS",
      "SPECIAL PURPOSE",
      "SUBJECT LEVEL ANALYSIS DATASET",
    ]);
    // the SDTM prose structure is not a token
    expect(scopeAxisValues(scoped, "Data_Structures")).toEqual([
      "BASIC DATA STRUCTURE",
      "SUBJECT LEVEL ANALYSIS DATASET",
    ]);
    expect(scopeAxisValues(scoped, "Subclasses")).toEqual([]);
    const doc = item("Data_Structures");
    const opts = complete(doc, doc.length, scoped)!.options;
    expect(opts.map((o) => o.label)).toEqual([
      "BASIC DATA STRUCTURE",
      "SUBJECT LEVEL ANALYSIS DATASET",
    ]);
    expect(opts[1]).toMatchObject({ apply: '"SUBJECT LEVEL ANALYSIS DATASET"', detail: "ADSL" });
    expect(opts.map((o) => o.label)).not.toContain("USUBJID");
  });

  it("replaces from the open quote, so a multi-word token is not doubled", () => {
    const doc = item("Data_Structures", '"SUBJECT LE');
    const result = complete(doc, doc.length, scoped)!;
    expect(result.from).toBe(doc.lastIndexOf('"') + 1);
    expect(result.options.find((o) => o.label.startsWith("SUBJECT"))!.apply).toBe(
      "SUBJECT LEVEL ANALYSIS DATASET",
    );
  });

  it("replaces the whole scalar, plain or quoted, in items, values and flow sequences", () => {
    /** The completion at the end of `doc`: its from, and the structure token's apply. */
    const take = (doc: string) => {
      const result = complete(doc, doc.length, scoped)!;
      const token = result.options.find((o) => o.label === "SUBJECT LEVEL ANALYSIS DATASET")!;
      return { from: result.from, apply: token.apply };
    };
    const quotedToken = '"SUBJECT LEVEL ANALYSIS DATASET"';
    // a plain list item: from the scalar's start, quoted on the way in
    let doc = item("Data_Structures", "SUBJECT LE");
    expect(take(doc)).toEqual({ from: doc.lastIndexOf("SUBJECT"), apply: quotedToken });
    // single-quoted: inside the quotes, bare
    doc = item("Data_Structures", "'SUBJECT LE");
    expect(take(doc)).toEqual({
      from: doc.lastIndexOf("'") + 1,
      apply: "SUBJECT LEVEL ANALYSIS DATASET",
    });
    // an inline Include value, plain
    doc = "Scope:\n  Data_Structures:\n    Include: SUBJECT LE";
    expect(take(doc)).toEqual({ from: doc.lastIndexOf("SUBJECT"), apply: quotedToken });
    // a flow sequence: the element the cursor is in, quoted or plain
    doc = 'Scope:\n  Data_Structures:\n    Exclude: ["BASIC DATA STRUCTURE", "SUBJECT LE';
    expect(take(doc)).toEqual({
      from: doc.lastIndexOf('"') + 1,
      apply: "SUBJECT LEVEL ANALYSIS DATASET",
    });
    doc = "Scope:\n  Data_Structures:\n    Include: [BASIC DATA STRUCTURE, SUBJECT LE";
    expect(take(doc)).toEqual({ from: doc.lastIndexOf("SUBJECT"), apply: quotedToken });
    // past a closed quoted scalar there is nothing to complete
    doc = 'Scope:\n  Data_Structures:\n    Include: "ADSL" ';
    expect(complete(doc, doc.length, scoped)).toBeNull();
  });

  it("offers axis values only under an axis' Include / Exclude", () => {
    for (const doc of [
      "Scope:\n  include_split_datasets: ",
      "Scope:\n  Domains:\n    Other: ",
      "Scope:\n  Domains:\n    Other:\n    - ",
    ]) {
      const got = (complete(doc, doc.length, scoped)?.options ?? []).map((o) => o.label);
      expect(got, JSON.stringify(doc)).not.toContain("AE");
      expect(got, JSON.stringify(doc)).not.toContain("USUBJID");
    }
    const doc = "Scope:\n  Domains:\n    Exclude:\n    - ";
    expect(complete(doc, doc.length, scoped)!.options.map((o) => o.label)).toContain("AE");
  });

  it("completes a scalar Scope value too, and nothing without a store", () => {
    const doc = 'Scope:\n  Classes:\n    Include: "EV';
    expect(complete(doc, doc.length, scoped)!.options.map((o) => o.label)).toContain("EVENTS");
    const empty = {
      ...scoped,
      analysis: { ...scoped.analysis!, scope: { ...scoped.analysis!.scope!, datasets: [] } },
    };
    expect(complete(item("Data_Structures"), item("Data_Structures").length, empty)).toBeNull();
  });
});

describe("ruleCompletionSource", () => {
  it("offers schema keys at the cursor's path, applied with a colon, and none without a schema", () => {
    const doc = "Core:\n  Id: x\nScope:\n  Do";
    const result = complete(doc, doc.length)!;
    expect(result.options.map((o) => o.label)).toEqual(["Domains", "Classes"]);
    expect(result.options[0]).toMatchObject({
      type: "property",
      apply: "Domains: ",
      info: "The domain axis",
    });
    expect(labels("", 0)).toEqual([
      "Core",
      "Description",
      "Severity",
      "Executability",
      "Scope",
      "Check",
      "Outcome",
      "Bindings",
      "Standards",
    ]);
    expect(complete("", 0)!.options[0].detail).toBe("required");
    expect(complete(doc, doc.length, { ...context, schema: null })).toBeNull();
    expect(complete(doc, doc.length, context, false)).not.toBeNull(); // a typed prefix activates
    expect(complete("Core:\n  ", 8, context, false)).toBeNull(); // nothing typed, not explicit
  });

  it("offers enum values (quoted unless already in quotes) and variables for a value", () => {
    const doc = "Severity: ";
    const opts = complete(doc, doc.length)!.options;
    expect(opts.slice(0, 4).map((o) => o.label)).toEqual(["Reject", "Error", "Warning", "Info"]);
    expect(opts[0]).toMatchObject({ type: "enum", apply: '"Reject"' });
    expect(complete('Severity: "', 11)!.options[0].apply).toBe("Reject");
    // variables (scope universe) follow, class-level ones first by boost
    expect(opts.map((o) => o.label)).toContain("--TERM");
    const term = opts.find((o) => o.label === "--TERM")!;
    expect(term).toMatchObject({ type: "class", detail: "text · AETERM, CMTERM" });
    const seq = opts.find((o) => o.label === "AESEQ")!;
    expect(seq).toMatchObject({
      type: "variable",
      detail: "integer · AE",
      info: "Sequence Number — standards/sdtmig/3-3",
    });
    // no function in a plain value
    expect(opts.map((o) => o.label)).not.toContain("empty");
  });

  it("offers functions with signatures and $bindings inside an expression", () => {
    const doc = 'Bindings:\n- name: "$t"\n  expression: "x"\nCheck:\n  expression: >-\n    not em';
    const opts = complete(doc, doc.length)!.options;
    const empty = opts.find((o) => o.label === "empty")!;
    expect(empty).toMatchObject({
      type: "function",
      detail: "empty(value)",
    });
    expect(typeof empty.apply).toBe("function"); // `empty()`, caret inside (applyFunction)
    // the info is rendered DOM: the summary's first sentence
    const info = (empty.info as (c: typeof empty) => HTMLElement)(empty);
    expect(info.textContent).toBe("Whether the value is missing.");
    expect(opts.find((o) => o.label === "count")!.info).toBeUndefined(); // no summary, no info
    expect(opts.find((o) => o.label === "$t")).toMatchObject({
      type: "variable",
      detail: "binding",
    });
    // without an analysis: functions only
    expect(labels(doc, doc.length, { ...context, analysis: null })).toEqual([
      "empty",
      "var_label",
      "count",
    ]);
    expect(complete("Core:\n  Id: ", 11, { ...EMPTY_CONTEXT })).toBeNull();
  });
});

describe("tooltipAt", () => {
  const at = (needle: string, offset = 1) => RULE.indexOf(needle) + offset;
  it("finds the token under the cursor", () => {
    expect(tokenAt("a $x b", 3)).toEqual({ text: "$x", from: 2, to: 4 });
    expect(tokenAt("--TERM = &DOM&", 11)).toEqual({ text: "&DOM&", from: 9, to: 14 });
    expect(tokenAt("DM.RFSTDTC", 4)).toEqual({ text: "DM.RFSTDTC", from: 0, to: 10 });
    expect(tokenAt("a  b", 2)).toBeNull(); // a space between tokens: nothing to describe
    expect(tokenAt("   ", 1)).toBeNull();
  });

  it("describes keys from the schema, Scope keys with the resolved datasets", () => {
    expect(tooltipAt(RULE, at("Severity:"), context)?.content).toEqual({
      title: "Severity",
      lines: ["Rule severity"],
    });
    expect(tooltipAt(RULE, at("Scope:"), context)?.content).toEqual({
      title: "Scope",
      lines: ["Which datasets the rule is ABOUT", "In scope (2): AE, CM"],
    });
    expect(tooltipAt(RULE, at("  Domains:", 3), context)?.content?.title).toBe("Scope.Domains");
    expect(
      tooltipAt(RULE, at("Scope:"), { ...context, schema: null, analysis: null })?.content?.lines,
    ).toEqual(["In scope: nothing resolved (no analysis or no store)"]);
    expect(tooltipAt(RULE, at("Standards:"), context)).toBeNull(); // no description anywhere
  });

  it("resolves a Scope value to its datasets, and Core.Id to the related rules", () => {
    expect(resolveScopeValue(context, "events").map((d) => d.name)).toEqual(["AE"]);
    expect(resolveScopeValue(context, "ALL").map((d) => d.name)).toEqual(["AE", "CM"]);
    expect(tooltipAt(RULE, at('    - "AE"', 7), context)?.content).toEqual({
      title: "AE resolves to",
      lines: ["AE (EVENTS) — standards/sdtmig/3-3"],
    });
    expect(tooltipAt(RULE, at('  Id: "CDISC-CG0270"', 8), context)?.content).toEqual({
      title: "CDISC-CG0270 — related rules",
      lines: ["FDA-SD1142 (SHARED_REFERENCE via CG0270)"],
    });
    expect(
      tooltipAt(RULE, at('  Id: "CDISC-CG0270"', 8), { ...context, related: [] })?.content?.lines,
    ).toEqual(["none"]);
    expect(
      tooltipAt(RULE, at('  Id: "CDISC-CG0270"', 8), { ...context, related: null })?.content?.lines,
    ).toEqual(["related rules: not loaded"]);
  });

  it("describes functions, variables, --X expansions, bindings and &NAME& tokens", () => {
    expect(tooltipAt(RULE, at("var_label(AEDECOD)", 2), context)?.content).toEqual({
      title: "var_label(name, source?)",
      summary: "The label of a variable.",
      lines: ["returns string"],
      markdown: true,
    });
    expect(tooltipAt(RULE, at("var_label(AEDECOD)", 12), context)?.content).toEqual({
      title: "AEDECOD",
      lines: [
        "Dictionary-Derived Term · text · Req · Synonym Qualifier",
        "codelists: C66767",
        "in: AE",
        "versions: standards/sdtmig/3-3",
      ],
    });
    expect(tooltipAt(RULE, at("--TERM = ", 2), context)?.content?.lines).toEqual([
      "Reported Term · text · Req · Topic",
      "stands for: AETERM, CMTERM",
      "in: EVENTS, INTERVENTIONS",
      "versions: standards/sdtmig/3-3",
    ]);
    expect(tooltipAt(RULE, at("not empty($t)", 11), context)?.content).toEqual({
      title: "Binding $t",
      lines: ["upper(AETERM)"],
      mono: true,
    });
    expect(tooltipAt("x: $nope", 5, context)?.content?.lines).toEqual([
      "not declared in this buffer",
    ]);
    expect(
      tooltipAt("x: $t", 4, { ...context, analysis: { ...analysis, bindings: ["$t"] } })?.content
        ?.lines,
    ).toEqual(["declared"]);
    expect(tooltipAt(RULE, at("= &DOM&", 3), context)?.content).toEqual({
      title: "Expansion &DOM&",
      lines: ["expanded per dataset at run time (over shared_variables)"],
    });
    const withValues = RULE.replace('  over: "shared_variables"', '  values: ["AE", "CM"]');
    expect(
      tooltipAt(withValues, withValues.indexOf("= &DOM&") + 3, context)?.content?.lines,
    ).toEqual(["expands to: AE, CM"]);
    expect(tooltipAt("x: &NOPE&", 5, context)?.content?.lines).toEqual([
      "expanded per dataset at run time",
    ]);
    expect(tooltipAt("x: nothing_here", 6, context)).toBeNull();
    expect(tooltipAt("x: unknownfn(1)", 5, context)).toBeNull();
    expect(bindingExpression("Bindings: 3", "$t")).toBeNull();
    expect(expansionOf("Expansion:\n- token: x", "&X&")).toBeNull();
  });

  it("loads a codelist tooltip from the store on demand", async () => {
    const spec = tooltipAt(RULE, at("C66767", 2), context)!;
    expect(spec.content).toBeNull();
    expect(await spec.load!()).toEqual({
      title: "C66767 ACN — Action Taken",
      lines: ["sdtmct-2024 · extensible", "DOSE INCREASED — Dose Increased", "… 3 terms"],
    });
    const miss = tooltipAt("x: C99999", 5, context)!;
    expect(await miss.load!()).toEqual({
      title: "C99999",
      lines: ["not in the metadata store's CT"],
    });
    const down = tooltipAt("x: C99999", 5, { ...context, lookupCodelist: async () => null })!;
    expect(await down.load!()).toEqual({ title: "C99999", lines: ["CT lookup unavailable"] });
  });

  it("renders content as DOM", () => {
    const dom = renderTooltip({ title: "T", lines: ["a", "b"], mono: true });
    expect(dom.children).toHaveLength(3);
    expect(dom.children[0].textContent).toBe("T");
    expect((dom.children[1] as HTMLElement).style.fontFamily).toContain("monospace");
    // plain lines keep their markdown characters literal
    expect(renderTooltip({ title: "T", lines: ["`x`"] }).children[1].innerHTML).toBe("`x`");
  });

  it("shows a function's first sentence, inline markdown, and UNKNOWN as any", () => {
    const fn = {
      name: "empty",
      signature: "empty(x)",
      returnType: "boolean",
      summary:
        'True when the value is missing or `""`. Prefer `not empty(x)`; **not** `is_missing`.',
      parameters: [
        { name: "x", type: "UNKNOWN", required: true, description: "The *value* to read" },
        { name: "y", type: "STRING", required: false, description: "A `name`" },
      ],
    };
    const content = tooltipAt("x: empty(A)", 4, { ...context, functions: [fn] })!.content!;
    expect(content.lines).toEqual([
      "returns boolean",
      "x: any — The *value* to read",
      "y?: STRING — A `name`",
    ]);
    const dom = renderTooltip(content);
    const summary = dom.querySelector(".rule-doc-summary")!;
    expect(summary.firstElementChild!.textContent).toBe('True when the value is missing or "".');
    const more = summary.querySelector("button")!;
    expect(more.textContent).toBe("more…");
    more.click();
    expect(summary.querySelector("strong")?.textContent).toBe("not");
    expect(more.textContent).toBe("less");
    expect(dom.children[2].textContent).toBe("returns boolean");
    expect(dom.children[3].querySelector("em")?.textContent).toBe("value");
    expect(dom.children[3].textContent).toBe("x: any — The value to read");
    expect(dom.children[4].querySelector("code")?.textContent).toBe("name");
  });
});

describe("engineContext helpers", () => {
  it("finds variables case-insensitively, through a dataset prefix", () => {
    expect(findVariable(analysis, "aeseq")?.name).toBe("AESEQ");
    expect(findVariable(analysis, "AE.AESEQ")?.name).toBe("AESEQ");
    expect(findVariable(analysis, "NOPE")).toBeUndefined();
    expect(findVariable(null, "AESEQ")).toBeUndefined();
    expect(describeVariable({ name: "X", type: "text" })).toBe("text");
  });
});

describe("widgetPositions", () => {
  it("places the widgets where the packaged shape would carry the fields", () => {
    const p = widgetPositions(RULE);
    const line = (needle: string) => RULE.indexOf(needle);
    // Sensitivity after the Severity line; Output_Variables at the end of the Outcome block;
    // Authorities before Standards
    expect(p.sensitivity).toEqual({ pos: line("Scope:") - 1, side: 1 });
    expect(p.outputVariables).toEqual({ pos: line("Standards:") - 1, side: 1, indent: 2 });
    expect(p.authorities).toEqual({ pos: line("Standards:"), side: -1 });
    // fallbacks: after Core / after Check / at the end
    const bare = "Core:\n  Id: x\nCheck:\n  expression: a\n";
    expect(widgetPositions(bare)).toEqual({
      sensitivity: { pos: 13, side: 1 },
      outputVariables: { pos: bare.length - 1, side: 1, indent: 0 },
      authorities: { pos: bare.length, side: 1 },
    });
    expect(widgetPositions("")).toEqual({
      sensitivity: { pos: 0, side: -1 },
      outputVariables: { pos: 0, side: 1, indent: 0 },
      authorities: { pos: 0, side: 1 },
    });
    expect(EMPTY_DERIVED.status).toBe("none");
  });
});

describe("jsonFold", () => {
  it("matches brackets, skipping strings", () => {
    const text = '{"a": [1, "]"], "b": {"c": 2}}';
    expect(matchingBracket(text, 0)).toBe(text.length - 1);
    expect(matchingBracket(text, 6)).toBe(13);
    expect(matchingBracket("[1, 2", 0)).toBe(-1);
    expect(matchingBracket('{"a": "x\\"y"}', 0)).toBe(12);
  });
});
