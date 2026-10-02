import { columnSlotIndex } from "./column-slots";
import type {
  PaneDefaults,
  PaneContentDefaults,
  PaneDefaultsConfiguration,
  PaneDimension,
  PaneId,
  PaneSizingConfiguration,
  WorkspaceColumn,
  WorkspacePane,
} from "../types";

export function resolvePaneDefaults(
  pane: WorkspacePane | null,
  configuration: PaneDefaultsConfiguration = {},
): PaneDefaults {
  const base = configuration.paneDefaults;
  const type = pane
    ? configuration.paneTypeDefaults?.[pane.surfaceKind]
    : undefined;
  const own = pane?.defaults;
  return {
    ...base,
    ...type,
    ...own,
    content: { ...base?.content, ...type?.content, ...own?.content },
  };
}

export function validatePaneDefaults(defaults: PaneDefaults | undefined): void {
  if (!defaults) return;
  for (const key of ["width", "height"] as const) {
    const value = defaults[key];
    if (value !== undefined && value !== "viewport" && value !== "auto")
      positiveDimension(value, key);
  }
  for (const key of [
    "minWidth",
    "minHeight",
    "maxWidth",
    "maxHeight",
    "aspectRatio",
  ] as const) {
    const value = defaults[key];
    if (value !== undefined) positiveDimension(value, key);
  }
  validateContentDefaults(defaults.content);
}

function validateContentDefaults(
  content: PaneContentDefaults | undefined,
): void {
  if (content?.aspectRatio !== undefined) {
    positiveDimension(content.aspectRatio, "content.aspectRatio");
  }
  const fit = content?.fit;
  if (
    fit !== undefined &&
    fit !== "contain" &&
    fit !== "cover" &&
    fit !== "fill"
  ) {
    throw new Error("Pane content fit must be contain, cover, or fill");
  }
}

export function validatePaneDefaultsConfiguration(
  configuration: PaneDefaultsConfiguration,
): void {
  validatePaneDefaults(configuration.paneDefaults);
  for (const defaults of Object.values(configuration.paneTypeDefaults ?? {})) {
    validatePaneDefaults(defaults);
  }
}

function positiveDimension(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`Pane ${name} must be a positive finite number`);
  }
}

function paneDimension(
  value: PaneDimension | undefined,
  available: number,
): number | undefined {
  return value === "auto"
    ? undefined
    : value === "viewport"
      ? available
      : value;
}

export function constrainPaneDimension(
  value: number,
  minimum: number | undefined,
  maximum: number | undefined,
  available: number,
  floor: number,
): number {
  const upper = Math.max(1, Math.min(available, maximum ?? available));
  const lower = Math.min(upper, minimum ?? floor);
  return Math.min(upper, Math.max(lower, value));
}

export function preferredColumnWidth({
  column,
  fallback,
  paneById,
  configuration,
  availableWidth,
  availableHeight,
}: {
  column: WorkspaceColumn;
  fallback: number;
  paneById: ReadonlyMap<string, WorkspacePane>;
  configuration: PaneDefaultsConfiguration;
  availableWidth: number;
  availableHeight: number;
}): number {
  if (column.widthOverride) return fallback;
  const widths = column.cells.flatMap((cell) => {
    const pane = cell.paneId ? paneById.get(cell.paneId) : undefined;
    if (!pane) return [];
    const defaults = resolvePaneDefaults(pane, configuration);
    const preferred = preferredPaneWidth(
      defaults,
      fallback,
      availableWidth,
      availableHeight,
    );
    if (preferred === undefined) return [];
    if (
      (defaults.height === undefined || defaults.height === "auto") &&
      defaults.aspectRatio !== undefined
    ) {
      return [
        Math.min(
          preferred,
          Math.min(availableHeight, defaults.maxHeight ?? availableHeight) *
            defaults.aspectRatio,
        ),
      ];
    }
    return [preferred];
  });
  return widths.length ? Math.max(...widths) : fallback;
}

function preferredPaneWidth(
  defaults: PaneDefaults,
  fallback: number,
  availableWidth: number,
  availableHeight: number,
): number | undefined {
  const width = paneDimension(defaults.width, availableWidth);
  if (width !== undefined) return width;
  if (defaults.aspectRatio === undefined) return undefined;
  const height = paneDimension(defaults.height, availableHeight);
  return height === undefined ? fallback : height * defaults.aspectRatio;
}

function constrainedSlotWidth(
  width: number,
  panes: readonly WorkspacePane[],
  configuration: PaneDefaultsConfiguration,
  available: number,
): number {
  let minimum = panes.length ? 1 : 96;
  let maximum = available;
  for (const pane of panes) {
    const defaults = resolvePaneDefaults(pane, configuration);
    minimum = Math.max(minimum, defaults.minWidth ?? 96);
    maximum = Math.min(maximum, defaults.maxWidth ?? available);
  }
  return constrainPaneDimension(width, minimum, maximum, available, 96);
}

export function preferredPaneHeight(
  defaults: PaneDefaults,
  columnWidth: number,
  availableHeight: number,
): number | undefined {
  if (defaults.height === "viewport") return undefined;
  return (
    paneDimension(defaults.height, availableHeight) ??
    (defaults.aspectRatio === undefined
      ? undefined
      : columnWidth / defaults.aspectRatio)
  );
}

export function constrainColumnWidths({
  available,
  columns,
  configuration,
  maximizedPaneId = null,
  paneById,
  widths,
}: {
  available: number;
  columns: readonly WorkspaceColumn[];
  configuration: PaneSizingConfiguration;
  maximizedPaneId?: PaneId | null;
  paneById: ReadonlyMap<string, WorkspacePane>;
  widths: Map<number, number>;
}): void {
  const panesBySlot = limitedPanesBySlot(
    columns,
    paneById,
    configuration,
    maximizedPaneId,
  );
  for (const [slot, width] of widths) {
    widths.set(
      slot,
      constrainedSlotWidth(
        width,
        panesBySlot.get(slot) ?? [],
        configuration,
        available,
      ),
    );
  }
}

function limitedPanesBySlot(
  columns: readonly WorkspaceColumn[],
  paneById: ReadonlyMap<string, WorkspacePane>,
  configuration: PaneSizingConfiguration,
  maximizedPaneId: PaneId | null,
): Map<number, WorkspacePane[]> {
  const panesBySlot = new Map<number, WorkspacePane[]>();
  if (configuration.fullPaneSizing) return panesBySlot;
  const maximizedSlots = new Set<number>();
  for (const column of columns) {
    const slot = columnSlotIndex(column);
    const panes = panesBySlot.get(slot) ?? [];
    for (const cell of column.cells) {
      const pane = cell.paneId ? paneById.get(cell.paneId) : undefined;
      if (!pane) continue;
      panes.push(pane);
      if (pane.paneId === maximizedPaneId) maximizedSlots.add(slot);
    }
    panesBySlot.set(slot, panes);
  }
  for (const slot of maximizedSlots) panesBySlot.delete(slot);
  return panesBySlot;
}

export function constrainSplitHeights({
  total,
  upperWeight,
  lowerWeight,
  upper,
  lower,
  availableHeight,
}: {
  total: number;
  upperWeight: number;
  lowerWeight: number;
  upper: PaneDefaults;
  lower: PaneDefaults;
  availableHeight: number;
}): [number, number] {
  const floor = Math.min(96, total / 2);
  const upperMinimum = constrainPaneDimension(
    0,
    upper.minHeight,
    upper.maxHeight,
    availableHeight,
    floor,
  );
  const lowerMinimum = constrainPaneDimension(
    0,
    lower.minHeight,
    lower.maxHeight,
    availableHeight,
    floor,
  );
  const upperMaximum = Math.min(
    availableHeight,
    upper.maxHeight ?? availableHeight,
  );
  const lowerMaximum = Math.min(
    availableHeight,
    lower.maxHeight ?? availableHeight,
  );
  const minimum = Math.max(upperMinimum, total - lowerMaximum);
  const maximum = Math.min(upperMaximum, total - lowerMinimum);
  const height = Math.min(
    maximum,
    Math.max(minimum, (total * upperWeight) / (upperWeight + lowerWeight)),
  );
  return [height, total - height];
}
