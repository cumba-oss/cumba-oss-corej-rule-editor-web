import { useState, type FormEvent } from "react";
import { Alert, Button, PasswordInput, Stack, Text, TextInput } from "@mantine/core";
import { login } from "../api/editor";
import type { ProblemError } from "../api/client";
import type { SessionInfoT } from "../api/types";

interface Props {
  /** Pre-filled login name (re-authentication keeps the name, never the token). */
  initialLogin?: string;
  onLoggedIn: (session: SessionInfoT) => void;
  submitLabel?: string;
}

/** Why a login was refused, worded from the problem code (rest README § The API). */
export function loginProblemText(problem: ProblemError): string {
  switch (problem.code) {
    case "FORGE_REFUSED":
      return "The forge refused the token, or it cannot read the repository.";
    case "FORGE_UNAVAILABLE":
      return "The forge did not answer — try again later.";
    case "CSRF":
      return "The session token expired — reload the page and try again.";
    default:
      return problem.detail;
  }
}

/**
 * Login name + personal access token (PLAN-rule-editor §5.1.2). The token goes to the server
 * once, over the same origin, and lives only in the server-side session.
 */
export function LoginForm({ initialLogin = "", onLoggedIn, submitLabel = "Log in" }: Props) {
  const [loginName, setLoginName] = useState(initialLogin);
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const result = await login(loginName.trim(), token);
    setBusy(false);
    if (result.problem) {
      setError(loginProblemText(result.problem));
      return;
    }
    setToken("");
    onLoggedIn(result.data);
  }

  return (
    <form onSubmit={submit} aria-label="login">
      <Stack gap="sm">
        <TextInput
          label="Login name"
          value={loginName}
          onChange={(e) => setLoginName(e.currentTarget.value)}
          autoComplete="username"
        />
        <PasswordInput
          label="Personal access token"
          description="A forge token that can read the repository; one that can push gives edit mode."
          value={token}
          onChange={(e) => setToken(e.currentTarget.value)}
          autoComplete="current-password"
        />
        {error && (
          <Alert color="red" title="Login refused">
            <Text size="sm">{error}</Text>
          </Alert>
        )}
        <Button type="submit" loading={busy} disabled={!loginName.trim() || !token}>
          {submitLabel}
        </Button>
      </Stack>
    </form>
  );
}
