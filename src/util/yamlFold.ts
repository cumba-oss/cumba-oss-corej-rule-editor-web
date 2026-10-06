/**
 * Compute the character range to fold for a top-level YAML key (e.g. `Authorities`).
 *
 * Returns `[from, to]` where `from` is the end of the key's own line (so the `Key:` line stays
 * visible) and `to` is the end of the block — the line just before the next top-level (column-0)
 * key, or end of input. Returns `null` when the key is absent or its block is empty (nothing to
 * fold).
 *
 * Top-level keys are detected as lines that start at column 0 with `key:` (no leading whitespace).
 */
export function topLevelKeyRange(text: string, key: string): [number, number] | null {
  const lines = text.split("\n");
  // offset of the start of each line
  const starts: number[] = [];
  let acc = 0;
  for (const line of lines) {
    starts.push(acc);
    acc += line.length + 1; // + newline
  }

  const prefix = `${key}:`;
  let keyLine = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith(prefix)) {
      keyLine = i;
      break;
    }
  }
  if (keyLine < 0) return null;

  // block runs until the next column-0, non-empty line
  let end = lines.length;
  for (let i = keyLine + 1; i < lines.length; i++) {
    const l = lines[i];
    if (l.length > 0 && !/^\s/.test(l)) {
      end = i;
      break;
    }
  }
  if (end === keyLine + 1) return null; // no indented body to fold

  const from = starts[keyLine] + lines[keyLine].length;
  const lastBlockLine = end - 1;
  const to = starts[lastBlockLine] + lines[lastBlockLine].length;
  return from < to ? [from, to] : null;
}
