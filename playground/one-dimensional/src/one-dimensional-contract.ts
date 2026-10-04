import type { OnirigiriPaneRenderState } from "@riteofstring/onirigiri";

export const oneDimensionalWorkspaceLabel =
  "One-dimensional Onirigiri package demonstration";

export const oneDimensionalWorkspaceRegionLabel =
  "Interactive one-dimensional Onirigiri playground";

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
