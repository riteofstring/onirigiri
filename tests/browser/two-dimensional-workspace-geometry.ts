import { expect, type Locator, type Page } from "@playwright/test";

export async function requiredBox(locator: Locator) {
  const box = await locator.boundingBox();
  if (!box) {
    throw new Error("browser-smoke target has no visible bounding box");
  }
  return box;
}

export function centerX(box: { width: number; x: number }): number {
  return box.x + box.width / 2;
}

export function centerY(box: { height: number; y: number }): number {
  return box.y + box.height / 2;
}

export function boxPosition(box: { x: number; y: number }): string {
  return `${box.x.toFixed(1)},${box.y.toFixed(1)}`;
}

export function boxGeometry(box: {
  height: number;
  width: number;
  x: number;
  y: number;
}): string {
  return [box.x, box.y, box.width, box.height]
    .map((value) => value.toFixed(1))
    .join(",");
}

export async function pageOverflow(
  page: Page,
): Promise<{ horizontal: number; vertical: number }> {
  return page.evaluate(() => ({
    horizontal: Math.max(
      0,
      document.documentElement.scrollWidth - window.innerWidth,
    ),
    vertical: Math.max(
      0,
      document.documentElement.scrollHeight - window.innerHeight,
    ),
  }));
}

export async function presentedPaneCountOnStage(
  page: Page,
  stage: { height: number; width: number; x: number; y: number },
): Promise<number> {
  const panes = page.locator('.onirigiri-pane[data-visible="true"]');
  let count = 0;
  for (let index = 0; index < (await panes.count()); index += 1) {
    const box = await requiredBox(panes.nth(index));
    if (rectsIntersect(stage, box)) {
      count += 1;
    }
  }
  return count;
}

export async function expectReachableControls(
  page: Page,
  groupName: string,
  viewport: { height: number; width: number },
): Promise<void> {
  const controls = page
    .getByRole("group", { name: groupName })
    .getByRole("button");
  const controlCount = await controls.count();
  expect(controlCount, `${groupName} controls`).toBeGreaterThan(0);
  for (let index = 0; index < controlCount; index += 1) {
    const control = controls.nth(index);
    await control.scrollIntoViewIfNeeded();
    expect(
      boxIsUsable(await requiredBox(control), viewport),
      `${groupName} control ${index}`,
    ).toBe(true);
  }
}

export async function computedOpacity(locator: Locator): Promise<number> {
  return locator.evaluate((element) =>
    Number.parseFloat(getComputedStyle(element).opacity),
  );
}

export function edgeDelta(left: number, right: number): number {
  return Math.abs(left - right);
}

export function rectDelta(
  left: { height: number; width: number; x: number; y: number },
  right: { height: number; width: number; x: number; y: number },
): number {
  return Math.max(
    Math.abs(left.x - right.x),
    Math.abs(left.y - right.y),
    Math.abs(left.width - right.width),
    Math.abs(left.height - right.height),
  );
}

export function expectCentersToMatch(
  stage: { height: number; width: number; x: number; y: number },
  paneBox: { height: number; width: number; x: number; y: number },
): void {
  expect(edgeDelta(centerX(stage), centerX(paneBox))).toBeLessThanOrEqual(1);
  expect(edgeDelta(centerY(stage), centerY(paneBox))).toBeLessThanOrEqual(1);
}

function rectsIntersect(
  left: { height: number; width: number; x: number; y: number },
  right: { height: number; width: number; x: number; y: number },
): boolean {
  return (
    left.x < right.x + right.width &&
    left.x + left.width > right.x &&
    left.y < right.y + right.height &&
    left.y + left.height > right.y
  );
}

export function boxIsUsable(
  box: { height: number; width: number; x: number; y: number },
  viewport: { height: number; width: number },
): boolean {
  return (
    box.height >= 28 &&
    box.width >= 28 &&
    box.x >= 0 &&
    box.y >= 0 &&
    box.x + box.width <= viewport.width + 1 &&
    box.y + box.height <= viewport.height + 1
  );
}
