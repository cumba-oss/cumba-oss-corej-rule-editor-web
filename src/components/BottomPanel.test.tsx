import { describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "../test/renderWithProviders";
import { fake } from "../test/handlers";
import type { Tab } from "../state/tabs";
import { BottomPanel, syntaxProblem } from "./BottomPanel";

const RULE = "rules-src/checks/CDISC/CDISC-CG0270.yaml";
const SCENARIO =
  "src/test/resources/net/cumba/corej/core/ruletestsuites/cdisc/CDISC-CG0270/CDISC-CG0270-invalid-AE.cdt";

const rule: Tab = {
  path: RULE,
  kind: "rule",
  title: "CDISC-CG0270.yaml",
  content: "Core:\n  Id: x\n",
  savedContent: "",
  blob: null,
};

function props(overrides: Partial<Parameters<typeof BottomPanel>[0]> = {}) {
  return {
    tab: rule,
    ruleId: "CDISC-CG0270",
    suite: { value: fake.engine.suite("CDISC-CG0270"), error: null },
    selectedScenario: SCENARIO,
    onSelectScenario: vi.fn(),
    onOpen: vi.fn(),
    onNewScenario: vi.fn(),
    lastRuns: {},
    report: undefined,
    runError: undefined,
    runBusy: false,
    canRun: true,
    onRun: vi.fn(),
    onTakeExpected: vi.fn(),
    analysis: undefined,
    analysisStatus: "none" as const,
    onRetryAnalysis: vi.fn(),
    onGoToDiagnostic: vi.fn(),
    related: undefined,
    ...overrides,
  };
}

describe("syntaxProblem", () => {
  it("reports a YAML error for rule and docs buffers only", () => {
    expect(syntaxProblem(undefined)).toBeNull();
    expect(syntaxProblem(rule)).toBeNull();
    expect(syntaxProblem({ ...rule, content: "a: [1" })).toMatch(/flow|sequence|\[/i);
    expect(syntaxProblem({ ...rule, kind: "scenario", content: "a: [1" })).toBeNull();
  });
});

describe("BottomPanel — Scenarios", () => {
  it("lists the suite's rows, selects on click, opens on double-click, offers new / clone", async () => {
    const user = userEvent.setup();
    const p = props({
      lastRuns: { [SCENARIO]: { outcome: "FAIL", code: "VERDICT", at: 1, branch: "feature/x" } },
      runBusy: false,
    });
    renderWithProviders(<BottomPanel {...p} />);
    expect(screen.getByRole("tab", { name: "Scenarios (2)" })).toBeInTheDocument();
    const table = screen.getByRole("table", { name: "scenarios" });
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("CDISC-CG0270-invalid-AE.cdt");
    expect(rows[0]).toHaveTextContent("violation");
    expect(rows[0]).toHaveTextContent("1 (+1 at)");
    expect(rows[0]).toHaveTextContent("AE, DM");
    expect(rows[0]).toHaveTextContent("FAIL VERDICT");
    expect(rows[0]).toHaveAttribute("aria-selected", "true");
    expect(rows[1]).toHaveTextContent("not run");

    await user.click(rows[1]);
    expect(p.onSelectScenario).toHaveBeenCalledWith(SCENARIO.replace("invalid", "valid"));
    await user.dblClick(rows[1]);
    expect(p.onOpen).toHaveBeenCalledWith(SCENARIO.replace("invalid", "valid"));
    // the keyboard reaches the same two actions (review 7): Space selects, Enter opens
    expect(rows[0]).toHaveAttribute("tabindex", "0");
    rows[0].focus();
    await user.keyboard(" ");
    expect(p.onSelectScenario).toHaveBeenLastCalledWith(SCENARIO);
    await user.keyboard("{Enter}");
    expect(p.onOpen).toHaveBeenLastCalledWith(SCENARIO);

    await user.click(screen.getByRole("button", { name: "New from rule" }));
    expect(p.onNewScenario).toHaveBeenCalledWith("rule");
    await user.click(screen.getByRole("button", { name: "Clone" }));
    expect(p.onNewScenario).toHaveBeenCalledWith(
      "clone",
      expect.objectContaining({ name: "CDISC-CG0270-invalid-AE.cdt" }),
    );
    // sidecars beside the scenarios open as plain files
    await user.click(screen.getByRole("button", { name: "library.json" }));
    expect(p.onOpen).toHaveBeenCalledWith(
      "src/test/resources/net/cumba/corej/core/ruletestsuites/cdisc/CDISC-CG0270/library.json",
    );
    await user.click(screen.getAllByRole("button", { name: "Run (F5)" })[0]);
    expect(p.onRun).toHaveBeenCalled();
  });

  it("explains an empty suite and a missing one", () => {
    renderWithProviders(
      <BottomPanel
        {...props({ suite: { value: { scenarios: [], otherFiles: [] }, error: null } })}
      />,
    );
    expect(screen.getByText("No scenarios yet.")).toBeInTheDocument();
    renderWithProviders(
      <BottomPanel {...props({ suite: { value: null, error: "no dir (NOT_FOUND)" } })} />,
    );
    expect(screen.getAllByText("No scenarios yet.")).toHaveLength(2);
    renderWithProviders(<BottomPanel {...props({ ruleId: null, tab: undefined })} />);
    expect(screen.getByText("Open a rule to list its scenarios.")).toBeInTheDocument();
  });
});

describe("BottomPanel — Results and JSON", () => {
  it("shows the verdict line, the checks, the findings table and offers take-as-expected", async () => {
    const user = userEvent.setup();
    const report = fake.engine.report("rule", "#test X expect=violation");
    const p = props({ report, reportScenario: SCENARIO, reportCurrent: true });
    const { rerender } = renderWithProviders(<BottomPanel {...p} />);
    await user.click(screen.getByRole("tab", { name: "Results (PASS)" }));
    // the header names the scenario the report ran
    expect(screen.getByLabelText("report scenario")).toHaveTextContent(
      "Scenario CDISC-CG0270-invalid-AE.cdt",
    );
    expect(screen.getByText("PASS")).toBeInTheDocument();
    expect(screen.getByText("OK")).toBeInTheDocument();
    expect(screen.getByText("as expected")).toBeInTheDocument();
    expect(screen.getByText("executed, violated as expected")).toBeInTheDocument();
    expect(screen.getByText("1 of 1 expectations met")).toBeInTheDocument();
    const findings = screen.getByRole("table", { name: "findings" });
    const row = within(findings).getAllByRole("row")[1];
    expect(row).toHaveTextContent("01-701-1015");
    expect(row).toHaveTextContent("AESEQ=1");
    expect(row).toHaveTextContent("AETERM=HEADACHE");
    expect(row).toHaveTextContent("Term is wrong");
    await user.click(screen.getByRole("button", { name: "Take actual as expected" }));
    expect(p.onTakeExpected).toHaveBeenCalled();

    // another scenario selected: the report says whose it is, and its expectations cannot be taken
    const other = SCENARIO.replace("invalid", "valid");
    rerender(<BottomPanel {...p} selectedScenario={other} reportCurrent={false} />);
    expect(screen.getByLabelText("report scenario")).toHaveTextContent(
      "Scenario CDISC-CG0270-invalid-AE.cdt — not the selected scenario (CDISC-CG0270-valid-AE.cdt)",
    );
    expect(screen.queryByRole("button", { name: "Take actual as expected" })).toBeNull();
    rerender(<BottomPanel {...p} />);

    await user.click(screen.getByRole("tab", { name: "JSON" }));
    expect(screen.getByRole("region", { name: "report JSON" })).toHaveTextContent('"json-2"');
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    await user.click(screen.getByRole("button", { name: "Copy" }));
    expect(writeText).toHaveBeenCalledWith(report.reportJson);
    URL.createObjectURL = vi.fn(() => "blob:x");
    URL.revokeObjectURL = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    await user.click(screen.getByRole("button", { name: "Download" }));
    expect(click).toHaveBeenCalled();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:x");
  });

  it("reports a failed or skipped run plainly", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <BottomPanel
        {...props({
          runError: "another run is in progress (RUN_BUSY)",
          report: {
            outcome: "ABORTED",
            code: "RULE_ERRORS",
            detail: "the rule does not load",
            scopeGate: { inScope: false, mismatch: "DM is not an EVENTS dataset" },
            skip: { kind: "SCOPE", text: "out of scope" },
            ruleDiagnostics: [{ severity: "ERROR", message: "bad", code: "LOAD_ERROR" }],
            results: [{ ruleId: "R", status: "ERROR", statusMessage: "boom", violationCount: 0 }],
            durationMs: 1,
            worker: "child",
          },
        })}
      />,
    );
    await user.click(screen.getByRole("tab", { name: "Results (ABORTED)" }));
    expect(screen.getByRole("alert")).toHaveTextContent("RUN_BUSY");
    expect(screen.getByText("Scope gate: DM is not an EVENTS dataset")).toBeInTheDocument();
    expect(screen.getByText("SCOPE: out of scope")).toBeInTheDocument();
    expect(screen.getByText("R: ERROR — boom · 0 findings")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "JSON" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Take actual as expected" })).toBeNull();
  });
});

describe("BottomPanel — Problems and Related", () => {
  it("lists check and docs diagnostics, the YAML error, and the analysis state", async () => {
    const user = userEvent.setup();
    const analysis = fake.engine.analyse('Core:\n  Id: "X"\nCheck:\n  expression: BAD\n', "DOCBAD");
    const p = props({
      tab: { ...rule, content: "a: [1" },
      analysis: { content: "a: [1", docs: undefined, analysis, failed: null },
      analysisStatus: "ok",
    });
    renderWithProviders(<BottomPanel {...p} />);
    await user.click(screen.getByRole("tab", { name: "Problems (3)" }));
    expect(screen.getByText(/^YAML:/)).toBeInTheDocument();
    expect(screen.getByText("The rule does not load.")).toBeInTheDocument();
    const docs = screen.getByRole("button", { name: /docs: docs name another rule/ });
    await user.click(docs);
    expect(p.onGoToDiagnostic).toHaveBeenCalledWith(expect.objectContaining({ document: "DOCS" }));
    await user.click(screen.getByRole("button", { name: /unexpected token BAD/ }));
    expect(p.onGoToDiagnostic).toHaveBeenLastCalledWith(
      expect.objectContaining({ code: "EXPRESSION_SYNTAX" }),
    );
  });

  it("shows pending / failed analysis with a retry, and no problems", async () => {
    const user = userEvent.setup();
    const p = props({
      analysisStatus: "failed",
      analysis: { content: "", docs: undefined, analysis: null, failed: "boom (HTTP_500)" },
    });
    const first = renderWithProviders(<BottomPanel {...p} />);
    await user.click(screen.getByRole("tab", { name: "Problems" }));
    expect(screen.getByText(/Analysis failed: boom/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "retry" }));
    expect(p.onRetryAnalysis).toHaveBeenCalled();
    first.unmount();
    const second = renderWithProviders(<BottomPanel {...props({ analysisStatus: "pending" })} />);
    expect(screen.getByText("Analysing…")).toBeInTheDocument();
    second.unmount();
    renderWithProviders(
      <BottomPanel
        {...props({
          analysisStatus: "ok",
          analysis: {
            content: rule.content,
            docs: undefined,
            analysis: fake.engine.analyse(rule.content),
            failed: null,
          },
        })}
      />,
    );
    expect(screen.getByText("No problems.")).toBeInTheDocument();
    expect(screen.getByText("Analysed.")).toBeInTheDocument();
  });

  it("lists related rules, opening those the repository holds", async () => {
    const user = userEvent.setup();
    const p = props({
      related: {
        value: [
          {
            coreId: "FDA-SD1142",
            relation: "SHARED_REFERENCE",
            via: "CG0270",
            family: "FDA",
            path: "rules-src/checks/FDA/FDA-SD1142.yaml",
            exists: true,
          },
          {
            coreId: "PMDA-SD1142",
            relation: "EQUIVALENT",
            via: "EQ-7",
            family: "PMDA",
            path: "x",
            exists: false,
          },
        ],
        error: null,
      },
    });
    renderWithProviders(<BottomPanel {...p} />);
    await user.click(screen.getByRole("tab", { name: "Related (2)" }));
    await user.click(screen.getByRole("button", { name: "FDA-SD1142" }));
    expect(p.onOpen).toHaveBeenCalledWith("rules-src/checks/FDA/FDA-SD1142.yaml");
    expect(screen.getByText("PMDA-SD1142 (not in this repository)")).toBeInTheDocument();
    renderWithProviders(<BottomPanel {...props({ related: { value: [], error: null } })} />);
    expect(screen.getByText("No related rules.")).toBeInTheDocument();
    renderWithProviders(
      <BottomPanel {...props({ related: { value: null, error: "nope (X)" } })} />,
    );
    expect(screen.getByText("nope (X)")).toBeInTheDocument();
  });
});
