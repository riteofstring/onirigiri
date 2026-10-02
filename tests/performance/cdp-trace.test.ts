import type { CDPSession } from "@playwright/test";
import { describe, expect, it, vi } from "vitest";

import {
  finalizePerformanceDiagnosticOperations,
  performanceCdpTraceArtifact,
  performanceCdpTraceCategories,
  performanceCdpTraceConfiguration,
  performanceCdpTraceEnvironment,
  performanceCdpTraceReceiptArtifact,
  retainPerformanceDiagnosticArtifact,
  shouldCapturePerformanceCdpTrace,
  startPerformanceCdpTrace,
} from "./cdp-trace";

describe("performance CDP trace boundary", () => {
  it("stays disabled unless the exact blocked probe explicitly opts in", () => {
    expect(
      shouldCapturePerformanceCdpTrace(
        { scenarioId: "mixed-content-36", viewportId: "four-k" },
        {},
      ),
    ).toBe(false);
    expect(
      shouldCapturePerformanceCdpTrace(
        { scenarioId: "navigation-50", viewportId: "four-k" },
        { [performanceCdpTraceEnvironment]: "1" },
      ),
    ).toBe(false);
    expect(
      shouldCapturePerformanceCdpTrace(
        { scenarioId: "mixed-content-36", viewportId: "desktop" },
        { [performanceCdpTraceEnvironment]: "1" },
      ),
    ).toBe(false);
    expect(
      shouldCapturePerformanceCdpTrace(
        { scenarioId: "mixed-content-36", viewportId: "four-k" },
        { [performanceCdpTraceEnvironment]: "1" },
      ),
    ).toBe(true);
  });

  it("starts a bounded minimal trace for the requested classifications", async () => {
    let tracingComplete:
      | ((event: { dataLossOccurred: boolean; stream: string }) => void)
      | undefined;
    const send = vi.fn(async (method: string) => {
      if (method === "Tracing.end") {
        tracingComplete?.({ dataLossOccurred: false, stream: "trace-stream" });
        return {};
      }
      if (method === "IO.read") {
        return { data: '{"traceEvents":[]}', eof: true };
      }
      return {};
    });
    const session = {
      once: vi.fn(
        (_event: string, listener: (event: { stream: string }) => void) => {
          tracingComplete = listener;
        },
      ),
      send,
    } as unknown as CDPSession;

    const trace = await startPerformanceCdpTrace(session);

    await expect(trace.stop()).resolves.toEqual({
      dataLossOccurred: false,
      trace: '{"traceEvents":[]}',
    });
    expect(send).toHaveBeenCalledWith("Tracing.start", {
      traceConfig: performanceCdpTraceConfiguration,
      transferMode: "ReturnAsStream",
    });
    expect(performanceCdpTraceConfiguration).toMatchObject({
      recordMode: "recordContinuously",
      traceBufferSizeInKb: 4 * 1024,
    });
    expect(performanceCdpTraceCategories).toEqual([
      "blink.user_timing",
      "cc",
      "gpu",
      "toplevel",
      "viz",
    ]);
    expect(send).toHaveBeenCalledWith("IO.close", { handle: "trace-stream" });
  });

  it("keeps a missing CDP data-loss receipt unknown", async () => {
    let tracingComplete: ((event: { stream: string }) => void) | undefined;
    const send = vi.fn(async (method: string) => {
      if (method === "Tracing.end") {
        tracingComplete?.({ stream: "trace-stream" });
        return {};
      }
      if (method === "IO.read") {
        return { data: '{"traceEvents":[]}', eof: true };
      }
      return {};
    });
    const session = {
      once: vi.fn(
        (_event: string, listener: (event: { stream: string }) => void) => {
          tracingComplete = listener;
        },
      ),
      send,
    } as unknown as CDPSession;

    const trace = await startPerformanceCdpTrace(session);
    const result = await trace.stop();
    const receipt = performanceCdpTraceReceiptArtifact(
      { scenarioId: "mixed-content-36", viewportId: "four-k" },
      result,
    );

    expect(result).toEqual({ trace: '{"traceEvents":[]}' });
    expect(JSON.parse(receipt.contents)).not.toHaveProperty("dataLossOccurred");
  });

  it("writes each trace artifact before attaching it", async () => {
    const calls: string[] = [];
    const writer = {
      attach: vi.fn(async (name: string, { path }: { path: string }) => {
        calls.push(`attach:${name}:${path}`);
      }),
      outputPath: vi.fn((name: string) => `/output/${name}`),
      writeFile: vi.fn(async (path: string, contents: string) => {
        calls.push(`write:${path}:${contents}`);
      }),
    };
    const target = { scenarioId: "mixed-content-36", viewportId: "four-k" };
    const trace = { dataLossOccurred: false, trace: '{"traceEvents":[]}' };

    await retainPerformanceDiagnosticArtifact(
      writer,
      performanceCdpTraceArtifact(target, trace),
    );
    await retainPerformanceDiagnosticArtifact(
      writer,
      performanceCdpTraceReceiptArtifact(target, trace),
    );

    expect(calls).toEqual([
      'write:/output/mixed-content-36-four-k-cdp-trace.json:{"traceEvents":[]}',
      "attach:mixed-content-36-four-k-cdp-trace.json:/output/mixed-content-36-four-k-cdp-trace.json",
      expect.stringContaining(
        "write:/output/mixed-content-36-four-k-cdp-receipt.json:",
      ),
      "attach:mixed-content-36-four-k-cdp-receipt.json:/output/mixed-content-36-four-k-cdp-receipt.json",
    ]);
    expect(calls[2]).toContain('"dataLossOccurred": false');
    expect(calls[2]).toContain('"recordMode": "recordContinuously"');
  });

  it("retains later artifacts and cleanup after an attachment failure", async () => {
    const calls: string[] = [];
    const attachmentFailure = new Error("trace attachment failed");
    const writer = {
      attach: vi.fn(async (name: string) => {
        calls.push(`attach:${name}`);
        if (name === "trace.json") {
          throw attachmentFailure;
        }
      }),
      outputPath: vi.fn((name: string) => `/output/${name}`),
      writeFile: vi.fn(async (_path: string, contents: string) => {
        calls.push(`write:${contents}`);
      }),
    };

    await expect(
      finalizePerformanceDiagnosticOperations([
        () =>
          retainPerformanceDiagnosticArtifact(writer, {
            contents: "trace",
            name: "trace.json",
          }),
        () =>
          retainPerformanceDiagnosticArtifact(writer, {
            contents: "receipt",
            name: "receipt.json",
          }),
        () =>
          retainPerformanceDiagnosticArtifact(writer, {
            contents: "alignment",
            name: "alignment.json",
          }),
        async () => {
          calls.push("detach");
        },
        async () => {
          calls.push("close");
        },
      ]),
    ).rejects.toMatchObject({ errors: [attachmentFailure] });

    expect(calls).toEqual([
      "write:trace",
      "attach:trace.json",
      "write:receipt",
      "attach:receipt.json",
      "write:alignment",
      "attach:alignment.json",
      "detach",
      "close",
    ]);
  });
});
