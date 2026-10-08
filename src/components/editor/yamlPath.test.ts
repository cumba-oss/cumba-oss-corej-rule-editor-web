import { describe, expect, it } from "vitest";
import { cursorContext, topLevelBlocks, yamlPathAt } from "./yamlPath";

const RULE = [
  "Core:",
  '  Id: "CDISC-AD0002"',
  '  Status: "Published"',
  "Scope:",
  "  Domains:",
  "    Include:",
  '    - "ALL"',
  "Bindings:",
  '- name: "$x"',
  '  expression: "cross(\\"label\\")"',
  "Check:",
  "  expression: >-",
  '    not empty($x) and var_label("DATA") != $x',
  "Outcome:",
  '  Message: "m"',
  "  Output_Variables:",
  '  - "$x"',
  "Standards:",
  '- Organization: "CDISC"',
  "  Standards:",
  '  - Name: "ADaMIG"',
  '    Version: "1.0"',
  "",
].join("\n");

function at(marker: string, occurrence = 0): number {
  let idx = -1;
  for (let i = 0; i <= occurrence; i++) idx = RULE.indexOf(marker, idx + 1);
  if (idx < 0) throw new Error(`marker ${marker} not found`);
  return idx;
}

describe("cursorContext", () => {
  it("names a key being typed under its parents", () => {
    const pos = at("  Status:") + 2;
    expect(cursorContext(RULE, pos)).toMatchObject({ kind: "key", path: ["Core"] });
    expect(yamlPathAt(RULE, at("    Include:") + 4)).toEqual(["Scope", "Domains"]);
  });

  it("steps into list items with the [] segment", () => {
    expect(cursorContext(RULE, at('    Version: "1.0"') + 4)).toMatchObject({
      kind: "key",
      path: ["Standards", "[]", "Standards", "[]"],
    });
    expect(cursorContext(RULE, at('  - Name: "ADaMIG"') + 12)).toMatchObject({
      kind: "value",
      key: "Name",
      path: ["Standards", "[]", "Standards", "[]"],
    });
    expect(cursorContext(RULE, at('  expression: "cross') + 16)).toMatchObject({
      kind: "value",
      key: "expression",
      path: ["Bindings", "[]"],
    });
  });

  it("recognises the value of a block scalar on its continuation lines", () => {
    const pos = at("not empty($x)") + 5;
    expect(cursorContext(RULE, pos)).toMatchObject({
      kind: "value",
      key: "expression",
      path: ["Check"],
      blockScalar: true,
    });
    // the chomping and indentation indicators come in either order (YAML 1.2 §8.1.1)
    for (const header of [">2-", "|-2", "|+", ">1 # note"]) {
      const doc = `Check:\n  expression: ${header}\n    not empty(X)`;
      expect(cursorContext(doc, doc.length), header).toMatchObject({
        kind: "value",
        key: "expression",
        blockScalar: true,
      });
    }
  });

  it("treats a blank line at an indent as a key position there", () => {
    const doc = "Scope:\n  Domains:\n    \n";
    expect(cursorContext(doc, doc.length - 1)).toMatchObject({
      kind: "key",
      path: ["Scope", "Domains"],
    });
    expect(cursorContext("Scope:\n  Dom", 12)).toMatchObject({ kind: "key", path: ["Scope"] });
    expect(cursorContext("Scope:\n", 7)).toMatchObject({ kind: "key", path: [] });
  });

  it("treats a deeper bare line under an inline value as its continuation", () => {
    const doc = 'Description: "a long\n  sentence"';
    expect(cursorContext(doc, doc.length - 3)).toMatchObject({
      kind: "value",
      key: "Description",
      path: [],
    });
  });

  it("handles a bare list item and comments", () => {
    const doc = "Scope:\n  Domains:\n    Include:\n    # c\n    - ";
    expect(cursorContext(doc, doc.length)).toMatchObject({
      kind: "key",
      path: ["Scope", "Domains", "Include", "[]"],
    });
  });
});

describe("topLevelBlocks", () => {
  it("spans each top-level key to its last non-blank line", () => {
    const blocks = topLevelBlocks("A:\n  x: 1\n\nB: 2\n# c\nC:\n  - y\n\n");
    expect(blocks.map((b) => b.key)).toEqual(["A", "B", "C"]);
    expect(blocks[0]).toMatchObject({ from: 0, keyLineEnd: 2, to: 9 });
    expect(blocks[1]).toMatchObject({ from: 11, to: 15 });
    expect(blocks[2]).toMatchObject({ from: 20, to: 28 });
  });
});
