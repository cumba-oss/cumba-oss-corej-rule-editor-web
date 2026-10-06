import { describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "../test/renderWithProviders";
import type { ChangedFileT, CommitInfoT } from "../api/types";
import {
  CloseDirtyTabDialog,
  CommitPushDialog,
  DirtyTreeDialog,
  LeaveDialog,
  PushNowDialog,
  ReauthDialog,
} from "./Dialogs";

const files: ChangedFileT[] = [
  { path: "rules-src/checks/CDISC/A.yaml", kind: "MODIFIED" },
  { path: "rules-src/checks/CDISC/B.yaml", kind: "UNTRACKED" },
];
const commits: CommitInfoT[] = [
  { sha: "abcdef1234", message: "Update A\n\nbody", author: "Alice" },
];

describe("PushNowDialog", () => {
  it("pre-fills the message and offers Commit + Push or Later", async () => {
    const user = userEvent.setup();
    const onCommitPush = vi.fn();
    const onLater = vi.fn();
    renderWithProviders(
      <PushNowDialog
        opened
        suggestedMessage="Update A"
        onCommitPush={onCommitPush}
        onLater={onLater}
      />,
    );
    expect(screen.getByLabelText("Commit message")).toHaveValue("Update A");
    await user.type(screen.getByLabelText("Commit message"), " and B");
    await user.click(screen.getByRole("button", { name: "Commit + Push" }));
    expect(onCommitPush).toHaveBeenCalledWith("Update A and B");
    await user.click(screen.getByRole("button", { name: "Later" }));
    expect(onLater).toHaveBeenCalled();
  });

  it("renders nothing while closed", () => {
    renderWithProviders(
      <PushNowDialog
        opened={false}
        suggestedMessage="x"
        onCommitPush={vi.fn()}
        onLater={vi.fn()}
      />,
    );
    expect(screen.queryByLabelText("Commit message")).not.toBeInTheDocument();
  });
});

describe("CommitPushDialog", () => {
  it("lists the pending work, commits + pushes and shows the PR link", async () => {
    const user = userEvent.setup();
    const onCommitPush = vi.fn(async () => ({ pullRequestUrl: "https://forge/pr" }));
    const onClose = vi.fn();
    renderWithProviders(
      <CommitPushDialog
        opened
        onClose={onClose}
        uncommitted={files}
        unpushed={commits}
        suggestedMessage="Update A, B"
        onCommitPush={onCommitPush}
        onUpdateFromRemote={vi.fn(async () => true)}
      />,
    );
    expect(screen.getByText("rules-src/checks/CDISC/A.yaml")).toBeInTheDocument();
    expect(screen.getByText("untracked")).toBeInTheDocument();
    expect(screen.getByText("abcdef1")).toBeInTheDocument();
    expect(screen.getByText("Update A")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Commit + Push" }));
    expect(onCommitPush).toHaveBeenCalledWith("Update A, B");
    expect(await screen.findByRole("link", { name: "Create a pull request" })).toHaveAttribute(
      "href",
      "https://forge/pr",
    );
    expect(screen.queryByRole("button", { name: "Commit + Push" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("offers Update from remote branch on a non-fast-forward rejection, then clears it", async () => {
    const user = userEvent.setup();
    const onCommitPush = vi.fn(async () => ({ nonFastForward: true, error: "rejected" }));
    const onUpdateFromRemote = vi.fn(async () => true);
    renderWithProviders(
      <CommitPushDialog
        opened
        onClose={vi.fn()}
        uncommitted={[]}
        unpushed={commits}
        suggestedMessage=""
        onCommitPush={onCommitPush}
        onUpdateFromRemote={onUpdateFromRemote}
      />,
    );
    expect(screen.queryByLabelText("Commit message")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Push" }));
    expect(await screen.findByText("rejected")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Update from remote branch" }));
    expect(onUpdateFromRemote).toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByText("rejected")).not.toBeInTheDocument());
  });

  it("disables Push with nothing to push", () => {
    const onUpdateFromRemote = vi.fn(async () => false);
    renderWithProviders(
      <CommitPushDialog
        opened
        onClose={vi.fn()}
        uncommitted={[]}
        unpushed={[]}
        suggestedMessage=""
        onCommitPush={vi.fn(async () => ({ nonFastForward: true, error: "rejected" }))}
        onUpdateFromRemote={onUpdateFromRemote}
      />,
    );
    expect(screen.getByRole("button", { name: "Push" })).toBeDisabled();
  });

  it("shows a plain error", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <CommitPushDialog
        opened
        onClose={vi.fn()}
        uncommitted={files}
        unpushed={[]}
        suggestedMessage="m"
        onCommitPush={vi.fn(async () => ({ error: "boom (STALE)" }))}
        onUpdateFromRemote={vi.fn(async () => true)}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Commit + Push" }));
    expect(await screen.findByText("boom (STALE)")).toBeInTheDocument();
  });
});

describe("DirtyTreeDialog", () => {
  it("names the files and commits locally with a message", async () => {
    const user = userEvent.setup();
    const onCommitLocally = vi.fn(async () => true);
    const onCancel = vi.fn();
    renderWithProviders(
      <DirtyTreeDialog
        opened
        files={files}
        onCommitLocally={onCommitLocally}
        onDiscard={vi.fn(async () => true)}
        onCancel={onCancel}
      />,
    );
    expect(screen.getByText("rules-src/checks/CDISC/B.yaml")).toBeInTheDocument();
    const commit = screen.getByRole("button", { name: "Commit locally" });
    expect(commit).toBeDisabled();
    await user.type(screen.getByLabelText("Commit message"), "WIP");
    await user.click(commit);
    expect(onCommitLocally).toHaveBeenCalledWith("WIP");
    await waitFor(() => expect(screen.getByLabelText("Commit message")).toHaveValue(""));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalled();
  });
});

describe("DirtyTreeDialog — Discard", () => {
  it("asks again naming every file before discarding, and Back returns", async () => {
    const user = userEvent.setup();
    let answer = false;
    const onDiscard = vi.fn(async () => answer);
    const onCommitLocally = vi.fn(async () => true);
    renderWithProviders(
      <DirtyTreeDialog
        opened
        files={files}
        onCommitLocally={onCommitLocally}
        onDiscard={onDiscard}
        onCancel={vi.fn()}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Discard…" }));
    expect(onDiscard).not.toHaveBeenCalled();
    expect(await screen.findByText("Discard saved changes?")).toBeInTheDocument();
    expect(screen.getByText("rules-src/checks/CDISC/A.yaml")).toBeInTheDocument();
    expect(screen.getByText("rules-src/checks/CDISC/B.yaml")).toBeInTheDocument();
    expect(screen.getByText(/will be lost/)).toHaveTextContent("these 2 files");
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(await screen.findByText("Uncommitted changes")).toBeInTheDocument();
    expect(onDiscard).not.toHaveBeenCalled();

    // a refused discard (STALE) keeps the confirmation open
    await user.click(screen.getByRole("button", { name: "Discard…" }));
    await user.click(screen.getByRole("button", { name: "Discard 2 files" }));
    expect(onDiscard).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Discard saved changes?")).toBeInTheDocument();
    answer = true;
    await user.click(screen.getByRole("button", { name: "Discard 2 files" }));
    await waitFor(() => expect(screen.getByText("Uncommitted changes")).toBeInTheDocument());
    expect(onDiscard).toHaveBeenCalledTimes(2);
    expect(onCommitLocally).not.toHaveBeenCalled();
  });

  it("offers no Discard without files, and names a single file in the singular", async () => {
    const user = userEvent.setup();
    const { rerender } = renderWithProviders(
      <DirtyTreeDialog
        opened
        files={[]}
        onCommitLocally={vi.fn(async () => true)}
        onDiscard={vi.fn(async () => true)}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "Discard…" })).toBeDisabled();
    rerender(
      <DirtyTreeDialog
        opened
        files={files.slice(0, 1)}
        onCommitLocally={vi.fn(async () => true)}
        onDiscard={vi.fn(async () => true)}
        onCancel={vi.fn()}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Discard…" }));
    expect(screen.getByRole("button", { name: "Discard 1 file" })).toBeInTheDocument();
  });
});

describe("LeaveDialog", () => {
  it("names unsaved buffers, uncommitted files and unpushed commits", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    renderWithProviders(
      <LeaveDialog
        opened
        title="Log out with work behind?"
        action="Log out"
        unsaved={["rules-src/checks/CDISC/C.yaml"]}
        uncommitted={files}
        unpushed={commits}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );
    expect(screen.getByText(/Unsaved buffers/)).toBeInTheDocument();
    expect(screen.getByText("rules-src/checks/CDISC/C.yaml")).toBeInTheDocument();
    expect(screen.getByText(/Saved, not committed/)).toBeInTheDocument();
    expect(screen.getByText(/Committed, not pushed/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Log out" }));
    expect(onConfirm).toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalled();
  });

  it("omits empty sections", () => {
    renderWithProviders(
      <LeaveDialog
        opened
        title="t"
        action="Go"
        unsaved={[]}
        uncommitted={[]}
        unpushed={[]}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.queryByText(/Unsaved buffers/)).not.toBeInTheDocument();
    expect(screen.queryByText(/not committed/)).not.toBeInTheDocument();
  });
});

describe("ReauthDialog", () => {
  it("keeps the login name and reports the new session", async () => {
    const user = userEvent.setup();
    const onLoggedIn = vi.fn();
    renderWithProviders(
      <ReauthDialog opened loginName="alice" onLoggedIn={onLoggedIn} onCancel={vi.fn()} />,
    );
    expect(screen.getByLabelText("Login name")).toHaveValue("alice");
    await user.type(screen.getByLabelText("Personal access token"), "tok");
    await user.click(screen.getByRole("button", { name: "Log in and retry" }));
    await waitFor(() => expect(onLoggedIn).toHaveBeenCalled());
  });
});

describe("CloseDirtyTabDialog", () => {
  it("names the tab and offers discard or keep", async () => {
    const user = userEvent.setup();
    const onDiscard = vi.fn();
    const onCancel = vi.fn();
    renderWithProviders(
      <CloseDirtyTabDialog
        path="rules-src/checks/CDISC/A.yaml"
        onDiscard={onDiscard}
        onCancel={onCancel}
      />,
    );
    expect(screen.getByText("rules-src/checks/CDISC/A.yaml")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Close and discard" }));
    expect(onDiscard).toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(onCancel).toHaveBeenCalled();
  });
});
