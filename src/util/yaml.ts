import { parse, stringify } from "yaml";

/**
 * Serialize a rule object to YAML text for the editor.
 *
 * Preserves key insertion order (so the YAML mirrors the JSON the API sent)
 * and disables line wrapping (`lineWidth: 0`) so long expressions / regexes
 * stay on a single line rather than folded across multiple lines.
 */
export function stringifyYaml(value: unknown): string {
  return stringify(value, { indent: 2, lineWidth: 0 });
}

/** A parsed-YAML outcome: the value, or a syntax-error message. */
export type ParseYamlResult =
  { value: unknown; error?: undefined } | { value?: undefined; error: string };

/**
 * Parse YAML text to a JS value, returning a discriminated result rather than
 * throwing — so the editor can mark a syntax error inline without a try/catch
 * at every call site.
 */
export function parseYaml(text: string): ParseYamlResult {
  try {
    return { value: parse(text) };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}
