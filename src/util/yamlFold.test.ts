import { describe, expect, it } from "vitest";
import { topLevelKeyRange } from "./yamlFold";

const YAML = [
  "Authorities:",
  "  - Organization: CDISC",
  "    Standards: []",
  "Core:",
  "  Id: X",
].join("\n");

describe("topLevelKeyRange", () => {
  it("spans from the end of the key line to the end of its block", () => {
    const range = topLevelKeyRange(YAML, "Authorities");
    expect(range).not.toBeNull();
    const [from, to] = range!;
    // `from` is right after "Authorities:"
    expect(YAML.slice(0, from)).toBe("Authorities:");
    // folded text covers the two indented lines, stopping before "Core:"
    expect(YAML.slice(from, to)).toContain("Organization: CDISC");
    expect(YAML.slice(from, to)).not.toContain("Core:");
  });

  it("returns null for an absent key", () => {
    expect(topLevelKeyRange(YAML, "Nope")).toBeNull();
  });

  it("returns null when the key has no indented body", () => {
    expect(topLevelKeyRange("Authorities: []\nCore:\n  Id: X", "Authorities")).toBeNull();
  });
});
