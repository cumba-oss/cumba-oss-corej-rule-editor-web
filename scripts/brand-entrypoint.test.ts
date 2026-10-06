// docker/25-cumba-brand.sh driven through sh against a temporary html root: it refuses to start
// the container on a BRAND that is not a brand, naming the available ones.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const SCRIPT = path.resolve(__dirname, "../docker/25-cumba-brand.sh");
const WINDOWS = process.platform === "win32";
/** `sh` on the PATH: the script is driven through it (never on Windows, review MED-2). */
const HAS_SH = !WINDOWS && spawnSync("sh", ["-c", "exit 0"]).status === 0;
let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "brand-entrypoint-"));
  for (const brand of ["neutral", "p300"]) {
    fs.mkdirSync(path.join(root, "brands", brand), { recursive: true });
    fs.writeFileSync(path.join(root, "brands", brand, "brand.css"), "");
  }
  fs.mkdirSync(path.join(root, "brands", "nocss"));
});

afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

function run(brand: string | undefined) {
  const env: Record<string, string> = { PATH: process.env.PATH ?? "", CUMBA_HTML_ROOT: root };
  if (brand !== undefined) env.BRAND = brand;
  const result = spawnSync("sh", [SCRIPT], { env, encoding: "utf8" });
  return { rc: result.status, out: result.stdout, err: result.stderr };
}

describe("docker/25-cumba-brand.sh", () => {
  it("is committed executable (the entrypoint ignores a non-executable script)", () => {
    // the file-system mode means nothing on Windows; the git index mode is checked everywhere
    if (!WINDOWS) expect(fs.statSync(SCRIPT).mode & 0o111).toBe(0o111);
    const tracked = spawnSync("git", ["ls-files", "-s", "docker/25-cumba-brand.sh"], {
      cwd: path.dirname(SCRIPT),
      encoding: "utf8",
    });
    if (tracked.status === 0 && tracked.stdout.trim() !== "") {
      expect(tracked.stdout.startsWith("100755 ")).toBe(true);
    }
  });

  it.skipIf(!HAS_SH)("accepts a known brand and defaults to neutral", () => {
    expect(run("p300")).toMatchObject({
      rc: 0,
      out: "cumba brand: serving /brand/ from brands/p300\n",
    });
    expect(run(undefined)).toMatchObject({ rc: 0, out: expect.stringContaining("brands/neutral") });
    expect(run("neutral").rc).toBe(0);
  });

  it.skipIf(!HAS_SH)("refuses an unknown brand, naming the available ones", () => {
    const r = run("acme");
    expect(r.rc).toBe(1);
    expect(r.err).toContain('BRAND="acme" has no');
    expect(r.err).toContain("available: neutral p300");
    expect(run("nocss").rc).toBe(1);
  });

  it.skipIf(!HAS_SH)("refuses an invalid name before it touches a path", () => {
    for (const bad of ["../x", "A", "p300/x", "-x", "x".repeat(41)]) {
      const r = run(bad);
      expect(r.rc, bad).toBe(1);
      expect(r.err).toContain("is not a brand name");
    }
    // an EMPTY variable is refused (review MED-1): envsubst would render the alias as brands//
    // and every /brand/ request would 404 silently
    const empty = run("");
    expect(empty.rc).toBe(1);
    expect(empty.err).toContain("BRAND is set but empty");
    expect(empty.err).toContain("available: neutral p300");
  });
});
