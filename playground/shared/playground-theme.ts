import { createContext } from "react";

export interface PlaygroundContentTheme {
  colorMode: "dark" | "light";
  styles: Record<string, string>;
}

export const PlaygroundThemeContext =
  createContext<PlaygroundContentTheme | null>(null);

export function readPlaygroundTheme(
  element: HTMLElement,
  colorMode: "dark" | "light",
  overrides?: Partial<PlaygroundContentTheme>,
): PlaygroundContentTheme {
  const computed = getComputedStyle(element);
  const variables = {
    page: "background",
    surface: "surface",
    "surface-raised": "surface-raised",
    "surface-sunken": "surface-sunken",
    text: "text",
    "text-strong": "text",
    "text-muted": "text-secondary",
    "text-subtle": "text-tertiary",
    border: "edge",
    accent: "chart-high",
    "accent-alt": "chart-low",
    positive: "success",
    warning: "warning",
    focus: "focus",
  };
  return {
    colorMode: overrides?.colorMode ?? colorMode,
    styles: {
      ...Object.fromEntries(
        Object.entries(variables).map(([name, variable]) => [
          name,
          computed.getPropertyValue(`--playground-${variable}`).trim(),
        ]),
      ),
      "font-family": computed.fontFamily,
      ...Object.fromEntries(
        [
          "font-mono",
          "font-size",
          "font-size-heading",
          "font-size-small",
          "font-size-label",
          "font-size-tiny",
          "font-weight",
          "font-weight-heading",
          "line-height",
          "line-height-heading",
          "radius",
        ].map((name) => [
          name,
          computed.getPropertyValue(`--playground-${name}`).trim(),
        ]),
      ),
      ...overrides?.styles,
    },
  };
}
