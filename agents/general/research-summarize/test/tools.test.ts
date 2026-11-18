import { ApplicationFailure } from "@temporalio/common";
import { describe, expect, it, vi } from "vitest";
import { selectSources } from "../dist/select.js";
import { assertAllowedUrl, readWikipediaArticle, searchWikipedia } from "../dist/tools/wikipedia.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("wikipedia tools", () => {
  it("searches and strips HTML from snippets", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ query: { search: [{ title: "Apollo 11", snippet: 'first <span class="searchmatch">crewed</span> landing' }] } }),
    );
    const hits = await searchWikipedia("moon landing", 4, fetchMock as unknown as typeof fetch);

    expect(hits).toEqual([{ title: "Apollo 11", url: "https://en.wikipedia.org/wiki/Apollo_11", snippet: "first crewed landing" }]);
    const url = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(url.hostname).toBe("en.wikipedia.org");
    expect(url.searchParams.get("srsearch")).toBe("moon landing");
    expect(url.searchParams.get("srlimit")).toBe("4");
  });

  it("reads an article and truncates it", async () => {
    const extract = "line\n".repeat(5000);
    const fetchMock = vi.fn(async () => jsonResponse({ query: { pages: [{ title: "Apollo 11", extract }] } }));
    const article = await readWikipediaArticle("Apollo 11", 1000, fetchMock as unknown as typeof fetch);

    expect(article?.url).toBe("https://en.wikipedia.org/wiki/Apollo_11");
    expect(article!.text.length).toBeLessThanOrEqual(1000 + "\n[truncated]".length);
    expect(article!.text.endsWith("[truncated]")).toBe(true);
  });

  it("returns undefined for a missing article", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ query: { pages: [{ title: "Nope", missing: true }] } }));
    expect(await readWikipediaArticle("Nope", 1000, fetchMock as unknown as typeof fetch)).toBeUndefined();
  });

  it("retries rate limits but not other HTTP errors", async () => {
    const rateLimited = vi.fn(async () => jsonResponse({}, 429));
    await expect(searchWikipedia("x", 1, rateLimited as unknown as typeof fetch)).rejects.not.toBeInstanceOf(ApplicationFailure);

    const forbidden = vi.fn(async () => jsonResponse({}, 403));
    const error = await searchWikipedia("x", 1, forbidden as unknown as typeof fetch).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApplicationFailure);
    expect((error as ApplicationFailure).nonRetryable).toBe(true);
  });

  it("refuses hosts outside the allow-list", () => {
    expect(() => assertAllowedUrl("https://en.wikipedia.org/w/api.php")).not.toThrow();
    const error = (() => {
      try {
        assertAllowedUrl("https://attacker.example/steal");
      } catch (e) {
        return e;
      }
    })();
    expect(error).toBeInstanceOf(ApplicationFailure);
    expect((error as ApplicationFailure).type).toBe("ToolNotAllowed");
  });
});

describe("selectSources", () => {
  const hit = (title: string) => ({ title, url: `u/${title}`, snippet: "" });

  it("takes each query's best hit first and skips duplicates", () => {
    const picked = selectSources([[hit("A"), hit("B")], [hit("a"), hit("C")], [hit("D")]], 10);
    expect(picked.map((h) => h.title)).toEqual(["A", "D", "B", "C"]);
  });

  it("stops at the maximum", () => {
    expect(selectSources([[hit("A"), hit("B")], [hit("C")]], 2).map((h) => h.title)).toEqual(["A", "C"]);
  });
});
