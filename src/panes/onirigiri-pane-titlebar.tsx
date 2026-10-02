import { memo, type MouseEvent } from "react";
import {
  OnirigiriIcon,
  type OnirigiriIconName,
} from "../workspace/onirigiri-icons";
import {
  resolveOnirigiriSlotProps,
  useOnirigiriStyling,
  type OnirigiriPaneActionDescriptor,
} from "../styles/onirigiri-styling";
import type { WorkspaceLayoutStore } from "../state/layout-store";
import type { PaneId, WorkspacePane } from "../types";

export interface OnirigiriPaneTitlebarProps {
  pane: WorkspacePane;
  showControls: boolean;
  closePane: (paneId: PaneId) => Promise<boolean>;
  store: WorkspaceLayoutStore;
  controlsAvailable: boolean;
  maximized: boolean;
}

export const OnirigiriPaneTitlebar = memo(function OnirigiriPaneTitlebar({
  controlsAvailable,
  maximized,
  pane,
  showControls,
  closePane,
  store,
}: OnirigiriPaneTitlebarProps) {
  const styling = useOnirigiriStyling();
  const Accessory = styling.chromeComponents?.PaneTitlebarAccessory;
  const titlebarSlot = resolveOnirigiriSlotProps(
    styling,
    "pane-titlebar",
    "onirigiri-pane__titlebar",
  );
  const toneSlot = resolveOnirigiriSlotProps(
    styling,
    "pane-tone",
    "onirigiri-pane__tone",
  );
  const headingSlot = resolveOnirigiriSlotProps(
    styling,
    "pane-heading",
    "onirigiri-pane__heading",
  );
  const actionsSlot = resolveOnirigiriSlotProps(
    styling,
    "pane-actions",
    "onirigiri-pane__actions",
  );
  return (
    <header
      className={titlebarSlot.className}
      data-onirigiri-pane-titlebar="true"
      data-onirigiri-slot="pane-titlebar"
      style={titlebarSlot.style}
    >
      <span
        className={toneSlot.className}
        data-onirigiri-slot="pane-tone"
        style={toneSlot.style}
      />
      <span
        className={headingSlot.className}
        data-onirigiri-slot="pane-heading"
        style={headingSlot.style}
      >
        <strong>{pane.title}</strong>
        {pane.subtitle ? <small>{pane.subtitle}</small> : null}
      </span>
      {Accessory ? <Accessory pane={pane} /> : null}
      {showControls ? (
        <span
          aria-hidden={!controlsAvailable}
          className={actionsSlot.className}
          data-onirigiri-slot="pane-actions"
          data-visible={String(controlsAvailable)}
          style={actionsSlot.style}
        >
          <PaneButton
            action={
              maximized
                ? { id: "restore", label: "Restore pane", pane }
                : { id: "maximize", label: "Maximize pane", pane }
            }
            icon={maximized ? "restore" : "maximize"}
            onActivate={() => store.togglePaneMaximized(pane.paneId)}
          />
          <PaneButton
            action={{ id: "close", label: "Close pane", pane }}
            icon="close"
            onActivate={() => void closePane(pane.paneId)}
          />
        </span>
      ) : null}
    </header>
  );
});

function PaneButton({
  action,
  icon,
  onActivate,
}: {
  action: OnirigiriPaneActionDescriptor;
  icon: OnirigiriIconName;
  onActivate: () => void;
}) {
  const styling = useOnirigiriStyling();
  const actionSlot = resolveOnirigiriSlotProps(
    styling,
    "pane-action",
    "onirigiri-pane__action",
  );
  const buttonProps = {
    "aria-label": action.label,
    children: <OnirigiriIcon name={icon} />,
    className: actionSlot.className,
    "data-onirigiri-pane-action": action.id,
    "data-onirigiri-pane-control": "true",
    "data-onirigiri-slot": "pane-action",
    onClick: (event: MouseEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      onActivate();
    },
    style: actionSlot.style,
    type: "button",
  } as const;
  const ActionButton = styling.chromeComponents?.PaneActionButton;
  return ActionButton ? (
    <ActionButton {...buttonProps} action={action} />
  ) : (
    <button {...buttonProps} />
  );
}
