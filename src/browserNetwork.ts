export type BrowserNetworkHandlers = {
  onOnline?: () => void;
  onOffline?: () => void;
};

/** SSR-safe browser online/offline subscription; noop unsubscribe when unavailable */
export function subscribeToBrowserNetwork(
  handlers: BrowserNetworkHandlers,
): () => void {
  if (typeof window === "undefined") return () => {};

  const handleOnline = () => handlers.onOnline?.();
  const handleOffline = () => handlers.onOffline?.();

  window.addEventListener("online", handleOnline);
  window.addEventListener("offline", handleOffline);

  return () => {
    window.removeEventListener("online", handleOnline);
    window.removeEventListener("offline", handleOffline);
  };
}
