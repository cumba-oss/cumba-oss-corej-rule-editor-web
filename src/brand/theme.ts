import {
  Checkbox,
  createTheme,
  defaultVariantColorsResolver,
  type CSSVariablesResolver,
  type MantineColorsTuple,
  type VariantColorsResolver,
} from "@mantine/core";

/**
 * The bridge from the brand tokens (`/brand/brand.css`, fallbacks in `defaults.css`) to Mantine: every
 * palette the apps name by Mantine colour (`red`, `green`, `orange`, `yellow`, `blue`, `gray`, the
 * `dark` surfaces and the primary `brand`) is ten `var(--brand-<role>-<shade>)` references, so the
 * ~150 existing `color="red"` / `c="dimmed"` sites follow the brand with no edit. Mantine's colour
 * functions turn a `var()` into `color-mix()` for the light / outline / subtle variants (measured in
 * phase 0 of PLAN-web-branding-and-theme), so every variant keeps working.
 */
const shades = (role: string): MantineColorsTuple =>
  Array.from(
    { length: 10 },
    (_, i) => `var(--brand-${role}-${i})`,
  ) as unknown as MantineColorsTuple;

/**
 * Filled primary surfaces take their text from `--brand-primary-contrast` (Mantine's default is
 * white, and `autoContrast` cannot judge a `var()`): a brand whose dark teal is too light for white
 * text sets ink there. Every other colour and variant keeps Mantine's resolution.
 */
const variantColorResolver: VariantColorsResolver = (input) => {
  const color = input.color ?? input.theme.primaryColor;
  const resolved = defaultVariantColorsResolver({ ...input, color });
  if (input.variant === "filled" && color === "brand") {
    return { ...resolved, color: "var(--brand-primary-contrast)" };
  }
  return resolved;
};

export const brandTheme = createTheme({
  primaryColor: "brand",
  primaryShade: { light: 6, dark: 6 },
  colors: {
    brand: shades("primary"),
    red: shades("danger"),
    green: shades("success"),
    orange: shades("warning"),
    yellow: shades("caution"),
    blue: shades("info"),
    gray: shades("neutral"),
    dark: shades("dark"),
  },
  variantColorResolver,
  components: {
    // the check mark on a filled primary box follows the same contrast token as filled text
    Checkbox: Checkbox.extend({ defaultProps: { iconColor: "var(--brand-primary-contrast)" } }),
  },
  fontFamily: "var(--brand-font-body)",
  fontFamilyMonospace: "var(--brand-font-mono)",
  headings: { fontFamily: "var(--brand-font-headings)" },
  defaultRadius: "md",
  radius: { md: "var(--brand-radius)" },
});

const surfaces = {
  // in the light AND dark blocks: Mantine's own scheme blocks set --mantine-primary-color-contrast
  // per scheme and would shadow a scheme-less `variables` entry (review round 1 LOW-1)
  "--mantine-primary-color-contrast": "var(--brand-primary-contrast)",
  "--mantine-color-body": "var(--brand-body)",
  "--mantine-color-text": "var(--brand-text)",
  "--mantine-color-dimmed": "var(--brand-text-dimmed)",
  "--mantine-color-anchor": "var(--brand-link)",
  "--mantine-color-default": "var(--brand-surface)",
  "--mantine-color-default-hover": "var(--brand-surface-hover)",
  "--mantine-color-default-border": "var(--brand-border)",
};

/** The surface, text and link variables, in both schemes, from the tokens (which carry both). */
export const brandCssVariables: CSSVariablesResolver = () => ({
  variables: {},
  light: { ...surfaces },
  dark: { ...surfaces },
});
