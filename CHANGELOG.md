# Changelog

## Unreleased (beta)

### Added

- `keepHeightWhenSplitting` optionally divides a pane's current height when
  splitting up or down. It is off by default and preserves neighboring panes.
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

### Fixed

- Split dividers retain positive sizes that satisfy both panes' minimum heights
  when those minimums need more space than the original pair.
- Changing overview card width constraints updates the mounted workspace,
  including the follow camera, without replacing pane content.
- Restoring a layout preserves current workspace and pane-type defaults.
- Background picture preparation retains useful accepted images while new
  content becomes ready, and yields to navigation and visible interaction.

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
