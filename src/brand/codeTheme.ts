import { EditorView } from "@codemirror/view";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import type { Extension } from "@codemirror/state";
import { tags as t } from "@lezer/highlight";

/**
 * The CodeMirror theme built from the brand's code tokens (`--brand-code-*`, both schemes carried by
 * the tokens themselves). Built once per scheme at module level: @uiw/react-codemirror reconfigures
 * the editor whenever the extension's identity changes, so a per-render object would reset the
 * editor on every render. The two differ only in CodeMirror's `dark` flag (its own base styles key
 * on it); the colours are the same `var()` references, which flip with the scheme in CSS.
 */
const highlight = HighlightStyle.define([
  {
    tag: [t.propertyName, t.definition(t.propertyName), t.attributeName],
    color: "var(--brand-code-key)",
  },
  { tag: [t.string, t.special(t.string)], color: "var(--brand-code-string)" },
  { tag: [t.number, t.integer, t.float], color: "var(--brand-code-number)" },
  { tag: [t.bool, t.null, t.keyword, t.atom], color: "var(--brand-code-keyword)" },
  {
    tag: [t.comment, t.lineComment, t.blockComment],
    color: "var(--brand-code-comment)",
    fontStyle: "italic",
  },
]);

function build(dark: boolean): Extension {
  return [
    EditorView.theme(
      {
        "&": { backgroundColor: "var(--brand-code-bg)", color: "var(--brand-code-fg)" },
        ".cm-content": { caretColor: "var(--brand-code-fg)" },
        ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--brand-code-fg)" },
        "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection":
          { backgroundColor: "var(--brand-code-selection)" },
        ".cm-activeLine": {
          backgroundColor: "color-mix(in srgb, var(--brand-code-fg) 6%, transparent)",
        },
        ".cm-gutters": {
          backgroundColor: "var(--brand-code-gutter)",
          color: "var(--brand-code-comment)",
          borderRight: "1px solid var(--brand-border)",
        },
        ".cm-activeLineGutter": { backgroundColor: "transparent" },
        ".cm-foldPlaceholder": {
          backgroundColor: "var(--brand-surface-hover)",
          border: "1px solid var(--brand-border)",
          color: "var(--brand-code-fg)",
        },
        ".cm-tooltip": {
          backgroundColor: "var(--brand-surface)",
          border: "1px solid var(--brand-border)",
          color: "var(--brand-text)",
        },
      },
      { dark },
    ),
    syntaxHighlighting(highlight),
  ];
}

export const codeThemeLight: Extension = build(false);
export const codeThemeDark: Extension = build(true);

/** The theme extension for the computed colour scheme (stable identity per scheme). */
export function codeTheme(scheme: "light" | "dark"): Extension {
  return scheme === "dark" ? codeThemeDark : codeThemeLight;
}
