import { describe, expect, test } from "vitest";

import { interpolatePaneRenderItems } from "../src/presentation/pane-render-interpolation";
import type { PaneRenderItem, WorkspacePresentationMode } from "../src/types";

describe("workspace pane render interpolation", () => {
  test("interpolates pane geometry between normal and overview frames", () => {
    const items = interpolatePaneRenderItems({
      normalItems: [renderItem("pane-a", "normal", 10, 20, 300, 400, 1)],
      overviewItems: [renderItem("pane-a", "overview", 90, 140, 120, 160, 0.4)],
      overviewProgress: 0.5,
      presentationMode: "overview",
    });

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      height: 280,
      moving: true,
      paneId: "pane-a",
      presentationMode: "overview",
      scale: 0.7,
      width: 210,
      x: 50,
      y: 80,
    });
  });

  test("fades panes that only exist in one endpoint frame", () => {
    const items = interpolatePaneRenderItems({
      normalItems: [renderItem("visible-pane", "normal", 10, 10, 300, 400, 1)],
      overviewItems: [
        renderItem("visible-pane", "overview", 20, 20, 120, 160, 0.4),
        renderItem("overview-only-pane", "overview", 140, 20, 120, 160, 0.4),
      ],
      overviewProgress: 0.25,
      presentationMode: "overview",
    });

    expect(items.map((item) => [item.paneId, item.opacity])).toEqual([
      ["visible-pane", 1],
      ["overview-only-pane", 0.25],
    ]);
  });

  test("supports a seamless reversal while exiting overview", () => {
    const items = interpolatePaneRenderItems({
      includeSecondaryOnlyItems: false,
      normalItems: [renderItem("visible-pane", "normal", 10, 10, 300, 400, 1)],
      overviewItems: [
        renderItem("visible-pane", "overview", 20, 20, 120, 160, 0.4),
        renderItem("overview-only-pane", "overview", 140, 20, 120, 160, 0.4),
      ],
      overviewProgress: 0.75,
      presentationMode: "normal",
    });

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      paneId: "visible-pane",
      presentationMode: "normal",
      scale: 0.55,
      width: 165,
      x: 17.5,
      y: 17.5,
    });
  });
});

function renderItem(
  paneId: string,
  presentationMode: WorkspacePresentationMode,
  x: number,
  y: number,
  width: number,
  height: number,
  scale: number,
): PaneRenderItem {
  return {
    focused: paneId === "pane-a",
    height,
    maximized: false,
    moving: false,
    opacity: 1,
    paneId,
    presentationMode,
    resizing: false,
    runtimeState: "live",
    scale,
    surfaceId: `${paneId}_surface`,
    surfaceKind: "fake-dom",
    visible: true,
    width,
    x,
    y,
    z: 1,
  };
}
