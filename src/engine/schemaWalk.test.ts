import { describe, expect, it } from "vitest";
import { descriptionAt, enumAt, keysAt, nodesAt, type JsonSchema } from "./schemaWalk";

/** A cut of the corpus's rule-check.schema.json shapes: $ref, anyOf, oneOf/allOf, items, enum. */
export const SCHEMA: JsonSchema = {
  type: "object",
  required: ["Core", "Check"],
  properties: {
    Core: {
      type: "object",
      required: ["Id"],
      properties: {
        Id: { type: "string", description: "The rule's identifier" },
        Status: { type: "string", description: "The publication status" },
      },
    },
    Severity: { description: "Rule severity", enum: ["Reject", "Error", "Warning", "Info"] },
    Executability: {
      anyOf: [{ enum: ["Fully Executable", "Not Executable"] }, { type: "null" }],
      description: "How far the rule can be executed",
    },
    Scope: {
      type: ["object", "null"],
      description: "Which datasets the rule is ABOUT",
      properties: {
        Domains: { description: "The domain axis", $ref: "#/$defs/axis" },
        Datasets: { $ref: "#/$defs/axis" },
      },
    },
    Check: { $ref: "#/$defs/checkOrLevels", description: "The condition that fires a finding" },
    Bindings: { type: ["array", "null"], items: { $ref: "#/$defs/binding" } },
    Standards: {
      type: "array",
      items: {
        type: "object",
        properties: {
          Organization: { type: "string" },
          Standards: {
            type: "array",
            items: { type: "object", properties: { Name: { type: "string" }, Version: {} } },
          },
        },
      },
    },
  },
  $defs: {
    axis: {
      type: ["object", "null"],
      description: "An Include / Exclude axis",
      properties: {
        Include: { type: ["array", "null"], items: { type: "string" } },
        Exclude: { type: ["array", "null"], items: { type: "string" } },
      },
    },
    checkOrLevels: { oneOf: [{ $ref: "#/$defs/levelMap" }, { $ref: "#/$defs/plainCheck" }] },
    plainCheck: { allOf: [{ $ref: "#/$defs/check" }, { not: { required: ["ERROR"] } }] },
    levelMap: {
      type: "object",
      properties: { ERROR: { $ref: "#/$defs/check" }, WARNING: { $ref: "#/$defs/check" } },
    },
    check: {
      type: "object",
      properties: {
        all: { type: "array", items: { $ref: "#/$defs/check" } },
        not: { $ref: "#/$defs/check" },
        expression: { type: "string", description: "The check in the rule expression language" },
      },
    },
    binding: {
      type: "object",
      required: ["expression"],
      properties: { name: { type: ["string", "null"] }, expression: { type: "string" } },
    },
  },
};

describe("schemaWalk", () => {
  it("lists the keys at the root and under a plain object, with descriptions and required", () => {
    const root = keysAt(SCHEMA, []);
    expect(root.map((k) => k.name)).toEqual([
      "Core",
      "Severity",
      "Executability",
      "Scope",
      "Check",
      "Bindings",
      "Standards",
    ]);
    expect(root.find((k) => k.name === "Core")).toMatchObject({ required: true });
    expect(keysAt(SCHEMA, ["Core"])).toEqual([
      { name: "Id", description: "The rule's identifier", required: true },
      { name: "Status", description: "The publication status", required: false },
    ]);
  });

  it("follows $ref, oneOf and allOf: the Check offers level keys and condition keys", () => {
    expect(keysAt(SCHEMA, ["Check"]).map((k) => k.name)).toEqual([
      "ERROR",
      "WARNING",
      "all",
      "not",
      "expression",
    ]);
    expect(keysAt(SCHEMA, ["Check", "ERROR", "not"]).map((k) => k.name)).toEqual([
      "all",
      "not",
      "expression",
    ]);
    // recursion through `all` items
    expect(keysAt(SCHEMA, ["Check", "all", "[]"]).map((k) => k.name)).toContain("expression");
  });

  it("steps into list items and nested lists", () => {
    expect(keysAt(SCHEMA, ["Bindings", "[]"]).map((k) => k.name)).toEqual(["name", "expression"]);
    expect(keysAt(SCHEMA, ["Standards", "[]", "Standards", "[]"]).map((k) => k.name)).toEqual([
      "Name",
      "Version",
    ]);
    expect(keysAt(SCHEMA, ["Nope"])).toEqual([]);
    expect(keysAt(SCHEMA, ["Core", "Id"])).toEqual([]);
    expect(nodesAt(SCHEMA, ["Bindings", "[]", "[]"])).toEqual([]);
  });

  it("answers enum values through anyOf and plain enum", () => {
    expect(enumAt(SCHEMA, ["Severity"])).toEqual(["Reject", "Error", "Warning", "Info"]);
    expect(enumAt(SCHEMA, ["Executability"])).toEqual(["Fully Executable", "Not Executable"]);
    expect(enumAt(SCHEMA, ["Core", "Id"])).toEqual([]);
  });

  it("describes a key, the $ref use winning over the definition", () => {
    expect(descriptionAt(SCHEMA, ["Scope", "Domains"])).toBe("The domain axis");
    expect(descriptionAt(SCHEMA, ["Scope", "Datasets"])).toBe("An Include / Exclude axis");
    expect(descriptionAt(SCHEMA, ["Check", "expression"])).toBe(
      "The check in the rule expression language",
    );
    expect(descriptionAt(SCHEMA, ["Standards", "[]", "Organization"])).toBeNull();
  });

  it("survives a cyclic or dangling $ref", () => {
    const cyclic: JsonSchema = {
      properties: { a: { $ref: "#/$defs/a" }, b: { $ref: "#/nope" }, c: { $ref: "http://x" } },
      $defs: { a: { $ref: "#/$defs/a" } },
    };
    expect(keysAt(cyclic, ["a"])).toEqual([]);
    expect(keysAt(cyclic, ["b"])).toEqual([]);
    expect(keysAt(cyclic, ["c"])).toEqual([]);
  });
});
