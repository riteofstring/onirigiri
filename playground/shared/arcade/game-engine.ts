export type GameKind = "prism" | "orbit";
export interface ArcadeGame {
  kind: GameKind;
  mode: "ready" | "playing" | "over" | "won";
  score: number;
  lives: number;
  time: number;
  player: number;
  target: number;
  ball: { x: number; y: number; vx: number; vy: number };
  bricks: boolean[];
  gates: { x: number; y: number; passed: boolean }[];
}

export function createGame(kind: GameKind): ArcadeGame {
  return {
    kind,
    mode: "ready",
    score: 0,
    lives: 3,
    time: 0,
    player: 300,
    target: 300,
    ball: { x: 300, y: 560, vx: 160, vy: -260 },
    bricks: Array.from({ length: 40 }, () => true),
    gates: Array.from({ length: 7 }, (_, index) => ({
      x: 110 + ((index * 137) % 380),
      y: -index * 150,
      passed: false,
    })),
  };
}

export function startGame(game: ArcadeGame): void {
  if (game.mode !== "playing")
    Object.assign(game, createGame(game.kind), { mode: "playing" });
}

export function stepGame(
  game: ArcadeGame,
  seconds: number,
  direction = 0,
): void {
  const dt = Math.min(0.05, Math.max(0, seconds));
  game.time += dt;
  if (game.mode !== "playing") return;
  if (direction)
    game.target = Math.max(
      50,
      Math.min(550, game.target + direction * dt * 500),
    );
  game.player += (game.target - game.player) * Math.min(1, dt * 18);
  if (game.kind === "prism") stepPrism(game, dt);
  else stepOrbit(game, dt);
}

function stepPrism(game: ArcadeGame, dt: number): void {
  const ball = game.ball;
  for (let step = 0; step < 3; step++) {
    ball.x += (ball.vx * dt) / 3;
    ball.y += (ball.vy * dt) / 3;
    bouncePrismBall(game);
    hitPrismBrick(game);
    if (ball.y > 730) {
      game.lives--;
      if (!game.lives) game.mode = "over";
      Object.assign(ball, { x: game.player, y: 560, vx: 160, vy: -260 });
      break;
    }
  }
  if (game.bricks.every((brick) => !brick)) game.mode = "won";
}

function bouncePrismBall(game: ArcadeGame): void {
  const ball = game.ball;
  if (ball.x < 12 || ball.x > 588) {
    ball.x = Math.max(12, Math.min(588, ball.x));
    ball.vx *= -1;
  }
  if (ball.y < 12) {
    ball.y = 12;
    ball.vy = Math.abs(ball.vy);
  }
  if (
    ball.vy > 0 &&
    ball.y >= 628 &&
    ball.y <= 650 &&
    Math.abs(ball.x - game.player) < 64
  ) {
    ball.y = 628;
    ball.vx = (ball.x - game.player) * 5;
    ball.vy = -Math.sqrt(Math.max(30000, 360 * 360 - ball.vx * ball.vx));
  }
}

function hitPrismBrick(game: ArcadeGame): void {
  const ball = game.ball;
  for (let index = 0; index < game.bricks.length; index++) {
    if (!game.bricks[index]) continue;
    const x = 28 + (index % 8) * 69;
    const y = 95 + Math.floor(index / 8) * 35;
    if (
      ball.x >= x - 8 &&
      ball.x <= x + 69 &&
      ball.y >= y - 8 &&
      ball.y <= y + 33
    ) {
      game.bricks[index] = false;
      game.score += 100;
      ball.vy *= -1;
      break;
    }
  }
}

function stepOrbit(game: ArcadeGame, dt: number): void {
  const speed = 150 + Math.min(150, game.score * 0.6);
  for (const gate of game.gates) {
    gate.y += speed * dt;
    if (Math.abs(gate.y - 610) < 14 && Math.abs(game.player - gate.x) > 70) {
      game.mode = "over";
      game.lives = 0;
      return;
    }
    if (!gate.passed && gate.y > 630) {
      game.score += 10;
      gate.passed = true;
    }
    if (gate.y > 760) {
      gate.y -= 1050;
      gate.x = 105 + ((game.score * 71 + Math.round(game.time * 31)) % 390);
      gate.passed = false;
    }
  }
}

export interface GamePalette {
  background: string;
  grid: string;
  ink: string;
  accent: string;
  warning: string;
  bands: readonly string[];
}

export function drawGame(
  context: CanvasRenderingContext2D,
  game: ArcadeGame,
  palette: GamePalette,
): void {
  const canvas = context.canvas;
  const scale = Math.min(canvas.width / 600, canvas.height / 720);
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.fillStyle = palette.background;
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.translate(
    (canvas.width - 600 * scale) / 2,
    (canvas.height - 720 * scale) / 2,
  );
  context.scale(scale, scale);
  context.strokeStyle = palette.grid;
  context.lineWidth = 1;
  for (let x = 0; x <= 600; x += 40) {
    context.beginPath();
    context.moveTo(x, 0);
    context.lineTo(x, 720);
    context.stroke();
  }
  for (let index = 0; index < 20; index++) {
    const y = ((index * 40 + game.time * 18) % 760) - 40;
    context.beginPath();
    context.moveTo(0, y);
    context.lineTo(600, y);
    context.stroke();
  }
  if (game.kind === "prism") {
    game.bricks.forEach((visible, index) => {
      if (!visible) return;
      context.fillStyle = palette.bands[Math.floor(index / 8)]!;
      context.beginPath();
      context.roundRect(
        28 + (index % 8) * 69,
        95 + Math.floor(index / 8) * 35,
        61,
        25,
        5,
      );
      context.fill();
    });
    const player =
      game.mode === "ready" ? 300 + Math.sin(game.time) * 130 : game.player;
    context.shadowBlur = 18;
    context.shadowColor = palette.accent;
    context.fillStyle = palette.accent;
    context.beginPath();
    context.roundRect(player - 56, 640, 112, 12, 6);
    context.fill();
    const ball =
      game.mode === "ready"
        ? {
            x: 300 + Math.sin(game.time * 1.3) * 160,
            y: 380 + Math.cos(game.time * 1.5) * 100,
          }
        : game.ball;
    context.fillStyle = palette.ink;
    context.beginPath();
    context.arc(ball.x, ball.y, 8, 0, Math.PI * 2);
    context.fill();
    context.shadowBlur = 0;
  } else {
    for (let index = 0; index < game.gates.length; index++) {
      const gate = game.gates[index]!;
      const y =
        game.mode === "ready"
          ? ((index * 150 + game.time * 80) % 1050) - 160
          : gate.y;
      context.fillStyle = palette.bands[index % palette.bands.length]!;
      context.fillRect(0, y, gate.x - 82, 8);
      context.fillRect(gate.x + 82, y, 600 - gate.x - 82, 8);
      context.fillStyle = palette.ink;
      context.beginPath();
      context.arc(gate.x, y + 30, 4, 0, Math.PI * 2);
      context.fill();
    }
    const player =
      game.mode === "ready"
        ? 300 + Math.sin(game.time * 1.2) * 90
        : game.player;
    context.fillStyle = palette.accent;
    context.shadowBlur = 22;
    context.shadowColor = palette.accent;
    context.beginPath();
    context.moveTo(player, 591);
    context.lineTo(player - 14, 624);
    context.lineTo(player, 617);
    context.lineTo(player + 14, 624);
    context.closePath();
    context.fill();
    context.shadowBlur = 0;
    context.fillStyle = palette.warning;
    context.beginPath();
    context.moveTo(player - 5, 625);
    context.lineTo(player, 646 + Math.sin(game.time * 30) * 8);
    context.lineTo(player + 5, 625);
    context.fill();
  }
}
