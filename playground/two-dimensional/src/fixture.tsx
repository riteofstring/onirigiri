import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "@riteofstring/onirigiri/styles.css";
import "../../shared/playground.css";
import { twoDimensionalFixturePanes } from "../../shared/fixture-panes";
import { TwoDimensionalPlayground } from "./two-dimensional-playground";

const root = document.getElementById("root");
if (!root) {
  throw new Error("Onirigiri two-dimensional fixture root is missing");
}

createRoot(root).render(
  <StrictMode>
    <TwoDimensionalPlayground initialPanes={twoDimensionalFixturePanes} />
  </StrictMode>,
);
