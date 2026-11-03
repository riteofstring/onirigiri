# Onirigiri playground

Interactive one- and two-dimensional demos for Onirigiri, the React window system
for spatially arranged panes. Both apps import `@riteofstring/onirigiri` and its
stylesheet exactly as a downstream React application would.

## Setup

The playground shares the repository's root install and works without any
sibling checkout:

```sh
pnpm install --frozen-lockfile --ignore-scripts
```

`library-source.ts` (used by both Vite configs and Vitest) and the `paths` in
`tsconfig.json` resolve `@riteofstring/onirigiri` to `../src`, so library edits
show up without a package build.

Lab content is optional and excluded from the default workspace and content
menu. To enable it, open the playground with `?lab=1`. For the local lab host,
place [browser-surface-lab](https://github.com/riteofstring/browser-surface-lab)
beside this checkout. Development and Vite preview servers then build its
fixture on demand and serve it under `/surface-lab/`. An enabled lab without
that checkout receives a 503 response.

## Static build and deployment

Run from the repository root:

```sh
pnpm build:playground
```

The standalone outputs are `playground/one-dimensional/dist/` and
`playground/two-dimensional/dist/`. Upload each directory's contents to its
own static hosting directory, for example `/examples/1d/` and `/examples/2d/`.
Serve over HTTP or HTTPS with the trailing slash; both builds use relative
asset URLs and work below a subdirectory. No Node server, rewrite rules, lab
checkout or backend is required. Only `index.html` is a production entry;
`fixture.html` is a development test harness.

For a local production preview:

```sh
pnpm exec vite preview --config playground/one-dimensional/vite.config.ts --host 127.0.0.1 --port 4173
pnpm exec vite preview --config playground/two-dimensional/vite.config.ts --host 127.0.0.1 --port 4174
```

Static hosting does not include the optional lab fixture or its assets. To use
labs on a deployed site, host the lab separately and opt in with
`?lab=1&fixtureOrigin=https://your-lab-host.example&fixturePath=/fixture.html`.
Its host must permit embedding. Cross-origin lab content stays native; retained
pixel capture requires same-origin hosting.

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
