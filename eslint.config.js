import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";

export default tseslint.config(
  { ignores: ["dist", "target", "node_modules", "src/api/schema.d.ts", "coverage"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.browser },
    },
    plugins: { "react-hooks": reactHooks },
    // Full react-hooks v7 "recommended" preset, including the new React-Compiler rules
    // (set-state-in-effect, refs, purity, immutability, …) on top of the classic
    // rules-of-hooks / exhaustive-deps.
    rules: { ...reactHooks.configs.recommended.rules },
  },
  {
    files: ["scripts/**/*.mjs", "vite.config.ts"],
    languageOptions: { globals: { ...globals.node } },
  },
);
