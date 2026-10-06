import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "../test/renderWithProviders";
import type { SessionInfoT, StatusT } from "../api/types";
import { Header, pendingCount } from "./Header";

const session: SessionInfoT = {
  id: 1,
  login: "alice",
  name: "Alice Author",
  email: "a@x",
  mode: "EDIT",
  defaultBranch: "main",
};

const status: StatusT = {
  branch: "feature/x",
  head: "h",
  defaultBranch: "main",
  readOnly: false,
  uncommitted: [{ path: "rules-src/checks/CDISC/A.yaml", kind: "MODIFIED" }],
  ignored: [],
  unpushed: { unpushed: true, hasTrackingRef: true, aheadCount: 2, behindCount: 0, commits: [] },
};

const info = {
  service: "s",
  repository: { url: "u", owner: "cumba", name: "rules", forge: "gitea" },
};

describe("pendingCount", () => {
  it("adds uncommitted files and unpushed commits", () => {
    expect(pendingCount(null)).toBe(0);
    expect(pendingCount(status)).toBe(3);
    expect(pendingCount({ ...status, unpushed: undefined, uncommitted: undefined })).toBe(0);
  });
});

describe("Header", () => {
  it("shows repo, branch, mode, the pending badge and wires the buttons", async () => {
    const user = userEvent.setup();
    const onOpenBranches = vi.fn();
    const onCommitPush = vi.fn();
    const onLogout = vi.fn();
    renderWithProviders(
      <Header
        info={info}
        session={session}
        status={status}
        unsavedCount={1}
        onOpenBranches={onOpenBranches}
        onCommitPush={onCommitPush}
        onLogout={onLogout}
      />,
    );
    expect(screen.getByText("cumba/rules")).toBeInTheDocument();
    expect(screen.getByText("edit")).toBeInTheDocument();
    expect(screen.getByText("1 unsaved")).toBeInTheDocument();
    expect(screen.getByText("Alice Author")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "branch" }));
    expect(onOpenBranches).toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Commit + Push (3)" }));
    expect(onCommitPush).toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Log out" }));
    expect(onLogout).toHaveBeenCalled();
  });

  it("hides Commit + Push in read-only mode and falls back to the login name", () => {
    renderWithProviders(
      <Header
        info={null}
        session={{ ...session, mode: "READ_ONLY", name: "" }}
        status={null}
        unsavedCount={0}
        onOpenBranches={vi.fn()}
        onCommitPush={vi.fn()}
        onLogout={vi.fn()}
      />,
    );
    expect(screen.getByText("read-only")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Commit \+ Push/ })).not.toBeInTheDocument();
    expect(screen.getByText("alice")).toBeInTheDocument();
    expect(screen.getByText("coreJ rule editor")).toBeInTheDocument();
    expect(screen.queryByText(/unsaved/)).not.toBeInTheDocument();
  });

  it("disables Commit + Push when nothing is pending", () => {
    renderWithProviders(
      <Header
        info={info}
        session={session}
        status={{ ...status, uncommitted: [], unpushed: { unpushed: false, aheadCount: 0 } }}
        unsavedCount={0}
        onOpenBranches={vi.fn()}
        onCommitPush={vi.fn()}
        onLogout={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "Commit + Push" })).toBeDisabled();
  });
});
