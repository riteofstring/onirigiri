import { ArcadePane } from "./arcade/arcade-pane";
import { useContext, useEffect, useState, type ReactNode } from "react";
import {
  useOnirigiriPaneContentReady,
  type OnirigiriPaneDefinition,
  type OnirigiriPaneRenderState,
  type WorkspacePane,
} from "@riteofstring/onirigiri";
import { usePlaygroundMenu } from "./playground-menu";
import { DemoPane, type DemoKind } from "./demo-pane";
import { CooperativeFixtureFrame } from "./cooperative-fixture-frame";
import { PlaygroundThemeContext } from "./playground-theme";
import { PlaygroundWelcomePane } from "./playground-shortcuts";
import {
  createPlaygroundPanes,
  fixtureUrl,
  paneContentTypes,
  paneCounts,
  requestForContent,
  type PaneContentType,
  type PaneCount,
} from "./playground-pane-catalog";

const allContentTypes = paneContentTypes.map(({ kind }) => kind);

export function usePlaygroundContent(
  model: "1d" | "2d",
  suppliedPanes?: readonly OnirigiriPaneDefinition[],
) {
  const [selected, setSelected] = useState<readonly PaneContentType[]>(() => {
    const requested = new URLSearchParams(location.search)
      .get("content")
      ?.split(",");
    const selected = allContentTypes.filter((kind) =>
      requested?.includes(kind),
    );
    return selected.length ? selected : allContentTypes;
  });
  const [count, setCount] = useState<PaneCount>(
    () =>
      paneCounts.find(
        (count) =>
          count === Number(new URLSearchParams(location.search).get("count")),
      ) ?? (model === "2d" ? 100 : 10),
  );
  const [panes, setPanes] = useState(
    () => suppliedPanes ?? createPlaygroundPanes(model, count, selected),
  );
  const [cacheAll, setCacheAll] = useState(
    () => new URLSearchParams(location.search).get("cache") !== "nearby",
  );
  const [textureMemoryMiB, setTextureMemoryMiB] = useState(() => {
    const value = Number(
      new URLSearchParams(location.search).get("textureMemory"),
    );
    return validTextureMemory(value) ? value : 256;
  });
  return {
    textureMemoryMiB,
    setTextureMemoryMiB(value: number) {
      if (!validTextureMemory(value)) return textureMemoryMiB;
      const url = new URL(location.href);
      url.searchParams.set("textureMemory", String(value));
      history.replaceState(null, "", url);
      setTextureMemoryMiB(value);
      return value;
    },
    cacheAll,
    setCacheAll(value: boolean) {
      const url = new URL(location.href);
      url.searchParams.set("cache", value ? "all" : "nearby");
      history.replaceState(null, "", url);
      setCacheAll(value);
    },
    count,
    panes,
    selected,
    spawn(nextCount: PaneCount) {
      updateContentUrl(nextCount, selected);
      setCount(nextCount);
      setPanes(createPlaygroundPanes(model, nextCount, selected));
    },
    select(types: readonly PaneContentType[]) {
      updateContentUrl(count, types);
      setSelected(types);
      setPanes(createPlaygroundPanes(model, count, types));
    },
    reset() {
      setPanes(suppliedPanes ?? createPlaygroundPanes(model, count, selected));
    },
    request(index: number) {
      return requestForContent(selected[index % selected.length]!);
    },
  };
}

export function PlaygroundPane({
  pane,
  state,
  onChoose,
  onExplore,
}: {
  pane: WorkspacePane;
  state: OnirigiriPaneRenderState;
  onChoose: (paneId: string, kind: DemoKind) => void;
  onExplore: () => void;
}) {
  const theme = useContext(PlaygroundThemeContext);
  const [query] = useState(() => new URLSearchParams(location.search));
  const lab = pane.surfaceKind.startsWith("lab:");
  useOnirigiriPaneContentReady(!lab || theme !== null);
  if (pane.surfaceKind === "welcome")
    return <PlaygroundWelcomePane onExplore={onExplore} />;
  if (pane.surfaceKind.startsWith("arcade:"))
    return (
      <ArcadePane
        key={pane.surfaceKind}
        kind={pane.surfaceKind.slice(7)}
        runtime={state.runtimeState}
      />
    );
  if (!lab)
    return <DemoPane pane={pane} focused={state.focused} onChoose={onChoose} />;
  return theme ? (
    <CooperativeFixtureFrame
      protocol={query.get("protocol") ?? "browser-surface-lab/v1"}
      runtime={state.runtimeState}
      src={fixtureUrl(query, pane.surfaceKind.slice(4))}
      theme={theme}
      title={pane.title}
    />
  ) : null;
}

export function PlaygroundContentControls({
  content,
  onRestart,
}: {
  content: ReturnType<typeof usePlaygroundContent>;
  onRestart: () => void;
}) {
  const [draft, setDraft] = useState(content.selected);
  useEffect(() => setDraft(content.selected), [content.selected]);
  return (
    <>
      <ContentDropdown label="Spawn panes">
        {(close) => (
          <>
            <p className="playground-add-menu__description">
              Starts a new workspace
            </p>
            {paneCounts.map((count) => (
              <button
                key={count}
                type="button"
                onClick={() => {
                  content.spawn(count);
                  onRestart();
                  close();
                }}
              >
                {count} panes
              </button>
            ))}
          </>
        )}
      </ContentDropdown>
      <ContentDropdown
        label={`Content (${content.selected.length})`}
        className="playground-content-menu"
      >
        {(close) => (
          <>
            <label>
              <input
                type="checkbox"
                checked={content.cacheAll}
                onChange={(event) => content.setCacheAll(event.target.checked)}
              />
              <span>Cache one frame from every pane</span>
            </label>
            <label className="playground-texture-memory">
              <span>Texture memory (MiB)</span>
              <input
                type="number"
                min={64}
                max={2048}
                step={1}
                defaultValue={content.textureMemoryMiB}
                onBlur={(event) => {
                  event.currentTarget.value = String(
                    content.setTextureMemoryMiB(
                      event.currentTarget.valueAsNumber,
                    ),
                  );
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") event.currentTarget.blur();
                }}
              />
            </label>
            <p className="playground-add-menu__description">
              More memory keeps more texture detail. No time expiry.
            </p>
            <div className="playground-content-menu__selection">
              <button type="button" onClick={() => setDraft(allContentTypes)}>
                Select all
              </button>
              <button type="button" onClick={() => setDraft([])}>
                Clear all
              </button>
            </div>
            <div className="playground-content-menu__types">
              {(["Demos", "Lab", "Arcade"] as const).map((group) => (
                <fieldset key={group}>
                  <legend>{group}</legend>
                  {paneContentTypes
                    .filter((type) => type.group === group)
                    .map(({ kind, label }) => (
                      <label key={kind}>
                        <input
                          type="checkbox"
                          checked={draft.includes(kind)}
                          onChange={(event) =>
                            setDraft((current) =>
                              event.target.checked
                                ? [...current, kind]
                                : current.filter((entry) => entry !== kind),
                            )
                          }
                        />
                        <span>{label}</span>
                      </label>
                    ))}
                </fieldset>
              ))}
            </div>
            <p className="playground-add-menu__description">
              Applying restarts the workspace.
            </p>
            <button
              className="playground-actions__primary"
              disabled={draft.length === 0}
              type="button"
              onClick={() => {
                content.select(draft);
                onRestart();
                close();
              }}
            >
              Apply content
            </button>
          </>
        )}
      </ContentDropdown>
    </>
  );
}

function ContentDropdown({
  children,
  className = "",
  label,
}: {
  children: (close: () => void) => ReactNode;
  className?: string;
  label: string;
}) {
  const { close, menuProps } = usePlaygroundMenu();
  return (
    <details className={`playground-add-menu ${className}`} {...menuProps}>
      <summary>
        <span>{label}</span>
        <svg
          aria-hidden="true"
          focusable="false"
          fill="none"
          viewBox="0 0 20 20"
        >
          <path d="m6 8 4 4 4-4" />
        </svg>
      </summary>
      <div className="playground-add-menu__panel">{children(close)}</div>
    </details>
  );
}

function updateContentUrl(
  count: PaneCount,
  selected: readonly PaneContentType[],
) {
  const url = new URL(location.href);
  url.searchParams.set("count", String(count));
  url.searchParams.set("content", selected.join(","));
  history.replaceState(null, "", url);
}

function validTextureMemory(value: number): boolean {
  return Number.isInteger(value) && value >= 64 && value <= 2048;
}
