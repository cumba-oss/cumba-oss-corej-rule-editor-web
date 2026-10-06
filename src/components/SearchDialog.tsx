import { useState, type FormEvent } from "react";
import {
  Anchor,
  Badge,
  Button,
  Checkbox,
  Group,
  Modal,
  ScrollArea,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import { search, type SearchFilters } from "../api/editor";
import type { HitT } from "../api/types";

interface Props {
  opened: boolean;
  onClose: () => void;
  /** Open a repository path in a tab (the dialog stays open, like an IDE's search results). */
  onOpen: (path: string) => void;
}

/**
 * The search dialog of PLAN-rule-editor §5.3: free text over check + docs YAML (words ANDed,
 * quotes make a phrase) and the semantic filters — mentions variable (`AETERM` also finds `--TERM`
 * rules whose scope reaches AE), scoped to a domain / class, uses a function, status, standard +
 * version, has no scenarios — all through `GET /api/search`.
 */
export function SearchDialog({ opened, onClose, onOpen }: Props) {
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<SearchFilters>({});
  const [busy, setBusy] = useState(false);
  const [hits, setHits] = useState<HitT[] | null>(null);
  const [total, setTotal] = useState(0);
  const [truncated, setTruncated] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const q = query.trim();
    const filtering = Object.values(filters).some(
      (v) => v !== undefined && v !== "" && v !== false,
    );
    if (!q && !filtering) return;
    setBusy(true);
    setError(null);
    const result = await search(q, filters);
    setBusy(false);
    if (result.problem) {
      setHits(null);
      setError(result.problem.detail);
      return;
    }
    setHits(result.data.hits ?? []);
    setTotal(result.data.total ?? 0);
    setTruncated(result.data.truncated ?? false);
  }

  return (
    <Modal opened={opened} onClose={onClose} title="Search rules" size="xl">
      <Stack gap="sm">
        <form onSubmit={submit}>
          <Group gap="xs" wrap="nowrap">
            <TextInput
              style={{ flex: 1 }}
              placeholder='free text — words are ANDed, "quotes" make a phrase'
              aria-label="Search text"
              value={query}
              onChange={(e) => setQuery(e.currentTarget.value)}
              data-autofocus
            />
            <Button
              type="submit"
              loading={busy}
              disabled={!query.trim() && !Object.values(filters).some((v) => v && v !== "")}
            >
              Search
            </Button>
          </Group>
          <Group gap="xs" mt="xs" align="flex-end" wrap="wrap">
            <TextInput
              size="xs"
              label="mentions variable"
              aria-label="mentions variable"
              placeholder="AETERM"
              value={filters.variable ?? ""}
              onChange={(e) => setFilters({ ...filters, variable: e.currentTarget.value })}
              w={120}
            />
            <TextInput
              size="xs"
              label="scoped to"
              aria-label="scoped to"
              placeholder="AE or EVENTS"
              value={filters.scope ?? ""}
              onChange={(e) => setFilters({ ...filters, scope: e.currentTarget.value })}
              w={120}
            />
            <TextInput
              size="xs"
              label="uses function"
              aria-label="uses function"
              placeholder="var_label"
              value={filters.function ?? ""}
              onChange={(e) => setFilters({ ...filters, function: e.currentTarget.value })}
              w={120}
            />
            <TextInput
              size="xs"
              label="status"
              aria-label="status"
              placeholder="Published"
              value={filters.status ?? ""}
              onChange={(e) => setFilters({ ...filters, status: e.currentTarget.value })}
              w={100}
            />
            <TextInput
              size="xs"
              label="standard"
              aria-label="standard"
              placeholder="SDTMIG"
              value={filters.standard ?? ""}
              onChange={(e) => setFilters({ ...filters, standard: e.currentTarget.value })}
              w={100}
            />
            <TextInput
              size="xs"
              label="version"
              aria-label="version"
              placeholder="3.3"
              value={filters.version ?? ""}
              onChange={(e) => setFilters({ ...filters, version: e.currentTarget.value })}
              w={70}
            />
            <Checkbox
              size="xs"
              label="has no scenarios"
              checked={filters.noScenarios ?? false}
              onChange={(e) => setFilters({ ...filters, noScenarios: e.currentTarget.checked })}
            />
          </Group>
        </form>
        {error && (
          <Text c="red" size="sm">
            {error}
          </Text>
        )}
        {hits && (
          <>
            <Text size="xs" c="dimmed">
              {total} hit{total === 1 ? "" : "s"}
              {truncated ? " (showing the first ones — narrow the query)" : ""}
            </Text>
            <ScrollArea.Autosize mah="60vh" type="auto">
              <Stack gap="xs">
                {hits.map((hit) => (
                  <div key={hit.path}>
                    <Group gap="xs" wrap="nowrap">
                      <Anchor
                        component="button"
                        type="button"
                        onClick={() => hit.path && onOpen(hit.path)}
                        style={{ fontFamily: "var(--mantine-font-family-monospace)" }}
                      >
                        {hit.id}
                      </Anchor>
                      <Badge size="xs" variant="light">
                        {hit.family}
                      </Badge>
                      {hit.docsPath && (
                        <Anchor
                          component="button"
                          type="button"
                          size="xs"
                          onClick={() => hit.docsPath && onOpen(hit.docsPath)}
                        >
                          docs
                        </Anchor>
                      )}
                    </Group>
                    {hit.description && <Text size="sm">{hit.description}</Text>}
                    {(hit.snippets ?? []).map((s, i) => (
                      <Text
                        key={i}
                        size="xs"
                        c="dimmed"
                        style={{ fontFamily: "var(--mantine-font-family-monospace)" }}
                      >
                        {s.file}:{s.line} {s.text}
                      </Text>
                    ))}
                  </div>
                ))}
                {hits.length === 0 && (
                  <Text size="sm" c="dimmed">
                    Nothing found.
                  </Text>
                )}
              </Stack>
            </ScrollArea.Autosize>
          </>
        )}
      </Stack>
    </Modal>
  );
}
