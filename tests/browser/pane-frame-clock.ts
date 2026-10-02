import type { Page } from "@playwright/test";

export async function holdPaneFrames(page: Page) {
  return page.evaluateHandle(async () => {
    const request = window.requestAnimationFrame.bind(window);
    const cancel = window.cancelAnimationFrame.bind(window);
    const callbacks = new Map<number, FrameRequestCallback>();
    let id = 0;
    let time = performance.now();
    window.requestAnimationFrame = (callback) => {
      callbacks.set(++id, callback);
      return id;
    };
    window.cancelAnimationFrame = (id) => {
      callbacks.delete(id);
    };
    await new Promise<void>((resolve) => request(() => resolve()));
    return {
      step() {
        time += 1000 / 60;
        const pending = [...callbacks.values()];
        callbacks.clear();
        for (const callback of pending) callback(time);
      },
      release() {
        window.requestAnimationFrame = request;
        window.cancelAnimationFrame = cancel;
        for (const callback of callbacks.values()) request(callback);
        callbacks.clear();
      },
    };
  });
}
