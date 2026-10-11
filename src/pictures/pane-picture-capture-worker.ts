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
  readonly width: number;
  close(): void;
}

export type PaneCaptureRequest =
  | { type: "prepare"; canvas: OffscreenCanvas }
  | {
      type: "capture";
      id: string;
      image: PaneCaptureImage;
      width: number;
      height: number;
    };

export type PaneCaptureReply =
  | { type: "prepared"; limit: number }
  | { type: "captured"; id: string; image: Blob }
  | { type: "failed"; message: string };

interface CaptureQueue extends GPUQueue {
  copyElementImageToTexture(
    source: { source: PaneCaptureImage },
    destination: {
      destination: { texture: GPUTexture; premultipliedAlpha: boolean };
      width: number;
      height: number;
    },
  ): void;
}

interface CaptureSource {
  adapter: GPUAdapter;
  device: GPUDevice;
  context: GPUCanvasContext;
  canvas: OffscreenCanvas;
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
    typeof (device.queue as CaptureQueue).copyElementImageToTexture !==
      "function"
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
  source = { adapter, device, context, canvas };
  device.addEventListener("uncapturederror", (event) => failed(event.error));
  void device.lost.then((info) => {
    if (info.reason !== "destroyed") failed(new Error(info.message));
  });
  reply({ type: "prepared", limit: device.limits.maxTextureDimension2D });
}

async function capture(
  request: Extract<PaneCaptureRequest, { type: "capture" }>,
): Promise<void> {
  let texture: GPUTexture | undefined;
  let image: Blob;
  try {
    if (!source) throw new Error("Pane capture worker is not prepared");
    const { canvas, device } = source;
    canvas.width = request.width;
    canvas.height = request.height;
    texture = device.createTexture({
      size: [request.width, request.height],
      format: "rgba8unorm",
      usage:
        GPUTextureUsage.COPY_DST |
        GPUTextureUsage.COPY_SRC |
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.RENDER_ATTACHMENT,
    });
    (device.queue as CaptureQueue).copyElementImageToTexture(
      { source: request.image },
      {
        destination: { texture, premultipliedAlpha: false },
        width: request.width,
        height: request.height,
      },
    );
    image = await readPaneCanvasTexture(
      device,
      texture,
      new AbortController().signal,
      encodeOnCurrentThread,
    );
  } finally {
    texture?.destroy();
    request.image.close();
  }
  reply({ type: "captured", id: request.id, image });
}

self.onmessage = ({ data }: MessageEvent<PaneCaptureRequest>): void => {
  void (data.type === "prepare" ? prepare(data.canvas) : capture(data)).catch(
    failed,
  );
};
