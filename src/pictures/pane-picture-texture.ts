declare const GPUTextureUsage: {
  readonly COPY_SRC: number;
  readonly COPY_DST: number;
  readonly RENDER_ATTACHMENT: number;
};

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
