import { describe, expect, it } from "vitest";

import {
  distributePaneHeights,
  minimumPaneHeightPx,
} from "../src/panes/pane-resize-geometry";

describe("pane resize geometry", () => {
  it("preserves the requested total and distributes rounding deterministically", () => {
    expect(distributePaneHeights(401, [1, 1])).toEqual([201, 200]);
    expect(distributePaneHeights(492, [3, 1])).toEqual([369, 123]);
  });

  it("keeps every pane usable while preserving the fixed stack height", () => {
    expect(distributePaneHeights(300, [4, 1])).toEqual([
      204,
      minimumPaneHeightPx,
    ]);
    expect(distributePaneHeights(100, [1, 1])).toEqual([
      minimumPaneHeightPx,
      minimumPaneHeightPx,
    ]);
  });
});
