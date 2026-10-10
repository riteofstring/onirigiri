# Quality and supply-chain tooling

Onirigiri is governed by the exact [Code Polishy](https://github.com/riteofstring/code-polishy)
release named in `.code-polishy.lock.json`. Run it through `./code-polishyw` (PowerShell:
`.\code-polishyw.ps1`); `./code-polishyw setup` installs the locked release after verifying its
digest. The release owns formatting, linting, TypeScript analysis, dead-code and complexity checks,
architecture enforcement, pnpm lock validation, dependency licensing, and vulnerability scanning.
`.code-polishy.json` contains only Onirigiri-specific architecture, build, test, package-contract,
and supply-chain facts.

Install target dependencies without lifecycle scripts before running policy checks:

```sh
pnpm install --frozen-lockfile --ignore-scripts
```

## Commands

| Command                                                | Purpose                                                                                                                       |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| `./code-polishyw doctor --strict`                      | Validate the lock, configuration, ownership, tool coverage, managed guidance, and installed dependency metadata.              |
| `./code-polishyw check --git-changes`                  | Run deterministic quality and architecture checks for current changes.                                                        |
| `./code-polishyw check --all`                          | Run deterministic quality and architecture checks over the repository.                                                        |
| `./code-polishyw format --git-changes`                 | Apply the locked formatter to current changes.                                                                                |
| `./code-polishyw test --changed`                       | Run the focused suites selected for current changes.                                                                          |
| `./code-polishyw test-levels --base origin/main`       | Show the recommended and full ordinary pre-merge choices without running them.                                                |
| `./code-polishyw supply-chain --offline`               | Validate pinned dependencies, lock consistency, lifecycle policy, sources, installed licenses, and offline advisory evidence. |
| `./code-polishyw supply-chain`                         | Add online native audit, OSV, and release-age checks.                                                                         |
| `./code-polishyw dependency-review --base origin/main` | Review an intentional manifest or lockfile change before installation.                                                        |
| `./code-polishyw gate`                                 | Run the complete ordinary gate after broader execution is authorized.                                                         |
| `pnpm consumer:check`                                  | Pack Onirigiri, install it into an unrelated temporary React app, and build against public exports only.                      |
| `pnpm test`                                            | Run unit and component behavior.                                                                                              |
| `pnpm test:browser`                                    | Run real interaction workflows in the installed Google Chrome channel.                                                        |
| `pnpm build`                                           | Build the library package and check the built package boundary.                                                               |

## Project-specific evidence

`scripts/check-package-boundary.mjs` remains local because it validates Onirigiri's public package
exports, consumer import boundary, built JavaScript imports, and scoped CSS contract. The production
build and packed-consumer test also remain local because their artifact and downstream-consumer
semantics are specific to this library.

The repository pins pnpm and its Node toolchain. `pnpm-workspace.yaml` enforces exact saves, strict
peers, the shared minimum release age, no trust downgrade, no exotic transitive sources, and an
empty lifecycle-build allowlist. Allowed dependency licenses, exact temporary release-age
assessments, and any future reviewed exceptions live in `.code-polishy.json` as the single policy
authority.

### Development dependency review, October 10, 2026

The compiler regression uses the official `@babel/standalone@7.29.7` build and
`babel-plugin-react-compiler@1.0.0`, both development dependencies. This keeps
the harness self-contained and limits its additional dependency graph to the
compiler's Babel types and two type helpers. It transforms only pane content
in a separate test project; neither compiler is added to the runtime package.

The existing jsdom dependency now resolves the aged security release
`undici@7.29.1`, published September 4, 2026, within jsdom's existing range.
This removes the September WebSocket, interceptor and BalancedPool advisories
without changing jsdom or introducing an override.

`source-map-js@1.2.1` remains temporarily assessed as not affected by
[GHSA-68fv-2mgg-jv7q](https://github.com/advisories/GHSA-68fv-2mgg-jv7q).
The advisory requires an attacker-controlled indexed source map with an
extremely large section offset. The lock has two callers: PostCSS 8.5.23 and
css-tree 3.2.1. css-tree's `lib/generator/sourceMap.js` imports only
`SourceMapGenerator`, so it never consumes indexed maps. PostCSS's
`lib/previous-map.js` and `lib/map-generator.js` do construct
`SourceMapConsumer`, but their inputs come from repository CSS and local build
outputs. No repository CSS contains `sourceMappingURL`, no build API accepts
application-supplied maps, and user pane contents are not compiled by PostCSS.
The library's runtime dependency is Zustand; this source-map package is confined
to development tooling. Opening or building unreviewed source is outside this
assessment's trust boundary.

The fixed `source-map-js@1.2.2` was published September 30 and has not yet met
the 30-day admission requirement. Retaining the current version does not
expose the affected input path; admitting the younger release is unnecessary.
Owner: Codex. Reassess and update the transitive resolution after October 30,
or immediately if a build begins consuming untrusted maps. The exact assessment
in `.code-polishy.json` expires November 9, 2026 and does not suppress other
versions or advisories.

The scheduled dependency-security workflow runs on a GitHub-hosted Linux runner. It installs Node
25.2.1 and pnpm 10.23.0, then `./code-polishyw setup` installs the exact Code Polishy release named by
`.code-polishy.lock.json` and verifies its digest before the online scan.
