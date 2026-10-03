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

The focus outline animates between selected cells, maximized states and pane
rearrangements. Other layout changes within the same selection, including column,
row and split resizing, update its bounds on the same frame as the pane. Such
geometry changes cancel any unfinished focus transition so the outline cannot
trail the resize gesture.

Zustand is an exact runtime dependency, externalized from the library bundle.
No persistence middleware is used: the existing explicit layout serialization and
restore contract remains responsible for persisted layout data. Picture blobs,
browser resources, and animation handles have separate resource lifetimes.

Boundary tests cover complete command notifications, immutable prior snapshots,
unsubscription, independent workspaces, layout restoration, and continuous camera
motion. Browser tests cover keyboard navigation and retained pane presentation.

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
