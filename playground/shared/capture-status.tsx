import { useEffect, useState, type RefObject } from "react";
import type {
  OnirigiriCaptureStatus,
  OnirigiriWorkspaceHandle,
} from "@riteofstring/onirigiri";

export function CaptureStatus({
  workspace,
}: {
  workspace: RefObject<OnirigiriWorkspaceHandle | null>;
}) {
  const [message, setMessage] = useState("");
  const [detail, setDetail] = useState("");
  useEffect(() => {
    const update = () => {
      const status = workspace.current?.getCaptureStatus();
      setMessage(captureStatusMessage(status));
      setDetail(status?.state === "unavailable" ? (status.reason ?? "") : "");
    };
    update();
    const timer = setInterval(update, 500);
    return () => clearInterval(timer);
  }, [workspace]);
  return message ? (
    <span role="status" title={detail || undefined}>
      {message}
    </span>
  ) : null;
}

function captureStatusMessage(
  status: OnirigiriCaptureStatus | undefined,
): string {
  if (!status) {
    return "";
  }
  if (status.state === "unconfigured") {
    return "Initializing pane rendering.";
  }
  if (status.state === "unavailable") {
    return "Native content only";
  }
  return `${status.pictures.length} textures retained`;
}
