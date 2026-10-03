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
  defaultWorkspaceCameraModes,
  OnirigiriWorkspace,
  type OnirigiriLayout,
  type OnirigiriLayoutChangeMetadata,
  type OnirigiriCameraMotion,
  type OnirigiriFocusHighlightOptions,
  type OnirigiriMinimapPlacement,
  type OnirigiriPaneDefinition,
  type OnirigiriPaneRenderState,
  type OnirigiriWorkspaceHandle,
  type WorkspaceColumn,
  type WorkspaceCameraModes,
  type WorkspacePresentationMode,
  type WorkspacePane,
} from "@riteofstring/onirigiri";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";

import { requestForDemo, type DemoKind } from "../../shared/demo-pane";
import { PlaygroundFrame } from "../../shared/playground-frame";
import {
  adjacentHistoryLayout,
  emptyLayoutHistory,
  initializeLayoutHistory,
  recordLayoutHistory,
} from "./layout-history";
import { usePlaygroundMenu } from "../../shared/playground-menu";

const paneDefaults = { width: 480, height: 600 } as const;

export function TwoDimensionalPlayground({
  initialPanes: suppliedPanes,
}: { initialPanes?: readonly OnirigiriPaneDefinition[] } = {}) {
  const content = usePlaygroundContent("2d", suppliedPanes);
  const initialPanes = content.panes;
  const workspaceRef = useRef<OnirigiriWorkspaceHandle>(null);
  const rendering = usePlaygroundPresentation();
  const nextDemoIndex = useRef(0);
  const historyRef = useRef(emptyLayoutHistory());
  const [layout, setLayout] = useState<OnirigiriLayout | null>(null);
  const [, setHistoryVersion] = useState(0);
  const [presentationMode, setPresentationMode] =
    useState<WorkspacePresentationMode>("normal");
  const [cameraModes, setCameraModes] = useState<WorkspaceCameraModes>(() => ({
    ...defaultWorkspaceCameraModes,
  }));
  const [cursorRunway, setCursorRunway] = useState<number | undefined>();
  const [showMinimap, setShowMinimap] = useState(false);
  const [motion, setMotion] = useState<PlaygroundMotion>({
    camera: "follow",
    highlight: "camera",
  });
  const [minimapPlacement, setMinimapPlacement] =
    useState<OnirigiriMinimapPlacement>();
  const [workspaceKey, setWorkspaceKey] = useState(0);
  const [workflowStatus, setWorkflowStatus] = useState("");
  const history = historyRef.current;
  const canUndo = history.index > 0;
  const canRedo =
    history.index >= 0 && history.index < history.entries.length - 1;
  const telemetry = telemetryFor(layout);
  const splitFocusedPaneToPlane = (direction: "up" | "down") => {
    withWorkspaceHandle(workspaceRef, (handle) => {
      const paneId = handle.getSnapshot().focusedPaneId;
      if (paneId) {
        handle.splitPaneToPlane(paneId, direction);
      }
    });
  };

  const addRight = () => {
    withWorkspaceHandle(workspaceRef, (handle) => {
      const paneId = handle.getSnapshot().focusedPaneId;
      if (!paneId) {
        return;
      }
      const request = content.request(nextDemoIndex.current);
      nextDemoIndex.current += 1;
      handle.openPaneNear(paneId, "right", request);
    });
  };

  const restartWorkspace = (status: string) => {
    nextDemoIndex.current = 0;
    historyRef.current = emptyLayoutHistory();
    setLayout(null);
    setHistoryVersion((version) => version + 1);
    setPresentationMode("normal");
    setWorkflowStatus(status);
    setWorkspaceKey((value) => value + 1);
  };

  const reset = () => {
    content.reset();
    restartWorkspace("Workspace reset.");
  };

  const applyCursorRunway = (nextCursorRunway: number | undefined) => {
    setCursorRunway(nextCursorRunway);
    setWorkflowStatus(
      nextCursorRunway === undefined
        ? "Cursor navigation is unbounded."
        : `Cursor runway set to ${String(nextCursorRunway)} cells beyond the pane edges.`,
    );
  };

  const returnHome = () => {
    withWorkspaceHandle(workspaceRef, (handle) => {
      setWorkflowStatus(
        handle.returnHome()
          ? "Returned to workspace home."
          : "Workspace home is unavailable.",
      );
    });
  };

  const handleLayoutChange = useCallback(
    (nextLayout: OnirigiriLayout, metadata: OnirigiriLayoutChangeMetadata) => {
      setLayout(nextLayout);
      const changed =
        metadata.kind === "initial"
          ? initializeLayoutHistory(historyRef.current, nextLayout)
          : metadata.kind === "user" &&
            recordLayoutHistory(
              historyRef.current,
              nextLayout,
              metadata.mutationId,
            );
      if (changed) {
        setHistoryVersion((version) => version + 1);
      }
    },
    [],
  );

  const configureDemoPane = useCallback((paneId: string, kind: DemoKind) => {
    withWorkspaceHandle(workspaceRef, (handle) =>
      handle.configurePane(paneId, requestForDemo(kind)),
    );
  }, []);

  const renderPane = useCallback(
    (pane: WorkspacePane, state: OnirigiriPaneRenderState) => (
      <PlaygroundPane
        state={state}
        onExplore={() => workspaceRef.current?.focus("right")}
        onChoose={configureDemoPane}
        pane={pane}
      />
    ),
    [configureDemoPane],
  );

  const restoreHistory = useCallback((direction: "redo" | "undo") => {
    const handle = workspaceRef.current;
    if (!handle) {
      return;
    }
    const nextLayout = adjacentHistoryLayout(historyRef.current, direction);
    if (!nextLayout) {
      return;
    }
    handle.restoreLayout(nextLayout);
    setHistoryVersion((version) => version + 1);
    setWorkflowStatus(
      direction === "undo" ? "Undid layout change." : "Redid layout change.",
    );
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const direction = historyShortcutDirection(event);
      if (!direction || !historyShortcutCanHandle(event.target)) {
        return;
      }
      const handle = workspaceRef.current;
      if (!handle) {
        return;
      }
      const nextLayout = adjacentHistoryLayout(historyRef.current, direction);
      if (!nextLayout) {
        return;
      }
      event.preventDefault();
      handle.restoreLayout(nextLayout);
      setHistoryVersion((version) => version + 1);
      setWorkflowStatus(
        direction === "undo" ? "Undid layout change." : "Redid layout change.",
      );
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const insertPaneAsSplit = (direction: "left" | "right") => {
    withWorkspaceHandle(workspaceRef, (handle) => {
      const inserted = handle.insertPaneAsSplit(direction);
      setWorkflowStatus(
        inserted
          ? `Inserted the focused pane as a ${direction} split.`
          : "The adjacent column is not a full-height occupied pane.",
      );
    });
  };

  const createReservedBlankSplit = (direction: "up" | "down") => {
    withWorkspaceHandle(workspaceRef, (handle) => {
      const created = handle.createReservedBlankSplit(direction);
      setWorkflowStatus(
        created
          ? `Created a reserved blank split ${direction}.`
          : "No focused pane can create a blank split.",
      );
    });
  };

  const removeReservedBlankSplit = (direction: "up" | "down") => {
    withWorkspaceHandle(workspaceRef, (handle) => {
      const removed = handle.removeReservedBlankSplit(direction);
      setWorkflowStatus(
        removed
          ? `Removed the reserved blank split ${direction}.`
          : "No reserved blank split exists there.",
      );
    });
  };

  return (
    <PlaygroundFrame
      actions={
        <>
          <PlaygroundContentControls
            content={content}
            onRestart={() => restartWorkspace("Workspace restarted.")}
          />
          <PlaygroundPresentationControls
            workspaceRef={workspaceRef}
            rendering={rendering}
          />
          <PlaygroundPrimaryActions
            addRight={addRight}
            createReservedBlankSplit={createReservedBlankSplit}
            canRedo={canRedo}
            canUndo={canUndo}
            redo={() => restoreHistory("redo")}
            splitFocusedPaneToPlane={splitFocusedPaneToPlane}
            undo={() => restoreHistory("undo")}
          />
        </>
      }
      moreActions={
        <PlaygroundArrangeActions
          cursorRunway={cursorRunway}
          insertPaneAsSplit={insertPaneAsSplit}
          layout={layout}
          onCursorRunwayChange={applyCursorRunway}
          motion={motion}
          onMotionChange={setMotion}
          onShowMinimapChange={setShowMinimap}
          removeReservedBlankSplit={removeReservedBlankSplit}
          reset={reset}
          showMinimap={showMinimap}
        />
      }
      model="2d"
      onCameraModesChange={setCameraModes}
      onResizePanes={(mode) =>
        withWorkspaceHandle(workspaceRef, (handle) => handle.resizePanes(mode))
      }
      onReturnHome={returnHome}
      onToggleOverview={() =>
        withWorkspaceHandle(workspaceRef, (handle) => handle.toggleOverview())
      }
      cameraModes={cameraModes}
      presentationMode={presentationMode}
      status={
        <>
          <CaptureStatus workspace={workspaceRef} />
          <PlaygroundStatus
            initialPaneCount={initialPanes.length}
            layout={layout}
            telemetry={telemetry}
            workflowStatus={workflowStatus}
          />
        </>
      }
      subtitle="two-dimensional package playground"
      title="Onirigiri · 2D"
      workspaceLabel="Two-dimensional Onirigiri package demonstration"
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
          ariaLabel="Interactive two-dimensional Onirigiri playground"
          compactBreakpoint={compactBreakpoint}
          compactPanePeek={compactPanePeek}
          cursorRunway={cursorRunway}
          desktopControlsContainer={desktopControlsContainer}
          directionControlMode={directionControlMode}
          focusAnchor={focusAnchor}
          initialPanes={initialPanes}
          paneDefaults={paneDefaults}
          paneTypeDefaults={playgroundPaneTypeDefaults}
          key={workspaceKey}
          minimapPlacement={minimapPlacement}
          onLayoutChange={handleLayoutChange}
          onMinimapPlacementChange={setMinimapPlacement}
          onPresentationModeChange={setPresentationMode}
          cameraModes={cameraModes}
          ref={workspaceRef}
          captureMissingOverviewPictures
          preloadAllPanePictures={content.cacheAll}
          pictureRasterBudgetBytes={content.textureMemoryMiB * 1024 * 1024}
          getPanePresentation={rendering.getPanePresentation}
          liveContent={rendering.liveContent}
          renderPane={renderPane}
          shortcutScope="application"
          cameraMotion={cameraMotionPresets[motion.camera]}
          focusHighlight={focusHighlightPresets[motion.highlight]}
          showMinimap={showMinimap}
          showOverviewControl={false}
          workspaceId="onirigiri-playground-two-dimensional"
        />
      )}
    </PlaygroundFrame>
  );
}

function PlaygroundPrimaryActions({
  addRight,
  canRedo,
  canUndo,
  createReservedBlankSplit,
  redo,
  splitFocusedPaneToPlane,
  undo,
}: {
  addRight: () => void;
  canRedo: boolean;
  canUndo: boolean;
  createReservedBlankSplit: (direction: "up" | "down") => void;
  redo: () => void;
  splitFocusedPaneToPlane: (direction: "up" | "down") => void;
  undo: () => void;
}) {
  const { menuProps } = usePlaygroundMenu();
  return (
    <>
      <details className="playground-add-menu" {...menuProps}>
        <summary>
          <AddIcon />
          <span>Add</span>
        </summary>
        <div className="playground-add-menu__panel">
          <button onClick={addRight} type="button">
            Pane right
          </button>
          <button onClick={() => splitFocusedPaneToPlane("up")} type="button">
            Plane above
          </button>
          <button onClick={() => splitFocusedPaneToPlane("down")} type="button">
            Plane below
          </button>
          <button onClick={() => createReservedBlankSplit("up")} type="button">
            Blank above
          </button>
          <button
            onClick={() => createReservedBlankSplit("down")}
            type="button"
          >
            Blank below
          </button>
        </div>
      </details>
      <button
        aria-keyshortcuts="Control+Z Meta+Z"
        aria-label="Undo layout"
        disabled={!canUndo}
        onClick={undo}
        title="Undo layout"
        type="button"
      >
        <HistoryIcon direction="undo" />
      </button>
      <button
        aria-keyshortcuts="Control+Shift+Z Meta+Shift+Z"
        aria-label="Redo layout"
        disabled={!canRedo}
        onClick={redo}
        title="Redo layout"
        type="button"
      >
        <HistoryIcon direction="redo" />
      </button>
    </>
  );
}

function PlaygroundArrangeActions({
  cursorRunway,
  insertPaneAsSplit,
  layout,
  onCursorRunwayChange,
  motion,
  onMotionChange,
  onShowMinimapChange,
  removeReservedBlankSplit,
  reset,
  showMinimap,
}: {
  cursorRunway: number | undefined;
  insertPaneAsSplit: (direction: "left" | "right") => void;
  layout: OnirigiriLayout | null;
  onCursorRunwayChange: (cursorRunway: number | undefined) => void;
  motion: PlaygroundMotion;
  onMotionChange: (motion: PlaygroundMotion) => void;
  onShowMinimapChange: (showMinimap: boolean) => void;
  removeReservedBlankSplit: (direction: "up" | "down") => void;
  reset: () => void;
  showMinimap: boolean;
}) {
  return (
    <div className="playground-more-actions__controls">
      <button
        disabled={!canInsertAsSplit(layout, "left")}
        onClick={() => insertPaneAsSplit("left")}
        type="button"
      >
        Insert split left
      </button>
      <button
        disabled={!canInsertAsSplit(layout, "right")}
        onClick={() => insertPaneAsSplit("right")}
        type="button"
      >
        Insert split right
      </button>
      <button
        disabled={!hasReservedBlankSplit(layout, "up")}
        onClick={() => removeReservedBlankSplit("up")}
        type="button"
      >
        Remove blank above
      </button>
      <button
        disabled={!hasReservedBlankSplit(layout, "down")}
        onClick={() => removeReservedBlankSplit("down")}
        type="button"
      >
        Remove blank below
      </button>
      <CursorRunwayControl
        cursorRunway={cursorRunway}
        onApply={onCursorRunwayChange}
      />
      <button
        aria-pressed={showMinimap}
        onClick={() => onShowMinimapChange(!showMinimap)}
        type="button"
      >
        Minimap
      </button>
      <label>
        <span>Camera motion</span>
        <select
          onChange={(event) =>
            onMotionChange({
              ...motion,
              camera: event.target.value as PlaygroundCameraPreset,
            })
          }
          value={motion.camera}
        >
          <option value="follow">Follow (default)</option>
          <option value="ease-out">Ease out, 115 ms</option>
          <option value="smooth">Ease in-out, 320 ms</option>
        </select>
      </label>
      <label>
        <span>Focus highlight</span>
        <select
          onChange={(event) =>
            onMotionChange({
              ...motion,
              highlight: event.target.value as PlaygroundHighlightPreset,
            })
          }
          value={motion.highlight}
        >
          <option value="camera">Moves with camera (default)</option>
          <option value="independent">Independent, 115 ms</option>
          <option value="off">Off</option>
        </select>
      </label>
      <button
        className="playground-actions__quiet"
        onClick={reset}
        type="button"
      >
        Reset workspace
      </button>
    </div>
  );
}

function CursorRunwayControl({
  cursorRunway,
  onApply,
}: {
  cursorRunway: number | undefined;
  onApply: (cursorRunway: number | undefined) => void;
}) {
  const [draft, setDraft] = useState(
    cursorRunway === undefined ? "" : String(cursorRunway),
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(cursorRunway === undefined ? "" : String(cursorRunway));
    setError(null);
  }, [cursorRunway]);

  const apply = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const next = cursorRunwayFromDraft(draft);
    if (next === null) {
      setError("Use a whole number of zero or more, or leave this blank.");
      return;
    }
    setError(null);
    onApply(next);
  };

  return (
    <details className="cursor-runway-control">
      <summary>
        <span className="cursor-runway-control__summary-label">
          Cursor runway
        </span>
        <span className="cursor-runway-control__summary-value">
          {cursorRunway === undefined
            ? "Unbounded"
            : `${String(cursorRunway)} cells`}
        </span>
      </summary>
      <form className="cursor-runway-control__form" noValidate onSubmit={apply}>
        <p className="cursor-runway-control__description">
          Limit empty-cell navigation beyond the current pane edges. Leave blank
          for unbounded navigation.
        </p>
        <label className="cursor-runway-control__field">
          <span>Cells beyond each edge</span>
          <input
            aria-describedby={error ? "cursor-runway-control-error" : undefined}
            aria-invalid={error ? true : undefined}
            inputMode="numeric"
            max={Number.MAX_SAFE_INTEGER}
            min={0}
            name="cursorRunway"
            onChange={(event) => setDraft(event.currentTarget.value)}
            placeholder="Unbounded"
            step={1}
            type="number"
            value={draft}
          />
        </label>
        <div className="cursor-runway-control__actions">
          <p
            aria-live="polite"
            className="cursor-runway-control__error"
            id="cursor-runway-control-error"
          >
            {error}
          </p>
          <button type="submit">Apply runway</button>
        </div>
      </form>
    </details>
  );
}

function AddIcon() {
  return (
    <svg aria-hidden="true" fill="none" focusable="false" viewBox="0 0 20 20">
      <path d="M10 4v12M4 10h12" />
    </svg>
  );
}

function HistoryIcon({ direction }: { direction: "redo" | "undo" }) {
  return (
    <svg aria-hidden="true" fill="none" focusable="false" viewBox="0 0 20 20">
      <path
        d={
          direction === "undo"
            ? "M7 6 3.5 9.5 7 13M4 9.5h7a5 5 0 0 1 5 5"
            : "m13 6 3.5 3.5L13 13m3-3.5H9a5 5 0 0 0-5 5"
        }
      />
    </svg>
  );
}

function focusedColumn(layout: OnirigiriLayout | null): WorkspaceColumn | null {
  return (
    layout?.columns.find(
      (column) =>
        column.planeIndex === layout.cursor.row &&
        (column.slotIndex ?? column.index) === layout.cursor.column,
    ) ?? null
  );
}

function canInsertAsSplit(
  layout: OnirigiriLayout | null,
  direction: "left" | "right",
): boolean {
  const source = focusedColumn(layout);
  if (!source) {
    return false;
  }
  const sourceSlot = source.slotIndex ?? source.index;
  const target = layout?.columns.find(
    (column) =>
      column.planeIndex === source.planeIndex &&
      (column.slotIndex ?? column.index) ===
        sourceSlot + (direction === "left" ? -1 : 1),
  );
  const targetCell = target?.cells[0];
  return Boolean(
    target &&
    target.cells.length === 1 &&
    targetCell?.paneId &&
    !targetCell.reserved,
  );
}

function hasReservedBlankSplit(
  layout: OnirigiriLayout | null,
  direction: "up" | "down",
): boolean {
  const column = focusedColumn(layout);
  if (!column || !layout) {
    return false;
  }
  const focusedRowIndex = layout.cursor.split;
  const targetCell =
    column.cells[focusedRowIndex + (direction === "up" ? -1 : 1)];
  return targetCell?.reserved === true && targetCell.paneId === null;
}

function cursorRunwayFromDraft(value: string): number | null | undefined {
  if (value.trim() === "") {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function PlaygroundStatus({
  initialPaneCount,
  layout,
  telemetry,
  workflowStatus,
}: {
  initialPaneCount: number;
  layout: OnirigiriLayout | null;
  telemetry: WorkspaceTelemetry | null;
  workflowStatus: string;
}) {
  return (
    <>
      <span>{layout?.panes.length ?? initialPaneCount} windows</span>
      <span aria-hidden="true" className="playground-status__separator" />
      <span className="telemetry-value">
        P{telemetry?.plane ?? 1} · S{telemetry?.slot ?? 1} · R
        {telemetry?.row ?? 1}
      </span>
      <span
        aria-live="polite"
        className="playground-status__workflow"
        role="status"
      >
        {workflowStatus}
      </span>
    </>
  );
}

interface WorkspaceTelemetry {
  plane: number;
  planeCount: number;
  row: number;
  slot: number;
}

function withWorkspaceHandle(
  workspaceRef: { readonly current: OnirigiriWorkspaceHandle | null },
  action: (handle: OnirigiriWorkspaceHandle) => void,
): void {
  const handle = workspaceRef.current;
  if (handle) {
    action(handle);
  }
}

function telemetryFor(
  layout: OnirigiriLayout | null,
): WorkspaceTelemetry | null {
  if (!layout) {
    return null;
  }
  return {
    plane: layout.cursor.row + 1,
    planeCount: new Set(layout.columns.map((candidate) => candidate.planeIndex))
      .size,
    row: layout.cursor.split + 1,
    slot: layout.cursor.column + 1,
  };
}

function historyShortcutDirection(
  event: KeyboardEvent,
): "redo" | "undo" | null {
  if (
    event.defaultPrevented ||
    event.altKey ||
    (!event.ctrlKey && !event.metaKey) ||
    event.key.toLowerCase() !== "z"
  ) {
    return null;
  }
  return event.shiftKey ? "redo" : "undo";
}

function historyShortcutCanHandle(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) {
    return true;
  }
  return !target.closest(
    "input, textarea, select, [contenteditable='true'], [role='dialog']",
  );
}

type PlaygroundCameraPreset = "ease-out" | "follow" | "smooth";
type PlaygroundHighlightPreset = "camera" | "independent" | "off";

interface PlaygroundMotion {
  camera: PlaygroundCameraPreset;
  highlight: PlaygroundHighlightPreset;
}

const easeInOutCubic = (progress: number) =>
  progress < 0.5
    ? 4 * progress * progress * progress
    : 1 - (-2 * progress + 2) ** 3 / 2;

const cameraMotionPresets: Record<
  PlaygroundCameraPreset,
  OnirigiriCameraMotion | undefined
> = {
  "ease-out": { navigation: { durationMs: 115 } },
  follow: undefined,
  smooth: {
    navigation: { durationMs: 320, easing: easeInOutCubic },
    overview: { durationMs: 320, easing: easeInOutCubic },
  },
};

const focusHighlightPresets: Record<
  PlaygroundHighlightPreset,
  boolean | OnirigiriFocusHighlightOptions
> = {
  camera: true,
  independent: { motion: { durationMs: 115 } },
  off: false,
};
