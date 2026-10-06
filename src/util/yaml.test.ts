import { describe, expect, it } from "vitest";
import { parseYaml, stringifyYaml } from "./yaml";

describe("stringifyYaml", () => {
  it("serializes preserving key order and without line wrapping", () => {
    expect(stringifyYaml({ b: 1, a: "x" })).toBe("b: 1\na: x\n");
  });
});

describe("parseYaml", () => {
  it("parses valid YAML", () => {
    expect(parseYaml("a: 1\nb: two")).toEqual({ value: { a: 1, b: "two" } });
  });

  it("returns an error for malformed YAML", () => {
    const result = parseYaml("a: [1, 2");
    expect(result.value).toBeUndefined();
    expect(result.error).toBeTruthy();
  });

  it("treats empty input as a null value", () => {
    expect(parseYaml("")).toEqual({ value: null });
  });
});
