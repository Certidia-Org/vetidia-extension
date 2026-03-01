/**
 * Tier 3: AI generation for unmatched fields.
 * Only for textarea/text fields with labels > 10 chars.
 * Returns FieldFillResult or null.
 */

import type { FieldFillResult, DetectedFieldInfo } from "./types";

const MIN_LABEL_LENGTH = 10;

export async function tier3Generate(
  field: DetectedFieldInfo,
  jobContext?: string,
): Promise<FieldFillResult | null> {
  const label = field.label.trim();
  if (!label || label.length < MIN_LABEL_LENGTH) return null;

  // Only generate for text-heavy fields (textarea, long text inputs)
  const tag = field.tagName.toLowerCase();
  const inputType = field.inputType?.toLowerCase();
  const isTextArea = tag === "textarea";
  const isTextInput = tag === "input" && (!inputType || inputType === "text");
  const isContentEditable = field.element.isContentEditable;

  if (!isTextArea && !isTextInput && !isContentEditable) return null;

  try {
    const resp = await chrome.runtime.sendMessage({
      type: "AI_GENERATE_ANSWER",
      payload: {
        question: label,
        profileContext: "", // Edge Function fetches context
        jobContext: jobContext || "",
        maxLength: isTextArea ? 1000 : 200,
      },
    });

    const answer = resp?.answer;
    if (!answer || typeof answer !== "string" || answer.length < 2) return null;

    return {
      fieldId: field.id,
      label: field.label,
      selector: field.selector,
      tier: 3,
      confidence: "low",
      value: answer,
      aiGenerated: true,
      autoFilled: false, // Tier 3 always requires review
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
