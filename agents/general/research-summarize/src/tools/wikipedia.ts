import { ApplicationFailure } from "@temporalio/common";
import { FailureType } from "@agents/agent-kit";
import { agentConfig } from "../agent.config.js";
import type { SearchHit } from "../types.js";

// Wikipedia's public API: no key needed. Wikimedia asks clients to identify themselves.
const API_URL = "https://en.wikipedia.org/w/api.php";
const USER_AGENT = process.env.WIKIPEDIA_USER_AGENT ?? "durable-agents-gcp/0.1 (research-summarize agent)";

export type Fetch = typeof fetch;

/** The tool allow-list: refuse any URL whose host isn't listed in agent.config.ts. */
export function assertAllowedUrl(url: string): void {
  const host = new URL(url).hostname;
  if (!(agentConfig.allowedHosts as readonly string[]).includes(host)) {
    throw ApplicationFailure.nonRetryable(`tool call to ${host} is not on the allow-list`, FailureType.ToolNotAllowed);
  }
}

async function callApi(params: Record<string, string>, fetchImpl: Fetch): Promise<unknown> {
  const url = `${API_URL}?${new URLSearchParams({ format: "json", formatversion: "2", ...params })}`;
  assertAllowedUrl(url);
  const response = await fetchImpl(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    // 429 and 5xx are worth retrying; other errors won't change on retry.
    const retryable = response.status === 429 || response.status >= 500;
    const message = `Wikipedia API returned HTTP ${response.status}`;
    throw retryable ? new Error(message) : ApplicationFailure.nonRetryable(message, "ToolCallFailed");
  }
  return response.json();
}

export function articleUrl(title: string): string {
  return `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replaceAll(" ", "_"))}`;
}

/** Full-text search. Returns article titles, URLs and plain-text snippets. */
export async function searchWikipedia(query: string, limit: number, fetchImpl: Fetch = fetch): Promise<SearchHit[]> {
  const data = (await callApi(
    { action: "query", list: "search", srsearch: query, srlimit: String(limit), srprop: "snippet" },
    fetchImpl,
  )) as { query?: { search?: { title: string; snippet?: string }[] } };
  return (data.query?.search ?? []).map((hit) => ({
    title: hit.title,
    url: articleUrl(hit.title),
    snippet: stripTags(hit.snippet ?? ""),
  }));
}

/** An article's plain-text extract, truncated to `maxChars`. Undefined if the page doesn't exist. */
export async function readWikipediaArticle(
  title: string,
  maxChars: number,
  fetchImpl: Fetch = fetch,
): Promise<{ title: string; url: string; text: string } | undefined> {
  const data = (await callApi(
    { action: "query", prop: "extracts", explaintext: "1", exsectionformat: "plain", redirects: "1", titles: title },
    fetchImpl,
  )) as { query?: { pages?: { title: string; missing?: boolean; extract?: string }[] } };
  const page = data.query?.pages?.[0];
  if (!page || page.missing || !page.extract?.trim()) return undefined;
  return { title: page.title, url: articleUrl(page.title), text: truncate(page.extract.trim(), maxChars) };
}

function stripTags(html: string): string {
  return html
    .replace(/<[^>]*>/g, "")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&amp;/g, "&");
}

function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const cut = text.slice(0, maxChars);
  const lastBreak = cut.lastIndexOf("\n");
  return `${lastBreak > maxChars * 0.8 ? cut.slice(0, lastBreak) : cut}\n[truncated]`;
}
