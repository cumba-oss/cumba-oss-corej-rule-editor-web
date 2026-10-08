import { describe, expect, it } from "vitest";
import { displayType, renderMarkdownLine, renderSummary } from "./functionDocs";

describe("displayType", () => {
  it("shows UNKNOWN as any and every other type unchanged", () => {
    expect(displayType("UNKNOWN")).toBe("any");
    expect(displayType("unknown")).toBe("any");
    expect(displayType("STRING")).toBe("STRING");
    expect(displayType("boolean")).toBe("boolean");
    expect(displayType(undefined)).toBe("");
    expect(displayType(null)).toBe("");
  });
});

describe("renderSummary", () => {
  it("shows the first sentence and toggles the full summary behind more…", () => {
    const dom = renderSummary("Is `x` empty. It is **not** *is_missing*.");
    const text = dom.firstElementChild!;
    expect(text.textContent).toBe("Is x empty.");
    expect(text.querySelector("code")?.style.fontFamily).toContain("monospace");
    const more = dom.querySelector("button")!;
    expect(more.textContent).toBe("more…");
    expect(more.getAttribute("aria-expanded")).toBe("false");
    // mousedown keeps the editor's focus
    const down = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    more.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);

    more.click();
    expect(text.textContent).toBe("Is x empty. It is not is_missing.");
    expect(text.querySelector("strong")?.textContent).toBe("not");
    expect(text.querySelector("em")?.textContent).toBe("is_missing");
    expect(more.textContent).toBe("less");
    expect(more.getAttribute("aria-expanded")).toBe("true");

    more.click();
    expect(text.textContent).toBe("Is x empty.");
    expect(more.textContent).toBe("more…");
  });

  it("has no toggle for a one-sentence summary", () => {
    const dom = renderSummary("Whether the value is missing.");
    expect(dom.textContent).toBe("Whether the value is missing.");
    expect(dom.querySelector("button")).toBeNull();
  });

  it("renders a markdown line as DOM, markup as text", () => {
    const line = renderMarkdownLine("x: any — <b>the</b> `value`");
    expect(line.querySelector("b")).toBeNull();
    expect(line.querySelector("code")?.textContent).toBe("value");
    expect(line.textContent).toBe("x: any — <b>the</b> value");
  });
});
