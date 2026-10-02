import { createServer } from "vite";

import { requirePlaygroundCheckout } from "./playground-checkout";

const repositoryRoot = new URL("../../", import.meta.url).pathname;

export async function startTwoDimensionalDevServer(): Promise<{
  close: () => Promise<void>;
  origin: string;
  repositoryRoot: string;
}> {
  const server = await createServer({
    configFile: `${requirePlaygroundCheckout()}two-dimensional/vite.config.ts`,
    logLevel: "error",
    server: { host: "127.0.0.1", open: false, port: 0, strictPort: false },
  });
  await server.listen();
  const origin = server.resolvedUrls?.local[0];
  if (!origin) {
    await server.close();
    throw new Error("The playground server did not report a URL");
  }
  return {
    close: () => server.close(),
    origin: origin.replace(/\/$/, ""),
    repositoryRoot,
  };
}
