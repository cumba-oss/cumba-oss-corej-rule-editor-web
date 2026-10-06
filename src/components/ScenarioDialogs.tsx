import { useState } from "react";
import { Button, Checkbox, Group, Modal, Select, Stack, Text, TextInput } from "@mantine/core";
import type { AnalysisT, ScenarioT } from "../api/types";
import { diffLines, newScenarioFromRule, scenarioColumns } from "../engine/cdt";

// ---- new scenario (§5.6: from the rule / clone) ----------------------------------------------

export interface NewScenarioRequest {
  mode: "rule" | "clone";
  source?: ScenarioT;
}

interface NewProps {
  request: NewScenarioRequest | null;
  ruleId: string;
  /** The rule's analysis: the in-scope datasets to pick from, the referenced variables. */
  analysis: AnalysisT | null;
  /** The scenario names the suite already holds. */
  existing: string[];
  /** The source scenario's text (clone). */
  sourceText: string | null;
  onCreate: (name: string, content: string) => void;
  onCancel: () => void;
}

const NAME = /^[A-Za-z0-9][\w.-]*$/;

/**
 * New scenario: "from the rule" — one dataset per in-scope dataset the user picks, the columns
 * the rule references ∪ the required ones, types and labels from the catalogue, one empty row;
 * or "clone" — a copy under a new name. Both open as unsaved tabs in the suite directory.
 */
export function NewScenarioDialog(props: NewProps) {
  const { request, onCancel } = props;
  return (
    <Modal
      opened={request !== null}
      onClose={onCancel}
      title={
        request?.mode === "clone"
          ? `Clone ${request.source?.name ?? ""}`
          : `New scenario for ${props.ruleId}`
      }
    >
      {request && <NewScenarioBody {...props} request={request} />}
    </Modal>
  );
}

function NewScenarioBody({
  request,
  ruleId,
  analysis,
  existing,
  sourceText,
  onCreate,
  onCancel,
}: NewProps & { request: NewScenarioRequest }) {
  const inScope = (analysis?.scope?.datasets ?? [])
    .filter((d) => d.inScope)
    .map((d) => d.name ?? "");
  const uniqueDatasets = [...new Set(inScope)];
  const defaultDataset = analysis?.derived?.evaluationDomain ?? uniqueDatasets[0] ?? "";
  const [datasets, setDatasets] = useState<string[]>(defaultDataset ? [defaultDataset] : []);
  const [extra, setExtra] = useState("");
  const [expect, setExpect] = useState<"violation" | "noViolation">("violation");
  const suggested =
    request.mode === "clone"
      ? (request.source?.name ?? "copy.cdt").replace(/\.cdt$/, "-copy.cdt")
      : `${ruleId}-${expect === "violation" ? "invalid" : "valid"}-${datasets[0] ?? "X"}.cdt`;
  const [name, setName] = useState(suggested);
  const [nameTouched, setNameTouched] = useState(false);
  const shownName = nameTouched ? name : suggested;
  const base = shownName.replace(/\.cdt$/, "");
  const fileName = `${base}.cdt`;
  const nameError = !NAME.test(base)
    ? "letters, digits, . _ - only"
    : existing.includes(fileName)
      ? "a scenario of that name exists"
      : null;
  const chosen = [
    ...datasets,
    ...extra
      .split(/[,\s]+/)
      .filter(Boolean)
      .map((d) => d.toUpperCase()),
  ];

  function create() {
    if (request.mode === "clone") {
      onCreate(fileName, sourceText ?? "");
      return;
    }
    const columns = scenarioColumns(analysis, ["USUBJID"]);
    onCreate(fileName, newScenarioFromRule(ruleId, chosen, columns, analysis, expect));
  }

  return (
    <Stack gap="sm">
      {request.mode === "rule" && (
        <>
          <Select
            label="expect"
            aria-label="expect"
            data={["violation", "noViolation"]}
            value={expect}
            onChange={(v) => setExpect(v === "noViolation" ? "noViolation" : "violation")}
          />
          <Checkbox.Group label="Datasets (in scope)" value={datasets} onChange={setDatasets}>
            <Group gap="sm" mt={4}>
              {uniqueDatasets.map((d) => (
                <Checkbox key={d} value={d} label={d} />
              ))}
            </Group>
          </Checkbox.Group>
          {uniqueDatasets.length === 0 && (
            <Text size="xs" c="dimmed">
              No in-scope dataset is known (no analysis or no metadata store) — name one below.
            </Text>
          )}
          <TextInput
            label="More datasets"
            aria-label="More datasets"
            placeholder="AE, SUPPAE"
            value={extra}
            onChange={(e) => setExtra(e.currentTarget.value)}
          />
          <Text size="xs" c="dimmed">
            Columns: {scenarioColumns(analysis, ["USUBJID"]).join(", ")}
          </Text>
        </>
      )}
      <TextInput
        label="File name"
        aria-label="File name"
        value={shownName}
        onChange={(e) => {
          setNameTouched(true);
          setName(e.currentTarget.value);
        }}
        error={nameError}
        data-autofocus={request.mode === "clone" || undefined}
      />
      <Group justify="flex-end">
        <Button variant="default" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          disabled={nameError !== null || (request.mode === "rule" && chosen.length === 0)}
          onClick={create}
        >
          Create
        </Button>
      </Group>
    </Stack>
  );
}

// ---- take actual as expected (§5.6: a diff, written only on confirmation) --------------------

interface TakeProps {
  opened: boolean;
  scenarioName: string;
  current: string[];
  proposed: string[];
  onConfirm: () => void;
  onCancel: () => void;
}

export function TakeExpectedDialog({
  opened,
  scenarioName,
  current,
  proposed,
  onConfirm,
  onCancel,
}: TakeProps) {
  const diff = diffLines(current, proposed);
  const unchanged = diff.every((d) => d.op === " ");
  return (
    <Modal
      opened={opened}
      onClose={onCancel}
      title={`Take actual as expected — ${scenarioName}`}
      size="lg"
    >
      <Stack gap="sm">
        <Text size="sm">
          The run proposes these <code>#expectViolation*</code> lines for the scenario buffer.
          Nothing is written until you confirm — check that the observed findings are the ones the
          scenario should expect.
        </Text>
        <pre
          aria-label="expectation diff"
          style={{
            margin: 0,
            fontSize: 12,
            fontFamily: "var(--mantine-font-family-monospace)",
            whiteSpace: "pre-wrap",
          }}
        >
          {diff.map((d, i) => (
            <div
              key={i}
              style={{
                color:
                  d.op === "+"
                    ? "var(--mantine-color-green-7)"
                    : d.op === "-"
                      ? "var(--mantine-color-red-7)"
                      : undefined,
                textDecoration: d.op === "-" ? "line-through" : undefined,
              }}
            >
              {d.op} {d.line}
            </div>
          ))}
          {diff.length === 0 && <div>(no expectation lines)</div>}
        </pre>
        {unchanged && (
          <Text size="xs" c="dimmed">
            The scenario already expects exactly this.
          </Text>
        )}
        <Group justify="flex-end">
          <Button variant="default" onClick={onCancel}>
            Cancel
          </Button>
          <Button disabled={unchanged} onClick={onConfirm}>
            Write into the buffer
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
