import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "../test/renderWithProviders";
import type { Tab } from "../state/tabs";
import { EditorTabs } from "./EditorTabs";

const clean: Tab = {
  path: "rules-src/checks/CDISC/A.yaml",
  kind: "rule",
  title: "A.yaml",
  content: "x",
  savedContent: "x",
  blob: "b",
};
const dirty: Tab = {
  ...clean,
  path: "rules-src/checks/CDISC/B.yaml",
  title: "B.yaml",
  content: "y",
};

describe("EditorTabs", () => {
  it("marks the dirty tab, activates on click, closes by button and by middle-click", async () => {
    const user = userEvent.setup();
    const onActivate = vi.fn();
    const onClose = vi.fn();
    renderWithProviders(
      <EditorTabs
        tabs={[clean, dirty]}
        active={clean.path}
        onActivate={onActivate}
        onClose={onClose}
      />,
    );
    const tabs = screen.getAllByRole("tab");
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");
    expect(tabs[1]).toHaveAttribute("data-dirty", "true");
    expect(screen.getByText("● B.yaml")).toBeInTheDocument();
    await user.click(screen.getByText("● B.yaml"));
    expect(onActivate).toHaveBeenCalledWith(dirty.path);
    await user.click(screen.getByLabelText("close A.yaml"));
    expect(onClose).toHaveBeenCalledWith(clean.path);
    fireEvent(tabs[1], new MouseEvent("auxclick", { button: 1, bubbles: true }));
    expect(onClose).toHaveBeenCalledWith(dirty.path);
    fireEvent(tabs[1], new MouseEvent("auxclick", { button: 2, bubbles: true }));
    expect(onClose).toHaveBeenCalledTimes(2);
    // closing does not also activate
    expect(onActivate).toHaveBeenCalledTimes(1);
  });
});
