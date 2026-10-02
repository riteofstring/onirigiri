import { useCallback, useState } from "react";
import type {
  OnirigiriChromeComponents,
  OnirigiriWorkspaceHandle,
  PanePresentation,
  PanePresentationContext,
  WorkspacePane,
} from "@riteofstring/onirigiri";
import { usePlaygroundMenu } from "./playground-menu";

export const playgroundRendererChrome = {
  PaneTitlebarAccessory: PlaygroundPaneRendererLabel,
} satisfies OnirigiriChromeComponents;

function PlaygroundPaneRendererLabel() {
  return (
    <span
      className="playground-renderer-label"
      title="Actual presentation of pane content"
    >
      <span data-renderer-label="dom">Native DOM</span>
      <span data-renderer-label="canvas">Live HTML-in-Canvas</span>
      <span data-renderer-label="texture">Frozen texture</span>
      <span data-renderer-label="placeholder">Placeholder</span>
      <span data-renderer-label="loading">Loading</span>
      <span data-renderer-label="error">Render error</span>
    </span>
  );
}

type Phase = "all" | PanePresentationContext["phase"];
type Choice =
  "inherit" | "auto" | "dom" | "canvas" | "texture" | "preview" | "icon";
type Rules = Record<string, Partial<Record<Phase, Choice>>>;

const choices: readonly [Choice, string][] = [
  ["inherit", "Inherit"],
  ["auto", "Automatic · performance"],
  ["dom", "Native DOM"],
  ["canvas", "Live HTML-in-Canvas"],
  ["texture", "Frozen texture"],
  ["preview", "Low-resolution texture"],
  ["icon", "Icon placeholder"],
];

function presentation(choice: Choice): PanePresentation | undefined {
  if (choice === "inherit") return undefined;
  if (choice === "preview") return { kind: "texture", detail: "preview" };
  if (choice === "texture") return { kind: "texture", detail: "full" };
  if (choice === "icon") return { kind: "placeholder", variant: "icon" };
  return choice;
}

export function usePlaygroundPresentation() {
  const [liveContent, setLiveContent] = useState(true);
  const [rules, setRules] = useState<Rules>({});
  const resolve = useCallback(
    (pane: WorkspacePane, context: PanePresentationContext) => {
      for (const key of [
        `pane:${pane.paneId}`,
        `type:${pane.surfaceKind}`,
        "all",
      ]) {
        const rule = rules[key];
        const value = rule?.[context.phase] ?? rule?.all;
        if (value && value !== "inherit") return presentation(value);
      }
      return undefined;
    },
    [rules],
  );
  return {
    liveContent,
    setLiveContent,
    getPanePresentation: Object.keys(rules).length ? resolve : undefined,
    choice(scope: string, phase: Phase): Choice {
      return rules[scope]?.[phase] ?? "inherit";
    },
    set(scope: string, phase: Phase, choice: Choice) {
      setRules((previous) => {
        const rule = { ...previous[scope] };
        if (choice === "inherit") delete rule[phase];
        else rule[phase] = choice;
        const next = { ...previous, [scope]: rule };
        if (!Object.keys(rule).length) delete next[scope];
        return next;
      });
    },
  };
}

export function PlaygroundPresentationControls({
  workspaceRef,
  rendering,
}: {
  workspaceRef: { readonly current: OnirigiriWorkspaceHandle | null };
  rendering: ReturnType<typeof usePlaygroundPresentation>;
}) {
  const { menuProps } = usePlaygroundMenu();
  const [panes, setPanes] = useState<readonly WorkspacePane[]>([]);
  const [paneId, setPaneId] = useState("");
  const [scope, setScope] = useState("all");
  const [phase, setPhase] = useState<Phase>("all");
  const pane = panes.find((candidate) => candidate.paneId === paneId);
  const key =
    scope === "pane"
      ? `pane:${paneId}`
      : scope === "type"
        ? `type:${pane?.surfaceKind}`
        : "all";
  return (
    <details
      className="playground-add-menu playground-renderer-menu"
      {...menuProps}
      onToggle={(event) => {
        const workspace = workspaceRef.current;
        if (event.currentTarget.open && workspace) {
          setPanes(workspace.getScene().panes);
          setPaneId(workspace.getSnapshot().focusedPaneId ?? "");
        }
        menuProps.onToggle();
      }}
    >
      <summary>Rendering</summary>
      <div className="playground-add-menu__panel">
        <label>
          <input
            type="checkbox"
            checked={rendering.liveContent}
            onChange={(event) => rendering.setLiveContent(event.target.checked)}
          />
          <span>Always live</span>
        </label>
        <p className="playground-add-menu__description">
          Keeps applications mounted and visible content animated. Uses more
          memory. Explicit texture and placeholder rules pause the covered
          content.
        </p>
        <label>
          <span>Apply to</span>
          <select
            value={scope}
            onChange={(event) => setScope(event.target.value)}
          >
            <option value="all">All panes</option>
            <option value="type">Same content type</option>
            <option value="pane">One pane</option>
          </select>
        </label>
        {scope !== "all" ? (
          <label>
            <span>Pane</span>
            <select
              value={paneId}
              onChange={(event) => setPaneId(event.target.value)}
            >
              {!pane ? <option value="">Select a pane</option> : null}
              {panes.map((candidate) => (
                <option key={candidate.paneId} value={candidate.paneId}>
                  {candidate.title}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label>
          <span>When</span>
          <select
            value={phase}
            onChange={(event) => setPhase(event.target.value as Phase)}
          >
            <option value="all">All phases</option>
            <option value="rest">At rest</option>
            <option value="motion">During motion</option>
            <option value="overview">Overview · stationary</option>
            <option value="overview-motion">Overview · moving</option>
            <option value="resize">During resize</option>
          </select>
        </label>
        <label>
          <span>Presentation</span>
          <select
            disabled={scope !== "all" && !pane}
            value={rendering.choice(key, phase)}
            onChange={(event) =>
              rendering.set(key, phase, event.target.value as Choice)
            }
          >
            {choices.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <p className="playground-add-menu__description">
          Pane rules override content-type rules, then workspace rules.
          Automatic keeps graphics native and uses live HTML-in-Canvas for
          capturable video. Unsupported capture stays native; unavailable
          textures show an icon.
        </p>
      </div>
    </details>
  );
}
