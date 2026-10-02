import type { CDPSession } from "@playwright/test";

export type PerformanceCdpReceiptStatus = "complete" | "missing" | "partial";

const paneContentSlots = ["pane-content", "pane-live-content"] as const;

type PaneContentSlot = (typeof paneContentSlots)[number];

interface CdpDomNode {
  attributes?: readonly string[];
  backendNodeId?: number;
  nodeId: number;
}

interface CdpDocument {
  root: CdpDomNode;
}

interface CdpNodeIds {
  nodeIds: readonly number[];
}

interface CdpNodeId {
  nodeId: number;
}

interface CdpNodeDescription {
  node: CdpDomNode;
}

interface CdpLayer {
  backendNodeId?: number;
  drawsContent: boolean;
  height: number;
  layerId: string;
  offsetX: number;
  offsetY: number;
  paintCount: number;
  parentLayerId?: string;
  transform?: readonly number[];
  width: number;
}

interface CdpLayerTreeDidChange {
  layers?: readonly CdpLayer[];
}

export interface PerformanceCdpIdentity {
  backendNodeId: number;
  paneId: string;
  slot: "pane" | PaneContentSlot;
}

export interface PerformanceCdpLayerGeometry {
  drawsContent: boolean;
  height: number;
  offsetX: number;
  offsetY: number;
  paintCount: number;
  transform?: readonly number[];
  width: number;
}

export interface PerformanceCdpLayerIdentityMatch extends PerformanceCdpIdentity {
  geometry: PerformanceCdpLayerGeometry;
  layerId: string;
  snapshot: number;
}

export interface PerformanceCdpObservedLayer {
  backendNodeId?: number;
  geometry: PerformanceCdpLayerGeometry;
  layerId: string;
  parentLayerId?: string;
}

export interface PerformanceCdpLayerSnapshot {
  layers: readonly PerformanceCdpObservedLayer[];
  snapshot: number;
}

interface PerformanceCdpDiagnosticDomainReceipt {
  errors: readonly string[];
  status: PerformanceCdpReceiptStatus;
}

interface PerformanceCdpDiagnosticTeardownReceipt {
  dom: PerformanceCdpDiagnosticDomainReceipt;
  layerTree: PerformanceCdpDiagnosticDomainReceipt;
}

export interface PerformanceCdpLayerIdentityReceipt {
  correlation: {
    expectedIdentityCount: number;
    matches: readonly PerformanceCdpLayerIdentityMatch[];
    status: PerformanceCdpReceiptStatus;
    unmatchedIdentities: readonly PerformanceCdpIdentity[];
  };
  dom: PerformanceCdpDiagnosticDomainReceipt & {
    identities: readonly PerformanceCdpIdentity[];
    missingSlots: readonly string[];
    visiblePaneIds: readonly string[];
  };
  layerTree: PerformanceCdpDiagnosticDomainReceipt & {
    eventCount: number;
    snapshots: readonly PerformanceCdpLayerSnapshot[];
  };
  teardown: PerformanceCdpDiagnosticTeardownReceipt;
}

export interface PerformanceCdpLayerIdentityCollector {
  stop(): Promise<PerformanceCdpLayerIdentityReceipt>;
}

export async function startPerformanceCdpLayerIdentityCollector(
  session: CDPSession,
): Promise<PerformanceCdpLayerIdentityCollector> {
  const collector = new PerformanceCdpLayerIdentityCollectorImpl(session);
  await collector.start();
  return collector;
}

export function performanceCdpLayerIdentityReceiptArtifact(
  target: { scenarioId: string; viewportId: string },
  receipt: PerformanceCdpLayerIdentityReceipt,
): { contents: string; name: string } {
  return {
    contents: JSON.stringify(receipt, null, 2),
    name: `${target.scenarioId}-${target.viewportId}-cdp-layer-identity.json`,
  };
}

class PerformanceCdpLayerIdentityCollectorImpl implements PerformanceCdpLayerIdentityCollector {
  private readonly domErrors: string[] = [];
  private domEnabled = false;
  private domDisabled = false;
  private readonly identities: PerformanceCdpIdentity[] = [];
  private readonly layerTreeErrors: string[] = [];
  private layerTreeEnabled = false;
  private layerTreeEventCount = 0;
  private layerTreeWasEnabled = false;
  private readonly snapshots: PerformanceCdpLayerSnapshot[] = [];
  private stopped = false;
  private readonly teardownErrors = {
    dom: [] as string[],
    layerTree: [] as string[],
  };
  private readonly visiblePaneIds: string[] = [];
  private readonly missingSlots: string[] = [];

  constructor(private readonly session: CDPSession) {}

  async start(): Promise<void> {
    await this.captureDomIdentities();
    this.session.on("LayerTree.layerTreeDidChange", this.recordLayerTree);
    try {
      await this.session.send("LayerTree.enable");
      this.layerTreeEnabled = true;
      this.layerTreeWasEnabled = true;
    } catch (error) {
      this.layerTreeErrors.push(`LayerTree.enable: ${errorMessage(error)}`);
    }
  }

  async stop(): Promise<PerformanceCdpLayerIdentityReceipt> {
    if (this.stopped) {
      throw new Error(
        "Performance CDP layer identity collector already stopped.",
      );
    }
    this.stopped = true;
    try {
      this.session.off("LayerTree.layerTreeDidChange", this.recordLayerTree);
    } catch (error) {
      this.teardownErrors.layerTree.push(
        `LayerTree listener removal: ${errorMessage(error)}`,
      );
    }
    await this.disableLayerTree();
    await this.disableDom();
    return this.receipt();
  }

  private async captureDomIdentities(): Promise<void> {
    try {
      await this.session.send("DOM.enable", { includeWhitespace: "none" });
      this.domEnabled = true;
      const document = (await this.session.send("DOM.getDocument", {
        depth: 1,
      })) as CdpDocument;
      const hostNodeIds = (await this.session.send("DOM.querySelectorAll", {
        nodeId: document.root.nodeId,
        selector: '[data-onirigiri-pane-id][data-visible="true"]',
      })) as CdpNodeIds;
      if (hostNodeIds.nodeIds.length === 0) {
        this.domErrors.push(
          "No visible Onirigiri pane hosts were returned by DOM.querySelectorAll.",
        );
      }
      for (const hostNodeId of hostNodeIds.nodeIds) {
        await this.capturePaneIdentity(hostNodeId);
      }
    } catch (error) {
      this.domErrors.push(`DOM identity capture: ${errorMessage(error)}`);
    } finally {
      await this.disableDom();
    }
  }

  private async capturePaneIdentity(hostNodeId: number): Promise<void> {
    const host = await this.describeNode(hostNodeId);
    const paneId = attributeValue(host.attributes, "data-onirigiri-pane-id");
    if (!paneId) {
      this.domErrors.push(
        `Visible pane host ${hostNodeId} has no data-onirigiri-pane-id.`,
      );
      return;
    }
    this.visiblePaneIds.push(paneId);
    this.captureIdentity(paneId, "pane", host);
    for (const slot of paneContentSlots) {
      const child = (await this.session.send("DOM.querySelector", {
        nodeId: hostNodeId,
        selector: `[data-onirigiri-slot=\"${slot}\"]`,
      })) as CdpNodeId;
      if (child.nodeId === 0) {
        this.missingSlots.push(`${paneId}:${slot}`);
        continue;
      }
      this.captureIdentity(paneId, slot, await this.describeNode(child.nodeId));
    }
  }

  private async describeNode(nodeId: number): Promise<CdpDomNode> {
    const description = (await this.session.send("DOM.describeNode", {
      nodeId,
    })) as CdpNodeDescription;
    return description.node;
  }

  private captureIdentity(
    paneId: string,
    slot: PerformanceCdpIdentity["slot"],
    node: CdpDomNode,
  ): void {
    if (node.backendNodeId === undefined) {
      this.domErrors.push(`${paneId}:${slot} has no DOM backend node id.`);
      return;
    }
    this.identities.push({ backendNodeId: node.backendNodeId, paneId, slot });
  }

  private readonly recordLayerTree = (event: unknown): void => {
    this.layerTreeEventCount += 1;
    const received = event as CdpLayerTreeDidChange;
    if (!received.layers) {
      this.layerTreeErrors.push("LayerTree.layerTreeDidChange omitted layers.");
      return;
    }
    const snapshot = this.snapshots.length + 1;
    const layers = received.layers.map((layer) => ({
      ...(layer.backendNodeId === undefined
        ? {}
        : { backendNodeId: layer.backendNodeId }),
      geometry: layerGeometry(layer),
      layerId: layer.layerId,
      ...(layer.parentLayerId === undefined
        ? {}
        : { parentLayerId: layer.parentLayerId }),
    }));
    this.snapshots.push({ layers, snapshot });
  };

  private async disableDom(): Promise<void> {
    if (!this.domEnabled || this.domDisabled) {
      return;
    }
    try {
      await this.session.send("DOM.disable");
      this.domDisabled = true;
    } catch (error) {
      this.teardownErrors.dom.push(`DOM.disable: ${errorMessage(error)}`);
    }
  }

  private async disableLayerTree(): Promise<void> {
    if (!this.layerTreeEnabled) {
      return;
    }
    try {
      await this.session.send("LayerTree.disable");
      this.layerTreeEnabled = false;
    } catch (error) {
      this.teardownErrors.layerTree.push(
        `LayerTree.disable: ${errorMessage(error)}`,
      );
    }
  }

  private receipt(): PerformanceCdpLayerIdentityReceipt {
    const identityByBackendNodeId = new Map(
      this.identities.map((identity) => [identity.backendNodeId, identity]),
    );
    const matches = this.snapshots.flatMap((snapshot) =>
      snapshot.layers.flatMap((layer) => {
        const identity =
          layer.backendNodeId === undefined
            ? undefined
            : identityByBackendNodeId.get(layer.backendNodeId);
        return identity
          ? [
              {
                ...identity,
                geometry: layer.geometry,
                layerId: layer.layerId,
                snapshot: snapshot.snapshot,
              },
            ]
          : [];
      }),
    );
    const matchedBackendNodeIds = new Set(
      matches.map((match) => match.backendNodeId),
    );
    const unmatchedIdentities = this.identities.filter(
      (identity) => !matchedBackendNodeIds.has(identity.backendNodeId),
    );
    return {
      correlation: {
        expectedIdentityCount:
          this.identities.length + this.missingSlots.length,
        matches,
        status: receiptStatus(
          this.identities.length + this.missingSlots.length,
          this.domErrors,
          unmatchedIdentities.length + this.missingSlots.length,
        ),
        unmatchedIdentities,
      },
      dom: {
        errors: [...this.domErrors],
        identities: [...this.identities],
        missingSlots: [...this.missingSlots],
        status: receiptStatus(
          this.visiblePaneIds.length * (paneContentSlots.length + 1),
          this.domErrors,
          this.missingSlots.length,
        ),
        visiblePaneIds: [...this.visiblePaneIds],
      },
      layerTree: {
        errors: [...this.layerTreeErrors],
        eventCount: this.layerTreeEventCount,
        snapshots: [...this.snapshots],
        status: receiptStatus(
          this.layerTreeEventCount,
          this.layerTreeErrors,
          0,
        ),
      },
      teardown: {
        dom: teardownStatus(
          this.domEnabled,
          this.domDisabled,
          this.teardownErrors.dom,
        ),
        layerTree: teardownStatus(
          this.layerTreeWasEnabled,
          !this.layerTreeEnabled,
          this.teardownErrors.layerTree,
        ),
      },
    };
  }
}

function attributeValue(
  attributes: readonly string[] | undefined,
  name: string,
): string | undefined {
  if (!attributes) {
    return undefined;
  }
  const index = attributes.indexOf(name);
  return index === -1 ? undefined : attributes[index + 1];
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function layerGeometry(layer: CdpLayer): PerformanceCdpLayerGeometry {
  return {
    drawsContent: layer.drawsContent,
    height: layer.height,
    offsetX: layer.offsetX,
    offsetY: layer.offsetY,
    paintCount: layer.paintCount,
    ...(layer.transform ? { transform: [...layer.transform] } : {}),
    width: layer.width,
  };
}

function receiptStatus(
  observed: number,
  errors: readonly string[],
  missing: number,
): PerformanceCdpReceiptStatus {
  if (observed === 0) {
    return "missing";
  }
  return errors.length === 0 && missing === 0 ? "complete" : "partial";
}

function teardownStatus(
  wasEnabled: boolean,
  disabled: boolean,
  errors: readonly string[],
): PerformanceCdpDiagnosticDomainReceipt {
  return {
    errors: [...errors],
    status: !wasEnabled
      ? "missing"
      : disabled && errors.length === 0
        ? "complete"
        : "partial",
  };
}
