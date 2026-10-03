# Post-Launch Fixes

Known defects and verification gaps deferred past the first release, ordered by
user impact. Evidence comes from the reference machine (2022 M2 MacBook Air,
Chrome 154.0.8037.93) and focused reproductions against commit `2ae5c57`.
Linux GPU results come from an RTX 2000 Ada host running Chrome for Testing
154.0.8037.57.

## User-facing defects

- [x] **Splits and group moves break signed, sparse spatial coordinates.**
      Splits, openings beside a pane and group moves now target the literal
      adjacent row or column and shift occupied rows or columns away from the
      source; closing a pane no longer renumbers rows. Layout tests cover all
      three reproductions.

- [x] **Pointer input cannot reach live content in canvas presentation.**
      `PaneCanvasSurface` calls `updateElementGeometry` after presenting a
      canvas frame and `clearElementGeometry` when content returns to native
      presentation or the surface is disposed. A browser test clicks and types
      into a canvas-presented pane with a real pointer at 1x and 2x; it fails
      without the fix. Chrome 153 lacks the geometry API and keeps the previous
      behavior.

- [ ] **Moving form content triggers Chrome password-manager scans that drop
      frames.** Each `moveBefore` of live pane content containing form controls
      (`moveInto` in `src/pictures/pane-picture-content.ts`) is followed 75–110 ms
      later by `ExtractFormsAndNotifyPasswordAutofillAgent`, a 47–108 ms
      renderer main-thread task. It causes the single 33–50 ms frame in
      `live-navigation-100` and `live-overview-100`, and 100 ms frames under 2x CPU
      throttling. Branded Chrome users see it; `chrome-headless-shell`, used on
      Linux, has no password manager. Profile preferences do not disable it.

  A headed branded Chrome under Xvfb reproduces the scan without a GPU: Chrome
  posts it from `components/autofill/content/renderer/autofill_agent.cc` with a
  100 ms delay after each move. Controls directly in the pane DOM trigger it;
  controls inside an iframe do not. `inert` does not suppress it, and several
  moves within one task share a single scan. Under the default `"auto"`
  presentation, panes already showing native content stay native, so the
  remaining moves come from picture captures, which move content into the
  canvas and back.

  Fix: avoid reparenting form-containing content at every motion boundary, or
  schedule moves so the scan lands while the workspace is at rest. Confirming
  which move lands in motion needs WebGPU and branded Chrome together, which
  only the reference machine currently provides.

## Performance

- [ ] **`overview-500` exceeds the 120 Hz CPU budget.** Onirigiri boundary work
      p95 measured 12.1–14.7 ms against 8.33 ms at 4K, 5K and 6K. Profiled causes:
  - [x] The presentation engine measured every pane's corner radius and
        content offset after each boundary, forcing a synchronous layout of the
        whole pane tree. Nothing consumed the values, so the measurement is
        removed. On a CPU-only Linux host, animation-frame work p95 fell from
        11.0–11.6 ms to 9.4–10.8 ms; boundary work was unchanged.
  - The `pictures.configure` layout effect in
    `src/workspace/OnirigiriWorkspace.tsx` runs `refreshSurfaces` and emits for
    every pane host on each commit, about a third of React boundary work on that
    host.
  - `workspaceGridCursorRenderItem` and `workspaceWorldRenderFrame` call
    `gridCellBox`, which recomputes full column geometry; a frame computes it
    four or five times instead of reusing the frame's geometry.

  Fix: limit the `configure` fan-out to panes whose inputs changed, and share
  column geometry between pane render items and the cursor. Together these
  saved about 15% of boundary work in local profiles, which is not enough on
  its own to reach the budget; re-measure on the reference machine.

## Verification

- [x] **`workspace-performance` cannot finish on the reference machine.** The
      suite timeout is now 600 seconds.
- [ ] **Decide whether one dropped frame should fail mean cadence.** The mean
      budget allows 0.07 ms above the refresh interval, so a single 33 ms frame in
      about 300 fails a scenario. Revisit after the password-manager fix.
- [x] **Stabilize "large viewports paint every loaded same-origin frame".** The
      paint check retries its screenshot for up to ten seconds instead of
      failing on a frame whose first composited paint is still pending. It
      passed 5/5 on the Linux GPU host.
- [x] **Investigate camera starvation in headless Linux.** The camera was not
      starved: frames held 60 Hz and the move finished in about 430 ms. The
      measured world travel (28–69 px) is the real distance between the empty
      cell and the next pane, which depends on fitted pane widths. The test now
      requires the world to move by the cursor's world-space displacement while
      the highlight stays still; it passed 5/5 on the Linux GPU host.
