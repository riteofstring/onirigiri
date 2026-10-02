import { expect, test, type Locator, type Page } from "@playwright/test";

const workspaceName = "Interactive two-dimensional Onirigiri playground";

test("keeps default overview follow centered at one scale beyond the pane rows", async ({
  page,
}) => {
  await page.setViewportSize({ height: 700, width: 900 });
  await openPlayground(page);
  const workspace = page.getByRole("region", { name: workspaceName });
  const stage = page.locator(".onirigiri-workspace__stage");
  const cursor = page.locator(".onirigiri-workspace__grid-cursor");
  const world = page.locator(".onirigiri-workspace__world");
  const overviewCamera = page.locator(
    '.playground-camera-mode-toggle[data-presentation-mode="overview"]',
  );

  await expect(overviewCamera).toHaveAttribute("aria-pressed", "true");
  await expect(overviewCamera).toHaveAttribute("data-camera-mode", "follow");
  await page
    .getByRole("button", { name: "Zoom out to workspace overview" })
    .click();
  await expect(workspace).toHaveAttribute("data-presentation-mode", "overview");
  await expect(pane(page, "north-signals")).toHaveAttribute(
    "data-moving",
    "false",
  );
  const initialScale = await worldTransformScale(world);
  await workspace.focus();

  for (const telemetry of [
    "P2 · S1 · R1",
    "P2 · S1 · R2",
    "P3 · S1 · R1",
    "P4 · S1 · R1",
  ]) {
    await page.keyboard.press("Alt+ArrowDown");
    await expect(page.locator(".telemetry-value")).toHaveText(telemetry);
    await expect
      .poll(async () => cursorCenterDelta(stage, cursor))
      .toBeLessThanOrEqual(2);
    await expect
      .poll(async () => worldTransformScale(world))
      .toBeCloseTo(initialScale, 3);
  }
});

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

function pane(page: Page, paneId: string): Locator {
  return page.locator(`[data-onirigiri-pane-id="${paneId}"]`);
}

async function worldTransformScale(locator: Locator): Promise<number> {
  return locator.evaluate((element) => {
    const matrix = new DOMMatrixReadOnly(getComputedStyle(element).transform);
    return matrix.a;
  });
}

async function cursorCenterDelta(
  stage: Locator,
  cursor: Locator,
): Promise<number> {
  const stageBox = await requiredBox(stage);
  const cursorBox = await requiredBox(cursor);
  return Math.max(
    Math.abs(centerX(stageBox) - centerX(cursorBox)),
    Math.abs(centerY(stageBox) - centerY(cursorBox)),
  );
}

async function requiredBox(locator: Locator) {
  const box = await locator.boundingBox();
  if (!box) {
    throw new Error("overview follow target has no visible bounding box");
  }
  return box;
}

function centerX(box: { width: number; x: number }): number {
  return box.x + box.width / 2;
}

function centerY(box: { height: number; y: number }): number {
  return box.y + box.height / 2;
}
