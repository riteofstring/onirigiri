import { act, createElement, createRef } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, vi } from "vitest";

import type { PanePictures } from "../src/pictures/pane-pictures";
import type { WorkspacePane } from "../src/types";
import { OnirigiriWorkspace } from "../src/workspace/OnirigiriWorkspace";
import type {
  OnirigiriWorkspaceHandle,
  OnirigiriWorkspaceProps,
} from "../src/workspace/onirigiri-workspace-types";

class ResizeObserverMock {
  disconnect() {}
  observe() {}
  unobserve() {}
}

let restoreMoveBefore: (() => void) | undefined;

afterEach(() => {
  restoreMoveBefore?.();
  restoreMoveBefore = undefined;
});

export function stubOnirigiriWorkspaceBrowserGlobals(): void {
  const descriptor = Object.getOwnPropertyDescriptor(
    Element.prototype,
    "moveBefore",
  );
  Object.defineProperty(Element.prototype, "moveBefore", {
    configurable: true,
    writable: true,
    value(this: Element, node: Node, child: Node | null) {
      this.insertBefore(node, child);
    },
  });
  restoreMoveBefore = () => {
    if (descriptor)
      Object.defineProperty(Element.prototype, "moveBefore", descriptor);
    else Reflect.deleteProperty(Element.prototype, "moveBefore");
  };
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("PointerEvent", MouseEvent);
  vi.stubGlobal("ResizeObserver", ResizeObserverMock);
  vi.stubGlobal(
    "requestAnimationFrame",
    vi.fn(() => 1),
  );
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
    viewportBounds(),
  );
}

export async function mountWorkspace(props: OnirigiriWorkspaceProps) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const ref = createRef<OnirigiriWorkspaceHandle>();
  const render = (next: OnirigiriWorkspaceProps) =>
    act(async () =>
      root.render(createElement(OnirigiriWorkspace, { ...next, ref })),
    );
  await render(props);
  return {
    container,
    ref,
    render,
    workspace: () => requiredWorkspaceHandle(ref.current),
    async unmount() {
      await act(async () => root.unmount());
      container.remove();
    },
  };
}

export const editorPane: WorkspacePane = {
  paneId: "editor",
  columnId: "column",
  sequence: 0,
  surfaceId: "editor",
  surfaceKind: "editor",
  title: "Editor",
  subtitle: "",
  tone: "slate",
};

export function panePicturesStub(
  methods: Partial<Record<keyof PanePictures, unknown>>,
) {
  const listeners = new Set<() => void>();
  const pictures = {
    subscribe: (_id: string, listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    isContinuous: () => true,
    acceptsContentInput: () => true,
    isOverviewCapture: () => false,
    isPreloading: () => false,
    presentCover: vi.fn(),
    register: () => () => {},
    ...methods,
  } as unknown as PanePictures;
  return {
    pictures,
    notify() {
      for (const listener of listeners) listener();
    },
  };
}

export function activePaneId(): string | undefined {
  return document.activeElement?.closest<HTMLElement>(
    "[data-onirigiri-pane-id]",
  )?.dataset.onirigiriPaneId;
}

export function paneLocation(
  workspace: OnirigiriWorkspaceHandle,
  paneId: string,
) {
  const column = workspace
    .getScene()
    .columns.find((candidate) =>
      candidate.cells.some((cell) => cell.paneId === paneId),
    );
  if (!column) {
    throw new Error(`missing column for pane ${paneId}`);
  }
  return { planeIndex: column.planeIndex, slotIndex: column.slotIndex };
}

export function requiredWorkspaceHandle(
  workspace: OnirigiriWorkspaceHandle | null,
): OnirigiriWorkspaceHandle {
  if (!workspace) {
    throw new Error("workspace ref was not attached");
  }
  return workspace;
}

export function requiredPaneId(paneId: string | null): string {
  if (!paneId) {
    throw new Error("expected the cursor to select a pane");
  }
  return paneId;
}

export function requiredElement<T extends Element>(
  root: ParentNode,
  selector: string,
): T {
  const element = root.querySelector<T>(selector);
  if (!element) {
    throw new Error(`missing ${selector}`);
  }
  return element;
}

export function workspacePaneIds(
  column:
    | ReturnType<OnirigiriWorkspaceHandle["getScene"]>["columns"][number]
    | undefined,
): Array<string | null> | undefined {
  return column?.cells.map((cell) => cell.paneId);
}

export function workspaceRowSizingSnapshot(
  scene: ReturnType<OnirigiriWorkspaceHandle["getScene"]>,
) {
  return scene.columns.map((column) => ({
    columnId: column.columnId,
    rowSizing: column.cells.map(({ heightPx, weight }) =>
      heightPx === undefined ? { weight } : { heightPx, weight },
    ),
  }));
}

function viewportBounds(): DOMRect {
  return {
    bottom: 900,
    height: 900,
    left: 0,
    right: 1200,
    toJSON: () => ({}),
    top: 0,
    width: 1200,
    x: 0,
    y: 0,
  };
}
