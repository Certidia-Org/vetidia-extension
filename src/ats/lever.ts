import type {
  DetectedField,
  FieldFillRequest,
  UserProfile,
} from "@/lib/messaging";
import {
  type ATSHandler,
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

/**
 * Lever ATS handler (jobs.lever.co).
 *
 * Lever uses a universal form structure across all postings.
 * Key difference: single "Full Name" field instead of first/last.
 * Forms are React-controlled so we need native property setters.
 */

interface FieldDef {
  profileKey: keyof UserProfile;
  selectors: string[];
}

const FIELD_DEFS: FieldDef[] = [
  {
    profileKey: "name",
    selectors: [
      'input[name="name"]',
      'input[placeholder*="Full name" i]',
      '.application-name input',
    ],
  },
  {
    profileKey: "email",
    selectors: [
      'input[name="email"]',
      'input[type="email"]',
      '.application-email input',
    ],
  },
  {
    profileKey: "phone",
    selectors: [
      'input[name="phone"]',
      'input[type="tel"]',
      '.application-phone input',
    ],
  },
  {
    profileKey: "location",
    selectors: [
      'input[name="location"]',
      'input[placeholder*="Location" i]',
    ],
  },
  {
    profileKey: "current_company",
    selectors: [
      'input[name="org"]',
      'input[placeholder*="Current company" i]',
      '.application-org input',
    ],
  },
  {
    profileKey: "linkedin_url",
    selectors: [
      'input[name="urls[LinkedIn]"]',
      'input[placeholder*="linkedin" i]',
      '.application-linkedin input',
    ],
  },
  {
    profileKey: "portfolio_url",
    selectors: [
      'input[name="urls[Portfolio]"]',
      'input[name="urls[GitHub]"]',
      'input[name="urls[Other]"]',
      'input[name="urls[Website]"]',
      'input[placeholder*="portfolio" i]',
      'input[placeholder*="github" i]',
    ],
  },
];

/** Native <select> dropdown selectors for fields typically rendered as dropdowns on Lever. */
const SELECT_DEFS: FieldDef[] = [
  {
    profileKey: "country",
    selectors: [
      'select[name*="country" i]',
      'select[id*="country" i]',
    ],
  },
  {
    profileKey: "state",
    selectors: [
      'select[name*="state" i]',
      'select[name*="province" i]',
    ],
  },
  {
    profileKey: "gender",
    selectors: [
      'select[name*="gender" i]',
      'select[name*="sex" i]',
    ],
  },
  {
    profileKey: "race_ethnicity",
    selectors: [
      'select[name*="race" i]',
      'select[name*="ethnicity" i]',
    ],
  },
  {
    profileKey: "veteran_status",
    selectors: [
      'select[name*="veteran" i]',
    ],
  },
  {
    profileKey: "disability_status",
    selectors: [
      'select[name*="disability" i]',
    ],
  },
  {
    profileKey: "work_authorization",
    selectors: [
      'select[name*="sponsor" i]',
      'select[name*="visa" i]',
    ],
  },
  {
    profileKey: "authorized_to_work",
    selectors: [
      'select[name*="authorized" i]',
      'select[name*="eligible" i]',
    ],
  },
  {
    profileKey: "education_level",
    selectors: [
      'select[name*="education" i]',
      'select[name*="degree" i]',
    ],
  },
  {
    profileKey: "willing_to_relocate",
    selectors: [
      'select[name*="relocat" i]',
    ],
  },
  {
    profileKey: "referral_source",
    selectors: [
      'select[name*="source" i]',
      'select[name*="referral" i]',
      'select[name*="hear" i]',
    ],
  },
];

import { labelToProfileKey } from "./field-mappings";

export const leverHandler: ATSHandler = {
  platform: "lever",

  detectFields(doc: Document, profile: UserProfile): DetectedField[] {
    const detected: DetectedField[] = [];
    const foundKeys = new Set<string>();

    // 1. Match standard Lever fields
    for (const def of FIELD_DEFS) {
      for (const selector of def.selectors) {
        const el = doc.querySelector<HTMLInputElement>(selector);
        if (el && !foundKeys.has(def.profileKey)) {
          detected.push({
            profileKey: def.profileKey,
            label: findLabelForElement(el, doc) || def.profileKey,
            tagName: el.tagName.toLowerCase(),
            type: el.type || "text",
            currentValue: el.value,
            selector,
            confidence: "high",
            fieldType: "input",
          });
          foundKeys.add(def.profileKey);
          break;
        }
      }
    }

    // 2. Match native <select> dropdowns
    for (const def of SELECT_DEFS) {
      for (const selector of def.selectors) {
        const el = doc.querySelector<HTMLSelectElement>(selector);
        if (el && !foundKeys.has(def.profileKey)) {
          detected.push({
            profileKey: def.profileKey,
            label: findLabelForElement(el, doc) || def.profileKey,
            tagName: "select",
            type: "select",
            currentValue: el.value,
            selector,
            confidence: "high",
            fieldType: "select",
          });
          foundKeys.add(def.profileKey);
          break;
        }
      }
    }

    // 3. Detect custom dropdown components
    const formContainer = doc.querySelector("form") ?? doc;
    const customDropdowns = findCustomDropdowns(formContainer);
    for (const trigger of customDropdowns) {
      const label = findLabelForElement(trigger, doc);
      if (!label) continue;

      const key = labelToProfileKey(label);
      if (key && !foundKeys.has(key)) {
        detected.push({
          profileKey: key,
          label,
          tagName: "div",
          type: "custom-dropdown",
          currentValue: trigger.textContent?.trim() ?? "",
          selector: buildSelector(trigger),
          confidence: "medium",
          fieldType: "custom-dropdown",
        });
        foundKeys.add(key);
      }
    }

    // 3. Scan custom question fields by label
    const customSections = doc.querySelectorAll(
      ".application-additional, .application-question, .custom-question",
    );
    const containers = customSections.length > 0
      ? customSections
      : [formContainer];

    for (const container of containers) {
      const inputs = container.querySelectorAll<
        HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
      >("input:not([type='hidden']):not([type='file']):not([type='submit']), textarea, select");

      for (const el of inputs) {
        const label = findLabelForElement(el, doc);
        if (!label) continue;

        const key = labelToProfileKey(label);
        if (key && !foundKeys.has(key)) {
          const isSelect = el instanceof HTMLSelectElement;
          detected.push({
            profileKey: key,
            label,
            tagName: el.tagName.toLowerCase(),
            type: isSelect ? "select" : (el instanceof HTMLInputElement ? el.type || "text" : el.tagName.toLowerCase()),
            currentValue: el.value,
            selector: buildSelector(el),
            confidence: "medium",
            fieldType: isSelect ? "select" : "input",
          });
          foundKeys.add(key);
        }
      }
    }

    // 3. Detect resume file input
    const resumeInput = doc.querySelector<HTMLInputElement>(
      'input[name="resume"], input[type="file"], .application-resume input[type="file"]',
    );
    if (resumeInput) {
      detected.push({
        profileKey: null,
        label: "Resume/CV",
        tagName: "input",
        type: "file",
        fieldType: "file",
        currentValue: "",
        selector: 'input[name="resume"], input[type="file"]',
        confidence: "high",
      });
    }

    return detected;
  },

  async fillFields(
    doc: Document,
    fields: FieldFillRequest[],
  ): Promise<number> {
    let filled = 0;

    for (const field of fields) {
      if (!field.selector) continue;

      // Handle custom dropdown components
      if (field.fieldType === "custom-dropdown") {
        const trigger = doc.querySelector<HTMLElement>(field.selector);
        if (trigger) {
          const success = await fillCustomDropdown(trigger, field.value, doc);
          if (success) filled++;
        }
        await humanDelay(100, 250);
        continue;
      }

      // Handle checkbox fields
      if (field.fieldType === "checkbox") {
        const el = doc.querySelector<HTMLInputElement>(field.selector);
        if (el && el.type === "checkbox") {
          const shouldCheck = field.checked ?? (field.value === "true" || field.value === "yes" || field.value === "1");
          setCheckboxValue(el, shouldCheck);
          filled++;
        }
        await humanDelay(50, 100);
        continue;
      }

      // Handle radio groups
      if (field.fieldType === "radio-group" && field.radioGroupName) {
        const success = setRadioGroupValue(field.radioGroupName, field.value, doc);
        if (success) filled++;
        await humanDelay(50, 100);
        continue;
      }

      // Handle native <select> and text inputs
      const el = doc.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
        field.selector,
      );

      if (!el) continue;
      if (el instanceof HTMLInputElement && el.type === "file") continue;
      if (el.value === field.value) continue;

      setFieldValue(el, field.value);
      filled++;
      await humanDelay(80, 200);
    }

    return filled;
  },
};

function buildSelector(el: Element): string {
  if (el.id) return `#${CSS.escape(el.id)}`;
  const name = el.getAttribute("name");
  if (name) return `${el.tagName.toLowerCase()}[name="${CSS.escape(name)}"]`;
  const ariaLabel = el.getAttribute("aria-label");
  if (ariaLabel) return `${el.tagName.toLowerCase()}[aria-label="${CSS.escape(ariaLabel)}"]`;
  const parent = el.parentElement;
  if (parent) {
    const siblings = Array.from(parent.children);
    const idx = siblings.indexOf(el) + 1;
    return `${buildSelector(parent)} > ${el.tagName.toLowerCase()}:nth-child(${idx})`;
  }
  return el.tagName.toLowerCase();
}
