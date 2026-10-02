import { writeFile } from "node:fs/promises";

import { expect, test, type CDPSession, type TestInfo } from "@playwright/test";

import {
  performanceScenarioIds,
  type PerformanceScenarioId,
  type PerformanceScenarioResult,
} from "../../bench/src/performance-types";
import { assessPerformanceBudget } from "../performance/frame-budget";
import { browserGraphicsCapabilities } from "../performance/browser-environment";
import {
  performanceCdpLayerIdentityReceiptArtifact,
  startPerformanceCdpLayerIdentityCollector,
  type PerformanceCdpLayerIdentityCollector,
  type PerformanceCdpLayerIdentityReceipt,
} from "../performance/cdp-layer-identity";
import {
  finalizePerformanceDiagnosticOperations,
  performanceCdpTraceArtifact,
  performanceCdpTraceReceiptArtifact,
  retainPerformanceDiagnosticArtifact,
  shouldCapturePerformanceCdpTrace,
  startPerformanceCdpTrace,
  type PerformanceCdpTraceResult,
  type PerformanceCdpTrace,
  type PerformanceCdpTraceTarget,
  type PerformanceDiagnosticArtifactWriter,
  type PerformanceDiagnosticOperation,
} from "../performance/cdp-trace";
import { chromeLaunchOptions } from "./chrome-launch";

interface ViewportClass {
  cpuSlowdown?: number;
  height: number;
  id:
    | "desktop"
    | "desktop-retina"
    | "desktop-retina-average-cpu"
    | "five-k"
    | "four-k"
    | "mobile"
    | "six-k"
    | "small-desktop";
  width: number;
}

const viewportClasses: readonly ViewportClass[] = [
  { height: 844, id: "mobile", width: 390 },
  { height: 600, id: "small-desktop", width: 768 },
  { height: 900, id: "desktop", width: 1_440 },
  { height: 900, id: "desktop-retina", width: 1_440 },
  {
    cpuSlowdown: 2,
    height: 900,
    id: "desktop-retina-average-cpu",
    width: 1_440,
  },
  { height: 2_160, id: "four-k", width: 3_840 },
  { height: 2_880, id: "five-k", width: 5_120 },
  { height: 3_384, id: "six-k", width: 6_016 },
];

for (const viewport of viewportClasses) {
  for (const scenarioId of scenarioIdsForViewport(viewport)) {
    test(`${scenarioId} preserves cadence and 120Hz CPU headroom in headless Chrome at ${viewport.id}`, async ({
      playwright,
    }, testInfo) => {
      test.slow();
      const browser = await playwright.chromium.launch({
        ...chromeLaunchOptions,
        headless: true,
      });
      try {
        const page = await browser.newPage({
          baseURL: testInfo.project.use.baseURL,
          deviceScaleFactor: viewport.id.startsWith("desktop-retina") ? 2 : 1,
          screen: { height: viewport.height, width: viewport.width },
          viewport: { height: viewport.height, width: viewport.width },
        });
        if (viewport.cpuSlowdown)
          await (
            await page.context().newCDPSession(page)
          ).send("Emulation.setCPUThrottlingRate", {
            rate: viewport.cpuSlowdown,
          });
        const traceTarget = {
          scenarioId,
          viewportId: viewport.id,
        };
        const traceRequested = shouldCapturePerformanceCdpTrace(traceTarget);
        const artifactWriter = performanceDiagnosticArtifactWriter(testInfo);
        let cdpSession: CDPSession | null = null;
        let cdpLayerIdentity: PerformanceCdpLayerIdentityCollector | null =
          null;
        let cdpTrace: PerformanceCdpTrace | null = null;
        let result: PerformanceScenarioResult | null = null;
        await finalizePerformanceDiagnosticOperations([
          async () => {
            const session = await browser.newBrowserCDPSession();
            const system = await session.send("SystemInfo.getInfo");
            await session.detach();
            const capabilities = await browserGraphicsCapabilities(page);
            await retainPerformanceDiagnosticArtifact(artifactWriter, {
              name: `${scenarioId}-${viewport.id}-environment.json`,
              contents: JSON.stringify(
                { browser: browser.version(), gpu: system.gpu, capabilities },
                null,
                2,
              ),
            });
            expect(
              capabilities.missing,
              "Required workspace graphics capabilities",
            ).toEqual([]);
            await page.goto(
              performanceScenarioUrl(scenarioId, traceRequested),
              {
                waitUntil: "networkidle",
              },
            );
            await expect
              .poll(() =>
                page.evaluate(
                  () => window.__onirigiriPerformance?.scenarioId ?? null,
                ),
              )
              .toBe(scenarioId);
            expect(await visibleBrowserSurface(page)).toEqual({
              headless: true,
              screen: { height: viewport.height, width: viewport.width },
              visibility: "visible",
            });
            if (traceRequested) {
              cdpSession = await page.context().newCDPSession(page);
              cdpLayerIdentity =
                await startPerformanceCdpLayerIdentityCollector(cdpSession);
              cdpTrace = await startPerformanceCdpTrace(cdpSession);
            }
            result = await runScenario(page, scenarioId);
            if (scenarioId.startsWith("live-")) {
              await expect(
                page.locator(
                  '[data-visible="true"][data-onirigiri-renderer="dom"][data-onirigiri-presentation-live="true"]',
                ),
              ).not.toHaveCount(0);
            }
            expect(result.productionBuild).toBe(true);
            expectRequiredPaneCount(result);
            expect(result.display.viewport).toEqual({
              height: viewport.height,
              width: viewport.width,
            });
            expect(result.counts.visiblePanes).toBeGreaterThan(0);
            expect(result.counts.visibleLivePanes).toBe(
              result.counts.visiblePanes,
            );
            expect(result.counts.mountedPanes).toBeGreaterThanOrEqual(
              result.counts.visiblePanes,
            );
            if (viewport.id === "mobile") {
              expect(result.counts.visiblePanes).toBe(1);
            }
            expectDiagnosticTraceAlignment(result, traceRequested);
            const assessment = assessPerformanceBudget(result);
            const report = JSON.stringify({ assessment, result }, null, 2);
            await retainPerformanceDiagnosticArtifact(artifactWriter, {
              contents: report,
              name: `${scenarioId}-${viewport.id}.json`,
            });
            expect(assessment.violations).toEqual([]);
          },
          ...performanceDiagnosticFinalizationOperations(
            artifactWriter,
            traceTarget,
            () => cdpTrace,
            () => cdpLayerIdentity,
            () => result,
            () => cdpSession,
          ),
        ]);
      } finally {
        await browser.close();
      }
    });
  }
}

function scenarioIdsForViewport(
  viewport: ViewportClass,
): readonly PerformanceScenarioId[] {
  if (viewport.id === "five-k" || viewport.id === "six-k") {
    return ["navigation-50", "overview-500"];
  }
  return performanceScenarioIds.filter(
    (scenarioId) =>
      (scenarioId !== "overview-500" || viewport.id === "four-k") &&
      (!scenarioId.startsWith("live-") || viewport.id.startsWith("desktop")) &&
      (scenarioId !== "background-cache-100" ||
        viewport.id.startsWith("desktop")),
  );
}

async function visibleBrowserSurface(
  page: import("@playwright/test").Page,
): Promise<{
  headless: boolean;
  screen: { height: number; width: number };
  visibility: DocumentVisibilityState;
}> {
  return page.evaluate(() => ({
    headless: navigator.userAgent.includes("HeadlessChrome"),
    screen: { height: window.screen.height, width: window.screen.width },
    visibility: document.visibilityState,
  }));
}

function expectRequiredPaneCount(result: PerformanceScenarioResult): void {
  if (result.scenarioId === "navigation-50") {
    expect(result.paneCount).toBe(50);
  }
  if (result.scenarioId === "overview-500") {
    expect(result.paneCount).toBe(500);
  }
}

function performanceScenarioUrl(
  scenarioId: PerformanceScenarioId,
  traceRequested: boolean,
): string {
  const search = new URLSearchParams({ scenario: scenarioId });
  if (traceRequested) {
    search.set("onirigiri-cdp-trace", "1");
  }
  return `/?${search}`;
}

function expectDiagnosticTraceAlignment(
  result: PerformanceScenarioResult,
  traceRequested: boolean,
): void {
  if (!traceRequested) {
    return;
  }
  expect(result.diagnosticTrace).toBeDefined();
  expect(result.diagnosticTrace?.slowFrameIntervals).toHaveLength(
    result.counts.framesOver50Ms,
  );
}

function performanceDiagnosticArtifactWriter(
  testInfo: TestInfo,
): PerformanceDiagnosticArtifactWriter {
  return {
    attach: (name, attachment) => testInfo.attach(name, attachment),
    outputPath: (name) => testInfo.outputPath(name),
    writeFile: (path, contents) => writeFile(path, contents, "utf8"),
  };
}

function performanceDiagnosticFinalizationOperations(
  writer: PerformanceDiagnosticArtifactWriter,
  target: PerformanceCdpTraceTarget,
  getCdpTrace: () => PerformanceCdpTrace | null,
  getCdpLayerIdentity: () => PerformanceCdpLayerIdentityCollector | null,
  getResult: () => PerformanceScenarioResult | null,
  getCdpSession: () => CDPSession | null,
): readonly PerformanceDiagnosticOperation[] {
  let layerIdentity: PerformanceCdpLayerIdentityReceipt | null = null;
  let trace: PerformanceCdpTraceResult | null = null;
  return [
    async () => {
      const cdpTrace = getCdpTrace();
      if (cdpTrace) {
        trace = await cdpTrace.stop();
      }
    },
    async () => {
      const cdpLayerIdentity = getCdpLayerIdentity();
      if (cdpLayerIdentity) {
        layerIdentity = await cdpLayerIdentity.stop();
      }
    },
    async () => {
      if (layerIdentity) {
        await retainPerformanceDiagnosticArtifact(
          writer,
          performanceCdpLayerIdentityReceiptArtifact(target, layerIdentity),
        );
      }
    },
    async () => {
      if (trace) {
        await retainPerformanceDiagnosticArtifact(
          writer,
          performanceCdpTraceArtifact(target, trace),
        );
      }
    },
    async () => {
      if (trace) {
        await retainPerformanceDiagnosticArtifact(
          writer,
          performanceCdpTraceReceiptArtifact(target, trace),
        );
      }
    },
    async () => {
      const result = getResult();
      if (result?.diagnosticTrace) {
        await retainPerformanceDiagnosticArtifact(writer, {
          contents: JSON.stringify(result.diagnosticTrace, null, 2),
          name: `${target.scenarioId}-${target.viewportId}-cdp-alignment.json`,
        });
      }
    },
    async () => {
      const cdpSession = getCdpSession();
      await cdpSession?.detach();
    },
  ];
}

async function runScenario(
  page: import("@playwright/test").Page,
  scenarioId: PerformanceScenarioId,
): Promise<PerformanceScenarioResult> {
  const result = await page.evaluate(async () => {
    const fixture = window.__onirigiriPerformance;
    if (!fixture) {
      throw new Error("Onirigiri performance fixture API is unavailable.");
    }
    return fixture.run();
  });
  expect(result.scenarioId).toBe(scenarioId);
  expect(result.samples.browserFrameDeltasMs.length).toBeGreaterThan(0);
  return result;
}
