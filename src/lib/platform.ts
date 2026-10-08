// Helpers for running as a Chrome extension popup vs. a normal web page.

/* eslint-disable @typescript-eslint/no-explicit-any */
const chromeApi: any = (globalThis as any).chrome;

export const isExtension = typeof location !== "undefined" && location.protocol === "chrome-extension:";
export const isPopup = isExtension && !new URLSearchParams(location.search).has("full");

/** Opens the wallet in a full browser tab (needed for anchor popups, which close the extension popup). */
export function openFullTab(tab?: string) {
  const url = `${location.pathname}?full=1${tab ? `&tab=${tab}` : ""}`;
  if (chromeApi?.tabs?.create) chromeApi.tabs.create({ url: chromeApi.runtime.getURL(url.replace(/^\//, "")) });
  else window.open(url, "_blank");
  if (isPopup) window.close();
}

// Unlocked session kept in chrome.storage.session (memory only, cleared when the browser closes),
// so the popup doesn't ask for the password every time it opens.
const SESSION_KEY = "unlocked";
const sessionStore = chromeApi?.storage?.session;

export async function loadSession(): Promise<string | null> {
  if (!sessionStore) return null;
  const r = await sessionStore.get(SESSION_KEY);
  const s = r?.[SESSION_KEY] as { secret: string; expires: number } | undefined;
  if (!s || s.expires < Date.now()) {
    await sessionStore.remove(SESSION_KEY);
    return null;
  }
  return s.secret;
}

export async function saveSession(secret: string, ttlMs: number) {
  await sessionStore?.set({ [SESSION_KEY]: { secret, expires: Date.now() + ttlMs } });
}

export async function clearSession() {
  await sessionStore?.remove(SESSION_KEY);
}
