import { describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "../test/renderWithProviders";
import { fake } from "../test/handlers";
import { LoginForm, loginProblemText } from "./LoginForm";
import { LoginView } from "./LoginView";

async function fillAndSubmit(loginName = "alice", token = "tok-123") {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("Login name"), loginName);
  await user.type(screen.getByLabelText("Personal access token"), token);
  await user.click(screen.getByRole("button", { name: "Log in" }));
  return user;
}

describe("LoginForm", () => {
  it("posts login + token with the CSRF header and hands back the session", async () => {
    const onLoggedIn = vi.fn();
    renderWithProviders(<LoginForm onLoggedIn={onLoggedIn} />);
    expect(screen.getByRole("button", { name: "Log in" })).toBeDisabled();
    await fillAndSubmit();
    await waitFor(() => expect(onLoggedIn).toHaveBeenCalled());
    expect(onLoggedIn.mock.calls[0][0]).toMatchObject({ login: "alice", mode: "EDIT" });
    expect(fake.loginAttempts).toEqual([{ login: "alice", token: "tok-123" }]);
    expect(fake.mutations[0].csrf).toBe("csrf-1");
    // the token field is cleared once the token has done its job
    expect(screen.getByLabelText("Personal access token")).toHaveValue("");
  });

  it("explains a refused token and keeps the form", async () => {
    fake.loginAnswer = "FORGE_REFUSED";
    const onLoggedIn = vi.fn();
    renderWithProviders(<LoginForm onLoggedIn={onLoggedIn} />);
    await fillAndSubmit();
    expect(await screen.findByText(/refused the token/)).toBeInTheDocument();
    expect(onLoggedIn).not.toHaveBeenCalled();
  });

  it("explains an unreachable forge", async () => {
    fake.loginAnswer = "FORGE_UNAVAILABLE";
    renderWithProviders(<LoginForm onLoggedIn={vi.fn()} />);
    await fillAndSubmit();
    expect(await screen.findByText(/did not answer/)).toBeInTheDocument();
  });

  it("pre-fills the login name and a custom submit label", () => {
    renderWithProviders(
      <LoginForm initialLogin="bob" onLoggedIn={vi.fn()} submitLabel="Log in and retry" />,
    );
    expect(screen.getByLabelText("Login name")).toHaveValue("bob");
    expect(screen.getByRole("button", { name: "Log in and retry" })).toBeInTheDocument();
  });
});

describe("loginProblemText", () => {
  it("words each problem code", () => {
    const base = { status: 401, detail: "d", extra: {} };
    expect(loginProblemText({ ...base, code: "FORGE_REFUSED" })).toMatch(/refused/);
    expect(loginProblemText({ ...base, code: "FORGE_UNAVAILABLE" })).toMatch(/did not answer/);
    expect(loginProblemText({ ...base, code: "CSRF" })).toMatch(/reload/);
    expect(loginProblemText({ ...base, status: 429, code: "RATE_LIMITED" })).toBe(
      "Too many login attempts from here — wait a minute and try again.",
    );
    expect(loginProblemText({ ...base, code: "OTHER" })).toBe("d");
  });
});

describe("LoginView", () => {
  it("names the bound repository and renders the form", () => {
    renderWithProviders(
      <LoginView
        info={{
          service: "s",
          version: "1.2.3",
          repository: { url: "https://x/y/z.git", owner: "cumba", name: "rules", forge: "gitea" },
        }}
        onLoggedIn={vi.fn()}
      />,
    );
    expect(screen.getByRole("link", { name: "cumba/rules" })).toHaveAttribute(
      "href",
      "https://x/y/z.git",
    );
    expect(screen.getByText(/editor 1\.2\.3/)).toBeInTheDocument();
    expect(screen.getByRole("form", { name: "login" })).toBeInTheDocument();
  });

  it("renders without service info", () => {
    renderWithProviders(<LoginView info={null} onLoggedIn={vi.fn()} />);
    expect(screen.queryByText(/Bound to/)).not.toBeInTheDocument();
  });
});
