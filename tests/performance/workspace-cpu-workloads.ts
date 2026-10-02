import { PaneContentCapabilities } from "../../src/panes/pane-content-capabilities";
import { WorkspaceLikeLayoutEngine } from "../../src/layout/layout-engine";
import { WorkspaceLayoutStore } from "../../src/state/layout-store";
import { createWorkspaceScene } from "../../src/workspace/workspace-scene";
import {
  WorkspaceRenderItemRenderer,
  WorkspaceWorldFrameRenderer,
} from "../../src/presentation/workspace-render-items";
import { orderPaneActivation } from "../../src/pictures/pane-picture-activation";
import { completePaneShells } from "../../src/presentation/workspace-sweep-geometry";

const viewport = { x: 0, y: 0, width: 1440, height: 900 };

export const scenarios = [
  "capability-text",
  "capability-terminal",
  "capability-graphics",
  "capability-cached",
  "render-normal-100",
  "render-overview-100",
  "render-normal-500",
  "shells-100",
  "shells-500",
  "activation-100",
  "activation-500",
  "camera-start-100",
  "camera-center-100",
  "camera-center-500",
];

export async function run(name: string, iterations = 100) {
  return name.startsWith("capability-")
    ? capabilities(name, iterations)
    : geometry(name, iterations);
}

async function capabilities(name: string, iterations: number) {
  const root = document.createElement("section");
  const rows = Array.from({ length: 120 }, (_, i) => {
    const row = document.createElement("div");
    row.innerHTML = `<span>${i}</span><span>Terminal output row</span><span>0</span>`;
    root.append(row);
    return row;
  });
  document.body.append(root);
  let notifications = 0;
  const inventory = new PaneContentCapabilities(root, () => notifications++);
  if (!inventory.canCapture())
    throw new Error("Initial DOM must be capturable");
  const samples: number[] = [];
  let checksum = 0;
  try {
    for (let i = 0; i < iterations; i++) {
      const row = rows[i % rows.length]!;
      if (name === "capability-text") row.lastChild!.textContent = String(i);
      if (name === "capability-terminal")
        row.innerHTML = `<span>${i}</span><span>Terminal output row</span><span>${i * 3}</span>`;
      if (name === "capability-graphics")
        row.replaceChildren(document.createElement(i % 2 ? "video" : "canvas"));
      const start = performance.now();
      for (let query = 0; query < 20; query++) {
        checksum +=
          Number(inventory.canCapture()) +
          Number(inventory.hasVideo()) +
          inventory.iframeDocuments().size;
      }
      samples.push(performance.now() - start);
      await Promise.resolve();
    }
    return {
      name,
      iterations,
      queries: iterations * 60,
      samples,
      checksum,
      notifications,
      elementCount: root.querySelectorAll("*").length,
    };
  } finally {
    inventory.dispose();
    root.remove();
  }
}

function geometry(name: string, iterations: number) {
  const count = name.endsWith("500") ? 500 : 100;
  const { scene, cursor } = createWorkspaceScene({
    panes: Array.from({ length: count }, (_, i) => ({
      paneId: `pane-${i}`,
      columnId: `column-${i}`,
      columnWidth: { unit: "px" as const, value: 480 + (i % 3) * 40 },
      heightPx: 520 + (i % 4) * 30,
      planeIndex: Math.floor(i / Math.ceil(count / 10)),
      slotIndex: i % Math.ceil(count / 10),
      surfaceKind: "cpu-diagnostic",
      title: `Pane ${i}`,
    })),
  });
  const engine = new WorkspaceLikeLayoutEngine(scene);
  const store = new WorkspaceLayoutStore(engine, scene, cursor, {
    initialCameraModes: { normal: "fixed", overview: "fixed" },
    initialFocusAnchor: "start",
  });
  store.ensureFocusedPaneVisible(viewport);
  const renderer = new WorkspaceRenderItemRenderer();
  const world = new WorkspaceWorldFrameRenderer();
  const boxes = engine.paneWorldBoxes(viewport);
  const snapshot = store.getSnapshot();
  let base = {
    engine,
    snapshot,
    viewport,
    compactLayout: false,
    moving: false,
  };
  const items = renderer.render(base);
  const samples: number[] = [];
  let checksum = 0;
  for (let i = 0; i < iterations; i++) {
    const next = nextSnapshot(snapshot, name, count, i);
    const input = { ...base, snapshot: next, moving: true };
    const start = performance.now();
    let result;
    if (name.startsWith("shells"))
      result = completePaneShells(input, [], boxes);
    else if (name.startsWith("activation"))
      result = orderPaneActivation(items, next.focusedPaneId);
    else if (name.startsWith("camera")) {
      const target = engine.gridCameraTarget(
        next.cursor,
        viewport,
        name.includes("center") ? "center" : "start",
      );
      checksum +=
        target.horizontalAnchorOffset + target.scrollColumn + target.scrollRow;
      result = items;
    } else {
      result = renderer.render(input);
      const frame = world.render(input);
      checksum += frame.scale;
    }
    samples.push(performance.now() - start);
    if (result.length !== count)
      throw new Error(`${name}: expected ${count} panes, got ${result.length}`);
    checksum += result.length + result[0]!.x;
  }
  return { name, iterations, samples, checksum, paneCount: count };
}

function nextSnapshot(
  snapshot: ReturnType<WorkspaceLayoutStore["getSnapshot"]>,
  name: string,
  count: number,
  i: number,
) {
  return {
    ...snapshot,
    focusedPaneId: `pane-${i % count}`,
    cursor: {
      column: (i % count) % Math.ceil(count / 10),
      row: Math.floor((i % count) / Math.ceil(count / 10)),
      split: 0,
    },
    revision: i,
    scrollColumn: (i % 5) * 0.25,
    targetScrollColumn: 2,
    presentationMode: name.includes("overview")
      ? ("overview" as const)
      : ("normal" as const),
    overviewProgress: name.includes("overview") ? 1 : 0,
  };
}
