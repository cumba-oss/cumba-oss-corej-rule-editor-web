import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "../test/renderWithProviders";
import { NewRuleDialog, validRuleId } from "./NewRuleDialog";

describe("validRuleId", () => {
  it("requires the family prefix and the id alphabet", () => {
    expect(validRuleId("", "CDISC")).toMatch(/Enter/);
    expect(validRuleId("cdisc-x", "CDISC")).toMatch(/upper-case/);
    expect(validRuleId("FDA-X1", "CDISC")).toMatch(/start with CDISC-/);
    expect(validRuleId("CDISC-", "CDISC")).toMatch(/after the dash/);
    expect(validRuleId("CDISC-CG9999", "CDISC")).toBeNull();
  });
});

describe("NewRuleDialog", () => {
  it("starts from the family prefix, upper-cases input, refuses a taken id, creates", async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn();
    renderWithProviders(
      <NewRuleDialog
        family="CDISC"
        existingIds={["CDISC-CG0270"]}
        onCreate={onCreate}
        onCancel={vi.fn()}
      />,
    );
    const input = screen.getByLabelText("Rule id");
    expect(input).toHaveValue("CDISC-");
    expect(screen.getByRole("button", { name: "Create" })).toBeDisabled();
    await user.type(input, "cg0270");
    expect(input).toHaveValue("CDISC-CG0270");
    expect(screen.getByText("A rule with this id exists.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create" })).toBeDisabled();
    await user.type(input, "1");
    await user.click(screen.getByRole("button", { name: "Create" }));
    expect(onCreate).toHaveBeenCalledWith("CDISC", "CDISC-CG02701");
  });

  it("is closed for a null family", () => {
    renderWithProviders(
      <NewRuleDialog family={null} existingIds={[]} onCreate={vi.fn()} onCancel={vi.fn()} />,
    );
    expect(screen.queryByLabelText("Rule id")).not.toBeInTheDocument();
  });
});
