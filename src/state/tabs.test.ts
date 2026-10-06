import { describe, expect, it } from "vitest";
import {
  activeTab,
  dirtyTabs,
  EMPTY_TABS,
  familyOf,
  isDirty,
  kindOf,
  newRuleTemplate,
  ruleIdOf,
  scenarioDirOf,
  tabsReducer,
  titleOf,
  type Tab,
  type TabsState,
} from "./tabs";

function tab(path: string, content = "a", savedContent = content): Tab {
  return { path, kind: kindOf(path), title: titleOf(path), content, savedContent, blob: "b" };
}

const RULE = "rules-src/checks/CDISC/CDISC-CG0270.yaml";
const DOCS = "rules-src/docs/CDISC/CDISC-CG0270.yaml";
const CDT =
  "src/test/resources/net/cumba/corej/core/ruletestsuites/cdisc/CDISC-CG0270/CDISC-CG0270-invalid-AE.cdt";

describe("path classification", () => {
  it("classifies check, docs, scenario and other paths", () => {
    expect(kindOf(RULE)).toBe("rule");
    expect(kindOf(DOCS)).toBe("docs");
    expect(kindOf(CDT)).toBe("scenario");
    expect(kindOf("rules-src/checks/CDISC/README.md")).toBe("text");
    expect(kindOf("src/test/resources/net/cumba/corej/core/ruletestsuites/README-CDT.md")).toBe(
      "text",
    );
  });

  it("titles the docs sidecar so it is not mistaken for the rule", () => {
    expect(titleOf(RULE)).toBe("CDISC-CG0270.yaml");
    expect(titleOf(DOCS)).toBe("CDISC-CG0270.yaml (docs)");
    expect(titleOf(CDT)).toBe("CDISC-CG0270-invalid-AE.cdt");
  });

  it("derives rule id, family and the lower-case scenario directory", () => {
    expect(ruleIdOf(RULE)).toBe("CDISC-CG0270");
    expect(ruleIdOf(DOCS)).toBe("CDISC-CG0270");
    expect(ruleIdOf(CDT)).toBeNull();
    expect(familyOf(RULE)).toBe("CDISC");
    expect(familyOf(CDT)).toBeNull();
    expect(scenarioDirOf(RULE)).toBe(
      "src/test/resources/net/cumba/corej/core/ruletestsuites/cdisc/CDISC-CG0270",
    );
    expect(scenarioDirOf(CDT)).toBeNull();
  });
});

describe("tabsReducer", () => {
  it("opens a tab, activates an already open one instead of duplicating it", () => {
    let s: TabsState = tabsReducer(EMPTY_TABS, { type: "open", tab: tab(RULE) });
    s = tabsReducer(s, { type: "open", tab: tab(DOCS) });
    expect(s.tabs.map((t) => t.path)).toEqual([RULE, DOCS]);
    expect(s.active).toBe(DOCS);
    s = tabsReducer(s, { type: "open", tab: tab(RULE, "other") });
    expect(s.tabs).toHaveLength(2);
    expect(s.active).toBe(RULE);
    expect(activeTab(s)?.content).toBe("a");
  });

  it("activates only open tabs", () => {
    const s = tabsReducer(EMPTY_TABS, { type: "open", tab: tab(RULE) });
    expect(tabsReducer(s, { type: "activate", path: DOCS })).toBe(s);
  });

  it("closing the active tab activates its right neighbour, else the left one, else none", () => {
    let s = tabsReducer(EMPTY_TABS, { type: "open", tab: tab(RULE) });
    s = tabsReducer(s, { type: "open", tab: tab(DOCS) });
    s = tabsReducer(s, { type: "open", tab: tab(CDT) });
    s = tabsReducer(s, { type: "activate", path: DOCS });
    s = tabsReducer(s, { type: "close", path: DOCS });
    expect(s.active).toBe(CDT);
    s = tabsReducer(s, { type: "close", path: CDT });
    expect(s.active).toBe(RULE);
    s = tabsReducer(s, { type: "close", path: RULE });
    expect(s).toEqual({ tabs: [], active: null });
    expect(tabsReducer(s, { type: "close", path: RULE })).toBe(s);
  });

  it("closing an inactive tab keeps the active one", () => {
    let s = tabsReducer(EMPTY_TABS, { type: "open", tab: tab(RULE) });
    s = tabsReducer(s, { type: "open", tab: tab(DOCS) });
    s = tabsReducer(s, { type: "close", path: RULE });
    expect(s.active).toBe(DOCS);
  });

  it("tracks dirty = buffer ≠ saved, and saved / rebase move the baseline", () => {
    let s = tabsReducer(EMPTY_TABS, { type: "open", tab: tab(RULE) });
    expect(dirtyTabs(s)).toHaveLength(0);
    s = tabsReducer(s, { type: "edit", path: RULE, content: "edited" });
    expect(isDirty(s.tabs[0])).toBe(true);
    s = tabsReducer(s, { type: "saved", path: RULE, blob: "b2" });
    expect(isDirty(s.tabs[0])).toBe(false);
    expect(s.tabs[0].blob).toBe("b2");
    s = tabsReducer(s, { type: "rebase", path: RULE, savedContent: "theirs", blob: "b3" });
    expect(s.tabs[0].content).toBe("edited");
    expect(isDirty(s.tabs[0])).toBe(true);
    expect(s.tabs[0].blob).toBe("b3");
    s = tabsReducer(s, { type: "reload", path: RULE, content: "head", blob: "b4" });
    expect(s.tabs[0].content).toBe("head");
    expect(isDirty(s.tabs[0])).toBe(false);
    expect(s.tabs[0].blob).toBe("b4");
    // edits to unknown paths are ignored
    expect(tabsReducer(s, { type: "edit", path: DOCS, content: "x" })).toBe(s);
    expect(tabsReducer(s, { type: "closeAll" })).toEqual(EMPTY_TABS);
  });
});

describe("newRuleTemplate", () => {
  it("carries the id and the required top-level keys", () => {
    const t = newRuleTemplate("CDISC-CG9999");
    expect(t).toContain('Id: "CDISC-CG9999"');
    for (const key of ["Core:", "Description:", "Scope:", "Check:", "Outcome:", "Standards:"]) {
      expect(t).toContain(key);
    }
  });
});
