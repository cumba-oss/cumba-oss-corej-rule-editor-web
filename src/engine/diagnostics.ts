import type { DiagnosticT } from "../api/types";
import type { EditorMarker } from "../components/CodeEditor";
import { pathToRange } from "../util/pathToRange";

/** The offset of a 1-based line / column in `text` (clamped to the document). */
export function offsetOf(text: string, line: number, column: number): number {
  let offset = 0;
  let current = 1;
  while (current < line) {
    const nl = text.indexOf("\n", offset);
    if (nl < 0) return text.length;
    offset = nl + 1;
    current++;
  }
  const lineEnd = text.indexOf("\n", offset);
  const end = lineEnd < 0 ? text.length : lineEnd;
  return Math.min(offset + Math.max(column - 1, 0), end);
}

function severityOf(d: DiagnosticT): EditorMarker["severity"] {
  switch ((d.severity ?? "").toUpperCase()) {
    case "ERROR":
      return "error";
    case "WARNING":
      return "warning";
    default:
      return "info";
  }
}

/**
 * The editor range of a diagnostic in `text`: the engine's 1-based inclusive range where it gave
 * one, else the YAML path resolved against the buffer (`pathToRange`), else `null`.
 */
export function rangeOf(text: string, d: DiagnosticT): [number, number] | null {
  const r = d.range;
  if (r && r.startLine && r.startColumn && r.endLine && r.endColumn) {
    const from = offsetOf(text, r.startLine, r.startColumn);
    // inclusive end column → exclusive offset
    const to = Math.max(offsetOf(text, r.endLine, r.endColumn + 1), from + 1);
    return [from, Math.min(to, text.length)];
  }
  return pathToRange(text, d.path);
}

/**
 * The lint markers of a buffer: the diagnostics of `document` (CHECK for the rule tab, DOCS for
 * the docs tab) that could be placed in `text`. Unplaceable ones are listed by the Problems tab
 * only.
 */
export function markersOf(
  text: string,
  diagnostics: DiagnosticT[],
  document: "CHECK" | "DOCS",
): EditorMarker[] {
  const markers: EditorMarker[] = [];
  for (const d of diagnostics) {
    if ((d.document ?? "CHECK") !== document) continue;
    const range = rangeOf(text, d);
    if (!range) continue;
    markers.push({
      from: range[0],
      to: range[1],
      severity: severityOf(d),
      message: `${d.message ?? ""}${d.code ? ` (${d.code})` : ""}`,
    });
  }
  return markers;
}
