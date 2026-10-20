import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer, type ViteDevServer } from "vite";
import { expect, test } from "vitest";

const configurations = [
  "vite.config.ts",
  "bench/vite.config.ts",
  "playground/one-dimensional/vite.config.ts",
  "playground/two-dimensional/vite.config.ts",
];

test.each(configurations)(
  "%s disables editor launching and retains development routes",
  async (configuration) => {
    const root = await mkdtemp(join(tmpdir(), "onirigiri-dev-routes-"));
    try {
      await writeFile(
        join(root, "index.html"),
        '<!doctype html><script type="module" src="./fixture.ts"></script>',
      );
      await writeFile(
        join(root, "fixture.ts"),
        "export const value: number = 17;",
      );
      await writeFile(
        join(root, "__open-in-editorial.js"),
        'export const value = "ordinary module";',
      );
      for (const base of ["/", "/lab/", "/lab%20space/"]) {
        const server = await createServer({
          configFile: fileURLToPath(
            new URL(`../${configuration}`, import.meta.url),
          ),
          root,
          base: base === "/lab/" ? "/lab" : base,
          logLevel: "silent",
          optimizeDeps: { noDiscovery: true, include: [] },
          server: {
            host: "127.0.0.1",
            port: 0,
            open: false,
            watch: null,
            fs: { allow: [root] },
          },
        });
        try {
          await server.listen();
          await verifyDevelopmentRoutes(server, base);
        } finally {
          await server.close();
        }
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);

async function verifyDevelopmentRoutes(server: ViteDevServer, base: string) {
  const address = server.httpServer?.address();
  if (!address || typeof address === "string")
    throw new Error("Missing HTTP listener");
  const origin = `http://127.0.0.1:${address.port}`;
  const headers = { connection: "close" };
  for (const path of [
    "/__open-in-editor",
    `${base}__open-in-editor`,
    `${base}__OPEN-IN-EDITOR`,
    `${base}__open-in-editor/`,
    `${base}__open-in-editor.json`,
    `${base}__open-in-editor?file=missing-fixture-file.ts`,
  ]) {
    const response = await fetch(`${origin}${path}`, { headers });
    expect(response.status, path).toBe(404);
    expect(await response.text(), path).toBe("");
  }
  const post = await fetch(`${origin}${base}__open-in-editor`, {
    method: "POST",
    headers,
  });
  expect(post.status).toBe(404);
  const html = await fetch(`${origin}${base}index.html`, { headers });
  expect(html.status).toBe(200);
  expect(await html.text()).toContain(`${base}@vite/client`);
  const module = await fetch(`${origin}${base}fixture.ts`, { headers });
  expect(module.status).toBe(200);
  expect(await module.text()).toContain("export const value = 17");
  const ordinary = await fetch(`${origin}${base}__open-in-editorial.js`, {
    headers,
  });
  expect(ordinary.status).toBe(200);
  expect(await ordinary.text()).toContain("ordinary module");
  const ping = await fetch(`${origin}${base}health`, {
    headers: { ...headers, accept: "text/x-vite-ping" },
  });
  expect(ping.status).toBe(204);
}
