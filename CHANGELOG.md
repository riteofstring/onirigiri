# Changelog

## Unreleased

### Added

- `focusPaneOnPointer` (default `true`) can stop a pointer press from focusing
  its pane, for hosts that focus panes themselves.
- `captureOnirigiriPanePicture(element, signal, recorded?)` captures a PNG of a mounted
  pane's content for host-managed persistence, or returns `null` when it cannot,
  including when `panePictures` is off.
- Pane render state includes `settledVisible`: whether the pane is visible where
  the current navigation will come to rest.

### Changed

- Breaking: pane pictures are opt-in. Pass `panePictures` to let the engine
  capture and show pane pictures; without it the engine takes none, shows none,
  including pictures from `getPanePicture`, and panes stay live.
- Set `panePictures` when the workspace mounts. Changing it on a mounted
  workspace is not supported; remount the workspace instead.
- A maximized pane respects its resolved `maxHeight`. Full sizing still uses
  the whole viewport height.
- An empty row takes the height a default pane would get, so its grid cursor
  matches capped rows.
- Default titlebars of panes outside the viewport are hidden.
- Covered visible panes all return to live content on the first stationary
  frame after navigation, instead of one per frame.
- `focusAnchor="start"` aligns only the left edge; the focused row stays
  vertically centred.
- `configurePane` updates an existing pane without selecting it or moving the
  camera. Opening and focusing panes still navigate.
- A new pane in a row whose height was resized takes that row's height, and an
  empty column slot takes the default pane width.
- A pointer resize has one owner per workspace; other pointers wait until it
  ends.

### Fixed

- Element images are recorded at the canvas's drawing size, so Chrome 156
  pictures are no longer misscaled.
- A pane whose canvas has no frame to show presents its content directly.
- A capture that is aborted after recording still finishes encoding.
- Overview entry and exit settle at their endpoints when rearrangement
  interrupts them.
- Changing pane defaults right after mounting keeps the camera centred.
- A still restore that moves the cursor places the focus outline without
  gliding.

### Removed

- Breaking: the `cursorTargets` option is removed. Arrow keys always step into
  empty cells; they never skip to the next pane.

## 0.4.0-beta.1 - 2026-10-27

### Added

- `togglePaneMaximized(paneId)` lets host controls maximize or restore a pane
  through the same behavior as its titlebar button.
- `onFocusedPaneFrame(frame, moving)` reports displayed pane geometry and the
  motion boundary so hosts can defer expensive work until navigation rests.
- `useOnirigiriPaneInteractive()` reports when live content accepts input.
- `cursorTargets="panes"` skips empty cells. `focusPane` can exit overview,
  and `restoreLayout` can retain the current presentation mode.
- Supplied pictures accept their captured `cssSize`. Images remain anchored
  at the top-left, clip when panes shrink, and expose the background when
  panes grow. `onPanePictureCaptured` provides a PNG and its capture bounds
  for host-managed persistence. Replaceable pictures can seed later captures.
- Optional `restPictureFade` briefly fades a saved picture over ready, interactive
  live content after navigation settles. It does not animate pictures in motion.

### Changed

- The exported `WorkspaceLayoutStore.resetFocusedColumnWidth()` method is now
  `resetPaneColumnWidth(paneId)`, so width reset targets the named pane.
- Ready panes uncover one per frame as navigation settles, with the focused pane
  first, while retained pictures cover panes awaiting activation.

### Fixed

- Pane-edge resizing preserves selection and keeps the resized pane stationary
  after release. Manual row-height changes recenter the selected row without
  starting a camera flight.
- Picture presentation follows the frame scheduler's motion phase, keeping
  retained coverage aligned with the displayed frame through settling.
- Repeated overview navigation and pane renaming preserve camera continuity,
  selection and grid positioning.
- Background worker captures are embedded in package builds and retain pane
  geometry, original iframe state and useful pictures through recovery.
- Custom placeholders observe input eligibility through motion and rest;
  opted-in editing shortcuts work in text fields.
- Changing overview card width constraints updates the mounted workspace,
  including the follow camera, without replacing pane content.
- Restoring a layout preserves current workspace and pane-type defaults.
- Background picture preparation retains useful accepted images while new
  content becomes ready, and yields to navigation and visible interaction.
- Retained pictures held only at preview detail are no longer presented under
  full detail. The host placeholder covers the pane until full detail is
  prepared, so a reduced texture never replaces a sharp host cover; explicit
  `{ kind: "texture", detail: "preview" }` still presents the reduced texture.
  Panes the host has not marked visible keep their placeholder instead of an
  empty cover, and overview capture releases temporary content when a card's
  detail cannot be prepared.

## 0.3.0 - 2026-10-10

### Added

- `keepHeightWhenSplitting` on `OnirigiriWorkspace` (off by default). With
  it, splitting a pane up or down divides the pane's current height between
  the two halves, so a height-limited pane's row keeps its height. Without
  it, each half takes its share of the full available height as before.

### Fixed

- Keep layouts restorable when a height-preserving split cannot fit both panes'
  minimum heights, and preserve neighboring panes and reserved cells in the stack.

## 0.2.0

Changes since 0.1.0. All 0.1.0 exports, props, defaults, styling slots and
saved-layout formats still work; layouts saved by 0.1.0 restore unchanged.

### Added

- `paneLink` on `OnirigiriWorkspace` (off by default). With it, `?pane=<id>`
  opens the workspace on that pane wherever it sits, the URL follows focus
  once it settles (keeping other query parameters and the hash, with
  `history: "replace"` by default or `"push"`), and `popstate` focuses the
  linked pane. `onirigiriPaneHref(paneId)` builds such a link.
- `resizeEdges` in `PaneDefaults` (workspace, pane-type or per-pane) chooses
  which edges carry resize handles, including new `left` and `top` handles
  that keep the opposite edge still while dragging. The default stays
  `defaultPaneResizeEdges` (`["right", "bottom"]`).
- Resize handles carry `data-resize-edge`; the styling contract version is
  now 9.

### Changed

- Splits, openings beside a pane, group moves and closes keep the existing
  row and column numbers instead of renumbering them. Moves beyond an edge
  can create negative rows or columns, and closing the only pane of a row
  leaves that row (and the cursor) in place rather than collapsing it, so
  `getLayout()`, `onLayoutChange` and saved layouts may contain negative
  numbers and gaps. Scenes built from pane definitions still start at
  row and column 0.
- Duplicate pane ids, and saved layouts that place an unknown pane or one
  pane twice, now fail with messages naming the pane and columns involved.

### Fixed

- Pointer input reaches live content presented through the canvas.
- Pane layout is no longer forced at every presentation boundary.
