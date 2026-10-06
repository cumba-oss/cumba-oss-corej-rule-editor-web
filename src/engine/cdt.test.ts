import { describe, expect, it } from "vitest";
import type { AnalysisT } from "../api/types";
import {
  blockHasComments,
  colLine,
  columnFor,
  datasetText,
  diffLines,
  expectationLines,
  expectationProposal,
  newScenarioFromRule,
  readExpectations,
  setTestExpect,
  testLine,
  scenarioColumns,
  suiteDirOf,
  writeExpectations,
} from "./cdt";

const TEXT = [
  "#!RuleTest",
  "#test CDISC-AD0002 expect=violation domain=ADAE",
  '#note "x"',
  "#expectViolationCount 1",
  '#expectViolationAt variable_name=AESEQ variable_label="Sequence Number MODIFIED"',
  "#expectViolationAt variable_name=AETERM",
  "dataset ADAE",
  "col STUDYID type=Char",
  "---",
  "a",
  "---",
  "",
].join("\n");

const analysis: AnalysisT = {
  coreId: "X",
  loaded: true,
  parked: false,
  diagnostics: [],
  bindings: [],
  storeAvailable: true,
  referencedVariables: [
    { name: "AESEQ", where: "Check", quoted: false },
    { name: "DM.RFSTDTC", where: "Check", quoted: false },
    { name: "--DTC", where: "Check", quoted: false },
    { name: "$x", where: "Check", quoted: false },
  ],
  scope: {
    products: [],
    missingProducts: [],
    datasets: [],
    variables: [
      { name: "AESEQ", label: "Sequence Number", type: "integer", classLevel: false },
      { name: "RFSTDTC", label: "Start", type: "datetime", classLevel: false },
    ],
  },
};

describe("expectations", () => {
  it("reads the header fields and the expectation lines", () => {
    expect(readExpectations(TEXT)).toEqual({
      ruleId: "CDISC-AD0002",
      expect: "violation",
      domain: "ADAE",
      expectViolationCount: 1,
      expectViolationAt: [
        'variable_name=AESEQ variable_label="Sequence Number MODIFIED"',
        "variable_name=AETERM",
      ],
    });
    expect(expectationLines(TEXT)).toHaveLength(3);
    expect(readExpectations("dataset X\n")).toMatchObject({ ruleId: null, expect: null });
  });

  it("rewrites the header lines in place, keeping everything else", () => {
    const out = writeExpectations(TEXT, {
      ruleId: "CDISC-AD0002",
      expect: "noViolation",
      domain: null,
      expectViolationCount: 2,
      expectViolationAt: ["variable_name=AETERM"],
    });
    expect(out.split("\n")).toEqual([
      "#!RuleTest",
      "#test CDISC-AD0002 expect=noViolation",
      '#note "x"',
      "#expectViolationCount 2",
      "#expectViolationAt variable_name=AETERM",
      "dataset ADAE",
      "col STUDYID type=Char",
      "---",
      "a",
      "---",
      "",
    ]);
  });

  it("adds absent lines after the #test line and removes a null count", () => {
    const text = "#!RuleTest\r\n#test R expect=violation\r\ndataset D\r\n---\r\n---\r\n";
    const out = writeExpectations(text, {
      ruleId: "R",
      expect: "violation",
      domain: "D E",
      expectViolationCount: 3,
      expectViolationAt: ["k=v"],
    });
    expect(out).toBe(
      '#!RuleTest\r\n#test R expect=violation domain="D E"\r\n#expectViolationCount 3\r\n#expectViolationAt k=v\r\ndataset D\r\n---\r\n---\r\n',
    );
    const removed = writeExpectations(out, {
      ruleId: "R",
      expect: "violation",
      domain: null,
      expectViolationCount: null,
      expectViolationAt: [],
    });
    expect(removed).toBe("#!RuleTest\r\n#test R expect=violation\r\ndataset D\r\n---\r\n---\r\n");
    // ats go after an existing count when none existed
    const withCount = writeExpectations("#test R\n#expectViolationCount 1\ndataset D\n", {
      ruleId: "R",
      expect: null,
      domain: null,
      expectViolationCount: 1,
      expectViolationAt: ["a=1"],
    });
    expect(withCount).toBe("#test R\n#expectViolationCount 1\n#expectViolationAt a=1\ndataset D\n");
    expect(
      writeExpectations("dataset D\n", {
        ruleId: null,
        expect: null,
        domain: null,
        expectViolationCount: 1,
        expectViolationAt: [],
      }),
    ).toBe("#expectViolationCount 1\ndataset D\n");
  });

  it("keeps CRLF through an in-place rewrite and reads CRLF values without the CR", () => {
    const text = [
      "#!RuleTest",
      "#test R expect=violation domain=AE",
      "#expectViolationCount 1",
      "#expectViolationAt AETERM=X",
      "dataset AE",
      "col AETERM type=Char",
      "---",
      "X",
      "---",
      "",
    ].join("\r\n");
    const e = readExpectations(text);
    expect(e).toEqual({
      ruleId: "R",
      expect: "violation",
      domain: "AE",
      expectViolationCount: 1,
      expectViolationAt: ["AETERM=X"],
    });
    const out = writeExpectations(text, {
      ...e,
      expect: "noViolation",
      expectViolationCount: 2,
      expectViolationAt: ["AETERM=X", "AETERM=Y"],
    });
    expect(out.replace(/\r\n/g, "")).not.toContain("\n");
    expect(out).toBe(
      [
        "#!RuleTest",
        "#test R expect=noViolation domain=AE",
        "#expectViolationCount 2",
        "#expectViolationAt AETERM=X",
        "#expectViolationAt AETERM=Y",
        "dataset AE",
        "col AETERM type=Char",
        "---",
        "X",
        "---",
        "",
      ].join("\r\n"),
    );
    expect(setTestExpect(text, "skipped")).toBe(text.replace("expect=violation", "expect=skipped"));
    expect(blockHasComments(text.replace("X\r\n---", "# why\r\nX\r\n---"), 0)).toBe(true);
  });

  it("proposes the expectation lines, and the #test line only when expect= changes", () => {
    const text =
      "#!RuleTest\n#test R expect=noViolation domain=AE\n#expectViolationCount 0\ndataset AE\n";
    expect(testLine(text)).toBe("#test R expect=noViolation domain=AE");
    expect(testLine("dataset AE\n#test R\n")).toBeNull();
    // the REST app names the new expect= as a field …
    const viaField = expectationProposal(
      text,
      ["#expectViolationCount 1", "#expectViolationAt AETERM=X"],
      "violation",
    );
    expect(viaField).toEqual({
      current: ["#test R expect=noViolation domain=AE", "#expectViolationCount 0"],
      proposed: [
        "#test R expect=violation domain=AE",
        "#expectViolationCount 1",
        "#expectViolationAt AETERM=X",
      ],
      lines: ["#expectViolationCount 1", "#expectViolationAt AETERM=X"],
      expect: "violation",
    });
    // … or as a #test line among the proposed lines — read the same
    expect(
      expectationProposal(text, [
        "#test R expect=violation",
        "#expectViolationCount 1",
        "#expectViolationAt AETERM=X",
      ]),
    ).toEqual(viaField);
    // the same expect= (or none): the #test line is not part of the diff
    expect(expectationProposal(text, ["#expectViolationCount 0"], "noViolation")).toEqual({
      current: ["#expectViolationCount 0"],
      proposed: ["#expectViolationCount 0"],
      lines: ["#expectViolationCount 0"],
      expect: null,
    });
    // the parser reads the token case-insensitively: the same verdict is no change
    expect(
      expectationProposal("#test R expect=noviolation\n", [], "noViolation").expect,
    ).toBeNull();
    // a text without a #test line has no line to rewrite
    expect(expectationProposal("dataset AE\n", [], "violation").expect).toBeNull();
    expect(setTestExpect("dataset AE\n#test R expect=x\n", "y")).toBe(
      "dataset AE\n#test R expect=x\n",
    );
  });

  it("finds comment lines inside a dataset block only", () => {
    const text = [
      "# a prelude comment",
      "#test R",
      "dataset AE",
      "col A type=Char",
      "---",
      "a",
      "# between rows",
      "---",
      "dataset DM",
      "col B type=Char",
      "---",
      "b",
      "---",
      "# after the blocks",
    ].join("\n");
    expect(blockHasComments(text, 0)).toBe(true);
    expect(blockHasComments(text, 1)).toBe(false);
    expect(blockHasComments(text, 2)).toBe(false);
    expect(blockHasComments("dataset AE\ncol A type=Char\ndataset DM\n# x\n", 0)).toBe(false);
    expect(blockHasComments("dataset AE\ncol A type=Char\ndataset DM\n# x\n", 1)).toBe(true);
    // two blocks of one name are told apart by position
    const twice =
      "dataset AE\ncol A type=Char\n---\na\n---\ndataset AE\ncol A type=Char\n---\n# c\nb\n---\n";
    expect(blockHasComments(twice, 0)).toBe(false);
    expect(blockHasComments(twice, 1)).toBe(true);
  });

  it("diffs expectation lines", () => {
    expect(diffLines(["#a", "#b"], ["#b", "#c"])).toEqual([
      { op: "-", line: "#a" },
      { op: " ", line: "#b" },
      { op: "+", line: "#c" },
    ]);
  });
});

describe("new scenarios", () => {
  it("names the suite directory and the columns from the catalogue", () => {
    expect(suiteDirOf("CDISC-CG0270")).toBe(
      "src/test/resources/net/cumba/corej/core/ruletestsuites/cdisc/CDISC-CG0270",
    );
    expect(columnFor("aeseq", analysis)).toEqual({
      name: "AESEQ",
      type: "Num",
      label: "Sequence Number",
      attrs: {},
    });
    expect(columnFor("NOPE", analysis)).toEqual({
      name: "NOPE",
      type: "Char",
      label: undefined,
      attrs: {},
    });
    expect(
      colLine({
        name: "A",
        type: "Char",
        label: 'say "hi"',
        length: 8,
        format: "F",
        codelist: "C1",
        attrs: { x: "y z" },
      }),
    ).toBe('col A type=Char label="say \'hi\'" length=8 format=F codelist=C1 x="y z"');
    expect(scenarioColumns(analysis, ["usubjid"])).toEqual(["AESEQ", "RFSTDTC", "USUBJID"]);
    // required variables (Requirements.Variables) join, class-level ones do not
    expect(
      scenarioColumns({ ...analysis, requiredVariables: ["aeterm", "--DTC", "AESEQ"] }, [
        "USUBJID",
      ]),
    ).toEqual(["AESEQ", "RFSTDTC", "AETERM", "USUBJID"]);
  });

  it("composes a scenario from the rule with one empty row per dataset", () => {
    const text = newScenarioFromRule(
      "CDISC-AD0002",
      ["ADAE"],
      ["AESEQ", "USUBJID"],
      analysis,
      "violation",
    );
    expect(text).toBe(
      [
        "#!RuleTest",
        "#test CDISC-AD0002 expect=violation domain=ADAE",
        "#expectViolationCount 1",
        "",
        "dataset ADAE",
        'col AESEQ type=Num label="Sequence Number"',
        "col USUBJID type=Char",
        "---",
        ". | .",
        "---",
        "",
      ].join("\n"),
    );
    const two = newScenarioFromRule("R", ["AE", "DM"], [], null, "noViolation");
    expect(two).toContain("#test R expect=noViolation\n");
    expect(two).not.toContain("#expectViolationCount");
    expect(two).toContain("dataset DM\n---\n\n---");
    expect(
      datasetText({ name: "X", label: "L", fence: "", columns: [], rows: [["a", "b"]], attrs: {} }),
    ).toBe('dataset X label="L"\n---\na | b\n---');
  });
});
