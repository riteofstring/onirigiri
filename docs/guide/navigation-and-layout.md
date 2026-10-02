# Navigation, layout and keyboard

Camera and focus behaviour, compact layouts and the default keyboard shortcuts.

## Workspace navigation

Use keyboard shortcuts, direction controls or pane title bars to navigate. The
overview button switches between the focused view and the workspace overview.
Wheel and trackpad input retain browser and content scrolling behavior.

The default `focusAnchor="center"` centers the focused column horizontally and its row vertically.
Focus navigation and completed resize gestures use the same interruptible camera motion, while the
pane remains under the pointer during active resizing. Controlled hosts can choose leading-edge
alignment with `"start"`, and imperative hosts can call
`workspaceRef.current?.setFocusAnchor("center" | "start")`.

## Camera and focus highlight motion

`cameraMotion` sets the curve for each kind of camera move: `navigation` for normal-view focus
changes, `overview` for camera moves inside overview, and `zoom` for entering and leaving overview.
A curve is either a fixed duration with an optional easing function, or an exponential follow:

```tsx
import { onirigiriEaseOutQuad } from "@riteofstring/onirigiri";

<OnirigiriWorkspace
  cameraMotion={{
    navigation: { durationMs: 240, easing: (t) => t * t * (3 - 2 * t) },
    overview: { durationMs: 200, easing: onirigiriEaseOutQuad },
    zoom: { timeConstantMs: 70 },
  }}
  {...workspaceProps}
/>;
```

An easing function receives linear progress from 0 to 1 and returns eased progress; it reaches 1
at the end of the duration. A follow curve moves a fixed share of the remaining distance each
millisecond, so a retargeted move continues smoothly. Unset curves keep the defaults,
`defaultOnirigiriCameraMotion`: a 55 ms follow for navigation and zoom, and a 115 ms ease-out for
overview. Reduced-motion preferences still snap every move.

The focus highlight moves with the camera by default: it uses the same curve on the same frames,
so it stays still on screen while the world moves beneath it. Give it its own curve to time it
independently, or pass `false` to remove it:

```tsx
<OnirigiriWorkspace focusHighlight={{ motion: { durationMs: 115 } }} {...workspaceProps} />
<OnirigiriWorkspace focusHighlight={false} {...workspaceProps} />
```

`{ durationMs: 115 }` reproduces the earlier normal-view highlight, which ran slightly ahead of the
follow camera. Without the highlight, the workspace status region still announces the selected cell.
Style it through the `grid-cursor` slot and the focus tokens described in
[styling](styling.md).

## Minimap

Set `showMinimap` to add a small map of the workspace. It is off by default. The minimap draws every
pane as a box, highlights the focused pane, and outlines the area currently on screen. Clicking a
box focuses that pane. The minimap is hidden in overview. It renders in every layout the host
enables it for, so a host can, for example, default it off on phones and offer a toggle.

The minimap anchors to a corner of the stage (`bottom-right` by default). People can drag it
to another corner, where it snaps on release, and resize it from its inner corner. Set
`minimapAdjustable={false}` to lock it in place. Use `minimapPlacement` to choose the corner and
size, and `onMinimapPlacementChange` to persist what people choose:

```tsx
const [minimapPlacement, setMinimapPlacement] =
  useState<OnirigiriMinimapPlacement>({
    corner: "top-right",
    heightPx: 160,
    widthPx: 220,
  });

<OnirigiriWorkspace
  minimapPlacement={minimapPlacement}
  onMinimapPlacementChange={setMinimapPlacement}
  showMinimap
  {...workspaceProps}
/>;
```

Theme the minimap with the `--onirigiri-minimap-*` tokens. Each box carries
`data-onirigiri-minimap-pane-id` and `data-focused` for pane-specific styling.

The minimap is a pointer shortcut. It is hidden from assistive technology because keyboard
navigation and the workspace status region already provide the same movement.

## Compact and mobile layout

At `compactBreakpoint` (640px by default), Onirigiri becomes a full-screen pager. The focused pane fills
the entire available stage, workspace controls move into a safe-area-aware bottom bar, and resize
handles are removed. Only the focused pane remains live and interactive;
other mounted panes are inert frozen previews, so application work does not continue invisibly.
Sparse 2D slots collapse to the columns that actually exist on each plane while compact mode is
active, avoiding blank mobile pages without changing the saved desktop layout.

The classic compact layout is edge-to-edge: the focused pane fills the stage, and neighboring panes
sit one column gap away horizontally and vertically, so the gap is visible while moving between them.
Set `compactPanePeek` to reserve a small hint of the previous and next panes when they exist:

```tsx
<OnirigiriWorkspace
  compactBreakpoint={640}
  compactPanePeek={18}
  {...workspaceProps}
/>
```

`compactPanePeek` is clamped to 32px and affects compact mode only. Leaving it unset preserves the
full-bleed behavior.

## Keyboard shortcuts

Onirigiri maps its `Mod` key to Alt (Option on Mac). Alt+Arrow or Alt+H/J/K/L moves the workspace cursor exactly one adjacent
logical cell, including an empty cell; it never skips space to find a pane. `focusedPaneId` is derived
from that cursor and is `null` for an empty cell. Spatial workspaces are logically unbounded within
JavaScript's exact signed-integer coordinate range. Set `gridAxes="horizontal"` when a workspace should
traverse local split cells vertically but never cross into another logical row; the default is `"spatial"`.
Empty coordinates remain mathematical geometry and do not create scene columns, pane hosts, or textures.
Set `cursorRunway={N}` to restrict adjacent empty-cell navigation to the current pane bounding rectangle
plus `N` logical rows and columns on every side. The default remains unbounded. Pane creation,
rearrangement, restoration, direct pane focus, and `returnHome()` remain unrestricted, so a runway can
never make a pane inaccessible. When removing or moving an edge pane contracts the runway around a cursor
that is already outside it, inward steps remain available until the cursor re-enters.
One decorative `grid-cursor` surface draws the selected cell in normal and overview presentation; it
is not a Tab stop or assistive-technology target, while the workspace status region announces the
coordinates and selected pane title or `Empty cell`.
Alt+Control+Arrow or Alt+Control+H/J/K/L moves only the focused pane into the immediately adjacent plane/slot/row cell: it leaves an empty
source cell behind when needed and swaps panes atomically when that cell is occupied. Rearrangement keeps
focus on the moved pane and the camera follows it by default. The two-dimensional playground's camera
control can switch to **Fixed** to leave the camera stationary during rearrangement, including in overview.
The choice is retained for the mounted playground session. Alt+Home/End focuses the first or last
column, Alt+Shift+Home returns to the workspace home pane, and Alt+O (Option+O on Mac) toggles overview. Control+Shift+Enter still splits right,
Control+Shift+Alt+Enter splits down, and Control+Shift+[ or ] creates a plane above or below.

Alt+Shift+G selects the focused split column as one rearrangement group; Alt+Control+Shift+Arrow moves that
group one adjacent slot or plane while preserving its row order and reserved blanks. Alt+Shift+Left/Right
inserts the focused pane as a split in an adjacent full-height pane, and Alt+Shift+Up/Down creates a reserved
blank split above or below it. Alt+Control+Shift+Home/End removes the reserved blank above or below. These
actions are public imperative-handle commands and individually customizable through `OnirigiriShortcutBindings`.
The playground exposes the same actions with native buttons; selected groups use a static titlebar cue and
announcements, and Escape returns to single-pane selection.

Pane movement has no terminal structural edge: moving beyond a leading or trailing slot or plane creates
one literal adjacent cell and rebases stored indexes when necessary. The renderer keeps bounded viewport
overscan without eagerly mounting consumer content, and a focused pane remains retained even when Fixed
camera mode has moved it beyond the visible corridor. Returning uses its exact destination-cell geometry
and the original consumer host.

Each `columns[].cells` record is the sole structural owner of `paneId`, `reserved`, `weight`, and optional
`heightPx`; panes own identity and content only. Swaps exchange pane identities while destination cells retain
their geometry. A transient vacancy collapses to one full-height cell when only one ordinary pane remains in
its stack. A user-created `{ paneId: null, reserved: true }` blank instead remains visible and serializable
until it is filled or explicitly removed. Blank cells never create or retain a pane host, title bar, action
controls, resize handle, content surface, focus target, or pointer target. The same directional command works
in overview; only hosts whose displayed visual boxes change retarget between overview-card boxes. Equal-size
swaps move without a scale entrance, while reversals continue from the in-flight visual box without remounting
consumer content. Fixed mode leaves the camera still; Follow mode retargets the camera from that same displayed
box. Persisted layouts use schema 4 only; older layouts are rejected rather than migrated or interpreted through
a compatibility path.

Within a stacked column, a vertical rearrangement uses the next structural row. At the top or bottom of a
stack it enters the aligned column in the adjacent plane at that plane's near edge: Down enters its first
row and Up its last. This makes an immediate reversal return through the same structural boundary without
adding a split row to an asymmetric destination. Normal and overview presentation both begin from the exact
displayed pane boxes; Fixed leaves the stage still and Follow retargets the stage on the same clock. Ordinary
Alt+Arrow cursor navigation visits every adjacent logical grid cell permitted by the optional runway. It
returns `false` when a configured runway, horizontal topology, or exact integer exhaustion prevents another coordinate. On an empty
selected cell pane commands return `false` rather than acting on a prior pane. This is deliberately distinct
from Alt+Control+Arrow pane rearrangement, which may create the literal adjacent structural cell and moves the
existing pane host into it.

Clicking an overview card preserves the displayed overview pan and zoom for the start of the exit, then
interpolates directly to that pane's exact normal-mode focused target. It does not issue a separate focus
scroll or reset the overview camera before the one exit trajectory completes.

`shortcutScope="workspace"` is the safe default for an embedded workspace and handles shortcuts only
while focus is inside Onirigiri. Use `shortcutScope="application"` when Onirigiri is the application's primary
surface; its shortcuts continue working while ordinary app chrome such as toolbar buttons has focus.
The first application-scoped workspace starts active, and pointer or focus activity selects the
active workspace when more than one exists.

Pass a partial `shortcuts` map to replace individual defaults. Each binding uses `KeyboardEvent.key`
and exact modifier booleans; character keys are matched case-insensitively.
On Apple keyboards, an Option-modified letter can arrive as a different character
(for example, Option+O produces `ø`). If no character binding matches, the
corresponding physical letter key from `KeyboardEvent.code` is tried with the
same modifiers. Explicit character bindings take precedence; text inputs and
composition retain their existing shortcut exclusions.
An action can have one binding or a readonly array of bindings:

```tsx
import {
  OnirigiriWorkspace,
  defaultOnirigiriShortcuts,
  type OnirigiriShortcutBindings,
} from "@riteofstring/onirigiri";

const shortcuts = {
  focusLeft: [
    ...defaultOnirigiriShortcuts.focusLeft,
    { altKey: true, ctrlKey: false, key: "a", metaKey: false, shiftKey: false },
  ],
  splitDown: [],
} satisfies OnirigiriShortcutBindings;

<OnirigiriWorkspace shortcuts={shortcuts} {...workspaceProps} />;
```

An empty array disables that action. Set `shortcuts={false}` to disable all configurable shortcuts.
Escape always retains its exit-overview and restore behavior. Editable controls, content-editable
content, composing input, and modal dialogs keep their native keyboard behavior. Custom modal
overlays should use native `<dialog>` or `role="dialog" aria-modal="true"`; a host can also switch
back to `shortcutScope="workspace"` while a custom overlay is open.
