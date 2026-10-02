# Development

Repository layout, sibling checkouts and repository commands.

## Sibling checkouts

The interactive one- and two-dimensional demo playground lives in the separate
[onirigiri-playground](https://github.com/riteofstring/onirigiri-playground)
repository. Its lab panes come from
[browser-surface-lab](https://github.com/riteofstring/browser-surface-lab).
Place both checkouts beside this one:

```text
onirigiri/
onirigiri-playground/
browser-surface-lab/
```

```sh
git clone https://github.com/riteofstring/onirigiri-playground.git ../onirigiri-playground
pnpm --dir ../onirigiri-playground install --frozen-lockfile --ignore-scripts
```

The playground resolves `@riteofstring/onirigiri` to this checkout's `src/`, so
`pnpm --dir ../onirigiri-playground dev:2d` shows local library changes without
a package build. See its README for the playground's own commands and tests.

Library unit tests, the package build and the performance harness need only
this repository. The browser suites under `tests/browser/` that use
`playwright.config.ts`, and the CPU checks that open the 2D playground, drive
the library through the playground and require the installed sibling checkout.
Without it they stop with a message naming the missing directory.
These tests reach the playground only through its development servers and
fixture pages (`/fixture.html`), never through source imports.

## Retained-capture preview

`tests/browser/retained-capture.html` is the library-owned retained-picture
harness used by the Chrome capture contract. To open it in Chrome with
HTML-in-Canvas enabled:

```sh
node scripts/preview-retained-capture.mjs
```

The launcher opens port 5197. Other tabs can open the same URL and use the same
engine, provided their browser has the required feature enabled.

## Performance harness

`bench/` contains the production performance fixture used by
`pnpm test:performance`; `pnpm build:performance` builds it.

## Package boundary

Onirigiri has no backend, Electron, chat, settings, speech, account, or application-shell dependency.
React and React DOM are peer dependencies.

## Commands

```sh
pnpm install --frozen-lockfile --ignore-scripts
code-polishy check --all
code-polishy test --changed
pnpm test
pnpm test:browser
pnpm typecheck
pnpm build
code-polishy supply-chain
pnpm consumer:check
```

The browser smoke suite runs in headless Chrome and starts
the sibling playground's 1D and 2D development servers only for the duration of
the check. It covers native scrolling, mouse and keyboard workflows, overview
interaction, reduced motion, an effective 200% CSS viewport, and the compact
layout.

All automated browser tests, including the performance suite, run in headless Google Chrome. Its required matrix includes 3840×2160
navigation with 50 panes and a 3840×2160 overview stress workload with 500 panes, with a 60Hz
display-cadence floor and 120Hz CPU-work budget.

See [`docs/quality-and-supply-chain-tooling.md`](../quality-and-supply-chain-tooling.md) for the
locked quality, architecture, test, dependency, vulnerability, license, and release-age gates.

## Releasing

Set the new `version` in `package.json`, commit, and push an annotated
`vMAJOR.MINOR.PATCH` tag that matches it. `.github/workflows/release.yml` runs in
the `npm` GitHub environment, verifies the tag, typechecks, runs the unit tests,
builds, and publishes `@riteofstring/onirigiri` through npm trusted publishing,
which adds provenance while the repository is public. Browser suites need a real GPU and run before tagging, not in
that workflow.
