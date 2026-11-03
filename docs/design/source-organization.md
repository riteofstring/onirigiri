# Source organization

The public package entry is `src/index.ts`; `src/types.ts` holds shared domain
contracts and `src/styles.css` is the stylesheet entry. Consumers import the
package exports. Internal code imports the owning file directly, without folder
barrels or forwarding modules.

| Directory      | Responsibility                                                       |
| -------------- | -------------------------------------------------------------------- |
| `layout`       | Layout geometry, sizing, pane defaults and camera calculations       |
| `state`        | Zustand layout state, commands, restoration and animation state      |
| `workspace`    | React workspace composition, runtime configuration and grid cursor   |
| `panes`        | Pane components, content readiness, capabilities and DOM lifecycle   |
| `pictures`     | Capture surfaces, retained pictures, cache budgets and GPU resources |
| `presentation` | Frame scheduling, motion geometry and renderer coordination          |
| `input`        | Keyboard commands, controls, focus and resize gestures               |
| `styles`       | Theme, style slots and CSS implementation                            |

These directories identify responsibilities within the existing library module;
they do not introduce separate packages or claim independently enforced dependency
layers. Layout and state remain independent of React composition. Browser resources
retain their existing owners and lifetimes. The detailed state and presentation
contracts remain in [workspace state](workspace-state.md),
[pane defaults](pane-defaults.md) and [native content](native-content-motion.md).

Filenames retain descriptive domain names so imports and search results identify
their purpose outside the containing directory. The exported workspace component
uses PascalCase; supporting modules use kebab-case. Public symbols and CSS selectors
retain their established names. Tests may import internal owners to exercise their
boundaries; consumer fixtures continue to use the public package.

The `playground` module depends on `onirigiri` as a development consumer. Its
applications resolve the public exports to the library source, and its Chrome
preview reuses the library's browser launch and hardware capability checks.
The published package excludes the playground. Browser fixture HTML files and
the root Vitest project list load the playground fixture and test entry points;
TypeScript loads the surface-lab server declaration for its Vite plugin imports.

Repository-owned development HTTP servers disable Vite's browser-to-editor
endpoint before its bundled launcher receives a filename. The shared development
plugin uses Connect's route matching at both root and raw configured base paths;
builds and production preview retain their normal behavior. The
[dependency assessments](../security/dependency-assessments.md) record the
affected input paths, verification and bounded dependency-update window.

Playground production builds use relative asset URLs and can be hosted as
independent static directories. The default catalog includes local demos and
arcades. `?lab=1` opts into lab menu entries and their external fixture
dependency. The development and preview lab middleware builds that sibling
fixture only when requested; static deployments must host an optional fixture
separately. The lab remains outside the package and standalone build artifacts.
