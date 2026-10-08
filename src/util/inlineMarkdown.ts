/**
 * A small inline-markdown subset for the rule guide's function docs: `code`, **bold** / __bold__,
 * *italic* / _italic_. It builds DOM nodes whose text goes through `textContent` /
 * `createTextNode` only — never `innerHTML` — because the guide text comes from the repository.
 * Anything it does not recognise (an unmatched delimiter, an intraword `_`) stays literal text.
 */

/** Abbreviations whose trailing `.` never ends a sentence. */
const ABBREVIATIONS = /(?:^|[\s(])(?:e\.g|i\.e|etc|vs|cf|approx|incl|resp)$/i;

/** The index just past a backtick code span opening at `i` (a run of n backticks), or -1. */
function codeSpanEnd(text: string, i: number): number {
  let n = 0;
  while (text[i + n] === "`") n++;
  let j = i + n;
  while (j < text.length) {
    const k = text.indexOf("`".repeat(n), j);
    if (k < 0) return -1;
    let run = 0;
    while (text[k + run] === "`") run++;
    if (run === n) return k + n;
    j = k + run;
  }
  return -1;
}

/**
 * Split `text` after its first sentence: a `.`, `!` or `?` (plus any closing `*`, `_`, `)`,
 * quotes) followed by whitespace and then not by a lowercase letter. Code spans (`"."`, `x.y`),
 * decimals and the abbreviations e.g. / i.e. / etc. never split; a blank line always does.
 * Returns `rest` empty when the text is one sentence.
 */
export function firstSentence(text: string): { first: string; rest: string } {
  const trimmed = text.trim();
  let i = 0;
  while (i < trimmed.length) {
    const c = trimmed[i];
    if (c === "`") {
      const end = codeSpanEnd(trimmed, i);
      if (end > 0) {
        i = end;
        continue;
      }
    } else if (c === "\n" && /^\n[ \t]*\n/.test(trimmed.slice(i))) {
      return { first: trimmed.slice(0, i).trim(), rest: trimmed.slice(i).trim() };
    } else if (c === "." || c === "!" || c === "?") {
      let end = i + 1;
      while (end < trimmed.length && /[*_)"'\]]/.test(trimmed[end])) end++;
      const after = trimmed.slice(end);
      const ws = /^\s+/.exec(after);
      const abbreviation = c === "." && ABBREVIATIONS.test(trimmed.slice(0, i));
      if (ws && !abbreviation && !/^[a-z]/.test(after.slice(ws[0].length))) {
        return { first: trimmed.slice(0, end), rest: after.trim() };
      }
    }
    i++;
  }
  return { first: trimmed, rest: "" };
}

const isSpace = (c: string | undefined) => c === undefined || /\s/.test(c);
const isWordChar = (c: string | undefined) => c !== undefined && /[\p{L}\p{N}]/u.test(c);

/** Whether `delim` at `i` may open an emphasis (left-flanking; `_` never intraword). */
function canOpen(text: string, i: number, delim: string): boolean {
  if (isSpace(text[i + delim.length])) return false;
  return delim[0] !== "_" || !isWordChar(text[i - 1]);
}

/** Whether `delim` at `j` may close an emphasis (right-flanking; `_` never intraword). */
function canClose(text: string, j: number, delim: string): boolean {
  if (isSpace(text[j - 1])) return false;
  if (delim[0] === "_" && isWordChar(text[j + delim.length])) return false;
  // a single delimiter is not one half of a double run
  if (delim.length === 1 && (text[j + 1] === delim || text[j - 1] === delim)) return false;
  return true;
}

/** The index of the closer of `delim` opened at `from`, skipping code spans, or -1. */
function findCloser(text: string, from: number, delim: string): number {
  let j = from;
  while (j < text.length) {
    if (text[j] === "`") {
      const end = codeSpanEnd(text, j);
      if (end > 0) {
        j = end;
        continue;
      }
    }
    if (text.startsWith(delim, j) && j > from && canClose(text, j, delim)) return j;
    j++;
  }
  return -1;
}

/** Append `text`, rendered, to `parent` (an element or fragment); returns `parent`. */
export function appendInline<T extends Node>(parent: T, text: string): T {
  const doc = parent.ownerDocument ?? document;
  let plain = "";
  const flush = () => {
    if (plain) parent.appendChild(doc.createTextNode(plain));
    plain = "";
  };
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === "`") {
      const end = codeSpanEnd(text, i);
      if (end > 0) {
        let n = 0;
        while (text[i + n] === "`") n++;
        let body = text.slice(i + n, end - n);
        if (body.length > 2 && body.startsWith(" ") && body.endsWith(" ")) body = body.slice(1, -1);
        flush();
        const code = doc.createElement("code");
        code.textContent = body;
        parent.appendChild(code);
        i = end;
        continue;
      }
      // an unmatched run stays literal as a whole
      while (text[i] === "`") plain += text[i++];
      continue;
    }
    if (c === "*" || c === "_") {
      const delim = text[i + 1] === c ? c + c : c;
      if (canOpen(text, i, delim)) {
        const close = findCloser(text, i + delim.length, delim);
        if (close > 0) {
          flush();
          const el = doc.createElement(delim.length === 2 ? "strong" : "em");
          appendInline(el, text.slice(i + delim.length, close));
          parent.appendChild(el);
          i = close + delim.length;
          continue;
        }
      }
      plain += delim;
      i += delim.length;
      continue;
    }
    plain += c;
    i++;
  }
  flush();
  return parent;
}

/** `text` rendered as a fragment of text, `<code>`, `<strong>` and `<em>` nodes. */
export function renderInline(text: string, doc: Document = document): DocumentFragment {
  return appendInline(doc.createDocumentFragment(), text);
}
