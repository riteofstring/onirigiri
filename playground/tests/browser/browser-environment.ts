import type { Page } from "@playwright/test";

export async function browserGraphicsCapabilities(page: Page) {
  const url = "http://127.0.0.1/onirigiri-capability-probe";
  await page.route(url, (route) =>
    route.fulfill({ contentType: "text/html", body: "<!doctype html>" }),
  );
  try {
    await page.goto(url);
    return await page.evaluate(async () => {
      const canvas = document.createElement("canvas");
      const methods = [
        "captureElementImage",
        "requestPaint",
        "showPopover",
        "moveBefore",
      ];
      const missing = methods.filter(
        (name) => typeof Reflect.get(canvas, name) !== "function",
      );
      const gpu = Reflect.get(navigator, "gpu");
      let adapterInfo = null;
      if (!gpu) missing.push("WebGPU");
      else {
        try {
          const adapter = await gpu.requestAdapter();
          if (!adapter) missing.push("WebGPU adapter");
          else if (adapter.info?.isFallbackAdapter)
            missing.push("WebGPU hardware adapter");
          else {
            adapterInfo = adapter.info
              ? {
                  vendor: adapter.info.vendor,
                  architecture: adapter.info.architecture,
                  device: adapter.info.device,
                  description: adapter.info.description,
                }
              : null;
            const device = await adapter.requestDevice();
            try {
              if (
                typeof Reflect.get(
                  device.queue,
                  "copyElementImageToTexture",
                ) !== "function"
              )
                missing.push("copyElementImageToTexture");
            } finally {
              device.destroy();
            }
          }
        } catch (error) {
          missing.push(`WebGPU initialization: ${String(error)}`);
        }
      }
      return { missing, adapterInfo, secureContext: isSecureContext };
    });
  } finally {
    await page.unroute(url);
    await page.goto("about:blank");
  }
}
