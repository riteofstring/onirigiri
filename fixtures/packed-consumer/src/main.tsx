import {
  OnirigiriWorkspace,
  useOnirigiriPaneContentReady,
  type OnirigiriPanePicture,
  defineOnirigiriChromeComponents,
  defineOnirigiriClassNames,
  defineOnirigiriStyles,
  defineOnirigiriTheme,
  type OnirigiriChromeButtonProps,
  type OnirigiriPaneDefinition,
} from "@riteofstring/onirigiri";
import "@riteofstring/onirigiri/styles.css";
import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

import "./consumer.css";

const panes = [
  {
    paneId: "packed-document",
    surfaceKind: "document",
    title: "Packed document",
  },
  {
    paneId: "packed-preview",
    surfaceKind: "preview",
    title: "Packed preview",
  },
] satisfies OnirigiriPaneDefinition[];

const workspaceTheme = defineOnirigiriTheme({
  "--onirigiri-control-size": "30px",
  "--onirigiri-pane-radius": "14px",
});

const workspaceClassNames = defineOnirigiriClassNames({
  control: "consumer-control",
  pane: "consumer-pane",
  "pane-action": "consumer-pane-action",
});

const workspaceStyles = defineOnirigiriStyles({
  "pane-tone": { opacity: 0.8 },
  "pane-picture": { borderRadius: "8px" },
  "pane-placeholder": { color: "#5b4569" },
});

function DesignSystemButton({
  className,
  ...props
}: OnirigiriChromeButtonProps) {
  return (
    <button
      className={["consumer-button", className].filter(Boolean).join(" ")}
      {...props}
    />
  );
}

const chromeComponents = defineOnirigiriChromeComponents({
  PaneActionButton: ({ action, ...props }) => (
    <DesignSystemButton data-consumer-action={action.id} {...props} />
  ),
  WorkspaceControlButton: ({ control, ...props }) => (
    <DesignSystemButton
      data-consumer-shortcut={control.shortcuts[0]?.label}
      {...props}
    />
  ),
});

function ConsumerContent({ ready, title }: { ready: boolean; title: string }) {
  useOnirigiriPaneContentReady(ready);
  return (
    <div className="consumer-document">
      <p>Public package pane: {title}</p>
      <input aria-label={`${title} note`} defaultValue="Keep this note" />
    </div>
  );
}

function ConsumerApp() {
  const [ready, setReady] = useState(true);
  const [picture, setPicture] = useState<OnirigiriPanePicture | null>(null);
  useEffect(() => {
    let active = true;
    const canvas = document.createElement("canvas");
    canvas.width = 480;
    canvas.height = 300;
    const context = canvas.getContext("2d")!;
    context.fillStyle = "#efe6d2";
    context.fillRect(0, 0, 480, 300);
    context.fillStyle = "#503f65";
    context.font = "24px Georgia";
    context.fillText("Last saved view", 32, 58);
    canvas.toBlob((image) => {
      if (active && image) setPicture({ image });
      canvas.width = canvas.height = 0;
    }, "image/png");
    return () => {
      active = false;
    };
  }, []);
  return (
    <main className="consumer-shell">
      <header>
        <h1>Packed Onirigiri consumer</h1>
        <button type="button" onClick={() => setReady((value) => !value)}>
          {ready ? "Show saved pictures" : "Show live content"}
        </button>
      </header>
      <div className="consumer-workspace">
        <OnirigiriWorkspace
          chromeComponents={chromeComponents}
          classNames={workspaceClassNames}
          initialPanes={panes}
          getPanePicture={() => picture}
          renderPane={(pane) => (
            <ConsumerContent ready={ready} title={pane.title} />
          )}
          shortcutScope="application"
          styles={workspaceStyles}
          tokens={workspaceTheme}
        />
      </div>
    </main>
  );
}

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Packed consumer root element is missing");
}

createRoot(rootElement).render(
  <StrictMode>
    <ConsumerApp />
  </StrictMode>,
);
