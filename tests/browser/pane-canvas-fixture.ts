import { expect, type Page } from "@playwright/test";
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
  interactive: boolean;
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

export async function openCanvas(
  page: Page,
  continuous = false,
): Promise<void> {
  const framePath = `/@fs${repositoryRoot}tests/browser/native-content-frame.html`;
  await page.goto(framePath);
  await page.addStyleTag({ url: `/@fs${repositoryRoot}src/styles.css` });
  await page.evaluate(
    async ({ framePath, continuous }) => {
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
        interactive: false,
        device: null,
        motionRenderer: "dom",
        drawn: false,
        error: null,
        revision: 0,
        surface: new PaneCanvasSurface(canvas, content, devicePromise, {
          canDraw: () => fixture.live,
          canPrime: () => false,
          visible: () => fixture.visible,
          continuous: () => continuous,
          interactive: () => fixture.interactive,
          renderer: () =>
            fixture.live || continuous ? fixture.motionRenderer : "canvas",
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
      continuous,
    },
  );
}

export async function expectLiveColors(
  page: Page,
  paneId: string,
): Promise<void> {
  const pane = page.locator(`[data-onirigiri-pane-id="${paneId}"]`);
  for (const color of ["rgb(200, 40, 60)", "rgb(30, 80, 210)"]) {
    await pane.locator("iframe").evaluate((frame, color) => {
      (
        frame as HTMLIFrameElement
      ).contentDocument!.documentElement.style.backgroundColor = color;
    }, color);
    await expect
      .poll(async () => {
        const bounds = (await pane
          .locator('[data-onirigiri-slot="pane-content"]')
          .boundingBox())!;
        const screenshot = await page.screenshot({
          clip: {
            x: bounds.x + bounds.width / 2,
            y: bounds.y + bounds.height * 0.8,
            width: 1,
            height: 1,
          },
        });
        return page.evaluate(async (encoded) => {
          const bitmap = await createImageBitmap(
            await (await fetch(`data:image/png;base64,${encoded}`)).blob(),
          );
          const context = new OffscreenCanvas(1, 1).getContext("2d")!;
          context.drawImage(bitmap, 0, 0, 1, 1);
          bitmap.close();
          return [...context.getImageData(0, 0, 1, 1).data];
        }, screenshot.toString("base64"));
      })
      .toEqual(
        color.startsWith("rgb(200") ? [200, 40, 60, 255] : [30, 80, 210, 255],
      );
  }
}

export async function redPixelBounds(page: Page) {
  const screenshot = await page.locator("#pane").screenshot();
  return page.evaluate(async (encoded) => {
    const bytes = Uint8Array.from(atob(encoded), (value) =>
      value.charCodeAt(0),
    );
    const bitmap = await createImageBitmap(
      new Blob([bytes], { type: "image/png" }),
    );
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext("2d")!;
    context.drawImage(bitmap, 0, 0);
    const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let minX = Infinity,
      minY = Infinity,
      maxX = -1,
      maxY = -1;
    for (let y = 0; y < canvas.height; y++)
      for (let x = 0; x < canvas.width; x++) {
        const i = (y * canvas.width + x) * 4;
        if (data[i]! > 240 && data[i + 1]! < 15 && data[i + 2]! < 15) {
          minX = Math.min(minX, x);
          maxX = Math.max(maxX, x);
          minY = Math.min(minY, y);
          maxY = Math.max(maxY, y);
        }
      }
    bitmap.close();
    return {
      x: minX,
      y: minY,
      width: maxX - minX + 1,
      height: maxY - minY + 1,
    };
  }, screenshot.toString("base64"));
}

export async function nativeContentPixels(page: Page): Promise<Buffer> {
  await page.evaluate(() => {
    const fixture = window.__paneCanvasFixture;
    const content = document.querySelector<HTMLElement>("#content")!;
    const reference = document.createElement("div");
    reference.id = "native-reference";
    reference.className = fixture.canvas.className;
    reference.style.cssText = fixture.canvas.style.cssText;
    fixture.canvas.after(reference);
    reference.moveBefore(content, null);
  });
  try {
    return await page.locator("#content").screenshot();
  } finally {
    await page.evaluate(() => {
      const fixture = window.__paneCanvasFixture;
      fixture.canvas.moveBefore(document.querySelector("#content")!, null);
      document.querySelector("#native-reference")!.remove();
    });
  }
}
