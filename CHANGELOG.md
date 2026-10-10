# Changelog

## Unreleased

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
