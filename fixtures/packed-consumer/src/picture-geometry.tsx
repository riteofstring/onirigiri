import {
  OnirigiriWorkspace,
  useOnirigiriPaneContentReady,
  type OnirigiriPaneDefinition,
  type OnirigiriPanePicture,
  type OnirigiriWorkspaceHandle,
} from "@riteofstring/onirigiri";
import { useEffect, useRef, useState } from "react";

declare global {
  interface Window {
    packedPictureWorkspace?: { current: OnirigiriWorkspaceHandle | null };
  }
}

function GeometryContent({ title, ready }: { title: string; ready: boolean }) {
  useOnirigiriPaneContentReady(ready);
  return <input aria-label={`${title} value`} defaultValue="Original value" />;
}

export function PictureGeometryConsumer({ grid }: { grid: boolean }) {
  const workspace = useRef<OnirigiriWorkspaceHandle>(null);
  const [ready, setReady] = useState(true);
  const [picture, setPicture] = useState<OnirigiriPanePicture | null>(null);
  const [panes] = useState<OnirigiriPaneDefinition[]>(() => [
    {
      paneId: "sized-picture",
      columnId: "picture-column",
      columnWidth: { unit: "px", value: 320 },
      heightPx: 280,
      planeIndex: 0,
      slotIndex: 0,
      surfaceKind: "document",
      title: "Sized picture",
    },
    {
      paneId: "retained-sibling",
      columnId: "sibling-column",
      columnWidth: { unit: "px", value: 320 },
      heightPx: 280,
      planeIndex: grid ? 1 : 0,
      slotIndex: grid ? 0 : 1,
      surfaceKind: "document",
      title: "Retained sibling",
    },
  ]);
  useEffect(() => {
    window.packedPictureWorkspace = workspace;
    let active = true;
    const canvas = document.createElement("canvas");
    canvas.width = 480;
    canvas.height = 320;
    const context = canvas.getContext("2d")!;
    context.fillStyle = "rgb(19, 83, 137)";
    context.fillRect(0, 0, 480, 320);
    context.fillStyle = "rgb(231, 173, 41)";
    context.fillRect(320, 192, 160, 128);
    canvas.toBlob((image) => {
      if (active && image)
        setPicture({
          image,
          cssSize: { width: 240, height: 160 },
          fit: "fill",
          position: "left top",
        });
      canvas.width = canvas.height = 0;
    }, "image/png");
    return () => {
      active = false;
      if (window.packedPictureWorkspace === workspace)
        delete window.packedPictureWorkspace;
    };
  }, []);
  return (
    <main className="consumer-shell">
      <header>
        <h1>Packed picture geometry</h1>
        <button type="button" onClick={() => setReady((value) => !value)}>
          {ready ? "Show sized picture" : "Restore live input"}
        </button>
      </header>
      <div className="consumer-workspace">
        <OnirigiriWorkspace
          ref={workspace}
          initialPanes={panes}
          gridAxes={grid ? "spatial" : "horizontal"}
          liveContent
          getPanePicture={(pane) =>
            pane.paneId === "sized-picture" ? picture : null
          }
          renderPane={(pane) => (
            <GeometryContent
              title={pane.title}
              ready={pane.paneId !== "sized-picture" || ready}
            />
          )}
          tokens={{
            "--onirigiri-pane": "rgb(47, 61, 79)",
            "--onirigiri-pane-raised": "rgb(47, 61, 79)",
          }}
          showControls={false}
          showMinimap={false}
          showOverviewControl={false}
          shortcutScope="workspace"
        />
      </div>
    </main>
  );
}
