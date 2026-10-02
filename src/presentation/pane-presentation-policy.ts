import type { WorkspacePane } from "../types";

export type PaneLiveRenderer = "dom" | "canvas";
export type PanePresentationKind =
  "auto" | PaneLiveRenderer | "texture" | "placeholder";
export type PanePresentationPhase =
  "rest" | "motion" | "overview" | "overview-motion" | "resize";
export type PanePresentation =
  | "auto"
  | PaneLiveRenderer
  | { kind: "auto" | PaneLiveRenderer; reason?: string }
  | { kind: "texture"; detail?: "full" | "preview"; reason?: string }
  | { kind: "placeholder"; variant?: string; reason?: string };

export interface PanePresentationContext {
  phase: PanePresentationPhase;
  focused: boolean;
  maximized: boolean;
  visible: boolean;
  capabilities: { canCapture: boolean | null; hasVideo: boolean };
}

export type PanePresentationResolver = (
  pane: WorkspacePane,
  context: PanePresentationContext,
) => PanePresentation | null | undefined;

export interface ResolvedPanePresentation {
  requested: PanePresentationKind;
  kind: Exclude<PanePresentationKind, "auto">;
  detail: "full" | "preview";
  variant: string;
  reason: string;
}

export interface PanePresentationState extends ResolvedPanePresentation {
  actual: PaneLiveRenderer | "texture" | "placeholder" | "loading" | "error";
  live: boolean;
  covered: boolean;
}

interface CachedDecision {
  pane: WorkspacePane;
  key: string;
  result: ResolvedPanePresentation;
}

export class PanePresentationPolicy {
  private readonly decisions = new Map<string, CachedDecision>();
  private presentation: PanePresentation | undefined;
  private presentationKey: string | undefined;
  private resolver: PanePresentationResolver | undefined;

  configure(
    presentation?: PanePresentation,
    resolver?: PanePresentationResolver,
  ): void {
    const key = JSON.stringify(presentation);
    if (key !== this.presentationKey || resolver !== this.resolver)
      this.decisions.clear();
    this.presentationKey = key;
    this.presentation = presentation;
    this.resolver = resolver;
  }

  forget(paneId: string): void {
    this.decisions.delete(paneId);
  }

  resolve(
    pane: WorkspacePane,
    context: PanePresentationContext,
  ): ResolvedPanePresentation {
    const key = `${context.phase}:${context.focused}:${context.maximized}:${context.visible}:${context.capabilities.canCapture}:${context.capabilities.hasVideo}`;
    const cached = this.decisions.get(pane.paneId);
    if (cached?.pane === pane && cached.key === key) return cached.result;
    let result: ResolvedPanePresentation;
    try {
      result = this.choose(pane, context);
    } catch (error) {
      console.error(
        "Onirigiri pane presentation policy failed",
        pane.paneId,
        error,
      );
      result = {
        requested: "dom",
        kind: "dom",
        detail: "full",
        variant: "icon",
        reason: "policy-error",
      };
    }
    this.decisions.set(pane.paneId, { pane, key, result });
    return result;
  }
  private choose(
    pane: WorkspacePane,
    context: PanePresentationContext,
  ): ResolvedPanePresentation {
    const choice =
      this.resolver?.(pane, context) ?? this.presentation ?? "auto";
    const { value, detail } = normalizePresentation(choice);
    const requested = value.kind;
    const kind = presentationKind(requested, context.capabilities);
    const result: ResolvedPanePresentation = {
      requested,
      kind,
      detail,
      variant:
        value.kind === "placeholder" ? (value.variant ?? "icon") : "icon",
      reason: presentationReason(value, kind),
    };
    return result;
  }
}

type PresentationChoice = Exclude<PanePresentation, string>;

function normalizePresentation(choice: PanePresentation): {
  value: PresentationChoice;
  detail: "full" | "preview";
} {
  const value = typeof choice === "string" ? { kind: choice } : choice;
  if (!["auto", "dom", "canvas", "texture", "placeholder"].includes(value.kind))
    throw new Error("Invalid pane presentation kind");
  const detail = value.kind === "texture" ? (value.detail ?? "full") : "full";
  if (detail !== "full" && detail !== "preview")
    throw new Error("Invalid pane texture detail");
  return { value, detail };
}

function presentationKind(
  requested: PanePresentationKind,
  capabilities: PanePresentationContext["capabilities"],
): ResolvedPanePresentation["kind"] {
  if (requested === "auto") return "dom";
  return requested === "canvas" && capabilities.canCapture !== true
    ? "dom"
    : requested;
}

function presentationReason(
  value: PresentationChoice,
  kind: ResolvedPanePresentation["kind"],
): string {
  const requested = value.kind;
  return kind !== requested && requested === "canvas"
    ? "capture-unavailable"
    : (value.reason ??
        (requested === "auto" ? "native-presentation" : "developer-policy"));
}
