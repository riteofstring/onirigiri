# Development dependency security assessments

Reviewed 2026-10-10 by Codex. This assessment expires on 2026-10-31 and applies
only to the exact package version, advisory and lockfile scope declared in
`.code-polishy.json`. It records an unreachable advisory prerequisite; scanner
findings remain visible. No fresh-release admission or risk acceptance is used.

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
