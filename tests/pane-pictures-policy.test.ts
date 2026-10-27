// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import {
  PanePresentationPolicy,
  type PanePresentationContext,
} from "../src/presentation/pane-presentation-policy";
import { createWorkspaceScene } from "../src/workspace/workspace-scene";

describe("pane presentation policy", () => {
  const pane = createWorkspaceScene({
    panes: [{ paneId: "video", surfaceKind: "media", title: "Video" }],
  }).scene.paneById.get("video")!;
  const context: PanePresentationContext = {
    phase: "rest",
    focused: true,
    maximized: false,
    visible: true,
    capabilities: { canCapture: true, hasVideo: true },
  };
  it("keeps capturable video native automatically and falls back to native graphics without losing the requested mode", () => {
    const policy = new PanePresentationPolicy();
    expect(policy.resolve(pane, context)).toMatchObject({
      requested: "auto",
      kind: "dom",
      reason: "native-presentation",
    });
    policy.configure("canvas");
    expect(
      policy.resolve(pane, {
        ...context,
        capabilities: { canCapture: false, hasVideo: true },
      }),
    ).toMatchObject({
      requested: "canvas",
      kind: "dom",
      reason: "capture-unavailable",
    });
    expect(policy.resolve(pane, context).kind).toBe("canvas");
    policy.configure("dom");
    expect(policy.resolve(pane, context).kind).toBe("dom");
  });
  it("resolves group and phase choices only when semantic inputs change", () => {
    const resolver = vi.fn((value, state: PanePresentationContext) =>
      value.surfaceKind === "media" && state.phase === "overview"
        ? {
            kind: "texture" as const,
            detail: "preview" as const,
            reason: "overview-budget",
          }
        : undefined,
    );
    const policy = new PanePresentationPolicy();
    policy.configure("dom", resolver);
    policy.resolve(pane, context);
    policy.resolve(pane, { ...context });
    expect(resolver).toHaveBeenCalledTimes(1);
    expect(
      policy.resolve(pane, { ...context, phase: "overview" }),
    ).toMatchObject({
      kind: "texture",
      detail: "preview",
      reason: "overview-budget",
    });
    expect(resolver).toHaveBeenCalledTimes(2);
    policy.configure({ kind: "placeholder", variant: "paused" });
    expect(policy.resolve(pane, context)).toMatchObject({
      kind: "placeholder",
      variant: "paused",
    });
  });
  it("keeps equivalent object policies cached and contains resolver failures", () => {
    const policy = new PanePresentationPolicy();
    const resolve = vi.fn(() => undefined);
    policy.configure({ kind: "dom", reason: "native" }, resolve);
    policy.resolve(pane, context);
    policy.configure({ kind: "dom", reason: "native" }, resolve);
    policy.resolve(pane, context);
    expect(resolve).toHaveBeenCalledTimes(1);
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const failure = vi.fn(() => {
        throw new Error("Invalid group rule");
      });
      policy.configure("canvas", failure);
      expect(policy.resolve(pane, context)).toMatchObject({
        kind: "dom",
        reason: "policy-error",
      });
      policy.resolve(pane, { ...context });
      expect(failure).toHaveBeenCalledTimes(1);
      expect(log).toHaveBeenCalledTimes(1);
    } finally {
      log.mockRestore();
    }
  });
});
