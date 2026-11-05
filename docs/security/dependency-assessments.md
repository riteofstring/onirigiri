# Development dependency security assessments

Each assessment applies only to its exact package version, advisory and lockfile
scope in `.code-polishy.json`. Owners, review dates and expiry dates are recorded
per decision. Scanner findings remain visible. No fresh-release admission is used.

The source-map-js decision below was reviewed by Codex on 2026-10-10 and expires
on 2026-10-31.

## Dependency and input boundaries

The lock resolves `undici@7.29.1`. It fixes the September advisories; its eight
October advisories are assessed under the November toolchain review below.

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

## November toolchain review

Reviewed 2026-11-05 by Claude; these ten exact assessments expire 2026-11-21.
They cover the checked-in configurations and resolved sources below, not arbitrary
consumer servers or Node's independently bundled Undici. No release-age
admissions or lifecycle-script execution are used.

### Undici 7.29.1

`pnpm why undici` shows one path: the development dependency jsdom 29.1.1, also
loaded as Vitest's jsdom environment peer. Repository source, tests, scripts and
configurations do not import Undici. The installed jsdom imports only
`getGlobalDispatcher`, `Dispatcher`, the wrap and unwrap handler adapters,
`DecoratorHandler` and `WebSocket`. Its `JSDOMDispatcher` follows redirects and
decompresses responses itself (`lib/jsdom/browser/resources/jsdom-dispatcher.js`
and `decompress-interceptor.js`) on top of the default global `Agent`, which
Undici's `lib/global.js` constructs without options. jsdom does not call
Undici's `fetch`, `EventSource`, `interceptors`, `compose` or cache stores.

The Vitest jsdom projects (root `jsdom` project, playground and compiler) set no
`environmentOptions`, so jsdom receives `resources: undefined` and loads no
subresources; the iframe `https://fixture.example` URLs in tests are never
requested. No jsdom test or library source creates `XMLHttpRequest` or
`WebSocket`. Undici's global dispatcher symbol is shared with Node's built-in
fetch, so a fetch in a process that loaded jsdom can use the installed `Agent`.
The only Vitest fetches are in `tests/dev-editor-endpoint.test.ts`, a node
environment file, and target plaintext `http://127.0.0.1` Vite servers that the
same test starts. Browser fixture requests run in Chrome, and Playwright uses
its own HTTP client.

- [GHSA-f72v-6w45-q472](https://github.com/nodejs/undici/security/advisories/GHSA-f72v-6w45-q472):
  the fetch SRI verifier mishandles mixed-case algorithm names. No enabled caller
  uses that verifier or makes an integrity decision with it. Outcome: not affected.
- [GHSA-4qv8-2p9j-2685](https://github.com/nodejs/undici/security/advisories/GHSA-4qv8-2p9j-2685):
  malicious SSE response framing can exhaust EventSource parser memory. Neither
  jsdom nor repository code creates that client. Outcome: not affected.
- [GHSA-xjj6-f33q-929c](https://github.com/nodejs/undici/security/advisories/GHSA-xjj6-f33q-929c):
  excessive content encodings can cause an unhandled decompression error in
  Undici's fetch and decompression interceptor. jsdom uses its own interceptor,
  and no repository caller installs Undici's. Outcome: not affected.
- [GHSA-2m5v-pch6-74hx](https://github.com/nodejs/undici/security/advisories/GHSA-2m5v-pch6-74hx):
  `Agent` drops function-valued `tls` options such as `checkServerIdentity`
  during a JSON clone. The only `Agent` is the option-less global default, so no
  custom verification callback exists; Node's default chain and hostname checks
  are unchanged. Outcome: not affected.
- [GHSA-qrxm-fqhp-jwvm](https://github.com/nodejs/undici/security/advisories/GHSA-qrxm-fqhp-jwvm):
  a TLS 1.2 server renegotiating with a mismatched certificate triggers an
  uncaught assertion. It needs the installed client connected to a hostile
  HTTPS endpoint. The traced callers make no HTTPS request through it; the only
  shared-dispatcher fetches use plaintext loopback. Outcome: not affected.
- [GHSA-4w7w-5xrc-9h26](https://github.com/nodejs/undici/security/advisories/GHSA-4w7w-5xrc-9h26):
  `compose(redirect(), cache())` with a shared cache store keys cross-origin
  redirect responses under the original URL. No caller uses the cache
  interceptor, a cache store or `compose`. Outcome: not affected.
- [GHSA-55wc-3pg8-jfw6](https://github.com/nodejs/undici/security/advisories/GHSA-55wc-3pg8-jfw6):
  the `decompress` interceptor lets an asynchronous throw from a downstream
  handler such as `dump` escape. jsdom's own `DecoratorHandler`-based
  interceptor replaces it, and no caller composes Undici interceptors.
  Outcome: not affected.
- [GHSA-9fm3-97px-rjf6](https://github.com/nodejs/undici/security/advisories/GHSA-9fm3-97px-rjf6):
  the WebSocket client buffers automatic PONG replies without backpressure. The
  installed client is reachable only through jsdom's `window.WebSocket`, which no
  test or library source constructs. Node's bundled `globalThis.WebSocket` is a
  separate copy. Outcome: not affected.

Undici 7.30.1, which fixes all eight, was published 2026-10-15T14:18:31.283Z and
clears the admission window on 2026-11-14; 7.30.0 is aged but fixes none of the
October advisories. Because no traced caller reaches the vulnerable paths,
waiting is lower risk than admitting fresh networking code early. Reassess
before adding an Undici import, a jsdom `resources` option, a jsdom
`XMLHttpRequest`, `WebSocket` or `EventSource` caller, a fetch to a non-loopback
or HTTPS target in a jsdom process, or changing jsdom. Update to Undici 7.30.1
or later after 2026-11-14 and before 2026-11-21, verifying registry release age,
then remove these assessments.

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
Plan a verified Vitest/mocker 4.1.12 update once it clears the admission window
on 2026-11-14, by November 21, or renew with current source evidence. Retaining
unused vulnerable APIs is lower risk than changing the test toolchain during
this release; it grants no fresh admission.

The source-map-js assessment keeps its own expiry. Scanner findings remain
visible even when the exact assessments are accepted.
