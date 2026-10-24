declare const __FITLENS_API_URL__: string;
declare const __FITLENS_WEB_URL__: string;

export interface Settings {
  apiUrl: string;
  webUrl: string;
}

export const DEFAULT_SETTINGS: Settings = { apiUrl: __FITLENS_API_URL__, webUrl: __FITLENS_WEB_URL__ };

export async function getSettings(): Promise<Settings> {
  const r = await chrome.storage.sync.get("fitlens.settings");
  const s = (r["fitlens.settings"] ?? {}) as Partial<Settings>;
  return { apiUrl: (s.apiUrl || DEFAULT_SETTINGS.apiUrl).replace(/\/$/, ""), webUrl: (s.webUrl || DEFAULT_SETTINGS.webUrl).replace(/\/$/, "") };
}

export async function saveSettings(s: Settings): Promise<void> {
  await chrome.storage.sync.set({ "fitlens.settings": s });
}
