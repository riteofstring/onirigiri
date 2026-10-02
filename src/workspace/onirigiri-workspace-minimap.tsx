import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent,
} from "react";

import {
  minimapDragThresholdPx,
  nearestMinimapCorner,
  resizedMinimapPlacement,
  resolveMinimapPlacement,
  sameMinimapPlacement,
} from "../input/workspace-minimap-placement.js";
import type { WorkspaceMinimapPresentation } from "../presentation/workspace-minimap-presentation.js";
import type { WorkspaceLayoutStore } from "../state/layout-store.js";
import {
  resolveOnirigiriSlotProps,
  useOnirigiriStyling,
} from "../styles/onirigiri-styling.js";
import type { Rect } from "../types.js";
import type { OnirigiriMinimapPlacement } from "./onirigiri-workspace-types.js";

interface MinimapGesture {
  kind: "press" | "move" | "resize";
  paneId: string | null;
  pointerId: number;
  stage: DOMRect;
  start: OnirigiriMinimapPlacement;
  startX: number;
  startY: number;
}

export function OnirigiriWorkspaceMinimap({
  adjustable,
  enabled,
  onPlacementChange,
  placement: requestedPlacement,
  presentation,
  stageRef,
  store,
  viewportRef,
}: {
  adjustable: boolean;
  enabled: boolean;
  onPlacementChange:
    ((placement: OnirigiriMinimapPlacement) => void) | undefined;
  placement: Partial<OnirigiriMinimapPlacement> | undefined;
  presentation: WorkspaceMinimapPresentation;
  stageRef: { current: HTMLDivElement | null };
  store: WorkspaceLayoutStore;
  viewportRef: { current: Rect };
}) {
  const styling = useOnirigiriStyling();
  const minimapSlot = resolveOnirigiriSlotProps(
    styling,
    "minimap",
    "onirigiri-workspace__minimap",
  );
  const resizeSlot = resolveOnirigiriSlotProps(
    styling,
    "minimap-resize",
    "onirigiri-workspace__minimap-resize",
  );
  const requested = resolveMinimapPlacement(requestedPlacement);
  const [placement, setPlacement] = useState(requested);
  const placementRef = useRef(placement);
  placementRef.current = placement;
  const rootRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<SVGSVGElement | null>(null);
  const gestureRef = useRef<MinimapGesture | null>(null);
  const placementChangeRef = useRef(onPlacementChange);
  placementChangeRef.current = onPlacementChange;

  const { corner, heightPx, widthPx } = requested;
  useEffect(() => {
    const next = { corner, heightPx, widthPx };
    placementRef.current = next;
    setPlacement((current) =>
      sameMinimapPlacement(current, next) ? current : next,
    );
  }, [corner, heightPx, widthPx]);

  const shown = enabled;
  useLayoutEffect(
    () => presentation.bindMinimapHost(shown ? mapRef.current : null),
    [presentation, shown],
  );

  const commit = (next: OnirigiriMinimapPlacement) => {
    if (sameMinimapPlacement(placementRef.current, next)) {
      return;
    }
    placementRef.current = next;
    setPlacement(next);
    placementChangeRef.current?.(next);
  };

  const begin = (
    event: PointerEvent<HTMLElement>,
    kind: MinimapGesture["kind"],
  ) => {
    const stage = stageRef.current;
    if (event.button !== 0 || !stage) {
      return;
    }
    event.stopPropagation();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const paneElement =
      event.target instanceof Element
        ? event.target.closest("[data-onirigiri-minimap-pane-id]")
        : null;
    gestureRef.current = {
      kind,
      paneId:
        paneElement?.getAttribute("data-onirigiri-minimap-pane-id") ?? null,
      pointerId: event.pointerId,
      stage: stage.getBoundingClientRect(),
      start: placementRef.current,
      startX: event.clientX,
      startY: event.clientY,
    };
  };

  const update = (event: PointerEvent<HTMLElement>) => {
    const gesture = gestureRef.current;
    const root = rootRef.current;
    if (!gesture || !root || gesture.pointerId !== event.pointerId) {
      return;
    }
    const delta = {
      x: event.clientX - gesture.startX,
      y: event.clientY - gesture.startY,
    };
    if (gesture.kind === "resize") {
      const next = resizedMinimapPlacement(gesture.start, delta, gesture.stage);
      root.setAttribute("data-adjusting", "true");
      root.style.width = `${String(next.widthPx)}px`;
      root.style.height = `${String(next.heightPx)}px`;
      return;
    }
    if (
      gesture.kind === "press" &&
      adjustable &&
      Math.hypot(delta.x, delta.y) >= minimapDragThresholdPx
    ) {
      gesture.kind = "move";
      root.setAttribute("data-adjusting", "true");
    }
    if (gesture.kind === "move") {
      root.style.translate = `${String(delta.x)}px ${String(delta.y)}px`;
    }
  };

  const finish = (event: PointerEvent<HTMLElement>, cancelled: boolean) => {
    const gesture = gestureRef.current;
    const root = rootRef.current;
    if (!gesture || !root || gesture.pointerId !== event.pointerId) {
      return;
    }
    gestureRef.current = null;
    const bounds = root.getBoundingClientRect();
    root.style.translate = "";
    root.removeAttribute("data-adjusting");
    if (!cancelled) {
      complete(gesture, bounds, event);
    }
    root.style.width = `${String(placementRef.current.widthPx)}px`;
    root.style.height = `${String(placementRef.current.heightPx)}px`;
  };

  const complete = (
    gesture: MinimapGesture,
    bounds: DOMRect,
    event: PointerEvent<HTMLElement>,
  ) => {
    if (gesture.kind !== "press") {
      commit(releasedMinimapPlacement(gesture, bounds, event));
      return;
    }
    if (gesture.paneId && store.focusPane(gesture.paneId)) {
      store.ensureFocusedPaneVisible(viewportRef.current);
    }
  };

  if (!shown) {
    return null;
  }

  return (
    <div
      aria-hidden="true"
      className={minimapSlot.className}
      data-corner={placement.corner}
      data-onirigiri-slot="minimap"
      onPointerCancel={(event) => finish(event, true)}
      onPointerDown={(event) => begin(event, "press")}
      onPointerMove={update}
      onPointerUp={(event) => finish(event, false)}
      ref={rootRef}
      style={{
        ...minimapSlot.style,
        height: placement.heightPx,
        width: placement.widthPx,
      }}
    >
      <svg
        className="onirigiri-workspace__minimap-map"
        preserveAspectRatio="xMidYMid meet"
        ref={mapRef}
      />
      {adjustable ? (
        <div
          className={resizeSlot.className}
          data-onirigiri-slot="minimap-resize"
          onPointerDown={(event) => begin(event, "resize")}
          style={resizeSlot.style}
        />
      ) : null}
    </div>
  );
}

function releasedMinimapPlacement(
  gesture: MinimapGesture,
  bounds: DOMRect,
  pointer: { clientX: number; clientY: number },
): OnirigiriMinimapPlacement {
  if (gesture.kind === "resize") {
    return resizedMinimapPlacement(
      gesture.start,
      {
        x: pointer.clientX - gesture.startX,
        y: pointer.clientY - gesture.startY,
      },
      gesture.stage,
    );
  }
  return {
    ...gesture.start,
    corner: nearestMinimapCorner(
      {
        x: bounds.left + bounds.width / 2 - gesture.stage.left,
        y: bounds.top + bounds.height / 2 - gesture.stage.top,
      },
      gesture.stage,
    ),
  };
}
