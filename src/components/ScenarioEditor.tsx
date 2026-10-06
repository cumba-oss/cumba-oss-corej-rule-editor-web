import { useEffect, useState } from "react";
import {
  ActionIcon,
  Autocomplete,
  Box,
  Button,
  Group,
  Loader,
  Modal,
  NumberInput,
  ScrollArea,
  SegmentedControl,
  Select,
  Stack,
  Table,
  Tabs,
  Text,
  TextInput,
  Tooltip,
} from "@mantine/core";
import { cdtParse, cdtSplice } from "../api/editor";
import type { AnalysisT, ColumnT, DatasetT, ParsedT } from "../api/types";
import { columnFor, readExpectations, writeExpectations, type Expectations } from "../engine/cdt";
import type { Tab } from "../state/tabs";
import { CodeEditor } from "./CodeEditor";

interface Props {
  tab: Tab;
  onChange: (content: string) => void;
  onSave: () => void;
  /** The rule's analysis, for the scope variables an added column may take. */
  analysis: AnalysisT | null;
}

/** A missing sentinel in the parser's field encoding: `.`, `._`, `.A`…`.Z` (unescaped). */
export function isMissing(cell: string): boolean {
  return /^\.(?:_|[A-Z])?$/.test(cell);
}

/**
 * A scenario tab (PLAN-rule-editor §5.6): two views of one document, the text being the truth.
 * The Grid view is one sub-tab per dataset block (`POST /api/cdt/parse`); every grid edit is a
 * `POST /api/cdt/splice` of the current text — a `CDT_UNREPRESENTABLE` answer is shown and
 * nothing changes. The expectations header edits the `#test … expect=`, `#expectViolationCount`
 * and `#expectViolationAt` lines in place.
 */
export function ScenarioEditor({ tab, onChange, onSave, analysis }: Props) {
  const [view, setView] = useState<"text" | "grid">("text");
  const [parsed, setParsed] = useState<{ forContent: string; value: ParsedT } | null>(null);
  const [spliceError, setSpliceError] = useState<string | null>(null);
  const content = tab.content;
  const current = parsed && parsed.forContent === content ? parsed.value : null;

  useEffect(() => {
    if (view !== "grid") return undefined;
    let cancelled = false;
    void cdtParse(content).then((r) => {
      if (cancelled) return;
      setParsed({
        forContent: content,
        value: r.problem ? { datasets: [], directives: [], error: r.problem.detail } : r.data,
      });
    });
    return () => {
      cancelled = true;
    };
  }, [view, content]);

  async function splice(dataset: DatasetT): Promise<void> {
    const r = await cdtSplice(content, dataset);
    if (r.problem) {
      setSpliceError(`${r.problem.detail} (${r.problem.code})`);
      return;
    }
    setSpliceError(null);
    if (r.data.content !== undefined && r.data.content !== content) onChange(r.data.content);
  }

  return (
    <Box style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      <ExpectationsForm content={content} onChange={onChange} />
      <Group px="xs" py={2} gap="xs">
        <SegmentedControl
          size="xs"
          value={view}
          onChange={(v) => setView(v as "text" | "grid")}
          data={[
            { label: "Text", value: "text" },
            { label: "Grid", value: "grid" },
          ]}
        />
        {spliceError && (
          <Text size="xs" c="red" role="alert">
            Not written: {spliceError}
          </Text>
        )}
      </Group>
      {view === "text" ? (
        <CodeEditor
          key={tab.path}
          label={tab.title}
          value={content}
          onChange={onChange}
          onSave={onSave}
        />
      ) : (
        <GridView parsed={current} analysis={analysis} onSplice={splice} />
      )}
    </Box>
  );
}

// ---- the expectations header ------------------------------------------------------------------

const EXPECT_VALUES = ["violation", "no-violation", "skipped", "error"];

function ExpectationsForm({
  content,
  onChange,
}: {
  content: string;
  onChange: (c: string) => void;
}) {
  const e = readExpectations(content);
  const write = (next: Partial<Expectations>) =>
    onChange(writeExpectations(content, { ...e, ...next }));
  return (
    <Group px="xs" py={4} gap="xs" align="flex-end" wrap="wrap" aria-label="expectations">
      <Text size="xs" c="dimmed" style={{ fontFamily: "var(--mantine-font-family-monospace)" }}>
        #test {e.ruleId ?? "?"}
      </Text>
      <Select
        size="xs"
        label="expect"
        aria-label="expect"
        data={
          EXPECT_VALUES.includes(e.expect ?? "") || !e.expect
            ? EXPECT_VALUES
            : [e.expect, ...EXPECT_VALUES]
        }
        value={e.expect}
        onChange={(v) => write({ expect: v })}
        clearable
        w={140}
      />
      <TextInput
        size="xs"
        label="domain"
        aria-label="domain"
        value={e.domain ?? ""}
        onChange={(ev) => write({ domain: ev.currentTarget.value || null })}
        w={100}
      />
      <NumberInput
        size="xs"
        label="#expectViolationCount"
        aria-label="expectViolationCount"
        value={e.expectViolationCount ?? ""}
        min={0}
        allowDecimal={false}
        onChange={(v) => write({ expectViolationCount: v === "" ? null : Number(v) })}
        w={160}
      />
      <Stack gap={2}>
        {e.expectViolationAt.map((at, i) => (
          <Group key={i} gap={2} wrap="nowrap">
            <TextInput
              size="xs"
              aria-label={`expectViolationAt ${i + 1}`}
              value={at}
              style={{ fontFamily: "var(--mantine-font-family-monospace)" }}
              onChange={(ev) => {
                const ats = [...e.expectViolationAt];
                ats[i] = ev.currentTarget.value;
                write({ expectViolationAt: ats });
              }}
              w={320}
            />
            <ActionIcon
              size="xs"
              variant="subtle"
              aria-label={`remove expectViolationAt ${i + 1}`}
              onClick={() =>
                write({ expectViolationAt: e.expectViolationAt.filter((_, j) => j !== i) })
              }
            >
              ×
            </ActionIcon>
          </Group>
        ))}
        <Button
          size="compact-xs"
          variant="subtle"
          onClick={() => write({ expectViolationAt: [...e.expectViolationAt, ""] })}
        >
          + #expectViolationAt
        </Button>
      </Stack>
    </Group>
  );
}

// ---- the grid ---------------------------------------------------------------------------------

function GridView({
  parsed,
  analysis,
  onSplice,
}: {
  parsed: ParsedT | null;
  analysis: AnalysisT | null;
  onSplice: (d: DatasetT) => Promise<void>;
}) {
  const [active, setActive] = useState<string | null>(null);
  if (!parsed) {
    return (
      <Group p="md">
        <Loader size="xs" />
      </Group>
    );
  }
  if (parsed.error) {
    return (
      <Text p="md" size="sm" c="red" role="alert">
        The text does not parse as a .cdt: {parsed.error} — fix it in the Text view.
      </Text>
    );
  }
  const datasets = parsed.datasets ?? [];
  if (datasets.length === 0) {
    return (
      <Text p="md" size="sm" c="dimmed">
        No dataset block yet — add one in the Text view (`dataset NAME`, `col …`, a `---` fence).
      </Text>
    );
  }
  const value = datasets.some((d) => d.name === active) ? active : (datasets[0].name ?? null);
  return (
    <Tabs
      value={value}
      onChange={setActive}
      style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}
    >
      <Tabs.List>
        {datasets.map((d) => (
          <Tabs.Tab key={d.name} value={d.name ?? ""}>
            {d.name}
          </Tabs.Tab>
        ))}
      </Tabs.List>
      {datasets.map((d) => (
        <Tabs.Panel key={d.name} value={d.name ?? ""} style={{ flex: 1, minHeight: 0 }}>
          <ScrollArea h="100%" type="auto">
            <DatasetGrid dataset={d} analysis={analysis} onSplice={onSplice} />
          </ScrollArea>
        </Tabs.Panel>
      ))}
    </Tabs>
  );
}

function DatasetGrid({
  dataset,
  analysis,
  onSplice,
}: {
  dataset: DatasetT;
  analysis: AnalysisT | null;
  onSplice: (d: DatasetT) => Promise<void>;
}) {
  const [adding, setAdding] = useState(false);
  const columns = dataset.columns ?? [];
  const rows = dataset.rows ?? [];

  const commitCell = (r: number, c: number, text: string) => {
    if (rows[r][c] === text) return;
    const next = rows.map((row, i) =>
      i === r ? row.map((cell, j) => (j === c ? text : cell)) : row,
    );
    void onSplice({ ...dataset, rows: next });
  };
  const addRow = () => void onSplice({ ...dataset, rows: [...rows, columns.map(() => ".")] });
  const removeRow = (r: number) =>
    void onSplice({ ...dataset, rows: rows.filter((_, i) => i !== r) });
  const removeColumn = (c: number) =>
    void onSplice({
      ...dataset,
      columns: columns.filter((_, i) => i !== c),
      rows: rows.map((row) => row.filter((_, j) => j !== c)),
    });
  const addColumn = (col: ColumnT) => {
    setAdding(false);
    void onSplice({
      ...dataset,
      columns: [...columns, col],
      rows: rows.map((row) => [...row, "."]),
    });
  };

  return (
    <Stack gap={4} p="xs">
      <Group gap="xs">
        <Text size="xs" c="dimmed">
          {dataset.name}
          {dataset.label ? ` — ${dataset.label}` : ""} · {rows.length} row
          {rows.length === 1 ? "" : "s"}
        </Text>
        <Button size="compact-xs" variant="default" onClick={addRow}>
          + row
        </Button>
        <Button size="compact-xs" variant="default" onClick={() => setAdding(true)}>
          + column
        </Button>
      </Group>
      <Table
        withColumnBorders
        withTableBorder
        verticalSpacing={0}
        fz="xs"
        aria-label={`grid ${dataset.name}`}
      >
        <Table.Thead>
          <Table.Tr>
            <Table.Th w={28} />
            {columns.map((c, i) => (
              <Table.Th key={`${c.name}-${i}`}>
                <Group gap={4} wrap="nowrap" justify="space-between">
                  <Tooltip
                    label={[c.type, c.label, c.codelist ? `codelist ${c.codelist}` : ""]
                      .filter(Boolean)
                      .join(" · ")}
                  >
                    <Text
                      span
                      size="xs"
                      fw={600}
                      style={{ fontFamily: "var(--mantine-font-family-monospace)" }}
                    >
                      {c.name}
                      <Text span c="dimmed" fw={400}>
                        {" "}
                        {c.type}
                      </Text>
                    </Text>
                  </Tooltip>
                  <ActionIcon
                    size="xs"
                    variant="subtle"
                    aria-label={`remove column ${c.name}`}
                    onClick={() => removeColumn(i)}
                  >
                    ×
                  </ActionIcon>
                </Group>
                {c.label && (
                  <Text size="xs" c="dimmed" fw={400} truncate maw={160}>
                    {c.label}
                  </Text>
                )}
              </Table.Th>
            ))}
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {rows.map((row, r) => (
            <Table.Tr key={r}>
              <Table.Td>
                <ActionIcon
                  size="xs"
                  variant="subtle"
                  aria-label={`remove row ${r + 1}`}
                  onClick={() => removeRow(r)}
                >
                  ×
                </ActionIcon>
              </Table.Td>
              {row.map((cell, c) => (
                <Table.Td key={c} p={0}>
                  <Cell
                    value={cell}
                    label={`${columns[c]?.name ?? c} row ${r + 1}`}
                    onCommit={(t) => commitCell(r, c, t)}
                  />
                </Table.Td>
              ))}
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      <AddColumnDialog
        opened={adding}
        analysis={analysis}
        existing={columns.map((c) => c.name ?? "")}
        onAdd={addColumn}
        onCancel={() => setAdding(false)}
      />
    </Stack>
  );
}

/** One cell: the raw field text, a missing sentinel shown distinctly (dimmed, marked). */
function Cell({
  value,
  label,
  onCommit,
}: {
  value: string;
  label: string;
  onCommit: (t: string) => void;
}) {
  const [text, setText] = useState(value);
  const [editing, setEditing] = useState(false);
  const shown = editing ? text : value;
  const missing = isMissing(shown);
  return (
    <TextInput
      size="xs"
      variant="unstyled"
      aria-label={label}
      title={missing ? `missing (${shown})` : undefined}
      value={shown}
      onFocus={() => {
        setText(value);
        setEditing(true);
      }}
      onChange={(e) => setText(e.currentTarget.value)}
      onBlur={() => {
        setEditing(false);
        onCommit(text);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          setText(value);
          setEditing(false);
        }
      }}
      styles={{
        input: {
          fontFamily: "var(--mantine-font-family-monospace)",
          paddingLeft: 6,
          minHeight: 24,
          height: 24,
          ...(missing
            ? {
                color: "var(--mantine-color-dimmed)",
                fontStyle: "italic",
                background: "var(--mantine-color-default-hover)",
              }
            : {}),
        },
      }}
    />
  );
}

/** Adding a column offers the rule's scope variables and fills type / label from the catalogue. */
function AddColumnDialog({
  opened,
  analysis,
  existing,
  onAdd,
  onCancel,
}: {
  opened: boolean;
  analysis: AnalysisT | null;
  existing: string[];
  onAdd: (c: ColumnT) => void;
  onCancel: () => void;
}) {
  return (
    <Modal opened={opened} onClose={onCancel} title="Add a column" size="sm">
      {opened && (
        <AddColumnBody analysis={analysis} existing={existing} onAdd={onAdd} onCancel={onCancel} />
      )}
    </Modal>
  );
}

function AddColumnBody({
  analysis,
  existing,
  onAdd,
  onCancel,
}: {
  analysis: AnalysisT | null;
  existing: string[];
  onAdd: (c: ColumnT) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [type, setType] = useState<string>("Char");
  const [label, setLabel] = useState("");
  const [touched, setTouched] = useState(false);
  const options = (analysis?.scope?.variables ?? [])
    .filter((v) => !v.classLevel && !existing.includes(v.name ?? ""))
    .map((v) => v.name ?? "");
  const pick = (n: string) => {
    setName(n);
    if (!touched) {
      const c = columnFor(n, analysis);
      setType(c.type ?? "Char");
      setLabel(c.label ?? "");
    }
  };
  const upper = name.trim().toUpperCase();
  const duplicate = existing.includes(upper);
  return (
    <Stack gap="sm">
      <Autocomplete
        label="Variable"
        aria-label="Variable"
        data={options}
        value={name}
        onChange={pick}
        placeholder="a scope variable, or any name"
        data-autofocus
        limit={50}
      />
      <Group grow>
        <Select
          label="type"
          aria-label="type"
          data={["Char", "Num", "Date", "DateTime", "Time"]}
          value={type}
          onChange={(v) => {
            setTouched(true);
            setType(v ?? "Char");
          }}
        />
        <TextInput
          label="label"
          aria-label="label"
          value={label}
          onChange={(e) => {
            setTouched(true);
            setLabel(e.currentTarget.value);
          }}
        />
      </Group>
      {duplicate && (
        <Text size="xs" c="red">
          {upper} is already a column.
        </Text>
      )}
      <Group justify="flex-end">
        <Button variant="default" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          disabled={!upper || duplicate}
          onClick={() => onAdd({ name: upper, type, label: label || undefined, attrs: {} })}
        >
          Add column
        </Button>
      </Group>
    </Stack>
  );
}
