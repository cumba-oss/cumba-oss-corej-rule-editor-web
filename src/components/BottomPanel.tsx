import { useMemo, useState } from "react";
import {
  Anchor,
  Badge,
  Button,
  Group,
  Loader,
  ScrollArea,
  Stack,
  Table,
  Tabs,
  Text,
  Tooltip,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import type { DiagnosticT, RelatedRuleT, RunReportT, ScenarioT, SuiteT } from "../api/types";
import { type AnalysisEntry, type AnalysisStatus, type LastRun } from "../engine/useEngine";
import type { Tab } from "../state/tabs";
import { parseYaml } from "../util/yaml";
import { CodeEditor } from "./CodeEditor";

/** A cached server answer as the panel shows it (undefined = loading). */
export interface Loaded<T> {
  value: T | null;
  error: string | null;
}

interface Props {
  tab: Tab | undefined;
  /** The rule the panel describes: the active rule, or the rule of the active docs / scenario tab. */
  ruleId: string | null;
  suite: Loaded<SuiteT> | undefined;
  selectedScenario: string | null;
  onSelectScenario: (path: string) => void;
  onOpen: (path: string) => void;
  onNewScenario: (mode: "rule" | "clone", source?: ScenarioT) => void;
  lastRuns: Record<string, LastRun>;
  report: RunReportT | undefined;
  /** The scenario the report ran (the Results header names it). */
  reportScenario?: string;
  /** The report is the selected scenario's: only then may its expectations be taken. */
  reportCurrent?: boolean;
  runError: string | undefined;
  runBusy: boolean;
  canRun: boolean;
  onRun: () => void;
  /** Opens the "take actual as expected" diff (never writes by itself). */
  onTakeExpected: () => void;
  analysis: AnalysisEntry | undefined;
  analysisStatus: AnalysisStatus;
  onRetryAnalysis: () => void;
  /** Open / point into the document a diagnostic belongs to (a DOCS one opens the docs tab). */
  onGoToDiagnostic: (d: DiagnosticT) => void;
  related: Loaded<RelatedRuleT[]> | undefined;
}

/** The YAML syntax problem of a buffer, if any (beside the server's diagnostics). */
export function syntaxProblem(tab: Tab | undefined): string | null {
  if (!tab || (tab.kind !== "rule" && tab.kind !== "docs")) return null;
  const parsed = parseYaml(tab.content);
  return parsed.error ?? null;
}

function outcomeColor(outcome: string | undefined): string {
  if (outcome === "PASS") return "green";
  if (outcome === "FAIL") return "red";
  return "orange";
}

function fileName(path: string | undefined): string {
  return path ? path.slice(path.lastIndexOf("/") + 1) : "";
}

function mapText(m: Record<string, string> | undefined): string {
  return Object.entries(m ?? {})
    .map(([k, v]) => `${k}=${v}`)
    .join(" ");
}

/**
 * The bottom panel of PLAN-rule-editor §5.3: Scenarios (§5.6), Results and JSON (§5.7), Problems
 * (the analysis' diagnostics of check AND docs, plus a YAML syntax error), Related (§5.5).
 */
export function BottomPanel(props: Props) {
  const { tab, ruleId, suite, report, analysis, analysisStatus, related } = props;
  const [value, setValue] = useState<string | null>("scenarios");
  const problem = useMemo(() => syntaxProblem(tab), [tab]);
  const diagnostics = analysis?.analysis?.diagnostics ?? [];
  const problemCount = diagnostics.length + (problem ? 1 : 0);
  const analysable = !!tab && (tab.kind === "rule" || tab.kind === "docs");
  /** Diagnostics of an analysis that no longer describes the buffers (pending or failed). */
  const staleDiagnostics =
    analysable && (analysisStatus === "pending" || analysisStatus === "failed");
  const scenarios = suite?.value?.scenarios ?? null;

  return (
    <Tabs
      value={value}
      onChange={setValue}
      h="100%"
      style={{ display: "flex", flexDirection: "column" }}
    >
      <Tabs.List>
        <Tabs.Tab value="scenarios">Scenarios{scenarios ? ` (${scenarios.length})` : ""}</Tabs.Tab>
        <Tabs.Tab value="results">Results{report ? ` (${report.outcome})` : ""}</Tabs.Tab>
        <Tabs.Tab value="json" disabled={!report?.reportJson}>
          JSON
        </Tabs.Tab>
        <Tabs.Tab value="problems">Problems{problemCount ? ` (${problemCount})` : ""}</Tabs.Tab>
        <Tabs.Tab value="related">
          Related{related?.value ? ` (${related.value.length})` : ""}
        </Tabs.Tab>
      </Tabs.List>

      <Tabs.Panel value="scenarios" style={{ flex: 1, minHeight: 0 }}>
        <ScrollArea h="100%" type="auto" p="xs">
          <ScenariosTab {...props} />
        </ScrollArea>
      </Tabs.Panel>

      <Tabs.Panel value="results" style={{ flex: 1, minHeight: 0 }}>
        <ScrollArea h="100%" type="auto" p="xs">
          <ResultsTab {...props} />
        </ScrollArea>
      </Tabs.Panel>

      <Tabs.Panel
        value="json"
        style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}
      >
        {report?.reportJson && <JsonTab json={report.reportJson} ruleId={ruleId} />}
      </Tabs.Panel>

      <Tabs.Panel value="problems" style={{ flex: 1, minHeight: 0 }}>
        <ScrollArea h="100%" type="auto" p="xs">
          <Stack gap={4}>
            {!tab && (
              <Text size="sm" c="dimmed">
                Nothing open.
              </Text>
            )}
            {analysable && (
              <Text size="xs" c="dimmed">
                {analysisStatus === "none" && "Not analysed — open the rule to analyse it."}
                {analysisStatus === "pending" && "Analysing…"}
                {analysisStatus === "failed" && (
                  <>
                    Analysis failed: {analysis?.failed}{" "}
                    <Anchor
                      component="button"
                      type="button"
                      size="xs"
                      onClick={props.onRetryAnalysis}
                    >
                      retry
                    </Anchor>
                  </>
                )}
                {analysisStatus === "ok" &&
                  (analysis?.analysis?.parked
                    ? "Parked (Not Executable): no derivation."
                    : analysis?.analysis?.loaded
                      ? "Analysed."
                      : "The rule does not load.")}
              </Text>
            )}
            {problem && (
              <Text size="sm" c="red" style={{ whiteSpace: "pre-wrap" }}>
                YAML: {problem}
              </Text>
            )}
            {staleDiagnostics && diagnostics.length > 0 && (
              <Text size="xs" c="orange">
                From the last analysis — stale until the new one is in:
              </Text>
            )}
            {diagnostics.map((d, i) => (
              <Group
                key={i}
                gap="xs"
                wrap="nowrap"
                align="flex-start"
                style={staleDiagnostics ? { opacity: 0.55 } : undefined}
              >
                <Badge
                  size="xs"
                  variant="light"
                  color={
                    d.severity === "ERROR" ? "red" : d.severity === "WARNING" ? "orange" : "blue"
                  }
                >
                  {d.severity}
                </Badge>
                <Anchor
                  component="button"
                  type="button"
                  size="sm"
                  ta="left"
                  onClick={() => props.onGoToDiagnostic(d)}
                >
                  {d.document === "DOCS" ? "docs: " : ""}
                  {d.message} ({d.code})
                  {d.range ? ` — line ${d.range.startLine}` : d.path ? ` — ${d.path}` : ""}
                </Anchor>
              </Group>
            ))}
            {tab &&
              !problem &&
              diagnostics.length === 0 &&
              (!analysable || analysisStatus === "ok") && (
                <Text size="sm" c="dimmed">
                  No problems.
                </Text>
              )}
          </Stack>
        </ScrollArea>
      </Tabs.Panel>

      <Tabs.Panel value="related" style={{ flex: 1, minHeight: 0 }}>
        <ScrollArea h="100%" type="auto" p="xs">
          {!ruleId && (
            <Text size="sm" c="dimmed">
              Open a rule to see its related rules.
            </Text>
          )}
          {ruleId && related === undefined && <Loader size="xs" />}
          {related?.error && (
            <Text size="sm" c="red">
              {related.error}
            </Text>
          )}
          {related?.value && related.value.length === 0 && (
            <Text size="sm" c="dimmed">
              No related rules.
            </Text>
          )}
          {related?.value && related.value.length > 0 && (
            <Table withRowBorders={false} verticalSpacing={2} fz="sm">
              <Table.Tbody>
                {related.value.map((r) => (
                  <Table.Tr key={`${r.coreId}-${r.relation}-${r.via}`}>
                    <Table.Td>
                      {r.exists && r.path ? (
                        <Anchor
                          component="button"
                          type="button"
                          size="sm"
                          onClick={() => props.onOpen(r.path ?? "")}
                          style={{ fontFamily: "var(--mantine-font-family-monospace)" }}
                        >
                          {r.coreId}
                        </Anchor>
                      ) : (
                        <Text
                          span
                          size="sm"
                          c="dimmed"
                          style={{ fontFamily: "var(--mantine-font-family-monospace)" }}
                        >
                          {r.coreId} (not in this repository)
                        </Text>
                      )}
                    </Table.Td>
                    <Table.Td>{r.relation}</Table.Td>
                    <Table.Td c="dimmed">{r.via}</Table.Td>
                    <Table.Td c="dimmed">{r.family}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          )}
        </ScrollArea>
      </Tabs.Panel>
    </Tabs>
  );
}

function ScenariosTab({
  ruleId,
  suite,
  selectedScenario,
  onSelectScenario,
  onOpen,
  onNewScenario,
  lastRuns,
  runBusy,
  canRun,
  onRun,
}: Props) {
  const scenarios = suite?.value?.scenarios ?? null;
  const selected = scenarios?.find((s) => s.path === selectedScenario);
  if (!ruleId) {
    return (
      <Text size="sm" c="dimmed">
        Open a rule to list its scenarios.
      </Text>
    );
  }
  return (
    <Stack gap="xs">
      <Group gap="xs">
        <Tooltip label="Run the rule buffer against the selected scenario buffer (F5)">
          <Button size="compact-xs" onClick={onRun} disabled={!canRun} loading={runBusy}>
            Run (F5)
          </Button>
        </Tooltip>
        <Button size="compact-xs" variant="default" onClick={() => onNewScenario("rule")}>
          New from rule
        </Button>
        <Button
          size="compact-xs"
          variant="default"
          disabled={!selected}
          onClick={() => selected && onNewScenario("clone", selected)}
        >
          Clone
        </Button>
        {selected && (
          <Text size="xs" c="dimmed">
            target: {selected.name}
          </Text>
        )}
      </Group>
      {suite === undefined && <Loader size="xs" />}
      {suite?.error && (
        <Text size="sm" c="dimmed">
          {suite.error.includes("NOT_FOUND") ? "No scenarios yet." : suite.error}
        </Text>
      )}
      {scenarios && scenarios.length === 0 && (
        <Text size="sm" c="dimmed">
          No scenarios yet.
        </Text>
      )}
      {scenarios && scenarios.length > 0 && (
        <Table
          highlightOnHover
          withRowBorders={false}
          verticalSpacing={2}
          fz="sm"
          aria-label="scenarios"
        >
          <Table.Thead>
            <Table.Tr>
              <Table.Th>name</Table.Th>
              <Table.Th>expect</Table.Th>
              <Table.Th>count</Table.Th>
              <Table.Th>datasets</Table.Th>
              <Table.Th>last run</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {scenarios.map((s) => {
              const last = s.path ? lastRuns[s.path] : undefined;
              const isSelected = s.path === selectedScenario;
              return (
                <Table.Tr
                  key={s.path}
                  aria-selected={isSelected}
                  aria-label={`scenario ${s.name}`}
                  title="Click or Space: run target · double-click or Enter: open"
                  tabIndex={0}
                  onClick={() => s.path && onSelectScenario(s.path)}
                  onDoubleClick={() => s.path && onOpen(s.path)}
                  onKeyDown={(e) => {
                    if (!s.path) return;
                    if (e.key === " ") {
                      e.preventDefault();
                      onSelectScenario(s.path);
                    } else if (e.key === "Enter") {
                      e.preventDefault();
                      onOpen(s.path);
                    }
                  }}
                  style={{
                    cursor: "pointer",
                    background: isSelected ? "var(--mantine-color-default-hover)" : undefined,
                  }}
                >
                  <Table.Td style={{ fontFamily: "var(--mantine-font-family-monospace)" }}>
                    {s.name}
                    {s.sidecars ? " ⎘" : ""}
                    {s.parseError && (
                      <Text span c="red" size="xs">
                        {" "}
                        {s.parseError}
                      </Text>
                    )}
                  </Table.Td>
                  <Table.Td>{s.expect ?? "—"}</Table.Td>
                  <Table.Td>
                    {s.expectViolationCount ?? "—"}
                    {s.expectViolationAtCount ? ` (+${s.expectViolationAtCount} at)` : ""}
                  </Table.Td>
                  <Table.Td>{(s.datasets ?? []).join(", ")}</Table.Td>
                  <Table.Td>
                    {last ? (
                      <Badge size="xs" variant="light" color={outcomeColor(last.outcome)}>
                        {last.outcome}
                        {last.code && last.code !== "OK" ? ` ${last.code}` : ""}
                      </Badge>
                    ) : (
                      <Text span size="xs" c="dimmed">
                        not run
                      </Text>
                    )}
                  </Table.Td>
                </Table.Tr>
              );
            })}
          </Table.Tbody>
        </Table>
      )}
      {(suite?.value?.otherFiles ?? []).length > 0 && (
        <Group gap="xs">
          <Text size="xs" c="dimmed">
            sidecars:
          </Text>
          {suite!.value!.otherFiles!.map((name) => (
            <Anchor
              key={name}
              component="button"
              type="button"
              size="xs"
              onClick={() => onOpen(`${suite!.value!.directory}/${name}`)}
              style={{ fontFamily: "var(--mantine-font-family-monospace)" }}
            >
              {name}
            </Anchor>
          ))}
        </Group>
      )}
    </Stack>
  );
}

function CheckLine({
  label,
  check,
}: {
  label: string;
  check: { pass?: boolean; detail?: string } | undefined;
}) {
  if (!check) return null;
  return (
    <Text size="xs">
      <Badge size="xs" variant="light" color={check.pass ? "green" : "red"}>
        {label}
      </Badge>{" "}
      {check.detail}
    </Text>
  );
}

function ResultsTab({
  report,
  reportScenario,
  reportCurrent,
  selectedScenario,
  runError,
  runBusy,
  canRun,
  onRun,
  onTakeExpected,
  onGoToDiagnostic,
}: Props) {
  return (
    <Stack gap="xs">
      <Group gap="xs">
        <Button size="compact-xs" onClick={onRun} disabled={!canRun} loading={runBusy}>
          Run (F5)
        </Button>
        {report?.expectations?.lines && reportCurrent && (
          <Tooltip label="Propose the observed findings as the scenario's expectation lines — shown as a diff, written only on confirmation">
            <Button size="compact-xs" variant="default" onClick={onTakeExpected}>
              Take actual as expected
            </Button>
          </Tooltip>
        )}
      </Group>
      {runError && (
        <Text size="sm" c="red" role="alert">
          Run failed: {runError}
        </Text>
      )}
      {!report && !runError && (
        <Text size="sm" c="dimmed">
          {canRun ? "Select a scenario and run (F5)." : "Open a rule and select a scenario to run."}
        </Text>
      )}
      {report && (
        <>
          {reportScenario && (
            <Text size="xs" aria-label="report scenario">
              Scenario{" "}
              <Text span fw={600} style={{ fontFamily: "var(--mantine-font-family-monospace)" }}>
                {fileName(reportScenario)}
              </Text>
              {!reportCurrent && (
                <Text span c="orange">
                  {" "}
                  — not the selected scenario
                  {selectedScenario ? ` (${fileName(selectedScenario)})` : ""}: run it to take its
                  expectations
                </Text>
              )}
            </Text>
          )}
          <Group gap="xs">
            <Badge color={outcomeColor(report.outcome)} variant="filled">
              {report.outcome}
            </Badge>
            <Text size="sm" fw={600}>
              {report.code}
            </Text>
            <Text size="sm">{report.detail}</Text>
            <Text size="xs" c="dimmed">
              {report.durationMs} ms · {report.worker}
            </Text>
          </Group>
          {report.scopeGate && !report.scopeGate.inScope && (
            <Text size="xs" c="orange">
              Scope gate: {report.scopeGate.mismatch}
            </Text>
          )}
          {report.skip && (
            <Text size="xs" c="orange">
              {report.skip.kind}: {report.skip.text}
            </Text>
          )}
          <CheckLine label="verdict" check={report.verdict} />
          <CheckLine label="locations" check={report.locations} />
          {(report.ruleDiagnostics ?? []).map((d, i) => (
            <Anchor
              key={i}
              component="button"
              type="button"
              size="xs"
              ta="left"
              onClick={() => onGoToDiagnostic(d)}
            >
              {d.severity} {d.message} ({d.code})
            </Anchor>
          ))}
          {(report.results ?? []).map((r, i) => (
            <Text key={i} size="xs" c="dimmed">
              {r.ruleId}: {r.status}
              {r.statusMessage ? ` — ${r.statusMessage}` : ""} · {r.violationCount} finding
              {r.violationCount === 1 ? "" : "s"}
              {r.truncated ? " (truncated)" : ""}
            </Text>
          ))}
          {(report.findings ?? []).length > 0 && (
            <Table withRowBorders={false} verticalSpacing={2} fz="xs" aria-label="findings">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>row</Table.Th>
                  <Table.Th>USUBJID</Table.Th>
                  <Table.Th>SEQ</Table.Th>
                  <Table.Th>keys</Table.Th>
                  <Table.Th>values</Table.Th>
                  <Table.Th>level</Table.Th>
                  <Table.Th>unit</Table.Th>
                  <Table.Th>message</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {report.findings!.map((f, i) => (
                  <Table.Tr key={i}>
                    <Table.Td>{f.row}</Table.Td>
                    <Table.Td>{f.usubjid}</Table.Td>
                    <Table.Td>{f.seq}</Table.Td>
                    <Table.Td style={{ fontFamily: "var(--mantine-font-family-monospace)" }}>
                      {mapText(f.keys)}
                    </Table.Td>
                    <Table.Td style={{ fontFamily: "var(--mantine-font-family-monospace)" }}>
                      {mapText(f.values)}
                    </Table.Td>
                    <Table.Td>{f.level}</Table.Td>
                    <Table.Td>{f.unit}</Table.Td>
                    <Table.Td>{f.message}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          )}
        </>
      )}
    </Stack>
  );
}

function JsonTab({ json, ruleId }: { json: string; ruleId: string | null }) {
  function download() {
    const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${ruleId ?? "run"}-report.json`;
    a.click();
    URL.revokeObjectURL(url);
  }
  return (
    <>
      <Group gap="xs" px="xs" py={2}>
        <Button
          size="compact-xs"
          variant="default"
          onClick={() =>
            void navigator.clipboard
              ?.writeText(json)
              .then(() => notifications.show({ message: "Report JSON copied", color: "green" }))
          }
        >
          Copy
        </Button>
        <Button size="compact-xs" variant="default" onClick={download}>
          Download
        </Button>
      </Group>
      <CodeEditor label="report JSON" value={json} onChange={() => {}} readOnly language="json" />
    </>
  );
}
