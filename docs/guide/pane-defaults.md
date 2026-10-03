# Pane defaults

Preferred sizes, limits, content fitting and resize handles by workspace, content type and pane.

## Defaults by content type

Pass ordinary objects, including JSON configuration, keyed by your own `surfaceKind` values:

```tsx
import type { PaneDefaults } from "@riteofstring/onirigiri";

const paneTypes = {
  video: {
    width: "auto",
    aspectRatio: 16 / 9,
    content: { fit: "contain", aspectRatio: 16 / 9 },
  },
  editor: { width: 900, minWidth: 360, maxWidth: 1400 },
  largePreview: { width: 3840, height: 2160 },
} satisfies Record<string, PaneDefaults>;

<OnirigiriWorkspace
  initialPanes={panes}
  paneDefaults={{ width: 480, height: "viewport" }}
  paneTypeDefaults={paneTypes}
  renderPane={(pane, state) => <YourPane pane={pane} content={state.content} />}
/>;
```

Workspace defaults are overridden by type defaults, then by an individual pane's `defaults`.
The same per-pane options work with `initialPanes`, `openPane` and `configurePane`. Nested `content`
properties merge independently. React prop updates apply without remounting pane content.

Width and height accept CSS pixels, `"viewport"`, or `"auto"` to clear an inherited preferred
size. `aspectRatio` derives a missing dimension; two explicit dimensions take precedence.
Viewport-height panes share the available row height when stacked. Users can resize preferred
sizes; `minWidth`, `maxWidth`, `minHeight` and `maxHeight` continue to constrain them. A maximized
pane and `resizePanes("full")` fill the viewport regardless of those bounds; restoring the pane or
choosing another sizing mode applies them again.

By default, even an oversized minimum is clamped to the available workspace viewport. A requested
4K pane fits a small browser and grows back when room returns. Aligned grid columns share width;
when their constraints conflict, the stricter maximum wins. The existing
`allowResizedPanesToOverflowViewport` option explicitly permits wider panes.

`content.fit` is independent of outer pane sizing: `contain` centers the complete content with
letterboxing, `cover` fills and crops, and `fill` stretches. A known `content.aspectRatio` fits
responsive iframe, canvas or application content. Direct video and image elements can also use
their intrinsic ratio through native object-fit. Nested applications own their internal media
layout and receive these options through `state.content`; Onirigiri does not inspect cross-origin
media metadata.

## Resize handles

`resizeEdges` chooses which pane edges have resize handles. It accepts any combination of
`"left"`, `"right"`, `"top"` and `"bottom"` and follows the same workspace, type and pane
precedence; a pane's own list replaces an inherited one, and an empty list removes every handle.
Without it, panes keep the right and bottom handles exported as `defaultPaneResizeEdges`:

```tsx
<OnirigiriWorkspace
  paneDefaults={{ resizeEdges: ["right"] }}
  paneTypeDefaults={{ editor: { resizeEdges: ["left", "right", "bottom"] } }}
  initialPanes={[
    {
      paneId: "map",
      surfaceKind: "map",
      title: "Map",
      defaults: { resizeEdges: [] },
    },
  ]}
  {...workspaceProps}
/>
```

Left and right handles resize the column width. While a left edge is dragged, the pane's right
edge stays where it is on screen. Top and bottom handles resize height: between two stacked panes
both handles move the split they share, and at the top of a column the top handle resizes the
row like the bottom handle does while keeping the column's bottom edge still. Width and height
limits apply to every edge. When the gesture ends, the camera settles on the focused pane as it
does after any resize.

Every handle has an accessible name, arrow-key resizing in 16px steps (64px with Shift) and
Enter, Space or a double click to reset. Arrow keys move the edge in their own direction. Handles
are hidden in compact layouts, overview and maximized panes.
