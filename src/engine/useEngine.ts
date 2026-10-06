import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ApiResult } from "../api/client";
import * as editor from "../api/editor";
import type {
  AnalysisT,
  FunctionInfoT,
  RelatedRuleT,
  RunReportT,
  ScenarioT,
  SuiteT,
} from "../api/types";
import { CHECKS_DIR, DOCS_DIR, isDirty, type Tab } from "../state/tabs";
import type { JsonSchema } from "./schemaWalk";

/** How long the editor waits after the last keystroke before analysing (§5.4). */
export const ANALYSIS_DEBOUNCE_MS = 400;

/** The analysis of one rule buffer: what was analysed (to tell a stale answer) and the answer. */
export interface AnalysisEntry {
  content: string;
  docs: string | undefined;
  analysis: AnalysisT | null;
  failed: string | null;
}

export type AnalysisStatus = "none" | "pending" | "ok" | "failed";

/** The docs path of a check path and back. */
export function docsPathFor(rulePath: string): string {
  return rulePath.replace(CHECKS_DIR, DOCS_DIR);
}

export function rulePathFor(docsPath: string): string {
  return docsPath.replace(DOCS_DIR, CHECKS_DIR);
}

/** The rule path an active tab's analysis belongs to: the rule itself, or a docs tab's rule. */
export function rulePathOf(tab: Tab | undefined): string | null {
  if (!tab) return null;
  if (tab.kind === "rule") return tab.path;
  if (tab.kind === "docs") return rulePathFor(tab.path);
  return null;
}

/** The status of an entry against the buffer it should describe. */
export function statusOf(entry: AnalysisEntry | undefined, content: string): AnalysisStatus {
  if (!entry) return "pending";
  if (entry.content !== content) return "pending";
  return entry.failed ? "failed" : "ok";
}

/**
 * Analysis on change (§5.4): the active rule buffer — or the rule of the active docs tab — is
 * sent to `POST /api/analyse` 400 ms after its last change, with the docs buffer when that tab
 * is open and dirty. Answers for a buffer that changed meanwhile are dropped. `epoch` (the
 * branch) invalidates every entry.
 */
export function useAnalyses(tabs: Tab[], active: Tab | undefined, epoch: string) {
  const [state, setState] = useState<{ epoch: string; byPath: Record<string, AnalysisEntry> }>({
    epoch,
    byPath: {},
  });
  const byPath = useMemo(() => (state.epoch === epoch ? state.byPath : {}), [state, epoch]);
  const byPathRef = useRef(byPath);
  useEffect(() => {
    byPathRef.current = byPath;
  }, [byPath]);
  const seq = useRef(0);
  const [retries, setRetries] = useState(0);

  const rulePath = rulePathOf(active);
  const ruleTab = rulePath ? tabs.find((t) => t.path === rulePath) : undefined;
  const docsTab = rulePath ? tabs.find((t) => t.path === docsPathFor(rulePath)) : undefined;
  const content = ruleTab?.content;
  const docs = docsTab && isDirty(docsTab) ? docsTab.content : undefined;

  useEffect(() => {
    if (!rulePath || content === undefined) return undefined;
    const existing = byPathRef.current[rulePath];
    if (existing && existing.content === content && existing.docs === docs && !existing.failed) {
      return undefined;
    }
    const id = ++seq.current;
    const timer = setTimeout(() => {
      void editor.analyse(rulePath, content, docs).then((r) => {
        if (seq.current !== id) return;
        setState((prev) => ({
          epoch,
          byPath: {
            ...(prev.epoch === epoch ? prev.byPath : {}),
            [rulePath]: {
              content,
              docs,
              analysis: r.problem
                ? (prev.byPath[rulePath]?.analysis ?? null)
                : (r.data.analysis ?? null),
              failed: r.problem ? `${r.problem.detail} (${r.problem.code})` : null,
            },
          },
        }));
      });
    }, ANALYSIS_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [rulePath, content, docs, epoch, retries]);

  const retry = useCallback(() => setRetries((n) => n + 1), []);
  return { byPath, retry };
}

/** The branch's schema (`null` = none, `undefined` = not loaded yet) and the function catalogue. */
export function useCatalogues(epoch: string, enabled: boolean) {
  const [schema, setSchema] = useState<{ epoch: string; value: JsonSchema | null } | null>(null);
  const [functions, setFunctions] = useState<{ epoch: string; value: FunctionInfoT[] } | null>(
    null,
  );
  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;
    void editor.schema().then((r) => {
      if (cancelled) return;
      setSchema({ epoch, value: r.problem ? null : r.data });
    });
    void editor.functions().then((r) => {
      if (cancelled) return;
      setFunctions({ epoch, value: r.problem ? [] : (r.data.functions ?? []) });
    });
    return () => {
      cancelled = true;
    };
  }, [epoch, enabled]);
  return {
    schema: schema?.epoch === epoch ? schema.value : null,
    functions: functions?.epoch === epoch ? functions.value : [],
  };
}

/** A per-key cache of a server answer, reloaded when `key` or `epoch` changes. */
function useKeyed<T>(
  key: string | null,
  epoch: string,
  load: (key: string) => Promise<ApiResult<T>>,
) {
  const [state, setState] = useState<{
    epoch: string;
    byKey: Record<string, { value: T | null; error: string | null }>;
  }>({ epoch, byKey: {} });
  const byKey = state.epoch === epoch ? state.byKey : {};
  const [reloads, setReloads] = useState(0);
  const has = key !== null && key in byKey;
  useEffect(() => {
    if (key === null || has) return undefined;
    let cancelled = false;
    void load(key).then((r) => {
      if (cancelled) return;
      setState((prev) => ({
        epoch,
        byKey: {
          ...(prev.epoch === epoch ? prev.byKey : {}),
          [key]: r.problem
            ? { value: null, error: `${r.problem.detail} (${r.problem.code})` }
            : { value: r.data, error: null },
        },
      }));
    });
    return () => {
      cancelled = true;
    };
  }, [key, has, epoch, load, reloads]);
  const reload = useCallback((k: string) => {
    setState((prev) => {
      const next = { ...prev.byKey };
      delete next[k];
      return { epoch: prev.epoch, byKey: next };
    });
    setReloads((n) => n + 1);
  }, []);
  return { entry: key === null ? undefined : byKey[key], reload };
}

const loadRelated = (id: string) =>
  editor.related(id).then((r) => (r.problem ? r : { data: r.data.related ?? [] }));

/** The related rules of a rule id (§5.5). */
export function useRelated(ruleId: string | null, epoch: string) {
  return useKeyed<RelatedRuleT[]>(ruleId, epoch, loadRelated);
}

const loadSuite = (id: string) =>
  editor.scenarios(id).then((r) => (r.problem ? r : { data: r.data.suite ?? { scenarios: [] } }));

/** The scenario suite of a rule id (§5.6). */
export function useSuite(ruleId: string | null, epoch: string) {
  return useKeyed<SuiteT>(ruleId, epoch, loadSuite);
}

/** A run's outcome as the Scenarios tab remembers it for the session. */
export interface LastRun {
  outcome: string;
  code: string;
  at: number;
}

/** The run state (§5.7): one at a time, the last report per rule, the last outcome per scenario. */
export function useRuns() {
  const [busy, setBusy] = useState(false);
  const [reports, setReports] = useState<Record<string, RunReportT>>({});
  const [lastRuns, setLastRuns] = useState<Record<string, LastRun>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  const run = useCallback(
    async (
      rule: { path: string; content: string; docs?: string },
      scenario: { path: string; content: string },
    ): Promise<{ report: RunReportT | null; error: string | null }> => {
      setBusy(true);
      try {
        const r = await editor.run(
          rule.path,
          rule.content,
          scenario.path,
          scenario.content,
          rule.docs,
        );
        if (r.problem) {
          const error = `${r.problem.detail} (${r.problem.code})`;
          setErrors((e) => ({ ...e, [rule.path]: error }));
          return { report: null, error };
        }
        const report = r.data.report ?? {};
        setErrors((e) => {
          const next = { ...e };
          delete next[rule.path];
          return next;
        });
        setReports((p) => ({ ...p, [rule.path]: report }));
        setLastRuns((p) => ({
          ...p,
          [scenario.path]: {
            outcome: report.outcome ?? "?",
            code: report.code ?? "",
            at: Date.now(),
          },
        }));
        return { report, error: null };
      } finally {
        setBusy(false);
      }
    },
    [],
  );
  return { busy, reports, errors, lastRuns, run };
}

export type { ScenarioT };
