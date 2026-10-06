/**
 * The open tabs — pure state and reducer, so the rules (dirty = buffer ≠ file, one tab per path,
 * closing the active tab activates its neighbour) are unit-testable without React.
 */

/** What a tab holds: a check file, its docs sidecar, a `.cdt` scenario or any other text. */
export type TabKind = "rule" | "docs" | "scenario" | "text";

export interface Tab {
  /** Repository-relative path; also the tab's identity. */
  path: string;
  kind: TabKind;
  title: string;
  /** The buffer. */
  content: string;
  /** The content as last read from or written to the workspace. */
  savedContent: string;
  /** Git blob id of `savedContent`; `null` for a file the workspace does not hold yet. */
  blob: string | null;
}

export interface TabsState {
  tabs: Tab[];
  active: string | null;
}

export const EMPTY_TABS: TabsState = { tabs: [], active: null };

export type TabsAction =
  | { type: "open"; tab: Tab }
  | { type: "activate"; path: string }
  | { type: "close"; path: string }
  | { type: "closeAll" }
  | { type: "edit"; path: string; content: string }
  /** The buffer was written: the saved baseline becomes the buffer. */
  | { type: "saved"; path: string; blob: string }
  /** The file changed under us (409 STALE): new baseline, the buffer is kept. */
  | { type: "rebase"; path: string; savedContent: string; blob: string | null }
  /** The file was reset under us (a discard): buffer and baseline both become the file. */
  | { type: "reload"; path: string; content: string; blob: string | null };

export function isDirty(tab: Tab): boolean {
  return tab.content !== tab.savedContent;
}

export function dirtyTabs(state: TabsState): Tab[] {
  return state.tabs.filter(isDirty);
}

export function activeTab(state: TabsState): Tab | undefined {
  return state.tabs.find((t) => t.path === state.active);
}

export const CHECKS_DIR = "rules-src/checks/";
export const DOCS_DIR = "rules-src/docs/";
export const SCENARIOS_DIR = "src/test/resources/net/cumba/corej/core/ruletestsuites/";

/** Classify a repository path by where it lives (rest `CorpusLayout`). */
export function kindOf(path: string): TabKind {
  if (path.startsWith(CHECKS_DIR) && path.endsWith(".yaml")) return "rule";
  if (path.startsWith(DOCS_DIR)) return "docs";
  if (path.startsWith(SCENARIOS_DIR) && path.endsWith(".cdt")) return "scenario";
  return "text";
}

/** The tab title: the file name, with the docs sidecar marked so it is not mistaken for the rule. */
export function titleOf(path: string): string {
  const name = path.slice(path.lastIndexOf("/") + 1);
  return kindOf(path) === "docs" ? `${name} (docs)` : name;
}

/** The rule id of a check or docs path (`rules-src/checks/CDISC/CDISC-CG0270.yaml` → `CDISC-CG0270`). */
export function ruleIdOf(path: string): string | null {
  const m = /^rules-src\/(?:checks|docs)\/[^/]+\/([^/]+)\.yaml$/.exec(path);
  return m ? m[1] : null;
}

/** The family of a check or docs path (`rules-src/checks/CDISC/…` → `CDISC`). */
export function familyOf(path: string): string | null {
  const m = /^rules-src\/(?:checks|docs)\/([^/]+)\//.exec(path);
  return m ? m[1] : null;
}

/** The rule id a scenario (or sidecar) path belongs to (`…/ruletestsuites/cdisc/CDISC-CG0270/x.cdt` → `CDISC-CG0270`). */
export function scenarioRuleIdOf(path: string): string | null {
  if (!path.startsWith(SCENARIOS_DIR)) return null;
  const m = /^[^/]+\/([^/]+)\//.exec(path.slice(SCENARIOS_DIR.length));
  return m ? m[1] : null;
}

/** The check path of a rule id (`CDISC-CG0270` → `rules-src/checks/CDISC/CDISC-CG0270.yaml`). */
export function rulePathOfId(ruleId: string): string {
  const family = ruleId.includes("-") ? ruleId.slice(0, ruleId.indexOf("-")) : ruleId;
  return `${CHECKS_DIR}${family}/${ruleId}.yaml`;
}

/** The scenario directory of a rule (families are lower-case there: `…/ruletestsuites/cdisc/CDISC-AD0001`). */
export function scenarioDirOf(rulePath: string): string | null {
  const family = familyOf(rulePath);
  const id = ruleIdOf(rulePath);
  return family && id ? `${SCENARIOS_DIR}${family.toLowerCase()}/${id}` : null;
}

export function tabsReducer(state: TabsState, action: TabsAction): TabsState {
  switch (action.type) {
    case "open": {
      const existing = state.tabs.find((t) => t.path === action.tab.path);
      if (existing) return { ...state, active: existing.path };
      return { tabs: [...state.tabs, action.tab], active: action.tab.path };
    }
    case "activate":
      return state.tabs.some((t) => t.path === action.path)
        ? { ...state, active: action.path }
        : state;
    case "close": {
      const index = state.tabs.findIndex((t) => t.path === action.path);
      if (index < 0) return state;
      const tabs = state.tabs.filter((t) => t.path !== action.path);
      let active = state.active;
      if (active === action.path) {
        const neighbour = tabs[Math.min(index, tabs.length - 1)];
        active = neighbour ? neighbour.path : null;
      }
      return { tabs, active };
    }
    case "closeAll":
      return EMPTY_TABS;
    case "edit":
      return update(state, action.path, (t) => ({ ...t, content: action.content }));
    case "saved":
      return update(state, action.path, (t) => ({
        ...t,
        savedContent: t.content,
        blob: action.blob,
      }));
    case "rebase":
      return update(state, action.path, (t) => ({
        ...t,
        savedContent: action.savedContent,
        blob: action.blob,
      }));
    case "reload":
      return update(state, action.path, (t) => ({
        ...t,
        content: action.content,
        savedContent: action.content,
        blob: action.blob,
      }));
  }
}

function update(state: TabsState, path: string, fn: (tab: Tab) => Tab): TabsState {
  if (!state.tabs.some((t) => t.path === path)) return state;
  return { ...state, tabs: state.tabs.map((t) => (t.path === path ? fn(t) : t)) };
}

/** A template for a new rule, per PLAN-rule-editor §5.3 (`Core`, `Description`, `Scope`, `Check`, `Outcome`, `Standards`). */
export function newRuleTemplate(id: string): string {
  return [
    "Core:",
    `  Id: "${id}"`,
    '  Status: "Draft"',
    '  Version: "1"',
    'Description: ""',
    'Executability: "Fully Executable"',
    "Scope:",
    "  Domains:",
    "    Include:",
    '    - ""',
    "Check:",
    "  expression: >-",
    "    ",
    "Outcome:",
    '  Message: ""',
    "Standards:",
    '- Organization: "CDISC"',
    "  Standards:",
    '  - Name: "SDTMIG"',
    '    Version: ""',
    "",
  ].join("\n");
}
