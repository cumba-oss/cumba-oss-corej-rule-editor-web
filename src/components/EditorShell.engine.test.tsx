import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EditorView } from "@codemirror/view";
import { renderWithProviders } from "../test/renderWithProviders";
import { fake } from "../test/handlers";
import type { ServiceInfoT, SessionInfoT } from "../api/types";
import { EditorShell } from "./EditorShell";

// These flows wait out the 400 ms analysis debounce several times each; under the parallel
// coverage run that passes vitest's default 5 s.
vi.setConfig({ testTimeout: 20_000 });

const RULE = "rules-src/checks/CDISC/CDISC-CG0270.yaml";
const SUITE = "src/test/resources/net/cumba/corej/core/ruletestsuites/cdisc/CDISC-CG0270";
const INVALID = `${SUITE}/CDISC-CG0270-invalid-AE.cdt`;
const DOCS = "rules-src/docs/CDISC/CDISC-CG0270.yaml";

/** Let pending promise callbacks (an answer that arrived) run before asserting a non-event. */
function settle(ms = 150): Promise<void> {
  return act(() => new Promise<void>((r) => setTimeout(r, ms)));
}

/** A promise the test resolves: the fake holds its answer until then. */
function gate(): { promise: Promise<void>; release: () => void } {
  let release!: () => void;
  const promise = new Promise<void>((r) => {
    release = r;
  });
  return { promise, release };
}

function info(engine = fake.engine.info): ServiceInfoT {
  return {
    service: "s",
    repository: { url: "u", owner: "cumba", name: "rules", forge: "gitea" },
    engine,
  };
}

function renderShell(
  serviceInfo: ServiceInfoT | null = info(),
  mode: SessionInfoT["mode"] = "EDIT",
) {
  return renderWithProviders(
    <EditorShell
      info={serviceInfo}
      session={{ ...fake.user, mode }}
      onSession={vi.fn()}
      onLoggedOut={vi.fn()}
    />,
  );
}

async function openRule(user: ReturnType<typeof userEvent.setup>, id = "CDISC-CG0270") {
  await user.click(await screen.findByLabelText("family CDISC"));
  await user.click(screen.getByLabelText(`rule ${id}`));
  return screen.findByRole("tab", { name: `${id}.yaml` });
}

function mainView(container: HTMLElement): EditorView {
  const dom = container.querySelector(".cm-editor") as HTMLElement;
  return EditorView.findFromDOM(dom)!;
}

function appendToBuffer(container: HTMLElement, insert: string) {
  const view = mainView(container);
  act(() => {
    view.dispatch({ changes: { from: view.state.doc.length, insert } });
  });
}

/** The scenario row of the Scenarios tab. */
async function scenarioRow(name: string): Promise<HTMLElement> {
  const table = await screen.findByRole("table", { name: "scenarios" });
  return (await within(table).findByText(name)).closest("tr")!;
}

describe("EditorShell — analysis on change (§5.4)", () => {
  it("analyses the opened rule, re-analyses 400 ms after an edit, sends the dirty docs buffer, and marks diagnostics", async () => {
    const user = userEvent.setup();
    const { container } = renderShell();
    await openRule(user);
    await waitFor(() => expect(fake.engine.analyses).toHaveLength(1));
    expect(fake.engine.analyses[0]).toEqual({ path: RULE, content: fake.files.get(RULE)!.content });
    // the widgets appear once the analysis is in
    await waitFor(() => expect(container.querySelectorAll(".cm-derived-widget")).toHaveLength(2));
    await waitFor(() => expect(container.querySelector(".cm-derived-stale")).toBeNull());
    expect(container.querySelector(".cm-derived-widget")!.textContent).toContain(
      'Sensitivity: "Record"',
    );

    // one edit, then a second within the debounce window: one more analysis of the final buffer
    appendToBuffer(container, "Check:\n  expression: a BA");
    expect(container.querySelector(".cm-derived-stale")).not.toBeNull(); // dims at once
    appendToBuffer(container, "D\n");
    await waitFor(() => expect(fake.engine.analyses).toHaveLength(2), { timeout: 3000 });
    expect(fake.engine.analyses[1].content).toContain("expression: a BAD\n");
    expect(fake.engine.analyses[1].docs).toBeUndefined();
    await waitFor(() => expect(container.querySelector(".cm-lintRange-error")).not.toBeNull());
    await waitFor(() =>
      expect(screen.getByRole("tab", { name: "Problems (1)" })).toBeInTheDocument(),
    );

    // the docs tab, dirty, rides along with the next analysis; its DOCS diagnostic marks the docs buffer
    await user.click(screen.getByRole("button", { name: "Open docs" }));
    await screen.findByRole("tab", { name: "CDISC-CG0270.yaml (docs)" });
    appendToBuffer(container, "# DOCBAD\n");
    await waitFor(() => expect(fake.engine.analyses).toHaveLength(3), { timeout: 3000 });
    expect(fake.engine.analyses[2]).toMatchObject({
      path: RULE,
      docs: expect.stringContaining("DOCBAD"),
    });
    await waitFor(() =>
      expect(screen.getByRole("tab", { name: "Problems (2)" })).toBeInTheDocument(),
    );
    await waitFor(() => expect(container.querySelector(".cm-lintRange-error")).not.toBeNull());

    // a DOCS diagnostic from the rule tab points into the docs tab
    await user.click(screen.getByRole("tab", { name: "CDISC-CG0270.yaml" }));
    await user.click(screen.getByRole("tab", { name: "Problems (2)" }));
    await user.click(screen.getByRole("button", { name: /docs: docs name another rule/ }));
    await waitFor(() =>
      expect(screen.getByRole("tab", { name: "CDISC-CG0270.yaml (docs)" })).toHaveAttribute(
        "aria-selected",
        "true",
      ),
    );
    await waitFor(() => expect(mainView(container).state.selection.main.to).toBe(4));
  });

  it("toggles the Authorities widget and reports a failed analysis as stale with a retry", async () => {
    const user = userEvent.setup();
    fake.engine.nextAnalyseProblem = { status: 500, code: "INTERNAL" };
    const { container } = renderShell();
    await openRule(user);
    await waitFor(() => expect(fake.engine.analyses).toHaveLength(1));
    await waitFor(() =>
      expect(container.querySelector(".cm-derived-widget")!.textContent).toContain(
        "stale — analysis failed",
      ),
    );
    await user.click(screen.getByRole("tab", { name: "Problems" }));
    expect(await screen.findByText(/Analysis failed: INTERNAL/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "retry" }));
    await waitFor(() => expect(fake.engine.analyses).toHaveLength(2), { timeout: 3000 });
    await waitFor(() => expect(container.querySelector(".cm-derived-stale")).toBeNull());

    expect(container.querySelectorAll(".cm-derived-widget")).toHaveLength(2);
    await user.click(screen.getByRole("button", { name: "Show Authorities" }));
    await waitFor(() => expect(container.querySelectorAll(".cm-derived-widget")).toHaveLength(3));
    expect(container.querySelectorAll(".cm-derived-widget")[2].textContent).toContain(
      "Authorities:",
    );
    await user.click(screen.getByRole("button", { name: "Hide Authorities" }));
    await waitFor(() => expect(container.querySelectorAll(".cm-derived-widget")).toHaveLength(2));
    // the buffer never carries a widget
    expect(mainView(container).state.doc.toString()).toBe(fake.files.get(RULE)!.content);
  });
});

describe("EditorShell — run (§5.7) and take actual as expected (§5.6)", () => {
  it("runs the rule buffer against the selected scenario buffer on F5, one at a time", async () => {
    const user = userEvent.setup();
    const { container } = renderShell();
    await openRule(user);
    await scenarioRow("CDISC-CG0270-invalid-AE.cdt");
    // the first scenario is the default target; an edit of the rule buffer is what runs
    appendToBuffer(container, "# edited\n");
    let release!: () => void;
    fake.engine.holdRun = new Promise<void>((r) => {
      release = r;
    });
    fireEvent.keyDown(window, { key: "F5" });
    await waitFor(() => expect(fake.engine.runs).toHaveLength(1));
    expect(fake.engine.runs[0]).toEqual({
      path: RULE,
      content: expect.stringContaining("# edited\n"),
      scenarioPath: INVALID,
      scenarioContent: fake.files.get(INVALID)!.content,
    });
    // a second F5 while busy is refused client-side
    fireEvent.keyDown(window, { key: "F5" });
    expect(await screen.findByText("A run is already in progress.")).toBeInTheDocument();
    expect(fake.engine.runs).toHaveLength(1);
    release();
    await waitFor(() =>
      expect(screen.getByRole("tab", { name: "Results (PASS)" })).toBeInTheDocument(),
    );
    const row = await scenarioRow("CDISC-CG0270-invalid-AE.cdt");
    expect(row).toHaveTextContent("PASS");

    // select the other scenario: it becomes the target
    await user.click(await scenarioRow("CDISC-CG0270-valid-AE.cdt"));
    await user.click(screen.getAllByRole("button", { name: "Run (F5)" })[0]);
    await waitFor(() => expect(fake.engine.runs).toHaveLength(2));
    expect(fake.engine.runs[1].scenarioPath).toBe(`${SUITE}/CDISC-CG0270-valid-AE.cdt`);
    await waitFor(() =>
      expect(screen.getByRole("tab", { name: "Results (FAIL)" })).toBeInTheDocument(),
    );
    await user.click(screen.getByRole("tab", { name: "Results (FAIL)" }));
    expect(screen.getByText("unexpected violation")).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "JSON" }));
    expect(screen.getByRole("region", { name: "report JSON" })).toHaveTextContent('"json-2"');
  });

  it("reports RUN_BUSY / RATE_LIMITED plainly", async () => {
    const user = userEvent.setup();
    renderShell();
    await openRule(user);
    await scenarioRow("CDISC-CG0270-invalid-AE.cdt");
    fake.engine.nextRunProblem = { status: 503, code: "RUN_BUSY" };
    fireEvent.keyDown(window, { key: "F5" });
    expect(await screen.findByText("another run is in progress (RUN_BUSY)")).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "Results" }));
    const resultsAlert = () =>
      screen.getAllByRole("alert").find((a) => a.textContent?.startsWith("Run failed:"));
    expect(resultsAlert()).toHaveTextContent("Run failed: another run is in progress (RUN_BUSY)");
    fake.engine.nextRunProblem = { status: 429, code: "RATE_LIMITED" };
    fireEvent.keyDown(window, { key: "F5" });
    await waitFor(() => expect(resultsAlert()).toHaveTextContent("RATE_LIMITED"));
    // the REST fold's codes: one run per user (409), a workspace held by another request (503)
    fake.engine.nextRunProblem = { status: 409, code: "RUN_IN_PROGRESS" };
    fireEvent.keyDown(window, { key: "F5" });
    await waitFor(() => expect(resultsAlert()).toHaveTextContent("(RUN_IN_PROGRESS)"));
    fake.engine.nextRunProblem = { status: 503, code: "WORKSPACE_BUSY" };
    fireEvent.keyDown(window, { key: "F5" });
    await waitFor(() => expect(resultsAlert()).toHaveTextContent("(WORKSPACE_BUSY)"));
  });

  it("shows the proposed expectation lines as a diff and writes the scenario buffer only on confirmation", async () => {
    const user = userEvent.setup();
    const { container } = renderShell();
    await openRule(user);
    await scenarioRow("CDISC-CG0270-invalid-AE.cdt");
    fake.engine.nextReport = {
      expectations: {
        count: 2,
        ats: 2,
        lines: [
          "#expectViolationCount 2",
          "#expectViolationAt AETERM=HEADACHE",
          "#expectViolationAt AETERM=NAUSEA",
        ],
      },
    };
    fireEvent.keyDown(window, { key: "F5" });
    await waitFor(() =>
      expect(screen.getByRole("tab", { name: "Results (PASS)" })).toBeInTheDocument(),
    );
    await user.click(screen.getByRole("tab", { name: "Results (PASS)" }));
    await user.click(screen.getByRole("button", { name: "Take actual as expected" }));
    const dialog = await screen.findByRole("dialog");
    // the scenario tab was opened so the diff is against its BUFFER
    expect(screen.getByRole("tab", { name: "CDISC-CG0270-invalid-AE.cdt" })).toBeInTheDocument();
    expect(within(dialog).getByLabelText("expectation diff").textContent).toBe(
      [
        "- #expectViolationCount 1",
        "  #expectViolationAt AETERM=HEADACHE",
        "+ #expectViolationCount 2",
        "+ #expectViolationAt AETERM=NAUSEA",
      ].join(""),
    );
    expect(fake.files.get(INVALID)!.content).toContain("#expectViolationCount 1\n"); // nothing written yet
    await user.click(within(dialog).getByRole("button", { name: "Write into the buffer" }));
    await waitFor(() =>
      expect(screen.getByRole("tab", { name: "CDISC-CG0270-invalid-AE.cdt" })).toHaveTextContent(
        "●",
      ),
    );
    const text = mainView(container).state.doc.toString();
    expect(text).toContain(
      "#expectViolationCount 2\n#expectViolationAt AETERM=HEADACHE\n#expectViolationAt AETERM=NAUSEA\ndataset AE\n",
    );
    expect(text).not.toContain("#expectViolationCount 1");
    // the buffer, not the file: nothing was saved
    expect(fake.files.get(INVALID)!.content).toContain("#expectViolationCount 1\n");
    expect(fake.mutations.filter((m) => m.method === "PUT")).toHaveLength(0);
  });
});

describe("EditorShell — new scenarios (§5.6)", () => {
  it("creates one from the rule as an unsaved tab in the suite directory, which becomes the run target and lists after a save", async () => {
    const user = userEvent.setup();
    const { container } = renderShell();
    await openRule(user);
    await scenarioRow("CDISC-CG0270-invalid-AE.cdt");
    await waitFor(() => expect(fake.engine.analyses).toHaveLength(1));
    await user.click(screen.getByRole("button", { name: "New from rule" }));
    const dialog = await screen.findByRole("dialog");
    await user.clear(within(dialog).getByLabelText("File name"));
    await user.type(within(dialog).getByLabelText("File name"), "CDISC-CG0270-invalid-new");
    await user.click(within(dialog).getByRole("button", { name: "Create" }));
    const tab = await screen.findByRole("tab", { name: "CDISC-CG0270-invalid-new.cdt" });
    expect(tab).toHaveTextContent("●");
    expect(tab).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText(`${SUITE}/CDISC-CG0270-invalid-new.cdt`)).toBeInTheDocument();
    const text = mainView(container).state.doc.toString();
    expect(text).toContain("#test CDISC-CG0270 expect=violation domain=AE\n");
    expect(text).toContain('col AETERM type=Char label="Reported Term for the Adverse Event"');
    expect(text).toContain("---\n. | . | .\n---");
    // it is the run target
    fireEvent.keyDown(window, { key: "F5" });
    await waitFor(() => expect(fake.engine.runs).toHaveLength(1));
    expect(fake.engine.runs[0].scenarioPath).toBe(`${SUITE}/CDISC-CG0270-invalid-new.cdt`);
    expect(fake.engine.runs[0].scenarioContent).toBe(text);
    // saved: the suite lists it
    await user.click(screen.getByRole("button", { name: "Save (Ctrl+S)" }));
    await screen.findByText("Saved — push now?");
    await user.click(screen.getByRole("button", { name: "Later" }));
    await waitFor(() =>
      expect(screen.getByRole("tab", { name: "Scenarios (3)" })).toBeInTheDocument(),
    );
  });

  it("clones the selected scenario's buffer", async () => {
    const user = userEvent.setup();
    const { container } = renderShell();
    await openRule(user);
    await user.click(await scenarioRow("CDISC-CG0270-valid-AE.cdt"));
    await user.click(screen.getByRole("button", { name: "Clone" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByLabelText("File name")).toHaveValue(
      "CDISC-CG0270-valid-AE-copy.cdt",
    );
    await user.click(within(dialog).getByRole("button", { name: "Create" }));
    expect(
      await screen.findByRole("tab", { name: "CDISC-CG0270-valid-AE-copy.cdt" }),
    ).toHaveTextContent("●");
    expect(mainView(container).state.doc.toString()).toBe(
      fake.files.get(`${SUITE}/CDISC-CG0270-valid-AE.cdt`)!.content,
    );
  });
});

describe("EditorShell — engine-version banner (O13) and the store notice", () => {
  it("fires on a mismatch in either direction, and for a branch that declares no level", async () => {
    fake.engine.branchLanguageLevel = 2;
    const { unmount } = renderShell(info({ ...fake.engine.info, languageLevel: 1 }));
    expect(await screen.findByText("This branch needs a newer editor")).toBeInTheDocument();
    expect(screen.getByText(/level 2; this editor's engine runs level 1/)).toBeInTheDocument();
    unmount();
    fake.engine.branchLanguageLevel = 1;
    const second = renderShell(info({ ...fake.engine.info, languageLevel: 3 }));
    expect(
      await screen.findByText("This branch predates the engine — update from default"),
    ).toBeInTheDocument();
    second.unmount();
    // no rules-src/LANGUAGE-LEVEL: level 0, the branch predates the engine (review 8)
    fake.engine.branchLanguageLevel = null;
    const third = renderShell(info({ ...fake.engine.info, languageLevel: 3 }));
    expect(
      await screen.findByText("This branch predates the engine — update from default"),
    ).toBeInTheDocument();
    expect(screen.getByText(/declares no rule-language level/)).toBeInTheDocument();
    third.unmount();
    // agreeing levels: no banner
    fake.engine.branchLanguageLevel = 3;
    renderShell(info({ ...fake.engine.info, languageLevel: 3 }));
    await screen.findByLabelText("family CDISC");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("notes a missing store quietly and completes without a schema", async () => {
    const user = userEvent.setup();
    fake.engine.info = {
      ...fake.engine.info,
      storeAvailable: false,
      storeFormat: -1,
      storeReason: "no store directory",
    };
    fake.engine.schemaAvailable = false;
    renderShell(info());
    expect(await screen.findByRole("note")).toHaveTextContent(
      "No metadata store on this instance (no store directory)",
    );
    await openRule(user);
    await waitFor(() => expect(fake.engine.analyses).toHaveLength(1));
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("EditorShell — review fold (PLAN-rule-editor web review)", () => {
  it("binds take-actual-as-expected to the scenario the run ran, not to the selection (review 1)", async () => {
    const user = userEvent.setup();
    const { container } = renderShell();
    await openRule(user);
    await scenarioRow("CDISC-CG0270-invalid-AE.cdt");
    fireEvent.keyDown(window, { key: "F5" }); // the default target: invalid-AE
    await waitFor(() =>
      expect(screen.getByRole("tab", { name: "Results (PASS)" })).toBeInTheDocument(),
    );
    // another scenario selected: the report still names its own, and offers nothing to take
    await user.click(await scenarioRow("CDISC-CG0270-valid-AE.cdt"));
    await user.click(screen.getByRole("tab", { name: "Results (PASS)" }));
    expect(screen.getByLabelText("report scenario")).toHaveTextContent(
      "Scenario CDISC-CG0270-invalid-AE.cdt — not the selected scenario (CDISC-CG0270-valid-AE.cdt)",
    );
    expect(screen.queryByRole("button", { name: "Take actual as expected" })).toBeNull();

    // back on the scenario it ran: the proposal writes THAT buffer, the other stays untouched
    await user.click(screen.getByRole("tab", { name: /^Scenarios/ }));
    await user.click(await scenarioRow("CDISC-CG0270-invalid-AE.cdt"));
    await user.click(screen.getByRole("tab", { name: "Results (PASS)" }));
    expect(screen.getByLabelText("report scenario")).toHaveTextContent(
      "Scenario CDISC-CG0270-invalid-AE.cdt",
    );
    fake.engine.nextReport = null;
    await user.click(screen.getByRole("button", { name: "Take actual as expected" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Take actual as expected — CDISC-CG0270-invalid-AE.cdt");
    // the fake proposes exactly what the scenario holds: nothing to write
    expect(within(dialog).getByRole("button", { name: "Write into the buffer" })).toBeDisabled();
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("tab", { name: "CDISC-CG0270-valid-AE.cdt" })).toBeNull();
    expect(mainView(container).state.doc.toString()).toBe(fake.files.get(INVALID)!.content);
  });

  it("refuses to take expectations from a run of a scenario or rule that changed since (confirmation look)", async () => {
    const user = userEvent.setup();
    const { container } = renderShell();
    await openRule(user);
    await scenarioRow("CDISC-CG0270-invalid-AE.cdt");
    fireEvent.keyDown(window, { key: "F5" });
    await waitFor(() =>
      expect(screen.getByRole("tab", { name: "Results (PASS)" })).toBeInTheDocument(),
    );
    // edit the scenario the run judged: delete its second row
    await user.dblClick(await scenarioRow("CDISC-CG0270-invalid-AE.cdt"));
    await screen.findByRole("tab", { name: "CDISC-CG0270-invalid-AE.cdt" });
    const view = mainView(container);
    act(() => {
      const text = view.state.doc.toString();
      const at = text.indexOf("01-701-1016 | . | 2\n");
      view.dispatch({ changes: { from: at, to: at + "01-701-1016 | . | 2\n".length } });
    });
    await user.click(screen.getByRole("tab", { name: "Results (PASS)" }));
    expect(screen.getByLabelText("report scenario")).toHaveTextContent(
      "changed since this run — run again",
    );
    const take = screen.getByRole("button", { name: "Take actual as expected" });
    expect(take).toBeDisabled();
    await user.click(take);
    expect(screen.queryByRole("dialog")).toBeNull();
    // undo the edit: the report describes the buffer again
    act(() => {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: fake.files.get(INVALID)!.content },
      });
    });
    expect(screen.getByRole("button", { name: "Take actual as expected" })).toBeEnabled();
    // a rule edit after the run makes it stale too
    await user.click(screen.getByRole("tab", { name: "CDISC-CG0270.yaml" }));
    appendToBuffer(container, "# edited after the run\n");
    await user.click(screen.getByRole("tab", { name: "Results (PASS)" }));
    expect(screen.getByRole("button", { name: "Take actual as expected" })).toBeDisabled();
  });

  it("shows the #test expect= rewrite in the diff and writes it with the lines (REST fold)", async () => {
    const user = userEvent.setup();
    const { container } = renderShell();
    await openRule(user);
    await user.click(await scenarioRow("CDISC-CG0270-valid-AE.cdt"));
    // the valid scenario expects no violation; the run finds one and proposes expect=violation
    fake.engine.nextReport = {
      expectations: {
        count: 1,
        ats: 1,
        lines: ["#expectViolationCount 1", "#expectViolationAt AETERM=HEADACHE"],
        expect: "violation",
      },
    };
    fireEvent.keyDown(window, { key: "F5" });
    await waitFor(() =>
      expect(screen.getByRole("tab", { name: "Results (FAIL)" })).toBeInTheDocument(),
    );
    await user.click(screen.getByRole("tab", { name: "Results (FAIL)" }));
    await user.click(screen.getByRole("button", { name: "Take actual as expected" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByLabelText("expectation diff").textContent).toBe(
      [
        "- #test CDISC-CG0270 expect=noViolation domain=AE",
        "+ #test CDISC-CG0270 expect=violation domain=AE",
        "+ #expectViolationCount 1",
        "+ #expectViolationAt AETERM=HEADACHE",
      ].join(""),
    );
    await user.click(within(dialog).getByRole("button", { name: "Write into the buffer" }));
    await waitFor(() =>
      expect(screen.getByRole("tab", { name: "CDISC-CG0270-valid-AE.cdt" })).toHaveTextContent("●"),
    );
    expect(mainView(container).state.doc.toString()).toBe(
      "#!RuleTest\n#test CDISC-CG0270 expect=violation domain=AE\n#expectViolationCount 1\n#expectViolationAt AETERM=HEADACHE\ndataset AE\ncol AETERM type=Char\n---\nx\n---\n",
    );
  });

  it("hides a report of another branch (review 1)", async () => {
    const user = userEvent.setup();
    renderShell();
    await openRule(user);
    await scenarioRow("CDISC-CG0270-invalid-AE.cdt");
    fireEvent.keyDown(window, { key: "F5" });
    await waitFor(() =>
      expect(screen.getByRole("tab", { name: "Results (PASS)" })).toBeInTheDocument(),
    );
    await user.click(screen.getByRole("button", { name: "branch" }));
    await user.click(await screen.findByLabelText("switch to feature/other"));
    await waitFor(() => expect(fake.branch).toBe("feature/other"));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "branch" })).toHaveTextContent("feature/other"),
    );
    // the switch closed every tab; open the rule again (its family may still be expanded)
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    if (!screen.queryByLabelText("rule CDISC-CG0270")) {
      await user.click(await screen.findByLabelText("family CDISC"));
    }
    await user.click(await screen.findByLabelText("rule CDISC-CG0270"));
    await screen.findByRole("tab", { name: "CDISC-CG0270.yaml" });
    await scenarioRow("CDISC-CG0270-invalid-AE.cdt");
    expect(screen.getByRole("tab", { name: "Results" })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: /Results \(/ })).toBeNull();
    expect(await scenarioRow("CDISC-CG0270-invalid-AE.cdt")).toHaveTextContent("not run");
  });

  it("drops an analysis answer for an edit undone before it arrived (review 3a)", async () => {
    const user = userEvent.setup();
    const { container } = renderShell();
    await openRule(user);
    await waitFor(() => expect(fake.engine.analysesAnswered).toBe(1));
    await user.click(screen.getByRole("tab", { name: /^Problems/ }));
    await screen.findByText("Analysed.");
    const view = mainView(container);
    const analysed = view.state.doc.toString();
    const held = gate();
    fake.engine.holdAnalyse = held.promise;
    appendToBuffer(container, "Check:\n  expression: a BAD\n");
    await waitFor(() => expect(fake.engine.analyses).toHaveLength(2), { timeout: 3000 });
    // undo before the answer: the buffer is the analysed content again
    act(() => {
      view.dispatch({ changes: { from: analysed.length, to: view.state.doc.length } });
    });
    expect(view.state.doc.toString()).toBe(analysed);
    held.release();
    await waitFor(() => expect(fake.engine.analysesAnswered).toBe(2));
    await settle();
    // the answer for the undone edit did not land: still analysed, no BAD marker, no new request
    expect(screen.getByText("Analysed.")).toBeInTheDocument();
    expect(screen.queryByText("Analysing…")).toBeNull();
    expect(screen.getByRole("tab", { name: "Problems" })).toBeInTheDocument();
    expect(container.querySelector(".cm-lintRange-error")).toBeNull();
    expect(fake.engine.analyses).toHaveLength(2);
  });

  it("keeps the markers on their text while an analysis is pending (review 3b)", async () => {
    const user = userEvent.setup();
    fake.files.set(RULE, {
      content: 'Core:\n  Id: "CDISC-CG0270"\nCheck:\n  expression: a BAD\n',
      blob: "b270",
    });
    const { container } = renderShell();
    await openRule(user);
    await waitFor(() =>
      expect(container.querySelector(".cm-lintRange-error")?.textContent).toBe("BAD"),
    );
    const held = gate();
    fake.engine.holdAnalyse = held.promise;
    const view = mainView(container);
    act(() => {
      view.dispatch({ changes: { from: 0, insert: "# one\n# two\n" } });
    });
    await waitFor(() => expect(fake.engine.analyses).toHaveLength(2), { timeout: 3000 });
    // past the lint pass (750 ms after the edit): the marker moved WITH its text
    await settle(900);
    expect(container.querySelector(".cm-lintRange-error")?.textContent).toBe("BAD");
    await user.click(screen.getByRole("tab", { name: /^Problems/ }));
    expect(screen.getByText(/stale until the new one is in/)).toBeInTheDocument();
    held.release();
    await waitFor(() => expect(screen.getByText("The rule does not load.")).toBeInTheDocument());
    expect(screen.queryByText(/stale until the new one is in/)).toBeNull();
    expect(container.querySelector(".cm-lintRange-error")?.textContent).toBe("BAD");
  });

  it("analyses a docs tab whose rule is not open, with the rule as saved (review 4)", async () => {
    const user = userEvent.setup();
    const { container } = renderShell();
    await openRule(user);
    await user.click(screen.getByRole("button", { name: "Open docs" }));
    await screen.findByRole("tab", { name: "CDISC-CG0270.yaml (docs)" });
    // close the rule tab: the docs tab is left alone
    await user.click(screen.getByLabelText("close CDISC-CG0270.yaml"));
    await waitFor(() =>
      expect(screen.queryByRole("tab", { name: "CDISC-CG0270.yaml" })).toBeNull(),
    );
    const before = fake.engine.analyses.length;
    appendToBuffer(container, "# DOCBAD\n");
    await waitFor(() => expect(fake.engine.analyses.length).toBe(before + 1), { timeout: 3000 });
    expect(fake.engine.analyses.at(-1)).toEqual({
      path: RULE,
      content: fake.files.get(RULE)!.content,
      docs: fake.files.get(DOCS)!.content + "# DOCBAD\n",
    });
    await waitFor(() =>
      expect(screen.getByRole("tab", { name: "Problems (1)" })).toBeInTheDocument(),
    );
    await waitFor(() => expect(container.querySelector(".cm-lintRange-error")).not.toBeNull());
  });

  it("says a lone docs tab is not analysed when its rule cannot be read (review 4)", async () => {
    const user = userEvent.setup();
    const { container } = renderShell();
    await openRule(user);
    await user.click(screen.getByRole("button", { name: "Open docs" }));
    await screen.findByRole("tab", { name: "CDISC-CG0270.yaml (docs)" });
    // with the rule open, a DOCS diagnostic marks the docs buffer
    appendToBuffer(container, "# DOCBAD\n");
    await waitFor(() => expect(container.querySelector(".cm-lintRange-error")).not.toBeNull(), {
      timeout: 3000,
    });
    // the rule disappears and its tab closes: that analysis describes nothing shown any more
    fake.files.delete(RULE);
    await user.click(screen.getByLabelText("close CDISC-CG0270.yaml"));
    await user.click(screen.getByRole("tab", { name: /^Problems/ }));
    expect(
      await screen.findByText("Not analysed — open the rule to analyse it."),
    ).toBeInTheDocument();
    expect(screen.queryByText("No problems.")).toBeNull();
    expect(screen.getByText(/stale until the new one is in/)).toBeInTheDocument();
    await waitFor(() => expect(container.querySelector(".cm-lintRange-error")).toBeNull());
  });

  it("runs, analyses and proposes expectations in read-only mode without writing (O12)", async () => {
    const user = userEvent.setup();
    fake.mode = "READ_ONLY";
    const { container } = renderShell(info(), "READ_ONLY");
    await openRule(user);
    await waitFor(() => expect(fake.engine.analyses).toHaveLength(1));
    await scenarioRow("CDISC-CG0270-invalid-AE.cdt");
    appendToBuffer(container, "# edited, never saved\n");
    fireEvent.keyDown(window, { key: "F5" });
    await waitFor(() =>
      expect(screen.getByRole("tab", { name: "Results (PASS)" })).toBeInTheDocument(),
    );
    expect(fake.engine.runs[0].content).toContain("# edited, never saved\n");
    fake.engine.nextReport = {
      expectations: { count: 0, ats: 0, lines: ["#expectViolationCount 2"] },
    };
    fireEvent.keyDown(window, { key: "F5" });
    await waitFor(() => expect(fake.engine.runs).toHaveLength(2));
    await user.click(await screen.findByRole("tab", { name: "Results (PASS)" }));
    await user.click(await screen.findByRole("button", { name: "Take actual as expected" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Write into the buffer" }));
    await waitFor(() =>
      expect(mainView(container).state.doc.toString()).toContain("#expectViolationCount 2\n"),
    );
    expect(fake.mutations.filter((m) => m.method === "PUT")).toHaveLength(0);
  });

  it("reloads the suite after any scenario save, and the caches after an update (review 9)", async () => {
    const user = userEvent.setup();
    const { container } = renderShell();
    await openRule(user);
    await user.dblClick(await scenarioRow("CDISC-CG0270-invalid-AE.cdt"));
    await screen.findByRole("tab", { name: "CDISC-CG0270-invalid-AE.cdt" });
    const view = mainView(container);
    act(() => {
      const text = view.state.doc.toString();
      const at = text.indexOf("#expectViolationCount 1");
      view.dispatch({
        changes: {
          from: at,
          to: at + "#expectViolationCount 1".length,
          insert: "#expectViolationCount 3",
        },
      });
    });
    await user.click(screen.getByRole("button", { name: "Save (Ctrl+S)" }));
    await screen.findByText("Saved — push now?");
    await user.click(screen.getByRole("button", { name: "Later" }));
    await waitFor(async () =>
      expect(await scenarioRow("CDISC-CG0270-invalid-AE.cdt")).toHaveTextContent("3 (+1 at)"),
    );

    // an update from the remote branch changes the files under the cache: the suite re-reads
    const merged = fake.files.get(INVALID)!;
    fake.files.set(INVALID, {
      ...merged,
      content: merged.content.replace("#expectViolationCount 3", "#expectViolationCount 5"),
    });
    fake.unpushedCommits = [{ sha: "c9", message: "m", author: "a" }];
    fake.nextPushProblem = { status: 409, code: "NON_FAST_FORWARD" };
    await user.click(await screen.findByRole("button", { name: /Commit \+ Push/ }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: /^(Commit \+ Push|Push)$/ }));
    await user.click(await screen.findByRole("button", { name: "Update from remote branch" }));
    await waitFor(() => expect(fake.head).toBe("merged44"));
    await waitFor(async () =>
      expect(await scenarioRow("CDISC-CG0270-invalid-AE.cdt")).toHaveTextContent("5 (+1 at)"),
    );
  });
});
