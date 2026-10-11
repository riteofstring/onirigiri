import { createPaneCaptureWorker } from "./pane-picture-capture-worker-factory.js";
import type {
  PaneCaptureImage,
  PaneCaptureReply,
  PaneCaptureRequest,
} from "./pane-picture-capture-worker.js";

interface PreparedCapture {
  canvas: HTMLCanvasElement;
  limit: number;
}

interface PendingCapture {
  resolve(reply: PaneCaptureReply): void;
  reject(error: unknown): void;
}

export class PanePictureCaptureClient {
  private worker: Worker | null = null;
  private prepared: PreparedCapture | null = null;
  private pending: PendingCapture | null = null;
  private unavailable = false;
  private disposed = false;

  constructor(private readonly document: Document) {}

  async prepare(signal: AbortSignal): Promise<PreparedCapture | null> {
    signal.throwIfAborted();
    if (this.pending) throw new Error("Pane capture worker is already active");
    if (this.disposed || this.unavailable) return null;
    if (this.prepared) return this.prepared;
    let worker: Worker | undefined;
    try {
      worker = this.createWorker();
      if (!worker) return null;
      this.worker = worker;
      this.listen(worker);
      const canvas = this.document.createElement("canvas");
      canvas.setAttribute("layoutsubtree", "");
      const offscreen = canvas.transferControlToOffscreen();
      const reply = await this.request(
        { type: "prepare", canvas: offscreen },
        [offscreen],
        signal,
      );
      signal.throwIfAborted();
      if (reply.type !== "prepared" || this.worker !== worker)
        throw new Error("Pane capture worker did not initialize");
      this.prepared = { canvas, limit: reply.limit };
      return this.prepared;
    } catch (error) {
      return this.prepareFailure(worker, signal, error);
    }
  }

  private createWorker(): Worker | undefined {
    const view = this.document.defaultView as
      (Window & typeof globalThis) | null;
    if (!view || view.Worker !== globalThis.Worker) return undefined;
    return createPaneCaptureWorker();
  }

  private listen(current: Worker): void {
    current.onmessage = ({ data }: MessageEvent<PaneCaptureReply>) =>
      this.receive(current, data);
    current.onerror = (event) => {
      event.preventDefault();
      if (this.worker === current)
        this.retire(true, new Error("Pane capture worker failed"));
    };
    current.onmessageerror = () => {
      if (this.worker === current)
        this.retire(true, new Error("Pane capture worker reply failed"));
    };
  }

  private prepareFailure(
    worker: Worker | undefined,
    signal: AbortSignal,
    error: unknown,
  ): null {
    if (signal.aborted) {
      if (this.worker === worker) this.retire(false, signal.reason);
      throw signal.reason;
    }
    if (this.disposed) throw error;
    if (!worker || this.worker === worker) this.retire(true, error);
    return null;
  }

  async capture(
    id: string,
    image: PaneCaptureImage,
    size: { width: number; height: number },
    signal: AbortSignal,
  ): Promise<Blob> {
    signal.throwIfAborted();
    if (!this.prepared) throw new Error("Pane capture worker is not ready");
    const worker = this.worker;
    const reply = await this.request(
      { type: "capture", id, image, ...size },
      [image as unknown as Transferable],
      signal,
    );
    signal.throwIfAborted();
    if (reply.type === "captured" && reply.id === id) return reply.image;
    const error = new Error("Pane capture worker returned another request");
    if (this.worker === worker) this.retire(true, error);
    throw error;
  }

  dispose(): void {
    this.disposed = true;
    this.retire(false, new DOMException("Pane capture disposed", "AbortError"));
  }

  private receive(worker: Worker, reply: PaneCaptureReply): void {
    if (this.worker !== worker) return;
    if (reply.type === "failed") {
      this.retire(true, new Error(reply.message));
      return;
    }
    const pending = this.pending;
    this.pending = null;
    pending?.resolve(reply);
  }

  private request(
    message: PaneCaptureRequest,
    transfer: Transferable[],
    signal: AbortSignal,
  ): Promise<PaneCaptureReply> {
    signal.throwIfAborted();
    if (this.pending) throw new Error("Pane capture worker is already active");
    const worker = this.worker;
    if (!worker) throw new Error("Pane capture worker is unavailable");
    return new Promise((resolve, reject) => {
      const abort = () => {
        if (this.worker === worker) this.retire(false, signal.reason);
      };
      signal.addEventListener("abort", abort, { once: true });
      this.pending = {
        resolve: (reply) => {
          signal.removeEventListener("abort", abort);
          resolve(reply);
        },
        reject: (error) => {
          signal.removeEventListener("abort", abort);
          reject(error);
        },
      };
      try {
        worker.postMessage(message, transfer);
      } catch (error) {
        this.retire(true, error);
      }
    });
  }

  private retire(unavailable: boolean, error: unknown): void {
    const worker = this.worker;
    const pending = this.pending;
    this.worker = null;
    this.prepared = null;
    this.pending = null;
    this.unavailable ||= unavailable;
    worker?.terminate();
    pending?.reject(error);
  }
}
