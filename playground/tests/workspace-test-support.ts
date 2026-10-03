import { afterEach, vi } from "vitest";

class ResizeObserverMock {
  disconnect() {}
  observe() {}
  unobserve() {}
}

let restoreMoveBefore: (() => void) | undefined;

afterEach(() => {
  restoreMoveBefore?.();
  restoreMoveBefore = undefined;
});

export function stubOnirigiriWorkspaceBrowserGlobals(): void {
  const descriptor = Object.getOwnPropertyDescriptor(
    Element.prototype,
    "moveBefore",
  );
  Object.defineProperty(Element.prototype, "moveBefore", {
    configurable: true,
    writable: true,
    value(this: Element, node: Node, child: Node | null) {
      this.insertBefore(node, child);
    },
  });
  restoreMoveBefore = () => {
    if (descriptor)
      Object.defineProperty(Element.prototype, "moveBefore", descriptor);
    else Reflect.deleteProperty(Element.prototype, "moveBefore");
  };
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("PointerEvent", MouseEvent);
  vi.stubGlobal("ResizeObserver", ResizeObserverMock);
  vi.stubGlobal(
    "requestAnimationFrame",
    vi.fn(() => 1),
  );
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
    viewportBounds(),
  );
}

export function requiredElement<T extends Element>(
  root: ParentNode,
  selector: string,
): T {
  const element = root.querySelector<T>(selector);
  if (!element) {
    throw new Error(`missing ${selector}`);
  }
  return element;
}

function viewportBounds(): DOMRect {
  return {
    bottom: 900,
    height: 900,
    left: 0,
    right: 1200,
    toJSON: () => ({}),
    top: 0,
    width: 1200,
    x: 0,
    y: 0,
  };
}
