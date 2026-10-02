import { createRef, StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { OnirigiriWorkspace } from "../../src/workspace/OnirigiriWorkspace";
import type { OnirigiriWorkspaceHandle } from "../../src/workspace/onirigiri-workspace-types";
import type {
  PaneLiveRenderer,
  PanePresentation,
} from "../../src/presentation/pane-presentation-policy";
import { CooperativeFixtureFrame } from "./cooperative-fixture-frame";

export interface NativeMotionFixture {
  handle: { current: OnirigiriWorkspaceHandle | null };
  step(): void;
  supplyPicture(paneId: string, src: string): Promise<void>;
  supplyPictures(
    sources: readonly (readonly [string, string])[],
  ): Promise<void>;
  setPictureBudget(bytes: number): void;
  setMotionRenderer(paneId: string, renderer: PaneLiveRenderer): void;
  setLiveContent(enabled: boolean): void;
  setPresentation(paneId: string, presentation: PanePresentation): void;
  activations: { id: string; time: number }[];
  renders: Record<string, number>;
}

const handle = createRef<OnirigiriWorkspaceHandle>();
const parameters = new URLSearchParams(location.search);
const dense = parameters.has("dense");
const grid = parameters.has("grid");
const cooperative = parameters.has("cooperative");
const overviewWidth = parameters.get("overviewWidth");
const overviewCamera =
  overviewWidth === null
    ? {}
    : {
        cameraModes: { normal: "follow", overview: "fixed" } as const,
        overviewCardMaxWidthPx: Number(overviewWidth),
      };
const picturesEnabled = parameters.has("pictures");
const pictures = new Map<string, Blob>();
const motionRenderers = new Map<string, PaneLiveRenderer>();
const presentations = new Map<string, PanePresentation>();
const fixtureFrameUrl = new URL("./native-content-frame.html", import.meta.url);
if (cooperative) fixtureFrameUrl.searchParams.set("cooperative", "");
const fixture: NativeMotionFixture = {
  handle,
  activations: [],
  renders: {},
  async supplyPicture(paneId, src) {
    await fixture.supplyPictures([[paneId, src]]);
  },
  async supplyPictures(sources) {
    for (const [id, src] of sources)
      pictures.set(id, await (await fetch(src)).blob());
    render();
  },
  setPictureBudget(bytes) {
    parameters.set("budget", String(bytes));
    render();
  },
  setLiveContent(enabled) {
    if (enabled) parameters.set("liveContent", "");
    else parameters.delete("liveContent");
    render();
  },
  setPresentation(paneId, presentation) {
    presentations.set(paneId, presentation);
    render();
  },
  setMotionRenderer(paneId, renderer) {
    motionRenderers.set(paneId, renderer);
    render();
  },
  step() {
    throw new Error("Native test clock is not held");
  },
};
(
  window as Window & { __nativeMotionFixture: NativeMotionFixture }
).__nativeMotionFixture = fixture;

function initialPanes() {
  const count = Number(parameters.get("count") ?? (dense ? 128 : 12));
  return Array.from({ length: count }, (_, index) => ({
    paneId: `pane-${index + 1}`,
    columnId: `column-${dense ? Math.floor(index / 8) : index}`,
    slotIndex: grid ? index % 10 : dense ? Math.floor(index / 8) : index,
    planeIndex: grid ? Math.floor(index / 10) : undefined,
    columnWidth: { unit: "px" as const, value: grid ? 480 : 520 },
    heightPx: grid ? 600 : dense ? 400 : undefined,
    title: `Native ${index + 1}`,
    surfaceKind: "test",
  }));
}

const root = createRoot(document.querySelector("#root")!);
function render() {
  root.render(
    <StrictMode>
      <OnirigiriWorkspace
        {...overviewCamera}
        liveContent={parameters.has("liveContent")}
        captureMissingOverviewPictures={parameters.has("overviewPictures")}
        preloadAllPanePictures={parameters.has("allPictures")}
        getPanePresentation={
          parameters.has("liveContent") || parameters.has("policy")
            ? (pane, context) =>
                presentations.get(pane.paneId) ??
                (parameters.has("auto")
                  ? "auto"
                  : context.phase === "rest" || context.phase === "overview"
                    ? "dom"
                    : (motionRenderers.get(pane.paneId) ?? "canvas"))
            : undefined
        }
        ref={handle}
        focusAnchor="center"
        preloadMarginPanes={Number(parameters.get("preloadMargin") ?? 1)}
        pictureBudgetBytes={Number(
          parameters.get("budget") ?? 256 * 1024 * 1024,
        )}
        pictureRasterBudgetBytes={Number(
          parameters.get("rasterBudget") ?? 256 * 1024 * 1024,
        )}
        getPanePicture={
          picturesEnabled
            ? (pane) => {
                const image = pictures.get(pane.paneId);
                return image ? { image } : null;
              }
            : undefined
        }
        retainedAreaBudgetViewports={picturesEnabled ? 0 : 8}
        initialPanes={initialPanes()}
        renderPanePlaceholder={
          parameters.has("customPlaceholder")
            ? (pane, state) => (
                <button
                  data-fixture-placeholder={state.variant}
                  onClick={() => fixture.setPresentation(pane.paneId, "dom")}
                >
                  {pane.title}: {state.variant}
                </button>
              )
            : undefined
        }
        renderPane={(pane, state) => {
          fixture.renders[pane.paneId] =
            (fixture.renders[pane.paneId] ?? 0) + 1;
          if (state.runtimeState === "live")
            fixture.activations.push({
              id: pane.paneId,
              time: performance.now(),
            });
          return cooperative ? (
            <CooperativeFixtureFrame
              protocol="onirigiri-native-test/v1"
              runtime={state.runtimeState}
              src={fixtureFrameUrl.href}
              title={pane.title}
            />
          ) : (
            <iframe
              data-consumer-state={state.runtimeState}
              title={pane.title}
              style={{
                width: "100%",
                height: "100%",
                border: 0,
                display: "block",
              }}
              src={dense ? fixtureFrameUrl.href : undefined}
              srcDoc={
                dense
                  ? undefined
                  : '<!doctype html><html style="background:#083b4b;color:#f4cf60;font:24px sans-serif"><body><h1>Retained native frame</h1><input aria-label="Retained value" value="Keep my state"><p>Real browser content</p></body></html>'
              }
            />
          );
        }}
      />
    </StrictMode>,
  );
}
render();
