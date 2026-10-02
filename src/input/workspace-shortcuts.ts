interface OnirigiriShortcutKeyEvent {
  altKey: boolean;
  code: string;
  ctrlKey: boolean;
  key: string;
  metaKey: boolean;
  shiftKey: boolean;
}

export type OnirigiriShortcutAction =
  | "createBlankSplitAbove"
  | "createBlankSplitBelow"
  | "focusDown"
  | "focusFirstColumn"
  | "focusLastColumn"
  | "focusLeft"
  | "focusRight"
  | "focusUp"
  | "movePaneDown"
  | "movePaneLeft"
  | "movePaneRight"
  | "movePaneUp"
  | "moveGroupDown"
  | "moveGroupLeft"
  | "moveGroupRight"
  | "moveGroupUp"
  | "insertAsSplitLeft"
  | "insertAsSplitRight"
  | "removeBlankSplitAbove"
  | "removeBlankSplitBelow"
  | "returnHome"
  | "selectPaneGroup"
  | "splitDown"
  | "splitPlaneDown"
  | "splitPlaneUp"
  | "splitRight"
  | "toggleOverview";

export type OnirigiriShortcutScope = "application" | "workspace";

export interface OnirigiriShortcutBinding {
  readonly altKey: boolean;
  readonly ctrlKey: boolean;
  readonly key: string;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
}

export type OnirigiriShortcutBindings = {
  readonly [Action in OnirigiriShortcutAction]?:
    OnirigiriShortcutBinding | readonly OnirigiriShortcutBinding[];
};

export type OnirigiriShortcutPlatform = "apple" | "other";

export interface OnirigiriShortcutFormatOptions {
  readonly platform?: OnirigiriShortcutPlatform;
}

export interface OnirigiriShortcutDescriptor {
  readonly aria: string;
  readonly binding: OnirigiriShortcutBinding;
  readonly keys: readonly string[];
  readonly label: string;
}

interface NormalizedOnirigiriShortcutBinding {
  action: OnirigiriShortcutAction;
  binding: OnirigiriShortcutBinding;
}

const onirigiriShortcutActions: readonly OnirigiriShortcutAction[] = [
  "createBlankSplitAbove",
  "createBlankSplitBelow",
  "focusDown",
  "focusFirstColumn",
  "focusLastColumn",
  "focusLeft",
  "focusRight",
  "focusUp",
  "movePaneDown",
  "movePaneLeft",
  "movePaneRight",
  "movePaneUp",
  "moveGroupDown",
  "moveGroupLeft",
  "moveGroupRight",
  "moveGroupUp",
  "insertAsSplitLeft",
  "insertAsSplitRight",
  "removeBlankSplitAbove",
  "removeBlankSplitBelow",
  "returnHome",
  "selectPaneGroup",
  "splitDown",
  "splitPlaneDown",
  "splitPlaneUp",
  "splitRight",
  "toggleOverview",
];

export const defaultOnirigiriShortcuts: Readonly<
  Record<OnirigiriShortcutAction, readonly OnirigiriShortcutBinding[]>
> = {
  createBlankSplitAbove: shiftOnirigiriModBindings("ArrowUp"),
  createBlankSplitBelow: shiftOnirigiriModBindings("ArrowDown"),
  focusDown: onirigiriModBindings("ArrowDown", "j"),
  focusFirstColumn: onirigiriModBindings("Home"),
  focusLastColumn: onirigiriModBindings("End"),
  focusLeft: onirigiriModBindings("ArrowLeft", "h"),
  focusRight: onirigiriModBindings("ArrowRight", "l"),
  focusUp: onirigiriModBindings("ArrowUp", "k"),
  movePaneDown: onirigiriModControlBindings("ArrowDown", "j"),
  movePaneLeft: onirigiriModControlBindings("ArrowLeft", "h"),
  movePaneRight: onirigiriModControlBindings("ArrowRight", "l"),
  movePaneUp: onirigiriModControlBindings("ArrowUp", "k"),
  moveGroupDown: shiftOnirigiriModControlBindings("ArrowDown"),
  moveGroupLeft: shiftOnirigiriModControlBindings("ArrowLeft"),
  moveGroupRight: shiftOnirigiriModControlBindings("ArrowRight"),
  moveGroupUp: shiftOnirigiriModControlBindings("ArrowUp"),
  insertAsSplitLeft: shiftOnirigiriModBindings("ArrowLeft"),
  insertAsSplitRight: shiftOnirigiriModBindings("ArrowRight"),
  removeBlankSplitAbove: shiftOnirigiriModControlBindings("Home"),
  removeBlankSplitBelow: shiftOnirigiriModControlBindings("End"),
  returnHome: shiftOnirigiriModBindings("Home"),
  selectPaneGroup: shiftOnirigiriModBindings("g"),
  splitDown: [controlShiftBinding("Enter", true)],
  splitPlaneDown: [controlShiftBinding("}")],
  splitPlaneUp: [controlShiftBinding("{")],
  splitRight: [controlShiftBinding("Enter")],
  toggleOverview: onirigiriModBindings("o"),
};

export function normalizeOnirigiriShortcutBindings(
  shortcuts: OnirigiriShortcutBindings | false | undefined,
): readonly NormalizedOnirigiriShortcutBinding[] {
  if (shortcuts === false) {
    return [];
  }
  return onirigiriShortcutActions.flatMap((action) => {
    const configuredBindings =
      shortcuts?.[action] ?? defaultOnirigiriShortcuts[action];
    const bindings = isOnirigiriShortcutBinding(configuredBindings)
      ? [configuredBindings]
      : configuredBindings;
    return bindings.map((binding) => ({ action, binding }));
  });
}

export function getOnirigiriShortcutBindings(
  action: OnirigiriShortcutAction,
  shortcuts?: OnirigiriShortcutBindings | false,
): readonly OnirigiriShortcutBinding[] {
  return normalizeOnirigiriShortcutBindings(shortcuts)
    .filter((shortcut) => shortcut.action === action)
    .map(({ binding }) => binding);
}

export function formatOnirigiriShortcut(
  binding: OnirigiriShortcutBinding,
  { platform = currentShortcutPlatform() }: OnirigiriShortcutFormatOptions = {},
): OnirigiriShortcutDescriptor {
  const modifierLabels =
    platform === "apple" ? appleModifierLabels : otherModifierLabels;
  const keys = [
    ...shortcutModifiers
      .filter((modifier) => binding[modifier])
      .map((modifier) => modifierLabels[modifier]),
    displayShortcutKey(binding.key),
  ];
  return {
    aria: [
      ...shortcutModifiers
        .filter((modifier) => binding[modifier])
        .map((modifier) => ariaModifierNames[modifier]),
      ariaShortcutKey(binding.key),
    ].join("+"),
    binding,
    keys,
    label: keys.join(" + "),
  };
}

const shortcutModifiers = ["ctrlKey", "altKey", "shiftKey", "metaKey"] as const;

type ShortcutModifier = (typeof shortcutModifiers)[number];

const ariaModifierNames: Record<ShortcutModifier, string> = {
  altKey: "Alt",
  ctrlKey: "Control",
  metaKey: "Meta",
  shiftKey: "Shift",
};

const appleModifierLabels: Record<ShortcutModifier, string> = {
  altKey: "⌥ Option",
  ctrlKey: "⌃ Control",
  metaKey: "⌘ Command",
  shiftKey: "⇧ Shift",
};

const otherModifierLabels: Record<ShortcutModifier, string> = {
  altKey: "Alt",
  ctrlKey: "Ctrl",
  metaKey: "Meta",
  shiftKey: "Shift",
};

const displayKeyLabels: Readonly<Record<string, string>> = {
  " ": "Space",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
  ArrowUp: "↑",
};

function displayShortcutKey(key: string): string {
  return (
    displayKeyLabels[key] ?? (isCharacterKey(key) ? key.toUpperCase() : key)
  );
}

function ariaShortcutKey(key: string): string {
  if (key === " ") {
    return "Space";
  }
  return isCharacterKey(key) ? key.toUpperCase() : key;
}

function currentShortcutPlatform(): OnirigiriShortcutPlatform {
  return isAppleKeyboard() ? "apple" : "other";
}

export function matchOnirigiriShortcutAction(
  event: OnirigiriShortcutKeyEvent,
  shortcuts: readonly NormalizedOnirigiriShortcutBinding[],
): OnirigiriShortcutAction | null {
  const keys = [event.key];
  if (event.altKey && isAppleKeyboard() && /^Key[A-Z]$/.test(event.code)) {
    keys.push(event.code.slice(3));
  }
  for (const key of keys) {
    const shortcut = shortcuts.find(
      ({ binding }) =>
        binding.altKey === event.altKey &&
        binding.ctrlKey === event.ctrlKey &&
        binding.metaKey === event.metaKey &&
        binding.shiftKey === event.shiftKey &&
        shortcutKeyMatches(binding.key, key),
    );
    if (shortcut) return shortcut.action;
  }
  return null;
}

function isAppleKeyboard(): boolean {
  return (
    typeof navigator !== "undefined" &&
    /Mac|iPhone|iPad|iPod/.test(navigator.platform)
  );
}

function controlShiftBinding(
  key: string,
  altKey = false,
): OnirigiriShortcutBinding {
  return {
    altKey,
    ctrlKey: true,
    key,
    metaKey: false,
    shiftKey: true,
  };
}

function onirigiriModBindings(
  ...keys: readonly string[]
): OnirigiriShortcutBinding[] {
  return keys.map((key) => onirigiriModBinding(key));
}

function onirigiriModControlBindings(
  ...keys: readonly string[]
): OnirigiriShortcutBinding[] {
  return keys.map((key) => onirigiriModBinding(key, true));
}

function shiftOnirigiriModBindings(
  ...keys: readonly string[]
): OnirigiriShortcutBinding[] {
  return keys.map((key) => ({ ...onirigiriModBinding(key), shiftKey: true }));
}

function shiftOnirigiriModControlBindings(
  ...keys: readonly string[]
): OnirigiriShortcutBinding[] {
  return keys.map((key) => ({
    ...onirigiriModBinding(key, true),
    shiftKey: true,
  }));
}

function onirigiriModBinding(
  key: string,
  ctrlKey = false,
): OnirigiriShortcutBinding {
  return {
    altKey: true,
    ctrlKey,
    key,
    metaKey: false,
    shiftKey: false,
  };
}

function isOnirigiriShortcutBinding(
  binding: OnirigiriShortcutBinding | readonly OnirigiriShortcutBinding[],
): binding is OnirigiriShortcutBinding {
  return !Array.isArray(binding);
}

function shortcutKeyMatches(bindingKey: string, eventKey: string): boolean {
  if (isCharacterKey(bindingKey) && isCharacterKey(eventKey)) {
    return bindingKey.toLowerCase() === eventKey.toLowerCase();
  }
  return bindingKey === eventKey;
}

function isCharacterKey(key: string): boolean {
  return Array.from(key).length === 1;
}
