import { createContext, useContext } from "react";

export const PaneInteractiveContext = createContext(false);

export function useOnirigiriPaneInteractive(): boolean {
  return useContext(PaneInteractiveContext);
}
