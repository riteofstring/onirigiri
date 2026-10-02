import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createServer, preview } from "vite";
import { surfaceLabServer } from "./surface-lab-server.mjs";

for (const mode of ["development", "preview"]) {
  await test(
    `${mode} hosts production fixtures and streams video ranges`,
    { timeout: 30_000 },
    async () => {
      const root = await mkdtemp(join(tmpdir(), "onirigiri-lab-host-"));
      const fixtureRoot = join(root, "lab");
      const environment = process.env.NODE_ENV;
      process.env.NODE_ENV = "development";
      let close;
      try {
        await mkdir(join(fixtureRoot, "public/assets"), { recursive: true });
        await mkdir(join(root, "dist"));
        await writeFile(join(root, "dist/index.html"), "Playground");
        await writeFile(
          join(fixtureRoot, "fixture.html"),
          '<!doctype html><script type="module" src="/fixture.js"></script>',
        );
        await writeFile(
          join(fixtureRoot, "fixture.js"),
          'document.title = "fixture-mode:" + import.meta.env.MODE + ":" + process.env.NODE_ENV;',
        );
        await writeFile(
          join(fixtureRoot, "public/assets/tier1-video.webm"),
          "0123456789",
        );
        const configuration = {
          configFile: false,
          root,
          plugins: [surfaceLabServer(fixtureRoot)],
          logLevel: "silent",
        };
        const listener = { host: "127.0.0.1", port: 0, strictPort: true };
        const server =
          mode === "preview"
            ? await preview({ ...configuration, preview: listener })
            : await createServer({ ...configuration, server: listener });
        close = () => server.close();
        if ("listen" in server) await server.listen();
        const address = server.httpServer?.address();
        assert(
          address && typeof address !== "string",
          "Fixture host did not open an HTTP port",
        );
        const base = `http://127.0.0.1:${address.port}`;
        const documents = await Promise.all(
          [0, 1, 2].map(async () => {
            const response = await fetch(`${base}/surface-lab/fixture.html`);
            const html = await response.text();
            assert.equal(response.status, 200, html);
            return html;
          }),
        );
        assert.equal(new Set(documents).size, 1);
        assert(!documents[0].includes("@vite/client"));
        const asset = documents[0].match(/src="([^"]+\.js)"/)?.[1];
        assert.match(asset ?? "", /^\/surface-lab\/assets\//);
        const bundle = await fetch(`${base}${asset}`);
        assert.equal(bundle.status, 200);
        assert(
          (await bundle.text()).includes("fixture-mode:production:production"),
        );
        assert.equal(process.env.NODE_ENV, "development");
        await verifyVideoRanges(base);
      } finally {
        await close?.();
        await rm(root, { recursive: true, force: true });
        if (environment === undefined) delete process.env.NODE_ENV;
        else process.env.NODE_ENV = environment;
      }
    },
  );
}

async function verifyVideoRanges(base) {
  for (const path of [
    "/surface-lab/assets/tier1-video.webm",
    "/assets/tier1-video.webm",
  ]) {
    const range = await fetch(`${base}${path}`, {
      headers: { Range: "bytes=2-5" },
    });
    assert.equal(range.status, 206);
    assert.equal(range.headers.get("content-range"), "bytes 2-5/10");
    assert.equal(await range.text(), "2345");
  }
}
