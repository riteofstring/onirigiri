import {
  defaultOnirigiriShortcuts,
  type OnirigiriShortcutAction,
  type OnirigiriShortcutBinding,
  type OnirigiriShortcutBindings,
} from "@riteofstring/onirigiri";
import { useId, useRef } from "react";

interface ShortcutRowSpec {
  actions?: readonly OnirigiriShortcutAction[];
  keys?: readonly string[];
  label: string;
}

interface ShortcutSectionSpec {
  label: string;
  rows: readonly ShortcutRowSpec[];
}

const navigationActions = [
  "focusUp",
  "focusDown",
  "focusLeft",
  "focusRight",
] as const satisfies readonly OnirigiriShortcutAction[];

const paneMoveActions = [
  "movePaneUp",
  "movePaneDown",
  "movePaneLeft",
  "movePaneRight",
] as const satisfies readonly OnirigiriShortcutAction[];

const groupMoveActions = [
  "moveGroupUp",
  "moveGroupDown",
  "moveGroupLeft",
  "moveGroupRight",
] as const satisfies readonly OnirigiriShortcutAction[];

export function PlaygroundWelcomePane({
  onExplore,
}: {
  onExplore: () => void;
}) {
  const titleId = useId();
  const apple = /Mac|iPhone|iPad|iPod/.test(navigator.platform);
  const rows = [
    {
      actions: navigationActions,
      label: "Navigate",
      detail: "Focus a nearby pane",
    },
    {
      actions: paneMoveActions,
      label: "Move a pane",
      detail: "Rearrange your workspace",
    },
  ];
  return (
    <section
      aria-labelledby={titleId}
      className="demo-panel playground-welcome"
    >
      <header>
        <span className="playground-welcome__eyebrow">
          Welcome to Onirigiri
        </span>
        <div aria-hidden="true" className="playground-welcome__mark">
          <i />
          <i />
          <i />
        </div>
        <h2 id={titleId}>
          Start here<span>.</span>
        </h2>
        <p>
          A workspace to explore.
          <br />
          Two shortcuts to make it yours.
        </p>
      </header>
      <dl>
        {rows.map(({ actions, label, detail }, rowIndex) => (
          <div key={label}>
            <dt>
              <span aria-hidden="true" className="playground-welcome__step">
                0{rowIndex + 1}
              </span>
              <span>
                {label}
                <small>{detail}</small>
              </span>
            </dt>
            <dd>
              {shortcutKeysForActions(actions, undefined)
                .filter((keys) => keys.endsWith("Arrow keys"))
                .map((keys) => (
                  <span className="playground-welcome__keys" key={keys}>
                    {keys.split(" + ").map((key, index) => (
                      <span key={key}>
                        {index > 0 && <span aria-hidden="true">+</span>}
                        <kbd>
                          {key === "Arrow keys" ? (
                            <>
                              <span aria-hidden="true">← ↑ ↓ →</span>
                              <span className="playground-visually-hidden">
                                Arrow keys
                              </span>
                            </>
                          ) : (
                            platformShortcutLabel(key)
                          )}
                        </kbd>
                      </span>
                    ))}
                  </span>
                ))}
            </dd>
          </div>
        ))}
      </dl>
      <footer>
        <p>
          Mod = <strong>{apple ? "Option" : "Alt"}</strong> on{" "}
          {apple ? "Mac" : "Windows / Linux"}
        </p>
        <button onClick={onExplore} type="button">
          Explore panes <span aria-hidden="true">→</span>
        </button>
        <span className="playground-welcome__hint">
          Or press {apple ? "Option" : "Alt"} + → to begin
        </span>
      </footer>
    </section>
  );
}

const shortcutSections: readonly ShortcutSectionSpec[] = [
  {
    label: "Navigate",
    rows: [
      { actions: navigationActions, label: "Move cursor" },
      { actions: ["focusFirstColumn"], label: "First column" },
      { actions: ["focusLastColumn"], label: "Last column" },
      { actions: ["returnHome"], label: "Return home" },
      { actions: ["toggleOverview"], label: "Toggle overview" },
    ],
  },
  {
    label: "Move",
    rows: [
      { actions: paneMoveActions, label: "Move pane" },
      { actions: ["selectPaneGroup"], label: "Select split group" },
      { actions: groupMoveActions, label: "Move split group" },
    ],
  },
  {
    label: "Arrange",
    rows: [
      { actions: ["splitRight"], label: "Split right" },
      { actions: ["splitDown"], label: "Split down" },
      { actions: ["splitPlaneUp"], label: "New plane above" },
      { actions: ["splitPlaneDown"], label: "New plane below" },
      { actions: ["insertAsSplitLeft"], label: "Insert split left" },
      { actions: ["insertAsSplitRight"], label: "Insert split right" },
      { actions: ["createBlankSplitAbove"], label: "Blank above" },
      { actions: ["createBlankSplitBelow"], label: "Blank below" },
      { actions: ["removeBlankSplitAbove"], label: "Remove blank above" },
      { actions: ["removeBlankSplitBelow"], label: "Remove blank below" },
    ],
  },
  {
    label: "History",
    rows: [
      { keys: ["Ctrl/Command + Z"], label: "Undo" },
      { keys: ["Ctrl/Command + Shift + Z"], label: "Redo" },
    ],
  },
];

export function PlaygroundShortcuts({
  shortcuts,
}: {
  shortcuts?: OnirigiriShortcutBindings;
}) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const titleId = useId();
  const sections = visibleShortcutSections(shortcuts);
  const closeDialog = () => dialogRef.current?.close();
  return (
    <>
      <button
        aria-haspopup="dialog"
        aria-label="Keyboard shortcuts"
        className="playground-shortcuts-trigger"
        onClick={() => dialogRef.current?.showModal()}
        ref={triggerRef}
        title="Keyboard shortcuts"
        type="button"
      >
        <KeyboardIcon />
        <span>Shortcuts</span>
      </button>
      <dialog
        aria-labelledby={titleId}
        className="playground-shortcuts-dialog"
        onClose={() => triggerRef.current?.focus()}
        ref={dialogRef}
      >
        <div className="playground-shortcuts-dialog__header">
          <div>
            <span className="playground-dialog-eyebrow">Reference</span>
            <h2 id={titleId}>Keyboard shortcuts</h2>
          </div>
          <button
            aria-label="Close keyboard shortcuts"
            autoFocus
            className="playground-dialog-close"
            onClick={closeDialog}
            type="button"
          >
            <CloseIcon />
          </button>
        </div>
        <div className="playground-shortcuts-dialog__body">
          {sections.map((section) => (
            <section key={section.label}>
              <h3>{section.label}</h3>
              <dl>
                {section.rows.map((row) => (
                  <div key={row.label}>
                    <dt>{row.label}</dt>
                    <dd>
                      {row.keys.map((keys) => (
                        <kbd key={keys}>{platformShortcutLabel(keys)}</kbd>
                      ))}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
        <form method="dialog" className="playground-dialog-footer">
          <button type="submit">Done</button>
        </form>
      </dialog>
    </>
  );
}

export function platformShortcutLabel(shortcut: string): string {
  const apple =
    typeof navigator !== "undefined" &&
    /Mac|iPhone|iPad|iPod/.test(navigator.platform);
  const labels: Record<string, string> = {
    Alt: apple ? "Option" : "Alt",
    Ctrl: apple ? "Control" : "Ctrl",
    Command: apple ? "Command" : "Meta",
    "Ctrl/Command": apple ? "Command" : "Ctrl",
  };
  return shortcut
    .split(" + ")
    .map((key) => labels[key] ?? key)
    .join(" + ");
}

function visibleShortcutSections(
  overrides: OnirigiriShortcutBindings | undefined,
): readonly {
  label: string;
  rows: readonly { keys: readonly string[]; label: string }[];
}[] {
  return shortcutSections
    .map((section) => ({
      label: section.label,
      rows: section.rows.flatMap((row) => {
        const keys = row.keys ?? shortcutKeysForActions(row.actions, overrides);
        return keys.length > 0 ? [{ keys, label: row.label }] : [];
      }),
    }))
    .filter((section) => section.rows.length > 0);
}

function shortcutKeysForActions(
  actions: readonly OnirigiriShortcutAction[] | undefined,
  overrides: OnirigiriShortcutBindings | undefined,
): readonly string[] {
  if (!actions) {
    return [];
  }
  const bindings = actions.flatMap((action) =>
    resolvedBindings(action, overrides),
  );
  return compactShortcutLabels(bindings);
}

function resolvedBindings(
  action: OnirigiriShortcutAction,
  overrides: OnirigiriShortcutBindings | undefined,
): readonly OnirigiriShortcutBinding[] {
  const configured = overrides?.[action] ?? defaultOnirigiriShortcuts[action];
  return isShortcutBinding(configured) ? [configured] : configured;
}

function isShortcutBinding(
  value: OnirigiriShortcutBinding | readonly OnirigiriShortcutBinding[],
): value is OnirigiriShortcutBinding {
  return !Array.isArray(value);
}

function compactShortcutLabels(
  bindings: readonly OnirigiriShortcutBinding[],
): readonly string[] {
  const groups = new Map<string, { keys: string[]; modifiers: string[] }>();
  for (const binding of bindings) {
    const modifiers = shortcutModifiers(binding);
    const signature = modifiers.join("+");
    const group = groups.get(signature) ?? { keys: [], modifiers };
    if (!group.keys.includes(binding.key)) {
      group.keys.push(binding.key);
    }
    groups.set(signature, group);
  }
  return [...groups.values()].flatMap(({ keys, modifiers }) =>
    compactKeyGroups(keys).map((keyGroup) =>
      [...modifiers, keyGroup].join(" + "),
    ),
  );
}

function compactKeyGroups(keys: readonly string[]): readonly string[] {
  const arrows = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"];
  const letters = ["k", "j", "h", "l"];
  const remaining = [...keys];
  const labels: string[] = [];
  if (arrows.every((key) => remaining.includes(key))) {
    labels.push("Arrow keys");
    removeKeys(remaining, arrows);
  }
  if (letters.every((key) => remaining.includes(key))) {
    labels.push("H J K L");
    removeKeys(remaining, letters);
  }
  return [...labels, ...remaining.map(shortcutKeyLabel)];
}

function removeKeys(target: string[], keys: readonly string[]): void {
  for (const key of keys) {
    const index = target.indexOf(key);
    if (index >= 0) {
      target.splice(index, 1);
    }
  }
}

function shortcutModifiers(binding: OnirigiriShortcutBinding): string[] {
  return [
    binding.ctrlKey ? "Ctrl" : null,
    binding.altKey ? "Alt" : null,
    binding.shiftKey ? "Shift" : null,
    binding.metaKey ? "Command" : null,
  ].filter((value): value is string => value !== null);
}

function shortcutKeyLabel(key: string): string {
  const labels: Record<string, string> = {
    " ": "Space",
    ArrowDown: "↓",
    ArrowLeft: "←",
    ArrowRight: "→",
    ArrowUp: "↑",
  };
  return labels[key] ?? key.toUpperCase();
}

function KeyboardIcon() {
  return (
    <svg aria-hidden="true" fill="none" focusable="false" viewBox="0 0 20 20">
      <rect height="12" rx="2" width="16" x="2" y="4" />
      <path d="M5 8h1M8 8h1M11 8h1M14 8h1M5 11h1M8 11h1M11 11h4M6 14h8" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg aria-hidden="true" fill="none" focusable="false" viewBox="0 0 20 20">
      <path d="m5 5 10 10M15 5 5 15" />
    </svg>
  );
}
