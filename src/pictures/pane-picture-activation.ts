import type { PaneId, PaneRenderItem } from "../types";

export class PanePictureActivation {
  private readonly active = new Set<PaneId>();
  private ordered: readonly PaneId[] = [];
  private pending: { id: PaneId; deadline: number } | null = null;
  private frame: number | null = null;
  private view: Window | null = null;
  private focused: PaneId | null = null;

  constructor(private readonly changed: (id: PaneId) => void) {}

  has(id: PaneId): boolean {
    return this.active.has(id);
  }

  settled(): boolean {
    return this.ordered.every((id) => this.active.has(id));
  }

  updateImmediate(items: readonly PaneRenderItem[]): void {
    if (this.frame !== null) this.view?.cancelAnimationFrame(this.frame);
    this.frame = null;
    this.pending = null;
    this.ordered = items.map((item) => item.paneId);
    const next = new Set(this.ordered);
    for (const id of this.active) {
      if (next.has(id)) continue;
      this.active.delete(id);
      this.changed(id);
    }
    for (const id of next) {
      if (this.active.has(id)) continue;
      this.active.add(id);
      this.changed(id);
    }
  }

  update(
    items: readonly PaneRenderItem[],
    focused: PaneId | null,
    view: Window | null,
  ): void {
    this.view = view;
    this.ordered = orderPaneActivation(items, focused).map(
      (item) => item.paneId,
    );
    this.reconcile();
    if (focused !== this.focused && focused && this.ordered.includes(focused))
      this.activate(focused);
    this.focused = focused;
    if (!this.active.size && this.ordered[0]) this.activate(this.ordered[0]);
    this.schedule();
  }

  private reconcile(): void {
    for (const id of this.active) {
      if (this.ordered.includes(id)) continue;
      this.active.delete(id);
      this.changed(id);
    }
    if (this.pending && !this.active.has(this.pending.id)) this.pending = null;
  }

  painted(id: PaneId): void {
    if (this.pending?.id !== id) return;
    this.pending = null;
    this.schedule();
  }

  dispose(): void {
    if (this.frame !== null) this.view?.cancelAnimationFrame(this.frame);
    this.frame = null;
    this.pending = null;
    this.ordered = [];
    this.active.clear();
    this.view = null;
    this.focused = null;
  }

  private activate(id: PaneId): void {
    if (this.active.has(id)) return;
    this.active.add(id);
    this.pending = { id, deadline: Date.now() + 200 };
    this.changed(id);
  }

  private schedule(): void {
    if (this.frame !== null || !this.view || this.settled()) return;
    this.frame = this.view.requestAnimationFrame(() => {
      this.frame = null;
      if (this.pending && Date.now() >= this.pending.deadline)
        this.pending = null;
      if (!this.pending) {
        const next = this.ordered.find((id) => !this.active.has(id));
        if (next) this.activate(next);
      }
      this.schedule();
    });
  }
}

export function orderPaneActivation(
  items: readonly PaneRenderItem[],
  focused: PaneId | null,
): PaneRenderItem[] {
  const anchor = items.find((item) => item.paneId === focused) ?? items[0];
  return items
    .map((item) => ({
      item,
      distance:
        item.paneId === focused ? -1 : paneActivationDistance(item, anchor),
    }))
    .sort((a, b) => a.distance - b.distance)
    .map(({ item }) => item);
}

export function paneActivationDistance(
  item: PaneRenderItem,
  anchor: PaneRenderItem | undefined,
): number {
  return Math.max(
    Math.abs(
      item.x + item.width / 2 - (anchor ? anchor.x + anchor.width / 2 : 0),
    ) / Math.max(1, (item.width + (anchor?.width ?? item.width)) / 2),
    Math.abs(
      item.y + item.height / 2 - (anchor ? anchor.y + anchor.height / 2 : 0),
    ) / Math.max(1, (item.height + (anchor?.height ?? item.height)) / 2),
  );
}
