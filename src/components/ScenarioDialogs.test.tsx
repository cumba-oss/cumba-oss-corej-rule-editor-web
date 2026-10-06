import { describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "../test/renderWithProviders";
import { fake } from "../test/handlers";
import { NewScenarioDialog, TakeExpectedDialog } from "./ScenarioDialogs";
import { EngineBanner, versionBanner } from "./EngineBanner";

const analysis = fake.engine.analyse('Core:\n  Id: "CDISC-CG0270"\n');

describe("NewScenarioDialog", () => {
  it("builds a scenario from the rule: picked datasets, referenced ∪ required columns, one empty row", async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn();
    renderWithProviders(
      <NewScenarioDialog
        request={{ mode: "rule" }}
        ruleId="CDISC-CG0270"
        analysis={analysis}
        existing={["CDISC-CG0270-invalid-AE.cdt"]}
        sourceText={null}
        onCreate={onCreate}
        onCancel={vi.fn()}
      />,
    );
    const dialog = await screen.findByRole("dialog");
    // the evaluation domain is pre-selected; the suggested name follows expect + dataset
    expect(within(dialog).getByRole("checkbox", { name: "AE" })).toBeChecked();
    expect(within(dialog).getByLabelText("File name")).toHaveValue("CDISC-CG0270-invalid-AE.cdt");
    expect(within(dialog).getByText("a scenario of that name exists")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Create" })).toBeDisabled();
    expect(within(dialog).getByText("Columns: AETERM, USUBJID, AESEQ")).toBeInTheDocument();

    await user.click(within(dialog).getByRole("checkbox", { name: "CM" }));
    await user.type(within(dialog).getByLabelText("More datasets"), "suppae");
    await user.clear(within(dialog).getByLabelText("File name"));
    await user.type(within(dialog).getByLabelText("File name"), "CDISC-CG0270-invalid-two");
    await user.click(within(dialog).getByRole("button", { name: "Create" }));
    expect(onCreate).toHaveBeenCalledTimes(1);
    const [name, content] = onCreate.mock.calls[0] as [string, string];
    expect(name).toBe("CDISC-CG0270-invalid-two.cdt");
    expect(content).toBe(
      [
        "#!RuleTest",
        "#test CDISC-CG0270 expect=violation",
        "#expectViolationCount 1",
        "",
        "dataset AE",
        'col AETERM type=Char label="Reported Term for the Adverse Event"',
        'col USUBJID type=Char label="Unique Subject Identifier"',
        'col AESEQ type=Num label="Sequence Number"',
        "---",
        ". | . | .",
        "---",
        "",
        "dataset CM",
        'col AETERM type=Char label="Reported Term for the Adverse Event"',
        'col USUBJID type=Char label="Unique Subject Identifier"',
        'col AESEQ type=Num label="Sequence Number"',
        "---",
        ". | . | .",
        "---",
        "",
        "dataset SUPPAE",
        'col AETERM type=Char label="Reported Term for the Adverse Event"',
        'col USUBJID type=Char label="Unique Subject Identifier"',
        'col AESEQ type=Num label="Sequence Number"',
        "---",
        ". | . | .",
        "---",
        "",
      ].join("\n"),
    );
  });

  it("without an analysis lets the user name the datasets, and validates the file name", async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn();
    renderWithProviders(
      <NewScenarioDialog
        request={{ mode: "rule" }}
        ruleId="FDA-SD1142"
        analysis={null}
        existing={[]}
        sourceText={null}
        onCreate={onCreate}
        onCancel={vi.fn()}
      />,
    );
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/No in-scope dataset is known/)).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Create" })).toBeDisabled();
    await user.type(within(dialog).getByLabelText("More datasets"), "DM");
    await user.clear(within(dialog).getByLabelText("File name"));
    await user.type(within(dialog).getByLabelText("File name"), "bad name");
    expect(within(dialog).getByText("letters, digits, . _ - only")).toBeInTheDocument();
    await user.clear(within(dialog).getByLabelText("File name"));
    await user.type(within(dialog).getByLabelText("File name"), "ok");
    await user.click(within(dialog).getByRole("button", { name: "Create" }));
    expect(onCreate).toHaveBeenCalledWith(
      "ok.cdt",
      expect.stringContaining("dataset DM\ncol USUBJID type=Char\n---\n.\n---"),
    );
  });

  it("writes the parser's expect= token for a scenario that expects no violation", async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn();
    renderWithProviders(
      <NewScenarioDialog
        request={{ mode: "rule" }}
        ruleId="CDISC-CG0270"
        analysis={analysis}
        existing={[]}
        sourceText={null}
        onCreate={onCreate}
        onCancel={vi.fn()}
      />,
    );
    const dialog = await screen.findByRole("dialog");
    await user.click(
      within(dialog)
        .getAllByLabelText("expect")
        .find((e) => e.tagName === "INPUT")!,
    );
    // RuleTestCdt accepts violation / noViolation / skipped / executionError — never no-violation
    await user.click(await screen.findByRole("option", { name: "noViolation" }));
    expect(within(dialog).getByLabelText("File name")).toHaveValue("CDISC-CG0270-valid-AE.cdt");
    await user.click(within(dialog).getByRole("button", { name: "Create" }));
    const content = onCreate.mock.calls[0][1] as string;
    expect(content).toContain("#test CDISC-CG0270 expect=noViolation domain=AE\n");
    expect(content).not.toContain("#expectViolationCount");
  });

  it("clones the source buffer under a new name", async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn();
    const onCancel = vi.fn();
    renderWithProviders(
      <NewScenarioDialog
        request={{ mode: "clone", source: { name: "CDISC-CG0270-invalid-AE.cdt", path: "p" } }}
        ruleId="CDISC-CG0270"
        analysis={analysis}
        existing={["CDISC-CG0270-invalid-AE.cdt"]}
        sourceText={"#test CDISC-CG0270 expect=violation\n"}
        onCreate={onCreate}
        onCancel={onCancel}
      />,
    );
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByLabelText("File name")).toHaveValue(
      "CDISC-CG0270-invalid-AE-copy.cdt",
    );
    await user.click(within(dialog).getByRole("button", { name: "Create" }));
    expect(onCreate).toHaveBeenCalledWith(
      "CDISC-CG0270-invalid-AE-copy.cdt",
      "#test CDISC-CG0270 expect=violation\n",
    );
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalled();
  });
});

describe("TakeExpectedDialog", () => {
  it("shows the proposed lines as a diff and writes only on confirmation", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    renderWithProviders(
      <TakeExpectedDialog
        opened
        scenarioName="x.cdt"
        current={["#expectViolationCount 1", "#expectViolationAt AETERM=HEADACHE"]}
        proposed={[
          "#expectViolationCount 2",
          "#expectViolationAt AETERM=HEADACHE",
          "#expectViolationAt AETERM=NAUSEA",
        ]}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );
    const diff = await screen.findByLabelText("expectation diff");
    expect(diff.textContent).toBe(
      [
        "- #expectViolationCount 1",
        "  #expectViolationAt AETERM=HEADACHE",
        "+ #expectViolationCount 2",
        "+ #expectViolationAt AETERM=NAUSEA",
      ].join(""),
    );
    expect(onConfirm).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Write into the buffer" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("disables writing when the scenario already expects exactly this", async () => {
    renderWithProviders(
      <TakeExpectedDialog
        opened
        scenarioName="x.cdt"
        current={["#expectViolationCount 1"]}
        proposed={["#expectViolationCount 1"]}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(
      await screen.findByText("The scenario already expects exactly this."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Write into the buffer" })).toBeDisabled();
  });
});

describe("EngineBanner", () => {
  it("fires on any mismatch, naming both levels, with direction-specific text", () => {
    expect(versionBanner(3, 3)).toBeNull();
    // not known yet: no banner; declared none: level 0, which predates every engine (review 8)
    expect(versionBanner(3, undefined)).toBeNull();
    expect(versionBanner(3, null)).toEqual({
      title: "This branch predates the engine — update from default",
      message:
        "The branch declares no rule-language level (rules-src/LANGUAGE-LEVEL), so it predates level 1; this editor's engine runs level 3. Rules may fail to load until the branch is updated from the default branch.",
    });
    expect(versionBanner(undefined, 3)).toBeNull();
    expect(versionBanner(3, 4)).toEqual({
      title: "This branch needs a newer editor",
      message: "The branch declares rule-language level 4; this editor's engine runs level 3.",
    });
    expect(versionBanner(3, 2)?.title).toBe(
      "This branch predates the engine — update from default",
    );
    expect(versionBanner(3, 2)?.message).toContain("level 2; this editor's engine runs level 3");
  });

  it("renders the banner and the quiet no-store notice", () => {
    const { rerender } = renderWithProviders(
      <EngineBanner engine={{ languageLevel: 2, storeAvailable: true }} branchLevel={2} />,
    );
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("note")).toBeNull();
    rerender(
      <EngineBanner
        engine={{ languageLevel: 2, storeAvailable: false, storeReason: "no store dir" }}
        branchLevel={3}
      />,
    );
    expect(screen.getByText("This branch needs a newer editor")).toBeInTheDocument();
    expect(screen.getByRole("note")).toHaveTextContent(
      "No metadata store on this instance (no store dir)",
    );
    rerender(<EngineBanner engine={null} branchLevel={3} />);
    expect(screen.queryByText("This branch needs a newer editor")).toBeNull();
    expect(screen.queryByRole("note")).toBeNull();
  });
});
