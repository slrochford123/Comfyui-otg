import { Capacitor, registerPlugin, type PluginListenerHandle } from "@capacitor/core";

interface GoogleBrowserPlugin {
  open(options: { url: string; id: string }): Promise<void>;
  close(options: { id: string }): Promise<void>;
  addListener(event: "closed", listener: (event: { id: string }) => void): Promise<PluginListenerHandle>;
}
const nativeBrowser = registerPlugin<GoogleBrowserPlugin>("SlrGoogleBrowser");

export type GoogleWindow = {
  inApp: boolean;
  navigate: (url: string) => Promise<void>;
  close: () => Promise<void>;
  isClosed: () => boolean;
};

/** Called directly from the click handler so desktop pop-up permission is kept. */
export function externalGoogleWindow(): GoogleWindow | null {
  if (Capacitor.isNativePlatform() && Capacitor.isPluginAvailable("SlrGoogleBrowser")) {
    const id = crypto.randomUUID();
    let closed = false;
    let dismissed = false;
    let listener: PluginListenerHandle | undefined;
    let opening: Promise<void> | undefined;
    let closing: Promise<void> | undefined;
    return {
      inApp: true,
      isClosed: () => dismissed,
      navigate: (url) => {
        opening = (async () => {
          if (closed) throw new DOMException("Canceled", "AbortError");
          listener = await nativeBrowser.addListener("closed", event => {
            if (event.id === id) dismissed = true;
          });
          if (!closed) await nativeBrowser.open({ url, id });
        })();
        return opening;
      },
      close: () => {
        closed = true;
        closing ??= (async () => {
          // Cancel may race the session request or native panel startup.
          await opening?.catch(() => {});
          try { if (!dismissed) await nativeBrowser.close({ id }); }
          finally { await listener?.remove(); }
        })();
        return closing;
      },
    };
  }
  // Existing installed wrappers remain compatible until their native update.
  if (Capacitor.isNativePlatform()) return {
    inApp: false,
    navigate: async url => { window.location.assign(url); },
    close: async () => {},
    isClosed: () => false,
  };
  const popup = window.open("about:blank", "_blank");
  if (!popup) return null;
  popup.opener = null;
  popup.document.title = "Opening Google Photos…";
  return {
    inApp: false,
    navigate: async url => { popup.location.href = url; },
    close: async () => { popup.close(); },
    isClosed: () => popup.closed,
  };
}
