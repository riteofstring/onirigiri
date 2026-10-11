import { expect, test } from "@playwright/test";
import { openCanvas } from "./pane-canvas-fixture";
import { chromeLaunchOptions } from "./chrome-launch";

test.use({
  launchOptions: chromeLaunchOptions,
});

for (const dpr of [1, 2]) {
  test.describe(`capture display at pixel ratio ${dpr}`, () => {
    test.use({ deviceScaleFactor: dpr });

    for (const reduced of [false, true]) {
      test(`keeps fresh translucent live pixels while PNG encoding waits${reduced ? " with a reduced capture" : " with one element copy"}`, async ({
        page,
      }) => {
        await openCanvas(page);
        await page.evaluate(() => {
          const fixture = window.__paneCanvasFixture;
          const content = document.querySelector<HTMLElement>("#content")!;
          content.replaceChildren();
          content.style.background = "transparent";
          content.style.display = "flex";
          for (const alpha of [0.5, 0.05]) {
            const stripe = document.createElement("div");
            stripe.style.cssText = `width:50%;height:100%;background:rgba(200,100,50,${alpha})`;
            content.append(stripe);
          }
          fixture.pane.style.transform = "none";
          fixture.live = true;
          fixture.surface.requestPaint();
        });
        await expect(page.locator("#content")).toHaveAttribute(
          "data-onirigiri-live",
          "true",
        );
        const capture = await page.evaluateHandle((reduced) => {
          const fixture = window.__paneCanvasFixture;
          const queue = fixture.device!.queue as GPUQueue & {
            copyElementImageToTexture(...args: unknown[]): void;
          };
          const copy = queue.copyElementImageToTexture;
          const post = Worker.prototype.postMessage;
          let copies = 0;
          let release!: () => void;
          let encoding!: () => void;
          let failed!: (error: unknown) => void;
          const started = new Promise<void>((resolve, reject) => {
            encoding = resolve;
            failed = reject;
          });
          const gate = new Promise<void>((resolve) => (release = resolve));
          queue.copyElementImageToTexture = function (...args) {
            copies++;
            return copy.apply(this, args);
          };
          Worker.prototype.postMessage = function (
            this: Worker,
            ...message: Parameters<Worker["postMessage"]>
          ) {
            encoding();
            void gate.then(() => post.apply(this, message));
          } as Worker["postMessage"];
          fixture.pane.style.width = "700px";
          fixture.pane.style.height = "260px";
          fixture.revision++;
          const currentBeforeCapture = fixture.surface.hasCurrentFrame();
          const options = {
            stage: false,
            signal: AbortSignal.timeout(10_000),
            maxRasterBytes: reduced ? 4096 : 16 * 1024 * 1024,
            maxEncodedBytes: 8 * 1024 * 1024,
          };
          const completion = fixture.surface.capture(options).finally(() => {
            queue.copyElementImageToTexture = copy;
            Worker.prototype.postMessage = post;
          });
          void completion.catch(failed);
          const pixels = async (image: Blob) => {
            const bitmap = await createImageBitmap(image);
            const reader = new OffscreenCanvas(bitmap.width, bitmap.height);
            const context = reader.getContext("2d")!;
            const sample = () =>
              [0.25, 0.75].map((x) => [
                ...context.getImageData(
                  Math.floor(reader.width * x),
                  Math.floor(reader.height / 2),
                  1,
                  1,
                ).data,
              ]);
            context.drawImage(bitmap, 0, 0);
            const raw = sample();
            context.fillStyle = "white";
            context.fillRect(0, 0, reader.width, reader.height);
            context.drawImage(bitmap, 0, 0);
            const composite = sample();
            bitmap.close();
            return {
              raw,
              composite,
              width: reader.width,
              height: reader.height,
            };
          };
          const live = async () => {
            const image = await new Promise<Blob>((resolve) =>
              fixture.canvas.toBlob((blob) => resolve(blob!)),
            );
            return pixels(image);
          };
          const finish = async () => {
            release();
            const retained = await completion;
            const reference = await fixture.surface.capture(options);
            return {
              retained: await pixels(retained.image),
              reference: await pixels(reference.image),
            };
          };
          return {
            started,
            live,
            finish,
            release,
            currentBeforeCapture,
            copies: () => copies,
          };
        }, reduced);
        try {
          await capture.evaluate((capture) => capture.started);
          expect(
            await capture.evaluate((capture) => capture.currentBeforeCapture),
          ).toBe(false);
          expect(await capture.evaluate((capture) => capture.copies())).toBe(
            reduced ? 2 : 1,
          );
          const live = await capture.evaluate((capture) => capture.live());
          expect([live.width, live.height]).toEqual([700 * dpr, 260 * dpr]);
          const { retained, reference } = await capture.evaluate((capture) =>
            capture.finish(),
          );
          expect(retained.raw).toEqual(reference.raw);
          expect(retained.width < live.width).toBe(reduced);
          for (const image of [live, retained])
            for (const [stripe, expected] of [
              [227, 177, 152, 255],
              [252, 247, 245, 255],
            ].entries())
              for (const [channel, value] of expected.entries())
                expect(
                  Math.abs(image.composite[stripe]![channel]! - value),
                ).toBeLessThanOrEqual(2);
          expect(
            await page.evaluate(() => window.__paneCanvasFixture.error),
          ).toBeNull();
        } finally {
          await capture.evaluate((capture) => capture.release());
          await capture.dispose();
        }
      });
    }
  });
}

for (const workerDpr of [1, 2]) {
  test.describe(`background worker at pixel ratio ${workerDpr}`, () => {
    test.use({ deviceScaleFactor: workerDpr });

    test("preserves staged pixels and recovers after a transferred capture is aborted", async ({
      page,
    }) => {
      test.setTimeout(40_000);
      await openCanvas(page);
      const result = await page.evaluate(async () => {
        const { PanePictureCaptureClient } =
          await import("../../src/pictures/pane-picture-capture-client.ts");
        const { PaneCanvasSurface } =
          await import("../../src/pictures/pane-picture-canvas.ts");
        const fixture = window.__paneCanvasFixture;
        const content = fixture.canvas.firstElementChild as HTMLElement;
        content.querySelector("#gpu")!.remove();
        const client = new PanePictureCaptureClient(document);
        const context = fixture.canvas.getContext("webgpu");
        const options = {
          stage: true,
          maxRasterBytes: 128 * 1024 * 1024,
          maxEncodedBytes: 32 * 1024 * 1024,
        };
        const pixels = async (image: Blob) => {
          const bitmap = await createImageBitmap(image);
          const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
          try {
            const context = canvas.getContext("2d")!;
            context.drawImage(bitmap, 0, 0);
            return context.getImageData(0, 0, canvas.width, canvas.height).data;
          } finally {
            bitmap.close();
            canvas.width = canvas.height = 0;
          }
        };
        const difference = (
          left: Uint8ClampedArray,
          right: Uint8ClampedArray,
        ) => {
          if (left.length !== right.length) return -1;
          let changed = 0;
          for (let index = 0; index < left.length; index++)
            if (left[index] !== right[index]) changed++;
          return changed;
        };
        const sameDimensions = (
          left: { width: number; height: number },
          right: { width: number; height: number },
        ) => left.width === right.width && left.height === right.height;
        const identity = () => ({
          content: fixture.canvas.firstElementChild === content,
          context: fixture.canvas.getContext("webgpu") === context,
          document: fixture.iframe.contentDocument === fixture.document,
          input: fixture.document.querySelector("input")!.value,
          staged: document.querySelector("canvas[popover]") !== null,
        });
        const capture = client.capture.bind(client);
        let workerCalls = 0;
        let abortOnTransfer: AbortController | null = null;
        client.capture = (...args) => {
          workerCalls++;
          const pending = capture(...args);
          abortOnTransfer?.abort();
          return pending;
        };
        const comparisons = [];
        let crossPane;
        let aborted = false;
        let restoredAtAbort;
        try {
          for (const [width, height] of [
            [400, 300],
            [1800, 1100],
          ]) {
            fixture.pane.style.width = `${width}px`;
            fixture.pane.style.height = `${height}px`;
            const signal = new AbortController().signal;
            const before = await fixture.surface.capture({
              ...options,
              signal,
            });
            const worker = await fixture.surface.capture({
              ...options,
              signal,
              background: { client, id: `size-${width}` },
            });
            const after = await fixture.surface.capture({ ...options, signal });
            const expected = await pixels(before.image);
            comparisons.push({
              worker: difference(expected, await pixels(worker.image)),
              restored: difference(expected, await pixels(after.image)),
              width:
                worker.width === before.width && after.width === before.width,
              height:
                worker.height === before.height &&
                after.height === before.height,
              identity: identity(),
            });
          }
          const secondPane = fixture.pane.cloneNode(false) as HTMLElement;
          secondPane.removeAttribute("id");
          secondPane.style.width = "520px";
          secondPane.style.height = "340px";
          const secondCanvas = document.createElement("canvas");
          secondCanvas.className = fixture.canvas.className;
          const secondContent = content.cloneNode(false) as HTMLElement;
          secondContent.removeAttribute("id");
          secondContent.style.background = "rgb(170,70,20)";
          secondContent.style.overflow = "scroll";
          secondContent.innerHTML =
            '<div style="height:700px"><h2>Second pane</h2><input value="Other draft"><ol><li>Separate source</li><li>Shared capture worker</li></ol></div>';
          secondCanvas.append(secondContent);
          secondPane.append(secondCanvas);
          fixture.pane.after(secondPane);
          const secondSurface = new PaneCanvasSurface(
            secondCanvas,
            secondContent,
            Promise.resolve(fixture.device!),
            {
              canDraw: () => false,
              canPrime: () => false,
              visible: () => false,
              continuous: () => false,
              renderer: () => "canvas",
              displayScale: () => 1,
              revision: () => 0,
              drawn: () => {},
              failed: (error) => {
                throw error;
              },
            },
          );
          try {
            const signal = new AbortController().signal;
            const prepared = await client.prepare(signal);
            if (!prepared)
              throw new Error("Background capture worker is unavailable");
            const auxiliary = prepared.canvas as HTMLCanvasElement & {
              captureElementImage(element: Element): {
                width: number;
                close(): void;
              };
            };
            const record = auxiliary.captureElementImage;
            let recordings = 0;
            secondContent.scrollTop = 37;
            const ordinaryScrolls = [secondContent.scrollTop];
            const ordinaryWorker = await secondSurface.capture({
              ...options,
              signal,
              background: { client, id: "second-pane" },
            });
            ordinaryScrolls.push(secondContent.scrollTop);
            const ordinaryMain = await secondSurface.capture({
              ...options,
              signal,
            });
            ordinaryScrolls.push(secondContent.scrollTop);
            secondContent.scrollTop = 38;
            const densityScrolls = [secondContent.scrollTop];
            auxiliary.captureElementImage = function (element) {
              const image = record.call(this, element);
              recordings++;
              return recordings === 1
                ? {
                    width: secondContent.offsetWidth * 2,
                    close: () => image.close(),
                  }
                : image;
            };
            try {
              const worker = await secondSurface.capture({
                ...options,
                signal,
                background: { client, id: "density-retry" },
              });
              densityScrolls.push(secondContent.scrollTop);
              auxiliary.captureElementImage = record;
              const main = await secondSurface.capture({ ...options, signal });
              densityScrolls.push(secondContent.scrollTop);
              const originalWorker = await fixture.surface.capture({
                ...options,
                signal,
                background: { client, id: "original-pane" },
              });
              const originalMain = await fixture.surface.capture({
                ...options,
                signal,
              });
              crossPane = {
                retried: recordings > 1,
                ordinaryWorker: difference(
                  await pixels(ordinaryMain.image),
                  await pixels(ordinaryWorker.image),
                ),
                ordinaryScrolls,
                densityScrolls,
                worker: difference(
                  await pixels(main.image),
                  await pixels(worker.image),
                ),
                original: difference(
                  await pixels(originalMain.image),
                  await pixels(originalWorker.image),
                ),
                dimensions:
                  sameDimensions(worker, main) &&
                  sameDimensions(ordinaryWorker, ordinaryMain),
                source: secondContent.parentElement === secondCanvas,
                input: secondContent.querySelector("input")!.value,
                reused: (await client.prepare(signal))?.canvas === auxiliary,
                identity: identity(),
              };
            } finally {
              auxiliary.captureElementImage = record;
            }
          } finally {
            secondSurface.dispose();
            secondPane.remove();
          }
          abortOnTransfer = new AbortController();
          abortOnTransfer.signal.addEventListener(
            "abort",
            () => {
              queueMicrotask(() => {
                restoredAtAbort = identity();
              });
            },
            { once: true },
          );
          try {
            await fixture.surface.capture({
              ...options,
              signal: abortOnTransfer.signal,
              background: { client, id: "cancelled" },
            });
          } catch (error) {
            aborted =
              error instanceof DOMException && error.name === "AbortError";
          }
          abortOnTransfer = null;
          const recovered = await fixture.surface.capture({
            ...options,
            signal: new AbortController().signal,
            background: { client, id: "recovered" },
          });
          const recoveryReference = await fixture.surface.capture({
            ...options,
            signal: new AbortController().signal,
          });
          return {
            comparisons,
            crossPane,
            aborted,
            restoredAtAbort,
            recovered: difference(
              await pixels(recoveryReference.image),
              await pixels(recovered.image),
            ),
            workerCalls,
            identity: identity(),
          };
        } finally {
          client.dispose();
          fixture.surface.dispose();
        }
      });
      const identity = {
        content: true,
        context: true,
        document: true,
        input: "Keep this edit",
        staged: false,
      };
      expect(result.comparisons).toEqual([
        { worker: 0, restored: 0, width: true, height: true, identity },
        { worker: 0, restored: 0, width: true, height: true, identity },
      ]);
      expect(result.crossPane).toEqual({
        retried: true,
        ordinaryWorker: 0,
        ordinaryScrolls: [37, 37, 37],
        densityScrolls: [38, 38, 38],
        worker: 0,
        original: 0,
        dimensions: true,
        source: true,
        input: "Other draft",
        reused: true,
        identity,
      });
      expect(result.aborted).toBe(true);
      expect(result.restoredAtAbort).toEqual(identity);
      expect(result.recovered).toBe(0);
      expect(result.workerCalls).toBe(7);
      expect(result.identity).toEqual(identity);
    });
  });
}
