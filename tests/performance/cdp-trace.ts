import type { CDPSession } from "@playwright/test";

export const performanceCdpTraceEnvironment = "ONIRIGIRI_PERFORMANCE_CDP_TRACE";

export const performanceCdpTraceCategories = [
  "blink.user_timing",
  "cc",
  "gpu",
  "toplevel",
  "viz",
] as const;

export const performanceCdpTraceConfiguration = {
  includedCategories: [...performanceCdpTraceCategories],
  recordMode: "recordContinuously" as const,
  traceBufferSizeInKb: 4 * 1024,
};

export interface PerformanceCdpTraceTarget {
  scenarioId: string;
  viewportId: string;
}

interface ChromeTraceStream {
  dataLossOccurred?: boolean;
  stream?: string;
}

interface CompletedChromeTrace {
  dataLossOccurred?: boolean;
  stream: string;
}

interface ChromeTraceRead {
  base64Encoded?: boolean;
  data: string;
  eof: boolean;
}

export interface PerformanceCdpTraceResult {
  dataLossOccurred?: boolean;
  trace: string;
}

export interface PerformanceCdpTrace {
  stop(): Promise<PerformanceCdpTraceResult>;
}

export interface PerformanceDiagnosticArtifact {
  contents: string;
  name: string;
}

export interface PerformanceDiagnosticArtifactWriter {
  attach(
    name: string,
    attachment: { contentType: string; path: string },
  ): Promise<void>;
  outputPath(name: string): string;
  writeFile(path: string, contents: string): Promise<void>;
}

export type PerformanceDiagnosticOperation = () => Promise<void>;

export function shouldCapturePerformanceCdpTrace(
  target: PerformanceCdpTraceTarget,
  environment: NodeJS.ProcessEnv = process.env,
): boolean {
  return (
    environment[performanceCdpTraceEnvironment] === "1" &&
    target.scenarioId === "mixed-content-36" &&
    target.viewportId === "four-k"
  );
}

export async function startPerformanceCdpTrace(
  session: CDPSession,
): Promise<PerformanceCdpTrace> {
  let completeTrace: (trace: CompletedChromeTrace) => void;
  let rejectTrace: (reason: Error) => void;
  const traceStream = new Promise<CompletedChromeTrace>((resolve, reject) => {
    completeTrace = resolve;
    rejectTrace = reject;
  });
  session.once("Tracing.tracingComplete", (event) => {
    const completedTrace = event as ChromeTraceStream;
    const stream = completedTrace.stream;
    if (stream) {
      completeTrace({
        ...(completedTrace.dataLossOccurred === undefined
          ? {}
          : { dataLossOccurred: completedTrace.dataLossOccurred }),
        stream,
      });
      return;
    }
    rejectTrace(new Error("Chrome trace completed without a stream."));
  });
  await session.send("Tracing.start", {
    traceConfig: performanceCdpTraceConfiguration,
    transferMode: "ReturnAsStream",
  });
  return {
    async stop(): Promise<PerformanceCdpTraceResult> {
      await session.send("Tracing.end");
      const completedTrace = await traceStream;
      return {
        ...(completedTrace.dataLossOccurred === undefined
          ? {}
          : { dataLossOccurred: completedTrace.dataLossOccurred }),
        trace: await readChromeTraceStream(session, completedTrace.stream),
      };
    },
  };
}

export async function retainPerformanceDiagnosticArtifact(
  writer: PerformanceDiagnosticArtifactWriter,
  artifact: PerformanceDiagnosticArtifact,
): Promise<void> {
  const path = writer.outputPath(artifact.name);
  await writer.writeFile(path, artifact.contents);
  await writer.attach(artifact.name, {
    contentType: "application/json",
    path,
  });
}

export async function finalizePerformanceDiagnosticOperations(
  operations: readonly PerformanceDiagnosticOperation[],
): Promise<void> {
  const failures: unknown[] = [];
  for (const operation of operations) {
    try {
      await operation();
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length > 0) {
    throw new AggregateError(
      failures,
      "Performance diagnostic finalization failed.",
    );
  }
}

export function performanceCdpTraceArtifact(
  target: PerformanceCdpTraceTarget,
  trace: PerformanceCdpTraceResult,
): PerformanceDiagnosticArtifact {
  return {
    contents: trace.trace,
    name: `${target.scenarioId}-${target.viewportId}-cdp-trace.json`,
  };
}

export function performanceCdpTraceReceiptArtifact(
  target: PerformanceCdpTraceTarget,
  trace: PerformanceCdpTraceResult,
): PerformanceDiagnosticArtifact {
  return {
    contents: JSON.stringify(
      {
        ...(trace.dataLossOccurred === undefined
          ? {}
          : { dataLossOccurred: trace.dataLossOccurred }),
        traceConfig: performanceCdpTraceConfiguration,
      },
      null,
      2,
    ),
    name: `${target.scenarioId}-${target.viewportId}-cdp-receipt.json`,
  };
}

async function readChromeTraceStream(
  session: CDPSession,
  stream: string,
): Promise<string> {
  let trace = "";
  try {
    for (;;) {
      const response = (await session.send("IO.read", {
        handle: stream,
      })) as ChromeTraceRead;
      trace += response.base64Encoded
        ? Buffer.from(response.data, "base64").toString("utf8")
        : response.data;
      if (response.eof) {
        return trace;
      }
    }
  } finally {
    await session.send("IO.close", { handle: stream });
  }
}
