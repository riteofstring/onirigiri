import type { OnirigiriPaneDefinition } from "@riteofstring/onirigiri";

import type { PerformanceScenarioId } from "./performance-types";

type PerformanceWorkflow =
  | "asymmetric"
  | "navigation"
  | "overview"
  | "continuous-navigation"
  | "background";

export interface PerformanceScenarioDefinition {
  id: PerformanceScenarioId;
  iterations: number;
  label: string;
  liveContent?: boolean;
  panes: readonly OnirigiriPaneDefinition[];
  workflow: PerformanceWorkflow;
}

const scenarios: Readonly<
  Record<PerformanceScenarioId, PerformanceScenarioDefinition>
> = {
  "live-navigation-100": {
    id: "live-navigation-100",
    iterations: 3,
    label: "100 retained mixed panes with live animation during navigation",
    liveContent: true,
    panes: linearPanes("live", 100, "performance-live").map((pane, index) => ({
      ...pane,
      surfaceKind: index % 2 ? "performance-live-dom" : "performance-live",
    })),
    workflow: "continuous-navigation",
  },
  "live-overview-100": {
    id: "live-overview-100",
    iterations: 3,
    label: "100 retained mixed panes with live animation through overview",
    liveContent: true,
    panes: linearPanes("live", 100, "performance-live").map((pane, index) => ({
      ...pane,
      surfaceKind: index % 2 ? "performance-live-dom" : "performance-live",
    })),
    workflow: "overview",
  },
  "background-cache-100": {
    id: "background-cache-100",
    iterations: 1,
    label: "100 cold mixed panes progressively captured outside the viewport",
    panes: linearPanes("background", 100, "performance-capturable"),
    workflow: "background",
  },
  "asymmetric-48": {
    id: "asymmetric-48",
    iterations: 3,
    label: "48 panes across asymmetric rows and planes",
    panes: asymmetricPanes(),
    workflow: "asymmetric",
  },
  "mixed-content-36": {
    id: "mixed-content-36",
    iterations: 3,
    label:
      "36 heavy mixed form, scroll, and canvas panes under continuous focus navigation",
    panes: linearPanes("mixed", 36, "performance-mixed"),
    workflow: "continuous-navigation",
  },
  "navigation-50": {
    id: "navigation-50",
    iterations: 4,
    label: "50-pane normal navigation",
    panes: linearPanes("navigation", 50),
    workflow: "navigation",
  },
  "overview-100": {
    id: "overview-100",
    iterations: 3,
    label: "100-pane overview enter, navigate, and exit",
    panes: linearPanes("overview", 100),
    workflow: "overview",
  },
  "overview-500": {
    id: "overview-500",
    iterations: 2,
    label: "500-pane overview enter, navigate, and exit",
    panes: linearPanes("overview-stress", 500),
    workflow: "overview",
  },
};

export function performanceScenario(
  id: PerformanceScenarioId,
): PerformanceScenarioDefinition {
  return scenarios[id];
}

function linearPanes(
  prefix: string,
  count: number,
  surfaceKind:
    | "performance-dom"
    | "performance-mixed"
    | "performance-capturable"
    | "performance-live" = "performance-dom",
): OnirigiriPaneDefinition[] {
  return Array.from({ length: count }, (_, index) => ({
    columnId: `${prefix}-column-${index}`,
    columnWidth: { unit: "px", value: 360 + (index % 4) * 36 },
    paneId: `${prefix}-pane-${index}`,
    planeIndex: 0,
    slotIndex: index,
    subtitle: `Sample ${index.toString().padStart(3, "0")}`,
    surfaceKind,
    title: `${prefix} pane ${index + 1}`,
    tone: paneTone(index),
  }));
}

function asymmetricPanes(): OnirigiriPaneDefinition[] {
  const panes: OnirigiriPaneDefinition[] = [];
  let paneIndex = 0;
  for (let planeIndex = 0; planeIndex < 3; planeIndex += 1) {
    for (let slotIndex = 0; slotIndex < 8; slotIndex += 1) {
      for (let rowIndex = 0; rowIndex < 2; rowIndex += 1) {
        panes.push({
          columnId: `asymmetric-${planeIndex}-${slotIndex}`,
          columnWidth: {
            unit: "px",
            value: 320 + ((planeIndex + slotIndex) % 4) * 70,
          },
          paneId: `asymmetric-pane-${paneIndex}`,
          planeIndex,
          slotIndex,
          subtitle: `Plane ${planeIndex + 1}, row ${rowIndex + 1}`,
          surfaceKind: "performance-dom",
          title: `Asymmetric pane ${paneIndex + 1}`,
          tone: paneTone(paneIndex),
          weight: 0.8 + ((planeIndex + slotIndex + rowIndex) % 3) * 0.2,
        });
        paneIndex += 1;
      }
    }
  }
  return panes;
}

function paneTone(
  index: number,
): "cyan" | "green" | "orange" | "pink" | "slate" {
  const tones = ["cyan", "green", "orange", "pink", "slate"] as const;
  return tones[index % tones.length] ?? "slate";
}
