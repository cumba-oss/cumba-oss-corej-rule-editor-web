import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "../test/renderWithProviders";
import type { ExplorerTreeT } from "../api/types";
import { Explorer, filterFamilies } from "./Explorer";

const tree: ExplorerTreeT = {
  branch: "feature/x",
  head: "h",
  anonymous: false,
  families: [
    {
      name: "CDISC",
      rules: [
        {
          id: "CDISC-CG0270",
          path: "rules-src/checks/CDISC/CDISC-CG0270.yaml",
          marker: "MODIFIED",
        },
        { id: "CDISC-CG0621", path: "rules-src/checks/CDISC/CDISC-CG0621.yaml", marker: "NEW" },
      ],
    },
    {
      name: "FDA",
      rules: [{ id: "FDA-SD1142", path: "rules-src/checks/FDA/FDA-SD1142.yaml", marker: "CLEAN" }],
    },
  ],
};

describe("filterFamilies", () => {
  it("narrows case-insensitively and drops families without a match", () => {
    expect(filterFamilies(tree.families!, "")).toBe(tree.families);
    const f = filterFamilies(tree.families!, "cg06");
    expect(f.map((x) => x.name)).toEqual(["CDISC"]);
    expect(f[0].rules?.map((r) => r.id)).toEqual(["CDISC-CG0621"]);
    expect(filterFamilies(tree.families!, "zzz")).toEqual([]);
  });
});

describe("Explorer", () => {
  it("shows a loader until the tree arrives", () => {
    renderWithProviders(<Explorer tree={null} onOpen={vi.fn()} onSearch={vi.fn()} />);
    expect(screen.queryByLabelText("family CDISC")).not.toBeInTheDocument();
  });

  it("expands a family, marks modified / new rules and opens one", async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    renderWithProviders(<Explorer tree={tree} onOpen={onOpen} onSearch={vi.fn()} />);
    expect(screen.queryByLabelText("rule CDISC-CG0270")).not.toBeInTheDocument();
    await user.click(screen.getByLabelText("family CDISC"));
    expect(screen.getByText("modified")).toBeInTheDocument();
    expect(screen.getByText("new")).toBeInTheDocument();
    await user.click(screen.getByLabelText("rule CDISC-CG0270"));
    expect(onOpen).toHaveBeenCalledWith("rules-src/checks/CDISC/CDISC-CG0270.yaml");
    await user.click(screen.getByLabelText("family CDISC"));
    expect(screen.queryByLabelText("rule CDISC-CG0270")).not.toBeInTheDocument();
  });

  it("the name filter narrows the tree and expands the matches", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Explorer tree={tree} onOpen={vi.fn()} onSearch={vi.fn()} />);
    await user.type(screen.getByLabelText("Filter rules by name"), "sd11");
    expect(screen.getByLabelText("rule FDA-SD1142")).toBeInTheDocument();
    expect(screen.queryByLabelText("family CDISC")).not.toBeInTheDocument();
    await user.clear(screen.getByLabelText("Filter rules by name"));
    await user.type(screen.getByLabelText("Filter rules by name"), "nothing");
    expect(screen.getByText("No rule matches.")).toBeInTheDocument();
  });

  it("the magnifier opens the search dialog; the + offers a new rule in edit mode only", async () => {
    const user = userEvent.setup();
    const onSearch = vi.fn();
    const onNewRule = vi.fn();
    const { unmount } = renderWithProviders(
      <Explorer tree={tree} onOpen={vi.fn()} onSearch={onSearch} onNewRule={onNewRule} />,
    );
    await user.click(screen.getByLabelText("Search rules"));
    expect(onSearch).toHaveBeenCalled();
    await user.click(screen.getByLabelText("New rule in FDA"));
    expect(onNewRule).toHaveBeenCalledWith("FDA");
    unmount();
    renderWithProviders(<Explorer tree={tree} onOpen={vi.fn()} onSearch={vi.fn()} />);
    expect(screen.queryByLabelText("New rule in FDA")).not.toBeInTheDocument();
  });
});
