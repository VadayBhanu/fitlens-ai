import { extractProduct, isCandidateImage } from "./extract";
import type { ExtensionMessage } from "./messages";

/**
 * Injected only when the user activates FitLens on a tab (toolbar button,
 * keyboard shortcut or image context menu). Shows a "Try on" button over
 * product images; nothing is read until the user clicks it.
 */

declare global {
  interface Window {
    __fitlens?: { deactivate: () => void };
  }
}

const CSS = `
  :host { all: initial; }
  .bar { position: fixed; top: 12px; left: 50%; transform: translateX(-50%); z-index: 2147483647; display: flex; gap: 10px; align-items: center;
         background: #0B1020; color: #F6F4FF; font: 500 13px/1.3 system-ui, sans-serif; padding: 8px 10px 8px 14px; border-radius: 999px;
         box-shadow: 0 8px 30px rgba(0,0,0,.25); }
  .bar b { color: #BBA7FF; }
  .bar button { all: unset; cursor: pointer; padding: 4px 10px; border-radius: 999px; background: #262f52; color: #fff; font: 600 12px system-ui; }
  .bar button:focus-visible, .try:focus-visible { outline: 3px solid #BBA7FF; outline-offset: 2px; }
  .try { position: fixed; z-index: 2147483647; display: none; align-items: center; gap: 6px; cursor: pointer; border: 0;
         background: #6D5DF6; color: #fff; font: 700 13px system-ui, sans-serif; padding: 9px 14px; border-radius: 999px;
         box-shadow: 0 6px 20px rgba(109,93,246,.45); }
  .try:hover { background: #5545e8; }
  .outline { position: fixed; z-index: 2147483646; pointer-events: none; border: 3px solid #6D5DF6; border-radius: 10px; display: none; }
  .toast { position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%); z-index: 2147483647; background: #0B1020; color: #fff;
           font: 500 14px system-ui, sans-serif; padding: 10px 16px; border-radius: 12px; box-shadow: 0 8px 30px rgba(0,0,0,.3); }
  .toast.err { background: #8a1f1f; }
`;

(() => {
  if (window.__fitlens) return;

  const host = document.createElement("fitlens-overlay");
  const root = host.attachShadow({ mode: "closed" });
  const style = document.createElement("style");
  style.textContent = CSS;
  const bar = document.createElement("div");
  bar.className = "bar";
  bar.setAttribute("role", "status");
  const label = document.createElement("span");
  label.innerHTML = "<b>FitLens</b> is on — hover a clothing photo and click <b>Try on</b>";
  const exit = document.createElement("button");
  exit.textContent = "Done (Esc)";
  bar.append(label, exit);
  const btn = document.createElement("button");
  btn.className = "try";
  btn.type = "button";
  btn.textContent = "✨ Try on";
  btn.setAttribute("aria-label", "Try this garment on with FitLens");
  const outline = document.createElement("div");
  outline.className = "outline";
  root.append(style, outline, bar, btn);
  document.documentElement.appendChild(host);

  let current: HTMLImageElement | null = null;
  let hideTimer = 0;

  const place = (img: HTMLImageElement) => {
    const r = img.getBoundingClientRect();
    outline.style.cssText = `display:block;left:${r.left - 3}px;top:${r.top - 3}px;width:${r.width}px;height:${r.height}px`;
    btn.style.display = "flex";
    btn.style.left = `${Math.max(8, r.right - 120)}px`;
    btn.style.top = `${Math.max(8, r.top + 10)}px`;
  };

  const hide = () => {
    btn.style.display = "none";
    outline.style.display = "none";
    current = null;
  };

  const imageFromEvent = (e: Event): HTMLImageElement | null => {
    for (const el of e.composedPath()) {
      if (el instanceof HTMLImageElement) return el;
      if (el instanceof HTMLElement) {
        // Many stores overlay links/divs on top of images; look for an image underneath.
        const img = el.querySelector?.(":scope > img, :scope > picture > img") as HTMLImageElement | null;
        if (img) return img;
      }
      if (el === document.body) break;
    }
    return null;
  };

  const onOver = (e: MouseEvent) => {
    if (e.composedPath().includes(host)) {
      clearTimeout(hideTimer);
      return;
    }
    const img = imageFromEvent(e);
    if (img && isCandidateImage(img)) {
      clearTimeout(hideTimer);
      current = img;
      place(img);
    } else if (current) {
      clearTimeout(hideTimer);
      hideTimer = window.setTimeout(hide, 400);
    }
  };

  const toast = (text: string, err = false) => {
    const t = document.createElement("div");
    t.className = `toast${err ? " err" : ""}`;
    t.setAttribute("role", err ? "alert" : "status");
    t.textContent = text;
    root.appendChild(t);
    setTimeout(() => t.remove(), 3200);
  };

  const select = async (img: HTMLImageElement) => {
    const result = extractProduct(img);
    if ("error" in result) return toast(result.error, true);
    try {
      const msg: ExtensionMessage = { type: "PRODUCT_SELECTED", product: result };
      const res = (await chrome.runtime.sendMessage(msg)) as { ok: boolean; error?: string } | undefined;
      if (res && !res.ok) return toast(res.error ?? "FitLens couldn't use this product.", true);
      toast(`Sent “${result.name.slice(0, 40)}” to FitLens`);
    } catch {
      toast("FitLens was updated. Reload this page and try again.", true);
    }
  };

  const onScroll = () => current && place(current);
  const onKey = (e: KeyboardEvent) => e.key === "Escape" && deactivate();
  btn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (current) void select(current);
  });
  exit.addEventListener("click", () => deactivate());

  const onMessage = (msg: ExtensionMessage) => {
    if (msg.type === "EXTRACT_FOR_IMAGE") {
      const img = [...document.images].find((i) => i.currentSrc === msg.srcUrl || i.src === msg.srcUrl);
      if (img) void select(img);
      else toast("Couldn't find that image on the page.", true);
    } else if (msg.type === "DEACTIVATE") deactivate();
  };

  document.addEventListener("mouseover", onOver, true);
  window.addEventListener("scroll", onScroll, { passive: true, capture: true });
  window.addEventListener("resize", onScroll, { passive: true });
  document.addEventListener("keydown", onKey, true);
  chrome.runtime.onMessage.addListener(onMessage);

  function deactivate() {
    document.removeEventListener("mouseover", onOver, true);
    window.removeEventListener("scroll", onScroll, true);
    window.removeEventListener("resize", onScroll);
    document.removeEventListener("keydown", onKey, true);
    chrome.runtime.onMessage.removeListener(onMessage);
    host.remove();
    delete window.__fitlens;
  }

  window.__fitlens = { deactivate };
})();
