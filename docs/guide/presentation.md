# Pane runtime, presentation and pictures

How pane content stays live, freezes, presents natively or through HTML-in-Canvas, and how retained pictures are acquired.

## Pane runtime and motion

Onirigiri determines visibility from each pane's actual intersection with the viewport, so there is no
fixed cap on the number of live panes that fit on screen. Normal frames calculate only visible
columns plus a nearby overscan corridor. At rest, spare cache area materializes that corridor before
navigation; hidden content remains laid out but visibility-suppressed, so it produces no offscreen
paint or interaction surface and does not defer cold layout to its first visible frame. Once a pane
has been activated, its React subtree is retained offscreen by recency while it fits within the same
memory-oriented area budget. The default budget is eight viewport areas and can be tuned without
introducing a semantic pane-count cap:

```tsx
<OnirigiriWorkspace retainedAreaBudgetViewports={6} {...workspaceProps} />
```

Only idle, offscreen panes are eligible for eviction. Every viewport-intersecting pane remains
mounted and live at normal rest, even when a large viewport fits many panes at once. Overview keeps
already mounted content paused (`runtimeState: "frozen"`) and inert so workspace navigation owns
input. Cold overview cards stay unmounted unless `captureMissingOverviewPictures` is enabled;
normal navigation mounts destination content before the camera settles.

`renderPane` receives `runtimeState` (`"live"`, `"frozen"`, or `"hidden"`).
Onirigiri keeps the same content subtree while the engine moves stable pane hosts.
Ready content stays visible during navigation and overview. Frozen content is
inert; applications pause their own render loops. Normal navigation mounts cold
destination panes without mounting the entire corridor. Zustand owns layout state.

### Always-live mode

Set `liveContent` to keep pane content mounted and visible panes animated during
navigation, resizing and overview:

```tsx
<OnirigiriWorkspace liveContent renderPane={renderPane} />
```

Automatic live presentation keeps ordinary DOM, graphics and video native. Playing
videos display their decoded frames through a Canvas 2D surface, which avoids
Chrome's multi-video cadence limit without per-frame element capture; a video with
native controls shows them again while paused, hovered or focused.
Visible applications still incur their own rendering costs; frame rate depends on
the content and device. Pane shells and controls remain DOM.

Both demos in
[the playground](https://github.com/riteofstring/onirigiri/tree/main/playground) expose **Rendering → Always live**, enabled by default. It keeps
all applications mounted. Disabling it restores ordinary content retention and
frozen navigation unless an explicit policy requests a different presentation.
Texture budgets apply to retained pictures, not mounted applications or live buffers.

### Configurable pane presentation

`panePresentation` sets a default across the workspace. `getPanePresentation`
overrides it for individual panes or any group selected by type, column, ID or
consumer metadata. Rules receive `phase` (`rest`, `motion`, `overview`,
`overview-motion`, `resize`), `focused`, `visible`, `maximized`, and capture
capabilities. A throwing or invalid rule falls back to DOM with reason
`policy-error` and a console diagnostic. Keep this pure callback stable with `useCallback`; it runs when
semantic inputs change, not for every camera position.

```tsx
<OnirigiriWorkspace
  liveContent
  panePresentation="auto"
  getPanePresentation={(pane, context) => {
    if (pane.surfaceKind === "game") return "dom";
    if (context.phase === "overview" && !context.focused)
      return { kind: "texture", detail: "preview", reason: "Overview budget" };
    if (pane.columnId === "parked")
      return { kind: "placeholder", variant: "icon" };
    return undefined;
  }}
  renderPanePlaceholder={(pane, state) => (
    <div aria-label={pane.title}>
      {state.variant === "icon" ? "◇" : pane.title}
    </div>
  )}
  renderPane={renderPane}
/>
```

Choices are `"auto"`, `"dom"`, `"canvas"`,
`{ kind: "texture", detail: "full" | "preview" }`, and
`{ kind: "placeholder", variant?: string }`. Object choices accept a `reason`.
For example, `{ kind: "dom", reason: "Interactive game" }` explains an override.
Explicit textures and placeholders pause the application. A mounted capturable
pane freezes a fresh display frame immediately, without PNG encoding. Preview
mode bounds it by `pictureMinLongEdgePx`. Cold or supplied pictures use the
retained cache; preview detail releases its full allocation, and restoring full
detail waits for idle time. Original CSS geometry remains unchanged.

Capture-incompatible graphics, shadow content, protected media and inaccessible
frames use native presentation when canvas is requested. They need a supplied
`getPanePicture` for a texture; otherwise the placeholder is shown. Policy changes
preserve mounted application state. With `liveContent` disabled, normal offscreen
retention and eviction still apply. A policy can keep visible content live without
keeping all hidden applications mounted.

The playground menu provides phase-specific rules for all panes, a content type,
or one pane. Titlebar labels report the visible presentation rather than the
selection. `ref.current.getPanePresentationState(paneId)` and
`onPanePresentationChange(paneId, state)` expose the requested/effective choices,
actual presentation, reason, coverage and live status. Workspace-wide policies
apply across panes; they do not flatten the whole workspace into one canvas.

### Retained pictures and asynchronous content

Graphics canvases and opaque embedded content retain their native presentation
while mounted. Automatic capture skips content Chromium cannot record faithfully;
provide `getPanePicture` when those panes need a preview after DOM eviction.

The playground's retained texture count is the number of cached panes. Refreshing
an existing pane's texture does not increase that count. Viewport and layout
changes refresh captures whose content dimensions have changed, including
offscreen panes covered by background caching.

Onirigiri defaults to original DOM. Panes already showing native content keep it
through motion and overview while applications receive the frozen runtime state;
HTML-in-Canvas and WebGPU supply pictures for panes that were not showing native
content and a brief transition before the native content appears.
Focus resumes first, then visible panes progressively outward. State-preserving
DOM moves keep iframe documents, native input and edited forms intact through
that handoff. While resizing, old pixels stay at their original size at the
top-left; the pane crops them or expands around them until responsive content
returns. Retained pictures cover cold or loading content. Compressed originals
survive content eviction and have no freshness expiry. Unvisited panes show a
styled icon and title.

```tsx
<OnirigiriWorkspace
  getPanePicture={(pane) => savedPngs.get(pane.paneId) ?? null}
  pictureBudgetBytes={256 * 1024 * 1024}
  pictureRasterBudgetBytes={512 * 1024 * 1024}
  pictureMinLongEdgePx={128}
  captureMissingOverviewPictures
  onCaptureStatusChange={showCaptureStatus}
  renderPane={renderPane}
/>
```

Capture is built into the engine. Optional `getPanePicture` returns `{ image: pngBlob, fit?, position? }`.
Use an immutable PNG Blob per revision; Onirigiri owns its prepared textures. Withdrawing a
source retains its last accepted picture. Removing the pane or replacing its
surface releases that picture. Developers can set both retention budgets:

- `pictureBudgetBytes`: retained PNG bytes, default 256 MiB.
- `pictureRasterBudgetBytes`: prepared GPU texture bytes (`width × height × 4`),
  default 256 MiB. The example above raises this ceiling to 512 MiB; it does not
  allocate that amount.
- `pictureMinLongEdgePx`: the long edge of prepared previews, default 128 pixels.
  Lower values reduce their memory use, with less detail.

Each retained PNG keeps a small prepared preview. Full-detail textures are
prepared for visible panes and the first surrounding ring, within the budget.
Leaving that neighborhood releases detail textures while preserving the original
PNG. Returning restores detail from that original, without another content
capture. A distant jump can show the prepared preview immediately while detail
loads; normal visible textures are protected. There is no age-based degradation.
Capacity pressure releases lower-priority detail first, then evicts unprotected
originals if necessary. Replacements require room for both old and new resources;
an impossible replacement preserves the existing cache.

Decoding and canvas capture have a separate 128 MiB raster limit and a 32 MiB
encoded-input limit. Raster accounting covers owned prepared textures, not total
browser memory: live canvases, presentation buffers, transient decoding and
browser caches are additional. Pictures survive content eviction, not workspace
destruction or page reload.

`preloadMarginPanes` defaults to **1**. Onirigiri initializes one missing pane at a
time within one pane's width and height outside the viewport, in normal and
overview modes. It can start during navigation after two smooth frames indicate
spare frame time. On a busy device it waits until navigation settles, then starts
promptly. Once ready, Onirigiri saves one frame as a PNG and returns the content to its paused
runtime while retaining the same DOM when its budget permits. Resizing suspends speculative work.

Visible picture acquisition takes priority. Missing visible overview content is
also eligible for serial initialization. Onirigiri can temporarily mount one extra
pane when `retainedAreaBudgetViewports` has no spare room, then freeze or
unmount it after capture. It can release offscreen DOM backed by a saved
picture while keeping that picture. Set the margin to **0** to disable the
neighboring band. A warming pane entering normal view goes live without
waiting for its background encoding to finish.

Set `preloadAllPanePictures` to also cache distant panes progressively while
idle. Visible work and nearby panes take priority. Only one speculative pane
runs at a time, and each returns to its paused state after one frame. Both
playgrounds enable this and expose a caching checkbox in **Content**. All-pane
caching respects the picture budgets; it will not repeatedly evict mosaics
to load more distant panes than the cache can hold.

Preloading saves offscreen pictures before navigation reaches their panes. Browser
painting, readiness and available memory can still delay a preview; existing
pictures remain usable even when outdated.

`captureMissingOverviewPictures` is opt-in and enabled in both playgrounds.
At overview rest, it loads or resumes one visible pane without a picture,
waits for the pane's readiness signal, captures its current frame, and waits for
the saved image to load before releasing the temporary content. Existing mounted
content returns to its frozen state. It then proceeds to the next missing pane.
Focus and camera position stay unchanged; input remains with the workspace.
Closing overview or starting a pointer gesture cancels its work. A pane that fails to load or capture is skipped,
and a later navigation or `refreshPanePictures()` gives it another opportunity.
This can temporarily mount one extra pane beyond the native-content area budget.
Retained pictures and HTML-in-Canvas presentation use WebGPU and HTML-in-Canvas
(`chrome://flags/#canvas-draw-element`). Without them the workspace stays fully
usable: panes present native content, requested canvas or texture presentation
falls back to native, and panes without a supplied picture show their placeholder
during motion and overview. `onCaptureStatusChange` reports `state: "unavailable"`
with the reason. Pane chrome remains ordinary DOM. Automatic
presentation keeps ordinary content and video native. Developers can override presentation by pane and phase.
Tab sharing is never required.

HTML-in-Canvas excludes cross-origin iframe pixels. Such content can render in
the native host at rest under the browser's normal embedding policy. Host content
on your application's origin for capture, or supply an authorized static preview
through `getPanePicture` to represent it while frozen or cold.
The examples serve their controlled lab fixtures on the playground origin.

`getCaptureStatus()` reports initialization, acquisition failures, picture
coverage, retained byte estimates and current warmup/capture activity.
`refreshPanePictures()` requests another encoding opportunity from the last
recorded content. A changed readiness revision or source size requires a new
recording. Native DOM updates at rest do not continuously capture or encode
PNG pictures; a subsequent canvas handoff records current content.

Asynchronous content reports readiness through the exported hook:

```tsx
function DocumentPane({ ready, documentId }) {
  useOnirigiriPaneContentReady(ready, documentId);
  return <YourDocument />;
}
```

All readiness sources within a pane must be ready before Onirigiri reveals its live
content or captures it. A changed revision invalidates pending work. Ordinary
synchronous HTML needs no hook. Frame adapters validate their own messages and
combine document identity, load and application readiness. Onirigiri does not interpret
application protocols. The `pane-picture` and `pane-placeholder` styling slots,
`data-onirigiri-content-ready` and `data-onirigiri-picture-ready` attributes are public;
no example CSS is needed for picture visibility.

See [pane content and picture ownership](../design/native-content-motion.md)
and the [HTML-in-Canvas examples](../design/html-canvas-examples.md).

Hosts with their own render loops should use the same state to stop expensive work such as WebGL,
canvas, terminal, video, chart, or stream updates:

```tsx
<OnirigiriWorkspace
  renderPane={(pane, state) => (
    <YourPane
      active={state.runtimeState === "live"}
      paneId={pane.paneId}
      visible={state.visible}
    />
  )}
/>
```

Because Onirigiri retains the original DOM, ordinary form state, scroll offsets, canvas elements, and
consumer component identity survive a movement round trip without copying. A host that owns WebGL,
video, canvas, or another independent render loop should pause that renderer on `frozen` and retain
its last frame until `runtimeState` returns to `"live"`.

Splitting a pane creates an `empty-frame` surface. The host can render a picker for that surface and
then call `configurePane`, as the playground does, or use the imperative API to configure it
directly. Onirigiri never decides what application content belongs in a window.

For a two-dimensional seed, assign plane and aligned slot indexes through the same public pane
definition type:

```tsx
const panes: OnirigiriPaneDefinition[] = [
  {
    paneId: "north",
    planeIndex: 0,
    slotIndex: 0,
    surfaceKind: "document",
    title: "North",
  },
  {
    paneId: "middle",
    planeIndex: 1,
    slotIndex: 0,
    surfaceKind: "preview",
    title: "Middle",
  },
  {
    paneId: "south",
    planeIndex: 2,
    slotIndex: 1,
    surfaceKind: "console",
    title: "South",
  },
];

const paneId = workspaceRef.current?.splitPaneToPlane("middle", "down");
```

The bottom handle on the last pane in a column resizes the shared plane height. Every aligned
column—including columns split into multiple panes—keeps the same outer height. Handles between
stacked panes adjust only that internal split. Width and height resize targets run flush along the
pane's right and bottom edges rather than floating inside its content. Focus a handle and use the
appropriate arrow keys to resize in 16px steps (Shift uses 64px steps); Enter or Space resets that
dimension. [`resizeEdges`](pane-defaults.md#resize-handles) adds left and top handles or removes
any of them.
