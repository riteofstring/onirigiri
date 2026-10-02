import { run, runPnpm } from "./lib/process.mjs";

const commands = {
  unit: ["test"],
  "pane-defaults": ["exec", "vitest", "run", "tests/pane-defaults.test.tsx"],
  cache: ["exec", "vitest", "run", "tests/pane-pictures.test.ts"],
  pictures: ["exec", "vitest", "run", "tests/engine-pane-pictures.test.tsx"],
  contract: [
    "exec",
    "vitest",
    "run",
    "tests/pane-pictures.test.ts",
    "tests/native-content-motion.test.tsx",
    "tests/pane-presentation-native-content.test.ts",
    "tests/pane-viewport-lifecycle.test.ts",
    "tests/workspace-render-items.test.ts",
    "tests/layout-engine-work.test.ts",
    "tests/pane-picture-activation.test.ts",
    "tests/overview-motion-registration.test.ts",
  ],
  browser: [
    "exec",
    "playwright",
    "test",
    "--config",
    "tests/browser/playwright.config.ts",
    "--project=chrome",
    "native-content.pw.ts",
    "pane-canvas.pw.ts",
    "fullscreen-content.pw.ts",
    "pane-native-cadence.pw.ts",
    "pane-video-presentation.pw.ts",
    "pane-defaults.pw.ts",
  ],
  video: [
    "exec",
    "playwright",
    "test",
    "--config",
    "tests/browser/playwright.config.ts",
    "--project=chrome",
    "--grep",
    "two videos keep live pixels",
    "pane-video-presentation.pw.ts",
  ],
  presentation: [
    "exec",
    "playwright",
    "test",
    "--config",
    "tests/browser/playwright.config.ts",
    "--project=chrome",
    "tests/browser/pane-canvas.pw.ts",
    "--grep",
    "presentation policies distinguish|texture policies freeze fresh|live motion adapts to graphics",
  ],
  cadence: [
    "exec",
    "playwright",
    "test",
    "--config",
    "tests/browser/playwright.config.ts",
    "--project=chrome",
    "tests/browser/pane-native-cadence.pw.ts",
    "--grep",
    "native live panes avoid",
  ],
  cpu: [
    "exec",
    "playwright",
    "test",
    "--config",
    "tests/browser/cpu.playwright.config.ts",
  ],
  navigation: [
    "exec",
    "playwright",
    "test",
    "--config",
    "tests/browser/playwright.config.ts",
    "one-dimensional-navigation.pw.ts",
    "two-dimensional-workspace.pw.ts",
    "--output",
    "tmp/navigation-playwright-results",
  ],
};
const mode = process.argv[2];
if (!Object.hasOwn(commands, mode) || process.argv.length !== 3) {
  throw new Error(
    "Choose the cache, pictures, contract, browser, video, presentation, cadence, cpu, navigation, pane-defaults, or unit suite.",
  );
}
runPnpm(["install", "--offline", "--frozen-lockfile", "--ignore-scripts"]);
if ((mode === "navigation" || mode === "cpu") && process.platform === "linux") {
  run(process.execPath, ["scripts/install-linux-chrome.mjs"]);
}
const result = runPnpm(commands[mode], { allowFailure: true });
process.exitCode = result.status ?? 1;
