import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "../test/renderWithProviders";
import { fake } from "../test/handlers";
import type { Tab } from "../state/tabs";
import { isMissing, ScenarioEditor } from "./ScenarioEditor";

const PATH =
  "src/test/resources/net/cumba/corej/core/ruletestsuites/cdisc/CDISC-CG0270/CDISC-CG0270-invalid-AE.cdt";

function tab(content = fake.files.get(PATH)!.content): Tab {
  return {
    path: PATH,
    kind: "scenario",
    title: "CDISC-CG0270-invalid-AE.cdt",
    content,
    savedContent: content,
    blob: "s1",
  };
}

/** A harness that feeds edits back as the shell would (the text is the truth). */
function Harness({ initial, onChange }: { initial: string; onChange: (c: string) => void }) {
  return <ScenarioEditorState initial={initial} onChange={onChange} />;
}

function ScenarioEditorState({
  initial,
  onChange,
}: {
  initial: string;
  onChange: (c: string) => void;
}) {
  const [content, setContent] = useState(initial);
  return (
    <ScenarioEditor
      tab={tab(content)}
      onChange={(c) => {
        setContent(c);
        onChange(c);
      }}
      onSave={vi.fn()}
      analysis={fake.engine.analyse('Core:\n  Id: "X"\n')}
    />
  );
}

describe("isMissing", () => {
  it("recognises the parser's missing sentinels only", () => {
    for (const s of [".", "._", ".A", ".Z"]) expect(isMissing(s)).toBe(true);
    for (const s of ["", "..", ".a", "x", "\\."]) expect(isMissing(s)).toBe(false);
  });
});

describe("ScenarioEditor — expectations header", () => {
  it("edits the #test, #expectViolationCount and #expectViolationAt lines in place", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderWithProviders(<Harness initial={tab().content} onChange={onChange} />);
    expect(screen.getByText("#test CDISC-CG0270")).toBeInTheDocument();
    expect(screen.getByLabelText("domain")).toHaveValue("AE");
    expect(screen.getByLabelText("expectViolationCount")).toHaveValue("1");
    expect(screen.getByLabelText("expectViolationAt 1")).toHaveValue("AETERM=HEADACHE");

    await user.clear(screen.getByLabelText("domain"));
    await user.type(screen.getByLabelText("domain"), "CM");
    expect(onChange.mock.calls.at(-1)![0]).toContain(
      "#test CDISC-CG0270 expect=violation domain=CM\n",
    );

    await user.clear(screen.getByLabelText("expectViolationCount"));
    await user.type(screen.getByLabelText("expectViolationCount"), "2");
    expect(onChange.mock.calls.at(-1)![0]).toContain(
      "#expectViolationCount 2\n#expectViolationAt AETERM=HEADACHE\n",
    );

    await user.click(screen.getByRole("button", { name: "+ #expectViolationAt" }));
    await user.type(screen.getByLabelText("expectViolationAt 2"), "AESEQ=2");
    expect(onChange.mock.calls.at(-1)![0]).toContain(
      "#expectViolationAt AETERM=HEADACHE\n#expectViolationAt AESEQ=2\ndataset AE",
    );
    await user.click(screen.getByLabelText("remove expectViolationAt 1"));
    expect(onChange.mock.calls.at(-1)![0]).not.toContain("AETERM=HEADACHE");
    // everything else is untouched
    expect(onChange.mock.calls.at(-1)![0]).toContain("01-701-1015 | HEADACHE | 1");
  });
});

describe("ScenarioEditor — grid", () => {
  it("shows one sub-tab per dataset, missing sentinels distinctly, and splices a cell edit", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderWithProviders(<Harness initial={tab().content} onChange={onChange} />);
    await user.click(screen.getByRole("radio", { name: "Grid" }));
    const grid = await screen.findByRole("table", { name: "grid AE" });
    expect(screen.getByRole("tab", { name: "AE" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "DM" })).toBeInTheDocument();
    expect(within(grid).getByText("USUBJID")).toBeInTheDocument();
    expect(within(grid).getByText("Reported Term")).toBeInTheDocument();
    const missing = within(grid).getByLabelText("AETERM row 2");
    expect(missing).toHaveValue(".");
    expect(missing).toHaveAttribute("title", "missing (.)");
    expect(within(grid).getByLabelText("AETERM row 1")).not.toHaveAttribute("title");

    const cell = within(grid).getByLabelText("AETERM row 1");
    await user.clear(cell);
    await user.type(cell, "NAUSEA{Enter}");
    await waitFor(() => expect(fake.engine.splices).toHaveLength(1));
    expect(fake.engine.splices[0].rows![0]).toEqual(["01-701-1015", "NAUSEA", "1"]);
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const text = onChange.mock.calls.at(-1)![0] as string;
    expect(text).toContain("01-701-1015 | NAUSEA | 1");
    expect(text).toContain("01-701-1016 | . | 2");
    // the prelude and the other block are byte for byte as before
    expect(text.startsWith("#!RuleTest\n#test CDISC-CG0270 expect=violation domain=AE\n")).toBe(
      true,
    );
    expect(text).toContain("dataset DM\ncol USUBJID type=Char\n---\n01-701-1015\n---");
    // an Escape drops the edit
    const other = within(await screen.findByRole("table", { name: "grid AE" })).getByLabelText(
      "AESEQ row 1",
    );
    await user.type(other, "9{Escape}");
    expect(fake.engine.splices).toHaveLength(1);
  });

  it("adds and removes rows and columns, offering scope variables with type and label", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderWithProviders(<Harness initial={tab().content} onChange={onChange} />);
    await user.click(screen.getByRole("radio", { name: "Grid" }));
    await screen.findByRole("table", { name: "grid AE" });
    await user.click(screen.getByRole("button", { name: "+ row" }));
    await waitFor(() => expect(fake.engine.splices).toHaveLength(1));
    expect(fake.engine.splices[0].rows).toHaveLength(3);
    expect(fake.engine.splices[0].rows![2]).toEqual([".", ".", "."]);

    await user.click(await screen.findByRole("button", { name: "+ column" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(
      within(dialog).getByPlaceholderText("a scope variable, or any name"),
      "AEDECOD",
    );
    expect(within(dialog).getByLabelText("label")).toHaveValue("Dictionary-Derived Term");
    await user.click(within(dialog).getByRole("button", { name: "Add column" }));
    await waitFor(() => expect(fake.engine.splices).toHaveLength(2));
    const added = fake.engine.splices[1];
    expect(added.columns!.at(-1)).toMatchObject({
      name: "AEDECOD",
      type: "Char",
      label: "Dictionary-Derived Term",
    });
    expect(added.rows![0]).toEqual(["01-701-1015", "HEADACHE", "1", "."]);
    expect(onChange.mock.calls.at(-1)![0]).toContain(
      'col AEDECOD type=Char label="Dictionary-Derived Term"',
    );

    await user.click(await screen.findByLabelText("remove column AEDECOD"));
    await waitFor(() => expect(fake.engine.splices).toHaveLength(3));
    expect(fake.engine.splices[2].columns).toHaveLength(3);
    await user.click(await screen.findByLabelText("remove row 3"));
    await waitFor(() => expect(fake.engine.splices).toHaveLength(4));
    expect(fake.engine.splices[3].rows).toHaveLength(2);
  });

  it("shows a CDT_UNREPRESENTABLE refusal and changes nothing", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderWithProviders(<Harness initial={tab().content} onChange={onChange} />);
    await user.click(screen.getByRole("radio", { name: "Grid" }));
    const grid = await screen.findByRole("table", { name: "grid AE" });
    const cell = within(grid).getByLabelText("AETERM row 1");
    await user.clear(cell);
    await user.type(cell, "a|b{Enter}");
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Not written: cell 'a|b' cannot be written so that the parser reads it back (CDT_UNREPRESENTABLE)",
    );
    expect(onChange).not.toHaveBeenCalled();
  });

  it("explains a text that does not parse, and a document without blocks", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <Harness
        initial={"#test X\ndataset AE\ncol A type=Char\n---\na | b\n---\n"}
        onChange={vi.fn()}
      />,
    );
    await user.click(screen.getByRole("radio", { name: "Grid" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("expected 1 fields, got 2");
    renderWithProviders(<Harness initial={"#test X\n"} onChange={vi.fn()} />);
    await user.click(screen.getAllByRole("radio", { name: "Grid" })[1]);
    expect(await screen.findByText(/No dataset block yet/)).toBeInTheDocument();
  });
});
