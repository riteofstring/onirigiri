import { createContext, useContext, useLayoutEffect, useState } from "react";

export class PaneContentReadiness {
  private readonly sources = new Map<
    object,
    { ready: boolean; revision: unknown }
  >();
  private readonly listeners = new Set<() => void>();
  revision = 0;

  getSnapshot = (): boolean =>
    [...this.sources.values()].every((source) => source.ready);

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  update(key: object, ready: boolean, revision: unknown): void {
    const old = this.sources.get(key);
    if (old?.ready === ready && Object.is(old.revision, revision)) return;
    this.sources.set(key, { ready, revision });
    this.invalidate();
  }

  remove(key: object): void {
    if (this.sources.delete(key)) this.invalidate();
  }

  invalidate = (): void => {
    this.revision++;
    for (const listener of this.listeners) listener();
  };
}

export const PaneReadinessContext = createContext<PaneContentReadiness | null>(
  null,
);

export function useOnirigiriPaneContentReady(
  ready: boolean,
  revision?: unknown,
): void {
  const owner = useContext(PaneReadinessContext);
  const [key] = useState(() => ({}));
  if (!owner)
    throw new Error(
      "useOnirigiriPaneContentReady requires Onirigiri pane content",
    );
  useLayoutEffect(() => {
    owner.update(key, ready, revision);
  }, [owner, key, ready, revision]);
  useLayoutEffect(() => () => owner.remove(key), [owner, key]);
}
