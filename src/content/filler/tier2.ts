/**
 * Tier 2: Semantic matching via answer vault.
 * Sends question to background → Edge Function → pgvector search.
 * Returns FieldFillResult or null.
 */

import type { FieldFillResult, DetectedFieldInfo } from "./types";

const AUTO_FILL_THRESHOLD = 0.85;
const SUGGEST_THRESHOLD = 0.70;

export async function tier2Match(
  field: DetectedFieldInfo,
): Promise<FieldFillResult | null> {
  const label = field.label.trim();
  if (!label || label.length < 5) return null; // Skip very short labels

  try {
    const resp = await chrome.runtime.sendMessage({
      type: "MATCH_ANSWER_VAULT",
      questionText: label,
    });

    const match = resp?.answer;
    if (!match) return null;

    const similarity = match.similarity ?? match.confidence ?? 0;
    if (similarity < SUGGEST_THRESHOLD) return null;

    const isAutoFill = similarity >= AUTO_FILL_THRESHOLD && match.autoFillEnabled;

    return {
      fieldId: field.selector,
      label: field.label,
      selector: field.selector,
      tier: 2,
      confidence: isAutoFill ? "high" : "medium",
      value: match.answerText ?? match.answer_text ?? "",
      similarity,
      vaultAnswerId: match.id,
      autoFilled: isAutoFill,
      element: field.element,
      originalValue: getFieldValue(field.element),
    };
  } catch {
    return null;
  }
}

function getFieldValue(el: HTMLElement): string {
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
    return el.value;
  }
  return el.isContentEditable ? (el.textContent ?? "") : "";
}
