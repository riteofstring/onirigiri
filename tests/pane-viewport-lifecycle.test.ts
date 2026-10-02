import { describe, expect, it } from "vitest";

import type { WorkspaceLayoutSnapshot } from "../src/state/layout-store";
import { PaneViewportLifecycle } from "../src/panes/pane-viewport-lifecycle";
import type {
  PaneRenderItem,
  WorkspacePane,
  WorkspaceWorldFrame,
} from "../src/types";

describe("PaneViewportLifecycle", () => {
  it("mounts only a swept edge entrant during motion and retains visited panes", () => {
    const lifecycle = new PaneViewportLifecycle(8);
    const panes = [pane("a"), pane("b"), pane("c")];

    expect(
      lifecycle
        .resolve({
          items: [item("a", true), item("b", true)],
          moving: false,
          panes,
          snapshot: snapshot("a"),
          viewport,
        })
        .map((candidate) => candidate.paneId),
    ).toEqual(["a", "b"]);

    const moving = lifecycle.resolve({
      items: [
        item("a", false, { runtimeState: "hidden" }),
        item("b", true, { runtimeState: "frozen" }),
        item("c", true, {
          preload: true,
          runtimeState: "frozen",
        }),
      ],
      moving: true,
      panes,
      snapshot: snapshot("b"),
      viewport,
    });
    expect(moving.map((candidate) => candidate.paneId)).toEqual([
      "a",
      "b",
      "c",
    ]);
    expect(moving.find(({ paneId }) => paneId === "b")?.placeholderOnly).toBe(
      undefined,
    );
    expect(moving.find(({ paneId }) => paneId === "c")?.placeholderOnly).toBe(
      true,
    );

    const settled = lifecycle.resolve({
      items: [item("b", true), item("c", true)],
      moving: false,
      panes,
      snapshot: snapshot("b"),
      viewport,
    });
    expect(settled.map((candidate) => candidate.paneId)).toEqual([
      "a",
      "b",
      "c",
    ]);
    expect(
      settled.find(({ paneId }) => paneId === "c")?.placeholderOnly,
    ).toBeUndefined();
  });

  it("starts a cold focused destination behind its motion surface", () => {
    const lifecycle = new PaneViewportLifecycle(1);
    const panes = [pane("a"), pane("b")];
    lifecycle.resolve({
      items: [item("a", true, { focused: true })],
      moving: false,
      panes,
      snapshot: snapshot("a"),
      viewport,
    });

    const moving = lifecycle.resolve({
      items: [
        item("a", false, {
          focused: false,
          runtimeState: "hidden",
        }),
        item("b", true, {
          focused: true,
          preload: true,
          runtimeState: "frozen",
        }),
      ],
      moving: true,
      panes,
      snapshot: snapshot("b"),
      viewport,
    });

    const focused = moving.find(({ paneId }) => paneId === "b");
    expect(focused).toMatchObject({
      focused: true,
      runtimeState: "frozen",
    });
    expect(focused?.placeholderOnly).toBeUndefined();
  });

  it("mounts preloaded sweep destinations behind the motion surface when motion mounting is enabled", () => {
    const lifecycle = new PaneViewportLifecycle(2);
    const panes = [pane("a"), pane("b")];
    lifecycle.resolve({
      items: [item("a", true, { focused: true })],
      moving: false,
      panes,
      snapshot: snapshot("a"),
      viewport,
    });

    const moving = lifecycle.resolve({
      items: [
        item("a", true, {
          focused: true,
          moving: true,
          runtimeState: "frozen",
        }),
        item("b", true, {
          moving: true,
          preload: true,
          runtimeState: "frozen",
        }),
      ],
      mountContentDuringMotion: true,
      moving: true,
      panes,
      snapshot: snapshot("a"),
      viewport,
    });

    const entrant = moving.find(({ paneId }) => paneId === "b");
    expect(entrant).toMatchObject({
      preload: true,
      runtimeState: "frozen",
    });
    expect(entrant?.placeholderOnly).toBeUndefined();
  });

  it("bounds motion mounting to panes that reach the destination viewport", () => {
    const lifecycle = new PaneViewportLifecycle(8);
    const panes = [pane("a"), pane("b"), pane("c")];
    lifecycle.resolve({
      items: [item("a", true, { focused: true })],
      moving: false,
      panes,
      snapshot: snapshot("a"),
      viewport,
    });

    const moving = lifecycle.resolve({
      items: [
        item("a", true, {
          focused: true,
          moving: true,
          runtimeState: "frozen",
        }),
        item("b", true, {
          moving: true,
          preload: true,
          runtimeState: "frozen",
          x: 240,
        }),
        item("c", true, {
          moving: true,
          preload: true,
          runtimeState: "frozen",
          x: 120,
        }),
      ],
      mountContentDuringMotion: true,
      moving: true,
      panes,
      snapshot: snapshot("a", { targetScrollColumn: 2 }),
      targetWorldFrame: worldFrame(-240),
      viewport,
    });

    expect(moving.find(({ paneId }) => paneId === "b")?.placeholderOnly).toBe(
      undefined,
    );
    expect(moving.find(({ paneId }) => paneId === "c")?.placeholderOnly).toBe(
      true,
    );
  });

  it("promotes a retained placeholder shell once a later motion targets it", () => {
    const lifecycle = new PaneViewportLifecycle(8);
    const panes = [pane("a"), pane("b")];
    lifecycle.resolve({
      items: [item("a", true, { focused: true })],
      moving: false,
      panes,
      snapshot: snapshot("a"),
      viewport,
    });
    const corridor = lifecycle.resolve({
      items: [
        item("a", true, {
          focused: true,
          moving: true,
          runtimeState: "frozen",
        }),
        item("b", true, {
          moving: true,
          preload: true,
          runtimeState: "frozen",
          x: 240,
        }),
      ],
      mountContentDuringMotion: true,
      moving: true,
      panes,
      snapshot: snapshot("a"),
      targetWorldFrame: worldFrame(-120),
      viewport,
    });
    const shell = corridor.find(({ paneId }) => paneId === "b");
    expect(shell?.placeholderOnly).toBe(true);

    const retargeted = lifecycle.resolve({
      items: [
        item("a", true, {
          focused: true,
          moving: true,
          runtimeState: "frozen",
        }),
        item("b", true, {
          moving: true,
          preload: true,
          runtimeState: "frozen",
          x: 240,
        }),
      ],
      mountContentDuringMotion: true,
      moving: true,
      panes,
      snapshot: snapshot("a", { targetScrollColumn: 2 }),
      targetWorldFrame: worldFrame(-240),
      viewport,
    });
    const mounted = retargeted.find(({ paneId }) => paneId === "b");
    expect(mounted).not.toBe(shell);
    expect(mounted?.placeholderOnly).toBeUndefined();
  });

  it("keeps cold overview shells unmounted at rest", () => {
    const lifecycle = new PaneViewportLifecycle(8);
    const panes = [pane("a"), pane("b")];
    lifecycle.resolve({
      items: [item("a", true)],
      moving: false,
      panes,
      snapshot: snapshot("a"),
      viewport,
    });

    const entering = lifecycle.resolve({
      items: [
        item("a", true, {
          moving: true,
          presentationMode: "overview",
          runtimeState: "frozen",
        }),
        item("b", true, {
          moving: true,
          preload: true,
          presentationMode: "overview",
          runtimeState: "frozen",
        }),
      ],
      moving: true,
      panes,
      snapshot: snapshot("a", {
        overviewProgress: 0.5,
        presentationMode: "overview",
      }),
      viewport,
    });
    expect(entering.find(({ paneId }) => paneId === "b")?.placeholderOnly).toBe(
      true,
    );

    const settled = lifecycle.resolve({
      items: [
        item("a", true, {
          presentationMode: "overview",
          runtimeState: "frozen",
        }),
        item("b", true, {
          presentationMode: "overview",
          runtimeState: "frozen",
        }),
      ],
      moving: false,
      panes,
      snapshot: snapshot("a", {
        overviewProgress: 1,
        presentationMode: "overview",
      }),
      viewport,
    });
    expect(settled.find(({ paneId }) => paneId === "b")?.placeholderOnly).toBe(
      true,
    );
  });

  it("does not mount every visible runway candidate while a camera sweep is active", () => {
    const lifecycle = new PaneViewportLifecycle(8);
    const panes = [pane("a"), pane("b"), pane("c")];
    lifecycle.resolve({
      items: [item("a", true)],
      moving: false,
      panes,
      snapshot: snapshot("a"),
      viewport,
    });

    const unmarked = lifecycle.resolve({
      items: [
        item("a", true, { moving: true, runtimeState: "frozen" }),
        item("b", true, { moving: true, runtimeState: "frozen" }),
        item("c", true, { moving: true, runtimeState: "frozen" }),
      ],
      moving: true,
      panes,
      snapshot: snapshot("a", { targetScrollColumn: 2 }),
      viewport,
    });
    expect(unmarked.map(({ paneId }) => paneId)).toEqual(["a"]);

    const swept = lifecycle.resolve({
      items: [
        item("a", true, { moving: true, runtimeState: "frozen" }),
        item("b", true, {
          moving: true,
          preload: true,
          runtimeState: "frozen",
        }),
        item("c", true, { moving: true, runtimeState: "frozen" }),
      ],
      moving: true,
      panes,
      snapshot: snapshot("a", { targetScrollColumn: 2 }),
      viewport,
    });
    expect(swept.map(({ paneId }) => paneId)).toEqual(["a", "b"]);
  });

  it("leaves cold overscan unmounted even when the idle DOM budget has spare area", () => {
    const lifecycle = new PaneViewportLifecycle(2);
    const panes = [pane("a"), pane("b"), pane("c")];

    const mounted = lifecycle.resolve({
      items: [
        item("a", true),
        item("b", false, { x: 110 }),
        item("c", false, { x: 220 }),
      ],
      moving: false,
      panes,
      snapshot: snapshot("a"),
      viewport,
    });

    expect(mounted.map(({ paneId }) => paneId)).toEqual(["a"]);
  });

  it("keeps cold overscan unmounted beside a parked focused shell", () => {
    const lifecycle = new PaneViewportLifecycle(2);
    const panes = [pane("warm"), pane("cold"), pane("near"), pane("far")];
    lifecycle.resolve({
      items: [item("warm", true)],
      moving: false,
      panes,
      snapshot: snapshot("warm"),
      viewport,
    });
    lifecycle.resolve({
      items: [
        item("cold", true, {
          focused: true,
          presentationMode: "overview",
          runtimeState: "frozen",
          width: 500,
        }),
      ],
      moving: false,
      panes,
      snapshot: snapshot("cold", {
        presentationMode: "overview",
        overviewProgress: 1,
      }),
      viewport,
    });
    const mounted = lifecycle.resolve({
      items: [
        item("warm", true),
        item("cold", false, { focused: true, width: 500, x: 1000 }),
        item("near", false, { x: 110 }),
        item("far", false, { x: 220 }),
      ],
      moving: false,
      panes,
      snapshot: snapshot("cold"),
      viewport,
    });
    expect(mounted.map(({ paneId }) => paneId)).toEqual(["warm", "cold"]);
    expect(
      mounted.find(({ paneId }) => paneId === "cold")?.placeholderOnly,
    ).toBe(true);
    expect(mounted.find(({ paneId }) => paneId === "near")).toBeUndefined();
    const next = lifecycle.resolve({
      items: [item("near", true), item("far", true)],
      moving: false,
      panes,
      snapshot: snapshot("near"),
      viewport,
    });
    expect(next.map(({ paneId }) => paneId)).toEqual(["near", "far"]);
  });

  it("refreshes parked content dimensions when the viewport is measured", () => {
    const lifecycle = new PaneViewportLifecycle(8);
    const panes = [pane("a"), pane("b")];
    lifecycle.resolve({
      items: [item("b", true, { width: 1, height: 1 })],
      moving: false,
      panes,
      snapshot: snapshot("b"),
      viewport,
    });
    const measured = lifecycle.resolve({
      items: [item("a", true), item("b", false, { x: 110 })],
      moving: false,
      panes,
      snapshot: snapshot("a"),
      viewport,
    });
    expect(measured.find(({ paneId }) => paneId === "b")).toMatchObject({
      width: 100,
      height: 100,
      x: 110,
    });
  });

  it("keeps parked React item identity through scheduler-owned motion", () => {
    const lifecycle = new PaneViewportLifecycle(2);
    const panes = [pane("a"), pane("b")];
    lifecycle.resolve({
      items: [item("b", true)],
      moving: false,
      panes,
      snapshot: snapshot("b"),
      viewport,
    });
    const initial = lifecycle.resolve({
      items: [item("a", true), item("b", false, { x: 110 })],
      moving: false,
      panes,
      snapshot: snapshot("a"),
      viewport,
    });
    const parked = initial.at(1);

    const duringMotion = lifecycle.resolve({
      items: [item("a", true, { moving: true })],
      moving: true,
      panes,
      snapshot: snapshot("b"),
      viewport,
    });

    expect(parked).toBeDefined();
    expect(duringMotion.at(1)).toBe(parked);
  });

  it("keeps unfocused visible frozen items through a moving retarget", () => {
    const lifecycle = new PaneViewportLifecycle(8);
    const panes = [pane("a"), pane("b"), pane("c")];
    lifecycle.resolve({
      items: [
        item("a", true, { focused: true }),
        item("b", true),
        item("c", true),
      ],
      moving: false,
      panes,
      snapshot: snapshot("a"),
      viewport,
    });

    const firstMotion = lifecycle.resolve({
      items: [
        item("a", true, {
          focused: false,
          moving: true,
          runtimeState: "frozen",
          x: -40,
        }),
        item("b", true, {
          focused: true,
          moving: true,
          runtimeState: "frozen",
          x: 60,
        }),
        item("c", true, {
          moving: true,
          runtimeState: "frozen",
          x: 160,
        }),
      ],
      moving: true,
      panes,
      snapshot: snapshot("b"),
      viewport,
    });
    const unfocused = firstMotion.find(({ paneId }) => paneId === "a");
    const newlyFocused = firstMotion.find(({ paneId }) => paneId === "c");

    const retargetedMotion = lifecycle.resolve({
      items: [
        item("a", true, {
          focused: false,
          moving: true,
          runtimeState: "frozen",
          x: -80,
        }),
        item("b", true, {
          focused: false,
          moving: true,
          runtimeState: "frozen",
          x: 20,
        }),
        item("c", true, {
          focused: true,
          moving: true,
          runtimeState: "frozen",
          x: 120,
        }),
      ],
      moving: true,
      panes,
      snapshot: snapshot("c"),
      viewport,
    });

    expect(retargetedMotion.find(({ paneId }) => paneId === "a")).toBe(
      unfocused,
    );
    expect(retargetedMotion.find(({ paneId }) => paneId === "c")).not.toBe(
      newlyFocused,
    );
  });

  it("evicts idle offscreen panes by retained area and recency, not pane count", () => {
    const lifecycle = new PaneViewportLifecycle(2);
    const panes = [pane("a"), pane("b"), pane("c")];
    lifecycle.resolve({
      items: [item("a", true)],
      moving: false,
      panes,
      snapshot: snapshot("a"),
      viewport,
    });
    lifecycle.resolve({
      items: [item("b", true)],
      moving: false,
      panes,
      snapshot: snapshot("b"),
      viewport,
    });
    lifecycle.resolve({
      items: [item("c", true)],
      moving: false,
      panes,
      snapshot: snapshot("c"),
      viewport,
    });

    expect(lifecycle.retainedPaneIds()).toEqual(["b", "c"]);
  });

  it("keeps uncaptured content before content with a retained picture within the same budget", () => {
    const pictures = new Set(["b"]);
    const lifecycle = new PaneViewportLifecycle(2, (id) => pictures.has(id));
    const panes = [pane("a"), pane("b"), pane("c"), pane("d")];
    const visit = (id: string) =>
      lifecycle.resolve({
        items: [item(id, true)],
        moving: false,
        panes,
        snapshot: snapshot(id),
        viewport,
      });
    visit("a");
    visit("b");
    visit("c");
    expect(lifecycle.retainedPaneIds()).toEqual(["a", "c"]);
    pictures.add("a");
    visit("d");
    expect(lifecycle.retainedPaneIds()).toEqual(["c", "d"]);
    lifecycle.setRetainedAreaBudgetViewports(1);
    visit("d");
    expect(lifecycle.retainedPaneIds()).toEqual(["d"]);
  });

  it("does not charge cold overview shells against retained content and drops hidden shells", () => {
    const lifecycle = new PaneViewportLifecycle(2);
    const panes = [
      pane("warm"),
      pane("cold-a"),
      pane("cold-b"),
      pane("cold-c"),
    ];
    lifecycle.resolve({
      items: [item("warm", true, { focused: true })],
      moving: false,
      panes,
      snapshot: snapshot("warm"),
      viewport,
    });
    for (const cold of ["cold-a", "cold-b", "cold-c"]) {
      const overviewSnapshot = snapshot(cold, {
        presentationMode: "overview",
        overviewProgress: 1,
      });
      const items = [
        item(cold, true, {
          focused: true,
          preload: true,
          presentationMode: "overview",
          runtimeState: "frozen",
          width: 500,
        }),
      ];
      lifecycle.resolve({
        items,
        moving: true,
        panes,
        snapshot: overviewSnapshot,
        viewport,
      });
      const settled = lifecycle.resolve({
        items,
        moving: false,
        panes,
        snapshot: overviewSnapshot,
        viewport,
      });
      expect(settled.find(({ paneId }) => paneId === "warm")).toMatchObject({
        runtimeState: "hidden",
        visible: false,
      });
      expect(
        settled.find(({ paneId }) => paneId === cold)?.placeholderOnly,
      ).toBe(true);
      expect(settled.map(({ paneId }) => paneId)).toEqual(["warm", cold]);
    }
  });

  it("retains an offscreen focused pane until it returns to the structural runway", () => {
    const lifecycle = new PaneViewportLifecycle(1);
    const panes = [pane("focused"), pane("visible")];
    lifecycle.resolve({
      items: [item("focused", true, { focused: true })],
      moving: false,
      panes,
      snapshot: snapshot("focused"),
      viewport,
    });

    lifecycle.resolve({
      items: [item("visible", true)],
      moving: false,
      panes,
      snapshot: snapshot("focused"),
      viewport,
    });

    expect(lifecycle.retainedPaneIds()).toContain("focused");
  });

  it("budgets retained DOM at its layout size rather than its overview scale", () => {
    const lifecycle = new PaneViewportLifecycle(1);
    const panes = [pane("a"), pane("b")];
    lifecycle.resolve({
      items: [item("a", true, { scale: 0.1 })],
      moving: false,
      panes,
      snapshot: snapshot("a"),
      viewport,
    });
    lifecycle.resolve({
      items: [item("b", true, { scale: 0.1 })],
      moving: false,
      panes,
      snapshot: snapshot("b"),
      viewport,
    });

    expect(lifecycle.retainedPaneIds()).toEqual(["b"]);
  });

  it("reconciles idle eviction after lowering the area budget", () => {
    const lifecycle = new PaneViewportLifecycle(3);
    const panes = [pane("a"), pane("b"), pane("c")];
    lifecycle.resolve({
      items: panes.map(({ paneId }) => item(paneId, true)),
      moving: false,
      panes,
      snapshot: snapshot("c"),
      viewport,
    });
    lifecycle.resolve({
      items: [item("c", true)],
      moving: false,
      panes,
      snapshot: snapshot("c"),
      viewport,
    });

    lifecycle.setRetainedAreaBudgetViewports(1);
    const mounted = lifecycle.resolve({
      items: [item("c", true)],
      moving: false,
      panes,
      snapshot: snapshot("c"),
      viewport,
    });

    expect(lifecycle.retainedPaneIds()).toEqual(["c"]);
    expect(mounted).toEqual([expect.objectContaining({ paneId: "c" })]);
  });
});

const viewport = { height: 100, width: 100, x: 0, y: 0 };

function worldFrame(x: number): WorkspaceWorldFrame {
  return {
    focalScreenX: 0,
    focalScreenY: 0,
    focalWorldX: -x,
    focalWorldY: 0,
    grid: { height: 100, width: 100, x: -x, y: 0 },
    scale: 1,
    x,
    y: 0,
  };
}

function pane(paneId: string): WorkspacePane {
  return {
    columnId: `column-${paneId}`,
    paneId,
    sequence: paneId.charCodeAt(0),
    subtitle: "",
    surfaceId: `surface-${paneId}`,
    surfaceKind: "test",
    title: paneId,
    tone: "slate",
  };
}

function item(
  paneId: string,
  visible: boolean,
  overrides: Partial<PaneRenderItem> = {},
): PaneRenderItem {
  return {
    focused: false,
    height: 100,
    maximized: false,
    moving: false,
    opacity: visible ? 1 : 0,
    paneId,
    presentationMode: "normal",
    resizing: false,
    runtimeState: visible ? "live" : "hidden",
    scale: 1,
    surfaceId: `surface-${paneId}`,
    surfaceKind: "test",
    visible,
    width: 100,
    x: 0,
    y: 0,
    z: 1,
    ...overrides,
  };
}

function snapshot(
  focusedPaneId: string,
  overrides: Partial<WorkspaceLayoutSnapshot> = {},
): WorkspaceLayoutSnapshot {
  return {
    cursor: { column: 0, row: 0, split: 0 },
    focusAnchor: "start",
    focusedPaneId,
    horizontalAnchorOffset: 0,
    layoutChangeKind: "initial",
    layoutMutationId: 0,
    layoutRevision: 0,
    maximizedPaneId: null,
    overviewFollowOffsetX: 0,
    overviewFollowOffsetY: 0,
    overviewPanX: 0,
    overviewPanY: 0,
    overviewProgress: 0,
    overviewZoom: 1,
    paneRearrangementRevision: 0,
    paneRearrangementSelection: "pane",
    presentationMode: "normal",
    revision: 0,
    scrollColumn: 0,
    scrollRow: 0,
    selectedGroupColumnId: null,
    targetHorizontalAnchorOffset: 0,
    targetScrollColumn: 0,
    targetScrollRow: 0,
    targetVerticalAnchorOffset: 0,
    verticalAnchorOffset: 0,
    ...overrides,
  };
}
