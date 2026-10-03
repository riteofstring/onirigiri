# Development

Repository layout, the demo playground and repository commands.

## Demo playground

The interactive one- and two-dimensional demo playground lives in
[`playground/`](https://github.com/riteofstring/onirigiri/tree/main/playground)
and shares this repository's dependencies. Its lab panes come from
[browser-surface-lab](https://github.com/riteofstring/browser-surface-lab),
placed beside this checkout:

```text
onirigiri/
browser-surface-lab/
```

The playground resolves `@riteofstring/onirigiri` to `src/`, so `pnpm dev:1d`
and `pnpm dev:2d` show library changes without a package build. `pnpm test`
includes the playground's Vitest project, and `pnpm build:playground` builds
both apps. See its README for the remaining playground commands.

The browser suites under `tests/browser/` that use `playwright.config.ts`, and
the CPU checks that open the 2D playground, drive the library through the
playground's development servers and fixture pages (`/fixture.html`), never
through source imports.

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

## Continuous integration

`.github/workflows/ci.yml` typechecks, runs the unit tests and builds the package
on Linux and Windows for every push to `main` and every pull request. Hosted
runners have no hardware WebGPU, so browser suites and `pnpm consumer:check` run
on real GPUs before release.

## Releasing

Set the new `version` in `package.json`, commit, and push an annotated
`vMAJOR.MINOR.PATCH` tag that matches it. `.github/workflows/release.yml` runs in
the `npm` GitHub environment, verifies the tag, typechecks, runs the unit tests,
builds, and publishes `@riteofstring/onirigiri` through npm trusted publishing,
which adds provenance while the repository is public. Browser suites need a real
GPU and run before tagging, not in that workflow.

npm trusted publishing can only be configured for a package that already exists.
Publish the first version by hand (`pnpm build`, then `npm publish --access public`),
then add the `riteofstring/onirigiri` repository, `release.yml` workflow and `npm`
environment as the package's trusted publisher on npmjs.com.
