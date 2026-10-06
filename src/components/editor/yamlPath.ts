import { ITEM } from "../../engine/schemaWalk";

/**
 * Where the cursor is in a YAML document, by an indentation scan (good enough for the well-formed
 * block YAML the corpus writes; adapted from the retired monorepo editor's `yamlPathAt`):
 *
 * - `path` — the ancestor keys of the cursor's line, `[]` for a list item (`Standards`, `[]`,
 *   `Standards`, `[]` inside the second-level standards list);
 * - `kind` — `key` when the cursor types a mapping key, `value` when it is after `key:` (on that
 *   line or on a continuation line of a block scalar), with `key` naming it.
 */
export interface CursorContext {
  kind: "key" | "value";
  path: string[];
  /** The key whose value the cursor is in (`value` only). */
  key?: string;
  /** Whether the value is a block scalar (`>-`, `|`) continuation — an expression, usually. */
  blockScalar: boolean;
}

interface Frame {
  indent: number;
  segment: string;
  blockScalar: boolean;
  /** The key line carried a plain inline value (a deeper bare line continues it). */
  inlineValue: boolean;
}

const KEY = /^([A-Za-z_$][\w$.-]*|"[^"]*"|'[^']*')\s*:(?=\s|$)/;
const BLOCK_SCALAR = /^[|>][+-]?\d*\s*(?:#.*)?$/;

function indentOf(line: string): number {
  return /^\s*/.exec(line)![0].length;
}

function unquote(key: string): string {
  return key.length >= 2 && (key.startsWith('"') || key.startsWith("'")) ? key.slice(1, -1) : key;
}

/** Pop the frames a key line at `indent` closes (siblings and deeper). */
function popForKey(stack: Frame[], indent: number): void {
  while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
}

/** Pop the frames a `- ` item at `indent` closes: deeper frames and a sibling item. */
function popForItem(stack: Frame[], indent: number): void {
  while (stack.length && stack[stack.length - 1].indent > indent) stack.pop();
  const top = stack[stack.length - 1];
  if (top && top.segment === ITEM && top.indent === indent) stack.pop();
}

/**
 * Feed one full line into the stack. Returns the key the line declares (with its indent), if any.
 */
function pushLine(stack: Frame[], line: string): { key: string; indent: number } | null {
  if (!line.trim() || line.trim().startsWith("#")) return null;
  let indent = indentOf(line);
  let rest = line.slice(indent);
  if (rest === "-" || rest.startsWith("- ")) {
    popForItem(stack, indent);
    stack.push({ indent, segment: ITEM, blockScalar: false, inlineValue: false });
    const after = rest.slice(1);
    const extra = after.length - after.trimStart().length;
    indent += 1 + extra;
    rest = after.trimStart();
    if (!rest) return null;
  } else {
    popForKey(stack, indent);
  }
  const m = KEY.exec(rest);
  if (!m) return null;
  const key = unquote(m[1]);
  const value = rest.slice(m[0].length).trim();
  const blockScalar = BLOCK_SCALAR.test(value);
  stack.push({ indent, segment: key, blockScalar, inlineValue: value.length > 0 && !blockScalar });
  return { key, indent };
}

/** The ancestor path of the cursor's line (not counting the line itself). */
export function yamlPathAt(doc: string, pos: number): string[] {
  return cursorContext(doc, pos).path;
}

export function cursorContext(doc: string, pos: number): CursorContext {
  const before = doc.slice(0, pos);
  const lines = before.split("\n");
  const cur = lines[lines.length - 1];
  const lineStart = before.length - cur.length;
  const lineEnd = doc.indexOf("\n", lineStart);
  const fullLine = doc.slice(lineStart, lineEnd < 0 ? doc.length : lineEnd);
  const stack: Frame[] = [];
  for (let i = 0; i < lines.length - 1; i++) pushLine(stack, lines[i]);

  const path = () => stack.map((f) => f.segment);
  const trimmedCur = cur.trim();
  const curIndent = indentOf(fullLine);
  // a continuation line of a block scalar: deeper than the key that opened it, no key of its own
  const top = stack[stack.length - 1];
  if (top && top.blockScalar && curIndent > top.indent) {
    const key = stack.pop()!;
    return { kind: "value", path: path(), key: key.segment, blockScalar: true };
  }
  // a line that only indents so far: a key being typed at that indent
  if (!trimmedCur) {
    popForKey(stack, cur.length);
    return { kind: "key", path: path(), blockScalar: false };
  }
  let rest = cur.slice(curIndent);
  if (rest === "-" || rest.startsWith("- ")) {
    popForItem(stack, curIndent);
    stack.push({ indent: curIndent, segment: ITEM, blockScalar: false, inlineValue: false });
    rest = rest.slice(1).trimStart();
    if (!rest.trim()) return { kind: "key", path: path(), blockScalar: false };
  } else {
    popForKey(stack, curIndent);
  }
  const m = KEY.exec(rest);
  if (m) {
    return { kind: "value", path: path(), key: unquote(m[1]), blockScalar: false };
  }
  // a bare word: a key being typed, unless it continues the inline value of the key above it
  if (top && stack[stack.length - 1] === top && curIndent > top.indent && top.inlineValue) {
    const key = stack.pop()!;
    return { kind: "value", path: path(), key: key.segment, blockScalar: false };
  }
  return { kind: "key", path: path(), blockScalar: false };
}

/** The top-level blocks of a YAML document: key, line span and the character range of the block. */
export interface TopLevelBlock {
  key: string;
  /** Offset of the key's line start. */
  from: number;
  /** Offset of the end of the block's last non-blank line. */
  to: number;
  /** Offset of the end of the key's own line. */
  keyLineEnd: number;
}

export function topLevelBlocks(doc: string): TopLevelBlock[] {
  const lines = doc.split("\n");
  const starts: number[] = [];
  let acc = 0;
  for (const line of lines) {
    starts.push(acc);
    acc += line.length + 1;
  }
  const blocks: TopLevelBlock[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = KEY.exec(lines[i]);
    if (!m) continue;
    let last = i;
    for (let j = i + 1; j < lines.length; j++) {
      const l = lines[j];
      if (l.length > 0 && !/^\s/.test(l)) {
        if (l.startsWith("#")) continue; // a column-0 comment belongs to no block
        break;
      }
      if (l.trim()) last = j;
    }
    blocks.push({
      key: unquote(m[1]),
      from: starts[i],
      to: starts[last] + lines[last].length,
      keyLineEnd: starts[i] + lines[i].length,
    });
  }
  return blocks;
}
