import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EditorView } from "@codemirror/view";
import { renderWithProviders } from "../test/renderWithProviders";
import { fake } from "../test/handlers";
import type { ServiceInfoT } from "../api/types";
import { EditorShell } from "./EditorShell";

// These flows wait out the 400 ms analysis debounce several times each; under the parallel
// coverage run that passes vitest's default 5 s.
vi.setConfig({ testTimeout: 20_000 });

const RULE = "rules-src/checks/CDISC/CDISC-CG0270.yaml";
const SUITE = "src/test/resources/net/cumba/corej/core/ruletestsuites/cdisc/CDISC-CG0270";
const INVALID = `${SUITE}/CDISC-CG0270-invalid-AE.cdt`;

function info(engine = fake.engine.info): ServiceInfoT {
  return {
    service: "s",
    repository: { url: "u", owner: "cumba", name: "rules", forge: "gitea" },
    engine,
  };
}

function renderShell(serviceInfo: ServiceInfoT | null = info()) {
  return renderWithProviders(
    <EditorShell
      info={serviceInfo}
      session={{ ...fake.user, mode: "EDIT" }}
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
  return (await screen.findByText(name)).closest("tr")!;
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
  it("fires on a mismatch in either direction, not when the branch declares no level", async () => {
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
    fake.engine.branchLanguageLevel = null;
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
