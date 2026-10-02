import {
  OnirigiriWorkspace,
  type OnirigiriPaneRenderState,
  type OnirigiriWorkspaceHandle,
  type WorkspacePane,
  type WorkspaceLayoutSnapshot,
} from "@riteofstring/onirigiri";
import {
  Profiler,
  type ProfilerOnRenderCallback,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import {
  measureOnirigiriRequestWork,
  recordReactBoundaryWork,
  startPerformanceWorkRecording,
  stopPerformanceWorkRecording,
} from "./performance-frame-work";
import {
  BrowserPerformanceSampler,
  sampleObservedRefreshInterval,
  summarizeDurations,
  waitForDisplayFrames,
} from "./performance-sampler";
import {
  minimumMovingVisiblePanes,
  performanceSamples,
} from "./performance-sample-selection";
import {
  PerformanceDiagnosticTraceSampler,
  performanceDiagnosticTraceIsEnabled,
} from "./performance-diagnostic-trace";
import {
  performanceScenario,
  type PerformanceScenarioDefinition,
} from "./performance-scenarios";
import {
  performanceScenarioIds,
  type PerformanceScenarioId,
  type PerformanceScenarioResult,
} from "./performance-types";

import { assertVisiblePaneSurface } from "./performance-pane-surface";

const workspaceId = "onirigiri-performance-workspace";

const recordReactCommit: ProfilerOnRenderCallback = (...parameters) => {
  const [, , actualDuration, , , commitTime] = parameters;
  const commitPhaseDurationMs = Math.max(0, performance.now() - commitTime);
  recordReactBoundaryWork(actualDuration + commitPhaseDurationMs);
};

export function PerformanceFixture() {
  const scenario = performanceScenario(scenarioIdFromLocation());
  const [cacheAll, setCacheAll] = useState(false);
  const workspaceHandleRef = useRef<OnirigiriWorkspaceHandle>(null);
  const workspaceContainerRef = useRef<HTMLDivElement>(null);
  const renderPane = useCallback(
    (pane: WorkspacePane, state: OnirigiriPaneRenderState) =>
      pane.surfaceKind !== "performance-dom" ? (
        <PerformanceMixedPane pane={pane} state={state} />
      ) : (
        <PerformancePane pane={pane} state={state} />
      ),
    [],
  );

  useEffect(() => {
    window.__onirigiriPerformance = {
      productionBuild: import.meta.env.PROD,
      run: () =>
        runMeasuredScenario(
          scenario,
          workspaceHandleRef,
          workspaceContainerRef,
          () => setCacheAll(true),
        ),
      scenarioId: scenario.id,
    };
    return () => {
      delete window.__onirigiriPerformance;
    };
  }, [scenario]);

  return (
    <main className="performance-fixture">
      <header className="performance-fixture__header">
        <h1>Onirigiri production performance fixture</h1>
        <p>{scenario.label}</p>
      </header>
      <div
        className="performance-fixture__workspace"
        ref={workspaceContainerRef}
      >
        <Profiler id="onirigiri-workspace" onRender={recordReactCommit}>
          <OnirigiriWorkspace
            ariaLabel={`Onirigiri performance scenario: ${scenario.label}`}
            initialPanes={scenario.panes}
            liveContent={scenario.liveContent}
            preloadAllPanePictures={cacheAll}
            preloadMarginPanes={scenario.workflow === "background" ? 0 : 1}
            ref={workspaceHandleRef}
            renderPane={renderPane}
            shortcutScope="workspace"
            showControls={false}
            showOverviewControl={false}
            workspaceId={workspaceId}
          />
        </Profiler>
      </div>
    </main>
  );
}

function PerformancePane({
  pane,
  state,
}: {
  pane: WorkspacePane;
  state: OnirigiriPaneRenderState;
}) {
  return (
    <div
      className="performance-content"
      data-performance-pane={pane.paneId}
      data-performance-runtime={state.runtimeState}
    >
      <p>
        {pane.surfaceKind} · sequence {pane.sequence}
      </p>
      <div className="performance-content__grid">
        {Array.from({ length: 16 }, (_, index) => (
          <span
            className="performance-content__cell"
            key={`${pane.paneId}-${index}`}
          />
        ))}
      </div>
    </div>
  );
}

const mixedScrollRowCount = 60;
const mixedDenseCellCount = 96;
const mixedFieldNames = ["owner", "region", "label", "note"] as const;

function PerformanceMixedPane({
  pane,
  state,
}: {
  pane: WorkspacePane;
  state: OnirigiriPaneRenderState;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationState = pane.surfaceKind.startsWith("performance-live")
    ? state.runtimeState
    : "hidden";
  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) {
      return;
    }
    let frame = 0;
    const paint = (time: number) => {
      paintPerformanceCanvas(context, pane.sequence, time);
      if (animationState === "live") frame = requestAnimationFrame(paint);
    };
    paint(pane.surfaceKind === "performance-live" ? performance.now() : 0);
    return () => cancelAnimationFrame(frame);
  }, [pane.sequence, pane.surfaceKind, animationState]);
  return (
    <div
      className="performance-content performance-content--mixed"
      data-performance-pane={pane.paneId}
      data-performance-runtime={state.runtimeState}
    >
      <form
        className="performance-content__form"
        onSubmit={(event) => event.preventDefault()}
      >
        {mixedFieldNames.map((field) => (
          <label key={field}>
            <span>{field}</span>
            <input
              autoComplete="off"
              defaultValue={`${field} ${pane.sequence}`}
              name={`${pane.paneId}-${field}`}
              type="text"
            />
          </label>
        ))}
        <label>
          <span>priority</span>
          <select defaultValue="normal" name={`${pane.paneId}-priority`}>
            <option value="low">low</option>
            <option value="normal">normal</option>
            <option value="high">high</option>
          </select>
        </label>
        <label>
          <span>level</span>
          <input
            defaultValue={40 + (pane.sequence % 5) * 10}
            max="100"
            min="0"
            name={`${pane.paneId}-level`}
            type="range"
          />
        </label>
      </form>
      {pane.surfaceKind === "performance-capturable" ||
      pane.surfaceKind === "performance-live-dom" ? (
        <div
          className="performance-content__chart"
          data-chart-live={String(animationState === "live")}
        >
          {Array.from({ length: 24 }, (_, index) => (
            <i
              key={index}
              style={{
                backgroundColor: `hsl(${(pane.sequence * 37 + index * 15) % 360} 60% ${35 + (index % 4) * 10}%)`,
                animationDelay: `${index * -0.07}s`,
              }}
            />
          ))}
        </div>
      ) : (
        <canvas
          aria-hidden="true"
          className="performance-content__canvas"
          height={48}
          ref={canvasRef}
          width={256}
        />
      )}

      <div
        aria-label={`Scrollable rows for ${pane.title}`}
        className="performance-content__scroll"
        role="group"
        tabIndex={-1}
      >
        {Array.from({ length: mixedScrollRowCount }, (_, index) => (
          <p key={`${pane.paneId}-row-${index}`}>
            Row {index + 1} · {pane.surfaceKind} · sequence {pane.sequence}
          </p>
        ))}
      </div>
      <div className="performance-content__grid performance-content__grid--dense">
        {Array.from({ length: mixedDenseCellCount }, (_, index) => (
          <span
            className="performance-content__cell"
            key={`${pane.paneId}-cell-${index}`}
          />
        ))}
      </div>
    </div>
  );
}

function paintPerformanceCanvas(
  context: CanvasRenderingContext2D,
  sequence: number,
  time: number,
): void {
  const { width, height } = context.canvas;
  for (let index = 0; index < 24; index++) {
    context.fillStyle = `hsl(${(sequence * 37 + index * 15 + time / 10) % 360} 60% ${35 + (index % 4) * 10}%)`;
    context.fillRect((index * width) / 24, 0, width / 24 + 1, height);
  }
}

async function runMeasuredScenario(
  scenario: PerformanceScenarioDefinition,
  handleRef: React.RefObject<OnirigiriWorkspaceHandle | null>,
  workspaceRef: React.RefObject<HTMLDivElement | null>,
  startBackground: () => void,
): Promise<PerformanceScenarioResult> {
  const { handle, workspace } = requiredPerformanceWorkspace(
    handleRef,
    workspaceRef,
  );
  const observedRefreshIntervalMs = await sampleObservedRefreshInterval();
  if (scenario.workflow !== "background")
    await warmScenario(handle, workspace, scenario);
  const { diagnosticTraceResult, observation, performanceWork } =
    await measureScenario(handle, workspace, scenario, startBackground);
  const panes = [
    ...workspace.querySelectorAll<HTMLElement>("[data-onirigiri-pane-id]"),
  ];
  const visiblePanes = panes.filter((pane) => pane.dataset.visible === "true");
  const samples = performanceSamples(observation, performanceWork);
  const {
    allAnimationFrameWorkMs,
    allBrowserFrameDeltasMs,
    animationFrameWorkMs,
    browserFrameDeltasMs,
    onirigiriBoundaries,
  } = samples;
  return {
    counts: {
      framesOver50Ms: browserFrameDeltasMs.filter((duration) => duration > 50)
        .length,
      longTasks: observation.longTasks.length,
      minimumMovingVisiblePanes: minimumMovingVisiblePanes(
        observation.movingVisiblePaneCounts,
      ),
      mountedPanes: panes.length,
      visibleLivePanes: visiblePanes.filter(
        (pane) => pane.dataset.runtimeState === "live",
      ).length,
      visiblePanes: visiblePanes.length,
    },
    display: {
      devicePixelRatio,
      observedRefreshIntervalMs,
      viewport: { height: innerHeight, width: innerWidth },
    },
    ...diagnosticTraceResultFields(diagnosticTraceResult),
    iterations: scenario.iterations,
    label: scenario.label,

    paneCount: scenario.panes.length,
    productionBuild: import.meta.env.PROD,
    samples: {
      allAnimationFrameWorkMs,
      allBrowserFrameDeltasMs,
      animationFrameWorkMs,
      browserFrameDeltasMs,
      longTasks: observation.longTasks,
      onirigiriBoundaries,
    },
    scenarioId: scenario.id,
    summaries: {
      allAnimationFrameWorkMs: summarizeDurations(allAnimationFrameWorkMs),
      allBrowserFrameDeltaMs: summarizeDurations(allBrowserFrameDeltasMs),
      animationFrameWorkMs: summarizeDurations(animationFrameWorkMs),
      browserFrameDeltaMs: summarizeDurations(browserFrameDeltasMs),
      longTaskDurationMs: summarizeDurations(
        observation.longTasks.map((sample) => sample.durationMs),
      ),
      onirigiriBoundaryWorkDurationMs: summarizeDurations(
        onirigiriBoundaries.map((sample) => sample.boundaryWorkDurationMs),
      ),
      reactWorkDurationMs: summarizeDurations(
        onirigiriBoundaries
          .filter((sample) => sample.reactCommitCount > 0)
          .map((sample) => sample.reactWorkDurationMs),
      ),
      requestHandlerWorkDurationMs: summarizeDurations(
        onirigiriBoundaries
          .filter((sample) => sample.requestCount > 0)
          .map((sample) => sample.requestHandlerWorkDurationMs),
      ),
    },
  };
}

function requiredPerformanceWorkspace(
  handleRef: React.RefObject<OnirigiriWorkspaceHandle | null>,
  workspaceRef: React.RefObject<HTMLDivElement | null>,
): { handle: OnirigiriWorkspaceHandle; workspace: HTMLElement } {
  const handle = handleRef.current;
  const workspace = workspaceRef.current?.querySelector<HTMLElement>(
    "[data-onirigiri-workspace-id]",
  );
  if (!handle || !workspace) {
    throw new Error("Onirigiri performance fixture is not ready.");
  }
  return { handle, workspace };
}

async function measureScenario(
  handle: OnirigiriWorkspaceHandle,
  workspace: HTMLElement,
  scenario: PerformanceScenarioDefinition,
  startBackground: () => void,
): Promise<{
  diagnosticTraceResult: ReturnType<
    PerformanceDiagnosticTraceSampler["stop"]
  > | null;
  observation: ReturnType<BrowserPerformanceSampler["stop"]>;
  performanceWork: ReturnType<typeof stopPerformanceWorkRecording>;
}> {
  const sampler = new BrowserPerformanceSampler();
  const diagnosticTrace = createPerformanceDiagnosticTraceSampler();
  let observation: ReturnType<BrowserPerformanceSampler["stop"]>;
  let diagnosticTraceResult: ReturnType<
    PerformanceDiagnosticTraceSampler["stop"]
  > | null = null;
  let performanceWork: ReturnType<typeof stopPerformanceWorkRecording>;
  startPerformanceWorkRecording();
  diagnosticTrace?.start();
  sampler.start();
  try {
    if (scenario.workflow === "background") {
      measureOnirigiriRequestWork(startBackground);
      await waitForBackgroundPictures(handle, scenario.panes.length);
    } else
      for (let iteration = 0; iteration < scenario.iterations; iteration += 1) {
        await runScenarioIteration(handle, workspace, scenario, iteration);
      }
    await waitForDisplayFrames(2);
  } finally {
    observation = sampler.stop();
    diagnosticTraceResult = diagnosticTrace?.stop() ?? null;
    performanceWork = stopPerformanceWorkRecording();
  }
  return { diagnosticTraceResult, observation, performanceWork };
}

async function waitForBackgroundPictures(
  handle: OnirigiriWorkspaceHandle,
  count: number,
): Promise<void> {
  const before = handle.getCaptureStatus().pictures.length;
  if (before >= count)
    throw new Error("Background capture must begin with missing pictures.");
  const deadline = performance.now() + 30_000;
  while (handle.getCaptureStatus().pictures.length < count) {
    if (performance.now() >= deadline)
      throw new Error("Background pictures did not finish within 30 seconds.");
    await waitForDisplayFrames(1);
  }
}

function createPerformanceDiagnosticTraceSampler(): PerformanceDiagnosticTraceSampler | null {
  return performanceDiagnosticTraceIsEnabled(location.search)
    ? new PerformanceDiagnosticTraceSampler()
    : null;
}

function diagnosticTraceResultFields(
  diagnosticTrace: ReturnType<PerformanceDiagnosticTraceSampler["stop"]> | null,
): Pick<PerformanceScenarioResult, "diagnosticTrace"> {
  return diagnosticTrace ? { diagnosticTrace } : {};
}

async function warmScenario(
  handle: OnirigiriWorkspaceHandle,
  workspace: HTMLElement,
  scenario: PerformanceScenarioDefinition,
): Promise<void> {
  const { anchorPane, nearbyPane } = requiredWarmPanes(scenario);
  requirePaneFocus(handle, nearbyPane.paneId, scenario.id, "warm");
  await waitForWorkspaceIdle(handle);
  requirePaneFocus(handle, anchorPane.paneId, scenario.id, "reset");
  await waitForWorkspaceIdle(handle);
  if (scenario.workflow === "navigation") {
    await warmRapidNavigationRetarget(handle, scenario);
  }
  if (scenario.workflow === "asymmetric") {
    await warmAsymmetricEndpointTraversal(handle, scenario);
  }
  if (scenario.workflow === "overview") {
    requestOverviewToggle(handle);
    await waitForWorkspaceIdle(handle);
    requestOverviewToggle(handle);
    await waitForWorkspaceIdle(handle);
  }
  if (scenario.workflow === "continuous-navigation") {
    requestFocusDirection(handle, "right");
    await waitForWorkspaceIdle(handle);
    requestFocusDirection(handle, "left");
    await waitForWorkspaceIdle(handle);
  }
  workspace.focus();
}

function requiredWarmPanes(scenario: PerformanceScenarioDefinition): {
  anchorPane: PerformanceScenarioDefinition["panes"][number];
  nearbyPane: PerformanceScenarioDefinition["panes"][number];
} {
  const anchorIndex =
    scenario.workflow === "overview"
      ? Math.floor(scenario.panes.length / 2)
      : 0;
  const anchorPane = scenario.panes[anchorIndex];
  const nearbyPane =
    scenario.panes[Math.min(anchorIndex + 3, scenario.panes.length - 1)];
  if (!anchorPane || !nearbyPane) {
    throw new Error(`Unable to resolve ${scenario.id} warmup panes.`);
  }
  return { anchorPane, nearbyPane };
}

function requirePaneFocus(
  handle: OnirigiriWorkspaceHandle,
  paneId: string,
  scenarioId: string,
  action: "reset" | "warm",
): void {
  if (!requestPaneFocus(handle, paneId)) {
    throw new Error(`Unable to ${action} ${scenarioId} navigation.`);
  }
}

async function warmAsymmetricEndpointTraversal(
  handle: OnirigiriWorkspaceHandle,
  scenario: PerformanceScenarioDefinition,
): Promise<void> {
  const firstPane = scenario.panes.at(0);
  const lastPane = scenario.panes.at(-1);
  if (!firstPane || !lastPane || !requestPaneFocus(handle, lastPane.paneId)) {
    throw new Error(`Unable to warm ${scenario.id} endpoint traversal.`);
  }
  await waitForWorkspaceIdle(handle);
  if (!requestPaneFocus(handle, firstPane.paneId)) {
    throw new Error(`Unable to reset ${scenario.id} endpoint traversal.`);
  }
  await waitForWorkspaceIdle(handle);
}

async function warmRapidNavigationRetarget(
  handle: OnirigiriWorkspaceHandle,
  scenario: PerformanceScenarioDefinition,
): Promise<void> {
  const [firstPane, lastPane] = measuredNavigationEndpoints(scenario);
  if (!firstPane || !lastPane) {
    throw new Error(`${scenario.id} has no retarget endpoints.`);
  }
  const start = handle.getSnapshot().scrollColumn;
  if (!requestPaneFocus(handle, lastPane.paneId)) {
    throw new Error(`Unable to start ${scenario.id} rapid retarget.`);
  }
  const forwardTarget = handle.getSnapshot().targetScrollColumn;
  await waitForDisplayFrames(3);
  const reversalStart = handle.getSnapshot().scrollColumn;
  const lower = Math.min(start, forwardTarget);
  const upper = Math.max(start, forwardTarget);
  if (reversalStart <= lower || reversalStart >= upper) {
    throw new Error(`${scenario.id} did not expose an in-flight camera.`);
  }
  if (!requestPaneFocus(handle, firstPane.paneId)) {
    throw new Error(`Unable to reverse ${scenario.id} rapid retarget.`);
  }
  const reverseTarget = handle.getSnapshot().targetScrollColumn;
  const reverseSamples = await waitForWorkspaceIdle(handle);
  assertLiteralTrajectory(
    `${scenario.id} rapid reversal`,
    reversalStart,
    reverseTarget,
    reverseSamples.map((sample) => sample.scrollColumn),
  );
}

async function runScenarioIteration(
  handle: OnirigiriWorkspaceHandle,
  workspace: HTMLElement,
  scenario: PerformanceScenarioDefinition,
  iteration: number,
): Promise<void> {
  if (scenario.workflow === "overview") {
    await runOverviewIteration(handle, workspace);
    return;
  }
  if (scenario.workflow === "continuous-navigation") {
    await runContinuousNavigationIteration(handle, scenario);
    return;
  }
  const startScrollColumn = handle.getSnapshot().scrollColumn;
  focusAlternatingEndpoint(handle, scenario, iteration);
  const targetScrollColumn = handle.getSnapshot().targetScrollColumn;
  const navigationSamples = await waitForWorkspaceIdle(handle);
  assertLiteralTrajectory(
    `${scenario.id} scroll column`,
    startScrollColumn,
    targetScrollColumn,
    navigationSamples.map((sample) => sample.scrollColumn),
  );
  if (
    scenario.workflow === "asymmetric" &&
    workspace.dataset.compactLayout !== "true"
  ) {
    await dragResizeHandle(workspace, iteration);
    await waitForWorkspaceIdle(handle);
  }
}

function focusAlternatingEndpoint(
  handle: OnirigiriWorkspaceHandle,
  scenario: PerformanceScenarioDefinition,
  iteration: number,
): void {
  const endpoints = measuredNavigationEndpoints(scenario);
  const pane = endpoints[iteration % 2 === 0 ? 1 : 0];
  if (!pane || !requestPaneFocus(handle, pane.paneId)) {
    throw new Error(`Unable to focus a ${scenario.id} endpoint.`);
  }
}

function measuredNavigationEndpoints(
  scenario: PerformanceScenarioDefinition,
): readonly [
  PerformanceScenarioDefinition["panes"][number] | undefined,
  PerformanceScenarioDefinition["panes"][number] | undefined,
] {
  if (scenario.workflow !== "navigation") {
    return [scenario.panes.at(0), scenario.panes.at(-1)];
  }
  const finalIndex = scenario.panes.length - 1;
  return [
    scenario.panes[Math.floor(finalIndex * 0.25)],
    scenario.panes[Math.ceil(finalIndex * 0.75)],
  ];
}

function requestPaneFocus(
  handle: OnirigiriWorkspaceHandle,
  paneId: string,
): boolean {
  return measureOnirigiriRequestWork(() => handle.focusPane(paneId));
}

function requestOverviewToggle(handle: OnirigiriWorkspaceHandle): void {
  measureOnirigiriRequestWork(() => handle.toggleOverview());
}

async function runOverviewIteration(
  handle: OnirigiriWorkspaceHandle,
  workspace: HTMLElement,
): Promise<void> {
  const normalProgress = handle.getSnapshot().overviewProgress;
  requestOverviewToggle(handle);
  const overviewSamples = await waitForWorkspaceIdle(handle);
  assertLiteralTrajectory(
    "overview entry",
    normalProgress,
    1,
    overviewSamples.map((sample) => sample.overviewProgress),
  );
  assertVisiblePaneSurface(workspace);
  for (let index = 0; index < 8; index += 1) {
    requestFocusDirection(handle, index < 4 ? "right" : "left");
    await waitForDisplayFrames(6);
  }
  await waitForWorkspaceIdle(handle);
  assertVisiblePaneSurface(workspace);
  const overviewProgress = handle.getSnapshot().overviewProgress;
  requestOverviewToggle(handle);
  const normalSamples = await waitForWorkspaceIdle(handle);
  assertLiteralTrajectory(
    "overview exit",
    overviewProgress,
    0,
    normalSamples.map((sample) => sample.overviewProgress),
  );
}

async function runContinuousNavigationIteration(
  handle: OnirigiriWorkspaceHandle,
  scenario: PerformanceScenarioDefinition,
): Promise<void> {
  for (const direction of ["right", "left"] as const) {
    const start = handle.getSnapshot().scrollColumn;
    const samples: number[] = [];
    for (let step = 0; step < 6; step += 1) {
      requestFocusDirection(handle, direction);
      for (let frame = 0; frame < 6; frame += 1) {
        await waitForDisplayFrames(1);
        samples.push(handle.getSnapshot().scrollColumn);
      }
    }
    const target = handle.getSnapshot().targetScrollColumn;
    const label = `${scenario.id} navigation ${direction}`;
    if (Math.abs(target - start) <= 0.001) {
      throw new Error(`${label} did not navigate the camera.`);
    }
    const idleSamples = await waitForWorkspaceIdle(handle);
    assertLiteralTrajectory(label, start, target, [
      ...samples,
      ...idleSamples.map((sample) => sample.scrollColumn),
    ]);
  }
}

function requestFocusDirection(
  handle: OnirigiriWorkspaceHandle,
  direction: "left" | "right",
): void {
  if (!measureOnirigiriRequestWork(() => handle.focus(direction))) {
    throw new Error(`Unable to navigate ${direction}.`);
  }
}

async function dragResizeHandle(
  workspace: HTMLElement,
  iteration: number,
): Promise<void> {
  const focusedPane = workspace.querySelector<HTMLElement>(
    '[data-onirigiri-pane-id][data-focused="true"]',
  );
  const selector =
    iteration % 2 === 0
      ? '[data-onirigiri-slot="pane-resize-row"]'
      : '[data-onirigiri-slot="pane-resize-column"]';
  const resizeHandle =
    focusedPane?.querySelector<HTMLElement>(selector) ??
    workspace.querySelector<HTMLElement>(
      `[data-onirigiri-pane-id][data-visible="true"] ${selector}`,
    );
  if (!resizeHandle) {
    throw new Error(`Asymmetric scenario has no ${selector} resize handle.`);
  }
  const bounds = resizeHandle.getBoundingClientRect();
  const startX = bounds.left + bounds.width / 2;
  const startY = bounds.top + bounds.height / 2;
  dispatchOnirigiriEvent(
    resizeHandle,
    pointerEvent("pointerdown", startX, startY, 1),
  );
  for (let step = 1; step <= 8; step += 1) {
    await waitForDisplayFrames(1);
    dispatchOnirigiriEvent(
      window,
      pointerEvent(
        "pointermove",
        startX + (iteration % 2 === 0 ? 0 : step * 9),
        startY + (iteration % 2 === 0 ? step * 7 : 0),
        1,
      ),
    );
  }
  dispatchOnirigiriEvent(window, pointerEvent("pointerup", startX, startY, 0));
}

function dispatchOnirigiriEvent(target: EventTarget, event: Event): void {
  measureOnirigiriRequestWork(() => target.dispatchEvent(event));
}

function pointerEvent(
  type: string,
  clientX: number,
  clientY: number,
  buttons: number,
): PointerEvent {
  return new PointerEvent(type, {
    bubbles: true,
    button: 0,
    buttons,
    cancelable: true,
    clientX,
    clientY,
    isPrimary: true,
    pointerId: 1,
    pointerType: "mouse",
  });
}

async function waitForWorkspaceIdle(
  handle: OnirigiriWorkspaceHandle,
): Promise<WorkspaceLayoutSnapshot[]> {
  const deadline = performance.now() + 20_000;
  const samples: WorkspaceLayoutSnapshot[] = [];
  await waitForDisplayFrames(1);
  samples.push(handle.getSnapshot());
  while (!workspaceIsSettled(handle)) {
    if (performance.now() >= deadline) {
      throw new Error(
        "Onirigiri performance scenario did not settle in 20 seconds.",
      );
    }
    await waitForDisplayFrames(1);
    samples.push(handle.getSnapshot());
  }
  await waitForDisplayFrames(1);
  return samples;
}

function assertLiteralTrajectory(
  label: string,
  start: number,
  target: number,
  samples: readonly number[],
): void {
  const distance = target - start;
  if (Math.abs(distance) <= 0.001) {
    return;
  }
  const direction = Math.sign(distance);
  const minimum = Math.min(start, target);
  const maximum = Math.max(start, target);
  if (!samples.some((value) => value > minimum && value < maximum)) {
    throw new Error(`${label} snapped without an intermediate frame.`);
  }
  for (let index = 1; index < samples.length; index += 1) {
    const previous = samples[index - 1] ?? start;
    const current = samples[index] ?? previous;
    if ((current - previous) * direction < -0.001) {
      throw new Error(`${label} reversed or replayed an intermediate leg.`);
    }
  }
  const final = samples.at(-1);
  if (final === undefined || Math.abs(final - target) > 0.001) {
    throw new Error(`${label} did not settle at its literal target.`);
  }
}

function workspaceIsSettled(handle: OnirigiriWorkspaceHandle): boolean {
  const snapshot = handle.getSnapshot();
  const overviewTarget = snapshot.presentationMode === "overview" ? 1 : 0;
  return (
    Math.abs(snapshot.scrollColumn - snapshot.targetScrollColumn) <= 0.001 &&
    Math.abs(
      snapshot.horizontalAnchorOffset - snapshot.targetHorizontalAnchorOffset,
    ) <= 0.001 &&
    snapshot.scrollRow === snapshot.targetScrollRow &&
    Math.abs(
      snapshot.verticalAnchorOffset - snapshot.targetVerticalAnchorOffset,
    ) <= 0.001 &&
    Math.abs(snapshot.overviewProgress - overviewTarget) <= 0.001
  );
}

function scenarioIdFromLocation(): PerformanceScenarioId {
  const candidate = new URLSearchParams(location.search).get("scenario");
  if (performanceScenarioIds.some((scenarioId) => scenarioId === candidate)) {
    return candidate as PerformanceScenarioId;
  }
  return "navigation-50";
}
