# Quality and supply-chain tooling

Onirigiri is governed by the exact locally installed Code Policy release named in
`.code-policy.lock.json`. The release owns formatting, linting, TypeScript analysis, dead-code and
complexity checks, architecture enforcement, pnpm lock validation, dependency licensing, and
vulnerability scanning. `.code-polishy.json` contains only Onirigiri-specific architecture, build, test,
package-contract, and supply-chain facts.

Install target dependencies without lifecycle scripts before running policy checks:

```sh
pnpm install --frozen-lockfile --ignore-scripts
```

## Commands

| Command                                            | Purpose                                                                                                                       |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `code-policy doctor --strict`                      | Validate the lock, configuration, ownership, tool coverage, managed guidance, and installed dependency metadata.              |
| `code-policy check --git-changes`                  | Run deterministic quality and architecture checks for current changes.                                                        |
| `code-policy check --all`                          | Run deterministic quality and architecture checks over the repository.                                                        |
| `code-policy format --git-changes`                 | Apply the locked formatter to current changes.                                                                                |
| `code-policy test --changed`                       | Run the focused suites selected for current changes.                                                                          |
| `code-policy test-levels --base origin/main`       | Show the recommended and full ordinary pre-merge choices without running them.                                                |
| `code-policy supply-chain --offline`               | Validate pinned dependencies, lock consistency, lifecycle policy, sources, installed licenses, and offline advisory evidence. |
| `code-policy supply-chain`                         | Add online native audit, OSV, and release-age checks.                                                                         |
| `code-policy dependency-review --base origin/main` | Review an intentional manifest or lockfile change before installation.                                                        |
| `code-policy gate`                                 | Run the complete ordinary gate after broader execution is authorized.                                                         |
| `pnpm consumer:check`                              | Pack Onirigiri, install it into an unrelated temporary React app, and build against public exports only.                      |
| `pnpm test`                                        | Run unit and component behavior.                                                                                              |
| `pnpm test:browser`                                | Run real interaction workflows in the installed Google Chrome channel.                                                        |
| `pnpm build`                                       | Build the library package and check the built package boundary.                                                               |

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

The scheduled dependency-security workflow runs on a GitHub-hosted Linux runner. It installs Node
25.2.1 and pnpm 10.23.0, then `./code-polishyw setup` installs the exact Code Polishy release named by
`.code-polishy.lock.json` and verifies its digest before the online scan.
