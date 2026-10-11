export function stagePaneCanvas(
  canvas: HTMLCanvasElement,
  preserveScroll: (update: () => void) => void,
  recordingScale: () => number,
  beforeShow: () => void,
): () => void {
  const style = canvas.getAttribute("style");
  const width = canvas.offsetWidth;
  const height = canvas.offsetHeight;
  const view = canvas.ownerDocument.defaultView!;
  const scale = Math.min(1, view.innerWidth / width, view.innerHeight / height);
  const inert = canvas.inert;
  let restored = false;
  const restore = () => {
    if (restored) return;
    restored = true;
    preserveScroll(() => {
      if (canvas.matches(":popover-open")) canvas.hidePopover();
      canvas.removeAttribute("popover");
      if (style === null) canvas.removeAttribute("style");
      else canvas.setAttribute("style", style);
      canvas.style.setProperty(
        "--_onirigiri-capture-scale",
        String(recordingScale()),
      );
      canvas.inert = inert;
    });
  };
  try {
    beforeShow();
    canvas.inert = true;
    canvas.setAttribute("popover", "manual");
    Object.assign(canvas.style, {
      position: "fixed",
      left: "0",
      top: "0",
      right: "auto",
      bottom: "auto",
      width: `${width}px`,
      height: `${height}px`,
      margin: "0",
      padding: "0",
      border: "0",
      background: "transparent",
      opacity: "1",
      pointerEvents: "none",
      transformOrigin: "0 0",
      transform: `scale(${scale})`,
    });
    canvas.showPopover();
    return restore;
  } catch (error) {
    restore();
    throw error;
  }
}
