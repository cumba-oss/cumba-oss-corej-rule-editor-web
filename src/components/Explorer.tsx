import { useMemo, useState } from "react";
import {
  ActionIcon,
  Badge,
  Group,
  Loader,
  ScrollArea,
  Stack,
  Text,
  TextInput,
  Tooltip,
  UnstyledButton,
} from "@mantine/core";
import type { ExplorerTreeT, FamilyT, RuleT } from "../api/types";

interface Props {
  tree: ExplorerTreeT | null;
  /** Open a repository path in a tab. */
  onOpen: (path: string) => void;
  /** Open the search dialog (the magnifier). */
  onSearch: () => void;
  /** New rule in a family (hidden in read-only mode when undefined). */
  onNewRule?: (family: string) => void;
}

/** Case-insensitive name filter over the families' rules; a family with no match disappears. */
export function filterFamilies(families: FamilyT[], filter: string): FamilyT[] {
  const needle = filter.trim().toLowerCase();
  if (!needle) return families;
  return families
    .map((f) => ({
      ...f,
      rules: (f.rules ?? []).filter((r) => (r.id ?? "").toLowerCase().includes(needle)),
    }))
    .filter((f) => f.rules.length > 0);
}

/**
 * The Explorer of PLAN-rule-editor §5.3 (O3): families → rules, with ONLY a name filter and a
 * magnifier on top; modified / new markers from the server's `git status`.
 */
export function Explorer({ tree, onOpen, onSearch, onNewRule }: Props) {
  const [filter, setFilter] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const families = useMemo(() => filterFamilies(tree?.families ?? [], filter), [tree, filter]);
  const filtering = filter.trim().length > 0;

  return (
    <Stack gap="xs" h="100%" style={{ minHeight: 0 }}>
      <Group gap="xs" wrap="nowrap" px="xs" pt="xs">
        <TextInput
          size="xs"
          placeholder="Filter rules by name"
          aria-label="Filter rules by name"
          value={filter}
          onChange={(e) => setFilter(e.currentTarget.value)}
          style={{ flex: 1 }}
        />
        <Tooltip label="Search rules…">
          <ActionIcon variant="light" onClick={onSearch} aria-label="Search rules">
            🔍
          </ActionIcon>
        </Tooltip>
      </Group>
      <ScrollArea style={{ flex: 1, minHeight: 0 }} type="auto">
        {!tree ? (
          <Group justify="center" p="md">
            <Loader size="sm" />
          </Group>
        ) : (
          <Stack gap={0} px="xs" pb="xs">
            {families.map((family) => {
              const name = family.name ?? "";
              const open = filtering || (expanded[name] ?? false);
              return (
                <div key={name}>
                  <Group gap="xs" wrap="nowrap" justify="space-between">
                    <UnstyledButton
                      onClick={() => setExpanded((e) => ({ ...e, [name]: !open }))}
                      aria-expanded={open}
                      aria-label={`family ${name}`}
                      style={{ flex: 1 }}
                    >
                      <Text size="sm" fw={600}>
                        {open ? "▾" : "▸"} {name}{" "}
                        <Text span c="dimmed" size="xs">
                          ({family.rules?.length ?? 0})
                        </Text>
                      </Text>
                    </UnstyledButton>
                    {onNewRule && (
                      <Tooltip label={`New rule in ${name}`}>
                        <ActionIcon
                          size="xs"
                          variant="subtle"
                          aria-label={`New rule in ${name}`}
                          onClick={() => onNewRule(name)}
                        >
                          +
                        </ActionIcon>
                      </Tooltip>
                    )}
                  </Group>
                  {open && (
                    <Stack gap={0} pl="md">
                      {(family.rules ?? []).map((rule) => (
                        <RuleRow key={rule.path} rule={rule} onOpen={onOpen} />
                      ))}
                    </Stack>
                  )}
                </div>
              );
            })}
            {families.length === 0 && (
              <Text size="xs" c="dimmed" p="xs">
                No rule matches.
              </Text>
            )}
          </Stack>
        )}
      </ScrollArea>
    </Stack>
  );
}

function RuleRow({ rule, onOpen }: { rule: RuleT; onOpen: (path: string) => void }) {
  const marker = rule.marker ?? "CLEAN";
  return (
    <UnstyledButton
      onClick={() => rule.path && onOpen(rule.path)}
      aria-label={`rule ${rule.id}`}
      py={1}
    >
      <Group gap={6} wrap="nowrap">
        <Text size="sm" style={{ fontFamily: "var(--mantine-font-family-monospace)" }}>
          {rule.id}
        </Text>
        {marker !== "CLEAN" && (
          <Badge size="xs" variant="light" color={marker === "NEW" ? "green" : "orange"}>
            {marker === "NEW" ? "new" : "modified"}
          </Badge>
        )}
      </Group>
    </UnstyledButton>
  );
}
