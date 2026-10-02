import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  onirigiriStyleIdentityAttributes,
  onirigiriStyleSlots,
  onirigiriStyleStateAttributes,
  onirigiriStylingContract,
  onirigiriThemeTokenGroups,
  onirigiriThemeTokenNames,
} from "../src/styles/onirigiri-theme";

const stylesheetEntryUrl = new URL("../src/styles.css", import.meta.url);
const stylesheetEntry = readFileSync(stylesheetEntryUrl, "utf8");
const stylesheetFragments = [
  ...stylesheetEntry.matchAll(/@import\s+["']([^"']+)["'];/g),
].map((match) =>
  readFileSync(new URL(match[1] ?? "", stylesheetEntryUrl), "utf8"),
);
const stylesheet = stylesheetFragments.join("\n");
const componentMarkup = [
  "workspace/OnirigiriWorkspace.tsx",
  "workspace/onirigiri-icons.tsx",
  "workspace/onirigiri-workspace-minimap.tsx",
  "presentation/workspace-minimap-presentation.ts",
  "panes/onirigiri-pane-content.tsx",
  "panes/onirigiri-pane-titlebar.tsx",
  "panes/onirigiri-pane-view.tsx",
  "panes/onirigiri-reserved-split.tsx",
  "presentation/pane-presentation-engine.ts",
  "input/workspace-controls.tsx",
  "workspace/workspace-grid-cursor-presentation.ts",
  "presentation/workspace-render-items.ts",
  "presentation/workspace-world-presentation.ts",
]
  .map((fileName) =>
    readFileSync(new URL(`../src/${fileName}`, import.meta.url), "utf8"),
  )
  .join("\n");
const workspaceFrameSchedulerSource = readFileSync(
  new URL("../src/presentation/workspace-frame-scheduler.ts", import.meta.url),
  "utf8",
);
const panePresentationEngineSource = readFileSync(
  new URL("../src/presentation/pane-presentation-engine.ts", import.meta.url),
  "utf8",
);

describe("Onirigiri theme API", () => {
  it("keeps the exported token catalog synchronized with the stylesheet", () => {
    const declaredTokens = uniqueSortedMatches(
      stylesheet,
      /(--onirigiri-[a-z0-9-]+)\s*:/g,
    );

    expect(declaredTokens).toEqual([...onirigiriThemeTokenNames]);
  });

  it("declares every custom property referenced by the bundled styles", () => {
    const declaredTokens = new Set(
      uniqueSortedMatches(stylesheet, /(--onirigiri-[a-z0-9-]+)\s*:/g),
    );
    const referencedTokens = uniqueSortedMatches(
      stylesheet,
      /var\((--onirigiri-[a-z0-9-]+)/g,
    );

    expect(
      referencedTokens.filter((token) => !declaredTokens.has(token)),
    ).toEqual([]);
  });

  it("groups every public token exactly once", () => {
    const groupedTokens = Object.values(onirigiriThemeTokenGroups).flat();

    expect(new Set(groupedTokens).size).toBe(groupedTokens.length);
    expect([...groupedTokens].sort()).toEqual([...onirigiriThemeTokenNames]);
  });

  it("ships the component rules in a named cascade layer", () => {
    expect(stylesheetFragments.length).toBeGreaterThan(0);
    for (const fragment of stylesheetFragments) {
      expect(fragment.trimStart()).toMatch(/^@layer onirigiri\s*\{/);
    }
  });

  it("publishes only state and identity attributes that exist in component markup", () => {
    for (const attribute of [
      ...onirigiriStyleStateAttributes,
      ...onirigiriStyleIdentityAttributes,
    ]) {
      expect(componentMarkup).toContain(attribute);
    }
  });

  it("exposes one machine-readable, versioned styling contract", () => {
    expect(onirigiriStylingContract).toEqual({
      cascadeLayer: "onirigiri",
      identityAttributes: onirigiriStyleIdentityAttributes,
      slots: onirigiriStyleSlots,
      stateAttributes: onirigiriStyleStateAttributes,
      tokenGroups: onirigiriThemeTokenGroups,
      tokenNames: onirigiriThemeTokenNames,
      version: 8,
    });
  });

  it("keeps motion guardrails explicit", assertMotionGuardrails);

  it("keeps overview elevation stable across camera and lifecycle boundaries", () => {
    const overviewElevationRule =
      stylesheet.match(
        /\.onirigiri-workspace\[data-presentation-mode="overview"\]\s+\.onirigiri-pane,\s*\.onirigiri-workspace\.onirigiri-workspace--overview-transition\s+\.onirigiri-pane\s*\{([^}]*)\}/,
      )?.[1] ?? "";
    expect(overviewElevationRule).toMatch(
      /box-shadow:\s*0 0 0 1px var\(--onirigiri-edge\)/,
    );
    expect(overviewElevationRule).toMatch(/transition-property:\s*none/);
    expect(overviewElevationRule).not.toMatch(
      /(?:data-visible|data-moving|hover|focus)/,
    );
    expect(stylesheet).not.toContain(
      '.onirigiri-workspace[data-presentation-mode="overview"] .onirigiri-pane:hover',
    );
    expect(stylesheet).not.toMatch(
      /\.onirigiri-pane:(?:hover|focus(?:-within|-visible)?)[^{]*\{[^}]*box-shadow/,
    );
    expect(stylesheet).not.toMatch(
      /\.onirigiri-pane\[data-focused="true"\][^{]*\{[^}]*box-shadow/,
    );
    expect(panePresentationEngineSource).toContain(
      "const overviewTransitioning = overviewTransitionIsActive(snapshot);",
    );
    expect(panePresentationEngineSource).not.toContain("overviewCameraMoving");
    expect(panePresentationEngineSource).not.toMatch(
      /overviewTransitionIsActive\(snapshot\)\s*\|\|/,
    );
    expect(workspaceFrameSchedulerSource).not.toContain(
      "overviewCameraMotionWasActive || overviewCameraMotionActive,",
    );
  });

  it("assigns cell selection to one decorative grid-cursor surface", () => {
    const cursorRule = stylesheetRule(
      /(?:^|\n)\s*\.onirigiri-workspace__grid-cursor\s*\{([^}]*)\}/,
    );

    expect(cursorRule).toMatch(/pointer-events:\s*none/);
    expect(cursorRule).toMatch(/position:\s*absolute/);
    expect(cursorRule).toMatch(/will-change:\s*transform/);
    expect(stylesheet).not.toContain(".onirigiri-pane::after");
    expect(componentMarkup).toContain('data-onirigiri-slot="grid-cursor"');
    expect(componentMarkup).toContain('aria-hidden="true"');
  });

  it("clips pane content while allowing consumer picture fit overrides", () => {
    const contentViewportRule = stylesheetRule(
      /(?:^|\n)\s*\.onirigiri-pane__content\s*\{([^}]*)\}/,
    );

    expect(stylesheet).not.toMatch(/object-fit:\s*contain\s*!important/);
    expect(contentViewportRule).toMatch(/overflow:\s*hidden/);
  });

  it("keeps the dots on the same world surface as panes and the focus cursor", () => {
    const stageRule = stylesheetRule(
      /\.onirigiri-workspace__stage\s*\{([^}]*)\}/,
    );
    const worldRule = stylesheetRule(
      /\.onirigiri-workspace__world\s*\{([^}]*)\}/,
    );
    const gridRule = stylesheetRule(
      /\.onirigiri-workspace__world-grid\s*\{([^}]*)\}/,
    );

    expect(stageRule).not.toMatch(/background-image/);
    expect(worldRule).toMatch(/transform-origin:\s*top left/);
    expect(worldRule).not.toMatch(/box-shadow/);
    expect(gridRule).toMatch(/background-image:\s*radial-gradient/);
    expect(gridRule).not.toMatch(/box-shadow/);
    expect(componentMarkup).toContain('data-onirigiri-world-surface="true"');
    expect(componentMarkup).toContain('data-onirigiri-world-grid="true"');
    expect(componentMarkup).not.toContain(
      "onirigiri-workspace__overview-camera",
    );
  });
});

function assertMotionGuardrails(): void {
  expect(stylesheet).not.toMatch(/transition(?:-property)?\s*:\s*all\b/);
  expect(stylesheet).not.toMatch(/will-change\s*:\s*all\b/);
  expect(stylesheet).not.toMatch(/\.onirigiri-pane\s*\{[^}]*will-change/);
}

function stylesheetRule(pattern: RegExp): string {
  return stylesheet.match(pattern)?.[1] ?? "";
}

function uniqueSortedMatches(value: string, pattern: RegExp): string[] {
  return [
    ...new Set([...value.matchAll(pattern)].map((match) => match[1] ?? "")),
  ].sort();
}
