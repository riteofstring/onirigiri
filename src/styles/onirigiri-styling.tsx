import {
  createContext,
  useContext,
  type ButtonHTMLAttributes,
  type ComponentType,
  type CSSProperties,
  type ElementType,
  type ReactNode,
} from "react";

import type { OnirigiriStyleSlot } from "./onirigiri-theme.js";
import type {
  OnirigiriShortcutAction,
  OnirigiriShortcutDescriptor,
} from "../input/workspace-shortcuts.js";
import type { WorkspacePane } from "../types.js";

export type OnirigiriSlotClassNames = Partial<
  Record<OnirigiriStyleSlot, string>
>;

export type OnirigiriSlotStyles = Partial<
  Record<OnirigiriStyleSlot, CSSProperties>
>;

export type OnirigiriChromeButtonProps =
  ButtonHTMLAttributes<HTMLButtonElement>;

export type OnirigiriWorkspaceControlId =
  "overview" | "move-up" | "move-down" | "move-left" | "move-right";

export interface OnirigiriWorkspaceControlDescriptor {
  readonly action: OnirigiriShortcutAction;
  readonly available: boolean;
  readonly id: OnirigiriWorkspaceControlId;
  readonly label: string;
  readonly pressed?: boolean;
  readonly shortcuts: readonly OnirigiriShortcutDescriptor[];
}

export interface OnirigiriWorkspaceControlButtonProps extends OnirigiriChromeButtonProps {
  control: OnirigiriWorkspaceControlDescriptor;
}

export type OnirigiriPaneActionId = "maximize" | "restore" | "close";

export interface OnirigiriPaneActionDescriptor {
  readonly id: OnirigiriPaneActionId;
  readonly label: string;
  readonly pane: WorkspacePane;
}

export interface OnirigiriPaneActionButtonProps extends OnirigiriChromeButtonProps {
  action: OnirigiriPaneActionDescriptor;
}

export interface OnirigiriChromeComponents {
  PaneActionButton?: ComponentType<OnirigiriPaneActionButtonProps>;
  PaneTitlebarAccessory?: ElementType<{ pane: WorkspacePane }>;
  WorkspaceControlButton?: ComponentType<OnirigiriWorkspaceControlButtonProps>;
}

export interface OnirigiriStylingOptions {
  chromeComponents?: OnirigiriChromeComponents;
  classNames?: OnirigiriSlotClassNames;
  styles?: OnirigiriSlotStyles;
}

interface ResolvedOnirigiriSlotProps {
  className: string;
  style: CSSProperties | undefined;
}

const defaultStyling: OnirigiriStylingOptions = {};

const OnirigiriStylingContext =
  createContext<OnirigiriStylingOptions>(defaultStyling);

export function OnirigiriStylingProvider({
  children,
  value,
}: {
  children: ReactNode;
  value: OnirigiriStylingOptions;
}) {
  return (
    <OnirigiriStylingContext.Provider value={value}>
      {children}
    </OnirigiriStylingContext.Provider>
  );
}

export function useOnirigiriStyling(): OnirigiriStylingOptions {
  return useContext(OnirigiriStylingContext);
}

export function resolveOnirigiriSlotProps(
  styling: OnirigiriStylingOptions,
  slot: OnirigiriStyleSlot,
  internalClassName: string,
): ResolvedOnirigiriSlotProps {
  return {
    className: [internalClassName, styling.classNames?.[slot]]
      .filter(Boolean)
      .join(" "),
    style: styling.styles?.[slot],
  };
}

export function defineOnirigiriClassNames<
  ClassNames extends OnirigiriSlotClassNames,
>(classNames: ClassNames): ClassNames {
  return classNames;
}

export function defineOnirigiriStyles<Styles extends OnirigiriSlotStyles>(
  styles: Styles,
): Styles {
  return styles;
}

export function defineOnirigiriChromeComponents<
  Components extends OnirigiriChromeComponents,
>(components: Components): Components {
  return components;
}
