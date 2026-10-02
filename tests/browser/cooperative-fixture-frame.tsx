import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { useOnirigiriPaneContentReady } from "../../src/index";

interface FixtureTheme {
  colorMode: "dark" | "light";
  styles: Record<string, string>;
}

interface FixtureFrameProps {
  protocol: string;
  runtime: string;
  src: string;
  theme?: FixtureTheme;
  title: string;
}

export function CooperativeFixtureFrame(props: FixtureFrameProps) {
  return <FixtureDocument key={props.src} {...props} />;
}

function FixtureDocument({
  protocol,
  runtime,
  src,
  theme,
  title,
}: FixtureFrameProps) {
  const [frameSource] = useState(() => {
    const url = new URL(src);
    if (theme) url.searchParams.set("theme", JSON.stringify(theme));
    return url.href;
  });
  const themeKey = JSON.stringify(theme ?? null);
  const themeRequest = useMemo(
    () => (themeKey === "null" ? null : crypto.randomUUID()),
    [themeKey],
  );
  const [themeApplied, setThemeApplied] = useState<string | null>(null);
  const [state, setState] = useState({
    src,
    document: "initial",
    loaded: false,
    ready: false,
  });
  const presented =
    state.src === src &&
    state.loaded &&
    state.ready &&
    themeApplied === themeRequest;
  const iframe = useRef<HTMLIFrameElement>(null);
  const document = useRef<Document | null>(null);
  const command = runtime === "live" ? "resume" : "pause";
  const origin = new URL(src).origin;
  useOnirigiriPaneContentReady(
    presented,
    `${state.src}:${state.document}:${themeApplied}`,
  );
  useLayoutEffect(() => {
    const frame = iframe.current;
    if (!frame) return;
    const view = frame.ownerDocument.defaultView;
    const receive = (event: MessageEvent) => {
      if (event.origin !== origin || event.source !== frame.contentWindow)
        return;
      const message = readinessMessage(event.data, protocol);
      if (!message) return;
      switch (message.type) {
        case "theme-applied":
          if (message.requestId === themeRequest) setThemeApplied(themeRequest);
          break;
        case "ready":
          document.current = frame.contentDocument;
          setState((current) => ({
            ...current,
            src,
            ready: message.supported,
            document: crypto.randomUUID(),
          }));
          break;
      }
    };
    view?.addEventListener("message", receive);
    return () => view?.removeEventListener("message", receive);
  }, [origin, protocol, src, themeRequest]);
  useLayoutEffect(() => {
    if (state.ready)
      iframe.current?.contentWindow?.postMessage({ protocol, command }, origin);
  }, [command, origin, protocol, state.document, state.ready]);
  useLayoutEffect(() => {
    if (state.ready && theme && themeRequest !== themeApplied)
      iframe.current?.contentWindow?.postMessage(
        { protocol, command: "theme", theme, requestId: themeRequest },
        origin,
      );
  }, [
    origin,
    protocol,
    state.document,
    state.ready,
    theme,
    themeApplied,
    themeRequest,
  ]);
  useLayoutEffect(() => {
    const frame = iframe.current;
    const invalidate = () => {
      setThemeApplied(null);
      setState((current) => ({ ...current, loaded: false, ready: false }));
    };
    const observe = () =>
      frame?.contentWindow?.addEventListener("pagehide", invalidate, {
        once: true,
      });
    frame?.addEventListener("load", observe);
    return () => {
      frame?.removeEventListener("load", observe);
      frame?.contentWindow?.removeEventListener("pagehide", invalidate);
    };
  }, []);
  return (
    <iframe
      data-consumer-state={runtime}
      data-consumer-ready={String(presented)}
      onLoad={() => {
        const currentDocument = iframe.current?.contentDocument ?? null;
        if (document.current !== currentDocument) {
          document.current = currentDocument;
          setThemeApplied(null);
          setState((current) => ({
            ...current,
            src,
            document: crypto.randomUUID(),
            loaded: true,
            ready: false,
          }));
        } else setState((current) => ({ ...current, src, loaded: true }));
      }}
      ref={iframe}
      src={frameSource}
      title={title}
      style={{ width: "100%", height: "100%", border: 0, display: "block" }}
    />
  );
}

function readinessMessage(
  data: unknown,
  protocol: string,
):
  | { type: "ready"; supported: boolean }
  | { type: "theme-applied"; requestId: string }
  | null {
  if (!data || typeof data !== "object") return null;
  const message = data as {
    protocol?: unknown;
    type?: unknown;
    requestId?: unknown;
    snapshot?: { supported?: boolean };
  };
  return message.protocol === protocol
    ? fixtureReadinessMessage(message)
    : null;
}

function fixtureReadinessMessage(message: {
  type?: unknown;
  requestId?: unknown;
  snapshot?: { supported?: boolean };
}):
  | { type: "ready"; supported: boolean }
  | { type: "theme-applied"; requestId: string }
  | null {
  switch (message.type) {
    case "theme-applied":
      return typeof message.requestId === "string"
        ? { type: "theme-applied", requestId: message.requestId }
        : null;
    case "ready":
      return {
        type: "ready",
        supported: message.snapshot?.supported !== false,
      };
    default:
      return null;
  }
}
