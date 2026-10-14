import { describe, expect, it, vi } from "vitest";

import { WorkspaceLikeLayoutEngine } from "../src/layout/layout-engine";
import { workspaceWorldRenderFrame } from "../src/presentation/workspace-render-items";
import { WorkspaceLayoutStore } from "../src/state/layout-store";
import {
  createWorkspaceScene,
  serializeWorkspaceLayout,
} from "../src/workspace/workspace-scene";

describe("workspace pane titles", () => {
  it.each([
    { presentation: "normal", selection: "pane" },
    { presentation: "normal", selection: "empty cell" },
    { presentation: "overview", selection: "pane" },
    { presentation: "overview", selection: "empty cell" },
  ] as const)(
    "renames another pane without moving the $selection in $presentation",
    ({ presentation, selection }) => {
      const result = createWorkspaceScene({
        gridAxes: "spatial",
        panes: [0, 1].map((index) => ({
          paneId: `pane-${index}`,
          slotIndex: index,
          surfaceKind: "test",
          title: `Pane ${index}`,
        })),
      });
      const engine = new WorkspaceLikeLayoutEngine(result.scene);
      const store = new WorkspaceLayoutStore(
        engine,
        result.scene,
        result.cursor,
      );
      const viewport = { height: 800, width: 1280, x: 0, y: 0 };
      store.ensureFocusedPaneVisible(viewport);
      store.focusPane("pane-1");
      if (selection === "empty cell") {
        expect(store.moveFocus("down", viewport)).toBe(true);
      }
      if (presentation === "overview") store.toggleOverviewMode();
      store.snapAnimationsToTarget();
      const before = store.getSnapshot();
      expect(before.focusedPaneId).toBe(selection === "pane" ? "pane-1" : null);
      const selectedCell = () =>
        engine.gridCursorRenderItem({
          ...store.getSnapshot(),
          movementPhase: "idle",
          viewport,
        });
      const beforeCell = selectedCell();

      expect(store.renamePane("pane-0", "Updated title")).toBe(true);

      expect(store.toScene().paneById.get("pane-0")?.title).toBe(
        "Updated title",
      );
      expect(store.getSnapshot()).toMatchObject({
        cursor: before.cursor,
        focusedPaneId: before.focusedPaneId,
        presentationMode: presentation,
        scrollColumn: before.scrollColumn,
        scrollRow: before.scrollRow,
        targetScrollColumn: before.targetScrollColumn,
        targetScrollRow: before.targetScrollRow,
        horizontalAnchorOffset: before.horizontalAnchorOffset,
        verticalAnchorOffset: before.verticalAnchorOffset,
        targetHorizontalAnchorOffset: before.targetHorizontalAnchorOffset,
        targetVerticalAnchorOffset: before.targetVerticalAnchorOffset,
      });
      expect(selectedCell()).toEqual(beforeCell);
    },
  );
});

describe("workspace overview pan recovery", () => {
  const viewport = { height: 800, width: 1280, x: 0, y: 0 };

  function workspace(overview: "fixed" | "follow", count = 1) {
    const result = createWorkspaceScene({
      gridAxes: "spatial",
      panes: Array.from({ length: count }, (_, index) => ({
        columnId: `pan-column-${index}`,
        columnWidth: { unit: "px" as const, value: 384 },
        paneId: `pan-pane-${index}`,
        planeIndex: Math.floor(index / 8),
        slotIndex: index % 8,
        surfaceKind: "test",
        title: `Pan pane ${index}`,
      })),
    });
    const engine = new WorkspaceLikeLayoutEngine(result.scene);
    const store = new WorkspaceLayoutStore(
      engine,
      result.scene,
      result.cursor,
      {
        initialCameraModes: { normal: "follow", overview },
      },
    );
    store.ensureFocusedPaneVisible(viewport);
    store.snapAnimationsToTarget();
    store.toggleOverviewMode();
    store.snapAnimationsToTarget();
    return {
      store,
      world: () =>
        workspaceWorldRenderFrame({
          engine,
          moving: false,
          snapshot: store.getSnapshot(),
          viewport,
        }),
      selected: () =>
        engine.gridCursorRenderItem({
          ...store.getSnapshot(),
          movementPhase: "idle",
          viewport,
        }),
    };
  }

  it.each([
    { overview: "fixed", direction: 1 },
    { overview: "fixed", direction: -1 },
    { overview: "follow", direction: 1 },
    { overview: "follow", direction: -1 },
  ] as const)(
    "recovers a displaced $overview view in direction $direction through incremental pans",
    ({ overview, direction }) => {
      const { store, world, selected } = workspace(overview);
      const initial = world();
      const near = { x: 100, y: 100 };
      const far = { x: 1180, y: 700 };
      const from = direction === 1 ? near : far;
      const to = direction === 1 ? far : near;
      expect(store.zoomOverviewBy(0.5, from.x, from.y, viewport)).toBe(true);
      expect(store.zoomOverviewBy(2, to.x, to.y, viewport)).toBe(true);
      const displaced = world();
      expect(displaced.scale).toBeCloseTo(initial.scale, 6);
      expect(displaced.x).toBeCloseTo(initial.x - direction * 1080, 6);
      expect(displaced.y).toBeCloseTo(initial.y - direction * 600, 6);

      expect(store.panOverviewBy(0, 0, viewport)).toBe(false);
      expect(store.panOverviewBy(direction * 40, 0, viewport)).toBe(false);
      expect(store.panOverviewBy(0, direction * 30, viewport)).toBe(false);
      expect(world()).toEqual(displaced);

      expect(store.panOverviewBy(-direction * 40, 0, viewport)).toBe(true);
      expect(world().x).toBeCloseTo(displaced.x + direction * 40, 6);
      expect(world().y).toBeCloseTo(displaced.y, 6);
      expect(store.panOverviewBy(0, -direction * 30, viewport)).toBe(true);
      const recovering = world();
      expect(recovering.x).toBeCloseTo(displaced.x + direction * 40, 6);
      expect(recovering.y).toBeCloseTo(displaced.y + direction * 30, 6);
      expect(recovering.scale).toBeCloseTo(initial.scale, 6);
      expect(
        store.panOverviewBy(direction * 40, direction * 30, viewport),
      ).toBe(false);
      expect(world()).toEqual(recovering);

      const focal = { x: 420, y: 300 };
      const point = {
        x: (focal.x - recovering.x) / recovering.scale,
        y: (focal.y - recovering.y) / recovering.scale,
      };
      expect(store.zoomOverviewBy(0.8, focal.x, focal.y, viewport)).toBe(true);
      const zoomed = world();
      expect(zoomed.x + point.x * zoomed.scale).toBeCloseTo(focal.x, 6);
      expect(zoomed.y + point.y * zoomed.scale).toBeCloseTo(focal.y, 6);
      expect(store.zoomOverviewBy(1.25, focal.x, focal.y, viewport)).toBe(true);
      expect(world().x).toBeCloseTo(recovering.x, 6);
      expect(world().y).toBeCloseTo(recovering.y, 6);

      expect(
        store.panOverviewBy(-direction * 100000, -direction * 100000, viewport),
      ).toBe(true);
      const recovered = world();
      expect(Math.abs(recovered.x - initial.x)).toBeLessThan(1);
      expect(Math.abs(recovered.y - initial.y)).toBeLessThan(1);
      expect(recovered.scale).toBeCloseTo(initial.scale, 6);
      const pane = selected();
      expect(pane.x).toBeGreaterThanOrEqual(0);
      expect(pane.y).toBeGreaterThanOrEqual(0);
      expect(pane.x + pane.width * pane.scale).toBeLessThanOrEqual(
        viewport.width,
      );
      expect(pane.y + pane.height * pane.scale).toBeLessThanOrEqual(
        viewport.height,
      );
      expect(store.panOverviewBy(-100, -100, viewport)).toBe(false);
      expect(store.panOverviewBy(100, 100, viewport)).toBe(false);
      expect(world()).toEqual(recovered);
    },
  );

  it("preserves ordinary bounded panning on both axes without a zoom offset", () => {
    const { store, world } = workspace("fixed", 24);
    const initial = world();
    expect(store.panOverviewBy(-100, -100, viewport)).toBe(false);
    expect(world()).toEqual(initial);
    expect(store.panOverviewBy(80, 60, viewport)).toBe(true);
    expect(world().x).toBeCloseTo(initial.x - 80, 6);
    expect(world().y).toBeCloseTo(initial.y - 60, 6);
    expect(store.panOverviewBy(-40, -20, viewport)).toBe(true);
    expect(world().x).toBeCloseTo(initial.x - 40, 6);
    expect(world().y).toBeCloseTo(initial.y - 40, 6);
    expect(store.panOverviewBy(100000, 100000, viewport)).toBe(true);
    const edge = world();
    expect(edge.x).toBeCloseTo(initial.x - 304, 6);
    expect(edge.y).toBeCloseTo(initial.y - 398, 6);
    expect(store.panOverviewBy(1, 1, viewport)).toBe(false);
    expect(world()).toEqual(edge);
    expect(store.panOverviewBy(-20, -30, viewport)).toBe(true);
    expect(world().x).toBeCloseTo(edge.x + 20, 6);
    expect(world().y).toBeCloseTo(edge.y + 30, 6);
    expect(store.panOverviewBy(-100000, -100000, viewport)).toBe(true);
    expect(world()).toEqual(initial);
  });

  it.each([
    { overview: "fixed", deltaX: 800, deltaY: 300 },
    { overview: "follow", deltaX: 2200, deltaY: 1000 },
  ] as const)(
    "crosses back into the ordinary $overview pan range without skipping part of the gesture",
    ({ overview, deltaX, deltaY }) => {
      const { store, world } = workspace(overview, 24);
      store.focusPane("pan-pane-23");
      store.snapAnimationsToTarget();
      store.zoomOverviewBy(0.5, 100, 100, viewport);
      store.zoomOverviewBy(2, 1180, 700, viewport);
      const before = world();
      expect(store.panOverviewBy(-deltaX, -deltaY, viewport)).toBe(true);
      const inside = world();
      expect(inside.x).toBeCloseTo(before.x + deltaX, 6);
      expect(inside.y).toBeCloseTo(before.y + deltaY, 6);
      expect(inside.scale).toBeCloseTo(before.scale, 6);
      expect(store.panOverviewBy(10, 15, viewport)).toBe(true);
      expect(world().x).toBeCloseTo(inside.x - 10, 6);
      expect(world().y).toBeCloseTo(inside.y - 15, 6);
      expect(store.panOverviewBy(100000, 100000, viewport)).toBe(true);
      const edge = world();
      expect(store.panOverviewBy(10, 15, viewport)).toBe(false);
      expect(world()).toEqual(edge);
    },
  );

  it("keeps a distant empty cell under the zoom focus", () => {
    const { store, world, selected } = workspace("follow");
    for (let index = 0; index < 6; index += 1) {
      store.moveFocus("right", viewport);
      store.moveFocus("down", viewport);
    }
    store.snapAnimationsToTarget();
    expect(store.getSnapshot().focusedPaneId).toBeNull();
    const cursor = selected();
    const focal = {
      x: cursor.x + (cursor.width * cursor.scale) / 2,
      y: cursor.y + (cursor.height * cursor.scale) / 2,
    };
    const before = world();
    const point = {
      x: (focal.x - before.x) / before.scale,
      y: (focal.y - before.y) / before.scale,
    };
    expect(store.zoomOverviewBy(0.5, focal.x, focal.y, viewport)).toBe(true);
    const after = world();
    expect(after.x + point.x * after.scale).toBeCloseTo(focal.x, 6);
    expect(after.y + point.y * after.scale).toBeCloseTo(focal.y, 6);
    const zoomedCursor = selected();
    expect(
      zoomedCursor.x + (zoomedCursor.width * zoomedCursor.scale) / 2,
    ).toBeCloseTo(focal.x, 6);
    expect(
      zoomedCursor.y + (zoomedCursor.height * zoomedCursor.scale) / 2,
    ).toBeCloseTo(focal.y, 6);
  });
});

describe("workspace overview scale", () => {
  it("keeps current row defaults and explicit sizes through layout restoration", () => {
    const result = createWorkspaceScene({
      gridAxes: "spatial",
      panes: [0, 1, 2].map((index) => ({
        paneId: `pane-${index}`,
        planeIndex: index,
        slotIndex: 0,
        surfaceKind: index === 2 ? "notes" : "test",
        title: `Pane ${index}`,
      })),
    });
    const engine = new WorkspaceLikeLayoutEngine(result.scene);
    const store = new WorkspaceLayoutStore(engine, result.scene, result.cursor);
    const viewport = { height: 1000, width: 1280, x: 0, y: 0 };
    store.ensureFocusedPaneVisible(viewport);
    store.resizePaneRow("pane-0", 600);
    store.setPaneDefaults({
      paneDefaults: { height: 420 },
      paneTypeDefaults: { notes: { height: 380 } },
    });
    const expected = engine.paneWorldBoxes(viewport);
    expect(expected.map((pane) => pane.height)).toEqual([600, 420, 380]);
    const layout = serializeWorkspaceLayout(
      store.toScene(),
      store.getSnapshot().cursor,
    );
    store.restoreLayout(layout, { keepPresentation: true });
    expect(engine.paneWorldBoxes(viewport)).toEqual(expected);
  });

  it.each(["follow", "fixed"] as const)(
    "refreshes %s overview geometry when its width constraints change",
    (overview) => {
      const result = createWorkspaceScene({
        panes: Array.from({ length: 12 }, (_, index) => ({
          paneId: `pane-${index}`,
          columnWidth: { unit: "px" as const, value: 520 },
          surfaceKind: "test",
          title: `Pane ${index}`,
        })),
      });
      const engine = new WorkspaceLikeLayoutEngine(result.scene);
      const store = new WorkspaceLayoutStore(
        engine,
        result.scene,
        result.cursor,
        {
          initialCameraModes: { normal: "follow", overview },
        },
      );
      const viewport = { height: 800, width: 1280, x: 0, y: 0 };
      store.ensureFocusedPaneVisible(viewport);
      store.focusPane("pane-6");
      store.snapAnimationsToTarget();
      store.setOverviewCardWidths(80, 80);
      store.toggleOverviewMode();
      store.snapAnimationsToTarget();
      const scale = () =>
        engine.gridCursorRenderItem({
          ...store.getSnapshot(),
          movementPhase: "idle",
          viewport,
        }).scale;
      const farScale = scale();
      expect(farScale).toBeCloseTo(80 / 520, 6);
      const cursor = store.getSnapshot().cursor;
      const layoutRevision = store.getSnapshot().layoutRevision;
      store.setOverviewCardWidths(240, 240);
      expect(scale()).toBeCloseTo(240 / 520, 6);
      expect(store.getSnapshot().cursor).toEqual(cursor);
      expect(store.getSnapshot().layoutRevision).toBe(layoutRevision);
      const changed = vi.fn();
      const unsubscribe = store.subscribe(changed);
      store.setOverviewCardWidths(240, 240);
      expect(changed).not.toHaveBeenCalled();
      unsubscribe();
      store.toggleOverviewMode();
      store.snapAnimationsToTarget();
      store.setOverviewCardWidths(80, 80);
      store.toggleOverviewMode();
      store.snapAnimationsToTarget();
      expect(scale()).toBeCloseTo(farScale, 6);
      store.setOverviewCardWidths(undefined, undefined);
      if (overview === "follow") expect(scale()).toBe(0.68);
    },
  );
  it("keeps a large following overview close at one stable scale", () => {
    const panes = Array.from({ length: 500 }, (_, index) => ({
      columnId: `overview-column-${String(index)}`,
      columnWidth: { unit: "px" as const, value: 384 },
      paneId: `overview-pane-${String(index)}`,
      slotIndex: index,
      surfaceKind: "test",
      title: `Overview pane ${String(index)}`,
    }));
    const result = createWorkspaceScene({ panes });
    const engine = new WorkspaceLikeLayoutEngine(result.scene);
    const store = new WorkspaceLayoutStore(engine, result.scene, result.cursor);
    const viewport = { height: 2_124, width: 3_840, x: 0, y: 0 };
    store.ensureFocusedPaneVisible(viewport);
    expect(store.focusPane("overview-pane-250")).toBe(true);
    store.snapAnimationsToTarget();
    store.toggleOverviewMode();
    store.snapAnimationsToTarget();
    const initialScale = store.getSnapshot().overviewFixedScale;

    expect(initialScale).toBeGreaterThanOrEqual(0.6);
    expect(store.focusPane("overview-pane-400")).toBe(true);
    expect(store.getSnapshot().overviewFixedScale).toBeCloseTo(
      initialScale ?? 0,
      6,
    );
  });

  it("keeps the point under the zoom focus in place while following the cursor", () => {
    const panes = Array.from({ length: 12 }, (_, index) => ({
      columnId: `zoom-column-${String(index)}`,
      columnWidth: { unit: "px" as const, value: 384 },
      paneId: `zoom-pane-${String(index)}`,
      planeIndex: Math.floor(index / 4),
      slotIndex: index % 4,
      surfaceKind: "test",
      title: `Zoom pane ${String(index)}`,
    }));
    const result = createWorkspaceScene({ panes });
    const engine = new WorkspaceLikeLayoutEngine(result.scene);
    const store = new WorkspaceLayoutStore(engine, result.scene, result.cursor);
    const viewport = { height: 800, width: 1_280, x: 0, y: 0 };
    store.ensureFocusedPaneVisible(viewport);
    expect(store.focusPane("zoom-pane-9")).toBe(true);
    store.snapAnimationsToTarget();
    expect(store.moveFocus("up", viewport)).toBe(true);
    store.snapAnimationsToTarget();
    store.toggleOverviewMode();
    store.snapAnimationsToTarget();
    const focusedCenter = () => {
      const snapshot = store.getSnapshot();
      const item = engine.gridCursorRenderItem({
        cursor: snapshot.cursor,
        focusedPaneId: snapshot.focusedPaneId,
        maximizedPaneId: null,
        movementPhase: "idle",
        overviewFixedScale: snapshot.overviewFixedScale,
        overviewFollowOffsetX: snapshot.overviewFollowOffsetX,
        overviewFollowOffsetY: snapshot.overviewFollowOffsetY,
        overviewPanX: snapshot.overviewPanX,
        overviewPanY: snapshot.overviewPanY,
        overviewZoom: snapshot.overviewZoom,
        presentationMode: "overview",
        scrollColumn: 0,
        scrollRow: 0,
        viewport,
      });
      return {
        x: item.x + (item.width * item.scale) / 2,
        y: item.y + (item.height * item.scale) / 2,
      };
    };
    const before = focusedCenter();
    expect(before.x).toBeCloseTo(640, 0);
    expect(before.y).toBeCloseTo(400, 0);

    expect(store.zoomOverviewBy(0.5, before.x, before.y, viewport)).toBe(true);
    const after = focusedCenter();
    expect(after.x).toBeCloseTo(before.x, 0);
    expect(after.y).toBeCloseTo(before.y, 0);
  });

  it("keeps overview and maximization through a restore that keeps presentation", () => {
    const definitions = (count: number) =>
      Array.from({ length: count }, (_, index) => ({
        columnId: `restore-column-${String(index)}`,
        paneId: `restore-pane-${String(index)}`,
        slotIndex: index,
        surfaceKind: "test",
        title: `Restore pane ${String(index)}`,
      }));
    const result = createWorkspaceScene({ panes: definitions(4) });
    const engine = new WorkspaceLikeLayoutEngine(result.scene);
    const store = new WorkspaceLayoutStore(engine, result.scene, result.cursor);
    const viewport = { height: 800, width: 1_280, x: 0, y: 0 };
    store.ensureFocusedPaneVisible(viewport);
    expect(store.focusPane("restore-pane-2")).toBe(true);
    store.togglePaneMaximized("restore-pane-2");
    store.toggleOverviewMode();
    store.snapAnimationsToTarget();

    const grown = createWorkspaceScene({ panes: definitions(6) });
    store.restoreLayout(
      serializeWorkspaceLayout(grown.scene, { column: 2, row: 0, split: 0 }),
      { keepPresentation: true },
    );

    const kept = store.getSnapshot();
    expect(kept.presentationMode).toBe("overview");
    expect(kept.maximizedPaneId).toBe("restore-pane-2");
    expect(kept.focusedPaneId).toBe("restore-pane-2");
    expect(engine.paneLocation("restore-pane-5")).toBeTruthy();

    store.restoreLayout(
      serializeWorkspaceLayout(grown.scene, { column: 2, row: 0, split: 0 }),
    );
    expect(store.getSnapshot().presentationMode).toBe("normal");
    expect(store.getSnapshot().maximizedPaneId).toBeNull();
  });
});
