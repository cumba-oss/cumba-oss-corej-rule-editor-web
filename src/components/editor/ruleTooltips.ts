import { hoverTooltip, type Tooltip } from "@codemirror/view";
import type { Extension } from "@codemirror/state";
import type { CodelistHitT, ScopeDatasetT } from "../../api/types";
import { descriptionAt, ITEM } from "../../engine/schemaWalk";
import { parseYaml } from "../../util/yaml";
import { describeVariable, findVariable, type EngineContext } from "./engineContext";
import { cursorContext } from "./yamlPath";

/** What a tooltip shows: a title line and body lines (monospace for signatures / expressions). */
export interface TooltipContent {
  title: string;
  lines: string[];
  mono?: boolean;
}

/** A tooltip at a token range — ready, or loaded on demand (codelists come from the server). */
export interface TooltipSpec {
  from: number;
  to: number;
  content: TooltipContent | null;
  load?: () => Promise<TooltipContent | null>;
}

const TOKEN = /\$[A-Za-z_]\w*|&[A-Z][A-Z0-9]*&|--[A-Z][A-Z0-9_]*|[A-Za-z_][\w.-]*/g;
const CODELIST = /^C\d{4,}$/i;

/** The token of `line` covering column `col` (`[from, to)` relative to the line). */
export function tokenAt(
  line: string,
  col: number,
): { text: string; from: number; to: number } | null {
  TOKEN.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TOKEN.exec(line))) {
    if (m.index <= col && col <= m.index + m[0].length) {
      return { text: m[0], from: m.index, to: m.index + m[0].length };
    }
    if (m.index > col) break;
  }
  return null;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

/** The authored `Bindings[].expression` of `$name`, from the buffer. */
export function bindingExpression(doc: string, name: string): string | null {
  const parsed = asRecord(parseYaml(doc).value);
  const bindings = parsed?.Bindings;
  if (!Array.isArray(bindings)) return null;
  for (const b of bindings) {
    const r = asRecord(b);
    if (r && r.name === name) return typeof r.expression === "string" ? r.expression : null;
  }
  return null;
}

/** The authored `Expansion[]` entry of `&NAME&`, from the buffer. */
export function expansionOf(doc: string, token: string): Record<string, unknown> | null {
  const parsed = asRecord(parseYaml(doc).value);
  const expansion = parsed?.Expansion;
  if (!Array.isArray(expansion)) return null;
  for (const e of expansion) {
    const r = asRecord(e);
    if (r && r.token === token) return r;
  }
  return null;
}

function datasetLine(d: ScopeDatasetT): string {
  return `${d.name}${d.datasetClass ? ` (${d.datasetClass})` : ""} — ${d.product}`;
}

/** The in-scope datasets a Scope value (a domain, class, dataset name or ALL) resolves to. */
export function resolveScopeValue(ctx: EngineContext, value: string): ScopeDatasetT[] {
  const upper = value.toUpperCase();
  const inScope = (ctx.analysis?.scope?.datasets ?? []).filter((d) => d.inScope);
  if (upper === "ALL") return inScope;
  return inScope.filter(
    (d) =>
      (d.name ?? "").toUpperCase() === upper ||
      (d.datasetClass ?? "").toUpperCase() === upper ||
      (d.dataStructure ?? "").toUpperCase() === upper,
  );
}

function codelistContent(id: string, lookup: CodelistHitT[]): TooltipContent | null {
  if (lookup.length === 0) return { title: id, lines: ["not in the metadata store's CT"] };
  const hit = lookup[0];
  const terms = (hit.terms ?? [])
    .slice(0, 12)
    .map((t) => `${t.submissionValue} — ${t.preferredTerm ?? ""}`);
  const more = (hit.termCount ?? 0) > terms.length ? [`… ${hit.termCount} terms`] : [];
  return {
    title: `${hit.conceptId} ${hit.submissionValue ?? ""} — ${hit.name ?? ""}`.trim(),
    lines: [
      `${hit.ctPackage}${hit.extensible ? " · extensible" : ""}`,
      ...(hit.definition ? [hit.definition] : []),
      ...terms,
      ...more,
    ],
  };
}

/**
 * The tooltip for the token under `pos`, per the table of PLAN-rule-editor §5.4: a key → its schema
 * description (Scope keys add the resolved datasets); a function → signature + summary; a variable
 * → the catalogue entry, `--X` → its concrete variables; a Scope value → the resolved datasets;
 * `&NAME&` → its expansion or "expanded per dataset at run time"; a C-code → the CT codelist (loaded);
 * `Core.Id` → the related rules; `$binding` → its expression.
 */
export function tooltipAt(doc: string, pos: number, ctx: EngineContext): TooltipSpec | null {
  const lineStart = doc.lastIndexOf("\n", pos - 1) + 1;
  const lineEndIdx = doc.indexOf("\n", pos);
  const line = doc.slice(lineStart, lineEndIdx < 0 ? doc.length : lineEndIdx);
  const token = tokenAt(line, pos - lineStart);
  if (!token) return null;
  const from = lineStart + token.from;
  const to = lineStart + token.to;
  const text = token.text;
  const cursor = cursorContext(doc, from);
  const spec = (content: TooltipContent | null): TooltipSpec | null =>
    content ? { from, to, content } : null;

  if (text.startsWith("$")) {
    const expression = bindingExpression(doc, text);
    if (expression) return spec({ title: `Binding ${text}`, lines: [expression], mono: true });
    const known = ctx.analysis?.bindings?.includes(text);
    return spec({
      title: `Binding ${text}`,
      lines: [known ? "declared" : "not declared in this buffer"],
    });
  }
  if (text.startsWith("&")) {
    const e = expansionOf(doc, text);
    const values = e?.values;
    if (Array.isArray(values) && values.length > 0) {
      return spec({ title: `Expansion ${text}`, lines: [`expands to: ${values.join(", ")}`] });
    }
    const over = e && typeof e.over === "string" ? ` (over ${e.over})` : "";
    return spec({ title: `Expansion ${text}`, lines: [`expanded per dataset at run time${over}`] });
  }

  // a key: the token sits before the colon of its line
  const afterToken = line.slice(token.to);
  const isKey = /^\s*:(\s|$)/.test(afterToken) && !/[^\s-]/.test(line.slice(0, token.from));
  if (isKey) {
    const path = [...cursor.path, text];
    const lines: string[] = [];
    const description = ctx.schema ? descriptionAt(ctx.schema, path) : null;
    if (description) lines.push(description);
    if (text === "Scope" || cursor.path[0] === "Scope") {
      const resolved = (ctx.analysis?.scope?.datasets ?? []).filter((d) => d.inScope);
      lines.push(
        resolved.length
          ? `In scope (${resolved.length}): ${resolved.map((d) => d.name).join(", ")}`
          : "In scope: nothing resolved (no analysis or no store)",
      );
    }
    return lines.length ? spec({ title: path.join("."), lines }) : null;
  }

  if (cursor.kind === "value" && cursor.key === "Id" && cursor.path.join("/") === "Core") {
    const related = ctx.related;
    if (!related) return spec({ title: text, lines: ["related rules: not loaded"] });
    return spec({
      title: `${text} — related rules`,
      lines: related.length
        ? related.map((r) => `${r.coreId} (${r.relation}${r.via ? ` via ${r.via}` : ""})`)
        : ["none"],
    });
  }
  const listItem = cursor.kind === "key" && cursor.path[cursor.path.length - 1] === ITEM;
  if (cursor.path[0] === "Scope" && (cursor.kind === "value" || listItem)) {
    const resolved = resolveScopeValue(ctx, text.replace(/^"|"$/g, ""));
    return spec({
      title: `${text} resolves to`,
      lines: resolved.length
        ? resolved.map(datasetLine)
        : ["no in-scope dataset (no analysis or no store)"],
    });
  }
  if (/^\s*\(/.test(afterToken)) {
    const f = ctx.functions.find((x) => x.name === text);
    if (!f) return null;
    const params = (f.parameters ?? [])
      .filter((p) => p.description)
      .map((p) => `${p.name}${p.required ? "" : "?"}: ${p.type} — ${p.description}`);
    return spec({
      title: f.signature ?? text,
      lines: [
        ...(f.summary ? [f.summary] : []),
        ...(f.returnType ? [`returns ${f.returnType}`] : []),
        ...params,
      ],
    });
  }
  if (CODELIST.test(text)) {
    return {
      from,
      to,
      content: null,
      load: async () => {
        const lookup = await ctx.lookupCodelist(text);
        return lookup
          ? codelistContent(text, lookup.hits ?? [])
          : { title: text, lines: ["CT lookup unavailable"] };
      },
    };
  }
  const v = findVariable(ctx.analysis, text);
  if (!v) return null;
  const lines = [describeVariable(v)];
  if (v.classLevel) {
    const concrete = v.concrete ?? [];
    lines.push(
      concrete.length ? `stands for: ${concrete.join(", ")}` : "stands for: nothing in scope",
    );
  }
  if (v.codelists?.length) lines.push(`codelists: ${v.codelists.join(", ")}`);
  if (v.datasets?.length) lines.push(`in: ${v.datasets.join(", ")}`);
  if (v.products?.length) lines.push(`versions: ${v.products.join(", ")}`);
  return spec({ title: v.name ?? text, lines });
}

/** Render a tooltip's content as DOM (the `cm-tooltip` element is CodeMirror's). */
export function renderTooltip(content: TooltipContent): HTMLElement {
  const dom = document.createElement("div");
  dom.className = "rule-tooltip";
  dom.style.maxWidth = "40em";
  dom.style.padding = "4px 8px";
  dom.style.whiteSpace = "pre-wrap";
  const title = document.createElement("div");
  title.style.fontWeight = "600";
  title.textContent = content.title;
  dom.appendChild(title);
  for (const line of content.lines) {
    const p = document.createElement("div");
    if (content.mono) p.style.fontFamily = "var(--mantine-font-family-monospace)";
    p.textContent = line;
    dom.appendChild(p);
  }
  return dom;
}

/** The hover-tooltip extension of the rule editor, reading its context lazily. */
export function ruleTooltips(getContext: () => EngineContext): Extension {
  return hoverTooltip(
    async (view, pos): Promise<Tooltip | null> => {
      const spec = tooltipAt(view.state.doc.toString(), pos, getContext());
      if (!spec) return null;
      const content = spec.content ?? (spec.load ? await spec.load() : null);
      if (!content) return null;
      return {
        pos: spec.from,
        end: spec.to,
        above: true,
        create: () => ({ dom: renderTooltip(content) }),
      };
    },
    { hoverTime: 300 },
  );
}
