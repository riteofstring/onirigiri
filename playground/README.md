# Onirigiri playground

Interactive one- and two-dimensional demos for Onirigiri, the React window system
for spatially arranged panes. Both apps import `@riteofstring/onirigiri` and its
stylesheet exactly as a downstream React application would.

## Setup

Run these from `playground/` after installing the library at the repository
root; lab panes need a `browser-surface-lab` checkout beside `onirigiri/`:

```text
onirigiri/              https://github.com/riteofstring/onirigiri
  playground/           this package
browser-surface-lab/    https://github.com/riteofstring/browser-surface-lab
```

```sh
pnpm --dir .. install --frozen-lockfile --ignore-scripts
pnpm install --frozen-lockfile --ignore-scripts
```

`library-source.ts` (used by both Vite configs and Vitest) and the `paths` in
`tsconfig.json` resolve `@riteofstring/onirigiri` to `../src`, so library edits
show up without a package build. React is deduplicated to this package's copy.

Lab panes come from the `browser-surface-lab` checkout, which the
development and preview servers build and serve under `/surface-lab/`. Without
it, lab panes receive an explicit 503 response and the other demos work
normally.

## Run

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
pnpm typecheck      # apps, shared UI, tests and the Onirigiri source they use
pnpm test           # Vitest suites and the lab-hosting contract
pnpm build          # production builds of both apps
pnpm test:browser   # Playwright: arcade and production overview cadence
pnpm test:content   # Playwright: content menus, spawn sizes, themes
```

Browser checks run in headless Chrome (on Linux, the pinned headless shell from
`scripts/install-linux-chrome.mjs`) and require a hardware WebGPU adapter. The
production overview check also requires the `browser-surface-lab` checkout.

See [`docs/playground-content.md`](docs/playground-content.md) for the design of
the content catalog, theming, arcade and lab hosting.

## License

Licensed under the [Apache License 2.0](../LICENSE).
