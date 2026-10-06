import { describe, expect, it } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "./test/renderWithProviders";
import { fake } from "./test/handlers";
import App from "./App";

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
});
