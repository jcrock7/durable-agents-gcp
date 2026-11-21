import { describe, expect, it } from "vitest";
import { MODEL_REQUEST_TIMEOUT_MS, timeoutFetch } from "../dist/index.js";

/** A fetch that never answers, but rejects when its signal aborts (like a hung gateway). */
const hanging: typeof fetch = (_url, init) =>
  new Promise((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(init.signal!.reason));
  });

describe("timeoutFetch", () => {
  it("fails a model request that hangs past the limit, so Temporal retries the activity", async () => {
    const started = Date.now();
    const error = await timeoutFetch(50, hanging)("http://litellm/v1/chat/completions", { method: "POST" }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(/model request timed out after 0\.05s/);
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it("passes a prompt answer through, and still honours the caller's cancellation", async () => {
    const ok: typeof fetch = async () => new Response("{}", { status: 200 });
    expect((await timeoutFetch(1_000, ok)("http://x")).status).toBe(200);
    const caller = new AbortController();
    const pending = timeoutFetch(10_000, hanging)("http://x", { signal: caller.signal }).catch((e: unknown) => e);
    caller.abort(new Error("activity cancelled"));
    expect(((await pending) as Error).message).toBe("activity cancelled");
  });

  it("defaults to 60 seconds, well under the 180s activity timeout", () => {
    expect(MODEL_REQUEST_TIMEOUT_MS).toBe(60_000);
  });
});
