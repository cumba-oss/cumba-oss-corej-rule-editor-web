import { describe, expect, it } from "vitest";
import { pathToRange } from "./pathToRange";

const YAML = ["Description: hello", "Match_Datasets:", "  - Name: AE", "    Wildcard: xx"].join(
  "\n",
);

describe("pathToRange", () => {
  it("resolves a top-level scalar pointer to its range", () => {
    const range = pathToRange(YAML, "/Description");
    expect(range).not.toBeNull();
    const [from, to] = range!;
    expect(YAML.slice(from, to)).toBe("hello");
  });

  it("resolves a nested array pointer", () => {
    const range = pathToRange(YAML, "/Match_Datasets/0/Wildcard");
    expect(range).not.toBeNull();
    const [from, to] = range!;
    expect(YAML.slice(from, to)).toBe("xx");
  });

  it("returns null for an empty or unresolvable pointer", () => {
    expect(pathToRange(YAML, null)).toBeNull();
    expect(pathToRange(YAML, undefined)).toBeNull();
    expect(pathToRange(YAML, "/Nope/Missing")).toBeNull();
  });
});
