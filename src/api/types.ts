import type { components } from "./schema";

/**
 * Friendly aliases over the generated OpenAPI component schemas. The `T` suffix avoids clashing
 * with value identifiers and signals "type". These are the only API DTO names the rest of the
 * app should reference — the raw `components["schemas"][...]` indirection stays in this file.
 */
type Schemas = components["schemas"];

export type ServiceInfoT = Schemas["ServiceInfo"];
export type RepositoryInfoT = Schemas["RepositoryInfo"];
export type SessionInfoT = Schemas["SessionInfo"];
export type CsrfInfoT = Schemas["CsrfInfo"];
export type StatusT = Schemas["Status"];
export type ChangedFileT = Schemas["ChangedFile"];
export type UnpushedInfoT = Schemas["UnpushedInfo"];
export type CommitInfoT = Schemas["CommitInfo"];
export type BranchesT = Schemas["Branches"];
export type BranchInfoT = Schemas["BranchInfo"];
export type UpdatedT = Schemas["Updated"];
export type CommittedT = Schemas["Committed"];
export type DiscardedT = Schemas["Discarded"];
export type PushedT = Schemas["Pushed"];
export type DirectoryT = Schemas["Directory"];
export type TreeEntryT = Schemas["TreeEntry"];
export type FileContentT = Schemas["FileContent"];
export type WrittenT = Schemas["Written"];
export type ExplorerTreeT = Schemas["ExplorerTree"];
export type FamilyT = Schemas["Family"];
export type RuleT = Schemas["Rule"];
export type SearchT = Schemas["Search"];
export type HitT = Schemas["Hit"];

/** The session's mode: the server enforces it, the UI only hides what a mode may not do. */
export type AccessModeT = NonNullable<SessionInfoT["mode"]>;

// ---- the engine (phase 3) -----------------------------------------------------------------

export type EngineInfoT = Schemas["EngineInfo"];
export type AnalysedT = Schemas["Analysed"];
export type AnalysisT = Schemas["Analysis"];
export type DiagnosticT = Schemas["Diagnostic"];
export type RangeT = Schemas["Range"];
export type DerivedT = Schemas["Derived"];
export type OutputVariablesT = Schemas["OutputVariables"];
export type ScopeT = Schemas["Scope"];
export type ScopeDatasetT = Schemas["ScopeDataset"];
export type VariableT = Schemas["Variable"];
export type VariableRefT = Schemas["VariableRef"];
export type FunctionsT = Schemas["Functions"];
export type FunctionInfoT = Schemas["FunctionInfo"];
export type FunctionParameterT = Schemas["FunctionParameter"];
export type CodelistLookupT = Schemas["CodelistLookup"];
export type CodelistHitT = Schemas["CodelistHit"];
export type CodelistTermT = Schemas["CodelistTerm"];
export type ScenariosT = Schemas["Scenarios"];
export type SuiteT = Schemas["Suite"];
export type ScenarioT = Schemas["Scenario"];
export type RelatedT = Schemas["Related"];
export type RelatedRuleT = Schemas["RelatedRule"];
export type ParsedT = Schemas["Parsed"];
export type DatasetT = Schemas["Dataset"];
export type ColumnT = Schemas["Column"];
export type DirectiveT = Schemas["Directive"];
export type CdtTextT = Schemas["CdtText"];
export type RunResultT = Schemas["RunResult"];
export type RunReportT = Schemas["RunReport"];
export type FindingT = Schemas["Finding"];
export type ResultT = Schemas["Result"];
export type ExpectationsT = Schemas["Expectations"];
