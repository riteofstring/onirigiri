import { expect, type Locator, type Page } from "@playwright/test";

export function sampleHorizontalTrajectory(
  page: Page,
  paneId: string,
): Promise<number[]> {
  return page.evaluate(
    ({ durationMs, paneId: targetPaneId }) =>
      new Promise<number[]>((resolve) => {
        const values: number[] = [];
        const startedAt = performance.now();
        const sample = (timestamp: number) => {
          const target = document.querySelector<HTMLElement>(
            `[data-onirigiri-pane-id="${targetPaneId}"]`,
          );
          if (target) {
            values.push(target.getBoundingClientRect().x);
          }
          if (timestamp - startedAt >= durationMs) {
            resolve(values);
            return;
          }
          requestAnimationFrame(sample);
        };
        requestAnimationFrame(sample);
      }),
    { durationMs: 240, paneId },
  );
}

export function expectAnimatedTrajectory(values: readonly number[]): void {
  const distinct = new Set(values.map((value) => value.toFixed(2)));
  expect(values.length).toBeGreaterThan(3);
  expect(distinct.size).toBeGreaterThan(3);
  expect(values.at(-1)).not.toBeCloseTo(values[0] ?? 0, 1);
}

export async function observeMovingState(locator: Locator): Promise<void> {
  await locator.evaluate((element) => {
    document.documentElement.removeAttribute("data-onirigiri-moving-observed");
    const surfaceIsVisible = (surface: HTMLElement | null) =>
      [
        surface !== null,
        surface && getComputedStyle(surface).visibility !== "hidden",
        surface && Number.parseFloat(getComputedStyle(surface).opacity) >= 0.99,
      ].every(Boolean);
    const liveContent = element.querySelector<HTMLElement>(
      ".onirigiri-pane__live-content",
    );
    const recordMovingState = () => {
      const movingWasObserved =
        element.getAttribute("data-moving") === "true" &&
        surfaceIsVisible(liveContent);
      if (!movingWasObserved) {
        return;
      }
      document.documentElement.setAttribute(
        "data-onirigiri-moving-observed",
        "true",
      );
      observer.disconnect();
    };
    const observer = new MutationObserver(recordMovingState);
    observer.observe(element, { attributeFilter: ["data-moving"] });
    recordMovingState();
  });
}

export async function expectMovingWasObserved(page: Page): Promise<void> {
  await expect(page.locator("html")).toHaveAttribute(
    "data-onirigiri-moving-observed",
    "true",
  );
}
