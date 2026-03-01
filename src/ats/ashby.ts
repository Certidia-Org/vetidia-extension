/**
 * Ashby ATS handler.
 * Ashby uses CSS module patterns (._form_, [class*="ashby"]) and React-based forms.
 * Application URLs: jobs.ashbyhq.com/company/job-id/application
 */

import type { ATSHandler } from "./base";
import { setFieldValue } from "./base";
import type { DetectedField, FieldFillRequest, UserProfile } from "@/lib/messaging";
import { labelToProfileKey } from "./field-mappings";

export const ashbyHandler: ATSHandler = {
  platform: "ashby",

  detectFields(doc: Document, profile: UserProfile): DetectedField[] {
    const fields: DetectedField[] = [];

    // Ashby uses standard form elements with labels
    const formGroups = doc.querySelectorAll(
      '[class*="formField"], [class*="FormField"], .ashby-application-form-field-entry'
    );

    for (const group of formGroups) {
      const label = group.querySelector("label")?.textContent?.trim() || "";
      if (!label) continue;

      const input = group.querySelector("input, textarea, select") as
        | HTMLInputElement
        | HTMLTextAreaElement
        | HTMLSelectElement
        | null;
      if (!input) continue;

      const selector = input.id
        ? `#${CSS.escape(input.id)}`
        : input.name
          ? `[name="${CSS.escape(input.name)}"]`
          : "";

      const profileKey = labelToProfileKey(label);
      const value = profileKey ? String((profile as Record<string, unknown>)[profileKey] ?? "") : "";

      fields.push({
        label,
        selector,
        profileKey,
        type: input.tagName === "SELECT" ? "select" : input.type || "text",
        value,
        confidence: profileKey ? "high" : "low",
        required: input.hasAttribute("required") || group.querySelector("[class*='required']") !== null,
      });
    }

    // File upload detection
    const fileInputs = doc.querySelectorAll('input[type="file"]');
    for (const fi of fileInputs) {
      const label = fi.closest("[class*='formField'], [class*='FormField']")
        ?.querySelector("label")?.textContent?.trim() || "Resume";
      fields.push({
        label,
        selector: fi.id ? `#${CSS.escape(fi.id)}` : "",
        profileKey: null,
        type: "file",
        fieldType: "file",
        value: "",
        confidence: "low",
        required: false,
      });
    }

    return fields;
  },

  async fillFields(doc: Document, fields: FieldFillRequest[]): Promise<number> {
    let filled = 0;

    for (const req of fields) {
      try {
        if (!req.selector || !req.value) continue;
        const el = doc.querySelector(req.selector) as
          | HTMLInputElement
          | HTMLTextAreaElement
          | HTMLSelectElement
          | null;
        if (!el) continue;

        setFieldValue(el, req.value);
        filled++;
      } catch {
        // Never break the host page
      }
    }

    return filled;
  },
};
