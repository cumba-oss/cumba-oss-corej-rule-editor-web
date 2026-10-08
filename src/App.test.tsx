import { afterEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "./test/renderWithProviders";
import { fake } from "./test/handlers";
import App, { requestOrder, SEEDING_POLL_MS, storeSeeding } from "./App";

describe("App", () => {
  it("shows the login page without a session, then the editor after login, then logs out", async () => {
    const user = userEvent.setup();
    fake.sessionOpen = false;
    renderWithProviders(<App />);
    expect(await screen.findByRole("form", { name: "login" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "cumba/cumba-corej-rules" })).toBeInTheDocument();
    await user.type(screen.getByLabelText("Login name"), "alice");
    await user.type(screen.getByLabelText("Personal access token"), "tok");
    await user.click(screen.getByRole("button", { name: "Log in" }));
    expect(await screen.findByRole("button", { name: "branch" })).toHaveTextContent("feature/x");
    await user.click(screen.getByRole("button", { name: "Log out" }));
    expect(await screen.findByRole("form", { name: "login" })).toBeInTheDocument();
    expect(fake.sessionOpen).toBe(false);
  });

  it("resumes an existing session straight into the editor", async () => {
    renderWithProviders(<App />);
    expect(await screen.findByRole("button", { name: "branch" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText("family CDISC")).toBeInTheDocument());
  });

  describe("while the server seeds its metadata store", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it("tells seeding by the engine's seeding flag, never by the reason's prose", () => {
      const info = (engine: object) => ({ engine: { languageLevel: 1, ...engine } }) as never;
      expect(storeSeeding(info({ storeAvailable: false, seeding: true }))).toBe(true);
      // a re-seed with the old store still open polls too
      expect(storeSeeding(info({ storeAvailable: true, seeding: true }))).toBe(true);
      expect(
        storeSeeding(
          info({ storeAvailable: false, seeding: false, storeReason: "store is being seeded" }),
        ),
      ).toBe(false);
      expect(storeSeeding(info({ storeAvailable: true }))).toBe(false);
      expect(storeSeeding(null)).toBe(false);
    });

    it("takes the answers of out-of-order requests in request order only", () => {
      const order = requestOrder();
      const first = order.next();
      const second = order.next();
      expect(second).toBeGreaterThan(first);
      expect(order.accept(second)).toBe(true);
      expect(order.accept(first)).toBe(false); // older than one already taken
      expect(order.accept(order.next())).toBe(true);
    });

    it("re-reads the info until the store opens, and the notice goes away without a reload", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      fake.engine.info.storeAvailable = false;
      fake.engine.info.storeReason = "metadata store is being seeded (GITHUB_PKL v0.17.1)…";
      fake.engine.info.seeding = true;
      fake.engine.info.seedStatus = "seeding (GITHUB_PKL v0.17.1)…";
      renderWithProviders(<App />);
      const note = await screen.findByRole("note");
      expect(note).toHaveTextContent("being seeded");
      // the reason already says it: the seed status is not repeated without a store
      expect(note).not.toHaveTextContent("Metadata store seed:");
      fake.engine.info.storeAvailable = true;
      fake.engine.info.storeReason = "";
      fake.engine.info.seeding = false;
      fake.engine.info.seedStatus = "";
      await vi.advanceTimersByTimeAsync(SEEDING_POLL_MS);
      await waitFor(() => expect(screen.queryByRole("note")).not.toBeInTheDocument());
    });

    it("shows a failed re-seed while the old store stays open", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      fake.engine.info.seeding = true;
      fake.engine.info.seedStatus = "seeding (GITHUB_PKL v0.18.0)…";
      renderWithProviders(<App />);
      expect(await screen.findByRole("note")).toHaveTextContent(
        "Metadata store seed: seeding (GITHUB_PKL v0.18.0)…",
      );
      expect(screen.getByRole("note")).not.toHaveTextContent("No metadata store");
      fake.engine.info.seeding = false;
      fake.engine.info.seedStatus = "seed failed (GITHUB_PKL v0.18.0): HTTP 404";
      await vi.advanceTimersByTimeAsync(SEEDING_POLL_MS);
      await waitFor(() =>
        expect(screen.getByRole("note")).toHaveTextContent(
          "Metadata store seed: seed failed (GITHUB_PKL v0.18.0): HTTP 404",
        ),
      );
    });
  });
});
