import { foldService } from "@codemirror/language";
import type { Extension } from "@codemirror/state";

/** The offset of the bracket closing the one at `open` in `text`, or -1 (strings are skipped). */
export function matchingBracket(text: string, open: number): number {
  const opener = text[open];
  const closer = opener === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (c === "\\") i++;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === opener) depth++;
    else if (c === closer && --depth === 0) return i;
  }
  return -1;
}

/**
 * Folding for the read-only JSON tab (§5.7) without a JSON language mode: a line whose last
 * bracket opens an object or array folds to the line of its closing bracket.
 */
export function jsonFolding(): Extension {
  return foldService.of((state, lineStart, lineEnd) => {
    const text = state.doc.toString();
    const line = text.slice(lineStart, lineEnd);
    const last = Math.max(line.lastIndexOf("{"), line.lastIndexOf("["));
    if (last < 0) return null;
    const close = matchingBracket(text, lineStart + last);
    if (close < 0) return null;
    const closeLine = state.doc.lineAt(close);
    if (closeLine.from <= lineStart) return null;
    return { from: lineStart + last + 1, to: closeLine.from + closeLine.text.search(/\S/) };
  });
}
