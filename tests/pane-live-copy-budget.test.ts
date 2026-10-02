import { describe, expect, it } from "vitest";

import { LiveCopyBudget } from "../src/pictures/pane-live-copy-budget";

function scheduler(budgetMs = 8) {
  let frame = 0;
  const budget = new LiveCopyBudget(() => frame, budgetMs);
  const surfaces = ["a", "b", "c"].map((name) => ({ name }));
  const runFrame = (costMs: number): string[] => {
    frame += 1;
    const copied: string[] = [];
    for (const surface of surfaces) {
      if (!budget.request(surface)) continue;
      budget.record(surface, costMs);
      copied.push(surface.name);
    }
    return copied;
  };
  return { budget, surfaces, runFrame };
}

describe("live copy budget", () => {
  it("refreshes every surface each frame while copies fit the budget", () => {
    const { runFrame } = scheduler();
    for (let index = 0; index < 5; index += 1)
      expect(runFrame(2)).toEqual(["a", "b", "c"]);
  });

  it("rotates expensive copies so every surface keeps refreshing", () => {
    const { runFrame } = scheduler();
    const copies = Array.from({ length: 9 }, () => runFrame(11));
    for (const copied of copies) expect(copied).toHaveLength(1);
    const counts = new Map<string, number>();
    for (const [name] of copies)
      counts.set(name!, (counts.get(name!) ?? 0) + 1);
    expect([...counts.values()]).toEqual([3, 3, 3]);
  });

  it("lets the longest-deferred surface copy before a fresher one", () => {
    const { budget, surfaces, runFrame } = scheduler();
    expect(runFrame(11)).toEqual(["a"]);
    expect(runFrame(11)).toEqual(["b"]);
    expect(runFrame(11)).toEqual(["c"]);
    expect(runFrame(11)).toEqual(["a"]);
    budget.forget(surfaces[1]!);
    expect(runFrame(11)).toEqual(["c"]);
  });

  it("copies at least once per frame when a single copy exceeds the budget", () => {
    const { runFrame } = scheduler(4);
    runFrame(16);
    for (let index = 0; index < 6; index += 1)
      expect(runFrame(16)).toHaveLength(1);
  });
});
