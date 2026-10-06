import { EditorSelection, type Extension, Prec } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";

/**
 * Smart YAML list editing (Req 6):
 *  1. Enter on a list item inserts a new `- ` entry at the same indent.
 *  2. Backspace on an empty `- ` marker dedents back to the parent-key level (so a new field name
 *     can be typed) — the mirror of (1).
 *  3. Typing `-` at the start of a line snaps the line to the enclosing sequence's indent.
 */
export function yamlListExtensions(): Extension {
  return [
    Prec.highest(
      keymap.of([
        { key: "Enter", run: continueList },
        { key: "Backspace", run: removeMarkerDedent },
      ]),
    ),
    dashIndentHandler,
  ];
}

/** Enter on `<indent>- <content>` inserts `\n<indent>- `. (Exported for testing.) */
export function continueList(view: EditorView): boolean {
  const { state } = view;
  const sel = state.selection.main;
  if (!sel.empty) return false;
  const line = state.doc.lineAt(sel.head);
  const m = line.text.match(/^(\s*)-\s+\S/);
  if (!m || sel.head !== line.to) return false;
  view.dispatch(
    state.update(state.replaceSelection(`\n${m[1]}- `), {
      userEvent: "input",
      scrollIntoView: true,
    }),
  );
  return true;
}

/** Backspace on an empty `<indent>- ` marker removes it and dedents one level. (Exported for testing.) */
export function removeMarkerDedent(view: EditorView): boolean {
  const { state } = view;
  const sel = state.selection.main;
  if (!sel.empty) return false;
  const line = state.doc.lineAt(sel.head);
  const m = line.text.match(/^(\s*)-\s$/);
  if (!m || sel.head !== line.to) return false;
  const parent = m[1].length >= 2 ? m[1].slice(0, m[1].length - 2) : "";
  view.dispatch(
    state.update({
      changes: { from: line.from, to: line.to, insert: parent },
      selection: EditorSelection.cursor(line.from + parent.length),
      userEvent: "delete",
    }),
  );
  return true;
}

/** Typing `-` at line start snaps the line to the enclosing sequence indent. */
const dashIndentHandler = EditorView.inputHandler.of((view, from, to, text) => {
  if (text !== "-") return false;
  const line = view.state.doc.lineAt(from);
  if (view.state.doc.sliceString(line.from, from).trim() !== "") return false;
  const target = enclosingSeqIndent(view.state.doc.toString(), line.number);
  if (target === null) return false;
  const indent = " ".repeat(target);
  view.dispatch({
    changes: { from: line.from, to, insert: `${indent}- ` },
    selection: EditorSelection.cursor(line.from + indent.length + 2),
    userEvent: "input",
  });
  return true;
});

/**
 * The indent at which a new list item should sit, looking at the lines above `lineNumber`: the
 * indent of the nearest preceding list item, or (key with an empty value ⇒ a block list) the key's
 * indent + 2. Returns null when there is no enclosing sequence context.
 */
export function enclosingSeqIndent(doc: string, lineNumber: number): number | null {
  const lines = doc.split("\n");
  for (let n = lineNumber - 2; n >= 0; n--) {
    const text = lines[n];
    if (!text.trim() || text.trim().startsWith("#")) continue;
    const li = text.match(/^(\s*)-/);
    if (li) return li[1].length;
    const emptyKey = text.match(/^(\s*)[A-Za-z_][\w]*\s*:\s*$/);
    if (emptyKey) return emptyKey[1].length + 2;
    return null;
  }
  return null;
}
