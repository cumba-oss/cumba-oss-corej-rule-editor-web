import {
  autocompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
  type CompletionSource,
} from "@codemirror/autocomplete";
import type { Extension } from "@codemirror/state";
import { enumAt, ITEM, keysAt } from "../../engine/schemaWalk";
import { EXPRESSION_KEYS, variablesOf, type EngineContext } from "./engineContext";
import { cursorContext } from "./yamlPath";

/**
 * The completion of PLAN-rule-editor §5.4: keys and enum values from the branch's schema at the
 * cursor's YAML path (no schema ⇒ no key completion), variables from the analysis' scope universe
 * (SDTM in `--` form, tagged with the datasets / products they occur in), functions with their
 * signature, `$binding` names from the buffer's own `Bindings`.
 */
export function ruleCompletionSource(getContext: () => EngineContext): CompletionSource {
  return (cm: CompletionContext): CompletionResult | null => {
    const engine = getContext();
    const word = cm.matchBefore(/[\w$&.-]*/);
    if (!word || (word.from === word.to && !cm.explicit)) return null;
    const ctx = cursorContext(cm.state.doc.toString(), word.from);

    // a scalar list item (`- "AE"` under Scope, `- "AETERM"` under Output_Variables) completes
    // like a value: enum values of the list's items, the Scope's datasets, variables
    const listItem = ctx.kind === "key" && ctx.path[ctx.path.length - 1] === ITEM;
    if (listItem) {
      const options: Completion[] = [];
      const quoted = word.from > 0 && cm.state.sliceDoc(word.from - 1, word.from) === '"';
      for (const value of engine.schema ? enumAt(engine.schema, ctx.path) : []) {
        options.push({ label: value, type: "enum", apply: quoted ? value : `"${value}"` });
      }
      if (ctx.path[0] === "Scope") {
        const names = new Set(
          (engine.analysis?.scope?.datasets ?? []).map((d) => d.name ?? "").filter(Boolean),
        );
        for (const name of names) options.push({ label: name, type: "constant", boost: 1 });
      }
      for (const v of variablesOf(engine.analysis)) {
        options.push({ label: v.name ?? "", type: v.classLevel ? "class" : "variable" });
      }
      return options.length ? { from: word.from, options, validFor: /^[\w$&.-]*$/ } : null;
    }
    if (ctx.kind === "key") {
      if (!engine.schema) return null;
      const keys = keysAt(engine.schema, ctx.path);
      if (keys.length === 0) return null;
      const options: Completion[] = keys.map((k) => ({
        label: k.name,
        type: "property",
        detail: k.required ? "required" : undefined,
        info: k.description ?? undefined,
        apply: `${k.name}: `,
      }));
      return { from: word.from, options, validFor: /^[\w-]*$/ };
    }

    const options: Completion[] = [];
    const key = ctx.key ?? "";
    const enums = engine.schema ? enumAt(engine.schema, [...ctx.path, key]) : [];
    const quoted = word.from > 0 && cm.state.sliceDoc(word.from - 1, word.from) === '"';
    for (const value of enums) {
      options.push({ label: value, type: "enum", apply: quoted ? value : `"${value}"` });
    }
    const expression = ctx.blockScalar || EXPRESSION_KEYS.has(key);
    for (const v of variablesOf(engine.analysis)) {
      const where = v.classLevel ? (v.concrete ?? []).join(", ") : (v.datasets ?? []).join(", ");
      options.push({
        label: v.name ?? "",
        type: v.classLevel ? "class" : "variable",
        detail: [v.type, where].filter(Boolean).join(" · "),
        info: [v.label, (v.products ?? []).join(", ")].filter(Boolean).join(" — ") || undefined,
        boost: v.classLevel ? 1 : 0,
      });
    }
    if (expression) {
      for (const name of engine.analysis?.bindings ?? []) {
        options.push({ label: name, type: "variable", detail: "binding", boost: 2 });
      }
      for (const f of engine.functions) {
        options.push({
          label: f.name ?? "",
          type: "function",
          detail: f.signature ?? undefined,
          info: f.summary ?? undefined,
          apply: `${f.name}(`,
        });
      }
    }
    if (options.length === 0) return null;
    return { from: word.from, options, validFor: /^[\w$&.-]*$/ };
  };
}

/** The autocompletion extension of the rule editor, reading its context lazily. */
export function ruleCompletion(getContext: () => EngineContext): Extension {
  return autocompletion({ override: [ruleCompletionSource(getContext)], activateOnTyping: true });
}
