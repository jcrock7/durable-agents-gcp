import { MockActivityEnvironment } from "@temporalio/testing";
import { describe, expect, it } from "vitest";
import { withHeartbeat } from "../dist/index.js";

describe("withHeartbeat", () => {
  it("sends the latest progress details on each heartbeat", async () => {
    const env = new MockActivityEnvironment();
    const beats: unknown[] = [];
    env.on("heartbeat", (d: unknown) => beats.push(d));
    await env.run(() =>
      withHeartbeat(async (_signal, progress) => {
        progress({ n: 1 });
        progress({ n: 2 });
        await new Promise((r) => setTimeout(r, 30));
      }, 10),
    );
    expect(beats).toContainEqual({ n: 1 });
    expect(beats).toContainEqual({ n: 2 });
    expect(beats.at(-1)).toEqual({ n: 2 });
  });
});
