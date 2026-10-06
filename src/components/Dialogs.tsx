import { useState } from "react";
import { Anchor, Button, Group, List, Modal, Stack, Text, Textarea } from "@mantine/core";
import type { ChangedFileT, CommitInfoT, SessionInfoT } from "../api/types";
import { LoginForm } from "./LoginForm";

/** A list of changed files, as the dialogs name them. */
function FileList({ files }: { files: ChangedFileT[] }) {
  return (
    <List size="sm" spacing={2}>
      {files.map((f) => (
        <List.Item key={f.path}>
          <Text span style={{ fontFamily: "var(--mantine-font-family-monospace)" }}>
            {f.path}
          </Text>
          <Text span c="dimmed" size="xs">
            {" "}
            {f.kind?.toLowerCase()}
          </Text>
        </List.Item>
      ))}
    </List>
  );
}

function CommitList({ commits }: { commits: CommitInfoT[] }) {
  return (
    <List size="sm" spacing={2}>
      {commits.map((c) => (
        <List.Item key={c.sha}>
          <Text span style={{ fontFamily: "var(--mantine-font-family-monospace)" }}>
            {c.sha?.slice(0, 7)}
          </Text>{" "}
          {c.message?.split("\n")[0]}
        </List.Item>
      ))}
    </List>
  );
}

// ---- "Push now?" after a save (§5.2) ---------------------------------------------------------

interface PushNowProps {
  opened: boolean;
  /** Message pre-filled from the changed rule ids. */
  suggestedMessage: string;
  onCommitPush: (message: string) => void;
  onLater: () => void;
}

export function PushNowDialog({ opened, suggestedMessage, onCommitPush, onLater }: PushNowProps) {
  // The body is mounted only while the modal is open (Mantine unmounts closed content), so the
  // message state initialises from the suggestion on every open without an effect.
  return (
    <Modal opened={opened} onClose={onLater} title="Saved — push now?">
      <PushNowBody
        suggestedMessage={suggestedMessage}
        onCommitPush={onCommitPush}
        onLater={onLater}
      />
    </Modal>
  );
}

function PushNowBody({ suggestedMessage, onCommitPush, onLater }: Omit<PushNowProps, "opened">) {
  const [message, setMessage] = useState(suggestedMessage);
  return (
    <>
      <Stack gap="sm">
        <Text size="sm">
          The file is written to your workspace. Commit and push it now, or keep editing and push
          later from the header.
        </Text>
        <Textarea
          label="Commit message"
          rows={3}
          value={message}
          onChange={(e) => setMessage(e.currentTarget.value)}
        />
        <Group justify="flex-end">
          <Button variant="default" onClick={onLater}>
            Later
          </Button>
          <Button onClick={() => onCommitPush(message)} disabled={!message.trim()}>
            Commit + Push
          </Button>
        </Group>
      </Stack>
    </>
  );
}

// ---- Commit + Push (header button) -----------------------------------------------------------

export interface CommitPushOutcome {
  pullRequestUrl?: string;
  /** The push was rejected as non-fast-forward: offer "Update from remote branch". */
  nonFastForward?: boolean;
  error?: string;
}

interface CommitPushProps {
  opened: boolean;
  onClose: () => void;
  uncommitted: ChangedFileT[];
  unpushed: CommitInfoT[];
  suggestedMessage: string;
  /** Commits (when there is something to commit) and pushes; resolves with what to show. */
  onCommitPush: (message: string) => Promise<CommitPushOutcome>;
  onUpdateFromRemote: () => Promise<boolean>;
}

export function CommitPushDialog({ opened, onClose, ...body }: CommitPushProps) {
  // Body mounted per open (see PushNowDialog): message and outcome start fresh each time.
  return (
    <Modal opened={opened} onClose={onClose} title="Commit + Push">
      <CommitPushBody onClose={onClose} {...body} />
    </Modal>
  );
}

function CommitPushBody({
  onClose,
  uncommitted,
  unpushed,
  suggestedMessage,
  onCommitPush,
  onUpdateFromRemote,
}: Omit<CommitPushProps, "opened">) {
  const [message, setMessage] = useState(suggestedMessage);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<CommitPushOutcome | null>(null);

  const needsMessage = uncommitted.length > 0;

  async function run() {
    setBusy(true);
    setOutcome(await onCommitPush(message));
    setBusy(false);
  }

  async function update() {
    setBusy(true);
    const ok = await onUpdateFromRemote();
    setBusy(false);
    if (ok) setOutcome(null);
  }

  return (
    <>
      <Stack gap="sm">
        {uncommitted.length > 0 && (
          <>
            <Text size="sm" fw={600}>
              Saved, not committed
            </Text>
            <FileList files={uncommitted} />
          </>
        )}
        {unpushed.length > 0 && (
          <>
            <Text size="sm" fw={600}>
              Committed, not pushed
            </Text>
            <CommitList commits={unpushed} />
          </>
        )}
        {needsMessage && (
          <Textarea
            label="Commit message"
            rows={3}
            value={message}
            onChange={(e) => setMessage(e.currentTarget.value)}
          />
        )}
        {outcome?.error && (
          <Text c="red" size="sm">
            {outcome.error}
          </Text>
        )}
        {outcome?.nonFastForward && (
          <Group>
            <Button variant="light" onClick={update} loading={busy}>
              Update from remote branch
            </Button>
          </Group>
        )}
        {outcome?.pullRequestUrl && (
          <Text size="sm">
            Pushed.{" "}
            <Anchor href={outcome.pullRequestUrl} target="_blank" rel="noreferrer">
              Create a pull request
            </Anchor>
          </Text>
        )}
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            {outcome?.pullRequestUrl ? "Close" : "Cancel"}
          </Button>
          {!outcome?.pullRequestUrl && (
            <Button
              onClick={run}
              loading={busy}
              disabled={(needsMessage && !message.trim()) || (!needsMessage && !unpushed.length)}
            >
              {needsMessage ? "Commit + Push" : "Push"}
            </Button>
          )}
        </Group>
      </Stack>
    </>
  );
}

// ---- Dirty tree on a branch switch / update (§5.2) --------------------------------------------

interface DirtyTreeProps {
  opened: boolean;
  files: ChangedFileT[];
  onCommitLocally: (message: string) => Promise<boolean>;
  /** Discards the saved changes of exactly `files`; resolves true when they are gone. */
  onDiscard: () => Promise<boolean>;
  onCancel: () => void;
}

/**
 * Branch switch and update need a CLEAN working tree (JGit carries changes across). The dialog
 * names the uncommitted files and offers *Commit locally* / *Discard* / *Cancel* (§5.2).
 * *Discard* asks again, naming every file whose saved changes will be lost, before it acts.
 */
export function DirtyTreeDialog({
  opened,
  files,
  onCommitLocally,
  onDiscard,
  onCancel,
}: DirtyTreeProps) {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  async function commit() {
    setBusy(true);
    const ok = await onCommitLocally(message);
    setBusy(false);
    if (ok) setMessage("");
  }
  async function discard() {
    setBusy(true);
    const ok = await onDiscard();
    setBusy(false);
    if (ok) setConfirming(false);
  }
  function cancel() {
    setConfirming(false);
    onCancel();
  }
  const count = `${files.length} file${files.length === 1 ? "" : "s"}`;
  return (
    <Modal
      opened={opened}
      onClose={cancel}
      title={confirming ? "Discard saved changes?" : "Uncommitted changes"}
    >
      {confirming ? (
        <Stack gap="sm">
          <Text size="sm">
            The saved, uncommitted changes of these {count} will be lost: changed files go back to
            the last commit, new files are deleted. Open tabs of these files reload, so unsaved
            edits in them are lost too. This cannot be undone.
          </Text>
          <FileList files={files} />
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setConfirming(false)} disabled={busy}>
              Back
            </Button>
            <Button color="red" onClick={discard} loading={busy}>
              Discard {count}
            </Button>
          </Group>
        </Stack>
      ) : (
        <Stack gap="sm">
          <Text size="sm">
            Switching or updating needs a clean working tree, and these files hold saved,
            uncommitted changes. Commit them locally on the current branch first, discard them, or
            cancel.
          </Text>
          <FileList files={files} />
          <Textarea
            label="Commit message"
            rows={3}
            value={message}
            onChange={(e) => setMessage(e.currentTarget.value)}
          />
          <Group justify="flex-end">
            <Button variant="default" onClick={cancel}>
              Cancel
            </Button>
            <Button
              color="red"
              variant="light"
              onClick={() => setConfirming(true)}
              disabled={busy || files.length === 0}
            >
              Discard…
            </Button>
            <Button onClick={commit} loading={busy} disabled={!message.trim()}>
              Commit locally
            </Button>
          </Group>
        </Stack>
      )}
    </Modal>
  );
}

// ---- Leaving with work behind (§5.2 exit guard) ----------------------------------------------

interface LeaveProps {
  opened: boolean;
  title: string;
  /** What the user is about to do, e.g. "log out" or "switch to feature/x". */
  action: string;
  unsaved: string[];
  uncommitted: ChangedFileT[];
  unpushed: CommitInfoT[];
  onConfirm: () => void;
  onCancel: () => void;
}

/** Names the unsaved buffers, uncommitted files and unpushed commits that would be left behind. */
export function LeaveDialog({
  opened,
  title,
  action,
  unsaved,
  uncommitted,
  unpushed,
  onConfirm,
  onCancel,
}: LeaveProps) {
  return (
    <Modal opened={opened} onClose={onCancel} title={title}>
      <Stack gap="sm">
        {unsaved.length > 0 && (
          <>
            <Text size="sm" fw={600}>
              Unsaved buffers — their edits will be lost
            </Text>
            <List size="sm" spacing={2}>
              {unsaved.map((p) => (
                <List.Item key={p}>
                  <Text span style={{ fontFamily: "var(--mantine-font-family-monospace)" }}>
                    {p}
                  </Text>
                </List.Item>
              ))}
            </List>
          </>
        )}
        {uncommitted.length > 0 && (
          <>
            <Text size="sm" fw={600}>
              Saved, not committed — they stay in your workspace
            </Text>
            <FileList files={uncommitted} />
          </>
        )}
        {unpushed.length > 0 && (
          <>
            <Text size="sm" fw={600}>
              Committed, not pushed — they stay in your workspace
            </Text>
            <CommitList commits={unpushed} />
          </>
        )}
        <Group justify="flex-end">
          <Button variant="default" onClick={onCancel}>
            Cancel
          </Button>
          <Button color="red" onClick={onConfirm}>
            {action}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

// ---- Session expired mid-edit (§5.2, review L4) ----------------------------------------------

interface ReauthProps {
  opened: boolean;
  loginName: string;
  onLoggedIn: (session: SessionInfoT) => void;
  onCancel: () => void;
}

/** A 401 on Save keeps every buffer in the browser; this dialog re-authenticates, then the save retries. */
export function ReauthDialog({ opened, loginName, onLoggedIn, onCancel }: ReauthProps) {
  return (
    <Modal opened={opened} onClose={onCancel} title="Session expired">
      <Stack gap="sm">
        <Text size="sm">
          Your session expired. Your buffers are kept — log in again and the save is retried.
        </Text>
        <LoginForm
          initialLogin={loginName}
          onLoggedIn={onLoggedIn}
          submitLabel="Log in and retry"
        />
      </Stack>
    </Modal>
  );
}

// ---- Closing a dirty tab (§5.3) --------------------------------------------------------------

interface CloseTabProps {
  path: string | null;
  onDiscard: () => void;
  onCancel: () => void;
}

export function CloseDirtyTabDialog({ path, onDiscard, onCancel }: CloseTabProps) {
  return (
    <Modal opened={path !== null} onClose={onCancel} title="Close without saving?">
      <Stack gap="sm">
        <Text size="sm">
          <Text span style={{ fontFamily: "var(--mantine-font-family-monospace)" }}>
            {path}
          </Text>{" "}
          has unsaved edits.
        </Text>
        <Group justify="flex-end">
          <Button variant="default" onClick={onCancel}>
            Keep editing
          </Button>
          <Button color="red" onClick={onDiscard}>
            Close and discard
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
