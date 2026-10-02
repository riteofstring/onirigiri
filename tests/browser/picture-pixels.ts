import type { Locator, Page } from "@playwright/test";

export async function picturePixels(
  page: Page,
  picture: Locator,
): Promise<string> {
  const state = await picture.evaluate((element) => {
    const canvas = element as HTMLCanvasElement;
    const style = canvas.getAttribute("style");
    const popover = canvas.getAttribute("popover");
    const width = canvas.width / devicePixelRatio;
    const height = canvas.height / devicePixelRatio;
    canvas.setAttribute("popover", "manual");
    Object.assign(canvas.style, {
      position: "fixed",
      left: "0",
      top: "0",
      right: "auto",
      bottom: "auto",
      width: `${width}px`,
      height: `${height}px`,
      maxWidth: "none",
      maxHeight: "none",
      padding: "0",
      margin: "0",
      border: "0",
      transform: "none",
      objectFit: "fill",
    });
    canvas.showPopover();
    return { style, popover, width, height };
  });
  try {
    return (
      await page.screenshot({
        clip: { x: 0, y: 0, width: state.width, height: state.height },
      })
    ).toString("base64");
  } finally {
    await picture.evaluate((element, state) => {
      const canvas = element as HTMLCanvasElement;
      canvas.hidePopover();
      if (state.style === null) canvas.removeAttribute("style");
      else canvas.setAttribute("style", state.style);
      if (state.popover === null) canvas.removeAttribute("popover");
      else canvas.setAttribute("popover", state.popover);
    }, state);
  }
}
