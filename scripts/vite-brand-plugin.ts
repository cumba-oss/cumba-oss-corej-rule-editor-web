// The brand folders at build and at development time (PLAN-web-branding-and-theme §5.5).
//
// A brand is a named folder under brands/ (brands/README.md). The SPA always loads
// /brand/brand.css; whatever serves the app maps /brand/ to the chosen folder. This plugin
//   - copies every brand to dist/brands/<name>/ and the default one (neutral) to dist/brand/,
//     so a plain static server needs no configuration and serves `neutral`;
//   - serves /brand/ from brands/$BRAND in `vite dev` and from dist/brands/$BRAND in
//     `vite preview` — without the preview middleware every preview would show `neutral`;
//   - refuses to start on an unknown or invalid BRAND, naming the available ones (a typo must
//     not silently ship the wrong look). Skipped under vitest, so a stray BRAND in the shell
//     cannot red the unit gate.
//
// Scoped node imports: tsconfig restricts the global `types`, so `process` and friends are not
// globals here (vite.config.ts does the same).
import * as fs from "node:fs";
import * as path from "node:path";
import * as process from "node:process";
import type { Connect, Plugin } from "vite";

/** The name rule every server checks before a brand name touches a path. */
export const BRAND_NAME = /^[a-z0-9][a-z0-9-]{0,39}$/;

/** The brand served when none is selected (owner ruling R5). */
export const DEFAULT_BRAND = "neutral";

const CONTENT_TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
};

/** The brands under `brandsDir`: every sub-folder holding a `brand.css`, sorted. */
export function availableBrands(brandsDir: string): string[] {
  if (!fs.existsSync(brandsDir)) return [];
  return fs
    .readdirSync(brandsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && fs.existsSync(path.join(brandsDir, d.name, "brand.css")))
    .map((d) => d.name)
    .sort();
}

/**
 * The brand to serve: `name` (undefined or blank ⇒ `neutral`), checked against the name rule and
 * for an existing `brand.css` under `brandsDir`. Throws, naming the available brands, otherwise.
 */
export function resolveBrand(brandsDir: string, name: string | undefined): string {
  const brand = name === undefined || name.trim() === "" ? DEFAULT_BRAND : name.trim();
  const available = availableBrands(brandsDir);
  if (!BRAND_NAME.test(brand)) {
    throw new Error(
      `BRAND "${brand}" is not a brand name (${BRAND_NAME}); available: ${available.join(", ")}`,
    );
  }
  if (!available.includes(brand)) {
    throw new Error(
      `BRAND "${brand}" has no brands/${brand}/brand.css; available: ${available.join(", ")}`,
    );
  }
  return brand;
}

/**
 * The file inside `brandDir` that the request path (`<prefix>brand.css`, …) names, or `null` when
 * the path leaves the folder, is not a file, or cannot be decoded. Resolution goes through
 * `path.resolve`, so `..` segments and encoded dots are judged after normalisation.
 */
export function brandFile(brandDir: string, prefix: string, url: string): string | null {
  const pathname = url.split("?")[0] ?? "";
  if (!pathname.startsWith(prefix)) return null;
  let rel: string;
  try {
    rel = decodeURIComponent(pathname.slice(prefix.length));
  } catch {
    return null;
  }
  if (rel === "" || rel.includes("\0") || rel.includes("\\")) return null;
  const root = path.resolve(brandDir);
  const resolved = path.resolve(root, rel);
  if (!resolved.startsWith(root + path.sep)) return null;
  try {
    return fs.statSync(resolved).isFile() ? resolved : null;
  } catch {
    return null;
  }
}

/** A connect middleware serving `<prefix>*` from `brandDir`; everything else passes on. */
export function serveBrand(brandDir: string, prefix: string): Connect.NextHandleFunction {
  return (req, res, next) => {
    const url = req.url ?? "";
    if (!url.startsWith(prefix)) {
      next();
      return;
    }
    const file = brandFile(brandDir, prefix, url);
    if (file === null) {
      res.statusCode = 404;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.end("not found");
      return;
    }
    res.statusCode = 200;
    res.setHeader("Content-Type", CONTENT_TYPES[path.extname(file)] ?? "application/octet-stream");
    res.setHeader("Cache-Control", "no-cache");
    const stream = fs.createReadStream(file);
    // a file that vanishes or cannot be read between stat and open: answer, never hang the request
    stream.on("error", () => {
      if (!res.headersSent) {
        res.statusCode = 404;
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
      }
      res.end("not found");
    });
    stream.pipe(res);
  };
}

/**
 * Copies every brand to `<distDir>/brands/<name>/` and the default brand to `<distDir>/brand/`
 * (the layout a plain static server serves as is).
 */
export function copyBrands(brandsDir: string, distDir: string): string[] {
  const brands = availableBrands(brandsDir);
  for (const brand of brands) {
    fs.cpSync(path.join(brandsDir, brand), path.join(distDir, "brands", brand), {
      recursive: true,
    });
  }
  if (brands.includes(DEFAULT_BRAND)) {
    fs.cpSync(path.join(brandsDir, DEFAULT_BRAND), path.join(distDir, "brand"), {
      recursive: true,
    });
  }
  return brands;
}

export interface BrandPluginOptions {
  /** The environment to read `BRAND` and `VITEST` from (tests pass their own). */
  env?: Record<string, string | undefined>;
}

/** The Vite plugin: wire it in `vite.config.ts` as `brandPlugin()`. */
export function brandPlugin(options: BrandPluginOptions = {}): Plugin {
  const env = options.env ?? process.env;
  let root = process.cwd();
  let outDir = "dist";
  let prefix = "/brand/";
  let brand = DEFAULT_BRAND;
  return {
    name: "cumba-brand",
    configResolved(config) {
      root = config.root;
      outDir = config.build.outDir;
      prefix = `${config.base.replace(/\/$/, "")}/brand/`;
    },
    // BRAND selects what is SERVED, so it is validated where a server starts: `vite dev` against
    // brands/, `vite preview` against dist/brands/ (what the preview serves). A build ships every
    // brand and reads no BRAND. Vitest starts a dev server too, but serves no brand: a stray
    // BRAND in the shell must not red the unit gate.
    configureServer(server) {
      if (env.VITEST) return;
      const brandsDir = path.join(root, "brands");
      brand = resolveBrand(brandsDir, env.BRAND);
      server.middlewares.use(serveBrand(path.join(brandsDir, brand), prefix));
    },
    configurePreviewServer(server) {
      const brandsDir = path.resolve(root, outDir, "brands");
      brand = resolveBrand(brandsDir, env.BRAND);
      server.middlewares.use(serveBrand(path.join(brandsDir, brand), prefix));
    },
    writeBundle() {
      copyBrands(path.join(root, "brands"), path.resolve(root, outDir));
    },
  };
}
