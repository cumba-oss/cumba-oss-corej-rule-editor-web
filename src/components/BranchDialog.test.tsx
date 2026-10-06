import { describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { renderWithProviders } from "../test/renderWithProviders";
import { server } from "../test/server";
import { fake } from "../test/handlers";
import { BranchDialog, validBranchName } from "./BranchDialog";

describe("validBranchName", () => {
  it("rejects blank, spaces, .. and a leading dash", () => {
    expect(validBranchName("feature/x")).toBe(true);
    expect(validBranchName("  ")).toBe(false);
    expect(validBranchName("a b")).toBe(false);
    expect(validBranchName("a..b")).toBe(false);
    expect(validBranchName("-x")).toBe(false);
  });
});

function renderDialog(overrides: Partial<Parameters<typeof BranchDialog>[0]> = {}) {
  const props = {
    opened: true,
    onClose: vi.fn(),
    canCreate: true,
    onSwitch: vi.fn(async () => true),
    onCreate: vi.fn(async () => true),
    onDelete: vi.fn(async () => false),
    ...overrides,
  };
  renderWithProviders(<BranchDialog {...props} />);
  return props;
}

describe("BranchDialog", () => {
  it("lists local and remote branches with the default marked, and switches", async () => {
    const user = userEvent.setup();
    const props = renderDialog();
    expect(await screen.findByText("default · read-only")).toBeInTheDocument();
    expect(screen.getByText("current")).toBeInTheDocument();
    expect(screen.getByLabelText("switch to feature/x")).toBeDisabled();
    await user.click(screen.getByLabelText("switch to feature/other"));
    expect(props.onSwitch).toHaveBeenCalledWith("feature/other");
    await waitFor(() => expect(props.onClose).toHaveBeenCalled());
  });

  it("creates a branch from the default once the name is valid", async () => {
    const user = userEvent.setup();
    const props = renderDialog();
    await screen.findByText("default · read-only");
    const create = screen.getByRole("button", { name: "Create" });
    expect(create).toBeDisabled();
    await user.type(screen.getByLabelText("New branch from main"), "feature/new");
    await user.click(create);
    expect(props.onCreate).toHaveBeenCalledWith("feature/new");
    await waitFor(() => expect(props.onClose).toHaveBeenCalled());
  });

  it("stays open when the operation reports false, offers delete only for pushed, non-current locals", async () => {
    const user = userEvent.setup();
    fake.branches.push({
      name: "feature/done",
      kind: "LOCAL",
      head: "dddd",
      current: false,
      isDefault: false,
      unpushed: { unpushed: false, hasTrackingRef: false, aheadCount: 0, behindCount: 0 },
    });
    fake.branches.push({
      name: "feature/wip",
      kind: "LOCAL",
      head: "eeee",
      current: false,
      isDefault: false,
      unpushed: { unpushed: true, hasTrackingRef: true, aheadCount: 1, behindCount: 0 },
    });
    const props = renderDialog({ onSwitch: vi.fn(async () => false) });
    await screen.findByText("default · read-only");
    expect(screen.getByText("1 unpushed")).toBeInTheDocument();
    const deletes = screen.getAllByRole("button", { name: "delete" });
    expect(deletes).toHaveLength(1);
    await user.click(deletes[0]);
    expect(props.onDelete).toHaveBeenCalledWith("feature/done");
    await user.click(screen.getByLabelText("switch to feature/other"));
    expect(props.onSwitch).toHaveBeenCalled();
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it("hides creation and deletion in read-only mode", async () => {
    renderDialog({ canCreate: false });
    await screen.findByText("default · read-only");
    expect(screen.queryByRole("button", { name: "Create" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "delete" })).not.toBeInTheDocument();
  });

  it("reports a server problem", async () => {
    server.use(
      http.get("/api/branches", () =>
        HttpResponse.json(
          { status: 502, detail: "forge down", code: "FORGE_UNAVAILABLE" },
          { status: 502 },
        ),
      ),
    );
    renderDialog();
    expect(await screen.findByText("forge down")).toBeInTheDocument();
  });
});
