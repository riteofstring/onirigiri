import { createContext } from "react";
import type { CSSProperties } from "react";
import type {
  PaneContentDefaults,
  PaneDefaultsConfiguration,
} from "../types.js";

export const PaneDefaultsContext = createContext<PaneDefaultsConfiguration>({});

export function paneContentFrameStyle(
  content: PaneContentDefaults,
): CSSProperties {
  const fit = content.fit ?? (content.aspectRatio ? "contain" : undefined);
  const ratio = content.aspectRatio;
  if (!fit || !ratio || fit === "fill") return { objectFit: fit };
  const size = fit === "contain" ? "min" : "max";
  return {
    height: `${size}(100cqh, calc(100cqw * ${1 / ratio}))`,
    objectFit: fit,
    width: `${size}(100cqw, calc(100cqh * ${ratio}))`,
  };
}
