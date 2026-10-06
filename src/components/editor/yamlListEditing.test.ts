import { describe, expect, it } from "vitest";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { continueList, enclosingSeqIndent, removeMarkerDedent } from "./yamlListEditing";

function withView(doc: string, head: number, fn: (v: EditorView) => void): void {
  const v = new EditorView({
    parent: document.body,
    state: EditorState.create({ doc, selection: EditorSelection.cursor(head) }),
  });
  try {
    fn(v);
  } finally {
    v.destroy();
  }
}

describe("continueList", () => {
  it("inserts a new dash item at the same indent on Enter", () => {
    withView("  - first", 9, (v) => {
      expect(continueList(v)).toBe(true);
      expect(v.state.doc.toString()).toBe("  - first\n  - ");
    });
  });

  it("does nothing on a non-list line", () => {
    withView("Core:", 5, (v) => expect(continueList(v)).toBe(false));
  });
});

describe("removeMarkerDedent", () => {
  it("dedents an empty marker back to the parent level", () => {
    withView("Keys:\n  - ", 10, (v) => {
      expect(removeMarkerDedent(v)).toBe(true);
      expect(v.state.doc.toString()).toBe("Keys:\n");
    });
  });

  it("ignores a marker that has content", () => {
    withView("  - x", 5, (v) => expect(removeMarkerDedent(v)).toBe(false));
  });
});

describe("enclosingSeqIndent", () => {
  it("matches a preceding list item's indent", () => {
    expect(enclosingSeqIndent("Keys:\n  - a\n", 3)).toBe(2);
  });

  it("uses key indent + 2 for an empty-valued key", () => {
    expect(enclosingSeqIndent("Keys:\n", 2)).toBe(2);
  });

  it("returns null with no sequence context", () => {
    expect(enclosingSeqIndent("Description: hi\n", 2)).toBeNull();
  });
});
