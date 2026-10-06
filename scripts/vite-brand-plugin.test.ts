// Runs under the shared jsdom environment (the global setup stubs window): node modules work there too.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { EventEmitter } from "node:events";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { ResolvedConfig } from "vite";
import {
  availableBrands,
  brandFile,
  brandPlugin,
  copyBrands,
  resolveBrand,
  serveBrand,
} from "./vite-brand-plugin";

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "brand-plugin-"));
  for (const brand of ["neutral", "acme"]) {
    fs.mkdirSync(path.join(root, "brands", brand, "fonts"), { recursive: true });
    fs.writeFileSync(path.join(root, "brands", brand, "brand.css"), `/* ${brand} */`);
    fs.writeFileSync(path.join(root, "brands", brand, "fonts", "x.woff2"), "woff");
  }
  fs.writeFileSync(path.join(root, "brands", "neutral", "brand.json"), "{}");
  // not brands: a folder without brand.css, and a file
  fs.mkdirSync(path.join(root, "brands", "nocss"));
  fs.writeFileSync(path.join(root, "brands", "README.md"), "# brands");
  fs.writeFileSync(path.join(root, "secret.txt"), "outside");
});

afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe("resolveBrand", () => {
  it("lists the folders holding a brand.css and defaults to neutral", () => {
    expect(availableBrands(path.join(root, "brands"))).toEqual(["acme", "neutral"]);
    expect(availableBrands(path.join(root, "missing"))).toEqual([]);
    expect(resolveBrand(path.join(root, "brands"), undefined)).toBe("neutral");
    expect(resolveBrand(path.join(root, "brands"), "")).toBe("neutral");
    expect(resolveBrand(path.join(root, "brands"), "acme")).toBe("acme");
  });

  it("refuses an unknown name, naming the available ones", () => {
    expect(() => resolveBrand(path.join(root, "brands"), "nope")).toThrow(
      /BRAND "nope" has no brands\/nope\/brand.css; available: acme, neutral/,
    );
    expect(() => resolveBrand(path.join(root, "brands"), "nocss")).toThrow(/has no brands\/nocss/);
  });

  it("refuses a name that breaks the name rule before it touches a path", () => {
    for (const bad of ["../x", "A", "acme/x", "x".repeat(41), "-x", "a b", "ACME"]) {
      expect(() => resolveBrand(path.join(root, "brands"), bad)).toThrow(/is not a brand name/);
    }
  });
});

describe("brandFile", () => {
  it("resolves files inside the brand and refuses everything that leaves it", () => {
    const dir = path.join(root, "brands", "acme");
    expect(brandFile(dir, "/brand/", "/brand/brand.css")).toBe(path.join(dir, "brand.css"));
    expect(brandFile(dir, "/brand/", "/brand/fonts/x.woff2?v=1")).toBe(
      path.join(dir, "fonts", "x.woff2"),
    );
    expect(brandFile(dir, "/brand/", "/brand/")).toBeNull();
    expect(brandFile(dir, "/brand/", "/brand/fonts")).toBeNull(); // a directory
    expect(brandFile(dir, "/brand/", "/brand/missing.css")).toBeNull();
    expect(brandFile(dir, "/brand/", "/brand/../../secret.txt")).toBeNull();
    expect(brandFile(dir, "/brand/", "/brand/..%2F..%2Fsecret.txt")).toBeNull();
    expect(brandFile(dir, "/brand/", "/brand/%2e%2e/%2e%2e/secret.txt")).toBeNull();
    expect(brandFile(dir, "/brand/", "/brand/fonts/../../neutral/brand.css")).toBeNull();
    expect(brandFile(dir, "/brand/", "/brand/%zz")).toBeNull(); // undecodable
    expect(brandFile(dir, "/brand/", "/other/brand.css")).toBeNull();
    expect(brandFile(dir, "/app/brand/", "/app/brand/brand.css")).toBe(path.join(dir, "brand.css"));
  });
});

/** A minimal connect request/response pair; the response collects status, headers and body. */
function request(url: string) {
  const req = { url } as IncomingMessage;
  const headers: Record<string, string> = {};
  const chunks: Buffer[] = [];
  const res = new EventEmitter() as ServerResponse & { body: () => string };
  Object.assign(res, {
    statusCode: 0,
    setHeader: (k: string, v: string) => {
      headers[k] = v;
    },
    write: (c: Buffer | string) => {
      chunks.push(Buffer.from(c));
      return true;
    },
    end: (c?: Buffer | string) => {
      if (c !== undefined) chunks.push(Buffer.from(c));
      res.emit("finish");
      return res;
    },
    once: res.once.bind(res),
    on: res.on.bind(res),
    emit: res.emit.bind(res),
    removeListener: res.removeListener.bind(res),
    body: () => Buffer.concat(chunks).toString("utf8"),
  });
  return { req, res, headers };
}

function finished(res: EventEmitter): Promise<void> {
  return new Promise((resolve) => res.once("finish", () => resolve()));
}

describe("serveBrand (the dev and preview middleware)", () => {
  it("serves the brand's files with their types and no-cache, 404s traversal, passes the rest on", async () => {
    const middleware = serveBrand(path.join(root, "brands", "acme"), "/brand/");
    const ok = request("/brand/brand.css");
    const done = finished(ok.res);
    middleware(ok.req, ok.res, () => {
      throw new Error("must not pass on");
    });
    await done;
    expect(ok.res.statusCode).toBe(200);
    expect(ok.headers["Content-Type"]).toBe("text/css; charset=utf-8");
    expect(ok.headers["Cache-Control"]).toBe("no-cache");
    expect(ok.res.body()).toBe("/* acme */");

    const font = request("/brand/fonts/x.woff2");
    const fontDone = finished(font.res);
    middleware(font.req, font.res, () => {});
    await fontDone;
    expect(font.headers["Content-Type"]).toBe("font/woff2");

    for (const bad of ["/brand/../../secret.txt", "/brand/..%2F..%2Fsecret.txt", "/brand/nope"]) {
      const r = request(bad);
      middleware(r.req, r.res, () => {
        throw new Error("must not pass on");
      });
      expect(r.res.statusCode).toBe(404);
      expect(r.res.body()).not.toContain("outside");
    }

    const other = request("/api/info");
    const next = vi.fn();
    middleware(other.req, other.res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(other.res.statusCode).toBe(0);
  });
});

describe("copyBrands", () => {
  it("copies every brand to dist/brands/<name> and neutral to dist/brand", () => {
    const dist = path.join(root, "dist");
    expect(copyBrands(path.join(root, "brands"), dist)).toEqual(["acme", "neutral"]);
    expect(fs.readFileSync(path.join(dist, "brand", "brand.css"), "utf8")).toBe("/* neutral */");
    expect(fs.existsSync(path.join(dist, "brand", "brand.json"))).toBe(true);
    expect(fs.readFileSync(path.join(dist, "brands", "acme", "brand.css"), "utf8")).toBe(
      "/* acme */",
    );
    expect(fs.existsSync(path.join(dist, "brands", "acme", "fonts", "x.woff2"))).toBe(true);
    expect(fs.existsSync(path.join(dist, "brands", "nocss"))).toBe(false);
    expect(fs.existsSync(path.join(dist, "brands", "README.md"))).toBe(false);
  });
});

describe("brandPlugin", () => {
  const config = (base = "/") =>
    ({ root, base, build: { outDir: "dist" } }) as unknown as ResolvedConfig;

  function configResolved(plugin: ReturnType<typeof brandPlugin>, cfg: ResolvedConfig) {
    const hook = plugin.configResolved;
    const fn = typeof hook === "function" ? hook : hook?.handler;
    if (!fn) throw new Error("no configResolved hook");
    return fn.call({} as never, cfg);
  }

  it("refuses an unknown BRAND at configResolved, except under vitest", () => {
    expect(() => configResolved(brandPlugin({ env: { BRAND: "nope" } }), config())).toThrow(
      /BRAND "nope"/,
    );
    expect(() =>
      configResolved(brandPlugin({ env: { BRAND: "nope", VITEST: "true" } }), config()),
    ).not.toThrow();
    expect(() => configResolved(brandPlugin({ env: {} }), config())).not.toThrow();
  });

  it("serves the selected brand in dev from brands/ and in preview from dist/brands/, under the base", async () => {
    const plugin = brandPlugin({ env: { BRAND: "acme" } });
    configResolved(plugin, config("/app/"));
    copyBrands(path.join(root, "brands"), path.join(root, "dist"));
    fs.writeFileSync(path.join(root, "dist", "brands", "acme", "brand.css"), "/* built acme */");

    const use = vi.fn();
    const devHook = plugin.configureServer;
    const devFn = typeof devHook === "function" ? devHook : devHook?.handler;
    await devFn?.call({} as never, { middlewares: { use } } as never);
    const previewHook = plugin.configurePreviewServer;
    const previewFn = typeof previewHook === "function" ? previewHook : previewHook?.handler;
    await previewFn?.call({} as never, { middlewares: { use } } as never);
    expect(use).toHaveBeenCalledTimes(2);

    const [dev, preview] = use.mock.calls.map((c) => c[0] as ReturnType<typeof serveBrand>);
    const a = request("/app/brand/brand.css");
    const aDone = finished(a.res);
    dev!(a.req, a.res, () => {});
    await aDone;
    expect(a.res.body()).toBe("/* acme */");
    const b = request("/app/brand/brand.css");
    const bDone = finished(b.res);
    preview!(b.req, b.res, () => {});
    await bDone;
    expect(b.res.body()).toBe("/* built acme */");
    const outside = request("/brand/brand.css");
    const next = vi.fn();
    dev!(outside.req, outside.res, next);
    expect(next).toHaveBeenCalled();
  });

  it("copies the brands into the bundle at writeBundle", () => {
    const plugin = brandPlugin({ env: {} });
    configResolved(plugin, config());
    const hook = plugin.writeBundle;
    const fn = typeof hook === "function" ? hook : hook?.handler;
    fn?.call({} as never, {} as never, {});
    expect(fs.existsSync(path.join(root, "dist", "brand", "brand.css"))).toBe(true);
    expect(fs.existsSync(path.join(root, "dist", "brands", "acme", "brand.css"))).toBe(true);
  });
});
