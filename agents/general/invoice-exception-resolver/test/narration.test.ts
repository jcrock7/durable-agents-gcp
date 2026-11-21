import { describe, expect, it } from "vitest";
import { splitNarration } from "../dist/prompts/index.js";

describe("splitNarration", () => {
  it("gatherEvidence strips the NARRATION line from notes", () => {
    expect(splitNarration("Looked up the PO.\nFound Amendment-07.\nNARRATION: The amendment explains the price.")).toEqual({
      notes: "Looked up the PO.\nFound Amendment-07.",
      narration: "The amendment explains the price.",
    });
  });
  it("leaves notes alone when there is no NARRATION line", () => {
    expect(splitNarration("Just notes.")).toEqual({ notes: "Just notes." });
  });
});
