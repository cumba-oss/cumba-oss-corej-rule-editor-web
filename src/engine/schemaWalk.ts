/**
 * A small walker over the branch's `rule-check.schema.json` (JSON Schema 2020-12 as the corpus
 * writes it: `properties`, `$ref` into `$defs`, `anyOf` / `oneOf` / `allOf`, `items`, `enum`) for
 * key completion, enum values and key tooltips (PLAN-rule-editor §5.4). It never validates — it
 * answers "what may sit here" for a YAML path such as `["Scope", "Domains"]` or
 * `["Standards", "[]", "Standards", "[]"]` (the `[]` segment steps into a list's items).
 */

export type JsonSchema = Record<string, unknown>;

/** The `[]` path segment: the cursor is inside an item of the list at the parent path. */
export const ITEM = "[]";

export interface SchemaKey {
  name: string;
  description: string | null;
  required: boolean;
}

function isObject(v: unknown): v is JsonSchema {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Follow a local `$ref` (`#/$defs/x`, `#/definitions/x`, `#/properties/x/…`). */
function deref(root: JsonSchema, node: JsonSchema, seen: Set<JsonSchema>): JsonSchema[] {
  if (seen.has(node)) return [];
  seen.add(node);
  const ref = node.$ref;
  if (typeof ref !== "string") return [node];
  if (!ref.startsWith("#/")) return [];
  let target: unknown = root;
  for (const seg of ref.slice(2).split("/")) {
    const key = seg.replace(/~1/g, "/").replace(/~0/g, "~");
    if (!isObject(target)) return [];
    target = target[key];
  }
  if (!isObject(target)) return [];
  const resolved = deref(root, target, seen);
  // a `$ref` sibling `description` describes the use, so it wins over the definition's
  return resolved.map((r) =>
    typeof node.description === "string" ? { ...r, description: node.description } : r,
  );
}

/**
 * Every concrete alternative a node may be: the node itself plus the branches of its
 * `anyOf` / `oneOf` / `allOf`, `$ref`s followed. Nulls and `not` are not alternatives.
 */
export function alternatives(root: JsonSchema, node: unknown): JsonSchema[] {
  if (!isObject(node)) return [];
  const out: JsonSchema[] = [];
  const visit = (n: JsonSchema, seen: Set<JsonSchema>) => {
    for (const r of deref(root, n, seen)) {
      out.push(r);
      for (const combinator of ["anyOf", "oneOf", "allOf"]) {
        const branches = r[combinator];
        if (Array.isArray(branches)) {
          for (const b of branches) if (isObject(b)) visit(b, seen);
        }
      }
    }
  };
  visit(node, new Set());
  return out;
}

/** The schema nodes at `path` from the root, `[]` stepping into `items`. */
export function nodesAt(root: JsonSchema, path: string[]): JsonSchema[] {
  let current: JsonSchema[] = alternatives(root, root);
  for (const seg of path) {
    const next: JsonSchema[] = [];
    for (const node of current) {
      if (seg === ITEM) {
        const items = node.items;
        if (isObject(items)) next.push(...alternatives(root, items));
        else if (Array.isArray(items)) {
          for (const i of items) next.push(...alternatives(root, i));
        }
        continue;
      }
      const props = node.properties;
      if (isObject(props) && isObject(props[seg])) next.push(...alternatives(root, props[seg]));
      else if (isObject(node.additionalProperties)) {
        next.push(...alternatives(root, node.additionalProperties));
      }
    }
    if (next.length === 0) return [];
    current = next;
  }
  return current;
}

/** The keys allowed at `path` (an object context), each with its description, de-duplicated. */
export function keysAt(root: JsonSchema, path: string[]): SchemaKey[] {
  const keys = new Map<string, SchemaKey>();
  for (const node of nodesAt(root, path)) {
    const props = node.properties;
    if (!isObject(props)) continue;
    const required = new Set(Array.isArray(node.required) ? (node.required as string[]) : []);
    for (const [name, def] of Object.entries(props)) {
      const description =
        isObject(def) && typeof def.description === "string" ? def.description : null;
      const existing = keys.get(name);
      if (!existing) {
        keys.set(name, { name, description, required: required.has(name) });
      } else if (!existing.description && description) {
        existing.description = description;
      }
    }
  }
  return [...keys.values()];
}

/** The `enum` / `const` values a scalar at `path` may take (strings only), de-duplicated. */
export function enumAt(root: JsonSchema, path: string[]): string[] {
  const values = new Set<string>();
  for (const node of nodesAt(root, path)) {
    const e = node.enum;
    if (Array.isArray(e)) for (const v of e) if (typeof v === "string") values.add(v);
    if (typeof node.const === "string") values.add(node.const);
  }
  return [...values];
}

/** The description of the key at `path` (the first alternative that carries one). */
export function descriptionAt(root: JsonSchema, path: string[]): string | null {
  for (const node of nodesAt(root, path)) {
    if (typeof node.description === "string" && node.description) return node.description;
  }
  return null;
}
