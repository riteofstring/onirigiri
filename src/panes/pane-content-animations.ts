const pausedContentAnimations = new WeakMap<HTMLElement, Animation[]>();
const contentAnimationTargets = new WeakMap<HTMLElement, Set<Element>>();

export function syncContentAnimations(
  liveContent: HTMLElement,
  frozen: boolean,
) {
  const paused = pausedContentAnimations.get(liveContent);
  if (frozen && !paused) {
    pausedContentAnimations.set(
      liveContent,
      pauseRunningAnimations(liveContent),
    );
  } else if (!frozen && paused) {
    for (const animation of paused)
      if (animation.playState === "paused") animation.play();
    pausedContentAnimations.delete(liveContent);
  }
}

function pauseRunningAnimations(liveContent: HTMLElement): Animation[] {
  const animated = trackedAnimationTargets(liveContent);
  const running = new Set<Animation>();
  for (const element of animated) {
    const animations = element.isConnected
      ? element
          .getAnimations({ subtree: true })
          .filter(
            (animation) =>
              animation instanceof CSSAnimation &&
              animation.playState === "running",
          )
      : [];
    if (animations.length === 0) animated.delete(element);
    for (const animation of animations) running.add(animation);
  }
  for (const animation of running) animation.pause();
  return [...running];
}

function trackedAnimationTargets(liveContent: HTMLElement): Set<Element> {
  let animated = contentAnimationTargets.get(liveContent);
  if (!animated) {
    const elements = new Set<Element>();
    liveContent.addEventListener("animationstart", (event) => {
      if (!(event.target instanceof Element)) return;
      elements.add(event.target);
      const paused = pausedContentAnimations.get(liveContent);
      if (paused) paused.push(...pauseRunningAnimations(liveContent));
    });
    contentAnimationTargets.set(liveContent, elements);
    animated = elements;
  }
  return animated;
}
