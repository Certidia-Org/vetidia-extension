/**
 * iCIMS ATS handler.
 * iCIMS uses a two-step flow (registration + application).
 * Container: .iCIMS_MainWrapper
 * Application URLs: careers-[company].icims.com/jobs/[id]/job
 */

import type { ATSHandler } from "./base";
import { setFieldValue } from "./base";
import type { DetectedField, FieldFillRequest, UserProfile } from "@/lib/messaging";
import { labelToProfileKey } from "./field-mappings";

export const icimsHandler: ATSHandler = {
  platform: "icims",

  detectFields(doc: Document, profile: UserProfile): DetectedField[] {
    const fields: DetectedField[] = [];

    // iCIMS uses .iCIMS_InfoMsg_Job class containers and standard form elements
    const container = doc.querySelector(".iCIMS_MainWrapper") || doc.body;

    // Find all labeled form fields
    const labels = container.querySelectorAll("label");
    for (const label of labels) {
      const text = label.textContent?.trim() || "";
      if (!text || text.length < 2) continue;

      const forId = label.getAttribute("for");
      const input = forId
        ? doc.getElementById(forId) as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null
        : label.querySelector("input, textarea, select") as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null;

      if (!input) continue;
      if (input.type === "hidden" || input.type === "submit") continue;

      const selector = input.id
        ? `#${CSS.escape(input.id)}`
        : input.name
          ? `[name="${CSS.escape(input.name)}"]`
          : "";

      const profileKey = labelToProfileKey(text);
      const value = profileKey ? String((profile as Record<string, unknown>)[profileKey] ?? "") : "";

      fields.push({
        label: text,
        selector,
        profileKey,
        type: input.tagName === "SELECT" ? "select" : input.type || "text",
        value,
        confidence: profileKey ? "high" : "low",
        required: input.hasAttribute("required") || label.querySelector(".required") !== null,
      });
    }

    // File uploads
    const fileInputs = container.querySelectorAll('input[type="file"]');
    for (const fi of fileInputs) {
      const label = fi.closest("div, td")?.querySelector("label")?.textContent?.trim() || "Resume";
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
