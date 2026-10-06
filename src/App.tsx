import { useEffect, useState } from "react";
import { Center, Loader } from "@mantine/core";
import * as editor from "./api/editor";
import type { ServiceInfoT, SessionInfoT } from "./api/types";
import { EditorShell } from "./components/EditorShell";
import { LoginView } from "./components/LoginView";

/**
 * Session gate: `GET /api/info` names the bound repository, `GET /api/session` says whether a
 * session exists (401 ⇒ the login page). Anonymous read (an opt-in for public repositories) is
 * not surfaced by the SPA in phase 2 — the editor is a logged-in tool.
 */
export default function App() {
  const [info, setInfo] = useState<ServiceInfoT | null>(null);
  const [session, setSession] = useState<SessionInfoT | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([editor.info(), editor.session()]).then(([i, s]) => {
      if (cancelled) return;
      if (!i.problem) setInfo(i.data);
      if (!s.problem) setSession(s.data);
      setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!ready) {
    return (
      <Center mih="100vh">
        <Loader />
      </Center>
    );
  }
  if (!session) {
    return <LoginView info={info} onLoggedIn={setSession} />;
  }
  return (
    <EditorShell
      key={session.id}
      info={info}
      session={session}
      onSession={setSession}
      onLoggedOut={() => setSession(null)}
    />
  );
}
