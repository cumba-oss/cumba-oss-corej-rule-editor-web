import { describe, expect, it, vi } from "vitest";
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EditorView } from "@codemirror/view";
import { renderWithProviders } from "../test/renderWithProviders";
import { fake } from "../test/handlers";
import type { SessionInfoT } from "../api/types";
import { docsPathOf, EditorShell, suggestMessage } from "./EditorShell";

const RULE = "rules-src/checks/CDISC/CDISC-CG0270.yaml";

function session(mode: SessionInfoT["mode"] = "EDIT"): SessionInfoT {
  return { ...fake.user, mode };
}

function renderShell(mode: SessionInfoT["mode"] = "EDIT") {
  const onSession = vi.fn();
  const onLoggedOut = vi.fn();
  const utils = renderWithProviders(
    <EditorShell
      info={{
        service: "s",
        repository: { url: "u", owner: "cumba", name: "rules", forge: "gitea" },
      }}
      session={session(mode)}
      onSession={onSession}
      onLoggedOut={onLoggedOut}
    />,
  );
  return { ...utils, onSession, onLoggedOut };
}

async function openRule(user: ReturnType<typeof userEvent.setup>, id = "CDISC-CG0270") {
  await user.click(await screen.findByLabelText("family CDISC"));
  await user.click(screen.getByLabelText(`rule ${id}`));
  return screen.findByRole("tab", { name: `${id}.yaml` });
}

function editBuffer(container: HTMLElement, insert: string) {
  const dom = container.querySelector(".cm-editor") as HTMLElement;
  const view = EditorView.findFromDOM(dom)!;
  act(() => {
    view.dispatch({ changes: { from: view.state.doc.length, insert } });
  });
}

/** Click Save once the edit has reached the tab (the button is disabled while the buffer is clean). */
async function saveActive(user: ReturnType<typeof userEvent.setup>) {
  const button = screen.getByRole("button", { name: "Save (Ctrl+S)" });
  await waitFor(() => expect(button).toBeEnabled());
  await user.click(button);
}

/** The file tabs of the tab strip (the bottom panel has tabs of its own). */
function fileTabs(): HTMLElement[] {
  return screen.queryAllByRole("tab").filter((t) => t.closest('[aria-label="open files"]'));
}

/** The text of the active tab's editor buffer. */
function bufferText(container: HTMLElement): string {
  const dom = container.querySelector(".cm-editor") as HTMLElement;
  return EditorView.findFromDOM(dom)!.state.doc.toString();
}

function unloadBlocked(): boolean {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}

describe("helpers", () => {
  it("suggestMessage names the changed rule ids, de-duplicated and capped", () => {
    expect(suggestMessage([])).toBe("");
    expect(
      suggestMessage([
        { path: RULE, kind: "MODIFIED" },
        { path: "rules-src/docs/CDISC/CDISC-CG0270.yaml", kind: "MODIFIED" },
        { path: "src/test/resources/x/a.cdt", kind: "UNTRACKED" },
      ]),
    ).toBe("Update CDISC-CG0270, a.cdt");
    const many = Array.from({ length: 7 }, (_, i) => ({
      path: `rules-src/checks/FDA/FDA-SD${i}.yaml`,
      kind: "MODIFIED" as const,
    }));
    expect(suggestMessage(many)).toMatch(/, …$/);
  });

  it("docsPathOf finds the sidecar from the tree", () => {
    expect(docsPathOf(null, RULE)).toBeNull();
    expect(docsPathOf(fake.explorer(), RULE)).toBe("rules-src/docs/CDISC/CDISC-CG0270.yaml");
    expect(docsPathOf(fake.explorer(), "rules-src/checks/FDA/FDA-SD1142.yaml")).toBeNull();
  });
});

describe("EditorShell — open, edit, save, push", () => {
  it("opens a rule, saves an edit with the stamp, asks to push, and Commit + Push yields a PR link", async () => {
    const user = userEvent.setup();
    const { container } = renderShell();
    await openRule(user);
    expect(screen.getByText(RULE)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save (Ctrl+S)" })).toBeDisabled();
    expect(unloadBlocked()).toBe(false);

    editBuffer(container, "Outcome:\n  Message: 'x'\n");
    await waitFor(() => expect(screen.getByText("● CDISC-CG0270.yaml")).toBeInTheDocument());
    expect(screen.getByText("1 unsaved")).toBeInTheDocument();
    expect(unloadBlocked()).toBe(true);

    await saveActive(user);
    expect(await screen.findByText("Saved — push now?")).toBeInTheDocument();
    const put = fake.mutations.find((m) => m.method === "PUT")!;
    expect(put.body).toMatchObject({
      path: RULE,
      branch: "feature/x",
      head: "aaaa111",
      blob: "b270",
    });
    expect(fake.files.get(RULE)!.content).toContain("Message: 'x'");
    expect(screen.getByLabelText("Commit message")).toHaveValue("Update CDISC-CG0270");
    expect(screen.queryByText("1 unsaved")).not.toBeInTheDocument();
    // saved but uncommitted: the exit guard stays armed, the explorer marks the rule
    expect(unloadBlocked()).toBe(true);
    await waitFor(() => expect(screen.getByText("modified")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "Later" }));
    expect(await screen.findByRole("button", { name: "Commit + Push (1)" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Commit + Push (1)" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Commit + Push" }));
    expect(await screen.findByRole("link", { name: "Create a pull request" })).toBeInTheDocument();
    expect(fake.unpushedCommits).toHaveLength(0);
    expect(fake.uncommitted).toHaveLength(0);
    const commit = fake.mutations.find((m) => m.path === "/api/commit")!;
    expect(commit.body).toMatchObject({ message: "Update CDISC-CG0270", head: "aaaa111" });
    const push = fake.mutations.find((m) => m.path === "/api/push")!;
    expect(push.body).toMatchObject({ head: fake.head });
    await user.click(within(dialog).getByRole("button", { name: "Close" }));
    await waitFor(() => expect(unloadBlocked()).toBe(false));
  });

  it("the Push now dialog's Commit + Push hands over to the commit dialog", async () => {
    const user = userEvent.setup();
    const { container } = renderShell();
    await openRule(user);
    editBuffer(container, "# a\n");
    await saveActive(user);
    const pushNow = await screen.findByRole("dialog");
    await user.click(within(pushNow).getByRole("button", { name: "Commit + Push" }));
    expect(await screen.findByText("Saved, not committed")).toBeInTheDocument();
  });

  it("a non-fast-forward push offers Update from remote branch, which merges and clears it", async () => {
    const user = userEvent.setup();
    fake.uncommitted = [{ path: RULE, kind: "MODIFIED" }];
    fake.nextPushProblem = { status: 409, code: "NON_FAST_FORWARD" };
    renderShell();
    await user.click(await screen.findByRole("button", { name: "Commit + Push (1)" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Commit + Push" }));
    await user.click(await screen.findByRole("button", { name: "Update from remote branch" }));
    await waitFor(() => expect(fake.head).toBe("merged44"));
    expect(await screen.findByText("MERGED")).toBeInTheDocument();
  });

  it("reports a conflicting update and a failed commit", async () => {
    const user = userEvent.setup();
    fake.unpushedCommits = [{ sha: "c9", message: "m", author: "a" }];
    fake.nextPushProblem = { status: 409, code: "NON_FAST_FORWARD" };
    fake.nextSwitchProblem = { status: 409, code: "MERGE_CONFLICT", extra: { paths: [RULE] } };
    renderShell();
    await user.click(await screen.findByRole("button", { name: "Commit + Push (1)" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Push" }));
    await user.click(await screen.findByRole("button", { name: "Update from remote branch" }));
    expect(await screen.findByText(/Conflicting: rules-src/)).toBeInTheDocument();
  });

  it("opens the docs sidecar and a scenario as further tabs, closes a dirty tab only after asking", async () => {
    const user = userEvent.setup();
    const { container } = renderShell();
    await openRule(user);
    await user.click(screen.getByRole("button", { name: "Open docs" }));
    expect(
      await screen.findByRole("tab", { name: "CDISC-CG0270.yaml (docs)" }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "CDISC-CG0270.yaml" }));
    // scenarios are rows of the Scenarios tab: a double-click opens one as a tab
    const row = (await screen.findByText("CDISC-CG0270-invalid-AE.cdt")).closest("tr")!;
    await user.dblClick(row);
    expect(await screen.findByRole("tab", { name: "CDISC-CG0270-invalid-AE.cdt" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    editBuffer(container, "col AETERM type=Char\n");
    await user.click(screen.getByLabelText("close CDISC-CG0270-invalid-AE.cdt"));
    expect(await screen.findByText("Close without saving?")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(screen.getByRole("tab", { name: "CDISC-CG0270-invalid-AE.cdt" })).toBeInTheDocument();
    await user.click(screen.getByLabelText("close CDISC-CG0270-invalid-AE.cdt"));
    await user.click(await screen.findByRole("button", { name: "Close and discard" }));
    await waitFor(() =>
      expect(
        screen.queryByRole("tab", { name: "CDISC-CG0270-invalid-AE.cdt" }),
      ).not.toBeInTheDocument(),
    );
    await user.click(screen.getByLabelText("close CDISC-CG0270.yaml (docs)"));
    await waitFor(() => expect(fileTabs()).toHaveLength(1));
  });

  it("creates a new rule from a template and saves it as a new file", async () => {
    const user = userEvent.setup();
    renderShell();
    await user.click(await screen.findByLabelText("New rule in FDA"));
    await user.type(screen.getByLabelText("Rule id"), "SD9999");
    await user.click(screen.getByRole("button", { name: "Create" }));
    expect(await screen.findByRole("tab", { name: "FDA-SD9999.yaml" })).toHaveTextContent("●");
    await saveActive(user);
    await screen.findByText("Saved — push now?");
    const put = fake.mutations.find((m) => m.method === "PUT")!;
    expect(put.body).toMatchObject({ path: "rules-src/checks/FDA/FDA-SD9999.yaml" });
    expect((put.body as Record<string, unknown>).blob).toBeUndefined();
    expect(fake.files.get("rules-src/checks/FDA/FDA-SD9999.yaml")!.content).toContain(
      'Id: "FDA-SD9999"',
    );
  });
});

describe("EditorShell — read-only mode (server-enforced, UI explains)", () => {
  it("lets the user edit, never writes, hides Commit + Push and New rule", async () => {
    const user = userEvent.setup();
    fake.mode = "READ_ONLY";
    const { container } = renderShell("READ_ONLY");
    await openRule(user);
    expect(screen.queryByRole("button", { name: /Commit \+ Push/ })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("New rule in CDISC")).not.toBeInTheDocument();
    editBuffer(container, "# edit\n");
    await saveActive(user);
    expect(await screen.findByText("Read-only mode")).toBeInTheDocument();
    expect(fake.mutations.filter((m) => m.method === "PUT")).toHaveLength(0);
    expect(fake.files.get(RULE)!.content).not.toContain("# edit");
    // the buffer is kept (O12: edit and run without saving)
    expect(screen.getByText("● CDISC-CG0270.yaml")).toBeInTheDocument();
  });

  it("a server 403 READ_ONLY (a session the UI believes is EDIT) is reported, not retried", async () => {
    const user = userEvent.setup();
    fake.mode = "READ_ONLY";
    const { container } = renderShell("EDIT");
    await openRule(user);
    editBuffer(container, "# edit\n");
    await saveActive(user);
    expect(await screen.findByText(/read-only session \(READ_ONLY\)/)).toBeInTheDocument();
    expect(fake.mutations.filter((m) => m.method === "PUT")).toHaveLength(1);
    expect(screen.queryByText("Saved — push now?")).not.toBeInTheDocument();
  });
});

describe("EditorShell — concurrency and session problems on save", () => {
  it("401 keeps the buffer, re-authenticates in a dialog and retries the save", async () => {
    const user = userEvent.setup();
    const { container, onSession } = renderShell();
    await openRule(user);
    editBuffer(container, "# late\n");
    fake.sessionOpen = false;
    await saveActive(user);
    expect(await screen.findByText("Session expired")).toBeInTheDocument();
    expect(fake.files.get(RULE)!.content).not.toContain("# late");
    await user.type(screen.getByLabelText("Personal access token"), "tok");
    await user.click(screen.getByRole("button", { name: "Log in and retry" }));
    expect(await screen.findByText("Saved — push now?")).toBeInTheDocument();
    expect(fake.files.get(RULE)!.content).toContain("# late");
    expect(onSession).toHaveBeenCalled();
    // the stamp read saw the 401 first, so exactly one PUT was sent — after the login, with the
    // rotated CSRF token
    const puts = fake.mutations.filter((m) => m.method === "PUT");
    expect(puts).toHaveLength(1);
    expect(puts[0].csrf).toBe(fake.csrfToken);
  });

  it("409 STALE rebases the tab on the current file, keeps the edit, and the next save succeeds", async () => {
    const user = userEvent.setup();
    const { container } = renderShell();
    await openRule(user);
    // the file moved on under us (another tab wrote it)
    fake.files.set(RULE, { content: "Core:\n  Id: theirs\n", blob: "b-theirs" });
    editBuffer(container, "# mine\n");
    await saveActive(user);
    expect(await screen.findByText("Workspace changed")).toBeInTheDocument();
    expect(screen.getByText("● CDISC-CG0270.yaml")).toBeInTheDocument();
    await saveActive(user);
    expect(await screen.findByText("Saved — push now?")).toBeInTheDocument();
    const puts = fake.mutations.filter((m) => m.method === "PUT");
    expect(puts[1].body).toMatchObject({ blob: "b-theirs" });
    expect(fake.files.get(RULE)!.content).toContain("# mine");
  });

  it("a write on the default branch opens the branch picker", async () => {
    const user = userEvent.setup();
    fake.branch = "main";
    fake.head = "0000main";
    const { container } = renderShell();
    await openRule(user);
    editBuffer(container, "# x\n");
    await saveActive(user);
    expect(await screen.findByText("Default branch is read-only")).toBeInTheDocument();
    expect(await screen.findByText("Branches")).toBeInTheDocument();
  });
});

describe("EditorShell — branches and leaving", () => {
  it("switches branch, closing the tabs; a dirty tree first asks to commit locally", async () => {
    const user = userEvent.setup();
    fake.uncommitted = [{ path: RULE, kind: "MODIFIED" }];
    renderShell();
    await openRule(user);
    await user.click(screen.getByRole("button", { name: "branch" }));
    await user.click(await screen.findByLabelText("switch to feature/other"));
    expect(await screen.findByText("Uncommitted changes")).toBeInTheDocument();
    await user.type(screen.getByLabelText("Commit message"), "WIP on x");
    await user.click(screen.getByRole("button", { name: "Commit locally" }));
    await waitFor(() => expect(fake.branch).toBe("feature/other"));
    await waitFor(() => expect(fileTabs()).toHaveLength(0));
    expect(fake.unpushedCommits.map((c) => c.message)).toEqual(["WIP on x"]);
    expect(await screen.findByRole("button", { name: "branch" })).toHaveTextContent(
      "feature/other",
    );
  });

  it("a dirty tree can be discarded: confirmation names the files, buffers reload, the switch proceeds", async () => {
    const user = userEvent.setup();
    const NEW = "rules-src/checks/CDISC/CDISC-ZZ0001.yaml";
    const original = fake.files.get(RULE)!.content;
    fake.files.set(RULE, { content: "Core: saved edit\n", blob: "w90" });
    fake.files.set(NEW, { content: "Core: new\n", blob: "w91" });
    fake.uncommitted = [
      { path: RULE, kind: "MODIFIED" },
      { path: NEW, kind: "UNTRACKED" },
    ];
    const { container } = renderShell();
    await openRule(user);
    await user.click(screen.getByLabelText("rule CDISC-ZZ0001"));
    await screen.findByRole("tab", { name: "CDISC-ZZ0001.yaml" });
    await user.click(screen.getByRole("tab", { name: "CDISC-CG0270.yaml" }));
    expect(bufferText(container)).toBe("Core: saved edit\n");

    await user.click(screen.getByRole("button", { name: "branch" }));
    await user.click(await screen.findByLabelText("switch to feature/other"));
    expect(await screen.findByText("Uncommitted changes")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Discard…" }));
    const confirm = await screen.findByRole("dialog", { name: "Discard saved changes?" });
    expect(within(confirm).getByText(RULE)).toBeInTheDocument();
    expect(within(confirm).getByText(NEW)).toBeInTheDocument();
    // the switch after the discard fails, so the reloaded tabs stay to be inspected
    fake.nextSwitchProblem = { status: 502, code: "FORGE_UNAVAILABLE" };
    await user.click(within(confirm).getByRole("button", { name: "Discard 2 files" }));

    await waitFor(() => expect(fake.uncommitted).toEqual([]));
    const call = fake.mutations.find((m) => m.path === "/api/discard")!;
    expect(call.csrf).toBe(fake.csrfToken);
    expect((call.body as { paths: string[] }).paths.sort()).toEqual([NEW, RULE].sort());
    expect(fake.files.get(RULE)!.content).toBe(original);
    expect(fake.files.has(NEW)).toBe(false);
    await waitFor(() => expect(bufferText(container)).toBe(original));
    expect(screen.getByRole("tab", { name: "CDISC-CG0270.yaml" })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "CDISC-ZZ0001.yaml" })).not.toBeInTheDocument();
    expect(fake.branch).toBe("feature/x");

    // with the tree clean the switch goes through
    await user.click(screen.getByRole("button", { name: "branch" }));
    await user.click(await screen.findByLabelText("switch to feature/other"));
    await waitFor(() => expect(fake.branch).toBe("feature/other"));
  });

  it("a discard refused as STALE discards nothing and asks again with the current files", async () => {
    const user = userEvent.setup();
    const LATE = "rules-src/checks/FDA/FDA-SD1142.yaml";
    fake.files.set(RULE, { content: "Core: saved edit\n", blob: "w90" });
    fake.uncommitted = [{ path: RULE, kind: "MODIFIED" }];
    renderShell();
    await user.click(await screen.findByRole("button", { name: "branch" }));
    await user.click(await screen.findByLabelText("switch to feature/other"));
    await user.click(await screen.findByRole("button", { name: "Discard…" }));
    await screen.findByRole("dialog", { name: "Discard saved changes?" });
    // another tab saves a second file after the list was shown
    fake.files.set(LATE, { content: "Core: other tab\n", blob: "w92" });
    fake.uncommitted.push({ path: LATE, kind: "MODIFIED" });
    await user.click(screen.getByRole("button", { name: "Discard 1 file" }));

    expect(await screen.findByText(/Nothing was discarded/)).toBeInTheDocument();
    expect(fake.files.get(RULE)!.content).toBe("Core: saved edit\n");
    expect(fake.uncommitted).toHaveLength(2);
    const confirm = screen.getByRole("dialog", { name: "Discard saved changes?" });
    expect(within(confirm).getByText(LATE)).toBeInTheDocument();
    await user.click(within(confirm).getByRole("button", { name: "Discard 2 files" }));
    await waitFor(() => expect(fake.branch).toBe("feature/other"));
    expect(fake.files.get(LATE)!.content).toBe('Core:\n  Id: "FDA-SD1142"\n');
  });

  it("a discard refused as STALE because the tree is clean by now just retries", async () => {
    const user = userEvent.setup();
    fake.uncommitted = [{ path: RULE, kind: "MODIFIED" }];
    renderShell();
    await user.click(await screen.findByRole("button", { name: "branch" }));
    await user.click(await screen.findByLabelText("switch to feature/other"));
    await user.click(await screen.findByRole("button", { name: "Discard…" }));
    fake.uncommitted = []; // another tab committed
    await user.click(await screen.findByRole("button", { name: "Discard 1 file" }));
    await waitFor(() => expect(fake.branch).toBe("feature/other"));
  });

  it("a discard failing otherwise is reported and changes nothing", async () => {
    const user = userEvent.setup();
    fake.uncommitted = [{ path: RULE, kind: "MODIFIED" }];
    renderShell();
    await user.click(await screen.findByRole("button", { name: "branch" }));
    await user.click(await screen.findByLabelText("switch to feature/other"));
    await user.click(await screen.findByRole("button", { name: "Discard…" }));
    fake.mode = "READ_ONLY";
    await user.click(await screen.findByRole("button", { name: "Discard 1 file" }));
    expect(await screen.findByText(/READ_ONLY/)).toBeInTheDocument();
    expect(fake.uncommitted).toHaveLength(1);
    expect(fake.branch).toBe("feature/x");
  });

  it("switching with an unsaved buffer names it and can be cancelled", async () => {
    const user = userEvent.setup();
    const { container } = renderShell();
    await openRule(user);
    editBuffer(container, "# unsaved\n");
    await user.click(screen.getByRole("button", { name: "branch" }));
    await user.click(await screen.findByLabelText("switch to feature/other"));
    expect(await screen.findByText("Switch branch")).toBeInTheDocument();
    const leave = screen.getAllByRole("dialog").at(-1)!;
    expect(within(leave).getByText(RULE)).toBeInTheDocument();
    await user.click(within(leave).getByRole("button", { name: "Cancel" }));
    expect(fake.branch).toBe("feature/x");
    expect(screen.getByText("● CDISC-CG0270.yaml")).toBeInTheDocument();
    await user.click(screen.getByLabelText("switch to feature/other"));
    await user.click(
      await screen.findByRole("button", { name: /Discard unsaved edits and switch/ }),
    );
    await waitFor(() => expect(fake.branch).toBe("feature/other"));
  });

  it("creates and deletes branches from the picker", async () => {
    const user = userEvent.setup();
    fake.branches.push({
      name: "feature/done",
      kind: "LOCAL",
      head: "dddd",
      current: false,
      isDefault: false,
      unpushed: { unpushed: false, hasTrackingRef: false, aheadCount: 0, behindCount: 0 },
    });
    renderShell();
    await user.click(await screen.findByRole("button", { name: "branch" }));
    await user.click(await screen.findByRole("button", { name: "delete" }));
    await waitFor(() => expect(fake.branches.some((b) => b.name === "feature/done")).toBe(false));
    await user.type(screen.getByLabelText("New branch from main"), "feature/fresh");
    await user.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => expect(fake.branch).toBe("feature/fresh"));
    expect(await screen.findByRole("button", { name: "branch" })).toHaveTextContent(
      "feature/fresh",
    );
  });

  it("logs out straight away with nothing pending, else names the work and asks", async () => {
    const user = userEvent.setup();
    fake.unpushedCommits = [{ sha: "c1", message: "pending", author: "a" }];
    const { onLoggedOut } = renderShell();
    await screen.findByRole("button", { name: "Commit + Push (1)" });
    await user.click(screen.getByRole("button", { name: "Log out" }));
    expect(await screen.findByText("Log out with work behind?")).toBeInTheDocument();
    expect(screen.getByText("pending")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onLoggedOut).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Log out" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Log out" }));
    await waitFor(() => expect(onLoggedOut).toHaveBeenCalled());
    expect(fake.sessionOpen).toBe(false);
  });

  it("logs out without a dialog when nothing is pending", async () => {
    const user = userEvent.setup();
    const { onLoggedOut } = renderShell();
    await screen.findByLabelText("family CDISC");
    await user.click(screen.getByRole("button", { name: "Log out" }));
    await waitFor(() => expect(onLoggedOut).toHaveBeenCalled());
  });

  it("search opens a hit in a tab", async () => {
    const user = userEvent.setup();
    renderShell();
    await user.click(await screen.findByLabelText("Search rules"));
    await user.type(screen.getByLabelText("Search text"), "SD1142");
    await user.click(screen.getByRole("button", { name: "Search" }));
    await user.click(await screen.findByRole("button", { name: "FDA-SD1142" }));
    expect(await screen.findByRole("tab", { name: "FDA-SD1142.yaml" })).toBeInTheDocument();
  });
});
