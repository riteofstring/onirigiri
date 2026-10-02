import type { Page } from "@playwright/test";
import type { PaneCanvasSurface } from "../../src/pictures/pane-picture-canvas";

const repositoryRoot = new URL("../../", import.meta.url).pathname;

interface CanvasFixture {
  surface: PaneCanvasSurface;
  canvas: HTMLCanvasElement;
  pane: HTMLElement;
  iframe: HTMLIFrameElement;
  document: Document;
  outside: HTMLInputElement;
  live: boolean;
  visible: boolean;
  device: GPUDevice | null;
  motionRenderer: "dom" | "canvas";
  drawn: boolean;
  error: string | null;
  revision: number;
}

declare global {
  interface Window {
    __paneCanvasFixture: CanvasFixture;
    __paneCanvasCopies: number;
    __paneWarmupMaximum: number;
  }
}

export async function openCanvas(page: Page): Promise<void> {
  const framePath = `/@fs${repositoryRoot}tests/browser/native-content-frame.html`;
  await page.goto(framePath);
  await page.addStyleTag({ url: `/@fs${repositoryRoot}src/styles.css` });
  await page.evaluate(
    async ({ framePath }) => {
      const { createPaneCanvasDevice, PaneCanvasSurface } =
        (await import("../../src/pictures/pane-picture-canvas.ts")) as typeof import("../../src/pictures/pane-picture-canvas");
      document.body.innerHTML = `
      <input id="outside" aria-label="Workspace input">
      <div id="pane" style="position:absolute;left:0;top:0;transform:translate(-900px,-700px);width:400px;height:300px;overflow:hidden">
        <canvas id="canvas" class="onirigiri-pane__live-surface" layoutsubtree>
          <div id="content" style="width:100%;height:100%;font:18px sans-serif;background:rgb(0,80,120)">
            <canvas id="gpu" width="400" height="128" style="width:100%;height:128px;display:block"></canvas>
            <iframe src="${framePath}" style="width:100%;height:172px;border:0;display:block"></iframe>
          </div>
        </canvas>
      </div>`;
      const canvas = document.querySelector<HTMLCanvasElement>("#canvas")!;
      const content = document.querySelector<HTMLElement>("#content")!;
      const iframe = document.querySelector("iframe")!;
      await new Promise<void>((resolve) =>
        iframe.addEventListener("load", () => resolve(), { once: true }),
      );
      const devicePromise = createPaneCanvasDevice(document);
      const fixture: CanvasFixture = {
        canvas,
        iframe,
        pane: document.querySelector<HTMLElement>("#pane")!,
        outside: document.querySelector<HTMLInputElement>("#outside")!,
        document: iframe.contentDocument!,
        live: false,
        visible: true,
        device: null,
        motionRenderer: "dom",
        drawn: false,
        error: null,
        revision: 0,
        surface: new PaneCanvasSurface(canvas, content, devicePromise, {
          canDraw: () => fixture.live,
          canPrime: () => false,
          visible: () => fixture.visible,
          continuous: () => false,
          renderer: () => (fixture.live ? fixture.motionRenderer : "canvas"),
          hideScrollbars: () => false,
          displayScale: () => 1,
          revision: () => fixture.revision,
          drawn: (drawn) => {
            fixture.drawn = drawn;
          },
          failed: (error) => {
            fixture.error = error.message;
          },
        }),
      };
      window.__paneCanvasFixture = fixture;
      const device = await devicePromise;
      fixture.device = device;
      const gpu = document.querySelector<HTMLCanvasElement>("#gpu")!;
      const context = gpu.getContext("webgpu") as GPUCanvasContext;
      context.configure({ device, format: "rgba8unorm", alphaMode: "opaque" });
      const encoder = device.createCommandEncoder();
      const pass = encoder.beginRenderPass({
        colorAttachments: [
          {
            view: context.getCurrentTexture().createView(),
            loadOp: "clear",
            storeOp: "store",
            clearValue: { r: 1, g: 0, b: 0, a: 1 },
          },
        ],
      });
      pass.end();
      device.queue.submit([encoder.finish()]);
      fixture.document.querySelector("input")!.value = "Keep this edit";
      fixture.outside.focus();
    },
    {
      framePath,
    },
  );
}
