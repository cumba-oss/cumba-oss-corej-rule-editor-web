import { describe, expect, it } from "vitest";
import { DEFAULT_THEME, mergeMantineTheme } from "@mantine/core";
import { brandCssVariables, brandTheme } from "./theme";
import { codeTheme, codeThemeDark, codeThemeLight } from "./codeTheme";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

const theme = mergeMantineTheme(DEFAULT_THEME, brandTheme);

describe("brandTheme", () => {
  it("maps every app palette onto the brand tokens, ten shades each", () => {
    const roles = {
      brand: "primary",
      red: "danger",
      green: "success",
      orange: "warning",
      yellow: "caution",
      blue: "info",
      gray: "neutral",
      dark: "dark",
    };
    for (const [palette, role] of Object.entries(roles)) {
      expect(theme.colors[palette]).toEqual(
        Array.from({ length: 10 }, (_, i) => `var(--brand-${role}-${i})`),
      );
    }
    expect(theme.primaryColor).toBe("brand");
    expect(theme.fontFamily).toBe("var(--brand-font-body)");
    expect(theme.headings.fontFamily).toBe("var(--brand-font-headings)");
    expect(theme.radius.md).toBe("var(--brand-radius)");
    // the stock palettes the apps also name (teal for "Copied") are still there
    expect(theme.colors.teal).toHaveLength(10);
  });

  it("gives a filled primary surface the brand's contrast colour and leaves the rest to Mantine", () => {
    const filledPrimary = theme.variantColorResolver({
      color: undefined,
      theme,
      variant: "filled",
    });
    expect(filledPrimary.color).toBe("var(--brand-primary-contrast)");
    expect(filledPrimary.background).toBe("var(--mantine-color-brand-filled)");
    const filledRed = theme.variantColorResolver({ color: "red", theme, variant: "filled" });
    expect(filledRed.color).toBe("var(--mantine-color-white)");
    const lightPrimary = theme.variantColorResolver({ color: "brand", theme, variant: "light" });
    expect(lightPrimary.color).toBe("var(--mantine-color-brand-light-color)");
    // the Checkbox's check mark follows the same token
    expect(theme.components.Checkbox?.defaultProps).toEqual({
      iconColor: "var(--brand-primary-contrast)",
    });
  });

  it("resolves the surface, text and link variables from the tokens in both schemes", () => {
    const resolved = brandCssVariables(theme);
    // per scheme, where Mantine sets its own value — a scheme-less entry would be shadowed
    expect(resolved.variables).toEqual({});
    for (const scheme of ["light", "dark"] as const) {
      expect(resolved[scheme]).toEqual({
        "--mantine-primary-color-contrast": "var(--brand-primary-contrast)",
        "--mantine-color-body": "var(--brand-body)",
        "--mantine-color-text": "var(--brand-text)",
        "--mantine-color-dimmed": "var(--brand-text-dimmed)",
        "--mantine-color-anchor": "var(--brand-link)",
        "--mantine-color-default": "var(--brand-surface)",
        "--mantine-color-default-hover": "var(--brand-surface-hover)",
        "--mantine-color-default-border": "var(--brand-border)",
      });
    }
  });
});

describe("codeTheme", () => {
  it("returns one stable extension per scheme, flagged dark or not", () => {
    expect(codeTheme("light")).toBe(codeThemeLight);
    expect(codeTheme("dark")).toBe(codeThemeDark);
    expect(codeTheme("light")).toBe(codeTheme("light"));
    const light = EditorState.create({ extensions: codeThemeLight });
    const dark = EditorState.create({ extensions: codeThemeDark });
    expect(light.facet(EditorView.darkTheme)).toBe(false);
    expect(dark.facet(EditorView.darkTheme)).toBe(true);
  });
});
