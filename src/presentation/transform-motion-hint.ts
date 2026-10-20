export function syncTransformMotionHint(
  host: HTMLElement,
  animation: Animation | null,
  moving: boolean,
): Animation | null {
  if (!moving) {
    animation?.cancel();
    return null;
  }
  if (animation || typeof host.animate !== "function") {
    return animation;
  }
  const hint = host.animate(
    [
      { transform: "translate3d(0px, 0px, 0px)", composite: "add" },
      { transform: "translate3d(0px, 0px, 0px)", composite: "add" },
    ],
    { duration: 600_000 },
  );
  hint.pause();
  hint.currentTime = 300_000;
  return hint;
}
