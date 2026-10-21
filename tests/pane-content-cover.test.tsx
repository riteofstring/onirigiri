// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { OnirigiriPaneContent } from "../src/panes/onirigiri-pane-content";
import type { PanePictures } from "../src/pictures/pane-pictures";
import type { PanePresentationState } from "../src/presentation/pane-presentation-policy";
import type { WorkspacePane } from "../src/types";
import {
  editorPane,
  panePicturesStub,
  stubOnirigiriWorkspaceBrowserGlobals,
} from "./onirigiri-workspace-test-support";

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
  picture: initialPicture = null,
  presentation: presentationOverride = {},
}: {
  enabled?: boolean;
  custom?: boolean;
  picture?: ReturnType<PanePictures["get"]>;
  presentation?: Partial<PanePresentationState>;
} = {}) {
  let moving = false;
  let error: string | null = null;
  let picture = initialPicture;
  let presentation: PanePresentationState = {
    requested: custom ? "placeholder" : "dom",
    kind: custom ? "placeholder" : "dom",
    detail: "full",
    variant: "saved",
    reason: "developer-policy",
    actual: picture ? "texture" : "placeholder",
    covered: true,
    live: false,
    ...presentationOverride,
  };
  const interactive = vi.fn(() => !moving);
  const { pictures, notify } = panePicturesStub({
    isLive: () => !presentation.covered,
    isInteractive: interactive,
    isDrawn: () => !presentation.covered,
    getPaneError: () => error,
    getPresentation: () => presentation,
    finishOverviewCapture: vi.fn(),
  });
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
          pane={editorPane}
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
    detail?: PanePresentationState["detail"];
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
      if (next.detail !== undefined)
        presentation = { ...presentation, detail: next.detail };
      if (next.moving !== undefined) moving = next.moving;
      if (next.error !== undefined) error = next.error;
      notify();
    });
  const surface = () =>
    container.querySelector<HTMLElement>(".onirigiri-pane__picture-surface");
  const setPicture = (next: ReturnType<PanePictures["get"]>) => {
    picture = next;
    return render();
  };
  return {
    update,
    render,
    setPicture,
    surface,
    clicked,
    interactive,
    pictures,
  };
}

function previewPicture(
  overrides: Partial<NonNullable<ReturnType<PanePictures["get"]>>> = {},
): NonNullable<ReturnType<PanePictures["get"]>> {
  const texture = {
    width: 64,
    height: 36,
    present: vi.fn((canvas: HTMLCanvasElement) => {
      canvas.width = 64;
      canvas.height = 36;
      return () => {};
    }),
    dispose: vi.fn(),
  };
  return {
    revision: 1,
    capture: null,
    image: new Blob(["Saved picture"]),
    width: 64,
    height: 36,
    originalSize: { width: 640, height: 360 },
    cssSize: { width: 240, height: 120 },
    texture,
    preview: texture,
    fit: "fill",
    position: "left top",
    pixelated: true,
    ...overrides,
  };
}

const pictureCanvas = () =>
  container.querySelector<HTMLCanvasElement>(
    "[data-onirigiri-slot=pane-picture]",
  );

const nativePresentation = {
  requested: "auto",
  kind: "dom",
  reason: "native-presentation",
} as const;

it("covers a preview-only picture with the host placeholder until full detail is prepared", async () => {
  const picture = previewPicture();
  const fixture = await coverFixture({
    picture,
    presentation: nativePresentation,
  });
  expect(container.querySelector("[data-saved-cover]")).not.toBeNull();
  expect(pictureCanvas()).toBeNull();
  expect(picture.texture.present).not.toHaveBeenCalled();
  expect(fixture.pictures.presentCover).toHaveBeenLastCalledWith(
    "editor",
    "placeholder",
  );
  expect(fixture.surface()?.getAttribute("aria-hidden")).toBe("false");
  const detail = {
    ...picture.texture,
    width: 640,
    height: 360,
    present: vi.fn((canvas: HTMLCanvasElement) => {
      canvas.width = 640;
      canvas.height = 360;
      return () => {};
    }),
  };
  await fixture.setPicture({
    ...picture,
    width: 640,
    height: 360,
    texture: detail,
    pixelated: false,
  });
  expect(container.querySelector("[data-saved-cover]")).toBeNull();
  expect(pictureCanvas()?.dataset.onirigiriPicturePixelated).toBe("false");
  expect(detail.present).toHaveBeenCalledOnce();
  expect(picture.texture.present).not.toHaveBeenCalled();
  expect(fixture.pictures.presentCover).toHaveBeenLastCalledWith(
    "editor",
    "texture",
  );
});

it("fades a preview presented during motion when rest requests full detail", async () => {
  const picture = previewPicture();
  const fixture = await coverFixture({
    enabled: true,
    picture,
    presentation: { requested: "texture", kind: "texture", detail: "preview" },
  });
  expect(pictureCanvas()).not.toBeNull();
  expect(picture.texture.present).toHaveBeenCalledOnce();
  await fixture.update({ covered: false, detail: "full" });
  expect(fixture.surface()?.dataset.onirigiriPictureFading).toBe("true");
  expect(pictureCanvas()).not.toBeNull();
  expect(picture.texture.present).toHaveBeenCalledOnce();
  await act(async () => vi.advanceTimersByTimeAsync(100));
  expect(fixture.surface()?.dataset.onirigiriPictureFading).toBe("false");
  expect(fixture.surface()?.dataset.onirigiriPictureVisible).toBe("false");
  expect(pictureCanvas()).toBeNull();
});

it("presents the reduced texture under explicit preview detail", async () => {
  const picture = previewPicture();
  const fixture = await coverFixture({
    picture,
    presentation: { requested: "texture", kind: "texture", detail: "preview" },
  });
  expect(container.querySelector("[data-saved-cover]")).toBeNull();
  expect(pictureCanvas()?.dataset.onirigiriPicturePixelated).toBe("true");
  expect(picture.texture.present).toHaveBeenCalledOnce();
  expect(fixture.pictures.presentCover).toHaveBeenLastCalledWith(
    "editor",
    "texture",
  );
});

it("keeps the host placeholder over a held picture until the host marks the pane visible", async () => {
  const picture = previewPicture({ pixelated: false });
  const fixture = await coverFixture({
    picture,
    presentation: nativePresentation,
  });
  vi.mocked(picture.texture.present).mockClear();
  await fixture.render(false);
  expect(container.querySelector("[data-saved-cover]")).not.toBeNull();
  expect(picture.texture.present).not.toHaveBeenCalled();
  expect(fixture.pictures.presentCover).toHaveBeenLastCalledWith(
    "editor",
    "placeholder",
  );
  await fixture.render(true);
  expect(container.querySelector("[data-saved-cover]")).toBeNull();
  expect(picture.texture.present).toHaveBeenCalledOnce();
  expect(fixture.pictures.presentCover).toHaveBeenLastCalledWith(
    "editor",
    "texture",
  );
});

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

it.each([
  {
    source: "supplied",
    capture: null,
    cssSize: { width: 240, height: 120 },
    width: "240px",
    height: "120px",
    anchor: "auto",
  },
  {
    source: "captured",
    capture: {
      id: "capture",
      devicePixelRatio: 2,
      pixelsPerCss: { x: 2, y: 2 },
      bounds: { x: 0, y: 0, width: 320, height: 180 },
    },
    cssSize: { width: 240, height: 120 },
    width: "320px",
    height: "180px",
    anchor: "auto",
  },
  {
    source: "unsized",
    capture: null,
    cssSize: undefined,
    width: "",
    height: "",
    anchor: "",
  },
])(
  "preserves $source picture sizing across pane shrink and growth",
  async ({ capture, cssSize, width, height, anchor }) => {
    const texture = {
      width: 64,
      height: 36,
      present: vi.fn((canvas: HTMLCanvasElement) => {
        canvas.width = 64;
        canvas.height = 36;
        return () => {};
      }),
      dispose: vi.fn(),
    };
    const picture: NonNullable<ReturnType<PanePictures["get"]>> = {
      revision: 1,
      capture,
      image: new Blob(["Saved picture"]),
      width: 64,
      height: 36,
      originalSize: { width: 640, height: 360 },
      cssSize,
      texture,
      preview: texture,
      fit: "fill",
      position: "left top",
      pixelated: true,
    };
    const fixture = await coverFixture({
      custom: false,
      picture,
      presentation: {
        requested: "texture",
        kind: "texture",
        detail: "preview",
      },
    });
    const canvas = pictureCanvas()!;
    for (const paneSize of [100, 800]) {
      container.style.width = `${paneSize}px`;
      container.style.height = `${paneSize}px`;
      await fixture.render();
      expect(canvas.style.width).toBe(width);
      expect(canvas.style.height).toBe(height);
      expect(canvas.style.right).toBe(anchor);
      expect(canvas.style.bottom).toBe(anchor);
      expect(canvas.width).toBe(64);
      expect(canvas.height).toBe(36);
    }
    expect(texture.present).toHaveBeenCalledOnce();
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
