import type { OnirigiriPaneRenderState } from "../../src/index";

export const oneDimensionalWorkspaceRegionLabel =
  "Interactive one-dimensional Onirigiri playground";

export const oneDimensionalPaneOrder = [
  "signals",
  "tasks",
  "notes",
  "atlas",
  "system",
] as const;

export type OneDimensionalPaneId = (typeof oneDimensionalPaneOrder)[number];

export interface OneDimensionalConsumerRender {
  paneId: string;
  state: OnirigiriPaneRenderState;
  timeMs: number;
}

interface OneDimensionalPlaygroundProbe {
  consumerRenders(): readonly OneDimensionalConsumerRender[];
  focusPane(paneId: string): boolean;
  focusedPaneId(): string | null;
  resetConsumerRenders(): void;
}

declare global {
  interface Window {
    __onirigiriOneDimensionalPlayground?: OneDimensionalPlaygroundProbe;
  }
}
