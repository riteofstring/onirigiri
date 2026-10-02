import { createRef, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { OnirigiriWorkspace } from "../../src/index";
import type {
  OnirigiriPaneRenderer,
  OnirigiriWorkspaceHandle,
} from "../../src/index";
import { CooperativeFixtureFrame } from "./cooperative-fixture-frame";
import "../../src/styles.css";
import "./retained-capture.css";

const query = new URLSearchParams(location.search);
const count = [10, 50, 100, 500].includes(Number(query.get("count")))
  ? Number(query.get("count"))
  : 50;
const fixture = `${new URL("./native-content-frame.html", import.meta.url).href}?cooperative`;
const handle = createRef<OnirigiriWorkspaceHandle>();
const panes = Array.from({ length: count }, (_, index) => ({
  paneId: `pane-${index}`,
  columnId: `column-${Math.floor(index / 2)}`,
  slotIndex: Math.floor(index / 2),
  columnWidth: { unit: "px" as const, value: 480 },
  heightPx: 390,
  surfaceKind: "dom",
  title: `dom ${index}`,
}));

declare global {
  interface Window {
    __retainedPreview?: {
      handle: typeof handle;
    };
  }
}

window.__retainedPreview = { handle };

function Preview() {
  return (
    <main className="capture-preview">
      <header>
        <strong>Onirigiri retained textures</strong>
        <PreviewStatus />
      </header>
      <div className="capture-preview__workspace">
        <OnirigiriWorkspace
          captureMissingOverviewPictures={
            query.get("overviewCapture") === "true"
          }
          pictureRasterBudgetBytes={
            query.has("rasterBudget")
              ? Number(query.get("rasterBudget"))
              : undefined
          }
          pictureMinLongEdgePx={
            query.has("minPictureEdge")
              ? Number(query.get("minPictureEdge"))
              : undefined
          }
          ref={handle}
          focusAnchor="center"
          retainedAreaBudgetViewports={
            query.has("contentBudget")
              ? Number(query.get("contentBudget"))
              : undefined
          }
          initialPanes={panes}
          renderPane={renderFixture}
        />
      </div>
    </main>
  );
}

function PreviewStatus() {
  const [status, setStatus] = useState("Initializing pane rendering…");
  useEffect(() => {
    const update = () => {
      const report = handle.current?.getCaptureStatus();
      setStatus(
        report && report.state !== "unconfigured"
          ? `${report.pictures.length}/${count} textures retained · ${count - report.pictures.length} not retained · ${report.state}`
          : "Initializing WebGPU pane rendering.",
      );
    };
    update();
    const timer = setInterval(update, 500);
    return () => clearInterval(timer);
  }, []);
  return (
    <span>
      {count} panes · {status}
    </span>
  );
}

const renderFixture: OnirigiriPaneRenderer = (pane, state) => (
  <CooperativeFixtureFrame
    protocol="onirigiri-native-test/v1"
    runtime={state.runtimeState}
    src={fixture}
    title={pane.title}
  />
);

createRoot(document.querySelector("#root")!).render(<Preview />);
