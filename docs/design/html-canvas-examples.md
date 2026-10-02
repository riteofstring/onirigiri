# HTML-in-Canvas examples

The retained-capture harness in `tests/browser/retained-capture.html` uses the
library's renderer, readiness, preload and picture-cache behavior directly. Its
panes embed the repository's cooperative native-content fixture, so the Chrome
capture contract needs no sibling checkout. Automated Chrome checks run
headlessly with HTML-in-Canvas enabled. An explicitly requested preview starts
Vite and a visible browser. A second tab opening the same URL works without a
host binding, screenshot transport, tab sharing prompt or capture banner.

The fixture adapter validates source and origin, combines document load and
application readiness, and sends neutral pause, resume and theme commands.
Document lifecycle observation belongs to the adapter, not a privileged browser
script.

The interactive one- and two-dimensional demos, their Browser Surface Lab
workloads and the lab fixture hosting live in `playground/`. Library browser
tests that drive those demos start its development servers through
`scripts/playground-server.mjs`, and the 2D CPU checks load its Vite
configuration in process. Both stop with an explicit message when the
playground's dependencies are not installed. The
playground resolves the library to this checkout's source, so these tests
exercise the current library rather than a published build.

Functional browser tests use deterministic local fixtures. Measured lab
acceptance additionally requires the lab's protected-input verification; a
functional preview does not establish a performance benchmark.
