/**
 * Answer capture on form submit.
 * Watches for form submit / button clicks / SPA container removal.
 * Captures final field values and sends learning signals.
 */

import type { FieldFillResult } from "../filler/types";

export function setupFormSubmitCapture(
  fillResults: Map<string, FieldFillResult>,
  platform: string,
): () => void {
  const cleanup: Array<() => void> = [];

  // 1. Native form submit
  const forms = document.querySelectorAll("form");
  for (const form of forms) {
    const handler = () => captureOnSubmit(fillResults, platform);
    form.addEventListener("submit", handler, { once: true });
    cleanup.push(() => form.removeEventListener("submit", handler));
  }

  // 2. Submit button click (for SPA forms that don't use native submit)
  const allButtons = document.querySelectorAll<HTMLButtonElement>(
    'button[type="submit"], input[type="submit"], button, [role="button"]'
  );
  const submitBtns = Array.from(allButtons).filter(btn => {
    if (btn.getAttribute("type") === "submit") return true;
    const text = btn.textContent?.trim().toLowerCase() ?? "";
    return text.includes("submit") || text.includes("apply") ||
           text.includes("send application") || text.includes("complete");
  });
  for (const btn of submitBtns) {
    const handler = () => {
      // Small delay to let the form process
      setTimeout(() => captureOnSubmit(fillResults, platform), 500);
    };
    btn.addEventListener("click", handler, { once: true });
    cleanup.push(() => btn.removeEventListener("click", handler));
  }

  // Return cleanup function
  return () => {
    for (const fn of cleanup) fn();
  };
}

function captureOnSubmit(
  fillResults: Map<string, FieldFillResult>,
  platform: string,
): void {
  try {
    for (const [_fieldId, result] of fillResults) {
      const currentValue = getCurrentFieldValue(result.element);
      if (!currentValue) continue;

      const wasEdited = currentValue !== result.value;

      if (result.tier === 1 && !wasEdited) {
        // Tier 1 unedited: skip (no learning needed for deterministic fills)
        continue;
      }

      if (result.vaultAnswerId) {
        // Has existing vault answer
        if (wasEdited) {
          // User edited the vault answer → version it
          chrome.runtime.sendMessage({
            type: "UPDATE_LEARNING",
            answerId: result.vaultAnswerId,
            action: "edited",
            editedText: currentValue,
          }).catch(() => {});
        } else {
          // User accepted the vault answer unchanged
          chrome.runtime.sendMessage({
            type: "UPDATE_LEARNING",
            answerId: result.vaultAnswerId,
            action: "accepted",
          }).catch(() => {});
        }
      } else if (result.tier >= 2 && result.label.length >= 10) {
        // No existing vault answer + non-trivial question → save to vault
        chrome.runtime.sendMessage({
          type: "SAVE_ANSWER",
          questionText: result.label,
          answerText: currentValue,
          atsType: platform,
          pageUrl: window.location.href,
        }).catch(() => {});
      }
    }

    // Log the submission
    chrome.runtime.sendMessage({
      type: "LOG_SUBMISSION",
      atsType: platform,
      pageUrl: window.location.href,
      fieldsAttempted: fillResults.size,
      fieldsFilled: fillResults.size,
      fieldsSkipped: 0,
      fieldDetails: Array.from(fillResults.values()).map((r) => ({
        label: r.label,
        tier: r.tier,
        confidence: r.confidence,
        vaultAnswerId: r.vaultAnswerId,
        aiGenerated: r.aiGenerated,
      })),
    }).catch(() => {});
  } catch {
    // Never break the page
  }
}

function getCurrentFieldValue(el: HTMLElement): string {
  if (!el.isConnected) return "";
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
    return el.value;
  }
  if (el.isContentEditable) return el.textContent ?? "";
  return "";
}
