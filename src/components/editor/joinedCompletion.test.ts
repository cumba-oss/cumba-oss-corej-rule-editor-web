import { afterEach, describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { CompletionContext, insertCompletionText } from "@codemirror/autocomplete";
import type { AnalysisT, FunctionInfoT } from "../../api/types";
import { fake } from "../../test/handlers";
import { FAKE_FUNCTIONS, FAKE_SCHEMA } from "../../test/fakeEngine";
import {
  EMPTY_CONTEXT,
  findJoined,
  joinedOf,
  matchEntries,
  type EngineContext,
} from "./engineContext";
import { classifyExpression, LOGICAL_OPERATORS } from "./expressionContext";
import { joinedOptions, ruleCompletionSource } from "./ruleCompletion";
import { tooltipAt } from "./ruleTooltips";

const WITHIN: FunctionInfoT = {
  name: "empty_within_except_last_row",
  kind: "BOOLEAN",
  signature: "empty_within_except_last_row(name, group, by=, keep_missings=)",
  parameters: [
    { name: "name", type: "COLUMN_REFERENCE", required: true, collector: false },
    { name: "group", type: "UNKNOWN", required: true, collector: false },
    { name: "by", type: "STRING", required: false, collector: false },
    { name: "keep_missings", type: "BOOLEAN", required: false, collector: false },
  ],
  sections: {},
};
/** A quantifier: no joined rows to quantify over in a Filter. */
const ANY: FunctionInfoT = {
  name: "any",
  kind: "BOOLEAN",
  signature: "any(condition)",
  parameters: [{ name: "condition", type: "BOOLEAN", required: true, collector: false }],
  sections: {},
};

const DM_VARS = ["DM.USUBJID", "DM.RFSTDTC", "DM.RFENDTC", "DM.SEX"];

/**
 * A rule joining DM: `expression` is the Check's block-scalar line, `output` an Output_Variables
 * item, `key` the second Keys item, `joinType` the entry's Join_Type (`null`: none, the default
 * inner join).
 */
const RULE = (
  expression: string,
  output = '"AETERM"',
  key = '"USUBJID"',
  joinType: string | null = "left",
) =>
  [
    "Core:",
    '  Id: "CDISC-CG0270"',
    "Scope:",
    "  Domains:",
    "    Include:",
    '    - "AE"',
    "Match_Datasets:",
    '- Name: "DM"',
    "  Keys:",
    '  - "STUDYID"',
    `  - ${key}`,
    ...(joinType === null ? [] : [`  Join_Type: "${joinType}"`]),
    "Check:",
    "  expression: >-",
    expression,
    "Outcome:",
    '  Message: "m"',
    "  Output_Variables:",
    `  - ${output}`,
    "Standards:",
    '- Organization: "CDISC"',
    "",
  ].join("\n");

const DOC = RULE("    AESTDTC < DM.RFSTDTC and DM._matched_ and DM.SEX != AETERM");
const analysis = fake.engine.analyse(DOC);
const contextOf = (a: AnalysisT | null): EngineContext => ({
  ...EMPTY_CONTEXT,
  schema: FAKE_SCHEMA,
  functions: [...FAKE_FUNCTIONS, WITHIN, ANY],
  analysis: a,
});
const context = contextOf(analysis);
/** The same analysis as an older server (or a rule without a join) answers it: no `joined`. */
const withoutJoined = (): EngineContext => {
  const rest: AnalysisT = { ...analysis };
  delete rest.joined;
  return { ...context, analysis: rest };
};
/** The analysis of `doc` by a server without a metadata store. */
function analyseWithoutStore(doc: string): AnalysisT {
  fake.engine.info.storeAvailable = false;
  try {
    return fake.engine.analyse(doc);
  } finally {
    fake.engine.info.storeAvailable = true;
  }
}
afterEach(() => {
  fake.engine.info.storeAvailable = true;
});

/** Complete at the `|` of a document; the context is the analysis of that document. */
function complete(marked: string, ctx?: EngineContext) {
  const pos = marked.indexOf("|");
  const doc = marked.slice(0, pos) + marked.slice(pos + 1);
  const state = EditorState.create({ doc });
  const use = ctx ?? contextOf(fake.engine.analyse(doc));
  const result = ruleCompletionSource(() => use)(new CompletionContext(state, pos, true));
  return { state, pos, result: result && "options" in result ? result : null };
}
const labels = (marked: string, ctx?: EngineContext) =>
  (complete(marked, ctx).result?.options ?? []).map((o) => o.label);
/** Take `label` at the `|` and return the document. */
function take(marked: string, label: string): string {
  const { state, pos, result } = complete(marked);
  expect(result!.options.map((o) => o.label)).toContain(label);
  return state.update(insertCompletionText(state, label, result!.from, pos)).state.doc.toString();
}

describe("the fake engine's joined datasets", () => {
  it("lists the Match_Datasets names, their join type and the store's variables", () => {
    expect(joinedOf(analysis).map((j) => [j.name, j.joinType])).toEqual([["DM", "left"]]);
    expect(joinedOf(analysis)[0].variables?.map((v) => `DM.${v.name}`)).toEqual(DM_VARS);
    expect(fake.engine.analyse(RULE("    X")).joined?.[0].variables?.[0].products).toEqual([
      "standards/sdtmig/3-3",
    ]);
    // no Join_Type: the engine's default
    expect(fake.engine.analyse(RULE("    X", undefined, undefined, null)).joined).toEqual([
      expect.objectContaining({ name: "DM", joinType: "inner" }),
    ]);
    expect(fake.engine.analyse('Id: "X"\n').joined).toBeUndefined();
  });

  it("lists the names without variables without a store", () => {
    expect(analyseWithoutStore(RULE("    X")).joined).toEqual([
      { name: "DM", joinType: "left", variables: [] },
    ]);
  });

  it("leaves out what the server does: no Keys, Child, SUPP-- template, RELREC, &TOKEN&", () => {
    const doc = [
      "Match_Datasets:",
      '- Name: "SUPPAE"',
      '  Keys: ["USUBJID"]',
      '- Name: "SQAPDM"',
      '  Keys: ["USUBJID"]',
      '- Name: "SUPP--"',
      '  Keys: ["USUBJID"]',
      '- Name: "CO"',
      "  Child: true",
      '  Keys: ["USUBJID"]',
      '- Name: "RELREC"',
      '- Name: "&DOM&"',
      '  Keys: ["USUBJID"]',
      '- Name: "TS"',
      '- Name: "ADSL"',
      '  Keys: ["USUBJID"]',
      'Check: { expression: "X" }',
    ].join("\n");
    // a keyed concrete SUPP / SQ family is listed (the server serves SUPPQUAL's variables for it)
    expect(fake.engine.analyse(doc).joined?.map((j) => j.name)).toEqual([
      "SUPPAE",
      "SQAPDM",
      "ADSL",
    ]);
  });
});

describe("joined-dataset completion in an expression", () => {
  it("offers DM.<VAR> at every operand position, DM._matched_ only where a boolean stands", () => {
    const opts = complete(RULE("    AESTDTC < |")).result!.options;
    const got = opts.map((o) => o.label);
    expect(got).toEqual(expect.arrayContaining(["AETERM", "--TERM", ...DM_VARS]));
    expect(got).not.toContain("DM._matched_"); // a comparison operand: MATCHED_FLAG_INVALID
    expect(opts.find((o) => o.label === "DM.RFSTDTC")).toMatchObject({
      type: "variable",
      detail: "joined DM · datetime",
      info: "Subject Reference Start Date/Time",
    });
    for (const at of [
      "    |",
      "    not |",
      "    AESTDTC < DM.RFSTDTC and |",
      "    AESTDTC < DM.RFSTDTC or not |",
      "    (|",
      "    X and (not |",
      "    any(joined(|",
      "    AESTDTC == (joined(|",
    ]) {
      expect(labels(RULE(at)), at).toContain("DM._matched_");
    }
    for (const at of [
      "    AESTDTC == |",
      "    AESTDTC in |",
      "    AESTDTC in [|",
      "    AESTDTC + |",
      "    AESTDTC + (|",
      "    empty(|",
      "    empty_within_except_last_row(AETERM, |",
    ]) {
      expect(labels(RULE(at)), at).not.toContain("DM._matched_");
    }
    const flag = complete(RULE("    |")).result!.options.find((o) => o.label === "DM._matched_");
    expect(flag).toMatchObject({ detail: "join matched — boolean" });
  });

  it("offers DM._matched_ for a left join only (inner: constant-true, refused)", () => {
    expect(labels(RULE("    |", undefined, undefined, "inner"))).not.toContain("DM._matched_");
    expect(labels(RULE("    |", undefined, undefined, null))).not.toContain("DM._matched_");
    expect(labels(RULE("    |", undefined, undefined, null))).toContain("DM.RFSTDTC");
    expect(labels(RULE("    |", undefined, undefined, "LEFT"))).toContain("DM._matched_");
  });

  it("narrows to DM's entries after `DM.`, replacing the whole qualified word", () => {
    const { state, pos, result } = complete(RULE("    AESTDTC < DM.RF|"));
    expect(result!.options.map((o) => o.label)).toEqual(DM_VARS);
    expect(state.sliceDoc(result!.from, pos)).toBe("DM.RF");
    const validFor = result!.validFor as RegExp;
    expect(validFor.test("DM.RFST")).toBe(true);
    expect(validFor.test("dm.")).toBe(true);
    expect(validFor.test("DM")).toBe(false); // backing out of the qualifier re-queries
    expect(validFor.test("AE")).toBe(false);
    expect(take(RULE("    AESTDTC < DM.RF|"), "DM.RFSTDTC")).toContain(
      "    AESTDTC < DM.RFSTDTC\nOutcome:",
    );
    expect(labels(RULE("    DM.|"))).toEqual([...DM_VARS, "DM._matched_"]);
    // the qualifier is matched case-insensitively (the names ruling)
    expect(labels(RULE("    AESTDTC < dm.|"))).toEqual(DM_VARS);
  });

  it("offers only and / or after a flag, nothing joined at an operator position", () => {
    expect(labels(RULE("    DM._matched_ |"))).toEqual([...LOGICAL_OPERATORS]);
    expect(labels(RULE("    not DM._matched_ |"))).toEqual([...LOGICAL_OPERATORS]);
    expect(labels(RULE("    X and dm._matched_ |"))).toEqual([...LOGICAL_OPERATORS]);
    // the suffix is exact (OperandClassifier.MATCHED_FLAG): `_MATCHED_` reads as a name
    expect(labels(RULE("    DM._MATCHED_ |"))).toContain("==");
    const ops = labels(RULE("    AESTDTC |"));
    expect(ops).toContain("<");
    expect(ops.filter((l) => l.startsWith("DM."))).toEqual([]);
    expect(labels(RULE("    DM.RFSTDTC |"))).toContain("<");
    const named = labels(RULE("    empty_within_except_last_row(AETERM, by=1, |)"));
    expect(named).toEqual(["group=", "keep_missings="]);
  });

  it("keeps today's lists exactly when the analysis carries no joined datasets", () => {
    const old = withoutJoined();
    const operand = labels(RULE("    AESTDTC < |"), context);
    expect(labels(RULE("    AESTDTC < |"), old)).toEqual(
      operand.filter((l) => !l.startsWith("DM.")),
    );
    // `DM.` is no qualifier then: the whole list, from the word's start, as before
    const { state, pos, result } = complete(RULE("    AESTDTC < DM.|"), old);
    expect(state.sliceDoc(result!.from, pos)).toBe("DM.");
    expect(result!.options.map((o) => o.label)).toEqual(labels(RULE("    AESTDTC < |"), old));
    expect(result!.validFor).toEqual(/^[\w$&.-]*$/);
    expect(labels(RULE("    X", "|"), old)).toEqual(
      labels(RULE("    X", "|"), context).filter((l) => !l.startsWith("DM.")),
    );
    expect(joinedOptions(old, true)).toEqual([]);
    expect(joinedOptions({ ...context, analysis: null }, true)).toEqual([]);
  });

  it("without a store: no variables, the flag at a boolean position, no crash", () => {
    const noStore = (marked: string) => {
      const doc = marked.replace("|", "");
      return labels(marked, contextOf(analyseWithoutStore(doc)));
    };
    expect(noStore(RULE("    DM.|"))).toEqual(["DM._matched_"]);
    expect(noStore(RULE("    DM.|", undefined, undefined, null))).toEqual([]);
    expect(noStore(RULE("    AESTDTC < DM.|"))).toEqual([]);
    expect(noStore(RULE("    X", "DM.|"))).toEqual([]);
    expect(noStore(RULE("    AESTDTC < |"))).toEqual(
      expect.arrayContaining(["empty", "empty_within_except_last_row"]),
    );
  });
});

/** A rule whose DM join filters DM; `filter` is the Filter's value line(s). */
const FILTERED = (filter: string) =>
  [
    "Scope:",
    "  Domains:",
    '    Include: ["AE"]',
    "Bindings:",
    '- name: "$t"',
    '  expression: "1"',
    "Match_Datasets:",
    '- Name: "ADSL"',
    '  Keys: ["USUBJID"]',
    '- Name: "DM"',
    "  Keys:",
    '  - "USUBJID"',
    '  Join_Type: "left"',
    filter,
    "Check:",
    '  expression: "not DM._matched_"',
    "",
  ].join("\n");

describe("joined-dataset completion in a Match_Datasets Filter", () => {
  const OWN = ["USUBJID", "RFSTDTC", "RFENDTC", "SEX"];
  const check = (got: string[]) => {
    expect(got).toEqual(expect.arrayContaining([...OWN, "empty", "empty_within_except_last_row"]));
    // nothing of the primary, no binding, no qualified name, no flag, no quantifier
    for (const absent of ["AETERM", "--TERM", "$t", "any", "TRTSDT", "SAFFL"]) {
      expect(got, absent).not.toContain(absent);
    }
    expect(got.filter((l) => l.includes("."))).toEqual([]);
  };

  it("offers the entry's own variables bare, and functions (inline value)", () => {
    check(labels(FILTERED("  Filter: 'SEX == \"F\" and |'")));
    check(labels(FILTERED("  Filter: |")));
    expect(labels(FILTERED("  Filter: 'SEX |'"))).toContain("==");
    expect(labels(FILTERED("  Filter: 'DM.|'"))).toEqual([]);
    expect(take(FILTERED("  Filter: 'RF|'"), "RFSTDTC")).toContain("  Filter: 'RFSTDTC'\n");
  });

  it("offers the same in a block scalar, and in the entry the cursor is in", () => {
    check(labels(FILTERED('  Filter: >-\n    SEX == "F" and\n    |')));
    // the ADSL entry's Filter: ADSL's variables
    const adsl = labels(
      FILTERED("  Filter: 'X'").replace(
        '  Keys: ["USUBJID"]\n- Name: "DM"',
        '  Keys: ["USUBJID"]\n  Filter: |\n- Name: "DM"',
      ),
    );
    expect(adsl).toEqual(expect.arrayContaining(["TRTSDT", "SAFFL"]));
    expect(adsl).not.toContain("RFSTDTC");
  });
});

describe("qualified names outside an expression", () => {
  it("offers DM.<VAR> (no flag) in Output_Variables list items, quoted or with a `!`", () => {
    expect(labels(RULE("    X", "DM.|"))).toEqual(DM_VARS);
    const all = labels(RULE("    X", "|"));
    expect(all).toEqual(expect.arrayContaining(["AETERM", "DM.RFSTDTC"]));
    expect(all).not.toContain("DM._matched_");
    expect(take(RULE("    X", '"!DM.RF|"'), "DM.RFSTDTC")).toContain('  - "!DM.RFSTDTC"\n');
    expect(take(RULE("    X", '"DM.RF|"'), "DM.RFSTDTC")).toContain('  - "DM.RFSTDTC"\n');
  });

  it("offers them in flow sequences of variable lists", () => {
    const flow = RULE("    X").replace(
      '  Output_Variables:\n  - "AETERM"',
      '  Output_Variables: ["AETERM", DM.|]',
    );
    expect(labels(flow)).toEqual(DM_VARS);
    const all = RULE("    X").replace(
      "Check:",
      'Requirements:\n  Variables:\n    All: ["DM.RF|"]\nCheck:',
    );
    expect(labels(all)).toEqual(DM_VARS);
    expect(take(all, "DM.RFSTDTC")).toContain('    All: ["DM.RFSTDTC"]\n');
  });

  it("offers qualified Keys of EARLIER inner entries only", () => {
    const two = (dmJoin: string, key: string) =>
      [
        "Match_Datasets:",
        '- Name: "DM"',
        `  Keys: [${key === "dm" ? '"USUBJID", |' : '"USUBJID"'}]`,
        ...(dmJoin ? [`  Join_Type: "${dmJoin}"`] : []),
        '- Name: "ADSL"',
        "  Keys:",
        `  - ${key === "dm" ? '"RPHASE"' : key}`,
        "Check:",
        '  expression: "X"',
        "",
      ].join("\n");
    // the second entry's Keys: the first's qualified names, beside the bare ones
    const keys = labels(two("", "|"));
    expect(keys).toEqual(expect.arrayContaining(["USUBJID", ...DM_VARS]));
    expect(keys.filter((l) => l.startsWith("ADSL."))).toEqual([]);
    expect(keys).not.toContain("DM._matched_");
    expect(labels(two("", '"DM.RF|"'))).toEqual(DM_VARS);
    // a left source is refused (guide: "A `left` source is refused")
    expect(labels(two("left", "|")).filter((l) => l.includes("."))).toEqual([]);
    // the first entry's own Keys (flow): nothing qualified — no earlier entry
    expect(labels(two("", "dm")).filter((l) => l.includes("."))).toEqual([]);
  });
});

describe("matchEntries", () => {
  it("finds each block entry's Name and range", () => {
    const doc = FILTERED("  Filter: 'X'");
    const entries = matchEntries(doc);
    expect(entries.map((e) => e.name)).toEqual(["ADSL", "DM"]);
    expect(doc.slice(entries[1].from, entries[1].to)).toBe(
      '- Name: "DM"\n  Keys:\n  - "USUBJID"\n  Join_Type: "left"\n  Filter: \'X\'',
    );
    expect(matchEntries("Match_Datasets:\n- Keys: [A]\n  Name: TP\nCheck: {}\n")).toEqual([
      expect.objectContaining({ name: "TP" }),
    ]);
    expect(matchEntries("Check: {}\n")).toEqual([]);
  });
});

describe("joined-dataset tooltips", () => {
  const at = (doc: string, needle: string, offset = 1) => doc.indexOf(needle) + offset;

  it("describes a qualified joined variable", () => {
    expect(tooltipAt(DOC, at(DOC, "DM.RFSTDTC", 4), context)).toMatchObject({
      from: at(DOC, "DM.RFSTDTC", 0),
      to: at(DOC, "DM.RFSTDTC", "DM.RFSTDTC".length),
      content: {
        title: "DM.RFSTDTC",
        lines: [
          "Subject Reference Start Date/Time · datetime · Exp · Record Qualifier",
          "joined via Match_Datasets DM",
          "versions: standards/sdtmig/3-3",
        ],
      },
    });
    expect(tooltipAt(DOC, at(DOC, "DM.SEX", 4), context)?.content).toMatchObject({
      title: "DM.SEX",
      lines: expect.arrayContaining(["codelists: C66731", "joined via Match_Datasets DM"]),
    });
    expect(findJoined(analysis, "dm.rfstdtc")).toMatchObject({ kind: "variable", dataset: "DM" });
  });

  it("explains the _matched_ flag, its suffix exact", () => {
    expect(tooltipAt(DOC, at(DOC, "DM._matched_", 5), context)?.content).toEqual({
      title: "DM._matched_",
      lines: [
        "boolean",
        "true on a row that found a partner in DM, false where the join found none",
        "joined via Match_Datasets DM",
      ],
    });
    expect(findJoined(analysis, "dm._matched_")).toMatchObject({ kind: "matched" });
    expect(findJoined(analysis, "DM._MATCHED_")).toMatchObject({ kind: "unknown" });
  });

  it("never falls back to the primary's variable when the qualifier names a joined dataset", () => {
    const doc = RULE("    DM.AETERM == AETERM");
    expect(tooltipAt(doc, at(doc, "DM.AETERM", 4), context)?.content).toEqual({
      title: "DM.AETERM",
      lines: ["not a variable of DM in the rule's standards", "joined via Match_Datasets DM"],
    });
    // the bare name still is the primary's
    expect(tooltipAt(doc, at(doc, "== AETERM", 4), context)?.content?.title).toBe("AETERM");
    const noStore = contextOf(analyseWithoutStore(doc));
    expect(tooltipAt(doc, at(doc, "DM.AETERM", 4), noStore)?.content?.lines).toEqual([
      "DM's variables are unknown: no metadata store",
      "joined via Match_Datasets DM",
    ]);
  });

  it("falls back to today's lookup without joined data", () => {
    const old = withoutJoined();
    expect(tooltipAt(DOC, at(DOC, "DM._matched_", 5), old)).toBeNull();
    expect(tooltipAt(DOC, at(DOC, "DM.RFSTDTC", 4), old)).toBeNull(); // RFSTDTC is not in scope
    expect(findJoined(old.analysis, "DM.RFSTDTC")).toBeUndefined();
    expect(findJoined(analysis, "RFSTDTC")).toBeUndefined();
  });
});

describe("boolean positions against the corpus's _matched_ uses", () => {
  /** Real Check expressions (cumba-corej-rules rules-src/checks), shortened where long. */
  const USES = [
    "not DM._matched_",
    '(SV._matched_ and SV.SVPRESP == "Y" or SV._matched_ and not var_exists(SV.SVPRESP) or not SV._matched_ and not contains(upper(VISIT), "UNPLAN"))',
    "not empty(FAOBJ) and (AE._matched_ and FAOBJ != AE.AETERM or BE._matched_ and FAOBJ != BE.BETERM)",
    "not empty(PPRFTDTC) and PC._matched_ and not empty(PC.PCRFTDTC) and PPRFTDTC != PC.PCRFTDTC",
  ];

  it("places every flag at a boolean position, and its successor among and / or", () => {
    let flags = 0;
    for (const expression of USES) {
      for (const m of expression.matchAll(/[A-Z]+\._matched_/g)) {
        flags++;
        const before = classifyExpression(expression.slice(0, m.index));
        expect(before, `${expression} @${m.index}`).toMatchObject({
          kind: "operand",
          boolean: true,
        });
        const after = classifyExpression(expression.slice(0, m.index + m[0].length) + " ");
        expect(after).toEqual({ kind: "operator", operators: [...LOGICAL_OPERATORS] });
      }
      // every other operand start after a comparison is no boolean position
      for (const m of expression.matchAll(/(?:==|!=) /g)) {
        const p = classifyExpression(expression.slice(0, m.index + m[0].length));
        expect(p.kind === "operand" && p.boolean, expression).toBeFalsy();
      }
    }
    expect(flags).toBe(7);
  });
});
