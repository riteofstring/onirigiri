import { createPortal } from "react-dom";

import {
  OnirigiriIcon,
  type OnirigiriIconName,
} from "../workspace/onirigiri-icons.js";
import {
  resolveOnirigiriSlotProps,
  useOnirigiriStyling,
  type OnirigiriWorkspaceControlDescriptor,
} from "../styles/onirigiri-styling.js";
import {
  onirigiriStylingContract,
  type OnirigiriThemeTokens,
} from "../styles/onirigiri-theme.js";
import type {
  FocusDirection,
  WorkspaceDirectionControlMode,
  WorkspacePresentationMode,
} from "../types.js";
import {
  formatOnirigiriShortcut,
  normalizeOnirigiriShortcutBindings,
  type OnirigiriShortcutAction,
  type OnirigiriShortcutDescriptor,
} from "./workspace-shortcuts.js";

type NormalizedOnirigiriShortcut = ReturnType<
  typeof normalizeOnirigiriShortcutBindings
>[number];

interface WorkspaceControlsProps {
  compactLayout: boolean;
  directionControlMode: WorkspaceDirectionControlMode;
  directionMoveAvailableByDirection: ReadonlyMap<FocusDirection, boolean>;
  moveDirection: (direction: FocusDirection) => void;
  presentationMode: WorkspacePresentationMode;
  shortcuts: readonly NormalizedOnirigiriShortcut[];
  showDirections: boolean;
  showOverview: boolean;
  toggleOverview: () => void;
}

interface WorkspaceControlsPlacementProps extends WorkspaceControlsProps {
  desktopControlsContainer?: Element | null;
  tokens?: OnirigiriThemeTokens;
  workspaceId: string;
}

export const focusDirections = [
  "up",
  "down",
  "left",
  "right",
] as const satisfies readonly FocusDirection[];

export function WorkspaceControlsPlacement({
  desktopControlsContainer,
  tokens,
  workspaceId,
  ...controlsProps
}: WorkspaceControlsPlacementProps) {
  const styling = useOnirigiriStyling();
  const controls = <WorkspaceControls {...controlsProps} />;
  if (!shouldPortalDesktopControls(desktopControlsContainer, controlsProps)) {
    return controls;
  }
  const desktopControlsSlot = resolveOnirigiriSlotProps(
    styling,
    "desktop-controls",
    "onirigiri-workspace__desktop-controls",
  );
  return createPortal(
    <div
      className={desktopControlsSlot.className}
      data-onirigiri-slot="desktop-controls"
      data-onirigiri-styling-version={onirigiriStylingContract.version}
      data-onirigiri-workspace-id={workspaceId}
      style={{ ...desktopControlsSlot.style, ...tokens }}
    >
      {controls}
    </div>,
    desktopControlsContainer,
  );
}

function shouldPortalDesktopControls(
  container: Element | null | undefined,
  { compactLayout, showDirections, showOverview }: WorkspaceControlsProps,
): container is Element {
  return (
    Boolean(container) && !compactLayout && (showDirections || showOverview)
  );
}

function WorkspaceControls({
  compactLayout,
  directionControlMode,
  directionMoveAvailableByDirection,
  moveDirection,
  presentationMode,
  shortcuts,
  showDirections,
  showOverview,
  toggleOverview,
}: WorkspaceControlsProps) {
  const styling = useOnirigiriStyling();
  const toolbarSlot = resolveOnirigiriSlotProps(
    styling,
    "toolbar",
    "onirigiri-workspace__toolbar",
  );
  if (!showDirections && !showOverview) {
    return null;
  }
  const overviewIsOpen = presentationMode === "overview";
  return (
    <div
      aria-label="Workspace controls"
      className={toolbarSlot.className}
      data-onirigiri-slot="toolbar"
      data-direction-control-mode={directionControlMode}
      data-direction-controls={String(showDirections)}
      data-layout={compactLayout ? "compact" : "desktop"}
      data-overview-control={String(showOverview)}
      role="group"
      style={toolbarSlot.style}
    >
      {showOverview ? (
        <WorkspaceControlButton
          control={{
            action: "toggleOverview",
            available: true,
            id: "overview",
            label: overviewIsOpen
              ? "Exit workspace overview"
              : "Open workspace overview",
            pressed: overviewIsOpen,
            shortcuts: shortcutDescriptorsForAction(
              shortcuts,
              "toggleOverview",
            ),
          }}
          icon="overview"
          onActivate={toggleOverview}
        />
      ) : null}
      {showDirections
        ? focusDirections.map((direction) => {
            const action = directionActionForMode(
              directionControlMode,
              direction,
            );
            return (
              <WorkspaceControlButton
                control={{
                  action,
                  available:
                    directionMoveAvailableByDirection.get(direction) === true,
                  id: `move-${direction}`,
                  label: directionControlLabel(directionControlMode, direction),
                  shortcuts: shortcutDescriptorsForAction(shortcuts, action),
                }}
                icon={`arrow-${direction}`}
                key={direction}
                onActivate={() => moveDirection(direction)}
              />
            );
          })
        : null}
    </div>
  );
}

function directionActionForMode(
  mode: WorkspaceDirectionControlMode,
  direction: FocusDirection,
): OnirigiriShortcutAction {
  const actionsByMode: Record<
    WorkspaceDirectionControlMode,
    Record<FocusDirection, OnirigiriShortcutAction>
  > = {
    focus: {
      down: "focusDown",
      left: "focusLeft",
      right: "focusRight",
      up: "focusUp",
    },
    "move-group": {
      down: "moveGroupDown",
      left: "moveGroupLeft",
      right: "moveGroupRight",
      up: "moveGroupUp",
    },
    "move-pane": {
      down: "movePaneDown",
      left: "movePaneLeft",
      right: "movePaneRight",
      up: "movePaneUp",
    },
  };
  return actionsByMode[mode][direction];
}

function directionControlLabel(
  mode: WorkspaceDirectionControlMode,
  direction: FocusDirection,
): string {
  if (mode === "focus") {
    return `Move cursor ${direction}`;
  }
  if (mode === "move-pane") {
    return `Move pane ${direction}`;
  }
  return `Move split group ${direction}`;
}

function WorkspaceControlButton({
  control,
  icon,
  onActivate,
}: {
  control: OnirigiriWorkspaceControlDescriptor;
  icon: OnirigiriIconName;
  onActivate: () => void;
}) {
  const styling = useOnirigiriStyling();
  const controlWrapSlot = resolveOnirigiriSlotProps(
    styling,
    "control-wrap",
    "onirigiri-workspace__control-wrap",
  );
  const controlSlot = resolveOnirigiriSlotProps(
    styling,
    "control",
    "onirigiri-workspace__control",
  );
  const ariaKeyShortcuts = control.shortcuts
    .map((shortcut) => shortcut.aria)
    .join(" ");
  const buttonProps = {
    "aria-disabled": control.available ? undefined : true,
    "aria-keyshortcuts": ariaKeyShortcuts || undefined,
    "aria-label": control.label,
    "aria-pressed": control.pressed,
    children: <OnirigiriIcon name={icon} />,
    className: controlSlot.className,
    "data-available": String(control.available),
    "data-onirigiri-control": control.id,
    "data-onirigiri-slot": "control",
    onClick: () => {
      if (control.available) {
        onActivate();
      }
    },
    style: controlSlot.style,
    type: "button",
  } as const;
  const ControlButton = styling.chromeComponents?.WorkspaceControlButton;
  return (
    <span
      className={controlWrapSlot.className}
      data-onirigiri-slot="control-wrap"
      style={controlWrapSlot.style}
    >
      {ControlButton ? (
        <ControlButton {...buttonProps} control={control} />
      ) : (
        <button {...buttonProps} />
      )}
    </span>
  );
}

function shortcutDescriptorsForAction(
  shortcuts: readonly NormalizedOnirigiriShortcut[],
  action: OnirigiriShortcutAction,
): OnirigiriShortcutDescriptor[] {
  return shortcuts
    .filter((candidate) => candidate.action === action)
    .map(({ binding }) => formatOnirigiriShortcut(binding));
}
