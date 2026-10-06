import { useEffect, useState } from "react";

/** What a brand's optional `brand.json` may carry (brands/README.md). */
export interface Brand {
  /** Logo path, relative to the brand folder (shown in light mode, and in dark without logoDark). */
  logo?: string;
  /** Logo for dark mode, relative to the brand folder. */
  logoDark?: string;
  /** A short line beside the logo, e.g. "made by P300". */
  kicker?: string;
  /** Where the kicker links to (http: / https: only). */
  kickerUrl?: string;
}

/** Where the server maps the chosen brand folder (`index.html` loads `brand.css` from here too). */
export const BRAND_BASE = `${import.meta.env.BASE_URL}brand/`;

/** A brand asset's URL from its path inside the brand folder. */
export function brandAsset(relativePath: string): string {
  return BRAND_BASE + relativePath;
}

/** A path inside the brand folder: no scheme, not absolute, no `..` segment, no backslash. */
export function isBrandPath(value: unknown): value is string {
  if (typeof value !== "string" || value === "" || value.length > 1024) return false;
  if (/^[a-z][a-z0-9+.-]*:/i.test(value) || value.startsWith("/") || value.includes("\\")) {
    return false;
  }
  return !value.split("/").some((segment) => segment === "..");
}

/** An http(s) URL for the kicker link (the bundled REST shape has no CSP to catch anything else). */
export function isKickerUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * The validated content of a `brand.json` text: malformed JSON or a non-object throws; a field of the
 * wrong shape is dropped with one `console.warn` naming it. Never an error screen — a brand without
 * a usable logo renders without one.
 */
export function parseBrandJson(text: string): Brand {
  const parsed: unknown = JSON.parse(text);
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("brand.json is not an object");
  }
  const raw = parsed as Record<string, unknown>;
  const brand: Brand = {};
  const dropped: string[] = [];
  for (const key of ["logo", "logoDark"] as const) {
    if (raw[key] === undefined) continue;
    if (isBrandPath(raw[key])) brand[key] = raw[key];
    else dropped.push(key);
  }
  if (raw.kicker !== undefined) {
    if (typeof raw.kicker === "string" && raw.kicker.trim() !== "") brand.kicker = raw.kicker;
    else dropped.push("kicker");
  }
  if (raw.kickerUrl !== undefined) {
    if (isKickerUrl(raw.kickerUrl)) brand.kickerUrl = raw.kickerUrl;
    else dropped.push("kickerUrl");
  }
  if (dropped.length > 0) {
    console.warn(`brand.json: ignoring ${dropped.join(", ")} (not a relative path / http(s) URL)`);
  }
  return brand;
}

/** Fetches and validates `/brand/brand.json` once; a 404 or malformed file ⇒ `{}` and one warning. */
export async function loadBrand(): Promise<Brand> {
  try {
    const response = await fetch(new URL(brandAsset("brand.json"), document.baseURI), {
      cache: "no-cache",
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return parseBrandJson(await response.text());
  } catch (error) {
    console.warn("brand.json not loaded, rendering without a logo:", error);
    return {};
  }
}

/** The brand's logo and kicker, `{}` until loaded and when there is none. */
export function useBrand(): Brand {
  const [brand, setBrand] = useState<Brand>({});
  useEffect(() => {
    let active = true;
    void loadBrand().then((loaded) => {
      if (active) setBrand(loaded);
    });
    return () => {
      active = false;
    };
  }, []);
  return brand;
}
