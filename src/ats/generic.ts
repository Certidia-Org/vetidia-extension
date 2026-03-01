/**
 * Generic ATS handler — works on any job application page.
 *
 * Strategy: "Deterministic first, AI fallback"
 * 1. Scan all visible form fields (input, textarea, select)
 * 2. Try label-based matching using shared field-mappings
 * 3. Batch unmatched fields and send to Claude Haiku for classification
 * 4. For open-ended textarea questions, generate AI answers with Claude Sonnet
 */

import type { ATSHandler } from "./base";
import type { DetectedField, FieldFillRequest, UserProfile } from "@/lib/messaging";
import type { DOMFieldInfo, ClassifiedField } from "@/lib/ai-classifier";
import { labelToProfileKey } from "./field-mappings";
import {
  setFieldValue,
  fillCustomDropdown,
  findCustomDropdowns,
  findLabelForElement,
  humanDelay,
  setCheckboxValue,
  setRadioGroupValue,
  getSelectOptions,
  getRadioGroupOptions,
} from "./base";

// ─── Field detection ──────────────────────────────────────────────

/**
 * Scan the page for all visible form fields.
 * Returns DetectedField[] with profileKey set for deterministic matches,
 * null for fields that need AI classification.
 */
function scanFormFields(
  doc: Document,
  profile: UserProfile,
): { detected: DetectedField[]; unknowns: DOMFieldInfo[] } {
  const detected: DetectedField[] = [];
  const unknowns: DOMFieldInfo[] = [];

  const formElements = doc.querySelectorAll<
    HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
  >("input, textarea, select");

  let index = 0;
  for (const el of formElements) {
    // Skip hidden, submit, button, file inputs
    if (el instanceof HTMLInputElement) {
      const skipTypes = ["hidden", "submit", "button", "image", "reset", "checkbox", "radio"];
      if (skipTypes.includes(el.type)) continue;
      // File inputs are handled separately
      if (el.type === "file") {
        detected.push({
          profileKey: null,
          label: findLabelForElement(el, doc) || "File upload",
          tagName: el.tagName.toLowerCase(),
          type: "file",
          fieldType: "file",
          currentValue: "",
          selector: buildSelector(el),
          confidence: "high",
        });
        continue;
      }
    }

    // Skip invisible elements
    if (!isVisible(el)) continue;

    const label = findLabelForElement(el, doc);
    if (!label) continue; // No label = can't classify

    const tagName = el.tagName.toLowerCase();
    const type = el instanceof HTMLInputElement ? el.type : tagName;
    const selector = buildSelector(el);
    const currentValue =
      el instanceof HTMLSelectElement
        ? el.options[el.selectedIndex]?.text ?? ""
        : el.value;

    // Determine field type
    let fieldType: "input" | "select" | "custom-dropdown" = "input";
    if (el instanceof HTMLSelectElement) fieldType = "select";

    // Try deterministic label matching
    const profileKey = labelToProfileKey(label);

    if (profileKey) {
      // Deterministic match — skip if no profile value
      const profileValue = profile[profileKey] as string | null;
      detected.push({
        profileKey,
        label,
        tagName,
        type,
        currentValue,
        selector,
        confidence: "high",
        fieldType,
      });
    } else {
      // Unknown field — queue for AI classification
      const domInfo: DOMFieldInfo = {
        index,
        label,
        tagName,
        type,
        name: el.getAttribute("name") ?? undefined,
        id: el.id || undefined,
        placeholder:
          el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement
            ? el.placeholder || undefined
            : undefined,
        ariaLabel: el.getAttribute("aria-label") ?? undefined,
      };

      // Include select options for better AI classification
      if (el instanceof HTMLSelectElement) {
        domInfo.options = Array.from(el.options)
          .slice(0, 15)
          .map((o) => o.text.trim())
          .filter(Boolean);
      }

      unknowns.push(domInfo);

      // Add as unmatched for now
      detected.push({
        profileKey: null,
        label,
        tagName,
        type,
        currentValue,
        selector,
        confidence: "low",
        fieldType,
      });
    }

    index++;
  }

  // Also detect custom dropdowns (div-based)
  const forms = doc.querySelectorAll("form");
  const container = forms.length > 0 ? forms[0] : doc.body;
  const customDropdowns = findCustomDropdowns(container);

  for (const trigger of customDropdowns) {
    // Skip if we already captured this via a native element
    const existingSelector = buildSelector(trigger);
    if (detected.some((d) => d.selector === existingSelector)) continue;

    const label = findLabelForElement(trigger, doc);
    if (!label) continue;

    const profileKey = labelToProfileKey(label);
    const currentValue = trigger.textContent?.trim() ?? "";

    if (profileKey) {
      detected.push({
        profileKey,
        label,
        tagName: trigger.tagName.toLowerCase(),
        type: "custom-dropdown",
        currentValue,
        selector: existingSelector,
        confidence: "high",
        fieldType: "custom-dropdown",
      });
    } else {
      unknowns.push({
        index: index++,
        label,
        tagName: trigger.tagName.toLowerCase(),
        type: "custom-dropdown",
        ariaLabel: trigger.getAttribute("aria-label") ?? undefined,
      });

      detected.push({
        profileKey: null,
        label,
        tagName: trigger.tagName.toLowerCase(),
        type: "custom-dropdown",
        currentValue,
        selector: existingSelector,
        confidence: "low",
        fieldType: "custom-dropdown",
      });
    }
  }

  return { detected, unknowns };
}

/**
 * Apply AI classifications to update the detected fields.
 * This is called asynchronously after the initial scan.
 */
export function applyClassifications(
  detected: DetectedField[],
  classifications: ClassifiedField[],
  unknowns: DOMFieldInfo[],
): DetectedField[] {
  for (const cls of classifications) {
    if (!cls.profileKey) continue;

    // Find the matching unknown field
    const unknown = unknowns.find((u) => u.index === cls.index);
    if (!unknown) continue;

    // Find the detected field with matching label and null profileKey
    const field = detected.find(
      (d) => d.profileKey === null && d.label === unknown.label,
    );
    if (field) {
      field.profileKey = cls.profileKey;
      field.confidence = cls.confidence;
    }
  }

  return detected;
}

// ─── Fill logic ─────────────────────────────────────────────────────

async function fillGenericFields(
  doc: Document,
  fields: FieldFillRequest[],
): Promise<number> {
  let filled = 0;

  for (const field of fields) {
    if (!field.value || !field.selector) continue;

    try {
      const el = doc.querySelector<HTMLElement>(field.selector);
      if (!el) continue;

      if (field.fieldType === "custom-dropdown") {
        const success = await fillCustomDropdown(el, field.value, doc);
        if (success) filled++;
      } else if (field.fieldType === "checkbox" && el instanceof HTMLInputElement) {
        const shouldCheck = field.checked ?? (field.value === "true" || field.value === "yes" || field.value === "1");
        setCheckboxValue(el, shouldCheck);
        filled++;
      } else if (field.fieldType === "radio-group" && field.radioGroupName) {
        const success = setRadioGroupValue(field.radioGroupName, field.value, doc);
        if (success) filled++;
      } else if (
        el instanceof HTMLInputElement ||
        el instanceof HTMLTextAreaElement ||
        el instanceof HTMLSelectElement
      ) {
        setFieldValue(el, field.value);
        filled++;
      }

      await humanDelay();
    } catch {
      // Skip individual field errors
    }
  }

  return filled;
}

// ─── Handler ────────────────────────────────────────────────────────

export const genericHandler: ATSHandler = {
  platform: "generic",

  detectFields(doc: Document, profile: UserProfile): DetectedField[] {
    // Synchronous initial scan with deterministic matching.
    // AI classification happens asynchronously via the content script.
    const { detected } = scanFormFields(doc, profile);
    return detected;
  },

  fillFields: fillGenericFields,
};

/**
 * Run the full detection pipeline including AI classification.
 * Called from content script after the initial synchronous scan.
 */
export async function detectFieldsWithAI(
  doc: Document,
  profile: UserProfile,
): Promise<DetectedField[]> {
  const { detected, unknowns } = scanFormFields(doc, profile);

  // If no unknown fields, skip AI
  if (unknowns.length === 0) return detected;

  try {
    // Send unknowns to background for AI classification
    const resp = await chrome.runtime.sendMessage({
      type: "AI_CLASSIFY_FIELDS",
      payload: { fields: unknowns },
    });

    if (resp?.classifications) {
      return applyClassifications(detected, resp.classifications, unknowns);
    }
  } catch (err) {
    console.warn("[Vetidia Copilot] AI classification failed:", err);
  }

  return detected;
}

/**
 * Generate an AI answer for an open-ended question.
 * Called from the widget when the user clicks "Generate Answer".
 */
export async function generateFieldAnswer(
  question: string,
  profile: UserProfile,
  jobContext?: string,
  maxLength?: number,
): Promise<{ answer: string; confidence: "high" | "medium" | "low" }> {
  // Build profile context string
  const profileContext = buildProfileContext(profile);

  const resp = await chrome.runtime.sendMessage({
    type: "AI_GENERATE_ANSWER",
    payload: { question, profileContext, jobContext, maxLength },
  });

  return {
    answer: resp?.answer ?? "",
    confidence: resp?.confidence ?? "low",
  };
}

// ─── Utilities ──────────────────────────────────────────────────────

function isVisible(el: HTMLElement): boolean {
  if (el.offsetParent === null && el.style.position !== "fixed") return false;
  const style = window.getComputedStyle(el);
  return style.display !== "none" && style.visibility !== "hidden";
}

function buildSelector(el: HTMLElement): string {
  if (el.id) return `#${CSS.escape(el.id)}`;

  const name = el.getAttribute("name");
  if (name) {
    const tag = el.tagName.toLowerCase();
    return `${tag}[name="${CSS.escape(name)}"]`;
  }

  // Build a path-based selector as fallback
  const parts: string[] = [];
  let current: HTMLElement | null = el;
  while (current && current !== document.body) {
    let selector = current.tagName.toLowerCase();
    if (current.id) {
      selector = `#${CSS.escape(current.id)}`;
      parts.unshift(selector);
      break;
    }
    const parent = current.parentElement;
    if (parent) {
      const siblings = Array.from(parent.children).filter(
        (c) => c.tagName === current!.tagName,
      );
      if (siblings.length > 1) {
        const idx = siblings.indexOf(current) + 1;
        selector += `:nth-of-type(${idx})`;
      }
    }
    parts.unshift(selector);
    current = parent;
  }

  return parts.join(" > ");
}

function buildProfileContext(profile: UserProfile): string {
  const lines: string[] = [];

  if (profile.name) lines.push(`Name: ${profile.name}`);
  if (profile.email) lines.push(`Email: ${profile.email}`);
  if (profile.location) lines.push(`Location: ${profile.location}`);
  if (profile.current_title) lines.push(`Current Title: ${profile.current_title}`);
  if (profile.current_company) lines.push(`Current Company: ${profile.current_company}`);
  if (profile.years_of_experience) lines.push(`Years of Experience: ${profile.years_of_experience}`);
  if (profile.education_level) lines.push(`Education: ${profile.education_level}`);
  if (profile.university) lines.push(`University: ${profile.university}`);
  if (profile.field_of_study) lines.push(`Field of Study: ${profile.field_of_study}`);
  if (profile.skills) lines.push(`Skills: ${profile.skills}`);
  if (profile.summary) lines.push(`Summary: ${profile.summary}`);
  if (profile.linkedin_url) lines.push(`LinkedIn: ${profile.linkedin_url}`);
  if (profile.github_url) lines.push(`GitHub: ${profile.github_url}`);

  return lines.join("\n");
}
