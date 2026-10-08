import { useEffect, useRef, useState } from "react";
import { Center, Loader } from "@mantine/core";
import * as editor from "./api/editor";
import type { ServiceInfoT, SessionInfoT } from "./api/types";
import { EditorShell } from "./components/EditorShell";
import { LoginView } from "./components/LoginView";

/** How often the SPA re-reads `/api/info` while the server seeds its metadata store. */
export const SEEDING_POLL_MS = 5000;

/**
 * Whether the server is seeding its metadata store (`engine.seeding`: the first seed or a re-seed,
 * with or without an open store) — then the info is re-read until the seed ends, so the notice
 * follows it without a reload: the "no store" notice goes away, a failed seed's status shows.
 */
export function storeSeeding(info: ServiceInfoT | null): boolean {
  return info?.engine?.seeding === true;
}

/**
 * Request ids for answers that may arrive out of order: `next()` numbers a request, `accept(id)`
 * takes its answer only when no later request's answer was taken already.
 */
export function requestOrder() {
  let issued = 0;
  let accepted = 0;
  return {
    next: () => ++issued,
    accept: (id: number) => {
      if (id <= accepted) return false;
      accepted = id;
      return true;
    },
  };
}

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

  const seeding = storeSeeding(info);
  const order = useRef(requestOrder());
  useEffect(() => {
    if (!seeding) return undefined;
    // an answer that lands after the poll stopped, or after a later poll's answer, is stale
    let cancelled = false;
    const timer = setInterval(() => {
      const id = order.current.next();
      void editor.info().then((i) => {
        if (cancelled || !order.current.accept(id)) return;
        if (!i.problem) setInfo(i.data);
      });
    }, SEEDING_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [seeding]);

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
