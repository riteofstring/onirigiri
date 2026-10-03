// @vitest-environment jsdom

import { act, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createWorkspaceScene,
  defaultPaneResizeEdges,
  OnirigiriLayoutEngine,
  OnirigiriLayoutStore,
  OnirigiriWorkspace,
  type OnirigiriLayoutChangeMetadata,
  type OnirigiriPaneDefinition,
  type OnirigiriWorkspaceHandle,
  type OnirigiriWorkspaceProps,
  type PaneDefaults,
  type WorkspaceFocusAnchor,
} from "../src/index";
import { paneCellSizingForPane } from "../src/layout/pane-cell-sizing";
import {
  requiredElement,
  requiredWorkspaceHandle,
  stubOnirigiriWorkspaceBrowserGlobals,
} from "./onirigiri-workspace-test-support";

const viewport = { x: 0, y: 0, width: 1200, height: 900 };

function layoutStore(
  focusAnchor: WorkspaceFocusAnchor,
  paneDefaults: PaneDefaults = {},
) {
  const { cursor, scene } = createWorkspaceScene({
    paneDefaults,
    panes: [
      {
        columnId: "left",
        columnWidth: { unit: "px", value: 400 },
        heightPx: 400,
        paneId: "left",
        surfaceKind: "test",
        title: "Left",
      },
      {
        columnId: "right",
        columnWidth: { unit: "px", value: 400 },
        heightPx: 400,
        paneId: "right",
        surfaceKind: "test",
        title: "Right",
      },
    ],
  });
  const engine = new OnirigiriLayoutEngine(scene);
  const store = new OnirigiriLayoutStore(engine, scene, cursor, {
    initialFocusAnchor: focusAnchor,
  });
  store.ensureFocusedPaneVisible(viewport);
  store.focusPane("right");
  store.snapAnimationsToTarget();
  const screenBox = () => {
    const snapshot = store.getSnapshot();
    return engine.gridCursorRenderItem({
      cursor: snapshot.cursor,
      focusedPaneId: snapshot.focusedPaneId,
      horizontalAnchorOffset: snapshot.horizontalAnchorOffset,
      maximizedPaneId: snapshot.maximizedPaneId,
      movementPhase: "idle",
      presentationMode: "normal",
      scrollColumn: snapshot.scrollColumn,
      scrollRow: snapshot.scrollRow,
      verticalAnchorOffset: snapshot.verticalAnchorOffset,
      viewport,
    });
  };
  return { screenBox, store };
}

describe("resize edge layout", () => {
  for (const focusAnchor of ["start", "center"] as const) {
    it(`keeps the right edge on screen while the left edge resizes with ${focusAnchor} focus`, () => {
      const { screenBox, store } = layoutStore(focusAnchor);
      const before = screenBox();
      store.resizePaneColumn("right", { unit: "px", value: 520 }, "end");
      const after = screenBox();
      expect(after.width).toBe(520);
      expect(after.x).toBeCloseTo(before.x - 120);
      expect(after.x + after.width).toBeCloseTo(before.x + before.width);
      const snapshot = store.getSnapshot();
      expect(snapshot.horizontalAnchorOffset).toBe(
        snapshot.targetHorizontalAnchorOffset,
      );
    });

    it(`keeps the bottom edge on screen while the top edge resizes with ${focusAnchor} focus`, () => {
      const { screenBox, store } = layoutStore(focusAnchor);
      const before = screenBox();
      store.resizePaneRow("right", 300, "end");
      const after = screenBox();
      expect(after.height).toBe(300);
      expect(after.y).toBeCloseTo(before.y + 100);
      expect(after.y + after.height).toBeCloseTo(before.y + before.height);
    });
  }

  it("keeps the start edges fixed for right and bottom resizing", () => {
    const { screenBox, store } = layoutStore("start");
    const before = screenBox();
    store.resizePaneColumn("right", { unit: "px", value: 520 });
    store.resizePaneRow("right", 300);
    const after = screenBox();
    expect(after).toMatchObject({ height: 300, width: 520 });
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
  });

  it("moves the start edges only as far as pane bounds allow", () => {
    const { screenBox, store } = layoutStore("start", {
      maxHeight: 450,
      maxWidth: 440,
      minWidth: 300,
    });
    const before = screenBox();
    store.resizePaneColumn("right", { unit: "px", value: 900 }, "end");
    store.resizePaneRow("right", 800, "end");
    const grown = screenBox();
    expect(grown).toMatchObject({ height: 450, width: 440 });
    expect(grown.x + grown.width).toBeCloseTo(before.x + before.width);
    expect(grown.y + grown.height).toBeCloseTo(before.y + before.height);

    store.resizePaneColumn("right", { unit: "px", value: 180 }, "end");
    const shrunk = screenBox();
    expect(shrunk.width).toBe(300);
    expect(shrunk.x + shrunk.width).toBeCloseTo(before.x + before.width);
  });

  it("validates resize edges with the other pane defaults", () => {
    expect(() =>
      createWorkspaceScene({
        paneDefaults: {
          resizeEdges: [
            "left",
            "middle",
          ] as unknown as PaneDefaults["resizeEdges"],
        },
      }),
    ).toThrow("resizeEdges");
    expect(() =>
      createWorkspaceScene({
        panes: [
          {
            defaults: {
              resizeEdges: "top" as unknown as PaneDefaults["resizeEdges"],
            },
            paneId: "pane",
            surfaceKind: "test",
            title: "Pane",
          },
        ],
      }),
    ).toThrow("resizeEdges");
    expect(defaultPaneResizeEdges).toEqual(["right", "bottom"]);
  });
});

describe("resize edge handles", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    stubOnirigiriWorkspaceBrowserGlobals();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    for (const method of pointerCaptureMethods) {
      Reflect.deleteProperty(HTMLElement.prototype, method);
    }
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  const stackPanes: OnirigiriPaneDefinition[] = [
    {
      columnId: "stack",
      columnWidth: { unit: "px", value: 400 },
      paneId: "upper",
      surfaceKind: "test",
      title: "Upper",
    },
    {
      columnId: "stack",
      paneId: "lower",
      surfaceKind: "test",
      title: "Lower",
    },
    {
      columnId: "side",
      columnWidth: { unit: "px", value: 400 },
      paneId: "side",
      surfaceKind: "note",
      title: "Side",
    },
  ];

  async function mount(
    props: Partial<OnirigiriWorkspaceProps> = {},
  ): Promise<OnirigiriWorkspaceHandle> {
    const ref = createRef<OnirigiriWorkspaceHandle>();
    await act(async () =>
      root.render(
        <OnirigiriWorkspace
          focusAnchor="start"
          initialPanes={stackPanes}
          ref={ref}
          renderPane={(pane) => <p>{pane.title}</p>}
          {...props}
        />,
      ),
    );
    return requiredWorkspaceHandle(ref.current);
  }

  function edges(paneId: string): string[] {
    const pane = requiredElement<HTMLElement>(
      container,
      `[data-onirigiri-pane-id="${paneId}"]`,
    );
    return [
      ...pane.querySelectorAll<HTMLButtonElement>(".onirigiri-pane__resize"),
    ].map(
      (handle) =>
        `${handle.dataset.onirigiriSlot ?? ""}:${handle.dataset.resizeEdge ?? ""}`,
    );
  }

  function handle(paneId: string, edge: string): HTMLButtonElement {
    return requiredElement<HTMLButtonElement>(
      container,
      `[data-onirigiri-pane-id="${paneId}"] [data-resize-edge="${edge}"]`,
    );
  }

  async function pressKey(target: HTMLElement, key: string): Promise<void> {
    await act(async () =>
      target.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key }),
      ),
    );
  }

  it("keeps the right and bottom handles by default", async () => {
    await mount();
    for (const paneId of ["upper", "lower", "side"]) {
      expect(edges(paneId)).toEqual([
        "pane-resize-column:right",
        "pane-resize-row:bottom",
      ]);
    }
    expect(handle("upper", "right").className).toBe(
      "onirigiri-pane__resize onirigiri-pane__resize--column",
    );
    expect(handle("upper", "bottom").getAttribute("aria-label")).toBe(
      "Resize split between Upper and Lower",
    );
  });

  it("chooses edges per workspace, pane type and pane", async () => {
    await mount({
      initialPanes: stackPanes.map((pane) =>
        pane.paneId === "lower"
          ? { ...pane, defaults: { resizeEdges: [] } }
          : pane,
      ),
      paneDefaults: { resizeEdges: ["left", "top"] },
      paneTypeDefaults: { note: { resizeEdges: ["bottom", "right"] } },
    });
    expect(edges("upper")).toEqual([
      "pane-resize-column:left",
      "pane-resize-row:top",
    ]);
    expect(edges("lower")).toEqual([]);
    expect(edges("side")).toEqual([
      "pane-resize-column:right",
      "pane-resize-row:bottom",
    ]);
    const left = handle("upper", "left");
    expect(left.className).toContain("onirigiri-pane__resize--left");
    expect(left.getAttribute("aria-label")).toBe(
      "Resize Upper width from the left edge",
    );
    expect(left.getAttribute("aria-keyshortcuts")).toBe(
      "ArrowLeft ArrowRight Enter Space",
    );
    const top = handle("upper", "top");
    expect(top.className).toContain("onirigiri-pane__resize--top");
    expect(top.dataset.resizeKind).toBe("row");
    expect(top.getAttribute("aria-label")).toBe(
      "Resize row containing Upper from the top edge",
    );
  });

  it("resizes width from the left edge with the keyboard", async () => {
    const workspace = await mount({
      paneDefaults: { resizeEdges: [...defaultPaneResizeEdges, "left"] },
    });
    await pressKey(handle("side", "left"), "ArrowLeft");
    expect(workspace.getSnapshot().focusedPaneId).toBe("side");
    expect(columnWidth(workspace, "side")).toBe(416);
    await pressKey(handle("side", "left"), "ArrowRight");
    await pressKey(handle("side", "left"), "ArrowRight");
    expect(columnWidth(workspace, "side")).toBe(384);
    await pressKey(handle("side", "left"), "Enter");
    expect(columnWidth(workspace, "side")).toBe(400);
  });

  it("moves the shared split from the lower pane's top edge", async () => {
    const fromTop = await mount({ paneDefaults: { resizeEdges: ["top"] } });
    const top = handle("lower", "top");
    expect(top.dataset.resizeKind).toBe("split");
    expect(top.getAttribute("aria-label")).toBe(
      "Resize split between Upper and Lower",
    );
    await pressKey(top, "ArrowUp");
    expect(fromTop.getSnapshot().focusedPaneId).toBe("lower");
    const topSizing = splitSizing(fromTop);
    await act(async () => root.unmount());
    root = createRoot(container);

    const fromBottom = await mount();
    await pressKey(handle("upper", "bottom"), "ArrowUp");
    expect(splitSizing(fromBottom)).toEqual(topSizing);
    expect(topSizing.upper?.weight).toBeLessThan(topSizing.lower?.weight ?? 0);
  });

  it("grows the row from the top cell's top edge with the keyboard", async () => {
    const workspace = await mount({ paneDefaults: { resizeEdges: ["top"] } });
    const top = handle("upper", "top");
    const before = stackHeight(workspace);
    await pressKey(top, "ArrowUp");
    expect(stackHeight(workspace)).toBe(before + 16);
    await pressKey(top, "ArrowDown");
    await pressKey(top, "ArrowDown");
    expect(stackHeight(workspace)).toBe(before - 16);
  });

  it("drags the left edge as one layout mutation with the right edge held", async () => {
    const changes: OnirigiriLayoutChangeMetadata[] = [];
    const workspace = await mount({
      initialPanes: stackPanes.filter((pane) => pane.paneId === "side"),
      onLayoutChange: (_layout, metadata) => changes.push(metadata),
      paneDefaults: { resizeEdges: ["left"] },
    });
    stubPointerCapture();
    const left = handle("side", "left");
    const anchorBefore = workspace.getSnapshot().horizontalAnchorOffset;
    const changesBefore = changes.length;

    await act(async () => {
      left.dispatchEvent(
        new MouseEvent("pointerdown", { bubbles: true, clientX: 500 }),
      );
    });
    for (const clientX of [480, 440, 400]) {
      await act(async () => {
        window.dispatchEvent(new MouseEvent("pointermove", { clientX }));
      });
    }
    expect(columnWidth(workspace, "side")).toBe(500);
    expect(workspace.getSnapshot().horizontalAnchorOffset).toBeCloseTo(
      anchorBefore + 100,
    );
    await act(async () => {
      window.dispatchEvent(new MouseEvent("pointerup", { clientX: 400 }));
    });

    const gesture = changes
      .slice(changesBefore)
      .filter((change) => change.kind === "user");
    expect(gesture.length).toBeGreaterThan(0);
    expect(new Set(gesture.map((change) => change.mutationId)).size).toBe(1);
    expect(workspace.getLayout().columns[0]?.widthSpec).toEqual({
      unit: "px",
      value: 500,
    });
  });
});

const pointerCaptureMethods = [
  "hasPointerCapture",
  "releasePointerCapture",
  "setPointerCapture",
] as const;

function stubPointerCapture(): void {
  for (const method of pointerCaptureMethods) {
    Object.defineProperty(HTMLElement.prototype, method, {
      configurable: true,
      value: () => method === "hasPointerCapture",
    });
  }
}

function columnWidth(
  workspace: OnirigiriWorkspaceHandle,
  paneId: string,
): number | undefined {
  const scene = workspace.getScene();
  const columnId = scene.paneById.get(paneId)?.columnId;
  return scene.columns.find((column) => column.columnId === columnId)?.widthSpec
    .value;
}

function splitSizing(workspace: OnirigiriWorkspaceHandle) {
  const scene = workspace.getScene();
  return {
    lower: paneCellSizingForPane(scene, "lower"),
    upper: paneCellSizingForPane(scene, "upper"),
  };
}

function stackHeight(workspace: OnirigiriWorkspaceHandle): number {
  const scene = workspace.getScene();
  const upper = paneCellSizingForPane(scene, "upper")?.heightPx;
  const lower = paneCellSizingForPane(scene, "lower")?.heightPx;
  if (upper === undefined || lower === undefined) {
    const items = [
      ...document.querySelectorAll<HTMLElement>(
        '[data-onirigiri-pane-id="upper"], [data-onirigiri-pane-id="lower"]',
      ),
    ];
    return items.reduce(
      (total, item) => total + Number.parseFloat(item.style.height),
      scene.rowGap,
    );
  }
  return upper + lower + scene.rowGap;
}
