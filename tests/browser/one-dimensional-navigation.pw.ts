import {
  expect,
  test,
  type CDPSession,
  type Locator,
  type Page,
} from "@playwright/test";

import {
  oneDimensionalPaneOrder,
  oneDimensionalWorkspaceRegionLabel,
  type OneDimensionalConsumerRender,
  type OneDimensionalPaneId,
} from "./one-dimensional-playground-contract";
import {
  analyzeMotion,
  analyzeMovement,
  axisSeries,
  describeMovement,
  describeSeries,
  installTrajectorySampler,
  markTrustedInputSequence,
  requestWindows,
  restingTail,
  stopTrajectorySampler,
  waitForEvidenceBeforeActionCompletion,
  type DeferredActionReceipt,
  type MotionAnalysis,
  type RequestWindow,
  type TrajectoryAxis,
  type TrajectoryPaneBox,
  type TrajectoryCapture,
  type TrajectoryPaneSample,
  type TrustedInputMark,
} from "./navigation-trajectory";

type PaneId = OneDimensionalPaneId;
type RestGeometry = Record<PaneId, TrajectoryPaneSample | null>;
type Tuple<
  Item,
  Count extends number,
  Result extends Item[] = [],
> = Result["length"] extends Count
  ? Result
  : Tuple<Item, Count, [...Result, Item]>;

interface Scene {
  references: Map<PaneId, TrajectoryPaneBox>;
  rest: RestGeometry;
  viewport: { height: number; width: number };
}

const paneIds: readonly PaneId[] = oneDimensionalPaneOrder;
const inFlightTravelPx = 48;
const reversalTravelPx = 120;
const settleTimeoutMs = 4_000;
const restCaptureMs = 120;
const movementStartGraceMs = 40;
const minimumIntermediatePositions = 12;
const minimumTravelPx = 40;
const geometryTolerancePx = 0.5;
const maximumFirstStepFraction = 0.5;
const maximumInitialSpeedRatio = 2.1;
const maximumVelocityGrowth = 1.3;

test("interpolates every settled forward keyboard step as one continuous movement", async ({
  page,
}) => {
  const scene = await openPlayground(page);
  await pressSettled(page, "Alt+ArrowRight", "signals → tasks");
  await pressSettled(page, "Alt+ArrowDown", "tasks → notes");
  await pressSettled(page, "Alt+ArrowRight", "notes → atlas");
  await pressSettled(page, "Alt+ArrowRight", "atlas → system");
  const renders = await consumerRenders(page);
  const [toTasks, toNotes, toAtlas, toSystem] = await captureWindows(page, 4);

  expectSettledMove(toTasks, scene, "tasks");
  expectSettledMove(toNotes, scene, "notes", "y");
  expectSettledMove(toAtlas, scene, "atlas");
  expectSettledMove(toSystem, scene, "system");
  for (const window of [toTasks, toAtlas, toSystem]) {
    expectOnlyRuntimeTransitionsDuringInterpolation(window, renders);
  }
});

test("interpolates every settled reverse keyboard step as one continuous movement", async ({
  page,
}) => {
  const scene = await openPlayground(page);
  await pressSettled(page, "Alt+ArrowRight", "signals → tasks");
  await pressSettled(page, "Alt+ArrowRight", "tasks → atlas");
  await pressSettled(page, "Alt+ArrowRight", "atlas → system");
  await pressSettled(page, "Alt+ArrowLeft", "system → atlas");
  await pressSettled(page, "Alt+ArrowLeft", "atlas → tasks");
  await pressSettled(page, "Alt+ArrowDown", "tasks → notes (reverse)");
  await pressSettled(page, "Alt+ArrowUp", "notes → tasks (reverse)");
  await pressSettled(page, "Alt+ArrowLeft", "tasks → signals");
  const renders = await consumerRenders(page);
  const [
    toTasks,
    toAtlas,
    toSystem,
    backToAtlas,
    backToTasks,
    downToNotes,
    upToTasks,
    backToSignals,
  ] = await captureWindows(page, 8);

  expectSettledMove(toTasks, scene, "tasks");
  expectSettledMove(toAtlas, scene, "atlas");
  expectSettledMove(toSystem, scene, "system");
  expectSettledMove(backToAtlas, scene, "atlas");
  expectSettledMove(backToTasks, scene, "tasks");
  expectSettledMove(downToNotes, scene, "notes", "y");
  expectSettledMove(upToTasks, scene, "tasks", "y");
  expectSettledMove(backToSignals, scene, "signals");
  expectGeometry(
    backToSignals.frames.at(-1)?.panes.signals ?? null,
    requiredRest(scene, "signals"),
    "tasks → signals: signals returns to its exact initial geometry",
  );
  for (const window of [toTasks, toAtlas, toSystem, backToAtlas, backToTasks]) {
    expectOnlyRuntimeTransitionsDuringInterpolation(window, renders);
  }
});

test("continues rapid repeated-right input from the displayed frame without replay", async ({
  page,
}) => {
  const scene = await openPlayground(page);
  await pressKeyboardSequence(page, [
    {
      chord: "Alt+ArrowRight",
      label: "signals → tasks (rapid)",
      travelPx: inFlightTravelPx,
    },
    {
      chord: "Alt+ArrowRight",
      label: "tasks → atlas (rapid)",
      travelPx: inFlightTravelPx,
    },
    {
      chord: "Alt+ArrowRight",
      label: "atlas → system (rapid)",
      travelPx: null,
    },
  ]);
  const [toTasks, toAtlas, toSystem] = await captureWindows(page, 3);

  expectOpeningLeg(toTasks, "tasks");
  expectInFlightContinuation(toAtlas, "atlas", "interrupted");
  expectInFlightContinuation(toSystem, "system", "settled");
  expectSettledAt(toSystem, scene, "system");
});

test("reverses mid-flight from the displayed frame without replaying or recentering", async ({
  page,
}) => {
  const scene = await openPlayground(page);
  await pressKeyboardSequence(page, [
    {
      chord: "Alt+ArrowRight",
      label: "signals → tasks (reversed in flight)",
      travelPx: reversalTravelPx,
    },
    {
      chord: "Alt+ArrowLeft",
      label: "tasks → signals (mid-flight)",
      travelPx: null,
    },
  ]);
  const [toTasks, backToSignals] = await captureWindows(page, 2);

  expectOpeningLeg(toTasks, "tasks");
  expectInFlightContinuation(backToSignals, "signals", "settled");
  expectSettledAt(backToSignals, scene, "signals");
  expectGeometry(
    backToSignals.frames.at(-1)?.panes.signals ?? null,
    requiredRest(scene, "signals"),
    "mid-flight reversal: signals returns to its exact initial geometry",
  );
});

test("animates a direct public focus request straight from A to C", async ({
  page,
}) => {
  const scene = await openPlayground(page);
  await focusPaneDirectly(
    page,
    "notes",
    "focusPane(notes) from signals (adjacent oracle)",
  );
  await focusPaneDirectly(
    page,
    "atlas",
    "focusPane(atlas) from notes (adjacent oracle)",
  );
  await focusPaneDirectly(page, "signals", "focusPane(signals) from atlas");
  await focusPaneDirectly(
    page,
    "atlas",
    "focusPane(atlas) from signals (direct)",
  );
  const [toNotes, adjacentToAtlas, backToSignals, directToAtlas] =
    await captureWindows(page, 4);

  expectSettledMove(toNotes, scene, "notes");
  expectSettledMove(adjacentToAtlas, scene, "atlas");
  expectSettledMove(backToSignals, scene, "signals");
  expectGeometry(
    backToSignals.frames.at(-1)?.panes.signals ?? null,
    requiredRest(scene, "signals"),
    "focusPane(signals): signals returns to its exact initial geometry",
  );
  expectSettledMove(directToAtlas, scene, "atlas");
});

test("keeps one movement and no intermediate endpoint across rapid two-command sequences", async ({
  page,
}) => {
  const scene = await openPlayground(page);
  await pressKeyboardSequence(page, [
    {
      chord: "Alt+ArrowRight",
      label: "signals → tasks (two-command)",
      travelPx: inFlightTravelPx,
    },
    {
      chord: "Alt+ArrowDown",
      label: "tasks → notes (in flight)",
      travelPx: null,
    },
  ]);
  await focusPaneDirectly(page, "signals", "focusPane(signals) from notes");
  const toTasksRequest = await focusPaneInFlight(
    page,
    "tasks",
    "focusPane(tasks) from signals (two-command)",
    inFlightTravelPx,
  );
  await focusPaneDirectly(page, "atlas", "focusPane(atlas) in flight");
  expect(
    await toTasksRequest.complete(),
    "focusPane(tasks) from signals (two-command): focusPane was accepted",
  ).toBe(true);
  const [toTasks, toNotes, backToSignals, toTasksAgain, toAtlas] =
    await captureWindows(page, 5);

  expectOpeningLeg(toTasks, "tasks");
  expectInFlightContinuation(toNotes, "notes", "settled");
  expectSettledAt(toNotes, scene, "notes");
  expectSettledMove(backToSignals, scene, "signals");
  expectOpeningLeg(toTasksAgain, "tasks");
  expectInFlightContinuation(toAtlas, "atlas", "settled");
  expectSettledAt(toAtlas, scene, "atlas");
});

test("enters overview from atlas and exits to system through continuous scene legs", async ({
  page,
}) => {
  const scene = await openPlayground(page);
  await pressSettled(page, "Alt+ArrowRight", "signals → tasks");
  await pressSettled(page, "Alt+ArrowRight", "tasks → atlas");
  await pressSettled(page, "Alt+ArrowRight", "atlas → system");
  const systemNormal = requiredBox((await paneBoxes(page)).system, "system");
  await pressSettled(page, "Alt+ArrowLeft", "system → atlas");
  const atlasNormal = requiredBox((await paneBoxes(page)).atlas, "atlas");

  await clickSettled(
    page,
    page.getByRole("button", { name: "Zoom out to workspace overview" }),
    "overview entry from atlas",
  );
  await clickSettled(
    page,
    pane(page, "system").locator('[data-onirigiri-pane-titlebar="true"]'),
    "overview exit to system",
  );
  const renders = await consumerRenders(page);
  const [toTasks, toAtlas, toSystem, backToAtlas, entry, exit] =
    await captureWindows(page, 6);

  expectSettledMove(toTasks, scene, "tasks");
  expectSettledMove(toAtlas, scene, "atlas");
  expectSettledMove(toSystem, scene, "system");
  expectSettledMove(backToAtlas, scene, "atlas");
  expectGeometry(
    atlasNormal,
    scene.references.get("atlas") ?? null,
    "atlas at rest before overview",
  );
  expectGeometry(
    systemNormal,
    scene.references.get("system") ?? null,
    "system at rest before overview",
  );
  expectOverviewEntry(entry, "atlas", atlasNormal);
  expectOverviewExit(exit, scene, "system", systemNormal);
  expectOnlyRuntimeTransitionsDuringInterpolation(entry, renders);
  expectOnlyRuntimeTransitionsDuringInterpolation(exit, renders);
});

test("retains consumer form, scroll, canvas, and subtree identity across a movement round trip", async ({
  page,
}) => {
  const scene = await openPlayground(page);
  const notes = pane(page, "notes");
  await expect(notes).toHaveAttribute("data-visible", "true");
  await expect(notes).toHaveAttribute("data-runtime-state", "live");
  const seeded = await seedConsumerState(page);
  await page
    .getByRole("region", { name: oneDimensionalWorkspaceRegionLabel })
    .focus();
  await expect(pane(page, "tasks")).toHaveAttribute("data-focused", "true");

  await pressSettled(page, "Alt+ArrowRight", "tasks → atlas");
  await pressSettled(page, "Alt+ArrowRight", "atlas → system");
  await expect(notes).toHaveAttribute("data-visible", "false");
  await expect(notes).toHaveAttribute("data-runtime-state", "hidden");
  await expect(notes).toHaveAttribute("inert", "");
  await expect(notes.locator(".onirigiri-pane__live-content")).toHaveAttribute(
    "aria-hidden",
    "true",
  );
  await expect(notes.locator("textarea")).toHaveCount(1);

  await pressSettled(page, "Alt+ArrowLeft", "system → atlas");
  await pressSettled(page, "Alt+ArrowLeft", "atlas → tasks");
  await pressSettled(page, "Alt+ArrowDown", "tasks → notes");
  await expect(notes).toHaveAttribute("data-focused", "true");
  await expect(notes).toHaveAttribute("data-visible", "true");
  await expect(notes).toHaveAttribute("data-runtime-state", "live");
  await expect(notes.locator(".onirigiri-pane__live-content")).toHaveAttribute(
    "aria-hidden",
    "false",
  );
  await expectConsumerStateRetained(page, seeded);

  const renders = await consumerRenders(page);
  const windows = await captureWindows(page, 5);
  for (const window of windows) {
    expectOnlyRuntimeTransitionsDuringInterpolation(window, renders);
  }
  expectSettledAt(windows[4], scene, "notes");
});

test.describe("reduced motion", () => {
  test.use({ contextOptions: { reducedMotion: "reduce" } });

  test("snaps trusted keyboard navigation to exact geometry without movement", async ({
    page,
  }) => {
    const scene = await openPlayground(page);
    await pressSettled(
      page,
      "Alt+ArrowRight",
      "signals → tasks (reduced motion)",
    );
    await pressSettled(
      page,
      "Alt+ArrowLeft",
      "tasks → signals (reduced motion)",
    );
    const [toTasks, backToSignals] = await captureWindows(page, 2);

    expectSnap(toTasks, scene, "tasks");
    expectSnap(backToSignals, scene, "signals");
    expectGeometry(
      backToSignals.frames.at(-1)?.panes.signals ?? null,
      requiredRest(scene, "signals"),
      "reduced motion: signals returns to its exact initial geometry",
    );
  });
});

function expectSettledMove(
  window: RequestWindow,
  scene: Scene,
  paneId: PaneId,
  axis: TrajectoryAxis = "x",
): void {
  const { context, motion, movement } = analyze(window, paneId, axis);
  expect(movement.movingBefore, context).toBe(false);
  expect(movement.movementStarts, context).toBe(1);
  expectContinuousMotion(motion, context);
  expectFullTrajectory(motion, context);
  expectSettledAt(window, scene, paneId);
}

function expectOpeningLeg(window: RequestWindow, paneId: PaneId): void {
  const { context, motion, movement } = analyze(window, paneId, "x");
  expect(movement.movingBefore, context).toBe(false);
  expect(movement.movementStarts, context).toBe(1);
  expect(movement.movingAtEnd, context).toBe(true);
  expectContinuousMotion(motion, context);
}

function expectInFlightContinuation(
  window: RequestWindow,
  paneId: PaneId,
  completion: "interrupted" | "settled",
): void {
  const { context, motion, movement } = analyze(window, paneId, "x");
  expect(movement.movingBefore, context).toBe(true);
  expect(movement.movementStarts, context).toBe(0);
  expect(movement.movingAtEnd, context).toBe(completion === "interrupted");
  expectContinuousMotion(motion, context);
  expect(motion.firstStepGrowth, context).toBeLessThanOrEqual(
    maximumInitialSpeedRatio,
  );
  if (completion === "settled") {
    expectFullTrajectory(motion, context);
  } else {
    expect(motion.distinctIntermediatePositions, context).toBeGreaterThan(0);
  }
}

function expectOverviewEntry(
  window: RequestWindow,
  paneId: PaneId,
  normal: TrajectoryPaneBox,
): void {
  const last = window.frames.at(-1);
  expectSceneLeg(window, paneId);
  expect(window.previous?.focusedPaneId, window.label).toBe(paneId);
  expectGeometry(
    window.previous?.panes[paneId] ?? null,
    normal,
    `${window.label}: starts from the displayed normal geometry`,
  );
  expect(last?.presentationMode, window.label).toBe("overview");
  expect(last?.overviewProgress, window.label).toBe("1.0000");
  expect(restingTail(window, paneId), window.label).toEqual({
    movingFrames: 0,
    stationary: true,
  });
  expect(last?.panes[paneId]?.width, window.label).toBeLessThan(
    normal.width - 1,
  );
}

function expectOverviewExit(
  window: RequestWindow,
  scene: Scene,
  paneId: PaneId,
  normal: TrajectoryPaneBox,
): void {
  const last = window.frames.at(-1);
  expectSceneLeg(window, paneId);
  expect(last?.presentationMode, window.label).toBe("normal");
  expect(last?.overviewProgress, window.label).toBe("0.0000");
  expectSettledAt(window, scene, paneId);
  expectGeometry(
    last?.panes[paneId] ?? null,
    normal,
    `${window.label}: lands on the pane's normal geometry`,
  );
}

function expectSceneLeg(window: RequestWindow, paneId: PaneId): void {
  const movement = analyzeMovement(window);
  const context = `${window.label}: movement ${JSON.stringify(movement)}; frames ${describeMovement(window)}`;
  expect(movement.movingBefore, context).toBe(false);
  expect(movement.movementStarts, context).toBe(1);
  for (const axis of ["x", "width"] as const) {
    const { context: axisContext, motion } = analyze(window, paneId, axis);
    expectContinuousMotion(motion, axisContext);
    expectFullTrajectory(motion, axisContext);
  }
}

function expectSnap(window: RequestWindow, scene: Scene, paneId: PaneId): void {
  const { context, motion, movement } = analyze(window, paneId, "x");
  expect(movement.movementStarts, context).toBe(0);
  expect(movement.movingFrames, context).toBe(0);
  expect(motion.travelPx, context).toBeGreaterThan(minimumTravelPx);
  expect(motion.distinctIntermediatePositions, context).toBe(0);
  expectSettledAt(window, scene, paneId);
}

function expectContinuousMotion(motion: MotionAnalysis, context: string): void {
  expect(motion.travelPx, context).toBeGreaterThan(minimumTravelPx);
  expect(motion.directionChanges, context).toBe(0);
  expect(motion.midFlightStalls, context).toBe(0);
  expect(motion.movedAwayPx, context).toBeLessThanOrEqual(1);
  expect(motion.largestVelocityGrowth, context).toBeLessThanOrEqual(
    maximumVelocityGrowth,
  );
}

function expectFullTrajectory(motion: MotionAnalysis, context: string): void {
  expect(motion.distinctIntermediatePositions, context).toBeGreaterThanOrEqual(
    minimumIntermediatePositions,
  );
  expect(motion.firstStepFraction, context).toBeLessThanOrEqual(
    maximumFirstStepFraction,
  );
}

function expectSettledAt(
  window: RequestWindow,
  scene: Scene,
  paneId: PaneId,
): void {
  const last = window.frames.at(-1);
  const context = `${window.label}: final frame`;
  expect(last?.focusedPaneId, context).toBe(paneId);
  expect(restingTail(window, paneId), context).toEqual({
    movingFrames: 0,
    stationary: true,
  });
  const box = last?.panes[paneId] ?? null;
  if (!box) {
    throw new Error(`${context}: ${paneId} has no sampled geometry`);
  }
  expect(box.visible, `${context}: ${paneId} is visible`).toBe(true);
  expect(box.runtimeState, `${context}: ${paneId} is live`).toBe("live");
  expect(box.x, `${context}: ${paneId} left edge`).toBeGreaterThanOrEqual(
    -geometryTolerancePx,
  );
  expect(box.y, `${context}: ${paneId} top edge`).toBeGreaterThanOrEqual(
    -geometryTolerancePx,
  );
  expect(
    box.x + box.width,
    `${context}: ${paneId} right edge`,
  ).toBeLessThanOrEqual(scene.viewport.width + geometryTolerancePx);
  expect(
    box.y + box.height,
    `${context}: ${paneId} bottom edge`,
  ).toBeLessThanOrEqual(scene.viewport.height + geometryTolerancePx);
  const reference = scene.references.get(paneId);
  if (reference) {
    expectGeometry(
      box,
      reference,
      `${context}: ${paneId} settles where it settled before`,
    );
  } else {
    scene.references.set(paneId, {
      height: box.height,
      width: box.width,
      x: box.x,
      y: box.y,
    });
  }
}

function expectGeometry(
  actual: TrajectoryPaneBox | null,
  expected: TrajectoryPaneBox | null,
  context: string,
): void {
  if (!expected) {
    throw new Error(`${context}: the expected geometry is unknown`);
  }
  if (!actual) {
    throw new Error(`${context}: the pane has no sampled geometry`);
  }
  for (const axis of ["x", "y", "width", "height"] as const) {
    expect(
      Math.abs(actual[axis] - expected[axis]),
      `${context}: ${axis} ${actual[axis]} vs ${expected[axis]}`,
    ).toBeLessThanOrEqual(geometryTolerancePx);
  }
}

function expectOnlyRuntimeTransitionsDuringInterpolation(
  window: RequestWindow,
  renders: readonly OneDimensionalConsumerRender[],
): void {
  const movingFrames = window.frames.filter((frame) => frame.moving);
  const open = movingFrames[1];
  const close = movingFrames.at(-1);
  if (!open || !close || movingFrames.length < 3) {
    return;
  }
  const interpolationRenders = renders.filter(
    (render) =>
      render.timeMs > open.sampledAtMs && render.timeMs < close.sampledAtMs,
  );
  for (const render of interpolationRenders) {
    const previous = renders
      .slice(0, renders.indexOf(render))
      .findLast((candidate) => candidate.paneId === render.paneId);
    expect(previous, `${window.label}: previous consumer state`).toBeDefined();
    const { runtimeState, ...state } = render.state;
    const { runtimeState: previousRuntime, ...previousState } = previous!.state;
    expect(state, `${window.label}: stable consumer inputs`).toEqual(
      previousState,
    );
    expect(
      [previousRuntime, runtimeState].sort(),
      `${window.label}: only live visibility transitions may render during interpolation`,
    ).toEqual(["hidden", "live"]);
  }
}

function analyze(window: RequestWindow, paneId: PaneId, axis: TrajectoryAxis) {
  const series = axisSeries(window, paneId, axis);
  const motion = analyzeMotion(series);
  const movement = analyzeMovement(window);
  return {
    context: `${window.label}: ${paneId}.${axis} ${describeSeries(series)}; motion ${JSON.stringify(motion)}; movement ${JSON.stringify(movement)}; frames ${describeMovement(window)}`,
    motion,
    movement,
  };
}

function requiredRest(scene: Scene, paneId: "signals"): TrajectoryPaneBox {
  const rest = scene.rest[paneId];
  if (!rest?.visible) {
    throw new Error(`${paneId} has no resting geometry at load`);
  }
  return { height: rest.height, width: rest.width, x: rest.x, y: rest.y };
}

function requiredBox(
  sample: TrajectoryPaneSample | null,
  paneId: PaneId,
): TrajectoryPaneBox {
  if (!sample?.visible) {
    throw new Error(`${paneId} is not presented`);
  }
  return requiredBoxOf(sample);
}

function requiredBoxOf(sample: TrajectoryPaneBox): TrajectoryPaneBox {
  return {
    height: sample.height,
    width: sample.width,
    x: sample.x,
    y: sample.y,
  };
}

async function openPlayground(page: Page): Promise<Scene> {
  await page.goto("/fixture.html");
  const workspace = page.getByRole("region", {
    name: oneDimensionalWorkspaceRegionLabel,
  });
  await expect(workspace).toHaveAttribute("data-presentation-mode", "normal");
  await expect(pane(page, "signals")).toHaveAttribute("data-focused", "true");
  await waitForRest(page);
  const rest = await paneBoxes(page);
  const signals = requiredBox(rest.signals, "signals");
  await page.evaluate(installTrajectorySampler, paneIds);
  await page.evaluate(() => {
    window.__onirigiriOneDimensionalPlayground?.resetConsumerRenders();
  });
  await workspace.focus();
  await page.waitForTimeout(restCaptureMs);
  const size = page.viewportSize();
  if (!size) {
    throw new Error("The page has no viewport size.");
  }
  return {
    references: new Map([["signals", requiredBoxOf(signals)]]),
    rest,
    viewport: size,
  };
}

async function pressSettled(
  page: Page,
  chord: string,
  label: string,
): Promise<void> {
  await page.evaluate(markTrustedInputSequence, [
    {
      eventType: "keydown",
      key: commandKey(chord),
      label,
    } satisfies TrustedInputMark,
  ]);
  await page.keyboard.press(chord);
  await waitForRest(page);
}

interface KeyboardSequenceRequest {
  chord: string;
  label: string;
  travelPx: number | null;
}

async function pressKeyboardSequence(
  page: Page,
  requests: readonly KeyboardSequenceRequest[],
): Promise<void> {
  await page.evaluate(
    markTrustedInputSequence,
    requests.map(
      ({ chord, label, travelPx }) =>
        ({
          eventType: "keydown",
          key: commandKey(chord),
          label,
          ...(travelPx === null ? {} : { travelOriginPaneId: "signals" }),
        }) satisfies TrustedInputMark,
    ),
  );
  const session = await page.context().newCDPSession(page);
  try {
    const commandReceipts: DeferredActionReceipt<void>[] = [];
    for (const { chord, label, travelPx } of requests) {
      const inFlightEvidence =
        travelPx === null
          ? null
          : waitForMarkedTravel(session, label, travelPx);
      const command = pressTrustedKeyboardChord(session, chord);
      const evidence = inFlightEvidence ?? waitForRest(page);
      commandReceipts.push(
        await waitForEvidenceBeforeActionCompletion(evidence, command),
      );
    }
    for (const receipt of commandReceipts) {
      await receipt.complete();
    }
  } finally {
    await session.detach();
  }
}

function commandKey(chord: string): string {
  return chord.split("+").at(-1) ?? chord;
}

async function clickSettled(
  page: Page,
  target: Locator,
  label: string,
): Promise<void> {
  await page.evaluate(markTrustedInputSequence, [
    {
      eventType: "click",
      label,
    } satisfies TrustedInputMark,
  ]);
  await target.click();
  await waitForRest(page);
}

async function focusPaneDirectly(
  page: Page,
  paneId: PaneId,
  label: string,
): Promise<void> {
  const accepted = await requestDirectFocus(page, paneId, label);
  expect(accepted, `${label}: focusPane was accepted`).toBe(true);
  await waitForRest(page);
}

async function focusPaneInFlight(
  page: Page,
  paneId: PaneId,
  label: string,
  travelPx: number,
): Promise<DeferredActionReceipt<boolean>> {
  const origin = await cameraX(page);
  const evidence = waitForTravel(page, origin, travelPx);
  const request = requestDirectFocus(page, paneId, label);
  return waitForEvidenceBeforeActionCompletion(evidence, request);
}

function requestDirectFocus(
  page: Page,
  paneId: PaneId,
  label: string,
): Promise<boolean> {
  return page.evaluate(
    (request) => {
      const probe = window.__onirigiriOneDimensionalPlayground;
      const trajectory = window.__onirigiriTrajectoryProbe;
      if (!probe || !trajectory) {
        throw new Error(
          "The playground probe or trajectory sampler is unavailable.",
        );
      }
      trajectory.capture.marks.push({
        label: request.label,
        timeMs: performance.now(),
      });
      return probe.focusPane(request.paneId);
    },
    { label, paneId },
  );
}

async function cameraX(page: Page): Promise<number> {
  return pane(page, "signals").evaluate(
    (element) => element.getBoundingClientRect().x,
  );
}

async function waitForTravel(
  page: Page,
  originX: number,
  travelPx: number,
): Promise<void> {
  await page.waitForFunction(
    ([origin, distance]) => {
      const sample =
        window.__onirigiriTrajectoryProbe?.capture.frames.at(-1)?.panes.signals;
      return (
        sample !== null &&
        sample !== undefined &&
        Math.abs(sample.x - origin) >= distance
      );
    },
    [originX, travelPx] as const,
    { polling: "raf", timeout: settleTimeoutMs },
  );
}

async function pressTrustedKeyboardChord(
  session: CDPSession,
  chord: string,
): Promise<void> {
  const keyCodes: Record<string, number> = {
    ArrowDown: 40,
    ArrowLeft: 37,
    ArrowRight: 39,
    ArrowUp: 38,
  };
  const [modifier, key] = chord.split("+");
  const keyCode = key ? keyCodes[key] : undefined;
  if (modifier !== "Alt" || !key || keyCode === undefined) {
    throw new Error(`Unsupported trusted keyboard chord: ${chord}`);
  }
  const event = {
    code: key,
    key,
    modifiers: 1,
    nativeVirtualKeyCode: keyCode,
    windowsVirtualKeyCode: keyCode,
  };
  await session.send("Input.dispatchKeyEvent", { ...event, type: "keyDown" });
  await session.send("Input.dispatchKeyEvent", { ...event, type: "keyUp" });
}

async function waitForMarkedTravel(
  session: CDPSession,
  label: string,
  travelPx: number,
): Promise<void> {
  const result = await session.send("Runtime.evaluate", {
    awaitPromise: true,
    expression: `(${waitForMarkedTravelInPage.toString()})(${JSON.stringify(label)}, ${travelPx}, ${settleTimeoutMs})`,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    throw new Error(
      `Unable to observe ${label} in-flight travel: ${result.exceptionDetails.text}`,
    );
  }
}

function waitForMarkedTravelInPage(
  requestLabel: string,
  distance: number,
  timeoutMs: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const deadline = performance.now() + timeoutMs;
    const positionsAfterMark = (
      capture: TrajectoryCapture,
      mark: TrajectoryCapture["marks"][number],
      origin: number,
    ): number[] => {
      const positions: number[] = [];
      for (const frame of capture.frames) {
        if (frame.sampledAtMs < mark.timeMs) {
          continue;
        }
        const sample = frame.panes.signals;
        if (!sample || Math.abs(sample.x - origin) < 0.1) {
          continue;
        }
        positions.push(sample.x);
      }
      return positions;
    };
    const markedTravel = () => {
      const capture = window.__onirigiriTrajectoryProbe?.capture;
      const mark = capture?.marks.findLast(
        (candidate) => candidate.label === requestLabel,
      );
      const origin = mark?.travelOriginX;
      if (!capture || !mark || origin === undefined) {
        return null;
      }
      return { origin, positions: positionsAfterMark(capture, mark, origin) };
    };
    const reachedTravel = () => {
      const travel = markedTravel();
      if (!travel) {
        return false;
      }
      if (new Set(travel.positions.map((entry) => entry.toFixed(1))).size < 2) {
        return false;
      }
      const position = travel.positions.at(-1);
      if (position === undefined) {
        return false;
      }
      return Math.abs(position - travel.origin) >= distance;
    };
    const check = () => {
      if (reachedTravel()) {
        resolve();
        return;
      }
      if (performance.now() >= deadline) {
        reject(new Error(`Timed out waiting for ${requestLabel} travel.`));
        return;
      }
      requestAnimationFrame(check);
    };
    requestAnimationFrame(check);
  });
}

async function waitForRest(page: Page): Promise<void> {
  await page.waitForTimeout(movementStartGraceMs);
  await page.waitForFunction(
    () =>
      document.querySelector('.onirigiri-pane[data-moving="true"]') === null,
    undefined,
    { polling: "raf", timeout: settleTimeoutMs },
  );
  await page.waitForTimeout(restCaptureMs);
}

async function captureWindows<Count extends number>(
  page: Page,
  expectedCount: Count,
): Promise<Tuple<RequestWindow, Count>> {
  const windows = requestWindows(await page.evaluate(stopTrajectorySampler));
  expect(
    windows.map((window) => window.label),
    "every request was marked",
  ).toHaveLength(expectedCount);
  return windows as Tuple<RequestWindow, Count>;
}

async function consumerRenders(
  page: Page,
): Promise<readonly OneDimensionalConsumerRender[]> {
  return page.evaluate(() => {
    const probe = window.__onirigiriOneDimensionalPlayground;
    if (!probe) {
      throw new Error("The playground probe is unavailable.");
    }
    return probe.consumerRenders();
  });
}

async function paneBoxes(page: Page): Promise<RestGeometry> {
  const boxes = await page.evaluate((ids) => {
    const entries = ids.map((paneId) => {
      const element = document.querySelector<HTMLElement>(
        `.onirigiri-pane[data-onirigiri-pane-id="${paneId}"]`,
      );
      if (!element) {
        return [paneId, null] as const;
      }
      const rect = element.getBoundingClientRect();
      return [
        paneId,
        {
          height: Number(rect.height.toFixed(2)),
          moving: element.dataset.moving === "true",
          runtimeState: element.dataset.runtimeState ?? null,
          visible: element.dataset.visible === "true",
          width: Number(rect.width.toFixed(2)),
          x: Number(rect.x.toFixed(2)),
          y: Number(rect.y.toFixed(2)),
        },
      ] as const;
    });
    return Object.fromEntries(entries);
  }, paneIds);
  return boxes as RestGeometry;
}

interface SeededConsumerState {
  canvasPixel: readonly number[];
  noteText: string;
  scrollTop: number;
}

async function seedConsumerState(page: Page): Promise<SeededConsumerState> {
  const notes = pane(page, "notes");
  const textarea = notes.locator("textarea");
  const noteText = Array.from(
    { length: 40 },
    (_, index) => `Retained line ${index + 1}`,
  ).join("\n");
  await textarea.fill(noteText);
  await expect(textarea).toHaveValue(noteText);
  const firstTask = pane(page, "tasks").locator(".task-list li").first();
  await expect(firstTask).toHaveAttribute("data-done", "true");
  await firstTask.locator("input[type=checkbox]").uncheck();
  await expect(firstTask).toHaveAttribute("data-done", "false");
  const seeded = await notes.evaluate((host) => {
    const textarea = host.querySelector<HTMLTextAreaElement>("textarea");
    const panel = host.querySelector<HTMLElement>(".demo-panel");
    if (!textarea || !panel) {
      throw new Error("The notes pane has no consumer surfaces.");
    }
    textarea.scrollTop = 48;
    textarea.dataset.onirigiriRoundTrip = "textarea";
    const canvas = document.createElement("canvas");
    canvas.width = 8;
    canvas.height = 8;
    canvas.dataset.onirigiriRoundTrip = "canvas";
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("The notes pane canvas has no 2D context.");
    }
    context.fillStyle = "rgb(10, 200, 30)";
    context.fillRect(0, 0, 8, 8);
    panel.append(canvas);
    return {
      canvasPixel: [...context.getImageData(3, 3, 1, 1).data],
      scrollTop: textarea.scrollTop,
    };
  });
  expect(seeded.scrollTop, "the seeded note scrolls").toBeGreaterThan(0);
  return { ...seeded, noteText };
}

async function expectConsumerStateRetained(
  page: Page,
  seeded: SeededConsumerState,
): Promise<void> {
  const notes = pane(page, "notes");
  const retained = await notes.evaluate((host) => {
    const live = host.querySelector<HTMLElement>(
      ".onirigiri-pane__live-content",
    );
    const textarea = live?.querySelector<HTMLTextAreaElement>(
      'textarea[data-onirigiri-round-trip="textarea"]',
    );
    const canvas = live?.querySelector<HTMLCanvasElement>(
      'canvas[data-onirigiri-round-trip="canvas"]',
    );
    const context = canvas?.getContext("2d");
    return {
      canvasPixel: context ? [...context.getImageData(3, 3, 1, 1).data] : null,
      scrollTop: textarea?.scrollTop ?? null,
      value: textarea?.value ?? null,
    };
  });
  expect(retained.value, "the textarea node and React state survive").toBe(
    seeded.noteText,
  );
  expect(retained.scrollTop, "the scroll offset survives").toBe(
    seeded.scrollTop,
  );
  expect(retained.canvasPixel, "the canvas bitmap survives").toEqual(
    seeded.canvasPixel,
  );
  await expect(
    pane(page, "tasks").locator(".task-list li").first(),
  ).toHaveAttribute("data-done", "false");
}

function pane(page: Page, paneId: PaneId): Locator {
  return page.locator(`.onirigiri-pane[data-onirigiri-pane-id="${paneId}"]`);
}
