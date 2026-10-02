import { describe, expect, it } from "vitest";

import {
  defaultOnirigiriShortcuts,
  formatOnirigiriShortcut,
  getOnirigiriShortcutBindings,
  type OnirigiriShortcutBinding,
} from "../src/index";

const optionRight: OnirigiriShortcutBinding = {
  altKey: true,
  ctrlKey: false,
  key: "ArrowRight",
  metaKey: false,
  shiftKey: false,
};

const everyModifierSpace: OnirigiriShortcutBinding = {
  altKey: true,
  ctrlKey: true,
  key: " ",
  metaKey: true,
  shiftKey: true,
};

describe("Onirigiri shortcut helpers", () => {
  it("formats bindings with Apple modifier symbols and names", () => {
    expect(formatOnirigiriShortcut(optionRight, { platform: "apple" })).toEqual(
      {
        aria: "Alt+ArrowRight",
        binding: optionRight,
        keys: ["⌥ Option", "→"],
        label: "⌥ Option + →",
      },
    );
    expect(
      formatOnirigiriShortcut(everyModifierSpace, { platform: "apple" }),
    ).toMatchObject({
      aria: "Control+Alt+Shift+Meta+Space",
      keys: ["⌃ Control", "⌥ Option", "⇧ Shift", "⌘ Command", "Space"],
      label: "⌃ Control + ⌥ Option + ⇧ Shift + ⌘ Command + Space",
    });
  });

  it("formats bindings with conventional names on other platforms", () => {
    expect(formatOnirigiriShortcut(optionRight, { platform: "other" })).toEqual(
      {
        aria: "Alt+ArrowRight",
        binding: optionRight,
        keys: ["Alt", "→"],
        label: "Alt + →",
      },
    );
    expect(
      formatOnirigiriShortcut(
        { ...everyModifierSpace, key: "Home" },
        { platform: "other" },
      ),
    ).toMatchObject({
      aria: "Control+Alt+Shift+Meta+Home",
      keys: ["Ctrl", "Alt", "Shift", "Meta", "Home"],
      label: "Ctrl + Alt + Shift + Meta + Home",
    });
  });

  it("looks up effective bindings for an action in configuration order", () => {
    const custom = [
      { ...optionRight, key: "d" },
      { ...optionRight, altKey: false, ctrlKey: true },
    ];

    expect(getOnirigiriShortcutBindings("focusRight")).toEqual(
      defaultOnirigiriShortcuts.focusRight,
    );
    expect(
      getOnirigiriShortcutBindings("focusRight", { focusRight: custom }),
    ).toEqual(custom);
    expect(
      getOnirigiriShortcutBindings("toggleOverview", {
        toggleOverview: optionRight,
      }),
    ).toEqual([optionRight]);
    expect(
      getOnirigiriShortcutBindings("focusLeft", { focusRight: custom }),
    ).toEqual(defaultOnirigiriShortcuts.focusLeft);
    expect(getOnirigiriShortcutBindings("focusRight", false)).toEqual([]);
  });
});
