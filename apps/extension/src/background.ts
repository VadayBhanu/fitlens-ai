import { SelectedProductInput } from "@fitlens/shared";
import { STORAGE, type ExtensionMessage, type PageStatus, type Selection } from "./messages";

/**
 * Service worker: activates FitLens on a tab only on explicit user action,
 * validates selections from content scripts, and hands them to the side panel
 * through chrome.storage.
 */

const MENU_ID = "fitlens-try-on-image";

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({ id: MENU_ID, title: "Try on with FitLens", contexts: ["image"] });
});

async function setStatus(status: Omit<PageStatus, "at">): Promise<void> {
  await chrome.storage.session.set({ [STORAGE.pageStatus]: { ...status, at: new Date().toISOString() } satisfies PageStatus });
}

async function activate(tabId: number): Promise<boolean> {
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
    await setStatus({ state: "active" });
    return true;
  } catch {
    await setStatus({ state: "unsupported", message: "FitLens can't run on this page (browser pages, the Chrome Web Store and some protected sites block extensions). Open a store's product page, or upload a garment photo instead." });
    return false;
  }
}

chrome.action.onClicked.addListener((tab) => {
  if (tab.id === undefined) return;
  // sidePanel.open must be called synchronously within the user gesture.
  void chrome.sidePanel.open({ tabId: tab.id });
  void activate(tab.id);
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== MENU_ID || tab?.id === undefined || !info.srcUrl) return;
  const tabId = tab.id;
  void chrome.sidePanel.open({ tabId });
  void (async () => {
    if (await activate(tabId)) {
      const msg: ExtensionMessage = { type: "EXTRACT_FOR_IMAGE", srcUrl: info.srcUrl! };
      await chrome.tabs.sendMessage(tabId, msg).catch(() => undefined);
    }
  })();
});

chrome.runtime.onMessage.addListener((msg: ExtensionMessage, sender, sendResponse) => {
  if (msg?.type !== "PRODUCT_SELECTED") return false;
  // Only accept selections from our own content script running in a web page tab
  // (not from extension pages, which also have sender.tab when opened as a tab).
  const fromWebPage = !!sender.tab && /^https?:\/\//.test(sender.url ?? "");
  if (sender.id !== chrome.runtime.id || !fromWebPage) {
    sendResponse({ ok: false, error: "Rejected" });
    return false;
  }
  const parsed = SelectedProductInput.safeParse(msg.product);
  if (!parsed.success) {
    sendResponse({ ok: false, error: "That doesn't look like a product image FitLens can use." });
    return false;
  }
  const selection: Selection = { product: parsed.data, tabId: sender.tab?.id ?? null, selectedAt: new Date().toISOString() };
  void (async () => {
    await chrome.storage.session.set({ [STORAGE.selection]: selection });
    const { [STORAGE.recent]: recent = [] } = (await chrome.storage.local.get(STORAGE.recent)) as { [k: string]: Selection[] };
    const next = [selection, ...recent.filter((r) => r.product.imageUrl !== selection.product.imageUrl)].slice(0, 20);
    await chrome.storage.local.set({ [STORAGE.recent]: next });
    sendResponse({ ok: true });
  })();
  return true; // async response
});

// Let users open the panel with the toolbar button on every tab.
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(() => undefined);
