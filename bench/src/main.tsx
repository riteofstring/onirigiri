import { createRoot } from "react-dom/client";

import "@riteofstring/onirigiri/styles.css";
import "./performance-fixture.css";
import { PerformanceFixture } from "./performance-fixture";
import { VideoFixture } from "./video-fixture";
import { installAnimationFrameWorkMeter } from "./performance-frame-work";

const root = document.getElementById("root");
if (!root) {
  throw new Error("Onirigiri performance fixture root is missing.");
}

const multiVideo =
  new URLSearchParams(location.search).get("scenario") === "multi-video";
if (!multiVideo) installAnimationFrameWorkMeter();
createRoot(root).render(multiVideo ? <VideoFixture /> : <PerformanceFixture />);
