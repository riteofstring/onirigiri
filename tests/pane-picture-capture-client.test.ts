import { getEventListeners } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PanePictureCaptureClient } from "../src/pictures/pane-picture-capture-client.js";
import type {
  PaneCaptureReply,
  PaneCaptureRequest,
} from "../src/pictures/pane-picture-capture-worker.js";

class CaptureWorker {
  static instances: CaptureWorker[] = [];
  static constructionError: Error | null = null;
  static initialPostError: Error | null = null;
  onmessage: ((event: { data: PaneCaptureReply }) => void) | null = null;
  onerror: ((event: { preventDefault(): void }) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  readonly messages: {
    message: PaneCaptureRequest;
    transfer: Transferable[];
  }[] = [];
  terminated = false;
  postError = CaptureWorker.initialPostError;

  constructor() {
    if (CaptureWorker.constructionError) throw CaptureWorker.constructionError;
    CaptureWorker.instances.push(this);
  }

  postMessage(message: PaneCaptureRequest, transfer: Transferable[]): void {
    if (this.postError) throw this.postError;
    this.messages.push({ message, transfer });
  }

  terminate(): void {
    this.terminated = true;
  }

  reply(data: PaneCaptureReply): void {
    this.onmessage?.({ data });
  }
}

const clients: PanePictureCaptureClient[] = [];

function client(): PanePictureCaptureClient {
  const document = {
    defaultView: { Worker: CaptureWorker },
    createElement: () => ({
      setAttribute: () => undefined,
      transferControlToOffscreen: () => ({}),
    }),
  } as unknown as Document;
  const value = new PanePictureCaptureClient(document);
  clients.push(value);
  return value;
}

function latest(): CaptureWorker {
  return CaptureWorker.instances.at(-1)!;
}

async function prepared(
  value: PanePictureCaptureClient,
): Promise<CaptureWorker> {
  const pending = value.prepare(new AbortController().signal);
  const worker = latest();
  worker.reply({ type: "prepared", limit: 8192 });
  expect((await pending)?.limit).toBe(8192);
  return worker;
}

function image() {
  return { width: 400, close: () => undefined };
}

beforeEach(() => {
  vi.stubGlobal("Worker", CaptureWorker);
  CaptureWorker.instances = [];
  CaptureWorker.constructionError = null;
  CaptureWorker.initialPostError = null;
});

afterEach(() => {
  for (const value of clients.splice(0)) value.dispose();
  vi.unstubAllGlobals();
});

describe("workspace capture worker ownership", () => {
  it("reuses its prepared source and transfers a fresh image for the returned PNG", async () => {
    const value = client();
    const worker = await prepared(value);
    const controller = new AbortController();
    const source = await value.prepare(controller.signal);
    const element = image();
    const pending = value.capture(
      "capture-1",
      element,
      { width: 400, height: 800 },
      controller.signal,
    );
    expect(worker.messages.at(-1)).toEqual({
      message: {
        type: "capture",
        id: "capture-1",
        image: element,
        width: 400,
        height: 800,
      },
      transfer: [element],
    });
    const png = new Blob(["PNG result"], { type: "image/png" });
    worker.reply({ type: "captured", id: "capture-1", image: png });
    expect(await pending).toBe(png);
    expect(await value.prepare(controller.signal)).toBe(source);
    expect(CaptureWorker.instances).toHaveLength(1);
    expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
  });

  it("cancels initialization without retiring a replacement started before rejection settles", async () => {
    const value = client();
    const controller = new AbortController();
    const reason = new Error("Navigation resumed");
    const pending = value.prepare(controller.signal);
    const rejected = expect(pending).rejects.toBe(reason);
    const old = latest();
    controller.abort(reason);
    const replacement = value.prepare(new AbortController().signal);
    const current = latest();
    old.reply({ type: "prepared", limit: 1 });
    current.reply({ type: "prepared", limit: 4096 });
    await rejected;
    expect((await replacement)?.limit).toBe(4096);
    expect(old.terminated).toBe(true);
    expect(current.terminated).toBe(false);
    expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
  });

  it("terminates an aborted capture and ignores its late reply during a fresh capture", async () => {
    const value = client();
    const old = await prepared(value);
    const controller = new AbortController();
    const reason = new Error("Pane changed");
    const pending = value.capture(
      "old",
      image(),
      { width: 400, height: 800 },
      controller.signal,
    );
    const rejected = expect(pending).rejects.toBe(reason);
    controller.abort(reason);
    const current = await prepared(value);
    await rejected;
    const next = value.capture(
      "new",
      image(),
      { width: 400, height: 800 },
      new AbortController().signal,
    );
    old.reply({ type: "captured", id: "new", image: new Blob(["stale"]) });
    const png = new Blob(["current"]);
    current.reply({ type: "captured", id: "new", image: png });
    expect(await next).toBe(png);
    expect(old.terminated).toBe(true);
    expect(current.terminated).toBe(false);
  });

  it.each(["constructor", "worker-error", "unsupported"])(
    "keeps main capture available after %s initialization failure",
    async (failure) => {
      if (failure === "constructor")
        CaptureWorker.constructionError = new Error("CSP blocked worker");
      const value = client();
      const controller = new AbortController();
      const pending = value.prepare(controller.signal);
      if (failure === "worker-error")
        latest().onerror?.({ preventDefault: () => undefined });
      if (failure === "unsupported")
        latest().reply({ type: "failed", message: "No worker WebGPU" });
      expect(await pending).toBeNull();
      const count = CaptureWorker.instances.length;
      expect(await value.prepare(controller.signal)).toBeNull();
      expect(CaptureWorker.instances).toHaveLength(count);
      expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
    },
  );

  it("releases its abort listener when the initial transfer throws", async () => {
    CaptureWorker.initialPostError = new DOMException(
      "Transfer rejected",
      "DataCloneError",
    );
    const value = client();
    const controller = new AbortController();
    expect(await value.prepare(controller.signal)).toBeNull();
    expect(latest().terminated).toBe(true);
    expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
  });

  it("retires runtime failures so a later preparation selects main capture", async () => {
    const value = client();
    const worker = await prepared(value);
    const controller = new AbortController();
    const pending = value.capture(
      "failed",
      image(),
      { width: 400, height: 800 },
      controller.signal,
    );
    worker.reply({ type: "failed", message: "Worker device lost" });
    await expect(pending).rejects.toThrow("Worker device lost");
    expect(worker.terminated).toBe(true);
    expect(await value.prepare(controller.signal)).toBeNull();
    expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
  });

  it("disposes pending work without accepting a late initialization reply", async () => {
    const value = client();
    const controller = new AbortController();
    const pending = value.prepare(controller.signal);
    const worker = latest();
    value.dispose();
    worker.reply({ type: "prepared", limit: 8192 });
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(worker.terminated).toBe(true);
    expect(await value.prepare(controller.signal)).toBeNull();
    expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
  });

  it("rejects a second capture without replacing the first pending request", async () => {
    const value = client();
    const worker = await prepared(value);
    const signal = new AbortController().signal;
    const first = value.capture(
      "first",
      image(),
      { width: 400, height: 800 },
      signal,
    );
    await expect(
      value.capture("second", image(), { width: 400, height: 800 }, signal),
    ).rejects.toThrow("already active");
    const png = new Blob(["first"]);
    worker.reply({ type: "captured", id: "first", image: png });
    expect(await first).toBe(png);
    expect(worker.terminated).toBe(false);
  });
});
