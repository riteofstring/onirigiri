import { describe, expect, it } from "vitest";

import { PanePresentationEngine } from "../src/presentation/pane-presentation-engine";

import {
  renderItem,
  snapshot,
  viewport,
} from "./pane-presentation-engine-test-support";

describe("PanePresentationEngine", () => {
  it("defers offscreen content measurements until the pane becomes visible", () => {
    const presentation = new PanePresentationEngine();
    const host = document.createElement("section");
    host.style.borderBottomLeftRadius = "18px";
    const content = document.createElement("div");
    content.className = "onirigiri-pane__content";
    let reads = 0;
    Object.defineProperty(content, "offsetTop", {
      get: () => {
        reads++;
        return 48;
      },
    });
    host.append(content);
    const hidden = renderItem({ visible: false, runtimeState: "hidden" });
    presentation.registerPaneHost("pane", host, hidden);
    presentation.apply([hidden], snapshot(), false, viewport);
    expect(reads).toBe(0);
    presentation.apply([renderItem()], snapshot(), false, viewport);
    expect(
      presentation.presentedPaneGeometries([renderItem()])[0],
    ).toMatchObject({
      contentOffsetTop: 48,
      cornerRadius: 18,
    });
    expect(reads).toBe(1);
  });

  it("publishes measured content geometry and interpolates unmounted ingress panes", () => {
    const presentation = new PanePresentationEngine();
    const host = document.createElement("section");
    host.style.borderBottomLeftRadius = "12px";
    const content = document.createElement("div");
    content.className = "onirigiri-pane__content";
    Object.defineProperty(content, "offsetTop", {
      configurable: true,
      value: 36,
    });
    host.append(content);
    presentation.registerPaneHost("pane", host, renderItem());

    expect(
      presentation.presentedPaneGeometries([renderItem()])[0],
    ).toMatchObject({
      contentOffsetTop: 36,
      cornerRadius: 12,
      height: 300,
      paneId: "pane",
      width: 400,
    });

    const ingressPresentation = new PanePresentationEngine();
    const workspace = document.createElement("div");
    workspace.style.setProperty("--onirigiri-titlebar-min-height", "36px");
    document.body.append(workspace);
    ingressPresentation.bindWorkspace(workspace);
    const destination = renderItem({ x: 200 });
    expect(
      ingressPresentation.retargetPaneRearrangement(
        [destination],
        [
          {
            height: 300,
            paneId: "pane",
            scale: 1,
            width: 400,
            x: 0,
            y: 0,
          },
        ],
      ),
    ).toBe(true);
    expect(
      ingressPresentation.presentedPaneGeometries([destination])[0]?.x,
    ).toBe(0);
    ingressPresentation.advancePaneRearrangement(80);
    const intermediate =
      ingressPresentation.presentedPaneGeometries([destination])[0]?.x ?? 0;
    expect(intermediate).toBeGreaterThan(0);
    expect(intermediate).toBeLessThan(200);
    ingressPresentation.advancePaneRearrangement(80);
    expect(
      ingressPresentation.presentedPaneGeometries([destination])[0]?.x,
    ).toBe(200);
    expect(
      ingressPresentation.presentedPaneGeometries([destination])[0]
        ?.contentOffsetTop,
    ).toBe(36);
    workspace.remove();
  });

  it("dirty-writes stable hosts and freezes the original content subtree", () => {
    const presentation = new PanePresentationEngine();
    const workspace = document.createElement("div");
    const host = document.createElement("section");
    const content = document.createElement("div");
    const liveContent = document.createElement("div");
    const consumer = document.createElement("input");
    content.className = "onirigiri-pane__content";
    liveContent.className = "onirigiri-pane__live-content";
    liveContent.append(consumer);
    content.append(liveContent);
    host.append(content);
    workspace.append(host);
    presentation.bindWorkspace(workspace);
    presentation.registerPaneHost("pane", host);

    const first = presentation.apply(
      [renderItem()],
      snapshot(),
      false,
      viewport,
    );
    expect(first.transformWrites).toBe(1);
    expect(first.boxWrites).toBe(2);
    expect(host.dataset.runtimeState).toBe("live");
    expect(host.style.transform).toBe(
      "translate(0.00px, 0.00px) scale(1.0000)",
    );
    expect(host.style.willChange).toBe("");
    expect(liveContent.inert).toBe(false);

    const unchanged = presentation.apply(
      [renderItem()],
      snapshot(),
      false,
      viewport,
    );
    expect(unchanged).toEqual({
      attributeWrites: 0,
      boxWrites: 0,
      transformWrites: 0,
    });

    const frozenItem = renderItem({
      moving: true,
      runtimeState: "frozen",
      x: -120,
    });
    const moved = presentation.apply(
      [frozenItem],
      snapshot({ scrollColumn: 0.5 }),
      false,
      viewport,
    );
    expect(moved.transformWrites).toBe(1);
    expect(moved.boxWrites).toBe(0);
    expect(host.dataset.frozen).toBe("true");
    expect(host.style.transform).toBe(
      "translate(-120.00px, 0.00px) scale(1.0000)",
    );
    expect(host.style.willChange).toBe("");
    expect(liveContent.inert).toBe(true);
    expect(liveContent.getAttribute("aria-hidden")).toBe("true");
    expect(host.querySelector("input")).toBe(consumer);
    expect(host.querySelector("[data-onirigiri-frozen-texture]")).toBeNull();
  });

  it("keeps overview elevation at presentation boundaries through camera ingress and reversal", () => {
    const presentation = new PanePresentationEngine();
    const workspace = document.createElement("div");
    presentation.bindWorkspace(workspace);

    presentation.presentWorkspace(
      snapshot({ overviewProgress: 0, presentationMode: "overview" }),
      viewport,
    );
    expect(
      workspace.classList.contains("onirigiri-workspace--overview-transition"),
    ).toBe(true);

    presentation.presentWorkspace(
      snapshot({ overviewProgress: 1, presentationMode: "overview" }),
      viewport,
    );
    expect(
      workspace.classList.contains("onirigiri-workspace--overview-transition"),
    ).toBe(false);

    const settledOverview = snapshot({
      overviewProgress: 1,
      presentationMode: "overview",
    });
    presentation.apply(
      [
        renderItem({
          moving: true,
          preload: true,
          presentationMode: "overview",
          runtimeState: "frozen",
        }),
      ],
      settledOverview,
      false,
      viewport,
    );
    expect(
      workspace.classList.contains("onirigiri-workspace--overview-transition"),
    ).toBe(false);

    presentation.apply(
      [
        renderItem({
          moving: true,
          presentationMode: "overview",
          runtimeState: "hidden",
          visible: false,
          x: 120,
        }),
      ],
      { ...settledOverview, overviewPanX: 120 },
      false,
      viewport,
    );
    expect(
      workspace.classList.contains("onirigiri-workspace--overview-transition"),
    ).toBe(false);

    presentation.apply(
      [
        renderItem({
          moving: true,
          preload: true,
          presentationMode: "overview",
          runtimeState: "frozen",
          x: 120,
        }),
      ],
      { ...settledOverview, overviewPanX: 120 },
      false,
      viewport,
    );
    expect(
      workspace.classList.contains("onirigiri-workspace--overview-transition"),
    ).toBe(false);

    presentation.apply(
      [
        renderItem({
          moving: true,
          preload: true,
          presentationMode: "overview",
          runtimeState: "frozen",
        }),
      ],
      settledOverview,
      false,
      viewport,
    );
    expect(
      workspace.classList.contains("onirigiri-workspace--overview-transition"),
    ).toBe(false);

    presentation.presentWorkspace(
      snapshot({ overviewProgress: 1, presentationMode: "normal" }),
      viewport,
    );
    expect(
      workspace.classList.contains("onirigiri-workspace--overview-transition"),
    ).toBe(true);

    presentation.presentWorkspace(snapshot(), viewport);
    expect(
      workspace.classList.contains("onirigiri-workspace--overview-transition"),
    ).toBe(false);
  });

  it("keeps unchanged overview cards out of a pane rearrangement", () => {
    const presentation = new PanePresentationEngine();
    const stationaryHost = document.createElement("section");
    const movingHost = document.createElement("section");
    const stationary = renderItem({
      paneId: "stationary",
      presentationMode: "overview",
      runtimeState: "frozen",
      scale: 0.5,
      x: 40,
      y: 24,
    });
    const moving = renderItem({
      paneId: "moving",
      presentationMode: "overview",
      runtimeState: "frozen",
      scale: 0.5,
      x: 260,
      y: 24,
    });
    presentation.registerPaneHost("stationary", stationaryHost, stationary);
    presentation.registerPaneHost("moving", movingHost, moving);
    const stationaryTransform = stationaryHost.style.transform;

    const movingDestination = { ...moving, x: 480 };
    expect(
      presentation.retargetPaneRearrangement([stationary, movingDestination]),
    ).toBe(true);
    presentation.apply(
      [stationary, movingDestination],
      snapshot({ overviewProgress: 1, presentationMode: "overview" }),
      false,
      viewport,
    );

    expect(stationaryHost.style.transform).toBe(stationaryTransform);
    expect(movingHost.style.transform).toBe(
      "translate(260.00px, 24.00px) scale(0.5000)",
    );
  });

  it("starts equal-size overview swaps at their displayed boxes and reverses continuously", () => {
    const presentation = new PanePresentationEngine();
    const host = document.createElement("section");
    const source = renderItem({
      paneId: "source",
      presentationMode: "overview",
      runtimeState: "frozen",
      scale: 0.5,
      x: 40,
      y: 24,
    });
    const destination = { ...source, x: 440 };
    presentation.registerPaneHost("source", host, source);
    const sourceTransform = host.style.transform;

    expect(presentation.retargetPaneRearrangement([destination])).toBe(true);
    presentation.apply(
      [destination],
      snapshot({ overviewProgress: 1, presentationMode: "overview" }),
      false,
      viewport,
    );
    expect(host.style.transform).toBe(sourceTransform);

    presentation.advancePaneRearrangement(40);
    presentation.apply(
      [destination],
      snapshot({ overviewProgress: 1, presentationMode: "overview" }),
      false,
      viewport,
    );
    const displayedBeforeReverse = host.style.transform;
    expect(displayedBeforeReverse).toMatch(/scale\(0\.5000\)$/);

    expect(presentation.retargetPaneRearrangement([source])).toBe(true);
    presentation.apply(
      [source],
      snapshot({ overviewProgress: 1, presentationMode: "overview" }),
      false,
      viewport,
    );
    expect(host.style.transform).toBe(displayedBeforeReverse);
  });

  it("keeps resized overview boxes at their displayed dimensions before settling", () => {
    const presentation = new PanePresentationEngine();
    const sourceHost = document.createElement("section");
    const targetHost = document.createElement("section");
    const source = renderItem({
      height: 420,
      paneId: "source",
      presentationMode: "overview",
      runtimeState: "frozen",
      scale: 0.5,
      x: 40,
      y: 24,
    });
    const target = renderItem({
      height: 300,
      paneId: "target",
      presentationMode: "overview",
      runtimeState: "frozen",
      scale: 0.5,
      x: 440,
      y: 240,
    });
    presentation.registerPaneHost("source", sourceHost, source);
    presentation.registerPaneHost("target", targetHost, target);
    const sourceVisualBox = visualPaneBox(sourceHost);
    const targetVisualBox = visualPaneBox(targetHost);

    expect(
      presentation.retargetPaneRearrangement([
        { ...target, paneId: "source" },
        { ...source, paneId: "target" },
      ]),
    ).toBe(true);
    presentation.apply(
      [
        { ...target, paneId: "source" },
        { ...source, paneId: "target" },
      ],
      snapshot({ overviewProgress: 1, presentationMode: "overview" }),
      false,
      viewport,
    );

    expect(sourceHost.style.height).toBe("420px");
    expect(targetHost.style.height).toBe("300px");
    expectVisualPaneBox(sourceHost, sourceVisualBox);
    expectVisualPaneBox(targetHost, targetVisualBox);

    presentation.advancePaneRearrangement(40);
    presentation.apply(
      [
        { ...target, paneId: "source" },
        { ...source, paneId: "target" },
      ],
      snapshot({ overviewProgress: 1, presentationMode: "overview" }),
      false,
      viewport,
    );
    const sourceVisualBeforeReverse = visualPaneBox(sourceHost);
    expect(presentation.retargetPaneRearrangement([source, target])).toBe(true);
    presentation.apply(
      [source, target],
      snapshot({ overviewProgress: 1, presentationMode: "overview" }),
      false,
      viewport,
    );
    expectVisualPaneBox(sourceHost, sourceVisualBeforeReverse);
  });

  it("primes a Fixed edge entrant from its bounded source world box instead of its target", () => {
    const presentation = new PanePresentationEngine();
    const source = renderItem({
      paneId: "edge",
      x: 920,
      y: 24,
    });
    const target = { ...source, x: 320 };

    expect(presentation.retargetPaneRearrangement([target], [source])).toBe(
      true,
    );
    presentation.apply([source], snapshot(), false, viewport);
    const host = document.createElement("section");
    presentation.registerPaneHost("edge", host, target);

    expect(host.style.transform).toBe(
      "translate(920.00px, 24.00px) scale(1.0000)",
    );
    presentation.advancePaneRearrangement(48);
    presentation.apply([target], snapshot(), false, viewport);
    expect(host.style.transform).not.toBe(
      "translate(320.00px, 24.00px) scale(1.0000)",
    );
  });

  it("settles an interrupted rearrangement at the current destination box", () => {
    const presentation = new PanePresentationEngine();
    const host = document.createElement("section");
    const shortRow = renderItem({
      height: 180,
      paneId: "source",
      x: 40,
      y: 24,
    });
    const tallRow = { ...shortRow, height: 480, y: 240 };
    presentation.registerPaneHost("source", host, shortRow);

    expect(presentation.retargetPaneRearrangement([tallRow])).toBe(true);
    presentation.apply([tallRow], snapshot(), false, viewport);
    presentation.advancePaneRearrangement(40);
    presentation.apply([tallRow], snapshot(), false, viewport);

    const shortDestination = { ...shortRow, y: 24 };
    presentation.apply([shortDestination], snapshot(), false, viewport);
    expectVisualPaneBox(host, {
      height: 180,
      width: 400,
      x: 40,
      y: 24,
    });
    presentation.advancePaneRearrangement(120);
    presentation.apply([shortDestination], snapshot(), false, viewport);

    expect(host.style.height).toBe("180px");
    expectVisualPaneBox(host, {
      height: 180,
      width: 400,
      x: 40,
      y: 24,
    });
  });

  it("derives a Follow camera offset from the exact displayed focused box", () => {
    const presentation = new PanePresentationEngine();
    const focusedHost = document.createElement("section");
    const neighborHost = document.createElement("section");
    const focused = renderItem({
      height: 560,
      paneId: "focused",
      x: 40,
      y: 24,
    });
    const neighbor = renderItem({ paneId: "neighbor", x: 440, y: 24 });
    presentation.registerPaneHost("focused", focusedHost, focused);
    presentation.registerPaneHost("neighbor", neighborHost, neighbor);
    const destination = { ...focused, height: 280, x: 440, y: 240 };

    expect(
      presentation.followPaneRearrangementCameraOffset(
        [destination, { ...neighbor, x: 40 }],
        "focused",
      ),
    ).toEqual({ x: -400, y: -216 });

    expect(
      presentation.retargetPaneRearrangement([
        destination,
        { ...neighbor, x: 40 },
      ]),
    ).toBe(true);
    presentation.advancePaneRearrangement(40);
    presentation.apply(
      [destination, { ...neighbor, x: 40 }],
      snapshot(),
      false,
      viewport,
    );

    expectVisualPaneBox(focusedHost, {
      height: 437.5,
      width: 400,
      x: 215,
      y: 118.5,
    });

    presentation.advancePaneRearrangement(120);
    presentation.apply(
      [destination, { ...neighbor, x: 40 }],
      snapshot(),
      false,
      viewport,
    );
    expectVisualPaneBox(focusedHost, {
      height: 280,
      width: 400,
      x: 440,
      y: 240,
    });
  });

  it("keeps offscreen shells placed and visible while disabling interaction", () => {
    const presentation = new PanePresentationEngine();
    const host = document.createElement("section");
    const titlebar = document.createElement("header");
    const action = document.createElement("button");
    const resize = document.createElement("button");
    titlebar.dataset.onirigiriPaneTitlebar = "true";
    action.dataset.onirigiriPaneControl = "true";
    resize.dataset.onirigiriPaneControl = "true";
    titlebar.append(action);
    host.append(titlebar, resize);
    const unregister = presentation.registerPaneHost(
      "pane",
      host,
      renderItem({ z: 3 }),
    );

    const hidden = presentation.apply(
      [
        renderItem({
          height: 360,
          moving: true,
          opacity: 1,
          runtimeState: "hidden",
          visible: false,
          width: 420,
          x: -240,
          y: 80,
          z: 1,
        }),
      ],
      snapshot({ scrollColumn: 0.5 }),
      false,
      viewport,
    );

    expect(hidden.transformWrites).toBe(1);
    expect(hidden.boxWrites).toBe(2);
    expect(host.dataset.visible).toBe("false");
    expect(host.dataset.runtimeState).toBe("hidden");
    expect(host.hidden).toBe(false);
    expect(host.inert).toBe(true);
    expect(host.style.pointerEvents).toBe("none");
    expect(titlebar.closest<HTMLElement>("[hidden]")).toBeNull();
    expect(action.closest<HTMLElement>("[hidden]")).toBeNull();
    expect(resize.closest<HTMLElement>("[hidden]")).toBeNull();
    expect(host.style.transform).toBe(
      "translate(-240.00px, 80.00px) scale(1.0000)",
    );
    expect(host.style.opacity).toBe("1");
    expect(host.style.zIndex).toBe("1");
    expect(host.style.width).toBe("420px");
    expect(host.style.height).toBe("360px");

    const returned = presentation.apply(
      [
        renderItem({
          height: 360,
          moving: true,
          runtimeState: "frozen",
          width: 420,
          x: -240,
          y: 80,
          z: 1,
        }),
      ],
      snapshot({ scrollColumn: 0.5 }),
      false,
      viewport,
    );

    expect(returned.transformWrites).toBe(0);
    expect(host.dataset.visible).toBe("true");
    expect(host.hidden).toBe(false);
    expect(host.style.transform).toBe(
      "translate(-240.00px, 80.00px) scale(1.0000)",
    );
    expect(host.style.zIndex).toBe("1");

    unregister();
  });

  it("places a never-visible shell at its world position", () => {
    const presentation = new PanePresentationEngine();
    const host = document.createElement("section");
    const unregister = presentation.registerPaneHost(
      "pane",
      host,
      renderItem({
        runtimeState: "hidden",
        visible: false,
        x: 4800,
        y: 160,
      }),
    );

    expect(host.hidden).toBe(false);
    expect(host.style.opacity).toBe("1");
    expect(host.style.transform).toBe(
      "translate(4800.00px, 160.00px) scale(1.0000)",
    );
    expect(host.inert).toBe(true);
    unregister();
  });
});

interface PaneVisualBox {
  height: number;
  width: number;
  x: number;
  y: number;
}

function expectVisualPaneBox(host: HTMLElement, expected: PaneVisualBox): void {
  const actual = visualPaneBox(host);
  expect(actual.height).toBeCloseTo(expected.height, 1);
  expect(actual.width).toBeCloseTo(expected.width, 1);
  expect(actual.x).toBeCloseTo(expected.x, 2);
  expect(actual.y).toBeCloseTo(expected.y, 2);
}

function visualPaneBox(host: HTMLElement): PaneVisualBox {
  const transform = host.style.transform;
  const translation = /translate(?:3d)?\((-?[\d.]+)px, (-?[\d.]+)px/.exec(
    transform,
  );
  const scale = /scale\((-?[\d.]+)(?:, (-?[\d.]+))?\)/.exec(transform);
  if (!translation?.[1] || !translation[2] || !scale?.[1]) {
    throw new Error(`missing pane visual transform: ${transform}`);
  }
  const scaleX = Number(scale[1]);
  const scaleY = Number(scale[2] ?? scale[1]);
  return {
    height: Number.parseFloat(host.style.height) * scaleY,
    width: Number.parseFloat(host.style.width) * scaleX,
    x: Number(translation[1]),
    y: Number(translation[2]),
  };
}
