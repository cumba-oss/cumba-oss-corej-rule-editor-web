import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// The pre-paint script is served as is from public/; the test runs its text in jsdom.
const SCRIPT = readFileSync(resolve(__dirname, "../../public/theme-init.js"), "utf8");

function run(): string | null {
  document.documentElement.removeAttribute("data-mantine-color-scheme");
  new Function(SCRIPT)();
  return document.documentElement.getAttribute("data-mantine-color-scheme");
}

function os(prefersDark: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: prefersDark && query.includes("dark"),
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
}

describe("public/theme-init.js", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    window.localStorage.clear();
  });

  it.each([
    ["light", false, "light"],
    ["light", true, "light"],
    ["dark", false, "dark"],
    ["dark", true, "dark"],
    ["auto", false, "light"],
    ["auto", true, "dark"],
    ["garbage", true, "dark"],
    [null, false, "light"],
    [null, true, "dark"],
  ] as const)("stored %s, OS dark=%s ⇒ %s", (stored, prefersDark, expected) => {
    os(prefersDark);
    if (stored !== null) window.localStorage.setItem("cumba-theme", stored);
    expect(run()).toBe(expected);
  });

  it("falls back to the OS preference when storage throws", () => {
    os(true);
    const broken = {
      getItem: () => {
        throw new Error("storage disabled");
      },
    };
    vi.stubGlobal("localStorage", broken);
    expect(run()).toBe("dark");
  });

  it("falls back to light when matchMedia throws too", () => {
    vi.stubGlobal("matchMedia", () => {
      throw new Error("no matchMedia");
    });
    expect(run()).toBe("light");
  });
});
