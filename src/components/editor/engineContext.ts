import type {
  AnalysisT,
  CodelistLookupT,
  FunctionInfoT,
  RelatedRuleT,
  VariableT,
} from "../../api/types";
import type { JsonSchema } from "../../engine/schemaWalk";

/**
 * What the rule editor's completion and tooltips read (PLAN-rule-editor §5.4): the branch's
 * schema (`null` when it carries none — then no key completion), the function catalogue, the
 * buffer's latest analysis (possibly stale), the related rules and a codelist lookup.
 */
export interface EngineContext {
  schema: JsonSchema | null;
  functions: FunctionInfoT[];
  analysis: AnalysisT | null;
  related: RelatedRuleT[] | null;
  lookupCodelist: (id: string) => Promise<CodelistLookupT | null>;
}

export const EMPTY_CONTEXT: EngineContext = {
  schema: null,
  functions: [],
  analysis: null,
  related: null,
  lookupCodelist: () => Promise.resolve(null),
};

/** Keys whose value is an expression of the rule language. */
export const EXPRESSION_KEYS = new Set(["expression", "Filter", "Precondition", "Condition"]);

/** The variables of the analysis' scope universe. */
export function variablesOf(analysis: AnalysisT | null): VariableT[] {
  return analysis?.scope?.variables ?? [];
}

/** Find a variable by name, case-insensitively (the names ruling); `DM.RFSTDTC` looks up `RFSTDTC`. */
export function findVariable(analysis: AnalysisT | null, name: string): VariableT | undefined {
  const bare = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1) : name;
  const upper = bare.toUpperCase();
  return variablesOf(analysis).find((v) => (v.name ?? "").toUpperCase() === upper);
}

/** One line describing a variable: label · type · core · role. */
export function describeVariable(v: VariableT): string {
  return [v.label, v.type, v.core, v.role].filter(Boolean).join(" · ");
}
