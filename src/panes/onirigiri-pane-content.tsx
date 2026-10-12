import { resolvePaneDefaults } from "../layout/pane-defaults.js";
import {
  PaneDefaultsContext,
  paneContentFrameStyle,
} from "./pane-content-layout.js";
import {
  memo,
  useContext,
  useCallback,
  useLayoutEffect,
  useRef,
  useMemo,
  useState,
  useSyncExternalStore,
  version as reactVersion,
  type CSSProperties,
} from "react";
import { OnirigiriIcon } from "../workspace/onirigiri-icons.js";
import { syncContentAnimations } from "./pane-content-animations.js";
import { PaneInteractiveContext } from "./pane-interactivity.js";
import {
  PaneContentReadiness,
  PaneReadinessContext,
} from "./pane-content-readiness.js";
import type { PanePictures } from "../pictures/pane-pictures.js";
import {
  resolveOnirigiriSlotProps,
  useOnirigiriStyling,
} from "../styles/onirigiri-styling.js";
import type {
  OnirigiriPaneRenderer,
  OnirigiriWorkspaceProps,
} from "../workspace/onirigiri-workspace-types.js";
import type {
  PaneRuntimeState,
  WorkspacePane,
  WorkspacePresentationMode,
} from "../types.js";

interface OnirigiriPaneContentProps {
  focused: boolean;
  maximized: boolean;
  pictures: PanePictures;
  picture: ReturnType<PanePictures["get"]>;
  pane: WorkspacePane;
  placeholderOnly: boolean;
  presentationMode: WorkspacePresentationMode;
  renderPane: OnirigiriPaneRenderer;
  renderPanePlaceholder?: OnirigiriWorkspaceProps["renderPanePlaceholder"];
  restPictureFade?: boolean;
  runtimeState: PaneRuntimeState;
  visible: boolean;
}

export const OnirigiriPaneContent = memo(function OnirigiriPaneContent({
  focused,
  maximized,
  pictures,
  picture,
  pane,
  placeholderOnly,
  presentationMode,
  renderPane,
  renderPanePlaceholder,
  restPictureFade = false,
  runtimeState,
  visible,
}: OnirigiriPaneContentProps) {
  const styling = useOnirigiriStyling();
  const { contentDefaults, contentFit } = usePaneContentLayout(pane);
  const contentSlot = resolveOnirigiriSlotProps(
    styling,
    "pane-content",
    "onirigiri-pane__content",
  );
  const liveSlot = resolveOnirigiriSlotProps(
    styling,
    "pane-live-content",
    "onirigiri-pane__live-content",
  );
  const {
    contentRef,
    readiness,
    overviewCapture,
    preloading,
    mounted,
    contentRuntime,
    continuous,
    presentation,
    covered,
    interactive,
    atRest,
    error,
  } = usePaneContentState({
    pictures,
    pane,
    focused,
    placeholderOnly,
    presentationMode,
    runtimeState,
    restPictureFade,
  });
  useLayoutEffect(() => {
    readiness.invalidate();
  }, [readiness, contentFit, contentDefaults.aspectRatio]);
  useLayoutEffect(() => {
    if (contentRef.current)
      syncContentAnimations(contentRef.current, contentRuntime === "frozen");
  }, [contentRef, contentRuntime]);
  return (
    <div
      className={contentSlot.className}
      data-onirigiri-content-ready={String(!covered)}
      data-onirigiri-placeholder-only={String(!mounted)}
      data-onirigiri-overview-capture={String(overviewCapture)}
      data-onirigiri-preloading={String(preloading)}
      data-onirigiri-slot="pane-content"
      data-runtime-state={contentRuntime}
      data-onirigiri-continuous={String(continuous)}
      style={contentSlot.style}
    >
      <span
        className="onirigiri-pane__paused-status"
        role="status"
        aria-live={focused ? "polite" : "off"}
        hidden={
          contentRuntime !== "frozen" && presentation.kind !== "placeholder"
        }
      >
        Content paused
      </span>
      <div
        className="onirigiri-pane__content-surface"
        data-onirigiri-pane-content-surface="true"
      >
        <canvas
          className="onirigiri-pane__live-surface"
          {...{ layoutsubtree: "" }}
        >
          <div
            aria-hidden={!interactive}
            className={liveSlot.className}
            data-onirigiri-slot="pane-live-content"
            data-onirigiri-content-fit={contentFit}
            {...inertAttribute(
              presentationMode !== "normal" ||
                covered ||
                contentRuntime === "hidden",
            )}
            ref={contentRef}
            style={liveSlot.style}
          >
            <div
              className="onirigiri-pane__content-frame"
              data-onirigiri-content-fit={contentFit}
              style={paneContentFrameStyle(contentDefaults)}
            >
              <PaneReadinessContext.Provider value={readiness}>
                <PaneInteractiveContext value={interactive}>
                  {mounted ? (
                    <PaneApplicationContent
                      renderPane={renderPane}
                      pane={pane}
                      content={contentDefaults}
                      focused={focused}
                      maximized={maximized}
                      presentationMode={presentationMode}
                      runtimeState={contentRuntime}
                      visible={visible}
                    />
                  ) : null}
                </PaneInteractiveContext>
              </PaneReadinessContext.Provider>
            </div>
          </div>
        </canvas>
        <div aria-hidden="true" className="onirigiri-pane__input-shield" />
        <PaneContentCover
          pictures={pictures}
          picture={picture}
          pane={pane}
          covered={covered}
          inputAvailable={
            visible && pictures.isInteractive() && presentationMode === "normal"
          }
          presentation={presentation}
          renderPanePlaceholder={renderPanePlaceholder}
          restPictureFade={restPictureFade}
          atRest={atRest}
          visible={visible}
          error={error}
        />
      </div>
    </div>
  );
});

const PaneApplicationContent = memo(function PaneApplicationContent({
  renderPane,
  pane,
  content,
  focused,
  maximized,
  presentationMode,
  runtimeState,
  visible,
}: Pick<
  OnirigiriPaneContentProps,
  | "renderPane"
  | "pane"
  | "focused"
  | "maximized"
  | "presentationMode"
  | "runtimeState"
  | "visible"
> & { content: ReturnType<typeof usePaneContentLayout>["contentDefaults"] }) {
  return renderPane(pane, {
    content,
    focused,
    frozen: runtimeState === "frozen",
    maximized,
    presentationMode,
    runtimeState,
    visible,
  });
});

interface PaneCoverProps extends Pick<
  OnirigiriPaneContentProps,
  | "pictures"
  | "picture"
  | "pane"
  | "renderPanePlaceholder"
  | "restPictureFade"
  | "visible"
> {
  atRest: boolean;
  covered: boolean;
  inputAvailable: boolean;
  presentation: ReturnType<PanePictures["getPresentation"]>;
  error: string | null;
}

function usePaneCoverState({
  pictures,
  picture,
  pane,
  presentation,
  inputAvailable,
  renderPanePlaceholder,
  covered,
  error,
}: PaneCoverProps) {
  const showPicture =
    !!picture && presentation.kind !== "placeholder" && !error;
  const placeholderInteractive =
    covered && !showPicture && !!renderPanePlaceholder && inputAvailable;
  useLayoutEffect(() => {
    if (!covered) pictures.presentCover(pane.paneId, null);
    else if (!showPicture) pictures.presentCover(pane.paneId, "placeholder");
  }, [covered, showPicture, pictures, pane.paneId]);
  return { showPicture, placeholderInteractive };
}

const PaneContentCover = memo(function PaneContentCover(props: PaneCoverProps) {
  const { pictures, picture, pane, covered, visible, error } = props;
  const { showPicture, placeholderInteractive } = usePaneCoverState(props);
  const { fading, retainedCover, surfaceRef } = usePaneCoverFade(
    props,
    showPicture,
  );
  const coverProps = retainedCover?.props ?? props;
  const coverShowPicture = retainedCover?.showPicture ?? showPicture;
  const surfaceVisible = covered || fading;
  const styling = useOnirigiriStyling();
  const pictureSlot = resolveOnirigiriSlotProps(
    styling,
    "pane-picture",
    "onirigiri-pane__picture",
  );
  if (!surfaceVisible && !picture) return null;
  return (
    <div
      className="onirigiri-pane__picture-surface"
      aria-hidden={!covered || (showPicture && !error)}
      data-onirigiri-picture-visible={String(surfaceVisible)}
      data-onirigiri-picture-fading={String(fading)}
      {...inertAttribute(fading)}
      ref={surfaceRef}
      style={
        fading
          ? { animationDuration: `${panePictureFadeDuration}ms` }
          : undefined
      }
    >
      {surfaceVisible ? (
        <PaneCoverPlaceholder
          {...coverProps}
          showPicture={coverShowPicture}
          interactive={placeholderInteractive}
        />
      ) : null}
      {coverShowPicture && picture ? (
        <PanePicture
          picture={picture}
          pictures={pictures}
          paneId={pane.paneId}
          visible={visible && surfaceVisible}
          className={pictureSlot.className}
          style={pictureSlot.style}
        />
      ) : null}
    </div>
  );
});

const panePictureFadeDuration = 100;

function usePaneCoverFade(props: PaneCoverProps, showPicture: boolean) {
  const { covered, restPictureFade, atRest, visible, picture, error } = props;
  const surfaceRef = useRef<HTMLDivElement>(null);
  const previousCover = useRef<{
    props: PaneCoverProps;
    showPicture: boolean;
  } | null>(null);
  const [finished, setFinished] = useState(false);
  const previous = previousCover.current;
  const fading = Boolean(
    restPictureFade &&
    atRest &&
    visible &&
    !covered &&
    !error &&
    !finished &&
    previous &&
    previous.props.pane === props.pane &&
    (previous.showPicture
      ? previous.props.picture === picture && showPicture
      : previous.props.renderPanePlaceholder === props.renderPanePlaceholder),
  );
  useLayoutEffect(() => {
    if (
      restPictureFade &&
      covered &&
      visible &&
      !error &&
      (showPicture || props.renderPanePlaceholder)
    ) {
      previousCover.current = { props, showPicture };
      if (finished) setFinished(false);
    } else if (!fading) previousCover.current = null;
  }, [
    props,
    covered,
    restPictureFade,
    visible,
    error,
    showPicture,
    finished,
    fading,
  ]);
  useLayoutEffect(() => {
    if (!fading) return;
    const reducedMotion =
      surfaceRef.current?.ownerDocument.defaultView?.matchMedia?.(
        "(prefers-reduced-motion: reduce)",
      );
    if (reducedMotion?.matches) {
      setFinished(true);
      return;
    }
    const changed = () => {
      if (reducedMotion?.matches) setFinished(true);
    };
    reducedMotion?.addEventListener("change", changed);
    const timer = setTimeout(() => setFinished(true), panePictureFadeDuration);
    return () => {
      clearTimeout(timer);
      reducedMotion?.removeEventListener("change", changed);
    };
  }, [fading]);
  return { fading, retainedCover: fading ? previous : null, surfaceRef };
}

function PaneCoverPlaceholder(
  props: PaneCoverProps & { showPicture: boolean; interactive: boolean },
) {
  const { renderPanePlaceholder, interactive, error } = props;
  const styling = useOnirigiriStyling();
  const slot = resolveOnirigiriSlotProps(
    styling,
    "pane-placeholder",
    "onirigiri-pane__placeholder",
  );
  return (
    <div
      className={slot.className}
      data-onirigiri-slot="pane-placeholder"
      data-onirigiri-placeholder-interactive={String(interactive)}
      {...inertAttribute(!!renderPanePlaceholder && !interactive && !error)}
      style={slot.style}
    >
      {panePlaceholderContent(props)}
    </div>
  );
}

function panePlaceholderContent({
  showPicture,
  error,
  renderPanePlaceholder,
  pane,
  presentation,
}: PaneCoverProps & { showPicture: boolean }) {
  if (showPicture) return null;
  if (error) return <span role="alert">{error}</span>;
  if (renderPanePlaceholder) return renderPanePlaceholder(pane, presentation);
  return <PanePlaceholderLabel error={null} title={pane.title} />;
}

function usePaneContentLayout(pane: WorkspacePane) {
  const defaults = useContext(PaneDefaultsContext);
  const contentDefaults = useMemo(
    () => resolvePaneDefaults(pane, defaults).content ?? {},
    [pane, defaults],
  );
  const contentFit =
    contentDefaults.fit ??
    (contentDefaults.aspectRatio ? "contain" : undefined);
  return { contentDefaults, contentFit };
}

function usePaneContentState({
  pictures,
  pane,
  focused,
  placeholderOnly,
  presentationMode,
  runtimeState,
  restPictureFade,
}: Pick<
  OnirigiriPaneContentProps,
  | "pictures"
  | "pane"
  | "focused"
  | "placeholderOnly"
  | "presentationMode"
  | "runtimeState"
  | "restPictureFade"
>) {
  const [readiness] = useState(() => new PaneContentReadiness());
  useSyncExternalStore(
    readiness.subscribe,
    readiness.getSnapshot,
    readiness.getSnapshot,
  );
  const contentRef = useRef<HTMLDivElement | null>(null);
  const subscribe = useCallback(
    (listener: () => void) => pictures.subscribe(pane.paneId, listener),
    [pictures, pane.paneId],
  );
  const getWarmingState = useCallback(
    () =>
      (pictures.isLive(pane.paneId) ? 8 : 0) |
      (pictures.isContinuous() ? 16 : 0) |
      (pictures.isLive(pane.paneId) && pictures.acceptsContentInput()
        ? 32
        : 0) |
      (restPictureFade &&
      pictures.isLive(pane.paneId) &&
      pictures.isInteractive()
        ? 64
        : 0) |
      (pictures.isDrawn(pane.paneId) ? 4 : 0) |
      (pictures.isOverviewCapture(pane.paneId)
        ? 1
        : pictures.isPreloading(pane.paneId)
          ? 2
          : 0),
    [pictures, pane.paneId, restPictureFade],
  );
  const warming = useSyncExternalStore(
    subscribe,
    getWarmingState,
    getWarmingState,
  );
  const getError = useCallback(
    () => pictures.getPaneError(pane.paneId),
    [pictures, pane.paneId],
  );
  const error = useSyncExternalStore(subscribe, getError, getError);
  const getPresentation = useCallback(
    () => pictures.getPresentation(pane.paneId),
    [pictures, pane.paneId],
  );
  const presentation = useSyncExternalStore(
    subscribe,
    getPresentation,
    getPresentation,
  );
  const overviewCapture = (warming & 3) === 1;
  const preloading = (warming & 3) === 2;
  const mounted = !placeholderOnly || (warming & 3) !== 0;
  const mountedRef = useRef(mounted);
  mountedRef.current = mounted;
  const contentRuntime =
    presentation.kind === "texture" &&
    mounted &&
    (warming & 3) === 0 &&
    runtimeState !== "hidden"
      ? "frozen"
      : paneContentRuntime(runtimeState, warming);
  const covered = presentation.covered;
  const interactive =
    contentRuntime === "live" &&
    presentationMode === "normal" &&
    !covered &&
    (warming & 32) !== 0;
  const wasFocused = useRef(focused);
  useLayoutEffect(() => {
    const lostFocus = wasFocused.current && !focused;
    wasFocused.current = focused;
    if (interactive && !lostFocus) return;
    const content = contentRef.current;
    if (content?.contains(content.ownerDocument.activeElement))
      content
        .closest<HTMLElement>('[data-onirigiri-slot="pane"]')
        ?.focus({ preventScroll: true });
  }, [interactive, focused]);
  useLayoutEffect(() => {
    if (!contentRef.current) return;
    return pictures.register(
      pane.paneId,
      contentRef.current,
      readiness,
      () => mountedRef.current,
    );
  }, [pictures, pane.paneId, readiness]);
  return {
    contentRef,
    readiness,
    overviewCapture,
    preloading,
    mounted,
    contentRuntime,
    continuous: (warming & 16) !== 0,
    presentation,
    covered,
    interactive,
    atRest: (warming & 64) !== 0,
    error,
  };
}

function paneContentRuntime(
  runtimeState: PaneRuntimeState,
  warming: number,
): PaneRuntimeState {
  if ((warming & 3) !== 0) return "live";
  if ((warming & 16) !== 0) return (warming & 8) !== 0 ? "live" : "hidden";
  return runtimeState === "live" && (warming & 8) === 0
    ? "frozen"
    : runtimeState;
}

function PanePlaceholderLabel({
  error,
  title,
}: {
  error: string | null;
  title: string;
}) {
  return error ? (
    <span role="alert">{error}</span>
  ) : (
    <>
      <OnirigiriIcon name="overview" />
      <span>{title}</span>
    </>
  );
}

function PanePicture({
  picture,
  pictures,
  paneId,
  visible,
  className,
  style,
}: {
  picture: NonNullable<ReturnType<PanePictures["get"]>>;
  pictures: PanePictures;
  paneId: string;
  visible: boolean;
  className: string;
  style: CSSProperties | undefined;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useLayoutEffect(() => {
    if (!canvas.current || !visible) return;
    const release = picture.texture.present(canvas.current);
    pictures.presentCover(paneId, "texture");
    const frame = requestAnimationFrame(() =>
      pictures.finishOverviewCapture(paneId, picture),
    );
    return () => {
      cancelAnimationFrame(frame);
      release();
    };
  }, [picture, pictures, paneId, visible]);
  return (
    <canvas
      width={1}
      height={1}
      ref={canvas}
      className={className}
      data-onirigiri-slot="pane-picture"
      data-onirigiri-picture-pixelated={String(picture.pixelated)}
      style={{
        objectFit: picture.fit,
        objectPosition: picture.position,
        ...style,
      }}
    />
  );
}

const booleanInert = !reactVersion.startsWith("18.");

function inertAttribute(inert: boolean): { inert?: boolean } {
  return booleanInert
    ? { inert }
    : ({ inert: inert ? "" : undefined } as unknown as { inert?: boolean });
}
