import { useEffect } from "react";

/**
 * The browser half of the exit guard (PLAN-rule-editor §5.2): while `active`, leaving the page
 * triggers the browser's generic "unsaved changes" prompt. The browser shows only its own text,
 * so the in-app dialogs (logout, branch switch) are what name the files and commits.
 */
export function useBeforeUnload(active: boolean): void {
  useEffect(() => {
    if (!active) return undefined;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // Legacy browsers read returnValue; modern ones only need preventDefault.
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [active]);
}
