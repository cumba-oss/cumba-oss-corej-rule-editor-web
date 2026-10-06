import { ActionIcon, Group, ScrollArea, Text, UnstyledButton } from "@mantine/core";
import { isDirty, type Tab } from "../state/tabs";

interface Props {
  tabs: Tab[];
  active: string | null;
  onActivate: (path: string) => void;
  /** Close a tab; the caller asks first when the tab is dirty. */
  onClose: (path: string) => void;
}

/**
 * The tab strip of PLAN-rule-editor §5.3: one tab per open file, a dirty marker (●), a close
 * button, middle-click closes.
 */
export function EditorTabs({ tabs, active, onActivate, onClose }: Props) {
  return (
    <ScrollArea type="never" scrollbars="x">
      <Group gap={0} wrap="nowrap" role="tablist" aria-label="open files">
        {tabs.map((tab) => {
          const dirty = isDirty(tab);
          const selected = tab.path === active;
          return (
            <Group
              key={tab.path}
              gap={2}
              wrap="nowrap"
              px="xs"
              py={4}
              role="tab"
              aria-selected={selected}
              aria-label={tab.title}
              data-dirty={dirty || undefined}
              onClick={() => onActivate(tab.path)}
              onAuxClick={(e) => {
                if (e.button === 1) onClose(tab.path);
              }}
              style={{
                borderBottom: selected
                  ? "2px solid var(--mantine-primary-color-filled)"
                  : "2px solid transparent",
                background: selected ? "var(--mantine-color-default-hover)" : undefined,
                whiteSpace: "nowrap",
              }}
            >
              <UnstyledButton title={tab.path}>
                <Text size="sm" fw={selected ? 600 : 400}>
                  {dirty ? "● " : ""}
                  {tab.title}
                </Text>
              </UnstyledButton>
              <ActionIcon
                size="xs"
                variant="subtle"
                color="gray"
                aria-label={`close ${tab.title}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onClose(tab.path);
                }}
              >
                ×
              </ActionIcon>
            </Group>
          );
        })}
      </Group>
    </ScrollArea>
  );
}
