import { useEffect, useRef, useState } from "react";
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
import {
  blockHasComments,
  columnFor,
  readExpectations,
  writeExpectations,
  type Expectations,
} from "../engine/cdt";
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
 * `POST /api/cdt/splice` of the text the grid was parsed from — a `CDT_UNREPRESENTABLE` answer is
 * shown and nothing changes. The expectations header edits the `#test … expect=`,
 * `#expectViolationCount` and `#expectViolationAt` lines in place.
 *
 * Splices are serialized (review 2): while one is in flight, or while the grid shows a parse of
 * older text, the grid and the header are read-only; an answer is applied only when the text is
 * still the one it was computed from. The previous parse stays mounted (dimmed) while the new text
 * is parsed, so focus and the active block survive an edit. The first splice of a block that
 * carries comment lines asks first — a splice drops them (`CdtDocument`, §12).
 */
export function ScenarioEditor({ tab, onChange, onSave, analysis }: Props) {
  const [view, setView] = useState<"text" | "grid">("text");
  const [parsed, setParsed] = useState<{ forContent: string; value: ParsedT } | null>(null);
  const [spliceError, setSpliceError] = useState<string | null>(null);
  const [splicing, setSplicing] = useState(false);
  const [askComments, setAskComments] = useState<{
    name: string;
    resolve: (ok: boolean) => void;
  } | null>(null);
  const content = tab.content;
  const contentRef = useRef(content);
  useEffect(() => {
    contentRef.current = content;
  }, [content]);
  const splicingRef = useRef(false);
  /** Blocks (by index) whose comment loss the user accepted, in this tab. */
  const commentsAccepted = useRef(new Set<number>());
  const fresh = parsed !== null && parsed.forContent === content;

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

  function confirmComments(name: string, index: number): Promise<boolean> {
    if (commentsAccepted.current.has(index) || !blockHasComments(contentRef.current, index)) {
      return Promise.resolve(true);
    }
    return new Promise((resolve) =>
      setAskComments({
        name,
        resolve: (ok) => {
          setAskComments(null);
          if (ok) commentsAccepted.current.add(index);
          resolve(ok);
        },
      }),
    );
  }

  /**
   * Splice `dataset` into `base` — the text the grid was parsed from — as the block at `index`
   * of that parse (a scenario may hold two blocks of one name).
   */
  async function splice(dataset: DatasetT, base: string, index: number): Promise<void> {
    if (splicingRef.current) return;
    splicingRef.current = true;
    setSplicing(true);
    try {
      if (!(await confirmComments(dataset.name ?? "", index))) return;
      if (contentRef.current !== base) {
        setSpliceError("the text changed before the grid edit was sent — redo it on the new grid");
        return;
      }
      const r = await cdtSplice(base, dataset, index);
      if (r.problem) {
        setSpliceError(`${r.problem.detail} (${r.problem.code})`);
        return;
      }
      if (contentRef.current !== base) {
        setSpliceError(
          "the text changed while the grid edit was written — redo it on the new grid",
        );
        return;
      }
      setSpliceError(null);
      const next = r.data.content;
      if (next !== undefined && next !== base) {
        contentRef.current = next;
        onChange(next);
      }
    } finally {
      splicingRef.current = false;
      setSplicing(false);
    }
  }

  return (
    <Box style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      <ExpectationsForm content={content} onChange={onChange} disabled={splicing} />
      <Group px="xs" py={2} gap="xs">
        <SegmentedControl
          size="xs"
          value={view}
          onChange={(v) => setView(v as "text" | "grid")}
          disabled={splicing}
          data={[
            { label: "Text", value: "text" },
            { label: "Grid", value: "grid" },
          ]}
        />
        {view === "grid" && (splicing || (parsed !== null && !fresh)) && (
          <Text size="xs" c="dimmed" role="status">
            {splicing ? "Writing the grid edit…" : "Re-reading the text…"}
          </Text>
        )}
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
        <GridView
          parsed={parsed?.value ?? null}
          blocked={splicing || !fresh}
          analysis={analysis}
          onSplice={(d, i) => (parsed ? splice(d, parsed.forContent, i) : Promise.resolve())}
        />
      )}
      <Modal
        opened={askComments !== null}
        onClose={() => askComments?.resolve(false)}
        title={`Rewrite dataset ${askComments?.name ?? ""}?`}
        size="md"
      >
        <Stack gap="sm">
          <Text size="sm">
            The block <code>{askComments?.name}</code> carries comment lines. A grid edit rewrites
            the whole block and drops them — the text view keeps them if you edit there instead.
          </Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => askComments?.resolve(false)}>
              Cancel
            </Button>
            <Button onClick={() => askComments?.resolve(true)}>Rewrite without the comments</Button>
          </Group>
        </Stack>
      </Modal>
    </Box>
  );
}

// ---- the expectations header ------------------------------------------------------------------

/** The `expect=` tokens `RuleTestCdt` accepts (`RuleTestScenario.Verdict.token()`). */
const EXPECT_VALUES = ["violation", "noViolation", "skipped", "executionError"];

function ExpectationsForm({
  content,
  onChange,
  disabled,
}: {
  content: string;
  onChange: (c: string) => void;
  /** A grid splice is in flight: the header waits (its edit would race the splice). */
  disabled: boolean;
}) {
  const e = readExpectations(content);
  const write = (next: Partial<Expectations>) =>
    onChange(writeExpectations(content, { ...e, ...next }));
  // A new #expectViolationAt line is written only once it has text (review 10): a bare directive
  // line is a half-filled expectation the buffer would carry into a save.
  const [draft, setDraft] = useState<string | null>(null);
  const draftRef = useRef<string | null>(null);
  const editDraft = (v: string | null) => {
    draftRef.current = v;
    setDraft(v);
  };
  const commitDraft = () => {
    const v = draftRef.current?.trim() ?? "";
    editDraft(null);
    if (v) write({ expectViolationAt: [...e.expectViolationAt, v] });
  };
  return (
    <Group
      px="xs"
      py={4}
      gap="xs"
      align="flex-end"
      wrap="wrap"
      aria-label="expectations"
      style={disabled ? { pointerEvents: "none", opacity: 0.6 } : undefined}
      aria-disabled={disabled || undefined}
    >
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
        disabled={disabled}
        w={140}
      />
      <TextInput
        size="xs"
        label="domain"
        aria-label="domain"
        value={e.domain ?? ""}
        onChange={(ev) => write({ domain: ev.currentTarget.value || null })}
        readOnly={disabled}
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
        readOnly={disabled}
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
              readOnly={disabled}
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
        {draft !== null && (
          <TextInput
            size="xs"
            aria-label={`expectViolationAt ${e.expectViolationAt.length + 1}`}
            placeholder="COLUMN=value … (Enter adds the line)"
            value={draft}
            autoFocus
            style={{ fontFamily: "var(--mantine-font-family-monospace)" }}
            onChange={(ev) => editDraft(ev.currentTarget.value)}
            onBlur={commitDraft}
            onKeyDown={(ev) => {
              if (ev.key === "Enter") commitDraft();
              if (ev.key === "Escape") editDraft(null);
            }}
            w={320}
          />
        )}
        <Button
          size="compact-xs"
          variant="subtle"
          disabled={disabled || draft !== null}
          onClick={() => editDraft("")}
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
  blocked,
  analysis,
  onSplice,
}: {
  parsed: ParsedT | null;
  /** A splice is in flight or the parse is of older text: shown, dimmed, read-only. */
  blocked: boolean;
  analysis: AnalysisT | null;
  onSplice: (d: DatasetT, index: number) => Promise<void>;
}) {
  // sub-tabs by POSITION: a scenario may hold two blocks of one name
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
  const value = active !== null && Number(active) < datasets.length ? active : "0";
  return (
    <Tabs
      value={value}
      onChange={setActive}
      aria-busy={blocked || undefined}
      style={{
        flex: 1,
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
        ...(blocked ? { opacity: 0.6 } : {}),
      }}
    >
      <Tabs.List>
        {datasets.map((d, i) => (
          <Tabs.Tab key={i} value={String(i)}>
            {d.name}
          </Tabs.Tab>
        ))}
      </Tabs.List>
      {datasets.map((d, i) => (
        <Tabs.Panel key={i} value={String(i)} style={{ flex: 1, minHeight: 0 }}>
          <ScrollArea h="100%" type="auto">
            <DatasetGrid
              dataset={d}
              blocked={blocked}
              analysis={analysis}
              onSplice={(next) => onSplice(next, i)}
            />
          </ScrollArea>
        </Tabs.Panel>
      ))}
    </Tabs>
  );
}

function DatasetGrid({
  dataset,
  blocked,
  analysis,
  onSplice,
}: {
  dataset: DatasetT;
  blocked: boolean;
  analysis: AnalysisT | null;
  onSplice: (d: DatasetT) => Promise<void>;
}) {
  const [adding, setAdding] = useState(false);
  const columns = dataset.columns ?? [];
  const rows = dataset.rows ?? [];

  const commitCell = (r: number, c: number, text: string) => {
    if (blocked || rows[r]?.[c] === undefined || rows[r][c] === text) return;
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
        <Button size="compact-xs" variant="default" onClick={addRow} disabled={blocked}>
          + row
        </Button>
        <Button
          size="compact-xs"
          variant="default"
          onClick={() => setAdding(true)}
          disabled={blocked}
        >
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
                    disabled={blocked}
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
                  disabled={blocked}
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
                    blocked={blocked}
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

/**
 * One cell: the raw field text, a missing sentinel shown distinctly (dimmed, marked). An edit
 * starts on focus (or on the first keystroke) and commits on blur / Enter; Escape drops it and
 * leaves the cell, so nothing typed afterwards can commit unseen (review 10). Read-only while
 * the grid is blocked.
 */
function Cell({
  value,
  label,
  blocked,
  onCommit,
}: {
  value: string;
  label: string;
  blocked: boolean;
  onCommit: (t: string) => void;
}) {
  const [text, setText] = useState(value);
  const [editing, setEditing] = useState(false);
  const edit = useRef<string | null>(null);
  const begin = (t: string) => {
    edit.current = t;
    setText(t);
    setEditing(true);
  };
  const end = () => {
    edit.current = null;
    setEditing(false);
  };
  const shown = editing ? text : value;
  const missing = isMissing(shown);
  return (
    <TextInput
      size="xs"
      variant="unstyled"
      aria-label={label}
      title={missing ? `missing (${shown})` : undefined}
      value={shown}
      readOnly={blocked}
      onFocus={() => {
        if (!blocked) begin(value);
      }}
      onChange={(e) => {
        if (blocked) return;
        const t = e.currentTarget.value;
        if (edit.current === null) begin(t);
        else {
          edit.current = t;
          setText(t);
        }
      }}
      onBlur={() => {
        const t = edit.current;
        end();
        if (t !== null) onCommit(t);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          end();
          e.currentTarget.blur();
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
