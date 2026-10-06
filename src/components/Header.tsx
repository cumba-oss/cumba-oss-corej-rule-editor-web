import { Badge, Button, Group, Text, Tooltip } from "@mantine/core";
import type { ServiceInfoT, SessionInfoT, StatusT } from "../api/types";
import { BrandMark } from "../brand/BrandMark";
import { ThemeToggle } from "../brand/ThemeToggle";
import { useBrand } from "../brand/useBrand";

interface Props {
  info: ServiceInfoT | null;
  session: SessionInfoT;
  status: StatusT | null;
  /** Unsaved buffers, for the badge. */
  unsavedCount: number;
  onOpenBranches: () => void;
  onCommitPush: () => void;
  onLogout: () => void;
}

/** Uncommitted saved files + unpushed commits — what Commit + Push would carry (§5.2). */
export function pendingCount(status: StatusT | null): number {
  if (!status) return 0;
  return (status.uncommitted?.length ?? 0) + (status.unpushed?.aheadCount ?? 0);
}

/**
 * The header of PLAN-rule-editor §5.3: [brand logo · kicker] repo · branch ▾ · mode ·
 * [Commit + Push (n)] · user · Log out · light/dark toggle. Commit + Push is hidden in read-only
 * mode — the server refuses it anyway (`403 READ_ONLY`). Logo and kicker come from the deployment's
 * brand (`/brand/brand.json`); the title is the app's own.
 */
export function Header({
  info,
  session,
  status,
  unsavedCount,
  onOpenBranches,
  onCommitPush,
  onLogout,
}: Props) {
  const readOnly = session.mode !== "EDIT";
  const pending = pendingCount(status);
  const repo = info?.repository;
  const brand = useBrand();
  return (
    <Group h="100%" px="md" justify="space-between" wrap="nowrap">
      <Group gap="sm" wrap="nowrap">
        <BrandMark brand={brand} />
        <Text fw={600}>{repo ? `${repo.owner}/${repo.name}` : "coreJ rule editor"}</Text>
        <Tooltip label="Switch or create a branch">
          <Button variant="light" size="xs" onClick={onOpenBranches} aria-label="branch">
            {status?.branch ?? "…"} ▾
          </Button>
        </Tooltip>
        <Badge color={readOnly ? "gray" : "green"} variant="light">
          {readOnly ? "read-only" : "edit"}
        </Badge>
        {unsavedCount > 0 && (
          <Badge color="orange" variant="light">
            {unsavedCount} unsaved
          </Badge>
        )}
      </Group>
      <Group gap="sm" wrap="nowrap">
        {!readOnly && (
          <Button size="xs" onClick={onCommitPush} disabled={pending === 0}>
            Commit + Push{pending > 0 ? ` (${pending})` : ""}
          </Button>
        )}
        <Text size="sm" c="dimmed">
          {session.name || session.login}
        </Text>
        <Button size="xs" variant="subtle" onClick={onLogout}>
          Log out
        </Button>
        <ThemeToggle />
      </Group>
    </Group>
  );
}
