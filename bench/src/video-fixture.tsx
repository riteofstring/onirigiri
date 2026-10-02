import {
  OnirigiriWorkspace,
  useOnirigiriPaneContentReady,
  type OnirigiriPaneDefinition,
} from "@riteofstring/onirigiri";
import { useState } from "react";

const search = new URLSearchParams(location.search);
const videoCount = search.get("videos") === "2" ? 2 : 1;
const panes: OnirigiriPaneDefinition[] = Array.from(
  { length: videoCount },
  (_, index) => ({
    columnId: `video-column-${index}`,
    columnWidth: { unit: "px", value: 480 },
    paneId: `video-${index}`,
    planeIndex: 0,
    slotIndex: index,
    surfaceKind: "native-video",
    title: `Native video ${index + 1}`,
  }),
);

export function VideoFixture() {
  const plain = search.get("container") === "plain";
  return (
    <main
      className="performance-fixture"
      data-production={import.meta.env.PROD}
    >
      <header className="performance-fixture__header">
        <h1>Simultaneous native video playback</h1>
        <p>{plain ? "Plain container" : "Onirigiri workspace"}</p>
      </header>
      <div className="performance-fixture__workspace">
        {plain ? (
          <div className="performance-video-container">
            {panes.map((pane) => (
              <VideoSurface key={pane.paneId} />
            ))}
          </div>
        ) : (
          <OnirigiriWorkspace
            focusAnchor="start"
            initialPanes={panes}
            paneDefaults={{ height: "viewport" }}
            preloadMarginPanes={0}
            renderPane={renderVideo}
            showControls={false}
            showOverviewControl={false}
            workspaceId="multi-video"
          />
        )}
      </div>
    </main>
  );
}

function renderVideo() {
  return <ReadyVideo />;
}

function ReadyVideo() {
  const [ready, setReady] = useState(false);
  useOnirigiriPaneContentReady(ready);
  return <VideoSurface onPlaying={() => setReady(true)} />;
}

function VideoSurface({ onPlaying }: { onPlaying?: () => void }) {
  return (
    <video
      aria-label="30 FPS test pattern"
      autoPlay
      className="performance-video"
      height={720}
      loop
      muted
      onPlaying={onPlaying}
      playsInline
      src="/video-30fps.webm"
      width={1280}
    />
  );
}
