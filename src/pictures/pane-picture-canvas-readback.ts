declare const GPUBufferUsage: {
  readonly COPY_DST: number;
  readonly MAP_READ: number;
};

declare const GPUMapMode: { readonly READ: number };

export function paneCanvasRasterSize(
  width: number,
  height: number,
  pixelRatio: number,
  budget: number,
  limit: number,
): { width: number; height: number } {
  if (
    ![width, height, pixelRatio, budget, limit].every(
      (value) => Number.isFinite(value) && value > 0,
    )
  )
    throw new Error("Invalid canvas capture dimensions or budget");
  const pixels = width * height * 4;
  const rowPadding = height * 256;
  const budgetScale =
    (2 * budget) /
    (rowPadding + Math.sqrt(rowPadding * rowPadding + 4 * pixels * budget));
  const scale = Math.min(
    pixelRatio,
    limit / width,
    limit / height,
    budgetScale,
  );
  const size = {
    width: Math.max(1, Math.floor(width * scale)),
    height: Math.max(1, Math.floor(height * scale)),
  };
  if (Math.ceil((size.width * 4) / 256) * 256 * size.height > budget)
    throw new Error("Canvas capture exceeds the readback budget");
  return size;
}

export async function readPaneCanvasTexture(
  device: GPUDevice,
  texture: GPUTexture,
  signal: AbortSignal,
): Promise<Blob> {
  signal.throwIfAborted();
  const stride = Math.ceil((texture.width * 4) / 256) * 256;
  const buffer = device.createBuffer({
    size: stride * texture.height,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });
  const abort = () => buffer.destroy();
  signal.addEventListener("abort", abort, { once: true });
  try {
    const encoder = device.createCommandEncoder();
    encoder.copyTextureToBuffer({ texture }, { buffer, bytesPerRow: stride }, [
      texture.width,
      texture.height,
    ]);
    device.queue.submit([encoder.finish()]);
    await buffer.mapAsync(GPUMapMode.READ);
    signal.throwIfAborted();
    const mapped = new Uint8Array(buffer.getMappedRange());
    const rgba = new Uint8ClampedArray(texture.width * texture.height * 4);
    for (let row = 0; row < texture.height; row++) {
      rgba.set(
        mapped.subarray(row * stride, row * stride + texture.width * 4),
        row * texture.width * 4,
      );
    }
    buffer.unmap();
    return await encodeCanvasPixels(
      rgba,
      texture.width,
      texture.height,
      signal,
    );
  } finally {
    signal.removeEventListener("abort", abort);
    buffer.destroy();
  }
}

async function encodeCanvasPixels(
  rgba: Uint8ClampedArray<ArrayBuffer>,
  width: number,
  height: number,
  signal: AbortSignal,
): Promise<Blob> {
  signal.throwIfAborted();
  const encoder = pngEncoder();
  if (encoder) {
    const image = await encoder.encode(rgba, width, height, signal);
    if (image) return image;
  }
  return encodeOnCurrentThread(rgba, width, height, signal);
}

async function encodeOnCurrentThread(
  rgba: Uint8ClampedArray<ArrayBuffer>,
  width: number,
  height: number,
  signal: AbortSignal,
): Promise<Blob> {
  signal.throwIfAborted();
  const canvas = new OffscreenCanvas(width, height);
  try {
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas picture encoding is unavailable");
    context.putImageData(new ImageData(rgba, width, height), 0, 0);
    const image = await canvas.convertToBlob({ type: "image/png" });
    signal.throwIfAborted();
    return image;
  } finally {
    canvas.width = canvas.height = 0;
  }
}

const pngEncoderSource = `onmessage = async ({ data: { id, rgba, width, height } }) => {
  try {
    const canvas = new OffscreenCanvas(width, height);
    canvas.getContext("2d").putImageData(new ImageData(rgba, width, height), 0, 0);
    postMessage({ id, image: await canvas.convertToBlob({ type: "image/png" }) });
  } catch (error) {
    postMessage({ id, error: String(error) });
  }
};`;

interface PendingEncode {
  resolve(image: Blob | null): void;
  reject(error: Error): void;
}

class PngEncoder {
  private next = 0;
  private readonly pending = new Map<number, PendingEncode>();
  private failed = false;

  constructor(private readonly worker: Worker) {
    worker.onmessage = ({ data }: MessageEvent) => {
      const request = this.pending.get(data.id);
      if (!request) return;
      this.pending.delete(data.id);
      if (data.error) request.reject(new Error(data.error));
      else request.resolve(data.image);
    };
    worker.onerror = () => {
      this.failed = true;
      for (const request of this.pending.values())
        request.reject(new Error("Pane picture encoding worker failed"));
      this.pending.clear();
    };
  }

  encode(
    rgba: Uint8ClampedArray<ArrayBuffer>,
    width: number,
    height: number,
    signal: AbortSignal,
  ): Promise<Blob | null> {
    if (this.failed) return Promise.resolve(null);
    const id = ++this.next;
    return new Promise((resolve, reject) => {
      const abort = () => {
        this.pending.delete(id);
        reject(signal.reason);
      };
      signal.addEventListener("abort", abort, { once: true });
      this.pending.set(id, {
        resolve: (image) => {
          signal.removeEventListener("abort", abort);
          resolve(image);
        },
        reject: (error) => {
          signal.removeEventListener("abort", abort);
          reject(error);
        },
      });
      this.worker.postMessage({ id, rgba, width, height }, [rgba.buffer]);
    });
  }
}

let sharedPngEncoder: PngEncoder | null | undefined;

function pngEncoder(): PngEncoder | null {
  if (sharedPngEncoder !== undefined) return sharedPngEncoder;
  try {
    const url = URL.createObjectURL(
      new Blob([pngEncoderSource], { type: "text/javascript" }),
    );
    sharedPngEncoder = new PngEncoder(new Worker(url));
  } catch {
    sharedPngEncoder = null;
  }
  return sharedPngEncoder;
}
