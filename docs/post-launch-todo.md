# Post-Launch Fixes

Known defects and verification gaps deferred past the first release, ordered by
user impact. Evidence comes from the reference machine (2022 M2 MacBook Air,
Chrome 154.0.8037.93) and focused reproductions against commit `2ae5c57`.

## User-facing defects

- [ ] **Splits and group moves break signed, sparse spatial coordinates.**
      Ordinary pane movement supports negative and sparse coordinates, but
      structural insertion and cleanup do not. `insertColumnInPlaneSlot` in
      `src/layout/layout-engine-base.ts` clamps the slot index to zero or above, and
      `insertPlaneAt` in `src/layout/layout-planes.ts` densely renumbers planes.
      Reproductions:
  - Move a pane down three times, select its group, then move the group down.
    It jumps from row 3 to row 0 instead of row 4.
  - Move a pane up to row −1, then split right. The new pane appears on row 0
    instead of beside it.
  - Move a pane left to column −1, select its group, then move left. It jumps
    right to column 0 instead of column −2.

  Fix: make structural insertion and cleanup preserve signed, sparse
  coordinates. Add a layout test for each reproduction; existing focused tests
  do not cover them.

- [ ] **Pointer input cannot reach live content in canvas presentation.** With
      `presentation: "canvas"`, a click on live pane content hits the
      `onirigiri-pane__live-surface` canvas, so inputs, links and native video
      controls ignore the pointer. HTML-in-Canvas makes `layoutsubtree` descendants
      hit-testable only after `canvas.updateElementGeometry(element)`; WebGPU
      presentation must call it explicitly, and `PaneCanvasSurface` in
      `src/pictures/pane-picture-canvas.ts` never does. A probe confirmed that one
      call restores clicks, typing and video controls.

  Fix: call `updateElementGeometry` whenever content is presented through the
  canvas and `clearElementGeometry` when it returns to native presentation or
  is disposed. Add a browser test that clicks into a canvas-presented pane with
  a real pointer; existing tests use `focus()` or `fill()`, which bypass hit
  testing. This also fixes the reproducible failure of "two videos keep live
  pixels and 60Hz with native input" at 1x and 2x.

- [ ] **Moving form content triggers Chrome password-manager scans that drop
      frames.** Each `moveBefore` of live pane content containing form controls
      (`moveInto` in `src/pictures/pane-picture-content.ts`) is followed 75–110 ms
      later by `ExtractFormsAndNotifyPasswordAutofillAgent`, a 47–108 ms
      renderer main-thread task. It causes the single 33–50 ms frame in
      `live-navigation-100` and `live-overview-100`, and 100 ms frames under 2x CPU
      throttling. Branded Chrome users see it; `chrome-headless-shell`, used on
      Linux, has no password manager. Profile preferences do not disable it.

  Fix: avoid reparenting form-containing content at every motion boundary, or
  schedule moves so the scan lands while the workspace is at rest.

## Performance

- [ ] **`overview-500` exceeds the 120 Hz CPU budget.** Onirigiri boundary work
      p95 measured 12.1–14.7 ms against 8.33 ms at 4K, 5K and 6K. Profiled causes:
  - The `pictures.configure` layout effect in
    `src/workspace/OnirigiriWorkspace.tsx` runs `refreshSurfaces` and emits for
    every pane host on each commit.
  - `workspaceGridCursorRenderItem` calls `gridCellBox`, which recomputes full
    column geometry every frame instead of reusing the frame's geometry.
  - `measurePaneContent` reads `getBoundingClientRect` for every pane during
    layout effects.

  Fix: limit the `configure` fan-out to panes whose inputs changed, and share
  column geometry between pane render items and the cursor.

## Verification

- [ ] **`workspace-performance` cannot finish on the reference machine.** Its
      23 desktop scenarios take 6.2 minutes, but `timeoutSeconds` is 300. Raise the
      timeout or split the suite.
- [ ] **Decide whether one dropped frame should fail mean cadence.** The mean
      budget allows 0.07 ms above the refresh interval, so a single 33 ms frame in
      about 300 fails a scenario. Revisit after the password-manager fix.
- [ ] **Stabilize "large viewports paint every loaded same-origin frame".** It
      failed once with `pane-77` at zero ink and passed on rerun.
- [ ] **Investigate camera starvation in headless Linux.** "keeps the focus
      highlight still on screen while the camera follows" measures `worldTravel`
      near 38 px on Linux against about 316 px on the reference machine. The
      `> 40` threshold is correct; the Linux camera barely advances within 600 ms.
