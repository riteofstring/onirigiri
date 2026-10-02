import { describe, expect, it, vi } from "vitest";

import {
  defaultCameraMotion,
  resolveCameraMotion,
} from "../src/presentation/motion-curve";
import { WorkspaceLikeLayoutEngine } from "../src/layout/layout-engine";
import { PanePresentationEngine } from "../src/presentation/pane-presentation-engine";
import { WorkspaceFrameScheduler } from "../src/presentation/workspace-frame-scheduler";
import { WorkspaceGridCursorPresentation } from "../src/workspace/workspace-grid-cursor-presentation";
import { WorkspaceWorldPresentation } from "../src/presentation/workspace-world-presentation";
import { createWorkspaceScene } from "../src/workspace/workspace-scene";
import { workspaceGridCursorForPane } from "../src/workspace/workspace-grid-cursor";

import {
  ManualAnimationFrameHost,
  cameraModes,
  createSchedulerHarness,
  createSchedulerHarnessFor,
  createTwoDimensionalSchedulerHarness,
  createVerticalEmptyCellSchedulerHarness,
  cursorForPane,
  displayedPosition,
  expectDisplayedPosition,
  expectIntermediateMonotonicTrajectory,
  expectOverviewCursorCentered,
  expectVisualPaneBox,
  expectVisualWorldPaneBox,
  overviewCursorFrame,
  paneIds,
  requiredHost,
  rowSizingSnapshot,
  schedulerTestStore,
  transformScale,
  transformScaleValue,
  viewport,
  visualPaneBox,
  visualWorldPaneBox,
} from "./workspace-frame-scheduler-test-support";

describe("WorkspaceFrameScheduler", () => {
  it("publishes only request and settle boundaries during a direct A-to-C trajectory", () => {
    const { cursor, scene } = createWorkspaceScene({
      panes: ["a", "b", "c"].map((paneId, index) => ({
        columnId: `column-${paneId}`,
        columnWidth: { unit: "px" as const, value: 300 },
        paneId,
        slotIndex: index,
        surfaceKind: "test",
        title: paneId.toUpperCase(),
      })),
    });
    const engine = new WorkspaceLikeLayoutEngine(scene);
    const store = schedulerTestStore(engine, scene, cursor);
    store.ensureFocusedPaneVisible(viewport);
    const presentation = new PanePresentationEngine();
    const frameHost = new ManualAnimationFrameHost();
    const boundaries = vi.fn();
    const sampledScrollColumns: number[] = [];
    for (const paneId of ["a", "b", "c"]) {
      presentation.registerPaneHost(paneId, document.createElement("section"));
    }
    const scheduler = new WorkspaceFrameScheduler({
      compactLayoutProvider: () => false,
      engine,
      frameHost,
      onBoundary: boundaries,
      onFrame: () => {
        sampledScrollColumns.push(store.getSnapshot().scrollColumn);
      },
      presentation,
      store,
      viewportProvider: () => viewport,
    });
    scheduler.start();
    frameHost.flushOne(0);
    sampledScrollColumns.length = 0;

    expect(store.focusPane("c")).toBe(true);
    expect(boundaries).toHaveBeenCalledTimes(1);
    expect(boundaries.mock.calls[0]?.[1]).toBe("request");
    expect(store.getSnapshot().targetScrollColumn).toBe(2);
    frameHost.flushAll();

    expect(store.getSnapshot().scrollColumn).toBe(2);
    expect(boundaries).toHaveBeenCalledTimes(2);
    expect(boundaries.mock.calls[1]?.[1]).toBe("settle");
    expect(sampledScrollColumns.length).toBeGreaterThan(2);
    expect(
      sampledScrollColumns.every(
        (value, index) =>
          index === 0 || value >= (sampledScrollColumns[index - 1] ?? 0),
      ),
    ).toBe(true);
    expect(sampledScrollColumns.some((value) => value > 0 && value < 2)).toBe(
      true,
    );
    scheduler.teardown();
  });

  it("animates each sequential request from the currently presented camera", () => {
    const harness = createSchedulerHarness();
    harness.scheduler.start();
    harness.frameHost.flushOne(0);

    expect(harness.store.focusPane("b")).toBe(true);
    harness.frameHost.flushAll();
    expectIntermediateMonotonicTrajectory(harness.samples.splice(0), 0, 1);

    expect(harness.store.focusPane("c")).toBe(true);
    harness.frameHost.flushAll();
    expectIntermediateMonotonicTrajectory(harness.samples.splice(0), 1, 2);
    expect(harness.store.getSnapshot().scrollColumn).toBe(2);
    harness.scheduler.teardown();
  });

  it("retargets an independently timed cursor from its displayed box during rapid reversal", () => {
    const cursorPresentation = new WorkspaceGridCursorPresentation();
    const cursorHost = document.createElement("div");
    cursorPresentation.bindCursorHost(cursorHost);
    const harness = createSchedulerHarness(
      undefined,
      cursorPresentation,
      undefined,
      { camera: defaultCameraMotion, highlight: { durationMs: 115 } },
    );
    harness.scheduler.start();
    harness.frameHost.flushOne(0);
    const initialTransform = cursorHost.style.transform;

    expect(harness.store.focusPane("c")).toBe(true);
    harness.frameHost.flushFrames(1);
    expect(cursorHost.style.transform).toBe(initialTransform);

    harness.frameHost.flushFrames(3);
    const displayedBeforeReversal = cursorHost.style.transform;
    expect(displayedBeforeReversal).not.toBe(initialTransform);

    expect(harness.store.focusPane("a")).toBe(true);
    harness.frameHost.flushFrames(1);
    expect(cursorHost.style.transform).toBe(displayedBeforeReversal);

    harness.frameHost.flushAll();
    expect(cursorHost.style.transform).toBe(initialTransform);
    expect(cursorHost.dataset.cellKind).toBe("occupied");
    harness.scheduler.teardown();
  });

  it.each([
    ["the default follow camera", defaultCameraMotion],
    [
      "a custom eased camera",
      resolveCameraMotion({
        navigation: {
          durationMs: 240,
          easing: (progress: number) =>
            progress * progress * (3 - 2 * progress),
        },
      }),
    ],
  ])(
    "keeps the camera-following highlight still on screen with %s",
    (_label, camera) => {
      const cursorPresentation = new WorkspaceGridCursorPresentation();
      const cursorHost = document.createElement("div");
      cursorPresentation.bindCursorHost(cursorHost);
      const harness = createSchedulerHarness(
        undefined,
        cursorPresentation,
        undefined,
        { camera, highlight: "camera" },
      );
      harness.store.setCameraMotion(camera);
      harness.scheduler.start();
      harness.frameHost.flushOne(0);
      expect(harness.store.focusPane("b")).toBe(true);
      harness.frameHost.flushAll();
      const screenX = () =>
        translatedX(harness.stage.style.transform) +
        translatedX(cursorHost.style.transform) *
          scaleOf(harness.stage.style.transform);
      const resting = screenX();

      expect(harness.store.focusPane("c")).toBe(true);
      const positions: number[] = [];
      for (let frame = 0; frame < 6; frame += 1) {
        harness.frameHost.flushFrames(1);
        positions.push(screenX());
      }

      expect(harness.store.getSnapshot().scrollColumn).toBeGreaterThan(1);
      expect(harness.store.getSnapshot().scrollColumn).toBeLessThan(2);
      for (const position of positions) {
        expect(position).toBeCloseTo(resting, 0);
      }
      harness.frameHost.flushAll();
      expect(screenX()).toBeCloseTo(resting, 0);
      harness.scheduler.teardown();
    },
  );

  it("reverses from the displayed camera without snapping through an endpoint", () => {
    const harness = createSchedulerHarness();
    harness.scheduler.start();
    harness.frameHost.flushOne(0);

    expect(harness.store.focusPane("c")).toBe(true);
    harness.frameHost.flushFrames(4);
    const displayedBeforeReversal = harness.store.getSnapshot().scrollColumn;
    expect(displayedBeforeReversal).toBeGreaterThan(0);
    expect(displayedBeforeReversal).toBeLessThan(2);
    harness.samples.length = 0;

    expect(harness.store.focusPane("a")).toBe(true);
    expect(harness.store.getSnapshot().scrollColumn).toBe(
      displayedBeforeReversal,
    );
    harness.frameHost.flushAll();

    expect(harness.samples.some((value) => value > 0)).toBe(true);
    expect(
      harness.samples.every(
        (value, index) =>
          index === 0 || value <= (harness.samples[index - 1] ?? 0),
      ),
    ).toBe(true);
    expect(harness.store.getSnapshot().scrollColumn).toBe(0);
    expect(harness.store.getSnapshot().focusedPaneId).toBe("a");
    harness.scheduler.teardown();
  });

  it("publishes in-flight focus retargets even when pane hosts already exist", () => {
    const harness = createSchedulerHarness();
    harness.scheduler.start();
    harness.frameHost.flushOne(0);

    expect(harness.store.focusPane("b")).toBe(true);
    expect(harness.boundaries.mock.calls.map((call) => call[1])).toEqual([
      "request",
    ]);
    harness.frameHost.flushFrames(2);

    expect(harness.store.focusPane("c")).toBe(true);
    expect(harness.boundaries.mock.calls.map((call) => call[1])).toEqual([
      "request",
      "request",
    ]);

    harness.frameHost.flushAll();

    expect(harness.boundaries.mock.calls.map((call) => call[1])).toEqual([
      "request",
      "request",
      "settle",
    ]);
    expect(harness.boundaries.mock.calls.at(-1)?.[0]).toMatchObject({
      focusedPaneId: "c",
      targetScrollColumn: 2,
    });
    harness.scheduler.teardown();
  });

  it("publishes an in-flight boundary when a cold focus has no pane host", () => {
    const { cursor, scene } = createWorkspaceScene({
      panes: ["a", "b", "c"].map((paneId, index) => ({
        columnId: `column-${paneId}`,
        columnWidth: { unit: "px" as const, value: 300 },
        paneId,
        slotIndex: index,
        surfaceKind: "test",
        title: paneId.toUpperCase(),
      })),
    });
    const harness = createSchedulerHarnessFor(scene, cursor, ["a", "b"]);
    harness.scheduler.start();
    harness.frameHost.flushOne(0);

    expect(harness.store.focusPane("b")).toBe(true);
    expect(harness.boundaries.mock.calls.map((call) => call[1])).toEqual([
      "request",
    ]);
    harness.frameHost.flushFrames(2);

    expect(harness.store.focusPane("c")).toBe(true);
    expect(harness.boundaries.mock.calls.map((call) => call[1])).toEqual([
      "request",
      "request",
    ]);
    expect(harness.boundaries.mock.calls.at(-1)?.[0]).toMatchObject({
      focusedPaneId: "c",
    });
    harness.scheduler.teardown();
  });

  it("keeps the default fixed camera stationary while retargeting adjacent pane swaps", () => {
    const harness = createSchedulerHarness();
    harness.scheduler.start();
    harness.frameHost.flushOne(0);
    const source = harness.hosts.get("a");
    const target = harness.hosts.get("b");
    if (!source || !target) {
      throw new Error("missing stable pane hosts");
    }
    const initialSourceTransform = source.style.transform;
    const initialTargetTransform = target.style.transform;
    const cameraBefore = harness.store.getSnapshot();

    expect(harness.store.moveFocusedPane("right")).toBe(true);
    expect(harness.store.getSnapshot()).toMatchObject({
      horizontalAnchorOffset: cameraBefore.horizontalAnchorOffset,
      scrollColumn: cameraBefore.scrollColumn,
      scrollRow: cameraBefore.scrollRow,
      targetHorizontalAnchorOffset: cameraBefore.targetHorizontalAnchorOffset,
      targetScrollColumn: cameraBefore.targetScrollColumn,
      targetScrollRow: cameraBefore.targetScrollRow,
    });
    harness.frameHost.flushFrames(3);
    expect(harness.stage.style.translate).toBe("");
    expect(source.style.transform).not.toBe(initialSourceTransform);
    expect(target.style.transform).not.toBe(initialTargetTransform);

    expect(harness.store.moveFocusedPane("left")).toBe(true);
    harness.frameHost.flushAll();

    expect(source.style.transform).toBe(initialSourceTransform);
    expect(target.style.transform).toBe(initialTargetTransform);
    expect(harness.store.focusedPaneId()).toBe("a");
    expect(harness.store.getSnapshot().paneRearrangementRevision).toBe(2);
    expect(harness.stage.style.translate).toBe("");
    harness.scheduler.teardown();
  });

  it("follows occupied horizontal and vertical moves while keeping the focused pane anchored", () => {
    const harness = createTwoDimensionalSchedulerHarness();
    harness.scheduler.start();
    harness.frameHost.flushOne(0);
    harness.store.setCameraModes(cameraModes("follow", "fixed"));
    const source = requiredHost(harness.hosts, "source");
    const initialSource = displayedPosition(source, harness.stage);
    const initialHorizontalAnchorOffset =
      harness.store.getSnapshot().horizontalAnchorOffset;

    expect(harness.store.moveFocusedPane("right")).toBe(true);
    harness.frameHost.flushFrames(3);
    expect(harness.store.getSnapshot().horizontalAnchorOffset).toBeGreaterThan(
      0,
    );
    expect(harness.store.getSnapshot().scrollRow).toBeCloseTo(0);
    expectDisplayedPosition(source, harness.stage, initialSource);
    harness.frameHost.flushAll();

    expect(harness.store.moveFocusedPane("left")).toBe(true);
    harness.frameHost.flushAll();
    expect(harness.store.getSnapshot().horizontalAnchorOffset).toBeCloseTo(
      initialHorizontalAnchorOffset,
    );

    expect(harness.store.moveFocusedPane("down")).toBe(true);
    harness.frameHost.flushFrames(3);
    expect(harness.store.getSnapshot().verticalAnchorOffset).toBeGreaterThan(0);
    expectDisplayedPosition(source, harness.stage, initialSource);
    harness.frameHost.flushAll();

    expect(harness.store.moveFocusedPane("up")).toBe(true);
    harness.frameHost.flushAll();
    expect(harness.store.getSnapshot().verticalAnchorOffset).toBeCloseTo(0);
    harness.scheduler.teardown();
  });

  it("keeps Follow split exits, immediate Zoom out, and distant moves on one camera", () => {
    const { scene } = createWorkspaceScene({
      panes: [
        {
          columnId: "source-column",
          columnWidth: { unit: "px" as const, value: 300 },
          paneId: "source",
          slotIndex: 0,
          surfaceKind: "test",
          title: "Source",
        },
        {
          columnId: "split-column",
          columnWidth: { unit: "px" as const, value: 300 },
          paneId: "split-top",
          slotIndex: 1,
          surfaceKind: "test",
          title: "Split top",
        },
        {
          columnId: "split-column",
          columnWidth: { unit: "px" as const, value: 300 },
          paneId: "split-bottom",
          slotIndex: 1,
          surfaceKind: "test",
          title: "Split bottom",
        },
      ],
    });
    const harness = createSchedulerHarnessFor(
      scene,
      cursorForPane(scene, "source"),
      ["source", "split-top", "split-bottom"],
    );
    harness.scheduler.start();
    harness.frameHost.flushOne(0);
    harness.store.setCameraModes(cameraModes("follow", "follow"));
    const source = requiredHost(harness.hosts, "source");
    const initialBox = visualPaneBox(source, harness.stage);

    expect(harness.store.moveFocusedPane("right")).toBe(true);
    harness.frameHost.flushAll();
    const splitBox = visualPaneBox(source, harness.stage);
    expect(splitBox.height).toBeLessThan(initialBox.height);
    expectDisplayedPosition(source, harness.stage, [
      initialBox.x,
      initialBox.y,
    ]);

    expect(harness.store.moveFocusedPane("right")).toBe(true);
    harness.frameHost.flushFrames(1);
    expectVisualPaneBox(source, harness.stage, splitBox);
    expect(
      harness.engine
        .toScene()
        .columns.find((column) =>
          column.cells.some((cell) => cell.paneId === "source"),
        )?.cells,
    ).toEqual([{ paneId: "source", reserved: false, weight: 1 }]);

    harness.store.toggleOverviewMode();
    harness.frameHost.flushAll();
    const overviewSnapshot = harness.store.getSnapshot();
    expect(overviewSnapshot).toMatchObject({
      overviewPanX: 0,
      overviewPanY: 0,
      overviewFixedScale: expect.any(Number),
      overviewZoom: expect.any(Number),
      presentationMode: "overview",
    });
    expect(overviewSnapshot.overviewZoom).toBeGreaterThan(1);
    expectOverviewCursorCentered(
      overviewCursorFrame(harness.engine, overviewSnapshot),
    );
    const overviewBounds = harness.engine.overviewContentBounds(viewport);
    expect(overviewBounds.contentWidth).toBeGreaterThan(0);
    expect(overviewBounds.contentHeight).toBeGreaterThan(0);
    const overviewSource = visualPaneBox(source, harness.stage);
    expect(overviewSource.x + overviewSource.width).toBeGreaterThan(0);
    expect(overviewSource.y + overviewSource.height).toBeGreaterThan(0);
    expect(overviewSource.x).toBeLessThan(viewport.width);
    expect(overviewSource.y).toBeLessThan(viewport.height);

    harness.store.toggleOverviewMode();
    harness.frameHost.flushAll();
    const normalAnchor = displayedPosition(source, harness.stage);
    const sourceHost = source;
    for (let step = 0; step < 12; step += 1) {
      expect(harness.store.moveFocusedPane("right")).toBe(true);
      harness.frameHost.flushAll();
      expect(requiredHost(harness.hosts, "source")).toBe(sourceHost);
      expect(source.hidden).toBe(false);
      expect(source.dataset.visible).toBe("true");
      expectDisplayedPosition(source, harness.stage, normalAnchor);
      expect(harness.store.focusedPaneId()).toBe("source");
    }
    harness.scheduler.teardown();
  });

  it("normalizes a transient empty source without creating a camera detour", () => {
    const { scene } = createWorkspaceScene({
      panes: [
        {
          columnId: "source-column",
          paneId: "source",
          slotIndex: 0,
          surfaceKind: "test",
          title: "Source",
        },
        {
          columnId: "far-column",
          paneId: "far",
          slotIndex: 2,
          surfaceKind: "test",
          title: "Far",
        },
      ],
    });
    const harness = createSchedulerHarnessFor(
      scene,
      cursorForPane(scene, "source"),
      ["source", "far"],
    );
    harness.scheduler.start();
    harness.frameHost.flushOne(0);
    harness.store.setCameraModes(cameraModes("follow", "fixed"));
    const source = requiredHost(harness.hosts, "source");
    const sourceAtRest = displayedPosition(source, harness.stage);

    expect(harness.store.moveFocusedPane("right")).toBe(true);
    expect(
      harness.store
        .toScene()
        .columns.find((column) => column.columnId === "source-column"),
    ).toBeUndefined();
    harness.frameHost.flushAll();
    expectDisplayedPosition(source, harness.stage, sourceAtRest);

    expect(harness.store.moveFocusedPane("left")).toBe(true);
    harness.frameHost.flushAll();
    expect(
      paneIds(
        harness.store
          .toScene()
          .columns.find((column) => column.slotIndex === 0),
      ),
    ).toEqual(["source"]);
    harness.scheduler.teardown();
  });

  it("retargets vertical moves from exact boxes after transient-source collapse", () => {
    const harness = createVerticalEmptyCellSchedulerHarness();
    harness.scheduler.start();
    harness.frameHost.flushOne(0);
    const source = requiredHost(harness.hosts, "source");
    harness.store.toggleOverviewMode();
    harness.frameHost.flushAll();
    const overviewStart = visualPaneBox(source, harness.stage);
    expect(harness.store.moveFocusedPane("down")).toBe(true);
    expect(harness.presentation.hasActivePaneRearrangement()).toBe(true);
    expect(harness.stage.style.translate).toBe("");
    harness.frameHost.flushFrames(1);
    expectVisualPaneBox(source, harness.stage, overviewStart);
    expect(harness.frameHost.pendingFrameCount()).toBe(1);
    harness.frameHost.flushFrames(3);
    const overviewBeforeReverse = visualPaneBox(source, harness.stage);
    expect(harness.store.moveFocusedPane("up")).toBe(true);
    harness.frameHost.flushFrames(1);
    expectVisualPaneBox(source, harness.stage, overviewBeforeReverse);
    harness.frameHost.flushAll();

    harness.store.toggleOverviewMode();
    harness.frameHost.flushAll();
    harness.store.setCameraModes(cameraModes("follow", "fixed"));
    const normalStart = displayedPosition(source, harness.stage);
    expect(harness.store.moveFocusedPane("down")).toBe(true);
    harness.frameHost.flushFrames(3);
    expect(harness.store.getSnapshot().verticalAnchorOffset).toBeGreaterThan(0);
    expectDisplayedPosition(source, harness.stage, normalStart);
    const normalBeforeReverse = visualPaneBox(source, harness.stage);
    expect(harness.store.moveFocusedPane("up")).toBe(true);
    harness.frameHost.flushFrames(1);
    expectVisualPaneBox(source, harness.stage, normalBeforeReverse);
    harness.frameHost.flushAll();
    expectDisplayedPosition(source, harness.stage, normalStart);
    expect(
      harness.engine
        .toScene()
        .columns.find((column) =>
          column.cells.some((cell) => cell.paneId === "source"),
        )?.cells,
    ).toEqual([{ paneId: "source", reserved: false, weight: 1 }]);
    harness.scheduler.teardown();
  });

  it("retargets a following camera from its displayed geometry without a reversal snap", () => {
    const harness = createSchedulerHarness();
    harness.scheduler.start();
    harness.frameHost.flushOne(0);
    harness.store.setCameraModes(cameraModes("follow", "fixed"));
    const source = requiredHost(harness.hosts, "a");
    const anchor = displayedPosition(source, harness.stage);
    const initialHorizontalAnchorOffset =
      harness.store.getSnapshot().horizontalAnchorOffset;

    expect(harness.store.moveFocusedPane("right")).toBe(true);
    harness.frameHost.flushFrames(3);
    expect(harness.store.getSnapshot().horizontalAnchorOffset).toBeGreaterThan(
      0,
    );

    expect(harness.store.moveFocusedPane("left")).toBe(true);
    harness.frameHost.flushFrames(1);
    expectDisplayedPosition(source, harness.stage, anchor);
    harness.frameHost.flushAll();
    expect(harness.store.getSnapshot().horizontalAnchorOffset).toBeCloseTo(
      initialHorizontalAnchorOffset,
    );
    harness.scheduler.teardown();
  });

  it("uses the following camera in overview and preserves the selected mode across overview changes", () => {
    const harness = createTwoDimensionalSchedulerHarness();
    harness.scheduler.start();
    harness.frameHost.flushOne(0);
    harness.store.setCameraModes(cameraModes("fixed", "follow"));
    harness.store.toggleOverviewMode();
    harness.frameHost.flushAll();
    expect(harness.store.getSnapshot().presentationMode).toBe("overview");
    expect(harness.store.cameraMode()).toBe("follow");

    expect(harness.store.focusPane("right")).toBe(true);
    harness.frameHost.flushAll();
    expect(harness.store.cameraMode()).toBe("follow");

    expect(harness.store.focusPane("source")).toBe(true);
    const overviewStart = displayedPosition(
      requiredHost(harness.hosts, "source"),
      harness.stage,
    );
    const followOffsetBefore =
      harness.store.getSnapshot().overviewFollowOffsetX;
    expect(harness.store.moveFocusedPane("right")).toBe(true);
    harness.frameHost.flushFrames(1);
    expectDisplayedPosition(
      requiredHost(harness.hosts, "source"),
      harness.stage,
      overviewStart,
    );
    harness.frameHost.flushAll();
    expect(harness.store.getSnapshot().overviewFollowOffsetX).not.toBe(
      followOffsetBefore,
    );
    expectOverviewCursorCentered(
      overviewCursorFrame(harness.engine, harness.store.getSnapshot()),
    );
    expect(harness.store.getSnapshot().presentationMode).toBe("overview");
    harness.scheduler.teardown();
  });

  it("keeps normal and overview camera modes independent across view switches", () => {
    const harness = createTwoDimensionalSchedulerHarness();
    harness.scheduler.start();
    harness.frameHost.flushOne(0);
    harness.store.setCameraModes(cameraModes("follow", "fixed"));

    expect(harness.store.cameraModes()).toEqual(cameraModes("follow", "fixed"));
    expect(harness.store.cameraMode()).toBe("follow");

    harness.store.toggleOverviewMode();
    harness.frameHost.flushAll();
    expect(harness.store.cameraMode()).toBe("fixed");

    harness.store.setCameraModes(cameraModes("follow", "follow"));
    expect(harness.store.cameraMode()).toBe("follow");

    harness.store.toggleOverviewMode();
    harness.frameHost.flushAll();
    expect(harness.store.cameraMode()).toBe("follow");
    expect(harness.store.cameraModes()).toEqual(
      cameraModes("follow", "follow"),
    );
    harness.scheduler.teardown();
  });

  it("retargets both axes between stable overview-card hosts and reverses from their displayed boxes", () => {
    const harness = createTwoDimensionalSchedulerHarness();
    harness.scheduler.start();
    harness.frameHost.flushOne(0);
    harness.store.toggleOverviewMode();
    harness.frameHost.flushAll();

    const source = requiredHost(harness.hosts, "source");
    const right = requiredHost(harness.hosts, "right");
    const lower = requiredHost(harness.hosts, "lower");
    const sourceAtRest = source.style.transform;
    const rightAtRest = right.style.transform;
    const lowerAtRest = lower.style.transform;
    const cameraBefore = harness.store.getSnapshot();

    expect(harness.store.moveFocusedPane("right")).toBe(true);
    expect(source.style.transform).toBe(sourceAtRest);
    expect(right.style.transform).toBe(rightAtRest);
    harness.frameHost.flushFrames(1);
    expect(transformScale(source.style.transform)).toBe(
      transformScale(sourceAtRest),
    );
    expect(transformScale(right.style.transform)).toBe(
      transformScale(rightAtRest),
    );
    harness.frameHost.flushFrames(2);
    expect(source.style.transform).not.toBe(sourceAtRest);
    expect(right.style.transform).not.toBe(rightAtRest);
    expect(harness.store.getSnapshot()).toMatchObject({
      overviewPanX: cameraBefore.overviewPanX,
      overviewPanY: cameraBefore.overviewPanY,
      overviewProgress: cameraBefore.overviewProgress,
      overviewZoom: cameraBefore.overviewZoom,
      presentationMode: "overview",
    });

    const sourceBeforeHorizontalReverse = source.style.transform;
    expect(harness.store.moveFocusedPane("left")).toBe(true);
    harness.frameHost.flushFrames(1);
    expect(source.style.transform).not.toBe(sourceAtRest);
    expect(source.style.transform).toBe(sourceBeforeHorizontalReverse);
    harness.frameHost.flushFrames(1);
    expect(source.style.transform).not.toBe(sourceBeforeHorizontalReverse);
    harness.frameHost.flushAll();
    expect(source.style.transform).toBe(sourceAtRest);
    expect(right.style.transform).toBe(rightAtRest);

    expect(harness.store.moveFocusedPane("down")).toBe(true);
    harness.frameHost.flushFrames(3);
    expect(source.style.transform).not.toBe(sourceAtRest);
    expect(lower.style.transform).not.toBe(lowerAtRest);

    expect(harness.store.moveFocusedPane("up")).toBe(true);
    harness.frameHost.flushAll();
    expect(source.style.transform).toBe(sourceAtRest);
    expect(lower.style.transform).toBe(lowerAtRest);
    expect(harness.store.focusedPaneId()).toBe("source");
    harness.scheduler.teardown();
  });

  it("keeps resized cell boxes exact on rearrangement edges in Fixed and Follow modes", () => {
    const harness = createTwoDimensionalSchedulerHarness(undefined, {
      height: 1000,
      width: 360,
      x: 0,
      y: 0,
    });
    harness.scheduler.start();
    harness.frameHost.flushOne(0);

    const source = requiredHost(harness.hosts, "source");
    const lower = requiredHost(harness.hosts, "lower");
    const normalSourceStart = visualPaneBox(source, harness.stage);
    const normalLowerStart = visualPaneBox(lower, harness.stage);
    const normalSizing = rowSizingSnapshot(harness.engine.toScene());

    expect(harness.store.moveFocusedPane("down")).toBe(true);
    harness.frameHost.flushFrames(1);
    expectVisualPaneBox(source, harness.stage, normalSourceStart);
    expectVisualPaneBox(lower, harness.stage, normalLowerStart);
    expect(harness.stage.style.translate).toBe("");
    expect(rowSizingSnapshot(harness.engine.toScene())).toEqual(normalSizing);

    harness.frameHost.flushFrames(3);
    const normalBeforeReverse = visualPaneBox(source, harness.stage);
    expect(harness.store.moveFocusedPane("up")).toBe(true);
    harness.frameHost.flushOne(1000 / 120);
    expectVisualPaneBox(source, harness.stage, normalBeforeReverse);
    harness.frameHost.flushAll();
    expectVisualPaneBox(source, harness.stage, normalSourceStart);

    harness.store.setCameraModes(cameraModes("follow", "follow"));
    harness.frameHost.flushAll();
    harness.store.toggleOverviewMode();
    harness.frameHost.flushAll();
    const overviewSourceStart = visualPaneBox(source, harness.stage);
    const overviewScale = overviewCursorFrame(
      harness.engine,
      harness.store.getSnapshot(),
    ).scale;
    expect(harness.store.moveFocusedPane("down")).toBe(true);
    harness.frameHost.flushFrames(1);
    expectVisualPaneBox(source, harness.stage, overviewSourceStart);
    harness.frameHost.flushFrames(3);
    expect(harness.store.getSnapshot().overviewFollowOffsetY).not.toBe(0);
    const movedCursor = overviewCursorFrame(
      harness.engine,
      harness.store.getSnapshot(),
    );
    expect(movedCursor.scale).toBeCloseTo(overviewScale, 6);
    const overviewBeforeReverse = visualPaneBox(source, harness.stage);
    expect(harness.store.moveFocusedPane("up")).toBe(true);
    harness.frameHost.flushFrames(1);
    expectVisualPaneBox(source, harness.stage, overviewBeforeReverse);
    harness.frameHost.flushAll();
    expectVisualPaneBox(source, harness.stage, overviewSourceStart);
    harness.scheduler.teardown();
  });

  it("returns a Follow rearrangement to its original short resized row", () => {
    const { scene } = createWorkspaceScene({
      panes: [
        {
          columnId: "short-row-column",
          columnWidth: { unit: "px" as const, value: 300 },
          heightPx: 180,
          paneId: "source",
          planeIndex: 0,
          slotIndex: 0,
          surfaceKind: "test",
          title: "Source",
        },
        {
          columnId: "lower-row-column",
          columnWidth: { unit: "px" as const, value: 300 },
          heightPx: 480,
          paneId: "lower",
          planeIndex: 1,
          slotIndex: 0,
          surfaceKind: "test",
          title: "Lower",
        },
      ],
    });
    const harness = createSchedulerHarnessFor(
      scene,
      cursorForPane(scene, "source"),
      ["source", "lower"],
    );
    harness.scheduler.start();
    harness.frameHost.flushOne(0);
    harness.store.setCameraModes(cameraModes("follow", "fixed"));
    const source = requiredHost(harness.hosts, "source");
    const originalShortRow = visualPaneBox(source, harness.stage);

    expect(harness.store.moveFocusedPane("down")).toBe(true);
    harness.frameHost.flushFrames(3);
    expect(harness.store.moveFocusedPane("up")).toBe(true);
    harness.frameHost.flushAll();

    const sourceCell = harness.engine
      .toScene()
      .columns.flatMap((column) => column.cells)
      .find((cell) => cell.paneId === "source");
    expect(sourceCell).toMatchObject({
      heightPx: 180,
      paneId: "source",
      reserved: false,
    });
    expect(source.style.height).toBe("180px");
    expectVisualPaneBox(source, harness.stage, originalShortRow);
    harness.scheduler.teardown();
  });

  it("snaps resized cell occupancy to its destination geometry for reduced motion", () => {
    const reducedMotionQuery = {
      addEventListener: vi.fn(),
      matches: true,
      removeEventListener: vi.fn(),
    } as unknown as MediaQueryList;
    const harness = createTwoDimensionalSchedulerHarness(reducedMotionQuery);
    harness.scheduler.start();
    harness.frameHost.flushOne(0);

    const source = requiredHost(harness.hosts, "source");
    const lower = requiredHost(harness.hosts, "lower");
    const lowerDestination = visualPaneBox(lower, harness.stage);
    const sizing = rowSizingSnapshot(harness.engine.toScene());
    expect(harness.store.moveFocusedPane("down")).toBe(true);
    harness.frameHost.flushAll();

    expect(visualPaneBox(source, harness.stage)).toEqual(lowerDestination);
    expect(rowSizingSnapshot(harness.engine.toScene())).toEqual(sizing);
    harness.scheduler.teardown();
  });

  it("snaps pane rearrangement when reduced motion is preferred", () => {
    const reducedMotionQuery = {
      addEventListener: vi.fn(),
      matches: true,
      removeEventListener: vi.fn(),
    } as unknown as MediaQueryList;
    const harness = createSchedulerHarness(reducedMotionQuery);
    harness.scheduler.start();
    harness.frameHost.flushOne(0);
    const source = requiredHost(harness.hosts, "a");
    const target = requiredHost(harness.hosts, "b");
    const targetAtRest = target.style.transform;
    const cameraBefore = harness.store.getSnapshot();

    expect(harness.store.moveFocusedPane("right")).toBe(true);
    expect(harness.presentation.hasActivePaneRearrangement()).toBe(false);
    harness.frameHost.flushAll();

    expect(source.style.transform).toBe(targetAtRest);
    expect(harness.store.getSnapshot()).toMatchObject({
      horizontalAnchorOffset: cameraBefore.horizontalAnchorOffset,
      scrollColumn: cameraBefore.scrollColumn,
      scrollRow: cameraBefore.scrollRow,
      targetHorizontalAnchorOffset: cameraBefore.targetHorizontalAnchorOffset,
      targetScrollColumn: cameraBefore.targetScrollColumn,
      targetScrollRow: cameraBefore.targetScrollRow,
    });
    harness.scheduler.teardown();
  });

  it("applies following pane and camera movement atomically for reduced motion", () => {
    const reducedMotionQuery = {
      addEventListener: vi.fn(),
      matches: true,
      removeEventListener: vi.fn(),
    } as unknown as MediaQueryList;
    const harness = createSchedulerHarness(reducedMotionQuery);
    harness.scheduler.start();
    harness.frameHost.flushOne(0);
    harness.store.setCameraModes(cameraModes("follow", "fixed"));
    const source = requiredHost(harness.hosts, "a");
    const sourceAtRest = displayedPosition(source, harness.stage);

    expect(harness.store.moveFocusedPane("right")).toBe(true);
    expect(harness.presentation.hasActivePaneRearrangement()).toBe(false);
    harness.frameHost.flushAll();
    expect(harness.store.getSnapshot().horizontalAnchorOffset).toBeGreaterThan(
      0,
    );
    expectDisplayedPosition(source, harness.stage, sourceAtRest);
    harness.scheduler.teardown();
  });

  it("lays out zoom endpoints once and reuses them during interpolation", () => {
    const harness = createSchedulerHarness();
    const renderFrame = vi.spyOn(harness.engine, "renderFrame");
    harness.scheduler.start();
    harness.frameHost.flushOne(0);
    renderFrame.mockClear();

    harness.store.toggleOverviewMode();
    harness.frameHost.flushAll();

    expect(renderFrame).toHaveBeenCalledTimes(3);
    expect(harness.store.getSnapshot().overviewProgress).toBe(1);
    harness.scheduler.teardown();
  });

  it("coalesces settled overview camera changes into one lifecycle boundary", () => {
    const harness = createSchedulerHarness();
    harness.scheduler.start();
    harness.frameHost.flushOne(0);
    harness.store.setCameraModes(cameraModes("fixed", "follow"));

    harness.store.toggleOverviewMode();
    expect(harness.boundaries.mock.calls.at(-1)?.[1]).toBe("request");
    harness.boundaries.mockClear();

    expect(
      harness.store.zoomOverviewBy(
        0.9,
        viewport.width / 2,
        viewport.height / 2,
        viewport,
      ),
    ).toBe(true);
    expect(harness.boundaries).not.toHaveBeenCalled();
    harness.frameHost.flushAll();
    expect(harness.boundaries).toHaveBeenCalledTimes(1);
    expect(harness.boundaries.mock.calls[0]?.[1]).toBe("settle");

    harness.boundaries.mockClear();
    const overviewZoomBeforeSettledChange =
      harness.store.getSnapshot().overviewZoom;
    expect(
      harness.store.zoomOverviewBy(
        1.05,
        viewport.width / 2,
        viewport.height / 2,
        viewport,
      ),
    ).toBe(true);
    expect(harness.boundaries).not.toHaveBeenCalled();

    harness.frameHost.flushOne(1000 / 60);
    expect(harness.boundaries).not.toHaveBeenCalled();
    harness.frameHost.flushOne((2 * 1000) / 60);
    expect(harness.worldPresentation.hasActiveMotion()).toBe(true);
    expect(harness.boundaries).not.toHaveBeenCalled();
    harness.frameHost.flushAll();
    expect(harness.boundaries).toHaveBeenCalledTimes(1);
    expect(harness.boundaries.mock.calls[0]?.[1]).toBe("settle");
    const settledZoomBoundary = harness.boundaries.mock.calls[0]?.[0];
    expect(settledZoomBoundary?.overviewZoom).not.toBe(
      overviewZoomBeforeSettledChange,
    );
    expect(settledZoomBoundary).toMatchObject({ presentationMode: "overview" });

    harness.boundaries.mockClear();
    expect(harness.store.panOverviewBy(12, 0, viewport)).toBe(true);
    expect(harness.boundaries).not.toHaveBeenCalled();

    harness.frameHost.flushOne(1000 / 60);
    expect(harness.boundaries).not.toHaveBeenCalled();

    expect(harness.store.panOverviewBy(12, 0, viewport)).toBe(true);
    expect(harness.boundaries).not.toHaveBeenCalled();

    harness.frameHost.flushOne((2 * 1000) / 60);
    expect(harness.boundaries).not.toHaveBeenCalled();
    harness.frameHost.flushOne((3 * 1000) / 60);
    expect(harness.worldPresentation.hasActiveMotion()).toBe(true);
    expect(harness.boundaries).not.toHaveBeenCalled();
    harness.frameHost.flushAll();
    expect(harness.boundaries).toHaveBeenCalledTimes(1);
    expect(harness.boundaries.mock.calls[0]?.[1]).toBe("settle");
    expect(harness.boundaries.mock.calls[0]?.[0]).toMatchObject({
      overviewPanX: expect.any(Number),
      presentationMode: "overview",
    });
    harness.scheduler.teardown();
  });

  it("retargets stable overview follow on the displayed world surface", () => {
    const worldPresentation = new WorkspaceWorldPresentation();
    const worldHost = document.createElement("div");
    const worldGrid = document.createElement("div");
    worldPresentation.bindWorldHost(worldHost, worldGrid);
    const harness = createSchedulerHarness(
      undefined,
      undefined,
      worldPresentation,
    );
    harness.scheduler.start();
    harness.frameHost.flushOne(0);
    harness.store.setCameraModes(cameraModes("fixed", "follow"));
    expect(harness.store.focusPane("c")).toBe(true);
    harness.frameHost.flushAll();
    harness.store.toggleOverviewMode();
    harness.frameHost.flushAll();
    const pane = requiredHost(harness.hosts, "c");
    const initial = visualWorldPaneBox(pane, worldHost);
    const initialWorldTransform = worldHost.style.transform;

    expect(harness.store.moveFocus("right", viewport)).toBe(true);
    expect(worldHost.style.transform).toBe(initialWorldTransform);
    harness.frameHost.flushFrames(1);
    expectVisualWorldPaneBox(pane, worldHost, initial);

    harness.frameHost.flushFrames(3);
    const displayedBeforeReversal = visualWorldPaneBox(pane, worldHost);
    expect(displayedBeforeReversal.width).toBeCloseTo(initial.width, 3);
    expect(displayedBeforeReversal.x).not.toBeCloseTo(initial.x, 3);

    expect(harness.store.moveFocus("left", viewport)).toBe(true);
    harness.frameHost.flushFrames(1);
    expectVisualWorldPaneBox(pane, worldHost, displayedBeforeReversal);

    harness.frameHost.flushAll();
    expectVisualWorldPaneBox(pane, worldHost, initial);
    expect(worldPresentation.hasActiveMotion()).toBe(false);
    harness.scheduler.teardown();
  });

  it("snaps stable overview follow when reduced motion is preferred", () => {
    const reducedMotionQuery = {
      addEventListener: vi.fn(),
      matches: true,
      removeEventListener: vi.fn(),
    } as unknown as MediaQueryList;
    const worldPresentation = new WorkspaceWorldPresentation();
    const worldHost = document.createElement("div");
    const worldGrid = document.createElement("div");
    worldPresentation.bindWorldHost(worldHost, worldGrid);
    const harness = createSchedulerHarness(
      reducedMotionQuery,
      undefined,
      worldPresentation,
    );
    harness.scheduler.start();
    harness.frameHost.flushOne(0);
    harness.store.setCameraModes(cameraModes("fixed", "follow"));
    expect(harness.store.focusPane("c")).toBe(true);
    harness.store.toggleOverviewMode();
    harness.frameHost.flushAll();

    expect(harness.store.moveFocus("right", viewport)).toBe(true);
    expect(worldPresentation.hasActiveMotion()).toBe(false);
    expect(worldHost.style.willChange).toBe("");
    harness.scheduler.teardown();
  });

  it("keeps following overview closer while centering every focus move without rescaling", () => {
    const worldPresentation = new WorkspaceWorldPresentation();
    const worldHost = document.createElement("div");
    const worldGrid = document.createElement("div");
    worldPresentation.bindWorldHost(worldHost, worldGrid);
    const harness = createSchedulerHarness(
      undefined,
      undefined,
      worldPresentation,
    );
    harness.scheduler.start();
    harness.frameHost.flushOne(0);
    harness.store.setCameraModes(cameraModes("follow", "follow"));
    harness.store.ensureFocusedPaneVisible(viewport);
    harness.store.toggleOverviewMode();
    harness.frameHost.flushAll();

    const initial = overviewCursorFrame(
      harness.engine,
      harness.store.getSnapshot(),
    );
    const fit = harness.engine.overviewContentBounds(
      viewport,
      null,
      1,
      harness.store.getSnapshot().cursor,
    );
    expect(initial.scale).toBeGreaterThan(fit.scale * 1.5);
    expectOverviewCursorCentered(initial);
    const initialWorldScale = transformScaleValue(worldHost.style.transform);

    expect(harness.store.focusPane("b")).toBe(true);
    expect(worldPresentation.hasActiveMotion()).toBe(true);
    expect(transformScaleValue(worldHost.style.transform)).toBeCloseTo(
      initialWorldScale,
      3,
    );
    harness.frameHost.flushAll();
    const occupied = overviewCursorFrame(
      harness.engine,
      harness.store.getSnapshot(),
    );
    expect(harness.store.getSnapshot().focusedPaneId).toBe("b");
    expect(occupied.scale).toBeCloseTo(initial.scale, 6);
    expectOverviewCursorCentered(occupied);

    expect(harness.store.moveFocus("right", viewport)).toBe(true);
    harness.frameHost.flushAll();
    expect(harness.store.moveFocus("right", viewport)).toBe(true);
    expect(worldPresentation.hasActiveMotion()).toBe(true);
    harness.frameHost.flushAll();
    const empty = overviewCursorFrame(
      harness.engine,
      harness.store.getSnapshot(),
    );
    expect(harness.store.getSnapshot()).toMatchObject({
      cursor: { column: 3, row: 0, split: 0 },
      focusedPaneId: null,
      presentationMode: "overview",
    });
    expect(empty.scale).toBeCloseTo(initial.scale, 6);
    expectOverviewCursorCentered(empty);

    expect(harness.store.moveFocus("down", viewport)).toBe(true);
    const firstCellBelow = overviewCursorFrame(
      harness.engine,
      harness.store.getSnapshot(),
    );
    expect(harness.store.getSnapshot().cursor.row).toBe(1);
    expect(firstCellBelow.scale).toBeCloseTo(initial.scale, 6);
    expectOverviewCursorCentered(firstCellBelow);
    harness.scheduler.teardown();
  });

  it("keeps empty-cell cursor navigation separate from pane rearrangement", () => {
    for (const presentationMode of ["normal", "overview"] as const) {
      const harness = createSchedulerHarness();
      harness.scheduler.start();
      harness.frameHost.flushOne(0);
      expect(harness.store.focusPane("c")).toBe(true);
      harness.frameHost.flushAll();
      if (presentationMode === "overview") {
        harness.store.toggleOverviewMode();
        harness.frameHost.flushAll();
      }
      const sceneBeforeCursorMove = harness.engine.toScene();

      expect(harness.store.moveFocus("right", viewport)).toBe(true);
      harness.frameHost.flushAll();
      expect(harness.store.getSnapshot()).toMatchObject({
        cursor: { column: 3, row: 0, split: 0 },
        focusedPaneId: null,
      });
      expect(harness.engine.toScene()).toEqual(sceneBeforeCursorMove);
      expect(harness.store.moveFocusedPane("right")).toBe(false);
      expect(harness.presentation.hasActivePaneRearrangement()).toBe(false);

      expect(harness.store.moveFocus("left", viewport)).toBe(true);
      harness.frameHost.flushAll();
      expect(harness.store.focusedPaneId()).toBe("c");
      const movingHost = requiredHost(harness.hosts, "c");
      expect(harness.store.moveFocusedPane("right")).toBe(true);
      const movedScene = harness.engine.toScene();
      expect(
        movedScene.columns.find((column) =>
          column.cells.some((cell) => cell.paneId === "c"),
        ),
      ).toMatchObject({ slotIndex: 3 });
      expect(requiredHost(harness.hosts, "c")).toBe(movingHost);
      harness.frameHost.flushAll();
      harness.scheduler.teardown();
    }
  });

  it("keeps normal and following-overview pane moves continuous at an outer virtual cell", () => {
    const normal = createSchedulerHarness();
    normal.scheduler.start();
    normal.frameHost.flushOne(0);
    expect(normal.store.focusPane("c")).toBe(true);
    normal.frameHost.flushAll();
    const normalCameraBefore = normal.store.getSnapshot();
    const normalHost = requiredHost(normal.hosts, "c");

    expect(normal.store.moveFocusedPane("right")).toBe(true);
    expect(normal.store.getSnapshot()).toMatchObject({
      cursor: { column: 3, row: 0, split: 0 },
      focusedPaneId: "c",
      horizontalAnchorOffset: normalCameraBefore.horizontalAnchorOffset,
      scrollColumn: normalCameraBefore.scrollColumn,
      scrollRow: normalCameraBefore.scrollRow,
      targetHorizontalAnchorOffset:
        normalCameraBefore.targetHorizontalAnchorOffset,
      targetScrollColumn: normalCameraBefore.targetScrollColumn,
      targetScrollRow: normalCameraBefore.targetScrollRow,
    });
    normal.frameHost.flushAll();
    expect(requiredHost(normal.hosts, "c")).toBe(normalHost);
    expect(workspaceGridCursorForPane(normal.engine.toScene(), "c")).toEqual({
      column: 3,
      row: 0,
      split: 0,
    });
    normal.scheduler.teardown();

    const overview = createSchedulerHarness();
    overview.scheduler.start();
    overview.frameHost.flushOne(0);
    expect(overview.store.focusPane("c")).toBe(true);
    overview.frameHost.flushAll();
    overview.store.setCameraModes(cameraModes("fixed", "follow"));
    overview.store.toggleOverviewMode();
    overview.frameHost.flushAll();
    const overviewCameraBefore = overview.store.getSnapshot();
    const fixedScale = overviewCameraBefore.overviewFixedScale;
    if (fixedScale === undefined) {
      throw new Error("expected a fixed overview scale");
    }
    const overviewHost = requiredHost(overview.hosts, "c");

    expect(overview.store.moveFocusedPane("right")).toBe(true);
    expect(overview.store.getSnapshot()).toMatchObject({
      cursor: { column: 3, row: 0, split: 0 },
      focusedPaneId: "c",
      overviewFixedScale: fixedScale,
      presentationMode: "overview",
    });
    expectOverviewCursorCentered(
      overviewCursorFrame(overview.engine, overview.store.getSnapshot()),
    );
    overview.frameHost.flushAll();
    expect(requiredHost(overview.hosts, "c")).toBe(overviewHost);

    expect(overview.store.moveFocusedPane("left")).toBe(true);
    expect(overview.store.getSnapshot().overviewFixedScale).toBeCloseTo(
      fixedScale,
      6,
    );
    expectOverviewCursorCentered(
      overviewCursorFrame(overview.engine, overview.store.getSnapshot()),
    );
    overview.scheduler.teardown();
  });

  it("keeps empty-cell cursor navigation safe under reduced motion", () => {
    const reducedMotionQuery = {
      addEventListener: vi.fn(),
      matches: true,
      removeEventListener: vi.fn(),
    } as unknown as MediaQueryList;
    const harness = createSchedulerHarness(reducedMotionQuery);
    harness.scheduler.start();
    harness.frameHost.flushOne(0);
    expect(harness.store.focusPane("c")).toBe(true);
    harness.frameHost.flushAll();
    const sceneBeforeCursorMove = harness.engine.toScene();
    expect(harness.store.moveFocus("right", viewport)).toBe(true);
    expect(harness.store.getSnapshot()).toMatchObject({
      cursor: { column: 3, row: 0, split: 0 },
      focusedPaneId: null,
    });
    expect(harness.engine.toScene()).toEqual(sceneBeforeCursorMove);
    expect(harness.store.moveFocusedPane("right")).toBe(false);
    expect(harness.presentation.hasActivePaneRearrangement()).toBe(false);

    expect(harness.store.moveFocus("left", viewport)).toBe(true);
    const movingHost = requiredHost(harness.hosts, "c");
    expect(harness.store.moveFocusedPane("right")).toBe(true);
    expect(requiredHost(harness.hosts, "c")).toBe(movingHost);
    expect(harness.presentation.hasActivePaneRearrangement()).toBe(false);
    expect(
      harness.engine
        .toScene()
        .columns.find((column) =>
          column.cells.some((cell) => cell.paneId === "c"),
        ),
    ).toMatchObject({ slotIndex: 3 });
    harness.scheduler.teardown();
  });
});

function translatedX(transform: string): number {
  const match = /translate3d\((-?[\d.]+)px/.exec(transform);
  return match ? Number(match[1]) : 0;
}

function scaleOf(transform: string): number {
  const match = /scale\((-?[\d.]+)\)/.exec(transform);
  return match ? Number(match[1]) : 1;
}
