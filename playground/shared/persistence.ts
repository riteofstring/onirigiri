import type {
  ColumnWidthSpec,
  OnirigiriLayout,
  WorkspaceColumn,
  WorkspaceCell,
  WorkspacePane,
} from "@riteofstring/onirigiri";

const paneTones = new Set(["cyan", "green", "orange", "pink", "slate"]);

export function readStoredLayout(storageKey: string): OnirigiriLayout | null {
  try {
    const serialized = window.localStorage.getItem(storageKey);
    if (!serialized) {
      return null;
    }
    const value: unknown = JSON.parse(serialized);
    return isOnirigiriLayout(value) ? value : null;
  } catch {
    return null;
  }
}

export function writeStoredLayout(
  storageKey: string,
  layout: OnirigiriLayout,
): boolean {
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(layout));
    return true;
  } catch {
    return false;
  }
}

export function clearStoredLayout(storageKey: string): boolean {
  try {
    window.localStorage.removeItem(storageKey);
    return true;
  } catch {
    return false;
  }
}

function isOnirigiriLayout(value: unknown): value is OnirigiriLayout {
  if (
    !isRecord(value) ||
    !hasLayoutIdentity(value) ||
    !hasLayoutCollections(value)
  ) {
    return false;
  }
  return layoutReferencesAreConsistent(value as unknown as OnirigiriLayout);
}

function hasLayoutIdentity(value: Record<string, unknown>): boolean {
  return (
    value.schemaVersion === 4 &&
    isNonEmptyString(value.id) &&
    isWorkspaceGridCursor(value.cursor)
  );
}

function hasLayoutCollections(value: Record<string, unknown>): boolean {
  return (
    Array.isArray(value.columns) &&
    value.columns.length > 0 &&
    value.columns.every(isWorkspaceColumn) &&
    Array.isArray(value.panes) &&
    value.panes.length > 0 &&
    value.panes.every(isWorkspacePane)
  );
}

function isWorkspaceColumn(value: unknown): value is WorkspaceColumn {
  if (!isRecord(value) || !hasColumnIdentityAndOrder(value)) {
    return false;
  }
  return hasColumnGeometry(value);
}

function hasColumnIdentityAndOrder(value: Record<string, unknown>): boolean {
  return (
    isNonEmptyString(value.columnId) &&
    isNonNegativeInteger(value.index) &&
    isWorkspaceCellArray(value.cells) &&
    value.cells.length > 0 &&
    isNonNegativeInteger(value.planeIndex) &&
    isOptionalNonNegativeInteger(value.slotIndex)
  );
}

function isWorkspaceCellArray(value: unknown): value is WorkspaceCell[] {
  return (
    Array.isArray(value) &&
    value.every(
      (cell) =>
        isRecord(cell) &&
        (cell.paneId === null || isNonEmptyString(cell.paneId)) &&
        typeof cell.reserved === "boolean" &&
        !(cell.reserved && cell.paneId !== null) &&
        isPositiveNumber(cell.weight) &&
        isOptionalPositiveNumber(cell.heightPx),
    )
  );
}

function hasColumnGeometry(value: Record<string, unknown>): boolean {
  return (
    isColumnWidthSpec(value.idealWidthSpec) &&
    isColumnWidthSpec(value.widthSpec) &&
    isOptionalPositiveNumber(value.previousProportionWidth)
  );
}

function isWorkspacePane(value: unknown): value is WorkspacePane {
  if (!isRecord(value)) {
    return false;
  }
  return (
    hasPaneIdentity(value) &&
    isNonNegativeInteger(value.sequence) &&
    typeof value.subtitle === "string" &&
    paneTones.has(String(value.tone))
  );
}

function hasPaneIdentity(value: Record<string, unknown>): boolean {
  return (
    isNonEmptyString(value.columnId) &&
    isNonEmptyString(value.paneId) &&
    isNonEmptyString(value.surfaceId) &&
    isNonEmptyString(value.surfaceKind) &&
    isNonEmptyString(value.title)
  );
}

function layoutReferencesAreConsistent(layout: OnirigiriLayout): boolean {
  const paneIds = new Set(layout.panes.map((pane) => pane.paneId));
  const columnIds = new Set(layout.columns.map((column) => column.columnId));
  if (!layoutHasUniqueKnownIds(layout, paneIds, columnIds)) {
    return false;
  }

  return paneOwnersAreConsistent(layout, paneIds);
}

function layoutHasUniqueKnownIds(
  layout: OnirigiriLayout,
  paneIds: ReadonlySet<string>,
  columnIds: ReadonlySet<string>,
): boolean {
  return (
    paneIds.size === layout.panes.length &&
    columnIds.size === layout.columns.length
  );
}

function paneOwnersAreConsistent(
  layout: OnirigiriLayout,
  paneIds: ReadonlySet<string>,
): boolean {
  const ownerByPaneId = new Map<string, string>();
  for (const column of layout.columns) {
    for (const { paneId } of column.cells) {
      if (paneId === null) {
        continue;
      }
      if (!paneIds.has(paneId) || ownerByPaneId.has(paneId)) {
        return false;
      }
      ownerByPaneId.set(paneId, column.columnId);
    }
  }
  return (
    ownerByPaneId.size === paneIds.size &&
    layout.panes.every(
      (pane) => ownerByPaneId.get(pane.paneId) === pane.columnId,
    )
  );
}

function isColumnWidthSpec(value: unknown): value is ColumnWidthSpec {
  return (
    isRecord(value) &&
    (value.unit === "proportion" || value.unit === "px") &&
    isPositiveNumber(value.value)
  );
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isWorkspaceGridCursor(value: unknown): boolean {
  return (
    isRecord(value) &&
    isInteger(value.column) &&
    isInteger(value.row) &&
    isNonNegativeInteger(value.split)
  );
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value);
}

function isOptionalNonNegativeInteger(
  value: unknown,
): value is number | undefined {
  return value === undefined || isNonNegativeInteger(value);
}

function isPositiveNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function isOptionalPositiveNumber(value: unknown): value is number | undefined {
  return value === undefined || isPositiveNumber(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
