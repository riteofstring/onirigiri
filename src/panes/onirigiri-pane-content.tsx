import { resolvePaneDefaults } from "../layout/pane-defaults";
import {
  PaneDefaultsContext,
  paneContentFrameStyle,
} from "./pane-content-layout";
import {
  memo,
  useContext,
  useCallback,
  useLayoutEffect,
  useRef,
  useMemo,
  useState,
  useSyncExternalStore,
  type CSSProperties,
} from "react";
import { OnirigiriIcon } from "../workspace/onirigiri-icons";
import {
  PaneContentReadiness,
  PaneReadinessContext,
} from "./pane-content-readiness";
import type { PanePictures } from "../pictures/pane-pictures";
import {
  resolveOnirigiriSlotProps,
  useOnirigiriStyling,
} from "../styles/onirigiri-styling";
import type {
  OnirigiriPaneRenderer,
  OnirigiriWorkspaceProps,
} from "../workspace/onirigiri-workspace-types";
import type {
  PaneRuntimeState,
  WorkspacePane,
  WorkspacePresentationMode,
} from "../types";

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
    presentation,
    covered,
    interactive,
    error,
  } = usePaneContentState({
    pictures,
    pane,
    placeholderOnly,
    presentationMode,
    runtimeState,
  });
  useLayoutEffect(() => {
    readiness.invalidate();
  }, [readiness, contentFit, contentDefaults.aspectRatio]);
  return (
    <div
      className={contentSlot.className}
      data-onirigiri-content-ready={String(!covered)}
      data-onirigiri-placeholder-only={String(!mounted)}
      data-onirigiri-overview-capture={String(overviewCapture)}
      data-onirigiri-preloading={String(preloading)}
      data-onirigiri-slot="pane-content"
      data-runtime-state={contentRuntime}
      data-onirigiri-continuous={String(pictures.isContinuous())}
      style={contentSlot.style}
    >
      {contentRuntime === "frozen" || presentation.kind === "placeholder" ? (
        <span
          className="onirigiri-pane__paused-status"
          role="status"
          aria-live={focused ? "polite" : "off"}
        >
          Content paused
        </span>
      ) : null}
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
            inert={!interactive}
            ref={contentRef}
            style={liveSlot.style}
          >
            <div
              className="onirigiri-pane__content-frame"
              data-onirigiri-content-fit={contentFit}
              style={paneContentFrameStyle(contentDefaults)}
            >
              <PaneReadinessContext.Provider value={readiness}>
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
              </PaneReadinessContext.Provider>
            </div>
          </div>
        </canvas>
        <PaneContentCover
          pictures={pictures}
          picture={picture}
          pane={pane}
          covered={covered}
          presentation={presentation}
          presentationMode={presentationMode}
          renderPanePlaceholder={renderPanePlaceholder}
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
  | "presentationMode"
  | "renderPanePlaceholder"
  | "visible"
> {
  covered: boolean;
  presentation: ReturnType<PanePictures["getPresentation"]>;
  error: string | null;
}

function usePaneCoverState({
  pictures,
  picture,
  pane,
  presentation,
  presentationMode,
  renderPanePlaceholder,
  covered,
  error,
}: PaneCoverProps) {
  const showPicture =
    !!picture && presentation.kind !== "placeholder" && !error;
  const placeholderInteractive =
    covered &&
    !showPicture &&
    !!renderPanePlaceholder &&
    pictures.isInteractive() &&
    presentationMode === "normal";
  useLayoutEffect(() => {
    if (!covered) pictures.presentCover(pane.paneId, null);
    else if (!showPicture) pictures.presentCover(pane.paneId, "placeholder");
  }, [covered, showPicture, pictures, pane.paneId]);
  return { showPicture, placeholderInteractive };
}

function PaneContentCover(props: PaneCoverProps) {
  const { pictures, picture, pane, covered, visible, error } = props;
  const { showPicture, placeholderInteractive } = usePaneCoverState(props);
  const styling = useOnirigiriStyling();
  const pictureSlot = resolveOnirigiriSlotProps(
    styling,
    "pane-picture",
    "onirigiri-pane__picture",
  );
  if (!covered && !picture) return null;
  return (
    <div
      className="onirigiri-pane__picture-surface"
      aria-hidden={!covered || (showPicture && !error)}
      data-onirigiri-picture-visible={String(covered)}
    >
      {covered ? (
        <PaneCoverPlaceholder
          {...props}
          showPicture={showPicture}
          interactive={placeholderInteractive}
        />
      ) : null}
      {showPicture && picture ? (
        <PanePicture
          picture={picture}
          pictures={pictures}
          paneId={pane.paneId}
          visible={visible && covered}
          className={pictureSlot.className}
          style={pictureSlot.style}
        />
      ) : null}
    </div>
  );
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
      inert={!!renderPanePlaceholder && !interactive && !error}
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
  placeholderOnly,
  presentationMode,
  runtimeState,
}: Pick<
  OnirigiriPaneContentProps,
  "pictures" | "pane" | "placeholderOnly" | "presentationMode" | "runtimeState"
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
      (pictures.isLive(pane.paneId) && pictures.isInteractive() ? 32 : 0) |
      (pictures.isDrawn(pane.paneId) ? 4 : 0) |
      (pictures.isOverviewCapture(pane.paneId)
        ? 1
        : pictures.isPreloading(pane.paneId)
          ? 2
          : 0),
    [pictures, pane.paneId],
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
  useLayoutEffect(() => {
    const content = contentRef.current;
    if (!interactive && content?.contains(content.ownerDocument.activeElement))
      content
        .closest<HTMLElement>('[data-onirigiri-slot="pane"]')
        ?.focus({ preventScroll: true });
  }, [interactive]);
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
    presentation,
    covered,
    interactive,
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
