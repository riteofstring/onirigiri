import { validatePaneDefaults } from "./pane-defaults";
import type { OpenPaneRequest, PaneDefaults, WorkspacePane } from "../types";

interface WorkspacePaneSurface {
  defaults?: PaneDefaults;
  data?: unknown;
  surfaceKind: string;
}

export function paneSurfaceForRequest(
  request: OpenPaneRequest,
  existing?: WorkspacePane,
): WorkspacePaneSurface {
  validatePaneDefaults(request.defaults);
  const surfaceKind =
    request.surfaceKind ?? existing?.surfaceKind ?? "empty-frame";
  const data = request.data === undefined ? existing?.data : request.data;
  const defaults = request.defaults ?? existing?.defaults;
  return {
    ...(data === undefined ? {} : { data }),
    defaults,
    surfaceKind,
  };
}

export function normalizedPaneWeight(value: number): number {
  return Number.isFinite(value) ? Math.max(0.1, value) : 1;
}

export function normalizedPaneHeightPx(
  value: number | null | undefined,
): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  return Number.isFinite(value) ? Math.max(96, Math.round(value)) : null;
}
