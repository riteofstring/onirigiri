# Retained pane picture verification

## Browser contracts

```sh
code-polishy test --suite chrome-picture-preview --suite native-content-browser
```

The capture suite exercises the library's HTML-in-Canvas/WebGPU renderer at
native and fractional display scales. It verifies decoded text and background
pixels, images retained after DOM eviction, cold overview presentation, and a
second ordinary tab without a host capture binding. It also exercises width,
row and split resizing in both directions with 100 panes, retaining document
identity, form edits and fixed raster allocations while the pointer is held.

The content suite checks original document identity, readiness and cancellation,
supplied PNG ownership, picture visibility, same-origin framed content and
cooperative suspension. Canvas-specific cases capture accelerated content from
outside the viewport, retain iframe edits, restore cancelled staging, respect
readback budgets and preserve texture aspect ratio during both resize axes.
An engine case captures the next pane before navigation and fills cold overview
pictures serially. Pixel evidence is saved by the relevant browser checks.

All renderer browser runs enable HTML-in-Canvas. The oversized content diagnostic
fixes DPR at one to avoid multiplying its already large viewport by desktop
HiDPI scaling. Ordinary capture cases also exercise fractional DPR and DPR two.

## Example workloads

The demo playground in the sibling
[onirigiri-playground](https://github.com/riteofstring/onirigiri-playground)
checkout hosts the Browser Surface Lab fixtures on its own origin without
modifying their workload source; see its README to launch an example. The
library's retained-capture harness opens with:

```sh
node scripts/preview-retained-capture.mjs
```

A real lab performance comparison requires the lab's protected-input check and
its applicable measurement procedure. Functional example checks do not replace
that acceptance boundary.

## Consumer and resource contracts

```sh
code-polishy test --suite pane-picture-contract --suite engine-picture-continuity --suite packed-consumer-contract
```

Resource checks cover useful captures across camera motion, changed identities
and readiness, cancellation, serial acquisition, encoded and raster budgets,
nearest-neighbor reduction, visible-picture protection and URL cleanup. Consumer
checks build against the public exports and exercise custom styling and controls.

## Limits

These checks establish selected lifecycle and pixel behavior. They do not
promise universal application suspension, permanent retention or preservation
of evicted application state. Pictures have no freshness expiry but remain
subject to configured budgets. Browser caches and GPU allocations are additional
to the retained-picture estimates. Frame-gap measurements are reported separately
from functional assertions and are specific to the machine and workload.

Capture requires WebGPU and HTML-in-Canvas, not tab sharing. Cross-origin iframe
pixels are unavailable through that API; consumers must use content hosted on
their origin or supply an authorized PNG preview.
