# Brands — the look of the app as a deployment choice

A **brand** is a named folder in this directory: `brand.css` with the design tokens below (light
**and** dark), an optional `brand.json` for a logo and a kicker line, and whatever fonts and images
they reference. The build ships every folder here; the deployment selects one **by name**, and the
app always loads it as `/brand/brand.css`.

| folder    | what it is                                                                                      |
| --------- | ----------------------------------------------------------------------------------------------- |
| `neutral` | the default: the look the app had before branding (Mantine's stock palettes) plus a dark scheme |
| `p300`    | the house style of corej.p-300.com (`NOTICE.md` there: logo and wordmark are P300 trademarks)   |

## Selecting a brand

| where the app runs                                 | set                                                                                             | default   |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------- | --------- |
| `npm run dev`, `vite preview`                      | `BRAND=<name>`                                                                                  | `neutral` |
| the nginx image (`Dockerfile`)                     | `BRAND=<name>` in the container's environment                                                   | `neutral` |
| bundled into a coreJ REST service (`-Pbundle-web`) | `EDITOR_BRAND_NAME` (rule editor) / `COREJ_BRAND_NAME` (validator)                              | `neutral` |
| any plain static server                            | nothing: `dist/brand/` is a copy of `neutral`; replace that folder with another brand's content | `neutral` |

An unknown or invalid name **refuses to start** and lists the available brands — a typo never
silently ships the wrong look. Names match `^[a-z0-9][a-z0-9-]{0,39}$`.

## Adding a brand

1. Copy `neutral/` to `<name>/` (or start from an empty `brand.css` — every token you leave out
   keeps the app's default, so a brand may be a handful of lines).
2. ⚠ If you change a palette's **base** colour (`--brand-primary`, `--brand-danger`, …), **delete
   that palette's ten shade lines** (`--brand-<role>-0` … `-9`) from your copy: exact shades outrank
   the shades the app derives from the base, so the old shades would win.
3. ⚠ **A token set only on `:root` applies to both colour schemes** — it outranks the app's dark
   default. A brand that sets a surface or text colour sets its dark value too, under
   `:root[data-mantine-color-scheme="dark"]`.
4. Optional `brand.json`; optional fonts (`@font-face` in `brand.css`, paths relative to the
   folder — the browser loads them from `/brand/…`).
5. Rebuild, or mount the folder: the nginx image takes extra brands at
   `/usr/share/nginx/html/brands/<name>` (`DOCKER.md`), a bundled REST service at
   `<config dir>/brands/<name>` (its README).

Shades are derived with `color-mix()`, supported by every evergreen browser since 2023.

## `brand.json`

```json
{
  "logo": "logo.svg",
  "logoDark": "logo-dark.svg",
  "kicker": "made by P300",
  "kickerUrl": "https://www.p-300.com"
}
```

All fields optional. `logo` / `logoDark` are paths **inside the folder** (no scheme, no leading `/`,
no `..`); `kickerUrl` must be `http:` or `https:`. A field of another shape is ignored with one
browser-console warning; a missing or malformed `brand.json` means no logo and no kicker, never an
error. `neutral/brand.json` is `{}` so a static server with SPA fallback never answers the request
with `index.html`. The logo is rendered 22 px high in the header, `logoDark` in dark mode (without
it the one logo serves both).

Product names are **not** brand content: the header titles belong to the apps.

## The token contract

Light values on `:root`, dark values on `:root[data-mantine-color-scheme="dark"]`. Any CSS colour
syntax. `neutral/brand.css` is the full example with every token written out. The list changes
**only additively** — a renamed token would silently break every operator's brand.

| group                | tokens                                                                                                                                                                                                                                                                                                                    |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| surfaces and text    | `--brand-body` (the page), `--brand-surface` (panels, cards, inputs), `--brand-surface-hover`, `--brand-border`, `--brand-text`, `--brand-text-dimmed`, `--brand-link`                                                                                                                                                    |
| primary              | `--brand-primary`; optional `--brand-primary-0` … `-9` (exact shades, 6 = the base); `--brand-primary-contrast` (text on a filled primary surface)                                                                                                                                                                        |
| semantic palettes    | `--brand-danger` (what the app calls `red`), `--brand-success` (`green`), `--brand-warning` (`orange`), `--brand-caution` (`yellow`), `--brand-info` (`blue`), `--brand-neutral` (`gray`); each with optional `-0` … `-9`                                                                                                 |
| dark surfaces        | optional `--brand-dark-0` … `-9`: the shades Mantine's components use for dark-mode surfaces (inputs, menus, modals, table lines); 0 is the lightest                                                                                                                                                                      |
| typography           | `--brand-font-body`, `--brand-font-headings`, `--brand-font-mono`                                                                                                                                                                                                                                                         |
| shape                | `--brand-radius` (the default corner radius)                                                                                                                                                                                                                                                                              |
| code (editors, JSON) | `--brand-code-bg`, `--brand-code-fg`, `--brand-code-gutter`, `--brand-code-selection`, `--brand-code-key`, `--brand-code-string`, `--brand-code-number`, `--brand-code-keyword` (booleans, null), `--brand-code-comment`. ⚠ The JSON tree colours booleans with `--brand-code-number` (its library has one slot for both) |

How the shades derive when a brand gives only the base: `-6` is the base; `-0` … `-5` mix it with
white (9 %, 18 %, 33 %, 50 %, 68 %, 85 % of the base), `-7` … `-9` with black (10 %, 20 %, 30 %
black). Filled surfaces use shade 6, the light variant and badges shades 0–2 (light mode) or a
translucent shade 4 (dark mode), outlines shade 6 (light) or 2 (dark). Keep a base colour readable
under white text, or set `--brand-primary-contrast`.
