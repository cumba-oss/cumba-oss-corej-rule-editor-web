import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { renderWithProviders } from "../test/renderWithProviders";
import { server } from "../test/server";
import { SearchDialog } from "./SearchDialog";

describe("SearchDialog", () => {
  it("searches the corpus and opens a hit or its docs", async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    renderWithProviders(<SearchDialog opened onClose={vi.fn()} onOpen={onOpen} />);
    expect(screen.getByRole("button", { name: "Search" })).toBeDisabled();
    await user.type(screen.getByLabelText("Search text"), "CG0270");
    await user.click(screen.getByRole("button", { name: "Search" }));
    expect(await screen.findByText("1 hit")).toBeInTheDocument();
    expect(screen.getByText(/check:2/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "CDISC-CG0270" }));
    expect(onOpen).toHaveBeenCalledWith("rules-src/checks/CDISC/CDISC-CG0270.yaml");
    await user.click(screen.getByRole("button", { name: "docs" }));
    expect(onOpen).toHaveBeenCalledWith("rules-src/docs/CDISC/CDISC-CG0270.yaml");
  });

  it("says when nothing matches, and reports a server problem", async () => {
    const user = userEvent.setup();
    renderWithProviders(<SearchDialog opened onClose={vi.fn()} onOpen={vi.fn()} />);
    await user.type(screen.getByLabelText("Search text"), "nothing-here");
    await user.click(screen.getByRole("button", { name: "Search" }));
    expect(await screen.findByText("Nothing found.")).toBeInTheDocument();
    expect(screen.getByText("0 hits")).toBeInTheDocument();
    server.use(
      http.get("/api/search", () =>
        HttpResponse.json(
          { status: 500, detail: "index exploded", code: "INTERNAL" },
          { status: 500 },
        ),
      ),
    );
    await user.click(screen.getByRole("button", { name: "Search" }));
    expect(await screen.findByText("index exploded")).toBeInTheDocument();
    expect(screen.queryByText("0 hits")).not.toBeInTheDocument();
  });

  it("marks a truncated result", async () => {
    const user = userEvent.setup();
    server.use(
      http.get("/api/search", () =>
        HttpResponse.json({
          query: "x",
          hits: [{ id: "A-1", family: "A", path: "rules-src/checks/A/A-1.yaml" }],
          total: 500,
          truncated: true,
        }),
      ),
    );
    renderWithProviders(<SearchDialog opened onClose={vi.fn()} onOpen={vi.fn()} />);
    await user.type(screen.getByLabelText("Search text"), "x");
    await user.click(screen.getByRole("button", { name: "Search" }));
    expect(await screen.findByText(/500 hits \(showing the first ones/)).toBeInTheDocument();
  });
});

describe("SearchDialog — semantic filters (phase 3)", () => {
  it("sends the filters as query parameters, and searches on filters alone", async () => {
    const user = userEvent.setup();
    const { fake } = await import("../test/handlers");
    renderWithProviders(<SearchDialog opened onClose={vi.fn()} onOpen={vi.fn()} />);
    await user.type(screen.getByLabelText("mentions variable"), "AETERM");
    await user.type(screen.getByLabelText("scoped to"), "AE");
    await user.type(screen.getByLabelText("uses function"), "var_label");
    await user.type(screen.getByLabelText("status"), "Published");
    await user.type(screen.getByLabelText("standard"), "SDTMIG");
    await user.type(screen.getByLabelText("version"), "3.3");
    await user.click(screen.getByRole("checkbox", { name: "has no scenarios" }));
    expect(screen.getByRole("button", { name: "Search" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "Search" }));
    await screen.findByText(/hits?$/);
    expect(fake.searches.at(-1)).toEqual({
      q: "",
      limit: "100",
      variable: "AETERM",
      scope: "AE",
      function: "var_label",
      status: "Published",
      standard: "SDTMIG",
      version: "3.3",
      noScenarios: "true",
    });
  });
});
