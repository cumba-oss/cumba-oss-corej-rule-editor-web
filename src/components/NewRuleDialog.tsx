import { useState } from "react";
import { Button, Group, Modal, Stack, Text, TextInput } from "@mantine/core";

interface Props {
  /** The family the rule goes into; `null` keeps the dialog closed. */
  family: string | null;
  existingIds: string[];
  onCreate: (family: string, id: string) => void;
  onCancel: () => void;
}

/** A rule id the corpus accepts: `<FAMILY>-<CODE>`, upper-case letters, digits, dashes. */
export function validRuleId(id: string, family: string): string | null {
  const v = id.trim();
  if (!v) return "Enter an id.";
  if (!/^[A-Z0-9][A-Z0-9-]*$/.test(v)) return "Use upper-case letters, digits and dashes.";
  if (!v.startsWith(`${family}-`)) return `Ids in ${family} start with ${family}-.`;
  if (v.length === family.length + 1) return "Add the code after the dash.";
  return null;
}

/** "New rule" from the family's context (PLAN-rule-editor §5.3): an id prompt, then a template tab. */
export function NewRuleDialog({ family, existingIds, onCreate, onCancel }: Props) {
  // The body is mounted only while open (Mantine unmounts closed modal content), so its id state
  // starts from the family prefix on every open without an effect.
  return (
    <Modal opened={family !== null} onClose={onCancel} title={`New rule in ${family ?? ""}`}>
      {family !== null && (
        <NewRuleBody
          family={family}
          existingIds={existingIds}
          onCreate={onCreate}
          onCancel={onCancel}
        />
      )}
    </Modal>
  );
}

function NewRuleBody({
  family: fam,
  existingIds,
  onCreate,
  onCancel,
}: Omit<Props, "family"> & { family: string }) {
  const [id, setId] = useState(`${fam}-`);
  const error = validRuleId(id, fam);
  const taken = existingIds.includes(id.trim());
  return (
    <>
      <Stack gap="sm">
        <TextInput
          label="Rule id"
          value={id}
          onChange={(e) => setId(e.currentTarget.value.toUpperCase())}
          error={taken ? "A rule with this id exists." : undefined}
          data-autofocus
        />
        {error && !taken && (
          <Text size="xs" c="dimmed">
            {error}
          </Text>
        )}
        <Group justify="flex-end">
          <Button variant="default" onClick={onCancel}>
            Cancel
          </Button>
          <Button disabled={error !== null || taken} onClick={() => onCreate(fam, id.trim())}>
            Create
          </Button>
        </Group>
      </Stack>
    </>
  );
}
