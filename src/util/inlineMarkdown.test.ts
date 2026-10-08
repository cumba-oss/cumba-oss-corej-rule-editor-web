import { describe, expect, it } from "vitest";
import { firstSentence, renderInline } from "./inlineMarkdown";

/** The rendered fragment's markup (jsdom serialises text nodes escaped). */
function html(text: string): string {
  const div = document.createElement("div");
  div.appendChild(renderInline(text));
  return div.innerHTML;
}

describe("firstSentence", () => {
  it("splits after the first sentence", () => {
    expect(firstSentence("One thing. Another thing.")).toEqual({
      first: "One thing.",
      rest: "Another thing.",
    });
    expect(firstSentence("  Is it? Yes! ")).toEqual({ first: "Is it?", rest: "Yes!" });
    expect(firstSentence("Only one.")).toEqual({ first: "Only one.", rest: "" });
    expect(firstSentence("No full stop")).toEqual({ first: "No full stop", rest: "" });
    expect(firstSentence("")).toEqual({ first: "", rest: "" });
  });

  it("splits the owner's empty(x) example after the code span", () => {
    const summary =
      'True when the value is missing or `""`. The positive spellings `non_empty` / `present` exist.';
    expect(firstSentence(summary).first).toBe('True when the value is missing or `""`.');
  });

  it("never splits inside a code span, an abbreviation or a decimal", () => {
    expect(firstSentence('Splits on `". "` here. Next.').first).toBe('Splits on `". "` here.');
    expect(firstSentence("Reads `x. y` and `a.b` too. Next.").first).toBe(
      "Reads `x. y` and `a.b` too.",
    );
    expect(firstSentence("A date, e.g. 2020-01-01 or i.e. Text. Next.").first).toBe(
      "A date, e.g. 2020-01-01 or i.e. Text.",
    );
    expect(firstSentence("Rounds 1.5 up. Next.").first).toBe("Rounds 1.5 up.");
    // a lowercase continuation is not a new sentence
    expect(firstSentence("Uses approx. values. Next.").first).toBe("Uses approx. values.");
    expect(firstSentence("See foo. bar continues. Next.").first).toBe("See foo. bar continues.");
  });

  it("keeps closing emphasis and quotes with the sentence, and splits on a blank line", () => {
    expect(firstSentence("**Note.** More.")).toEqual({ first: "**Note.**", rest: "More." });
    expect(firstSentence("(as `a`.) More.").first).toBe("(as `a`.)");
    expect(firstSentence("Head line\n\nBody. More.")).toEqual({
      first: "Head line",
      rest: "Body. More.",
    });
    // an unclosed backtick is literal and does not swallow the rest
    expect(firstSentence("A ` tick. More.").first).toBe("A ` tick.");
  });
});

describe("renderInline", () => {
  it("renders code, bold and italic", () => {
    expect(html("a `b` c")).toBe("a <code>b</code> c");
    expect(html("**bold** and __bold__")).toBe("<strong>bold</strong> and <strong>bold</strong>");
    expect(html("*it* and _it_")).toBe("<em>it</em> and <em>it</em>");
    expect(html("**not `x` *y* z**")).toBe("<strong>not <code>x</code> <em>y</em> z</strong>");
    expect(html("*a **b** c*")).toBe("<em>a <strong>b</strong> c</em>");
    expect(html("``a ` b``")).toBe("<code>a ` b</code>");
    expect(html("` padded `")).toBe("<code>padded</code>");
  });

  it("leaves code span contents and unmatched delimiters literal", () => {
    expect(html("`**not bold**`")).toBe("<code>**not bold**</code>");
    expect(html("is_missing and non_empty_x")).toBe("is_missing and non_empty_x");
    expect(html("a * b * c")).toBe("a * b * c");
    expect(html("2 * 3 and *open")).toBe("2 * 3 and *open");
    expect(html("one ` tick")).toBe("one ` tick");
    expect(html("**")).toBe("**");
    expect(html("**bold `x**` y")).toBe("**bold <code>x**</code> y");
  });

  it("never interprets HTML: markup in the text is text", () => {
    const evil = "<img src=x onerror=alert(1)>";
    const div = document.createElement("div");
    div.appendChild(renderInline(`${evil} **${evil}** \`${evil}\``));
    expect(div.querySelector("img")).toBeNull();
    expect(div.querySelectorAll("*")).toHaveLength(2); // the <strong> and the <code>, nothing else
    expect(div.textContent).toBe(`${evil} ${evil} ${evil}`);
    expect(div.innerHTML).toContain("&lt;img src=x onerror=alert(1)&gt;");
  });
});
