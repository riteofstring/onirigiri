# Pane content and retained pictures

Onirigiri automatically presents ordinary content and video through their original
DOM. Without live presentation enabled, applications receive the frozen runtime
state during motion and overview, but a pane already presenting native content
keeps that native presentation instead of copying a fresh frame into a texture;
a copy at motion start costs a synchronous GPU readback that can stall the first
frame on discrete GPUs. Retained WebGPU textures cover panes that were not
presenting natively, and retained pictures cover cold content. The original subtree supplies browser
layout, styling and input semantics; it is neither cloned nor serialized.
State-preserving `moveBefore` transfers that same subtree between its capture
canvas and native host without reloading iframe documents or replacing inputs.
Pane shells, titlebars and controls remain ordinary DOM with stable creation
order and world positions. Zustand owns layout state.

Camera sweep calculations reuse the current and destination world-frame caches
while the built-in scene geometry remains unchanged. Layout, viewport and pane
defaults changes invalidate those caches; custom layout engines keep their
dynamic geometry behavior. Pane style and content-offset measurements remain
pending offscreen and resolve before the pane's first visible presentation.

Each workspace owns one GPU device and each content host owns a capture surface.
Native presentation displays the original subtree without requiring a successful
capture first. This applies at rest and during live motion and overview.
HTML-in-Canvas presentation waits for a completed draw before uncovering content.

## Presentation policies

`panePresentation` supplies a workspace-wide default and `getPanePresentation`
can override it for a pane, content type, column, or consumer-defined group.
The resolver receives semantic phase, focus, visibility, maximized state and
capture capabilities. It must be pure. Invalid or throwing rules produce a native
fallback with reason `policy-error` and one console diagnostic per decision.
Equivalent default objects share their decision cache. Decisions are cached between changes to
those inputs; camera coordinates are deliberately absent from the context.
Changing policy preserves the original content subtree and application state.

Choices are automatic, native DOM, live HTML-in-Canvas, retained texture with
full or preview detail, and a placeholder with a consumer-defined variant.
`renderPanePlaceholder` provides custom React content, including icons. Explicit
texture and placeholder choices intentionally suspend the application's runtime.
A visible, mounted, capturable pane freezes one fresh frame directly in its display
buffer; it does not wait for PNG encoding or reuse a stale offscreen picture.
Preview detail bounds that buffer by the configured preview edge. Hidden display
buffers are released. Supplied pictures and cold panes use the retained cache,
where preview detail releases the full allocation and suppresses promotion.
Missing pictures for excluded or cold content show a placeholder. Promoting a
retained preview to full detail is deferred until idle; a mounted capturable
frozen buffer can change detail immediately.

Automatic live presentation keeps ordinary DOM, graphics and video native in every
phase. Chrome implements element-image copies with a synchronous pixel readback, so
per-frame HTML-in-Canvas presentation cannot sustain high-refresh cadence on
discrete GPUs; automatic presentation therefore never copies element images every
frame. This is the measured performance preference, not a universal frame-rate
guarantee. Developers can
explicitly choose native video or capturable HTML-in-Canvas at any phase. Graphics
canvases, opaque frames, shadow content and protected media remain native when
capture cannot preserve their content. The effective decision reports that reason.
A texture for excluded content requires a developer-supplied picture.

Presentation and retention are separate. `liveContent` retains all applications;
a custom presentation policy can animate visible panes without retaining every
hidden application. Without either option, applications are frozen during motion
while already-native panes keep their pixels in place.
Pane shells and controls stay DOM. The workspace default applies across the
surface; it does not flatten the workspace into a single capture canvas.

Presentation status follows the topmost content layer, distinguishing native,
live canvas, frozen texture, placeholder, loading and error. A surface reports
completed presentation facts; the picture service owns the public status and
attributes. A requested mode is never reported as proof of rendered pixels.

A cached capability inventory observes relevant subtree additions/removals and
iframe loads, including nested same-origin documents. It ignores ordinary text
updates, refreshes before renderer selection and releases listeners with its owner.
The inventory also supplies documents for temporary scrollbar suppression.
Native live panes do not capture an intermediate or final frame merely because
they enter or leave the viewport. This avoids the same problematic capture at
handoff boundaries. Inactive content keeps its native host and resumes in place.

The presented world-frame boundary requests renderer changes at motion start and
completion even when the camera stays in overview. Native presentation restores
original elements; HTML-in-Canvas stays live during eligible motion. Renderer
attributes describe completed presentation for developer badges. Scrollbars are
suppressed without changing layout while motion/overview is inert, including
native motion hosts and same-origin frames.

Raw input still postpones picture acquisition and cancels invalid captures, but
scrolling, typing and ordinary pointer interaction do not repaint every mounted
live pane. Store updates and presentation boundaries own navigation changes.
Resize gestures and window lifecycle changes still refresh surfaces immediately.
Capability mutations and readiness changes retain their pane-local notifications.
This keeps input cost from growing with unrelated mounted applications without
delaying animation, renderer selection or the return of native interaction.
Capture eligibility samples visual viewport scale and offsets when the workspace
starts and when that viewport emits resize or scroll events. Navigation and
background admission read this state without forcing layout through viewport
geometry getters. A viewport change that blocks capture immediately cancels
ineligible work; returning to an unscaled, unshifted viewport wakes acquisition.
Document visibility remains a fresh check, and viewport listeners are released
with the workspace. The [CSSOM View event model](https://drafts.csswg.org/cssom-view/#events)
supplies the scale and scroll invalidation notifications.
Within a paint request, live renderer checks reuse one native/canvas decision.
Presentation and frozen-surface checks also share the decision already resolved
for that query. Subsequent requests still refresh capabilities, including
synchronous subtree mutations; no decision cache spans a host sweep.

Native video can affect Chromium's page-wide cadence independently of capture.
Automatic native panes present eligible video pixels through an independent
Canvas 2D surface in every phase, so two or more playing videos do not trigger
Chromium's video frame-interval matcher. The original media element keeps decoding
in place. At ordinary rest a video with native controls shows its original pixels
and controls while it is paused, hovered or focused, which never leaves more than
one playing video on its native path. Explicit native policies bypass this
adaptation.

The video presenter copies only newly decoded frames with
`requestVideoFrameCallback`, draws an already available frame on activation, and
redraws paused seeks. It performs no pixel readback or image encoding. The buffer
keeps the source's intrinsic dimensions; CSS object fit and position preserve
its displayed proportions. CSS anchors align a noninteractive sibling host with
the original border box within its containing block. A closed shadow
root isolates the canvas from consumer canvas styles and queries. Owned hosts do
not change the capture capability inventory. Constructed stylesheets hide the
original pixels only after a successful copy without rewriting authored inline
styles. Disposal cancels callbacks and removes only owned attributes, hosts and
stylesheets; application media state remains untouched.

Adaptation requires a positioned ancestor with no clipping, scrolling, masking or
paint containment between it and the video, and unchanged video
geometry and appearance after host insertion. Transformed, filtered, masked,
animated, translucent, captioned, protected, fullscreen and picture-in-picture
videos remain native. Changes to video styling, source or captions restore native
presentation. Inaccessible documents and shadow content remain outside the
inventory. Applications with structural selectors or observers that depend on
an untouched child list should explicitly select native presentation. A failed
or ineligible presentation leaves the original content visible. Native fallbacks,
including multiple native videos at rest, can still expose the browser's cadence
limit; automatic selection is not a universal frame-rate guarantee.

This is a native Canvas 2D video surface, not an HTML-in-Canvas capture of the
mixed pane. Its pane badge remains Native DOM. The original video exposes
`data-onirigiri-video-renderer="canvas"` only while copied pixels are displayed.
Browser checks cover decoder progress, changing video and graphics pixels,
unaltered media state and inline styles, native controls, captions, removal,
object fit, exact border-box geometry and fullscreen restoration at both device
ratios. Stable color regions permit eight channel levels for video/canvas color
conversion; compressed edges and fractional raster filtering are not required
to be bit-identical. Sustained browser cadence and producer animation checks
remain separate acceptance requirements.
Missing WebGPU or HTML-in-Canvas support never blocks the workspace. Each surface
switches to native-only presentation: content moves once into its native host
(with `moveBefore` where available, otherwise an ordinary append before any
state-preserving handoff is needed), capture is reported unavailable so policies
fall back to native, and no capture work is admitted. The capture status reports
`unavailable` with the reason for developers. Device and canvas resources are
released with their owners.

## Optional continuous presentation

`liveContent` opts into keeping every pane's content mounted. It overrides the
DOM eviction policy while enabled, preserving initialized applications and their
state for later navigation. The ordinary retention lifecycle owns these entries,
so disabling the option retains eligible content within the restored budget and
unchanged offscreen pane views can be reused between navigation commands. Initial readiness, new panes and consumer reloads
remain asynchronous. Background acquisition prepares offscreen pictures once;
those pictures can bridge the first paint without replacing the retained DOM.
Disabling the option resumes ordinary mounting and retention rules.

The frame scheduler supplies its presented world geometry directly to the picture
service. Visible world rectangles determine active content on each camera frame,
including panes encountered by an interrupted move. During an overview camera move
the visible rectangle is projected through the same interpolated transform that
positions the pane frames, joined with the destination's rectangle: a departing
pane keeps its content for as long as any part of its frame is on screen, and
arriving panes are prepared from the first frame of the move. Activation changes notify
only affected content subscribers. Camera interpolation does not rerender the
workspace tree. Interaction snapshots are pane-local: hidden content does not
rerender when the workspace begins or ends a move. Content stays live through
motion and overview. Suitable content uses HTML-in-Canvas during motion while
native-only content stays on its original rendering path. Stationary normal and
overview presentations both restore native content. Inactive content uses
`content-visibility: hidden` to skip its rendering while preserving the mounted
documents; activation and preparation restore rendering. Interaction is independent of
animation: motion and overview remain inert, and recorded scrollbars stay hidden.
Continuous resizing permits responsive layout and animation during the gesture.

Live copies reuse canvas contexts and copy changed element images. Chrome
rasterizes each element image and reads its pixels back synchronously before the
WebGPU upload, so a copy costs a few milliseconds on unified-memory hardware and
10–16 ms per pane on a discrete GPU. One document-wide live copy budget spends
at most 8 ms of measured copy time per frame on content refreshes. Each surface
keeps a smoothed cost of its recent copies; when the next refresh would exceed
the budget, that surface keeps its last image and is served before fresher
surfaces on the following frame. The first refresh of every frame always
proceeds, so content keeps advancing even when a single copy exceeds the budget.
Initial frames, resizing and freezing copies are never deferred, and their cost
still counts. Where copies are cheap every live pane refreshes every frame;
where they are expensive, motion keeps its cadence while live pane content
refreshes in rotation. The budget measures cost rather than detecting hardware. Drawing-buffer scales follow the presented world scale throughout
overview entry and exit, rounded up to powers of two, capped at native density,
with a one-eighth minimum. Requesting normal mode does not immediately allocate
full-resolution buffers while panes are still displayed at overview scale.
These changes affect raster allocation only; original CSS dimensions, recording
density normalization and element identity remain unchanged. PNG acquisition is
reserved for background offscreen preparation and never runs for live visible
overview content. GPU picture budgets do not include the retained DOM, application
resources or live drawing buffers. Keeping all applications mounted is an explicit
memory tradeoff, and a large visible set still pays its script, layout and media
cost. Continuous presentation does not establish a universal frame-rate guarantee.

Headless pixel checks change real iframe content while the camera is held midway
through navigation and while overview is at rest. They verify that the displayed
content updates, that cooperative clocks continue, that native presentation
resumes, and that original iframe documents and edited inputs survive the handoff.

## Lifecycle and readiness

Consumer rendering is memoized against public pane inputs, separately from internal
readiness and cover updates. A stable renderer and unchanged inputs preserve the
application render result; external mutable state must use the consumer's own
React subscriptions. Native readiness is published after attachment. Initial
renderer setup must succeed, but a later GPU loss does not prevent the original
DOM from returning to its native host.

Live native surfaces receive a compositor hint while visible and noninteractive.
This isolates animated graphics from neighboring pane raster work during motion
and overview. Hidden live HTML-in-Canvas panes do not record a final display frame;
re-entry records fresh pixels. Explicit background picture acquisition and visible
frozen presentation keep their own capture lifecycle.

In the default mode, viewport-intersecting panes resume progressively at normal rest: focus first,
then increasing distance from focus, one admission per animation frame. The
next pane waits for the preceding first frame, with a bounded wait so slow
readiness cannot block other visible content indefinitely. Motion and overview
freeze mounted content and make it inert while preserving its pixels. Consumers
pause their own clocks using runtime state. Cold navigation destinations mount
before the camera settles. A focused destination without a retained picture or
drawn surface may present its first ready frame during that motion once its
canvas fits within the browser viewport. It stays
inert and paused, then freezes that frame until normal live activation; other
panes do not gain a motion-time paint allowance. Readiness still governs
asynchronous consumer content. Retained DOM stays within its configured area budget;
eviction prefers panes already represented by saved pictures, then recency.

`useOnirigiriPaneContentReady(ready, revision?)` aggregates asynchronous readiness.
Synchronous content is ready on mount. Consumers report document and appearance
revisions; changing a revision cancels that pane's pending capture. A loading pane
keeps its last picture or styled placeholder until ready content can be presented.
Frame protocols and message validation remain consumer responsibilities.

During pointer resizing in the default mode, the displayed texture retains its pre-gesture CSS
width and height, anchored at the pane's top-left. A smaller pane crops those
pixels; a larger pane exposes space beyond them. Both the canvas and retained
image box follow this rule. Source layout stays fixed during the drag. Release
restores responsive layout and native presentation, without stretching the old
image while the new layout paints. Both axes use the same lifecycle.
Resize handles capture the pointer for the gesture so crossing embedded content
or leaving the viewport does not interrupt movement or release.

## Picture ownership and capture

One engine service owns acquired and developer-supplied PNG pictures.
`getPanePicture` supplies immutable Blob revisions and optional fit/position.
The engine owns acceptance, compressed originals, prepared GPU textures and
presentation. Immutable PNG originals survive live-DOM eviction without a
freshness expiry. Pane identity changes and workspace disposal release their
originals and destroy their GPU textures.

Display copies use premultiplied alpha to match the WebGPU canvas configuration.
Private readback copies use straight alpha to match PNG ImageData encoding.
Transparent gradients and overlays retain their color in both presentations.

Scrollbar thumbs and tracks are transparent only in recorded content. Chromium
can paint otherwise-hidden native overlay scrollbars into element images, making
them flash during panning. Changing their color preserves overflow behavior,
scroll positions and reserved scrollbar space. Ordinary DOM uses capture-scoped
CSS; same-origin iframe documents receive owned temporary styles, including
nested frames. Recording waits for a new paint when a document first receives
these styles. Live presentation and disposal remove the owned iframe styles,
restoring the consumer's scrollbar appearance and normal interaction.
Native and frozen presentation use matching density normalization. Matching
the native host and capture canvas preserves effective CSS zoom, text and border rounding,
descendant geometry and scroll offsets. Actual recording-density changes
preserve nonzero CSS scroll offsets: Chromium otherwise keeps physical offsets
across zoom changes. Offset restoration is immediate even when the consumer
requests smooth scrolling.

A capture replays a recorded element image into a private GPU texture, reads its pixels
into a bounded buffer and encodes a PNG. Encoding runs in one shared worker
created from an inline script, because main-thread PNG encoding of a Retina pane
blocks for tens of milliseconds and several hundred on first use; the pixel buffer
is transferred, not copied. Where a content security policy forbids the worker,
encoding runs on the current thread; a worker that fails mid-encode rejects that
capture, which retries later on the current thread. It uses neither screen sharing nor a
privileged viewport screenshot. GPU dimensions and padded readback allocation
are bounded before allocation; captured input has 128 MiB raster and 32 MiB
encoded limits. The source's owner document supplies browser resources. The last recorded image
can be encoded without moving native DOM. Acquisition without a current frame
requests a private recording with scrollbars suppressed. When that recording
replaces resized live DOM, the same fresh image updates the visible canvas before
asynchronous readback and PNG encoding begin. Encoding cannot expose an old-sized
frame in the new content bounds. Completion permits the native handoff. A changed readiness revision or source
size requires a fresh recording; stale pixels cannot be labeled as the new
layout. Temporary offscreen resources are released after capture.

Normal-view encoding is keyed to a recorded frame, its readiness revision and
source size. A changed source size permits a fresh recording even when native
presentation has already stopped the canvas paint loop. Native DOM updates do not
continuously record or encode pictures.
The next canvas handoff records current content; motion completion makes that
recording eligible for retention. Replacing a content host, explicit picture refresh and interrupted
encoding clear attempt suppression.

Chromium can omit accelerated descendants of canvases outside its paintable
extent, especially at negative coordinates. Cold capture temporarily presents
its canvas as an inert manual popover at the viewport origin. The displayed
buffer stays transparent; only the private capture texture receives pixels.
This preserves DOM ancestry, styling, dimensions, form state and iframe
identity. Completion and cancellation restore the ordinary canvas presentation.
Zero opacity can suppress accelerated descendant recording, so staging uses
transparent pixels with opacity one and disabled pointer input.

Only one capture/readback owns the acquisition slot at a time. Ready visible
content takes priority over speculative initialization. Surface identity,
readiness revision, local dimensions, connectivity and cancellation are checked
before acceptance. Camera movement alone does not invalidate a useful picture.
Pointer gestures and viewport resizing cancel speculative acquisition; ordinary
capture starts after navigation settles. A cancelled operation retains its slot
until its asynchronous cleanup finishes. Failures preserve accepted pictures.

## Retention budgets

Compressed originals and prepared texture bytes have independent 256 MiB default
ceilings. Neither ceiling is an allocation. `pictureBytes` counts original PNG
Blobs; `pictureRasterBytes` counts owned four-channel, eight-bit preview and detail textures using
width × height × 4. Live canvases, visible presentation buffers, browser caches
and transient capture/decode allocations are additional; these counters do not
claim to measure the browser's total GPU memory.

`PanePictureCache` owns immutable originals, prepared resources, admission,
priority and disposal. Every accepted original has a small prepared preview,
using the configured minimum long edge (128 pixels by default). Full detail is
prepared for normal visible panes and the first surrounding ring (normalized
center distance below two pane widths/heights), subject to capacity. This
neighborhood controls preparation priority, not retention: leaving it or entering
overview keeps already-prepared detail while it fits the budget. Capacity
pressure releases lower-priority detail while preserving its compressed original
and preview. Overview uses the same focus neighborhood for preparation. There is
no age-based quality reduction. Keeping reusable detail avoids repeated decoding
and uploads when navigation returns to a recently viewed pane.

Captured previews fill the recorded content rectangle. Rounding a reduced bitmap
to whole pixels must not make its slightly different intrinsic ratio introduce
letterboxing or change the displayed layout. Developer-supplied pictures retain
their requested fit and position. A retained picture keeps the pane background
beneath transparent pixels, without a placeholder icon or title showing through.

Preparation decodes an original and queues its upload serially, ahead of use.
Upload and presentation use the same ordered GPU queue, without waiting for all
shared GPU work to finish. WebGPU snapshots the external image when the copy is
issued, so the decoded bitmap closes after submission
([WebGPU copy semantics](https://www.w3.org/TR/webgpu/#dom-gpuqueue-copyexternalimagetotexture)). A retained
pane draws directly from its prepared GPU texture in the browser-preferred
canvas format, without decoding on the
presentation path. Only visible, covered panes configure an output canvas;
hidden outputs are reduced to one pixel. Connected output canvases keep their
WebGPU context configured: unconfiguring a canvas in this document can crash
Chromium during subsequent HTML-in-Canvas navigation. Resizing releases the
large drawing buffer; disposing the workspace destroys the shared device. Restoring detail uses
the original PNG and does not remount consumer content or recapture it. A cold
jump can show its prepared preview immediately and upgrade asynchronously;
limited memory cannot guarantee every distant full-resolution pane is ready.

Normal visible textures are protected. Capacity pressure releases lower-priority
detail first, then evicts complete unprotected entries if previews or compressed
originals cannot coexist. Speculative admission cannot evict existing previews.
Replacements need simultaneous capacity for old and new resources. Admission
first checks all reclaimable capacity; an impossible replacement must not demote
or evict retained entries. Reducing a
budget below protected usage defers enforcement until those resources become
eligible. In-flight preparation checks source identity and demand before
publishing, destroys stale resources and retains the previous usable picture.

PNG already compresses the stored originals losslessly. GPU block compression
would require an encoder before upload and a sampling presentation pass. It is
not used here: live text fidelity and encoding cost need separate validation.
The bounded prepared working set reduces resident source textures without
putting an encoder on the navigation path.

## Neighboring and overview pictures

`preloadMarginPanes` defaults to one. One missing pane within a pane's width and
height outside the stage can mount or resume, become ready, save a single frame
and return to its paused runtime. The queue finishes only after capture, rather
than treating initialization alone as a retained picture. Accepted pictures do
not need another speculative warmup. Zero disables this neighbor queue. `preloadAllPanePictures` additionally fills
missing distant pictures at rest, after visible work. Live activation, overview
capture and background acquisition share an outward order centered on focus.
Distance is measured in pane widths and heights using the larger axis, so
immediate neighbors, including diagonals, precede the next surrounding ring.
Changing focus reorders queued work; an acquisition already running may finish.
It reuses the same serial capture slot. A prepared background pane waits while
that slot is occupied, within its existing deadline; contention must not consume
its one acquisition attempt. Cold offscreen content mounts only for
that acquisition and unmounts after its one frame or a failed attempt; the saved
picture stays. Previously visited content follows the normal DOM retention budget.
Spare DOM budget never mounts additional cold overscan content. Speculation can release lower-priority detail,
but cannot evict existing previews to cycle through an
unaffordable workspace. Captured pictures suppress repeat warmups only while their
capture bounds match the current content dimensions. Layout and viewport changes
queue outdated offscreen captures again in the same outward order, preserving the
old picture until its replacement is accepted. Supplied pictures remain under
consumer control. After
eviction, navigation can make a missing neighboring picture eligible again.
Overview preserves already-painted canvas surfaces instead of staging them for
speculative acquisition. Queued admissions recheck this condition so entering
overview cannot replace an existing texture with a temporary placeholder.

Admission requires two consecutive timely animation frames. A healthy acquisition
contributes its last monitored frame to the next admission check, avoiding a fresh
observation delay between serial captures. The next callback still validates the
frame gap and callback latency. Stalled acquisitions and user activity discard
that timing evidence. Warming and capture never start while the camera moves:
a capture's readback and content initialization cost cannot be bounded, and on
discrete GPUs or slower processors a single capture can stall a navigation
frame for hundreds of milliseconds. Picture reconciliation and decoding of
existing pictures continue during motion. At rest a 40 ms frame-gap limit
permits gradual progress on browsers capped near 30 Hz; while other interaction
is active the limit is 20 ms. Both require callbacks within 8 ms of their frame timestamp. Slower
or busy frames defer admission, including at rest. Frame timing is also monitored
throughout mounting, readiness and capture against the admission cadence. Healthy
work needs no fixed pause; a missed frame introduces a recovery pause that grows
under repeated load, up to two seconds, and halves after healthy acquisitions.
The queue remains serial even when the browser has spare capacity. These checks
cannot predict arbitrary consumer initialization cost. Geometry, identity and connectivity are
revalidated. A serial warmup can temporarily mount one extra subtree beyond the
ordinary DOM budget. A warming pane entering normal view relinquishes capture
priority to live activation.

Content that finishes loading during settling or capture stays in the same
temporary slot until its readiness revision is stable. A capture invalidated by
a later load retries with the current revision without remounting the subtree.
That wait remains bounded by the original acquisition deadline; an unfinished
load is not a completed picture attempt.

A staged canvas also waits two browser frames before requesting its capture
paint. This lets the browser paint deferred descendants, including iframe lists
using `content-visibility: auto`, at the staged position. The wait is cancellable;
the original document, consumer styles and focus remain intact. The public canvas
stays transparent while pixels are copied into the private capture texture.

`captureMissingOverviewPictures` enables a separate serial queue at overview
rest, prioritizing a missing focused pane. It may temporarily mount one extra
subtree beyond the ordinary DOM budget. Only that pane resumes, and the saved
texture is prepared and presented before temporary content is released.
Presentation acknowledgement is bound to the current picture revision and
resource, so a stale completion cannot release a newer capture. Focus, layout and camera do
not change. Closing overview cancels its capture; readiness and acquisition
have deadlines so a failed pane does not prevent other pictures from loading.

Fast navigation can outrun readiness or available capacity. A placeholder is
still necessary for content that has never produced usable pixels. The engine
retains usable old pictures rather than replacing them merely because they age.

## Public boundary and verification

Consumer CSS layers, semantic variables, class/style slots and replaceable
controls remain applicable to original elements. No example CSS or capture
transport is required by the library. Cross-origin iframe pixels cannot be read
through HTML-in-Canvas; consumers need content hosted on their origin or an
authorized supplied picture. Onirigiri reports this capture boundary instead of accepting a blank iframe
snapshot. Cross-origin iframe content renders in the native host at rest, subject to the
browser's normal embedding policy. Its pixels remain unavailable to the capture
surface; a supplied picture is needed to represent it while frozen or cold.
WebGPU and HTML-in-Canvas remain required capabilities for capture and motion,
including when every pane uses native DOM at rest.

Chrome can record nested accelerated canvases at a different scale from their
native display ([Chromium tracking issue](https://issues.chromium.org/issues/540532973)).
The capture surface normalizes recording density using the element image's
reported width and the source's CSS width. Reciprocal CSS zoom and scale preserve
the displayed bounds, while percentage sizing preserves the original content
dimensions. Chromium rounds font and border metrics at the effective zoom, so
live and frozen presentation share that zoom to prevent layout shifts.
Recording scale is private surface geometry, outside the public theme-token
namespace.
A density change discards that recording and waits for another paint
before displaying or retaining pixels. A resized surface keeps its previous
drawing buffer until the replacement recording passes this density check;
resizing the buffer earlier would clear valid pixels during the retry.
Staged captures preserve the same density
adjustment when restoring their ordinary presentation. The image's density is
measured independently of `devicePixelRatio`: visible Retina Chrome and headless
Chrome can report different recording densities at the same emulated ratio.

Fullscreen comparisons cover text, controls, edge markers and untransformed
Canvas 2D graphics, including CSS resizing, padding, borders, shadows and an
overlapping positioned sibling, at landscape and portrait sizes. Original iframe,
canvas and input identities survive live-mode changes and overview transitions.
Rectangular pane chrome isolates content pixels from rounded-clip antialiasing.

Automatic picture acquisition excludes content containing graphics canvases,
custom elements, shadow roots, plugins or inaccessible frames. These panes keep
native content while mounted, including during frozen motion, so background
capture cannot temporarily replace their pixels with a faulty recording.
Consumers still receive the frozen runtime signal and control their clocks.
Developer-supplied pictures can cover evicted content. Acquisition exclusions survive
DOM eviction and navigation, and are reconsidered after identity changes, explicit
refresh or newly mounted capturable content. Explicit low-level PNG
readback remains subject to Chromium's nested-canvas capture limitations;
consumer CSS is not rewritten as a workaround. Open shadow roots present when
content is inventoried are detected; consumers attaching opaque shadow content
to an existing standard element should select native motion explicitly.

Contract and headless browser checks cover original document identity, edited
forms, readiness, cancellation, cache pressure, square-pixel images, real
same-origin DOM and nested GPU pixels. Pixel checks at device ratios one and two
exercise transparent display copies and private PNG readback. Native screenshot
comparisons in headless Chrome cover nested Canvas 2D pixels,
DOM markers, iframe identity, motion, staged readback and both resize axes.
Scrollbar checks cover motion and retained pixels, both scroll axes, native wheel
input, author styles, cancellation and disposal for direct and iframe content.
Motion/rest checks compare every descendant's bounds exactly at several pane widths,
including native text and form controls in same-origin frames. Raster comparisons
permit only small antialiasing differences between browser screenshot and texture
readback; layout tolerances are zero.
Engine checks capture an offscreen
neighbor before navigation and fill missing overview pictures serially.
The 100-pane interaction case exercises width, row-height and stacked-divider
resizing in both directions, including window resizing and retained form state.
The resize/background guards navigate through mixed native and canvas panes,
then resize the viewport and require all offscreen capture bounds to match their
current content. A separate pixel guard holds PNG encoding and checks a fixed
marker's exact position and dimensions before, during and after capture in both
presentation paths.
Repeated navigation through a fully cached 100-pane grid checks that each newly
visible covered pane has a populated texture output before motion settles.
A reduced-capture pixel check verifies the content reaches both side edges.
A scheduler contract steps overview camera moves frame by frame and requires every
on-screen pane to be active in the presented world frame and the grid cursor to
share the world camera's progress. A headless CPU browser check in the
`cpu-capability-browser` suite records each frame before paint during overview
moves in the two-dimensional playground and rejects any on-screen pane whose
content is not rendered.
The native-rest browser guard changes original iframe content and verifies its
displayed pixels without any further HTML-in-Canvas copies. It checks that the
content leaves the canvas at rest, returns during overview, and keeps its
document and edited input through the handoff. This case runs in the ordinary
`native-content-browser` Code Polishy suite selected by renderer changes.
Two-video checks require both streams to advance, displayed pixels to change,
native input to work and animation-frame cadence to meet 60 Hz at 1x and 2x.
Functional and sustained frame-rate checks are both required. The
[performance budgets](performance-budget.md) govern browser cadence, CPU
headroom, background acquisition and resize timing.

## CPU work during geometry requests

An elapsed pane-rearrangement clock rules out active rearrangements without
scanning host bindings. In-progress rearrangements still inspect mounted and
pending panes, including cancellation and unmounted ingress.
Pane views also reuse equivalent render-item fields across React boundaries;
changes to geometry, runtime, controls, callbacks or content still update the
view. This comparison adds no cross-request geometry cache.

Reserved-cell queries check for actual reserved blanks before resolving pane
geometry. Empty results need no scene copy for world-coordinate conversion.
Creating or removing a reserved split is reflected by the next query.

Completing missing pane shells constructs one pane-to-plane lookup for that
operation. A later request obtains the current scene; the lookup is never reused
across requests. An already complete inventory needs no scene copy. Camera sweeps
likewise obtain a scene only when they must materialize an absent pane. These
choices preserve existing shell objects and geometry while bounding scene scans
as pane count grows. Activation sorting computes each pane's distance once and
retains stable tie ordering and the original item identities.

The native content contract includes operation-count guards for shell completion,
layout queries and activation ordering. Separate headless CPU browser checks
exercise synchronous DOM mutations, protected-video capability queries, iframe
document replacement and observer cleanup without requesting graphics devices.
