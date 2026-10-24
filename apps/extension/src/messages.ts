import type { SelectedProductInput } from "@fitlens/shared";

/** Messages exchanged between the content script, service worker and side panel. */
export type ExtensionMessage =
  | { type: "PRODUCT_SELECTED"; product: SelectedProductInput }
  | { type: "EXTRACT_FOR_IMAGE"; srcUrl: string }
  | { type: "DEACTIVATE" };

export interface Selection {
  product: SelectedProductInput;
  tabId: number | null;
  selectedAt: string;
}

export interface PageStatus {
  state: "active" | "unsupported" | "idle";
  message?: string;
  at: string;
}

export const STORAGE = {
  selection: "fitlens.selection",
  pageStatus: "fitlens.pageStatus",
  recent: "fitlens.recent",
  token: "fitlens.token",
  settings: "fitlens.settings"
} as const;
