import type { ReactNode } from "react";
import { render, type RenderResult } from "@testing-library/react";
import { localStorageColorSchemeManager, MantineProvider } from "@mantine/core";
import { Notifications } from "@mantine/notifications";
import { brandCssVariables, brandTheme } from "../brand/theme";

// The same theme and colour-scheme manager as src/main.tsx, so the brand bridge and the toggle are
// what the tests exercise (the manager reads the jsdom localStorage; tests clear it).
const colorSchemeManager = localStorageColorSchemeManager({ key: "cumba-theme" });

function Providers({ children }: { children: ReactNode }) {
  return (
    <MantineProvider
      env="test"
      theme={brandTheme}
      cssVariablesResolver={brandCssVariables}
      defaultColorScheme="auto"
      colorSchemeManager={colorSchemeManager}
    >
      <Notifications />
      {children}
    </MantineProvider>
  );
}

/**
 * Render a component tree wrapped in the same providers as the real app (MantineProvider +
 * Notifications), so components that use Mantine hooks / notifications work under Vitest + jsdom.
 * Passed as `wrapper`, so the result's `rerender` keeps the providers.
 *
 * `env="test"` is Mantine's documented testing mode: it disables transitions (and portal
 * animations), so modal and collapse content joins the accessibility tree synchronously.
 */
export function renderWithProviders(ui: ReactNode): RenderResult {
  return render(ui, { wrapper: Providers });
}
