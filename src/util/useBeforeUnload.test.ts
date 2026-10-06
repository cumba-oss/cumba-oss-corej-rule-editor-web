import { describe, expect, it } from "vitest";
import { renderHook } from "@testing-library/react";
import { useBeforeUnload } from "./useBeforeUnload";

function fireBeforeUnload(): boolean {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}

describe("useBeforeUnload", () => {
  it("blocks unload only while active, and unregisters on unmount", () => {
    const { rerender, unmount } = renderHook(({ active }) => useBeforeUnload(active), {
      initialProps: { active: false },
    });
    expect(fireBeforeUnload()).toBe(false);
    rerender({ active: true });
    expect(fireBeforeUnload()).toBe(true);
    rerender({ active: false });
    expect(fireBeforeUnload()).toBe(false);
    rerender({ active: true });
    unmount();
    expect(fireBeforeUnload()).toBe(false);
  });
});
