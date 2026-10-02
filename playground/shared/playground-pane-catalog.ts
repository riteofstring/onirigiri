import type {
  OnirigiriPaneDefinition,
  PaneDefaults,
} from "@riteofstring/onirigiri";
import { demoDefinitions, type DemoKind } from "./demo-pane";

export const playgroundPaneTypeDefaults = {
  "lab:video": {
    content: { aspectRatio: 16 / 9, fit: "contain" },
  },
} satisfies Readonly<Record<string, PaneDefaults>>;

export const paneCounts = [5, 10, 50, 100] as const;
export type PaneCount = (typeof paneCounts)[number];
export const paneContentTypes = [
  { kind: "notes", label: "Field notes", group: "Demos" },
  { kind: "lab:dom", label: "DOM document", group: "Lab" },
  { kind: "signals", label: "Signal lab", group: "Demos" },
  { kind: "lab:canvas-2d", label: "Canvas 2D", group: "Lab" },
  { kind: "atlas", label: "Atlas", group: "Demos" },
  { kind: "lab:forms", label: "Forms", group: "Lab" },
  { kind: "tasks", label: "Focus board", group: "Demos" },
  { kind: "lab:react", label: "React", group: "Lab" },
  { kind: "mixer", label: "Field mixer", group: "Demos" },
  { kind: "lab:video", label: "Video", group: "Lab" },
  { kind: "system", label: "System map", group: "Demos" },
  { kind: "lab:webgl-2", label: "WebGL 2", group: "Lab" },
  { kind: "lab:webgpu", label: "WebGPU", group: "Lab" },
  { kind: "lab:xterm-dom", label: "Terminal · DOM", group: "Lab" },
  { kind: "lab:xterm-webgl", label: "Terminal · WebGL", group: "Lab" },
  { kind: "lab:mixed", label: "Combined lab surfaces", group: "Lab" },
  { kind: "lab:three-reactor", label: "Chromatic reactor", group: "Lab" },
  { kind: "lab:three-tidal", label: "Tidal lattice", group: "Lab" },
  { kind: "arcade:prism", label: "Prism Break", group: "Arcade" },
  { kind: "arcade:orbit", label: "Orbit Dash", group: "Arcade" },
] as const;
export type PaneContentType = (typeof paneContentTypes)[number]["kind"];

export function requestForContent(kind: PaneContentType) {
  const definition = paneContentTypes.find((content) => content.kind === kind)!;
  return {
    surfaceKind: kind,
    ...(definition.group === "Demos"
      ? demoDefinitions[kind as DemoKind]
      : {
          title: definition.label,
          subtitle:
            definition.group === "Arcade"
              ? "interactive playground"
              : "browser surface lab",
          tone: "slate" as const,
        }),
  };
}

export function createPlaygroundPanes(
  model: "1d" | "2d",
  count: PaneCount,
  selected: readonly PaneContentType[],
): OnirigiriPaneDefinition[] {
  if (selected.length === 0)
    throw new Error("Choose at least one content type");
  const columns = model === "1d" ? count : Math.ceil(Math.sqrt(count));
  const catalog = paneContentTypes.filter(({ kind }) =>
    selected.includes(kind),
  );
  const welcome = catalog.length === paneContentTypes.length;
  return Array.from({ length: count }, (_, index) => ({
    ...(welcome && index === 0
      ? {
          surfaceKind: "welcome",
          title: "Start here",
          subtitle: "welcome to Onirigiri",
          tone: "green" as const,
        }
      : requestForContent(
          catalog[(index - (welcome ? 1 : 0)) % catalog.length]!.kind,
        )),
    paneId: `pane-${index + 1}`,
    columnId: `column-${index + 1}`,
    planeIndex: Math.floor(index / columns),
    slotIndex: index % columns,
  }));
}

export function fixtureUrl(query: URLSearchParams, kind: string): string {
  const origin = new URL(query.get("fixtureOrigin") ?? window.location.origin)
    .origin;
  const url = new URL(
    query.get("fixturePath") ?? "/surface-lab/fixture.html",
    origin,
  );
  url.searchParams.set("fixture", kind);
  url.searchParams.set("embedding", "surface");
  url.searchParams.set("cooperative", "");
  return url.href;
}
