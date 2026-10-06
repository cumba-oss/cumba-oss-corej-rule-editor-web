import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { EditorView } from "@codemirror/view";
import { foldedRanges } from "@codemirror/language";
import { renderWithProviders } from "../test/renderWithProviders";
import { CodeEditor } from "./CodeEditor";

function viewOf(container: HTMLElement): EditorView {
  const dom = container.querySelector(".cm-editor");
  const view = dom && EditorView.findFromDOM(dom as HTMLElement);
  if (!view) throw new Error("no CodeMirror view");
  return view;
}

const YAML = ["Authorities:", "  - Organization: CDISC", "Core:", "  Id: X"].join("\n");

describe("CodeEditor", () => {
  it("renders YAML with the region labelled and reports edits", async () => {
    const onChange = vi.fn();
    const { container } = renderWithProviders(
      <CodeEditor label="CDISC-CG0270.yaml" language="yaml" value={YAML} onChange={onChange} />,
    );
    expect(screen.getByRole("region", { name: "CDISC-CG0270.yaml" })).toBeInTheDocument();
    expect(container.textContent).toContain("Organization: CDISC");
    act(() => {
      viewOf(container).dispatch({ changes: { from: 0, insert: "# note\n" } });
    });
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(onChange.mock.calls.at(-1)?.[0]).toBe(`# note\n${YAML}`);
  });

  it("Ctrl+S calls onSave and swallows the key", async () => {
    const onSave = vi.fn();
    const { container } = renderWithProviders(
      <CodeEditor label="x" language="yaml" value="a: 1" onChange={vi.fn()} onSave={onSave} />,
    );
    const content = container.querySelector(".cm-content") as HTMLElement;
    const event = new KeyboardEvent("keydown", {
      key: "s",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    fireEvent(content, event);
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
    // the latest onSave is the one called (ref, not a rebuilt extension set)
    const later = vi.fn();
    renderWithProviders(<CodeEditor label="y" value="plain" onChange={vi.fn()} onSave={later} />);
    const plain = screen
      .getByRole("region", { name: "y" })
      .querySelector(".cm-content") as HTMLElement;
    fireEvent(plain, new KeyboardEvent("keydown", { key: "s", ctrlKey: true, bubbles: true }));
    expect(later).toHaveBeenCalledTimes(1);
  });

  it("folds the requested top-level keys once per trigger and clamps markers", async () => {
    const { container, rerender } = renderWithProviders(
      <CodeEditor
        label="x"
        language="yaml"
        value={YAML}
        onChange={vi.fn()}
        initialFoldKeys={["Authorities", "Nope"]}
        foldTrigger="load-1"
        markers={[{ from: 0, to: 11, severity: "error", message: "bad key" }]}
      />,
    );
    await waitFor(() => {
      const view = viewOf(container);
      let folded = 0;
      foldedRanges(view.state).between(0, view.state.doc.length, () => {
        folded++;
      });
      expect(folded).toBe(1);
    });
    // a marker past the end of the document is dropped, one crossing it is clamped
    rerender(
      <CodeEditor
        label="x"
        language="yaml"
        value={YAML}
        onChange={vi.fn()}
        initialFoldKeys={["Authorities"]}
        foldTrigger="load-1"
        markers={[
          { from: 0, to: 9999, severity: "warning", message: "long" },
          { from: 9999, to: 10000, severity: "info", message: "gone" },
        ]}
      />,
    );
    await waitFor(() => expect(container.querySelector(".cm-lintRange-warning")).not.toBeNull());
  });
});

describe("CodeEditor — the greyed generated fields (phase 3)", () => {
  const RULE =
    'Core:\n  Id: "X"\nSeverity: "Error"\nOutcome:\n  Message: "m"\nStandards:\n- Organization: "CDISC"\n';
  const derived = {
    sensitivity: "Record",
    sensitivityConfidence: "HIGH",
    sensitivityRationale: "row-level reads only",
    outputVariables: {
      effective: ["USUBJID", "AETERM"],
      authored: ["AETERM"],
      excluded: ["AESEQ"],
      derived: true,
    },
    authorities: [{ Organization: "CDISC" }],
    wildcardNames: [],
  };
  const engine = {
    schema: null,
    functions: [],
    analysis: null,
    related: null,
    lookupCodelist: async () => null,
  };

  it("renders Sensitivity and Output_Variables as read-only widgets outside the document", async () => {
    const onChange = vi.fn();
    const { container, rerender } = renderWithProviders(
      <CodeEditor
        label="x"
        language="yaml"
        value={RULE}
        onChange={onChange}
        engine={engine}
        derived={{ derived, status: "ok", showAuthorities: false }}
      />,
    );
    await waitFor(() => expect(container.querySelectorAll(".cm-derived-widget")).toHaveLength(2));
    const [sensitivity, output] = Array.from(container.querySelectorAll(".cm-derived-widget"));
    expect(sensitivity).toHaveAttribute("aria-label", "Sensitivity (generated, read-only)");
    expect(sensitivity).toHaveAttribute("role", "note");
    expect(sensitivity.textContent).toContain(
      'Sensitivity: "Record"   # generated · confidence HIGH',
    );
    expect(sensitivity.querySelector("[title]")).toHaveAttribute("title", "row-level reads only");
    // the effective list in its order, the authored entry marked, the derived one (USUBJID) not,
    // then the exclusion struck through — line for line
    expect(Array.from(output.children).map((d) => d.textContent)).toEqual([
      "Output_Variables:   # generated · effective",
      '- "USUBJID"',
      '- "AETERM"   # authored',
      '- "!AESEQ"   # excluded',
    ]);
    const struck = Array.from(output.querySelectorAll("div")).find((d) =>
      d.textContent?.includes("!AESEQ"),
    )!;
    expect(struck.style.textDecoration).toBe("line-through");
    // the widgets sit where the packaged shape would: Sensitivity after Severity, Output_Variables
    // inside Outcome — and the document is untouched
    const dom = container.querySelector(".cm-editor") as HTMLElement;
    const view = EditorView.findFromDOM(dom)!;
    expect(view.state.doc.toString()).toBe(RULE);
    expect(onChange).not.toHaveBeenCalled();
    expect(container.querySelector(".cm-derived-stale")).toBeNull();

    rerender(
      <CodeEditor
        label="x"
        language="yaml"
        value={RULE}
        onChange={onChange}
        engine={engine}
        derived={{ derived, status: "pending", showAuthorities: true }}
      />,
    );
    await waitFor(() => expect(container.querySelectorAll(".cm-derived-widget")).toHaveLength(3));
    expect(container.querySelectorAll(".cm-derived-stale")).toHaveLength(3);
    expect(container.querySelector(".cm-derived-widget")!.textContent).toContain("stale");
    const authorities = container.querySelectorAll(".cm-derived-widget")[2];
    expect(authorities.textContent).toContain("Authorities:");
    expect(authorities.textContent).toContain("Organization: CDISC");

    rerender(
      <CodeEditor
        label="x"
        language="yaml"
        value={RULE}
        onChange={onChange}
        engine={engine}
        derived={{ derived: null, status: "failed", showAuthorities: false }}
      />,
    );
    await waitFor(() =>
      expect(container.querySelector(".cm-derived-widget")!.textContent).toContain(
        "stale — analysis failed",
      ),
    );
    expect(container.querySelector(".cm-derived-widget")!.textContent).toContain("Sensitivity: —");
  });

  it("says why an Output_Variables list is empty, and what a rule that failed to load lists", async () => {
    const outputOf = (c: HTMLElement) =>
      Array.from(c.querySelectorAll(".cm-derived-widget")[1].children).map((d) => d.textContent);
    const ov = (outputVariables: typeof derived.outputVariables) => ({
      derived: { ...derived, outputVariables },
      status: "ok" as const,
      showAuthorities: false,
    });
    const { container, rerender } = renderWithProviders(
      <CodeEditor
        label="x"
        language="yaml"
        value={RULE}
        onChange={vi.fn()}
        engine={engine}
        derived={ov({ effective: [], authored: [], excluded: [], derived: true })}
      />,
    );
    // P4: an empty effective list is not "reports nothing"
    await waitFor(() =>
      expect(outputOf(container)).toEqual([
        "Output_Variables:   # generated · effective",
        "# none listed — at run time the engine reports the columns the Check reads",
      ]),
    );
    // P7 / L2: derived=false is a rule that failed to load — the authored list, said so, no P4
    rerender(
      <CodeEditor
        label="x"
        language="yaml"
        value={RULE}
        onChange={vi.fn()}
        engine={engine}
        derived={ov({
          effective: ["AETERM"],
          authored: ["AETERM"],
          excluded: ["AESEQ"],
          derived: false,
        })}
      />,
    );
    await waitFor(() =>
      expect(outputOf(container)).toEqual([
        "Output_Variables:   # generated · rule failed to load — list as authored",
        '- "AETERM"',
        '- "!AESEQ"   # excluded',
      ]),
    );
    rerender(
      <CodeEditor
        label="x"
        language="yaml"
        value={RULE}
        onChange={vi.fn()}
        engine={engine}
        derived={ov({ effective: [], authored: [], excluded: [], derived: false })}
      />,
    );
    await waitFor(() =>
      expect(outputOf(container)).toEqual([
        "Output_Variables:   # generated · rule failed to load — list as authored",
      ]),
    );
  });

  it("reveals a range on request and folds JSON by brackets", async () => {
    const { container, rerender } = renderWithProviders(
      <CodeEditor
        label="r"
        language="yaml"
        value={RULE}
        onChange={vi.fn()}
        reveal={{ from: 2, to: 6, seq: 1 }}
      />,
    );
    await waitFor(() => {
      const view = viewOf(container);
      expect(view.state.selection.main.from).toBe(2);
      expect(view.state.selection.main.to).toBe(6);
    });
    rerender(
      <CodeEditor
        label="r"
        language="yaml"
        value={RULE}
        onChange={vi.fn()}
        reveal={{ from: 9999, to: 99999, seq: 2 }}
      />,
    );
    await waitFor(() => expect(viewOf(container).state.selection.main.from).toBe(RULE.length));
    renderWithProviders(
      <CodeEditor
        label="j"
        language="json"
        value={'{\n  "a": [\n    1\n  ]\n}'}
        onChange={vi.fn()}
        readOnly
      />,
    );
    const json = screen.getByRole("region", { name: "j" });
    await waitFor(() =>
      expect(
        json.querySelectorAll(".cm-foldGutter .cm-gutterElement [title]").length,
      ).toBeGreaterThan(0),
    );
  });

  describe("colour scheme", () => {
    afterEach(() => {
      vi.unstubAllGlobals();
      window.localStorage.clear();
    });

    it("follows the COMPUTED scheme: auto on a dark OS gives the dark brand theme at first render", () => {
      // under "auto" useMantineColorScheme() answers "auto" — the old `=== "dark"` test rendered light
      vi.stubGlobal("matchMedia", (query: string) => ({
        matches: query.includes("dark"),
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }));
      const { container } = renderWithProviders(
        <CodeEditor label="x" language="yaml" value="a: 1" onChange={vi.fn()} />,
      );
      expect(viewOf(container).state.facet(EditorView.darkTheme)).toBe(true);
    });

    it("takes a stored dark choice", () => {
      window.localStorage.setItem("cumba-theme", "dark");
      const { container } = renderWithProviders(
        <CodeEditor label="x" language="yaml" value="a: 1" onChange={vi.fn()} />,
      );
      expect(viewOf(container).state.facet(EditorView.darkTheme)).toBe(true);
    });

    it("is light under auto with a light OS", () => {
      const { container } = renderWithProviders(
        <CodeEditor label="x" language="yaml" value="a: 1" onChange={vi.fn()} />,
      );
      expect(viewOf(container).state.facet(EditorView.darkTheme)).toBe(false);
    });
  });
});
