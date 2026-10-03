import { useEffect, useLayoutEffect, useRef } from "react";

import type { WorkspaceLayoutStore } from "../state/layout-store.js";
import type { PaneId } from "../types.js";

export type OnirigiriPaneLinkHistory = "push" | "replace";

export interface OnirigiriPaneLinkOptions {
  history?: OnirigiriPaneLinkHistory;
  param?: string;
}

export interface OnirigiriPaneHrefOptions {
  base?: string | URL;
  param?: string;
}

interface ResolvedPaneLink {
  history: OnirigiriPaneLinkHistory;
  param: string;
}

const defaultPaneLinkParam = "pane";
const maximumPaneLinkLength = 256;

export function onirigiriPaneHref(
  paneId: PaneId,
  options: OnirigiriPaneHrefOptions = {},
): string {
  if (!isLinkablePaneId(paneId)) {
    throw new Error("Onirigiri pane links require a linkable pane id");
  }
  const param = resolvedParam(options.param);
  const base =
    options.base ??
    (typeof window === "undefined" ? undefined : window.location.href);
  if (base === undefined) {
    return searchWithPaneParam("", param, paneId);
  }
  const url = new URL(base);
  url.search = searchWithPaneParam(url.search, param, paneId);
  return url.href;
}

export function useOnirigiriPaneLink(
  store: WorkspaceLayoutStore,
  paneLink: boolean | OnirigiriPaneLinkOptions | undefined,
): void {
  const resolved = resolvePaneLink(paneLink);
  const param = resolved?.param ?? null;
  const history = resolved?.history ?? null;
  const startedRef = useRef(false);
  useLayoutEffect(() => {
    if (param === null || startedRef.current) {
      return;
    }
    startedRef.current = true;
    const paneId = linkedPaneId(window.location.search, param);
    if (paneId !== null) {
      store.startAtPane(paneId);
    }
  }, [param, store]);
  useEffect(() => {
    if (param === null || history === null) {
      return;
    }
    let focusedPaneId = store.getSnapshot().focusedPaneId;
    const unsubscribe = store.subscribe((snapshot) => {
      if (snapshot.focusedPaneId === focusedPaneId) {
        return;
      }
      focusedPaneId = snapshot.focusedPaneId;
      writePaneLink(param, history, focusedPaneId);
    });
    const followHistory = () => {
      const paneId = linkedPaneId(window.location.search, param);
      if (paneId !== null && paneId !== store.getSnapshot().focusedPaneId) {
        store.focusPane(paneId);
      }
    };
    window.addEventListener("popstate", followHistory);
    return () => {
      unsubscribe();
      window.removeEventListener("popstate", followHistory);
    };
  }, [history, param, store]);
}

function resolvePaneLink(
  paneLink: boolean | OnirigiriPaneLinkOptions | undefined,
): ResolvedPaneLink | null {
  if (!paneLink) {
    return null;
  }
  const options = paneLink === true ? {} : paneLink;
  const history = options.history ?? "replace";
  if (history !== "push" && history !== "replace") {
    throw new Error("Onirigiri paneLink history must be push or replace");
  }
  return { history, param: resolvedParam(options.param) };
}

function resolvedParam(param: string | undefined): string {
  const resolved = param ?? defaultPaneLinkParam;
  if (!isLinkablePaneId(resolved)) {
    throw new Error(
      "Onirigiri paneLink param must be a non-empty plain string",
    );
  }
  return resolved;
}

function linkedPaneId(search: string, param: string): PaneId | null {
  const value = new URLSearchParams(search).get(param);
  return value !== null && isLinkablePaneId(value) ? value : null;
}

function isLinkablePaneId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maximumPaneLinkLength &&
    !/[\u0000-\u001f\u007f]/.test(value)
  );
}

function writePaneLink(
  param: string,
  history: OnirigiriPaneLinkHistory,
  paneId: PaneId | null,
): void {
  const { hash, pathname, search } = window.location;
  const linkable = paneId !== null && isLinkablePaneId(paneId) ? paneId : null;
  if (linkedPaneId(search, param) === linkable) {
    return;
  }
  const url = `${pathname}${searchWithPaneParam(search, param, linkable)}${hash}`;
  if (history === "push") {
    window.history.pushState(null, "", url);
  } else {
    window.history.replaceState(window.history.state, "", url);
  }
}

function searchWithPaneParam(
  search: string,
  param: string,
  paneId: PaneId | null,
): string {
  const parts = search
    .replace(/^\?/, "")
    .split("&")
    .filter((part) => part !== "");
  const linkIndex = parts.findIndex((part) => decodedQueryKey(part) === param);
  const kept = parts.filter((part) => decodedQueryKey(part) !== param);
  if (paneId !== null) {
    kept.splice(
      linkIndex < 0 ? kept.length : linkIndex,
      0,
      `${encodeURIComponent(param)}=${encodeURIComponent(paneId)}`,
    );
  }
  return kept.length > 0 ? `?${kept.join("&")}` : "";
}

function decodedQueryKey(part: string): string {
  const separator = part.indexOf("=");
  const key = (separator < 0 ? part : part.slice(0, separator)).replaceAll(
    "+",
    " ",
  );
  try {
    return decodeURIComponent(key);
  } catch {
    return key;
  }
}
