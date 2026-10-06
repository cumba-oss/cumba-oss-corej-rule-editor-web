import { describe, expect, it } from "vitest";
import { markersOf, offsetOf, rangeOf } from "./diagnostics";

const TEXT = 'Core:\n  Id: "X"\nScope:\n  Domains:\n    Include:\n    - "AE"\n';

describe("diagnostics", () => {
  it("maps 1-based line / column to offsets, clamped", () => {
    expect(offsetOf(TEXT, 1, 1)).toBe(0);
    expect(offsetOf(TEXT, 2, 3)).toBe(8);
    expect(offsetOf(TEXT, 2, 99)).toBe(15); // end of line 2
    expect(offsetOf(TEXT, 99, 1)).toBe(TEXT.length);
  });

  it("uses the engine's inclusive range when given, else the YAML path", () => {
    expect(
      rangeOf(TEXT, { range: { startLine: 2, startColumn: 7, endLine: 2, endColumn: 9 } }),
    ).toEqual([12, 15]);
    expect(rangeOf(TEXT, { path: "/Scope/Domains/Include/0" })).toEqual([53, 57]);
    expect(rangeOf(TEXT, { path: "/Nope" })).toBeNull();
    expect(rangeOf(TEXT, {})).toBeNull();
  });

  it("builds markers for one document only, skipping unplaceable diagnostics", () => {
    const markers = markersOf(
      TEXT,
      [
        { code: "LOAD_ERROR", severity: "ERROR", message: "bad", path: "/Core/Id" },
        { code: "X", severity: "WARNING", message: "warn", document: "CHECK", range: undefined },
        { code: "D", severity: "INFO", message: "docs", document: "DOCS", path: "/Core" },
        {
          code: "E",
          severity: "ERROR",
          message: "ranged",
          document: "CHECK",
          range: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 4 },
        },
      ],
      "CHECK",
    );
    expect(markers).toEqual([
      { from: 12, to: 15, severity: "error", message: "bad (LOAD_ERROR)" },
      { from: 0, to: 4, severity: "error", message: "ranged (E)" },
    ]);
    expect(
      markersOf(
        TEXT,
        [{ severity: "INFO", message: "d", document: "DOCS", path: "/Core" }],
        "DOCS",
      ),
    ).toEqual([{ from: 8, to: 16, severity: "info", message: "d" }]);
  });
});
