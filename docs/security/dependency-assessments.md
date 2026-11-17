# Development dependency security assessments

Each assessment applies only to its exact package version, advisory and lockfile
scope in `.code-polishy.json`. Owners, review dates and expiry dates are recorded
per decision. Scanner findings remain visible. No fresh-release admission is used.

The source-map-js decision below was re-reviewed by Claude on 2026-11-03 and
expires on 2026-12-03. The picomatch decision was made by Claude on 2026-11-17 and
expires on 2026-12-17.

## Dependency and input boundaries

The lock resolves `undici@7.30.1`, which fixes the September and October
advisories. No Undici assessment remains.

`source-map-js@1.2.1` is reached through `postcss@8.5.23` in Vite and through
`css-tree@3.2.1` in jsdom. The vulnerable loop is in
`source-map-js/lib/source-node.js`, `SourceNode.fromStringWithSourceMap`, where
`lastGeneratedLine` advances toward a mapping's potentially enormous line.
PostCSS's `lib/previous-map.js` and `lib/map-generator.js` consume maps through
`SourceMapConsumer` and `SourceMapGenerator`; neither calls that SourceNode API.
css-tree's `lib/generator/sourceMap.js` imports only `SourceMapGenerator`.
Repository code also has no SourceNode call. Build inputs and maps come from
checked-in source and the locked toolchain; no network service accepts uploaded
source maps. The absence of the vulnerable API is the primary applicability
reason, rather than the package merely being a development dependency.

## Advisory-specific decisions

| Advisory                                                                 | Package               | Absent prerequisite and impact                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------------------------------------------------ | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [GHSA-68fv-2mgg-jv7q](https://github.com/advisories/GHSA-68fv-2mgg-jv7q) | `source-map-js@1.2.1` | The resolved callers are PostCSS and css-tree. PostCSS uses SourceMapConsumer and SourceMapGenerator; css-tree imports only SourceMapGenerator. Neither calls SourceNode.fromStringWithSourceMap, whose generated-line loop is the reported denial-of-service sink. No enabled caller reaches the unbounded SourceNode loop; build maps also originate in checked-in sources and locked tools, not uploaded or remotely supplied maps. |
| [GHSA-fc5q-39xc-vjpf](https://github.com/advisories/GHSA-fc5q-39xc-vjpf) | `picomatch@4.0.5`     | The backtracking needs a crafted glob pattern: a repeated extglob with a single branch. picomatch is resolved only through Vite, Vitest, tinyglobby and fdir, whose patterns here come from checked-in configuration and contain no extglob. No network service, test or script passes an externally supplied pattern, and the published package does not include picomatch.                                                           |

## Remediation and reassessment

Retain the aged, unaffected version for this release. Reassess immediately if a
build adds a source-map consumer or the resolved version changes. This decision
does not cover consumer applications that independently use the vulnerable APIs.

Complete the next intentional dependency update by 2026-12-03: resolve
source-map-js to at least 1.2.2, remove the assessment that no longer matches, review
the complete candidate dependency graph, install frozen without scripts, and
verify the test/build consumers. Registry metadata records source-map-js 1.2.2
on 2026-09-30; it clears the 30-day admission window on 2026-10-30. No early
admission is justified when the affected path is absent. Expiry blocks continued
acceptance without completing the update or a new evidence-backed assessment.

## Vite 8.1.6 development editor endpoint

Vite 8.1.6 fixes the five advisories previously assessed against 8.1.4:
GHSA-698v-4r3x-3vcv, GHSA-587h-7wmj-h5pm and GHSA-r825-w8mm-5pxw in the bundled
launch-editor, plus GHSA-rq7h-c2jc-7f22 and GHSA-9jrq-w75r-8gcw. Registry
metadata dates 8.1.6 to 2026-10-06T04:51:51.393Z, so it cleared the 30-day
admission window on 2026-11-05 without a release-age assessment. Its runtime
dependency set is unchanged from 8.1.4 apart from raised lower bounds that the
locked postcss and rolldown releases already satisfy. The lock change is limited
to Vite and the Vitest and mocker snapshots that name it. No Vite assessment
remains.

Every repository-owned Vite development HTTP server still installs
`scripts/disable-dev-editor.mjs`. Its early `configureServer` hook mounts an
unconditional 404 response at the editor route and at the raw configured base
prefix, so the development error overlay does not open an editor. HTTP tests in
`tests/dev-editor-endpoint.test.ts` verify the rejection at root, nested and
percent-encoded bases alongside normal HTML, module and hot-reload responses.

## November toolchain update

On 2026-11-17 the lock moved to Undici 7.30.1 and to Vitest and its mocker
4.1.12. Undici 7.30.1 fixes the eight October advisories, and mocker 4.1.12 fixes
GHSA-xp26-3454-mjgp and GHSA-qxg6-89mg-rqv8. Both releases are older than the
30-day admission window, so no release-age assessment was needed. The ten
assessments that covered the earlier versions are removed. The lock change is
limited to Undici, Vitest and the Vitest packages released with it.

Undici is still reached only through the development dependency jsdom 29.1.1.
Reassess before adding an Undici import, a jsdom `resources` option, or a jsdom
`XMLHttpRequest`, `WebSocket` or `EventSource` caller.

## picomatch 4.0.5

[GHSA-fc5q-39xc-vjpf](https://github.com/advisories/GHSA-fc5q-39xc-vjpf) reports
exponential backtracking when picomatch compiles a repeated extglob with a single
branch, such as `+(\*a)`, and matches it against a short crafted string. The
advisory covers 4.0.7 and earlier and lists no fixed version.

`pnpm why picomatch` shows it only under the development tools Vite 8.1.6 and
Vitest 4.1.12, directly and through tinyglobby 0.2.17 and fdir 6.5.0. Repository
source, tests and scripts do not import picomatch, tinyglobby or fdir. The
patterns these tools receive from this repository are the `include`, `exclude`
and `testMatch` entries in the checked-in Vite, Vitest and Playwright
configurations: file paths, `*`, `**` and brace lists, with no extglob. No
network service, test or script passes an externally supplied pattern to them.
The published package depends only on zustand.

Outcome: not affected. Reassess before a build or test step takes a glob
pattern from outside the repository, and update when a fixed picomatch release
clears the admission window.

The source-map-js assessment keeps its own expiry. Scanner findings remain
visible even when the exact assessments are accepted.
