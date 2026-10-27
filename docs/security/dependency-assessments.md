# Development dependency security assessments

Each assessment applies only to its exact package version, advisory and lockfile
scope in `.code-polishy.json`. Owners, review dates and expiry dates are recorded
per decision. Scanner findings remain visible. No fresh-release admission is used.

The source-map-js decision below was reviewed by Codex on 2026-10-10 and expires
on 2026-10-31.

## Dependency and input boundaries

The lock resolves `undici@7.29.1`. It fixes the September advisories but needs
three separate October assessments, recorded below.

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

## Vite 8.1.4 development editor endpoint

Reviewed 2026-10-20 by Codex; expires 2026-11-06. The pinned Vite release
contains launch-editor 2.14.1 and remains affected by three upstream advisories:

- [GHSA-698v-4r3x-3vcv](https://github.com/vitejs/launch-editor/security/advisories/GHSA-698v-4r3x-3vcv):
  Windows command construction fails to escape percent expansion.
- [GHSA-587h-7wmj-h5pm](https://github.com/vitejs/launch-editor/security/advisories/GHSA-587h-7wmj-h5pm):
  Windows path normalization bypasses the file-existence check. A supplied path
  ending in `\..:1:1` survives middleware resolution until the position suffix is
  removed. The resulting parent-directory path can pass `existsSync` without the
  preceding component existing. Combined with percent expansion, this permits
  command injection without an attacker-created file.
- [GHSA-r825-w8mm-5pxw](https://github.com/vitejs/launch-editor/security/advisories/GHSA-r825-w8mm-5pxw):
  WSL converts absolute `/mnt/` paths back to relative paths. An existing filename
  beginning with `+` or `-` can become a command-line option for affected editors.

The resolved caller is Vite's `/__open-in-editor` middleware. It takes the HTTP
`file` query parameter, resolves a path and calls the bundled launcher. The
launcher removes the position suffix, checks existence, guesses an editor and
constructs a process invocation. Windows uses a shell; WSL may change the path
passed to an editor. Absolute paths outside the repository are accepted.
Loopback listeners and Host validation do not authorize requests from local
pages, and file existence is not a reliable Windows security boundary.

Every repository-owned Vite development HTTP server installs
`scripts/disable-dev-editor.mjs`. Its early `configureServer` hook mounts an
unconditional 404 response at the editor route, using Connect's own matching.
It also mounts the raw configured base prefix, before Vite strips that prefix.
Both mounts remain present in middleware mode. This covers case variants,
trailing path segments and dot suffixes without parsing or forwarding `file`.
The response ends without calling the downstream editor middleware.

The root, benchmark and both playground Vite configurations install
the plugin. The playground preview, retained-capture preview, packed-consumer
development fixture and surface-lab server test install it in their inline
configurations. The two-dimensional browser test server inherits its playground
configuration. Vitest's remaining internal middleware servers have no HTTP
listener. The cadence configuration is used only for a production build and
preview. The built npm package has no Vite server, and production preview
never mounts the editor endpoint.

The high finding is `not-affected` / `unreachable` for these owned entry points:
no untrusted HTTP input can reach the vulnerable launcher. The two moderate
findings retain explicit `risk-accepted` / `mitigated` assessments while the
bundled dependency remains present. These decisions do not clear arbitrary Vite
servers created by consumers or configurations that omit the plugin. New server
entry points require the same mitigation until the dependency update.

HTTP tests start the actual Vite configurations with temporary page and module
files. They verify editor-route rejection at root, nested and percent-encoded
bases, normal HTML injection and module transformation, and the hot-reload ping.
The tests establish that the endpoint is unavailable; they do not establish
that Windows path parsing or the bundled launcher itself is safe. Production
rendering, motion and styling are unchanged. The development error overlay no
longer opens an editor when its source-file link is clicked.

[Registry metadata for Vite](https://registry.npmjs.org/vite) dates 8.1.6 to
2026-10-06T04:51:51.393Z; it reaches 30 days on 2026-11-05. No affected release
line has an aged fix as of this review. A launch-editor dependency override
cannot replace Vite's bundled copy. Disabling the unused HTTP endpoint removes
the reachable input with a small development-only change; admitting a younger
bundler would replace substantially more code while the release is being
verified. Keep the exact toolchain with this mitigation through the bounded
admission window.

Update to Vite 8.1.6 by 2026-11-06, remove these assessments, review the complete
dependency graph, install frozen without scripts and verify build and development
server behavior. Reassess sooner if an HTTP server bypasses the plugin, middleware
ordering changes, an editor caller is introduced or Vite changes. All findings
remain visible in dependency-review output.

## October beta toolchain review

Reviewed 2026-10-27 by Codex; these seven exact assessments expire 2026-11-06.
They cover the checked-in configurations and resolved sources below, not arbitrary
consumer servers or Node's independently bundled Undici. No dependency changes,
release-age admissions or lifecycle-script execution are needed.

### Undici 7.29.1

The installed jsdom 29.1.1 imports `getGlobalDispatcher`, `Dispatcher`, handler
adapters, `DecoratorHandler` and `WebSocket`. Its resource loader implements its
own dispatch and decompression in
`lib/jsdom/browser/resources/jsdom-dispatcher.js` and
`decompress-interceptor.js`. It does not call Undici's `fetch`, `EventSource` or
`interceptors.decompress`. Repository source has no direct Undici import.
Unit tests construct local DOM and controlled fixtures, not an uploaded HTML
service. Node HTTP checks use built-in fetch; browser fixture requests run in
Chrome. Those implementations are separate from this installed package.

- [GHSA-f72v-6w45-q472](https://github.com/nodejs/undici/security/advisories/GHSA-f72v-6w45-q472):
  the fetch SRI verifier mishandles mixed-case algorithm names. No enabled caller
  uses that verifier or makes an integrity decision with it. Outcome: not affected.
- [GHSA-4qv8-2p9j-2685](https://github.com/nodejs/undici/security/advisories/GHSA-4qv8-2p9j-2685):
  malicious SSE response framing can exhaust EventSource parser memory. Neither
  jsdom nor repository code creates that client. Outcome: not affected.
- [GHSA-xjj6-f33q-929c](https://github.com/nodejs/undici/security/advisories/GHSA-xjj6-f33q-929c):
  excessive content encodings can cause an unhandled decompression error. The
  installed fetch and decompression interceptor contain the affected handling;
  jsdom uses its own interceptor, and no repository caller installs Undici's.
  No response header reaches that sink in the installed package. Outcome: not affected.

Reassess before adding an Undici fetch, EventSource or decompression caller,
changing jsdom, or accepting remote documents. Plan an intentional update to
Undici 7.30.1 or later after its exact release clears the 30-day admission window;
verify registry release age during that update. The absent vulnerable paths do
not justify admitting fresh networking code during beta verification. Complete
the update or renew the analysis with current evidence before November 6.

### Vitest mocker 4.1.11

The resolved `@vitest/mocker/dist/node.js` registers
`vitest:interceptor:register` in `interceptorPlugin.configureServer`. Its redirect
branch joins a URL pathname and later reads the registered file; its manual
branch generates module source from the registered URL. These are network-facing
browser mocking features, distinct from node/jsdom `vi.mock` execution.

- [GHSA-xp26-3454-mjgp](https://github.com/vitest-dev/vitest/security/advisories/GHSA-xp26-3454-mjgp):
  a Windows backslash in a redirect can bypass the path allowlist and disclose
  an outside file.
- [GHSA-qxg6-89mg-rqv8](https://github.com/vitest-dev/vitest/security/advisories/GHSA-qxg6-89mg-rqv8):
  a manual mock URL can inject JavaScript into a served module.

Both are not affected here: root, playground and compiler projects use node or
jsdom; no Vitest browser pool, direct `mockerPlugin` or `interceptorPlugin` is
configured. Internal Vitest Vite servers use middleware mode without an HTTP
listener; Playwright uses separate Vite applications without mocker plugins.
There is no untrusted WebSocket registration path to either sink. This reasoning
also applies on Windows; it does not rely on the local assessor running Linux.
Reassess before enabling browser mocking or exposing Vitest API/UI servers.
Plan a verified Vitest/mocker 4.1.12 update once eligible, by November 6, or renew
with current source evidence. Retaining unused vulnerable APIs is lower risk
than changing the test toolchain during this release; it grants no fresh admission.

### Vite 8.1.4: additional HTTP advisories

- [GHSA-rq7h-c2jc-7f22](https://github.com/vitejs/vite/security/advisories/GHSA-rq7h-c2jc-7f22):
  import analysis can add a root-relative URL to `safeModulePaths` as an absolute
  host path. Raw-filesystem middleware then accepts that path before checking
  `server.fs.allow`. The exploit requires an imported project file whose URL
  also names a readable host file outside the allowed roots. Owned imports use
  source, playground, test, fixture and dependency paths; none supplies the
  system-path collision. Playground aliases use absolute library source paths
  with explicit allowed roots. The surface-lab middleware serves a production
  build, not development import analysis. Outcome: not affected for this import
  inventory. This is not a claim that loopback or the allowlist fixes Vite.
- [GHSA-9jrq-w75r-8gcw](https://github.com/vitejs/vite/security/advisories/GHSA-9jrq-w75r-8gcw):
  custom middleware passing an unchanged request URL to `transformIndexHtml`
  can generate an attacker-origin module URL. No repository caller uses that
  API. Development servers use normal SPA HTML handling; surface-lab delegates
  to production MPA preview. No custom request-to-HTML transform reaches the
  sink. Outcome: not affected.

Resolved evidence is Vite's bundled `dist/node/chunks` import-analysis,
raw-filesystem and HTML-transform implementations, `vite.config.ts`, benchmark
and playground configs, `playground/library-source.ts`,
`playground/scripts/surface-lab-server.mjs`, preview launchers and packed-consumer
server configuration. Reassess when imports, host paths, server entry points or
custom HTML transforms change. The existing Vite 8.1.6 update deadline remains
November 6; its documented November 5 eligibility covers these fixes too.

The earlier source-map-js assessment still expires October 31; the editor-route
assessments still expire November 6. These additions extend neither deadline.
Scanner findings remain visible even when the exact assessments are accepted.
