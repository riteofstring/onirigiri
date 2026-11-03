# Workspace state

Each workspace owns Zustand vanilla stores. The authoritative immutable state is the current
layout snapshot: cursor, focus, presentation, camera coordinates, selection, and
revisions. The layout command controller reads and updates that state directly;
there is no parallel snapshot cache or custom listener registry.

The existing `OnirigiriLayoutStore` command interface coordinates the layout engine,
workspace sizing, and camera calculations. Those domain operations remain outside
React. Scene geometry and transient animation integration belong to their domain
controllers; completed values are published into Zustand. Independent workspace
instances never share a global store.

A separate Zustand store publishes the complete command snapshot once per command.
Frame updates change only the current state. This preserves command notification
ordering when a subscriber adjusts camera coordinates synchronously: another
subscriber receives the original command after the first subscriber finishes.
Neither frame interpolation nor those camera adjustments emit command events.
The frame scheduler owns presentation boundaries, so React does not rerender the
pane tree on each interpolated frame.

Focused-pane frame notifications carry the presentation's motion state even when
the final geometry is unchanged, so hosts can wait for actual settlement instead
of guessing the camera's duration; they never schedule or pause consumer content.

Every new focus or camera destination publishes a request boundary, including
commands issued during an unfinished move. That boundary prepares content and
retained-picture outputs for the new camera sweep. Existing pane shells alone
do not establish display readiness. Animation frames continue to update geometry
without publishing React boundaries.

Camera motion has one curve model shared by normal navigation, overview moves
and the overview zoom: a fixed duration with an easing function, or an
exponential follow. Follow curves keep the existing per-frame integration with
its distance-based settlement. Duration curves restart from the displayed
position when their target changes. The focus outline follows the active camera
curve by default and starts on the same frame as the store camera, so the
camera and outline progress identically and the outline stays fixed on screen.
An explicit outline curve keeps its own timeline instead. Disabling the outline
removes its element; cursor geometry and announcements are unchanged.

Following overview preserves the displayed world and outline when a navigation
command retargets an unfinished move. A new motion still presents its starting
pose once, but retargeting an active overview move does not restart that delay.
The camera and outline can therefore advance between repeated target changes.
When the default camera-following outline joins an existing overview pan, or the
camera joins an existing outline move, they share any owed starting frame.
Pane rearrangements retain their shared initial frame so their geometry, world
and outline start together. Normal navigation and independently timed normal-view
outlines retain their existing timing.

Store-driven navigation resets the overview presenter only when that presenter
has an active motion to cancel. Resetting an idle presenter would reapply its
previous frame, recenter the grid and clear the world's movement promotion hint
between commands and animation frames. Ordinary frame presentation expands the
grid when its cached bounds no longer cover the viewport. Explicit reduced-motion
paths still reset presentation synchronously, including when no overview timeline
is active.

The focus outline animates between selected cells, maximized states and pane
rearrangements. Other layout changes within the same selection, including column,
row and split resizing, update its bounds on the same frame as the pane. Such
geometry changes cancel any unfinished focus transition so the outline cannot
trail the resize gesture. A layout revision whose rendered destination is
unchanged, such as a pane rename, preserves the camera and outline timelines.
Titles and serialized layouts still publish immediately. Each command compares
its destination with the active motion's endpoint, so a rename cannot conceal
a resize before the next animation frame.

Moving the focus outline alone does not mark stationary panes as moving. Content
stays live and accepts the original pointer gesture when focus changes without
revealing a new camera position. The scheduler continues the outline's timeline
independently; camera, overview and pane rearrangement motion still protect content
from input during movement.

Zustand is an exact runtime dependency, externalized from the library bundle.
No persistence middleware is used: the existing explicit layout serialization and
restore contract remains responsible for persisted layout data. Picture blobs,
browser resources, and animation handles have separate resource lifetimes.

A restore normally starts a fresh presentation: it leaves overview, clears
maximization and snaps the camera to the restored cursor. A host that rebuilds
the layout because its panes came or went asks the restore to keep the
presentation instead. Overview stays open and follows the restored cursor, a
maximized pane that survives stays maximized, and a settled normal camera lands
on the restored cursor, so a host's membership changes do not undo the user's
view. A normal camera that is still travelling keeps travelling toward the
restored cursor instead of landing at once; landing would finish the camera in
one frame while the focus outline's own motion continued, so the two would
separate. The travel continues from the current column coordinates, which a
column inserted before the camera reinterprets; hosts that must avoid that
jump can defer the restore until the camera settles.

Boundary tests cover complete command notifications, immutable prior snapshots,
unsubscription, independent workspaces, layout restoration, and continuous camera
motion. Browser tests cover keyboard navigation and retained pane presentation.

Changing overview card width constraints on a mounted workspace invalidates the
geometry revision and reapplies the current overview camera mode around the same
selected pane, deliberately resetting manual overview pan and zoom to the new
baseline while preserving the layout, normal camera and pane content. Unchanged
constraints publish no command; updates outside overview apply on its next entry.
Layout restoration reads the current scene configuration so runtime default
sizes remain authoritative while explicit saved pane sizes retain precedence.

Overview zoom preserves the point under its focus, keeping any translation that
the bounded pan cannot absorb in the follow offset. Manual pan uses the displayed
translation, including that offset. A view outside the ordinary pan range can
move incrementally back toward that range without snapping or moving farther
away; once inside, the existing pan limits apply. Zoom focal stability and
unbounded cursor navigation remain unchanged.

Workspace navigation is driven by keyboard commands, explicit controls and pane
selection. Wheel events retain browser and consumer-content semantics in both
normal and overview presentation. This keeps nested scrolling independent of
workspace focus and camera motion. Overview entry and exit use complete commands
with the existing animated or reduced-motion presentation.

Spatial grid coordinates are signed safe integers with no camera or structural
edge. Horizontal topology permits vertical traversal within a split stack but
prevents transitions to another logical row; spatial topology permits both axes.
An optional non-negative cursor runway restricts adjacent empty-cell navigation
to the current pane extrema plus its configured distance. Pane operations, direct
focus, restoration and camera targets remain unrestricted. The scene stores
topology rather than a mutable bounds snapshot, and the layout store refreshes
pane extrema only on layout changes. Runtime row or column insertion therefore
cannot create structure beyond stale camera authority. Layout schema 4 persists
the cursor and structural coordinates without serializing topology or runway;
restoration applies the current workspace configuration and rejects inexact
coordinates.

Structural edits keep that coordinate space. Splits, openings beside a pane
and group moves target the literal adjacent row or column. When that row or
column is occupied, the rows or columns from it outward shift one step away from
the source, so the source pane never moves. Removing a pane drops empty columns
without renumbering the remaining rows or columns. Only scenes built from pane
definitions, without a restored layout, start from dense non-negative rows.

Empty cells are sparse geometry. Column and row offsets combine a default stride
with sorted structural overrides and prefix differences, so lookup work depends
on structure rather than distance from the origin. Normal camera targets are not
clamped to structural extents. Overview derives a finite local range from
structural cells plus the cursor, while the dotted world grid remains bounded to
the viewport and motion overscan. Navigation does not allocate empty columns,
DOM, textures, observers, captures, or persistent geometry caches.

The pane selected by the initial cursor is the runtime Home target and follows
that pane's identity when it moves. If it closes, Home falls back to the first
surviving pane. Returning Home bypasses the cursor runway and exits overview
through the existing focus transition without changing layout or pane content.

Pane links treat the page URL as an optional external view of focus, not as
layout state. Pane identities are the link vocabulary because they are the only
coordinates that survive moves, splits, plane changes and restoration; layout
documents reject duplicate identities and every focus command resolves a pane by
identity. Before the first viewport measurement, a valid linked identity
replaces the initial cursor and snaps the camera, so the first painted frame is
already there and no camera flight or reduced-motion branch is involved. Home
remains the pane at the initial cursor. A single store subscription mirrors
focused-pane changes from every command source into one query parameter, and the
URL is written only when it differs, so history traversal that focuses a pane
does not write again. Other parameters keep their original encoding, and the
existing history state is retained. Browser access lives in effects, which keeps
server rendering free of window access.

A vertical split normally leaves both halves flexible, so they share the full
available height and a height-limited pane's row grows. `keepHeightWhenSplitting`
measures the source pane in the store's last viewport before the split and
fixes both halves to that height less the row gap, through the same constrained
divider sizing as dragging the split. Flexible neighbors, including reserved
cells, keep their measured heights as explicit sizes so they cannot absorb the
source's unused height. Existing explicit sizes and preferred heights remain
unchanged. If the halves' constrained minimums do not fit, the split grows to
accommodate them and retains positive, restorable cell sizes. The measurement
happens once, at the split; later viewport changes keep the explicit heights
like any other resized split.

Pane resize handles preserve the selected pane for pointer, keyboard and reset
gestures. Width resets address the resized pane's column directly. Each edge
reuses the column-width or plane-height command and holds its opposite edge in
screen coordinates. Measuring the resolved cell geometry before and after the
command accounts for changes to columns or rows preceding the selected cell,
as well as width and height limits. The current and target camera anchor offsets
move only by the distance the fixed edge would otherwise move. The
compensation is applied before the command is published, so frame and React
presentation never observe the uncompensated layout. A top handle between two
stacked panes is the same split control as the bottom handle above it. When a
gesture ends after changing an outer row, the selected pane in that row returns
to its configured vertical anchor. At rest, current and target vertical anchors
are updated together, leaving horizontal placement, logical scroll and selection
intact. This is one placement correction without a camera flight, so responsive
live content stays live. Existing vertical motion keeps interpolating toward its
updated destination. Keyboard row-height changes and resets use the same rule.
A handle press without a layout change and resizing another row retain the
camera position. Overview keeps its own camera. Split and width gestures,
keyboard split or width changes and their resets retain their adjusted placement.
Ordinary navigation and explicit focus-anchor changes still choose their normal
camera destinations.

Normal camera coordinates remain logical rows and columns, with local pixel
anchors for centering and compact alignment. Geometry is projected relative to
the active camera and to a bounded floating world origin, so adjacent cells stay
distinct across the full safe-integer coordinate range. The world origin changes
only when the cursor crosses a large coordinate chunk and participates in motion
cache identity. Ordinary projection uses number arithmetic; exact integer
subtraction is reserved for spans whose numeric difference is not safe. These
choices keep frame work and memory proportional to sparse structure rather than
coordinate magnitude.

Logical vertical interpolation uses a tighter settlement tolerance than pixel
anchors and horizontal column interpolation. This preserves the established
subpixel vertical settling duration and keeps swept presentation active until
the normalized row motion is visually complete.

Column and row geometry share the column widths already resolved within a single
query. Camera targets reuse that geometry when measuring the selected cell and
compute its center only for the centered anchor. Scene serialization still
returns independent column, cell and map containers; it counts columns per plane
in one pass. No geometry or scene snapshot is cached across requests by these
paths.
Cursor normalization reads the current columns directly rather than serializing
the scene. Overview cursor bounds and overview transforms use one resolved
geometry within their query, including signed cells outside the pane range.

The optional minimap is a navigation aid, not a second scene. The frame
scheduler hands each presented frame's world-space pane items and on-screen
world transform to a minimap presenter, which writes one SVG view box, one
visible-area rectangle and one rectangle per pane. Frames update attributes in
place; rectangles are created or removed only when the pane set changes. The
map spans the panes plus the visible area, so it stays meaningful on the
unbounded plane without a fixed extent. It draws plain boxes only: pane
pictures, titles and icons stay with the panes. Overview hides it because
overview already shows the whole structure; every other layout, including
compact, follows the host's `showMinimap`.

Clicking a pane box uses the ordinary pane focus command; the minimap has no
camera command of its own. Its placement belongs to the minimap component, not
the layout snapshot: a corner plus a pixel size. Hosts seed or replace it with
`minimapPlacement` and persist it from `onMinimapPlacementChange`. When
adjustment is enabled, dragging past a small threshold moves the minimap and
snaps it to the nearest stage corner, and the inner-corner handle resizes it.
Both gestures write inline styles during the drag and commit one placement on
release.

At settlement the scheduler restores every visible pane's live runtime in the
same boundary. Cover and content readiness still govern presentation, but no
pane remains frozen merely to spread uncovering across later stationary frames.

Layout geometry owns column and row projection, viewport sizing and overview
frames in `layout-engine-geometry.ts`; `layout-engine-base.ts` owns scene edits
and structural sizing. Column visibility selection lives separately from cell
and grid sizing. The layout store inherits camera and focus operations from
`layout-store-camera.ts`, sharing its existing Zustand state through typed
hooks. Structural commands and command publication stay in `layout-store.ts`.
Neither boundary introduces a second scene or snapshot cache.
