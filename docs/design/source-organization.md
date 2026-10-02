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
