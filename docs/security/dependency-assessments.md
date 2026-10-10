# Development dependency security assessments

Reviewed 2026-10-10 by Codex. These assessments expire on 2026-10-31 and apply
only to the exact package versions, advisories and lockfile scope declared in
`.code-polishy.json`. They record unreachable advisory prerequisites; scanner
findings remain visible. No fresh-release admission or risk acceptance is used.

## Dependency and input boundaries

`pnpm why undici source-map-js` identifies `jsdom@29.1.1` as the only Undici
owner. jsdom is a development dependency used by the root and playground Vitest
projects. `vite.config.ts` and `playground/vitest.config.ts` enable jsdom for
checked-in tests without custom resource, dispatcher or interceptor options.
The tests do not construct WebSocket clients, use `JSDOM.fromURL`, or supply
untrusted HTML to jsdom. Browser fixture requests run in Chrome and do not use
this installed Node dependency. The published library depends on Zustand and
React peers and does not include jsdom or Undici.

The installed `jsdom/lib/api.js` `extractResourcesOptions` leaves automatic
subresource loading off and user interceptors empty under these options. Its
`JSDOMDispatcher` delegates to the normal global dispatcher and adds jsdom's own
`browser/resources/decompress-interceptor.js`, not Undici's optional decompression
interceptor. `living/websockets/WebSocket-impl.js` exposes Undici's WebSocket only
when a caller constructs a jsdom WebSocket; none of these tests does so.

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
| [GHSA-rfgv-xxqx-mfg5](https://github.com/advisories/GHSA-rfgv-xxqx-mfg5) | `undici@7.29.0`       | The only dependency owner is jsdom, used for repository-authored Vitest fixtures. Those fixtures never construct WebSocket clients; no remote handshake reaches Undici WebSocket. The unrequested-subprotocol crash has no enabled caller or attacker-controlled peer.                                                                                                                                                                 |
| [GHSA-3wwx-pv8p-q78v](https://github.com/advisories/GHSA-3wwx-pv8p-q78v) | `undici@7.29.0`       | The jsdom test fixtures never construct WebSocket clients. No permessage-deflate peer input reaches the installed Undici WebSocket implementation. The malformed compressed-message crash has no enabled caller.                                                                                                                                                                                                                       |
| [GHSA-rx4f-c7p8-82vq](https://github.com/advisories/GHSA-rx4f-c7p8-82vq) | `undici@7.29.0`       | Neither repository code nor its jsdom caller constructs Undici WebSocketStream. No writable WebSocketStream exists for an unclean peer close to terminate.                                                                                                                                                                                                                                                                             |
| [GHSA-w293-vg96-wgc3](https://github.com/advisories/GHSA-w293-vg96-wgc3) | `undici@7.29.0`       | jsdom uses getGlobalDispatcher and its own JSDOMDispatcher. The repository configures no BalancedPool, custom TLS connector, or checkServerIdentity callback. The BalancedPool-only loss of a custom TLS verification function is unreachable.                                                                                                                                                                                         |
| [GHSA-3xpg-4rpp-hhhm](https://github.com/advisories/GHSA-3xpg-4rpp-hhhm) | `undici@7.29.0`       | jsdom uses its own decompress-interceptor.js. The repository enables no Undici interceptors.decompress invocation or custom resource interceptors. The vulnerable Undici decompression interceptor receives no responses.                                                                                                                                                                                                              |
| [GHSA-2gqq-gqf2-x968](https://github.com/advisories/GHSA-2gqq-gqf2-x968) | `undici@7.29.0`       | Neither repository code nor the configured jsdom dispatcher enables Undici interceptors.dump. No response is processed through the vulnerable chunked-response dump path.                                                                                                                                                                                                                                                              |
| [GHSA-r53p-7pc4-xj5r](https://github.com/advisories/GHSA-r53p-7pc4-xj5r) | `undici@7.29.0`       | No retry interceptor or RetryAgent is configured, and the repository has no Undici-backed downstream HTTP forwarder. The retry-and-forward prerequisites for response splitting are absent.                                                                                                                                                                                                                                            |
| [GHSA-pmjh-fq2x-6v4x](https://github.com/advisories/GHSA-pmjh-fq2x-6v4x) | `undici@7.29.0`       | Neither repository code nor the configured jsdom dispatcher enables RetryHandler, RetryAgent, or interceptors.retry. No response body can enter the vulnerable retry sequence.                                                                                                                                                                                                                                                         |
| [GHSA-2jfj-6hjv-fm6j](https://github.com/advisories/GHSA-2jfj-6hjv-fm6j) | `undici@7.29.0`       | No Undici cache interceptor is configured. jsdom resource configuration leaves userInterceptors empty and adds only its own decompression interceptor. There is no shared response cache that can replay another user cookie.                                                                                                                                                                                                          |
| [GHSA-8436-99hf-9mmv](https://github.com/advisories/GHSA-8436-99hf-9mmv) | `undici@7.29.0`       | No Undici cache interceptor or cache store is configured by the repository or its jsdom resource options. Unsafe HTTP methods cannot enter the vulnerable cache lookup and storage path.                                                                                                                                                                                                                                               |
| [GHSA-68fv-2mgg-jv7q](https://github.com/advisories/GHSA-68fv-2mgg-jv7q) | `source-map-js@1.2.1` | The resolved callers are PostCSS and css-tree. PostCSS uses SourceMapConsumer and SourceMapGenerator; css-tree imports only SourceMapGenerator. Neither calls SourceNode.fromStringWithSourceMap, whose generated-line loop is the reported denial-of-service sink. No enabled caller reaches the unbounded SourceNode loop; build maps also originate in checked-in sources and locked tools, not uploaded or remotely supplied maps. |

## Remediation and reassessment

Retain the aged, unaffected versions for this release. Reassess immediately if a
new test opens a WebSocket, enables a listed Undici interceptor or BalancedPool,
loads untrusted jsdom content, adds a source-map consumer, or changes either
resolved version. These decisions do not cover consumer applications that
independently use the vulnerable APIs.

Complete the next intentional dependency update by 2026-10-31: resolve Undici
to at least 7.29.1 and source-map-js to at least 1.2.2, remove the assessments
that no longer match, review the complete candidate dependency graph, install
frozen without scripts, and verify the test/build consumers. Registry metadata
records Undici 7.29.1 on 2026-09-04 and source-map-js 1.2.2 on 2026-09-30; the
latter clears the 30-day admission window on 2026-10-30. No early admission is
justified when the affected path is absent. Expiry blocks continued acceptance
without completing the update or a new evidence-backed assessment.
