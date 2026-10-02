import {
  useContext,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from "react";
import type { PaneRuntimeState } from "@riteofstring/onirigiri";
import {
  createGame,
  drawGame,
  startGame,
  stepGame,
  type ArcadeGame,
  type GameKind,
  type GamePalette,
} from "./game-engine";
import {
  PlaygroundThemeContext,
  type PlaygroundContentTheme,
} from "../playground-theme";
import "./arcade.css";

export function ArcadePane({
  kind,
  runtime,
}: {
  kind: string;
  runtime: PaneRuntimeState;
}) {
  const theme = useContext(PlaygroundThemeContext);
  return theme ? (
    <GamePane
      kind={kind === "prism" ? "prism" : "orbit"}
      runtime={runtime}
      theme={theme}
    />
  ) : null;
}

function GamePane({
  kind,
  runtime,
  theme,
}: {
  kind: GameKind;
  runtime: PaneRuntimeState;
  theme: PlaygroundContentTheme;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const game = useRef<ArcadeGame>(createGame(kind));
  const keys = useRef(new Set<string>());
  const ticks = useRef(0);
  const [status, setStatus] = useState({
    mode: game.current.mode,
    score: 0,
    lives: 3,
  });
  const statusKey = useRef("");
  useEffect(() => {
    const element = canvas.current!;
    const colors = theme.styles;
    const palette: GamePalette = {
      background: colors.surface!,
      grid: colors.border!,
      ink: colors.text!,
      accent: colors.accent!,
      warning: colors.warning!,
      bands: [
        colors["accent-alt"]!,
        colors["text-subtle"]!,
        colors.accent!,
        colors.positive!,
        colors.warning!,
      ],
    };
    const pressedKeys = keys.current;
    if (runtime !== "live") {
      pressedKeys.clear();
      if (runtime === "hidden") element.width = element.height = 1;
      else drawGame(element.getContext("2d")!, game.current, palette);
      return;
    }
    const context = element.getContext("2d")!;
    let frame = 0;
    let previous = 0;
    const resize = () => {
      const ratio = Math.min(devicePixelRatio, 1.5);
      element.width = Math.max(1, Math.round(element.clientWidth * ratio));
      element.height = Math.max(1, Math.round(element.clientHeight * ratio));
      drawGame(context, game.current, palette);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    resize();
    const draw = (time: number) => {
      const direction =
        Number(pressedKeys.has("arrowright") || pressedKeys.has("d")) -
        Number(pressedKeys.has("arrowleft") || pressedKeys.has("a"));
      stepGame(
        game.current,
        previous ? (time - previous) / 1000 : 0,
        direction,
      );
      previous = time;
      drawGame(context, game.current, palette);
      element.dataset.arcadeTicks = String(++ticks.current);
      element.dataset.arcadeScore = String(game.current.score);
      const key = `${game.current.mode}:${game.current.score}:${game.current.lives}`;
      if (key !== statusKey.current) {
        statusKey.current = key;
        setStatus({
          mode: game.current.mode,
          score: game.current.score,
          lives: game.current.lives,
        });
      }
      frame = requestAnimationFrame(draw);
    };
    draw(performance.now());
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      pressedKeys.clear();
    };
  }, [runtime, theme]);
  const start = () => {
    startGame(game.current);
    canvas.current?.focus({ preventScroll: true });
  };
  const key = (event: KeyboardEvent<HTMLCanvasElement>, down: boolean) => {
    const pressed = event.key.toLowerCase();
    if (
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      !["arrowleft", "arrowright", "a", "d", " "].includes(pressed)
    )
      return;
    event.preventDefault();
    event.stopPropagation();
    if (pressed === " ") {
      if (down && !event.repeat) start();
      return;
    }
    if (down) keys.current.add(pressed);
    else keys.current.delete(pressed);
  };
  const prism = kind === "prism";
  const title = prism ? "Prism Break" : "Orbit Dash";
  return (
    <section
      className="arcade-pane arcade-pane--game"
      data-arcade-kind={kind}
      style={
        Object.fromEntries(
          Object.entries(theme.styles).map(([name, value]) => [
            `--arcade-${name}`,
            value,
          ]),
        ) as CSSProperties
      }
    >
      <header className="arcade-header">
        <span className="arcade-eyebrow">
          {prism ? "03 / POCKET ARCADE" : "04 / POCKET ARCADE"}
        </span>
        <div className="arcade-scoreline">
          <h2>{title}</h2>
          <output aria-label={`${title} score`} aria-live="off">
            {String(status.score).padStart(4, "0")}
          </output>
        </div>
        <p>
          {prism
            ? "Clear the spectrum. Keep the light alive."
            : "Find your line through the stars."}
        </p>
      </header>
      <div className="arcade-game-field">
        <canvas
          role="application"
          aria-label={`${title}: use Left and Right or A and D to move; Space to start`}
          tabIndex={0}
          ref={canvas}
          width={1}
          height={1}
          onKeyDown={(event) => key(event, true)}
          onKeyUp={(event) => key(event, false)}
          onBlur={() => keys.current.clear()}
          onPointerDown={start}
          onPointerMove={(event) => {
            const bounds = event.currentTarget.getBoundingClientRect();
            const scale = Math.min(bounds.width / 600, bounds.height / 720);
            game.current.target = Math.max(
              50,
              Math.min(
                550,
                (event.clientX -
                  bounds.left -
                  (bounds.width - 600 * scale) / 2) /
                  scale,
              ),
            );
          }}
        />
        {status.mode !== "playing" ? (
          <div className="arcade-game-prompt">
            <span>
              {status.mode === "ready"
                ? "READY WHEN YOU ARE"
                : status.mode === "won"
                  ? "SPECTRUM CLEARED"
                  : "ONE MORE RUN?"}
            </span>
            <button type="button" onClick={start}>
              {status.mode === "ready" ? "Play" : "Play again"}
              <span aria-hidden="true">↗</span>
            </button>
          </div>
        ) : null}
      </div>
      <footer className="arcade-footer">
        <span className="arcade-hint">Pointer or ← → · Space to start</span>
        <span className="arcade-lives">
          {prism ? `${status.lives} lives` : "Stay inside the gaps"}
        </span>
      </footer>
    </section>
  );
}
