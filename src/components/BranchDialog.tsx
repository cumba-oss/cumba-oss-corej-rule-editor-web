import { useEffect, useState } from "react";
import {
  Badge,
  Button,
  Group,
  Loader,
  Modal,
  ScrollArea,
  Stack,
  Text,
  TextInput,
  UnstyledButton,
} from "@mantine/core";
import { branches as fetchBranches } from "../api/editor";
import type { BranchInfoT, BranchesT } from "../api/types";

interface Props {
  opened: boolean;
  onClose: () => void;
  /** Edit mode: offers "New branch from default…" (the server refuses it otherwise). */
  canCreate: boolean;
  onSwitch: (name: string) => Promise<boolean>;
  onCreate: (name: string) => Promise<boolean>;
  onDelete: (name: string) => Promise<boolean>;
}

/** A branch name the server will accept: no spaces, no `..`, not blank. */
export function validBranchName(name: string): boolean {
  const n = name.trim();
  return n.length > 0 && !/\s/.test(n) && !n.includes("..") && !n.startsWith("-");
}

/**
 * The branch picker of PLAN-rule-editor §5.2: the user's local branches, the remote branches,
 * "New branch from default…". The default branch is listed but marked: it is not selectable for
 * writing (the server refuses commits and pushes to it, `409 DEFAULT_BRANCH`).
 */
export function BranchDialog({ opened, onClose, ...body }: Props) {
  // The body is mounted per open (Mantine unmounts closed modal content), so the branch list is
  // fetched fresh — with `fetch=true`, so remote branches are current — on every open.
  return (
    <Modal opened={opened} onClose={onClose} title="Branches" size="lg">
      <BranchBody onClose={onClose} {...body} />
    </Modal>
  );
}

function BranchBody({ onClose, canCreate, onSwitch, onCreate, onDelete }: Omit<Props, "opened">) {
  const [data, setData] = useState<BranchesT | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [newName, setNewName] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetchBranches(true).then((r) => {
      if (cancelled) return;
      if (r.problem) setError(r.problem.detail);
      else setData(r.data);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function run(action: () => Promise<boolean>) {
    setBusy(true);
    const done = await action();
    setBusy(false);
    if (done) onClose();
  }

  const list = data?.branches ?? [];
  const local = list.filter((b) => b.kind === "LOCAL");
  const remote = list.filter((b) => b.kind === "REMOTE");

  return (
    <>
      <Stack gap="sm">
        {error && (
          <Text c="red" size="sm">
            {error}
          </Text>
        )}
        {!data && !error && <Loader size="sm" />}
        {data && (
          <ScrollArea.Autosize mah="50vh" type="auto">
            <Stack gap="xs">
              <Text size="xs" c="dimmed" fw={600}>
                Local
              </Text>
              {local.map((b) => (
                <BranchRow
                  key={`local:${b.name}`}
                  branch={b}
                  busy={busy}
                  onSwitch={() => run(() => onSwitch(b.name ?? ""))}
                  onDelete={
                    canCreate && !b.current && !b.isDefault && !b.unpushed?.unpushed
                      ? () => run(() => onDelete(b.name ?? ""))
                      : undefined
                  }
                />
              ))}
              {local.length === 0 && (
                <Text size="xs" c="dimmed">
                  none
                </Text>
              )}
              <Text size="xs" c="dimmed" fw={600}>
                Remote
              </Text>
              {remote.map((b) => (
                <BranchRow
                  key={`remote:${b.name}`}
                  branch={b}
                  busy={busy}
                  onSwitch={() => run(() => onSwitch(b.name ?? ""))}
                />
              ))}
            </Stack>
          </ScrollArea.Autosize>
        )}
        {canCreate && (
          <Group gap="xs" wrap="nowrap" align="flex-end">
            <TextInput
              style={{ flex: 1 }}
              label={`New branch from ${data?.defaultBranch ?? "default"}`}
              placeholder="feature/CG0270-message"
              value={newName}
              onChange={(e) => setNewName(e.currentTarget.value)}
            />
            <Button
              disabled={!validBranchName(newName) || busy}
              onClick={() => run(() => onCreate(newName.trim()))}
            >
              Create
            </Button>
          </Group>
        )}
      </Stack>
    </>
  );
}

function BranchRow({
  branch,
  busy,
  onSwitch,
  onDelete,
}: {
  branch: BranchInfoT;
  busy: boolean;
  onSwitch: () => void;
  onDelete?: () => void;
}) {
  return (
    <Group gap="xs" wrap="nowrap" justify="space-between">
      <UnstyledButton
        onClick={onSwitch}
        disabled={busy || branch.current}
        aria-label={`switch to ${branch.name}`}
      >
        <Group gap="xs" wrap="nowrap">
          <Text size="sm" fw={branch.current ? 700 : 400}>
            {branch.name}
          </Text>
          {branch.current && (
            <Badge size="xs" variant="light">
              current
            </Badge>
          )}
          {branch.isDefault && (
            <Badge size="xs" variant="light" color="gray">
              default · read-only
            </Badge>
          )}
          {branch.unpushed?.unpushed && (
            <Badge size="xs" variant="light" color="orange">
              {branch.unpushed.aheadCount ?? "?"} unpushed
            </Badge>
          )}
        </Group>
      </UnstyledButton>
      {onDelete && (
        <Button size="compact-xs" variant="subtle" color="red" onClick={onDelete} disabled={busy}>
          delete
        </Button>
      )}
    </Group>
  );
}
