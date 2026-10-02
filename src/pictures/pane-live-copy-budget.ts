const liveCopyFrameBudgetMs = 8;

const costSmoothing = 0.25;

export class LiveCopyBudget {
  private frame: number | null = null;
  private spentMs = 0;
  private waiting = new Map<object, number>();
  private nextWaiting = new Map<object, number>();
  private readonly costs = new Map<object, number>();

  constructor(
    private readonly currentFrame: () => number | null,
    private readonly budgetMs = liveCopyFrameBudgetMs,
  ) {}

  request(surface: object): boolean {
    this.advance();
    const waited = this.waiting.get(surface) ?? 0;
    for (const other of this.waiting.values())
      if (other > waited) return this.defer(surface, waited);
    const cost = this.costs.get(surface) ?? 0;
    if (this.spentMs > 0 && this.spentMs + cost > this.budgetMs)
      return this.defer(surface, waited);
    this.waiting.delete(surface);
    return true;
  }

  record(surface: object, durationMs: number): void {
    this.advance();
    this.spentMs += durationMs;
    const previous = this.costs.get(surface);
    this.costs.set(
      surface,
      previous === undefined
        ? durationMs
        : previous + (durationMs - previous) * costSmoothing,
    );
  }

  forget(surface: object): void {
    this.waiting.delete(surface);
    this.nextWaiting.delete(surface);
    this.costs.delete(surface);
  }

  private defer(surface: object, waited: number): false {
    this.nextWaiting.set(surface, waited + 1);
    return false;
  }

  private advance(): void {
    const frame = this.currentFrame();
    if (frame !== null && frame === this.frame) return;
    this.frame = frame;
    this.spentMs = 0;
    this.waiting = this.nextWaiting;
    this.nextWaiting = new Map();
  }
}

const documentBudgets = new WeakMap<Document, LiveCopyBudget>();

export function documentLiveCopyBudget(document: Document): LiveCopyBudget {
  let budget = documentBudgets.get(document);
  if (!budget) {
    budget = new LiveCopyBudget(() => {
      const time = document.timeline?.currentTime;
      return typeof time === "number" ? time : null;
    });
    documentBudgets.set(document, budget);
  }
  return budget;
}
