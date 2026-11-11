import {
  canDrawElementImages,
  drawElementImage,
} from "./pane-picture-canvas-api.js";
import {
  encodeOnCurrentThread,
  readPaneCanvasTexture,
} from "./pane-picture-canvas-readback.js";

declare const GPUTextureUsage: {
  readonly COPY_SRC: number;
  readonly COPY_DST: number;
  readonly TEXTURE_BINDING: number;
  readonly RENDER_ATTACHMENT: number;
};

export interface PaneCaptureImage {
  close(): void;
}

export type PaneCaptureRequest =
  | { type: "prepare"; canvas: OffscreenCanvas }
  | { type: "resize"; width: number; height: number }
  | {
      type: "capture";
      id: string;
      image: PaneCaptureImage;
      width: number;
      height: number;
    };

export type PaneCaptureReply =
  | { type: "prepared"; limit: number }
  | { type: "resized" }
  | {
      type: "captured";
      id: string;
      image: Blob;
      rasterMs: number;
      encodeMs: number;
    }
  | { type: "failed"; message: string };


interface CaptureSource {
  device: GPUDevice;
  canvas: OffscreenCanvas;
  context: GPUCanvasContext;
}

let source: CaptureSource | null = null;

function reply(message: PaneCaptureReply): void {
  self.postMessage(message);
}

function failed(error: unknown): void {
  reply({
    type: "failed",
    message: error instanceof Error ? error.message : String(error),
  });
}

async function prepare(canvas: OffscreenCanvas): Promise<void> {
  const adapter = await navigator.gpu?.requestAdapter();
  if (!adapter) throw new Error("Pane capture worker has no WebGPU adapter");
  const device = await adapter.requestDevice();
  const context = canvas.getContext("webgpu") as GPUCanvasContext | null;
  if (
    !context ||
    !canDrawElementImages(device.queue)
  ) {
    device.destroy();
    throw new Error("Pane capture worker lacks HTML-in-Canvas");
  }
  context.configure({
    device,
    format: "rgba8unorm",
    alphaMode: "premultiplied",
    usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
  });
  source = { device, canvas, context };
  device.addEventListener("uncapturederror", (event) => failed(event.error));
  void device.lost.then((info) => {
    if (info.reason !== "destroyed") failed(new Error(info.message));
  });
  reply({ type: "prepared", limit: device.limits.maxTextureDimension2D });
}

function resize(
  request: Extract<PaneCaptureRequest, { type: "resize" }>,
): void {
  if (!source) throw new Error("Pane capture worker is not prepared");
  const { canvas, context, device } = source;
  canvas.width = request.width;
  canvas.height = request.height;
  const encoder = device.createCommandEncoder();
  encoder
    .beginRenderPass({
      colorAttachments: [
        {
          view: context.getCurrentTexture().createView(),
          loadOp: "clear",
          storeOp: "store",
          clearValue: [0, 0, 0, 0],
        },
      ],
    })
    .end();
  device.queue.submit([encoder.finish()]);
  reply({ type: "resized" });
}

async function capture(
  request: Extract<PaneCaptureRequest, { type: "capture" }>,
): Promise<void> {
  let texture: GPUTexture | undefined;
  let image: Blob;
  const started = performance.now();
  let encodeStart = started;
  let encodeMs = 0;
  try {
    if (!source) throw new Error("Pane capture worker is not prepared");
    const { device } = source;
    texture = device.createTexture({
      size: [request.width, request.height],
      format: "rgba8unorm",
      usage:
        GPUTextureUsage.COPY_DST |
        GPUTextureUsage.COPY_SRC |
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.RENDER_ATTACHMENT,
    });
    drawElementImage(device.queue, request.image, texture, false);
    image = await readPaneCanvasTexture(
      device,
      texture,
      new AbortController().signal,
      async (...args) => {
        encodeStart = performance.now();
        const result = await encodeOnCurrentThread(...args);
        encodeMs = performance.now() - encodeStart;
        return result;
      },
    );
  } finally {
    texture?.destroy();
    request.image.close();
  }
  reply({
    type: "captured",
    id: request.id,
    image,
    rasterMs: encodeStart - started,
    encodeMs,
  });
}

self.onmessage = ({ data }: MessageEvent<PaneCaptureRequest>): void => {
  void (async () => {
    if (data.type === "prepare") await prepare(data.canvas);
    else if (data.type === "resize") resize(data);
    else await capture(data);
  })().catch(failed);
};
