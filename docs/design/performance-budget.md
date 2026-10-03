# Mandatory performance budgets

Performance is an ordinary Code Polishy acceptance requirement. The
`workspace-performance` desktop suite at both 1x and 2x device scale runs at focused, recommended and full
boundaries when engine or performance-fixture inputs change. The
complete viewport matrix additionally runs at full boundaries. These are not
optional supplemental suites. Failed measurements block acceptance; a functional
browser pass or an agent review cannot replace them.

The production fixture runs serially in headless Chrome with HTML-in-Canvas
enabled. It records actual animation-frame timestamps and measured callback,
request-handler and React work. It does not simulate a faster display clock. The callback meter records all frame
work directly; it performs no per-callback document scans for renderer-specific
motion markers or unused timing subsets.
Browser launches share `tests/browser/chrome-launch.ts`. macOS uses installed
Chrome. Linux uses the Chrome for Testing headless shell at the pinned stable
version, installed by `node scripts/install-linux-chrome.mjs` after verifying
the archive digest, with ANGLE on Vulkan, Dawn's Vulkan adapter and no
presentation surface. On a headless Linux GPU host, installed Chrome's headless
mode falls back to software compositing and reports its WebGPU adapter
intermittently, while the headless shell composites and rasterizes on the GPU.
Playwright's bundled Chromium 149 predates the `copyElementImageToTexture`
signature the engine uses. Browser and performance runs first require a
hardware adapter and fail on a software fallback. The NVIDIA Vulkan driver
loads the GLVND `libEGL.so.1` (Debian/Ubuntu `libegl1`); without it the driver
reports no Vulkan device and Chrome falls back to software.
The Linux headless shell does not scroll iframe content from synthesized wheel
input, so the native wheel-scrolling check passes only in installed Chrome.

Chrome implements `copyElementImageToTexture` by rasterizing the element image
and synchronously reading its pixels back before uploading them to WebGPU. On
unified-memory hardware the readback is inexpensive; on a discrete GPU it
blocks the renderer for roughly 11 ms per 400 × 800 CSS-pixel pane at 1x and
16 ms at 2x (RTX 2000 Ada, Chrome 154), which limits live HTML-in-Canvas panes
to about 30 Hz with three visible. Linux text in captured element images also
differs from native text at glyph edges, so exact native-versus-captured pixel
checks fail there.
Tests require a visible document, working pane surfaces and the expected pane
counts. Raw measurements and budget assessments are retained as JSON artifacts.
Each matrix scenario owns its browser and closes it in `finally` after retaining
diagnostics. Closing the page separately is unnecessary and can leave the owning
browser cleanup waiting on an additional document teardown.

Browser cadence must sustain nominal 60 Hz: the measured mean interval cannot
exceed 1000/60 ms plus 0.1 ms for timestamp precision. Calibration cannot turn a
30 Hz browser into a passing baseline. A browser delivering a faster refresh
interval must also sustain that observed interval plus the same precision
allowance; a 120 Hz or faster measurement cannot pass on 60 Hz throughput.
Existing tail limits additionally reject excessive slow-frame ratios, long
tasks and frames above 50 ms. The Onirigiri CPU
budget remains 1000/120 ms at p95 and twice that at p99, for both animation-frame
work and combined request/React boundaries. This is CPU headroom for 120 Hz,
not a claim of 120 displayed frames on a 60 Hz browser.

Navigation, overview and asymmetric layouts run across mobile,
desktop and large viewports. The desktop suite also runs every
desktop Retina scenario with Chrome's 2× CPU slowdown as the average-machine
profile, `desktop-retina-average-cpu`. It keeps the same thresholds; a pass there
is the minimum claim for ordinary laptops, while the unthrottled profiles report
the reference hardware. The mixed-content workload repeatedly advances six
adjacent panes and reverses through the same focus commands as keyboard navigation.
Overview coverage enters, navigates and exits through explicit controls.
The asymmetric workload resizes both axes. The
separate 100-pane retained-picture interaction suite also fails on width,
row-height or stacked-divider resize mean or p95 above the 60 Hz budget and on any
resize frame above 50 ms; it verifies both growth and reversal.

The background-cache case starts with missing pictures, then enables the
engine's all-pane queue during measurement. All 100 mixed document/form/chart
panes must acquire pictures within 30 seconds while meeting the same frame and
CPU budgets. These charts use capturable DOM bars because nested graphics canvases
are excluded from automatic capture. The separate mixed-content and live workloads
retain native canvas coverage. It does not prewarm that workload before recording. Other scenarios
retain their explicit warmup phase so repeated interaction cost is measured
separately from initialization.

The desktop and Retina matrix includes explicit `live-navigation-100` and
`live-overview-100` scenarios. These keep 100 mixed documents mounted and animate
visible native canvases and DOM charts through navigation and overview with the
default automatic presentation, so they measure what applications receive
without configuration. Hidden applications pause their own animation loop.
Explicit HTML-in-Canvas presentation keeps its functional and pixel coverage in
the pane canvas browser suites. These scenarios use the existing
cadence and CPU thresholds; retained static pictures cannot replace their live
content. Separate headless pixel guards check changing content during held
motion and overview exit, document identity, and unchanged render counts for
content that remains hidden throughout navigation.

The ordinary `pane-native-cadence-browser` guard isolates automatic presentation
with 100 mounted iframe applications alternating automatic native Canvas 2D and
explicit native DOM animation. It traverses neighboring panes in normal and
overview modes over ten-second samples, checks changing pixels, and enforces the
nominal 60 Hz mean (or faster observed refresh interval), 50 ms maximum, and
bounded slow-frame ratio.
It also rejects element-image captures during native navigation. Queued paint
events must respect the current native presentation decision, including before
the native host has been attached. This focused guard complements the heavier
mixed native and HTML-in-Canvas performance matrix; it does not certify arbitrary
content or visible-browser refresh rates.

The production overview cadence check of the full 2D demo with its sibling
`browser-surface-lab` workloads lives with the demo in `playground/`. It is an integration check of that application, separate from the
repository-contained native cadence and video proofs, and is not protected-lab
certification or evidence for a visible 120 Hz display.

The motion-continuity review feature admits the workspace performance matrix as
its production evidence suite. Functional or synthetic passes do not establish
production cadence. Changes to default presentation require the production
workload to pass before claiming performance acceptance. Retain failures alongside exact reruns; one later pass does not prove
that an intermittent regression is fixed.

Timing checks disable Playwright's continuous DOM snapshot tracing, whose work
would otherwise scale with all mounted documents and contaminate the measured
application. The native and video cadence guards
retain frame measurements, producer evidence and pixel comparisons. Standalone
functional video and fullscreen checks continue to retain failure traces.

The quick `performance-budget-contract` suite exercises the assessor with
healthy, slow, invalid and insufficient measurements. In particular, modest
repeated frame drops cannot pass merely because percentile allowances hide
reduced throughput. Thresholds are fixed repository requirements, not inferred
from the candidate's slower measurements. Hardware or browser limitations are
reported as failures rather than silently lowering the minimums.

## Coverage and native video cadence

The ordinary desktop suite also runs a headless Chrome multi-video case at 1x and
2x device scale. It measures an empty browser baseline, one native video and two
simultaneously playing native videos, both in a plain container and in the
workspace. Each sample retains animation-frame deltas and per-video presentation
counters. Both videos must remain visible, playing at normal speed and advancing
throughout the sample. The same fixed 60 Hz mean-frame budget applies to every
workspace case and the blank and single-video controls. The two-video plain
container remains a measured diagnostic: its browser-selected cadence and video
callback counts are retained
without treating browser behavior outside Onirigiri as a renderer failure.
Each case starts a fresh headless browser so one presentation cannot contaminate
the next browser's scheduler state. Workspace screenshots must also show changing
pixels for each video; advancing decoder counters alone cannot pass a frozen
canvas. Two videos within one pane additionally exercise native input and 60 Hz
in the ordinary content browser suite. The exact `pane-video-browser` suite also
selects these cases for an executable regression proof without unrelated
interaction scenarios. The check is part of `workspace-performance`, so normal focused
verification cannot report success while the workspace workload fails.

The repository-owned media is an eight-second, silent 1280 × 720 VP9 test pattern
at 30 frames per second, generated with FFmpeg's `testsrc2` filter. Reproduce it
with `ffmpeg -f lavfi -i testsrc2=size=1280x720:rate=30 -t 8 -an -c:v libvpx-vp9
-crf 45 -b:v 0 -threads 2 video-30fps.webm`. Both containers use the same asset and
480 × 270 display dimensions. This isolates native video scheduling without
depending on the sibling lab's protected inputs.

All automated browser checks run headlessly so they cannot take desktop focus.
Each workspace performance scenario starts a fresh browser process so earlier
benchmark scenes do not influence later GPU capture or scheduler measurements.
Headless measurements cover this execution mode; they do not certify cadence or
capture behavior in a visible browser. This coverage also excludes the shared
lab's complete WebGL and terminal catalog.

Chromium's [video-conference frame-interval matcher](https://chromium.googlesource.com/chromium/src.git/+/23a46edb04aea8e8b84d2ef0ba6e033f10ee93ed/components/viz/service/display/frame_interval_matchers.cc)
uses two or more updating videos as a heuristic and can select their frame
interval even when other content is updating. Two native 30 Hz videos can
therefore lower page animation-frame cadence to 30 Hz, including in plain iframe
containers without Onirigiri. The shared Video and Combined lab surfaces together
meet this condition. A single video and a non-video baseline distinguish this
browser scheduling behavior from Onirigiri's own work. Automatic presentation
keeps video panes native and displays eligible playing videos through Canvas 2D
surfaces with the original video pixels hidden, which avoids this heuristic
without per-frame element capture. Native graphics remain DOM. Developers can explicitly select native
video, which retains the browser scheduling limitation. The workspace multi-video
cadence guard exercises the automatic policy; plain native fixtures remain
diagnostic controls. Required budgets are unchanged.
The two-video native fixtures reproduce approximately 30 Hz in headless Chrome
153 on macOS at both tested pixel densities. An identity filter, clipping and
explicit compositor isolation also retain that cadence in a plain native page.
These treatments do not provide a native-DOM solution to the 60 Hz requirement.

Visible-browser native video acceptance needs separately requested measurements of the same workload
both inside Onirigiri and in a plain container, with video frame counters advancing.
A passing synthetic fixture is insufficient evidence for that workload. Keep
the nominal 60 Hz budget unchanged, report the browser limitation explicitly,
and do not disable frame limiting, pause videos or reduce fixture work to obtain
a passing performance result.

## CPU diagnostics on hosts without graphics devices

`node scripts/measure-workspace-cpu.mjs --output tmp/cpu-run-1` bundles the real
layout, shell, activation and content-capability code into a headless Chrome
page. The output directory must be new, and the command requires the pinned Node
version. Each of fourteen scenarios warms twenty operations, then records five
batches of one hundred operations. Setup and DOM mutations occur outside the
timed queries. The fixed inputs include 100 and 500 mixed-size pane layouts,
normal and overview render queries, camera targets, activation ordering and
capability queries over 120 three-span rows.

Artifacts retain individual durations, counts, checksums, workload source, bundle
and source map, source revision and patch, machine and GPU information, competing
processes and 180 empty-page frame intervals. `--profile` additionally retains a
CDP CPU profile and must run separately from timing comparisons. Predetermine an
alternating baseline/candidate sequence, hold the harness fixed, and retain all
arms. These are synchronous CPU diagnostics without rendered pane content,
video producers or GPU copies; they never establish production graphics
acceptance or change a frame budget.

`pnpm exec playwright test --config tests/browser/cpu.playwright.config.ts` runs
the capability invalidation and benchmark-preflight guards headlessly without
building a production bundle. Production and synthetic performance
guards record the actual graphics prerequisites before timing and fail explicitly
if a WebGPU adapter or required HTML-in-Canvas method is unavailable.

The CPU diagnostic contract executes the real bundled workloads in a temporary
directory, checks complete finite samples and a populated CPU profile, and proves
that a second invocation cannot overwrite existing evidence. It asserts no timing
threshold and cannot establish graphics acceptance. The capability browser suite
checks missing adapters, device creation failures, missing copy support, successful
initialization and device disposal with controlled adapters. Actual hardware
initialization remains part of the production and Retina measurements. Both suites
are ordinary declared verification and are available to the presentation review.
The diagnostic contract requires Node 25.2.1 for the measurement process. When
the contract itself runs under a validator-owned runtime, it selects only an
available Node executable that proves the exact project version before measurement,
so the validator cannot silently replace the project's measurement pin.
