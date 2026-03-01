import type {
  DetectedField,
  FieldFillRequest,
  UserProfile,
} from "@/lib/messaging";
import {
  type ATSHandler,
  setFieldValue,
  fillCustomDropdown,
  findLabelForElement,
  humanDelay,
  waitForElement,
} from "./base";
import { labelToProfileKey } from "./field-mappings";

/**
 * Workday ATS handler (*.myworkdayjobs.com).
 *
 * Workday is the most complex ATS to automate (37% of Fortune 500):
 * - Uses `data-automation-id` attributes for element identification
 * - Two container patterns:
 *   1. Direct: data-automation-id on the <input> itself (e.g. legalNameSection_firstName)
 *   2. Container: data-automation-id="formField-*" on a parent <div> with <input> nested
 * - Canvas Kit UI components (ARIA Combobox dropdowns, searchable multi-selects)
 * - Multi-page wizard (My Information → My Experience → Application Questions → Review)
 * - React-controlled fields requiring native property setters + synthetic events
 *
 * Verified selectors from: berellevy/job_app_filler, ubangura/Workday-Application-Automator,
 * andrewmillercode/Autofill-Jobs
 */

interface FieldDef {
  profileKey: keyof UserProfile;
  /** data-automation-id values to match (on the input itself or a parent container). */
  automationIds: string[];
  /** Fallback CSS selectors if automation IDs don't match. */
  fallbackSelectors?: string[];
}

// ─── Wizard Page Containers ─────────────────────────────────────────

const PAGE_CONTAINERS = [
  "contactInformationPage",
  "myExperiencePage",
  "voluntaryDisclosuresPage",
  "selfIdentificationPage",
  "applicationForm",
  "jobApplicationPage",
] as const;

// ─── Text Input Fields ──────────────────────────────────────────────

const FIELD_DEFS: FieldDef[] = [
  {
    profileKey: "first_name",
    automationIds: [
      "legalNameSection_firstName",
      "firstName",
      "formField-firstName",
    ],
    fallbackSelectors: [
      'input[data-automation-id*="firstName" i]',
      'input[aria-label*="First Name" i]',
    ],
  },
  {
    profileKey: "last_name",
    automationIds: [
      "legalNameSection_lastName",
      "lastName",
      "formField-lastName",
    ],
    fallbackSelectors: [
      'input[data-automation-id*="lastName" i]',
      'input[aria-label*="Last Name" i]',
    ],
  },
  {
    profileKey: "email",
    automationIds: [
      "addressSection_emailAddress",
      "email",
      "emailAddress",
      "formField-email",
    ],
    fallbackSelectors: [
      'input[data-automation-id*="email" i]',
      'input[type="email"]',
    ],
  },
  {
    profileKey: "phone",
    automationIds: [
      "phone-number",
      "phoneNumber",
      "formField-phone",
    ],
    fallbackSelectors: [
      'input[data-automation-id*="phone-number" i]',
      'input[type="tel"]',
    ],
  },
  {
    profileKey: "city",
    automationIds: [
      "addressSection_city",
      "city",
      "formField-city",
    ],
    fallbackSelectors: [
      'input[data-automation-id*="city" i]',
    ],
  },
  {
    profileKey: "zip_code",
    automationIds: [
      "addressSection_postalCode",
      "postalCode",
      "formField-postalCode",
    ],
    fallbackSelectors: [
      'input[data-automation-id*="postal" i]',
      'input[data-automation-id*="zip" i]',
    ],
  },
  {
    profileKey: "address",
    automationIds: [
      "addressSection_addressLine1",
      "addressLine1",
      "formField-addressLine1",
    ],
    fallbackSelectors: [
      'input[data-automation-id*="addressLine" i]',
    ],
  },
  {
    profileKey: "linkedin_url",
    automationIds: [
      "linkedInQuestion",
      "linkedin",
      "linkedIn",
      "formField-linkedin",
    ],
    fallbackSelectors: [
      'input[data-automation-id*="linkedin" i]',
      'input[aria-label*="LinkedIn" i]',
    ],
  },
  {
    profileKey: "website_url",
    automationIds: [
      "websiteQuestion",
      "website",
      "websiteUrl",
      "formField-website",
    ],
    fallbackSelectors: [
      'input[data-automation-id*="website" i]',
      'input[aria-label*="Website" i]',
    ],
  },
  {
    profileKey: "current_title",
    automationIds: [
      "jobTitle",
      "currentJobTitle",
      "formField-jobTitle",
    ],
    fallbackSelectors: [
      'input[data-automation-id*="jobTitle" i]',
    ],
  },
  {
    profileKey: "current_company",
    automationIds: [
      "company",
      "companyName",
      "employerName",
      "formField-company",
    ],
    fallbackSelectors: [
      'input[data-automation-id*="company" i]',
      'input[data-automation-id*="employer" i]',
    ],
  },
  {
    profileKey: "gpa",
    automationIds: [
      "gpa",
      "formField-gradeAverage",
    ],
    fallbackSelectors: [
      'input[data-automation-id*="gpa" i]',
    ],
  },
];

// ─── Simple Dropdown Fields (button[aria-haspopup="listbox"]) ───────

const DROPDOWN_DEFS: FieldDef[] = [
  {
    profileKey: "country",
    automationIds: [
      "addressSection_countryRegion",
      "countryRegion",
      "country",
      "formField-country",
    ],
  },
  {
    profileKey: "state",
    automationIds: [
      "addressSection_region",
      "region",
      "state",
      "formField-state",
    ],
  },
  {
    profileKey: "education_level",
    automationIds: [
      "degree",
      "educationDegree",
      "formField-degree",
    ],
  },
  {
    profileKey: "gender",
    automationIds: [
      "gender",
      "genderDropdown",
      "formField-gender",
    ],
  },
  {
    profileKey: "race_ethnicity",
    automationIds: [
      "ethnicity",
      "ethnicityDropdown",
      "raceEthnicity",
      "race",
      "hispanicOrLatino",
      "formField-ethnicity",
    ],
  },
  {
    profileKey: "veteran_status",
    automationIds: [
      "veteranStatus",
      "veteran",
      "formField-veteran",
    ],
  },
  {
    profileKey: "disability_status",
    automationIds: [
      "disabilityStatus",
      "disability",
      "formField-disability",
    ],
  },
  {
    profileKey: "work_authorization",
    automationIds: [
      "sponsorship",
      "visaSponsorship",
      "requireSponsorship",
      "formField-sponsorship",
    ],
  },
  {
    profileKey: "authorized_to_work",
    automationIds: [
      "authorizedToWork",
      "legallyAuthorized",
      "workAuthorization",
      "formField-authorizedToWork",
    ],
  },
  {
    profileKey: "willing_to_relocate",
    automationIds: [
      "relocate",
      "willingToRelocate",
      "relocation",
      "formField-relocate",
    ],
  },
];

// ─── Searchable Dropdown Fields (multiSelectContainer pattern) ──────

const SEARCHABLE_DROPDOWN_DEFS: FieldDef[] = [
  {
    profileKey: "referral_source",
    automationIds: [
      "formField-sourcePrompt",
      "formField-source",
      "source",
      "sourceSection",
    ],
  },
  {
    profileKey: "university",
    automationIds: [
      "formField-schoolItem",
      "formField-school",
      "school",
      "schoolItem",
      "educationSchool",
      "schoolName",
      "formField-educationSchool",
      "formField-schoolName",
      "formField-schoolSection",
    ],
  },
  {
    profileKey: "field_of_study",
    automationIds: [
      "formField-field-of-study",
      "formField-fieldOfStudy",
      "fieldOfStudy",
    ],
  },
  {
    profileKey: "skills",
    automationIds: [
      "formField-skillsPrompt",
      "formField-skills",
    ],
  },
];

// ─── Handler ────────────────────────────────────────────────────────

export const workdayHandler: ATSHandler = {
  platform: "workday",

  detectFields(doc: Document, profile: UserProfile): DetectedField[] {
    const detected: DetectedField[] = [];
    const foundKeys = new Set<string>();

    // 1. Detect text input fields by data-automation-id
    for (const def of FIELD_DEFS) {
      const el = findWorkdayInput(doc, def);
      if (el && !foundKeys.has(def.profileKey)) {
        detected.push({
          profileKey: def.profileKey,
          label: findWorkdayLabel(el, doc) || def.profileKey,
          tagName: el.tagName.toLowerCase(),
          type: el instanceof HTMLInputElement ? el.type || "text" : "text",
          currentValue: el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement
            ? el.value
            : "",
          selector: buildWorkdaySelector(el),
          confidence: "high",
          fieldType: "input",
        });
        foundKeys.add(def.profileKey);
      }
    }

    // 2. Detect simple dropdown fields (button[aria-haspopup="listbox"])
    for (const def of DROPDOWN_DEFS) {
      const trigger = findWorkdayDropdown(doc, def);
      if (trigger && !foundKeys.has(def.profileKey)) {
        detected.push({
          profileKey: def.profileKey,
          label: findWorkdayLabel(trigger, doc) || def.profileKey,
          tagName: trigger.tagName.toLowerCase(),
          type: "custom-dropdown",
          currentValue: getDropdownCurrentValue(trigger),
          selector: buildWorkdaySelector(trigger),
          confidence: "high",
          fieldType: "custom-dropdown",
        });
        foundKeys.add(def.profileKey);
      }
    }

    // 3. Detect searchable dropdowns (multiSelectContainer pattern)
    for (const def of SEARCHABLE_DROPDOWN_DEFS) {
      const container = findSearchableDropdown(doc, def);
      if (container && !foundKeys.has(def.profileKey)) {
        detected.push({
          profileKey: def.profileKey,
          label: findWorkdayLabel(container, doc) || def.profileKey,
          tagName: container.tagName.toLowerCase(),
          type: "custom-dropdown",
          currentValue: getSearchableDropdownValue(container),
          selector: buildWorkdaySelector(container),
          confidence: "high",
          fieldType: "custom-dropdown",
        });
        foundKeys.add(def.profileKey);
      }
    }

    // 3b. Label-based fallback for searchable dropdowns not matched by automation IDs
    const allMultiSelects = formContainer.querySelectorAll<HTMLElement>(
      '[data-automation-id="multiSelectContainer"], [data-automation-id="multiselectInputContainer"]',
    );
    for (const ms of allMultiSelects) {
      const label = findWorkdayLabel(ms, doc);
      if (!label) continue;
      const key = labelToProfileKey(label);
      if (key && !foundKeys.has(key)) {
        detected.push({
          profileKey: key,
          label,
          tagName: ms.tagName.toLowerCase(),
          type: "custom-dropdown",
          currentValue: getSearchableDropdownValue(ms),
          selector: buildWorkdaySelector(ms),
          confidence: "medium",
          fieldType: "custom-dropdown",
        });
        foundKeys.add(key);
      }
    }

    // 4. Detect native <select> elements (rare on Workday but possible)
    const selects = doc.querySelectorAll<HTMLSelectElement>(
      'select[data-automation-id]',
    );
    for (const sel of selects) {
      const automationId = sel.getAttribute("data-automation-id") ?? "";
      const label = findWorkdayLabel(sel, doc);
      const key = automationIdToProfileKey(automationId) ??
        (label ? labelToProfileKey(label) : null);

      if (key && !foundKeys.has(key)) {
        detected.push({
          profileKey: key,
          label: label || key,
          tagName: "select",
          type: "select",
          currentValue: sel.value,
          selector: buildWorkdaySelector(sel),
          confidence: "high",
          fieldType: "select",
        });
        foundKeys.add(key);
      }
    }

    // 5. Scan formField-* containers for inputs not matched by specific defs
    const formContainer = getFormContainer(doc);

    const formFieldContainers = formContainer.querySelectorAll<HTMLElement>(
      '[data-automation-id^="formField-"]',
    );
    for (const container of formFieldContainers) {
      // Skip containers that contain dropdowns (they have aria-haspopup)
      const hasDropdown = container.querySelector('button[aria-haspopup], [role="combobox"], [data-automation-id="multiSelectContainer"]');
      const input = container.querySelector<HTMLInputElement | HTMLTextAreaElement>(
        'input:not([type="hidden"]):not([type="file"]):not([type="checkbox"]):not([type="radio"]):not([type="password"]), textarea',
      );
      if (!input || hasDropdown) continue;

      const label = findWorkdayLabel(input, doc);
      if (!label) continue;

      const key = labelToProfileKey(label);
      if (key && !foundKeys.has(key)) {
        detected.push({
          profileKey: key,
          label,
          tagName: input.tagName.toLowerCase(),
          type: input instanceof HTMLInputElement ? input.type || "text" : "text",
          currentValue: input.value,
          selector: buildWorkdaySelector(input),
          confidence: "medium",
          fieldType: "input",
        });
        foundKeys.add(key);
      }
    }

    // 6. Scan remaining inputs by label (custom questions / unknown fields)
    const allInputs = formContainer.querySelectorAll<
      HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
    >(
      'input:not([type="hidden"]):not([type="file"]):not([type="submit"]):not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="password"]), textarea, select',
    );

    for (const el of allInputs) {
      const label = findWorkdayLabel(el, doc);
      if (!label) continue;

      const key = labelToProfileKey(label);
      if (key && !foundKeys.has(key)) {
        const isSelect = el instanceof HTMLSelectElement;
        detected.push({
          profileKey: key,
          label,
          tagName: el.tagName.toLowerCase(),
          type: isSelect ? "select" : (el instanceof HTMLInputElement ? el.type || "text" : "text"),
          currentValue: el.value,
          selector: buildWorkdaySelector(el),
          confidence: "medium",
          fieldType: isSelect ? "select" : "input",
        });
        foundKeys.add(key);
      }
    }

    // 7. Detect ARIA combobox triggers missed by automation IDs
    const comboboxes = formContainer.querySelectorAll<HTMLElement>(
      'button[aria-haspopup="listbox"]:not([data-automation-id])',
    );
    for (const trigger of comboboxes) {
      const label = findWorkdayLabel(trigger, doc);
      if (!label) continue;

      const key = labelToProfileKey(label);
      if (key && !foundKeys.has(key)) {
        detected.push({
          profileKey: key,
          label,
          tagName: trigger.tagName.toLowerCase(),
          type: "custom-dropdown",
          currentValue: getDropdownCurrentValue(trigger),
          selector: buildWorkdaySelector(trigger),
          confidence: "medium",
          fieldType: "custom-dropdown",
        });
        foundKeys.add(key);
      }
    }

    // 8. Detect resume file input (verified selector: file-upload-input-ref)
    const fileInput = doc.querySelector<HTMLInputElement>(
      '[data-automation-id="file-upload-input-ref"], ' +
      '[data-automation-id="file-upload-drop-zone"] input[type="file"], ' +
      'input[type="file"]',
    );
    if (fileInput) {
      detected.push({
        profileKey: null,
        label: "Resume/CV",
        tagName: "input",
        type: "file",
        fieldType: "file",
        currentValue: "",
        selector: buildWorkdaySelector(fileInput),
        confidence: "high",
      });
    }

    // 9. Detect work experience entries (multi-entry support)
    // Workday renders each experience as a section; we scan by label within
    // each section and map to the _experiences array on the profile.
    const experiences = profile._experiences ?? [];
    if (experiences.length > 0) {
      detectExperienceEntries(doc, formContainer, detected, foundKeys, experiences);
    }

    // 10. Detect education entries (multi-entry support)
    const education = profile._education ?? [];
    if (education.length > 0) {
      detectEducationEntries(doc, formContainer, detected, foundKeys, education);
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

      // Handle Workday Canvas Kit dropdowns (simple + searchable)
      if (field.fieldType === "custom-dropdown") {
        const trigger = doc.querySelector<HTMLElement>(field.selector);
        if (trigger) {
          // Check if it's a searchable dropdown (multiSelectContainer)
          const isSearchable = trigger.querySelector('[data-automation-id="multiSelectContainer"]')
            || trigger.matches('[data-automation-id="multiSelectContainer"]')
            || trigger.closest('[data-automation-id="multiSelectContainer"]');

          const success = isSearchable
            ? await fillSearchableDropdown(trigger, field.value, doc)
            : await fillWorkdayDropdown(trigger, field.value, doc);
          if (success) filled++;
        }
        await humanDelay(150, 350);
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
      await humanDelay(100, 300);
    }

    return filled;
  },
};

// ─── Workday-specific Helpers ───────────────────────────────────────

/**
 * Get the current wizard page form container.
 */
function getFormContainer(doc: Document): Element {
  for (const id of PAGE_CONTAINERS) {
    const container = doc.querySelector(`[data-automation-id="${id}"]`);
    if (container) return container;
  }
  return doc.querySelector("form") ?? doc;
}

/**
 * Find an input element using Workday's data-automation-id attributes.
 * Handles both patterns:
 * 1. data-automation-id directly on the <input>
 * 2. data-automation-id on a parent container with <input> nested inside
 */
function findWorkdayInput(
  doc: Document,
  def: FieldDef,
): HTMLInputElement | HTMLTextAreaElement | null {
  // Try direct match on input
  for (const id of def.automationIds) {
    const el = doc.querySelector<HTMLInputElement | HTMLTextAreaElement>(
      `input[data-automation-id="${id}"], textarea[data-automation-id="${id}"]`,
    );
    if (el) return el;
  }

  // Try container match — find input inside a container with the automation ID
  for (const id of def.automationIds) {
    const container = doc.querySelector<HTMLElement>(
      `[data-automation-id="${id}"]`,
    );
    if (container) {
      // If the container itself IS a dropdown trigger, skip (handled by DROPDOWN_DEFS)
      if (container.matches('button[aria-haspopup], [role="combobox"]')) continue;

      const input = container.querySelector<HTMLInputElement | HTMLTextAreaElement>(
        'input:not([type="hidden"]):not([type="file"]):not([type="checkbox"]):not([type="radio"]):not([type="password"]), textarea',
      );
      if (input) return input;
    }
  }

  // Fallback selectors
  if (def.fallbackSelectors) {
    for (const sel of def.fallbackSelectors) {
      const el = doc.querySelector<HTMLInputElement | HTMLTextAreaElement>(sel);
      if (el) return el;
    }
  }

  return null;
}

/**
 * Find a Workday simple dropdown trigger by automation ID.
 * These are typically <button aria-haspopup="listbox"> elements inside a container.
 */
function findWorkdayDropdown(doc: Document, def: FieldDef): HTMLElement | null {
  for (const id of def.automationIds) {
    // Direct match on a button/combobox
    const trigger = doc.querySelector<HTMLElement>(
      `button[data-automation-id="${id}"][aria-haspopup="listbox"], ` +
      `button[data-automation-id="${id}"], ` +
      `[data-automation-id="${id}"][role="combobox"]`,
    );
    if (trigger) return trigger;

    // Container with a dropdown button inside
    const container = doc.querySelector<HTMLElement>(
      `[data-automation-id="${id}"]`,
    );
    if (container) {
      const btn = container.querySelector<HTMLElement>(
        'button[aria-haspopup="listbox"], [role="combobox"], button[aria-haspopup="true"]',
      );
      if (btn) return btn;
    }
  }

  return null;
}

/**
 * Find a Workday searchable dropdown (multiSelectContainer) by automation ID.
 */
function findSearchableDropdown(doc: Document, def: FieldDef): HTMLElement | null {
  for (const id of def.automationIds) {
    const container = doc.querySelector<HTMLElement>(
      `[data-automation-id="${id}"]`,
    );
    if (container) {
      // Check if it contains a multiSelectContainer or a search input
      const multiSelect = container.querySelector<HTMLElement>(
        '[data-automation-id="multiSelectContainer"], [data-automation-id="multiselectInputContainer"]',
      );
      if (multiSelect) return multiSelect;

      // Some searchable dropdowns just have an input inside
      const searchInput = container.querySelector<HTMLElement>('input');
      if (searchInput) return container;
    }
  }

  return null;
}

/**
 * Fill a Workday simple dropdown (non-searchable).
 *
 * Pattern: click button → listbox appears → click matching option.
 */
async function fillWorkdayDropdown(
  trigger: HTMLElement,
  value: string,
  doc: Document,
): Promise<boolean> {
  // Click to open
  trigger.focus();
  trigger.click();
  trigger.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
  trigger.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));

  // Wait for listbox to render
  await new Promise((r) => setTimeout(r, 300));

  // Find the listbox via aria-controls
  const listboxId = trigger.getAttribute("aria-controls") ??
    trigger.getAttribute("aria-owns");
  let listbox: Element | null = null;

  if (listboxId) {
    listbox = doc.getElementById(listboxId);
  }

  if (!listbox) {
    // Look for a recently appeared listbox
    listbox = doc.querySelector(
      '[role="listbox"]:not([style*="display: none"]), ' +
      'ul[role="listbox"]',
    );
  }

  if (!listbox) {
    // Fallback to the generic dropdown handler
    trigger.click(); // close
    await new Promise((r) => setTimeout(r, 100));
    return fillCustomDropdown(trigger, value, doc);
  }

  // Find matching option in the listbox
  const options = listbox.querySelectorAll<HTMLElement>(
    '[role="option"], li',
  );

  const matched = findMatchingOption(options, value);

  if (matched) {
    matched.scrollIntoView({ block: "nearest" });
    matched.click();
    matched.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    matched.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    return true;
  }

  // Close dropdown if no match found
  trigger.click();
  return false;
}

/**
 * Fill a Workday searchable dropdown (multiSelectContainer).
 *
 * Pattern: find input → type search term → wait for popup → click promptOption.
 */
async function fillSearchableDropdown(
  container: HTMLElement,
  value: string,
  doc: Document,
): Promise<boolean> {
  // Find the search input inside the multi-select container
  const searchInput = container.querySelector<HTMLInputElement>(
    'input, [data-automation-id="monikerSearchBox"]',
  );

  if (!searchInput) {
    // Fallback to simple dropdown
    return fillWorkdayDropdown(container, value, doc);
  }

  // Type the value to trigger search
  searchInput.focus();
  setFieldValue(searchInput, value);
  await new Promise((r) => setTimeout(r, 500));

  // Find the popup with options
  // Workday uses data-automation-widget="wd-popup" linked via data-associated-widget
  const containerId = container.id || container.getAttribute("data-automation-id");
  let popup: Element | null = null;

  if (containerId) {
    popup = doc.querySelector(
      `[data-associated-widget="${containerId}"], ` +
      `[data-automation-widget="wd-popup"]`,
    );
  }

  if (!popup) {
    popup = doc.querySelector(
      '[data-automation-widget="wd-popup"], ' +
      '[data-automation-id="promptOption"]',
    );
  }

  // Look for prompt options (in the popup or globally)
  const searchScope = popup ?? doc;
  const options = searchScope.querySelectorAll<HTMLElement>(
    '[data-automation-id="promptOption"]',
  );

  if (options.length === 0) {
    // No options found — try clicking the first result that appears
    await new Promise((r) => setTimeout(r, 300));
    const retryOptions = (popup ?? doc).querySelectorAll<HTMLElement>(
      '[data-automation-id="promptOption"]',
    );
    if (retryOptions.length > 0) {
      retryOptions[0].click();
      return true;
    }
    return false;
  }

  const matched = findMatchingOption(options, value);
  if (matched) {
    matched.click();
    return true;
  }

  // If no exact match, click the first option (Workday pre-filters by search)
  if (options.length > 0) {
    options[0].click();
    return true;
  }

  return false;
}

/**
 * Find a search input inside an open dropdown popup.
 */
function findDropdownSearchInput(
  trigger: HTMLElement,
  doc: Document,
): HTMLInputElement | null {
  const popupId = trigger.getAttribute("aria-controls") ??
    trigger.getAttribute("aria-owns");

  if (popupId) {
    const popup = doc.getElementById(popupId);
    if (popup) {
      const input = popup.querySelector<HTMLInputElement>(
        'input[type="text"], input[type="search"], input:not([type])',
      );
      if (input) return input;
    }
  }

  // Check for a search input near the trigger
  const parent = trigger.closest('[data-automation-id]') ?? trigger.parentElement;
  if (parent) {
    const input = parent.querySelector<HTMLInputElement>(
      'input[type="text"], input[type="search"]',
    );
    if (input && input !== trigger) return input;
  }

  return null;
}

/**
 * Match an option from a set of candidates using exact, alias, and fuzzy matching.
 */
function findMatchingOption(
  options: NodeListOf<HTMLElement>,
  value: string,
): HTMLElement | null {
  const lower = value.toLowerCase().trim();

  // Exact text match
  for (const opt of options) {
    const text = opt.textContent?.trim().toLowerCase() ?? "";
    if (text === lower) return opt;
  }

  // Starts-with match
  for (const opt of options) {
    const text = opt.textContent?.trim().toLowerCase() ?? "";
    if (text.startsWith(lower) || lower.startsWith(text)) return opt;
  }

  // Contains match
  for (const opt of options) {
    const text = opt.textContent?.trim().toLowerCase() ?? "";
    if (text.includes(lower) || lower.includes(text)) return opt;
  }

  return null;
}

/**
 * Get the currently displayed value of a Workday simple dropdown.
 */
function getDropdownCurrentValue(trigger: HTMLElement): string {
  const valueSpan = trigger.querySelector<HTMLElement>(
    '[data-automation-id="selectedValue"], ' +
    '[class*="selected"], ' +
    '[class*="value"]:not([class*="placeholder"])',
  );
  if (valueSpan?.textContent?.trim()) {
    return valueSpan.textContent.trim();
  }

  return trigger.textContent?.trim() ?? "";
}

/**
 * Get the currently selected value(s) of a searchable dropdown.
 */
function getSearchableDropdownValue(container: HTMLElement): string {
  const selectedItems = container.querySelectorAll<HTMLElement>(
    '[data-automation-id="selectedItemList"] li, [data-automation-id="selectedItem"]',
  );
  if (selectedItems.length > 0) {
    return Array.from(selectedItems)
      .map((el) => el.textContent?.trim() ?? "")
      .filter(Boolean)
      .join(", ");
  }
  return "";
}

/**
 * Find a Workday label for an element.
 * Workday labels are in data-automation-id="formLabel" elements or parent containers.
 */
function findWorkdayLabel(el: HTMLElement, doc: Document): string {
  // 1. Check for Workday-specific label automation IDs in parent container
  const container = el.closest('[data-automation-id^="formField-"]')
    ?? el.closest('[data-automation-id]');
  if (container) {
    const label = container.querySelector<HTMLElement>(
      '[data-automation-id="formLabel"], ' +
      '[data-automation-id="label"], ' +
      'label, legend',
    );
    if (label?.textContent?.trim()) return label.textContent.trim();
  }

  // 2. data-automation-id on the element → convert to readable label
  const automationId = el.getAttribute("data-automation-id")
    ?? el.closest('[data-automation-id]')?.getAttribute("data-automation-id");
  if (automationId) {
    const readable = automationId
      .replace(/^formField-/, "")
      .replace(/Section_?/g, " ")
      .replace(/([A-Z])/g, " $1")
      .replace(/[_-]/g, " ")
      .trim();
    if (readable.length > 2) return readable;
  }

  // 3. Fall back to the generic label finder
  return findLabelForElement(el, doc);
}

/**
 * Map a data-automation-id to a profile key.
 */
function automationIdToProfileKey(automationId: string): keyof UserProfile | null {
  const id = automationId.toLowerCase();

  for (const def of FIELD_DEFS) {
    for (const aid of def.automationIds) {
      if (aid.toLowerCase() === id) return def.profileKey;
    }
  }
  for (const def of DROPDOWN_DEFS) {
    for (const aid of def.automationIds) {
      if (aid.toLowerCase() === id) return def.profileKey;
    }
  }
  for (const def of SEARCHABLE_DROPDOWN_DEFS) {
    for (const aid of def.automationIds) {
      if (aid.toLowerCase() === id) return def.profileKey;
    }
  }

  return null;
}

/**
 * Build a CSS selector for a Workday element.
 * Prefers data-automation-id for stability across Workday updates.
 */
function buildWorkdaySelector(el: Element): string {
  const automationId = el.getAttribute("data-automation-id");
  if (automationId) {
    return `[data-automation-id="${CSS.escape(automationId)}"]`;
  }

  if (el.id) return `#${CSS.escape(el.id)}`;

  const ariaLabel = el.getAttribute("aria-label");
  if (ariaLabel) {
    return `${el.tagName.toLowerCase()}[aria-label="${CSS.escape(ariaLabel)}"]`;
  }

  const name = el.getAttribute("name");
  if (name) return `${el.tagName.toLowerCase()}[name="${CSS.escape(name)}"]`;

  // Walk up to find a parent with data-automation-id
  let parent = el.parentElement;
  while (parent) {
    const parentAid = parent.getAttribute("data-automation-id");
    if (parentAid) {
      const siblings = Array.from(parent.querySelectorAll(el.tagName.toLowerCase()));
      const idx = siblings.indexOf(el);
      if (idx === 0 && siblings.length === 1) {
        return `[data-automation-id="${CSS.escape(parentAid)}"] ${el.tagName.toLowerCase()}`;
      }
      return `[data-automation-id="${CSS.escape(parentAid)}"] ${el.tagName.toLowerCase()}:nth-of-type(${idx + 1})`;
    }
    parent = parent.parentElement;
  }

  // Last resort: nth-child path
  const parentEl = el.parentElement;
  if (parentEl) {
    const siblings = Array.from(parentEl.children);
    const idx = siblings.indexOf(el) + 1;
    return `${buildWorkdaySelector(parentEl)} > ${el.tagName.toLowerCase()}:nth-child(${idx})`;
  }

  return el.tagName.toLowerCase();
}

/**
 * Detect the current wizard step name from the progress bar.
 */
export function getWorkdayWizardStep(doc: Document): string | null {
  const activeStep = doc.querySelector<HTMLElement>(
    '[data-automation-id="progressBarActiveStep"]',
  );
  if (activeStep) {
    // The step name is typically in the third child element
    const children = activeStep.children;
    if (children.length >= 3) {
      return children[2]?.textContent?.trim() ?? null;
    }
    return activeStep.textContent?.trim() ?? null;
  }
  return null;
}

// ─── Work Experience Multi-Entry Detection ──────────────────────────

/**
 * Work experience field labels and the property name in the _experiences array.
 */
const EXP_LABEL_PATTERNS: Array<{
  patterns: RegExp[];
  expKey: "title" | "company" | "description" | "location" | "startDate" | "endDate";
}> = [
  // Description BEFORE title so "Role Description" matches description, not title
  { patterns: [/description/i, /responsibilities/i, /role\s*description/i, /summary/i], expKey: "description" },
  { patterns: [/job\s*title/i, /^title$/i, /position\s*title/i, /^role$/i, /^role\s*name/i], expKey: "title" },
  { patterns: [/company/i, /employer/i, /organization/i, /company\s*name/i], expKey: "company" },
  { patterns: [/location/i, /city/i, /work\s*location/i], expKey: "location" },
  { patterns: [/start\s*date/i, /from\s*date/i, /^from\b/i, /began/i], expKey: "startDate" },
  { patterns: [/end\s*date/i, /to\s*date/i, /^to\s/i, /until/i, /^to$/i], expKey: "endDate" },
];

function matchExpLabel(label: string): "title" | "company" | "description" | "location" | "startDate" | "endDate" | null {
  for (const entry of EXP_LABEL_PATTERNS) {
    for (const p of entry.patterns) {
      if (p.test(label)) return entry.expKey;
    }
  }
  return null;
}

/**
 * Detect work experience entries within the My Experience page.
 *
 * Strategy: find repeatable experience sections by looking for groups of
 * fields that contain a job title + company combination. Each group maps
 * to an entry in the _experiences array.
 */
function detectExperienceEntries(
  doc: Document,
  formContainer: Element,
  detected: DetectedField[],
  foundKeys: Set<string>,
  experiences: NonNullable<UserProfile["_experiences"]>,
): void {
  // Look for numbered work experience containers
  // Workday uses patterns like workExperience-1, workExperience-2, etc.
  const expContainers: HTMLElement[] = [];
  for (let i = 1; i <= 10; i++) {
    const container = formContainer.querySelector<HTMLElement>(
      `[data-automation-id="workExperience-${i}"], ` +
      `[data-automation-id="workExperience_${i}"], ` +
      `[data-automation-id="workExperienceSection-${i}"], ` +
      `[data-automation-id="workExperienceItem-${i}"]`,
    );
    if (container) expContainers.push(container);
  }

  // Also try generic experience container selectors
  if (expContainers.length === 0) {
    const genericContainers = formContainer.querySelectorAll<HTMLElement>(
      '[data-automation-id*="workExperience"], ' +
      '[data-automation-id*="experience-"], ' +
      '[data-automation-id="editSection"]',
    );
    for (const c of genericContainers) {
      // Only include if it has work experience-like fields inside
      const hasTitle = c.querySelector('[data-automation-id*="jobTitle"], [data-automation-id*="title"]');
      const hasCompany = c.querySelector('[data-automation-id*="company"], [data-automation-id*="employer"]');
      if (hasTitle || hasCompany) {
        expContainers.push(c);
      }
    }
  }

  // If no containers found, try scanning all inputs on the experience page
  // by looking for clusters of title+company fields
  if (expContainers.length === 0) {
    scanExperienceFieldsByLabel(doc, formContainer, detected, foundKeys, experiences);
    return;
  }

  // Map each container to an experience entry
  for (let idx = 0; idx < expContainers.length && idx < experiences.length; idx++) {
    const container = expContainers[idx];
    const exp = experiences[idx];

    // Find all inputs/textareas within this container
    const inputs = container.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
      'input:not([type="hidden"]):not([type="file"]):not([type="checkbox"]):not([type="radio"]), textarea',
    );

    for (const input of inputs) {
      const label = findWorkdayLabel(input, doc);
      if (!label) continue;

      const expKey = matchExpLabel(label);
      if (!expKey) continue;

      const value = exp[expKey];
      if (!value) continue;

      // Build a unique profile key for this entry: e.g. "_exp_0_company"
      const profileKey = `_exp_${idx}_${expKey}`;
      if (foundKeys.has(profileKey)) continue;

      detected.push({
        profileKey,
        label: `${label} (#${idx + 1})`,
        tagName: input.tagName.toLowerCase(),
        type: input instanceof HTMLInputElement ? input.type || "text" : "textarea",
        currentValue: input.value,
        selector: buildWorkdaySelector(input),
        confidence: "high",
        fieldType: "input",
      });
      foundKeys.add(profileKey);
    }
  }
}

/**
 * Fallback: scan all inputs on the experience page by label
 * when no numbered containers are found.
 *
 * Strategy: walk inputs in DOM order and detect entry boundaries by
 * watching for repeated "title" or "company" labels — each repetition
 * signals a new experience entry.
 */
function scanExperienceFieldsByLabel(
  doc: Document,
  formContainer: Element,
  detected: DetectedField[],
  foundKeys: Set<string>,
  experiences: NonNullable<UserProfile["_experiences"]>,
): void {
  const expPage = formContainer.querySelector('[data-automation-id="myExperiencePage"]') ?? formContainer;

  const inputs = expPage.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
    'input:not([type="hidden"]):not([type="file"]):not([type="checkbox"]):not([type="radio"]), textarea',
  );

  // Collect all experience-related fields in DOM order
  const matched: Array<{ input: HTMLInputElement | HTMLTextAreaElement; label: string; expKey: string }> = [];
  for (const input of inputs) {
    const label = findWorkdayLabel(input, doc);
    if (!label) continue;
    const expKey = matchExpLabel(label);
    if (!expKey) continue;
    matched.push({ input, label, expKey });
  }

  if (matched.length === 0) return;

  // Split into entries: a new entry starts when we see a key that already
  // appeared in the current entry (e.g. a second "title" means new entry)
  const entries: typeof matched[] = [];
  let currentEntry: typeof matched = [];
  const seenInEntry = new Set<string>();

  for (const field of matched) {
    if (seenInEntry.has(field.expKey)) {
      // Repeated key → start a new entry
      entries.push(currentEntry);
      currentEntry = [field];
      seenInEntry.clear();
      seenInEntry.add(field.expKey);
    } else {
      currentEntry.push(field);
      seenInEntry.add(field.expKey);
    }
  }
  if (currentEntry.length > 0) entries.push(currentEntry);

  // Map each entry group to an experience from the profile
  for (let idx = 0; idx < entries.length && idx < experiences.length; idx++) {
    const exp = experiences[idx];

    for (const { input, label, expKey } of entries[idx]) {
      const value = exp[expKey as keyof typeof exp];
      if (!value) continue;

      const profileKey = `_exp_${idx}_${expKey}`;
      if (foundKeys.has(profileKey)) continue;

      detected.push({
        profileKey,
        label: entries.length > 1 ? `${label} (#${idx + 1})` : label,
        tagName: input.tagName.toLowerCase(),
        type: input instanceof HTMLInputElement ? input.type || "text" : "textarea",
        currentValue: input.value,
        selector: buildWorkdaySelector(input),
        confidence: "high",
        fieldType: "input",
      });
      foundKeys.add(profileKey);
    }
  }
}

// ─── Education Multi-Entry Detection ────────────────────────────────

const EDU_LABEL_PATTERNS: Array<{
  patterns: RegExp[];
  eduKey: "institution" | "degree" | "field" | "gpa" | "startDate" | "endDate";
}> = [
  { patterns: [/school/i, /university/i, /college/i, /institution/i], eduKey: "institution" },
  { patterns: [/degree/i, /education\s*level/i], eduKey: "degree" },
  { patterns: [/field\s*of\s*study/i, /major/i, /area\s*of\s*study/i], eduKey: "field" },
  { patterns: [/gpa/i, /grade\s*point/i], eduKey: "gpa" },
  { patterns: [/start\s*date/i, /first\s*year/i, /^from\b/i], eduKey: "startDate" },
  { patterns: [/end\s*date/i, /last\s*year/i, /graduation/i, /^to\s/i, /^to$/i], eduKey: "endDate" },
];

function detectEducationEntries(
  doc: Document,
  formContainer: Element,
  detected: DetectedField[],
  foundKeys: Set<string>,
  education: NonNullable<UserProfile["_education"]>,
): void {
  const eduContainers: HTMLElement[] = [];
  for (let i = 1; i <= 10; i++) {
    const container = formContainer.querySelector<HTMLElement>(
      `[data-automation-id="education-${i}"], ` +
      `[data-automation-id="education_${i}"], ` +
      `[data-automation-id="educationSection-${i}"], ` +
      `[data-automation-id="educationItem-${i}"]`,
    );
    if (container) eduContainers.push(container);
  }

  if (eduContainers.length === 0) {
    const genericContainers = formContainer.querySelectorAll<HTMLElement>(
      '[data-automation-id*="education"], [data-automation-id*="Education"]',
    );
    for (const c of genericContainers) {
      const hasSchool = c.querySelector('[data-automation-id*="school"], [data-automation-id*="institution"]');
      const hasDegree = c.querySelector('[data-automation-id*="degree"]');
      if (hasSchool || hasDegree) {
        eduContainers.push(c);
      }
    }
  }

  if (eduContainers.length === 0) {
    scanEducationFieldsByLabel(doc, formContainer, detected, foundKeys, education);
    return;
  }

  for (let idx = 0; idx < eduContainers.length && idx < education.length; idx++) {
    const container = eduContainers[idx];
    const edu = education[idx];

    const inputs = container.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
      'input:not([type="hidden"]):not([type="file"]):not([type="checkbox"]):not([type="radio"]), textarea',
    );

    for (const input of inputs) {
      const label = findWorkdayLabel(input, doc);
      if (!label) continue;

      let eduKey: string | null = null;
      for (const entry of EDU_LABEL_PATTERNS) {
        for (const p of entry.patterns) {
          if (p.test(label)) { eduKey = entry.eduKey; break; }
        }
        if (eduKey) break;
      }
      if (!eduKey) continue;

      const value = edu[eduKey as keyof typeof edu];
      if (!value) continue;

      const profileKey = `_edu_${idx}_${eduKey}`;
      if (foundKeys.has(profileKey)) continue;

      detected.push({
        profileKey,
        label: education.length > 1 ? `${label} (#${idx + 1})` : label,
        tagName: input.tagName.toLowerCase(),
        type: input instanceof HTMLInputElement ? input.type || "text" : "textarea",
        currentValue: input.value,
        selector: buildWorkdaySelector(input),
        confidence: "high",
        fieldType: "input",
      });
      foundKeys.add(profileKey);
    }

    // Also scan searchable dropdowns inside the education container (e.g. School)
    const eduDropdowns = container.querySelectorAll<HTMLElement>(
      '[data-automation-id="multiSelectContainer"], [data-automation-id="multiselectInputContainer"]',
    );
    for (const dd of eduDropdowns) {
      const label = findWorkdayLabel(dd, doc);
      if (!label) continue;

      let eduKey: string | null = null;
      for (const entry of EDU_LABEL_PATTERNS) {
        for (const p of entry.patterns) {
          if (p.test(label)) { eduKey = entry.eduKey; break; }
        }
        if (eduKey) break;
      }
      if (!eduKey) continue;

      const value = edu[eduKey as keyof typeof edu];
      if (!value) continue;

      const profileKey = `_edu_${idx}_${eduKey}`;
      if (foundKeys.has(profileKey)) continue;

      detected.push({
        profileKey,
        label: education.length > 1 ? `${label} (#${idx + 1})` : label,
        tagName: dd.tagName.toLowerCase(),
        type: "custom-dropdown",
        currentValue: getSearchableDropdownValue(dd),
        selector: buildWorkdaySelector(dd),
        confidence: "high",
        fieldType: "custom-dropdown",
      });
      foundKeys.add(profileKey);
    }
  }
}

/** Fallback: scan education fields by label repetition (same approach as experience). */
function scanEducationFieldsByLabel(
  doc: Document,
  formContainer: Element,
  detected: DetectedField[],
  foundKeys: Set<string>,
  education: NonNullable<UserProfile["_education"]>,
): void {
  const eduPage = formContainer.querySelector('[data-automation-id="educationPage"]') ?? formContainer;

  const inputs = eduPage.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
    'input:not([type="hidden"]):not([type="file"]):not([type="checkbox"]):not([type="radio"]), textarea',
  );

  const matched: Array<{ input: HTMLInputElement | HTMLTextAreaElement; label: string; eduKey: string }> = [];
  for (const input of inputs) {
    const label = findWorkdayLabel(input, doc);
    if (!label) continue;
    let eduKey: string | null = null;
    for (const entry of EDU_LABEL_PATTERNS) {
      for (const p of entry.patterns) {
        if (p.test(label)) { eduKey = entry.eduKey; break; }
      }
      if (eduKey) break;
    }
    if (!eduKey) continue;
    matched.push({ input, label, eduKey });
  }

  if (matched.length === 0) return;

  const entries: typeof matched[] = [];
  let currentEntry: typeof matched = [];
  const seenInEntry = new Set<string>();

  for (const field of matched) {
    if (seenInEntry.has(field.eduKey)) {
      entries.push(currentEntry);
      currentEntry = [field];
      seenInEntry.clear();
      seenInEntry.add(field.eduKey);
    } else {
      currentEntry.push(field);
      seenInEntry.add(field.eduKey);
    }
  }
  if (currentEntry.length > 0) entries.push(currentEntry);

  for (let idx = 0; idx < entries.length && idx < education.length; idx++) {
    const edu = education[idx];

    for (const { input, label, eduKey } of entries[idx]) {
      const value = edu[eduKey as keyof typeof edu];
      if (!value) continue;

      const profileKey = `_edu_${idx}_${eduKey}`;
      if (foundKeys.has(profileKey)) continue;

      detected.push({
        profileKey,
        label: entries.length > 1 ? `${label} (#${idx + 1})` : label,
        tagName: input.tagName.toLowerCase(),
        type: input instanceof HTMLInputElement ? input.type || "text" : "textarea",
        currentValue: input.value,
        selector: buildWorkdaySelector(input),
        confidence: "high",
        fieldType: "input",
      });
      foundKeys.add(profileKey);
    }
  }
}
