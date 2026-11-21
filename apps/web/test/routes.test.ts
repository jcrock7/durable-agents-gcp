import { describe, expect, it } from "vitest";
import { parseHash } from "../src/routes.js";

describe("parseHash", () => {
  it("readHash parses the live route", () => {
    expect(parseHash("#/agent/invoice-exception-resolver/case/inv-20931/live")).toEqual({ view: "agent", agent: "invoice-exception-resolver", case: "inv-20931", live: true });
    expect(parseHash("#/agent/invoice-exception-resolver/case/inv-20931")).toEqual({ view: "agent", agent: "invoice-exception-resolver", case: "inv-20931" });
    expect(parseHash("#/agent/invoice-exception-resolver")).toEqual({ view: "agent", agent: "invoice-exception-resolver", case: undefined });
    expect(parseHash("#/cases/needs")).toEqual({ view: "needs" });
    expect(parseHash("#/overview/health")).toEqual({ view: "overview", health: true });
  });
});
