import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { localStorageColorSchemeManager, MantineProvider } from "@mantine/core";
import { Notifications } from "@mantine/notifications";
import App from "./App.tsx";
import { brandCssVariables, brandTheme } from "./brand/theme";

import "@mantine/core/styles.css";
import "@mantine/notifications/styles.css";
// The fallback of every brand token, after Mantine's styles; the deployment's /brand/brand.css
// (index.html) outranks it whatever the order, because these fallbacks have zero specificity.
import "./brand/defaults.css";

// The scheme follows the OS unless the header's toggle chose one; stored under the key
// public/theme-init.js reads before the first paint.
const colorSchemeManager = localStorageColorSchemeManager({ key: "cumba-theme" });

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <MantineProvider
      theme={brandTheme}
      cssVariablesResolver={brandCssVariables}
      defaultColorScheme="auto"
      colorSchemeManager={colorSchemeManager}
    >
      <Notifications />
      <App />
    </MantineProvider>
  </StrictMode>,
);
