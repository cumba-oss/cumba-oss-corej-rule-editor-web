import { http, HttpResponse, type HttpHandler } from "msw";
import type {
  AnalysisT,
  ColumnT,
  DatasetT,
  DiagnosticT,
  DirectiveT,
  EngineInfoT,
  FunctionInfoT,
  ParsedT,
  RelatedRuleT,
  RunReportT,
  ScenarioT,
  ScopeDatasetT,
  SuiteT,
  VariableT,
} from "../api/types";
import { datasetText } from "../engine/cdt";
import type { JsonSchema } from "../engine/schemaWalk";

interface Files {
  files: Map<string, { content: string; blob: string }>;
  problem(status: number, code: string, detail: string, extra?: Record<string, unknown>): Response;
}

/** The small schema the fake branch carries (a cut of `rule-check.schema.json`). */
export const FAKE_SCHEMA: JsonSchema = {
  type: "object",
  required: ["Core", "Check"],
  properties: {
    Core: {
      type: "object",
      required: ["Id"],
      properties: {
        Id: { type: "string", description: "The rule's identifier, e.g. CDISC-CG0006" },
        Status: { type: "string", description: "The publication status" },
      },
      description: "The rule's identity block",
    },
    Description: { type: ["string", "null"], description: "One sentence describing the violation" },
    Severity: { description: "Rule severity", enum: ["Reject", "Error", "Warning", "Info"] },
    Executability: {
      anyOf: [{ enum: ["Fully Executable", "Not Executable"] }, { type: "null" }],
      description: "How far the rule can be executed",
    },
    Scope: {
      type: ["object", "null"],
      description: "Which datasets the rule is ABOUT",
      properties: {
        Domains: { $ref: "#/$defs/axis", description: "The domain axis" },
        Classes: { $ref: "#/$defs/axis", description: "The class axis" },
      },
    },
    Check: { $ref: "#/$defs/check", description: "The condition that fires a finding" },
    Outcome: {
      type: "object",
      properties: {
        Message: { type: ["string", "null"], description: "The finding's text" },
        Output_Variables: { type: ["array", "null"], items: { type: "string" } },
      },
    },
    Bindings: { type: ["array", "null"], items: { $ref: "#/$defs/binding" } },
    Standards: { type: "array", items: { type: "object", properties: { Organization: {} } } },
  },
  $defs: {
    axis: {
      type: ["object", "null"],
      properties: { Include: { type: "array" }, Exclude: { type: "array" } },
    },
    check: {
      type: "object",
      properties: { expression: { type: "string", description: "The check expression" } },
    },
    binding: { type: "object", properties: { name: {}, expression: { type: "string" } } },
  },
};

export const FAKE_FUNCTIONS: FunctionInfoT[] = [
  {
    name: "empty",
    kind: "BOOLEAN",
    signature: "empty(value)",
    parameters: [
      { name: "value", type: "ANY", required: true, collector: false, description: "the value" },
    ],
    returnType: "boolean",
    summary: "Whether the value is missing.",
    sections: {},
  },
  {
    name: "var_label",
    kind: "VALUE",
    signature: "var_label(name, source?)",
    parameters: [
      { name: "name", type: "STRING", required: true, collector: false },
      { name: "source", type: "STRING", required: false, collector: false },
    ],
    returnType: "string",
    summary: "The label of a variable.",
    sections: {},
  },
  { name: "count", kind: "VALUE", signature: "count(...values)", parameters: [], sections: {} },
];

const SCOPE_DATASETS: ScopeDatasetT[] = [
  { product: "sdtmig-3-3", name: "AE", datasetClass: "EVENTS", inScope: true },
  { product: "sdtmig-3-3", name: "CM", datasetClass: "INTERVENTIONS", inScope: true },
  {
    product: "sdtmig-3-3",
    name: "DM",
    datasetClass: "SPECIAL PURPOSE",
    inScope: false,
    mismatch: "not in Domains.Include",
  },
];

const SCOPE_VARIABLES: VariableT[] = [
  {
    name: "USUBJID",
    label: "Unique Subject Identifier",
    type: "text",
    core: "Req",
    role: "Identifier",
    codelists: [],
    datasets: ["AE", "CM"],
    products: ["sdtmig-3-3"],
    classLevel: false,
    concrete: [],
  },
  {
    name: "AESEQ",
    label: "Sequence Number",
    type: "integer",
    core: "Req",
    role: "Identifier",
    codelists: [],
    datasets: ["AE"],
    products: ["sdtmig-3-3"],
    classLevel: false,
    concrete: [],
  },
  {
    name: "AETERM",
    label: "Reported Term for the Adverse Event",
    type: "text",
    core: "Req",
    role: "Topic",
    codelists: [],
    datasets: ["AE"],
    products: ["sdtmig-3-3"],
    classLevel: false,
    concrete: [],
  },
  {
    name: "AEDECOD",
    label: "Dictionary-Derived Term",
    type: "text",
    core: "Req",
    role: "Synonym Qualifier",
    codelists: ["C66767"],
    datasets: ["AE"],
    products: ["sdtmig-3-3"],
    classLevel: false,
    concrete: [],
  },
  {
    name: "--TERM",
    label: "Reported Term",
    type: "text",
    core: "Req",
    role: "Topic",
    codelists: [],
    datasets: ["EVENTS", "INTERVENTIONS"],
    products: ["sdtmig-3-3"],
    classLevel: true,
    concrete: ["AETERM", "CMTERM"],
  },
];

const RELATED: Record<string, RelatedRuleT[]> = {
  "CDISC-CG0270": [
    {
      coreId: "FDA-SD1142",
      relation: "SHARED_REFERENCE",
      via: "CG0270",
      family: "FDA",
      path: "rules-src/checks/FDA/FDA-SD1142.yaml",
      exists: true,
    },
    {
      coreId: "PMDA-SD1142",
      relation: "EQUIVALENT",
      via: "EQ-7",
      family: "PMDA",
      path: "rules-src/checks/PMDA/PMDA-SD1142.yaml",
      exists: false,
    },
  ],
};

/** The data the fake engine reports for `C66767` (the AE dictionary codelist, cut down). */
const CODELISTS: Record<string, { name: string; terms: [string, string][] }> = {
  C66767: {
    name: "Action Taken with Study Treatment",
    terms: [
      ["DOSE INCREASED", "Dose Increased"],
      ["DOSE NOT CHANGED", "Dose Not Changed"],
    ],
  },
};

const KNOWN_TYPES = new Set([
  "char",
  "num",
  "date",
  "datetime",
  "time",
  "int",
  "float",
  "integer",
  "text",
]);

/**
 * The engine half of the rest app as the SPA's tests see it: analysis shaped from the buffer
 * (a `BAD` token is an error at its range, `DOCBAD` in the docs buffer a DOCS diagnostic,
 * `Not Executable` parks the rule), fixed catalogues, a scenario suite read from the workspace
 * files, a `.cdt` parser / splicer in the server's field encoding, and a run whose verdict
 * follows the scenario's `expect=` (a rule containing `NOFIND` reports no finding).
 */
export class FakeEngine {
  info: EngineInfoT = {
    version: "0.1.0-SNAPSHOT",
    languageLevel: 1,
    storeAvailable: true,
    storeFormat: 5,
    storeReason: "",
    runTimeoutSeconds: 60,
    maxBufferBytes: 1_048_576,
  };
  /** The branch's `rules-src/LANGUAGE-LEVEL`; `null` when it declares none. */
  branchLanguageLevel: number | null = 1;
  schemaAvailable = true;
  analyses: { path: string; content: string; docs?: string }[] = [];
  runs: {
    path: string;
    content: string;
    docs?: string;
    scenarioPath: string;
    scenarioContent: string;
  }[] = [];
  splices: DatasetT[] = [];
  nextAnalyseProblem: { status: number; code: string } | null = null;
  nextRunProblem: { status: number; code: string } | null = null;
  /** When set, the next run waits for this promise before answering (to test "one at a time"). */
  holdRun: Promise<void> | null = null;
  /** The next run's report override. */
  nextReport: Partial<RunReportT> | null = null;

  constructor(private readonly workspace: Files) {}

  reset(): void {
    this.info = {
      ...this.info,
      languageLevel: 1,
      storeAvailable: true,
      storeFormat: 5,
      storeReason: "",
    };
    this.branchLanguageLevel = 1;
    this.schemaAvailable = true;
    this.analyses = [];
    this.runs = [];
    this.splices = [];
    this.nextAnalyseProblem = null;
    this.nextRunProblem = null;
    this.holdRun = null;
    this.nextReport = null;
  }

  analyse(content: string, docs?: string): AnalysisT {
    const lines = content.split("\n");
    const idMatch = /Id:\s*"([^"]+)"/.exec(content);
    const coreId = idMatch ? idMatch[1] : "<unknown>";
    const diagnostics: DiagnosticT[] = [];
    const badLine = lines.findIndex((l) => l.includes("BAD"));
    if (badLine >= 0) {
      const col = lines[badLine].indexOf("BAD") + 1;
      diagnostics.push({
        code: "EXPRESSION_SYNTAX",
        severity: "ERROR",
        message: "unexpected token BAD",
        path: "/Check/expression",
        range: {
          startLine: badLine + 1,
          startColumn: col,
          endLine: badLine + 1,
          endColumn: col + 2,
        },
        document: "CHECK",
      });
    }
    if (content.includes("WARN")) {
      diagnostics.push({
        code: "STANDARDS_SHAPE",
        severity: "WARNING",
        message: "odd standards",
        path: "/Standards",
        document: "CHECK",
      });
    }
    if (docs?.includes("DOCBAD")) {
      diagnostics.push({
        code: "DOC_CORE_MISMATCH",
        severity: "ERROR",
        message: "docs name another rule",
        path: "/Core",
        range: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 4 },
        document: "DOCS",
      });
    }
    const parked = content.includes('"Not Executable"');
    const loaded = !parked && badLine < 0;
    const authored: string[] = [];
    const excluded: string[] = [];
    let inOutput = false;
    for (const l of lines) {
      if (/^\s+Output_Variables:/.test(l)) {
        inOutput = true;
        continue;
      }
      if (inOutput) {
        const m = /^\s+-\s*"?(!?[^"\s]+)"?/.exec(l);
        if (!m) {
          inOutput = false;
          continue;
        }
        if (m[1].startsWith("!")) excluded.push(m[1].slice(1));
        else authored.push(m[1]);
      }
    }
    const bindings = [...content.matchAll(/name:\s*"(\$\w+)"/g)].map((m) => m[1]);
    return {
      coreId,
      loaded,
      parked,
      diagnostics,
      derived: loaded
        ? {
            sensitivity: "Record",
            sensitivityConfidence: "HIGH",
            sensitivityRationale: "the Check reads row-level variables only",
            outputVariables: {
              effective: ["USUBJID", ...authored.filter((a) => !excluded.includes(a))],
              authored,
              excluded,
              derived: authored.length === 0,
            },
            authorities: [
              { Organization: "CDISC", Standards: [{ Name: "SDTMIG", Version: "3.3" }] },
            ],
            evaluationDomain: "AE",
            wildcardNames: content.includes("--TERM") ? ["--TERM"] : [],
          }
        : undefined,
      scope: this.info.storeAvailable
        ? {
            products: ["sdtmig-3-3"],
            missingProducts: [],
            datasets: SCOPE_DATASETS,
            variables: SCOPE_VARIABLES,
          }
        : {
            products: ["sdtmig-3-3"],
            missingProducts: ["sdtmig-3-3"],
            datasets: [],
            variables: [],
          },
      referencedVariables: [
        { name: "AETERM", where: "Check", quoted: false },
        { name: "USUBJID", where: "Outcome.Output_Variables", quoted: false },
      ],
      bindings,
      requiredVariables: ["USUBJID", "AESEQ", "--DTC"],
      storeAvailable: this.info.storeAvailable,
    };
  }

  suite(rule: string): SuiteT {
    const family = rule.slice(0, rule.indexOf("-")).toLowerCase();
    const dir = `src/test/resources/net/cumba/corej/core/ruletestsuites/${family}/${rule}`;
    const scenarios: ScenarioT[] = [];
    const otherFiles: string[] = [];
    for (const [path, f] of [...this.workspace.files.entries()].sort()) {
      if (!path.startsWith(`${dir}/`) || path.slice(dir.length + 1).includes("/")) continue;
      const name = path.slice(dir.length + 1);
      if (!name.endsWith(".cdt")) {
        otherFiles.push(name);
        continue;
      }
      scenarios.push(describe(name, path, f.content));
    }
    return { directory: dir, scenarios, otherFiles };
  }

  report(ruleContent: string, scenarioContent: string): RunReportT {
    const expectsViolation = /expect=violation/.test(scenarioContent);
    const finds = !ruleContent.includes("NOFIND");
    const findings = finds
      ? [
          {
            ruleId: "R",
            row: 1,
            usubjid: "01-701-1015",
            seq: "1",
            keys: { AESEQ: "1" },
            values: { AETERM: "HEADACHE" },
            level: "ERROR",
            unit: "record",
            groupKey: {},
            namedColumns: ["AETERM"],
            message: "Term is wrong",
          },
        ]
      : [];
    const pass = expectsViolation === finds;
    return {
      outcome: pass ? "PASS" : "FAIL",
      code: pass ? "OK" : "VERDICT",
      detail: pass
        ? "as expected"
        : expectsViolation
          ? "expected a violation, none reported"
          : "unexpected violation",
      scopeGate: { inScope: true },
      evaluation: {
        violated: finds,
        executed: true,
        errored: false,
        totalCount: findings.length,
        truncated: false,
      },
      verdict: { pass, detail: pass ? "executed, violated as expected" : "verdict mismatch" },
      locations: { pass: true, detail: "1 of 1 expectations met" },
      results: [
        {
          ruleId: "R",
          status: "VIOLATED",
          violationCount: findings.length,
          totalViolationCount: findings.length,
          truncated: false,
          runtimeMillis: 3,
        },
      ],
      findings,
      reportJson: JSON.stringify({ version: "json-2", findings }, null, 2),
      expectations: {
        count: findings.length,
        ats: findings.length,
        lines: finds
          ? ["#expectViolationCount 1", "#expectViolationAt AETERM=HEADACHE"]
          : ["#expectViolationCount 0"],
      },
      ruleDiagnostics: [],
      durationMs: 12,
      worker: "inline",
      ...(this.nextReport ?? {}),
    };
  }

  handlers(): HttpHandler[] {
    const ws = this.workspace;
    return [
      http.post("/api/analyse", async ({ request }) => {
        const body = (await request.json()) as { path: string; content: string; docs?: string };
        this.analyses.push(body);
        if (this.nextAnalyseProblem) {
          const p = this.nextAnalyseProblem;
          this.nextAnalyseProblem = null;
          return ws.problem(p.status, p.code, p.code);
        }
        return HttpResponse.json({
          branch: "feature/x",
          head: "aaaa111",
          analysis: this.analyse(body.content, body.docs),
        });
      }),
      http.get("/api/engine/functions", () => HttpResponse.json({ functions: FAKE_FUNCTIONS })),
      http.get("/api/engine/schema", () =>
        this.schemaAvailable
          ? HttpResponse.json(FAKE_SCHEMA)
          : ws.problem(404, "NO_SCHEMA", "the branch carries no rule-check.schema.json"),
      ),
      http.get("/api/engine/ct", ({ request }) => {
        const query = new URL(request.url).searchParams.get("codelist") ?? "";
        const c = this.info.storeAvailable ? CODELISTS[query.toUpperCase()] : undefined;
        return HttpResponse.json({
          query,
          hits: c
            ? [
                {
                  ctPackage: "sdtmct-2024-03-29",
                  conceptId: query.toUpperCase(),
                  submissionValue: "ACN",
                  name: c.name,
                  extensible: true,
                  termCount: c.terms.length,
                  terms: c.terms.map(([submissionValue, preferredTerm]) => ({
                    conceptId: "C0",
                    submissionValue,
                    preferredTerm,
                  })),
                },
              ]
            : [],
        });
      }),
      http.get("/api/scenarios", ({ request }) => {
        const rule = new URL(request.url).searchParams.get("rule") ?? "";
        return HttpResponse.json({
          branch: "feature/x",
          head: "aaaa111",
          rule,
          family: rule.slice(0, rule.indexOf("-")),
          suite: this.suite(rule),
        });
      }),
      http.get("/api/related", ({ request }) => {
        const rule = new URL(request.url).searchParams.get("rule") ?? "";
        return HttpResponse.json({
          branch: "feature/x",
          head: "aaaa111",
          rule,
          related: RELATED[rule] ?? [],
        });
      }),
      http.post("/api/cdt/parse", async ({ request }) => {
        const body = (await request.json()) as { content: string };
        return HttpResponse.json(parseCdt(body.content));
      }),
      http.post("/api/cdt/splice", async ({ request }) => {
        const body = (await request.json()) as { content: string; dataset: DatasetT };
        this.splices.push(body.dataset);
        const refused = spliceCheck(body.dataset);
        if (refused) return ws.problem(400, "CDT_UNREPRESENTABLE", refused);
        const spliced = spliceCdt(body.content, body.dataset);
        if (spliced === null)
          return ws.problem(
            400,
            "CDT_UNREPRESENTABLE",
            `no dataset ${body.dataset.name} in the document`,
          );
        return HttpResponse.json({ content: spliced });
      }),
      http.post("/api/cdt/expectations", async ({ request }) => {
        const body = (await request.json()) as { content: string; lines: string[] };
        for (const l of body.lines) {
          if (!l.trim().startsWith("#expectViolation"))
            return ws.problem(400, "BAD_REQUEST", `not an expectation line: ${l}`);
        }
        return HttpResponse.json({ content: withExpectations(body.content, body.lines) });
      }),
      http.post("/api/run", async ({ request }) => {
        const body = (await request.json()) as (typeof this.runs)[number];
        this.runs.push(body);
        if (this.nextRunProblem) {
          const p = this.nextRunProblem;
          this.nextRunProblem = null;
          return ws.problem(
            p.status,
            p.code,
            p.code === "RUN_BUSY" ? "another run is in progress" : p.code,
          );
        }
        if (this.holdRun) await this.holdRun;
        const report = this.report(body.content, body.scenarioContent);
        this.nextReport = null;
        return HttpResponse.json({ branch: "feature/x", head: "aaaa111", report });
      }),
    ];
  }
}

/** The prelude facts of a scenario (the catalogue's `describe`). */
export function describe(name: string, path: string, text: string): ScenarioT {
  const test = /^#test\s+(\S+)(.*)$/m.exec(text);
  let expect: string | undefined;
  let domain: string | undefined;
  if (test) {
    for (const m of test[2].matchAll(/(\w+)=("[^"]*"|\S+)/g)) {
      const v = m[2].replace(/^"|"$/g, "");
      if (m[1] === "expect") expect = v;
      if (m[1] === "domain") domain = v;
    }
  }
  const count = /^#expectViolationCount\s+(\d+)/m.exec(text);
  return {
    name,
    path,
    coreId: test?.[1],
    expect,
    domain,
    expectViolationCount: count ? Number(count[1]) : undefined,
    expectViolationAtCount: (text.match(/^#expectViolationAt\b/gm) ?? []).length,
    datasets: [...text.matchAll(/^dataset\s+(\S+)/gm)].map((m) => m[1]),
    sidecars: /#library-include|#define-xml|#define-include/.test(text),
    size: text.length,
  };
}

function parseAttrs(rest: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const m of rest.matchAll(/(\w+)=("[^"]*"|\S+)/g)) attrs[m[1]] = m[2].replace(/^"|"$/g, "");
  return attrs;
}

/** A `.cdt` reader good enough for the tests: directives, dataset / col lines, fences, rows. */
export function parseCdt(text: string): ParsedT {
  const lines = text.split(/\r?\n/);
  const directives: DirectiveT[] = [];
  const datasets: DatasetT[] = [];
  let current: DatasetT | null = null;
  let inRows = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const t = line.trim();
    if (!current && t.startsWith("#") && t.length > 1 && t[1] !== " " && t[1] !== "!") {
      const sp = t.indexOf(" ");
      directives.push({ line: i + 1, name: sp < 0 ? t.slice(1) : t.slice(1, sp), text: t });
      continue;
    }
    if (t.startsWith("dataset ")) {
      const rest = t.slice(8).trim();
      const sp = rest.indexOf(" ");
      const name = sp < 0 ? rest : rest.slice(0, sp);
      const attrs = sp < 0 ? {} : parseAttrs(rest.slice(sp));
      const { label, ...others } = attrs;
      current = { name, label, attrs: others, fence: "---", columns: [], rows: [] };
      datasets.push(current);
      inRows = false;
      continue;
    }
    if (!current) continue;
    if (t.startsWith("col ")) {
      const rest = t.slice(4).trim();
      const sp = rest.indexOf(" ");
      const name = sp < 0 ? rest : rest.slice(0, sp);
      const { type, label, length, format, codelist, ...others } =
        sp < 0 ? {} : parseAttrs(rest.slice(sp));
      if (!type)
        return { datasets: [], directives, error: `document:${i + 1}: column ${name} has no type` };
      current.columns!.push({
        name,
        type,
        label,
        length: length ? Number(length) : undefined,
        format,
        codelist,
        attrs: others,
      });
      continue;
    }
    if (/^-{3,}$/.test(t)) {
      if (inRows) {
        inRows = false;
        current = null;
      } else {
        current.fence = t;
        inRows = true;
      }
      continue;
    }
    if (inRows && t) {
      const cells = line.split("|").map((c) => c.trim());
      if (cells.length !== current.columns!.length) {
        return {
          datasets: [],
          directives,
          error: `document:${i + 1}: expected ${current.columns!.length} fields, got ${cells.length}`,
        };
      }
      current.rows!.push(cells);
    }
  }
  return { datasets, directives };
}

/** What the engine's `CdtDocument` refuses: an unknown type, a cell the parser cannot read back. */
export function spliceCheck(d: DatasetT): string | null {
  for (const c of d.columns ?? []) {
    if (!KNOWN_TYPES.has((c.type ?? "").toLowerCase()))
      return `column ${c.name}: unknown type '${c.type}'`;
  }
  for (const row of d.rows ?? []) {
    for (const cell of row)
      if (cell.includes("|"))
        return `cell '${cell}' cannot be written so that the parser reads it back`;
  }
  return null;
}

/** Replace the first block named `d.name` (case-insensitive) with the grid's content. */
export function spliceCdt(text: string, d: DatasetT): string | null {
  const nl = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) =>
    new RegExp(`^dataset\\s+${d.name}(\\s|$)`, "i").test(l.trim()),
  );
  if (start < 0) return null;
  let fences = 0;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^-{3,}$/.test(lines[i].trim())) fences++;
    if (fences === 2) {
      end = i + 1;
      break;
    }
  }
  const block = datasetText(d).split("\n");
  return [...lines.slice(0, start), ...block, ...lines.slice(end)].join(nl);
}

/** The server's `CdtService.withExpectations`: replace the `#expectViolation*` lines in place. */
export function withExpectations(text: string, lines: string[]): string {
  const nl = text.includes("\r\n") ? "\r\n" : "\n";
  const kept = text.split(/\r?\n/).filter((l) => !l.trim().startsWith("#expectViolation"));
  let at = kept.findIndex((l) => /^#library\b|^dataset\b/.test(l.trim()));
  if (at < 0) at = kept.length;
  kept.splice(at, 0, ...lines.map((l) => l.trim()));
  return kept.join(nl);
}

export type { ColumnT };
