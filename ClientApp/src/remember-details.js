export function rememberDetails(elements, storage) {
  const cleanup = [];
  for (const element of elements) {
    const key = `tour-details:${element.dataset.remember}`;
    try {
      const saved = storage.getItem(key);
      if (saved !== null) element.open = saved === "true";
    } catch { /* Details remain usable when storage is unavailable. */ }
    const persist = () => {
      try { storage.setItem(key, String(element.open)); }
      catch { /* Keep the preference for the current page. */ }
    };
    element.addEventListener("toggle", persist);
    cleanup.push(() => element.removeEventListener("toggle", persist));
  }
  return () => cleanup.forEach(remove => remove());
}
