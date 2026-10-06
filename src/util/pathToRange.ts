import { parseDocument } from "yaml";

/**
 * Resolve a diagnostic's JSON-pointer (e.g. `/Match_Datasets/0/Wlidcard`) to a character range
 * `[from, to]` in the YAML source, for inline marking. Returns `null` when the pointer is empty or
 * cannot be resolved against the current (possibly mid-edit) YAML.
 *
 * The rule is edited as YAML but validated as JSON; the `yaml` document AST exposes node character
 * ranges that line up with CodeMirror's offsets.
 */
export function pathToRange(
  yamlText: string,
  pointer: string | null | undefined,
): [number, number] | null {
  if (!pointer) return null;
  const segments = pointer
    .split("/")
    .slice(1)
    .map((s) => s.replace(/~1/g, "/").replace(/~0/g, "~"))
    .map((s) => (/^\d+$/.test(s) ? Number(s) : s));
  if (segments.length === 0) return null;
  try {
    const doc = parseDocument(yamlText);
    const node = doc.getIn(segments, true) as
      { range?: [number, number, number] | null } | undefined;
    const range = node?.range;
    if (!range) return null;
    // [start, valueEnd, nodeEnd] — use valueEnd so the marker hugs the value, not trailing whitespace
    return [range[0], range[1]];
  } catch {
    return null;
  }
}
