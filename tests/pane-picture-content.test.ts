// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";

import { PanePictureContent } from "../src/pictures/pane-picture-content";

function scrolledTo(element: Element, top: number) {
  Object.defineProperty(element, "scrollTop", {
    configurable: true,
    value: top,
  });
  element.dispatchEvent(new Event("scroll"));
}

describe("PanePictureContent", () => {
  it("restores scroll offsets across moves, scanning descendants only the first time", () => {
    const canvas = document.createElement("canvas");
    const content = document.createElement("div");
    const timeline = document.createElement("div");
    const untouched = document.createElement("div");
    content.append(timeline, untouched);
    document.body.append(canvas, content);
    const source = new PanePictureContent(canvas, content, {
      canPresent: () => true,
      changed: () => {},
      interactive: () => true,
      presented: () => {},
    });
    const scrollTo = vi.fn();
    timeline.scrollTo = scrollTo;
    const initial = document.createElement("div");
    content.append(initial);
    Object.defineProperty(initial, "scrollTop", {
      configurable: true,
      value: 64,
    });
    const initialScrollTo = vi.fn();
    initial.scrollTo = initialScrollTo;
    source.preserveScroll(() => {});
    expect(initialScrollTo).toHaveBeenCalledWith({
      left: 0,
      top: 64,
      behavior: "instant",
    });

    const untouchedReads = vi.fn(() => 0);
    Object.defineProperty(untouched, "scrollTop", { get: untouchedReads });

    scrolledTo(timeline, 480);
    const update = vi.fn();
    source.preserveScroll(update);

    expect(update).toHaveBeenCalledOnce();
    expect(scrollTo).toHaveBeenCalledWith({
      left: 0,
      top: 480,
      behavior: "instant",
    });
    expect(untouchedReads).not.toHaveBeenCalled();

    timeline.remove();
    scrollTo.mockClear();
    source.preserveScroll(() => {});
    expect(scrollTo).not.toHaveBeenCalled();

    source.dispose();
    content.remove();
    canvas.remove();
  });
});
