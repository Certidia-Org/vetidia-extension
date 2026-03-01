/**
 * Page observer — watches for dynamic field additions/removals.
 * Debounced re-scan on DOM changes. Handles SPA navigation and Workday wizard.
 */

export type FieldChangeCallback = () => void;

let observer: MutationObserver | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

const DEBOUNCE_MS = 600;

export function startPageObserver(
  onFieldsChanged: FieldChangeCallback,
  root: HTMLElement = document.body,
  debounceMs = DEBOUNCE_MS,
): void {
  stopPageObserver();

  observer = new MutationObserver(() => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(onFieldsChanged, debounceMs);
  });

  observer.observe(root, {
    childList: true,
    subtree: true,
  });
}

export function stopPageObserver(): void {
  if (observer) {
    observer.disconnect();
    observer = null;
  }
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
}

/**
 * Watch for URL changes (SPA navigation).
 */
export function watchUrlChanges(onUrlChange: (newUrl: string) => void): () => void {
  let lastUrl = window.location.href;

  const urlObserver = new MutationObserver(() => {
    if (window.location.href !== lastUrl) {
      lastUrl = window.location.href;
      onUrlChange(lastUrl);
    }
  });

  urlObserver.observe(document.body, { childList: true, subtree: true });
  return () => urlObserver.disconnect();
}
