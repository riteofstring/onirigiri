import { WorkspaceWorldPresentation } from "../../src/presentation/workspace-world-presentation";
import { WorkspaceGridCursorPresentation } from "../../src/workspace/workspace-grid-cursor-presentation";
import type {
  WorkspaceGridCursorRenderItem,
  WorkspaceWorldFrame,
} from "../../src/types";

export interface TransformMotionFixture {
  world: HTMLElement;
  cursor: HTMLElement;
  step(): void;
  unbindWorld(): void;
  unbindCursor(): void;
}

function createTransformMotionFixture(): TransformMotionFixture {
  document.body.style.cssText = "margin:0;overflow:hidden;background:#17191f";
  document.body.innerHTML =
    '<main class="onirigiri-workspace" style="width:100vw;height:100vh"><div class="onirigiri-workspace__world"><div class="onirigiri-workspace__world-grid"></div><section style="position:absolute;width:320px;height:240px;padding:20px;background:#eee;color:#222;font:20px sans-serif"><h1>Retained notes</h1><p>Native text stays clear during movement.</p><input value="Retained draft"></section><div class="onirigiri-workspace__grid-cursor"></div></div></main>';
  const world = document.querySelector<HTMLElement>(
    ".onirigiri-workspace__world",
  )!;
  const cursor = document.querySelector<HTMLElement>(
    ".onirigiri-workspace__grid-cursor",
  )!;
  const grid = document.querySelector<HTMLElement>(
    ".onirigiri-workspace__world-grid",
  )!;
  const worldPresentation = new WorkspaceWorldPresentation();
  const cursorPresentation = new WorkspaceGridCursorPresentation();
  const unbindWorld = worldPresentation.bindWorldHost(world, grid);
  const unbindCursor = cursorPresentation.bindCursorHost(cursor);
  const from: WorkspaceWorldFrame = {
    x: 40,
    y: 40,
    scale: 0.8,
    focalWorldX: 0,
    focalWorldY: 0,
    focalScreenX: 40,
    focalScreenY: 40,
    grid: { x: -50, y: -50, width: 1600, height: 1200 },
  };
  const to = {
    ...from,
    x: 240,
    y: 180,
    focalScreenX: 240,
    focalScreenY: 180,
  };
  const item: WorkspaceGridCursorRenderItem = {
    x: 0,
    y: 0,
    width: 360,
    height: 280,
    scale: 1,
    cursor: { column: 0, row: 0, split: 0 },
    kind: "occupied",
    paneId: "notes",
    presentationMode: "overview",
    structural: true,
  };
  const target = { ...item, x: 120, y: 80 };
  const curve = {
    durationMs: 1000,
    easing: (progress: number) => progress,
  };
  worldPresentation.apply(from);
  cursorPresentation.apply(item, false, from.scale);
  worldPresentation.retarget(from, to, curve);
  cursorPresentation.retarget(target, curve);
  const step = () => {
    worldPresentation.advanceMotion(16);
    cursorPresentation.advanceMotion(16);
    worldPresentation.apply(to, true);
    cursorPresentation.apply(target, true, to.scale);
  };
  step();
  return { world, cursor, step, unbindWorld, unbindCursor };
}

Reflect.set(window, "__transformMotionFixture", createTransformMotionFixture());
