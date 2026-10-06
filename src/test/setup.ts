import "@testing-library/jest-dom/vitest";
import { afterAll, afterEach, beforeAll, beforeEach, vi } from "vitest";
import { server } from "./server";
import { fake } from "./handlers";
import { notifications } from "@mantine/notifications";
import { resetCsrf } from "../api/client";

// jsdom does not implement matchMedia; Mantine's color-scheme + responsive
// hooks call it on mount. Provide an inert stub so components render.
Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }),
});

// jsdom lacks ResizeObserver; Mantine's ScrollArea constructs one on mount.
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
window.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;

// CodeMirror measures text through Range geometry, which jsdom's Range lacks. Patch the
// prototype rather than replacing createRange: Mantine's ScrollArea needs a real Range (cloneRange).
const rect = { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 };
const proto = Range.prototype as unknown as Record<string, unknown>;
if (typeof proto.getClientRects !== "function") {
  proto.getClientRects = () => [] as unknown as DOMRectList;
}
if (typeof proto.getBoundingClientRect !== "function") {
  proto.getBoundingClientRect = () => rect;
}

// jsdom lacks scrollIntoView; Mantine's Select scrolls its selected option into view on opening.
if (typeof Element.prototype.scrollIntoView !== "function") {
  Element.prototype.scrollIntoView = () => {};
}

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
beforeEach(() => {
  fake.reset();
  resetCsrf();
});
afterEach(() => {
  server.resetHandlers();
  // The notifications store is module-global: without this, toasts from earlier tests pile up to
  // Mantine's visible limit and a later test's toast waits in the queue, unrendered.
  notifications.clean();
  notifications.cleanQueue();
});
afterAll(() => server.close());
