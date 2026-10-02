import { describe, expect, it } from "vitest";

import {
  defaultMinimapPlacement,
  minimapMinimumSize,
  nearestMinimapCorner,
  resizedMinimapPlacement,
  resolveMinimapPlacement,
} from "../src/input/workspace-minimap-placement";

describe("minimap placement", () => {
  it("fills missing or invalid placement fields from the bottom-right default", () => {
    expect(resolveMinimapPlacement(undefined)).toEqual(defaultMinimapPlacement);
    expect(
      resolveMinimapPlacement({
        corner: "sideways" as never,
        heightPx: Number.NaN,
        widthPx: 10,
      }),
    ).toEqual({
      corner: "bottom-right",
      heightPx: defaultMinimapPlacement.heightPx,
      widthPx: minimapMinimumSize.widthPx,
    });
    expect(resolveMinimapPlacement({ corner: "top-left" })).toEqual({
      ...defaultMinimapPlacement,
      corner: "top-left",
    });
  });

  it("snaps a released minimap to the corner of the stage quadrant holding its center", () => {
    const stage = { height: 600, width: 1000 };

    expect(nearestMinimapCorner({ x: 100, y: 100 }, stage)).toBe("top-left");
    expect(nearestMinimapCorner({ x: 900, y: 100 }, stage)).toBe("top-right");
    expect(nearestMinimapCorner({ x: 100, y: 500 }, stage)).toBe("bottom-left");
    expect(nearestMinimapCorner({ x: 900, y: 500 }, stage)).toBe(
      "bottom-right",
    );
  });

  it("grows away from the anchored corner and stays within the stage", () => {
    const limit = { height: 400, width: 600 };
    const start = { heightPx: 140, widthPx: 200 };

    expect(
      resizedMinimapPlacement(
        { ...start, corner: "bottom-right" },
        { x: -50, y: -30 },
        limit,
      ),
    ).toEqual({ corner: "bottom-right", heightPx: 170, widthPx: 250 });
    expect(
      resizedMinimapPlacement(
        { ...start, corner: "top-left" },
        { x: -50, y: -30 },
        limit,
      ),
    ).toEqual({ corner: "top-left", heightPx: 110, widthPx: 150 });
    expect(
      resizedMinimapPlacement(
        { ...start, corner: "top-right" },
        { x: -2000, y: 2000 },
        limit,
      ),
    ).toEqual({ corner: "top-right", heightPx: 400, widthPx: 600 });
    expect(
      resizedMinimapPlacement(
        { ...start, corner: "bottom-left" },
        { x: -2000, y: 2000 },
        limit,
      ),
    ).toEqual({
      corner: "bottom-left",
      heightPx: minimapMinimumSize.heightPx,
      widthPx: minimapMinimumSize.widthPx,
    });
  });
});
