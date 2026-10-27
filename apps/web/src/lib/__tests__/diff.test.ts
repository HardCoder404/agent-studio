import { describe, expect, it } from "vitest";
import { diff, wordDiff } from "../diff";

describe("diff", () => {
  it("reports added, removed and changed keys, nested", () => {
    const a = { topic: "x", draft: "one", meta: { n: 1, keep: true } };
    const b = { topic: "x", draft: "two", decision: "yes", meta: { n: 2, keep: true } };
    expect(diff(a, b)).toEqual([
      { path: "draft", kind: "changed", before: "one", after: "two" },
      { path: "meta.n", kind: "changed", before: 1, after: 2 },
      { path: "decision", kind: "added", after: "yes" },
    ]);
    expect(diff(b, a).find((c) => c.path === "decision")?.kind).toBe("removed");
  });
  it("is empty for equal values", () => {
    expect(diff({ a: [1, 2] }, { a: [1, 2] })).toEqual([]);
  });
});

describe("wordDiff", () => {
  it("marks inserted and deleted words", () => {
    const runs = wordDiff("the quick fox", "the slow brown fox");
    expect(runs.map(([k, t]) => k + ":" + t)).toEqual(["same:the ", "del:quick", "ins:slow", "same: ", "ins:brown ", "same:fox"]);
  });
});
