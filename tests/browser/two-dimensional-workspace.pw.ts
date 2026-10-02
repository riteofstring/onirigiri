import { expect, test, type Locator, type Page } from "@playwright/test";

import {
  expectAnimatedTrajectory,
  expectMovingWasObserved,
  observeMovingState,
} from "./two-dimensional-motion-assertions";
import {
  boxGeometry,
  boxIsUsable,
  boxPosition,
  centerX,
  centerY,
  computedOpacity,
  edgeDelta,
  expectCentersToMatch,
  expectReachableControls,
  pageOverflow,
  presentedPaneCountOnStage,
  rectDelta,
  requiredBox,
} from "./two-dimensional-workspace-geometry";

const workspaceName = "Interactive two-dimensional Onirigiri playground";

test("creates and moves a plane using only keyboard commands with visible focus", async ({
  page,
}) => {
  await openPlayground(page);
  const workspace = page.getByRole("region", { name: workspaceName });
  const maximize = pane(page, "north-signals").getByRole("button", {
    name: "Maximize pane",
  });

  await expect(
    desktopControls(page).getByRole("button", { name: "Move cursor down" }),
  ).toBeVisible();
  await workspace.focus();
  expect((await focusOutline(workspace)).style).toBe("none");
  await page.keyboard.press("Tab");
  await expect(maximize).toBeFocused();
  expect(await focusOutline(maximize)).toEqual({ style: "solid", width: 2 });

  await page.keyboard.press("Control+Shift+BracketRight");
  await expect(
    page.getByRole("status", { name: "Playground status" }),
  ).toContainText("7 windows");
  await expect(page.locator(".telemetry-value")).toHaveText("P2 · S1 · R1");
  const createdPane = page.locator('.onirigiri-pane[data-focused="true"]');
  const createdPaneId = await requiredAttribute(
    createdPane,
    "data-onirigiri-pane-id",
  );
  expect(await activePaneId(page)).toBe(createdPaneId);

  await page.keyboard.press("Alt+Control+ArrowDown");
  await expect(workspace.locator('[data-onirigiri-slot="status"]')).toHaveText(
    /Moved Pane 007 down to grid cell/,
  );
  await expect(pane(page, createdPaneId)).toHaveAttribute(
    "data-focused",
    "true",
  );
  expect(await activePaneId(page)).toBe(createdPaneId);
});

test("keeps repeatedly added lower planes reachable through overview and reversal", async ({
  page,
}) => {
  test.setTimeout(45_000);
  await openPlayground(page);
  const workspace = page.getByRole("region", { name: workspaceName });
  const stage = page.locator(".onirigiri-workspace__stage");
  const addMenu = page
    .locator("details.playground-add-menu")
    .filter({ hasText: "Plane below" });
  const paneIds = ["north-signals"];

  for (let row = 1; row <= 8; row += 1) {
    if ((await addMenu.getAttribute("open")) === null) {
      await addMenu.locator("summary").click();
    }
    await addMenu.getByRole("button", { name: "Plane below" }).click();
    await expect(page.locator(".telemetry-value")).toHaveText(
      `P${row + 1} · S1 · R1`,
    );
    const focusedPane = workspace.locator(
      '.onirigiri-pane[data-focused="true"]',
    );
    await expect(focusedPane).toHaveAttribute("data-moving", "false");
    const paneId = await requiredAttribute(
      focusedPane,
      "data-onirigiri-pane-id",
    );
    expect(paneIds).not.toContain(paneId);
    paneIds.push(paneId);
    await expectPaneOnStage(stage, focusedPane);
  }

  await page
    .getByRole("button", { name: "Zoom out to workspace overview" })
    .click();
  await expect(workspace).toHaveAttribute("data-presentation-mode", "overview");
  await expectPaneOnStage(stage, pane(page, paneIds.at(-1)!));

  for (const paneId of paneIds.slice(0, -1).reverse()) {
    await page.keyboard.press("Alt+ArrowUp");
    const target = pane(page, paneId);
    await expect(target).toHaveAttribute("data-focused", "true");
    await expect(target).toHaveAttribute("data-moving", "false");
    await expect(target).toHaveAttribute("data-visible", "true");
    await expectPaneOnStage(stage, target);
  }

  await pane(page, paneIds[0]!).click();
  await expect(workspace).toHaveAttribute("data-presentation-mode", "normal");
  for (const paneId of paneIds.slice(1)) {
    await page.keyboard.press("Alt+ArrowDown");
    const target = pane(page, paneId);
    await expect(target).toHaveAttribute("data-focused", "true");
    await expect(target).toHaveAttribute("data-moving", "false");
    await expectPaneOnStage(stage, target);
  }

  await page.keyboard.press("Alt+ArrowUp");
  const reversed = pane(page, paneIds.at(-2)!);
  await expect(reversed).toHaveAttribute("data-focused", "true");
  await expect(reversed).toHaveAttribute("data-moving", "false");
  await expectPaneOnStage(stage, reversed);
});

test("applies a cursor runway without remounting and returns home", async ({
  page,
}) => {
  await openPlayground(page);
  const workspace = page.getByRole("region", { name: workspaceName });
  const homePane = pane(page, "north-signals");

  await openMoreMenu(page);
  const runway = page.locator("details.cursor-runway-control");
  await runway.locator("summary").click();
  await runway
    .getByRole("spinbutton", { name: "Cells beyond each edge" })
    .fill("1");
  await runway.getByRole("button", { name: "Apply runway" }).click();
  await expect(
    page.getByRole("status", { name: "Playground status" }),
  ).toContainText("Cursor runway set to 1 cell");

  await workspace.focus();
  await page.keyboard.press("Alt+ArrowLeft");
  await expect(
    workspace.locator('[data-onirigiri-slot="status"]'),
  ).toContainText("Grid cell (-1, 0)");
  await page.keyboard.press("Alt+ArrowLeft");
  await expect(
    workspace.locator('[data-onirigiri-slot="status"]'),
  ).toContainText("Grid cell (-1, 0)");

  const home = page.getByRole("button", { name: "Return to workspace home" });
  await expect(home).toHaveAttribute("aria-keyshortcuts", "Alt+Shift+Home");
  await home.click();
  await expect(homePane).toHaveAttribute("data-focused", "true");
  await expect(homePane).toHaveAttribute("data-moving", "false");

  await openMoreMenu(page);
  if ((await runway.getAttribute("open")) === null) {
    await runway.locator("summary").click();
  }
  await runway
    .getByRole("spinbutton", { name: "Cells beyond each edge" })
    .fill("");
  await runway.getByRole("button", { name: "Apply runway" }).click();
  await workspace.focus();
  for (let step = 0; step < 3; step += 1) {
    await page.keyboard.press("Alt+ArrowLeft");
  }
  await expect(
    workspace.locator('[data-onirigiri-slot="status"]'),
  ).toContainText("Grid cell (-3, 0)");
});

test("rearranges adjacent pane cells with Onirigiri keyboard commands", async ({
  page,
}) => {
  await page.setViewportSize({ height: 2_160, width: 3_840 });
  await openPlayground(page);
  const workspace = page.getByRole("region", { name: workspaceName });
  const signals = pane(page, "north-signals");
  const atlas = pane(page, "north-atlas");
  const status = workspace.locator('[data-onirigiri-slot="status"]');
  const initialHorizontalGap =
    (await requiredBox(atlas)).x - (await requiredBox(signals)).x;
  await signals.focus();

  await page.keyboard.press("Alt+Control+ArrowRight");
  await expect(signals).toHaveAttribute("data-focused", "true");
  expect(await activePaneId(page)).toBe("north-signals");
  await expect(status).toHaveText(/Moved Signal lab right to grid cell/);
  await expect
    .poll(
      async () => (await requiredBox(atlas)).x - (await requiredBox(signals)).x,
    )
    .toBeLessThan(initialHorizontalGap);
  expect(
    (await requiredBox(atlas)).x - (await requiredBox(signals)).x,
  ).toBeGreaterThan(0);

  await page.keyboard.press("Alt+Control+h");
  await expect(status).toHaveText(/Moved Signal lab left to grid cell/);
  await expect
    .poll(
      async () => (await requiredBox(atlas)).x - (await requiredBox(signals)).x,
    )
    .toBeCloseTo(initialHorizontalGap, 0);

  await page.keyboard.press("Alt+ArrowDown");
  await expect(pane(page, "middle-tasks")).toHaveAttribute(
    "data-focused",
    "true",
  );
  await page.keyboard.press("Alt+Control+j");
  await expect(status).toHaveText(/Moved Focus board down to grid cell/);
  await expect(pane(page, "middle-tasks")).toHaveAttribute(
    "data-focused",
    "true",
  );

  await page.keyboard.press("Alt+Control+ArrowUp");
  await expect(status).toHaveText(/Moved Focus board up to grid cell/);

  await page.keyboard.press("Alt+Control+l");
  await expect(status).toHaveText(/Moved Focus board right to grid cell/);
  await expect(pane(page, "middle-tasks")).toHaveAttribute(
    "data-onirigiri-column-id",
    "middle-system-column",
  );
  await expect(pane(page, "middle-system")).toHaveAttribute(
    "data-onirigiri-column-id",
    "middle-focus-column",
  );
});

function samplePaneSizeTrajectory(page: Page): Promise<number[]> {
  return page.evaluate(
    (durationMs) =>
      new Promise<number[]>((resolve) => {
        const values: number[] = [];
        const startedAt = performance.now();
        const sample = (timestamp: number) => {
          const pane = document.querySelector<HTMLElement>(
            '[data-onirigiri-pane-id="north-signals"]',
          );
          values.push(pane?.getBoundingClientRect().width ?? 0);
          if (timestamp - startedAt >= durationMs) {
            resolve(values);
            return;
          }
          requestAnimationFrame(sample);
        };
        requestAnimationFrame(sample);
      }),
    240,
  );
}

test("moves through empty grid cells, reuses the D-pad, and opens shortcut help", async ({
  page,
}) => {
  await openPlayground(page);
  const workspace = page.getByRole("region", { name: workspaceName });
  const playgroundControls = page.getByRole("group", {
    name: "Playground controls",
  });
  const controls = page.getByRole("group", { name: "Workspace controls" });
  const directionButtons = [
    page.getByRole("button", { name: "Move cursor up" }),
    page.getByRole("button", { name: "Move cursor down" }),
    page.getByRole("button", { name: "Move cursor left" }),
    page.getByRole("button", { name: "Move cursor right" }),
  ];

  await expect(playgroundControls.getByRole("button")).toHaveCount(3);
  await expect(
    playgroundControls.getByRole("button", { name: "Undo layout" }),
  ).toBeVisible();
  await expect(
    playgroundControls.getByRole("button", { name: "Redo layout" }),
  ).toBeVisible();
  await expect(
    playgroundControls.getByRole("button", { name: "Keyboard shortcuts" }),
  ).toBeVisible();
  const addMenu = page.locator(".playground-add-menu").filter({
    has: page.locator("summary", { hasText: /^Add$/ }),
  });
  await expect(addMenu).not.toHaveAttribute("open", "");
  await expect(
    addMenu.locator(".playground-add-menu__panel"),
  ).not.toBeVisible();
  await expect(page.locator(".playground-more-menu")).not.toHaveAttribute(
    "open",
    "",
  );
  await expect(page.locator(".playground-more-menu__panel")).not.toBeVisible();

  await expect(controls).toBeVisible();
  for (const button of directionButtons) {
    await expect(button).toHaveJSProperty("tagName", "BUTTON");
    expect(
      boxIsUsable(await requiredBox(button), { height: 900, width: 1_280 }),
    ).toBe(true);
  }

  const focusRight = page.getByRole("button", { name: "Move cursor right" });
  await focusRight.hover();
  await expect(focusRight).toHaveAttribute(
    "aria-keyshortcuts",
    "Alt+ArrowRight Alt+L",
  );
  await expect(
    page.locator('[data-onirigiri-slot="toolbar"] [role="tooltip"]'),
  ).toHaveCount(0);

  await focusRight.click();
  await expect(workspace.locator('[data-onirigiri-slot="status"]')).toHaveText(
    /Grid cell \(1, 0\), split 1: Empty cell/,
  );
  await expect(pane(page, "north-signals")).toHaveAttribute(
    "data-focused",
    "false",
  );
  await focusRight.click();
  await expect(pane(page, "north-atlas")).toHaveAttribute(
    "data-focused",
    "true",
  );
  await expect(focusRight).not.toHaveAttribute("aria-disabled", "true");

  const atlas = pane(page, "north-atlas");
  const atlasBeforeMove = await requiredBox(atlas);
  await page
    .getByRole("combobox", { name: "D-pad action" })
    .selectOption("move-pane");
  await page.getByRole("button", { name: "Move pane left" }).click();
  await expect
    .poll(async () => (await requiredBox(atlas)).x)
    .toBeLessThan(atlasBeforeMove.x);

  await page.getByRole("button", { name: "Keyboard shortcuts" }).click();
  const shortcutDialog = page.getByRole("dialog", {
    name: "Keyboard shortcuts",
  });
  await expect(shortcutDialog).toBeVisible();
  for (const section of ["Navigate", "Move", "Arrange", "History"]) {
    await expect(
      shortcutDialog.getByRole("heading", { name: section }),
    ).toBeVisible();
  }
  await shortcutDialog.getByRole("button", { name: "Done" }).click();
  await expect(shortcutDialog).not.toBeVisible();
});

test("previews the full mobile workspace, optional pane peeks, and bottom navigation", async ({
  page,
}) => {
  await page.setViewportSize({ height: 850, width: 1_440 });
  await openPlayground(page);
  const shell = page.locator(".playground-shell");
  const workspace = page.getByRole("region", { name: workspaceName });
  const preview = page.locator(".playground-preview");
  const stage = page.locator(".onirigiri-workspace__stage");
  const toolbar = page.getByRole("group", { name: "Workspace controls" });

  await page
    .getByRole("button", { name: "Show mobile workspace preview" })
    .click();
  await expect(shell).toHaveAttribute("data-preview-mode", "mobile");
  await expect(workspace).toHaveAttribute("data-compact-layout", "true");
  await expect(workspace).toHaveAttribute("data-compact-pane-peek", "false");
  expect((await requiredBox(preview)).width).toBeLessThanOrEqual(390.5);

  const stageBox = await requiredBox(stage);
  const toolbarBox = await requiredBox(toolbar);
  const focusedPane = pane(page, "north-signals");
  await expect(focusedPane).toHaveAttribute("data-moving", "false");
  expect(
    rectDelta(stageBox, await requiredBox(focusedPane)),
  ).toBeLessThanOrEqual(1);
  expect(toolbarBox.y).toBeGreaterThanOrEqual(stageBox.y + stageBox.height - 1);
  expect(
    await stage.evaluate(
      (element) => getComputedStyle(element).backgroundImage,
    ),
  ).toBe("none");
  expect(
    await focusedPane.evaluate(
      (element) => getComputedStyle(element).borderRadius,
    ),
  ).toBe("0px");
  expect(
    await focusedPane.evaluate(
      (element) => getComputedStyle(element).boxShadow,
    ),
  ).toBe("none");
  await expect(focusedPane).toHaveAttribute("data-runtime-state", "live");
  await expect(
    workspace.locator('.onirigiri-pane[data-runtime-state="live"]'),
  ).toHaveCount(1);
  await expect(workspace.locator(".onirigiri-pane__resize")).toHaveCount(0);

  await page.getByRole("button", { name: "Peek at adjacent panes" }).click();
  await expect(shell).toHaveAttribute("data-mobile-peek", "true");
  await expect(workspace).toHaveAttribute("data-compact-pane-peek", "true");
  const insetFocusedBox = await requiredBox(focusedPane);
  expect(insetFocusedBox.x - stageBox.x).toBeGreaterThanOrEqual(25);
  expect(
    stageBox.x + stageBox.width - (insetFocusedBox.x + insetFocusedBox.width),
  ).toBeGreaterThanOrEqual(25);
  const adjacentPane = pane(page, "north-atlas");
  await expect(adjacentPane).toHaveAttribute("data-visible", "false");

  await page.getByRole("button", { name: "Move cursor right" }).click();
  await expect(workspace.locator('[data-onirigiri-slot="status"]')).toHaveText(
    /Empty cell/,
  );
  await expect(adjacentPane).toHaveAttribute("data-visible", "true");
  await expect(adjacentPane).toHaveAttribute("data-moving", "false");
  const adjacentBox = await requiredBox(adjacentPane);
  expect(stageBox.x + stageBox.width - adjacentBox.x).toBeGreaterThanOrEqual(
    17,
  );
  expect(stageBox.x + stageBox.width - adjacentBox.x).toBeLessThanOrEqual(19);
  await expect(adjacentPane).toHaveAttribute("data-runtime-state", "live");
  await expect(adjacentPane).toHaveAttribute("inert", "");

  await page.getByRole("button", { name: "Move cursor right" }).click();
  await expect(adjacentPane).toHaveAttribute("data-focused", "true");
  await expect(adjacentPane).toHaveAttribute("data-moving", "false");
  await expect(adjacentPane).toHaveAttribute("data-runtime-state", "live");
  await expect(focusedPane).toHaveAttribute("data-runtime-state", "hidden");
  await expect(
    workspace.locator('.onirigiri-pane[data-runtime-state="live"]'),
  ).toHaveCount(1);

  await page
    .getByRole("button", { name: "Show desktop workspace preview" })
    .click();
  await expect(shell).toHaveAttribute("data-preview-mode", "desktop");
  await expect(workspace).toHaveAttribute("data-compact-layout", "false");
  expect((await requiredBox(preview)).width).toBeGreaterThan(1_000);
  await expect(
    adjacentPane.locator(".onirigiri-pane__resize--column"),
  ).toHaveCount(1);
});

test("keeps unfocused pane actions available and puts resize handles on the pane edges", async ({
  page,
}) => {
  await page.setViewportSize({ height: 850, width: 1_600 });
  await openPlayground(page);

  const focusedPane = pane(page, "north-signals");
  const unfocusedPane = pane(page, "north-atlas");
  const focusedActions = focusedPane.locator(".onirigiri-pane__actions");
  const unfocusedActions = unfocusedPane.locator(".onirigiri-pane__actions");
  const unfocusedButtons = unfocusedActions.getByRole("button");

  await expect(unfocusedPane).toHaveAttribute("data-focused", "false");
  await expect(unfocusedActions).toHaveAttribute("aria-hidden", "false");
  await expect(unfocusedButtons).toHaveCount(2);
  for (let index = 0; index < (await unfocusedButtons.count()); index += 1) {
    await expect(unfocusedButtons.nth(index)).toBeVisible();
    await expect(unfocusedButtons.nth(index)).toBeEnabled();
  }

  expect(await computedOpacity(unfocusedActions)).toBeLessThan(
    await computedOpacity(focusedActions),
  );
  await unfocusedActions.hover();
  await expect
    .poll(async () => computedOpacity(unfocusedActions))
    .toBeGreaterThan(0.95);

  const titlebarBox = await requiredBox(
    focusedPane.locator(".onirigiri-pane__titlebar"),
  );
  const firstActionBox = await requiredBox(
    focusedPane.getByRole("button", { name: "Maximize pane" }),
  );
  expect(titlebarBox.height).toBeLessThanOrEqual(42);
  expect(firstActionBox.height).toBeGreaterThanOrEqual(24);
  expect(firstActionBox.height).toBeLessThanOrEqual(30);

  const paneBox = await requiredBox(focusedPane);
  const columnHandleBox = await requiredBox(
    focusedPane.locator(".onirigiri-pane__resize--column"),
  );
  const rowHandleBox = await requiredBox(
    focusedPane.locator(".onirigiri-pane__resize--row"),
  );
  expect(
    edgeDelta(
      columnHandleBox.x + columnHandleBox.width,
      paneBox.x + paneBox.width,
    ),
  ).toBeLessThanOrEqual(1);
  expect(edgeDelta(columnHandleBox.y, paneBox.y)).toBeLessThanOrEqual(1);
  expect(edgeDelta(columnHandleBox.height, paneBox.height)).toBeLessThanOrEqual(
    1,
  );
  expect(edgeDelta(rowHandleBox.x, paneBox.x)).toBeLessThanOrEqual(1);
  expect(edgeDelta(rowHandleBox.width, paneBox.width)).toBeLessThanOrEqual(1);
  expect(
    edgeDelta(rowHandleBox.y + rowHandleBox.height, paneBox.y + paneBox.height),
  ).toBeLessThanOrEqual(1);
});

test("keeps pane content interactive without moving the scene until its title bar is selected", async ({
  page,
}) => {
  await page.setViewportSize({ height: 850, width: 1_600 });
  await openPlayground(page);
  const atlas = pane(page, "north-atlas");
  await expect(atlas).toHaveAttribute("data-visible", "true");
  await expect(atlas).toHaveAttribute("data-runtime-state", "live");
  const beforeContentUse = boxPosition(await requiredBox(atlas));

  const kyoto = page.getByRole("button", { name: "Select Kyoto" });
  await kyoto.dispatchEvent("pointerdown", { button: 0 });
  await kyoto.dispatchEvent("pointerup", { button: 0 });
  await kyoto.dispatchEvent("click", { button: 0 });
  await expect(atlas).toHaveAttribute("data-focused", "true");
  await expect(page.locator(".atlas-footer")).toContainText("Kyoto");
  await expect(atlas).toHaveAttribute("data-moving", "false");
  await page.waitForTimeout(50);
  expect(boxPosition(await requiredBox(atlas))).toBe(beforeContentUse);

  await observeMovingState(atlas);
  await atlas
    .locator(".onirigiri-pane__titlebar")
    .dispatchEvent("pointerdown", {
      button: 0,
    });
  await expectMovingWasObserved(page);
  await expect
    .poll(async () => boxPosition(await requiredBox(atlas)))
    .not.toBe(beforeContentUse);
  await expect(atlas).toHaveAttribute("data-moving", "false");
});

test("keeps split stacks aligned when their shared plane height is resized", async ({
  page,
}) => {
  await openPlayground(page);
  await page
    .getByRole("button", { name: "Zoom out to workspace overview" })
    .click();
  await pane(page, "middle-system").click();
  await expect(pane(page, "middle-system")).toHaveAttribute(
    "data-focused",
    "true",
  );
  await expect(pane(page, "middle-system")).toHaveAttribute(
    "data-moving",
    "false",
  );

  const systemPane = pane(page, "middle-system");
  const resizeHandle = systemPane.locator('button[data-resize-kind="row"]');
  await expect(resizeHandle).toHaveAccessibleName(
    "Resize row containing System map",
  );
  const beforeSystem = await requiredBox(systemPane);
  const handleBox = await requiredBox(resizeHandle);
  await page.mouse.move(centerX(handleBox), centerY(handleBox));
  await page.mouse.down();
  await page.mouse.move(centerX(handleBox), centerY(handleBox) - 120, {
    steps: 6,
  });
  await page.mouse.up();

  await expect
    .poll(async () => (await requiredBox(systemPane)).height)
    .toBeLessThan(beforeSystem.height - 80);
  await expect(systemPane).toHaveAttribute("data-moving", "false");
  const systemBox = await requiredBox(systemPane);
  const tasksBox = await requiredBox(pane(page, "middle-tasks"));
  const notesBox = await requiredBox(pane(page, "middle-notes"));
  expect(Math.abs(systemBox.y - tasksBox.y)).toBeLessThanOrEqual(1);
  expect(
    Math.abs(systemBox.y + systemBox.height - (notesBox.y + notesBox.height)),
  ).toBeLessThanOrEqual(1);
  expect(notesBox.y).toBeGreaterThan(tasksBox.y + tasksBox.height);
});

test("supports persistent dark and light themes with readable pane chrome", async ({
  page,
}) => {
  await openPlayground(page);

  await useColorMode(page, "dark");
  const darkTheme = await themeMetrics(page);
  expect(darkTheme.colorScheme).toContain("dark");
  expect(darkTheme.headingContrast).toBeGreaterThanOrEqual(4.5);
  expect(darkTheme.subtitleContrast).toBeGreaterThanOrEqual(4.5);
  expect(darkTheme.paneShadow).not.toBe("none");

  await useColorMode(page, "light");
  const lightTheme = await themeMetrics(page);
  expect(lightTheme.colorScheme).toContain("light");
  expect(lightTheme.headingContrast).toBeGreaterThanOrEqual(4.5);
  expect(lightTheme.subtitleContrast).toBeGreaterThanOrEqual(4.5);
  expect(lightTheme.paneShadow).not.toBe("none");
  expect(lightTheme.workspaceBackground).not.toBe(
    darkTheme.workspaceBackground,
  );
  expect(lightTheme.paneBackground).not.toBe(lightTheme.workspaceBackground);

  await page.reload();
  await expect(page.locator(".playground-shell")).toHaveAttribute(
    "data-color-mode",
    "light",
  );
  await expect(page.locator("html")).toHaveAttribute(
    "data-color-mode",
    "light",
  );
  await expect(page.locator(".playground-theme-toggle")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

test("preserves region semantics and visible controls in forced colors", async ({
  page,
}) => {
  test.slow();
  await page.emulateMedia({ forcedColors: "active" });
  await openPlayground(page);

  const workspace = page.getByRole("region", { name: workspaceName });
  const control = desktopControls(page).getByRole("button", {
    name: "Move cursor down",
  });
  const source = pane(page, "north-signals");
  await control.focus();

  await expect(workspace).toHaveAttribute(
    "data-onirigiri-styling-version",
    "8",
  );
  await expect(desktopControls(page)).toHaveAttribute(
    "data-onirigiri-styling-version",
    "8",
  );
  const outline = await focusOutline(control);
  expect(outline.style).toBe("solid");
  expect(outline.width).toBeGreaterThanOrEqual(2);
  expect(
    await control.evaluate((element) => getComputedStyle(element).borderStyle),
  ).toBe("solid");
  expect(
    await source.evaluate((element) => getComputedStyle(element).borderStyle),
  ).toBe("solid");
});

test("exposes low-friction theme tokens and stable component slots", async ({
  page,
}) => {
  await openPlayground(page);
  await page.evaluate(() => {
    const hostTheme = document.createElement("style");
    hostTheme.dataset.testHostTheme = "true";
    hostTheme.textContent = `
      .onirigiri-workspace {
        --onirigiri-control-size: 12px;
        --onirigiri-minimum-target-size: 26px;
        --onirigiri-pane-action-size: 12px;
        --onirigiri-pane-radius: 18px;
        --onirigiri-titlebar-min-height: 44px;
      }

      .onirigiri-workspace__desktop-controls {
        --onirigiri-minimum-target-size: 36px;
      }
    `;
    document.head.prepend(hostTheme);
  });

  const workspace = page.getByRole("region", { name: workspaceName });
  const source = pane(page, "north-signals");
  const titlebar = source.locator('[data-onirigiri-slot="pane-titlebar"]');
  const control = desktopControls(page)
    .locator('[data-onirigiri-slot="control"]')
    .first();
  const paneAction = source
    .locator('[data-onirigiri-slot="pane-action"]')
    .first();

  await expect(workspace).toHaveAttribute("data-onirigiri-slot", "workspace");
  await expect(workspace).toHaveAttribute(
    "data-onirigiri-styling-version",
    "8",
  );
  await expect(desktopControls(page)).toHaveAttribute(
    "data-onirigiri-workspace-id",
    "onirigiri-playground-two-dimensional",
  );
  await expect(source).toHaveAttribute("data-onirigiri-slot", "pane");
  expect((await requiredBox(control)).width).toBeCloseTo(36, 0);
  expect((await requiredBox(paneAction)).width).toBeCloseTo(26, 0);
  expect((await requiredBox(titlebar)).height).toBeGreaterThanOrEqual(44);
  expect(
    await source.evaluate((element) => getComputedStyle(element).borderRadius),
  ).toBe("18px");
});

test("fits, minimizes, and expands all panes from compact accessible controls", async ({
  page,
}) => {
  await page.setViewportSize({ height: 900, width: 1_600 });
  await openPlayground(page);
  await openMoreMenu(page);
  const sizingControls = page.getByRole("group", { name: "Resize all panes" });
  const fit = sizingControls.getByRole("button", {
    name: "Fit all panes to content",
  });
  const minimum = sizingControls.getByRole("button", {
    name: "Shrink all panes to minimum size",
  });
  const full = sizingControls.getByRole("button", {
    name: "Expand all panes to full size",
  });

  await expect(sizingControls.getByRole("button")).toHaveCount(4);
  await fit.hover();
  const tooltipId = await requiredAttribute(fit, "aria-describedby");
  await expect(
    page.locator(`[id="${tooltipId}"][role="tooltip"]`),
  ).toBeVisible();

  const beforeFit = await inlinePaneSize(pane(page, "north-signals"));
  await fit.click();
  await expect
    .poll(async () => inlinePaneSize(pane(page, "north-signals")))
    .not.toEqual(beforeFit);
  const fittedSizes = await page
    .locator(".onirigiri-pane")
    .evaluateAll((panes) =>
      panes.map((pane) => ({
        height: Number.parseFloat((pane as HTMLElement).style.height),
        width: Number.parseFloat((pane as HTMLElement).style.width),
      })),
    );
  expect(
    new Set(fittedSizes.map((size) => size.height)).size,
  ).toBeGreaterThanOrEqual(3);
  expect(
    new Set(fittedSizes.map((size) => size.width)).size,
  ).toBeGreaterThanOrEqual(2);

  await minimum.click();
  await expect
    .poll(async () => inlinePaneSize(pane(page, "north-signals")))
    .toEqual({
      height: 96,
      width: 96,
    });

  const stageBox = await requiredBox(
    page.locator(".onirigiri-workspace__stage"),
  );
  await full.click();
  await expect
    .poll(async () => {
      const size = await inlinePaneSize(pane(page, "north-signals"));
      return Math.max(
        Math.abs(size.height - (stageBox.height - 20)),
        Math.abs(size.width - (stageBox.width - 20)),
      );
    })
    .toBeLessThanOrEqual(1);

  await page
    .getByRole("button", { name: "Show mobile workspace preview" })
    .click();
  await openMoreMenu(page);
  for (const button of [fit, minimum, full]) {
    await expect(button).toBeDisabled();
  }
  await page
    .getByRole("button", { name: "Show desktop workspace preview" })
    .click();
  await openMoreMenu(page);
  for (const button of [fit, minimum, full]) {
    await expect(button).toBeEnabled();
  }
});

test("toggles centered focus and keeps a resized row centered on both axes", async ({
  page,
}) => {
  await page.setViewportSize({ height: 900, width: 1_600 });
  await openPlayground(page);
  await openMoreMenu(page);
  const workspace = page.getByRole("region", { name: workspaceName });
  const stage = page.locator(".onirigiri-workspace__stage");
  const focusedPane = pane(page, "north-signals");
  const centerToggle = page.getByRole("button", {
    name: "Center focused panes",
  });

  await page
    .getByRole("button", { name: "Shrink all panes to minimum size" })
    .click();
  await expect(centerToggle).toHaveAttribute("aria-pressed", "true");
  await expect(workspace).toHaveAttribute("data-focus-anchor", "center");
  await expect(focusedPane).toHaveAttribute("data-moving", "false");
  expectCentersToMatch(
    await requiredBox(stage),
    await requiredBox(focusedPane),
  );

  const resizeHandle = focusedPane.locator('button[data-resize-kind="row"]');
  const beforeResize = await requiredBox(focusedPane);
  const resizeHandleBox = await requiredBox(resizeHandle);
  await page.mouse.move(centerX(resizeHandleBox), centerY(resizeHandleBox));
  await page.mouse.down();
  await page.mouse.move(
    centerX(resizeHandleBox),
    centerY(resizeHandleBox) + 80,
    { steps: 4 },
  );
  await page.mouse.up();
  await expect
    .poll(async () => (await requiredBox(focusedPane)).height)
    .toBeGreaterThan(beforeResize.height + 60);
  await expect(focusedPane).toHaveAttribute("data-moving", "false");
  expectCentersToMatch(
    await requiredBox(stage),
    await requiredBox(focusedPane),
  );

  await openMoreMenu(page);
  await centerToggle.click();
  await expect(centerToggle).toHaveAttribute("aria-pressed", "false");
  await expect(workspace).toHaveAttribute("data-focus-anchor", "start");
  await expect(focusedPane).toHaveAttribute("data-moving", "false");
  const startAlignedPane = await requiredBox(focusedPane);
  const stageBox = await requiredBox(stage);
  expect(startAlignedPane.x - stageBox.x).toBeCloseTo(10, 0);
  expect(startAlignedPane.y - stageBox.y).toBeCloseTo(10, 0);
});

test("focuses a pane from the minimap and snaps the minimap to a corner", async ({
  page,
}) => {
  await openPlayground(page);
  const workspace = page.getByRole("region", { name: workspaceName });
  await openMoreMenu(page);
  await page.getByRole("button", { name: "Minimap" }).click();
  await page.keyboard.press("Escape");
  const minimap = page.locator('[data-onirigiri-slot="minimap"]');
  const stageBox = await requiredBox(
    page.locator('[data-onirigiri-slot="stage"]'),
  );
  const minimapBox = await requiredBox(minimap);
  expect(
    stageBox.x + stageBox.width - (minimapBox.x + minimapBox.width),
  ).toBeCloseTo(12, 0);
  expect(
    stageBox.y + stageBox.height - (minimapBox.y + minimapBox.height),
  ).toBeCloseTo(12, 0);
  const target = minimap.locator(
    '[data-onirigiri-minimap-pane-id="middle-tasks"]',
  );
  await expect(target).toHaveAttribute("data-focused", "false");

  await target.click();
  await expect(pane(page, "middle-tasks")).toHaveAttribute(
    "data-focused",
    "true",
  );
  await expect(target).toHaveAttribute("data-focused", "true");
  expect(await requiredBox(minimap)).toMatchObject({
    height: minimapBox.height,
    width: minimapBox.width,
  });

  await page.mouse.move(minimapBox.x + 20, minimapBox.y + 20);
  await page.mouse.down();
  await page.mouse.move(stageBox.x + 60, stageBox.y + 60, { steps: 4 });
  await page.mouse.up();
  await expect(minimap).toHaveAttribute("data-corner", "top-left");
  const movedBox = await requiredBox(minimap);
  expect(movedBox.x - stageBox.x).toBeCloseTo(12, 0);
  expect(movedBox.y - stageBox.y).toBeCloseTo(12, 0);
  await expect(pane(page, "middle-tasks")).toHaveAttribute(
    "data-focused",
    "true",
  );

  await page
    .getByRole("button", { name: "Zoom out to workspace overview" })
    .click();
  await expect(workspace).toHaveAttribute("data-presentation-mode", "overview");
  await expect(minimap).toBeHidden();
});

test("keeps the focus highlight still on screen while the camera follows and can turn it off", async ({
  page,
}) => {
  await openPlayground(page);
  const workspace = page.getByRole("region", { name: workspaceName });
  const cursor = page.locator('[data-onirigiri-slot="grid-cursor"]');
  await workspace.focus();
  await page.keyboard.press("Alt+ArrowRight");
  await expect(cursor).toHaveAttribute("data-moving", "false");
  await expect(cursor).toHaveAttribute("data-cell-kind", "empty");

  const sampling = cursor.evaluate(
    (element) =>
      new Promise<{ center: number; worldX: number }[]>((resolve) => {
        const world = element.parentElement;
        const samples: { center: number; worldX: number }[] = [];
        const started = performance.now();
        const sample = () => {
          const box = element.getBoundingClientRect();
          samples.push({
            center: box.left + box.width / 2,
            worldX: world?.getBoundingClientRect().left ?? 0,
          });
          if (performance.now() - started < 600) {
            requestAnimationFrame(sample);
          } else {
            resolve(samples);
          }
        };
        sample();
      }),
  );
  await page.keyboard.press("Alt+ArrowRight");
  const samples = await sampling;
  await expect(pane(page, "north-atlas")).toHaveAttribute(
    "data-focused",
    "true",
  );

  const resting = samples[0]?.center ?? 0;
  const worldTravel = Math.abs(
    (samples.at(-1)?.worldX ?? 0) - (samples[0]?.worldX ?? 0),
  );
  expect(worldTravel).toBeGreaterThan(40);
  expect(
    Math.max(...samples.map((entry) => Math.abs(entry.center - resting))),
  ).toBeLessThanOrEqual(2);

  await openMoreMenu(page);
  await page.getByLabel("Focus highlight").selectOption("off");
  await expect(cursor).toHaveCount(0);
  await page.getByLabel("Focus highlight").selectOption("camera");
  await expect(cursor).toHaveCount(1);
});

test("opens overview and selects a pane", async ({ page }) => {
  await page.setViewportSize({ height: 700, width: 700 });
  await openPlayground(page);
  const workspace = page.getByRole("region", { name: workspaceName });
  const source = pane(page, "north-signals");

  await page
    .getByRole("button", { name: "Zoom out to workspace overview" })
    .click();
  await expect(workspace).toHaveAttribute("data-presentation-mode", "overview");
  await expect(
    page.getByRole("button", { name: "Zoom in to focused pane" }),
  ).toBeVisible();
  await expect(source).toHaveAttribute("data-moving", "false");
  await pane(page, "middle-tasks").click();
  await expect(workspace).toHaveAttribute("data-presentation-mode", "normal");
  await expect(pane(page, "middle-tasks")).toHaveAttribute(
    "data-focused",
    "true",
  );
});

test("animates between normal and overview geometry", async ({ page }) => {
  await page.setViewportSize({ height: 700, width: 800 });
  await openPlayground(page);
  const workspace = page.getByRole("region", { name: workspaceName });
  const targetPane = pane(page, "north-signals");
  const originalLiveContent = await targetPane
    .locator(".onirigiri-pane__live-content")
    .elementHandle();
  expect(originalLiveContent).not.toBeNull();

  const normalGeometry = boxGeometry(await requiredBox(targetPane));
  const overviewTrajectory = samplePaneSizeTrajectory(page);
  await page
    .getByRole("button", { name: "Zoom out to workspace overview" })
    .click();
  expectAnimatedTrajectory(await overviewTrajectory);
  await expect(workspace).toHaveAttribute("data-presentation-mode", "overview");
  await expect(targetPane).toHaveAttribute("data-runtime-state", "frozen");
  expect(
    await originalLiveContent?.evaluate(
      (content) => content.isConnected && (content as HTMLElement).inert,
    ),
  ).toBe(true);
  await expect
    .poll(async () => boxGeometry(await requiredBox(targetPane)))
    .not.toBe(normalGeometry);
  await expect(targetPane).toHaveAttribute("data-moving", "false");
  await expect(targetPane).toHaveAttribute("data-runtime-state", "frozen");
  const overviewGeometry = boxGeometry(await requiredBox(targetPane));
  expect(overviewGeometry).not.toBe(normalGeometry);

  const normalTrajectory = samplePaneSizeTrajectory(page);
  await targetPane.click();
  expectAnimatedTrajectory(await normalTrajectory);
  await expect(workspace).toHaveAttribute("data-presentation-mode", "normal");
  await expect
    .poll(async () => boxGeometry(await requiredBox(targetPane)))
    .not.toBe(overviewGeometry);
  await expect(targetPane).toHaveAttribute("data-moving", "false");
  await expect(targetPane).toHaveAttribute("data-runtime-state", "live");
  expect(
    await originalLiveContent?.evaluate(
      (content) => content.isConnected && !(content as HTMLElement).inert,
    ),
  ).toBe(true);
});

test.describe("reduced motion", () => {
  test.use({ contextOptions: { reducedMotion: "reduce" } });

  test("snaps overview and two-axis camera transitions", async ({ page }) => {
    await page.setViewportSize({ height: 700, width: 800 });
    await openPlayground(page);
    const workspace = page.getByRole("region", { name: workspaceName });
    const targetPane = pane(page, "middle-system");
    const world = page.locator(".onirigiri-workspace__world");
    const initialPosition = await transformPosition(world);

    expect(
      await page.evaluate(
        () => matchMedia("(prefers-reduced-motion: reduce)").matches,
      ),
    ).toBe(true);
    await page
      .getByRole("button", { name: "Zoom out to workspace overview" })
      .click();
    await expect(workspace).toHaveAttribute(
      "data-presentation-mode",
      "overview",
    );
    await expect(targetPane).toHaveAttribute("data-moving", "false");
    expect(await transitionDuration(targetPane)).toBeLessThanOrEqual(0.01);

    const overviewTransform = await requiredAttribute(world, "style");
    await page.waitForTimeout(50);
    expect(await requiredAttribute(world, "style")).toBe(overviewTransform);

    await targetPane.click();
    await expect(workspace).toHaveAttribute("data-presentation-mode", "normal");
    await expect(targetPane).toHaveAttribute("data-moving", "false");
    await expect(page.locator(".telemetry-value")).toHaveText("P2 · S2 · R1");
    const normalPosition = await transformPosition(world);
    expect(Math.abs(normalPosition.x - initialPosition.x)).toBeGreaterThan(1);
    expect(Math.abs(normalPosition.y - initialPosition.y)).toBeGreaterThan(1);
    const normalTransform = await requiredAttribute(world, "style");
    await page.waitForTimeout(50);
    expect(await requiredAttribute(world, "style")).toBe(normalTransform);
  });
});

for (const scenario of [
  { height: 450, label: "effective 200% zoom", width: 640 },
  { height: 800, label: "compact layout", width: 320 },
] as const) {
  test(`keeps controls and the focused pane usable at ${scenario.label}`, async ({
    page,
  }) => {
    test.slow();
    await page.setViewportSize({
      height: scenario.height,
      width: scenario.width,
    });
    await openPlayground(page);

    expect(await pageOverflow(page)).toEqual({ horizontal: 0, vertical: 0 });
    for (const groupName of [
      "Playground controls",
      "Workspace preview",
      "Workspace controls",
    ]) {
      await expectReachableControls(page, groupName, scenario);
    }

    const stageBox = await requiredBox(
      page.locator(".onirigiri-workspace__stage"),
    );
    const focusedBox = await requiredBox(
      page.locator('.onirigiri-pane[data-focused="true"]'),
    );
    const toolbarBox = await requiredBox(
      page.getByRole("group", { name: "Workspace controls" }),
    );
    await expect(
      page.getByRole("region", { name: workspaceName }),
    ).toHaveAttribute("data-compact-layout", "true");
    expect(rectDelta(stageBox, focusedBox)).toBeLessThanOrEqual(1);
    expect(toolbarBox.y).toBeGreaterThanOrEqual(
      stageBox.y + stageBox.height - 1,
    );
    expect(await presentedPaneCountOnStage(page, stageBox)).toBe(1);
  });
}

async function openPlayground(page: Page): Promise<void> {
  await page.goto("/fixture.html");
  await expect(
    page.getByRole("region", { name: workspaceName }),
  ).toHaveAttribute("data-presentation-mode", "normal");
  await expect(pane(page, "north-signals")).toHaveAttribute(
    "data-focused",
    "true",
  );
}

async function openMoreMenu(page: Page): Promise<void> {
  const menu = page.locator("details.playground-more-menu");
  if ((await menu.getAttribute("open")) === null) {
    await menu.getByTitle("More controls").click();
  }
  await expect(menu).toHaveAttribute("open", "");
}

function desktopControls(page: Page): Locator {
  return page.locator('[data-onirigiri-slot="desktop-controls"]');
}

async function useColorMode(page: Page, mode: "dark" | "light"): Promise<void> {
  await openMoreMenu(page);
  const toggle = page.locator(".playground-theme-toggle");
  const pressed = mode === "light";
  if ((await toggle.getAttribute("aria-pressed")) !== String(pressed)) {
    await toggle.click();
  }
  await expect(toggle).toHaveAttribute("aria-pressed", String(pressed));
  await expect(page.locator(".playground-shell")).toHaveAttribute(
    "data-color-mode",
    mode,
  );
  await expect(page.locator("html")).toHaveAttribute("data-color-mode", mode);
}

async function themeMetrics(page: Page): Promise<{
  colorScheme: string;
  headingContrast: number;
  paneBackground: string;
  paneShadow: string;
  subtitleContrast: number;
  workspaceBackground: string;
}> {
  return page.evaluate(() => {
    type Rgba = [number, number, number, number];
    const required = <Value>(value: Value | null, label: string): Value => {
      if (value === null) {
        throw new Error(`missing ${label}`);
      }
      return value;
    };
    const workspace = required(
      document.querySelector<HTMLElement>(".onirigiri-workspace"),
      "workspace",
    );
    const pane = required(
      document.querySelector<HTMLElement>(
        '[data-onirigiri-pane-id="north-signals"]',
      ),
      "pane",
    );
    const titlebar = required(
      pane.querySelector<HTMLElement>(".onirigiri-pane__titlebar"),
      "titlebar",
    );
    const heading = required(
      titlebar.querySelector<HTMLElement>("strong"),
      "heading",
    );
    const subtitle = required(
      titlebar.querySelector<HTMLElement>("small"),
      "subtitle",
    );
    const context = required(
      document
        .createElement("canvas")
        .getContext("2d", { willReadFrequently: true }),
      "canvas context for contrast measurement",
    );
    context.canvas.height = 1;
    context.canvas.width = 1;
    const rgba = (color: string): Rgba => {
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = color;
      context.fillRect(0, 0, 1, 1);
      const [red = 0, green = 0, blue = 0, alpha = 0] = context.getImageData(
        0,
        0,
        1,
        1,
      ).data;
      return [red, green, blue, alpha / 255];
    };
    const composite = (top: Rgba, bottom: Rgba): Rgba => {
      const alpha = top[3] + bottom[3] * (1 - top[3]);
      if (alpha === 0) {
        return [0, 0, 0, 0];
      }
      return [
        (top[0] * top[3] + bottom[0] * bottom[3] * (1 - top[3])) / alpha,
        (top[1] * top[3] + bottom[1] * bottom[3] * (1 - top[3])) / alpha,
        (top[2] * top[3] + bottom[2] * bottom[3] * (1 - top[3])) / alpha,
        alpha,
      ];
    };
    const luminance = ([red, green, blue]: Rgba) => {
      const channels = [red, green, blue].map((channel) => {
        const value = channel / 255;
        return value <= 0.04045
          ? value / 12.92
          : ((value + 0.055) / 1.055) ** 2.4;
      });
      return (
        0.2126 * (channels[0] ?? 0) +
        0.7152 * (channels[1] ?? 0) +
        0.0722 * (channels[2] ?? 0)
      );
    };
    const contrast = (foreground: Rgba, background: Rgba) => {
      const light = Math.max(luminance(foreground), luminance(background));
      const dark = Math.min(luminance(foreground), luminance(background));
      return (light + 0.05) / (dark + 0.05);
    };

    const workspaceStyle = getComputedStyle(workspace);
    const paneStyle = getComputedStyle(pane);
    const titlebarStyle = getComputedStyle(titlebar);
    const workspaceBackground = rgba(workspaceStyle.backgroundColor);
    const paneBackground = composite(
      rgba(paneStyle.backgroundColor),
      workspaceBackground,
    );
    const titlebarBackground = composite(
      rgba(titlebarStyle.backgroundColor),
      paneBackground,
    );
    return {
      colorScheme: workspaceStyle.colorScheme,
      headingContrast: contrast(
        rgba(getComputedStyle(heading).color),
        titlebarBackground,
      ),
      paneBackground: paneStyle.backgroundColor,
      paneShadow: paneStyle.boxShadow,
      subtitleContrast: contrast(
        rgba(getComputedStyle(subtitle).color),
        titlebarBackground,
      ),
      workspaceBackground: workspaceStyle.backgroundColor,
    };
  });
}

function pane(page: Page, paneId: string): Locator {
  return page.locator(`[data-onirigiri-pane-id="${paneId}"]`);
}

async function activePaneId(page: Page): Promise<string | null> {
  return page.evaluate(
    () =>
      document.activeElement?.closest<HTMLElement>("[data-onirigiri-pane-id]")
        ?.dataset.onirigiriPaneId ?? null,
  );
}

async function focusOutline(
  locator: Locator,
): Promise<{ style: string; width: number }> {
  return locator.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      style: style.outlineStyle,
      width: Number.parseFloat(style.outlineWidth),
    };
  });
}

async function transitionDuration(locator: Locator): Promise<number> {
  return locator.evaluate((element) => {
    const duration = getComputedStyle(element).transitionDuration;
    return Number.parseFloat(duration) * (duration.endsWith("ms") ? 1 : 1_000);
  });
}

async function transformPosition(
  locator: Locator,
): Promise<{ x: number; y: number }> {
  return locator.evaluate((element) => {
    const matrix = new DOMMatrixReadOnly(getComputedStyle(element).transform);
    return { x: matrix.m41, y: matrix.m42 };
  });
}

async function inlinePaneSize(
  locator: Locator,
): Promise<{ height: number; width: number }> {
  return locator.evaluate((element) => ({
    height: Number.parseFloat((element as HTMLElement).style.height),
    width: Number.parseFloat((element as HTMLElement).style.width),
  }));
}

async function requiredAttribute(
  locator: Locator,
  name: string,
): Promise<string> {
  const value = await locator.getAttribute(name);
  if (value === null) {
    throw new Error(`missing ${name} on browser-smoke target`);
  }
  return value;
}

async function expectPaneOnStage(
  stage: Locator,
  target: Locator,
): Promise<void> {
  const stageBox = await requiredBox(stage);
  const paneBox = await requiredBox(target);
  expect(paneBox.x + paneBox.width).toBeGreaterThan(stageBox.x);
  expect(paneBox.x).toBeLessThan(stageBox.x + stageBox.width);
  expect(paneBox.y + paneBox.height).toBeGreaterThan(stageBox.y);
  expect(paneBox.y).toBeLessThan(stageBox.y + stageBox.height);
}
