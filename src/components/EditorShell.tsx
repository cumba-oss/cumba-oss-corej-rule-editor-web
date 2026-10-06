import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { AppShell, Box, Button, Group, Text } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import type { ProblemError } from "../api/client";
import * as editor from "../api/editor";
import type {
  ChangedFileT,
  DiagnosticT,
  ExplorerTreeT,
  ServiceInfoT,
  SessionInfoT,
  StatusT,
} from "../api/types";
import { expectationProposal, readExpectations } from "../engine/cdt";
import { markersOf, rangeOf } from "../engine/diagnostics";
import {
  docsPathFor,
  rulePathOf,
  statusOf,
  type RunEntry,
  useAnalyses,
  useCatalogues,
  useRelated,
  useRuns,
  useSuite,
} from "../engine/useEngine";
import {
  activeTab,
  CHECKS_DIR,
  dirtyTabs,
  EMPTY_TABS,
  isDirty,
  kindOf,
  newRuleTemplate,
  ruleIdOf,
  rulePathOfId,
  scenarioDirOf,
  scenarioRuleIdOf,
  tabsReducer,
  titleOf,
} from "../state/tabs";
import { useBeforeUnload } from "../util/useBeforeUnload";
import { BottomPanel } from "./BottomPanel";
import { BranchDialog } from "./BranchDialog";
import { CodeEditor } from "./CodeEditor";
import type { DerivedView } from "./editor/derivedWidgets";
import type { EngineContext } from "./editor/engineContext";
import { EngineBanner } from "./EngineBanner";
import { NewScenarioDialog, TakeExpectedDialog, type NewScenarioRequest } from "./ScenarioDialogs";
import { ScenarioEditor } from "./ScenarioEditor";
import {
  CloseDirtyTabDialog,
  CommitPushDialog,
  DirtyTreeDialog,
  LeaveDialog,
  PushNowDialog,
  ReauthDialog,
  type CommitPushOutcome,
} from "./Dialogs";
import { EditorTabs } from "./EditorTabs";
import { Explorer } from "./Explorer";
import { Header } from "./Header";
import { NewRuleDialog } from "./NewRuleDialog";
import { SearchDialog } from "./SearchDialog";

interface Props {
  info: ServiceInfoT | null;
  session: SessionInfoT;
  /** The session was re-established after a 401 (the server rotated the id). */
  onSession: (session: SessionInfoT) => void;
  onLoggedOut: () => void;
}

/** A commit message pre-filled from the changed rule ids (§5.2). */
export function suggestMessage(uncommitted: ChangedFileT[]): string {
  const names = uncommitted
    .map((f) => f.path ?? "")
    .filter(Boolean)
    .map((p) => ruleIdOf(p) ?? p.slice(p.lastIndexOf("/") + 1));
  const unique = Array.from(new Set(names));
  if (unique.length === 0) return "";
  return `Update ${unique.slice(0, 5).join(", ")}${unique.length > 5 ? ", …" : ""}`;
}

function notifyProblem(title: string, problem: ProblemError): void {
  notifications.show({ color: "red", title, message: `${problem.detail} (${problem.code})` });
}

interface DirtyTree {
  files: ChangedFileT[];
  retry: () => Promise<boolean>;
}

interface Leave {
  title: string;
  action: string;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * The IDE composition of PLAN-rule-editor §5.3 and every flow of §5.2: open / edit / save,
 * Save → "Push now?", Commit + Push, branch switch with the clean-tree rule, the exit guard,
 * read-only mode (the server enforces it; the UI hides and explains), session expiry.
 */
export function EditorShell({ info, session, onSession, onLoggedOut }: Props) {
  const readOnly = session.mode !== "EDIT";
  const [status, setStatus] = useState<StatusT | null>(null);
  const [tree, setTree] = useState<ExplorerTreeT | null>(null);
  const [tabs, dispatch] = useReducer(tabsReducer, EMPTY_TABS);
  const current = activeTab(tabs);
  const unsaved = dirtyTabs(tabs);

  const [searchOpen, setSearchOpen] = useState(false);
  const [branchOpen, setBranchOpen] = useState(false);
  const [pushNowFor, setPushNowFor] = useState<string | null>(null);
  const [commitPushOpen, setCommitPushOpen] = useState(false);
  const [dirtyTree, setDirtyTree] = useState<DirtyTree | null>(null);
  const [leave, setLeave] = useState<Leave | null>(null);
  const [reauthRetry, setReauthRetry] = useState<(() => void) | null>(null);
  const [closingDirty, setClosingDirty] = useState<string | null>(null);
  const [newRuleFamily, setNewRuleFamily] = useState<string | null>(null);
  const [showAuthorities, setShowAuthorities] = useState(false);
  const [newScenario, setNewScenario] = useState<NewScenarioRequest | null>(null);
  /** The run the "take actual as expected" dialog is about: its scenario, branch and report. */
  const [takeExpected, setTakeExpected] = useState<RunEntry | null>(null);
  const [selectedScenarios, setSelectedScenarios] = useState<Record<string, string>>({});
  const [reveal, setReveal] = useState<{ path: string; d: DiagnosticT; seq: number } | null>(null);

  const uncommitted = useMemo(() => status?.uncommitted ?? [], [status]);
  const unpushed = useMemo(() => status?.unpushed?.commits ?? [], [status]);
  const anythingPending = unsaved.length > 0 || uncommitted.length > 0 || unpushed.length > 0;
  useBeforeUnload(anythingPending);

  // `.then` rather than `await`: the state updates happen in the callbacks, never synchronously
  // in the calling effect (react-hooks/set-state-in-effect).
  /** Set when the last status read answered 401: the session expired (§5.2, review L4). */
  const sessionLost = useRef(false);

  const refreshStatus = useCallback(
    (): Promise<StatusT | null> =>
      editor.status().then((r) => {
        if (r.problem) {
          sessionLost.current = r.problem.status === 401;
          if (!sessionLost.current) notifyProblem("Workspace status", r.problem);
          return null;
        }
        sessionLost.current = false;
        setStatus(r.data);
        return r.data;
      }),
    [],
  );

  const refreshTree = useCallback(
    (): Promise<void> =>
      editor.explorer().then((r) => {
        if (r.problem) notifyProblem("Explorer", r.problem);
        else setTree(r.data);
      }),
    [],
  );

  useEffect(() => {
    void refreshStatus();
    void refreshTree();
  }, [refreshStatus, refreshTree]);

  /**
   * The optimistic-concurrency stamp, always re-read from the server: a retry closure (dirty
   * tree → commit locally → switch) would otherwise carry the head it was created with.
   */
  const expect = useCallback(async (): Promise<editor.Expect | null> => {
    const s = await refreshStatus();
    if (!s?.branch || !s.head) return null;
    return { branch: s.branch, head: s.head };
  }, [refreshStatus]);

  // ---- the engine (phase 3) ------------------------------------------------------------------

  const epoch = status?.branch ?? "";
  /**
   * Bumped when the workspace changes under the caches without a branch switch (update from the
   * remote branch, a discard): the suite, related-rule, schema and function caches reload (review 9).
   */
  const [cacheGen, setCacheGen] = useState(0);
  const cacheKey = `${epoch}\u0000${cacheGen}`;
  const invalidateCaches = useCallback(() => setCacheGen((n) => n + 1), []);
  const {
    byPath: analyses,
    retry: retryAnalysis,
    target: analysisTarget,
    forgetDisk,
  } = useAnalyses(tabs.tabs, current, epoch, cacheKey);
  const catalogues = useCatalogues(cacheKey, true);
  /** The rule the panel and the run are about: the active rule / docs tab's, or a scenario's. */
  const ruleId = current
    ? (ruleIdOf(rulePathOf(current) ?? "") ?? scenarioRuleIdOf(current.path))
    : null;
  const rulePath = ruleId ? rulePathOfId(ruleId) : null;
  const ruleTab = rulePath ? tabs.tabs.find((t) => t.path === rulePath) : undefined;
  const docsTab = rulePath ? tabs.tabs.find((t) => t.path === docsPathFor(rulePath)) : undefined;
  const analysisEntry = rulePath ? analyses[rulePath] : undefined;
  // The status describes what the active rule / docs tab shows: the buffers analysed (a lone docs
  // tab's rule as saved). A scenario tab has no analysis of its own.
  const analysisStatus =
    analysisTarget && analysisTarget.rulePath === rulePath
      ? statusOf(analysisEntry, analysisTarget.content, analysisTarget.docs)
      : "none";
  const analysis = analysisEntry?.analysis ?? null;
  const { entry: related } = useRelated(ruleId, cacheKey);
  const { entry: suite, reload: reloadSuite } = useSuite(ruleId, cacheKey);
  const runs = useRuns(epoch);
  const scenarios = suite?.value?.scenarios ?? [];
  const selectedScenario =
    (ruleId && selectedScenarios[ruleId]) ||
    (current?.kind === "scenario" ? current.path : null) ||
    scenarios[0]?.path ||
    null;
  const scenarioTab = selectedScenario
    ? tabs.tabs.find((t) => t.path === selectedScenario)
    : undefined;
  /** The rule's last run on this branch, bound to the scenario it ran (review 1). */
  const runEntry = rulePath ? runs.reports[rulePath] : undefined;
  const report = runEntry?.report;
  /** The report describes the selected scenario: only then can its expectations be taken. */
  const reportCurrent = !!runEntry && runEntry.scenarioPath === selectedScenario;
  /**
   * The scenario or rule buffer changed since the run (confirmation look): the proposal's rows
   * and keys may point elsewhere, so it cannot be taken. A scenario without an open tab is still
   * the file the run read; that is re-checked when the take opens it.
   */
  const reportChanged =
    !!runEntry &&
    (tabs.tabs.some(
      (t) => t.path === runEntry.scenarioPath && t.content !== runEntry.scenarioContent,
    ) ||
      (!!ruleTab && ruleTab.content !== runEntry.ruleContent));
  const runError = rulePath ? runs.errors[rulePath] : undefined;
  const canRun = !!ruleTab && !!selectedScenario && !runs.busy;

  const lookupCodelist = useCallback(
    (id: string) => editor.codelist(id).then((r) => (r.problem ? null : r.data)),
    [],
  );
  const engineContext = useMemo<EngineContext>(
    () => ({
      schema: catalogues.schema,
      functions: catalogues.functions,
      analysis,
      related: related?.value ?? null,
      lookupCodelist,
    }),
    [catalogues.schema, catalogues.functions, analysis, related, lookupCodelist],
  );
  const derivedView = useMemo<DerivedView>(
    () => ({ derived: analysis?.derived ?? null, status: analysisStatus, showAuthorities }),
    [analysis, analysisStatus, showAuthorities],
  );
  /**
   * The lint markers of the active tab — only from a FRESH analysis of exactly this buffer. While
   * an analysis is pending or failed the answer's lines describe other text, so `null` leaves the
   * editor's own set alone (CodeMirror maps it through the edits) instead of re-placing old
   * ranges on new lines (review 3b).
   */
  const markers = useMemo(() => {
    if (!current || (current.kind !== "rule" && current.kind !== "docs")) return [];
    if (analysisStatus === "pending" || analysisStatus === "failed") return null;
    if (analysisStatus === "none" || !analysis) return [];
    return markersOf(
      current.content,
      analysis.diagnostics ?? [],
      current.kind === "rule" ? "CHECK" : "DOCS",
    );
  }, [current, analysis, analysisStatus]);

  // ---- open / close -------------------------------------------------------------------------

  const openPath = useCallback(
    async (path: string) => {
      if (tabs.tabs.some((t) => t.path === path)) {
        dispatch({ type: "activate", path });
        return;
      }
      const r = await editor.readFile(path);
      if (r.problem) {
        notifyProblem(`Open ${path}`, r.problem);
        return;
      }
      const content = r.data.content ?? "";
      dispatch({
        type: "open",
        tab: {
          path,
          kind: kindOf(path),
          title: titleOf(path),
          content,
          savedContent: content,
          blob: r.data.blob ?? null,
        },
      });
    },
    [tabs.tabs],
  );

  function openNewRule(family: string, id: string) {
    const path = `${CHECKS_DIR}${family}/${id}.yaml`;
    dispatch({
      type: "open",
      tab: {
        path,
        kind: "rule",
        title: titleOf(path),
        content: newRuleTemplate(id),
        savedContent: "",
        blob: null,
      },
    });
    setNewRuleFamily(null);
  }

  /** Open a new, unsaved scenario tab in the rule's suite directory and make it the run target. */
  function openNewScenario(name: string, content: string) {
    if (!rulePath || !ruleId) return;
    const dir = scenarioDirOf(rulePath);
    const path = `${dir}/${name}`;
    dispatch({
      type: "open",
      tab: { path, kind: "scenario", title: titleOf(path), content, savedContent: "", blob: null },
    });
    setSelectedScenarios((s) => ({ ...s, [ruleId]: path }));
    setNewScenario(null);
  }

  /** Open / point into the document a diagnostic belongs to (DOCS → the docs tab, RE-Q3). */
  async function goToDiagnostic(d: DiagnosticT) {
    if (!rulePath) return;
    const path = d.document === "DOCS" ? docsPathFor(rulePath) : rulePath;
    await openPath(path);
    setReveal((r) => ({ path, d, seq: (r?.seq ?? 0) + 1 }));
  }
  const revealRange = useMemo(() => {
    if (!reveal || !current || current.path !== reveal.path) return undefined;
    const range = rangeOf(current.content, reveal.d);
    return range ? { from: range[0], to: range[1], seq: reveal.seq } : undefined;
  }, [reveal, current]);

  // ---- run (§5.7) ---------------------------------------------------------------------------

  const runSelected = useCallback(async () => {
    if (!ruleTab || !selectedScenario) return;
    if (runs.busy) {
      notifications.show({
        color: "yellow",
        title: "Run",
        message: "A run is already in progress.",
      });
      return;
    }
    let scenarioContent = scenarioTab?.content;
    if (scenarioContent === undefined) {
      const r = await editor.readFile(selectedScenario);
      if (r.problem) {
        notifyProblem(`Run ${selectedScenario}`, r.problem);
        return;
      }
      scenarioContent = r.data.content ?? "";
    }
    const docs = docsTab && isDirty(docsTab) ? docsTab.content : undefined;
    const result = await runs.run(
      { path: ruleTab.path, content: ruleTab.content, docs },
      { path: selectedScenario, content: scenarioContent },
    );
    if (result.error) {
      notifications.show({ color: "red", title: "Run failed", message: result.error });
    }
  }, [ruleTab, selectedScenario, runs, scenarioTab, docsTab]);

  const runRef = useRef(runSelected);
  useEffect(() => {
    runRef.current = runSelected;
  }, [runSelected]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "F5") {
        e.preventDefault();
        void runRef.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  /**
   * The diff dialog of "take actual as expected" — over the BUFFER of the scenario the report ran
   * (never merely the selected one), so that tab is opened first. A report of another scenario or
   * branch is refused (review 1).
   */
  async function requestTakeExpected() {
    if (!runEntry || !reportCurrent || reportChanged || runEntry.branch !== epoch) {
      notifications.show({
        color: "orange",
        title: "Take actual as expected",
        message: "The report is not the selected scenario's — run it first.",
      });
      return;
    }
    // not open yet: the file must still be what the run judged
    if (!tabs.tabs.some((t) => t.path === runEntry.scenarioPath)) {
      const r = await editor.readFile(runEntry.scenarioPath);
      if (r.problem || (r.data.content ?? "") !== runEntry.scenarioContent) {
        notifications.show({
          color: "orange",
          title: "Take actual as expected",
          message: "The scenario changed since this run — run again.",
        });
        return;
      }
    }
    await openPath(runEntry.scenarioPath);
    setTakeExpected(runEntry);
  }

  const takeTab = takeExpected
    ? tabs.tabs.find((t) => t.path === takeExpected.scenarioPath)
    : undefined;
  const proposal =
    takeExpected && takeTab
      ? expectationProposal(
          takeTab.content,
          takeExpected.report.expectations?.lines ?? [],
          proposedExpect(takeExpected.report),
        )
      : null;

  /** Confirmed: rewrite the expectation lines of the report's scenario buffer (never automatic). */
  async function writeExpectationsIntoBuffer() {
    const target = takeExpected;
    setTakeExpected(null);
    if (!target || !takeTab || !proposal) return;
    if (
      target.branch !== epoch ||
      runs.reports[rulePath ?? ""] !== target ||
      takeTab.content !== target.scenarioContent ||
      (ruleTab && ruleTab.content !== target.ruleContent)
    ) {
      notifications.show({
        color: "orange",
        title: "Take actual as expected",
        message: "The run is no longer current — nothing was written. Run the scenario again.",
      });
      return;
    }
    const before = takeTab.content;
    const r = await editor.cdtExpectations(before, proposal.lines, proposal.expect ?? undefined);
    if (r.problem) {
      notifyProblem("Take actual as expected", r.problem);
      return;
    }
    dispatch({ type: "edit", path: target.scenarioPath, content: r.data.content ?? before });
    dispatch({ type: "activate", path: target.scenarioPath });
  }

  /** Clone copies the source's BUFFER, so the source tab is opened first. */
  async function requestNewScenario(
    mode: "rule" | "clone",
    source?: { path?: string; name?: string },
  ) {
    if (mode === "clone" && source?.path) await openPath(source.path);
    setNewScenario({ mode, source });
  }

  function requestClose(path: string) {
    const tab = tabs.tabs.find((t) => t.path === path);
    if (tab && tab.content !== tab.savedContent) setClosingDirty(path);
    else dispatch({ type: "close", path });
  }

  // ---- save ---------------------------------------------------------------------------------

  // The latest `save`, for the re-authentication retry (a callback cannot name itself).
  const saveRef = useRef<((path: string) => Promise<void>) | null>(null);

  const save = useCallback(
    async (path: string): Promise<void> => {
      const tab = tabs.tabs.find((t) => t.path === path);
      if (!tab) return;
      if (readOnly) {
        notifications.show({
          color: "yellow",
          title: "Read-only mode",
          message: "Your token cannot push, so edits are not saved. You can still edit and run.",
        });
        return;
      }
      const stamp = await expect();
      if (!stamp) {
        if (sessionLost.current) setReauthRetry(() => () => void saveRef.current?.(path));
        return;
      }
      const r = await editor.writeFile(path, tab.content, tab.blob, stamp);
      if (!r.problem) {
        dispatch({ type: "saved", path, blob: r.data.blob ?? "" });
        await refreshStatus();
        void refreshTree();
        // the suite rows show the saved scenarios' expectations, so any scenario save reloads it
        if (tab.kind === "scenario") {
          const id = scenarioRuleIdOf(path);
          if (id) reloadSuite(id);
        }
        if (tab.kind === "rule") forgetDisk(path);
        setPushNowFor(path);
        return;
      }
      const p = r.problem;
      if (p.status === 401) {
        setReauthRetry(() => () => void saveRef.current?.(path));
      } else if (p.code === "STALE") {
        const fresh = await editor.readFile(path);
        if (!fresh.problem) {
          dispatch({
            type: "rebase",
            path,
            savedContent: fresh.data.content ?? "",
            blob: fresh.data.blob ?? null,
          });
        }
        await refreshStatus();
        notifications.show({
          color: "orange",
          title: "Workspace changed",
          message:
            "The branch or head moved under this tab. Reloaded — save again to keep your edits.",
        });
      } else if (p.code === "DEFAULT_BRANCH") {
        notifications.show({
          color: "orange",
          title: "Default branch is read-only",
          message: "Create a branch for your change; it reaches the default branch through a PR.",
        });
        setBranchOpen(true);
      } else {
        notifyProblem(`Save ${path}`, p);
      }
    },
    // The three setters are listed because the React Compiler lint infers them as dependencies
    // of this callback (react-hooks/preserve-manual-memoization); they are stable, so the list
    // changes nothing at run time.
    [
      tabs.tabs,
      readOnly,
      expect,
      refreshStatus,
      refreshTree,
      reloadSuite,
      forgetDisk,
      setPushNowFor,
      setReauthRetry,
      setBranchOpen,
    ],
  );

  useEffect(() => {
    saveRef.current = save;
  }, [save]);

  // ---- commit / push ------------------------------------------------------------------------

  const commitPush = useCallback(
    async (message: string): Promise<CommitPushOutcome> => {
      let stamp = await expect();
      if (!stamp) return { error: "Workspace status unavailable." };
      if ((status?.uncommitted?.length ?? 0) > 0) {
        const c = await editor.commit(message, stamp);
        if (c.problem) return { error: `${c.problem.detail} (${c.problem.code})` };
        const s = await refreshStatus();
        void refreshTree();
        if (!s?.branch || !s.head) return { error: "Workspace status unavailable." };
        stamp = { branch: s.branch, head: s.head };
      }
      const p = await editor.push(stamp);
      if (p.problem) {
        if (p.problem.code === "NON_FAST_FORWARD") {
          return { nonFastForward: true, error: p.problem.detail };
        }
        return { error: `${p.problem.detail} (${p.problem.code})` };
      }
      await refreshStatus();
      return { pullRequestUrl: p.data.pullRequestUrl ?? undefined };
    },
    [expect, status, refreshStatus, refreshTree],
  );

  const runUpdate = useCallback(
    async (
      update: (stamp: editor.Expect) => ReturnType<typeof editor.updateFromRemote>,
      title: string,
    ): Promise<boolean> => {
      const retry = async (): Promise<boolean> => {
        const stamp = await expect();
        if (!stamp) return false;
        const r = await update(stamp);
        if (r.problem) {
          if (r.problem.code === "DIRTY_TREE") {
            // the problem names paths only; the dialog lists kinds too, so read them fresh
            const fresh = await refreshStatus();
            setDirtyTree({ files: fresh?.uncommitted ?? uncommitted, retry });
            return false;
          }
          if (r.problem.code === "MERGE_CONFLICT") {
            const paths = (r.problem.extra.paths as string[] | undefined) ?? [];
            notifications.show({
              color: "red",
              title: `${title}: conflict`,
              message: `Aborted, nothing changed. Conflicting: ${paths.join(", ")}`,
            });
            return false;
          }
          notifyProblem(title, r.problem);
          return false;
        }
        await refreshStatus();
        void refreshTree();
        invalidateCaches();
        notifications.show({ color: "green", title, message: `${r.data.merge?.status ?? "done"}` });
        return true;
      };
      return retry();
    },
    [expect, uncommitted, refreshStatus, refreshTree, invalidateCaches],
  );

  // ---- branches -----------------------------------------------------------------------------

  /** Resolves true when there are no unsaved buffers, or the user chose to leave them behind. */
  const guardUnsaved = useCallback(
    (title: string, action: string): Promise<boolean> =>
      new Promise((resolve) => {
        if (unsaved.length === 0) {
          resolve(true);
          return;
        }
        setLeave({
          title,
          action,
          onConfirm: () => {
            setLeave(null);
            resolve(true);
          },
          onCancel: () => {
            setLeave(null);
            resolve(false);
          },
        });
      }),
    [unsaved.length],
  );

  const branchOp = useCallback(
    async (
      op: (stamp: editor.Expect) => ReturnType<typeof editor.switchBranch>,
      title: string,
    ): Promise<boolean> => {
      const retry = async (): Promise<boolean> => {
        const stamp = await expect();
        if (!stamp) return false;
        const r = await op(stamp);
        if (r.problem) {
          if (r.problem.code === "DIRTY_TREE") {
            // the problem names paths only; the dialog lists kinds too, so read them fresh
            const fresh = await refreshStatus();
            setDirtyTree({ files: fresh?.uncommitted ?? uncommitted, retry });
            return false;
          }
          notifyProblem(title, r.problem);
          return false;
        }
        dispatch({ type: "closeAll" });
        await refreshStatus();
        void refreshTree();
        notifications.show({ color: "green", title, message: `Now on ${r.data.current}` });
        return true;
      };
      return retry();
    },
    [expect, uncommitted, refreshStatus, refreshTree],
  );

  const switchBranch = useCallback(
    async (name: string): Promise<boolean> => {
      if (!(await guardUnsaved("Switch branch", `Discard unsaved edits and switch to ${name}`))) {
        return false;
      }
      return branchOp((stamp) => editor.switchBranch(name, stamp), "Switch branch");
    },
    [guardUnsaved, branchOp],
  );

  const createBranch = useCallback(
    async (name: string): Promise<boolean> => {
      if (!(await guardUnsaved("New branch", `Discard unsaved edits and create ${name}`))) {
        return false;
      }
      return branchOp((stamp) => editor.createBranch(name, stamp), "New branch");
    },
    [guardUnsaved, branchOp],
  );

  const deleteBranch = useCallback(async (name: string): Promise<boolean> => {
    const r = await editor.deleteBranch(name);
    if (r.problem) {
      notifyProblem("Delete branch", r.problem);
      return false;
    }
    notifications.show({ color: "green", title: "Delete branch", message: `Deleted ${name}` });
    return false; // keep the picker open with the refreshed list
  }, []);

  // ---- discard (dirty-tree dialog) ----------------------------------------------------------

  /** Reloads the open tabs of discarded files from the workspace; a deleted new file's tab closes. */
  async function reloadDiscarded(paths: string[]): Promise<void> {
    for (const path of paths) {
      if (!tabs.tabs.some((t) => t.path === path)) continue;
      const r = await editor.readFile(path);
      if (!r.problem) {
        dispatch({
          type: "reload",
          path,
          content: r.data.content ?? "",
          blob: r.data.blob ?? null,
        });
      } else if (r.problem.status === 404) {
        dispatch({ type: "close", path });
      } else {
        notifyProblem(`Reload ${path}`, r.problem);
      }
    }
  }

  /**
   * Discards exactly the files the dialog named. When they are no longer the workspace's
   * uncommitted files (another tab saved or committed) the server refuses with `STALE` and
   * discards nothing; the dialog then shows the current list and asks again.
   */
  async function discardDirtyTree(): Promise<boolean> {
    if (!dirtyTree) return false;
    const stamp = await expect();
    if (!stamp) return false;
    const paths = dirtyTree.files.map((f) => f.path ?? "").filter(Boolean);
    const r = await editor.discard(paths, stamp);
    if (r.problem) {
      if (r.problem.code !== "STALE") {
        notifyProblem("Discard", r.problem);
        return false;
      }
      const fresh = (await refreshStatus())?.uncommitted ?? [];
      if (fresh.length === 0) {
        setDirtyTree(null);
        void dirtyTree.retry();
        return true;
      }
      setDirtyTree({ ...dirtyTree, files: fresh });
      notifications.show({
        color: "orange",
        title: "Discard",
        message:
          "The uncommitted files changed since they were listed. Nothing was discarded — check the list and confirm again.",
      });
      return false;
    }
    await reloadDiscarded((r.data.discarded ?? []).map((f) => f.path ?? ""));
    await refreshStatus();
    void refreshTree();
    invalidateCaches();
    const retry = dirtyTree.retry;
    setDirtyTree(null);
    void retry();
    return true;
  }

  // ---- logout -------------------------------------------------------------------------------

  const doLogout = useCallback(async () => {
    setLeave(null);
    await editor.logout();
    onLoggedOut();
  }, [onLoggedOut]);

  function requestLogout() {
    if (anythingPending) {
      setLeave({
        title: "Log out with work behind?",
        action: "Log out",
        onConfirm: () => void doLogout(),
        onCancel: () => setLeave(null),
      });
    } else {
      void doLogout();
    }
  }

  // ---- render -------------------------------------------------------------------------------

  const suggested = suggestMessage(uncommitted);

  return (
    <AppShell header={{ height: 48 }} navbar={{ width: 300, breakpoint: 0 }} padding={0}>
      <AppShell.Header>
        <Header
          info={info}
          session={session}
          status={status}
          unsavedCount={unsaved.length}
          onOpenBranches={() => setBranchOpen(true)}
          onCommitPush={() => setCommitPushOpen(true)}
          onLogout={requestLogout}
        />
      </AppShell.Header>
      <AppShell.Navbar>
        <Explorer
          tree={tree}
          onOpen={(p) => void openPath(p)}
          onSearch={() => setSearchOpen(true)}
          onNewRule={readOnly ? undefined : (family) => setNewRuleFamily(family)}
        />
      </AppShell.Navbar>
      <AppShell.Main h="100vh" style={{ display: "flex", flexDirection: "column" }}>
        <EngineBanner
          engine={info?.engine}
          branchLevel={tree ? (tree.languageLevel ?? null) : undefined}
        />
        <EditorTabs
          tabs={tabs.tabs}
          active={tabs.active}
          onActivate={(p) => dispatch({ type: "activate", path: p })}
          onClose={requestClose}
        />
        <Box style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
          {current ? (
            <>
              <Group gap="xs" px="xs" py={2} justify="space-between">
                <Text
                  size="xs"
                  c="dimmed"
                  style={{ fontFamily: "var(--mantine-font-family-monospace)" }}
                >
                  {current.path}
                </Text>
                <Group gap="xs">
                  {current.kind === "rule" && (
                    <Button
                      size="compact-xs"
                      variant={showAuthorities ? "light" : "subtle"}
                      onClick={() => setShowAuthorities((v) => !v)}
                      aria-pressed={showAuthorities}
                    >
                      {showAuthorities ? "Hide Authorities" : "Show Authorities"}
                    </Button>
                  )}
                  {ruleTab && (
                    <Button
                      size="compact-xs"
                      variant="light"
                      color="green"
                      onClick={() => void runSelected()}
                      disabled={!canRun}
                      loading={runs.busy}
                    >
                      Run (F5)
                    </Button>
                  )}
                  {current.kind === "rule" && docsPathOf(tree, current.path) && (
                    <Button
                      size="compact-xs"
                      variant="subtle"
                      onClick={() => void openPath(docsPathOf(tree, current.path) ?? "")}
                    >
                      Open docs
                    </Button>
                  )}
                  <Button
                    size="compact-xs"
                    variant="light"
                    onClick={() => void save(current.path)}
                    disabled={current.content === current.savedContent}
                  >
                    Save (Ctrl+S)
                  </Button>
                </Group>
              </Group>
              {current.kind === "scenario" ? (
                <ScenarioEditor
                  key={current.path}
                  tab={current}
                  onChange={(content) => dispatch({ type: "edit", path: current.path, content })}
                  onSave={() => void save(current.path)}
                  analysis={analysis}
                />
              ) : (
                <CodeEditor
                  key={current.path}
                  label={current.title}
                  value={current.content}
                  onChange={(content) => dispatch({ type: "edit", path: current.path, content })}
                  onSave={() => void save(current.path)}
                  language={current.kind === "rule" || current.kind === "docs" ? "yaml" : undefined}
                  initialFoldKeys={current.kind === "rule" ? ["Authorities"] : undefined}
                  foldTrigger={current.path}
                  markers={markers}
                  engine={current.kind === "rule" ? engineContext : undefined}
                  derived={current.kind === "rule" ? derivedView : undefined}
                  reveal={revealRange}
                />
              )}
            </>
          ) : (
            <Box p="md">
              <Text c="dimmed">Open a rule from the Explorer, or search (🔍).</Text>
            </Box>
          )}
        </Box>
        <Box h={260} style={{ borderTop: "1px solid var(--mantine-color-default-border)" }}>
          <BottomPanel
            tab={current}
            ruleId={ruleId}
            suite={suite}
            selectedScenario={selectedScenario}
            onSelectScenario={(path) =>
              ruleId && setSelectedScenarios((s) => ({ ...s, [ruleId]: path }))
            }
            onOpen={(p) => void openPath(p)}
            onNewScenario={(mode, source) => void requestNewScenario(mode, source)}
            lastRuns={runs.lastRuns}
            report={report}
            reportScenario={runEntry?.scenarioPath}
            reportCurrent={reportCurrent}
            reportChanged={reportChanged}
            runError={runError}
            runBusy={runs.busy}
            canRun={canRun}
            onRun={() => void runSelected()}
            onTakeExpected={() => void requestTakeExpected()}
            analysis={analysisEntry}
            analysisStatus={analysisStatus}
            onRetryAnalysis={retryAnalysis}
            onGoToDiagnostic={(d) => void goToDiagnostic(d)}
            related={related}
          />
        </Box>
      </AppShell.Main>

      <SearchDialog
        opened={searchOpen}
        onClose={() => setSearchOpen(false)}
        onOpen={(p) => void openPath(p)}
      />
      <BranchDialog
        opened={branchOpen}
        onClose={() => setBranchOpen(false)}
        canCreate={!readOnly}
        onSwitch={switchBranch}
        onCreate={createBranch}
        onDelete={deleteBranch}
      />
      <NewRuleDialog
        family={newRuleFamily}
        existingIds={tree?.families?.flatMap((f) => (f.rules ?? []).map((r) => r.id ?? "")) ?? []}
        onCreate={openNewRule}
        onCancel={() => setNewRuleFamily(null)}
      />
      <PushNowDialog
        opened={pushNowFor !== null}
        suggestedMessage={suggested}
        onLater={() => setPushNowFor(null)}
        onCommitPush={() => {
          setPushNowFor(null);
          setCommitPushOpen(true);
        }}
      />
      <CommitPushDialog
        opened={commitPushOpen}
        onClose={() => setCommitPushOpen(false)}
        uncommitted={uncommitted}
        unpushed={unpushed}
        suggestedMessage={suggested}
        onCommitPush={commitPush}
        onUpdateFromRemote={() => runUpdate(editor.updateFromRemote, "Update from remote branch")}
      />
      <DirtyTreeDialog
        opened={dirtyTree !== null}
        files={dirtyTree?.files ?? []}
        onCancel={() => setDirtyTree(null)}
        onDiscard={discardDirtyTree}
        onCommitLocally={async (message) => {
          const stamp = await expect();
          if (!stamp || !dirtyTree) return false;
          const c = await editor.commit(message, stamp);
          if (c.problem) {
            notifyProblem("Commit locally", c.problem);
            return false;
          }
          await refreshStatus();
          const retry = dirtyTree.retry;
          setDirtyTree(null);
          void retry();
          return true;
        }}
      />
      <LeaveDialog
        opened={leave !== null}
        title={leave?.title ?? ""}
        action={leave?.action ?? ""}
        unsaved={unsaved.map((t) => t.path)}
        uncommitted={uncommitted}
        unpushed={unpushed}
        onConfirm={() => leave?.onConfirm()}
        onCancel={() => leave?.onCancel()}
      />
      <ReauthDialog
        opened={reauthRetry !== null}
        loginName={session.login ?? ""}
        onCancel={() => setReauthRetry(null)}
        onLoggedIn={(s) => {
          onSession(s);
          const retry = reauthRetry;
          setReauthRetry(null);
          retry?.();
        }}
      />
      <NewScenarioDialog
        request={newScenario}
        ruleId={ruleId ?? ""}
        analysis={analysis}
        existing={scenarios.map((sc) => sc.name ?? "")}
        sourceText={
          newScenario?.source?.path
            ? (tabs.tabs.find((t) => t.path === newScenario.source?.path)?.content ?? null)
            : null
        }
        onCreate={openNewScenario}
        onCancel={() => setNewScenario(null)}
      />
      <TakeExpectedDialog
        opened={takeExpected !== null && proposal !== null}
        scenarioName={nameOf(takeExpected?.scenarioPath ?? "")}
        current={proposal?.current ?? []}
        proposed={proposal?.proposed ?? []}
        onConfirm={() => void writeExpectationsIntoBuffer()}
        onCancel={() => setTakeExpected(null)}
      />
      <CloseDirtyTabDialog
        path={closingDirty}
        onCancel={() => setClosingDirty(null)}
        onDiscard={() => {
          if (closingDirty) dispatch({ type: "close", path: closingDirty });
          setClosingDirty(null);
        }}
      />
    </AppShell>
  );
}

/** The file name of a path. */
function nameOf(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

/** The `expect=` a run proposes for its scenario: `expectations.expect`, else `testLine`'s token. */
function proposedExpect(report: RunEntry["report"]): string | null {
  const e = report.expectations;
  if (e?.expect) return e.expect;
  return e?.testLine ? readExpectations(e.testLine).expect : null;
}

/** The docs sidecar of a check path, from the Explorer tree (RE-Q3: opens as its own tab). */
export function docsPathOf(tree: ExplorerTreeT | null, rulePath: string): string | null {
  for (const family of tree?.families ?? []) {
    for (const rule of family.rules ?? []) {
      if (rule.path === rulePath) return rule.docsPath ?? null;
    }
  }
  return null;
}
