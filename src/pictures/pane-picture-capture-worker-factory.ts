export function createPaneCaptureWorker(): Worker {
  return new Worker(
    new URL("./pane-picture-capture-worker.ts", import.meta.url),
    { type: "module" },
  );
}
