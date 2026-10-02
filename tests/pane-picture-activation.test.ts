import { describe, expect, it } from "vitest";
import { orderPaneActivation } from "../src/pictures/pane-picture-activation";
import { renderItem } from "./pane-presentation-engine-test-support";

describe("pane activation order", () => {
  it("prioritizes focus and nearby mixed-size panes, preserving ties and input identity", () => {
    const items = [
      renderItem({ paneId: "large", x: 500, width: 1000 }),
      renderItem({ paneId: "left", x: -100, width: 100 }),
      renderItem({ paneId: "right", x: 100, width: 100 }),
      renderItem({ paneId: "focus", x: 0, width: 100 }),
      renderItem({ paneId: "far", x: 400, width: 100 }),
    ];
    const ordered = orderPaneActivation(items, "focus");
    expect(ordered).toEqual([items[3], items[1], items[2], items[0], items[4]]);
    expect(ordered[0]).toBe(items[3]);
    expect(items.map((item) => item.paneId)).toEqual([
      "large",
      "left",
      "right",
      "focus",
      "far",
    ]);
    expect(orderPaneActivation(items, "missing")[0]).toBe(items[0]);
    expect(orderPaneActivation([], null)).toEqual([]);
    items[4]!.x = 20;
    expect(orderPaneActivation(items, "focus")[1]).toBe(items[4]);
  });

  it.each([100, 500])(
    "bounds geometry reads when ordering %s panes",
    (count) => {
      let reads = 0;
      const items = Array.from({ length: count }, (_, index) => ({
        ...renderItem({ paneId: `pane-${index}` }),
        get x() {
          reads++;
          return (index % 17) * 100;
        },
      }));
      const result = orderPaneActivation(items, "pane-37");
      expect(result[0]).toBe(items[37]);
      expect(new Set(result).size).toBe(count);
      expect(reads).toBeLessThanOrEqual(count * 2);
    },
  );
});
