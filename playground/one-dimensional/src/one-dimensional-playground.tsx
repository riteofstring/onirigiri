import { playgroundPaneTypeDefaults } from "../../shared/playground-pane-catalog";
import {
  PlaygroundContentControls,
  PlaygroundPane,
  usePlaygroundContent,
} from "../../shared/playground-content";
import { CaptureStatus } from "../../shared/capture-status";
import {
  PlaygroundPresentationControls,
  playgroundRendererChrome,
  usePlaygroundPresentation,
} from "../../shared/playground-presentation";
import {
  OnirigiriWorkspace,
  defaultOnirigiriShortcuts,
  type OnirigiriLayout,
  type OnirigiriPaneDefinition,
  type OnirigiriPaneRenderState,
  type OnirigiriShortcutBindings,
  type OnirigiriWorkspaceHandle,
  type WorkspacePane,
  type WorkspacePresentationMode,
} from "@riteofstring/onirigiri";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { requestForDemo, type DemoKind } from "../../shared/demo-pane";
import {
  clearStoredLayout,
  readStoredLayout,
  writeStoredLayout,
} from "../../shared/persistence";
import { PlaygroundFrame } from "../../shared/playground-frame";
import {
  oneDimensionalWorkspaceLabel,
  oneDimensionalWorkspaceRegionLabel,
  type OneDimensionalConsumerRender,
} from "./one-dimensional-contract";

const storageKey = "onirigiri-playground-one-dimensional-layout-v2";
const paneDefaults = { width: 480, height: "viewport" } as const;

const oneDimensionalShortcuts = {
  splitPlaneDown: [],
  splitPlaneUp: [],
  toggleOverview: [
    ...defaultOnirigiriShortcuts.toggleOverview,
    { altKey: false, ctrlKey: true, key: " ", metaKey: false, shiftKey: true },
  ],
} satisfies OnirigiriShortcutBindings;

export function OneDimensionalPlayground({
  initialPanes: suppliedPanes,
}: { initialPanes?: readonly OnirigiriPaneDefinition[] } = {}) {
  const content = usePlaygroundContent("1d", suppliedPanes);
  const initialPanes = content.panes;
  const workspaceRef = useRef<OnirigiriWorkspaceHandle>(null);
  const rendering = usePlaygroundPresentation();
  const nextDemoIndex = useRef(0);
  const [initialLayout, setInitialLayout] = useState<OnirigiriLayout | null>(
    readOneDimensionalLayout,
  );
  const [layout, setLayout] = useState<OnirigiriLayout | null>(initialLayout);
  const [persistenceAvailable, setPersistenceAvailable] = useState(true);
  const [presentationMode, setPresentationMode] =
    useState<WorkspacePresentationMode>("normal");
  const [workspaceKey, setWorkspaceKey] = useState(0);
  const consumerRendersRef = useRef<OneDimensionalConsumerRender[]>([]);

  useEffect(() => {
    window.__onirigiriOneDimensionalPlayground = {
      consumerRenders: () => [...consumerRendersRef.current],
      focusPane: (paneId) => workspaceRef.current?.focusPane(paneId) ?? false,
      focusedPaneId: () =>
        workspaceRef.current?.getSnapshot().focusedPaneId ?? null,
      resetConsumerRenders: () => {
        consumerRendersRef.current = [
          ...new Map(
            consumerRendersRef.current.map((render) => [render.paneId, render]),
          ).values(),
        ];
      },
    };
    return () => {
      delete window.__onirigiriOneDimensionalPlayground;
    };
  }, []);

  const configureDemoPane = useCallback((paneId: string, kind: DemoKind) => {
    workspaceRef.current?.configurePane(paneId, requestForDemo(kind));
  }, []);

  const renderPane = useCallback(
    (pane: WorkspacePane, state: OnirigiriPaneRenderState) => {
      return (
        <ObservedPlaygroundPane
          renders={consumerRendersRef}
          state={state}
          onExplore={() => workspaceRef.current?.focus("right")}
          onChoose={configureDemoPane}
          pane={pane}
        />
      );
    },
    [configureDemoPane],
  );

  const addWindow = () => {
    const request = content.request(nextDemoIndex.current);
    nextDemoIndex.current += 1;
    workspaceRef.current?.openPane(request);
  };

  const splitFocusedPane = (direction: "down" | "right") => {
    const handle = workspaceRef.current;
    if (!handle) {
      return;
    }
    const paneId = handle.getSnapshot().focusedPaneId;
    if (paneId) {
      handle.splitPane(paneId, direction);
    }
  };

  const restart = () => {
    nextDemoIndex.current = 0;
    setPersistenceAvailable(clearStoredLayout(storageKey));
    setInitialLayout(null);
    setLayout(null);
    setPresentationMode("normal");
    setWorkspaceKey((value) => value + 1);
  };

  const handleLayoutChange = (nextLayout: OnirigiriLayout) => {
    setLayout(nextLayout);
    setPersistenceAvailable(writeStoredLayout(storageKey, nextLayout));
  };

  return (
    <PlaygroundFrame
      actions={
        <>
          <PlaygroundContentControls content={content} onRestart={restart} />
          <PlaygroundPresentationControls
            workspaceRef={workspaceRef}
            rendering={rendering}
          />
          <button
            className="playground-actions__primary"
            onClick={addWindow}
            type="button"
          >
            Add pane
          </button>
        </>
      }
      moreActions={
        <div className="playground-more-actions__controls">
          <button onClick={() => splitFocusedPane("right")} type="button">
            Split right
          </button>
          <button onClick={() => splitFocusedPane("down")} type="button">
            Split down
          </button>
          <button
            className="playground-actions__quiet"
            onClick={() => {
              content.reset();
              restart();
            }}
            type="button"
          >
            Reset workspace
          </button>
        </div>
      }
      model="1d"
      onResizePanes={(mode) => workspaceRef.current?.resizePanes(mode)}
      onToggleOverview={() => workspaceRef.current?.toggleOverview()}
      presentationMode={presentationMode}
      shortcuts={oneDimensionalShortcuts}
      status={
        <>
          <CaptureStatus workspace={workspaceRef} />
          <span>{layout?.panes.length ?? initialPanes.length} windows</span>
          <span aria-hidden="true" className="playground-status__separator" />
          <span>
            {persistenceAvailable
              ? "Layout saved locally"
              : "Local save unavailable"}
          </span>
        </>
      }
      subtitle="one-dimensional package playground"
      title="Onirigiri · 1D"
      workspaceLabel={oneDimensionalWorkspaceLabel}
    >
      {({
        compactBreakpoint,
        compactPanePeek,
        desktopControlsContainer,
        directionControlMode,
        focusAnchor,
      }) => (
        <OnirigiriWorkspace
          chromeComponents={playgroundRendererChrome}
          captureMissingOverviewPictures
          preloadAllPanePictures={content.cacheAll}
          pictureRasterBudgetBytes={content.textureMemoryMiB * 1024 * 1024}
          getPanePresentation={rendering.getPanePresentation}
          liveContent={rendering.liveContent}
          ariaLabel={oneDimensionalWorkspaceRegionLabel}
          className="one-dimensional-workspace"
          compactBreakpoint={compactBreakpoint}
          compactPanePeek={compactPanePeek}
          desktopControlsContainer={desktopControlsContainer}
          directionControlMode={directionControlMode}
          focusAnchor={focusAnchor}
          gridAxes="horizontal"
          initialLayout={initialLayout}
          initialPanes={initialPanes}
          paneTypeDefaults={playgroundPaneTypeDefaults}
          paneDefaults={paneDefaults}
          key={workspaceKey}
          onLayoutChange={handleLayoutChange}
          onPresentationModeChange={setPresentationMode}
          ref={workspaceRef}
          renderPane={renderPane}
          shortcutScope="application"
          shortcuts={oneDimensionalShortcuts}
          showOverviewControl={false}
          workspaceId="onirigiri-playground-one-dimensional"
        />
      )}
    </PlaygroundFrame>
  );
}

function ObservedPlaygroundPane({
  renders,
  ...props
}: Parameters<typeof PlaygroundPane>[0] & {
  renders: { current: OneDimensionalConsumerRender[] };
}) {
  useLayoutEffect(() => {
    renders.current.push({
      paneId: props.pane.paneId,
      state: props.state,
      timeMs: performance.now(),
    });
  });
  return <PlaygroundPane {...props} />;
}

function readOneDimensionalLayout(): OnirigiriLayout | null {
  const query = new URLSearchParams(location.search);
  if (query.has("count") || query.has("content")) return null;
  const storedLayout = readStoredLayout(storageKey);
  return storedLayout?.cursor.row === 0 &&
    storedLayout.columns.every((column) => column.planeIndex === 0)
    ? storedLayout
    : null;
}
