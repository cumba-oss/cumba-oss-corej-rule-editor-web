import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "../test/renderWithProviders";
import { ThemeToggle } from "./ThemeToggle";

/** The OS preference seen by Mantine (the provider) and by the toggle (`useColorScheme`). */
function os(prefersDark: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: prefersDark && query.includes("dark"),
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

describe("ThemeToggle", () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(() => {
    vi.unstubAllGlobals();
    window.localStorage.clear();
  });

  it("flips light → dark and stores the choice when it differs from the OS", async () => {
    os(false);
    const user = userEvent.setup();
    renderWithProviders(<ThemeToggle />);
    const button = screen.getByRole("button", { name: "Switch to dark mode" });
    await user.click(button);
    await waitFor(() =>
      expect(document.documentElement.getAttribute("data-mantine-color-scheme")).toBe("dark"),
    );
    expect(window.localStorage.getItem("cumba-theme")).toBe("dark");
    expect(screen.getByRole("button", { name: "Switch to light mode" })).toBeInTheDocument();
  });

  it("goes back to following the OS (auto) when the choice equals the OS preference", async () => {
    os(false);
    window.localStorage.setItem("cumba-theme", "dark");
    const user = userEvent.setup();
    renderWithProviders(<ThemeToggle />);
    await user.click(screen.getByRole("button", { name: "Switch to light mode" }));
    await waitFor(() => expect(window.localStorage.getItem("cumba-theme")).toBe("auto"));
    expect(document.documentElement.getAttribute("data-mantine-color-scheme")).toBe("light");
    expect(screen.getByRole("button", { name: "Switch to dark mode" })).toBeInTheDocument();
  });

  it("on a dark OS: dark → light is stored, light → dark is auto again", async () => {
    os(true);
    const user = userEvent.setup();
    renderWithProviders(<ThemeToggle />);
    // auto + dark OS ⇒ computed dark ⇒ the sun is offered
    await user.click(screen.getByRole("button", { name: "Switch to light mode" }));
    await waitFor(() => expect(window.localStorage.getItem("cumba-theme")).toBe("light"));
    await user.click(screen.getByRole("button", { name: "Switch to dark mode" }));
    await waitFor(() => expect(window.localStorage.getItem("cumba-theme")).toBe("auto"));
  });
});
