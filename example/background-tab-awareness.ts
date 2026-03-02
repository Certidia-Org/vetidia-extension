/**
 * background-tab-awareness.ts
 *
 * PATCH: Add these code blocks to src/entrypoints/background.ts
 *
 * This is the missing piece. Without this, the side panel has no way to know
 * when the user switches tabs. Chrome's side panel is a GLOBAL singleton —
 * it does NOT re-mount or re-render when you switch tabs.
 *
 * Architecture:
 *   Background = state coordinator (stores per-tab state, pushes on switch)
 *   Side Panel = dumb view (receives state, renders it, sends edits back)
 *   Content Script = sensor (detects ATS, scans fields, reports to background)
 *
 * ════════════════════════════════════════════════════════════════════
 *
 * HOW TO APPLY: Add these three blocks inside the defineBackground({ main() { ... } })
 * function body, AFTER the existing chrome.runtime.onMessage.addListener block
 * and BEFORE the chrome.alarms setup.
 *
 * Also add the two new cases to the handleMessage() switch statement.
 *
 * ════════════════════════════════════════════════════════════════════
 */

// ═══════════════════════════════════════════════════════
// BLOCK 1: Add inside main() after chrome.runtime.onMessage.addListener
// ═══════════════════════════════════════════════════════

// ─── Tab switch: push stored state to side panel instantly ───
chrome.tabs.onActivated.addListener(async ({ tabId, windowId }) => {
  try {
    const tab = await chrome.tabs.get(tabId);
    const tabKey = `tab_${tabId}`;
    const stored = await chrome.storage.session.get(tabKey);
    const tabState = stored[tabKey] as Record<string, unknown> | undefined;

    // Build the context payload — always send, even if empty
    const context: Record<string, unknown> = {
      tabId,
      url: tab.url || "",
      job: tabState?.job || null,
      fields: tabState?.fields || null,
      scanStatus: tabState?.scanStatus || null,
      fillResult: tabState?.fillResult || null,
    };

    // Send to side panel — it swaps its entire state
    chrome.runtime.sendMessage({
      type: "TAB_CONTEXT_CHANGED",
      payload: context,
    }).catch(() => {
      // Side panel might not be open — that's fine
    });
  } catch (err) {
    // Tab might have been removed between activation and our handler
    console.warn("[Vetidia] Tab activation handler error:", err);
  }
});

// ─── Tab navigation: detect URL changes within a tab ───
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  // Only care about URL changes (not title, favicon, loading state, etc.)
  if (!changeInfo.url) return;

  // Only process if this is the currently active tab
  try {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (activeTab?.id !== tabId) return;
  } catch {
    return;
  }

  const tabKey = `tab_${tabId}`;
  const stored = await chrome.storage.session.get(tabKey);
  const existing = (stored[tabKey] as Record<string, unknown>) || {};

  // Check if the URL actually changed to a different page
  // (ignore fragment-only changes like #section)
  const oldUrl = (existing.url as string) || "";
  const newUrl = changeInfo.url;

  try {
    const oldOriginPath = new URL(oldUrl).origin + new URL(oldUrl).pathname;
    const newOriginPath = new URL(newUrl).origin + new URL(newUrl).pathname;
    if (oldOriginPath === newOriginPath) return; // Same page, different fragment
  } catch {
    // Invalid URLs — treat as changed
  }

  // URL changed — clear old fields, keep job context temporarily
  // (content script will re-detect and send new state)
  await chrome.storage.session.set({
    [tabKey]: {
      url: newUrl,
      job: null,    // Will be re-populated by content script
      fields: null,
      scanStatus: null,
      fillResult: null,
    },
  });

  // Notify side panel that the page changed
  chrome.runtime.sendMessage({
    type: "TAB_CONTEXT_CHANGED",
    payload: {
      tabId,
      url: newUrl,
      job: null,
      fields: null,
      scanStatus: null,
      fillResult: null,
    },
  }).catch(() => {});
});

// ─── Tab closed: clean up session storage ───
chrome.tabs.onRemoved.addListener(async (tabId) => {
  const tabKey = `tab_${tabId}`;
  await chrome.storage.session.remove(tabKey).catch(() => {});
});

// ─── Window focus change: push state for the new window's active tab ───
chrome.windows.onFocusChanged.addListener(async (windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) return;

  try {
    const [tab] = await chrome.tabs.query({ active: true, windowId });
    if (!tab?.id) return;

    const tabKey = `tab_${tab.id}`;
    const stored = await chrome.storage.session.get(tabKey);
    const tabState = stored[tabKey] as Record<string, unknown> | undefined;

    chrome.runtime.sendMessage({
      type: "TAB_CONTEXT_CHANGED",
      payload: {
        tabId: tab.id,
        url: tab.url || "",
        job: tabState?.job || null,
        fields: tabState?.fields || null,
        scanStatus: tabState?.scanStatus || null,
        fillResult: tabState?.fillResult || null,
      },
    }).catch(() => {});
  } catch {}
});


// ═══════════════════════════════════════════════════════
// BLOCK 2: Add these cases to handleMessage() switch
// ═══════════════════════════════════════════════════════

/*

    // ─── Side panel saves field edits back so they persist across tab switches ───
    case "SAVE_PANEL_STATE": {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) return { success: false };
      const tabKey = `tab_${tab.id}`;
      const existing = await chrome.storage.session.get(tabKey);
      await chrome.storage.session.set({
        [tabKey]: {
          ...((existing[tabKey] as object) || {}),
          fields: message.payload?.fields ?? (existing[tabKey] as Record<string, unknown>)?.fields,
          fillResult: message.payload?.fillResult ?? null,
        },
      });
      return { success: true };
    }

    // ─── SCAN_STATUS: store + forward to side panel ───
    case "SCAN_STATUS": {
      if (senderTabId) {
        const tabKey = `tab_${senderTabId}`;
        const existing = await chrome.storage.session.get(tabKey);
        await chrome.storage.session.set({
          [tabKey]: {
            ...((existing[tabKey] as object) || {}),
            scanStatus: message.payload,
          },
        });
      }
      chrome.runtime.sendMessage({
        type: "SCAN_STATUS",
        payload: message.payload,
      }).catch(() => {});
      return { success: true };
    }

*/


// ═══════════════════════════════════════════════════════
// BLOCK 3: Update existing JOB_PAGE_DETECTED handler
//          to also store the URL in tab state
// ═══════════════════════════════════════════════════════

/*
  Replace the existing ATS_PAGE_DETECTED / JOB_PAGE_DETECTED handler with:

    case "ATS_PAGE_DETECTED":
    case "JOB_PAGE_DETECTED": {
      if (senderTabId) {
        chrome.action.setBadgeText({ tabId: senderTabId, text: "•" });
        chrome.action.setBadgeBackgroundColor({ tabId: senderTabId, color: "#10b981" });
        const tabKey = `tab_${senderTabId}`;
        const existing = await chrome.storage.session.get(tabKey);
        await chrome.storage.session.set({
          [tabKey]: {
            ...((existing[tabKey] as object) || {}),
            job: message.payload,
            url: (message.payload as Record<string, unknown>)?.url || "",
          },
        });
      }
      chrome.runtime.sendMessage({
        type: "JOB_PAGE_DETECTED",
        payload: message.payload,
      }).catch(() => {});
      return { success: true };
    }
*/


// ═══════════════════════════════════════════════════════
// BLOCK 4: Update existing FIELDS_SCANNED handler
//          to also store scanStatus = complete
// ═══════════════════════════════════════════════════════

/*
  Replace the existing FIELDS_SCANNED handler with:

    case "FIELDS_SCANNED": {
      if (senderTabId) {
        const tabKey = `tab_${senderTabId}`;
        const existing = await chrome.storage.session.get(tabKey);
        await chrome.storage.session.set({
          [tabKey]: {
            ...((existing[tabKey] as object) || {}),
            fields: message.payload,
            scanStatus: { status: "complete" },
          },
        });
      }
      chrome.runtime.sendMessage({
        type: "FIELDS_SCANNED",
        payload: message.payload,
      }).catch(() => {});
      return { success: true };
    }
*/


// ═══════════════════════════════════════════════════════
// BLOCK 5: Update existing GET_TAB_STATE handler
//          to return a richer state object
// ═══════════════════════════════════════════════════════

/*
  Replace the existing GET_TAB_STATE handler with:

    case "GET_TAB_STATE": {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) return { state: null, tabId: null, url: null };
      const tabKey = `tab_${tab.id}`;
      const stored = await chrome.storage.session.get(tabKey);
      return {
        state: stored[tabKey] ?? null,
        tabId: tab.id,
        url: tab.url || "",
      };
    }
*/
