declare const GPUTextureUsage: {
  readonly COPY_SRC: number;
  readonly COPY_DST: number;
  readonly RENDER_ATTACHMENT: number;
};

const captureDisplays = new WeakMap<
  GPUDevice,
  Promise<GPURenderPipeline | undefined>
>();

export function preparePaneCaptureDisplay(
  device: GPUDevice,
  signal: AbortSignal,
): Promise<GPURenderPipeline | undefined> {
  signal.throwIfAborted();
  let pipeline = captureDisplays.get(device);
  if (!pipeline) {
    const module = device.createShaderModule({
      code: `
@group(0) @binding(0) var pixels: texture_2d<f32>;

@vertex fn vertex(@builtin(vertex_index) index: u32) -> @builtin(position) vec4f {
  let corners = array(vec2f(-1, -1), vec2f(3, -1), vec2f(-1, 3));
  return vec4f(corners[index], 0, 1);
}

@fragment fn fragment(@builtin(position) position: vec4f) -> @location(0) vec4f {
  let color = textureLoad(pixels, vec2i(position.xy), 0);
  return vec4f(color.rgb * color.a, color.a);
}`,
    });
    pipeline = device
      .createRenderPipelineAsync({
        layout: "auto",
        vertex: { module, entryPoint: "vertex" },
        fragment: {
          module,
          entryPoint: "fragment",
          targets: [{ format: "rgba8unorm" }],
        },
      })
      .catch(() => undefined);
    captureDisplays.set(device, pipeline);
  }
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    void pipeline.then(
      (prepared) => {
        signal.removeEventListener("abort", abort);
        if (signal.aborted) reject(signal.reason);
        else resolve(prepared);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", abort);
        reject(error);
      },
    );
  });
}

export function displayPaneCapture(
  device: GPUDevice,
  pipeline: GPURenderPipeline,
  source: GPUTexture,
  destination: GPUTexture,
): void {
  const encoder = device.createCommandEncoder();
  const pass = encoder.beginRenderPass({
    colorAttachments: [
      {
        view: destination.createView(),
        loadOp: "clear",
        storeOp: "store",
        clearValue: { r: 0, g: 0, b: 0, a: 0 },
      },
    ],
  });
  pass.setPipeline(pipeline);
  pass.setBindGroup(
    0,
    device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: source.createView() }],
    }),
  );
  pass.draw(3);
  pass.end();
  device.queue.submit([encoder.finish()]);
}

export interface PanePictureTexture {
  readonly width: number;
  readonly height: number;
  present(canvas: HTMLCanvasElement): () => void;
  dispose(): void;
}

export async function preparePanePictureTexture(
  document: Document,
  device: GPUDevice,
  image: Blob,
  size: { width: number; height: number },
  valid: () => boolean,
): Promise<PanePictureTexture> {
  if (Math.max(size.width, size.height) > device.limits.maxTextureDimension2D)
    throw new Error("Picture exceeds the GPU texture dimensions");
  const bitmap = await document.defaultView!.createImageBitmap(image, {
    resizeWidth: size.width,
    resizeHeight: size.height,
    resizeQuality: "pixelated",
  });
  let texture: GPUTexture | undefined;
  try {
    if (!valid()) throw new Error("Picture preparation cancelled");
    texture = device.createTexture({
      size: [size.width, size.height],
      format: document.defaultView!.navigator.gpu.getPreferredCanvasFormat(),
      usage:
        GPUTextureUsage.COPY_SRC |
        GPUTextureUsage.COPY_DST |
        GPUTextureUsage.RENDER_ATTACHMENT,
    });
    device.queue.copyExternalImageToTexture(
      { source: bitmap },
      { texture, premultipliedAlpha: true },
      [size.width, size.height],
    );
    return new PreparedPanePicture(device, texture);
  } catch (error) {
    texture?.destroy();
    throw error;
  } finally {
    bitmap.close();
  }
}

class PreparedPanePicture implements PanePictureTexture {
  readonly width: number;
  readonly height: number;

  constructor(
    private readonly device: GPUDevice,
    private readonly texture: GPUTexture,
  ) {
    this.width = texture.width;
    this.height = texture.height;
  }

  present(canvas: HTMLCanvasElement): () => void {
    const context = canvas.getContext("webgpu") as GPUCanvasContext | null;
    if (!context) throw new Error("Picture presentation is unavailable");
    canvas.width = this.width;
    canvas.height = this.height;
    context.configure({
      device: this.device,
      format: this.texture.format,
      alphaMode: "premultiplied",
      usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
    });
    const encoder = this.device.createCommandEncoder();
    encoder.copyTextureToTexture(
      { texture: this.texture },
      { texture: context.getCurrentTexture() },
      [this.width, this.height],
    );
    this.device.queue.submit([encoder.finish()]);
    return () => {
      canvas.width = canvas.height = 1;
    };
  }

  dispose(): void {
    this.texture.destroy();
  }
}
