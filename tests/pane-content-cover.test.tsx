// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { OnirigiriPaneContent } from "../src/panes/onirigiri-pane-content";
import type { PanePictures } from "../src/pictures/pane-pictures";
import type { PanePresentationState } from "../src/presentation/pane-presentation-policy";
import type { WorkspacePane } from "../src/types";
import { stubOnirigiriWorkspaceBrowserGlobals } from "./onirigiri-workspace-test-support";

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  vi.useFakeTimers();
  stubOnirigiriWorkspaceBrowserGlobals();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function coverFixture({
  enabled,
  custom = true,
  picture = null,
}: {
  enabled?: boolean;
  custom?: boolean;
  picture?: ReturnType<PanePictures["get"]>;
} = {}) {
  let moving = false;
  let error: string | null = null;
  let presentation: PanePresentationState = {
    requested: custom ? "placeholder" : "dom",
    kind: custom ? "placeholder" : "dom",
    detail: "full",
    variant: "saved",
    reason: "developer-policy",
    actual: picture ? "texture" : "placeholder",
    covered: true,
    live: false,
  };
  const listeners = new Set<() => void>();
  const interactive = vi.fn(() => !moving);
  const pictures = {
    subscribe: (_id: string, listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    isLive: () => !presentation.covered,
    isContinuous: () => true,
    isInteractive: interactive,
    acceptsContentInput: () => true,
    isDrawn: () => !presentation.covered,
    isOverviewCapture: () => false,
    isPreloading: () => false,
    getPaneError: () => error,
    getPresentation: () => presentation,
    presentCover: vi.fn(),
    finishOverviewCapture: vi.fn(),
    register: () => () => {},
  } as unknown as PanePictures;
  const pane: WorkspacePane = {
    paneId: "editor",
    columnId: "column",
    sequence: 0,
    surfaceId: "editor",
    surfaceKind: "editor",
    title: "Editor",
    subtitle: "",
    tone: "slate",
  };
  const clicked = vi.fn();
  const renderPane = () => <button onClick={clicked}>Live editor</button>;
  const renderPlaceholder = (
    _pane: WorkspacePane,
    state: PanePresentationState,
  ) => <button data-saved-cover={state.variant}>Saved picture</button>;
  const render = (visible = true, restPictureFade = enabled) =>
    act(async () => {
      root.render(
        <OnirigiriPaneContent
          focused
          maximized={false}
          picture={picture}
          pictures={pictures}
          pane={pane}
          placeholderOnly={false}
          presentationMode="normal"
          renderPane={renderPane}
          renderPanePlaceholder={custom ? renderPlaceholder : undefined}
          restPictureFade={restPictureFade}
          runtimeState="live"
          visible={visible}
        />,
      );
    });
  await render();
  const update = (next: {
    covered?: boolean;
    moving?: boolean;
    error?: string;
  }) =>
    act(async () => {
      if (next.covered !== undefined)
        presentation = {
          ...presentation,
          kind: next.covered && custom ? "placeholder" : "dom",
          variant: next.covered ? "saved" : "icon",
          actual: next.covered ? "placeholder" : "dom",
          covered: next.covered,
          live: !next.covered,
        };
      if (next.moving !== undefined) moving = next.moving;
      if (next.error !== undefined) error = next.error;
      for (const listener of listeners) listener();
    });
  const surface = () =>
    container.querySelector<HTMLElement>(".onirigiri-pane__picture-surface");
  return { update, render, surface, clicked, interactive, pictures };
}

it("removes covers immediately by default without adding motion subscriptions", async () => {
  const fixture = await coverFixture();
  await fixture.update({ covered: false });
  expect(fixture.surface()).toBeNull();
  expect(vi.getTimerCount()).toBe(0);
  fixture.interactive.mockClear();
  await fixture.update({ moving: true });
  await fixture.update({ moving: false });
  expect(fixture.interactive).not.toHaveBeenCalled();
});

it("fades the displayed custom cover for 100 ms while native input is already live", async () => {
  const fixture = await coverFixture({ enabled: true });
  const saved = container.querySelector("[data-saved-cover]");
  const live = container.querySelector<HTMLButtonElement>(
    ".onirigiri-pane__live-content button",
  )!;
  await fixture.update({ covered: false });
  expect(container.querySelector("[data-saved-cover]")).toBe(saved);
  expect(saved?.getAttribute("data-saved-cover")).toBe("saved");
  expect(fixture.surface()?.dataset.onirigiriPictureFading).toBe("true");
  expect(fixture.surface()?.hasAttribute("inert")).toBe(true);
  expect(fixture.surface()?.getAttribute("aria-hidden")).toBe("true");
  expect(saved?.parentElement?.dataset.onirigiriPlaceholderInteractive).toBe(
    "false",
  );
  expect(live.closest("[inert]")).toBeNull();
  expect(
    live.closest("[data-runtime-state]")?.getAttribute("data-runtime-state"),
  ).toBe("live");
  await act(async () => live.click());
  expect(fixture.clicked).toHaveBeenCalledOnce();
  await act(async () => vi.advanceTimersByTimeAsync(99));
  expect(container.querySelector("[data-saved-cover]")).toBe(saved);
  await act(async () => vi.advanceTimersByTimeAsync(1));
  expect(fixture.surface()).toBeNull();
  expect(container.querySelector(".onirigiri-pane__live-content button")).toBe(
    live,
  );
});

it("cancels a rest fade as soon as motion resumes and never restarts the old cover", async () => {
  const fixture = await coverFixture({ enabled: true });
  await fixture.update({ covered: false });
  expect(fixture.surface()?.dataset.onirigiriPictureFading).toBe("true");
  await fixture.update({ moving: true });
  expect(fixture.surface()).toBeNull();
  expect(vi.getTimerCount()).toBe(0);
  const requestedFrames = vi.mocked(requestAnimationFrame).mock.calls.length;
  for (let frame = 0; frame < 3; frame++)
    await fixture.update({ moving: true });
  expect(vi.mocked(requestAnimationFrame).mock.calls).toHaveLength(
    requestedFrames,
  );
  await fixture.update({ moving: false });
  expect(fixture.surface()).toBeNull();
  expect(vi.getTimerCount()).toBe(0);
});

it("skips fading for cold generic placeholders and content revealed during motion", async () => {
  const generic = await coverFixture({ enabled: true, custom: false });
  await generic.update({ covered: false });
  expect(generic.surface()).toBeNull();
  const custom = await coverFixture({ enabled: true });
  await custom.update({ covered: false, moving: true });
  expect(custom.surface()).toBeNull();
  expect(vi.getTimerCount()).toBe(0);
});

it("skips retention with reduced motion and releases an active fade when the preference changes", async () => {
  const query = {
    matches: true,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => query),
  );
  const fixture = await coverFixture({ enabled: true });
  await fixture.update({ covered: false });
  expect(fixture.surface()).toBeNull();
  expect(vi.getTimerCount()).toBe(0);
  query.matches = false;
  await fixture.update({ covered: true });
  await fixture.update({ covered: false });
  expect(fixture.surface()?.dataset.onirigiriPictureFading).toBe("true");
  await act(async () => {
    query.matches = true;
    query.addEventListener.mock.calls[0]![1]();
  });
  expect(fixture.surface()).toBeNull();
  expect(vi.getTimerCount()).toBe(0);
  expect(query.removeEventListener).toHaveBeenCalledOnce();
});

it.each(["error", "hidden", "disabled", "unmount"])(
  "cleans up a departing cover after %s",
  async (change) => {
    const fixture = await coverFixture({ enabled: true });
    await fixture.update({ covered: false });
    if (change === "error") await fixture.update({ error: "Unavailable" });
    else if (change === "hidden") await fixture.render(false);
    else if (change === "disabled") await fixture.render(true, false);
    else await act(async () => root.render(null));
    expect(fixture.surface()).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  },
);

it("keeps the existing texture output through the fade and releases its buffer at completion", async () => {
  const release = vi.fn();
  const texture = {
    width: 10,
    height: 10,
    present: vi.fn((canvas: HTMLCanvasElement) => {
      canvas.width = canvas.height = 10;
      return () => {
        canvas.width = canvas.height = 1;
        release();
      };
    }),
    dispose: vi.fn(),
  };
  const picture: NonNullable<ReturnType<PanePictures["get"]>> = {
    revision: 1,
    capture: null,
    image: new Blob(["Saved picture"]),
    width: 10,
    height: 10,
    originalSize: { width: 10, height: 10 },
    texture,
    preview: texture,
    fit: "fill",
    position: "center",
    pixelated: false,
  };
  const fixture = await coverFixture({ enabled: true, custom: false, picture });
  const canvas = container.querySelector<HTMLCanvasElement>(
    "[data-onirigiri-slot=pane-picture]",
  )!;
  const requestedFrames = vi.mocked(requestAnimationFrame).mock.calls.length;
  expect(canvas.width).toBe(10);
  await fixture.update({ covered: false });
  expect(canvas.width).toBe(10);
  expect(release).not.toHaveBeenCalled();
  expect(texture.present).toHaveBeenCalledOnce();
  expect(vi.mocked(requestAnimationFrame).mock.calls).toHaveLength(
    requestedFrames,
  );
  await act(async () => vi.advanceTimersByTimeAsync(100));
  expect(canvas.width).toBe(1);
  expect(release).toHaveBeenCalledOnce();
  expect(fixture.surface()?.dataset.onirigiriPictureVisible).toBe("false");
  expect(texture.dispose).not.toHaveBeenCalled();
});
