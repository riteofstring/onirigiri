import { createRef } from "react";
import { createRoot } from "react-dom/client";
import { OnirigiriWorkspace } from "../../src/workspace/OnirigiriWorkspace";
import type { OnirigiriWorkspaceHandle } from "../../src/workspace/onirigiri-workspace-types";
import { CooperativeFixtureFrame } from "./cooperative-fixture-frame";

const fixtures = [
  "dom",
  "forms",
  "react",
  "canvas-2d",
  "video",
  "webgl-2",
  "webgpu",
  "xterm-dom",
  "xterm-webgl",
  "mixed",
];
const query = new URLSearchParams(location.search);
const count = Number(query.get("count"));
const workload = query.get("workload");
const origin = new URL(query.get("fixtureOrigin")!).origin;
const handle = createRef<OnirigiriWorkspaceHandle>();
const pictures = new Map<string, Blob>();
const root = createRoot(document.querySelector("#root")!);

function render() {
  root.render(
    <OnirigiriWorkspace
      ref={handle}
      focusAnchor="center"
      retainedAreaBudgetViewports={0}
      initialPanes={Array.from({ length: count }, (_, index) => ({
        paneId: `pane-${index}`,
        columnId: `column-${Math.floor(index / 2)}`,
        slotIndex: Math.floor(index / 2),
        columnWidth: { unit: "px" as const, value: 480 },
        heightPx: 390,
        surfaceKind:
          workload === "dom" ? "dom" : fixtures[index % fixtures.length]!,
        title: `${workload === "dom" ? "dom" : fixtures[index % fixtures.length]} ${index}`,
      }))}
      getPanePicture={(pane) => {
        const image = pictures.get(pane.paneId);
        return image ? { image } : null;
      }}
      renderPane={(pane, state) => (
        <CooperativeFixtureFrame
          protocol="browser-surface-lab/v1"
          runtime={state.runtimeState}
          src={`${origin}/fixture.html?fixture=${pane.surfaceKind}&embedding=surface`}
          title={pane.title}
        />
      )}
    />,
  );
}
Object.assign(window, {
  __retainedLab: {
    handle,
    async supply(id: string, src: string) {
      pictures.set(id, await (await fetch(src)).blob());
      render();
    },
  },
});
render();
