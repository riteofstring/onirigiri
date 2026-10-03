import { useEffect, useState } from "react";

const sampleDurationMilliseconds = 1_000;

export function DisplayFrameRate() {
  const frameRate = useDisplayFrameRate();
  const value = frameRate === null ? "— FPS" : `${frameRate} FPS`;
  const accessibleValue =
    frameRate === null
      ? "Browser display frame rate: sampling"
      : `Browser display frame rate: ${frameRate} frames per second`;

  return (
    <output
      aria-label={accessibleValue}
      aria-live="off"
      className="playground-frame-rate"
    >
      {value}
    </output>
  );
}

function useDisplayFrameRate(): number | null {
  const [frameRate, setFrameRate] = useState<number | null>(null);

  useEffect(() => {
    let active = true;
    let frameId: number | null = null;
    let sampleFrameCount = 0;
    let sampleStartTimestamp: number | null = null;

    const resetSample = () => {
      sampleFrameCount = 0;
      sampleStartTimestamp = null;
    };

    const cancelSampling = () => {
      if (frameId === null) {
        return;
      }
      cancelAnimationFrame(frameId);
      frameId = null;
    };

    function requestNextFrame(): void {
      if (
        !active ||
        document.visibilityState !== "visible" ||
        frameId !== null
      ) {
        return;
      }
      frameId = requestAnimationFrame(sampleFrame);
    }

    function sampleFrame(timestamp: number): void {
      frameId = null;
      if (!active || document.visibilityState !== "visible") {
        return;
      }
      if (sampleStartTimestamp === null) {
        sampleStartTimestamp = timestamp;
      } else {
        sampleFrameCount += 1;
        const elapsed = timestamp - sampleStartTimestamp;
        if (elapsed >= sampleDurationMilliseconds) {
          const nextFrameRate = Math.round(
            (sampleFrameCount * sampleDurationMilliseconds) / elapsed,
          );
          setFrameRate((current) =>
            current === nextFrameRate ? current : nextFrameRate,
          );
          resetSample();
          sampleStartTimestamp = timestamp;
        }
      }
      requestNextFrame();
    }

    const startSampling = () => {
      if (frameId !== null) {
        return;
      }
      resetSample();
      requestNextFrame();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        startSampling();
        return;
      }
      cancelSampling();
      resetSample();
      setFrameRate(null);
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    startSampling();
    return () => {
      active = false;
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      cancelSampling();
    };
  }, []);

  return frameRate;
}
