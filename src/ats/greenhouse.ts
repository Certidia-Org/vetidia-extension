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
 * Greenhouse ATS handler (boards.greenhouse.io).
 *
 * Greenhouse uses standard server-rendered HTML forms with predictable
 * `name` and `id` attributes. Fields live inside `#application_form`
 * or `.application-form`.
 *
 * Greenhouse forms can include:
 * - Standard <input> text fields
 * - Native <select> dropdowns (country, state, etc.)
 * - Custom div-based dropdowns (React Select components)
 * - <textarea> for longer text answers
 */

interface FieldDef {
  profileKey: keyof UserProfile;
  selectors: string[];
}

const FIELD_DEFS: FieldDef[] = [
  {
    profileKey: "first_name",
    selectors: [
      "#first_name",
      'input[name="first_name"]',
      'input[autocomplete="given-name"]',
    ],
  },
  {
    profileKey: "last_name",
    selectors: [
      "#last_name",
      'input[name="last_name"]',
      'input[autocomplete="family-name"]',
    ],
  },
  {
    profileKey: "email",
    selectors: [
      "#email",
      'input[name="email"]',
      'input[type="email"]',
      'input[autocomplete="email"]',
    ],
  },
  {
    profileKey: "phone",
    selectors: [
      "#phone",
      'input[name="phone"]',
      'input[type="tel"]',
      'input[autocomplete="tel"]',
    ],
  },
  {
    profileKey: "linkedin_url",
    selectors: [
      'input[name*="linkedin" i]',
      'input[id*="linkedin" i]',
      'input[aria-label*="LinkedIn" i]',
      'input[placeholder*="linkedin" i]',
    ],
  },
  {
    profileKey: "portfolio_url",
    selectors: [
      'input[name*="website" i]',
      'input[name*="portfolio" i]',
      'input[placeholder*="website" i]',
      'input[placeholder*="portfolio" i]',
      'input[name*="github" i]',
      'input[id*="github" i]',
      'input[placeholder*="github" i]',
    ],
  },
  {
    profileKey: "location",
    selectors: [
      "#location",
      'input[name="location"]',
      'input[autocomplete="address-level2"]',
      'input[placeholder*="City" i]',
    ],
  },
  {
    profileKey: "current_company",
    selectors: [
      'input[name*="company" i]',
      'input[id*="company" i]',
      'input[placeholder*="Current company" i]',
    ],
  },
];

/** Native <select> dropdown selectors for fields typically rendered as dropdowns. */
const SELECT_DEFS: FieldDef[] = [
  {
    profileKey: "country",
    selectors: [
      'select[name*="country" i]',
      'select[id*="country" i]',
      'select[autocomplete="country"]',
      'select[autocomplete="country-name"]',
    ],
  },
  {
    profileKey: "state",
    selectors: [
      'select[name*="state" i]',
      'select[id*="state" i]',
      'select[name*="province" i]',
      'select[id*="province" i]',
      'select[autocomplete="address-level1"]',
    ],
  },
  {
    profileKey: "education_level",
    selectors: [
      'select[name*="education" i]',
      'select[name*="degree" i]',
      'select[id*="education" i]',
      'select[id*="degree" i]',
    ],
  },
  {
    profileKey: "gender",
    selectors: [
      'select[name*="gender" i]',
      'select[id*="gender" i]',
      'select[name*="sex" i]',
    ],
  },
  {
    profileKey: "race_ethnicity",
    selectors: [
      'select[name*="race" i]',
      'select[name*="ethnicity" i]',
      'select[id*="race" i]',
      'select[id*="ethnicity" i]',
    ],
  },
  {
    profileKey: "veteran_status",
    selectors: [
      'select[name*="veteran" i]',
      'select[id*="veteran" i]',
    ],
  },
  {
    profileKey: "disability_status",
    selectors: [
      'select[name*="disability" i]',
      'select[id*="disability" i]',
      'select[name*="handicap" i]',
    ],
  },
  {
    profileKey: "work_authorization",
    selectors: [
      'select[name*="sponsor" i]',
      'select[id*="sponsor" i]',
      'select[name*="visa" i]',
    ],
  },
  {
    profileKey: "authorized_to_work",
    selectors: [
      'select[name*="authorized" i]',
      'select[name*="eligible" i]',
      'select[id*="authorized" i]',
      'select[name*="work_permit" i]',
    ],
  },
  {
    profileKey: "willing_to_relocate",
    selectors: [
      'select[name*="relocat" i]',
      'select[id*="relocat" i]',
    ],
  },
  {
    profileKey: "remote_preference",
    selectors: [
      'select[name*="remote" i]',
      'select[name*="work_arrangement" i]',
      'select[name*="on_site" i]',
      'select[name*="hybrid" i]',
    ],
  },
  {
    profileKey: "referral_source",
    selectors: [
      'select[name*="source" i]',
      'select[name*="referral" i]',
      'select[id*="source" i]',
      'select[name*="hear" i]',
    ],
  },
];

import { labelToProfileKey } from "./field-mappings";

export const greenhouseHandler: ATSHandler = {
  platform: "greenhouse",

  detectFields(doc: Document, profile: UserProfile): DetectedField[] {
    const detected: DetectedField[] = [];
    const foundKeys = new Set<string>();

    // 1. Match text input fields using known selectors
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

    // 3. Detect custom dropdown components (div-based selects)
    const formContainer =
      doc.querySelector("#application_form") ??
      doc.querySelector(".application-form") ??
      doc.querySelector("form") ??
      doc;

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

    // 4. Scan remaining inputs/textareas/selects by label for custom fields
    const allInputs = formContainer.querySelectorAll<
      HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
    >("input:not([type='hidden']):not([type='file']):not([type='submit']):not([type='checkbox']):not([type='radio']), textarea, select");

    for (const el of allInputs) {
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
          options: isSelect ? getSelectOptions(el as HTMLSelectElement) : undefined,
        });
        foundKeys.add(key);
      }
    }

    // 4b. Detect standalone checkboxes (e.g. "I agree to the privacy policy")
    const allCheckboxes = formContainer.querySelectorAll<HTMLInputElement>("input[type='checkbox']");
    for (const el of allCheckboxes) {
      const label = findLabelForElement(el, doc);
      if (!label) continue;
      const key = labelToProfileKey(label) ?? `checkbox_${label.slice(0, 20).replace(/\s+/g, "_").toLowerCase()}`;
      if (!foundKeys.has(key)) {
        detected.push({
          profileKey: null,
          label,
          tagName: "input",
          type: "checkbox",
          currentValue: el.checked ? "true" : "false",
          selector: buildSelector(el),
          confidence: "medium",
          fieldType: "checkbox",
          checked: el.checked,
        });
        foundKeys.add(key);
      }
    }

    // 4c. Detect radio groups (grouped by name attribute)
    const radioNames = new Set<string>();
    const allRadios = formContainer.querySelectorAll<HTMLInputElement>("input[type='radio']");
    for (const el of allRadios) {
      if (!el.name || radioNames.has(el.name)) continue;
      radioNames.add(el.name);
      // Find the group label (often a <fieldset><legend> or a preceding <label>)
      const fieldset = el.closest("fieldset");
      const groupLabel = fieldset?.querySelector("legend")?.textContent?.trim() ?? findLabelForElement(el, doc);
      if (!groupLabel) continue;
      const key = labelToProfileKey(groupLabel) ?? `radio_${el.name}`;
      if (!foundKeys.has(key)) {
        const checkedRadio = formContainer.querySelector<HTMLInputElement>(`input[type="radio"][name="${CSS.escape(el.name)}"]:checked`);
        detected.push({
          profileKey: labelToProfileKey(groupLabel),
          label: groupLabel,
          tagName: "input",
          type: "radio",
          currentValue: checkedRadio?.value ?? "",
          selector: `input[type="radio"][name="${CSS.escape(el.name)}"]`,
          confidence: "medium",
          fieldType: "radio-group",
          options: getRadioGroupOptions(el.name, formContainer),
          radioGroupName: el.name,
        });
        foundKeys.add(key);
      }
    }

    // 5. Detect resume file input
    const resumeInput = doc.querySelector<HTMLInputElement>(
      '#resume, input[name="resume"], input[type="file"][name*="resume" i], input[data-field="resume"]',
    );
    if (resumeInput) {
      detected.push({
        profileKey: null,
        label: "Resume",
        tagName: "input",
        type: "file",
        currentValue: "",
        selector: '#resume, input[name="resume"]',
        confidence: "high",
        fieldType: "file",
      });
    }

    // 6. Detect cover letter file input
    const coverInput = doc.querySelector<HTMLInputElement>(
      '#cover_letter, input[name="cover_letter"], input[type="file"][name*="cover" i]',
    );
    if (coverInput) {
      detected.push({
        profileKey: null,
        label: "Cover Letter",
        tagName: "input",
        type: "file",
        currentValue: "",
        selector: '#cover_letter, input[name="cover_letter"]',
        confidence: "high",
        fieldType: "file",
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

      // Handle custom dropdown components (click to open → select option)
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

/** Build a reasonably unique CSS selector for an element. */
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
