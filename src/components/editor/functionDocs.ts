import { appendInline, firstSentence } from "../../util/inlineMarkdown";

/**
 * A registry type as the editor shows it: the engine's `UNKNOWN` (a parameter accepting any value)
 * reads as `any`; every other type is shown as the catalogue names it. Display mapping only.
 */
export function displayType(type: string | undefined | null): string {
  if (!type) return "";
  return type.toUpperCase() === "UNKNOWN" ? "any" : type;
}

/** Inline style of the `<code>` spans the inline renderer emits. */
function styleCode(root: HTMLElement): void {
  for (const code of Array.from(root.querySelectorAll("code"))) {
    code.style.fontFamily = "var(--mantine-font-family-monospace)";
    code.style.fontSize = "0.92em";
  }
}

/** A block of `text` rendered as inline markdown (DOM nodes only, never HTML). */
export function renderMarkdownLine(text: string): HTMLElement {
  const div = document.createElement("div");
  appendInline(div, text);
  styleCode(div);
  return div;
}

/**
 * A function summary: its first sentence, rendered, and — when there is more — a "more…" toggle
 * button that swaps in the full summary (and back with "less"). The toggle keeps the editor's
 * focus (mousedown is prevented), so neither the hover tooltip nor the completion list closes.
 */
export function renderSummary(summary: string): HTMLElement {
  const { first, rest } = firstSentence(summary);
  const dom = document.createElement("div");
  dom.className = "rule-doc-summary";
  const text = document.createElement("span");
  dom.appendChild(text);
  const show = (expanded: boolean) => {
    text.replaceChildren();
    appendInline(text, expanded ? summary.trim() : first);
    styleCode(text);
  };
  show(false);
  if (!rest) return dom;

  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "rule-doc-more";
  toggle.textContent = "more…";
  toggle.setAttribute("aria-expanded", "false");
  Object.assign(toggle.style, {
    marginLeft: "0.5em",
    padding: "0",
    border: "none",
    background: "none",
    color: "var(--mantine-color-anchor)",
    cursor: "pointer",
    font: "inherit",
    textDecoration: "underline",
  });
  toggle.addEventListener("mousedown", (e) => e.preventDefault());
  toggle.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    const expanded = toggle.getAttribute("aria-expanded") !== "true";
    show(expanded);
    toggle.textContent = expanded ? "less" : "more…";
    toggle.setAttribute("aria-expanded", String(expanded));
  });
  dom.appendChild(toggle);
  return dom;
}
