# Onirigiri playground

Interactive one- and two-dimensional demos for Onirigiri, the React window system
for spatially arranged panes. Both apps import `@riteofstring/onirigiri` and its
stylesheet exactly as a downstream React application would.

## Setup

The playground shares the repository's root install. Lab panes need a
`browser-surface-lab` checkout beside `onirigiri/`:

```text
onirigiri/              https://github.com/riteofstring/onirigiri
  playground/           this directory
browser-surface-lab/    https://github.com/riteofstring/browser-surface-lab
```

```sh
pnpm install --frozen-lockfile --ignore-scripts
```

`library-source.ts` (used by both Vite configs and Vitest) and the `paths` in
`tsconfig.json` resolve `@riteofstring/onirigiri` to `../src`, so library edits
show up without a package build.

Lab panes come from the `browser-surface-lab` checkout, which the
development and preview servers build and serve under `/surface-lab/`. Without
it, lab panes receive an explicit 503 response and the other demos work
normally.

## Run

Run commands from the repository root.

```sh
pnpm dev:1d   # http://127.0.0.1:5173, 10 panes on one row
pnpm dev:2d   # http://127.0.0.1:5174, 100 panes on a sparse grid
```

**Content** offers a checklist of demo and lab content types; apply the
selection to build a fresh workspace. **Spawn panes** starts a fresh 5, 10, 50
or 100 pane workspace using that selection. URLs accept `count`, `content`,
`cache` and `textureMemory` parameters. The 1D mode persists its layout locally;
the 2D mode adds plane controls and layout undo/redo. Desktop and Mobile preview
buttons exercise the responsive engine without resizing the browser.

Each app also serves `/fixture.html`, a fixed asymmetric scene that Onirigiri's
own browser tests drive. Keep its pane ids and labels stable.

To open an example in Chrome with HTML-in-Canvas enabled (requires a hardware
WebGPU adapter):

```sh
node scripts/install-linux-chrome.mjs   # Linux only, once
pnpm preview:chrome one-dimensional
pnpm preview:chrome two-dimensional
```

## Commands

```sh
pnpm typecheck          # includes the apps, shared UI and playground tests
pnpm test               # includes the playground Vitest project and lab-hosting contract
pnpm build:playground   # production builds of both apps
pnpm test:browser       # includes the arcade and production overview cadence checks
pnpm test:content       # content menus, spawn sizes, themes
```

Browser checks run in headless Chrome (on Linux, the pinned headless shell from
`scripts/install-linux-chrome.mjs`) and require a hardware WebGPU adapter. The
production overview check also requires the `browser-surface-lab` checkout. The
arcade and overview cadence checks live in `tests/browser/` with the library's
other browser suites.

See [`docs/playground-content.md`](docs/playground-content.md) for the design of
the content catalog, theming, arcade and lab hosting.

## License

Licensed under the [Apache License 2.0](../LICENSE).
