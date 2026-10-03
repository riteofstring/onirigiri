# Styling and theming

Theme tokens, slot class names and styles, design-system components and accessibility boundaries.

## Styling

Onirigiri's styling API is framework-neutral and has four deliberate levels:

1. **Theme tokens** change the whole visual system.
2. **Slot classes** connect CSS Modules, Tailwind, vanilla CSS, CSS-in-JS, or variant helpers.
3. **Slot styles** cover small dynamic inline values.
4. **Chrome components** let a design system render Onirigiri's visible buttons.

The exported stylesheet provides the dependency-free neutral default. All bundled rules live in
the named `onirigiri` cascade layer, and every custom property and selector hook is namespaced. Normal
unlayered host CSS therefore overrides the defaults regardless of stylesheet order—no
`!important` or specificity contest is needed:

```css
.product-workspace {
  --onirigiri-background: oklch(0.16 0 0);
  --onirigiri-pane: oklch(0.22 0 0);
  --onirigiri-pane-raised: oklch(0.25 0 0);
  --onirigiri-focus: oklch(0.9 0 0);
  --onirigiri-pane-radius: 10px;
  --onirigiri-titlebar-min-height: 32px;
  --onirigiri-control-size: 28px;
}
```

If the host also uses cascade layers, declare their order once so the result is explicit:

```css
@layer reset, onirigiri, components, utilities;
```

Onirigiri scopes token defaults to each workspace instead of `:root`, so dark, light, branded, and
embedded workspaces can coexist on one page without leaking values into one another.

Tokens cover the complete bundled appearance rather than color alone:

| Area                 | Representative tokens                                                                                                        |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Color and elevation  | `--onirigiri-background`, `--onirigiri-pane`, `--onirigiri-text`, `--onirigiri-edge`, `--onirigiri-pane-shadow`              |
| Type                 | `--onirigiri-font`, `--onirigiri-font-mono`, `--onirigiri-title-font-size`, `--onirigiri-title-font-weight`                  |
| Pane and title bar   | `--onirigiri-pane-radius`, `--onirigiri-titlebar-min-height`, `--onirigiri-titlebar-padding`, `--onirigiri-pane-action-size` |
| Workspace controls   | `--onirigiri-toolbar-radius`, `--onirigiri-toolbar-padding`, `--onirigiri-control-size`, `--onirigiri-control-icon-size`     |
| Resize UI            | `--onirigiri-resize-hit-size`, `--onirigiri-resize-indicator-size`, `--onirigiri-resize-indicator-opacity`                   |
| Responsive and touch | `--onirigiri-compact-control-size`, `--onirigiri-touch-control-size`, `--onirigiri-minimum-target-size`                      |
| Motion and stacking  | `--onirigiri-duration-fast`, `--onirigiri-easing-standard`, `--onirigiri-z-toolbar`, `--onirigiri-z-minimap`                 |

The exported `onirigiriThemeTokenNames` catalog is the authoritative full list.
`onirigiriThemeTokenGroups` provides the same names grouped into `color`, `elevation`, `layout`,
`motion`, `shape`, `stacking`, and `typography`. `defineOnirigiriTheme`, `OnirigiriThemeTokens`, and
`OnirigiriWorkspaceStyle` provide autocomplete without requiring a runtime theme provider:

```tsx
import {
  OnirigiriWorkspace,
  defineOnirigiriTheme,
} from "@riteofstring/onirigiri";

const workspaceTheme = defineOnirigiriTheme({
  "--onirigiri-pane-radius": "16px",
  "--onirigiri-titlebar-min-height": "34px",
  "--onirigiri-duration-normal": "140ms",
});

<OnirigiriWorkspace tokens={workspaceTheme} {...workspaceProps} />;
```

Every structural element also has a stable `data-onirigiri-slot` hook. The exported `onirigiriStyleSlots`
catalog lists the supported values, including `workspace`, `stage`, `toolbar`, `control`, `pane`,
`grid-cursor`, `pane-titlebar`, `pane-content`, `pane-action`, `minimap`, `minimap-resize`, and both
resize handles:

```css
.product-workspace [data-onirigiri-slot="pane-titlebar"] {
  backdrop-filter: blur(12px);
}

.product-workspace [data-onirigiri-slot="grid-cursor"][data-cell-kind="empty"] {
  border-color: currentColor;
}
```

Use `classNames` when a framework produces classes and `styles` only for genuinely dynamic inline
values. Both maps are keyed by the same slot catalog:

```tsx
import {
  OnirigiriWorkspace,
  defineOnirigiriClassNames,
  defineOnirigiriStyles,
} from "@riteofstring/onirigiri";
import styles from "./workspace.module.css";

const classNames = defineOnirigiriClassNames({
  control: styles.control,
  pane: styles.pane,
  "pane-action": styles.paneAction,
});

const slotStyles = defineOnirigiriStyles({
  "pane-tone": { opacity: 0.8 },
});

<OnirigiriWorkspace
  classNames={classNames}
  styles={slotStyles}
  {...workspaceProps}
/>;
```

Onirigiri always keeps its internal class first and appends the slot class. On the root, the order is
the internal class, `classNames.workspace`, then `className`. Inline root values merge in this
order: `styles.workspace`, `tokens`, then `style`; the later source wins. For panes, Onirigiri applies
slot styles first and its measured `width`, `height`, `transform`,
`opacity`, position, and stacking values last. Those properties are engine-owned runtime geometry;
change them through Onirigiri's sizing and layout APIs rather than CSS.

State is available through attributes such as `data-presentation-mode`, `data-compact-layout`,
`data-focus-anchor`, `data-focused`, `data-maximized`, `data-moving`, `data-runtime-state`, and
`data-tone`. Always combine a state selector with its slot—for example,
`[data-onirigiri-slot="pane"][data-focused="true"]`—so generic state names cannot collide with host
markup. Workspace, pane, column, and content-type identity are exposed through
`data-onirigiri-workspace-id`, `data-onirigiri-pane-id`, `data-onirigiri-column-id`, and
`data-onirigiri-surface-kind`. Workspace controls carry `data-onirigiri-control` (`overview`,
`move-up`, `move-down`, `move-left`, `move-right`) and `data-available`; pane actions carry
`data-onirigiri-pane-action` (`maximize`, `restore`, `close`).

`onirigiriStylingContract` exposes the contract version, cascade layer, token groups, slots, state
attributes, and identity attributes as a machine-readable object. The root also carries
`data-onirigiri-styling-version="8"`. Version 8 removed the bundled tooltips together with the
`tooltip` and `tooltip-key` slots and every `--onirigiri-tooltip*` and `--onirigiri-z-tooltip` token. Exported tokens, slots, and state/identity hooks are public API;
renaming or removing one requires a major release. Internal `.onirigiri-*` classes remain implementation
details even though Onirigiri preserves them when adding host classes.

### Focus highlight

The focus highlight is the `grid-cursor` slot. Its border uses `--onirigiri-focus` and
`--onirigiri-focus-border-width`, its glow uses `--onirigiri-pane-focus-shadow`, and its corners
follow `--onirigiri-pane-radius`. `classNames["grid-cursor"]` and `styles["grid-cursor"]` can
replace any of these. It exposes `data-cell-kind` (`occupied` or `empty`), `data-moving` and
`data-presentation-mode` for state-specific styling. Onirigiri positions it with `transform`, so
custom styles should not set `transform`. Its motion is configured with the `focusHighlight` prop,
and `focusHighlight={false}` removes it.

### Design-system components

Onirigiri renders plain native buttons and no visible tooltips. Each workspace control has an
accessible name, `aria-keyshortcuts` listing every effective binding, `aria-disabled="true"` when the
move is unavailable, and `aria-pressed` on the overview toggle. Hosts add tooltips, hints, and visual
variants with their own components.

`chromeComponents.WorkspaceControlButton` and `chromeComponents.PaneActionButton` replace those
buttons without adding a framework dependency to Onirigiri. Each receives the button props it must
forward (class, style, accessible name, state, data attributes, event handlers, `type="button"`, and
the icon as `children`) plus a typed descriptor that is not a DOM attribute:

- `control: OnirigiriWorkspaceControlDescriptor` — `{ id, action, label, available, pressed?, shortcuts }`.
  `shortcuts` lists every effective binding as `OnirigiriShortcutDescriptor`
  (`{ aria, label, keys, binding }`); the first entry is the primary binding.
- `action: OnirigiriPaneActionDescriptor` — `{ id: "maximize" | "restore" | "close", label, pane }`.
  Returning `null` omits that action for that pane.

Shortcut labels follow the platform: on Apple platforms modifiers are written with symbol and name
(`⌃ Control`, `⌥ Option`, `⇧ Shift`, `⌘ Command`); elsewhere they are `Ctrl`, `Alt`, `Shift`, and
`Meta`. Arrow keys render as `←`, `↑`, `→`, `↓`, Space as `Space`, and single characters in upper
case. `keys` holds the individual labels for `<kbd>` rendering and `label` joins them with `+`, for
example `⌥ Option + →` or `Alt + →`.

#### Use your own components (for example shadcn/ui)

```tsx
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  OnirigiriWorkspace,
  defineOnirigiriChromeComponents,
} from "@riteofstring/onirigiri";

const chromeComponents = defineOnirigiriChromeComponents({
  WorkspaceControlButton: ({ control, ...props }) => (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon" {...props} />
      </TooltipTrigger>
      <TooltipContent>
        {control.label}
        {control.shortcuts[0]?.keys.map((key) => (
          <kbd key={key}>{key}</kbd>
        ))}
      </TooltipContent>
    </Tooltip>
  ),
  PaneActionButton: ({ action, ...props }) =>
    action.id === "maximize" ? null : (
      <Button variant="ghost" size="icon-sm" {...props} />
    ),
});

<OnirigiriWorkspace chromeComponents={chromeComponents} {...workspaceProps} />;
```

Wrappers, portals, and extra elements around the button are supported; Onirigiri does not depend on
which DOM node the override renders. Keep the descriptor out of the DOM, forward every other prop to
one native `<button>`, and do not strip accessible names or swallow keyboard and pointer handlers.

When the built-in controls are hidden with `showControls={false}`, a host control bar can derive the
same data: `getOnirigiriShortcutBindings(action, shortcuts)` returns the effective bindings for an
action from the workspace's `shortcuts` configuration, and `formatOnirigiriShortcut(binding, {
platform })` returns an `OnirigiriShortcutDescriptor`. `platform` (`"apple"` or `"other"`) is detected
from the browser by default; pass it explicitly for server rendering and tests.

`chromeComponents.PaneTitlebarAccessory` can add a badge or other content between
the pane heading and its action buttons. It receives `{ pane: WorkspacePane }`
and stays in the native titlebar, outside captured pane content.

Pane content remains completely host-owned through `renderPane`, so any React component system can
be used there without an adapter.

### Accessibility boundaries

The bundled theme maintains visible `:focus-visible` indicators, forced-colors fallbacks, reduced
motion behavior, dark/light contrast, and native button semantics. Fine-pointer controls are
clamped by `--onirigiri-minimum-target-size` (`24px` by default), while compact and coarse-pointer modes
use larger defaults. A denser theme can shrink the visible icons and padding, but should not lower
the minimum target below `24px`; raise it to `44px` when the workspace is primarily touch-driven.
Custom themes should keep focus and state cues non-color-only and verify rendered foreground and
background pairs in dark, light, increased-contrast, and forced-colors modes.

The `--onirigiri-tone-cyan`, `--onirigiri-tone-green`, `--onirigiri-tone-orange`,
`--onirigiri-tone-pink`, and `--onirigiri-tone-slate` properties preserve the public pane-tone names while
allowing a host to map those roles to any palette. The default mappings are neutral greys.

Set `data-color-mode="light"` on the workspace or any ancestor to use the bundled light theme. The
[demo playgrounds](https://github.com/riteofstring/onirigiri/tree/main/playground) include a persisted light-mode toggle as a host-application example:

```tsx
<main data-color-mode={colorMode}>
  <OnirigiriWorkspace {...workspaceProps} />
</main>
```

When `showControls` is enabled, the workspace control rail exposes native directional buttons.
Their `aria-keyshortcuts` lists the effective configured shortcuts. The overview
button is shown by default and can be omitted with `showOverviewControl={false}` when the host puts
the same action in its own top bar. `onPresentationModeChange` lets that host keep a state-aware
“Zoom out” / “Zoom in” label synchronized with keyboard and pointer changes.

Pass a host element to `desktopControlsContainer` to move the same native directional controls into
application chrome on desktop. Onirigiri uses a React portal, so button behavior, configured shortcuts,
framework adapters, and slot styles remain unchanged. At the compact breakpoint, the portal is
automatically removed and the controls return to the safe-area-aware bottom bar:

```tsx
const [controlsContainer, setControlsContainer] = useState<HTMLElement | null>(
  null,
);

return (
  <main>
    <header>
      <div ref={setControlsContainer} />
    </header>
    <OnirigiriWorkspace
      desktopControlsContainer={controlsContainer}
      showOverviewControl={false}
      {...workspaceProps}
    />
  </main>
);
```

The portal wrapper exposes `data-onirigiri-slot="desktop-controls"`. Onirigiri applies
`styles["desktop-controls"]` first and the `tokens` map second, matching the documented root merge
order through the token layer. Keep the destination under the same `data-color-mode` ancestor when
using the bundled light theme.

Every pane action remains available in normal mode, including on unfocused panes. Unfocused action
groups use lower visual emphasis and return to full contrast on hover or keyboard focus, so the
controls stay discoverable without making every pane compete with the active one.

Pane content stays directly interactive without changing the camera. Pressing a pane interior
updates focus in place; pressing its non-interactive title bar focuses and reveals that pane. This
lets a user work across every pane already visible in a wide viewport without the layout sliding
under their pointer.
