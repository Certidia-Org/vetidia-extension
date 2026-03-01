/**
 * Tier 1: Deterministic field filling.
 * Uses the canonical label→profile mapping from field-mappings.ts.
 * Returns FieldFillResult or null if no match.
 */

import type { FieldFillResult, DetectedFieldInfo } from "./types";
import type { UserProfile } from "@/lib/messaging";
import { labelToProfileKey } from "@/ats/field-mappings";

export function tier1Match(
  field: DetectedFieldInfo,
  profile: UserProfile,
): FieldFillResult | null {
  const label = field.label.trim();
  if (!label) return null;

  // Try label→profile mapping (canonical table from field-mappings.ts)
  const matchFromLabel = tryLabelMatch(label, profile, field);
  if (matchFromLabel) return matchFromLabel;

  // Try name/id attribute matching as fallback
  const nameAttr = field.element.getAttribute("name")?.toLowerCase() ?? "";
  const idAttr = field.element.getAttribute("id")?.toLowerCase() ?? "";

  for (const attr of [nameAttr, idAttr]) {
    if (!attr) continue;
    const matchFromAttr = tryLabelMatch(attr, profile, field);
    if (matchFromAttr) return matchFromAttr;
  }

  return null;
}

function tryLabelMatch(
  text: string,
  profile: UserProfile,
  field: DetectedFieldInfo,
): FieldFillResult | null {
  const profileKey = labelToProfileKey(text);
  if (!profileKey) return null;

  const rawValue = (profile as Record<string, unknown>)[profileKey];
  const value = coerceToString(rawValue);
  if (!value) return null;

  return {
    fieldId: field.id,
    label: field.label,
    selector: field.selector,
    tier: 1,
    confidence: "high",
    value,
    profileKey,
    autoFilled: true,
    element: field.element,
    originalValue: getFieldValue(field.element),
  };
}

/** Coerce profile values (string, number, boolean, array) to string. */
function coerceToString(val: unknown): string {
  if (typeof val === "string" && val.trim()) return val.trim();
  if (typeof val === "number") return String(val);
  if (typeof val === "boolean") return val ? "Yes" : "No";
  if (Array.isArray(val) && val.length > 0) return val.join(", ");
  return "";
}

function getFieldValue(el: HTMLElement): string {
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
    return el.value;
  }
  if (el.isContentEditable) return el.textContent ?? "";
  return "";
}
