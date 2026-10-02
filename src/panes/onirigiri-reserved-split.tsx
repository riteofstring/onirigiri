import type { ReservedCellRenderItem } from "../types.js";

export function ReservedSplitCell({ item }: { item: ReservedCellRenderItem }) {
  return (
    <div
      aria-hidden="true"
      className="onirigiri-reserved-split"
      data-onirigiri-column-id={item.columnId}
      data-onirigiri-slot="reserved-split"
      data-onirigiri-structural-row={item.rowIndex}
      style={{
        height: item.height,
        transform: `translate3d(${item.x}px, ${item.y}px, 0) scale(${item.scale})`,
        transformOrigin: "top left",
        width: item.width,
      }}
    />
  );
}

export function reservedSplitCellKey(item: ReservedCellRenderItem): string {
  return `${item.presentationMode}:${item.planeIndex}:${item.columnId}:${item.rowIndex}`;
}
