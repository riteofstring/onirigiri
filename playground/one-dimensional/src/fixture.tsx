import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "@riteofstring/onirigiri/styles.css";
import "../../shared/playground.css";
import { oneDimensionalFixturePanes } from "../../shared/fixture-panes";
import { OneDimensionalPlayground } from "./one-dimensional-playground";

const root = document.getElementById("root");
if (!root) {
  throw new Error("Onirigiri one-dimensional fixture root is missing");
}

createRoot(root).render(
  <StrictMode>
    <OneDimensionalPlayground initialPanes={oneDimensionalFixturePanes} />
  </StrictMode>,
);
