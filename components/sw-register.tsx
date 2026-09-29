"use client";

import { useEffect } from "react";

/** Registers the offline-notes service worker (field app only). */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  }, []);
  return null;
}
