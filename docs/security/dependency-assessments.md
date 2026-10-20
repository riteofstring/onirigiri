# Development dependency security assessments

Each assessment applies only to its exact package version, advisory and lockfile
scope in `.code-polishy.json`. Owners, review dates and expiry dates are recorded
per decision. Scanner findings remain visible. No fresh-release admission is used.

The source-map-js decision below was reviewed by Codex on 2026-10-10 and expires
on 2026-10-31.

## Dependency and input boundaries

The lock resolves `undici@7.29.1`, which fixes the September Undici advisories,
so no Undici assessment is needed.

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

## Remediation and reassessment

Retain the aged, unaffected version for this release. Reassess immediately if a
build adds a source-map consumer or the resolved version changes. This decision
does not cover consumer applications that independently use the vulnerable APIs.

Complete the next intentional dependency update by 2026-10-31: resolve
source-map-js to at least 1.2.2, remove the assessment that no longer matches, review
the complete candidate dependency graph, install frozen without scripts, and
verify the test/build consumers. Registry metadata records source-map-js 1.2.2
on 2026-09-30; it clears the 30-day admission window on 2026-10-30. No early
admission is justified when the affected path is absent. Expiry blocks continued
acceptance without completing the update or a new evidence-backed assessment.

## Vite 8.1.4 Windows editor launch

Reviewed 2026-10-20 by Codex; expires 2026-11-06. Accept the moderate development
risk temporarily because an aged fixed release is not yet available. This is
`risk-accepted` / `temporary-no-fix`, not a claim that all supported uses are
unaffected.

[GHSA-698v-4r3x-3vcv](https://github.com/vitejs/launch-editor/security/advisories/GHSA-698v-4r3x-3vcv)
affects the launch-editor 2.14.1 copy bundled inside Vite 8.1.4. In
`vite/dist/node/chunks/node.js`, the `/__open-in-editor` middleware reads the
request's `file` parameter, resolves it against the working directory, checks
that it exists and passes it to `launchEditor`. Absolute paths outside the
repository are accepted. On Windows, `escapeCmdArgs` omits percent-sign escaping
before a shell command is executed. A crafted existing filename combined with
environment expansion or NTFS stream behavior can execute commands as the
developer. The advisory also describes a filename using `%CD%`; absence of an
explicit attacker-supplied environment variable is not sufficient protection.

Both playground dev configurations, `preview-playground.mjs`,
`preview-retained-capture.mjs`, `two-dimensional-dev-server.ts`, the packed-consumer
development fixture and the surface-lab server test can start this middleware.
Their default listeners use localhost or 127.0.0.1, with Vite's normal Host
validation. These controls reduce network exposure but do not prevent a malicious
page from reaching a local development endpoint. In particular, a Windows
contributor who has an attacker-named file anywhere on disk remains exposed.

The npm package contains browser code and no Vite server. Release builds and the
GPU comparison run on Linux, where this function uses `spawn` without a shell.
The cadence fixture uses a production build and Vite preview, which does not
register the editor endpoint. Windows CI does briefly start a loopback dev server
in the surface-lab test; its checked-in fixture requests do not invoke this
endpoint. These narrower observations do not clear Windows interactive use.

Retain the exact version for this bounded interval. On Windows, use built
playground assets with `vite preview` when inspecting untrusted files, and stop
interactive Vite dev servers before doing so. No untrusted-file workflow should
rely on loopback or Host validation as authorization. Residual risk remains for
contributors who run a dev server with attacker-controlled files available.

[Registry metadata for Vite](https://registry.npmjs.org/vite) dates 8.1.6 to
2026-10-06T04:51:51.393Z; it reaches 30 days on 2026-11-05. No affected release
line has an aged fix as of this review. A launch-editor dependency override would
not replace Vite's bundled copy. Disabling the endpoint at every configuration
and inline server would add temporary code and remove editor integration.
The limited development exposure and available production-preview workflow do
not justify admitting a fresh toolchain release now. Keeping the dependency graph
fixed also preserves the controlled cadence comparison's historical inputs.

Update to Vite 8.1.6 by 2026-11-06, remove this assessment, review the candidate
dependency graph, install frozen without scripts and verify build and development
server behavior. Reassess sooner if listener exposure, Windows execution lanes,
file-input authority or the resolved Vite version changes. This assessment does
not cover other applications that independently run a Vite development server.
