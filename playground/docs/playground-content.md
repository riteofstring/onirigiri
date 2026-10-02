# Playground content and appearance

Both 1D and 2D examples share one pane catalog, content checklist, spawn control
and content renderer. Selected content types determine the generated workspace;
5, 10, 50 and 100 are the supported spawn sizes. The default is 10 panes in 1D
and 100 panes in 2D; an explicit supported count in the URL takes precedence.
Applying content choices or spawning a count starts a fresh workspace.
At least one content type is required.
One-dimensional scenes use horizontal grid topology. Keyboard and direction
controls can traverse splits within the current row but cannot cross into
another logical row. Saved layouts must also have a cursor on that row.
Two-dimensional scenes use the default spatial topology, whose logical cells and
camera have no structural edge. The example exposes an optional pane-relative
cursor runway that updates without remounting the workspace; leaving it blank
keeps cursor navigation unbounded. Its visible Home action returns to the initial
pane, or the first surviving pane if that pane closes. Neither example
materializes empty grid coordinates. The dimensional examples keep their
existing layout tools. The playground header has no dimension selector. The 1D
example remains available through `pnpm dev:1d` or the `one-dimensional` preview
launch argument. Both examples accept content and count choices in their launch
URL. An explicit recipe takes precedence over the 1D mode's saved layout.

Default scenes open with one dedicated welcome pane, followed by the content
catalog. Its navigation and pane-movement shortcuts use the library's default
bindings and name Option and Control on Apple keyboards, or Alt and Ctrl on other
platforms. The Explore panes action focuses the next pane. The welcome surface
contains no editor; Field notes remains a separate editable pane. Curated content
selections contain only their chosen surfaces. The welcome pane counts toward the
requested scene size and is never repeated when the catalog cycles.

New panes share the playground's outer dimensions regardless of content type.
The 2D playground uses 480 × 600 pixels for every pane, including the welcome
pane. The 1D playground uses a 480-pixel width and fills the available row height.
Workspace defaults govern initial scenes, content selection, spawning and adding
individual panes. Video keeps contained 16:9 content within that same outer size.
Viewport clamping and subsequent user resizing still apply normally.

The playground passes semantic style values and its light/dark mode into framed
lab content, including font families, semantic text sizes, weights and line heights.
The same CSS tokens style the playground. `contentThemeOverrides` on
`PlaygroundFrame` merges explicit style values over the inherited theme; omitted
values continue to follow the host. The lab accepts a neutral theme contract over its own bridge and
never imports or names a pane engine. Initial appearance travels with the frame
URL so readiness cannot expose an unthemed document. Later changes travel over
validated parent messages and update the mounted document, canvas and terminal
in place. Theme acknowledgement advances the content revision used for capture.
Runtime pause/resume messages do not resend an acknowledged theme or repaint its
palette. The dimensional hosts keep their pane renderer stable across layout
status updates so retained consumers only rerender when their inputs change.
Pane defaults also keep a stable identity across those updates, so moving focus
does not invalidate every consumer's layout context.
Retained pictures remain available until refreshed; theme changes do not warm
offscreen content or create a separate texture cache.

Each example also serves `/fixture.html`, which renders the same playground with
an explicit asymmetric scene from `shared/fixture-panes.ts`. Onirigiri's library
browser tests open these pages and the example roots on the development servers
to exercise splits, gaps, navigation and layout history; keep their pane ids,
region labels and the 1D probe stable. The actual example startup, content
selection, spawn sizes and theme propagation have their own browser boundary
check (`pnpm test:content`).
The 1D probe records committed consumer renders and their input state. During
interpolation, live content may render when its runtime changes between live and
hidden as it crosses the viewport. Other inputs remain stable; repeated renders
with unchanged state are rejected. Resetting the probe retains the last committed
state of each pane as the comparison baseline.

Both dimensional examples enable the engine's optional missing-picture overview
queue. It temporarily renders one visible pane without a saved picture at a time,
using the same themed renderer and readiness signal as ordinary navigation.

Both examples enable progressive all-pane picture caching. A checkbox in the
Content menu can restrict this to nearby panes without restarting the workspace.
The URL carries that choice between dimensional examples. The Content menu also
exposes an estimated decoded texture memory budget from 64 to 2048 MiB, initially
256 MiB. Applying a value updates the existing engine budget without restarting
the workspace and persists it in the URL. Encoded PNGs retain their separate
256 MiB limit; browser caches and temporary GPU resources are additional.
Textures have no time expiry, so extra memory preserves more cached detail
rather than extending a timer. Scheduling, live
canvas presentation and texture retention belong to the library.

The Rendering menu configures workspace, content-type and individual pane rules.
Pane rules take precedence over type rules, then workspace defaults; an exact
phase overrides the all-phases rule within each scope. Options include automatic,
native DOM, live HTML-in-Canvas, full or reduced-resolution retained textures,
and an icon placeholder. The library's resolver also accepts arbitrary group
predicates and custom placeholder rendering.

Each titlebar reports the visible presentation: Native DOM, Live HTML-in-Canvas,
Frozen texture, Placeholder, Loading or Render error. One presentation service
owns these attributes; surface completion and covering-layer reports feed it.
Badge CSS updates without per-frame React renders. The public state getter and
change callback expose requested and effective kinds, reason, live state and
coverage for developer diagnostics. A renderer label does not certify cadence.

**Always live** retains applications and starts enabled in both playgrounds.
Automatic presentation uses native DOM, graphics and video. Eligible videos use
live Canvas 2D pixels in every phase; at ordinary rest a video with native
controls returns to its original pixels while paused, hovered or focused.
Explicit native selection bypasses that adaptation. Explicit texture and placeholder choices
suspend covered content. Disabling Always live restores frozen navigation unless
an explicit presentation policy requests live content. Policies do not require
retaining all offscreen applications.

## Arcade and lab graphics

The playground owns two small Canvas 2D games. Their simulation state survives
runtime changes and does not advance while hidden or explicitly frozen. Keyboard
listeners belong to the focused game surface; workspace modifiers continue to
navigate normally. Pointer and keyboard controls support play and restart.
Game chrome and Canvas 2D palettes consume the host content theme, including its
font families, semantic type sizes, colors and explicit overrides. Theme changes
repaint at the current game state without starting a new game.

Chromatic reactor and Tidal lattice belong to the sibling Browser Surface Lab.
The shared catalog selects its `three-reactor` and `three-tidal` fixtures through
the same themed cooperative iframe boundary as other lab content. Onirigiri has no
Three.js dependency, scene implementation, graphics pool or scene controls.
The lab owns geometry, shaders, camera sizing, context recovery and frame counters.
These demos are separate from its protected Tier 1 baseline. Their chrome and
scene palettes consume the same host theme as other fixtures. Palette changes
redraw the existing canvas at its current simulation time, including paused
scenes, without restarting the scene or resetting its controls.

Paused lab scenes retain their displayed pixels and simulation settings. The lab
releases their WebGL context while paused and reacquires it on resume, bounding
context usage across independent iframe documents. Active scenes in the same lab
document share a renderer. Resizing redraws at the existing simulation time with
the new content-box aspect ratio. The integration tests cover native pixels,
resizing, retained iframe identity and settings; standalone lab tests own graphics
recovery and lifecycle behavior. Production measurements continue to require the
same four visible scenes to advance alongside both video decoders.

## Lab hosting

Development and preview servers mount a production build of the sibling
browser-surface-lab's fixture entry under `/surface-lab/` on the playground's
origin. A separate build process preserves the parent server's development mode
and leaves the fixture sources, dependencies, assets, workloads and counters
unchanged. Each server builds once into its own temporary directory, shares that
build across concurrent requests, and removes it on shutdown. Vite's preview
middleware serves the compiled assets, including video byte ranges. Production
React avoids development instrumentation competing with navigation on the
shared main thread; it does not change workload size or update rates. Restart
the playground server to rebuild after changing fixture sources. This
first-party hosting makes the controlled fixture documents readable by
HTML-in-Canvas. It grants no access to unrelated third-party origins. Missing
local fixtures produce an explicit development-server response.
