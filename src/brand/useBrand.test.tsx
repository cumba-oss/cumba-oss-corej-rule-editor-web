import { afterEach, describe, expect, it, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { screen } from "@testing-library/react";
import { server } from "../test/server";
import { renderWithProviders } from "../test/renderWithProviders";
import { BrandMark } from "./BrandMark";
import { isBrandPath, isKickerUrl, loadBrand, parseBrandJson, useBrand } from "./useBrand";

function Probe() {
  const brand = useBrand();
  return <pre data-testid="brand">{JSON.stringify(brand)}</pre>;
}

describe("brand.json validation", () => {
  it("accepts paths inside the folder and http(s) kicker URLs only", () => {
    expect(isBrandPath("logo.svg")).toBe(true);
    expect(isBrandPath("img/logo.svg")).toBe(true);
    expect(isBrandPath("")).toBe(false);
    expect(isBrandPath("/etc/passwd")).toBe(false);
    expect(isBrandPath("../other/logo.svg")).toBe(false);
    expect(isBrandPath("img/../../x.svg")).toBe(false);
    expect(isBrandPath("https://evil.example/logo.svg")).toBe(false);
    expect(isBrandPath("javascript:alert(1)")).toBe(false);
    expect(isBrandPath("data:image/svg+xml,x")).toBe(false);
    expect(isBrandPath("img\\logo.svg")).toBe(false);
    expect(isBrandPath("%2e%2e/x.svg")).toBe(false);
    expect(isBrandPath("logo%20.svg")).toBe(false);
    expect(isBrandPath(42)).toBe(false);
    expect(isKickerUrl("https://www.p-300.com")).toBe(true);
    expect(isKickerUrl("http://localhost:8080/x")).toBe(true);
    expect(isKickerUrl("javascript:alert(1)")).toBe(false);
    expect(isKickerUrl("ftp://x")).toBe(false);
    expect(isKickerUrl("/relative")).toBe(false);
    expect(isKickerUrl(null)).toBe(false);
  });

  it("drops invalid fields with one warning and keeps the valid ones", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const brand = parseBrandJson(
      JSON.stringify({
        logo: "logo.svg",
        logoDark: "https://evil.example/x.svg",
        kicker: "made by X",
        kickerUrl: "javascript:alert(1)",
        extra: true,
      }),
    );
    expect(brand).toEqual({ logo: "logo.svg", kicker: "made by X" });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain("logoDark, kickerUrl");
    warn.mockRestore();
  });

  it("rejects a non-object document", () => {
    expect(() => parseBrandJson("[]")).toThrow(/not an object/);
    expect(() => parseBrandJson("null")).toThrow(/not an object/);
    expect(() => parseBrandJson("{not json")).toThrow();
    expect(parseBrandJson("{}")).toEqual({});
    expect(parseBrandJson('{"kicker": "   "}')).toEqual({});
  });
});

describe("loadBrand / useBrand", () => {
  afterEach(() => vi.restoreAllMocks());

  it("loads the logo and kicker from /brand/brand.json", async () => {
    server.use(
      http.get("/brand/brand.json", () =>
        HttpResponse.json({ logo: "logo.svg", logoDark: "logo-dark.svg", kicker: "made by X" }),
      ),
    );
    renderWithProviders(<Probe />);
    expect(
      await screen.findByText(
        JSON.stringify({ logo: "logo.svg", logoDark: "logo-dark.svg", kicker: "made by X" }),
      ),
    ).toBeInTheDocument();
  });

  it("renders without a logo on a 404, with one warning", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    server.use(http.get("/brand/brand.json", () => new HttpResponse(null, { status: 404 })));
    expect(await loadBrand()).toEqual({});
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[1])).toContain("HTTP 404");
  });

  it("renders without a logo on malformed JSON, with one warning", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    server.use(http.get("/brand/brand.json", () => HttpResponse.text("<html>not json")));
    expect(await loadBrand()).toEqual({});
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("the default handler answers {} so a header renders without a logo", async () => {
    renderWithProviders(<Probe />);
    expect(await screen.findByText("{}")).toBeInTheDocument();
  });
});

describe("BrandMark", () => {
  it("renders a light/dark logo pair, each hidden in the other scheme, and the kicker link", () => {
    const { container } = renderWithProviders(
      <BrandMark
        brand={{
          logo: "logo.svg",
          logoDark: "logo-dark.svg",
          kicker: "made by X",
          kickerUrl: "https://x.example/",
        }}
      />,
    );
    const logos = container.querySelectorAll<HTMLImageElement>("img[data-brand-logo]");
    expect([...logos].map((img) => [img.dataset.brandLogo, img.getAttribute("src")])).toEqual([
      ["light", "/brand/logo.svg"],
      ["dark", "/brand/logo-dark.svg"],
    ]);
    expect(logos[0]?.className).toContain("mantine-dark-hidden");
    expect(logos[1]?.className).toContain("mantine-light-hidden");
    const kicker = screen.getByRole("link", { name: "made by X" });
    expect(kicker).toHaveAttribute("href", "https://x.example/");
    expect(kicker).toHaveAttribute("rel", "noopener");
  });

  it("renders one logo for both schemes without logoDark, and a plain kicker without a URL", () => {
    const { container } = renderWithProviders(
      <BrandMark brand={{ logo: "logo.svg", kicker: "made by X" }} />,
    );
    const logos = container.querySelectorAll<HTMLImageElement>("img[data-brand-logo]");
    expect(logos).toHaveLength(1);
    expect(logos[0]?.dataset.brandLogo).toBe("both");
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.getByText("made by X")).toBeInTheDocument();
  });

  it("uses a lone logoDark for both schemes", () => {
    const { container } = renderWithProviders(<BrandMark brand={{ logoDark: "dark.svg" }} />);
    const logos = container.querySelectorAll<HTMLImageElement>("img[data-brand-logo]");
    expect(logos).toHaveLength(1);
    expect(logos[0]?.dataset.brandLogo).toBe("both");
    expect(logos[0]?.getAttribute("src")).toBe("/brand/dark.svg");
  });

  it("renders nothing for an empty brand", () => {
    const { container } = renderWithProviders(<BrandMark brand={{}} />);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("[data-brand-kicker]")).toBeNull();
  });
});
