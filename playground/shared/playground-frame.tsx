import {
  PlaygroundThemeContext,
  readPlaygroundTheme,
  type PlaygroundContentTheme,
} from "./playground-theme";
import type {
  PaneSizingMode,
  WorkspaceCameraMode,
  WorkspaceCameraModes,
  WorkspaceDirectionControlMode,
  WorkspaceFocusAnchor,
  WorkspacePresentationMode,
  OnirigiriShortcutBindings,
} from "@riteofstring/onirigiri";
import {
  useEffect,
  useLayoutEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ReactNode,
} from "react";

import { usePlaygroundMenu } from "./playground-menu";
import { DisplayFrameRate } from "./display-frame-rate";
import {
  PlaygroundShortcuts,
  platformShortcutLabel,
} from "./playground-shortcuts";

type PlaygroundModel = "1d" | "2d";

type PlaygroundColorMode = "dark" | "light";
type PlaygroundPreviewMode = "desktop" | "mobile";

interface PlaygroundPreviewState {
  compactBreakpoint: number;
  compactPanePeek: number;
  desktopControlsContainer: HTMLElement | null;
  directionControlMode: WorkspaceDirectionControlMode;
  focusAnchor: WorkspaceFocusAnchor;
  mode: PlaygroundPreviewMode;
}

type PlaygroundChildren =
  ReactNode | ((state: PlaygroundPreviewState) => ReactNode);

const colorModeStorageKey = "onirigiri-playground-color-mode";
const mobilePreviewQuery = "(max-width: 640px)";

export function PlaygroundFrame({
  actions,
  children,
  contentThemeOverrides,
  guide,
  moreActions,
  model,
  onResizePanes,
  onReturnHome,
  onCameraModesChange,
  onToggleOverview,
  cameraModes,
  presentationMode,
  status,
  shortcuts,
  subtitle,
  title,
  workspaceLabel,
}: {
  actions: ReactNode;
  children: PlaygroundChildren;
  contentThemeOverrides?: Partial<PlaygroundContentTheme>;
  guide?: ReactNode;
  moreActions?: ReactNode;
  model: PlaygroundModel;
  onResizePanes: (mode: PaneSizingMode) => void;
  onReturnHome?: () => void;
  onCameraModesChange?: (modes: WorkspaceCameraModes) => void;
  onToggleOverview: () => void;
  cameraModes?: WorkspaceCameraModes;
  presentationMode: WorkspacePresentationMode;
  status: ReactNode;
  shortcuts?: OnirigiriShortcutBindings;
  subtitle: string;
  title: string;
  workspaceLabel: string;
}) {
  const [colorMode, setColorMode] =
    useState<PlaygroundColorMode>(initialColorMode);
  const [focusAnchor, setFocusAnchor] =
    useState<WorkspaceFocusAnchor>("center");
  const [directionControlMode, setDirectionControlMode] =
    useState<WorkspaceDirectionControlMode>("focus");
  const [previewMode, setPreviewMode] =
    useState<PlaygroundPreviewMode>(initialPreviewMode);
  const [mobilePeek, setMobilePeek] = useState(false);
  const [desktopControlsContainer, setDesktopControlsContainer] =
    useState<HTMLElement | null>(null);
  const headerRef = useRef<HTMLElement | null>(null);
  const [contentTheme, setContentTheme] =
    useState<PlaygroundContentTheme | null>(null);
  useLayoutEffect(() => {
    document.documentElement.dataset.colorMode = colorMode;
    if (headerRef.current)
      setContentTheme(
        readPlaygroundTheme(
          headerRef.current,
          colorMode,
          contentThemeOverrides,
        ),
      );
  }, [colorMode, contentThemeOverrides]);
  useEffect(() => {
    try {
      window.localStorage.setItem(colorModeStorageKey, colorMode);
    } catch {}
  }, [colorMode]);

  useEffect(() => {
    const query = window.matchMedia?.(mobilePreviewQuery);
    if (!query) {
      return;
    }
    const syncPreviewToViewport = (
      event: MediaQueryListEvent | MediaQueryList,
    ) => {
      setPreviewMode(event.matches ? "mobile" : "desktop");
    };
    query.addEventListener("change", syncPreviewToViewport);
    return () => query.removeEventListener("change", syncPreviewToViewport);
  }, []);

  const previewState: PlaygroundPreviewState = {
    compactBreakpoint: previewMode === "mobile" ? Number.POSITIVE_INFINITY : 0,
    compactPanePeek: previewMode === "mobile" && mobilePeek ? 18 : 0,
    desktopControlsContainer,
    directionControlMode,
    focusAnchor,
    mode: previewMode,
  };

  return (
    <PlaygroundThemeContext.Provider value={contentTheme}>
      <div
        className="playground-shell"
        data-color-mode={colorMode}
        data-focus-anchor={focusAnchor}
        data-mobile-peek={String(previewState.compactPanePeek > 0)}
        data-model={model}
        data-preview-mode={previewMode}
      >
        <a className="skip-link" href="#playground-workspace">
          Skip to workspace
        </a>
        <header className="playground-header" ref={headerRef}>
          <div className="playground-brand">
            <span aria-hidden="true" className="playground-mark">
              <i />
              <i />
              <i />
            </span>
            <div className="playground-brand__text">
              <h1>{title}</h1>
              <small>{subtitle}</small>
            </div>
          </div>
          <div
            aria-label="Workspace navigation and display"
            className="playground-navigation"
            role="group"
          >
            <div className="playground-camera-controls">
              <div
                className="playground-workspace-navigation"
                ref={setDesktopControlsContainer}
              />
              <PlaygroundDirectionControlMode
                mode={directionControlMode}
                onChange={setDirectionControlMode}
              />
              {onReturnHome ? (
                <PlaygroundHomeControl onReturnHome={onReturnHome} />
              ) : null}
              <PlaygroundZoomToggle
                mode={presentationMode}
                onToggle={onToggleOverview}
              />
            </div>
            <PlaygroundPreviewControls
              mobilePeek={mobilePeek}
              mode={previewMode}
              onMobilePeekChange={setMobilePeek}
              onModeChange={setPreviewMode}
            />
          </div>
          <div
            aria-label="Playground controls"
            className="playground-actions"
            role="group"
          >
            <div className="playground-primary-actions">{actions}</div>
            <PlaygroundShortcuts shortcuts={shortcuts} />
            <PlaygroundMoreMenu
              cameraModes={cameraModes}
              colorMode={colorMode}
              focusAnchor={focusAnchor}
              moreActions={moreActions}
              onCameraModesChange={onCameraModesChange}
              onColorModeChange={setColorMode}
              onFocusAnchorChange={setFocusAnchor}
              onResizePanes={onResizePanes}
              paneSizingDisabled={previewMode === "mobile"}
            />
          </div>
          <div className="playground-status-row">
            <PlaygroundStatus>{status}</PlaygroundStatus>
            <DisplayFrameRate />
          </div>
        </header>
        <main
          className="playground-main"
          data-has-guide={String(Boolean(guide))}
          id="playground-workspace"
          tabIndex={-1}
        >
          {guide ? (
            <aside aria-label="Interaction guide" className="playground-guide">
              {guide}
            </aside>
          ) : null}
          <section className="playground-canvas" aria-label={workspaceLabel}>
            <div className="playground-preview">
              {typeof children === "function"
                ? children(previewState)
                : children}
            </div>
          </section>
        </main>
      </div>
    </PlaygroundThemeContext.Provider>
  );
}

function PlaygroundStatus({ children }: { children: ReactNode }) {
  return (
    <div
      aria-atomic="true"
      aria-label="Playground status"
      className="playground-status"
      role="status"
    >
      <span aria-hidden="true" className="playground-status__dot" />
      {children}
    </div>
  );
}

export function PlaygroundCommandGroup({
  children,
  label,
}: {
  children: ReactNode;
  label: string;
}) {
  return (
    <div aria-label={label} className="playground-command-group" role="group">
      <span aria-hidden="true" className="playground-command-group__label">
        {label}
      </span>
      <div className="playground-command-group__controls">{children}</div>
    </div>
  );
}

function PlaygroundDirectionControlMode({
  mode,
  onChange,
}: {
  mode: WorkspaceDirectionControlMode;
  onChange: (mode: WorkspaceDirectionControlMode) => void;
}) {
  return (
    <label className="playground-direction-mode">
      <span className="playground-visually-hidden">D-pad action</span>
      <select
        aria-label="D-pad action"
        onChange={(event) =>
          onChange(event.currentTarget.value as WorkspaceDirectionControlMode)
        }
        value={mode}
      >
        <option value="focus">Navigate</option>
        <option value="move-pane">Move pane</option>
        <option value="move-group">Move group</option>
      </select>
    </label>
  );
}

function PlaygroundMoreMenu({
  cameraModes,
  colorMode,
  focusAnchor,
  moreActions,
  onCameraModesChange,
  onColorModeChange,
  onFocusAnchorChange,
  onResizePanes,
  paneSizingDisabled,
}: {
  cameraModes: WorkspaceCameraModes | undefined;
  colorMode: PlaygroundColorMode;
  focusAnchor: WorkspaceFocusAnchor;
  moreActions: ReactNode;
  onCameraModesChange: ((modes: WorkspaceCameraModes) => void) | undefined;
  onColorModeChange: (mode: PlaygroundColorMode) => void;
  onFocusAnchorChange: (anchor: WorkspaceFocusAnchor) => void;
  onResizePanes: (mode: PaneSizingMode) => void;
  paneSizingDisabled: boolean;
}) {
  const { menuProps } = usePlaygroundMenu();
  return (
    <details className="playground-more-menu" {...menuProps}>
      <summary title="More controls">
        <MoreIcon />
        <span>More</span>
      </summary>
      <div className="playground-more-menu__panel">
        {moreActions ? (
          <section className="playground-more-actions">
            <h2>Arrange</h2>
            {moreActions}
          </section>
        ) : null}
        {cameraModes && onCameraModesChange ? (
          <section>
            <h2>Camera</h2>
            <PlaygroundCameraModeControls
              cameraModes={cameraModes}
              onCameraModesChange={onCameraModesChange}
            />
          </section>
        ) : null}
        <section>
          <h2>View</h2>
          <div className="playground-utilities" role="group">
            <PlaygroundFocusAnchorToggle
              focusAnchor={focusAnchor}
              onToggle={() =>
                onFocusAnchorChange(
                  focusAnchor === "center" ? "start" : "center",
                )
              }
            />
            <PlaygroundToolbarButton
              aria-label={
                colorMode === "light" ? "Use dark mode" : "Use light mode"
              }
              aria-pressed={colorMode === "light"}
              className="playground-theme-toggle"
              onClick={() =>
                onColorModeChange(colorMode === "light" ? "dark" : "light")
              }
              tooltip={
                colorMode === "light" ? "Use dark mode" : "Use light mode"
              }
            >
              <span
                aria-hidden="true"
                className="playground-theme-toggle__icons"
              >
                <ThemeIcon name="sun" visible={colorMode === "light"} />
                <ThemeIcon name="moon" visible={colorMode === "dark"} />
              </span>
              <span className="playground-theme-toggle__label">
                {colorMode === "light" ? "Dark" : "Light"}
              </span>
            </PlaygroundToolbarButton>
          </div>
        </section>
        <section>
          <h2>Pane size</h2>
          <PlaygroundPaneSizing
            disabled={paneSizingDisabled}
            onResizePanes={onResizePanes}
          />
        </section>
      </div>
    </details>
  );
}

function PlaygroundPaneSizing({
  disabled,
  onResizePanes,
}: {
  disabled: boolean;
  onResizePanes: (mode: PaneSizingMode) => void;
}) {
  const tooltipPrefix = useId();
  const actions: readonly {
    label: string;
    mode: PaneSizingMode;
    tooltip: string;
  }[] = [
    {
      label: "Restore default pane sizing",
      mode: "default",
      tooltip: "Restore every pane to the workspace default sizing",
    },
    {
      label: "Fit all panes to content",
      mode: "fit-content",
      tooltip: "Fit every pane to its content",
    },
    {
      label: "Shrink all panes to minimum size",
      mode: "minimum",
      tooltip: "Shrink every pane to its minimum size",
    },
    {
      label: "Expand all panes to full size",
      mode: "full",
      tooltip: "Expand every pane to the full workspace size",
    },
  ];
  return (
    <div
      aria-label="Resize all panes"
      className="playground-pane-sizing"
      role="group"
    >
      {actions.map(({ label, mode, tooltip }) => {
        const tooltipId = `${tooltipPrefix}-${mode}`;
        return (
          <span className="playground-pane-sizing__control" key={mode}>
            <button
              aria-describedby={tooltipId}
              aria-label={label}
              disabled={disabled}
              onClick={() => onResizePanes(mode)}
              type="button"
            >
              <PaneSizeIcon mode={mode} />
            </button>
            <span
              className="playground-pane-sizing__tooltip"
              id={tooltipId}
              role="tooltip"
            >
              {disabled
                ? "Pane sizing is fixed in the mobile preview"
                : tooltip}
            </span>
          </span>
        );
      })}
    </div>
  );
}

function PaneSizeIcon({ mode }: { mode: PaneSizingMode }) {
  return (
    <svg aria-hidden="true" fill="none" focusable="false" viewBox="0 0 20 20">
      {mode === "default" ? (
        <>
          <rect height="11" rx="1.5" width="11" x="4.5" y="4.5" />
          <path d="M7 2.75H4.5v2.5M13 17.25h2.5v-2.5M4.5 2.75 7 5.25M15.5 17.25 13 14.75" />
        </>
      ) : mode === "fit-content" ? (
        <>
          <path d="M3.5 5h13M3.5 10h9M3.5 15h6" />
          <path d="m14.5 8 2 2-2 2" />
        </>
      ) : mode === "minimum" ? (
        <>
          <rect height="6" rx="1" width="6" x="7" y="7" />
          <path d="m3.5 3.5 2.75 2.75M16.5 3.5l-2.75 2.75M3.5 16.5l2.75-2.75M16.5 16.5l-2.75-2.75" />
        </>
      ) : (
        <>
          <rect height="13" rx="1.5" width="13" x="3.5" y="3.5" />
          <path d="M7 7H5v2M13 7h2v2M7 13H5v-2M13 13h2v-2" />
        </>
      )}
    </svg>
  );
}

function PlaygroundPreviewControls({
  mobilePeek,
  mode,
  onMobilePeekChange,
  onModeChange,
}: {
  mobilePeek: boolean;
  mode: PlaygroundPreviewMode;
  onMobilePeekChange: (enabled: boolean) => void;
  onModeChange: (mode: PlaygroundPreviewMode) => void;
}) {
  return (
    <div
      aria-label="Workspace preview"
      className="playground-preview-controls"
      role="group"
    >
      {(["desktop", "mobile"] as const).map((candidate) => {
        const label = candidate === "desktop" ? "Desktop" : "Mobile";
        return (
          <button
            aria-label={`Show ${candidate} workspace preview`}
            aria-pressed={mode === candidate}
            key={candidate}
            onClick={() => onModeChange(candidate)}
            title={`${label} workspace preview`}
            type="button"
          >
            <PreviewIcon name={candidate} />
            <span>{label}</span>
          </button>
        );
      })}
      {mode === "mobile" ? (
        <button
          aria-label="Peek at adjacent panes"
          aria-pressed={mobilePeek}
          className="playground-preview-controls__peek"
          onClick={() => onMobilePeekChange(!mobilePeek)}
          title="Show a hint of adjacent panes"
          type="button"
        >
          <PreviewIcon name="peek" />
          <span>Peek</span>
        </button>
      ) : null}
    </div>
  );
}

function PreviewIcon({ name }: { name: PlaygroundPreviewMode | "peek" }) {
  return (
    <svg aria-hidden="true" fill="none" focusable="false" viewBox="0 0 20 20">
      {name === "desktop" ? (
        <>
          <rect height="10" rx="1.5" width="15" x="2.5" y="3" />
          <path d="M7 17h6M10 13v4" />
        </>
      ) : name === "mobile" ? (
        <>
          <rect height="16" rx="2" width="10" x="5" y="2" />
          <path d="M8.5 4h3M9 15.5h2" />
        </>
      ) : (
        <>
          <rect height="13" rx="2" width="9" x="5.5" y="3.5" />
          <path d="M2.5 6.5h1.25v7H2.5M17.5 6.5h-1.25v7h1.25" />
        </>
      )}
    </svg>
  );
}

function PlaygroundZoomToggle({
  mode,
  onToggle,
}: {
  mode: WorkspacePresentationMode;
  onToggle: () => void;
}) {
  const zoomingOut = mode === "normal";
  const label = zoomingOut
    ? "Zoom out to workspace overview"
    : "Zoom in to focused pane";
  return (
    <PlaygroundToolbarButton
      aria-keyshortcuts="Alt+O"
      aria-label={label}
      className="playground-zoom-toggle"
      data-overview={String(!zoomingOut)}
      onClick={onToggle}
      tooltip={
        <>
          <span>{label}</span>
          <kbd>{platformShortcutLabel("Alt + O")}</kbd>
        </>
      }
    >
      <ZoomIcon direction={zoomingOut ? "out" : "in"} />
      <span>{zoomingOut ? "Zoom out" : "Zoom in"}</span>
    </PlaygroundToolbarButton>
  );
}

function PlaygroundHomeControl({ onReturnHome }: { onReturnHome: () => void }) {
  return (
    <PlaygroundToolbarButton
      aria-keyshortcuts="Alt+Shift+Home"
      aria-label="Return to workspace home"
      className="playground-home-control"
      onClick={onReturnHome}
      tooltip={
        <>
          <span>Return to workspace home</span>
          <kbd>{platformShortcutLabel("Alt + Shift + Home")}</kbd>
        </>
      }
    >
      <HomeIcon />
      <span>Home</span>
    </PlaygroundToolbarButton>
  );
}

function HomeIcon() {
  return (
    <svg aria-hidden="true" fill="none" focusable="false" viewBox="0 0 20 20">
      <path d="m3.5 9.25 6.5-5.5 6.5 5.5v7h-4.25v-4.5h-4.5v4.5H3.5z" />
    </svg>
  );
}

function PlaygroundCameraModeControls({
  cameraModes,
  onCameraModesChange,
}: {
  cameraModes: WorkspaceCameraModes;
  onCameraModesChange: (modes: WorkspaceCameraModes) => void;
}) {
  return (
    <div
      aria-label="Independent camera modes"
      className="playground-camera-mode-controls"
      role="group"
    >
      <PlaygroundPaneCameraToggle
        mode={cameraModes.normal}
        onToggle={() =>
          onCameraModesChange({
            ...cameraModes,
            normal: cameraModes.normal === "fixed" ? "follow" : "fixed",
          })
        }
        presentationMode="normal"
      />
      <PlaygroundPaneCameraToggle
        mode={cameraModes.overview}
        onToggle={() =>
          onCameraModesChange({
            ...cameraModes,
            overview: cameraModes.overview === "fixed" ? "follow" : "fixed",
          })
        }
        presentationMode="overview"
      />
    </div>
  );
}

function PlaygroundPaneCameraToggle({
  mode,
  onToggle,
  presentationMode,
}: {
  mode: WorkspaceCameraMode;
  onToggle: () => void;
  presentationMode: WorkspacePresentationMode;
}) {
  const following = mode === "follow";
  const view = presentationMode === "overview" ? "Overview" : "Normal";
  const state = following ? "Follow" : "Fixed";
  const nextState = following ? "Fixed" : "Follow";
  const tooltip =
    presentationMode === "overview"
      ? following
        ? "Keep the focused cell centered at a stable overview scale"
        : "Keep overview framing fixed while focus moves"
      : following
        ? "Keep the moved pane under the camera in normal view"
        : "Keep the camera fixed while moving panes in normal view";
  return (
    <PlaygroundToolbarButton
      aria-label={`${view} camera mode: ${state}. Activate to switch to ${nextState}.`}
      aria-pressed={following}
      className="playground-camera-mode-toggle"
      data-camera-mode={mode}
      data-presentation-mode={presentationMode}
      onClick={onToggle}
      tooltip={tooltip}
    >
      <span className="playground-camera-mode-toggle__view">{view}</span>
      <span className="playground-camera-mode-toggle__state">{state}</span>
    </PlaygroundToolbarButton>
  );
}

function PlaygroundFocusAnchorToggle({
  focusAnchor,
  onToggle,
}: {
  focusAnchor: WorkspaceFocusAnchor;
  onToggle: () => void;
}) {
  const centered = focusAnchor === "center";
  const tooltip = centered
    ? "Align focused panes to the leading edge"
    : "Center focused panes";
  return (
    <PlaygroundToolbarButton
      aria-label="Center focused panes"
      aria-pressed={centered}
      className="playground-focus-anchor-toggle"
      onClick={onToggle}
      tooltip={tooltip}
    >
      <FocusAnchorIcon />
      <span>Center</span>
    </PlaygroundToolbarButton>
  );
}

function PlaygroundToolbarButton({
  children,
  tooltip,
  ...buttonProps
}: ButtonHTMLAttributes<HTMLButtonElement> & { tooltip: ReactNode }) {
  const tooltipId = useId();
  return (
    <span className="playground-toolbar-control">
      <button {...buttonProps} aria-describedby={tooltipId} type="button">
        {children}
      </button>
      <span
        className="playground-toolbar-tooltip"
        id={tooltipId}
        role="tooltip"
      >
        {tooltip}
      </span>
    </span>
  );
}

function FocusAnchorIcon() {
  return (
    <svg aria-hidden="true" fill="none" focusable="false" viewBox="0 0 20 20">
      <circle cx="10" cy="10" r="3" />
      <path d="M10 2.5v3M10 14.5v3M2.5 10h3M14.5 10h3" />
    </svg>
  );
}

function MoreIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="currentColor"
      focusable="false"
      viewBox="0 0 20 20"
    >
      <circle cx="4" cy="10" r="1.25" />
      <circle cx="10" cy="10" r="1.25" />
      <circle cx="16" cy="10" r="1.25" />
    </svg>
  );
}

function ZoomIcon({ direction }: { direction: "in" | "out" }) {
  const outward = direction === "out";
  return (
    <svg aria-hidden="true" fill="none" focusable="false" viewBox="0 0 20 20">
      {outward ? (
        <path d="M8 3H3v5M12 3h5v5M8 17H3v-5M12 17h5v-5" />
      ) : (
        <path d="M3 8h5V3M17 8h-5V3M3 12h5v5M17 12h-5v5" />
      )}
    </svg>
  );
}

function initialColorMode(): PlaygroundColorMode {
  if (typeof window === "undefined") {
    return "dark";
  }
  try {
    const stored = window.localStorage.getItem(colorModeStorageKey);
    if (stored === "dark" || stored === "light") {
      return stored;
    }
  } catch {}
  return window.matchMedia?.("(prefers-color-scheme: light)").matches
    ? "light"
    : "dark";
}

function initialPreviewMode(): PlaygroundPreviewMode {
  return typeof window !== "undefined" &&
    window.matchMedia?.(mobilePreviewQuery).matches
    ? "mobile"
    : "desktop";
}

function ThemeIcon({
  name,
  visible,
}: {
  name: "moon" | "sun";
  visible: boolean;
}) {
  return (
    <svg
      data-visible={String(visible)}
      fill="none"
      focusable="false"
      viewBox="0 0 20 20"
    >
      {name === "sun" ? (
        <>
          <circle cx="10" cy="10" r="3.25" />
          <path d="M10 2.25v1.5M10 16.25v1.5M2.25 10h1.5M16.25 10h1.5M4.5 4.5l1.05 1.05M14.45 14.45l1.05 1.05M15.5 4.5l-1.05 1.05M5.55 14.45 4.5 15.5" />
        </>
      ) : (
        <path d="M16.75 12.2A7.2 7.2 0 0 1 7.8 3.25a7.2 7.2 0 1 0 8.95 8.95Z" />
      )}
    </svg>
  );
}
