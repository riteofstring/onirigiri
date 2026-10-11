const frozenContentAnimations = new WeakMap<
  HTMLElement,
  Map<Animation, number>
>();
interface AnimationTargets {
  references: Set<WeakRef<Element>>;
  tracked: WeakSet<Element>;
}

const contentAnimationTargets = new WeakMap<HTMLElement, AnimationTargets>();

export function syncContentAnimations(
  liveContent: HTMLElement,
  frozen: boolean,
) {
  trackedAnimationTargets(liveContent);
  const held = frozenContentAnimations.get(liveContent);
  if (frozen && !held) {
    frozenContentAnimations.set(
      liveContent,
      freezeRunningAnimations(liveContent),
    );
  } else if (!frozen && held) {
    for (const [animation, playbackRate] of held)
      if (animation.playbackRate === 0) animation.playbackRate = playbackRate;
    frozenContentAnimations.delete(liveContent);
  }
}

function freezeRunningAnimations(
  liveContent: HTMLElement,
): Map<Animation, number> {
  const held = new Map<Animation, number>();
  for (const animation of runningContentAnimations(liveContent)) {
    if (animation.playbackRate === 0) continue;
    held.set(animation, animation.playbackRate);
    animation.playbackRate = 0;
  }
  return held;
}

function runningContentAnimations(liveContent: HTMLElement): Set<Animation> {
  const animated = trackedAnimationTargets(liveContent);
  const running = new Set<Animation>();
  for (const reference of animated.references) {
    const element = reference.deref();
    const animations =
      element && liveContent.contains(element)
        ? element
            .getAnimations({ subtree: true })
            .filter((animation) => animation instanceof CSSAnimation)
        : [];
    if (animations.length === 0) {
      animated.references.delete(reference);
      if (element) animated.tracked.delete(element);
    }
    for (const animation of animations)
      if (animation.playState === "running") running.add(animation);
  }
  return running;
}

function trackedAnimationTargets(liveContent: HTMLElement): AnimationTargets {
  let animated = contentAnimationTargets.get(liveContent);
  if (!animated) {
    const elements: AnimationTargets = {
      references: new Set(),
      tracked: new WeakSet(),
    };
    const track = (element: Element) => {
      if (elements.tracked.has(element)) return;
      elements.tracked.add(element);
      elements.references.add(new WeakRef(element));
    };
    for (const animation of liveContent.getAnimations?.({ subtree: true }) ??
      []) {
      if (!(animation instanceof CSSAnimation)) continue;
      const target = (animation.effect as KeyframeEffect | null)?.target;
      if (target instanceof Element) track(target);
    }
    liveContent.addEventListener("animationstart", (event) => {
      if (!(event.target instanceof Element)) return;
      track(event.target);
      const held = frozenContentAnimations.get(liveContent);
      if (held)
        for (const [animation, rate] of freezeRunningAnimations(liveContent))
          held.set(animation, rate);
    });
    contentAnimationTargets.set(liveContent, elements);
    animated = elements;
  }
  return animated;
}
