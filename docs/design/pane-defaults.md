# Pane defaults and content fit

A workspace accepts plain `paneDefaults` and `paneTypeDefaults` objects. Type keys
are developer-owned `surfaceKind` strings. A pane definition or open/configure
request can supply `defaults` for that individual pane. Workspace, type and pane
values merge in that order, including individual properties inside `content`.
The library does not infer application categories from DOM or iframe URLs.

`width` and `height` accept positive CSS pixel numbers, `"viewport"`, or `"auto"`.
Auto removes an inherited preferred dimension so the aspect ratio or ordinary
layout can determine it. Minimum
and maximum dimensions accept positive pixel numbers. `aspectRatio` is a preferred
outer-pane width/height ratio used to derive a missing dimension. Explicit width
and height take precedence over that ratio. These are initial preferences, not
locks on resize handles. Explicit initial geometry and later user resizing take
precedence over preferred dimensions. Resetting sizing restores the current type
preferences. Invalid dimensions and content-fit values are rejected.
Moving into an empty grid cell preserves the source column's explicit sizing
override along with its width, so workspace defaults cannot resize the pane
during a move or its return trip.

Displayed dimensions obey configured bounds and, by default, the available
workspace viewport. The viewport is the stage inside the embedding application,
less workspace padding, rather than the physical display or browser chrome.
Viewport bounds win over oversized minimums, even on unusually small workspaces.
Stored desired sizes survive viewport shrinkage and can grow back when space
returns. The existing explicit viewport-overflow option can permit wider panes.
A maximized pane and `resizePanes("full")` fill the available viewport: per-pane
minimums and maximums shape panes within the tiled layout, not these explicit
viewport-filling commands. Restoring a maximized pane returns it to its bounded
size. Full sizing suspends per-pane bounds until another sizing mode, including
the default reset, is chosen; like maximization, that state is not part of the
serialized layout, so a restored layout is bounded again.

Columns in a grid slot share width. The largest preferred width reserves the
slot, constrained by its panes' shared minimum/maximum interval; the strictest
maximum wins an incompatible minimum. Per-pane heights remain independent.
Viewport-height defaults use the existing flexible column allocation, so stacked
panes divide the available row height by their weights instead of each requesting
an additional screenful. Ordinary, overview and grid-focus geometry use the same
resolution. Configuration updates flow through the existing layout engine and
Zustand store without remounting consumer content.

`resizeEdges` lists which pane edges expose resize handles. It is not a sizing
preference, but it shares the workspace, type and pane precedence because hosts
choose handles along the same lines as sizes. Arrays replace rather than merge,
so a pane can remove an inherited edge, and an empty list removes all handles.
An absent value keeps the right and bottom handles. Validation rejects anything
other than an array of the four edge names. The handle set is read while
rendering the pane, so changing it updates handles without touching layout.

`content.fit` controls presentation inside the pane independently of pane sizing:
`contain` centers the full content with empty space as needed, `cover` centers and
crops it to fill the pane, and `fill` stretches it. An optional
`content.aspectRatio` sizes a responsive content viewport, including iframe and
canvas hosts, at a known ratio. Ratio alone selects containment. Direct image and
video children use native object-fit and can retain their intrinsic media ratio
without supplying metadata. Arbitrary nested applications own their internal
layout; the renderer receives the resolved content options as `state.content`.
The library cannot inspect media metadata inside cross-origin frames.

A stable content wrapper uses CSS container dimensions for containment and cover.
Fit changes preserve the mounted subtree and invalidate its saved picture for
refresh through the existing capture scheduler. Fitting does not add measurement
observers, cloning, capture queues or per-frame React updates. Consumer CSS can
style the existing live-content slot and its child content normally.

The 1D playground supplies a viewport-height row preference and a 480-pixel width
preference. The 2D playground uses 480 × 600 pixels for every content type.
Videos retain contained 16:9 content without changing the common outer pane
dimensions. Viewport clamping and manual resizing keep that content centered and
complete. Explicit navigation fixtures retain their own initial dimensions.

Engine tests cover precedence, creation and restoration, small and large
viewports, configured bounds, viewport-filling maximize and full sizing,
resize/reset behavior, and grid/overview agreement. A headless CPU browser check
in `cpu-capability-browser` maximizes and fully sizes a bounded pane and compares
it with the stage.
Headless engine split resizing accepts the current viewport so preferred heights
and type bounds can be resolved; the layout store supplies it automatically.
Browser checks cover 1D row height, real media and iframe fitting, changed fit
without lost content state, and both resize directions.
`pane-edges.cpu.pw.ts` in `cpu-capability-browser` drags left and top handles on
the fixture and checks the opposite edge stays on screen.
