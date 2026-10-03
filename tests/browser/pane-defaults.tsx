import { createRef, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  OnirigiriWorkspace,
  useOnirigiriPaneContentReady,
  type OnirigiriPaneRenderer,
  type OnirigiriWorkspaceHandle,
  type PaneDefaults,
} from "../../src/index";
import "../../src/styles.css";

export interface PaneDefaultsFixture {
  handle: { current: OnirigiriWorkspaceHandle | null };
  configure(defaults: PaneDefaults): void;
}

const handle = createRef<OnirigiriWorkspaceHandle>();
const root = createRoot(document.querySelector("#root")!);
const panes = [
  { paneId: "frame", surfaceKind: "frame", title: "Responsive frame" },
  { paneId: "video", surfaceKind: "video", title: "Native video" },
];
const linkPanes = new URLSearchParams(window.location.search).has("link");
const renderPane: OnirigiriPaneRenderer = (pane) =>
  pane.surfaceKind === "video" ? <Video /> : <Frame />;

function configure(defaults: PaneDefaults) {
  root.render(
    <OnirigiriWorkspace
      compactBreakpoint={0}
      ref={handle}
      initialPanes={panes}
      paneDefaults={defaults}
      paneLink={linkPanes}
      renderPane={renderPane}
    />,
  );
}

(
  window as Window & { __paneDefaultsFixture: PaneDefaultsFixture }
).__paneDefaultsFixture = { handle, configure };
configure({
  width: 500,
  height: 700,
  content: { aspectRatio: 16 / 9, fit: "contain" },
});

function Frame() {
  const [ready, setReady] = useState(false);
  useOnirigiriPaneContentReady(ready);
  return (
    <iframe
      title="Fitted frame"
      style={{ border: 0 }}
      onLoad={() => setReady(true)}
      srcDoc={
        '<!doctype html><html style="height:100%;background:#083b4b;color:#f4cf60;font:24px sans-serif"><body style="margin:0;height:100%;box-sizing:border-box;border:12px solid #f4cf60"><h1>Complete frame</h1><input aria-label="Retained value" value="Keep this value"></body></html>'
      }
    />
  );
}

function Video() {
  const ref = useRef<HTMLVideoElement | null>(null);
  const [ready, setReady] = useState(false);
  useOnirigiriPaneContentReady(ready);
  useEffect(() => {
    const video = ref.current!;
    const canvas = document.createElement("canvas");
    canvas.width = 960;
    canvas.height = 540;
    const context = canvas.getContext("2d")!;
    for (const [index, color] of ["#ef476f", "#118ab2", "#06d6a0"].entries()) {
      context.fillStyle = color;
      context.fillRect(index * 320, 0, 320, 540);
    }
    context.strokeStyle = "#ffffff";
    context.lineWidth = 24;
    context.strokeRect(12, 12, 936, 516);
    const stream = canvas.captureStream(0);
    video.srcObject = stream;
    const frame = requestAnimationFrame(() =>
      (
        stream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack
      ).requestFrame(),
    );
    void video.play();
    return () => {
      cancelAnimationFrame(frame);
      video.pause();
      for (const track of stream.getTracks()) track.stop();
      video.srcObject = null;
    };
  }, []);
  return (
    <video ref={ref} muted playsInline onLoadedData={() => setReady(true)} />
  );
}
