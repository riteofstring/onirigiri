import type { CDPSession } from "@playwright/test";
import { describe, expect, it, vi } from "vitest";

import {
  performanceCdpLayerIdentityReceiptArtifact,
  startPerformanceCdpLayerIdentityCollector,
} from "./cdp-layer-identity";

describe("performance CDP layer identity collector", () => {
  it("retains each visible Onirigiri identity with its layer geometry", async () => {
    const session = cdpSessionWith({});
    const collector = await startPerformanceCdpLayerIdentityCollector(session);
    emitLayerTree(session, {
      layers: [layer("pane", 11), layer("content", 12), layer("live", 13)],
    });

    const receipt = await collector.stop();

    expect(receipt.dom).toMatchObject({
      status: "complete",
      visiblePaneIds: ["pane-a"],
    });
    expect(receipt.correlation).toMatchObject({
      expectedIdentityCount: 3,
      status: "complete",
      unmatchedIdentities: [],
    });
    expect(receipt.correlation.matches).toContainEqual(
      expect.objectContaining({
        geometry: expect.objectContaining({ height: 1_088, width: 1_152 }),
        layerId: "live",
        paneId: "pane-a",
        slot: "pane-live-content",
      }),
    );
    expect(receipt.layerTree).toMatchObject({
      eventCount: 1,
      status: "complete",
    });
    expect(receipt.teardown).toEqual({
      dom: { errors: [], status: "complete" },
      layerTree: { errors: [], status: "complete" },
    });
    expect(
      performanceCdpLayerIdentityReceiptArtifact(
        { scenarioId: "mixed-content-36", viewportId: "four-k" },
        receipt,
      ).name,
    ).toBe("mixed-content-36-four-k-cdp-layer-identity.json");
  });

  it("records missing and partial evidence instead of a complete association", async () => {
    const missingSession = cdpSessionWith({ hostNodeIds: [] });
    const missing =
      await startPerformanceCdpLayerIdentityCollector(missingSession);
    const missingReceipt = await missing.stop();

    expect(missingReceipt.dom.status).toBe("missing");
    expect(missingReceipt.layerTree.status).toBe("missing");
    expect(missingReceipt.correlation.status).toBe("missing");

    const partialSession = cdpSessionWith({});
    const partial =
      await startPerformanceCdpLayerIdentityCollector(partialSession);
    emitLayerTree(partialSession, { layers: [layer("pane", 11)] });
    const partialReceipt = await partial.stop();

    expect(partialReceipt.correlation).toMatchObject({
      status: "partial",
      unmatchedIdentities: [
        expect.objectContaining({ slot: "pane-content" }),
        expect.objectContaining({ slot: "pane-live-content" }),
      ],
    });
  });

  it("retains teardown failure in the receipt", async () => {
    const session = cdpSessionWith({
      failLayerTreeDisable: true,
    });
    const collector = await startPerformanceCdpLayerIdentityCollector(session);
    emitLayerTree(session, {
      layers: [layer("pane", 11), layer("content", 12), layer("live", 13)],
    });

    const receipt = await collector.stop();

    expect(receipt.teardown.layerTree).toEqual({
      errors: ["LayerTree.disable: teardown failed"],
      status: "partial",
    });
  });
});

interface SessionOptions {
  failLayerTreeDisable?: boolean;
  hostNodeIds?: readonly number[];
}

function cdpSessionWith(options: SessionOptions): CDPSession {
  const listeners = new Map<string, (event: unknown) => void>();
  const nodeIdForSlot = new Map([
    ["pane-content", 3],
    ["pane-live-content", 4],
  ]);
  const nodes = new Map([
    [
      2,
      {
        attributes: ["data-onirigiri-pane-id", "pane-a"],
        backendNodeId: 11,
        nodeId: 2,
      },
    ],
    [
      3,
      {
        attributes: ["data-onirigiri-slot", "pane-content"],
        backendNodeId: 12,
        nodeId: 3,
      },
    ],
    [
      4,
      {
        attributes: ["data-onirigiri-slot", "pane-live-content"],
        backendNodeId: 13,
        nodeId: 4,
      },
    ],
  ]);
  const context = { nodeIdForSlot, nodes, options };
  const session = {
    off: vi.fn((event: string) => listeners.delete(event)),
    on: vi.fn((event: string, listener: (received: unknown) => void) => {
      listeners.set(event, listener);
    }),
    send: vi.fn((method: string, parameters?: Record<string, unknown>) =>
      cdpResponse(context, method, parameters),
    ),
  } as unknown as CDPSession & { __listeners: typeof listeners };
  Object.assign(session, { __listeners: listeners });
  return session;
}

interface CdpSessionContext {
  nodeIdForSlot: ReadonlyMap<string, number>;
  nodes: ReadonlyMap<
    number,
    { attributes: string[]; backendNodeId: number; nodeId: number }
  >;
  options: SessionOptions;
}

function cdpResponse(
  context: CdpSessionContext,
  method: string,
  parameters?: Record<string, unknown>,
): unknown {
  const handler = cdpResponseHandlers[method];
  return handler ? handler(context, parameters) : {};
}

const cdpResponseHandlers: Readonly<
  Record<
    string,
    (
      context: CdpSessionContext,
      parameters?: Record<string, unknown>,
    ) => unknown
  >
> = {
  "DOM.describeNode": (context, parameters) => ({
    node: context.nodes.get(parameters?.nodeId as number),
  }),
  "DOM.getDocument": () => ({ root: { nodeId: 1 } }),
  "DOM.querySelector": (context, parameters) => ({
    nodeId: nodeIdForSelector(context.nodeIdForSlot, parameters?.selector),
  }),
  "DOM.querySelectorAll": (context) => ({
    nodeIds: context.options.hostNodeIds ?? [2],
  }),
  "LayerTree.disable": (context) => {
    if (context.options.failLayerTreeDisable) {
      throw new Error("teardown failed");
    }
    return {};
  },
};

function nodeIdForSelector(
  nodeIdForSlot: ReadonlyMap<string, number>,
  selector: unknown,
): number {
  return typeof selector === "string"
    ? (nodeIdForSlot.get(slotFromSelector(selector)) ?? 0)
    : 0;
}

function emitLayerTree(
  session: CDPSession,
  event: { layers?: readonly ReturnType<typeof layer>[] },
): void {
  (
    session as unknown as {
      __listeners: Map<string, (received: unknown) => void>;
    }
  ).__listeners.get("LayerTree.layerTreeDidChange")?.(event);
}

function layer(layerId: string, backendNodeId: number) {
  return {
    backendNodeId,
    drawsContent: true,
    height: 1_088,
    layerId,
    offsetX: 10,
    offsetY: 20,
    paintCount: 3,
    width: 1_152,
  };
}

function slotFromSelector(selector: string): string {
  return selector.slice('[data-onirigiri-slot="'.length, -2);
}
