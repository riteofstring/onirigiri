import type {
  PaneId,
  PaneRenderItem,
  Rect,
  WorkspaceWorldFrame,
} from "../types.js";
import { unionRects } from "./workspace-sweep-geometry.js";

const svgNamespace = "http://www.w3.org/2000/svg";
const minimapPaddingRatio = 0.06;

interface WorkspaceMinimapPaneBox extends Rect {
  focused: boolean;
  paneId: PaneId;
}

interface WorkspaceMinimapView {
  bounds: Rect;
  panes: readonly WorkspaceMinimapPaneBox[];
  visible: Rect;
}

interface MinimapPaneElement {
  element: SVGRectElement;
  focused: string;
  geometry: string;
}

interface MinimapBinding {
  host: SVGSVGElement;
  panes: SVGGElement;
  paneElements: Map<PaneId, MinimapPaneElement>;
  lastViewBox: string;
  lastVisible: string;
  visible: SVGRectElement;
}

interface MinimapInput {
  items: readonly PaneRenderItem[];
  viewport: Rect;
  world: WorkspaceWorldFrame;
}

export function workspaceMinimapView(
  items: readonly PaneRenderItem[],
  world: WorkspaceWorldFrame,
  viewport: Rect,
): WorkspaceMinimapView {
  const scale =
    Number.isFinite(world.scale) && world.scale > 0 ? world.scale : 1;
  const visible: Rect = {
    height: viewport.height / scale,
    width: viewport.width / scale,
    x: (viewport.x - world.x) / scale,
    y: (viewport.y - world.y) / scale,
  };
  const panes = items.map((item) => {
    const itemScale =
      Number.isFinite(item.scale) && item.scale > 0 ? item.scale : 1;
    return {
      focused: item.focused,
      height: item.height * itemScale,
      paneId: item.paneId,
      width: item.width * itemScale,
      x: item.x,
      y: item.y,
    };
  });
  const content = panes.reduce<Rect>(
    (bounds, pane) => unionRects(bounds, pane),
    visible,
  );
  const padding = Math.max(content.width, content.height) * minimapPaddingRatio;
  return {
    bounds: {
      height: content.height + padding * 2,
      width: content.width + padding * 2,
      x: content.x - padding,
      y: content.y - padding,
    },
    panes,
    visible,
  };
}

export class WorkspaceMinimapPresentation {
  private binding: MinimapBinding | null = null;
  private lastInput: MinimapInput | null = null;

  bindMinimapHost(host: SVGSVGElement | null): () => void {
    if (!host) {
      return () => undefined;
    }
    const binding = createMinimapBinding(host);
    this.binding = binding;
    if (this.lastInput) {
      writeMinimap(binding, this.lastInput);
    }
    return () => {
      binding.panes.remove();
      binding.visible.remove();
      if (this.binding === binding) {
        this.binding = null;
      }
    };
  }

  apply(
    items: readonly PaneRenderItem[],
    world: WorkspaceWorldFrame,
    viewport: Rect,
  ): void {
    this.lastInput = { items, viewport, world };
    if (this.binding) {
      writeMinimap(this.binding, this.lastInput);
    }
  }
}

function createMinimapBinding(host: SVGSVGElement): MinimapBinding {
  const ownerDocument = host.ownerDocument;
  const panes = ownerDocument.createElementNS(svgNamespace, "g");
  panes.setAttribute("class", "onirigiri-workspace__minimap-panes");
  const visible = ownerDocument.createElementNS(svgNamespace, "rect");
  visible.setAttribute("class", "onirigiri-workspace__minimap-viewport");
  visible.setAttribute("data-onirigiri-minimap-viewport", "true");
  visible.setAttribute("vector-effect", "non-scaling-stroke");
  host.append(panes, visible);
  return {
    host,
    lastViewBox: "",
    lastVisible: "",
    paneElements: new Map(),
    panes,
    visible,
  };
}

function writeMinimap(binding: MinimapBinding, input: MinimapInput): void {
  const view = workspaceMinimapView(input.items, input.world, input.viewport);
  const viewBox = rectList(view.bounds);
  if (binding.lastViewBox !== viewBox) {
    binding.lastViewBox = viewBox;
    binding.host.setAttribute("viewBox", viewBox);
  }
  const visible = rectList(view.visible);
  if (binding.lastVisible !== visible) {
    binding.lastVisible = visible;
    writeRect(binding.visible, view.visible);
  }
  const retained = new Set<PaneId>();
  for (const pane of view.panes) {
    retained.add(pane.paneId);
    writePane(binding, pane);
  }
  for (const [paneId, pane] of binding.paneElements) {
    if (!retained.has(paneId)) {
      pane.element.remove();
      binding.paneElements.delete(paneId);
    }
  }
}

function writePane(
  binding: MinimapBinding,
  pane: WorkspaceMinimapPaneBox,
): void {
  let current = binding.paneElements.get(pane.paneId);
  if (!current) {
    const element = binding.host.ownerDocument.createElementNS(
      svgNamespace,
      "rect",
    );
    element.setAttribute("class", "onirigiri-workspace__minimap-pane");
    element.setAttribute("data-onirigiri-minimap-pane-id", pane.paneId);
    element.setAttribute("vector-effect", "non-scaling-stroke");
    binding.panes.append(element);
    current = { element, focused: "", geometry: "" };
    binding.paneElements.set(pane.paneId, current);
  }
  const geometry = rectList(pane);
  if (current.geometry !== geometry) {
    current.geometry = geometry;
    writeRect(current.element, pane);
  }
  const focused = String(pane.focused);
  if (current.focused !== focused) {
    current.focused = focused;
    current.element.setAttribute("data-focused", focused);
  }
}

function writeRect(element: SVGRectElement, rect: Rect): void {
  element.setAttribute("x", coordinate(rect.x));
  element.setAttribute("y", coordinate(rect.y));
  element.setAttribute("width", coordinate(Math.max(0, rect.width)));
  element.setAttribute("height", coordinate(Math.max(0, rect.height)));
}

function rectList(rect: Rect): string {
  return `${coordinate(rect.x)} ${coordinate(rect.y)} ${coordinate(Math.max(1, rect.width))} ${coordinate(Math.max(1, rect.height))}`;
}

function coordinate(value: number): string {
  return Number.isFinite(value) ? value.toFixed(1) : "0";
}
