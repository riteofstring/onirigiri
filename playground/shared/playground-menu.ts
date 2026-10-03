import { useCallback, useEffect, useRef, type KeyboardEvent } from "react";

export function usePlaygroundMenu() {
  const ref = useRef<HTMLDetailsElement>(null);
  const close = useCallback(() => {
    if (ref.current) ref.current.open = false;
    ref.current?.querySelector("summary")?.focus();
  }, []);
  const align = useCallback(() => {
    const menu = ref.current;
    if (!menu?.open) return;
    const panel = menu.lastElementChild as HTMLElement;
    panel.style.transform = "";
    panel.style.maxHeight = "";
    const bounds = panel.getBoundingClientRect();
    const left = Math.max(
      12,
      Math.min(bounds.left, innerWidth - 12 - bounds.width),
    );
    const top = Math.max(
      12,
      Math.min(bounds.top, innerHeight - 12 - Math.min(bounds.height, 240)),
    );
    panel.style.transform = `translate(${left - bounds.left}px, ${top - bounds.top}px)`;
    panel.style.maxHeight = `${innerHeight - top - 12}px`;
  }, []);

  useEffect(() => {
    const dismissOutside = (event: Event) => {
      const menu = ref.current;
      if (menu?.open && !event.composedPath().includes(menu)) menu.open = false;
    };
    const dismissOnWindowBlur = () => {
      if (ref.current) ref.current.open = false;
    };
    document.addEventListener("pointerdown", dismissOutside, true);
    document.addEventListener("focusin", dismissOutside);
    window.addEventListener("blur", dismissOnWindowBlur);
    window.addEventListener("resize", align);
    return () => {
      document.removeEventListener("pointerdown", dismissOutside, true);
      document.removeEventListener("focusin", dismissOutside);
      window.removeEventListener("blur", dismissOnWindowBlur);
      window.removeEventListener("resize", align);
    };
  }, [align]);

  return {
    close,
    menuProps: {
      ref,
      onToggle: align,
      onWheelCapture: (event: { stopPropagation(): void }) =>
        event.stopPropagation(),
      onKeyDown: (event: KeyboardEvent<HTMLDetailsElement>) => {
        if (event.key !== "Escape" || !ref.current?.open) return;
        event.preventDefault();
        event.stopPropagation();
        close();
      },
    },
  };
}
